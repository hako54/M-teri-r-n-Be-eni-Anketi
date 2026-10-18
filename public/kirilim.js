// Alt kırılımlı, aranabilir seçim. Her seviye için gerçek <select> formda kalır (gönderilen değer odur);
// üstüne açılınca arama kutusu çıkan bir liste çizilir. Bir seviye değişince alttakiler sıfırlanır ve
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

  function combo(select) {
    select.classList.add('native-hidden');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    var wrap = document.createElement('div');
    wrap.className = 'combo';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'combo-btn';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    var panel = document.createElement('div');
    panel.className = 'combo-panel';
    panel.hidden = true;
    var search = document.createElement('input');
    search.type = 'search';
    search.className = 'combo-search';
    search.placeholder = 'Ara…';
    search.setAttribute('aria-label', 'Listede ara');
    search.autocomplete = 'off';
    var list = document.createElement('ul');
    list.className = 'combo-list';
    list.setAttribute('role', 'listbox');
    var empty = document.createElement('div');
    empty.className = 'combo-empty';
    empty.textContent = 'Eşleşen seçenek yok';
    panel.append(search, list, empty);
    wrap.append(button, panel);
    select.parentNode.insertBefore(wrap, select.nextSibling);
    var label = select.closest('label');
    if (label) label.addEventListener('click', function (e) { if (e.target === label.firstElementChild) e.preventDefault(); });

    var active = -1;

    function options() {
      return Array.prototype.filter.call(select.options, function (o) { return o.value; });
    }

    function sync() {
      var chosen = select.selectedOptions[0];
      button.textContent = chosen && chosen.value ? chosen.textContent : select.options[0] ? select.options[0].textContent : '';
      button.classList.toggle('placeholder', !(chosen && chosen.value));
      button.disabled = select.disabled;
    }

    function render() {
      var q = fold(search.value.trim());
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
      empty.hidden = shown > 0;
      setActive(shown ? 0 : -1);
    }

    function setActive(i) {
      var items = list.children;
      if (active >= 0 && items[active]) items[active].classList.remove('active');
      active = i;
      if (active >= 0 && items[active]) {
        items[active].classList.add('active');
        items[active].scrollIntoView({ block: 'nearest' });
      }
    }

    function open() {
      if (select.disabled) return;
      closeAll(wrap);
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      search.value = '';
      render();
      search.focus();
    }

    function close(focusButton) {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focusButton) button.focus();
    }

    function choose(value) {
      select.value = value;
      sync();
      close(true);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    button.addEventListener('click', function () { if (panel.hidden) open(); else close(); });
    search.addEventListener('input', render);
    search.addEventListener('keydown', function (e) {
      var n = list.children.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((active + 1) % n); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((active - 1 + n) % n); }
      else if (e.key === 'Enter') { e.preventDefault(); if (list.children[active]) choose(list.children[active].dataset.value); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });
    list.addEventListener('click', function (e) {
      var li = e.target.closest('li');
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
