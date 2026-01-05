// app.js — X-Wallet + SendSafe + Alchemy (ETH + all ERC-20s) + Risk Engine + Ticker + Wallet Settings

if (typeof ethers === "undefined") {
  alert("Crypto library failed to load. Check the ethers.js <script> tag URL.");
  throw new Error("ethers.js not loaded");
}

// ===== KEYS / CONFIG =====
const LS_WALLETS_KEY = "xwallet_wallets_v1";
const SS_CURRENT_ID_KEY = "xwallet_current_wallet_id_v1";
const LS_SAFESEND_HISTORY_KEY = "xwallet_safesend_history_v1";
const LS_TICKER_ASSETS_KEY = "xwallet_ticker_assets_v1";

// Risk engine (shared with Vision)
const RISK_ENGINE_BASE_URL =
  "https://riskxlabs-vision-api.agedotcom.workers.dev"; // no trailing slash

function mapNetworkForRiskEngine(uiValue) {
  switch (uiValue) {
    case "ethereum-mainnet":
    case "sepolia":
      return "eth";
    case "polygon-pos":
      return "polygon";
    case "arbitrum":
      return "arbitrum";
    case "polygon-zkevm":
      return "polygon-zkevm";
    case "linea":
      return "linea";
    case "base":
      return "base";
    case "solana":
      return "sol";
    case "tron":
      return "tron";
    default:
      return "eth";
  }
}

// ===== TICKER / WATCHLIST CONFIG =====
const AVAILABLE_TICKER_ASSETS = [
  { symbol: "BTC", id: "bitcoin", label: "Bitcoin" },
  { symbol: "ETH", id: "ethereum", label: "Ethereum" },
  { symbol: "USDT", id: "tether", label: "Tether (USDT)" },
  { symbol: "USDC", id: "usd-coin", label: "USD Coin (USDC)" },
  { symbol: "SOL", id: "solana", label: "Solana" },
  { symbol: "ARB", id: "arbitrum", label: "Arbitrum" },
  { symbol: "MATIC", id: "matic-network", label: "Polygon (MATIC)" },
  { symbol: "LINK", id: "chainlink", label: "Chainlink" },
];

const DEFAULT_TICKER_SYMBOLS = ["BTC", "ETH", "USDT", "SOL"];

// Alchemy
const ALCHEMY_API_KEY = "kxHg5y9yBXWAb9cOcJsf0";

// ===== LOGOS (SYMBOL -> URL) =====
// Use your provided SVG links. We’ll normalize symbols so ETH-sep works too.
const LOGO_URLS_BY_SYMBOL = {
  ETH: "https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=040",
  "ETH-sep": "https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=040",

  USDC: "https://cryptologos.cc/logos/usd-coin-usdc-logo.svg?v=040",
  USDT: "https://cryptologos.cc/logos/tether-usdt-logo.svg?v=040",
  SOL: "https://cryptologos.cc/logos/solana-sol-logo.svg?v=040",
  PYUSD: "https://cryptologos.cc/logos/paypal-usd-pyusd-logo.svg?v=040",

  ADA: "https://cryptologos.cc/logos/cardano-ada-logo.svg?v=040",
  LTC: "https://cryptologos.cc/logos/litecoin-ltc-logo.svg?v=040",
  CRO: "https://cryptologos.cc/logos/cronos-cro-logo.svg?v=040",
  TRX: "https://cryptologos.cc/logos/tron-trx-logo.svg?v=040",
  XLM: "https://cryptologos.cc/logos/stellar-xlm-logo.svg?v=040",
  MATIC: "https://cryptologos.cc/logos/polygon-matic-logo.svg?v=040",
  OP: "https://cryptologos.cc/logos/optimism-ethereum-op-logo.svg?v=040",
  XYO: "https://cryptologos.cc/logos/xyo-xyo-logo.svg?v=040",
};

function normalizeSymbol(sym) {
  if (!sym) return "";
  return String(sym).trim();
}

// Fallback placeholder if we don't know the logo
function placeholderLogo(symbol) {
  const s = normalizeSymbol(symbol);
  const ch = (s && s[0]) ? s[0].toUpperCase() : "T";
  return "https://via.placeholder.com/32?text=" + encodeURIComponent(ch);
}

// Primary resolver: use your map first, otherwise placeholder
function getLogoUrlForSymbol(symbol) {
  const s = normalizeSymbol(symbol);
  if (LOGO_URLS_BY_SYMBOL[s]) return LOGO_URLS_BY_SYMBOL[s];

  // Common special cases: strip network suffixes like "-sep" for lookup
  if (s.includes("-")) {
    const base = s.split("-")[0];
    if (LOGO_URLS_BY_SYMBOL[base]) return LOGO_URLS_BY_SYMBOL[base];
  }

  return placeholderLogo(s);
}

