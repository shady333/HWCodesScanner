(() => {
  "use strict";

  const STORAGE_KEY = "garageLogCollection";
  const CODE_PATTERN = /[A-Z0-9]{5}/i;
  const TYPES = ["MainLine", "Silver Series", "Premium", "Elite 64", "RLC", "Matchbox", "UNDEFINED"];
  const DEFAULT_TYPE = "MainLine";
  const DEFAULT_PRICE = 100;

  const els = {
    input: document.getElementById("code-input"),
    typeSelect: document.getElementById("type-select"),
    priceInput: document.getElementById("price-input"),
    toast: document.getElementById("toast"),
    list: document.getElementById("car-list"),
    emptyState: document.getElementById("empty-state"),
    count: document.getElementById("collection-count"),
    exportBtn: document.getElementById("export-btn"),
    clearAllBtn: document.getElementById("clear-all-btn"),
    confirmationPanel: document.getElementById("confirmation-panel"),
    confirmSummary: document.getElementById("confirm-summary"),
    confirmAddBtn: document.getElementById("confirm-add-btn"),
    clearInputBtn: document.getElementById("clear-input-btn"),
  };

  let collection = loadCollection();
  let toastTimer = null;

  // ---------- Utilities ----------

  function makeId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function slugifyType(type) {
    return String(type || "UNDEFINED")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function normalizeType(type) {
    return TYPES.includes(type) ? type : "UNDEFINED";
  }

  function normalizePrice(value) {
    const n = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PRICE;
  }

  function formatPrice(n) {
    // Keep whole numbers clean (100 not 100.00), but preserve decimals if present.
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  // ---------- Storage ----------

  function loadCollection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      // Migrate older entries that predate id/type/price fields.
      return parsed.map((item) => ({
        id: item.id || makeId(),
        code: String(item.code || "").toUpperCase(),
        quantity: Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1,
        type: normalizeType(item.type || DEFAULT_TYPE),
        price: normalizePrice(item.price),
        scanned_at: item.scanned_at || new Date().toISOString(),
      }));
    } catch (err) {
      console.error("Failed to read collection from storage:", err);
      return [];
    }
  }

  function saveCollection() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
    } catch (err) {
      console.error("Failed to save collection to storage:", err);
    }
  }

  // ---------- Formatting ----------

  function formatDisplayTimestamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const day = String(d.getDate()).padStart(2, "0");
    const month = d.toLocaleString("en-US", { month: "short" });
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${day} ${month} ${hh}:${mm}`;
  }

  function formatCsvTimestamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // ---------- Core actions ----------
  // Every scan creates its own row — codes are not merged/deduped, since
  // the same model can be bought again later at a different price.

  function addToCollection(code, type, price) {
    collection.push({
      id: makeId(),
      code,
      type: normalizeType(type),
      price: normalizePrice(price),
      quantity: 1,
      scanned_at: new Date().toISOString(),
    });
    saveCollection();
    render();
  }

  function changeQuantity(id, delta) {
    const item = collection.find((c) => c.id === id);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      collection = collection.filter((c) => c.id !== id);
    }
    saveCollection();
    render();
  }

  function removeItem(id) {
    collection = collection.filter((c) => c.id !== id);
    saveCollection();
    render();
  }

  function editItem(id, { code, type, price }) {
    const item = collection.find((c) => c.id === id);
    if (!item) return;

    const newCode = String(code || "").trim().toUpperCase();
    if (newCode) item.code = newCode;
    item.type = normalizeType(type);
    item.price = normalizePrice(price);

    saveCollection();
    render();
  }

  // ---------- Scanning / input handling ----------

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove("show");
    }, 1800);
  }

  function flashSuccess() {
    els.input.classList.add("flash-success");
    setTimeout(() => els.input.classList.remove("flash-success"), 350);
  }

  function currentPendingCode() {
    const sanitized = els.input.value.replace(/\s+/g, "").toUpperCase();
    const match = sanitized.match(CODE_PATTERN);
    return match ? match[0] : "";
  }

  function updateConfirmSummary() {
    const code = currentPendingCode();
    if (!code) return;
    const type = els.typeSelect.value;
    const price = normalizePrice(els.priceInput.value);
    els.confirmSummary.innerHTML =
      `<strong>${code}</strong> &middot; ${type} &middot; ${formatPrice(price)} &#8372;`;
  }

  function showConfirmation() {
    updateConfirmSummary();
    els.confirmationPanel.classList.add("show");
  }

  function hideConfirmation() {
    els.confirmationPanel.classList.remove("show");
  }

  function handleInput() {
    const raw = els.input.value;

    // iOS Live Text can insert stray spaces, lowercase letters, or
    // surrounding noise (e.g. "fncontrol jbb55"). Normalize first...
    const sanitized = raw.replace(/\s+/g, "").toUpperCase();

    // ...then pull out just the valid 5-character code if one is
    // present, so the confirmation field only ever shows the clean
    // code rather than whatever else iOS grabbed around it.
    const match = sanitized.match(CODE_PATTERN);
    const cleaned = match ? match[0] : sanitized;

    if (cleaned !== raw) {
      els.input.value = cleaned;
    }

    if (cleaned.length > 0) {
      showConfirmation();
    } else {
      hideConfirmation();
    }
  }

  function confirmAndAdd() {
    const code = currentPendingCode();

    if (!code) {
      showToast("Enter a valid 5-character code");
      return;
    }

    const type = els.typeSelect.value;
    const price = normalizePrice(els.priceInput.value);
    addToCollection(code, type, price);

    // Immediate refocus keeps the keyboard (and Scan Text) open and
    // ready for the next car without the user tapping again. Series
    // and price stay as-is (sticky) since batches are usually scanned
    // at the same price/series in a row.
    els.input.value = "";
    hideConfirmation();
    els.input.focus();
    flashSuccess();
    showToast(`Scanned ${code} — ${type} · ${formatPrice(price)} \u20B4`);
  }

  function clearInput() {
    els.input.value = "";
    hideConfirmation();
    els.input.focus();
  }

  // ---------- Rendering ----------

  function render() {
    els.count.textContent = `${collection.length} car${collection.length === 1 ? "" : "s"}`;
    els.exportBtn.disabled = collection.length === 0;
    els.clearAllBtn.disabled = collection.length === 0;

    if (collection.length === 0) {
      els.emptyState.style.display = "block";
      els.list.style.display = "none";
      els.list.innerHTML = "";
      return;
    }

    els.emptyState.style.display = "none";
    els.list.style.display = "flex";

    // Most recently scanned first.
    const sorted = [...collection].sort(
      (a, b) => new Date(b.scanned_at) - new Date(a.scanned_at)
    );

    els.list.innerHTML = "";
    sorted.forEach((item) => {
      els.list.appendChild(buildRow(item));
    });
  }

  function buildRow(item) {
    const row = document.createElement("div");
    row.className = "car-row";
    row.dataset.id = item.id;

    const codeEl = document.createElement("div");
    codeEl.className = "car-code";
    codeEl.textContent = item.code;

    const detailsEl = document.createElement("div");
    detailsEl.className = "car-details";

    const badge = document.createElement("span");
    badge.className = `type-badge ${slugifyType(item.type)}`;
    badge.textContent = item.type;

    const priceEl = document.createElement("span");
    priceEl.className = "car-price";
    priceEl.textContent = `${formatPrice(item.price)} \u20B4`;

    detailsEl.append(badge, priceEl);

    const metaEl = document.createElement("div");
    metaEl.className = "car-meta";
    metaEl.textContent = `Scanned ${formatDisplayTimestamp(item.scanned_at)}`;

    const qtyWrap = document.createElement("div");
    qtyWrap.className = "car-qty";

    const minusBtn = document.createElement("button");
    minusBtn.className = "qty-btn";
    minusBtn.type = "button";
    minusBtn.textContent = "\u2212";
    minusBtn.setAttribute("aria-label", `Decrease quantity of ${item.code}`);
    minusBtn.addEventListener("click", () => changeQuantity(item.id, -1));

    const qtyVal = document.createElement("span");
    qtyVal.className = "qty-value";
    qtyVal.textContent = item.quantity;

    const plusBtn = document.createElement("button");
    plusBtn.className = "qty-btn";
    plusBtn.type = "button";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", `Increase quantity of ${item.code}`);
    plusBtn.addEventListener("click", () => changeQuantity(item.id, 1));

    qtyWrap.append(minusBtn, qtyVal, plusBtn);

    const actions = document.createElement("div");
    actions.className = "car-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "text-btn";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => enterEditMode(row, item, codeEl, detailsEl, actions));

    const removeBtn = document.createElement("button");
    removeBtn.className = "text-btn danger";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeItem(item.id));

    actions.append(editBtn, removeBtn);

    row.append(codeEl, detailsEl, qtyWrap, actions, metaEl);
    return row;
  }

  function enterEditMode(row, item, codeEl, detailsEl, actions) {
    const codeInput = document.createElement("input");
    codeInput.className = "car-edit-input";
    codeInput.type = "text";
    codeInput.value = item.code;
    codeInput.autocapitalize = "characters";
    codeInput.spellcheck = false;
    codeInput.maxLength = 12;

    row.replaceChild(codeInput, codeEl);
    codeInput.focus();
    codeInput.select();

    const editDetails = document.createElement("div");
    editDetails.className = "car-edit-details";

    const typeSelect = document.createElement("select");
    TYPES.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      if (t === item.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });

    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0";
    priceInput.step = "1";
    priceInput.inputMode = "decimal";
    priceInput.value = item.price;

    editDetails.append(typeSelect, priceInput);
    row.replaceChild(editDetails, detailsEl);

    actions.innerHTML = "";

    const saveBtn = document.createElement("button");
    saveBtn.className = "text-btn confirm";
    saveBtn.type = "button";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "text-btn";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    const commit = () => {
      editItem(item.id, {
        code: codeInput.value,
        type: typeSelect.value,
        price: priceInput.value,
      });
    };
    saveBtn.addEventListener("click", commit);
    cancelBtn.addEventListener("click", () => render());
    codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") render();
    });

    actions.append(saveBtn, cancelBtn);
  }

  // ---------- CSV export ----------

  function exportCsv() {
    if (collection.length === 0) return;

    const rows = [["Model Code", "Type", "Price (UAH)", "Quantity", "Scanned At"]];
    [...collection]
      .sort((a, b) => a.code.localeCompare(b.code) || new Date(a.scanned_at) - new Date(b.scanned_at))
      .forEach((item) => {
        rows.push([
          item.code,
          item.type,
          formatPrice(item.price),
          item.quantity,
          formatCsvTimestamp(item.scanned_at),
        ]);
      });

    const csvContent = rows.map((r) => r.join(", ")).join("\n");

    // Use a Blob + object URL instead of a data: URI — iOS Safari and
    // installed PWAs block data: URI downloads for security reasons.
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `garage-log-${dateStamp()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  function dateStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  // ---------- Clear all ----------

  function clearAllCollection() {
    const confirmed = confirm(
      "Are you sure you want to completely erase your collection? This action cannot be undone."
    );
    if (!confirmed) return;

    collection = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.error("Failed to clear collection from storage:", err);
    }
    render();
  }

  // ---------- Init ----------

  function init() {
    els.input.addEventListener("change", handleInput);
    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmAndAdd();
      }
    });
    els.typeSelect.addEventListener("change", updateConfirmSummary);
    els.priceInput.addEventListener("input", updateConfirmSummary);
    els.confirmAddBtn.addEventListener("click", confirmAndAdd);
    els.clearInputBtn.addEventListener("click", clearInput);
    els.exportBtn.addEventListener("click", exportCsv);
    els.clearAllBtn.addEventListener("click", clearAllCollection);
    render();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch((err) => {
          console.error("Service worker registration failed:", err);
        });
      });
    }
  }

  init();
})();
