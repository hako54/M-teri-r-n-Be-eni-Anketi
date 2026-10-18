// "Kopyala" düğmeleri: data-copy ile belirtilen alanın değerini panoya alır.
(function () {
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var field = document.getElementById(btn.getAttribute('data-copy'));
    if (!field) return;
    var label = btn.textContent;
    var done = function () { btn.textContent = 'Kopyalandı'; setTimeout(function () { btn.textContent = label; }, 1500); };
    var fallback = function () { field.select(); try { document.execCommand('copy'); done(); } catch (err) { /* metin seçili kalır */ } };
    if (navigator.clipboard) navigator.clipboard.writeText(field.value).then(done, fallback);
    else fallback();
  });
})();
