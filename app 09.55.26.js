(() => {
  "use strict";

  const STORAGE_KEY = "garageLogCollection";
  const CODE_PATTERN = /[A-Z0-9]{5}/i;

  const els = {
    input: document.getElementById("code-input"),
    toast: document.getElementById("toast"),
    list: document.getElementById("car-list"),
    emptyState: document.getElementById("empty-state"),
    count: document.getElementById("collection-count"),
    exportBtn: document.getElementById("export-btn"),
  };

  let collection = loadCollection();
  let toastTimer = null;

  // ---------- Storage ----------

  function loadCollection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
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

  function addToCollection(code) {
    const existing = collection.find((item) => item.code === code);
    if (existing) {
      existing.quantity += 1;
    } else {
      collection.push({
        code,
        quantity: 1,
        scanned_at: new Date().toISOString(),
      });
    }
    saveCollection();
    render();
    return existing ? existing.quantity : 1;
  }

  function changeQuantity(code, delta) {
    const item = collection.find((c) => c.code === code);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) {
      collection = collection.filter((c) => c.code !== code);
    }
    saveCollection();
    render();
  }

  function removeItem(code) {
    collection = collection.filter((c) => c.code !== code);
    saveCollection();
    render();
  }

  function editCode(oldCode, newCodeRaw) {
    const newCode = newCodeRaw.trim().toUpperCase();
    if (!newCode || newCode === oldCode) {
      render();
      return;
    }

    const item = collection.find((c) => c.code === oldCode);
    if (!item) return;

    const target = collection.find((c) => c.code === newCode);
    if (target && target !== item) {
      // Merge into the existing entry with that code.
      target.quantity += item.quantity;
      collection = collection.filter((c) => c.code !== oldCode);
    } else {
      item.code = newCode;
    }
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

  function handleInput() {
    const raw = els.input.value;
    const match = raw.match(CODE_PATTERN);
    if (!match) return; // wait for a complete, valid code

    const code = match[0].toUpperCase();
    const newQty = addToCollection(code);

    els.input.value = "";
    els.input.focus();
    flashSuccess();
    showToast(newQty > 1 ? `Scanned ${code} — now x${newQty}` : `Scanned ${code}`);
  }

  // ---------- Rendering ----------

  function render() {
    els.count.textContent = `${collection.length} car${collection.length === 1 ? "" : "s"}`;
    els.exportBtn.disabled = collection.length === 0;

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
    row.dataset.code = item.code;

    const codeEl = document.createElement("div");
    codeEl.className = "car-code";
    codeEl.textContent = item.code;

    const metaEl = document.createElement("div");
    metaEl.className = "car-meta";
    metaEl.textContent = `First scanned ${formatDisplayTimestamp(item.scanned_at)}`;

    const qtyWrap = document.createElement("div");
    qtyWrap.className = "car-qty";

    const minusBtn = document.createElement("button");
    minusBtn.className = "qty-btn";
    minusBtn.type = "button";
    minusBtn.textContent = "\u2212";
    minusBtn.setAttribute("aria-label", `Decrease quantity of ${item.code}`);
    minusBtn.addEventListener("click", () => changeQuantity(item.code, -1));

    const qtyVal = document.createElement("span");
    qtyVal.className = "qty-value";
    qtyVal.textContent = item.quantity;

    const plusBtn = document.createElement("button");
    plusBtn.className = "qty-btn";
    plusBtn.type = "button";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", `Increase quantity of ${item.code}`);
    plusBtn.addEventListener("click", () => changeQuantity(item.code, 1));

    qtyWrap.append(minusBtn, qtyVal, plusBtn);

    const actions = document.createElement("div");
    actions.className = "car-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "text-btn";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => enterEditMode(row, item, codeEl, metaEl, actions));

    const removeBtn = document.createElement("button");
    removeBtn.className = "text-btn danger";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeItem(item.code));

    actions.append(editBtn, removeBtn);

    row.append(codeEl, metaEl, qtyWrap, actions);
    return row;
  }

  function enterEditMode(row, item, codeEl, metaEl, actions) {
    const input = document.createElement("input");
    input.className = "car-edit-input";
    input.type = "text";
    input.value = item.code;
    input.autocapitalize = "characters";
    input.spellcheck = false;
    input.maxLength = 12;

    row.replaceChild(input, codeEl);
    input.focus();
    input.select();

    actions.innerHTML = "";

    const saveBtn = document.createElement("button");
    saveBtn.className = "text-btn confirm";
    saveBtn.type = "button";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "text-btn";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    const commit = () => editCode(item.code, input.value);
    saveBtn.addEventListener("click", commit);
    cancelBtn.addEventListener("click", () => render());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") render();
    });

    actions.append(saveBtn, cancelBtn);
  }

  // ---------- CSV export ----------

  function exportCsv() {
    if (collection.length === 0) return;

    const rows = [["Model Code", "Quantity", "First Scanned"]];
    [...collection]
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((item) => {
        rows.push([item.code, item.quantity, formatCsvTimestamp(item.scanned_at)]);
      });

    const csvContent = rows.map((r) => r.join(", ")).join("\n");
    const uri = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);

    const link = document.createElement("a");
    link.setAttribute("href", uri);
    link.setAttribute("download", `garage-log-${dateStamp()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function dateStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  // ---------- Init ----------

  function init() {
    els.input.addEventListener("input", handleInput);
    els.exportBtn.addEventListener("click", exportCsv);
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
