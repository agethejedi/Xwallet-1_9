// app.js — X-Wallet + SendSafe + Alchemy (multi-EVM networks) + Seed Vault (1.8) + ENS resolution (public naming)
// ✅ Completed: 60s auto-refresh balances + portable token discovery catalog (export/import)

if (typeof ethers === "undefined") {
  alert("Crypto library failed to load. Check the ethers.js <script> tag URL.");
  throw new Error("ethers.js not loaded");
}

// ===== KEYS / CONFIG =====
const LS_WALLETS_KEY = "xwallet_wallets_v1";
const SS_CURRENT_ID_KEY = "xwallet_current_wallet_id_v1";
const LS_SAFESEND_HISTORY_KEY = "xwallet_safesend_history_v1";
const LS_TICKER_ASSETS_KEY = "xwallet_ticker_assets_v1";

// ✅ NEW: Portable token discovery catalog (included in vault export/import)
const LS_TOKEN_CATALOG_KEY = "xwallet_token_catalog_v1";

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
    case "iotex-mainnet":
    case "iotex-testnet":
      return "eth"; // Risk engine currently expects EVM buckets; treat as eth-class
    default:
      return "eth";
  }
}

const AVAILABLE_TICKER_ASSETS = [
  { symbol: "BTC", id: "bitcoin", label: "Bitcoin" },
  { symbol: "ETH", id: "ethereum", label: "Ethereum" },
  { symbol: "USDT", id: "tether", label: "Tether (USDT)" },
  { symbol: "USDC", id: "usd-coin", label: "USD Coin (USDC)" },
  { symbol: "SOL", id: "solana", label: "Solana" },
  { symbol: "ARB", id: "arbitrum", label: "Arbitrum" },
  { symbol: "MATIC", id: "matic-network", label: "Polygon (MATIC)" },
  { symbol: "LINK", id: "chainlink", label: "Chainlink" },

  // ✅ New options
  { symbol: "PYUSD", id: "paypal-usd", label: "PayPal USD (PYUSD)" },
  { symbol: "LTC", id: "litecoin", label: "Litecoin (LTC)" },
  { symbol: "CRO", id: "crypto-com-chain", label: "Cronos (CRO)" },
  { symbol: "TRX", id: "tron", label: "TRON (TRX)" },
  { symbol: "OP", id: "optimism", label: "Optimism (OP)" },
  { symbol: "XYO", id: "xyo-network", label: "XYO Network (XYO)" },
];

const DEFAULT_TICKER_SYMBOLS = ["BTC", "ETH", "USDT", "SOL"];

// Alchemy
const ALCHEMY_API_KEY = "kxHg5y9yBXWAb9cOcJsf0";

// ===== LOGOS (SYMBOL -> URL) =====
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

function placeholderLogo(symbol) {
  const s = normalizeSymbol(symbol);
  const ch = (s && s[0]) ? s[0].toUpperCase() : "T";
  return "https://via.placeholder.com/32?text=" + encodeURIComponent(ch);
}

function getLogoUrlForSymbol(symbol) {
  const s = normalizeSymbol(symbol);
  if (LOGO_URLS_BY_SYMBOL[s]) return LOGO_URLS_BY_SYMBOL[s];
  if (s.includes("-")) {
    const base = s.split("-")[0];
    if (LOGO_URLS_BY_SYMBOL[base]) return LOGO_URLS_BY_SYMBOL[base];
  }
  return placeholderLogo(s);
}

// Known tokens
const KNOWN_TOKENS_BY_ADDRESS = {
  // PYUSD mainnet
  "0x6c3ea9036406852006290770bedfcaba0e23a0e8": {
    symbol: "PYUSD",
    name: "PayPal USD",
    logoUrl: getLogoUrlForSymbol("PYUSD"),
    decimals: 6,
  },
  // PYUSD Sepolia
  "0xcac5ca27d96c219bdcdc823940b66ebd4ff4c7f1": {
    symbol: "PYUSD-sep",
    name: "PYUSD (Sepolia)",
    logoUrl: getLogoUrlForSymbol("PYUSD-sep"),
    decimals: 6,
  },
};

// Minimal ERC-20 ABI
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

// ====== NETWORKS (1.7/1.8) ======
function getRpcUrlForNetwork(uiValue) {
  if (uiValue === "iotex-mainnet") return "https://babel-api.mainnet.iotex.io";
  if (uiValue === "iotex-testnet") return "https://babel-api.testnet.iotex.io";

  if (!ALCHEMY_API_KEY) return null;

  // Alchemy EVM
  if (uiValue === "ethereum-mainnet") return `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "sepolia") return `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "arbitrum") return `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "arbitrum-sepolia") return `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "base") return `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "base-sepolia") return `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "celo") return `https://celo-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "celo-alfajores") return `https://celo-alfajores.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "moonbeam") return `https://moonbeam-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "moonbeam-alpha") return `https://moonbeam-alpha.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "worldchain") return `https://worldchain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "worldchain-sepolia") return `https://worldchain-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

  return null;
}

function getProviderForNetwork(uiValue) {
  const url = getRpcUrlForNetwork(uiValue);
  if (!url) return null;

  const staticNet = (() => {
    switch (uiValue) {
      case "iotex-mainnet": return { name: "iotex", chainId: 4689 };
      case "iotex-testnet": return { name: "iotex-testnet", chainId: 4690 };
      default: return null;
    }
  })();

  if (staticNet) return new ethers.providers.JsonRpcProvider(url, staticNet);
  return new ethers.providers.JsonRpcProvider(url);
}

// ===== SEED VAULT (1.8) =====
const VAULT_DEFAULTS = {
  v: 1,
  kdf: "PBKDF2",
  hash: "SHA-256",
  iter: 210000,
  alg: "AES-GCM",
};

