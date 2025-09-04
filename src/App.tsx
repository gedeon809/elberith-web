import React, { useEffect, useMemo, useState } from "react";

/************************
 * Types & Local Storage *
 ************************/

type Tab = "Inventory" | "Sell" | "Report";

interface Item {
  id: string;
  name: string;
  price: number; // default unit price
  sku?: string;
  photoDataUrl?: string; // stored as base64 for persistence
  createdAt: number;
}

interface Sale {
  id: string;
  itemId: string; // FK to Item
  qty: number;
  price: number; // unit price at time of sale
  photoDataUrl?: string; // optional sale proof
  timestamp: number;
}

const ITEMS_KEY = "web_inv_items_v1";
const SALES_KEY = "web_sales_v1";

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const toTwo = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

const dateKey = (ts: number = Date.now()) => {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const isSameDay = (a: number, b: number) => dateKey(a) === dateKey(b);

/****************
 * Image Helpers *
 ****************/
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/****************
 * Main App      *
 ****************/
export default function App() {
  const [tab, setTab] = useState<Tab>("Inventory");
  const [items, setItems] = useState<Item[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  // Load persisted data
  useEffect(() => {
    try {
      const itemsStr = localStorage.getItem(ITEMS_KEY);
      if (itemsStr) {
        const parsed = JSON.parse(itemsStr) as Item[];
        const fresh = parsed.filter(i => Date.now() - i.createdAt < 24 * 60 * 60 * 1000); // keep only < 24h
        setItems(fresh);
        if (fresh.length !== parsed.length) {
          localStorage.setItem(ITEMS_KEY, JSON.stringify(fresh)); // update if some expired
        }
      }
      const salesStr = localStorage.getItem(SALES_KEY);
      if (salesStr) setSales(JSON.parse(salesStr));
    } catch (e) {
      console.warn("Failed to load localStorage", e);
    } finally {
      setLoading(false);
    }
  }, []);


  // Persist on change
  useEffect(() => {
    try { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)); } catch {}
  }, [items]);
  useEffect(() => {
    try { localStorage.setItem(SALES_KEY, JSON.stringify(sales)); } catch {}
  }, [sales]);

  if (loading) return <div style={styles.center}>Loading…</div>;

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Mirichouky Supermarket Tracker</h1>

      {/* Tabs */}
      <div style={styles.tabs}>
        {(["Inventory", "Sell", "Report"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...styles.tabBtn, ...(tab === t ? styles.tabBtnActive : {}) }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", paddingBottom: 40 }}>
        {tab === "Inventory" && (
          <InventoryScreen items={items} setItems={setItems} />
        )}
        {tab === "Sell" && (
          <SellScreen items={items} onCreateSale={(s) => setSales((p) => [s, ...p])} />
        )}
        {tab === "Report" && (
          <ReportScreen items={items} sales={sales} />
        )}
      </div>
    </div>
  );
}

/****************
 * Inventory Tab *
 ****************/
function InventoryScreen({ items, setItems }: { items: Item[]; setItems: React.Dispatch<React.SetStateAction<Item[]>>; }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [sku, setSku] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>();

  const onSelectFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return alert("Please choose an image file");
    const dataUrl = await fileToDataUrl(file);
    setPhotoDataUrl(dataUrl);
  };

  const addItem = () => {
    const n = name.trim();
    const p = Number(price);
    if (!n) return alert("Please enter the item name");
    if (!Number.isFinite(p) || p <= 0) return alert("Please enter a valid price > 0");

    const newItem: Item = { id: uid(), name: n, price: p, sku: sku.trim() || undefined, photoDataUrl, createdAt: Date.now() };
    setItems((prev) => [newItem, ...prev]);
    setName(""); setPrice(""); setSku(""); setPhotoDataUrl(undefined);
  };

  return (
    <div>
      <h2 style={styles.h2}>Add Item</h2>
      <div style={styles.card}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" style={styles.input as React.CSSProperties} />
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Default Price *" type="number" step="0.01" style={styles.input as React.CSSProperties} />
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU / Barcode (optional)" style={styles.input as React.CSSProperties} />

        <div style={styles.row}> 
          <label style={styles.btn as React.CSSProperties}>
            Pick Photo
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onSelectFile(e.target.files?.[0])} />
          </label>
          <label style={styles.btn as React.CSSProperties}>
            Take Photo
            {/* On mobile, capture opens camera */}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => onSelectFile(e.target.files?.[0])} />
          </label>
        </div>
        {photoDataUrl && (
          <img src={photoDataUrl} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 12, marginTop: 8 }} />
        )}

        <button onClick={addItem} style={{ ...styles.btn, ...styles.btnPrimary, marginTop: 10 }}>Add Item</button>
      </div>

      <h2 style={{ ...styles.h2, marginTop: 16 }}>Inventory</h2>
      {items.length === 0 ? (
        <p style={{ color: '#555', padding: '0 8px' }}>No items yet. Add your first item above.</p>
      ) : (
        <div style={{ padding: '0 8px' }}>
          {items.map((item) => <ItemRow key={item.id} item={item} onDelete={(id) => setItems(items.filter(i => i.id !== id))} />)}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, onDelete }: { item: Item; onDelete: (id: string) => void }) {
  return (
    <div style={{ ...styles.card, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {item.photoDataUrl ? (
          <img src={item.photoDataUrl} style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 12, background: '#eee', display: 'grid', placeItems: 'center' }}>🛒</div>
        )}
        <div>
          <div style={styles.itemTitle}>{item.name}</div>
          <div style={{ color: '#666' }}>Price: R {toTwo(item.price)}{item.sku ? ` • SKU: ${item.sku}` : ''}</div>
        </div>
      </div>
      <button onClick={() => onDelete(item.id)} style={{ ...styles.btn, background: '#DC2626', color: '#fff' }}>Delete</button>
    </div>
  );
}


