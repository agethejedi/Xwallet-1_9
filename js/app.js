// ===== SAFETY: ethers presence =====
if (typeof ethers === "undefined") {
  alert("Crypto library failed to load. Check the ethers.js <script> tag URL.");
  throw new Error("ethers.js not loaded");
}

// ===== STORAGE KEYS =====
const LS_WALLETS_KEY = "xwallet_wallets_v1";
const SS_CURRENT_ID_KEY = "xwallet_current_wallet_id_v1";
const LS_SAFESEND_HISTORY_KEY = "xwallet_safesend_history_v1";

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

// Wallet Hub modal (popup)
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

// SafeSend page elements
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

const networkSelect = document.getElementById("networkSelect");

// ===== UTIL =====
function formatPct(p) {
  if (p === null || p === undefined) return "--";
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}

function formatUsd(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "$0.00";
  return `$${x.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
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

  // Normalize shape
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

// ===== VIEW MANAGEMENT =====
let currentView = "dashboard";

function setView(view) {
  // Wallets tab is special: always opens the Wallet Hub popup
  if (view === "wallets") {
    showWalletHub();
    return;
  }

  const hasUnlocked = !!currentWalletId;

  // If no wallet unlocked, force dashboard + hub
  if (!hasUnlocked && view !== "dashboard") {
    currentView = "dashboard";
    walletDashboard.hidden = true;
    safesendPage.hidden = true;
    updateAppVisibility(); // will show hub
    // visually keep Dashboard active
    navButtons.forEach((btn) => {
      const v = btn.dataset.view;
      btn.classList.toggle("nav-item-active", v === "dashboard");
    });
    return;
  }

  currentView = view;

  if (view === "dashboard") {
    walletDashboard.hidden = false;
    safesendPage.hidden = true;
  } else if (view === "safesend") {
    walletDashboard.hidden = true;
    safesendPage.hidden = false;
  }

  navButtons.forEach((btn) => {
    const v = btn.dataset.view;
    if (v === "wallets") return; // never mark Wallets as active
    btn.classList.toggle("nav-item-active", v === view);
  });

  updateAppVisibility();
}

// hook nav buttons
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    setView(view);
  });
});

// ===== HEADER / APP VISIBILITY =====
function setCurrentWallet(id) {
  currentWalletId = id;
  if (id) {
    sessionStorage.setItem(SS_CURRENT_ID_KEY, id);
  } else {
    sessionStorage.removeItem(SS_CURRENT_ID_KEY);
  }
  refreshHeader();
  updateAppVisibility();
  populateSafesendSelectors(); // keep dropdowns in sync
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
    walletTopbar.hidden = false;
    walletHero.hidden = false;

    // show current view
    if (currentView === "safesend") {
      safesendPage.hidden = false;
      walletDashboard.hidden = true;
    } else {
      walletDashboard.hidden = false;
      safesendPage.hidden = true;
    }

    hideWalletHub();
    if (walletsNavBtn) walletsNavBtn.classList.remove("nav-item-attention");
  } else {
    walletTopbar.hidden = true;
    walletHero.hidden = true;
    walletDashboard.hidden = true;
    safesendPage.hidden = true;
    showWalletHub();
    if (walletsNavBtn) walletsNavBtn.classList.add("nav-item-attention");
  }
}

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
      <div class="wallet-holdings" hidden>
      </div>
    `;

    const holdingsContainer = card.querySelector(".wallet-holdings");

    // Header row: Asset | Amount | Value (USD) | 24h Change | Action
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
  // Close menus if clicked outside
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
  const holding = wallet && wallet.holdings[index];

  if (!wallet || !holding) return;

  if (action === "safesend") {
    startSafeSendForHolding(wallet, holding);
  } else {
    console.log(`TODO: ${action} for`, wallet.label, holding.symbol);
  }
});

