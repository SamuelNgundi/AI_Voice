const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const houndifySdk = require("houndify");
const houndifyExpress = houndifySdk.HoundifyExpress;
const TextRequest = houndifySdk.TextRequest;
const compression = require("compression");
const rateLimit = require("express-rate-limit");
require("dotenv").config({ path: path.join(__dirname, ".env") });

// Enable verbose Houndify SDK logging with HOUNDIFY_DEBUG=1 in .env.
// Prints the exact auth headers, endpoint URL, and response status/body
// for every text request — useful for diagnosing 401/403 rejections.
if (process.env.HOUNDIFY_DEBUG === "1" || process.env.HOUNDIFY_DEBUG === "true") {
    try {
        houndifySdk.setDebug(true);
    } catch {
        /* older SDK versions may not expose setDebug */
    }
}

// ---------------------------------------------------------------------------
// Env-value sanitization: tolerate the common paste artifact of copying a
// value out of a JSON/dict view (surrounded by `{}` / `""` / `''` / backticks
// / `[]`). Does not alter a bare Base64 string.
// ---------------------------------------------------------------------------
function sanitizeEnvValue(raw) {
    if (typeof raw !== "string") return raw;
    let v = raw.trim();
    const pairs = [
        ["{", "}"],
        ["[", "]"],
        ['"', '"'],
        ["'", "'"],
        ["`", "`"],
    ];
    let changed = true;
    while (changed) {
        changed = false;
        v = v.trim();
        for (const [open, close] of pairs) {
            if (v.length >= 2 && v.startsWith(open) && v.endsWith(close)) {
                v = v.slice(1, -1);
                changed = true;
                break;
            }
        }
    }
    return v.trim();
}

function describeInvalidChars(value) {
    const allowed = new Set(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_".split(
            ""
        )
    );
    const bad = new Set();
    for (const ch of String(value)) {
        if (!allowed.has(ch)) bad.add(JSON.stringify(ch));
    }
    return Array.from(bad).join(", ");
}

function describeInvalidIdChars(value) {
    const bad = new Set();
    for (const ch of String(value)) {
        if (/[\s\x00-\x1f\x7f]/.test(ch)) bad.add(JSON.stringify(ch));
    }
    return Array.from(bad).join(", ");
}

function validateHoundifyConfig(rawId, rawKey) {
    const clientId = sanitizeEnvValue(rawId);
    const clientKey = sanitizeEnvValue(rawKey);

    if (!clientId || !clientKey) {
        throw new Error(
            "HOUNDIFY_CLIENT_ID and HOUNDIFY_CLIENT_KEY must be set in the environment or .env file. Copy .env.example to .env and fill in your credentials."
        );
    }

    if (/[\s\x00-\x1f\x7f]/.test(clientId)) {
        const bad = describeInvalidIdChars(clientId);
        throw new Error(
            `HOUNDIFY_CLIENT_ID contains whitespace or control characters${bad ? ` (${bad})` : ""}. ` +
                `It should be the bare ID string from the Houndify console, without spaces, braces, or quotes.`
        );
    }

    const normalizedClientKey = clientKey
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const unpaddedClientKey = normalizedClientKey.replace(/=+$/, "");
    const invalidChars = describeInvalidChars(normalizedClientKey);
    const hasInvalidChars =
        !/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedClientKey);
    const badLength = unpaddedClientKey.length % 4 === 1;
    const badPadding =
        normalizedClientKey.includes("=") &&
        normalizedClientKey.length % 4 !== 0;
    if (hasInvalidChars || badLength || badPadding) {
        const hints = [];
        if (hasInvalidChars) {
            hints.push(
                `invalid characters${invalidChars ? `: ${invalidChars}` : ""}`
            );
        }
        if (badLength) hints.push("unpadded length is not valid for Base64");
        if (badPadding) hints.push("'=' padding is misplaced");
        throw new Error(
            `HOUNDIFY_CLIENT_KEY is not a valid Base64/Base64URL string (${hints.join(
                "; "
            )}). Copy the key directly from the Houndify console; it should be a single unbroken string with no surrounding braces, quotes or extra text.`
        );
    }

    // Sanity-check that the key is a usable HMAC secret. This is a
    // self-contained dry-run that never leaves the process.
    try {
        const crypto = require("crypto");
        const keyBin = Buffer.from(normalizedClientKey, "base64");
        if (keyBin.length < 16) {
            throw new Error("decoded key too short");
        }
        crypto.createHmac("sha256", keyBin).update("probe").digest("base64");
    } catch (err) {
        throw new Error(
            `HOUNDIFY_CLIENT_KEY cannot be used as an HMAC secret after Base64 decoding: ${err.message}. Copy it directly from Houndify.`
        );
    }

    return { clientId, clientKey };
}

