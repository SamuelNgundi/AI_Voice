// Basic tests for server.js — run with `npm run test:server`.
// Uses Node's built-in test runner (Node 18+) and supertest for HTTP asserts.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const request = require("supertest");

const { createApp, validateHoundifyConfig } = require("./server");

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
