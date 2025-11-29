if (typeof ethers === "undefined") {
  alert("Crypto library failed to load. Check the ethers.js <script> tag URL.");
  throw new Error("ethers.js not loaded");
}

// ========= STORAGE KEYS =========
const LS_WALLETS_KEY = "xwallet_wallets_v1";
const SS_CURRENT_ID_KEY = "xwallet_current_wallet_id_v1";

// ========= STATE =========
let wallets = [];
let currentWalletId = null;

// ========= ELEMENTS =========
const walletGate = document.getElementById("walletGate");
const gateWalletList = document.getElementById("gateWalletList");
const gateCreateBtn = document.getElementById("gateCreateBtn");
const gateImportBtn = document.getElementById("gateImportBtn");

const walletTopbar = document.getElementById("walletTopbar");
const walletHero = document.getElementById("walletHero");
const walletDashboard = document.getElementById("walletDashboard");

const walletAddressEl = document.getElementById("walletAddress");
const fiatBalanceLabelEl = document.getElementById("fiatBalanceLabel");
const walletsContainer = document.getElementById("walletsContainer");

const createWalletBtn = document.getElementById("createWalletBtn");
const importWalletBtn = document.getElementById("importWalletBtn");

const createWalletModal = document.getElementById("createWalletModal");
const importWalletModal = document.getElementById("importWalletModal");

const cwMnemonicEl = document.getElementById("cwMnemonic");
const cwAddressEl = document.getElementById("cwAddress");
const cwLabelEl = document.getElementById("cwLabel");
const cwConfirmBtn = document.getElementById("cwConfirmBtn");

const iwLabelEl = document.getElementById("iwLabel");
const iwMnemonicEl = document.getElementById("iwMnemonic");
const iwErrorEl = document.getElementById("iwError");
const iwImportBtn = document.getElementById("iwImportBtn");

// ========= UTIL =========
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

