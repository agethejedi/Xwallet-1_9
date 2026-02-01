// app.js — X-Wallet + SendSafe + Alchemy (multi-EVM networks) + Seed Vault (1.8) + ENS resolution (public naming)
// ✅ Updates in this drop-in:
// 1) Native ETH send (ethereum-mainnet + sepolia)
// 2) SendSafe-gated signing
// 3) Transaction preview + confirm (incl. gas estimate)
// 4) Hard deny / warn enforcement (deny >= 90, warn 60-89 w/ ack)

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
  const ch = s && s[0] ? s[0].toUpperCase() : "T";
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
  },
  // PYUSD Sepolia
  "0xcac5ca27d96c219bdcdc823940b66ebd4ff4c7f1": {
    symbol: "PYUSD-sep",
    name: "PYUSD (Sepolia)",
    logoUrl: getLogoUrlForSymbol("PYUSD-sep"),
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
// Note: ethers+EVM networks use JsonRpcProvider.
// Solana is NOT EVM; we will not attempt native balance with ethers here.

function getRpcUrlForNetwork(uiValue) {
  if (uiValue === "iotex-mainnet") return "https://babel-api.mainnet.iotex.io";
  if (uiValue === "iotex-testnet") return "https://babel-api.testnet.iotex.io";

  if (!ALCHEMY_API_KEY) return null;

  // Alchemy EVM
  if (uiValue === "ethereum-mainnet")
    return `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "sepolia")
    return `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "arbitrum")
    return `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "arbitrum-sepolia")
    return `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "base")
    return `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "base-sepolia")
    return `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "celo")
    return `https://celo-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "celo-alfajores")
    return `https://celo-alfajores.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "moonbeam")
    return `https://moonbeam-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "moonbeam-alpha")
    return `https://moonbeam-alpha.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "worldchain")
    return `https://worldchain-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  if (uiValue === "worldchain-sepolia")
    return `https://worldchain-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

  return null;
}