// ---------------------------------------------------------------------------
// IP-based coarse location (no device permissions).
// Resolved server-side from the real client IP, then sent to the browser via
// /houndifyConfig so voice and text queries can include Latitude/Longitude.
// City-level accuracy is the ceiling for IP geolocation — plenty for
// "weather / nearby" style queries. Failures are silent: queries simply go
// out without location instead of being blocked.
// ---------------------------------------------------------------------------
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const locationCache = new Map(); // ip -> { coords, expires }

// IPv4 + IPv4-mapped-IPv6 private/loopback ranges. Local dev traffic is
// private, so we skip the lookup instead of wasting ipinfo calls (a private
// `ip` value makes the whole session share one cached "" → null entry).
const PRIVATE_IP_RE =
    /^(?:127\.|10\.|192\.168\.|0\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|::1|localhost|(?:::ffff:)?(?:127\.|10\.|192\.168\.|0\.|172\.(?:1[6-9]|2[0-9]|3[01])\.))/i;

function isPrivateIp(ip) {
    return !ip || PRIVATE_IP_RE.test(ip);
}

async function fetchCoords(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return null;
        const body = await res.json();
        if (!body || typeof body.loc !== "string") return null;
        const [lat, lng] = body.loc.split(",").map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { latitude: lat, longitude: lng };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Coarse lat/lng for a request's client IP, or null when unavailable
 * (private IP, rate-limited upstream, timeout, VPN anycast, etc.).
 * `fetchImpl` is injectable for tests.
 */
async function resolveClientLocation(req, fetchImpl = fetch) {
    const ip = req.ip || req.connection?.remoteAddress || "";
    if (isPrivateIp(ip)) return null;

    const now = Date.now();
    const hit = locationCache.get(ip);
    if (hit && hit.expires > now) return hit.coords;

    // Authenticated requests get a higher (documented) quota; anonymous
    // fallbacks are fine for a low-traffic personal assistant.
    const token = process.env.IPINFO_TOKEN;
    const url = token
        ? `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`
        : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;
    const coords = await fetchCoordsWith(url, fetchImpl);
    // Cache misses too (shorter TTL) so a flaky upstream isn't retried on
    // every page load.
    const ttl = coords ? LOCATION_CACHE_TTL_MS : 60 * 1000;
    locationCache.set(ip, { coords, expires: now + ttl });
    if (locationCache.size > 500) {
        // Crude memory guard: drop expired entries, then oldest half.
        for (const [key, value] of locationCache) {
            if (value.expires <= now) locationCache.delete(key);
        }
        if (locationCache.size > 500) {
            let toDelete = Math.floor(locationCache.size / 2);
            for (const key of locationCache.keys()) {
                if (toDelete-- <= 0) break;
                locationCache.delete(key);
            }
        }
    }
    return coords;
}

async function fetchCoordsWith(url, fetchImpl) {
    if (fetchImpl === fetch) return fetchCoords(url);
    // Test-injected fetch: mimic the timeout-less path.
    try {
        const res = await fetchImpl(url);
        if (!res.ok) return null;
        const body = await res.json();
        if (!body || typeof body.loc !== "string") return null;
        const [lat, lng] = body.loc.split(",").map(Number);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { latitude: lat, longitude: lng };
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Shared API router. The exact same handlers power both the local Express
// server (createApp) and the Vercel Serverless Function (createApiApp), so
// behavior stays identical across environments. Mount it under any prefix.
//   limits: { authMax, configMax, textMax } override the rate-limiter caps
//           (used by the test suite; default to sane production values).
// ---------------------------------------------------------------------------
function buildApiRouter(config, limits = {}) {
    const router = express.Router();

    // Tight limit on the auth endpoint: it is an HMAC signing oracle and
    // should not be hammered. The browser only calls it once per query.
    const authLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: limits.authMax || 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many auth requests; try again later." },
    });
    const configLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: limits.configMax || 60,
        standardHeaders: true,
        legacyHeaders: false,
    });
    const textLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: limits.textMax || 20,
        standardHeaders: true,
        legacyHeaders: false,
    });

    router.get("/healthz", (_req, res) => {
        res.json({ ok: true, uptime: process.uptime() });
    });

    router.get("/houndifyConfig", configLimiter, async (req, res) => {
        // Coarse, permission-free location for both query flows. Best-effort:
        // on any failure the client just sends no coordinates.
        const coords = await resolveClientLocation(req).catch(() => null);
        res.set("Cache-Control", "no-store").json({
            clientId: config.clientId,
            latitude: coords ? coords.latitude : undefined,
            longitude: coords ? coords.longitude : undefined,
        });
    });

    router.get("/houndifyAuth", authLimiter, (req, res, next) => {
        // The houndify handler assumes a string `token`. Reject malformed
        // requests with a proper 4xx instead of blowing up with a 500.
        if (typeof req.query.token !== "string" || !req.query.token) {
            return res
                .status(400)
                .json({ error: "Missing required query parameter: token" });
        }
        try {
            houndifyExpress.createAuthenticationHandler({
                clientId: config.clientId,
                clientKey: config.clientKey,
            })(req, res, next);
        } catch (err) {
            next(err);
        }
    });

    // Text query endpoint — uses houndify's own TextRequest class so the
    // auth-header format matches whatever the SDK is tested against.
    // The client key stays here on the server; the browser never sees it.
    router.post("/houndifyText", textLimiter, async (req, res) => {
        const {
            query,
            conversationState,
            userId,
            latitude,
            longitude,
        } = req.body || {};

        if (typeof query !== "string" || !query.trim()) {
            return res
                .status(400)
                .json({ error: "Body must include a non-empty 'query' string." });
        }

        const requestInfo = {
            UserID: userId || "web-user",
        };
        if (typeof latitude === "number" && typeof longitude === "number") {
            requestInfo.Latitude = latitude;
            requestInfo.Longitude = longitude;
        }

        try {
            new TextRequest({
                clientId: config.clientId,
                clientKey: config.clientKey,
                method: "POST",
                query,
                requestInfo,
                conversationState: conversationState || undefined,
                onResponse: (response) => {
                    // `response` is Houndify's parsed body; forward it as-is.
                    res.json(response);
                },
                onError: (err, info) => {
                    // Log full error on the server so it's visible in the
                    // terminal, but return a clean structured JSON to the
                    // client so the UI can display the reason.
                    console.error("[houndifyText] upstream error:", err);
                    if (info && info.contentBody) {
                        console.error(
                            "[houndifyText] raw upstream body:",
                            info.contentBody
                        );
                    }
                    const type = err && err.type ? err.type : "UNKNOWN";
                    const statusByType = {
                        AUTHENTICATION: 403,
                        BAD_REQUEST: 400,
                        CONNECTION: 502,
                        SERVER: 502,
                        PROXY: 502,
                    };
                    const status = statusByType[type] || 502;
                    res.status(status).json({
                        error: "Houndify text request failed",
                        type,
                        exception: (err && err.exception) || err,
                        rawBody: (info && info.contentBody) || undefined,
                    });
                },
            });
        } catch (err) {
            console.error("[houndifyText] threw synchronously:", err);
            res.status(500).json({
                error: err && err.message ? err.message : String(err),
            });
        }
    });

    // Centralized error handler for anything that reaches the router via
    // next(err) — keeps stack traces off the wire.
    // eslint-disable-next-line no-unused-vars
    router.use((err, _req, res, _next) => {
        if (process.env.NODE_ENV !== "production") {
            console.error(err);
        }
        res.status(500).json({ error: "Internal server error" });
    });

    return router;
}