/************
 * Sell Tab *
 ************/
function SellScreen({ items, onCreateSale }: { items: Item[]; onCreateSale: (s: Sale) => void; }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>();

  useEffect(() => { if (selected) setPrice(String(selected.price)); }, [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q));
  }, [items, query]);

  const onSelectFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return alert('Please choose an image');
    const dataUrl = await fileToDataUrl(file);
    setPhotoDataUrl(dataUrl);
  };

  const saveSale = () => {
    if (!selected) return alert('Choose an item to sell');
    const qn = Number(qty);
    const pr = Number(price);
    if (!Number.isFinite(qn) || qn <= 0) return alert('Enter a valid quantity');
    if (!Number.isFinite(pr) || pr <= 0) return alert('Enter a valid price');

    const s: Sale = { id: uid(), itemId: selected.id, qty: qn, price: pr, photoDataUrl, timestamp: Date.now() };
    onCreateSale(s);
    // reset
    setSelected(null); setQty('1'); setPrice(''); setPhotoDataUrl(undefined);
    alert('Sale recorded');
  };

  return (
    <div>
      <h2 style={styles.h2}>Record a Sale</h2>
      <div style={styles.card}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or SKU" style={styles.input as React.CSSProperties} />

        <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 8 }}>
          {filtered.map((item) => (
            <div key={item.id} onClick={() => setSelected(item)} style={{ ...styles.listRow, ...(selected?.id === item.id ? styles.listRowActive : {}) }}>
              <div style={{ fontWeight: 600 }}>{item.name}</div>
              <div style={{ color: '#666' }}>R {toTwo(item.price)}{item.sku ? ` • ${item.sku}` : ''}</div>
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Selected: {selected.name}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" type="number" style={{ ...styles.input, flex: 1 } as React.CSSProperties} />
              <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Unit Price" type="number" step="0.01" style={{ ...styles.input, flex: 1 } as React.CSSProperties} />
            </div>
            <div style={styles.row}>
              <label style={styles.btn as React.CSSProperties}>
                Pick Photo
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onSelectFile(e.target.files?.[0])} />
              </label>
              <label style={styles.btn as React.CSSProperties}>
                Take Photo
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => onSelectFile(e.target.files?.[0])} />
              </label>
            </div>
            {photoDataUrl && (
              <img src={photoDataUrl} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 12, marginTop: 8 }} />
            )}

            <button onClick={saveSale} style={{ ...styles.btn, ...styles.btnPrimary, marginTop: 10 }}>Save Sale</button>
          </div>
        )}
      </div>
    </div>
  );
}

/***************
 * Report Tab  *
 ***************/
