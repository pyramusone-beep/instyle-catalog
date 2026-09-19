# Instyle Outfitters — Private Product Catalog

A private, link-gated product catalog for showing US-brand products to customers in
the Philippines. Customers browse a mobile-friendly page **only** if they have your
secret link; the main address reveals nothing and search engines are blocked. Only
you can sign in to add, edit, import, and remove products.

Every access control is enforced **on the server** — none of it relies on hiding
things in the browser.

---

## What you get

- **Customer catalog** at `/c/<token>` — brand, title, optional USD price, the
  original product URL above the image, and two buttons: **See details** (opens the
  brand's site in a new tab) and **Buy from us** (opens your Messenger). Filter by brand.
- **Owner manager** at `/admin` — sign in, set the Messenger link once, add/edit/remove
  products, bulk-import (manual rows, CSV paste, CSV upload, blank template, or a
  **Shopify** export), review an editable preview, and a **Save & create customer link**
  button that stores changes and gives you a copyable link.
- **SQLite** storage (one file) so data persists across devices and restarts.

---

## 1. Requirements

- **Node.js 18 or newer** (built and tested on Node 22). Check: `node --version`.

## 2. Install

```bash
cd instyle-catalog
npm install
```

## 3. Configure the owner account and settings

Copy the example env file and edit it:

```bash
cp .env.example .env
```

Set at least these in `.env`:

```
OWNER_USERNAME=owner
OWNER_PASSWORD=your-strong-password-here
```

- `OWNER_USERNAME` / `OWNER_PASSWORD` — your sign-in. The password is hashed (scrypt);
  the plain value is never stored. There is **no signup page**, so no anonymous visitor
  can ever claim ownership. Change the password anytime by editing `.env` and restarting.
- `SESSION_SECRET` — optional; if left blank a strong secret is generated and saved
  automatically so your login stays valid across restarts.
- `BASE_URL` — set in production to your public URL (e.g. `https://catalog.yourdomain.com`)
  so the customer link is built correctly. Leave blank for local testing.
- `NODE_ENV=production` — set once deployed behind HTTPS; enables Secure cookies.
- `PORT` — defaults to `3000`. `DATA_DIR` — where the SQLite file lives (default `./data`).

> If you start without `OWNER_PASSWORD`, the server prints a **temporary random
> password** in its console once. Set your own in `.env` as soon as possible.

## 4. Run

```bash
npm start
```

Open **http://localhost:3000/admin** and sign in.

- The root URL `http://localhost:3000/` deliberately shows "not available".
- Set your **Messenger link** (e.g. `https://m.me/YourPageUsername`).
- Add a product or import a CSV.
- Click **Save & create customer link** at the bottom, then **Copy** the link.
- Open that `/c/<token>` link in a private/incognito window to see the customer view.

---

## 5. Importing products

Open the **Bulk importer** in the manager. Required fields: `brand, title, image_url,
product_url`. `price` is optional. `image_url` and `product_url` must be `https://`.

- **Manual rows** — add blank rows and type; edit inline in the preview.
- **Paste CSV** — paste rows whose first line is the header.
- **Upload CSV** — choose a `.csv` file. Quoted values, commas, and inch marks in titles
  (e.g. `Rocco Skinny 32"`) are handled correctly.
- **Download blank CSV template** — get a correctly-formatted starter file.
- **Shopify CSV** — upload a Shopify product export. Columns are mapped automatically:
  `Title→title`, `Vendor→brand`, `Image Src→image_url`, `Variant Price→price`, and the
  **Original Product URL** metafield column → `product_url`. If `Vendor` is blank, the
  brand is derived from the product URL's domain. If the file has a `Status`/`Published`
  column, all rows are imported by default and you're offered an optional
  "only active/published" filter — **draft is not auto-excluded**.

Every row is shown in an **editable preview** and validated before saving; rows with
problems are highlighted with the reason. `product_url` is the unique key, so importing
the same URL again **updates** that product instead of creating a duplicate. Large files
are saved to the server in safe batches of 100.

---

## 6. Sharing safely

- The customer link uses a long, unguessable token, validated on the server on every
  request. Opening the main address (or a wrong token) never returns products.
- Anyone you forward a valid link to can view it — that's the intended behavior.
- **Reset** (in the save bar) issues a new link and **immediately breaks the old one**.
- `noindex`, `robots.txt` (disallow all), and `Referrer-Policy: no-referrer` keep the
  catalog out of search engines and stop the token leaking to brand sites via referrers.

---

## 7. Deploy

The app needs a host that keeps a **persistent disk** for the SQLite file (Render,
Railway, Fly.io, or any VPS). Platforms with an ephemeral/read-only filesystem
(e.g. plain Vercel/Netlify functions) won't persist the database without an external
volume or DB.

General steps (any Node host):

```bash
# on the server
git clone <your repo>   # or upload the folder
cd instyle-catalog
npm install --omit=dev
# set env vars in the host's dashboard (or a .env file):
#   OWNER_USERNAME, OWNER_PASSWORD, BASE_URL=https://your-domain, NODE_ENV=production
npm start
```

Point your domain at the host, make sure it's served over **HTTPS**, and set
`BASE_URL` to that HTTPS domain so customer links are correct. Give the process a
persistent directory and set `DATA_DIR` to it if the default `./data` isn't durable.

### Example: run under systemd on a VPS

```ini
# /etc/systemd/system/instyle-catalog.service
[Service]
WorkingDirectory=/opt/instyle-catalog
ExecStart=/usr/bin/node server.js
Environment=NODE_ENV=production
Environment=BASE_URL=https://catalog.yourdomain.com
Environment=OWNER_USERNAME=owner
Environment=OWNER_PASSWORD=your-strong-password
Restart=always
[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now instyle-catalog
```

Put Nginx/Caddy in front for HTTPS. (Caddy gives you automatic certificates.)

---

## 8. How the security works (summary)

| Control | Where enforced |
|---|---|
| Customer link required to see products | Server validates token on `/c/:token` **and** `/api/catalog` |
| Owner-only writes | Signed `HttpOnly` session cookie checked on every `/api/admin/*` write |
| No anonymous ownership | Credentials come from env/first-boot only; no signup route |
| Not indexed / no referrer leak | `noindex` headers + `robots.txt` + `Referrer-Policy: no-referrer` + `rel="noopener noreferrer"` on outbound links |
| Passwords | scrypt hash; plaintext never stored |

## 9. Project layout

```
instyle-catalog/
  server.js            Express app: auth, token validation, admin API, catalog API
  db.js                SQLite schema + queries (upsert by product_url)
  public/
    admin.html/js      Owner manager (login, CRUD, importer, save & link)
    catalog.html/js    Customer catalog (token-gated)
    styles.css         Shared styles
  .env.example         Copy to .env and fill in
  README.md
```

## 10. Common tasks

- **Change owner password:** edit `OWNER_PASSWORD` in `.env`, restart.
- **Rotate the customer link:** manager → save bar → **Reset**.
- **Back up your data:** copy the `data/` folder (contains `catalog.db`).
- **Move hosts:** copy `data/catalog.db` to the new server's `DATA_DIR`.
