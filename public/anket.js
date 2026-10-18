// Katılımcı anketi: modelleri tek tek gösterir. JavaScript yoksa tüm modeller alt alta görünür.
(function () {
  var form = document.getElementById('survey');
  if (!form) return;
  var steps = Array.prototype.slice.call(form.querySelectorAll('.step'));
  var dots = Array.prototype.slice.call(document.querySelectorAll('.dots i'));
  var current = 0;

  document.documentElement.classList.add('js');
  form.noValidate = true;

  // A/B adımlarında her seçenek ve koleksiyon tercihi ayrı bir grup; hepsi yanıtlanmalı.
  function answered(step) {
    var names = {};
    step.querySelectorAll('input[type=radio]').forEach(function (r) { names[r.name] = true; });
    return Object.keys(names).every(function (n) {
      return step.querySelector('input[name="' + n + '"]:checked');
    });
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
      var first = Array.prototype.find.call(steps[current].querySelectorAll('fieldset'), function (f) {
        return f.querySelector('input[type=radio]') && !f.querySelector('input:checked');
      });
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    show(current + dir);
  });

  form.addEventListener('change', function (e) {
    if (e.target.type === 'radio') {
      e.target.closest('fieldset').classList.remove('missing');
      var step = e.target.closest('.step');
      if (answered(step)) step.classList.remove('missing');
    }
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
