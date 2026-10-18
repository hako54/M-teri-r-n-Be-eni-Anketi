// data-confirm taşıyan formlar göndermeden önce onay ister (ör. anket silme).
document.addEventListener('submit', function (e) {
  var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});
