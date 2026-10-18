// Seçilen görsellerin yükleme öncesi önizlemesi.
(function () {
  var input = document.getElementById('images');
  var box = document.getElementById('preview');
  if (!input || !box) return;
  input.addEventListener('change', function () {
    box.innerHTML = '';
    Array.prototype.forEach.call(input.files, function (f) {
      if (!f.type.startsWith('image/')) return;
      var img = document.createElement('img');
      img.alt = f.name;
      img.src = URL.createObjectURL(f);
      box.appendChild(img);
    });
  });
})();
