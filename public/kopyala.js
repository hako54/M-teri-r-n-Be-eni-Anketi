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
