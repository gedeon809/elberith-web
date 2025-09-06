import React, { useEffect, useMemo, useState } from "react";

// PWA install prompt + reset data
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted'|'dismissed', platform: string }>;
};

/** ****************************
 * Types & Local Storage
 ***************************** */

type Tab = "Inventory" | "Sell" | "Report";
type TrackBy = "unit" | "kg";

interface Item {
  id: string;
  name: string;
  sku?: string;
  photoDataUrl?: string;

  trackBy: TrackBy;             // "unit" or "kg"
  unitLabel?: string;           // e.g. "unit" | "kg" (defaults handled)

  pricePerUnit?: number;        // required if trackBy = "unit"
  pricePerKg?: number;          // required if trackBy = "kg"

  stockUnits?: number;          // current stock if "unit"
  stockKg?: number;             // current stock if "kg"

  createdAt: number;
  updatedAt: number;
}

interface Sale {
  id: string;
  itemId: string;

  qtyUnits?: number;            // if unit sale, positive number
  qtyKg?: number;               // if kg sale, positive number (allow decimals)

  unitPrice?: number;           // price/unit at sale time (snapshot)
  kgPrice?: number;             // price/kg at sale time (snapshot)

  total: number;                // computed at sale time (snapshot)
  note?: string;
  photoDataUrl?: string;
  timestamp: number;
}

const ITEMS_KEY = "web_inv_items_v2";
const SALES_KEY = "web_sales_v2";

/** small helpers */
const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const two = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const clampNonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** localStorage with guards */
const LS = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // no-op
    }
  },
};

/** ****************************
 * App
 ***************************** */
