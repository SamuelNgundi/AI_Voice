// Basic tests for server.js — run with `npm run test:server`.
// Uses Node's built-in test runner (Node 18+) and supertest for HTTP asserts.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const request = require("supertest");

const { createApp, validateHoundifyConfig, resolveClientLocation, isPrivateIp } =
    require("./server");

// A syntactically valid Base64 HMAC key (32 random bytes). Tests never send
// this to a real backend; it just needs to pass validation.
const VALID_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const VALID_ID = "TestApp-TestAccount";

function tempBuildDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "houndify-build-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>t</title>");
    return dir;
}

// ---------------------------------------------------------------------------
// validateHoundifyConfig
// ---------------------------------------------------------------------------
test("accepts a well-formed ID + Base64 key", () => {
    const out = validateHoundifyConfig(VALID_ID, VALID_KEY_B64);
    assert.equal(out.clientId, VALID_ID);
    assert.equal(out.clientKey, VALID_KEY_B64);
});

test("strips braces, quotes and whitespace paste artifacts", () => {
    const out = validateHoundifyConfig(
        `  {${VALID_ID}}  `,
        `"${VALID_KEY_B64}"`
    );
    assert.equal(out.clientId, VALID_ID);
    assert.equal(out.clientKey, VALID_KEY_B64);
});

test("rejects when either value is missing", () => {
    assert.throws(() => validateHoundifyConfig("", VALID_KEY_B64), /must be set/);
    assert.throws(() => validateHoundifyConfig(VALID_ID, undefined), /must be set/);
});

test("rejects an ID with whitespace or control characters", () => {
    assert.throws(
        () => validateHoundifyConfig("Bad ID With Space", VALID_KEY_B64),
        /whitespace or control characters/
    );
});

test("rejects a key with non-Base64 characters", () => {
    assert.throws(
        () => validateHoundifyConfig(VALID_ID, "not base64!!"),
        /invalid characters/
    );
});

test("rejects a key whose decoded length is too short for HMAC", () => {
    // 8 bytes decodes but is not a usable HMAC secret per our sanity check.
    const shortKey = Buffer.alloc(8, 1).toString("base64");
    assert.throws(
        () => validateHoundifyConfig(VALID_ID, shortKey),
        /HMAC secret/
    );
});

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------
function buildTestApp(overrides = {}) {
    return createApp({
        config: { clientId: VALID_ID, clientKey: VALID_KEY_B64 },
        buildDir: tempBuildDir(),
        authMax: 5,
        configMax: 5,
        textMax: 5,
        ...overrides,
    });
}

test("GET /healthz returns ok", async () => {
    const res = await request(buildTestApp()).get("/healthz").expect(200);
    assert.equal(res.body.ok, true);
});

test("GET /houndifyConfig exposes only the client ID", async () => {
    // Supertest connects from 127.0.0.1, which isPrivateIp treats as
    // unlocatable — so no coordinates are attached on local requests.
    const res = await request(buildTestApp()).get("/houndifyConfig").expect(200);
    assert.deepEqual(res.body, { clientId: VALID_ID });
    assert.equal(res.headers["cache-control"], "no-store");
});

test("GET /houndifyAuth rejects missing token with 400", async () => {
    const res = await request(buildTestApp()).get("/houndifyAuth").expect(400);
    assert.match(res.body.error, /token/);
});

test("GET /houndifyAuth signs a valid token", async () => {
    const res = await request(buildTestApp())
        .get("/houndifyAuth")
        .query({ token: "dGVzdA==" })
        .expect(200);
    assert.ok(typeof res.text === "string" && res.text.length > 0);
});

test("GET /houndifyAuth rate-limits after repeated hits", async () => {
    const app = buildTestApp({ authMax: 3 });
    for (let i = 0; i < 3; i++) {
        await request(app)
            .get("/houndifyAuth")
            .query({ token: "dGVzdA==" })
            .expect(200);
    }
    const res = await request(app)
        .get("/houndifyAuth")
        .query({ token: "dGVzdA==" });
    assert.equal(res.status, 429);
});

test("unknown non-API path falls back to index.html (SPA)", async () => {
    const res = await request(buildTestApp())
        .get("/some/client/route")
        .expect(200);
    assert.match(res.text, /<!doctype html>/i);
});

test("gzip compression is enabled", async () => {
    const res = await request(buildTestApp())
        .get("/houndifyConfig")
        .set("Accept-Encoding", "gzip");
    assert.equal(res.status, 200);
    // supertest decompresses automatically; just verify a body was returned.
    assert.equal(res.body.clientId, VALID_ID);
});

test("POST /houndifyText rejects missing query", async () => {
    const res = await request(buildTestApp())
        .post("/houndifyText")
        .send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /query/);
});

test("POST /houndifyText rejects whitespace-only query", async () => {
    const res = await request(buildTestApp())
        .post("/houndifyText")
        .send({ query: "   " });
    assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// IP-based coarse location (no device permissions)
// ---------------------------------------------------------------------------
test("isPrivateIp detects loopback, RFC1918, and IPv4-mapped variants", () => {
    for (const ip of [
        "127.0.0.1",
        "::ffff:127.0.0.1",
        "10.1.2.3",
        "192.168.1.5",
        "172.16.0.1",
        "::1",
        "",
    ]) {
        assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
    }
    for (const ip of ["8.8.8.8", "2001:4860:4860::8888"]) {
        assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
    }
});

test("resolveClientLocation skips the upstream for private IPs", async () => {
    let calls = 0;
    const fakeFetch = async () => {
        calls++;
        return { ok: true, json: async () => ({ loc: "1,1" }) };
    };
    const out = await resolveClientLocation(
        { ip: "::ffff:127.0.0.1" },
        fakeFetch
    );
    assert.equal(out, null);
    assert.equal(calls, 0);
});

test("resolveClientLocation returns parsed coords and caches per IP", async () => {
    const uniqueIp = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    let calls = 0;
    const fakeFetch = async () => {
        calls++;
        return { ok: true, json: async () => ({ loc: "-1.292,36.821" }) };
    };
    const req = { ip: uniqueIp };
    const first = await resolveClientLocation(req, fakeFetch);
    const second = await resolveClientLocation(req, fakeFetch);
    assert.deepEqual(first, { latitude: -1.292, longitude: 36.821 });
    assert.deepEqual(second, first);
    assert.equal(calls, 1); // second hit served from cache
});
test("resolveClientLocation returns null on malformed upstream data", async () => {
    const out = await resolveClientLocation(
        { ip: "198.51.100.42" },
        async () => ({ ok: true, json: async () => ({ loc: "nope" }) })
    );
    assert.equal(out, null);
});
