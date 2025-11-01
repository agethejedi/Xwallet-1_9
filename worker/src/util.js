// src/util.js
export const VERSION = "v1.5.9-plaintext";

/**
 * Returns standard CORS and cache control headers.
 */
export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS,HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Content-Type": "application/json",
  };
}

/**
 * JSON response helper
 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

/**
 * Common error helpers
 */
export function badRequest(msg = "Bad request") {
  return json({ error: msg }, 400);
}
export function notFound(msg = "Not found") {
  return json({ error: msg }, 404);
}
export function okEmpty() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Parses a plaintext list (from env variable) into a Set.
 * Accepts newline, comma, or space separated lists.
 */
export function parseListToSet(raw) {
  if (!raw) return new Set();
  return new Set(
    String(raw)
      .split(/[\r\n, ]+/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * Normalizes hex addresses.
 */
export function normalizeHexAddress(addr) {
  if (!addr) return null;
  const lower = String(addr).trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(lower) ? lower : null;
}

/**
 * Builds a normalized JSON object matching the structure your
 * X-Wallet frontend expects.
 */
export function buildRiskResponse({
  address,
  network = "unknown",
  score = 10,
  block = false,
  reasons = [],
  risk_factors = [],
  matched_in = { ofac: false, badlist: false, bad_ens: false },
  policy = block
    ? "XWallet policy: hard block on listed addresses"
    : "XWallet policy: warn and allow under threshold",
  source = "cloudflare:plaintext",
}) {
  return {
    version: VERSION,
    address,
    network,
    risk_score: score,
    block: !!block,
    reasons,
    risk_factors,
    policy,
    checked_at: new Date().toISOString(),
    source,
    matched_in,
  };
}