// Known tokens (for nicer names/logos on top of generic ERC-20 metadata)
const KNOWN_TOKENS_BY_ADDRESS = {
  // PYUSD mainnet
  "0x6c3ea9036406852006290770bedfcaba0e23a0e8": {
    symbol: "PYUSD",
    name: "PayPal USD",
    // Use symbol map for logo instead of hardcoded png
    logoUrl: getLogoUrlForSymbol("PYUSD"),
  },
  // PYUSD Sepolia
  "0xcac5ca27d96c219bdcdc823940b66ebd4ff4c7f1": {
    symbol: "PYUSD-sep",
    name: "PYUSD (Sepolia)",
    // This will fall back to PYUSD's logo due to suffix handling
    logoUrl: getLogoUrlForSymbol("PYUSD-sep"),
  },
};

// Minimal ERC-20 ABI for metadata & balances
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

function getRpcUrlForNetwork(uiValue) {
  if (!ALCHEMY_API_KEY) return null;
  if (uiValue === "ethereum-mainnet") {
    return `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  }
  if (uiValue === "sepolia") {
    return `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  }
  return null;
}

function getProviderForNetwork(uiValue) {
  const url = getRpcUrlForNetwork(uiValue);
  if (!url) return null;
  return new ethers.providers.JsonRpcProvider(url);
}

// Autoload all ERC-20 token balances for a wallet using Alchemy's extended API
async function fetchAllErc20Holdings(provider, walletAddress, { maxTokens = 20 } = {}) {
  try {
    const resp = await provider.send("alchemy_getTokenBalances", [
      walletAddress,
      "erc20",
    ]);

    if (!resp || !Array.isArray(resp.tokenBalances)) return [];

    const nonZero = resp.tokenBalances
      .filter((tb) => tb.tokenBalance && tb.tokenBalance !== "0")
      .slice(0, maxTokens);

    const holdings = await Promise.all(
      nonZero.map(async (tb) => {
        const tokenAddr = tb.contractAddress;
        try {
          const contract = new ethers.Contract(tokenAddr, ERC20_ABI, provider);

          const [decimalsRaw, symbolRaw, nameRaw] = await Promise.all([
            contract.decimals().catch(() => 18),
            contract.symbol().catch(() => "TOKEN"),
            contract.name().catch(() => "Unknown Token"),
          ]);

          const decimals = Number(decimalsRaw) || 18;
          const override =
            KNOWN_TOKENS_BY_ADDRESS[tokenAddr.toLowerCase()] || {};

          const finalSymbol = override.symbol || symbolRaw || "TOKEN";
          const finalName = override.name || nameRaw || "Unknown Token";

          // Logo resolution priority:
          // 1) override.logoUrl (e.g., PYUSD)
          // 2) map by symbol (USDC, USDT, etc.)
          // 3) placeholder
          const logoUrl =
            override.logoUrl || getLogoUrlForSymbol(finalSymbol);

          const rawBal = tb.tokenBalance;
          const amount = Number(ethers.utils.formatUnits(rawBal, decimals));

          return {
            symbol: finalSymbol,
            name: finalName,
            logoUrl,
            // For now, treat 1 token unit as 1 "USD-ish" value in this prototype.
            usdValue: amount,
            amount,
            change24hPct: 0,
            tokenAddress: tokenAddr,
          };
        } catch (inner) {
          console.warn("Failed to hydrate token", tokenAddr, inner);
          return null;
        }
      })
    );

    return holdings.filter(Boolean);
  } catch (err) {
    console.warn("fetchAllErc20Holdings error", err);
    return [];
  }
}

// ===== STATE =====
let wallets = [];
let currentWalletId = null;
let pendingUnlockWalletId = null;
let safesendHistory = [];
let tickerSymbols = [];
let tickerRefreshTimer = null;

// ===== DOM =====
const walletTopbar = document.getElementById("walletTopbar");
const walletHero = document.getElementById("walletHero");
const walletDashboard = document.getElementById("walletDashboard");
const safesendPage = document.getElementById("safesendPage");
const settingsPage = document.getElementById("settingsPage");

const walletAddressEl = document.getElementById("walletAddress");
const fiatBalanceLabelEl = document.getElementById("fiatBalanceLabel");
const walletsContainer = document.getElementById("walletsContainer");

const createWalletBtn = document.getElementById("createWalletBtn");
const importWalletBtn = document.getElementById("importWalletBtn");
const walletsNavBtn = document.getElementById("walletsNavBtn");
const navButtons = document.querySelectorAll(".sidebar-nav .nav-item");

const copyAddressBtn = document.getElementById("copyAddressBtn");
const switchAccountBtn = document.getElementById("switchAccountBtn");
const receiveBtn = document.getElementById("receiveBtn");
const sendBtn = document.getElementById("sendBtn");
const networkStatusPill = document.getElementById("networkStatusPill");

const networkSelect = document.getElementById("networkSelect");

