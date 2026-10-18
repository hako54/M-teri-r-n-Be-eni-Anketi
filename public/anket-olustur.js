// Anket oluşturma: gün sayacı, seçili model sayısı ve kapanış zamanı önizlemesi.
(function () {
  var days = document.getElementById('days');
  var hour = document.getElementById('hour');
  var info = document.getElementById('closeinfo');
  var count = document.getElementById('selcount');
  var months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

  document.querySelectorAll('[data-step]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = Math.max(0, Math.min(60, (Number(days.value) || 0) + Number(b.getAttribute('data-step'))));
      days.value = v;
      update();
    });
  });

  // Sunucuyla aynı hesap: Türkiye saati (UTC+3).
  function update() {
    var now = new Date(Date.now() + 3 * 3600000);
    var parts = (hour.value || '18:00').split(':');
    var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + (Number(days.value) || 0), Number(parts[0]), Number(parts[1])));
    var past = d.getTime() - 3 * 3600000 <= Date.now();
    info.textContent = past
      ? 'Bu zaman geçmişte kalıyor. Gün sayısını artırın veya daha geç bir saat seçin.'
      : 'Anket ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' + hour.value + ' saatinde kapanır ve sonuç otomatik mail ile gelir.';
    info.style.color = past ? 'var(--err)' : '';
  }

  function updateCount() {
    if (!count) return;
    var n = document.querySelectorAll('input[name=models]:checked').length;
    count.textContent = n ? '· ' + n + ' seçili' : '';
  }

  days.addEventListener('input', update);
  hour.addEventListener('input', update);
  document.addEventListener('change', function (e) { if (e.target.name === 'models') updateCount(); });
  update();
  updateCount();
})();
