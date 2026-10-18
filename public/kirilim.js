// Alt kırılımlı seçim: bir seviye değişince alttaki seviyeler sıfırlanır ve yeni seçenekler sunucudan gelir.
(function () {
  var box = document.getElementById('kirilim');
  if (!box) return;
  var selects = Array.prototype.slice.call(box.querySelectorAll('select'));

  function fill(select, options, placeholder) {
    select.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.textContent = o;
      select.appendChild(opt);
    });
    select.disabled = !options.length;
  }

  box.addEventListener('change', function (e) {
    var level = Number(e.target.getAttribute('data-level'));
    var prefix = selects.slice(0, level + 1).map(function (s) { return s.value; });
    selects.slice(level + 1).forEach(function (s) { fill(s, [], 'Önce üst seviyeyi seçin'); });
    var next = selects[level + 1];
    if (!next || !e.target.value) return;
    fill(next, [], 'Yükleniyor…');
    var qs = prefix.map(function (p) { return 'p=' + encodeURIComponent(p); }).join('&');
    fetch('/kirilim?' + qs, { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { fill(next, d.options, d.options.length ? 'Seçin' : 'Alt kırılım yok'); })
      .catch(function () { fill(next, [], 'Liste alınamadı, sayfayı yenileyin'); });
  });
})();