// Wallet hub
const walletHubModal = document.getElementById("walletHubModal");
const gateWalletList = document.getElementById("gateWalletList");
const hubCreateBtn = document.getElementById("hubCreateBtn");
const hubImportBtn = document.getElementById("hubImportBtn");

// Create wallet
const createWalletModal = document.getElementById("createWalletModal");
const cwMnemonicEl = document.getElementById("cwMnemonic");
const cwAddressEl = document.getElementById("cwAddress");
const cwLabelEl = document.getElementById("cwLabel");
const cwConfirmBtn = document.getElementById("cwConfirmBtn");
const cwPasswordEl = document.getElementById("cwPassword");
const cwPasswordErrorEl = document.getElementById("cwPasswordError");

// Import
const importWalletModal = document.getElementById("importWalletModal");
const iwLabelEl = document.getElementById("iwLabel");
const iwMnemonicEl = document.getElementById("iwMnemonic");
const iwPasswordEl = document.getElementById("iwPassword");
const iwPasswordErrorEl = document.getElementById("iwPasswordError");
const iwErrorEl = document.getElementById("iwError");
const iwImportBtn = document.getElementById("iwImportBtn");

// Unlock
const unlockWalletModal = document.getElementById("unlockWalletModal");
const uwLabelEl = document.getElementById("uwLabel");
const uwAddressEl = document.getElementById("uwAddress");
const uwPasswordEl = document.getElementById("uwPassword");
const uwPasswordErrorEl = document.getElementById("uwPasswordError");
const uwConfirmBtn = document.getElementById("uwConfirmBtn");

// SendSafe main
const ssWalletSelect = document.getElementById("ssWalletSelect");
const ssAssetSelect = document.getElementById("ssAssetSelect");
const safesendScoreBadge = document.getElementById("safesendScoreBadge");
const riskGaugeDial = document.getElementById("riskGaugeDial");
const riskGaugeLabel = document.getElementById("riskGaugeLabel");
const riskHighlightsList = document.getElementById("riskHighlightsList");
const recipientInput = document.getElementById("recipientInput");
const runSafeSendBtn = document.getElementById("runSafeSendBtn");
const clearSafesendHistoryBtn = document.getElementById("clearSafesendHistoryBtn");
const safesendHistoryList = document.getElementById("safesendHistoryList");
const viewFullReportBtn = document.getElementById("viewFullReportBtn");
const safesendTxList = document.getElementById("safesendTxList");

// SendSafe balance / amount
const ssBalanceAmountEl = document.getElementById("ssBalanceAmount");
const ssBalanceUsdEl = document.getElementById("ssBalanceUsd");
const ssSendAmountEl = document.getElementById("ssSendAmount");
const ssAmountUnitEl = document.getElementById("ssAmountUnit");

// SendSafe result modal
const safesendResultModal = document.getElementById("safesendResultModal");
const modalRiskGaugeDial = document.getElementById("modalRiskGaugeDial");
const modalRiskGaugeLabel = document.getElementById("modalRiskGaugeLabel");
const safesendResultMessage = document.getElementById("safesendResultMessage");
const safesendRiskAckRow = document.getElementById("safesendRiskAckRow");
const safesendRiskAckCheckbox = document.getElementById("safesendRiskAckCheckbox");
const safesendRiskAckText = document.getElementById("safesendRiskAckText");
const safesendResultButtons = document.getElementById("safesendResultButtons");

// Ticker / settings
const tickerStrip = document.getElementById("tickerStrip");
const tickerSettingsContainer = document.getElementById("tickerSettingsContainer");
const walletSettingsList = document.getElementById("walletSettingsList");

// ===== UTIL =====
function formatPct(p) {
  if (p === null || p === undefined || Number.isNaN(p)) return "--";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}

function formatUsd(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "$0.00";
  return `$${x.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shorten(str, left = 6, right = 4) {
  if (!str) return "";
  if (str.length <= left + right + 3) return str;
  return `${str.slice(0, left)}…${str.slice(-right)}`;
}

function formatTxTime(ms) {
  if (!ms) return "--";
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ===== LOAD / SAVE =====
function loadWallets() {
  try {
    const raw = localStorage.getItem(LS_WALLETS_KEY);
    wallets = raw ? JSON.parse(raw) : [];
  } catch {
    wallets = [];
  }

  wallets.forEach((w) => {
    if (!Array.isArray(w.holdings)) w.holdings = [];
    if (typeof w.password === "undefined") w.password = null;

    // If holdings were saved earlier with png/placeholder logos,
    // we can opportunistically upgrade known symbols to your SVG logos.
    if (Array.isArray(w.holdings)) {
      w.holdings = w.holdings.map((h) => {
        if (!h || !h.symbol) return h;
        const upgraded = getLogoUrlForSymbol(h.symbol);
        // Only overwrite if we have a known logo OR the current one is placeholder-ish
        const