export default function App() {

  const [installEvt, setInstallEvt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = React.useState(false);

  React.useEffect(() => {
    const onBip = (e: any) => { e.preventDefault(); setInstallEvt(e); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const doInstall = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    try { await installEvt.userChoice; } finally { setInstallEvt(null); }
  };

  const resetAll = () => {
    if (!confirm('This will delete all inventory and sales. Continue?')) return;
    setItems([]);   // your existing state setters
    setSales([]);
    try {
      localStorage.removeItem('web_inv_items_v2');
      localStorage.removeItem('web_sales_v2');
    } catch {}
  };

  /** Persisted state */
  const [items, setItems] = useState<Item[]>(() => LS.get<Item[]>(ITEMS_KEY, []));
  const [sales, setSales] = useState<Sale[]>(() => LS.get<Sale[]>(SALES_KEY, []));

  /** UI state */
  const [tab, setTab] = useState<Tab>("Inventory");
  const [persistInfo, setPersistInfo] = useState<"unknown" | "granted" | "denied">("unknown");
  const [search, setSearch] = useState("");

  /** Save to LS whenever data changes */
  useEffect(() => LS.set(ITEMS_KEY, items), [items]);
  useEffect(() => LS.set(SALES_KEY, sales), [sales]);

  /** Ask Chrome/Android for persistent storage to prevent eviction */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // @ts-ignore - older TS doesn't know about StorageManager
        if (navigator?.storage?.persist) {
          // @ts-ignore
          const already = await navigator.storage.persisted?.();
          if (already && mounted) {
            setPersistInfo("granted");
            return;
          }
          // @ts-ignore
          const res = await navigator.storage.persist();
          if (mounted) setPersistInfo(res ? "granted" : "denied");
        } else {
          setPersistInfo("unknown");
        }
      } catch {
        setPersistInfo("unknown");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /** Derived: quick lookup */
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /** Derived: Stats per item */
  const statsByItem = useMemo(() => {
    const base = new Map<
      string,
      {
        soldUnits: number;
        soldKg: number;
        revenue: number;
      }
    >();
    for (const it of items) {
      base.set(it.id, { soldUnits: 0, soldKg: 0, revenue: 0 });
    }
    for (const s of sales) {
      const st = base.get(s.itemId);
      if (!st) continue;
      st.soldUnits += clampNonNeg(s.qtyUnits || 0);
      st.soldKg += clampNonNeg(s.qtyKg || 0);
      st.revenue += clampNonNeg(s.total || 0);
    }
    return base;
  }, [items, sales]);

  /** Helpers */
  const upsertItem = (partial: Partial<Item> & { id?: string }) => {
    if (partial.id) {
      setItems((prev) =>
        prev.map((i) => (i.id === partial.id ? { ...i, ...partial, updatedAt: Date.now() } : i))
      );
    } else {
      const now = Date.now();
      const trackBy = (partial.trackBy || "unit") as TrackBy;
      const newI: Item = {
        id: uid(),
        name: partial.name?.trim() || "Unnamed",
        sku: partial.sku?.trim() || undefined,
        photoDataUrl: partial.photoDataUrl,
        trackBy,
        unitLabel: partial.unitLabel || (trackBy === "kg" ? "kg" : "unit"),
        pricePerUnit: partial.pricePerUnit,
        pricePerKg: partial.pricePerKg,
        stockUnits: trackBy === "unit" ? clampNonNeg(partial.stockUnits || 0) : undefined,
        stockKg: trackBy === "kg" ? clampNonNeg(partial.stockKg || 0) : undefined,
        createdAt: now,
        updatedAt: now,
      };
      setItems((prev) => [newI, ...prev]);
    }
  };

  const deleteItem = (id: string, alsoDeleteSales: boolean) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (alsoDeleteSales) {
      setSales((prev) => prev.filter((s) => s.itemId !== id));
    }
  };

  /** Adjust stock (add or subtract). Use positive numbers. */
  const adjustStock = (id: string, deltaUnits?: number, deltaKg?: number) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        if (i.trackBy === "unit") {
          const next = clampNonNeg((i.stockUnits || 0) + (deltaUnits || 0));
          return { ...i, stockUnits: next, updatedAt: Date.now() };
        } else {
          const next = clampNonNeg((i.stockKg || 0) + (deltaKg || 0));
          return { ...i, stockKg: next, updatedAt: Date.now() };
        }
      })
    );
  };

  /** Create Sale (decrements stock). */
  const addSale = (payload: {
    itemId: string;
    qtyUnits?: number;
    qtyKg?: number;
    overridePrice?: number;
    note?: string;
  }) => {
    const it = itemMap.get(payload.itemId);
    if (!it) return;

    if (it.trackBy === "unit") {
      const q = clampNonNeg(payload.qtyUnits || 0);
      if (q <= 0) return;
      const price = Number.isFinite(payload.overridePrice)
        ? (payload.overridePrice as number)
        : it.pricePerUnit || 0;
      const total = q * price;

      // Check stock
      if ((it.stockUnits || 0) < q) {
        alert(`Insufficient stock. You have ${(it.stockUnits || 0)} ${it.unitLabel || "unit"}(s).`);
        return;
      }

      const sale: Sale = {
        id: uid(),
        itemId: it.id,
        qtyUnits: q,
        unitPrice: price,
        total,
        note: payload.note?.trim() || undefined,
        timestamp: Date.now(),
      };

      setSales((prev) => [sale, ...prev]);
      // decrement stock
      adjustStock(it.id, -q, 0);
    } else {
      const qkg = clampNonNeg(payload.qtyKg || 0);
      if (qkg <= 0) return;
      const priceKg = Number.isFinite(payload.overridePrice)
        ? (payload.overridePrice as number)
        : it.pricePerKg || 0;
      const total = qkg * priceKg;

      // Check stock
      if ((it.stockKg || 0) < qkg) {
        alert(`Insufficient stock. You have ${(it.stockKg || 0)} ${(it.unitLabel || "kg")}.`);
        return;
      }

      const sale: Sale = {
        id: uid(),
        itemId: it.id,
        qtyKg: qkg,
        kgPrice: priceKg,
        total,
        note: payload.note?.trim() || undefined,
        timestamp: Date.now(),
      };

      setSales((prev) => [sale, ...prev]);
      // decrement stock
      adjustStock(it.id, 0, -qkg);
    }
  };

  /** Edit/Delete Sale (and reconcile stock differences) */
  const updateSale = (saleId: string, changes: Partial<Sale>) => {
    setSales((prev) => {
      const old = prev.find((s) => s.id === saleId);
      if (!old) return prev;

      const it = itemMap.get(old.itemId);
      if (!it) return prev;

      const next: Sale = { ...old, ...changes };

      // reconcile stock
      if (it.trackBy === "unit") {
        const oldQty = clampNonNeg(old.qtyUnits || 0);
        const newQty = clampNonNeg(next.qtyUnits || 0);
        const delta = newQty - oldQty; // positive means we sold more → subtract more stock
        if (delta !== 0) {
          // ensure stock sufficient if selling more
          const available = it.stockUnits || 0;
          if (delta > 0 && available < delta) {
            alert(`Insufficient stock to increase sale. Available: ${available} ${it.unitLabel || "unit"}(s).`);
            return prev;
          }
          adjustStock(it.id, -delta, 0);
        }
        const price = Number.isFinite(next.unitPrice) ? (next.unitPrice as number) : (it.pricePerUnit || 0);
        next.total = price * newQty;
      } else {
        const oldKg = clampNonNeg(old.qtyKg || 0);
        const newKg = clampNonNeg(next.qtyKg || 0);
        const delta = newKg - oldKg; // positive means sell more kg
        if (delta !== 0) {
          const available = it.stockKg || 0;
          if (delta > 0 && available < delta) {
            alert(`Insufficient stock to increase sale. Available: ${available} ${(it.unitLabel || "kg")}.`);
            return prev;
          }
          adjustStock(it.id, 0, -delta);
        }
        const price = Number.isFinite(next.kgPrice) ? (next.kgPrice as number) : (it.pricePerKg || 0);
        next.total = price * newKg;
      }

      return prev.map((s) => (s.id === saleId ? next : s));
    });
  };

  const deleteSale = (saleId: string) => {
    setSales((prev) => {
      const s = prev.find((x) => x.id === saleId);
      if (!s) return prev;
      const it = itemMap.get(s.itemId);
      if (it) {
        if (it.trackBy === "unit" && s.qtyUnits) adjustStock(it.id, s.qtyUnits, 0);
        if (it.trackBy === "kg" && s.qtyKg) adjustStock(it.id, 0, s.qtyKg);
      }
      return prev.filter((x) => x.id !== saleId);
    });
  };

  /** Backup/Restore */
  const exportJson = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      items,
      sales,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `inventory-backup-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        if (!Array.isArray(parsed.items) || !Array.isArray(parsed.sales)) {
          alert("Invalid backup file.");
          return;
        }
        setItems(parsed.items);
        setSales(parsed.sales);
      } catch (e) {
        alert("Failed to import file.");
      }
    };
    reader.readAsText(file);
  };

  /** Filters */
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.sku || "").toLowerCase().includes(q)
    );
  }, [items, search]);

  /** ------------- UI -------------- */

  return (
    <div style={styles.shell}>
      <style>{css}</style>

      <header style={styles.header}>
        <h1>🛒 Mirichouky-Meat Tracker</h1>

        <div className="row gap">
          <small className={`pill ${persistInfo === "granted" ? "ok" : persistInfo === "denied" ? "warn" : ""}`}>
            Storage: {persistInfo}
          </small>

          {installed && <small className="pill ok">Installed ✓</small>}
          {!installed && installEvt && (
            <button className="primary" onClick={doInstall}>Install App</button>
          )}

          <button className="ghost" onClick={exportJson}>Export</button>
          <label className="ghost file">
            Import
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          </label>

          <button className="danger" onClick={resetAll}>Reset Data</button>
        </div>
      </header>


      <nav style={styles.tabs}>
        {(["Inventory", "Sell", "Report"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tab ${tab === t ? "active" : ""}`}
          >
            {t}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {tab === "Inventory" && (
          <InventoryTab
            items={filteredItems}
            allItems={items}
            statsByItem={statsByItem}
            onUpsertItem={upsertItem}
            onDeleteItem={deleteItem}
            onAdjustStock={adjustStock}
            onSearch={setSearch}
            search={search}
          />
        )}

        {tab === "Sell" && (
          <SellTab
            items={items}
            onAddSale={addSale}
            sales={sales}
            onUpdateSale={updateSale}
            onDeleteSale={deleteSale}
          />
        )}

        {tab === "Report" && (
          <ReportTab items={items} statsByItem={statsByItem} />
        )}
      </main>

      <footer style={styles.footer}>
        <small>
          Tip: On Android/Chrome, we request <b>Persistent Storage</b> to keep your data even when the browser needs space. You can also Export/Import backups anytime.
        </small>
      </footer>
    </div>
  );
}

