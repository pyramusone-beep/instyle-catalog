'use strict';
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var api = {
    get: function (u) { return fetch(u, { headers: { 'Accept': 'application/json' } }).then(json); },
    send: function (u, m, b) { return fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(json); }
  };
  function json(r) { return r.text().then(function (t) { var d = t ? JSON.parse(t) : {}; if (!r.ok) { var e = new Error(d.error || ('HTTP ' + r.status)); e.status = r.status; e.data = d; throw e; } return d; }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  var tT; function toast(m) { var t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tT); tT = setTimeout(function () { t.classList.remove('show'); }, 2800); }

  var PRODUCTS = [], SETTINGS = {}, PENDING = []; // PENDING = validated import rows not yet saved

  /* ------------------------------ boot ------------------------------ */
  api.get('/api/session').then(function (s) {
    $('#whoami') && ($('#whoami').textContent = 'Signed in as ' + s.username);
    if (s.authed) showManager(); else showLogin();
  }).catch(function () { showLogin(); });

  function showLogin() {
    $('#managerView').hidden = true; $('#loginView').hidden = false;
    $('#loginBtn').onclick = doLogin;
    $('#p').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
  }
  function doLogin() {
    $('#loginErr').hidden = true;
    api.send('/api/login', 'POST', { username: $('#u').value, password: $('#p').value })
      .then(function () { location.reload(); })
      .catch(function (e) { $('#loginErr').textContent = e.message; $('#loginErr').hidden = false; });
  }
  function logout() { api.send('/api/logout', 'POST').then(function () { location.reload(); }); }

  function showManager() {
    $('#loginView').hidden = true; $('#managerView').hidden = false;
    $('#logoutBtn').onclick = logout;
    Promise.all([api.get('/api/admin/products'), api.get('/api/admin/settings')])
      .then(function (r) { PRODUCTS = r[0].products || []; SETTINGS = r[1] || {}; renderManager(); })
      .catch(function (e) { if (e.status === 401) return showLogin(); toast('Load failed: ' + e.message); });
  }

  /* ------------------------------ layout ------------------------------ */
  function renderManager() {
    $('#manager').innerHTML =
      settingsPanel() + importPanel() + productsPanel() + saveBar();
    wireSettings(); wireImport(); wireProducts(); wireSaveBar();
    refreshShareUi();
  }

  /* ------------------------------ settings ------------------------------ */
  function settingsPanel() {
    return panel('Messenger link', '',
      '<div class="field"><label>Facebook Messenger link <span class="sub">used by every “Buy from us” button</span></label>' +
      '<input class="tx" id="msg" placeholder="https://m.me/yourpageusername" value="' + esc(SETTINGS.messenger_url || '') + '"></div>' +
      '<button class="btn sm" id="saveMsg">Save messenger link</button>' +
      '<span class="hint" id="msgState" style="margin-left:10px"></span>');
  }
  function wireSettings() {
    $('#saveMsg').onclick = function () {
      api.send('/api/admin/settings', 'PUT', { messenger_url: $('#msg').value.trim() })
        .then(function (d) { SETTINGS.messenger_url = d.messenger_url; toast('Messenger link saved'); })
        .catch(function (e) { toast(e.message); });
    };
  }

  /* ------------------------------ importer ------------------------------ */
  function importPanel() {
    return panel('Bulk importer', '<span class="hint">brand, title, image_url, product_url, price</span>',
      '<div class="tabs" id="impTabs">' +
        tab('manual', 'Manual rows', true) + tab('paste', 'Paste CSV') + tab('file', 'Upload CSV') + tab('shopify', 'Shopify CSV') +
      '</div>' +
      '<div id="impPane"></div>' +
      '<div id="previewWrap"></div>');
  }
  function tab(id, label, on) { return '<button class="tab' + (on ? ' on' : '') + '" data-tab="' + id + '">' + label + '</button>'; }

  function wireImport() {
    var pane = $('#impPane');
    function select(id) {
      $('#impTabs').querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-tab') === id); });
      if (id === 'manual') pane.innerHTML =
        '<p class="hint" style="margin:0 0 10px">Add blank rows and type each product. Then Review.</p>' +
        '<button class="btn sm" id="addRow">+ Add blank row</button> ' +
        '<button class="btn sm" id="dlTemplate">Download blank CSV template</button>';
      else if (id === 'paste') pane.innerHTML =
        '<div class="field"><label>Paste CSV <span class="sub">first line must be the header row</span></label>' +
        '<textarea class="tx" id="csvText" placeholder="brand,title,image_url,product_url,price"></textarea></div>' +
        '<button class="btn sm" id="parsePaste">Review rows</button> ' +
        '<button class="btn sm" id="dlTemplate2">Download blank CSV template</button>';
      else if (id === 'file') pane.innerHTML =
        '<div class="field"><label>Upload a .csv file</label><input class="tx" type="file" id="csvFile" accept=".csv,text/csv"></div>' +
        '<span class="hint">Standard CSV with a header row (brand,title,image_url,product_url,price).</span>';
      else if (id === 'shopify') pane.innerHTML =
        '<div class="banner info">Shopify export: <b>Title→title, Vendor→brand, Image Src→image_url, Variant Price→price</b>, and the <b>Original Product URL</b> metafield column → product_url. Blank Vendor is filled from the product URL’s domain.</div>' +
        '<div class="field"><label>Upload your Shopify products CSV</label><input class="tx" type="file" id="shopFile" accept=".csv,text/csv"></div>' +
        '<div id="statusOpt"></div>';
      bindPaneButtons(id);
    }
    $('#impTabs').querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { select(t.getAttribute('data-tab')); }; });
    select('manual');
  }

  function bindPaneButtons(id) {
    var dl = $('#dlTemplate') || $('#dlTemplate2'); if (dl) dl.onclick = downloadTemplate;
    var dl2 = $('#dlTemplate2'); if (dl2) dl2.onclick = downloadTemplate;
    if (id === 'manual') { $('#addRow').onclick = function () { PENDING.push(blankRow()); renderPreview(); }; if (!PENDING.length) { PENDING.push(blankRow()); } renderPreview(); }
    if (id === 'paste') $('#parsePaste').onclick = function () { ingest(parseCSV($('#csvText').value), false); };
    if (id === 'file') $('#csvFile').onchange = function (e) { readFile(e.target.files[0], function (txt) { ingest(parseCSV(txt), false); }); };
    if (id === 'shopify') $('#shopFile').onchange = function (e) { readFile(e.target.files[0], function (txt) { ingest(parseCSV(txt), true); }); };
  }

  function blankRow() { return { brand: '', title: '', image_url: '', product_url: '', price: '', _errs: [] }; }

  function ingest(rows, shopify) {
    if (!rows.length) { toast('No rows found'); return; }
    var header = rows[0].map(function (h) { return h.trim(); });
    var idx = mapHeader(header, shopify);
    if (idx.title == null || idx.product_url == null) {
      toast(shopify ? 'Could not find Title / Original Product URL columns' : 'CSV needs at least title and product_url columns'); return;
    }
    var mapped = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i]; if (!r.length || r.every(function (c) { return String(c).trim() === ''; })) continue;
      var pu = (r[idx.product_url] || '').trim();
      var brand = idx.brand != null ? (r[idx.brand] || '').trim() : '';
      if (!brand && shopify) brand = brandFromUrl(pu);
      var row = {
        brand: brand,
        title: idx.title != null ? (r[idx.title] || '').trim() : '',
        image_url: idx.image_url != null ? (r[idx.image_url] || '').trim() : '',
        product_url: pu,
        price: idx.price != null ? (r[idx.price] || '').trim() : ''
      };
      if (!row.title && !row.product_url && !row.image_url) continue;
      row._errs = [];
      mapped.push(row);
    }
    // De-dup within the file by product_url (keep last).
    var seen = {}; var out = [];
    mapped.forEach(function (r) { var k = r.product_url.toLowerCase(); if (k && seen[k] != null) out[seen[k]] = r; else { if (k) seen[k] = out.length; out.push(r); } });
    PENDING = out;
    if (shopify) maybeStatusFilter(rows, header);
    renderPreview();
    toast('Loaded ' + PENDING.length + ' rows — review below');
  }

  // Optional Shopify status filter (do NOT auto-exclude drafts).
  function maybeStatusFilter(rows, header) {
    var si = header.findIndex(function (h) { return /^status$/i.test(h.trim()); });
    var pi = header.findIndex(function (h) { return /^published$/i.test(h.trim()); });
    if (si < 0 && pi < 0) { var s = $('#statusOpt'); if (s) s.innerHTML = ''; return; }
    var host = $('#statusOpt'); if (!host) return;
    host.innerHTML = '<div class="banner info" style="margin-top:12px">This file has a status column. All rows are included by default. ' +
      '<label style="display:inline-flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="onlyActive"> Only import rows marked <b>active</b>/published</label></div>';
    $('#onlyActive').onchange = function () {
      var onlyActive = this.checked;
      var kept = [];
      for (var i = 1; i < rows.length; i++) {
        var r = rows[i]; if (r.every(function (c) { return String(c).trim() === ''; })) continue;
        var status = si >= 0 ? String(r[si] || '').toLowerCase() : '';
        var pub = pi >= 0 ? String(r[pi] || '').toLowerCase() : '';
        var active = (status ? status === 'active' : true) && (pub ? (pub === 'true' || pub === 'yes') : true);
        if (onlyActive && !active) continue;
        kept.push(i);
      }
      // rebuild PENDING from kept indices using same mapping
      var idx = mapHeader(header, true), mapped = [];
      kept.forEach(function (i) {
        var r = rows[i]; var pu = (r[idx.product_url] || '').trim();
        var brand = idx.brand != null ? (r[idx.brand] || '').trim() : ''; if (!brand) brand = brandFromUrl(pu);
        mapped.push({ brand: brand, title: (r[idx.title] || '').trim(), image_url: idx.image_url != null ? (r[idx.image_url] || '').trim() : '', product_url: pu, price: idx.price != null ? (r[idx.price] || '').trim() : '', _errs: [] });
      });
      PENDING = mapped; renderPreview(); toast('Now ' + PENDING.length + ' rows');
    };
  }

  /* -------- header mapping -------- */
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function mapHeader(header, shopify) {
    var n = header.map(norm), idx = {};
    function find(cands) { for (var c = 0; c < cands.length; c++) { var k = n.indexOf(cands[c]); if (k > -1) return k; } return null; }
    if (shopify) {
      idx.title = find(['title']);
      idx.brand = find(['vendor']);
      idx.image_url = find(['imagesrc']);
      idx.price = find(['variantprice']);
      // Original Product URL metafield column — its header is long & namespaced.
      idx.product_url = header.findIndex(function (h) { return /original\s*product\s*url/i.test(h) || /original_product_url/i.test(h); });
      if (idx.product_url < 0) idx.product_url = find(['producturl', 'originalproducturl']);
      if (idx.product_url != null && idx.product_url < 0) idx.product_url = null;
    } else {
      idx.brand = find(['brand', 'vendor']);
      idx.title = find(['title', 'name', 'product', 'productname']);
      idx.image_url = find(['imageurl', 'image', 'imagesrc', 'photo']);
      idx.product_url = find(['producturl', 'url', 'link', 'originalproducturl']);
      idx.price = find(['price', 'variantprice', 'usd']);
    }
    return idx;
  }
  function brandFromUrl(u) {
    try { var h = new URL(u).hostname.replace(/^www\./, '').split('.')[0]; return h ? h.charAt(0).toUpperCase() + h.slice(1) : ''; }
    catch (e) { return ''; }
  }

  /* -------- RFC4180 CSV parser (quotes, commas, inch marks, newlines) -------- */
  function parseCSV(text) {
    var rows = [], row = [], f = '', i = 0, q = false; text = String(text || '').replace(/^\uFEFF/, '');
    while (i < text.length) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
        f += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { row.push(f); f = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; continue; }
      f += c; i++;
    }
    if (f.length || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }
  function toCSV(rows) {
    return rows.map(function (r) { return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
  }
  function downloadTemplate() {
    var csv = toCSV([['brand', 'title', 'image_url', 'product_url', 'price'],
      ['True Religion', 'Rocco Skinny Jean 32"', 'https://example.com/img.jpg', 'https://truereligion.com/rocco', '189.00']]);
    downloadFile('catalog-template.csv', csv);
  }
  function downloadFile(name, text) {
    var blob = new Blob([text], { type: 'text/csv' }); var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  function readFile(file, cb) { if (!file) return; var rd = new FileReader(); rd.onload = function () { cb(rd.result); }; rd.onerror = function () { toast('Could not read file'); }; rd.readAsText(file); }

  /* -------- editable preview -------- */
  var HTTPS = /^https:\/\//i;
  function validateRow(r) {
    var e = [];
    if (!r.brand.trim()) e.push('brand');
    if (!r.title.trim()) e.push('title');
    if (!HTTPS.test(r.image_url.trim())) e.push('image_url');
    if (!HTTPS.test(r.product_url.trim())) e.push('product_url');
    return e;
  }
  function renderPreview() {
    var wrap = $('#previewWrap'); if (!wrap) return;
    if (!PENDING.length) { wrap.innerHTML = ''; return; }
    PENDING.forEach(function (r) { r._errs = validateRow(r); });
    var bad = PENDING.filter(function (r) { return r._errs.length; }).length;
    var cols = ['brand', 'title', 'image_url', 'product_url', 'price'];
    wrap.innerHTML =
      '<div style="margin:16px 0 8px" class="hint"><b>' + PENDING.length + '</b> rows to import' + (bad ? ' · <span style="color:var(--danger)"><b>' + bad + '</b> need fixing (highlighted)</span>' : ' · all valid') + '</div>' +
      '<div class="tablewrap"><table><thead><tr>' + cols.map(function (c) { return '<th>' + c + (c !== 'price' ? ' *' : '') + '</th>'; }).join('') + '<th></th></tr></thead><tbody id="pvBody">' +
      PENDING.map(function (r, i) {
        return '<tr data-i="' + i + '">' + cols.map(function (c) {
          var isErr = r._errs.indexOf(c) > -1;
          return '<td' + (isErr ? ' class="err"' : '') + '><input data-c="' + c + '" value="' + esc(r[c]) + '">' + (isErr ? '<div class="rowerr">' + errMsg(c) + '</div>' : '') + '</td>';
        }).join('') + '<td><button class="btn ghost sm" data-rm="' + i + '" title="Remove">✕</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn navy" id="saveImport">Add ' + PENDING.length + ' products to catalog</button>' +
        '<button class="btn ghost sm" id="clearImport">Clear</button></div>';
    // wire edits
    wrap.querySelectorAll('#pvBody input').forEach(function (inp) {
      inp.oninput = function () {
        var tr = inp.closest('tr'), i = +tr.getAttribute('data-i');
        PENDING[i][inp.getAttribute('data-c')] = inp.value;
      };
      inp.onblur = renderPreview;
    });
    wrap.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { PENDING.splice(+b.getAttribute('data-rm'), 1); renderPreview(); }; });
    $('#saveImport').onclick = saveImport;
    $('#clearImport').onclick = function () { PENDING = []; renderPreview(); };
  }
  function errMsg(c) { return c === 'image_url' || c === 'product_url' ? 'must start with https://' : 'required'; }

  function saveImport() {
    PENDING.forEach(function (r) { r._errs = validateRow(r); });
    var valid = PENDING.filter(function (r) { return !r._errs.length; });
    var invalid = PENDING.length - valid.length;
    if (!valid.length) { toast('Fix the highlighted rows first'); return; }
    var rows = valid.map(strip);
    var btn = $('#saveImport'); btn.disabled = true; btn.textContent = 'Saving…';
    batchImport(rows, 100).then(function (res) {
      // keep only the invalid rows in the preview
      PENDING = PENDING.filter(function (r) { return r._errs.length; });
      return api.get('/api/admin/products').then(function (d) { PRODUCTS = d.products || []; });
    }).then(function () {
      toast('Imported ✓' + (invalid ? ' (' + invalid + ' left to fix)' : ''));
      renderManager();
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Add products'; toast('Import failed: ' + e.message); });
  }
  function strip(r) { return { brand: r.brand, title: r.title, image_url: r.image_url, product_url: r.product_url, price: r.price }; }
  function batchImport(rows, size) {
    var i = 0, agg = { created: 0, updated: 0 };
    function next() {
      if (i >= rows.length) return Promise.resolve(agg);
      var slice = rows.slice(i, i + size); i += size;
      return api.send('/api/admin/import', 'POST', { rows: slice }).then(function (r) { agg.created += r.created || 0; agg.updated += r.updated || 0; return next(); });
    }
    return next();
  }

  /* ------------------------------ products list ------------------------------ */
  function productsPanel() {
    var body = PRODUCTS.length
      ? '<div class="tablewrap"><table><thead><tr><th></th><th>Brand</th><th>Title</th><th>Price</th><th>Product URL</th><th></th></tr></thead><tbody>' +
        PRODUCTS.map(function (p) {
          return '<tr>' +
            '<td>' + (p.image_url ? '<img class="thumb" src="' + esc(p.image_url) + '" referrerpolicy="no-referrer" alt="">' : '') + '</td>' +
            '<td>' + esc(p.brand) + '</td><td>' + esc(p.title) + '</td><td>' + esc(p.price || '') + '</td>' +
            '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="' + esc(p.product_url) + '" target="_blank" rel="noopener noreferrer">' + esc(p.product_url) + '</a></td>' +
            '<td style="white-space:nowrap"><button class="btn ghost sm" data-edit="' + p.id + '">Edit</button> <button class="btn ghost sm" data-del="' + p.id + '" style="color:var(--danger)">Remove</button></td>' +
            '</tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="hint">No products yet. Add one, or use the importer above.</div>';
    return panel('Products (' + PRODUCTS.length + ')', '<button class="btn primary sm" id="addProduct">+ Add product</button>', body);
  }
  function wireProducts() {
    $('#addProduct').onclick = function () { editProduct(null); };
    $('#manager').querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { editProduct(PRODUCTS.find(function (p) { return p.id == b.getAttribute('data-edit'); })); }; });
    $('#manager').querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { delProduct(b.getAttribute('data-del')); }; });
  }
  function editProduct(p) {
    p = p || {};
    var fields = [['brand', 'Brand', 'True Religion'], ['title', 'Title', 'Rocco Skinny Jean'], ['image_url', 'Image URL (https)', 'https://…'], ['product_url', 'Product URL (https)', 'https://…'], ['price', 'Price (optional USD)', '189.00']];
    modal((p.id ? 'Edit product' : 'Add product'),
      fields.map(function (f) { return '<div class="field"><label>' + f[1] + (f[0] !== 'price' ? ' *' : '') + '</label><input class="tx" id="e_' + f[0] + '" value="' + esc(p[f[0]] || '') + '" placeholder="' + f[2] + '"></div>'; }).join(''),
      function (close) {
        var rec = {}; fields.forEach(function (f) { rec[f[0]] = $('#e_' + f[0]).value.trim(); });
        api.send('/api/admin/products', 'POST', rec).then(function () { return api.get('/api/admin/products'); })
          .then(function (d) { PRODUCTS = d.products || []; close(); toast(p.id ? 'Updated' : 'Added'); renderManager(); })
          .catch(function (e) { toast(e.message); });
      }, p.id ? 'Save' : 'Add');
  }
  function delProduct(id) {
    var p = PRODUCTS.find(function (x) { return x.id == id; });
    modal('Remove product', '<p>Remove <b>' + esc(p ? p.title : 'this product') + '</b> from the catalog?</p>', function (close) {
      api.send('/api/admin/products/' + id, 'DELETE').then(function () { PRODUCTS = PRODUCTS.filter(function (x) { return x.id != id; }); close(); toast('Removed'); renderManager(); }).catch(function (e) { toast(e.message); });
    }, 'Remove');
  }

  /* ------------------------------ save & share ------------------------------ */
  function saveBar() {
    return '<div class="savebar">' +
      '<div><div style="font-family:var(--disp);font-size:17px">Customer link</div>' +
      '<div class="status" id="shareStatus">The link customers open — the main address shows nothing.</div></div>' +
      '<div class="grow"></div>' +
      '<div class="share" id="shareRow" style="flex:1 1 320px"></div>' +
      '<button class="btn primary" id="saveShare">Save &amp; create customer link</button>' +
      '</div>';
  }
  function wireSaveBar() { $('#saveShare').onclick = saveAndShare; }
  function refreshShareUi() {
    var row = $('#shareRow'); if (!row) return;
    if (SETTINGS.share_url) {
      row.innerHTML = '<input id="shareUrl" readonly value="' + esc(SETTINGS.share_url) + '">' +
        '<button class="btn sm" id="copyShare">Copy</button>' +
        '<button class="btn ghost sm" id="openShare">Open</button>' +
        '<button class="btn ghost sm" id="resetShare" style="color:var(--danger)">Reset</button>';
      $('#copyShare').onclick = function () { copy(SETTINGS.share_url); };
      $('#openShare').onclick = function () { window.open(SETTINGS.share_url, '_blank', 'noopener'); };
      $('#resetShare').onclick = resetShare;
    } else {
      row.innerHTML = '<span class="hint">No link yet — click “Save &amp; create customer link”.</span>';
    }
  }
  function saveAndShare() {
    var btn = $('#saveShare'); btn.disabled = true; btn.textContent = 'Saving…';
    // flush any valid pending import rows too
    var pend = PENDING.filter(function (r) { return !validateRow(r).length; }).map(strip);
    api.send('/api/admin/share-link', 'POST', { rows: pend })
      .then(function (d) {
        SETTINGS.share_url = d.share_url;
        if (pend.length) { PENDING = PENDING.filter(function (r) { return validateRow(r).length; }); return api.get('/api/admin/products').then(function (x) { PRODUCTS = x.products || []; }); }
      })
      .then(function () { renderManager(); copy(SETTINGS.share_url); toast('Saved — link copied'); })
      .catch(function (e) { btn.disabled = false; btn.textContent = 'Save & create customer link'; toast(e.message); });
  }
  function resetShare() {
    modal('Reset customer link', '<p>This creates a brand-new link and <b>breaks the old one</b> immediately. Anyone with the old link loses access. Continue?</p>', function (close) {
      api.send('/api/admin/reset-link', 'POST').then(function (d) { SETTINGS.share_url = d.share_url; close(); renderManager(); toast('New link created'); }).catch(function (e) { toast(e.message); });
    }, 'Reset link');
  }

  /* ------------------------------ ui helpers ------------------------------ */
  function panel(title, right, body) {
    return '<section class="panel"><div class="ph"><h2>' + esc(title) + '</h2><div class="grow"></div>' + (right || '') + '</div><div class="pb">' + body + '</div></section>';
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { toast('Link copied'); }).catch(fb); }
    else fb();
    function fb() { var i = $('#shareUrl'); if (i) { i.focus(); i.select(); try { document.execCommand('copy'); toast('Link copied'); return; } catch (e) {} } toast('Select the link to copy'); }
  }
  function modal(title, bodyHtml, onOk, okLabel) {
    var s = document.createElement('div');
    s.style.cssText = 'position:fixed;inset:0;background:rgba(15,24,40,.5);display:flex;align-items:flex-start;justify-content:center;padding:30px 16px;z-index:80;overflow-y:auto';
    s.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:520px;width:100%;box-shadow:0 24px 70px rgba(0,0,0,.3)">' +
      '<div style="padding:16px 20px;border-bottom:1px solid var(--line);font-family:var(--disp);font-size:19px">' + esc(title) + '</div>' +
      '<div style="padding:20px">' + bodyHtml + '</div>' +
      '<div style="padding:14px 20px;border-top:1px solid var(--line);display:flex;gap:8px;justify-content:flex-end">' +
      '<button class="btn ghost" data-x>Cancel</button><button class="btn primary" data-ok>' + esc(okLabel || 'OK') + '</button></div></div>';
    document.body.appendChild(s);
    function close() { s.remove(); }
    s.addEventListener('mousedown', function (e) { if (e.target === s) close(); });
    s.querySelector('[data-x]').onclick = close;
    s.querySelector('[data-ok]').onclick = function () { onOk(close); };
    return close;
  }
})();
