// app.js — X-Wallet UI + SafeSend wired to Risk Engine

// ===== SAFETY: ethers presence =====
if (typeof ethers === "undefined") {
  alert("Crypto library failed to load. Check the ethers.js <script> tag URL.");
  throw new Error("ethers.js not loaded");
}

// ===== STORAGE KEYS =====
const LS_WALLETS_KEY = "xwallet_wallets_v1";
const SS_CURRENT_ID_KEY = "xwallet_current_wallet_id_v1";
const LS_SAFESEND_HISTORY_KEY = "xwallet_safesend_history_v1";

// ===== RISK ENGINE CONFIG =====
const RISK_ENGINE_BASE_URL = "https://riskxlabs-vision-api.agedotcom.workers.dev/"; // <-- CHANGE THIS

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

// ===== STATE =====
let wallets = [];
let currentWalletId = null;
let pendingUnlockWalletId = null;
let safesendHistory = [];

// ===== DOM ELEMENTS =====
const walletTopbar = document.getElementById("walletTopbar");
const walletHero = document.getElementById("walletHero");
const walletDashboard = document.getElementById("walletDashboard");
const safesendPage = document.getElementById("safesendPage");

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

// Wallet Hub popup
const walletHubModal = document.getElementById("walletHubModal");
const gateWalletList = document.getElementById("gateWalletList");
const hubCreateBtn = document.getElementById("hubCreateBtn");
const hubImportBtn = document.getElementById("hubImportBtn");

// Create wallet modal
const createWalletModal = document.getElementById("createWalletModal");
const cwMnemonicEl = document.getElementById("cwMnemonic");
const cwAddressEl = document.getElementById("cwAddress");
const cwLabelEl = document.getElementById("cwLabel");
const cwConfirmBtn = document.getElementById("cwConfirmBtn");
const cwPasswordEl = document.getElementById("cwPassword");
const cwPasswordErrorEl = document.getElementById("cwPasswordError");

// Import wallet modal
const importWalletModal = document.getElementById("importWalletModal");
const iwLabelEl = document.getElementById("iwLabel");
const iwMnemonicEl = document.getElementById("iwMnemonic");
const iwPasswordEl = document.getElementById("iwPassword");
const iwPasswordErrorEl = document.getElementById("iwPasswordError");
const iwErrorEl = document.getElementById("iwError");
const iwImportBtn = document.getElementById("iwImportBtn");

// Unlock wallet modal
const unlockWalletModal = document.getElementById("unlockWalletModal");
const uwLabelEl = document.getElementById("uwLabel");
const uwAddressEl = document.getElementById("uwAddress");
const uwPasswordEl = document.getElementById("uwPassword");
const uwPasswordErrorEl = document.getElementById("uwPasswordError");
const uwConfirmBtn = document.getElementById("uwConfirmBtn");

// SafeSend page
const ssWalletSelect = document.getElementById("ssWalletSelect");
const ssAssetSelect = document.getElementById("ssAssetSelect");
const safesendScoreBadge = document.getElementById("safesendScoreBadge");
const riskGaugeDial = document.getElementById("riskGaugeDial");
const riskGaugeLabel = document.getElementById("riskGaugeLabel");
const riskHighlightsList = document.getElementById("riskHighlightsList");
const recipientInput = document.getElementById("recipientInput");
const runSafeSendBtn = document.getElementById("runSafeSendBtn");
const clearSafesendHistoryBtn = document.getElementById(
  "clearSafesendHistoryBtn"
);
const safesendHistoryList = document.getElementById("safesendHistoryList");
const viewFullReportBtn = document.getElementById("viewFullReportBtn");

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
  localStorage.setItem(
    LS_SAFESEND_HISTORY_KEY,
    JSON.stringify(safesendHistory)
  );
}

function getWalletById(id) {
  return wallets.find((w) => w.id === id);
}

// ===== VIEW MANAGEMENT =====
let currentView = "dashboard";

function setCurrentWallet(id) {
  currentWalletId = id;
  if (id) {
    sessionStorage.setItem(SS_CURRENT_ID_KEY, id);
  } else {
    sessionStorage.removeItem(SS_CURRENT_ID_KEY);
  }
  refreshHeader();
  updateAppVisibility();
  populateSafesendSelectors();
}

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

    showWalletHub();
    if (walletsNavBtn) walletsNavBtn.classList.add("nav-item-attention");
  }
}

function setView(view) {
  // Wallets nav: open wallet hub popup
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

  if (!hasUnlocked) {
    updateAppVisibility();
    return;
  }

  if (view === "safesend" && safesendPage) {
    safesendPage.hidden = false;
    safesendPage.classList.add("active-view");
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

// ===== WALLET HUB POPUP =====
function updateWalletHubList() {
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
              <span class="safesend-tv">SafeSend</span>
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
}

// Expand / collapse wallet
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

  setCurrentWallet(card.dataset.walletId);
});

