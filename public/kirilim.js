// Alt kırılımlı, aranabilir seçim. Her seviye için gerçek <select> formda kalır (gönderilen değer odur);
// yerine içine yazılabilen tek bir alan çizilir. Bir seviye değişince alttakiler sıfırlanır ve
// yeni seçenekler sunucudan gelir.
(function () {
  var box = document.getElementById('kirilim');
  if (!box) return;
  var selects = Array.prototype.slice.call(box.querySelectorAll('select'));

  // Türkçe büyük/küçük harf ve şapkasız yazım fark etmesin: "sapka" -> "ŞAPKA".
  function fold(s) {
    return String(s).toLocaleLowerCase('tr')
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Tek alan: liste görünümünde, içine yazılabilen kutu. Dokununca seçenekler açılır, yazdıkça daralır.
  function combo(select) {
    // Gerçek liste formda kalır ama hiç görünmez (stil dosyası gecikse de iki alan çıkmasın diye satır içi).
    select.style.display = 'none';
    select.tabIndex = -1;
    var wrap = document.createElement('div');
    wrap.className = 'combo';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'combo-input';
    input.autocomplete = 'off';
    input.setAttribute('autocapitalize', 'characters');
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    if (select.id) { input.id = select.id + '-ara'; var lbl = select.closest('label'); if (lbl) lbl.htmlFor = input.id; }
    var list = document.createElement('ul');
    list.className = 'combo-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.append(input, list);
    select.parentNode.insertBefore(wrap, select.nextSibling);

    var active = -1;
    var typing = false;

    function options() {
      return Array.prototype.filter.call(select.options, function (o) { return o.value; });
    }
    function selectedText() {
      var o = select.selectedOptions[0];
      return o && o.value ? o.textContent : '';
    }

    function sync() {
      input.value = selectedText();
      input.placeholder = select.options[0] ? select.options[0].textContent : '';
      input.disabled = select.disabled;
    }

    function render() {
      var q = typing ? fold(input.value.trim()) : '';
      list.innerHTML = '';
      var shown = 0;
      options().forEach(function (o) {
        if (q && fold(o.textContent).indexOf(q) < 0) return;
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = o.textContent;
        li.dataset.value = o.value;
        if (o.value === select.value) li.setAttribute('aria-selected', 'true');
        list.appendChild(li);
        shown++;
      });
      if (!shown) {
        var none = document.createElement('li');
        none.className = 'combo-empty';
        none.textContent = 'Eşleşen seçenek yok';
        list.appendChild(none);
      }
      setActive(shown ? 0 : -1);
    }

    function setActive(i) {
      var items = list.querySelectorAll('li[data-value]');
      if (active >= 0 && items[active]) items[active].classList.remove('active');
      active = i;
      if (active >= 0 && items[active]) {
        items[active].classList.add('active');
        items[active].scrollIntoView({ block: 'nearest' });
      }
    }

    function open() {
      if (select.disabled || !list.hidden) return;
      closeAll(wrap);
      typing = false;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      render();
      // Yazmaya başlayınca seçili değerin üzerine yazılsın.
      input.select();
    }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      typing = false;
      sync();
    }

    function choose(value) {
      select.value = value;
      close();
      input.blur();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    input.addEventListener('input', function () { typing = true; if (list.hidden) open(); render(); });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (e) {
      var items = list.querySelectorAll('li[data-value]');
      var n = items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); open(); if (n) setActive((active + 1) % n); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((active - 1 + n) % n); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) choose(items[active].dataset.value); }
      else if (e.key === 'Escape') { close(); }
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-value]');
      if (li) choose(li.dataset.value);
    });

    wrap.close = close;
    select.refreshCombo = sync;
    sync();
  }

  function closeAll(except) {
    box.querySelectorAll('.combo').forEach(function (w) { if (w !== except) w.close(); });
  }
  document.addEventListener('click', function (e) { if (!e.target.closest('.combo')) closeAll(); });

  function fill(select, opts, placeholder) {
    select.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    opts.forEach(function (o) {
      var opt = document.createElement('option');
      opt.textContent = o;
      select.appendChild(opt);
    });
    select.disabled = !opts.length;
    if (select.refreshCombo) select.refreshCombo();
  }

  selects.forEach(combo);

  box.addEventListener('change', function (e) {
    // Yalnızca seviye listeleri; arama kutusunun kendi "change" olayı dikkate alınmaz.
    if (e.target.tagName !== 'SELECT' || !e.target.hasAttribute('data-level')) return;
    var level = Number(e.target.getAttribute('data-level'));
    var prefix = selects.slice(0, level + 1).map(function (s) { return s.value; });
    selects.slice(level + 1).forEach(function (s) { fill(s, [], 'Önce üstteki alanı seçin'); });
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