// ---------------------------------------------------------------------------
// App factory — exported for tests. Wires middleware + routes but does not
// bind to a port.
// ---------------------------------------------------------------------------
function createApp(overrides = {}) {
    const config =
        overrides.config ||
        validateHoundifyConfig(
            process.env.HOUNDIFY_CLIENT_ID,
            process.env.HOUNDIFY_CLIENT_KEY
        );

    const buildDir = overrides.buildDir || path.join(__dirname, "build");
    const indexHtml = path.join(buildDir, "index.html");
    const buildExists = fs.existsSync(indexHtml);

    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", 1);

    // Gzip responses (large CRA bundles benefit heavily).
    app.use(compression());

    // Body parsing for the text proxy.
    app.use(express.json({ limit: "64kb" }));

    // Static assets: hashed CRA chunks can be cached aggressively.
    if (buildExists) {
        app.use(
            "/static",
            express.static(path.join(buildDir, "static"), {
                maxAge: "1y",
                immutable: true,
            })
        );
        app.use(express.static(buildDir, { index: false, maxAge: 0 }));
    }

    // --- API routes (shared with the serverless build) -----------------
    // Mounted at both the bare path (matches the CRA dev proxy) and under
    // /api (matches how Vercel serves the function). Same handlers either way.
    app.use(buildApiRouter(config, overrides));
    app.use("/api", buildApiRouter(config, overrides));

    // SPA fallback: any GET not matching an API route serves index.html so
    // client-side routing keeps working on hard refreshes.
    if (buildExists) {
        app.get(/^\/(?!houndify|healthz|api).*/, (_req, res) => {
            res.sendFile(indexHtml);
        });
    } else {
        app.get("/", (_req, res) => {
            res.status(503).send(
                "Frontend build not found. Run `npm run build` first, or use `npm start` for the CRA dev server."
            );
        });
    }

    // Centralized error handler — keeps stack traces off the wire.
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
        if (process.env.NODE_ENV !== "production") {
            console.error(err);
        }
        res.status(500).json({ error: "Internal server error" });
    });

    return app;
}