// Action menu + SafeSend trigger
document.addEventListener("click", (e) => {
  // Close menus if clicked outside actions
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

// ===== SAFE SEND SELECTORS =====
function populateSafesendSelectors() {
  if (!ssWalletSelect || !ssAssetSelect) return;

  const prevWalletId = ssWalletSelect.value || currentWalletId;
  const prevAssetKey = ssAssetSelect.value;

  ssWalletSelect.innerHTML = "";
  ssAssetSelect.innerHTML = "";

  if (!wallets.length) {
    ssWalletSelect.innerHTML = `<option value="">No wallets yet</option>`;
    ssAssetSelect.innerHTML = `<option value="">No holdings</option>`;
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
    return;
  }

  wallet.holdings.forEach((h, index) => {
    const key = `${wallet.id}:${index}`;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${h.symbol} — ${h.name}`;
    ssAssetSelect.appendChild(opt);
  });

  if (prevAssetKey && [...ssAssetSelect.options].some((o) => o.value === prevAssetKey)) {
    ssAssetSelect.value = prevAssetKey;
  } else {
    ssAssetSelect.value = `${wallet.id}:0`;
  }
}

if (ssWalletSelect) {
  ssWalletSelect.addEventListener("change", (e) => {
    populateAssetsForWallet(e.target.value, null);
  });
}

// Route into SafeSend for a given wallet/holding index
function goToSafeSend(walletId, holdingIndex) {
  setView("safesend");
  populateSafesendSelectors();

  if (ssWalletSelect) {
    ssWalletSelect.value = walletId;
    const key = `${walletId}:${holdingIndex}`;
    populateAssetsForWallet(walletId, key);
  }

  if (recipientInput) {
    recipientInput.focus();
  }
}

// ===== SAFE SEND SCORE / HISTORY =====
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
  else if (level === "warn")
    safesendScoreBadge.classList.add("risk-badge-warn");
  else if (level === "bad")
    safesendScoreBadge.classList.add("risk-badge-bad");
  else safesendScoreBadge.classList.add("risk-badge-neutral");
}

function updateRiskHighlightsFromEngine(engineResult) {
  if (!riskHighlightsList) return;
  riskHighlightsList.innerHTML = "";

  if (!engineResult) {
    const li = document.createElement("li");
    li.textContent = "Awaiting SafeSend check.";
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
      "No major risk factors flagged by the SafeSend engine.";
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
      '<div class="safesend-history-main"><div class="safesend-history-meta">No SafeSend checks yet.</div></div>';
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

if (runSafeSendBtn) {
  runSafeSendBtn.addEventListener("click", async () => {
    const address = (recipientInput && recipientInput.value.trim()) || "";
    if (!address) {
      alert("Paste a recipient address or ENS first.");
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
    runSafeSendBtn.textContent = "Running...";

    try {
      const networkValue = networkSelect
        ? networkSelect.value
        : "ethereum-mainnet";

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

      if (!res.ok) {
        throw new Error(`Risk engine HTTP ${res.status}`);
      }

      const engineResult = await res.json();
      const score =
        engineResult.score ?? engineResult.risk_score ?? null;

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
    } catch (err) {
      console.error("SafeSend error:", err);
      alert(
        "SafeSend risk engine is temporarily unavailable. Showing no score."
      );
      updateRiskGauge(null);
      updateRiskHighlightsFromEngine(null);
    } finally {
      runSafeSendBtn.disabled = false;
      runSafeSendBtn.textContent = "Run SafeSend";
    }
  });
}

if (clearSafesendHistoryBtn) {
  clearSafesendHistoryBtn.addEventListener("click", () => {
    if (!confirm("Clear all SafeSend history on this device?")) return;
    safesendHistory = [];
    saveSafesendHistory();
    renderSafesendHistory();
    updateRiskGauge(null);
    updateRiskHighlightsFromEngine(null);
  });
}

// ===== MODAL HELPERS =====
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

// ===== CREATE WALLET FLOW =====
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
  setCurrentWallet(id);
});

// ===== IMPORT / UNLOCK BY SEED =====
function openImportModal() {
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
    setCurrentWallet(existing.id);
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
  setCurrentWallet(wallet.id);
  renderWallets();
});

// ===== NETWORK SELECT (stub) =====
if (networkSelect) {
  networkSelect.addEventListener("change", (e) => {
    console.log("Change network (UI only):", e.target.value);
  });
}

// Copy address
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

// Switch account (simple: open Wallet Hub)
if (switchAccountBtn) {
  switchAccountBtn.addEventListener("click", () => {
    showWalletHub();
  });
}

// Send button → SafeSend for current wallet
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

// ===== INIT =====
loadWallets();
loadSafesendHistory();

// Seed a demo wallet if there are none (for visual testing)
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
          logoUrl:
            "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=032",
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
setView("dashboard");
