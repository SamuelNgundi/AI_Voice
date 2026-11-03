#!/usr/bin/env node
/**
 * Pushes HOUNDIFY_CLIENT_ID / HOUNDIFY_CLIENT_KEY from local .env into the
 * linked Vercel project (production + preview + development), WITHOUT ever
 * echoing the secret values to stdout. Values are sanitized/validated using
 * the same logic the server uses, so paste artifacts are stripped first.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const isWindows = os.platform() === "win32";

const dotenv = require("dotenv");
const { validateHoundifyConfig } = require("../server");

const raw = dotenv.parse(fs.readFileSync(path.join(__dirname, "..", ".env")));
const cfg = validateHoundifyConfig(
    raw.HOUNDIFY_CLIENT_ID,
    raw.HOUNDIFY_CLIENT_KEY
);

const targets = {
    HOUNDIFY_CLIENT_ID: cfg.clientId,
    HOUNDIFY_CLIENT_KEY: cfg.clientKey,
};

function log(msg) {
    console.error(msg);
}

for (const [name, value] of Object.entries(targets)) {
    log(`Adding ${name} (${value.length} chars) to production/preview/development...`);
    const result = spawnSync(
        "vercel",
        [
            "env", "add", name,
            "--environment", "production",
            "--environment", "preview",
            "--environment", "development",
        ],
        {
            input: value + "\n",
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            shell: isWindows,
        }
    );
    const out = (result.stdout || "") + (result.stderr || "");
    // Redact: only show status lines, never the value.
    const redacted = out.split("\n").filter((l) => !l.includes(value));
    log(redacted.join("\n").trim());
    if (result.status !== 0) {
        log(`FAILED to add ${name}`);
        process.exit(1);
    }
    log(`OK: ${name} added\n`);
}

log("All environment variables added.");
console.log(JSON.stringify({ status: "success" }));
