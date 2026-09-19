'use strict';
/*
 * Data layer — SQLite (better-sqlite3).
 * One file on disk (data/catalog.db) => products, settings, and the owner
 * credential live server-side and persist across restarts and devices.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'catalog.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    brand       TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    image_url   TEXT NOT NULL DEFAULT '',
    product_url TEXT NOT NULL UNIQUE,
    price       TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

/* ---- settings ---- */
const _getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const _setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
function getSetting(key, fallback = null) {
  const row = _getSetting.get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) { _setSetting.run(key, String(value)); }

/* ---- products ---- */
const _all = db.prepare('SELECT * FROM products ORDER BY brand COLLATE NOCASE, title COLLATE NOCASE');
const _byUrl = db.prepare('SELECT * FROM products WHERE product_url = ?');
const _del = db.prepare('DELETE FROM products WHERE id = ?');
const _upsert = db.prepare(`
  INSERT INTO products (brand, title, image_url, product_url, price, created_at, updated_at)
  VALUES (@brand, @title, @image_url, @product_url, @price, @now, @now)
  ON CONFLICT(product_url) DO UPDATE SET
    brand=excluded.brand, title=excluded.title, image_url=excluded.image_url,
    price=excluded.price, updated_at=excluded.updated_at
`);

function allProducts() { return _all.all(); }

function upsertProduct(p) {
  const now = Date.now();
  const row = {
    brand: (p.brand || '').trim(),
    title: (p.title || '').trim(),
    image_url: (p.image_url || '').trim(),
    product_url: (p.product_url || '').trim(),
    price: (p.price == null ? '' : String(p.price)).trim(),
    now
  };
  _upsert.run(row);
  return _byUrl.get(row.product_url);
}

// Upsert many rows inside a single transaction (used per network batch).
const _upsertMany = db.transaction((rows) => {
  let created = 0, updated = 0;
  for (const p of rows) {
    const existed = !!_byUrl.get((p.product_url || '').trim());
    upsertProduct(p);
    if (existed) updated++; else created++;
  }
  return { created, updated };
});
function importBatch(rows) { return _upsertMany(rows); }

function deleteProduct(id) { return _del.run(id).changes > 0; }

/* ---- owner credential ---- */
// scrypt hash, stored as scrypt$<saltHex>$<hashHex>
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, saltHex, hashHex] = stored.split('$');
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const got = crypto.scryptSync(String(pw), salt, expected.length);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch { return false; }
}

module.exports = {
  db, getSetting, setSetting,
  allProducts, upsertProduct, importBatch, deleteProduct,
  hashPassword, verifyPassword,
  DATA_DIR
};
