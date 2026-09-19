'use strict';
(function () {
  var token = decodeURIComponent((location.pathname.match(/\/c\/([^\/?#]+)/) || [])[1] || '');
  var grid = document.getElementById('grid');
  var stateEl = document.getElementById('state');
  var filters = document.getElementById('filters');
  var chipsEl = document.getElementById('chips');
  var ALL = [], brand = 'All', messenger = '';

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
  function state(lg, p){ grid.innerHTML=''; stateEl.hidden=false; stateEl.innerHTML='<div class="lg">'+esc(lg)+'</div>'+(p?'<p>'+esc(p)+'</p>':''); }

  function shortUrl(u){ try{ var x=new URL(u); return (x.hostname.replace(/^www\./,'')) + x.pathname; }catch(e){ return u; } }

  function render(){
    var items = brand==='All' ? ALL : ALL.filter(function(p){ return p.brand===brand; });
    if(!items.length){ state('Nothing here yet','Check back soon — new items are added often.'); return; }
    stateEl.hidden=true;
    grid.innerHTML = items.map(function(p){
      var img = p.image_url ? '<img src="'+esc(p.image_url)+'" alt="'+esc(p.title)+'" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML=\'<span class=&quot;ph&quot;>No image</span>\'">' : '<span class="ph">No image</span>';
      var det = p.product_url ? '<a class="det" href="'+esc(p.product_url)+'" target="_blank" rel="noopener noreferrer nofollow">See details</a>' : '';
      var buy = messenger ? '<a class="buy" href="'+esc(messenger)+'" target="_blank" rel="noopener noreferrer nofollow">Buy from us</a>' : '';
      return '<article class="card">'+
        (p.product_url ? '<div class="url" title="'+esc(p.product_url)+'">'+esc(shortUrl(p.product_url))+'</div>' : '')+
        '<div class="imgbox">'+img+'</div>'+
        '<div class="body">'+
          (p.brand ? '<div class="brand">'+esc(p.brand)+'</div>' : '')+
          '<div class="title">'+esc(p.title)+'</div>'+
          (p.price ? '<div class="price">'+formatPrice(p.price)+'</div>' : '')+
          ((det||buy) ? '<div class="btns">'+det+buy+'</div>' : '')+
        '</div></article>';
    }).join('');
  }
  function formatPrice(v){ var n=parseFloat(String(v).replace(/[^0-9.]/g,'')); if(!isNaN(n) && /^[\s$]*[\d.,]+\s*$/.test(String(v))) return '$'+n.toFixed(2)+' USD'; return esc(v); }

  function renderChips(brands){
    if(!brands.length){ filters.hidden=true; return; }
    filters.hidden=false;
    var all=['All'].concat(brands);
    chipsEl.innerHTML = all.map(function(b){ return '<button class="chip'+(b===brand?' on':'')+'" data-b="'+esc(b)+'">'+esc(b)+'</button>'; }).join('');
    chipsEl.querySelectorAll('.chip').forEach(function(c){ c.addEventListener('click', function(){ brand=c.getAttribute('data-b'); renderChips(brands); render(); window.scrollTo({top:0,behavior:'smooth'}); }); });
  }

  if(!token){ state('This link isn’t valid','Ask Instyle Outfitters for a current catalog link.'); return; }
  fetch('/api/catalog?token='+encodeURIComponent(token), { headers:{ 'Accept':'application/json' } })
    .then(function(r){ if(r.status===403) throw new Error('invalid'); if(!r.ok) throw new Error('net'); return r.json(); })
    .then(function(d){
      ALL = d.products || []; messenger = d.messenger_url || '';
      renderChips(d.brands || []);
      render();
    })
    .catch(function(e){
      if(e.message==='invalid') state('This link isn’t valid','It may have been reset. Ask Instyle Outfitters for a current link.');
      else state('Couldn’t load the catalog','Please check your connection and try again.');
    });
})();