function ReportScreen({ items, sales }: { items: Item[]; sales: Sale[] }) {
  const now = Date.now();
  const todaySales = useMemo(() => sales.filter((s) => isSameDay(s.timestamp, now)), [sales, now]);

  const byItem = useMemo(() => {
    const m: Record<string, { item: Item | undefined; qty: number; revenue: number }> = {};
    for (const s of todaySales) {
      m[s.itemId] ||= { item: items.find((i) => i.id === s.itemId), qty: 0, revenue: 0 };
      m[s.itemId].qty += s.qty;
      m[s.itemId].revenue += s.qty * s.price;
    }
    return Object.values(m).sort((a, b) => b.revenue - a.revenue);
  }, [todaySales, items]);

  const totals = useMemo(() => {
    let qty = 0, revenue = 0;
    for (const s of todaySales) { qty += s.qty; revenue += s.qty * s.price; }
    return { qty, revenue };
  }, [todaySales]);

  const exportCSV = () => {
    const dKey = dateKey(now);
    const lines: (string | number)[][] = [
      ["Date", dKey],
      ["Total Qty", totals.qty],
      ["Total Revenue (R)", toTwo(totals.revenue)],
      [],
      ["Item", "SKU", "Qty", "Unit Price (R)", "Line Total (R)"],
    ];
    for (const row of byItem) {
      const item = row.item;
      lines.push([
        item?.name || "Unknown Item",
        item?.sku || "",
        row.qty,
        item ? toTwo(item.price) : "",
        toTwo(row.revenue),
      ]);
    }
    const csv = lines.map((r) => r.join(",")).join("\n");

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${dKey}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h2 style={styles.h2}>End of Day Report ({dateKey(now)})</h2>
      <div style={{ ...styles.card, padding: '14px 12px' }}>
        <div style={styles.metric}>Total Items Sold: <span style={styles.metricVal as React.CSSProperties}>{totals.qty}</span></div>
        <div style={styles.metric}>Total Revenue: <span style={styles.metricVal as React.CSSProperties}>R {toTwo(totals.revenue)}</span></div>
        <button onClick={exportCSV} style={{ ...styles.btn, ...styles.btnPrimary, marginTop: 8 }}>Export CSV</button>
      </div>

      <h3 style={{ ...styles.h2, marginTop: 8 }}>Breakdown by Item</h3>
      {byItem.length === 0 ? (
        <p style={{ color: '#555', padding: '0 8px' }}>No sales recorded today.</p>
      ) : (
        <div style={{ padding: '0 8px' }}>
          {byItem.map((row, idx) => (
            <div key={idx} style={{ ...styles.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ flex: 1 }}>
                <div style={styles.itemTitle}>{row.item?.name || 'Unknown Item'}</div>
                <div style={{ color: '#666' }}>Qty: {row.qty}</div>
              </div>
              <div style={{ fontWeight: 700 }}>R {toTwo(row.revenue)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**********
 * Styles  *
 **********/
const styles: Record<string, React.CSSProperties> = {
  container: { minHeight: '100vh', background: '#fff', padding: '12px 12px 40px' },
  center: { minHeight: '100vh', display: 'grid', placeItems: 'center' },
  title: { fontSize: 22, fontWeight: 800, textAlign: 'center', marginTop: 8 },
  h2: { fontSize: 18, fontWeight: 700, margin: '12px 12px 0' },
  tabs: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxWidth: 980, margin: '12px auto 0' },
  tabBtn: { padding: '10px 12px', borderRadius: 10, background: '#F2F2F2', border: 'none', fontWeight: 700, cursor: 'pointer' },
  tabBtnActive: { background: '#111', color: '#fff' },

  card: { background: '#fff', borderRadius: 12, padding: 12, margin: '10px 8px 0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },

  input: { background: '#F7F7F7', borderRadius: 10, border: '1px solid #eee', padding: '10px 2px', marginTop: 8, fontSize: 16, width: '100%' },

  btn: { padding: '10px 14px', borderRadius: 10, border: 'none', background: '#EFEFEF', fontWeight: 700, cursor: 'pointer' },
  btnPrimary: { background: '#0EA5E9', color: '#fff' },

  listRow: { padding: '10px', borderRadius: 10, background: '#F7F7F7', marginTop: 6, cursor: 'pointer' },
  listRowActive: { background: '#E3F2FD' },

  itemTitle: { fontSize: 16, fontWeight: 700 },
  metric: { fontSize: 16, marginBottom: 4 },
  metricVal: { fontWeight: 800 },
};
