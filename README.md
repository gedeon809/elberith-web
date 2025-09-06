# Mini Store Tracker (Vite + React + TS)

Track inventory and sales by **unit** or **kilogram**, with edit/delete, restocking, live stats, backup/restore, and a PWA for Android install & persistence.

## Features
- Add/Edit/Delete **Inventory** and **Sales**
- Track by **unit** or **kg** (per-unit and per-kg pricing)
- Sell by kg or unit; stock auto-decrements; edit sales reconciles stock safely
- Live stats: **sold**, **left**, **revenue**
- **Restock** units/kg anytime
- **Export/Import** JSON backup
- Android persistence boost: uses **StorageManager.persist()** and **PWA install**

---

## Getting Started

### 1) Clone & Install
```bash
git clone <YOUR_REPO_URL> store-tracker
cd store-tracker
pnpm i   # or npm i / yarn
```

### 2) Dev
```bash
pnpm dev   # or npm run dev / yarn dev
```
Open the printed local URL (e.g., http://localhost:5173).

### 3) Build
```bash
pnpm build   # or npm run build / yarn build
pnpm preview # serve the build locally
```

---

## Enable PWA (Installable on Android)

Add these files to your **public/** folder:

- `public/manifest.webmanifest`  ← provided in this repo
- `public/sw.js`                 ← provided in this repo
- `public/icon-192.png`          ← provided in this repo
- `public/icon-512.png`          ← provided in this repo

Then ensure your `index.html` includes:
```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#2563eb" />
```

And your `main.tsx` registers the service worker:
```ts
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
```

The app listens for `beforeinstallprompt` and shows an **Install App** button when the device is eligible. After installing, it shows an **Installed ✓** pill.

> Tip: for Android, test on HTTPS (Vercel/Netlify). `localhost` also works for SW during development.

---

## Deploy (Vercel)

1. Push to GitHub.
2. In Vercel:
   - **New Project** → Import your repo
   - Framework: **Vite** (autodetected)
   - Build Command: `pnpm build` (or npm/yarn equivalent)
   - Output Directory: `dist`
3. Add the **public/** files (manifest, sw, icons) to your repo so they’re deployed.
4. Visit your deployed URL on Android → tap **Install**.

---

## FAQ

### Android clears my data on refresh
We call `navigator.storage.persist()`. Additionally, installing the PWA makes storage less likely to be evicted. You can also use **Export/Import** to back up data manually.

### Reset everything
Use the **Reset Data** button in the header. It clears inventory and sales (and local storage keys).

---

## Scripts
- `dev` – Vite dev server
- `build` – production build
- `preview` – preview the built app