// ---------------------------------------------------------------------------
// Serverless API app — for Vercel (and other serverless Node runtimes). Same
// API routes as createApp, but WITHOUT static-file serving or the SPA
// fallback, because Vercel serves the CRA `build/` as static assets itself.
// Exported from api/[...all].js and invoked as a (req, res) listener.
// ---------------------------------------------------------------------------
function createApiApp(overrides = {}) {
    const config =
        overrides.config ||
        validateHoundifyConfig(
            process.env.HOUNDIFY_CLIENT_ID,
            process.env.HOUNDIFY_CLIENT_KEY
        );

    const app = express();
    app.disable("x-powered-by");
    // Behind Vercel's proxy, trust X-Forwarded-* so the rate limiter and
    // redirects see the real client/protocol.
    app.set("trust proxy", 1);

    app.use(compression());
    app.use(express.json({ limit: "64kb" }));

    // Mount under /api (how Vercel delivers the path) and bare (in case the
    // runtime strips the prefix) so req.url matching is robust either way.
    app.use("/api", buildApiRouter(config, overrides));
    app.use("/", buildApiRouter(config, overrides));

    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => {
        if (process.env.NODE_ENV !== "production") {
            console.error(err);
        }
        res.status(500).json({ error: "Internal server error" });
    });

    return app;
}

// ---------------------------------------------------------------------------
// Server bootstrap (only when run directly, not during tests).
// ---------------------------------------------------------------------------
function startServer() {
    const app = createApp();

    const port = Number(process.env.PORT || 4000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535.");
    }
    // Default to localhost so a dev machine doesn't accidentally expose
    // the server on the LAN. Set HOST=0.0.0.0 to opt in.
    const host = process.env.HOST || "127.0.0.1";

    const server = http.createServer(app);
    server.listen(port, host, () => {
        console.log(`Listening on http://${host}:${port}`);
    });

    const shutdown = (signal) => {
        console.log(`\n${signal} received, closing server…`);
        server.close((err) => {
            if (err) {
                console.error("Error during shutdown:", err);
                process.exit(1);
            }
            process.exit(0);
        });
        // Force-exit if in-flight requests hang for too long.
        setTimeout(() => {
            console.warn("Forcing exit after 10s timeout.");
            process.exit(1);
        }, 10_000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = {
    createApp,
    createApiApp,
    buildApiRouter,
    startServer,
    validateHoundifyConfig,
    resolveClientLocation,
    isPrivateIp,
};
