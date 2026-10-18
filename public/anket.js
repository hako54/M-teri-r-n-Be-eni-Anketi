// Katılımcı anketi: modelleri tek tek gösterir. JavaScript yoksa tüm modeller alt alta görünür.
(function () {
  var form = document.getElementById('survey');
  if (!form) return;
  var steps = Array.prototype.slice.call(form.querySelectorAll('.step'));
  var dots = Array.prototype.slice.call(document.querySelectorAll('.dots i'));
  var current = 0;

  document.documentElement.classList.add('js');
  form.noValidate = true;

  function answered(step) {
    return Boolean(step.querySelector('input[type=radio]:checked'));
  }

  function show(i) {
    current = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach(function (s, n) { s.classList.toggle('active', n === current); });
    dots.forEach(function (d, n) {
      d.classList.toggle('on', n === current);
      d.classList.toggle('done', n !== current && answered(steps[n]));
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  form.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-go]');
    if (!btn) return;
    var dir = Number(btn.getAttribute('data-go'));
    if (dir > 0 && !answered(steps[current])) {
      steps[current].classList.add('missing');
      return;
    }
    show(current + dir);
  });

  form.addEventListener('change', function (e) {
    if (e.target.type === 'radio') e.target.closest('.step').classList.remove('missing');
  });

  form.addEventListener('submit', function (e) {
    var firstMissing = steps.findIndex(function (s) { return !answered(s); });
    if (firstMissing >= 0) {
      e.preventDefault();
      steps[firstMissing].classList.add('missing');
      show(firstMissing);
    }
  });

  show(0);
})();