function getProviderForNetwork(uiValue) {
  const url = getRpcUrlForNetwork(uiValue);
  if (!url) return null;

  // Explicit chainId helps on some RPCs
  const staticNet = (() => {
    switch (uiValue) {
      case "iotex-mainnet":
        return { name: "iotex", chainId: 4689 };
      case "iotex-testnet":
        return { name: "iotex-testnet", chainId: 4690 };
      default:
        return null;
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
    throw new Error(
      "Password required (min 8 chars) to encrypt seed for portability."
    );
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

// Standard EVM derivation path
const DEFAULT_EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0";

function deriveEvmAddressFromMnemonic(
  mnemonic,
  path = DEFAULT_EVM_DERIVATION_PATH
) {
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
  // ENS is anchored to Ethereum mainnet; Sepolia has test ENS.
  if (uiNetwork === "sepolia") return getProviderForNetwork("sepolia");
  return getProviderForNetwork("ethereum-mainnet");
}

async function resolveRecipientToAddress(input, uiNetwork) {
  const raw = String(input || "").trim();

  // Address case
  if (raw.toLowerCase().startsWith("0x")) {
    if (!ethers.utils.isAddress(raw))
      return { type: "invalid", input: raw, address: null };
    return {
      type: "address",
      input: raw,
      address: ethers.utils.getAddress(raw),
    };
  }

  // ENS case
  if (isEnsName(raw)) {
    const ensProvider = getEnsResolutionProvider(uiNetwork);
    if (!ensProvider)
      return {
        type: "ens",
        input: raw,
        address: null,
        error: "No ENS-capable provider configured.",
      };
    const addr = await ensProvider.resolveName(raw);
    if (!addr)
      return {
        type: "ens",
        input: raw,
        address: null,
        error: "ENS name did not resolve.",
      };
    return {
      type: "ens",
      input: raw,
      address: ethers.utils.getAddress(addr),
    };
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

// ===== AUTLOAD ERC-20 via Alchemy (where available) =====
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
          const override = KNOWN_TOKENS_BY_ADDRESS[tokenAddr.toLowerCase()] || {};

          const finalSymbol = override.symbol || symbolRaw || "TOKEN";
          const finalName = override.name || nameRaw || "Unknown Token";

          const logoUrl = override.logoUrl || getLogoUrlForSymbol(finalSymbol);

          const rawBal = tb.tokenBalance;
          const amount = Number(ethers.utils.formatUnits(rawBal, decimals));

          return {
            symbol: finalSymbol,
            name: finalName,
            logoUrl,
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

// Session-only unlock state (we do NOT persist decrypted seed)
const sessionUnlockedWallets = new Set(); // walletId

// ===== SEND EXECUTION STATE (Beta Native ETH Send) =====
let lastSendSafeDecision = null; // set after SendSafe run; consumed by execute

function isSupportedNativeSendNetwork(uiNet) {
  return uiNet === "ethereum-mainnet" || uiNet === "sepolia";
}

function isNativeEthHolding(h) {
  // native row uses tokenAddress:null and symbol ETH or ETH-sep
  return (
    !!h &&
    !h.tokenAddress &&
    typeof h.symbol === "string" &&
    h.symbol.toUpperCase().startsWith("ETH")
  );
}

function getExplorerTxBase(uiNet) {
  if (uiNet === "ethereum-mainnet") return "https://etherscan.io/tx/";
  if (uiNet === "sepolia") return "https://sepolia.etherscan.io/tx/";
  return null;
}

function setRunButtonLabel(text) {
  if (!runSafeSendBtn) return;
  const labelSpan = runSafeSendBtn.querySelector(".safesend-tv");
  if (labelSpan) labelSpan.textContent = text;
}

async function estimateNativeTxCost(provider, { from, to, valueWei }) {
  const txReq = { from, to, value: valueWei };

  const gasLimit = await provider.estimateGas(txReq);
  const feeData = await provider.getFeeData();

  const perGas =
    feeData.maxFeePerGas && !feeData.maxFeePerGas.isZero()
      ? feeData.maxFeePerGas
      : feeData.gasPrice;

  const estFeeWei = perGas ? gasLimit.mul(perGas) : null;
  const estTotalWei = estFeeWei ? valueWei.add(estFeeWei) : null;

  return { gasLimit, feeData, estFeeWei, estTotalWei };
}

function formatEth(ethNum) {
  if (ethNum === null || ethNum === undefined || Number.isNaN(ethNum)) return "--";
  return `${ethNum.toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH`;
}

// ===== DOM =====
const walletTopbar = document.getElementById("walletTopbar");
const walletHero = document.getElementById("walletHero");
const walletDashboard = document.getElementById("walletDashboard");
const safesendPage = document.getElementById("safesendPage");
const settingsPage = document.getElementById("settingsPage");

const walletAddressEl = document.getElementById("walletAddress");
const walletEnsNameEl = document.getElementById("walletEnsName"); // (NEW, optional)
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

// (NEW) Recipient resolution UI (ENS)
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

// (NEW) Vault export/import controls (Settings)
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

function isLegacyWallet(w) {
  // Legacy if it lacks encrypted vault data.
  return !w || !w.vault;
}

function hasPortableVault(w) {
  return !!(w && w.vault && w.vault.cipherB64 && w.vault.saltB64 && w.vault.ivB64);
}

function validatePasswordPattern(pw) {
  // Keep your existing rule: 8+, letters+numbers
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

function getSendAmountEthFromUI() {
  if (!ssSendAmountEl) return null;
  const raw = String(ssSendAmountEl.value || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/,/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
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

    // Upgrade logo URLs opportunistically
    if (Array.isArray(w.holdings)) {
      w.holdings = w.holdings.map((h) => {
        if (!h || !h.symbol) return h;
        const upgraded = getLogoUrlForSymbol(h.symbol);
        const hasKnown =
          LOGO_URLS_BY_SYMBOL[normalizeSymbol(h.symbol)] ||
          (normalizeSymbol(h.symbol).includes("-") &&
            LOGO_URLS_BY_SYMBOL[normalizeSymbol(h.symbol).split("-")[0]]);
        const isPlaceholder =
          typeof h.logoUrl === "string" && h.logoUrl.includes("via.placeholder.com");
        if (hasKnown || isPlaceholder) return { ...h, logoUrl: upgraded };
        return h;
      });
    }

    // Ensure hd metadata exists for portable wallets
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

// ===== LIVE BALANCES =====
async function refreshWalletOnChainData() {
  const wallet = getWalletById(currentWalletId);
  if (!wallet || !networkSelect) return;

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
      const erc20Holdings = await fetchAllErc20Holdings(provider, wallet.address);
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

    // Optional: show reverse ENS name for current wallet (mainnet/sepolia)
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
    const legacyTag = portable
      ? ""
      : `<div class="hint-text">Legacy (re-import seed to make portable)</div>`;

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
  if (prevAssetKey && [...ssAssetSelect.options].some((o) => o.value === prevAssetKey)) {
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
    if (ssAmountUnitEl) ssAmountUnitEl.textContent = "ETH";
    return;
  }

  ssBalanceAmountEl.textContent = `${holding.amount} ${holding.symbol}`;
  ssBalanceUsdEl.textContent = formatUsd(holding.usdValue || 0);

  if (ssAmountUnitEl) {
    ssAmountUnitEl.textContent = holding && holding.symbol ? holding.symbol : "ETH";
  }
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
  if (score === null || score === undefined || Number.isNaN(score)) return "neutral";
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
        ${
          entry.displayRecipient && entry.displayRecipient !== entry.address
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

// ===== SENDSAFE RESULT MODAL (UPDATED: gated execution) =====
function showSafesendResultModal(score) {
  if (!safesendResultModal) return;

  updateModalGauge(score);
  safesendRiskAckCheckbox.checked = false;
  safesendRiskAckRow.hidden = true;
  safesendResultButtons.innerHTML = "";

  const deny = score >= 90;
  const warn = score >= 60 && score < 90;

  if (deny) {
    safesendResultMessage.textContent =
      "DENIED: This transaction is being blocked due to elevated risk signals (sanctions, fraud patterns, or other severe indicators).";
  } else if (warn) {
    safesendResultMessage.textContent =
      "WARNING: This transaction represents a higher than normal amount of risk. If you proceed, you assume all risks. Transactions are irreversible.";
  } else {
    safesendResultMessage.textContent =
      "ALLOWED: This transaction falls within normal risk bands according to SendSafe.";
  }

  const backBtn = document.createElement("button");
  backBtn.className = "ghost-btn";
  backBtn.textContent = "Back";
  backBtn.addEventListener("click", () => closeModal(safesendResultModal));
  safesendResultButtons.appendChild(backBtn);

  if (deny) {
    const denyBtn = document.createElement("button");
    denyBtn.className = "primary-btn";
    denyBtn.textContent = "Denied";
    denyBtn.disabled = true;
    safesendResultButtons.appendChild(denyBtn);

    openModal(safesendResultModal);
    return;
  }

  const sendBtn2 = document.createElement("button");
  sendBtn2.className = "primary-btn";
  sendBtn2.textContent = "Preview & Send";
  sendBtn2.disabled = false;

  let warnChangeHandler = null;

  if (warn) {
    safesendRiskAckRow.hidden = false;
    safesendRiskAckText.textContent =
      "To proceed, you must acknowledge the warning by checking the box.";

    sendBtn2.disabled = true;
    warnChangeHandler = () => {
      sendBtn2.disabled = !safesendRiskAckCheckbox.checked;
    };
    safesendRiskAckCheckbox.addEventListener("change", warnChangeHandler);

    // Clean up handler when modal closes via back or X
    backBtn.addEventListener("click", () => {
      if (warnChangeHandler) {
        safesendRiskAckCheckbox.removeEventListener("change", warnChangeHandler);
        warnChangeHandler = null;
      }
    });

    const closeX = safesendResultModal.querySelector("[data-close-modal]");
    if (closeX) {
      closeX.addEventListener(
        "click",
        () => {
          if (warnChangeHandler) {
            safesendRiskAckCheckbox.removeEventListener("change", warnChangeHandler);
            warnChangeHandler = null;
          }
        },
        { once: true }
      );
    }
  }

  sendBtn2.addEventListener("click", async () => {
    try {
      closeModal(safesendResultModal);
      if (warnChangeHandler) {
        safesendRiskAckCheckbox.removeEventListener("change", warnChangeHandler);
        warnChangeHandler = null;
      }
      await executeNativeEthSendFromLastDecision();
    } catch (e) {
      console.error("Execute send error", e);
      alert(e && e.message ? e.message : "Unable to execute send.");
    }
  });

  safesendResultButtons.appendChild(sendBtn2);
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
        setRecipientResolutionUI({
          type: "ens",
          input: v,
          address: null,
          error: "Resolve failed.",
        });
      }
    }, 350);
  });
}

// ===== SEND EXECUTION (Native ETH only, mainnet + sepolia) =====
async function executeNativeEthSendFromLastDecision() {
  if (!lastSendSafeDecision) {
    throw new Error("No SendSafe decision found. Run SendSafe first.");
  }

  const {
    walletId,
    toAddress,
    toDisplay,
    uiNetwork,
    score,
    scoreCategory,
    amountEth,
  } = lastSendSafeDecision;

  if (!isSupportedNativeSendNetwork(uiNetwork)) {
    throw new Error(
      "Native send is enabled only for Ethereum mainnet and Sepolia in this beta step."
    );
  }

  if (score >= 90) {
    throw new Error("SendSafe denied this transaction. Execution blocked.");
  }

  const wallet = getWalletById(walletId);
  if (!wallet) throw new Error("Selected wallet is no longer available.");

  // Require unlock session for portable wallets
  if (hasPortableVault(wallet) && !sessionUnlockedWallets.has(wallet.id)) {
    openUnlockModalForWallet(wallet);
    throw new Error("Wallet is locked. Unlock it to sign and send.");
  }

  const provider = getProviderForNetwork(uiNetwork);
  if (!provider) throw new Error("RPC provider unavailable for selected network.");

  if (!Number.isFinite(amountEth) || amountEth <= 0) {
    throw new Error("Enter a valid send amount.");
  }

  let mnemonic = null;
  if (hasPortableVault(wallet)) {
    // Execution-time password entry (not persisted)
    const pw = prompt(`Enter password to sign this transaction for "${wallet.label}":`);
    if (!pw) throw new Error("Password required to sign.");
    mnemonic = await decryptMnemonicFromVault(wallet.vault, pw);
  } else {
    throw new Error(
      "Legacy wallet cannot sign transactions. Convert it by re-importing the seed to enable signing."
    );
  }

  const signer = ethers.Wallet.fromMnemonic(
    mnemonic.trim(),
    (wallet.hd && wallet.hd.path) || DEFAULT_EVM_DERIVATION_PATH
  ).connect(provider);

  const signerAddr = ethers.utils.getAddress(signer.address);
  const walletAddr = ethers.utils.getAddress(wallet.address);
  if (signerAddr !== walletAddr) {
    mnemonic = null;
    throw new Error(
      "Safety check failed: decrypted seed does not match the selected wallet address."
    );
  }

  const valueWei = ethers.utils.parseEther(String(amountEth));
  const txReq = {
    to: ethers.utils.getAddress(toAddress),
    value: valueWei,
  };

  const balanceWei = await provider.getBalance(walletAddr);
  const { gasLimit, estFeeWei, estTotalWei } = await estimateNativeTxCost(provider, {
    from: walletAddr,
    to: txReq.to,
    valueWei,
  });

  const balEth = Number(ethers.utils.formatEther(balanceWei));
  const feeEth = estFeeWei ? Number(ethers.utils.formatEther(estFeeWei)) : null;
  const totalEth = estTotalWei ? Number(ethers.utils.formatEther(estTotalWei)) : null;

  if (estTotalWei && balanceWei.lt(estTotalWei)) {
    mnemonic = null;
    throw new Error(
      `Insufficient funds. Balance: ${formatEth(balEth)}. Estimated total (amount + gas): ${formatEth(totalEth)}.`
    );
  }

  const previewLines = [
    `Network: ${uiNetwork}`,
    `From: ${walletAddr}`,
    `To: ${txReq.to}${toDisplay && toDisplay !== txReq.to ? ` (input: ${toDisplay})` : ""}`,
    `Amount: ${formatEth(amountEth)}`,
    `Estimated gas limit: ${gasLimit.toString()}`,
    `Estimated fee: ${feeEth === null ? "--" : formatEth(feeEth)}`,
    `Estimated total: ${totalEth === null ? "--" : formatEth(totalEth)}`,
    `SendSafe score: ${score}/100 (${scoreCategory})`,
  ].join("\n");

  const ok = confirm(
    `Review & confirm transaction:\n\n${previewLines}\n\nProceed to send?`
  );
  if (!ok) {
    mnemonic = null;
    return;
  }

  setRunButtonLabel("Sending…");
  if (runSafeSendBtn) runSafeSendBtn.disabled = true;

  let tx;
  try {
    tx = await signer.sendTransaction(txReq);
  } finally {
    mnemonic = null; // discard
    if (runSafeSendBtn) runSafeSendBtn.disabled = false;
    setRunButtonLabel("Sendsafe");
  }

  const explorerBase = getExplorerTxBase(uiNetwork);
  const explorerUrl = explorerBase ? `${explorerBase}${tx.hash}` : null;

  alert(
    `Transaction submitted!\n\nHash: ${tx.hash}\n${
      explorerUrl ? `\nExplorer: ${explorerUrl}` : ""
    }\n\nNote: it may take a moment to confirm.`
  );

  await refreshWalletOnChainData().catch(() => {});
}

// ===== SENDSAFE BUTTON HANDLER (UPDATED: stores decision for execution) =====
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

    const amountEth = getSendAmountEthFromUI();

    runSafeSendBtn.disabled = true;
    setRunButtonLabel("Scanning…");

    try {
      const networkValue = networkSelect ? networkSelect.value : "ethereum-mainnet";

      // Resolve ENS -> address OR validate 0x
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
          alert(
            `That ENS name didn't resolve to an address.${
              resolved.error ? " (" + resolved.error + ")" : ""
            }`
          );
        } else {
          alert("Enter a valid 0x address or an ENS name like riskxlabs.eth");
        }
        return;
      }

      const toAddressResolved = resolved.address;

      // Load tx preview (uses resolved 0x)
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
          engineResult && engineResult.error ? engineResult.error : `Risk engine error ${res.status}`;
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

      // ===== Store last decision for gated execution (Native ETH only) =====
      const networkValue2 = networkSelect ? networkSelect.value : "ethereum-mainnet";

      let selectedHolding = null;
      if (wallet && assetKey && assetKey.includes(":")) {
        const idx2 = Number(assetKey.split(":")[1]);
        selectedHolding = wallet.holdings && wallet.holdings[idx2];
      }

      if (!isNativeEthHolding(selectedHolding)) {
        alert("Beta step: Only native ETH (ETH / ETH-Sepolia) transfers are enabled right now.");
        return;
      }

      if (!isSupportedNativeSendNetwork(networkValue2)) {
        alert("Beta step: Native send is enabled only on Ethereum mainnet and Sepolia.");
        return;
      }

      if (amountEth === null) {
        alert("Enter the amount of ETH you want to send.");
        return;
      }

      lastSendSafeDecision = {
        walletId: wallet ? wallet.id : null,
        walletLabel: wallet ? wallet.label : "Unknown wallet",
        fromAddress: wallet ? wallet.address : null,
        toAddress: toAddressResolved,
        toDisplay: resolved && resolved.type === "ens" ? resolved.input : toAddressResolved,
        uiNetwork: networkValue2,
        score,
        scoreCategory: classifyScore(score),
        amountEth,
        holdingSymbol: selectedHolding ? selectedHolding.symbol : "ETH",
        createdAt: Date.now(),
      };

      showSafesendResultModal(score);
    } catch (err) {
      console.error("SendSafe error:", err);
      alert("SendSafe risk engine is temporarily unavailable. Showing no score.");
      updateRiskGauge(null);
      updateRiskHighlightsFromEngine(null);
    } finally {
      runSafeSendBtn.disabled = false;
      setRunButtonLabel("Sendsafe");
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

    // Encrypt mnemonic to vault
    let vault;
    try {
      vault = await encryptMnemonicToVault(phrase, password);
    } catch (e) {
      console.error("Vault encrypt error", e);
      alert("Unable to encrypt seed. Check browser crypto support.");
      return;
    }

    // If wallet already exists by address, just update it to portable
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

// ===== UNLOCK (portable: decrypt vault, legacy: optional fallback) =====
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
      if (wallet.password) {
        if (entered !== wallet.password) {
          if (uwPasswordErrorEl) {
            uwPasswordErrorEl.textContent = "Incorrect password.";
            uwPasswordErrorEl.removeAttribute("hidden");
          }
          return;
        }
      }
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
      iwErrorEl.textContent = `Convert wallet: paste the seed phrase for ${shorten(
        w.address,
        8,
        6
      )} to enable portability.`;
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
    v: 1,
    exportedAt: new Date().toISOString(),
    wallets: wallets.map((w) => ({
      id: w.id,
      label: w.label,
      address: w.address,
      hd: w.hd || { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 },
      vault: w.vault || null,
    })),
  };
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
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

      const incoming = data.wallets;

      incoming.forEach((iw) => {
        if (!iw || !iw.address) return;

        const existing = wallets.find(
          (w) => w.address.toLowerCase() === String(iw.address).toLowerCase()
        );
        if (existing) {
          existing.label = iw.label || existing.label;
          existing.hd =
            iw.hd || existing.hd || { path: DEFAULT_EVM_DERIVATION_PATH, accountIndex: 0 };
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
    const changeClass = item.change > 0 ? "positive" : item.change < 0 ? "negative" : "";

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