// ===== SAFE SEND PAGE HELPERS =====
function populateSafesendSelectors() {
  if (!ssWalletSelect || !ssAssetSelect) return;

  // Remember previous selections (if any)
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

  // restore selection if possible
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

function startSafeSendForHolding(wallet, holding) {
  // Switch view
  setView("safesend");

  // Ensure dropdowns are populated
  populateSafesendSelectors();

  // Select the wallet & asset in dropdowns
  if (ssWalletSelect) {
    ssWalletSelect.value = wallet.id;
    const holdingIndex = (wallet.holdings || []).findIndex(
      (h) => h.symbol === holding.symbol && h.name === holding.name
    );
    const key =
      holdingIndex >= 0 ? `${wallet.id}:${holdingIndex}` : `${wallet.id}:0`;
    populateAssetsForWallet(wallet.id, key);
  }

  // Clear / focus recipient input
  if (recipientInput) {
    recipientInput.focus();
  }
}

// ===== SAFE SEND SCORE / HISTORY (stub) =====
function classifyScore(score) {
  if (score === null || score === undefined) return "neutral";
  if (score >= 80) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

function updateRiskGauge(score) {
  if (!riskGaugeLabel || !safesendScoreBadge) return;

  if (score === null) {
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

  // simple highlight list (stub)
  if (riskHighlightsList) {
    riskHighlightsList.innerHTML = "";
    const li = document.createElement("li");
    li.textContent =
      level === "good"
        ? "No obvious red flags detected (stub scoring)."
        : level === "warn"
        ? "Some moderate risk indicators (stub scoring)."
        : level === "bad"
        ? "High-risk pattern detected (stub scoring)."
        : "Awaiting SafeSend check.";
    riskHighlightsList.appendChild(li);
  }
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
  runSafeSendBtn.addEventListener("click", () => {
    const address = (recipientInput && recipientInput.value.trim()) || "";
    if (!address) {
      alert("Paste a recipient address or ENS first.");
      return;
    }

    const walletId = ssWalletSelect ? ssWalletSelect.value : null;
    const assetKey = ssAssetSelect ? ssAssetSelect.value : null;
    const wallet = walletId && getWalletById(walletId);

    let assetSymbol = "";
    if (wallet && assetKey && assetKey.includes(":")) {
      const idx = Number(assetKey.split(":")[1]);
      const holding = wallet.holdings[idx];
      if (holding) assetSymbol = holding.symbol;
    }

    // Stub: random-ish score for now; engine will override later
    const score = Math.floor(60 + Math.random() * 35); // 60–94
    const scoreCategory = classifyScore(score);

    // Look for previous entry for this address
    const previous = safesendHistory.find(
      (e) => e.address.toLowerCase() === address.toLowerCase()
    );
    let alertText = "";
    if (previous && previous.score !== score) {
      alertText = `Score changed from ${previous.score} to ${score}.`;
    }

    const entry = {
      address,
      walletLabel: wallet ? wallet.label : "Unknown wallet",
      assetSymbol: assetSymbol || "Unknown asset",
      score,
      scoreCategory,
      alertText,
      timestamp: Date.now()
    };
    safesendHistory.push(entry);
    saveSafesendHistory();
    renderSafesendHistory();
    updateRiskGauge(score);
  });
}

if (clearSafesendHistoryBtn) {
  clearSafesendHistoryBtn.addEventListener("click", () => {
    if (!confirm("Clear all SafeSend history on this device?")) return;
    safesendHistory = [];
    saveSafesendHistory();
    renderSafesendHistory();
    updateRiskGauge(null);
  });
}

// ===== MODAL HELPERS =====
function openModal(el) {
  el.removeAttribute("hidden");
}

function closeModal(el) {
  el.setAttribute("hidden", "");
}

// Close modals on backdrop / close buttons
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
    holdings: []
  });

  saveWallets();
  closeModal(createWalletModal);
  renderWallets();
  setCurrentWallet(id);
});

// ===== IMPORT / UNLOCK BY SEED (with optional password) =====
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
        holdings: []
      };
      wallets.push(existing);
      saveWallets();
    } else if (password) {
      // Optionally update password if provided
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

// ===== UNLOCK BY PASSWORD (Wallet Hub -> Unlock modal) =====
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

  // Success
  pendingUnlockWalletId = null;
  closeModal(unlockWalletModal);
  setCurrentWallet(wallet.id);
  renderWallets();
});

// ===== NETWORK SELECT (STUB) =====
if (networkSelect) {
  networkSelect.addEventListener("change", (e) => {
    console.log("Change network (UI only):", e.target.value);
  });
}

// ===== INIT =====
loadWallets();
loadSafesendHistory();

// Seed demo wallet if none exist (for visual testing)
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
          tokenAddress: null
        },
        {
          symbol: "USDC",
          name: "USD Coin",
          logoUrl: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=032",
          amount: 100,
          usdValue: 100,
          change24hPct: 0.0,
          tokenAddress: "0x..."
        }
      ]
    }
  ];
  saveWallets();
}

renderWallets();
renderSafesendHistory();
updateRiskGauge(null);
setView("dashboard");