/** ****************************
 * Inventory Tab
 ***************************** */
function InventoryTab(props: {
  items: Item[];
  allItems: Item[];
  statsByItem: Map<string, { soldUnits: number; soldKg: number; revenue: number }>;
  onUpsertItem: (i: Partial<Item> & { id?: string }) => void;
  onDeleteItem: (id: string, alsoDeleteSales: boolean) => void;
  onAdjustStock: (id: string, deltaUnits?: number, deltaKg?: number) => void;
  onSearch: (q: string) => void;
  search: string;
}) {
  const { items, allItems, statsByItem, onUpsertItem, onDeleteItem, onAdjustStock, onSearch, search } = props;

  /** Create / Edit form state */
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState<Partial<Item>>({ trackBy: "unit", unitLabel: "unit" });

  useEffect(() => {
    if (editing) {
      setForm(editing);
    } else {
      setForm({ trackBy: "unit", unitLabel: "unit" });
    }
  }, [editing]);

  const reset = () => setEditing(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // coerce numbers
    const trackBy = (form.trackBy || "unit") as TrackBy;
    const payload: Partial<Item> & { id?: string } = {
      id: editing?.id,
      name: form.name?.trim(),
      sku: form.sku?.trim(),
      trackBy,
      unitLabel: form.unitLabel?.trim() || (trackBy === "kg" ? "kg" : "unit"),
      pricePerUnit:
        trackBy === "unit" ? Number(form.pricePerUnit) || 0 : undefined,
      pricePerKg: trackBy === "kg" ? Number(form.pricePerKg) || 0 : undefined,
      stockUnits: trackBy === "unit" ? clampNonNeg(Number(form.stockUnits) || 0) : undefined,
      stockKg: trackBy === "kg" ? clampNonNeg(Number(form.stockKg) || 0) : undefined,
      photoDataUrl: form.photoDataUrl,
    };
    onUpsertItem(payload);
    reset();
  };

  const loadPhoto = (file: File) => {
    const fr = new FileReader();
    fr.onload = () => setForm((f) => ({ ...f, photoDataUrl: String(fr.result) }));
    fr.readAsDataURL(file);
  };

  return (
    <section className="stack">
      <div className="row spread">
        <h2>Inventory</h2>
        <input
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="input"
          style={{ maxWidth: 280 }}
        />
      </div>

      <form className="card form" onSubmit={submit}>
        <h3>{editing ? "Edit Item" : "Add Item"}</h3>
        <div className="grid2">
          <label className="stack">
            <span>Name</span>
            <input
              className="input"
              required
              value={form.name || ""}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>

          <label className="stack">
            <span>SKU (optional)</span>
            <input
              className="input"
              value={form.sku || ""}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            />
          </label>

          <label className="stack">
            <span>Track By</span>
            <select
              className="input"
              value={form.trackBy || "unit"}
              onChange={(e) => {
                const v = e.target.value as TrackBy;
                setForm((f) => ({
                  ...f,
                  trackBy: v,
                  unitLabel: v === "kg" ? "kg" : "unit",
                }));
              }}
            >
              <option value="unit">Unit</option>
              <option value="kg">Kilogram (kg)</option>
            </select>
          </label>

          <label className="stack">
            <span>Unit Label</span>
            <input
              className="input"
              value={form.unitLabel || (form.trackBy === "kg" ? "kg" : "unit")}
              onChange={(e) => setForm((f) => ({ ...f, unitLabel: e.target.value }))}
            />
          </label>

          {form.trackBy !== "kg" ? (
            <>
              <label className="stack">
                <span>Price per {form.unitLabel || "unit"} (R)</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.pricePerUnit ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pricePerUnit: Number(e.target.value) }))
                  }
                />
              </label>

              <label className="stack">
                <span>Stock ({form.unitLabel || "unit"}s)</span>
                <input
                  className="input"
                  type="number"
                  step="1"
                  min="0"
                  value={form.stockUnits ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, stockUnits: Number(e.target.value) }))
                  }
                />
              </label>
            </>
          ) : (
            <>
              <label className="stack">
                <span>Price per {form.unitLabel || "kg"} (R)</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.pricePerKg ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pricePerKg: Number(e.target.value) }))
                  }
                />
              </label>

              <label className="stack">
                <span>Stock ({form.unitLabel || "kg"})</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.stockKg ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, stockKg: Number(e.target.value) }))
                  }
                />
              </label>
            </>
          )}

          <label className="stack">
            <span>Photo (optional)</span>
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && loadPhoto(e.target.files[0])}
            />
          </label>
          <div />
        </div>

        <div className="row gap">
          <button type="submit" className="primary">
            {editing ? "Save Changes" : "Add Item"}
          </button>
          {editing && (
            <button type="button" className="ghost" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="list">
        {items.length === 0 ? (
          <div className="empty">No items yet.</div>
        ) : (
          items.map((i) => {
            const st = statsByItem.get(i.id)!;
            const left =
              i.trackBy === "unit"
                ? `${i.stockUnits ?? 0} ${i.unitLabel || "unit"}(s)`
                : `${two(i.stockKg ?? 0)} ${i.unitLabel || "kg"}`;
            const sold =
              i.trackBy === "unit"
                ? `${st.soldUnits} ${i.unitLabel || "unit"}(s)`
                : `${two(st.soldKg)} ${i.unitLabel || "kg"}`;

            return (
              <div key={i.id} className="card row spread wrap">
                <div className="row gap wrap">
                  {i.photoDataUrl && (
                    <img src={i.photoDataUrl} alt={i.name} className="thumb" />
                  )}
                  <div className="stack">
                    <b>{i.name}</b>
                    <small>SKU: {i.sku || "-"}</small>
                    <small>Track: {i.trackBy === "kg" ? "KG" : "Unit"}</small>
                    <small>
                      Price:{" "}
                      {i.trackBy === "kg"
                        ? `R${two(i.pricePerKg || 0)} / ${i.unitLabel || "kg"}`
                        : `R${two(i.pricePerUnit || 0)} / ${i.unitLabel || "unit"}`}
                    </small>
                  </div>
                </div>

                <div className="row gap wrap">
                  <div className="pill">Sold: {sold}</div>
                  <div className="pill">Left: {left}</div>
                  <div className="pill">Revenue: R{two(st.revenue)}</div>
                </div>

                <div className="row gap wrap">
                  <button className="ghost" onClick={() => setEditing(i)}>
                    Edit
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      const also = confirm("Also delete all sales for this item?");
                      onDeleteItem(i.id, also);
                    }}
                  >
                    Delete
                  </button>

                  {/* Quick restock */}
                  {i.trackBy === "unit" ? (
                    <RestockButton
                      label={`+ ${i.unitLabel || "unit"}s`}
                      onApply={(n) => onAdjustStock(i.id, n, 0)}
                      step="1"
                    />
                  ) : (
                    <RestockButton
                      label={`+ ${i.unitLabel || "kg"}`}
                      onApply={(n) => onAdjustStock(i.id, 0, n)}
                      step="0.01"
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {allItems.length > 0 && (
        <details>
          <summary>All Items ({allItems.length})</summary>
          <small>Shows the full list without search filter.</small>
        </details>
      )}
    </section>
  );
}

/** ****************************
 * Sell Tab
 ***************************** */
function SellTab(props: {
  items: Item[];
  sales: Sale[];
  onAddSale: (payload: { itemId: string; qtyUnits?: number; qtyKg?: number; overridePrice?: number; note?: string; }) => void;
  onUpdateSale: (saleId: string, changes: Partial<Sale>) => void;
  onDeleteSale: (saleId: string) => void;
}) {
  const { items, sales, onAddSale, onUpdateSale, onDeleteSale } = props;

  const [itemId, setItemId] = useState(items[0]?.id || "");
  const current = useMemo(() => items.find((i) => i.id === itemId) || null, [itemId, items]);

  useEffect(() => {
    if (!current && items[0]) setItemId(items[0].id);
  }, [items, current]);

  /** Sale form */
  const [qtyUnits, setQtyUnits] = useState<number>(0);
  const [qtyKg, setQtyKg] = useState<number>(0);
  const [overridePrice, setOverridePrice] = useState<number | "">("");
  const [note, setNote] = useState("");

  const clear = () => {
    setQtyUnits(0);
    setQtyKg(0);
    setOverridePrice("");
    setNote("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!current) return;
    const price =
      current.trackBy === "kg"
        ? (overridePrice === "" ? current.pricePerKg || 0 : Number(overridePrice))
        : (overridePrice === "" ? current.pricePerUnit || 0 : Number(overridePrice));

    if (current.trackBy === "unit") {
      onAddSale({ itemId: current.id, qtyUnits: Number(qtyUnits) || 0, overridePrice: price, note: note.trim() || undefined });
    } else {
      onAddSale({ itemId: current.id, qtyKg: Number(qtyKg) || 0, overridePrice: price, note: note.trim() || undefined });
    }
    clear();
  };

  return (
    <section className="stack">
      <h2>Sell</h2>

      {items.length === 0 ? (
        <div className="empty">Add an item in Inventory first.</div>
      ) : (
        <form className="card form" onSubmit={submit}>
          <div className="grid2">
            <label className="stack">
              <span>Item</span>
              <select
                className="input"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} {i.sku ? `(${i.sku})` : ""}
                  </option>
                ))}
              </select>
            </label>

            {current?.trackBy === "kg" ? (
              <>
                <label className="stack">
                  <span>Quantity (kg)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={qtyKg}
                    onChange={(e) => setQtyKg(Number(e.target.value))}
                  />
                </label>

                <label className="stack">
                  <span>Price per kg (R)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={overridePrice === "" ? (current?.pricePerKg ?? 0) : overridePrice}
                    onChange={(e) => setOverridePrice(Number(e.target.value))}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="stack">
                  <span>Quantity ({current?.unitLabel || "unit"})</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="1"
                    value={qtyUnits}
                    onChange={(e) => setQtyUnits(Number(e.target.value))}
                  />
                </label>

                <label className="stack">
                  <span>Price per {current?.unitLabel || "unit"} (R)</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={overridePrice === "" ? (current?.pricePerUnit ?? 0) : overridePrice}
                    onChange={(e) => setOverridePrice(Number(e.target.value))}
                  />
                </label>
              </>
            )}

            <label className="stack" style={{ gridColumn: "1 / -1" }}>
              <span>Note (optional)</span>
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>

          <div className="row gap">
            <button className="primary" type="submit">Add Sale</button>
            <button className="ghost" type="button" onClick={clear}>Clear</button>
          </div>
        </form>
      )}

      <h3>Recent Sales</h3>
      <div className="list">
        {sales.length === 0 ? (
          <div className="empty">No sales yet.</div>
        ) : (
          sales.map((s) => {
            const it = items.find((i) => i.id === s.itemId);
            if (!it) return null;
            // ✅ No hooks here — just render the child component
            return (
              <EditableSaleCard
                key={s.id}
                sale={s}
                item={it}
                onUpdateSale={onUpdateSale}
                onDeleteSale={onDeleteSale}
              />
            );
          })
        )}
      </div>
    </section>
  );
}

/** Single Sale Card with own edit state (fixes hooks-in-loop) */
function EditableSaleCard(props: {
  sale: Sale;
  item: Item;
  onUpdateSale: (saleId: string, changes: Partial<Sale>) => void;
  onDeleteSale: (saleId: string) => void;
}) {
  const { sale, item, onUpdateSale, onDeleteSale } = props;

  // Local edit state lives INSIDE the component
  const [isEditing, setIsEditing] = useState(false);
  const [qtyUnits, setQtyUnits] = useState<number>(sale.qtyUnits || 0);
  const [qtyKg, setQtyKg] = useState<number>(sale.qtyKg || 0);
  const [price, setPrice] = useState<number>(
    item.trackBy === "kg" ? (sale.kgPrice ?? item.pricePerKg ?? 0) : (sale.unitPrice ?? item.pricePerUnit ?? 0)
  );
  const [note, setNote] = useState<string>(sale.note || "");

  // Keep edit fields in sync if the sale changes (e.g., after parent updates)
  useEffect(() => {
    setQtyUnits(sale.qtyUnits || 0);
    setQtyKg(sale.qtyKg || 0);
    setPrice(item.trackBy === "kg" ? (sale.kgPrice ?? item.pricePerKg ?? 0) : (sale.unitPrice ?? item.pricePerUnit ?? 0));
    setNote(sale.note || "");
  }, [sale.id, sale.qtyUnits, sale.qtyKg, sale.unitPrice, sale.kgPrice, sale.note, item.trackBy, item.pricePerUnit, item.pricePerKg]);

  const save = () => {
    if (item.trackBy === "kg") {
      onUpdateSale(sale.id, {
        qtyKg,
        kgPrice: price,
        note: note.trim() || undefined,
      });
    } else {
      onUpdateSale(sale.id, {
        qtyUnits,
        unitPrice: price,
        note: note.trim() || undefined,
      });
    }
    setIsEditing(false);
  };

  return (
    <div className="card row spread wrap">
      <div className="stack">
        <b>{item.name}</b>
        <small>{new Date(sale.timestamp).toLocaleString()}</small>
        {isEditing ? (
          <>
            {item.trackBy === "kg" ? (
              <div className="row gap wrap">
                <label className="stack">
                  <span>Qty (kg)</span>
                  <input className="input" type="number" min="0" step="0.01" value={qtyKg} onChange={(e) => setQtyKg(Number(e.target.value))} />
                </label>
                <label className="stack">
                  <span>Price/kg (R)</span>
                  <input className="input" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                </label>
              </div>
            ) : (
              <div className="row gap wrap">
                <label className="stack">
                  <span>Qty ({item.unitLabel || "unit"})</span>
                  <input className="input" type="number" min="0" step="1" value={qtyUnits} onChange={(e) => setQtyUnits(Number(e.target.value))} />
                </label>
                <label className="stack">
                  <span>Price/{item.unitLabel || "unit"} (R)</span>
                  <input className="input" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                </label>
              </div>
            )}
            <label className="stack">
              <span>Note</span>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <small>
              {item.trackBy === "kg"
                ? `Sold: ${two(sale.qtyKg || 0)} ${item.unitLabel || "kg"} @ R${two(sale.kgPrice || 0)}`
                : `Sold: ${sale.qtyUnits || 0} ${item.unitLabel || "unit"}(s) @ R${two(sale.unitPrice || 0)}`}
            </small>
            <b>Total: R{two(sale.total)}</b>
            {sale.note && <small>Note: {sale.note}</small>}
          </>
        )}
      </div>

      <div className="row gap wrap">
        {isEditing ? (
          <>
            <button className="primary" onClick={save}>Save</button>
            <button className="ghost" onClick={() => setIsEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="ghost" onClick={() => setIsEditing(true)}>Edit</button>
            <button className="danger" onClick={() => onDeleteSale(sale.id)}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}

/** ****************************
 * Report Tab
 ***************************** */
function ReportTab(props: {
  items: Item[];
  statsByItem: Map<string, { soldUnits: number; soldKg: number; revenue: number }>;
}) {
  const { items, statsByItem } = props;

  const totals = useMemo(() => {
    let revenue = 0;
    let totalUnits = 0;
    let totalKg = 0;
    for (const it of items) {
      const st = statsByItem.get(it.id)!;
      revenue += st.revenue;
      totalUnits += st.soldUnits;
      totalKg += st.soldKg;
    }
    return { revenue, totalUnits, totalKg };
  }, [items, statsByItem]);

  return (
    <section className="stack">
      <h2>Report</h2>

      <div className="row gap wrap">
        <div className="pill big">Revenue: R{two(totals.revenue)}</div>
        <div className="pill big">Sold Units: {totals.totalUnits}</div>
        <div className="pill big">Sold Kg: {two(totals.totalKg)}</div>
      </div>

      <div className="list">
        {items.length === 0 ? (
          <div className="empty">No data yet.</div>
        ) : (
          items.map((i) => {
            const st = statsByItem.get(i.id)!;
            const left =
              i.trackBy === "unit"
                ? `${i.stockUnits ?? 0} ${i.unitLabel || "unit"}(s)`
                : `${two(i.stockKg ?? 0)} ${i.unitLabel || "kg"}`;
            return (
              <div key={i.id} className="card row spread wrap">
                <div className="stack">
                  <b>{i.name}</b>
                  <small>Track: {i.trackBy === "kg" ? "KG" : "Unit"}</small>
                </div>
                <div className="row gap wrap">
                  <div className="pill">Sold: {i.trackBy === "kg" ? `${two(st.soldKg)} ${i.unitLabel || "kg"}` : `${st.soldUnits} ${i.unitLabel || "unit"}(s)`}</div>
                  <div className="pill">Left: {left}</div>
                  <div className="pill">Revenue: R{two(st.revenue)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/** ****************************
 * Small components
 ***************************** */

function RestockButton(props: {
  label: string;
  onApply: (n: number) => void;
  step?: string;
}) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState<number>(0);

  const apply = () => {
    if (n > 0) {
      props.onApply(n);
      setN(0);
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button className="ghost" onClick={() => setOpen(true)}>
        Restock
      </button>
    );
  }
  return (
    <div className="row gap">
      <input
        className="input"
        type="number"
        min="0"
        step={props.step || "1"}
        value={n}
        onChange={(e) => setN(Number(e.target.value))}
        style={{ width: 120 }}
      />
      <button className="primary" onClick={apply}>{props.label}</button>
      <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

/** ****************************
 * Styles
 ***************************** */

const styles: Record<string, React.CSSProperties> = {
  shell: {
    maxWidth: 980,
    margin: "0 auto",
    padding: "24px 16px 80px",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    color: "#0f172a",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  tabs: { display: "flex", gap: 8, borderBottom: "1px solid #e2e8f0", marginBottom: 16 },
  main: { display: "grid", gap: 16 },
  footer: { marginTop: 24, opacity: 0.8 },
};

const css = `
:root {
  --bg: #ffffff;
  --card: #f8fafc;
  --ink: #0f172a;
  --muted: #475569;
  --border: #e2e8f0;
  --brand: #2563eb;
  --ok: #059669;
  --warn: #d97706;
  --danger: #dc2626;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); }
h1,h2,h3 { margin: 0 0 .5rem; }
small { color: var(--muted); }
img.thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); }

.row { display: flex; align-items: center; }
.row.spread { justify-content: space-between; }
.row.gap { gap: 8px; }
.wrap { flex-wrap: wrap; }
.stack { display: grid; gap: 4px; }

.input, select, button { font: inherit; }
.input, select { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
.input:focus, select:focus { outline: 2px solid #bfdbfe; border-color: #bfdbfe; }

button { padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border); background: #fff; cursor: pointer; }
button.primary { background: var(--brand); color: white; border-color: var(--brand); }
button.ghost { background: #fff; }
button.danger { background: var(--danger); color: #fff; border-color: var(--danger); }
button.tab { border: none; padding: 10px 14px; background: transparent; border-bottom: 2px solid transparent; }
button.tab.active { border-bottom-color: var(--brand); color: var(--brand); }

.pill { background: var(--card); padding: 6px 10px; border-radius: 999px; border: 1px solid var(--border); }
.pill.ok { background: #ecfdf5; color: var(--ok); border-color: #bbf7d0; }
.pill.warn { background: #fffbeb; color: var(--warn); border-color: #fde68a; }
.pill.big { font-weight: 600; }

.card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
.form { display: grid; gap: 12px; }
.grid2 { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }

.list { display: grid; gap: 10px; }
.empty { text-align: center; padding: 20px; border: 1px dashed var(--border); border-radius: 12px; color: var(--muted); }

label.file { position: relative; overflow: hidden; }
label.file input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
`;

/** ****************************
 * END
 ***************************** */