function loadWallets() {
  try {
    const raw = localStorage.getItem(LS_WALLETS_KEY);
    wallets = raw ? JSON.parse(raw) : [];
  } catch {
    wallets = [];
  }

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

function setCurrentWallet(id) {
  currentWalletId = id;
  if (id) {
    sessionStorage.setItem(SS_CURRENT_ID_KEY, id);
  } else {
    sessionStorage.removeItem(SS_CURRENT_ID_KEY);
  }
  refreshHeader();
  updateGateVisibility();
}

function getWalletById(id) {
  return wallets.find((w) => w.id === id);
}

// ========= GATE & DASHBOARD TOGGLING =========

function updateGateWalletList() {
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
        Unlock with seed
      </button>
    `;
    gateWalletList.appendChild(row);
  });
}

function updateGateVisibility() {
  const hasUnlocked = !!currentWalletId;
  if (hasUnlocked) {
    walletGate.hidden = true;
    walletTopbar.hidden = false;
    walletHero.hidden = false;
    walletDashboard.hidden = false;
  } else {
    walletGate.hidden = false;
    walletTopbar.hidden = true;
    walletHero.hidden = true;
    walletDashboard.hidden = true;
  }
  updateGateWalletList();
}

// ========= RENDER WALLET DASHBOARD =========

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

function renderWallets() {
  walletsContainer.innerHTML = "";
  wallets.forEach((wallet) => {
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
        <div class="holding-row holding-row-header">
          <span>Asset</span>
          <span></span>
          <span>Amount</span>
          <span>Value (USD)</span>
          <span>24h Change</span>
          <span>Action</span>
        </div>
      </div>
    `;

    const holdingsContainer = card.querySelector(".wallet-holdings");
    (wallet.holdings || []).forEach((h, index) => {
      const row = document.createElement("div");
      const hChangeClass =
        h.change24hPct > 0 ? "positive" : h.change24hPct < 0 ? "negative" : "";
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

  refreshHeader();
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

// Action menu handling
document.addEventListener("click", (e) => {
  // Close menus when clicking outside
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

  const holdingRow = actionContainer.closest(".holding-row");
  const walletId = holdingRow.dataset.walletId;
  const index = Number(holdingRow.dataset.holdingIndex);
  const wallet = getWalletById(walletId);
  const holding = wallet && wallet.holdings[index];

  menu.setAttribute("hidden", "");

  if (!wallet || !holding) return;

  if (action === "safesend") {
    startSafeSendForHolding(wallet, holding);
  } else {
    console.log(`TODO: ${action} for`, wallet.label, holding.symbol);
  }
});

// ===== SAFE SEND HOOK =====
function startSafeSendForHolding(wallet, holding) {
  console.log("SafeSend for", wallet.label, holding.symbol);
  // Plug this into your existing send / SafeSend flow:
  // openSendModal({ fromWalletId: wallet.id, assetSymbol: holding.symbol, tokenAddress: holding.tokenAddress });
}

// ===== MODAL HELPERS =====
function openModal(el) {
  el.removeAttribute("hidden");
}

function closeModal(el) {
  el.setAttribute("hidden", "");
}

document.addEventListener("click", (e) => {
  if (e.target.matches("[data-close-modal]")) {
    const modal = e.target.closest(".modal");
    if (modal) closeModal(modal);
  }
});

// ===== CREATE WALLET FLOW =====
createWalletBtn.addEventListener("click", () => {
  createNewWallet();
});
gateCreateBtn.addEventListener("click", () => {
  createNewWallet();
});

function createNewWallet() {
  try {
    const wallet = ethers.Wallet.createRandom();
    const phrase = wallet.mnemonic && wallet.mnemonic.phrase;
    cwLabelEl.value = "New wallet";
    cwMnemonicEl.value = phrase || "";
    cwAddressEl.textContent = wallet.address;
    openModal(createWalletModal);
  } catch (err) {
    console.error("Create wallet error", err);
    alert("Unable to create wallet.");
  }
}

cwConfirmBtn.addEventListener("click", () => {
  const label = cwLabelEl.value.trim() || "New wallet";
  const phrase = cwMnemonicEl.value.trim();
  const address = cwAddressEl.textContent.trim();

  if (!phrase || !address) {
    alert("Seed phrase or address missing.");
    return;
  }
  const id = `wallet_${Date.now()}`;
  wallets.push({
    id,
    label,
    address,
    totalUsd: 0,
    change24hPct: 0,
    holdings: []
  });
  saveWallets();
  closeModal(createWalletModal);
  renderWallets();
  setCurrentWallet(id);
});

// ===== IMPORT / UNLOCK WALLET =====
importWalletBtn.addEventListener("click", () => openImport());
gateImportBtn.addEventListener("click", () => openImport());

function openImport() {
  iwLabelEl.value = "";
  iwMnemonicEl.value = "";
  iwErrorEl.textContent = "";
  iwErrorEl.setAttribute("hidden", "");
  openModal(importWalletModal);
}

iwImportBtn.addEventListener("click", () => {
  const label = iwLabelEl.value.trim() || "Imported wallet";
  const phrase = iwMnemonicEl.value.trim().toLowerCase();

  iwErrorEl.textContent = "";
  iwErrorEl.setAttribute("hidden", "");

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

  try {
    if (!ethers.utils.isValidMnemonic(phrase)) {
      throw new Error("Invalid mnemonic");
    }
    const hd = ethers.utils.HDNode.fromMnemonic(phrase);
    const derivedWallet = new ethers.Wallet(hd.privateKey);
    const addr = derivedWallet.address;

    // See if wallet already exists (unlock case)
    let existing = wallets.find((w) => w.address.toLowerCase() === addr.toLowerCase());
    if (!existing) {
      const id = `wallet_${Date.now()}`;
      existing = {
        id,
        label,
        address: addr,
        totalUsd: 0,
        change24hPct: 0,
        holdings: []
      };
      wallets.push(existing);
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

// ===== NETWORK SELECT STUB =====
const networkSelect = document.getElementById("networkSelect");
if (networkSelect) {
  networkSelect.addEventListener("change", (e) => {
    console.log("Change network:", e.target.value);
    // Wire into your existing RPC switch if needed
  });
}

// ===== INIT =====
loadWallets();

// TEMP: add dummy holdings for first wallet if none exist, so UI isn't empty
if (!wallets.length) {
  wallets = [
    {
      id: "demo",
      label: "Demo wallet",
      address: "0x1234...ABCD",
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
        }
      ]
    }
  ];
  saveWallets();
}

renderWallets();
updateGateVisibility();