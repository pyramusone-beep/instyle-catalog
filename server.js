'use strict';
/*
 * Instyle Outfitters — private product catalog server.
 *
 * Security model (all enforced server-side, not in the browser):
 *   - Customers reach the catalog only via /c/<token>. The token is validated
 *     on the server for BOTH the page route and the data API. No valid token
 *     => no page, no data. Client code never decides visibility.
 *   - The owner signs in with a username + password configured out-of-band
 *     (env or first-boot generated). There is NO signup route, so an anonymous
 *     visitor can never "claim" ownership.
 *   - Every admin write requires a valid signed session cookie.
 *   - noindex + robots.txt + Referrer-Policy: no-referrer keep the catalog out
 *     of search engines and stop the share token leaking to brand sites.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Minimal .env loader (no dependency). Real env vars always win.
(function loadEnv() {
  try {
    const p = path.join(__dirname, '.env');
    if (!fs.existsSync(p)) return;
    fs.readFileSync(p, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) return;
      let v = m[2].replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    });
  } catch (e) { /* ignore */ }
})();

const express = require('express');
const store = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.set('trust proxy', 1); // correct req.protocol behind a host's proxy

/* ------------------------------------------------------------------ */
/* Owner credential + session secret (bootstrapped once, at startup)   */
/* ------------------------------------------------------------------ */
const OWNER_USERNAME = (process.env.OWNER_USERNAME || store.getSetting('owner_username') || 'owner').trim();
store.setSetting('owner_username', OWNER_USERNAME);

// Password: env wins (re-hashed on every boot); else use stored hash; else generate.
if (process.env.OWNER_PASSWORD) {
  store.setSetting('owner_password_hash', store.hashPassword(process.env.OWNER_PASSWORD));
} else if (!store.getSetting('owner_password_hash')) {
  const generated = crypto.randomBytes(9).toString('base64url');
  store.setSetting('owner_password_hash', store.hashPassword(generated));
  console.log('\n============================================================');
  console.log('  No OWNER_PASSWORD set. Generated a temporary owner password:');
  console.log('     username: ' + OWNER_USERNAME);
  console.log('     password: ' + generated);
  console.log('  Set OWNER_PASSWORD in your .env to choose your own.');
  console.log('============================================================\n');
}

// Session signing secret: env, else stored, else generated + persisted.
let SESSION_SECRET = process.env.SESSION_SECRET || store.getSetting('session_secret');
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  store.setSetting('session_secret', SESSION_SECRET);
}
const PROD = process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function signSession(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySession(cookie) {
  if (!cookie || cookie.indexOf('.') < 0) return null;
  const [payload, mac] = cookie.split('.');
  const good = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}
function parseCookies(req) {
  const out = {}; const h = req.headers.cookie;
  if (!h) return out;
  h.split(';').forEach(kv => { const i = kv.indexOf('='); if (i > -1) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim()); });
  return out;
}
function requireOwner(req, res, next) {
  const sess = verifySession(parseCookies(req)['sid']);
  if (!sess) return res.status(401).json({ error: 'Not signed in' });
  req.owner = sess; next();
}

/* ------------------------------------------------------------------ */
/* Global middleware                                                    */
/* ------------------------------------------------------------------ */
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; connect-src 'self'; " +
    "base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  next();
});
const noIndex = (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); };

/* ------------------------------------------------------------------ */
/* Share token helpers                                                  */
/* ------------------------------------------------------------------ */
function currentToken() { return store.getSetting('share_token'); }
function ensureToken() {
  let t = currentToken();
  if (!t) { t = crypto.randomBytes(24).toString('base64url'); store.setSetting('share_token', t); } // ~32 chars, unguessable
  return t;
}
function tokenValid(t) {
  const cur = currentToken();
  if (!cur || !t) return false;
  const a = Buffer.from(String(t)); const b = Buffer.from(cur);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
function brandsOf(products) {
  return [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/* ------------------------------------------------------------------ */
/* Static assets (js/css only — never the HTML entry points directly)  */
/* ------------------------------------------------------------------ */
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
app.use('/assets', noIndex, express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: (res) => res.setHeader('X-Robots-Tag', 'noindex, nofollow')
}));

/* ------------------------------------------------------------------ */
/* Root — deliberately reveals nothing                                  */
/* ------------------------------------------------------------------ */
app.get('/', noIndex, (req, res) => {
  res.status(200).type('html').send(
    '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Not available</title>' +
    '<body style="font-family:system-ui;background:#0f1420;color:#8b93a7;display:grid;place-items:center;height:100vh;margin:0">' +
    '<p>This site isn’t publicly available.</p>');
});

/* ------------------------------------------------------------------ */
/* Auth API                                                             */
/* ------------------------------------------------------------------ */
const loginHits = new Map(); // tiny in-memory throttle
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'x';
  const rec = loginHits.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n >= 10) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });

  const { username, password } = req.body || {};
  const hash = store.getSetting('owner_password_hash');
  const ok = username === OWNER_USERNAME && hash && store.verifyPassword(password || '', hash);
  if (!ok) { rec.n++; loginHits.set(ip, rec); return res.status(401).json({ error: 'Wrong username or password' }); }

  loginHits.delete(ip);
  res.setHeader('Set-Cookie',
    `sid=${signSession(OWNER_USERNAME)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}` +
    (PROD ? '; Secure' : ''));
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/session', (req, res) => {
  res.json({ authed: !!verifySession(parseCookies(req)['sid']), username: OWNER_USERNAME });
});

