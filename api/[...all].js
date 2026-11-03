// Vercel Serverless Function entrypoint.
//
// The catch-all filename `[...all].js` maps every `/api/*` request to this
// single handler, so the whole Express API (mounted under /api in
// createApiApp) runs on Vercel's Node runtime. The long-lived `server.js`
// process cannot run on Vercel, so we export the Express app as a function
// instead — Vercel invokes it as (req, res) per request.
//
// Static files and the SPA are served by Vercel directly from the CRA
// `build/` output (see vercel.json `framework`), NOT through this function.
//
// Environment: HOUNDIFY_CLIENT_ID and HOUNDIFY_CLIENT_KEY must be set in the
// Vercel project's Environment Variables (Production). They never reach the
// browser — the client only ever receives the public clientId from /api.
const { createApiApp } = require("../server");

// Build the app once per cold start (module scope), then hand the same
// Express listener to Vercel for every warm invocation.
module.exports = createApiApp();
