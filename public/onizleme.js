// Seçilen görsellerin yükleme öncesi önizlemesi; her görsele isteğe bağlı seçenek adı yazılabilir.
// Her seçim (ya da çekilen fotoğraf) listeye eklenir, öncekilerin yerine geçmez; yanlış eklenen × ile çıkarılır.
(function () {
  var input = document.getElementById('images');
  var box = document.getElementById('preview');
  if (!input || !box) return;
  var existing = document.querySelectorAll('.img-cell').length;
  var items = []; // { file, url, label }
  var canKeep = (function () { try { return Boolean(new DataTransfer().items); } catch (e) { return false; } })();

  function sync() {
    if (!canKeep) return;
    var dt = new DataTransfer();
    items.forEach(function (it) { dt.items.add(it.file); });
    input.files = dt.files;
  }

  function render() {
    box.innerHTML = '';
    items.forEach(function (it, i) {
      var cell = document.createElement('div');
      cell.className = 'pv tile-img';
      var img = document.createElement('img');
      img.className = 'ph';
      img.alt = it.file.name;
      img.src = it.url;
      var letter = document.createElement('span');
      letter.className = 'no';
      letter.textContent = String.fromCharCode(65 + ((existing + i) % 26));
      var label = document.createElement('input');
      label.name = 'labels';
      label.className = 'vlabel';
      label.maxLength = 80;
      label.placeholder = 'Seçenek adı (isteğe bağlı)';
      label.value = it.label;
      label.addEventListener('input', function () { it.label = label.value; });
      cell.append(img, letter, label);
      if (canKeep) {
        var x = document.createElement('button');
        x.type = 'button';
        x.className = 'x';
        x.textContent = '×';
        x.title = 'Görseli kaldır';
        x.setAttribute('aria-label', letter.textContent + ' görselini kaldır');
        x.addEventListener('click', function () {
          URL.revokeObjectURL(it.url);
          items.splice(items.indexOf(it), 1);
          sync();
          render();
        });
        cell.appendChild(x);
      }
      box.appendChild(cell);
    });
  }

  input.addEventListener('change', function () {
    var picked = Array.prototype.slice.call(input.files);
    if (!canKeep) items.forEach(function (it) { URL.revokeObjectURL(it.url); });
    items = (canKeep ? items : []).concat(picked.map(function (f) { return { file: f, url: URL.createObjectURL(f), label: '' }; }));
    sync();
    render();
  });
})();
