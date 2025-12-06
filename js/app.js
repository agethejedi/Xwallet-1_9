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

// Known tokens (for nicer names/logos on top of generic ERC-20 metadata)
const KNOWN_TOKENS_BY_ADDRESS = {
  // PYUSD mainnet
  "0x6c3ea9036406852006290770bedfcaba0e23a0e8": {
    symbol: "PYUSD",
    name: "PayPal USD",
    logoUrl: "https://cryptologos.cc/logos/paypal-usd-pyusd-logo.png?v=032",
  },
  // PYUSD Sepolia
  "0xcac5ca27d96c219bdcdc823940b66ebd4ff4c7f1": {
    symbol: "PYUSD-sep",
    name: "PYUSD (Sepolia)",
    logoUrl: "https://cryptologos.cc/logos/paypal-usd-pyusd-logo.png?v=032",
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
          const logoUrl =
            override.logoUrl ||
            "https://via.placeholder.com/32?text=" +
              encodeURIComponent(finalSymbol[0] || "T");

          const rawBal = tb.tokenBalance;
          const amount = Number(ethers.utils.formatUnits(rawBal, decimals));

          return {
            symbol: finalSymbol,
            name: finalName,
            logoUrl,
            amount,
            // For now, treat 1 token unit as 1 "USD-ish" value in this prototype.
            // Stablecoins (USDC, PYUSD, etc.) will be roughly correct; others are placeholders.
            usdValue: amount,
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
  } catch {
    // ignore
  }
  return DEFAULT_TICKER_SYMBOLS.slice();
}

function saveTickerSymbols(symbols) {
  tickerSymbols = symbols.slice();
  localStorage.setItem(LS_TICKER_ASSETS_KEY, JSON.stringify(tickerSymbols));
}

// ===== LIVE BALANCES (Alchemy) =====
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
    console.warn(
      "No provider for network",
      uiNet,
      "- did you set ALCHEMY_API_KEY?"
    );
    return;
  }

  if (networkStatusPill) {
    networkStatusPill.textContent = "RPC: CONNECTING…";
  }

  try {
    const holdings = [];

    // 1) Native ETH balance
    const rawEth = await provider.getBalance(wallet.address);
    const eth = Number(ethers.utils.formatEther(rawEth));
    const isSepolia = uiNet === "sepolia";

    holdings.push({
      symbol: isSepolia ? "ETH-sep" : "ETH",
      name: isSepolia ? "Ethereum (Sepolia)" : "Ethereum",
      logoUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=032",
      amount: eth,
      // For now we treat 1 ETH = 1 "USD unit" in this prototype. Later this can hook into live prices.
      usdValue: eth,
      change24hPct: 0,
      tokenAddress: null,
    });

    // 2) All ERC-20s (including PYUSD) via Alchemy
    const erc20Holdings = await fetchAllErc20Holdings(provider, wallet.address);
    erc20Holdings.forEach((h) => holdings.push(h));

    // Aggregate total "USD" value
    let totalUsd = 0;
    for (const h of holdings) {
      totalUsd += h.usdValue || 0;
    }

    wallet.totalUsd = totalUsd;
    wallet.change24hPct = 0;
    wallet.holdings = holdings;

    saveWallets();
    renderWallets();

    if (networkStatusPill) {
      networkStatusPill.textContent = "RPC: CONNECTED";
      networkStatusPill.className = "status-pill status-pill-good";
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
    walletAddressEl.textContent = "No wallet selected";
    fiatBalanceLabelEl.textContent = "$0.00";
    return;
  }
  walletAddressEl.textContent = wallet.address;
  fiatBalanceLabelEl.textContent = formatUsd(wallet.totalUsd || 0);
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
  if (id) {
    sessionStorage.setItem(SS_CURRENT_ID_KEY, id);
  } else {
    sessionStorage.removeItem(SS_CURRENT_ID_KEY);
  }
  refreshHeader();
  updateAppVisibility();
  populateSafesendSelectors();
  renderWalletSettingsUI();
  if (refreshOnChain) {
    refreshWalletOnChainData();
  }
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
    const row = document.createElement("div");
    row.className = "wallet-gate-list-item";
    row.innerHTML = `
      <div>
        <div>${w.label}</div>
        <div class="wallet-address">${w.address}</div>
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
      const row = document.createElement("div");
      row.className = "holding-row";
      row.dataset.walletId = wallet.id;
      row.dataset.holdingIndex = index;
      row.innerHTML = `
        <div class="holding-asset-logo">
          <img src="${h.logoUrl}" alt="${h.symbol}" />
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

  fiatBalanceLabelEl.textContent = formatUsd(total);
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

  const reasons = Array.isArray(engineResult.reasons)
    ? engineResult.reasons
    : [];

  const impacts = Array.isArray(engineResult.explain?.factorImpacts)
    ? engineResult.explain.factorImpacts
    : [];

  let bullets = reasons.slice();
  if (!bullets.length && impacts.length) {
    bullets = impacts
      .filter((f) => f.delta > 0)
      .map((f) => f.label);
  }

  if (!bullets.length) {
    const li = document.createElement("li");
    li.textContent =
      "No major risk factors flagged by the SendSafe engine.";
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
        <div class="safesend-history-address">${entry.address}</div>
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

    // Recipient column
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
          <span class="safesend-tx-amount">${
            tx.value && tx.value !== "0" ? tx.value : ""
          }</span>
        `;
        recipCol.appendChild(row);
      });
    } else {
      const empty = document.createElement("div");
      empty.className = "hint-text";
      empty.textContent = "No recent tx for recipient.";
      recipCol.appendChild(empty);
    }

    // Sender column
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
          <span class="safesend-tx-amount">${
            tx.value && tx.value !== "0" ? tx.value : ""
          }</span>
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

// ===== SENDSAFE BUTTON HANDLER =====
if (runSafeSendBtn) {
  runSafeSendBtn.addEventListener("click", async () => {
    const address = (recipientInput && recipientInput.value.trim()) || "";
    if (!address) {
      alert("Paste a recipient address first.");
      return;
    }

    if (!address.toLowerCase().startsWith("0x")) {
      alert(
        "The current SendSafe engine works with 0x EVM addresses only. ENS / Tron support will come later."
      );
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
      const networkValue = networkSelect
        ? networkSelect.value
        : "ethereum-mainnet";

      loadRecentTransactions(
        wallet ? wallet.address : null,
        address,
        networkValue
      );

      const payload = {
        network: mapNetworkForRiskEngine(networkValue),
        toAddress: address,
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
        (e) => e.address.toLowerCase() === address.toLowerCase()
      );
      let alertText = "";
      if (previous && previous.score !== score) {
        alertText = `Score changed from ${previous.score} to ${score}.`;
      }

      const scoreCategory = classifyScore(score);
      const entry = {
        address,
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
      alert(
        "SendSafe risk engine is temporarily unavailable. Showing no score."
      );
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

// ===== CREATE WALLET =====
function createNewWallet() {
  try {
    const wallet = ethers.Wallet.createRandom();
    const phrase = wallet.mnemonic && wallet.mnemonic.phrase;

    cwLabelEl.value = "New wallet";
    cwMnemonicEl.value = phrase || "";
    cwAddressEl.textContent = wallet.address;

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

cwConfirmBtn.addEventListener("click", () => {
  const label = cwLabelEl.value.trim() || "New wallet";
  const phrase = cwMnemonicEl.value.trim();
  const address = cwAddressEl.textContent.trim();
  const password = cwPasswordEl ? cwPasswordEl.value.trim() : "";

  if (!phrase || !address) {
    alert("Seed phrase or address missing.");
    return;
  }

  if (cwPasswordErrorEl) {
    cwPasswordErrorEl.textContent = "";
    cwPasswordErrorEl.setAttribute("hidden", "");
  }

  if (password) {
    const validPattern = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!validPattern.test(password)) {
      if (cwPasswordErrorEl) {
        cwPasswordErrorEl.textContent =
          "Password must be at least 8 characters and include letters and numbers.";
        cwPasswordErrorEl.removeAttribute("hidden");
      } else {
        alert(
          "Password must be at least 8 characters and include letters and numbers."
        );
      }
      return;
    }
  }

  const id = `wallet_${Date.now()}`;
  wallets.push({
    id,
    label,
    address,
    password: password || null,
    totalUsd: 0,
    change24hPct: 0,
    holdings: [],
  });

  saveWallets();
  closeModal(createWalletModal);
  renderWallets();
  setCurrentWallet(id, { refreshOnChain: true });
});

// ===== IMPORT / UNLOCK BY SEED =====
function openImportModal() {
  if (!importWalletModal) return;
  iwLabelEl.value = "";
  iwMnemonicEl.value = "";
  iwErrorEl.textContent = "";
  iwErrorEl.setAttribute("hidden", "");

  if (iwPasswordEl) iwPasswordEl.value = "";
  if (iwPasswordErrorEl) {
    iwPasswordErrorEl.textContent = "";
    iwPasswordErrorEl.setAttribute("hidden", "");
  }

  openModal(importWalletModal);
}

if (importWalletBtn) importWalletBtn.addEventListener("click", openImportModal);
if (hubImportBtn) hubImportBtn.addEventListener("click", openImportModal);

iwImportBtn.addEventListener("click", () => {
  const label = iwLabelEl.value.trim() || "Imported wallet";
  const phrase = iwMnemonicEl.value.trim().toLowerCase();
  const password = iwPasswordEl ? iwPasswordEl.value.trim() : "";

  iwErrorEl.textContent = "";
  iwErrorEl.setAttribute("hidden", "");
  if (iwPasswordErrorEl) {
    iwPasswordErrorEl.textContent = "";
    iwPasswordErrorEl.setAttribute("hidden", "");
  }

  if (!phrase) {
    iwErrorEl.textContent = "Seed phrase is required.";
    iwErrorEl.removeAttribute("hidden");
    return;
  }
  const words = phrase.split(/\s+/);
  if (words.length !== 12 && words.length !== 24) {
    iwErrorEl.textContent = "Seed phrase must be 12 or 24 words.";
    iwErrorEl.removeAttribute("hidden");
    return;
  }

  if (password) {
    const validPattern = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
    if (!validPattern.test(password)) {
      if (iwPasswordErrorEl) {
        iwPasswordErrorEl.textContent =
          "Password must be at least 8 characters and include letters and numbers.";
        iwPasswordErrorEl.removeAttribute("hidden");
      } else {
        alert(
          "Password must be at least 8 characters and include letters and numbers."
        );
      }
      return;
    }
  }

  try {
    if (!ethers.utils.isValidMnemonic(phrase)) {
      throw new Error("Invalid mnemonic");
    }
    const hd = ethers.utils.HDNode.fromMnemonic(phrase);
    const derivedWallet = new ethers.Wallet(hd.privateKey);
    const addr = derivedWallet.address;

    let existing = wallets.find(
      (w) => w.address.toLowerCase() === addr.toLowerCase()
    );
    if (!existing) {
      const id = `wallet_${Date.now()}`;
      existing = {
        id,
        label,
        address: addr,
        password: password || null,
        totalUsd: 0,
        change24hPct: 0,
        holdings: [],
      };
      wallets.push(existing);
      saveWallets();
    } else if (password) {
      existing.password = password;
      saveWallets();
    }

    closeModal(importWalletModal);
    renderWallets();
    setCurrentWallet(existing.id, { refreshOnChain: true });
  } catch (err) {
    console.error("Import error", err);
    iwErrorEl.textContent =
      "That seed phrase could not be imported. Please double-check the words.";
    iwErrorEl.removeAttribute("hidden");
  }
});

// ===== UNLOCK BY PASSWORD =====
function openUnlockModalForWallet(wallet) {
  pendingUnlockWalletId = wallet.id;
  uwLabelEl.textContent = wallet.label;
  uwAddressEl.textContent = wallet.address;
  uwPasswordEl.value = "";
  uwPasswordErrorEl.textContent = "";
  uwPasswordErrorEl.setAttribute("hidden", "");
  openModal(unlockWalletModal);
}

document.addEventListener("click", (e) => {
  const unlockBtn = e.target.closest("[data-gate-unlock]");
  if (!unlockBtn) return;

  const walletId = unlockBtn.dataset.gateUnlock;
  const wallet = getWalletById(walletId);
  if (!wallet) return;

  if (!wallet.password) {
    alert(
      "This wallet does not have a password set. Use 'Import with 12-word seed' to recover it, then set a password."
    );
    return;
  }

  openUnlockModalForWallet(wallet);
});

uwConfirmBtn.addEventListener("click", () => {
  if (!pendingUnlockWalletId) return;
  const wallet = getWalletById(pendingUnlockWalletId);
  if (!wallet) {
    pendingUnlockWalletId = null;
    closeModal(unlockWalletModal);
    return;
  }

  const entered = uwPasswordEl.value.trim();
  uwPasswordErrorEl.textContent = "";
  uwPasswordErrorEl.setAttribute("hidden", "");

  if (!entered) {
    uwPasswordErrorEl.textContent = "Password is required.";
    uwPasswordErrorEl.removeAttribute("hidden");
    return;
  }

  if (entered !== wallet.password) {
    uwPasswordErrorEl.textContent = "Incorrect password.";
    uwPasswordErrorEl.removeAttribute("hidden");
    return;
  }

  pendingUnlockWalletId = null;
  closeModal(unlockWalletModal);
  setCurrentWallet(wallet.id, { refreshOnChain: true });
  renderWallets();
});

// ===== NETWORK / TOPBAR BUTTONS =====
if (networkSelect) {
  networkSelect.addEventListener("change", (e) => {
    console.log("Network changed to:", e.target.value);
    refreshWalletOnChainData();
  });
}

if (copyAddressBtn) {
  copyAddressBtn.addEventListener("click", async () => {
    const text = walletAddressEl.textContent || "";
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

// ===== SETTINGS: WALLET LABELS =====
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
    row.innerHTML = `
      <div class="wallet-settings-address">${shorten(w.address, 10, 6)}</div>
      <input
        class="input wallet-label-input"
        data-wallet-id="${w.id}"
        value="${w.label}"
      />
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
      if (checkbox.checked) {
        newSymbols.add(asset.symbol);
      } else {
        newSymbols.delete(asset.symbol);
      }

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

// ===== TICKER: DATA =====
function getTickerAssetConfigForSymbols(symbols) {
  const bySymbol = new Map(AVAILABLE_TICKER_ASSETS.map((a) => [a.symbol, a]));
  return symbols
    .map((sym) => bySymbol.get(sym))
    .filter((a) => !!a);
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
      return {
        symbol: cfg.symbol,
        label: cfg.label,
        price,
        change,
      };
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
loadWallets();
loadSafesendHistory();
tickerSymbols = loadTickerSymbols();

if (!wallets.length) {
  wallets = [
    {
      id: "demo",
      label: "Demo wallet",
      address: "0x1234...ABCD",
      password: null,
      totalUsd: 1234.56,
      change24hPct: 1.2,
      holdings: [
        {
          symbol: "ETH",
          name: "Ethereum",
          logoUrl: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=032",
          amount: 0.5,
          usdValue: 950,
          change24hPct: 2.5,
          tokenAddress: null,
        },
        {
          symbol: "USDC",
          name: "USD Coin",
          logoUrl: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=032",
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
