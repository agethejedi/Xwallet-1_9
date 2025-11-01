// worker/src/index.js
import {
  VERSION,
  corsHeaders,
  json,
  badRequest,
  notFound,
  okEmpty,
  parseListToSet,
  normalizeHexAddress,
  buildRiskResponse,
} from "./util.js";

/**
 * Cloudflare Worker: SafeSend plaintext risk engine
 *
 * Env text variables expected (set in Cloudflare Dashboard → Workers → Settings → Variables):
 *  - OFACLIST  (newline/whitespace/CSV — lower/upper ok)
 *  - OFAC_SET  (optional alias; if present, merged with OFACLIST)
 *  - BADLIST   (newline/whitespace/CSV of internal bad addresses)
 *  - BAD_ENS   (newline/whitespace/CSV of ENS names)
 *
 * Endpoints:
 *   GET /sanity
 *   GET /check?address=0x...&chain=sepolia
 *   GET /analytics?address=0x...&chain=sepolia   (stub; optional)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return badRequest("method not allowed");
    }

    // Route
    if (path === "" || path === "/") {
      return json({ version: VERSION, ok: true });
    }
    if (path === "/sanity") {
      return handleSanity(env);
    }
    if (path === "/check") {
      return handleCheck(url, env);
    }
    if (path === "/analytics") {
      return handleAnalytics(url, env);
    }
    return notFound("no such endpoint");
  },
};

// --- handlers ---

function handleSanity(env) {
  const ofacA = parseListToSet(env.OFACLIST);
  const ofacB = parseListToSet(env.OFAC_SET);
  const ofac = new Set([...ofacA, ...ofacB]);

  const bad = parseListToSet(env.BADLIST);
  const ens = parseListToSet(env.BAD_ENS);

  // Only lengths for sanity (no data leakage)
  return json({
    version: VERSION,
    env_present: {
      OFACLIST: ofacA.size || undefined,
      OFAC_SET: ofacB.size || undefined,
      BADLIST: bad.size || undefined,
      BAD_ENS: ens.size || undefined,
    },
    note: "Lengths only for sanity.",
  });
}

function handleCheck(url, env) {
  const addressRaw = url.searchParams.get("address");
  const network = url.searchParams.get("chain") || url.searchParams.get("network") || "unknown";

  if (!addressRaw) return badRequest("address required");
  const address = normalizeHexAddress(addressRaw);
  if (!address) return badRequest("invalid address");

  // Load lists (plaintext)
  const ofacA = parseListToSet(env.OFACLIST);
  const ofacB = parseListToSet(env.OFAC_SET);
  const ofac = new Set([...ofacA, ...ofacB]);

  const bad = parseListToSet(env.BADLIST);
  const ens = parseListToSet(env.BAD_ENS);

  // Evaluate
  const inOfac = ofac.has(address);
  const inBad = bad.has(address);
  // Note: BAD_ENS applies to ENS names; request is by address, so it's a separate signal path.
  const inBadENS = false;

  // Policy (per your current requirements):
  //  - OFAC  -> score 100, block true
  //  - BAD   -> score 100, block true
  //  - else  -> conservative base score 35, allow
  let score = 35;
  let block = false;
  const reasons = [];
  const factors = [];

  if (inOfac) {
    score = 100;
    block = true;
    reasons.push("OFAC");
    factors.push("OFAC/sanctions list match");
  } else if (inBad) {
    score = 100;
    block = true;
    reasons.push("BAD_LIST");
    factors.push("Internal bad list match");
  }

  const resp = buildRiskResponse({
    address,
    network,
    score,
    block,
    reasons,
    risk_factors: factors,
    matched_in: { ofac: inOfac, badlist: inBad, bad_ens: inBadENS },
  });

  return json(resp);
}

// Optional enrichment stub (safe to leave; front-end tolerates 404/non-ok)
function handleAnalytics(url, env) {
  const addressRaw = url.searchParams.get("address");
  const address = normalizeHexAddress(addressRaw || "");
  const network = url.searchParams.get("chain") || url.searchParams.get("network") || "unknown";

  if (!address) {
    // Return 204 to be quiet; front-end treats non-ok/empty as "no enrichment"
    return okEmpty();
  }

  // Lightweight placeholder (no PII leakage, no on-chain calls here)
  return json({
    version: VERSION,
    address,
    network,
    sanctions: { hit: false },
    exposures: { mixer: false, scam: false },
    heuristics: { ageDays: null },
    note: "analytics stub (configure real enrichment in a later version)",
  });
}
