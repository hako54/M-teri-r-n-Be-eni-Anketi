// Ana ekrana eklenen kısayol ya da arka planda bekleyen sekme öne gelince yeni sürüm var mı bakar.
// Varsa sayfayı yeniler; kişi bir formu dolduruyorsa (ör. anket) yazdıkları kaybolmasın diye yalnızca not gösterir.
(function () {
  var meta = document.querySelector('meta[name="app-version"]');
  if (!meta) return;
  var current = meta.content;
  var dirty = false;
  var checking = false;
  var lastCheck = 0;

  document.addEventListener('input', function (e) { if (e.target.closest('form')) dirty = true; });
  document.addEventListener('submit', function () { dirty = false; });

  function showBar() {
    if (document.getElementById('surum-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'surum-bar';
    bar.className = 'mail-fallback';
    bar.innerHTML = '<span>Uygulamanın yeni sürümü hazır. Formu gönderdikten sonra ya da şimdi yenileyebilirsiniz.</span>';
    var row = document.createElement('div');
    var reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Şimdi yenile';
    reload.addEventListener('click', function () { location.reload(); });
    var later = document.createElement('button');
    later.type = 'button';
    later.textContent = 'Sonra';
    later.addEventListener('click', function () { bar.remove(); });
    row.append(reload, later);
    bar.appendChild(row);
    document.body.appendChild(bar);
  }

  function check() {
    if (checking || Date.now() - lastCheck < 15000) return;
    checking = true;
    lastCheck = Date.now();
    fetch('/surum', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.v || d.v === current) return;
        if (dirty) showBar(); else location.reload();
      })
      .catch(function () { /* çevrimdışı: sonra tekrar denenir */ })
      .then(function () { checking = false; });
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { lastCheck = 0; check(); } });
  window.addEventListener('focus', check);
  setInterval(function () { if (!document.hidden) check(); }, 5 * 60000);
})();
