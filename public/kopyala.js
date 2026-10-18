// "Kopyala" düğmeleri: data-copy ile belirtilen alanın değerini panoya alır.
// data-copy-html: alanın değerini biçimli (HTML) olarak kopyalar; data-then varsa ardından o linki (Outlook) açar.
(function () {
  function flash(btn, text) {
    var label = btn.textContent;
    btn.textContent = text;
    setTimeout(function () { btn.textContent = label; }, 1800);
  }

  function copyHtml(htmlText) {
    if (!navigator.clipboard || !window.ClipboardItem) return Promise.reject(new Error('desteklenmiyor'));
    var tmp = document.createElement('div');
    tmp.innerHTML = htmlText;
    var item = new ClipboardItem({
      'text/html': new Blob([htmlText], { type: 'text/html' }),
      'text/plain': new Blob([tmp.innerText], { type: 'text/plain' }),
    });
    return navigator.clipboard.write([item]);
  }

  document.addEventListener('click', function (e) {
    var htmlBtn = e.target.closest('[data-copy-html]');
    if (htmlBtn) {
      var source = document.getElementById(htmlBtn.getAttribute('data-copy-html'));
      var then = htmlBtn.getAttribute('data-then');
      var ping = htmlBtn.getAttribute('data-ping');
      var go = function () {
        if (ping) fetch(ping, { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(function () {});
        if (then) window.location.href = then;
      };
      copyHtml(source ? source.value : '').then(function () { flash(htmlBtn, 'Rapor kopyalandı, Outlook açılıyor…'); go(); }, go);
      return;
    }

    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var field = document.getElementById(btn.getAttribute('data-copy'));
    if (!field) return;
    var done = function () { flash(btn, 'Kopyalandı'); };
    var fallback = function () { field.select(); try { document.execCommand('copy'); done(); } catch (err) { /* metin seçili kalır */ } };
    if (navigator.clipboard) navigator.clipboard.writeText(field.value).then(done, fallback);
    else fallback();
  });
})();

// Sonuç maili: telefonda paylaşım menüsü (dosyalarla) varsa onu öne çıkarır, yoksa bilgisayar yolunu gösterir.
(function () {
  var phone = document.querySelector('[data-device="phone"]');
  var shareBtn = document.querySelector('[data-share]');
  if (!phone || !shareBtn) return;
  var probe;
  try { probe = new File(['x'], 'x.png', { type: 'image/png' }); } catch (e) { return; }
  var canShareFiles = navigator.canShare && navigator.canShare({ files: [probe] });
  var isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (!canShareFiles) return;
  phone.hidden = false;
  if (isTouch) phone.parentNode.insertBefore(phone, document.querySelector('[data-device="pc"]'));

  shareBtn.addEventListener('click', function () {
    var id = shareBtn.getAttribute('data-share');
    var label = shareBtn.textContent;
    shareBtn.textContent = 'Hazırlanıyor…';
    var get = function (url, name, type) {
      return fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.blob(); })
        .then(function (b) { return new File([b], name, { type: type }); });
    };
    Promise.all([
      get('/anketler/' + id + '/rapor.png', 'anket-sonucu.png', 'image/png'),
      get('/anketler/' + id + '/sonuclar.csv', 'sonuclar.csv', 'text/csv'),
      get('/anketler/' + id + '/yorumlar.csv', 'yorumlar.csv', 'text/csv'),
    ]).then(function (files) {
      shareBtn.textContent = label;
      var title = shareBtn.getAttribute('data-title');
      return navigator.share({ files: files, title: title, text: title });
    }).then(function () {
      fetch(shareBtn.getAttribute('data-ping'), { method: 'POST', credentials: 'same-origin' }).catch(function () {});
    }).catch(function () { shareBtn.textContent = label; });
  });
})();

// Bağlantılı düğmelerde (Outlook taslağı) tıklanınca "açıldı" bilgisini kaydeder.
document.addEventListener('click', function (e) {
  var a = e.target.closest('a[data-ping]');
  if (a) fetch(a.getAttribute('data-ping'), { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(function () {});
});