function b64FromBytes(bytes) {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function bytesFromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveAesKeyFromPassword(password, saltBytes, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptMnemonicToVault(mnemonic, password) {
  if (!password || password.length < 8) {
    throw new Error("Password required (min 8 chars) to encrypt seed for portability.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iter = VAULT_DEFAULTS.iter;

  const key = await deriveAesKeyFromPassword(password, salt, iter);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(String(mnemonic).trim())
  );

  const cipherBytes = new Uint8Array(cipherBuf);

  return {
    v: VAULT_DEFAULTS.v,
    kdf: VAULT_DEFAULTS.kdf,
    hash: VAULT_DEFAULTS.hash,
    iter,
    alg: VAULT_DEFAULTS.alg,
    saltB64: b64FromBytes(salt),
    ivB64: b64FromBytes(iv),
    cipherB64: b64FromBytes(cipherBytes),
  };
}

async function decryptMnemonicFromVault(vault, password) {
  if (!vault || !vault.saltB64 || !vault.ivB64 || !vault.cipherB64) {
    throw new Error("Wallet is missing vault data.");
  }
  const salt = bytesFromB64(vault.saltB64);
  const iv = bytesFromB64(vault.ivB64);
  const cipher = bytesFromB64(vault.cipherB64);
  const iter = Number(vault.iter) || VAULT_DEFAULTS.iter;

  const key = await deriveAesKeyFromPassword(password, salt, iter);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipher
  );
  const dec = new TextDecoder();
  return dec.decode(plainBuf);
}

const DEFAULT_EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

function deriveEvmAddressFromMnemonic(mnemonic, path = DEFAULT_EVM_DERIVATION_PATH) {
  const hd = ethers.utils.HDNode.fromMnemonic(mnemonic.trim());
  const child = hd.derivePath(path);
  const w = new ethers.Wallet(child.privateKey);
  return ethers.utils.getAddress(w.address);
}

// ===== ENS (Public naming) =====
function isEnsName(s) {
  if (!s) return false;
  const v = String(s).trim().toLowerCase();
  return v.endsWith(".eth");
}

function getEnsResolutionProvider(uiNetwork) {
  if (uiNetwork === "sepolia") return getProviderForNetwork("sepolia");
  return getProviderForNetwork("ethereum-mainnet");
}

async function resolveRecipientToAddress(input, uiNetwork) {
  const raw = String(input || "").trim();

  if (raw.toLowerCase().startsWith("0x")) {
    if (!ethers.utils.isAddress(raw)) return { type: "invalid", input: raw, address: null };
    return { type: "address", input: raw, address: ethers.utils.getAddress(raw) };
  }

  if (isEnsName(raw)) {
    const ensProvider = getEnsResolutionProvider(uiNetwork);
    if (!ensProvider) return { type: "ens", input: raw, address: null, error: "No ENS-capable provider configured." };
    const addr = await ensProvider.resolveName(raw);
    if (!addr) return { type: "ens", input: raw, address: null, error: "ENS name did not resolve." };
    return { type: "ens", input: raw, address: ethers.utils.getAddress(addr) };
  }

  return { type: "invalid", input: raw, address: null };
}

async function reverseLookupEnsName(address, uiNetwork) {
  try {
    if (!address || !ethers.utils.isAddress(address)) return null;
    const ensProvider = getEnsResolutionProvider(uiNetwork);
    if (!ensProvider) return null;
    const name = await ensProvider.lookupAddress(address);
    return name || null;
  } catch {
    return null;
  }
}

// ===== ✅ TOKEN CATALOG (portable discovery) =====
let tokenCatalog = {
  // schema:
  // [uiNetwork]: { [tokenAddressLower]: { symbol, name, decimals, logoUrl, discoveredAt } }
};

function loadTokenCatalog() {
  try {
    const raw = localStorage.getItem(LS_TOKEN_CATALOG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") tokenCatalog = parsed;
  } catch {
    tokenCatalog = {};
  }
}
function saveTokenCatalog() {
  try {
    localStorage.setItem(LS_TOKEN_CATALOG_KEY, JSON.stringify(tokenCatalog));
  } catch {}
}
function getCatalogEntry(uiNetwork, tokenAddressLower) {
  if (!uiNetwork || !tokenAddressLower) return null;
  const net = tokenCatalog[uiNetwork];
  if (!net) return null;
  return net[tokenAddressLower] || null;
}
function upsertCatalogEntry(uiNetwork, tokenAddressLower, entry) {
  if (!uiNetwork || !tokenAddressLower || !entry) return;
  if (!tokenCatalog[uiNetwork]) tokenCatalog[uiNetwork] = {};
  tokenCatalog[uiNetwork][tokenAddressLower] = {
    ...(tokenCatalog[uiNetwork][tokenAddressLower] || {}),
    ...entry,
    discoveredAt: tokenCatalog[uiNetwork][tokenAddressLower]?.discoveredAt || Date.now(),
  };
  saveTokenCatalog();
}

// ===== AUTLOAD ERC-20 via Alchemy (where available) =====
async function fetchAllErc20Holdings(provider, walletAddress, uiNetwork, { maxTokens = 20 } = {}) {
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
        const tokenAddrLower = String(tokenAddr || "").toLowerCase();
        try {
          const contract = new ethers.Contract(tokenAddr, ERC20_ABI, provider);

          // ✅ Prefer known token overrides, then catalog, then on-chain calls
          const known = KNOWN_TOKENS_BY_ADDRESS[tokenAddrLower] || null;
          const cached = getCatalogEntry(uiNetwork, tokenAddrLower);

          const decimalsPromise =
            known?.decimals != null
              ? Promise.resolve(known.decimals)
              : cached?.decimals != null
              ? Promise.resolve(cached.decimals)
              : contract.decimals().catch(() => 18);

          const symbolPromise =
            known?.symbol
              ? Promise.resolve(known.symbol)
              : cached?.symbol
              ? Promise.resolve(cached.symbol)
              : contract.symbol().catch(() => "TOKEN");

          const namePromise =
            known?.name
              ? Promise.resolve(known.name)
              : cached?.name
              ? Promise.resolve(cached.name)
              : contract.name().catch(() => "Unknown Token");

          const [decimalsRaw, symbolRaw, nameRaw] = await Promise.all([
            decimalsPromise,
            symbolPromise,
            namePromise,
          ]);

          const decimals = Number(decimalsRaw) || 18;
          const finalSymbol = String(symbolRaw || "TOKEN");
          const finalName = String(nameRaw || "Unknown Token");

          const logoUrl =
            known?.logoUrl ||
            cached?.logoUrl ||
            getLogoUrlForSymbol(finalSymbol);

          // ✅ Save to catalog so other devices can inherit after export/import
          upsertCatalogEntry(uiNetwork, tokenAddrLower, {
            symbol: finalSymbol,
            name: finalName,
            decimals,
            logoUrl,
          });

          const rawBal = tb.tokenBalance;
          const amount = Number(ethers.utils.formatUnits(rawBal, decimals));

          return {
            symbol: finalSymbol,
            name: finalName,
            logoUrl,
            usdValue: amount, // prototype: treat as USD for now
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

// ✅ NEW: wallet balance auto refresh timer (60s)
let walletRefreshTimer = null;
let isRefreshingWallet = false;

// Session-only unlock state
const sessionUnlockedWallets = new Set(); // walletId

// ===== DOM =====
const walletTopbar = document.getElementById("walletTopbar");
const walletHero = document.getElementById("walletHero");
const walletDashboard = document.getElementById("walletDashboard");
const safesendPage = document.getElementById("safesendPage");
const settingsPage = document.getElementById("settingsPage");

const walletAddressEl = document.getElementById("walletAddress");
const walletEnsNameEl = document.getElementById("walletEnsName"); // optional
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

// Recipient resolution UI (ENS)
const recipientResolveRow = document.getElementById("recipientResolveRow");
const recipientResolvedAddress = document.getElementById("recipientResolvedAddress");

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

// Vault export/import controls (Settings)
const exportVaultBtn = document.getElementById("exportVaultBtn");
const importVaultFile = document.getElementById("importVaultFile");
const importVaultBtn = document.getElementById("importVaultBtn");

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

function hasPortableVault(w) {
  return !!(w && w.vault && w.vault.cipherB64 && w.vault.saltB64 && w.vault.ivB64);
}

function validatePasswordPattern(pw) {
  const validPattern = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
  return validPattern.test(pw);
}

function setRecipientResolutionUI({ type, input, address, error }) {
  if (!recipientResolveRow || !recipientResolvedAddress) return;

  if (type === "ens" && address) {
    recipientResolvedAddress.textContent = address;
    recipientResolveRow.hidden = false;
    return;
  }

  recipientResolveRow.hidden = true;
  recipientResolvedAddress.textContent = "";
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

    if (w.vault && !w.hd) {
      w.hd = { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 };
    }
  });

  const storedId = sessionStorage.getItem(SS_CURRENT_ID_KEY);
  if (storedId && wallets.some((w) => w.id === storedId)) {
    currentWalletId = storedId;
  } else {
    currentWalletId = null;
  }
}

function saveWallets() {
  localStorage.setItem(LS_WALLETS_KEY, JSON.stringify(wallets));
}

function loadSafesendHistory() {
  try {
    const raw = localStorage.getItem(LS_SAFESEND_HISTORY_KEY);
    safesendHistory = raw ? JSON.parse(raw) : [];
  } catch {
    safesendHistory = [];
  }
}

function saveSafesendHistory() {
  localStorage.setItem(LS_SAFESEND_HISTORY_KEY, JSON.stringify(safesendHistory));
}

function getWalletById(id) {
  return wallets.find((w) => w.id === id);
}

function loadTickerSymbols() {
  try {
    const raw = localStorage.getItem(LS_TICKER_ASSETS_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    if (Array.isArray(arr) && arr.length) {
      return arr.filter((s) => typeof s === "string");
    }
  } catch {}
  return DEFAULT_TICKER_SYMBOLS.slice();
}

function saveTickerSymbols(symbols) {
  tickerSymbols = symbols.slice();
  localStorage.setItem(LS_TICKER_ASSETS_KEY, JSON.stringify(tickerSymbols));
}

// ===== ✅ LIVE BALANCES (with overlap protection) =====
async function refreshWalletOnChainData() {
  const wallet = getWalletById(currentWalletId);
  if (!wallet || !networkSelect) return;

  // Avoid overlapping refreshes
  if (isRefreshingWallet) return;
  isRefreshingWallet = true;

  const uiNet = networkSelect.value || "sepolia";
  const provider = getProviderForNetwork(uiNet);

  if (networkStatusPill) {
    networkStatusPill.className = "status-pill";
  }

  if (!provider) {
    if (networkStatusPill) {
      networkStatusPill.textContent = "RPC: DISCONNECTED";
      networkStatusPill.classList.add("status-pill-bad");
    }
    console.warn("No provider for network", uiNet);
    isRefreshingWallet = false;
    return;
  }

  if (networkStatusPill) {
    networkStatusPill.textContent = "RPC: CONNECTING…";
  }

  try {
    const holdings = [];

    // Native balance (EVM only)
    const rawNative = await provider.getBalance(wallet.address);
    const native = Number(ethers.utils.formatEther(rawNative));

    const isSepolia = uiNet === "sepolia";
    const ethSymbol = isSepolia ? "ETH-sep" : "ETH";

    holdings.push({
      symbol: ethSymbol,
      name: isSepolia ? "Ethereum (Sepolia)" : "Ethereum",
      logoUrl: getLogoUrlForSymbol(ethSymbol),
      amount: native,
      usdValue: native,
      change24hPct: 0,
      tokenAddress: null,
    });

    // ERC-20 holdings only where Alchemy extended APIs exist
    const isAlchemyNetwork = !uiNet.startsWith("iotex-") && uiNet !== "unknown";
    if (isAlchemyNetwork) {
      const erc20Holdings = await fetchAllErc20Holdings(provider, wallet.address, uiNet);
      erc20Holdings.forEach((h) => holdings.push(h));
    }

    let totalUsd = 0;
    for (const h of holdings) totalUsd += h.usdValue || 0;

    wallet.totalUsd = totalUsd;
    wallet.change24hPct = 0;
    wallet.holdings = holdings;

    saveWallets();
    renderWallets();

    if (networkStatusPill) {
      networkStatusPill.textContent = "RPC: CONNECTED";
      networkStatusPill.className = "status-pill status-pill-good";
    }

    // Optional: reverse ENS name for current wallet (mainnet/sepolia)
    if (walletEnsNameEl) {
      walletEnsNameEl.textContent = "";
      const ens = await reverseLookupEnsName(wallet.address, uiNet);
      walletEnsNameEl.textContent = ens ? ens : "";
      walletEnsNameEl.hidden = !ens;
    }
  } catch (err) {
    console.error("Error refreshing on-chain balance", err);
    if (networkStatusPill) {
      networkStatusPill.textContent = "RPC: ERROR";
      networkStatusPill.className = "status-pill status-pill-bad";
    }
  } finally {
    isRefreshingWallet = false;
  }
}

// ✅ NEW: auto-refresh balances every minute (only when a wallet is active)
function startWalletAutoRefresh() {
  if (walletRefreshTimer) {
    clearInterval(walletRefreshTimer);
    walletRefreshTimer = null;
  }
  // Immediate refresh, then every 60s
  refreshWalletOnChainData();
  walletRefreshTimer = setInterval(() => {
    // Avoid doing work if tab is hidden (reduces weird RPC timing issues)
    if (document.hidden) return;
    refreshWalletOnChainData();
  }, 60_000);
}

function stopWalletAutoRefresh() {
  if (walletRefreshTimer) {
    clearInterval(walletRefreshTimer);
    walletRefreshTimer = null;
  }
}

// ===== VIEW MANAGEMENT =====
let currentView = "dashboard";

function refreshHeader() {
  const wallet = getWalletById(currentWalletId);
  if (!wallet) {
    if (walletAddressEl) walletAddressEl.textContent = "No wallet selected";
    if (fiatBalanceLabelEl) fiatBalanceLabelEl.textContent = "$0.00";
    if (walletEnsNameEl) walletEnsNameEl.hidden = true;
    return;
  }
  if (walletAddressEl) walletAddressEl.textContent = wallet.address;
  if (fiatBalanceLabelEl) fiatBalanceLabelEl.textContent = formatUsd(wallet.totalUsd || 0);
}

function updateAppVisibility() {
  const hasUnlocked = !!currentWalletId;

  if (hasUnlocked) {
    if (walletTopbar) walletTopbar.hidden = false;
    if (walletHero) walletHero.hidden = false;
    hideWalletHub();
    if (walletsNavBtn) walletsNavBtn.classList.remove("nav-item-attention");
  } else {
    if (walletTopbar) walletTopbar.hidden = true;
    if (walletHero) walletHero.hidden = true;
    if (walletDashboard) walletDashboard.hidden = true;
    if (safesendPage) safesendPage.hidden = true;
    if (settingsPage) settingsPage.hidden = true;

    showWalletHub();
    if (walletsNavBtn) walletsNavBtn.classList.add("nav-item-attention");
  }
}

function setCurrentWallet(id, { refreshOnChain = false } = {}) {
  currentWalletId = id;
  if (id) sessionStorage.setItem(SS_CURRENT_ID_KEY, id);
  else sessionStorage.removeItem(SS_CURRENT_ID_KEY);

  refreshHeader();
  updateAppVisibility();
  populateSafesendSelectors();
  renderWalletSettingsUI();

  // ✅ Auto refresh lifecycle
  if (currentWalletId) startWalletAutoRefresh();
  else stopWalletAutoRefresh();

  if (refreshOnChain) refreshWalletOnChainData();
}

function setView(view) {
  if (view === "wallets") {
    showWalletHub();
    return;
  }

  const hasUnlocked = !!currentWalletId;
  currentView = view;

  if (walletDashboard) {
    walletDashboard.hidden = true;
    walletDashboard.classList.remove("active-view");
  }
  if (safesendPage) {
    safesendPage.hidden = true;
    safesendPage.classList.remove("active-view");
  }
  if (settingsPage) {
    settingsPage.hidden = true;
    settingsPage.classList.remove("active-view");
  }

  if (!hasUnlocked) {
    updateAppVisibility();
    return;
  }

  if (view === "safesend" && safesendPage) {
    safesendPage.hidden = false;
    safesendPage.classList.add("active-view");
  } else if (view === "settings" && settingsPage) {
    settingsPage.hidden = false;
    settingsPage.classList.add("active-view");
  } else if (walletDashboard) {
    walletDashboard.hidden = false;
    walletDashboard.classList.add("active-view");
  }

  navButtons.forEach((btn) => {
    const v = btn.dataset.view;
    if (v === "wallets") return;
    btn.classList.toggle("nav-item-active", v === view);
  });

  updateAppVisibility();
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    setView(view);
  });
});

// ===== WALLET HUB =====
function updateWalletHubList() {
  if (!gateWalletList) return;

  if (!wallets.length) {
    gateWalletList.hidden = true;
    gateWalletList.innerHTML = "";
    return;
  }

  gateWalletList.hidden = false;
  gateWalletList.innerHTML = `
    <div class="wallet-gate-list-title">Wallets on this device</div>
  `;

  wallets.forEach((w) => {
    const portable = hasPortableVault(w);
    const legacyTag = portable ? "" : `<div class="hint-text">Legacy (re-import seed to make portable)</div>`;

    const row = document.createElement("div");
    row.className = "wallet-gate-list-item";
    row.innerHTML = `
      <div>
        <div>${w.label}</div>
        <div class="wallet-address">${w.address}</div>
        ${legacyTag}
      </div>
      <button class="pill-btn-outline" data-gate-unlock="${w.id}">
        Unlock
      </button>
    `;
    gateWalletList.appendChild(row);
  });
}

function showWalletHub() {
  updateWalletHubList();
  if (walletHubModal) walletHubModal.removeAttribute("hidden");
}

function hideWalletHub() {
  if (walletHubModal) walletHubModal.setAttribute("hidden", "");
}

// ===== RENDER WALLETS & HOLDINGS =====
function renderWallets() {
  if (!walletsContainer) return;

  walletsContainer.innerHTML = "";

  let total = 0;
  wallets.forEach((wallet) => {
    total += wallet.totalUsd || 0;

    const card = document.createElement("article");
    card.className = "wallet-card";
    card.dataset.walletId = wallet.id;

    const changeClass =
      wallet.change24hPct > 0
        ? "positive"
        : wallet.change24hPct < 0
        ? "negative"
        : "";

    card.innerHTML = `
      <button class="wallet-header" type="button">
        <div class="wallet-header-main">
          <div class="wallet-name">${wallet.label}</div>
          <div class="wallet-address">${wallet.address}</div>
        </div>
        <div class="wallet-header-meta">
          <span class="wallet-balance">${formatUsd(wallet.totalUsd || 0)}</span>
          <span class="wallet-change ${changeClass}">
            ${formatPct(wallet.change24hPct || 0)} (24h)
          </span>
          <span class="wallet-toggle">+</span>
        </div>
      </button>
      <div class="wallet-holdings" hidden></div>
    `;

    const holdingsContainer = card.querySelector(".wallet-holdings");
    holdingsContainer.innerHTML = `
      <div class="holding-row holding-row-header">
        <span class="header-asset">Asset</span>
        <span class="header-amount">Amount</span>
        <span class="header-value">Value (USD)</span>
        <span class="header-change">24h Change</span>
        <span class="header-action">Action</span>
      </div>
    `;

    (wallet.holdings || []).forEach((h, index) => {
      const hChangeClass =
        h.change24hPct > 0 ? "positive" : h.change24hPct < 0 ? "negative" : "";

      const safeLogo = h.logoUrl || getLogoUrlForSymbol(h.symbol);

      const row = document.createElement("div");
      row.className = "holding-row";
      row.dataset.walletId = wallet.id;
      row.dataset.holdingIndex = index;
      row.innerHTML = `
        <div class="holding-asset-logo">
          <img src="${safeLogo}" alt="${h.symbol}" />
        </div>
        <div class="holding-asset-name">
          <div class="holding-symbol">${h.symbol}</div>
          <div class="holding-name">${h.name}</div>
        </div>
        <div class="holding-amount">${h.amount}</div>
        <div class="holding-value">${formatUsd(h.usdValue)}</div>
        <div class="holding-change ${hChangeClass}">
          ${formatPct(h.change24hPct)}
        </div>
        <div class="holding-action">
          <button class="action-btn" type="button" data-open-menu>
            Action ▾
          </button>
          <div class="action-menu" hidden>
            <button class="action-item" data-action="safesend">
              <span class="safesend-tv">SendSafe</span>
            </button>
            <button class="action-item" data-action="swap">Swap</button>
            <button class="action-item" data-action="buy">Buy More</button>
            <button class="action-item" data-action="liquidate">Liquidate</button>
          </div>
        </div>
      `;
      holdingsContainer.appendChild(row);
    });

    walletsContainer.appendChild(card);
  });

  if (fiatBalanceLabelEl) fiatBalanceLabelEl.textContent = formatUsd(total);
  refreshHeader();
  populateSafesendSelectors();
  renderWalletSettingsUI();
}

// Accordion
if (walletsContainer) {
  walletsContainer.addEventListener("click", (e) => {
    const header = e.target.closest(".wallet-header");
    if (!header) return;

    const card = header.closest(".wallet-card");
    const holdings = card.querySelector(".wallet-holdings");
    const toggle = card.querySelector(".wallet-toggle");
    const hidden = holdings.hasAttribute("hidden");

    if (hidden) {
      holdings.removeAttribute("hidden");
      toggle.textContent = "–";
    } else {
      holdings.setAttribute("hidden", "");
      toggle.textContent = "+";
    }
  });
}

// Action menu
document.addEventListener("click", (e) => {
  if (!e.target.closest(".holding-action")) {
    document
      .querySelectorAll(".action-menu:not([hidden])")
      .forEach((m) => m.setAttribute("hidden", ""));
    return;
  }

  const actionContainer = e.target.closest(".holding-action");
  const menu = actionContainer.querySelector(".action-menu");

  const trigger = e.target.closest("[data-open-menu]");
  if (trigger) {
    const hidden = menu.hasAttribute("hidden");
    document
      .querySelectorAll(".action-menu:not([hidden])")
      .forEach((m) => m.setAttribute("hidden", ""));
    if (hidden) menu.removeAttribute("hidden");
    else menu.setAttribute("hidden", "");
    return;
  }

  const item = e.target.closest(".action-item");
  if (!item) return;
  const action = item.dataset.action;
  menu.setAttribute("hidden", "");

  const holdingRow = actionContainer.closest(".holding-row");
  const walletId = holdingRow.dataset.walletId;
  const index = Number(holdingRow.dataset.holdingIndex);
  const wallet = getWalletById(walletId);

  if (!wallet) return;

  if (action === "safesend") {
    goToSafeSend(wallet.id, index);
  } else {
    console.log(`TODO: ${action} for`, wallet.label);
  }
});

// ===== SENDSAFE SELECTORS & BALANCE =====
function populateSafesendSelectors() {
  if (!ssWalletSelect || !ssAssetSelect) return;

  const prevWalletId = ssWalletSelect.value || currentWalletId;
  const prevAssetKey = ssAssetSelect.value;

  ssWalletSelect.innerHTML = "";
  ssAssetSelect.innerHTML = "";

  if (!wallets.length) {
    ssWalletSelect.innerHTML = `<option value="">No wallets yet</option>`;
    ssAssetSelect.innerHTML = `<option value="">No holdings</option>`;
    updateSafesendSelectedBalance(null, null);
    return;
  }

  wallets.forEach((w) => {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = w.label;
    ssWalletSelect.appendChild(opt);
  });

  const walletToUse =
    wallets.find((w) => w.id === prevWalletId) ||
    wallets.find((w) => w.id === currentWalletId) ||
    wallets[0];

  ssWalletSelect.value = walletToUse.id;
  populateAssetsForWallet(walletToUse.id, prevAssetKey);
}

function populateAssetsForWallet(walletId, prevAssetKey) {
  if (!ssAssetSelect) return;
  ssAssetSelect.innerHTML = "";

  const wallet = getWalletById(walletId);
  if (!wallet || !wallet.holdings.length) {
    ssAssetSelect.innerHTML = `<option value="">No holdings</option>`;
    updateSafesendSelectedBalance(null, null);
    return;
  }

  wallet.holdings.forEach((h, index) => {
    const key = `${wallet.id}:${index}`;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${h.symbol} — ${h.name}`;
    ssAssetSelect.appendChild(opt);
  });

  let selectedKey;
  if (
    prevAssetKey &&
    [...ssAssetSelect.options].some((o) => o.value === prevAssetKey)
  ) {
    selectedKey = prevAssetKey;
  } else {
    selectedKey = `${wallet.id}:0`;
  }
  ssAssetSelect.value = selectedKey;
  updateSafesendBalanceForSelection();
}

function updateSafesendSelectedBalance(wallet, holding) {
  if (!ssBalanceAmountEl || !ssBalanceUsdEl) return;

  if (!wallet || !holding) {
    ssBalanceAmountEl.textContent = "--";
    ssBalanceUsdEl.textContent = "--";
    return;
  }

  ssBalanceAmountEl.textContent = `${holding.amount} ${holding.symbol}`;
  ssBalanceUsdEl.textContent = formatUsd(holding.usdValue || 0);
}

function updateSafesendBalanceForSelection() {
  const walletId = ssWalletSelect ? ssWalletSelect.value : null;
  const assetKey = ssAssetSelect ? ssAssetSelect.value : null;
  if (!walletId || !assetKey || !assetKey.includes(":")) {
    updateSafesendSelectedBalance(null, null);
    return;
  }

  const wallet = getWalletById(walletId);
  if (!wallet) {
    updateSafesendSelectedBalance(null, null);
    return;
  }

  const idx = Number(assetKey.split(":")[1]);
  const holding = wallet.holdings && wallet.holdings[idx];
  if (!holding) {
    updateSafesendSelectedBalance(null, null);
    return;
  }

  updateSafesendSelectedBalance(wallet, holding);
}

if (ssWalletSelect) {
  ssWalletSelect.addEventListener("change", (e) => {
    populateAssetsForWallet(e.target.value, null);
  });
}

if (ssAssetSelect) {
  ssAssetSelect.addEventListener("change", () => {
    updateSafesendBalanceForSelection();
  });
}

function goToSafeSend(walletId, holdingIndex) {
  setView("safesend");
  populateSafesendSelectors();

  if (ssWalletSelect) {
    ssWalletSelect.value = walletId;
    const key = `${walletId}:${holdingIndex}`;
    populateAssetsForWallet(walletId, key);
  }

  if (recipientInput) recipientInput.focus();
}

// ===== SENDSAFE GAUGE / HIGHLIGHTS / HISTORY =====
function classifyScore(score) {
  if (score === null || score === undefined || Number.isNaN(score))
    return "neutral";
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

function updateRiskGauge(score) {
  if (!riskGaugeLabel || !safesendScoreBadge) return;

  if (score === null || score === undefined || Number.isNaN(score)) {
    riskGaugeLabel.textContent = "--";
    safesendScoreBadge.textContent = "Score: -- / 100";
    safesendScoreBadge.className = "risk-badge risk-badge-neutral";
    return;
  }

  riskGaugeLabel.textContent = score.toString();
  safesendScoreBadge.textContent = `Score: ${score} / 100`;

  const level = classifyScore(score);
  safesendScoreBadge.className = "risk-badge";
  if (level === "good") safesendScoreBadge.classList.add("risk-badge-good");
  else if (level === "warn") safesendScoreBadge.classList.add("risk-badge-warn");
  else if (level === "bad") safesendScoreBadge.classList.add("risk-badge-bad");
  else safesendScoreBadge.classList.add("risk-badge-neutral");
}

function updateRiskHighlightsFromEngine(engineResult) {
  if (!riskHighlightsList) return;
  riskHighlightsList.innerHTML = "";

  if (!engineResult) {
    const li = document.createElement("li");
    li.textContent = "Awaiting SendSafe check.";
    riskHighlightsList.appendChild(li);
    return;
  }

  const reasons = Array.isArray(engineResult.reasons) ? engineResult.reasons : [];
  const impacts = Array.isArray(engineResult.explain?.factorImpacts)
    ? engineResult.explain.factorImpacts
    : [];

  let bullets = reasons.slice();
  if (!bullets.length && impacts.length) {
    bullets = impacts.filter((f) => f.delta > 0).map((f) => f.label);
  }

  if (!bullets.length) {
    const li = document.createElement("li");
    li.textContent = "No major risk factors flagged by the SendSafe engine.";
    riskHighlightsList.appendChild(li);
    return;
  }

  bullets.slice(0, 4).forEach((reason) => {
    const li = document.createElement("li");
    li.textContent = reason;
    riskHighlightsList.appendChild(li);
  });
}

function renderSafesendHistory() {
  if (!safesendHistoryList) return;

  safesendHistoryList.innerHTML = "";

  if (!safesendHistory.length) {
    const empty = document.createElement("div");
    empty.className = "safesend-history-row";
    empty.innerHTML =
      '<div class="safesend-history-main"><div class="safesend-history-meta">No SendSafe checks yet.</div></div>';
    safesendHistoryList.appendChild(empty);
    return;
  }

  safesendHistory
    .slice()
    .reverse()
    .forEach((entry) => {
      const row = document.createElement("div");
      row.className = "safesend-history-row";

      const main = document.createElement("div");
      main.className = "safesend-history-main";
      main.innerHTML = `
        <div class="safesend-history-address">${entry.displayRecipient || entry.address}</div>
        ${entry.displayRecipient && entry.displayRecipient !== entry.address
          ? `<div class="hint-text">Resolved: ${shorten(entry.address, 10, 6)}</div>`
          : ""
        }
        <div class="safesend-history-meta">
          Wallet: ${entry.walletLabel} · Asset: ${entry.assetSymbol}
        </div>
      `;

      const right = document.createElement("div");
      const scoreClass =
        entry.scoreCategory === "good"
          ? "good"
          : entry.scoreCategory === "warn"
          ? "warn"
          : entry.scoreCategory === "bad"
          ? "bad"
          : "";
      right.innerHTML = `
        <div class="safesend-history-score ${scoreClass}">
          ${entry.score}/100
        </div>
        ${
          entry.alertText
            ? `<div class="safesend-history-alert">${entry.alertText}</div>`
            : ""
        }
      `;

      row.appendChild(main);
      row.appendChild(right);
      safesendHistoryList.appendChild(row);
    });
}

// ===== RECENT TX (sender + recipient) =====
async function fetchRecentTxForAddress(address, uiNetwork) {
  if (!address) return [];
  const net = mapNetworkForRiskEngine(uiNetwork);
  const url = `${RISK_ENGINE_BASE_URL}/tx-debug?address=${encodeURIComponent(
    address
  )}&network=${encodeURIComponent(net)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("tx-debug failed", res.status);
      return [];
    }
    const body = await res.json();
    const txs = Array.isArray(body.txs) ? body.txs : [];
    txs.sort((a, b) => (b.timeStamp || 0) - (a.timeStamp || 0));
    return txs.slice(0, 10);
  } catch (err) {
    console.warn("tx-debug error", err);
    return [];
  }
}

async function loadRecentTransactions(fromAddress, toAddress, uiNetwork) {
  if (!safesendTxList) return;

  safesendTxList.innerHTML =
    '<div class="hint-text">Loading recent transactions…</div>';

  try {
    const [toTxs, fromTxs] = await Promise.all([
      fetchRecentTxForAddress(toAddress, uiNetwork),
      fetchRecentTxForAddress(fromAddress, uiNetwork),
    ]);

    const wrapper = document.createElement("div");
    wrapper.className = "safesend-tx-columns";

    const recipCol = document.createElement("div");
    recipCol.className = "safesend-tx-column";

    const recipHeader = document.createElement("div");
    recipHeader.className = "safesend-tx-section-label";
    recipHeader.textContent = "Recipient address";
    recipCol.appendChild(recipHeader);

    if (toTxs.length) {
      toTxs.forEach((tx) => {
        const row = document.createElement("div");
        row.className = "safesend-tx-row";
        row.innerHTML = `
          <span class="safesend-tx-time">${formatTxTime(tx.timeStamp)}</span>
          <span class="safesend-tx-hash">${shorten(tx.hash || "")}</span>
          <span class="safesend-tx-amount">${tx.value && tx.value !== "0" ? tx.value : ""}</span>
        `;
        recipCol.appendChild(row);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "hint-text";
      empty.textContent = "No recent tx for recipient.";
      recipCol.appendChild(empty);
    }

    const senderCol = document.createElement("div");
    senderCol.className = "safesend-tx-column";

    const senderHeader = document.createElement("div");
    senderHeader.className = "safesend-tx-section-label";
    senderHeader.textContent = "Sender address";
    senderCol.appendChild(senderHeader);

    if (fromTxs.length) {
      fromTxs.forEach((tx) => {
        const direction =
          tx.from &&
          fromAddress &&
          tx.from.toLowerCase() === fromAddress.toLowerCase()
            ? "Sent"
            : "Received";

        const row = document.createElement("div");
        row.className = "safesend-tx-row";
        row.innerHTML = `
          <span class="safesend-tx-time">
            <span class="safesend-tx-direction">${direction}</span>
            · ${formatTxTime(tx.timeStamp)}
          </span>
          <span class="safesend-tx-hash">${shorten(tx.hash || "")}</span>
          <span class="safesend-tx-amount">${tx.value && tx.value !== "0" ? tx.value : ""}</span>
        `;
        senderCol.appendChild(row);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "hint-text";
      empty.textContent = "No recent tx for sender.";
      senderCol.appendChild(empty);
    }

    wrapper.appendChild(recipCol);
    wrapper.appendChild(senderCol);

    safesendTxList.innerHTML = "";
    safesendTxList.appendChild(wrapper);
  } catch (err) {
    console.warn("loadRecentTransactions error", err);
    safesendTxList.innerHTML =
      '<div class="hint-text">Unable to load recent transactions right now.</div>';
  }
}

// ===== MODALS =====
function openModal(el) {
  if (!el) return;
  el.removeAttribute("hidden");
}

function closeModal(el) {
  if (!el) return;
  el.setAttribute("hidden", "");
}

document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-modal]")) {
    const modal = e.target.closest(".modal");
    if (modal) closeModal(modal);
  }
});

function updateModalGauge(score) {
  if (!modalRiskGaugeDial || !modalRiskGaugeLabel) return;

  modalRiskGaugeDial.classList.remove("good", "warn", "bad");
  if (score === null || score === undefined || Number.isNaN(score)) {
    modalRiskGaugeLabel.textContent = "--";
    return;
  }

  modalRiskGaugeLabel.textContent = score.toString();
  const level = classifyScore(score);
  if (level === "good") modalRiskGaugeDial.classList.add("good");
  else if (level === "warn") modalRiskGaugeDial.classList.add("warn");
  else if (level === "bad") modalRiskGaugeDial.classList.add("bad");
}

function showSafesendResultModal(score) {
  if (!safesendResultModal) return;

  updateModalGauge(score);
  safesendRiskAckCheckbox.checked = false;
  safesendRiskAckRow.hidden = true;
  safesendResultButtons.innerHTML = "";

  if (score >= 90) {
    safesendResultMessage.textContent =
      "This transaction is being denied due to elevated risks associated with government sanctions, concerning patterns of activity or reports of fraud.";

    const backBtn = document.createElement("button");
    backBtn.className = "primary-btn";
    backBtn.textContent = "Return to SendSafe";
    backBtn.addEventListener("click", () => {
      closeModal(safesendResultModal);
    });

    safesendResultButtons.appendChild(backBtn);
  } else if (score >= 60) {
    safesendResultMessage.textContent =
      "This transaction represents a higher than normal amount of risk. Should you choose to proceed with the transaction you assume any risks associated with the transaction. Neither RiskXLabs, SendSafe nor our affiliates will be responsible for the reclamation or recovery of funds sent to this address now or in the future.";

    safesendRiskAckRow.hidden = false;
    safesendRiskAckText.textContent =
      "By checking the following box you agree to all of the above.";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ghost-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      closeModal(safesendResultModal);
    });

    const completeBtn = document.createElement("button");
    completeBtn.className = "primary-btn";
    completeBtn.textContent = "Complete transaction";
    completeBtn.disabled = true;

    const onChange = () => {
      completeBtn.disabled = !safesendRiskAckCheckbox.checked;
    };
    safesendRiskAckCheckbox.addEventListener("change", onChange);

    completeBtn.addEventListener("click", () => {
      alert("Prototype: this is where the transaction would be submitted.");
      closeModal(safesendResultModal);
      safesendRiskAckCheckbox.removeEventListener("change", onChange);
    });

    safesendResultButtons.appendChild(cancelBtn);
    safesendResultButtons.appendChild(completeBtn);
  } else {
    safesendResultMessage.textContent =
      "This transaction falls within normal risk bands according to SendSafe. You may proceed, or cancel if you have doubts.";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ghost-btn";
    cancelBtn.textContent = "Cancel transaction";
    cancelBtn.addEventListener("click", () => {
      closeModal(safesendResultModal);
    });

    const completeBtn = document.createElement("button");
    completeBtn.className = "primary-btn";
    completeBtn.textContent = "Complete transaction";
    completeBtn.addEventListener("click", () => {
      alert("Prototype: this is where the transaction would be submitted.");
      closeModal(safesendResultModal);
    });

    safesendResultButtons.appendChild(cancelBtn);
    safesendResultButtons.appendChild(completeBtn);
  }

  openModal(safesendResultModal);
}

// ===== SENDSAFE: ENS resolve while typing =====
let ensResolveTimer = null;
if (recipientInput) {
  recipientInput.addEventListener("input", () => {
    if (ensResolveTimer) clearTimeout(ensResolveTimer);

    ensResolveTimer = setTimeout(async () => {
      const networkValue = networkSelect ? networkSelect.value : "ethereum-mainnet";
      const v = (recipientInput.value || "").trim();

      if (!isEnsName(v)) {
        setRecipientResolutionUI({ type: "none" });
        return;
      }

      try {
        const res = await resolveRecipientToAddress(v, networkValue);
        setRecipientResolutionUI(res);
      } catch (e) {
        setRecipientResolutionUI({ type: "ens", input: v, address: null, error: "Resolve failed." });
      }
    }, 350);
  });
}

// ===== SENDSAFE BUTTON HANDLER =====
if (runSafeSendBtn) {
  runSafeSendBtn.addEventListener("click", async () => {
    const rawRecipient = (recipientInput && recipientInput.value.trim()) || "";
    if (!rawRecipient) {
      alert("Paste a recipient address or ENS name first.");
      return;
    }

    const walletId = ssWalletSelect ? ssWalletSelect.value : null;
    const assetKey = ssAssetSelect ? ssAssetSelect.value : null;
    const wallet = walletId && getWalletById(walletId);

    let assetSymbol = "";
    let amountUsd = null;

    if (wallet && assetKey && assetKey.includes(":")) {
      const idx = Number(assetKey.split(":")[1]);
      const holding = wallet.holdings[idx];
      if (holding) {
        assetSymbol = holding.symbol;
        amountUsd = holding.usdValue ?? null;
      }
    }

    runSafeSendBtn.disabled = true;
    const labelSpan = runSafeSendBtn.querySelector(".safesend-tv");
    if (labelSpan) labelSpan.textContent = "Scanning…";

    try {
      const networkValue = networkSelect ? networkSelect.value : "ethereum-mainnet";

      let resolved = null;
      try {
        resolved = await resolveRecipientToAddress(rawRecipient, networkValue);
      } catch (err) {
        console.error("Resolve error", err);
        alert("Unable to resolve recipient. Please try again.");
        return;
      }

      if (!resolved || !resolved.address) {
        if (resolved && resolved.type === "ens") {
          alert(`That ENS name didn't resolve to an address.${resolved.error ? " (" + resolved.error + ")" : ""}`);
        } else {
          alert("Enter a valid 0x address or an ENS name like riskxlabs.eth");
        }
        return;
      }

      const toAddressResolved = resolved.address;

      loadRecentTransactions(wallet ? wallet.address : null, toAddressResolved, networkValue);

      const payload = {
        network: mapNetworkForRiskEngine(networkValue),
        toAddress: toAddressResolved,
        fromAddress: wallet ? wallet.address : null,
        amountUsd,
        symbol: assetSymbol || null,
      };

      const res = await fetch(`${RISK_ENGINE_BASE_URL}/wallet-risk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const bodyText = await res.text();
      let engineResult;
      try {
        engineResult = JSON.parse(bodyText);
      } catch {
        engineResult = null;
      }

      if (!res.ok) {
        console.error("Risk engine 4xx/5xx:", res.status, bodyText);
        const msg =
          engineResult && engineResult.error
            ? engineResult.error
            : `Risk engine error ${res.status}`;
        alert(`SendSafe risk engine rejected the request: ${msg}`);
        updateRiskGauge(null);
        updateRiskHighlightsFromEngine(null);
        return;
      }

      const score = engineResult.score ?? engineResult.risk_score ?? null;

      updateRiskGauge(score);
      updateRiskHighlightsFromEngine(engineResult);

      const previous = safesendHistory.find(
        (e) => e.address && e.address.toLowerCase() === toAddressResolved.toLowerCase()
      );
      let alertText = "";
      if (previous && previous.score !== score) {
        alertText = `Score changed from ${previous.score} to ${score}.`;
      }

      const scoreCategory = classifyScore(score);
      const entry = {
        address: toAddressResolved,
        displayRecipient: resolved.type === "ens" ? resolved.input : toAddressResolved,
        walletLabel: wallet ? wallet.label : "Unknown wallet",
        assetSymbol: assetSymbol || "Unknown asset",
        score,
        scoreCategory,
        alertText,
        timestamp: Date.now(),
      };

      safesendHistory.push(entry);
      saveSafesendHistory();
      renderSafesendHistory();

      showSafesendResultModal(score);
    } catch (err) {
      console.error("SendSafe error:", err);
      alert("SendSafe risk engine is temporarily unavailable. Showing no score.");
      updateRiskGauge(null);
      updateRiskHighlightsFromEngine(null);
    } finally {
      runSafeSendBtn.disabled = false;
      const labelSpan2 = runSafeSendBtn.querySelector(".safesend-tv");
      if (labelSpan2) labelSpan2.textContent = "Sendsafe";
    }
  });
}

if (clearSafesendHistoryBtn) {
  clearSafesendHistoryBtn.addEventListener("click", () => {
    if (!confirm("Clear all SendSafe history on this device?")) return;
    safesendHistory = [];
    saveSafesendHistory();
    renderSafesendHistory();
    updateRiskGauge(null);
    updateRiskHighlightsFromEngine(null);
  });
}

// ===== CREATE WALLET (portable vault) =====
function createNewWallet() {
  try {
    const wallet = ethers.Wallet.createRandom();
    const phrase = wallet.mnemonic && wallet.mnemonic.phrase;

    if (cwLabelEl) cwLabelEl.value = "New wallet";
    if (cwMnemonicEl) cwMnemonicEl.value = phrase || "";
    if (cwAddressEl) cwAddressEl.textContent = wallet.address;

    if (cwPasswordEl) cwPasswordEl.value = "";
    if (cwPasswordErrorEl) {
      cwPasswordErrorEl.textContent = "";
      cwPasswordErrorEl.setAttribute("hidden", "");
    }

    openModal(createWalletModal);
  } catch (err) {
    console.error("Create wallet error", err);
    alert("Unable to create wallet.");
  }
}

if (createWalletBtn) createWalletBtn.addEventListener("click", createNewWallet);
if (hubCreateBtn) hubCreateBtn.addEventListener("click", createNewWallet);

if (cwConfirmBtn) {
  cwConfirmBtn.addEventListener("click", async () => {
    const label = (cwLabelEl && cwLabelEl.value.trim()) || "New wallet";
    const phrase = (cwMnemonicEl && cwMnemonicEl.value.trim()) || "";
    const password = (cwPasswordEl && cwPasswordEl.value.trim()) || "";

    if (!phrase) {
      alert("Seed phrase missing.");
      return;
    }

    if (!validatePasswordPattern(password)) {
      if (cwPasswordErrorEl) {
        cwPasswordErrorEl.textContent =
          "Password must be at least 8 characters and include letters and numbers.";
        cwPasswordErrorEl.removeAttribute("hidden");
      } else {
        alert("Password must be at least 8 characters and include letters and numbers.");
      }
      return;
    }

    let address;
    try {
      if (!ethers.utils.isValidMnemonic(phrase)) throw new Error("Invalid mnemonic");
      address = deriveEvmAddressFromMnemonic(phrase, DEFAULT_EVM_DERIVATION_PATH);
    } catch (e) {
      alert("That seed phrase appears invalid.");
      return;
    }

    let vault;
    try {
      vault = await encryptMnemonicToVault(phrase, password);
    } catch (e) {
      console.error("Vault encrypt error", e);
      alert("Unable to encrypt seed. Check browser crypto support.");
      return;
    }

    let existing = wallets.find((w) => w.address.toLowerCase() === address.toLowerCase());
    if (!existing) {
      const id = `wallet_${Date.now()}`;
      existing = {
        id,
        label,
        address,
        hd: { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 },
        vault,
        totalUsd: 0,
        change24hPct: 0,
        holdings: [],
      };
      wallets.push(existing);
    } else {
      existing.label = label;
      existing.hd = existing.hd || { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 };
      existing.vault = vault;
      delete existing.password;
    }

    saveWallets();
    closeModal(createWalletModal);
    renderWallets();

    sessionUnlockedWallets.add(existing.id);
    setCurrentWallet(existing.id, { refreshOnChain: true });
  });
}

// ===== IMPORT WALLET (portable vault) =====
function openImportModal() {
  if (!importWalletModal) return;
  if (iwLabelEl) iwLabelEl.value = "";
  if (iwMnemonicEl) iwMnemonicEl.value = "";
  if (iwErrorEl) {
    iwErrorEl.textContent = "";
    iwErrorEl.setAttribute("hidden", "");
  }

  if (iwPasswordEl) iwPasswordEl.value = "";
  if (iwPasswordErrorEl) {
    iwPasswordErrorEl.textContent = "";
    iwPasswordErrorEl.setAttribute("hidden", "");
  }

  openModal(importWalletModal);
}

if (importWalletBtn) importWalletBtn.addEventListener("click", openImportModal);
if (hubImportBtn) hubImportBtn.addEventListener("click", openImportModal);

if (iwImportBtn) {
  iwImportBtn.addEventListener("click", async () => {
    const label = (iwLabelEl && iwLabelEl.value.trim()) || "Imported wallet";
    const phrase = (iwMnemonicEl && iwMnemonicEl.value.trim().toLowerCase()) || "";
    const password = (iwPasswordEl && iwPasswordEl.value.trim()) || "";

    if (iwErrorEl) {
      iwErrorEl.textContent = "";
      iwErrorEl.setAttribute("hidden", "");
    }
    if (iwPasswordErrorEl) {
      iwPasswordErrorEl.textContent = "";
      iwPasswordErrorEl.setAttribute("hidden", "");
    }

    if (!phrase) {
      if (iwErrorEl) {
        iwErrorEl.textContent = "Seed phrase is required.";
        iwErrorEl.removeAttribute("hidden");
      } else alert("Seed phrase is required.");
      return;
    }

    const words = phrase.split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      if (iwErrorEl) {
        iwErrorEl.textContent = "Seed phrase must be 12 or 24 words.";
        iwErrorEl.removeAttribute("hidden");
      } else alert("Seed phrase must be 12 or 24 words.");
      return;
    }

    if (!validatePasswordPattern(password)) {
      if (iwPasswordErrorEl) {
        iwPasswordErrorEl.textContent =
          "Password must be at least 8 characters and include letters and numbers.";
        iwPasswordErrorEl.removeAttribute("hidden");
      } else {
        alert("Password must be at least 8 characters and include letters and numbers.");
      }
      return;
    }

    let addr;
    try {
      if (!ethers.utils.isValidMnemonic(phrase)) throw new Error("Invalid mnemonic");
      addr = deriveEvmAddressFromMnemonic(phrase, DEFAULT_EVM_DERIVATION_PATH);
    } catch (err) {
      console.error("Import error", err);
      if (iwErrorEl) {
        iwErrorEl.textContent =
          "That seed phrase could not be imported. Please double-check the words.";
        iwErrorEl.removeAttribute("hidden");
      } else alert("That seed phrase could not be imported.");
      return;
    }

    let vault;
    try {
      vault = await encryptMnemonicToVault(phrase, password);
    } catch (e) {
      console.error("Vault encrypt error", e);
      alert("Unable to encrypt seed. Check browser crypto support.");
      return;
    }

    let existing = wallets.find((w) => w.address.toLowerCase() === addr.toLowerCase());
    if (!existing) {
      const id = `wallet_${Date.now()}`;
      existing = {
        id,
        label,
        address: addr,
        hd: { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 },
        vault,
        totalUsd: 0,
        change24hPct: 0,
        holdings: [],
      };
      wallets.push(existing);
    } else {
      existing.label = label;
      existing.hd = existing.hd || { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 };
      existing.vault = vault;
      delete existing.password;
    }

    saveWallets();
    closeModal(importWalletModal);
    renderWallets();

    sessionUnlockedWallets.add(existing.id);
    setCurrentWallet(existing.id, { refreshOnChain: true });
  });
}

// ===== UNLOCK =====
function openUnlockModalForWallet(wallet) {
  pendingUnlockWalletId = wallet.id;
  if (uwLabelEl) uwLabelEl.textContent = wallet.label;
  if (uwAddressEl) uwAddressEl.textContent = wallet.address;
  if (uwPasswordEl) uwPasswordEl.value = "";
  if (uwPasswordErrorEl) {
    uwPasswordErrorEl.textContent = "";
    uwPasswordErrorEl.setAttribute("hidden", "");
  }
  openModal(unlockWalletModal);
}

document.addEventListener("click", (e) => {
  const unlockBtn = e.target.closest("[data-gate-unlock]");
  if (!unlockBtn) return;

  const walletId = unlockBtn.dataset.gateUnlock;
  const wallet = getWalletById(walletId);
  if (!wallet) return;

  openUnlockModalForWallet(wallet);
});

if (uwConfirmBtn) {
  uwConfirmBtn.addEventListener("click", async () => {
    if (!pendingUnlockWalletId) return;
    const wallet = getWalletById(pendingUnlockWalletId);
    if (!wallet) {
      pendingUnlockWalletId = null;
      closeModal(unlockWalletModal);
      return;
    }

    const entered = (uwPasswordEl && uwPasswordEl.value.trim()) || "";
    if (uwPasswordErrorEl) {
      uwPasswordErrorEl.textContent = "";
      uwPasswordErrorEl.setAttribute("hidden", "");
    }

    if (!entered) {
      if (uwPasswordErrorEl) {
        uwPasswordErrorEl.textContent = "Password is required.";
        uwPasswordErrorEl.removeAttribute("hidden");
      }
      return;
    }

    if (hasPortableVault(wallet)) {
      try {
        await decryptMnemonicFromVault(wallet.vault, entered);
        sessionUnlockedWallets.add(wallet.id);
      } catch {
        if (uwPasswordErrorEl) {
          uwPasswordErrorEl.textContent = "Incorrect password.";
          uwPasswordErrorEl.removeAttribute("hidden");
        }
        return;
      }
    } else {
      sessionUnlockedWallets.add(wallet.id);
    }

    pendingUnlockWalletId = null;
    closeModal(unlockWalletModal);
    setCurrentWallet(wallet.id, { refreshOnChain: true });
    renderWallets();
  });
}

// ===== NETWORK / TOPBAR BUTTONS =====
if (networkSelect) {
  networkSelect.addEventListener("change", (e) => {
    console.log("Network changed to:", e.target.value);
    refreshWalletOnChainData();
  });
}

if (copyAddressBtn) {
  copyAddressBtn.addEventListener("click", async () => {
    const text = (walletAddressEl && walletAddressEl.textContent) || "";
    if (!text || text === "No wallet selected") return;
    try {
      await navigator.clipboard.writeText(text);
      copyAddressBtn.textContent = "✓";
      setTimeout(() => {
        copyAddressBtn.textContent = "⧉";
      }, 800);
    } catch (err) {
      console.error("Clipboard error", err);
    }
  });
}

if (switchAccountBtn) {
  switchAccountBtn.addEventListener("click", () => {
    showWalletHub();
  });
}

if (sendBtn) {
  sendBtn.addEventListener("click", () => {
    if (!currentWalletId) {
      showWalletHub();
      return;
    }
    const wallet = getWalletById(currentWalletId);
    if (!wallet) {
      showWalletHub();
      return;
    }
    const hasHoldings = wallet.holdings && wallet.holdings.length > 0;
    if (hasHoldings) {
      goToSafeSend(wallet.id, 0);
    } else {
      setView("safesend");
    }
  });
}

// ===== SETTINGS: WALLET LABELS + PORTABILITY STATUS + CONVERT =====
function renderWalletSettingsUI() {
  if (!walletSettingsList) return;

  walletSettingsList.innerHTML = "";

  if (!wallets.length) {
    const empty = document.createElement("div");
    empty.className = "settings-empty";
    empty.textContent = "No wallets on this device yet.";
    walletSettingsList.appendChild(empty);
    return;
  }

  wallets.forEach((w) => {
    const row = document.createElement("div");
    row.className = "wallet-settings-row";

    const portable = hasPortableVault(w);

    row.innerHTML = `
      <div class="wallet-settings-address">
        ${shorten(w.address, 10, 6)}
        <div class="hint-text">${portable ? "Portable (seed vault encrypted)" : "Legacy (re-import seed to make portable)"}</div>
      </div>

      <input
        class="input wallet-label-input"
        data-wallet-id="${w.id}"
        value="${w.label}"
      />

      <div class="wallet-settings-actions">
        ${portable ? "" : `<button class="pill-btn-outline" data-convert-wallet="${w.id}">Convert</button>`}
      </div>
    `;

    walletSettingsList.appendChild(row);
  });
}

if (walletSettingsList) {
  walletSettingsList.addEventListener("change", (e) => {
    const input = e.target.closest(".wallet-label-input");
    if (!input) return;
    const id = input.dataset.walletId;
    const wallet = getWalletById(id);
    if (!wallet) return;

    const newLabel = input.value.trim() || "Wallet";
    wallet.label = newLabel;
    saveWallets();
    renderWallets();
    populateSafesendSelectors();
    renderWalletSettingsUI();
  });

  walletSettingsList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-convert-wallet]");
    if (!btn) return;
    const id = btn.dataset.convertWallet;
    const w = getWalletById(id);
    if (!w) return;

    openImportModal();
    if (iwLabelEl) iwLabelEl.value = w.label || "Imported wallet";
    if (iwErrorEl) {
      iwErrorEl.textContent = `Convert wallet: paste the seed phrase for ${shorten(w.address, 8, 6)} to enable portability.`;
      iwErrorEl.removeAttribute("hidden");
    }
  });
}

// ===== SETTINGS: TICKER UI =====
function renderTickerSettingsUI() {
  if (!tickerSettingsContainer) return;

  tickerSettingsContainer.innerHTML = "";

  const currentSet = new Set(tickerSymbols);

  AVAILABLE_TICKER_ASSETS.forEach((asset) => {
    const row = document.createElement("label");
    row.className = "ticker-asset-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = asset.symbol;
    checkbox.checked = currentSet.has(asset.symbol);
    checkbox.className = "ticker-asset-checkbox";

    checkbox.addEventListener("change", () => {
      const newSymbols = new Set(tickerSymbols);
      if (checkbox.checked) newSymbols.add(asset.symbol);
      else newSymbols.delete(asset.symbol);

      if (!newSymbols.size) {
        alert("At least one asset must be selected for the ticker.");
        checkbox.checked = true;
        newSymbols.add(asset.symbol);
      }

      const updated = Array.from(newSymbols);
      saveTickerSymbols(updated);
      refreshTickerNow();
    });

    const labelSpan = document.createElement("span");
    labelSpan.textContent = `${asset.symbol} — ${asset.label}`;

    row.appendChild(checkbox);
    row.appendChild(labelSpan);
    tickerSettingsContainer.appendChild(row);
  });
}

// ===== VAULT EXPORT / IMPORT (Settings) =====
function buildVaultExportPayload() {
  return {
    schema: "xwallet-vault",
    v: 2, // ✅ bumped version because we now include tokenCatalog
    exportedAt: new Date().toISOString(),
    wallets: wallets.map((w) => ({
      id: w.id,
      label: w.label,
      address: w.address,
      hd: w.hd || { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 },
      vault: w.vault || null,
    })),
    // ✅ NEW: portable token discovery across devices
    tokenCatalog: tokenCatalog || {},
  };
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

if (exportVaultBtn) {
  exportVaultBtn.addEventListener("click", () => {
    const payload = buildVaultExportPayload();
    downloadJson("xwallet-vault.json", payload);
  });
}

if (importVaultBtn && importVaultFile) {
  importVaultBtn.addEventListener("click", () => {
    importVaultFile.click();
  });

  importVaultFile.addEventListener("change", async () => {
    const file = importVaultFile.files && importVaultFile.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data || data.schema !== "xwallet-vault" || !Array.isArray(data.wallets)) {
        alert("That file does not appear to be a valid Xwallet vault export.");
        return;
      }

      // ✅ Merge tokenCatalog from export (if present)
      if (data.tokenCatalog && typeof data.tokenCatalog === "object") {
        tokenCatalog = { ...(tokenCatalog || {}), ...(data.tokenCatalog || {}) };
        saveTokenCatalog();
      }

      const incoming = data.wallets;

      incoming.forEach((iw) => {
        if (!iw || !iw.address) return;

        const existing = wallets.find((w) => w.address.toLowerCase() === String(iw.address).toLowerCase());
        if (existing) {
          existing.label = iw.label || existing.label;
          existing.hd = iw.hd || existing.hd || { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 };
          if (iw.vault) existing.vault = iw.vault;
          delete existing.password;
        } else {
          wallets.push({
            id: iw.id || `wallet_${Date.now()}`,
            label: iw.label || "Imported wallet",
            address: ethers.utils.getAddress(iw.address),
            hd: iw.hd || { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 },
            vault: iw.vault || null,
            totalUsd: 0,
            change24hPct: 0,
            holdings: [],
          });
        }
      });

      saveWallets();
      renderWallets();
      renderWalletSettingsUI();
      updateWalletHubList();

      alert("Vault imported. Unlock wallets with their passwords to use them.");
    } catch (e) {
      console.error("Vault import error", e);
      alert("Unable to import that file.");
    } finally {
      importVaultFile.value = "";
    }
  });
}

// ===== TICKER: DATA =====
function getTickerAssetConfigForSymbols(symbols) {
  const bySymbol = new Map(AVAILABLE_TICKER_ASSETS.map((a) => [a.symbol, a]));
  return symbols.map((sym) => bySymbol.get(sym)).filter((a) => !!a);
}

async function fetchTickerData() {
  const configs = getTickerAssetConfigForSymbols(tickerSymbols);
  if (!configs.length) return [];

  const ids = configs.map((c) => c.id).join(",");
  const url =
    "https://api.coingecko.com/api/v3/simple/price" +
    "?vs_currencies=usd&include_24hr_change=true&ids=" +
    encodeURIComponent(ids);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("Ticker API response not ok:", res.status);
      return [];
    }
    const body = await res.json();

    return configs.map((cfg) => {
      const entry = body[cfg.id];
      const price = entry ? entry.usd : null;
      const change = entry ? entry.usd_24h_change : null;
      return { symbol: cfg.symbol, label: cfg.label, price, change };
    });
  } catch (err) {
    console.warn("Ticker fetch error:", err);
    return [];
  }
}

function renderTicker(data) {
  if (!tickerStrip) return;

  if (!data || !data.length) {
    tickerStrip.textContent = "Ticker data unavailable.";
    return;
  }

  const strip = document.createElement("div");
  strip.className = "ticker-strip-inner";

  data.forEach((item) => {
    const changeClass =
      item.change > 0 ? "positive" : item.change < 0 ? "negative" : "";

    const cell = document.createElement("div");
    cell.className = "ticker-item";
    cell.innerHTML = `
      <span class="ticker-symbol">${item.symbol}</span>
      <span class="ticker-price">${formatUsd(item.price)}</span>
      <span class="ticker-change ${changeClass}">
        ${formatPct(item.change)}
      </span>
    `;
    strip.appendChild(cell);
  });

  tickerStrip.innerHTML = "";
  tickerStrip.appendChild(strip);
}

async function refreshTickerNow() {
  const data = await fetchTickerData();
  renderTicker(data);
}

function startTickerAutoRefresh() {
  if (tickerRefreshTimer) {
    clearInterval(tickerRefreshTimer);
    tickerRefreshTimer = null;
  }
  refreshTickerNow();
  tickerRefreshTimer = setInterval(refreshTickerNow, 60_000);
}

// ===== INIT =====
loadTokenCatalog();          // ✅ NEW
loadWallets();
loadSafesendHistory();
tickerSymbols = loadTickerSymbols();

// Keep existing demo behavior if no wallets exist
if (!wallets.length) {
  wallets = [
    {
      id: "demo",
      label: "Demo wallet",
      address: "0x1234...ABCD",
      vault: null,
      hd: null,
      totalUsd: 1234.56,
      change24hPct: 1.2,
      holdings: [
        {
          symbol: "ETH",
          name: "Ethereum",
          logoUrl: getLogoUrlForSymbol("ETH"),
          amount: 0.5,
          usdValue: 950,
          change24hPct: 2.5,
          tokenAddress: null,
        },
        {
          symbol: "USDC",
          name: "USD Coin",
          logoUrl: getLogoUrlForSymbol("USDC"),
          amount: 100,
          usdValue: 100,
          change24hPct: 0.0,
          tokenAddress: "0x...",
        },
      ],
    },
  ];
  saveWallets();
  setCurrentWallet("demo");
}

renderWallets();
renderSafesendHistory();
updateRiskGauge(null);
updateRiskHighlightsFromEngine(null);
renderWalletSettingsUI();
renderTickerSettingsUI();
startTickerAutoRefresh();
setView("dashboard");
updateAppVisibility();

// ✅ If a wallet is already selected from session, start balance auto-refresh
if (currentWalletId) startWalletAutoRefresh();

// ✅ Stop refresh loops cleanly when the page is unloading
window.addEventListener("beforeunload", () => {
  stopWalletAutoRefresh();
  if (tickerRefreshTimer) clearInterval(tickerRefreshTimer);
});
