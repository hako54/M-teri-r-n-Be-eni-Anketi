// Telefonda mail linkleri (mailto:) varsayılan mail uygulaması yerine doğrudan Outlook uygulamasında açılır.
// Outlook'un kendi adresi kullanılır: ms-outlook://compose?to=…&bcc=…&subject=…&body=…
// Outlook kurulu değilse sayfa açık kalır ve varsayılan mail uygulamasıyla açma seçeneği gösterilir.
(function () {
  var isPhone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function toOutlook(mailto) {
    var rest = mailto.slice('mailto:'.length);
    var q = rest.indexOf('?');
    var to = q >= 0 ? rest.slice(0, q) : rest;
    var params = new URLSearchParams(q >= 0 ? rest.slice(q + 1) : '');
    // Alıcılar virgülle ayrılır; her adres ayrı kodlanır, virgüller açık kalır.
    var addresses = function (list) {
      return list.split(',').map(function (x) { return encodeURIComponent(decodeURIComponent(x.trim())); }).filter(Boolean).join(',');
    };
    var out = [];
    if (to) out.push('to=' + addresses(to));
    ['cc', 'bcc'].forEach(function (k) { if (params.has(k)) out.push(k + '=' + addresses(params.get(k))); });
    ['subject', 'body'].forEach(function (k) { if (params.has(k)) out.push(k + '=' + encodeURIComponent(params.get(k))); });
    return 'ms-outlook://compose?' + out.join('&');
  }

  // Outlook açılmazsa (kurulu değilse) altta bir not çıkar; varsayılan mail uygulamasına geçişi kullanıcı seçer.
  // Otomatik geçiş yapılmaz: iPhone "Outlook'ta açılsın mı?" diye sorarken ikinci bir uygulama açılmasın.
  function showFallback(mailto) {
    var old = document.getElementById('mail-fallback');
    if (old) old.remove();
    var bar = document.createElement('div');
    bar.id = 'mail-fallback';
    bar.className = 'mail-fallback';
    bar.innerHTML = '<span>Outlook açılmadı mı? Telefonunuzda Outlook uygulaması kurulu ve şirket hesabınız ekli olmalı.</span>';
    var other = document.createElement('a');
    other.href = mailto;
    other.textContent = 'Varsayılan mail uygulamasıyla aç';
    other.setAttribute('data-direct', '');
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Kapat';
    close.addEventListener('click', function () { bar.remove(); });
    var row = document.createElement('div');
    row.append(other, close);
    bar.appendChild(row);
    document.body.appendChild(bar);
  }

  function openMail(mailto) {
    if (!isPhone) { window.location.href = mailto; return; }
    var left = false;
    var onHide = function () { if (document.hidden) left = true; };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    window.location.href = toOutlook(mailto);
    setTimeout(function () {
      document.removeEventListener('visibilitychange', onHide);
      if (!left && !document.hidden) showFallback(mailto);
    }, 2500);
  }

  window.openMail = openMail;
  openMail.toOutlook = toOutlook;

  document.addEventListener('click', function (e) {
    if (!isPhone || e.defaultPrevented) return;
    var a = e.target.closest('a[href^="mailto:"]');
    if (!a || a.hasAttribute('data-direct')) return;
    e.preventDefault();
    openMail(a.getAttribute('href'));
  });
})();