/* ------------------------------------------------------------------ */
/* Customer catalog — page + data, both token-gated on the server      */
/* ------------------------------------------------------------------ */
app.get('/c/:token', noIndex, (req, res) => {
  if (!tokenValid(req.params.token)) {
    return res.status(404).type('html').send(
      '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">' +
      '<title>Not found</title><body style="font-family:system-ui;background:#0f1420;color:#8b93a7;' +
      'display:grid;place-items:center;height:100vh;margin:0"><p>This link isn’t valid.</p>');
  }
  res.sendFile(path.join(__dirname, 'public', 'catalog.html'));
});

app.get('/api/catalog', noIndex, (req, res) => {
  if (!tokenValid(req.query.token)) return res.status(403).json({ error: 'Invalid or missing link' });
  const products = store.allProducts();
  res.json({
    products: products.map(p => ({
      brand: p.brand, title: p.title, image_url: p.image_url,
      product_url: p.product_url, price: p.price
    })),
    brands: brandsOf(products),
    messenger_url: store.getSetting('messenger_url', '')
  });
});

/* ------------------------------------------------------------------ */
/* Admin manager — page + protected write API                          */
/* ------------------------------------------------------------------ */
app.get('/admin', noIndex, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/admin/products', requireOwner, (req, res) => res.json({ products: store.allProducts() }));

function validateProduct(p) {
  const errs = [];
  const brand = (p.brand || '').trim();
  const title = (p.title || '').trim();
  const image_url = (p.image_url || '').trim();
  const product_url = (p.product_url || '').trim();
  if (!brand) errs.push('brand is required');
  if (!title) errs.push('title is required');
  if (!/^https:\/\//i.test(image_url)) errs.push('image_url must be an https:// URL');
  if (!/^https:\/\//i.test(product_url)) errs.push('product_url must be an https:// URL');
  return { errs, clean: { brand, title, image_url, product_url, price: (p.price == null ? '' : String(p.price)).trim() } };
}

app.post('/api/admin/products', requireOwner, (req, res) => {
  const { errs, clean } = validateProduct(req.body || {});
  if (errs.length) return res.status(400).json({ error: errs.join('; ') });
  res.json({ product: store.upsertProduct(clean) });
});

app.delete('/api/admin/products/:id', requireOwner, (req, res) => {
  const ok = store.deleteProduct(Number(req.params.id));
  res.status(ok ? 200 : 404).json({ ok });
});

// Batch import. Body: { rows:[{brand,title,image_url,product_url,price}] }
// Rows are validated server-side; the response reports per-row errors by index.
app.post('/api/admin/import', requireOwner, (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'rows[] required' });
  if (rows.length > 500) return res.status(413).json({ error: 'Send at most 500 rows per batch' });
  const good = []; const rowErrors = [];
  rows.forEach((r, i) => {
    const { errs, clean } = validateProduct(r);
    if (errs.length) rowErrors.push({ index: i, product_url: (r.product_url || '').trim(), errors: errs });
    else good.push(clean);
  });
  if (good.length === 0) return res.status(400).json({ error: 'No valid rows', rowErrors, created: 0, updated: 0 });
  const { created, updated } = store.importBatch(good);
  res.json({ created, updated, skipped: rowErrors.length, rowErrors });
});

app.get('/api/admin/settings', requireOwner, (req, res) => {
  const token = currentToken();
  res.json({
    messenger_url: store.getSetting('messenger_url', ''),
    has_link: !!token,
    share_url: token ? `${baseUrl(req)}/c/${token}` : null,
    admin_url: `${baseUrl(req)}/admin`
  });
});

app.put('/api/admin/settings', requireOwner, (req, res) => {
  const m = (req.body && req.body.messenger_url != null) ? String(req.body.messenger_url).trim() : null;
  if (m !== null) {
    if (m && !/^https:\/\//i.test(m)) return res.status(400).json({ error: 'Messenger link must be an https:// URL' });
    store.setSetting('messenger_url', m);
  }
  res.json({ ok: true, messenger_url: store.getSetting('messenger_url', '') });
});

// Save any pending rows the client passes, ensure a token exists, return the link.
app.post('/api/admin/share-link', requireOwner, (req, res) => {
  let created = 0, updated = 0, rowErrors = [];
  const rows = req.body && Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length) {
    const good = [];
    rows.forEach((r, i) => { const v = validateProduct(r); if (v.errs.length) rowErrors.push({ index: i, errors: v.errs }); else good.push(v.clean); });
    if (good.length) ({ created, updated } = store.importBatch(good));
  }
  const token = ensureToken();
  res.json({ share_url: `${baseUrl(req)}/c/${token}`, created, updated, rowErrors });
});

// Rotate the token — old customer links stop working immediately.
app.post('/api/admin/reset-link', requireOwner, (req, res) => {
  const t = crypto.randomBytes(24).toString('base64url');
  store.setSetting('share_token', t);
  res.json({ share_url: `${baseUrl(req)}/c/${t}` });
});

app.listen(PORT, () => console.log(`Instyle catalog running on http://localhost:${PORT}  (admin: /admin)`));
