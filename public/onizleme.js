// Seçilen görsellerin yükleme öncesi önizlemesi; her görsele isteğe bağlı seçenek adı yazılabilir.
(function () {
  var input = document.getElementById('images');
  var box = document.getElementById('preview');
  if (!input || !box) return;
  var existing = document.querySelectorAll('.img-cell').length;
  input.addEventListener('change', function () {
    box.innerHTML = '';
    Array.prototype.forEach.call(input.files, function (f, i) {
      var cell = document.createElement('div');
      cell.className = 'pv tile-img';
      var img = document.createElement('img');
      img.className = 'ph';
      img.alt = f.name;
      img.src = URL.createObjectURL(f);
      var letter = document.createElement('span');
      letter.className = 'no';
      letter.textContent = String.fromCharCode(65 + ((existing + i) % 26));
      var label = document.createElement('input');
      label.name = 'labels';
      label.className = 'vlabel';
      label.maxLength = 80;
      label.placeholder = 'Seçenek adı (isteğe bağlı)';
      cell.append(img, letter, label);
      box.appendChild(cell);
    });
  });
})();
