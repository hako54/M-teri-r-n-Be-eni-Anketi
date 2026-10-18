const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anket-test-'));
delete process.env.SMTP_HOST;

const app = require('../src/server');
const { db } = require('../src/db');
const surveys = require('../src/surveys');
const { closesAt } = require('../src/time');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

let server;
let base;
let cookie = '';

async function req(method, url, body, extra = {}) {
  const headers = { cookie, ...extra.headers };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    payload = new URLSearchParams(body);
  }
  const res = await fetch(base + url, { method, body: payload, headers, redirect: 'manual' });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('kapanış saati Türkiye saatine göre hesaplanır', () => {
  // 18 Ekim 2026 22:30 TR = 19:30 UTC; 5 gün sonra 18:00 TR = 23 Ekim 15:00 UTC
  assert.strictEqual(closesAt(5, '18:00', new Date('2026-10-18T19:30:00Z')), '2026-10-23T15:00:00.000Z');
  // TR'de gece yarısını geçtiyse gün TR takvimine göre sayılır
  assert.strictEqual(closesAt(0, '23:00', new Date('2026-10-18T21:30:00Z')), '2026-10-19T20:00:00.000Z');
});

test('uçtan uca akış: kayıt, model, anket, yanıt, sonuç maili', async () => {
  let r = await req('POST', '/kayit', { username: 'ayse', email: 'ayse@firma.com.tr', password: 'gizli-sifre' });
  assert.strictEqual(r.status, 302);
  assert.ok(cookie.startsWith('oturum='));

  const modelIds = [];
  for (const [kumas, icerik] of [['Viskon krep', '%100 Viskon'], ['Denim', '%98 Pamuk %2 Elastan']]) {
    const fd = new FormData();
    fd.append('ana_kumas', kumas);
    fd.append('icerik', icerik);
    fd.append('images', new Blob([PNG], { type: 'image/png' }), 'a.png');
    fd.append('images', new Blob([PNG], { type: 'image/png' }), 'b.png');
    r = await req('POST', '/modeller', fd);
    assert.strictEqual(r.status, 302, r.text);
    modelIds.push(Number(r.location.split('/').pop()));
  }
  r = await req('GET', '/modeller');
  assert.match(r.text, /MDL-0001/);
  assert.match(r.text, /MDL-0002/);
  assert.match(r.text, /2 görsel/);

  r = await req('POST', '/anketler', {
    title: 'Yaz 2027', models: String(modelIds[0]), emails: 'mehmet@firma.com.tr\nselin@magaza.com, hatali', days: '3', hour: '18:00', result_emails: 'ayse@firma.com.tr',
  });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /hatali/);

  const body = new URLSearchParams({ title: 'Yaz 2027', emails: 'mehmet@firma.com.tr\nselin@magaza.com;ali@firma.com.tr', days: '3', hour: '18:00', result_emails: 'ayse@firma.com.tr' });
  modelIds.forEach((id) => body.append('models', String(id)));
  r = await req('POST', '/anketler', body);
  assert.strictEqual(r.status, 302, r.text);
  const surveyId = Number(r.location.match(/anketler\/(\d+)/)[1]);
  await surveys.sendInvitations(surveyId);

  const invites = db.prepare('SELECT * FROM invitations WHERE survey_id = ? ORDER BY email').all(surveyId);
  assert.strictEqual(invites.length, 3);
  assert.ok(invites.every((i) => i.sent_at));
  const inviteMail = db.prepare("SELECT * FROM outbox WHERE subject LIKE 'Görüşünüz%' AND to_addr = 'mehmet@firma.com.tr'").get();
  assert.ok(inviteMail.html.includes(`/a/${invites.find((i) => i.email === 'mehmet@firma.com.tr').token}`));

  const [ali, mehmet, selin] = invites;
  const [m1, m2] = modelIds;
  const anon = cookie;
  cookie = '';
  r = await req('GET', `/a/${mehmet.token}`);
  assert.match(r.text, /Tarzım değil/);
  r = await req('POST', `/a/${mehmet.token}`, { [`r_${m1}`]: '5' });
  assert.strictEqual(r.status, 400, 'eksik yanıt reddedilmeli');
  r = await req('POST', `/a/${mehmet.token}`, { [`r_${m1}`]: '5', [`r_${m2}`]: 'nms', [`c_${m2}`]: 'Bana göre değil' });
  assert.match(r.text, /Teşekkürler/);
  r = await req('POST', `/a/${selin.token}`, { [`r_${m1}`]: '4', [`r_${m2}`]: '2', [`c_${m1}`]: 'Rengi çok güzel' });
  assert.match(r.text, /Teşekkürler/);
  r = await req('GET', `/a/${mehmet.token}`);
  assert.match(r.text, /tamamladınız/);
  cookie = anon;

  // Kapanış zamanı geldiğinde zamanlayıcı anketi kapatır ve sonucu gönderir.
  db.prepare('UPDATE surveys SET closes_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), surveyId);
  await surveys.tick();
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  assert.ok(survey.closed_at && survey.result_sent_at);

  const resultMail = db.prepare("SELECT * FROM outbox WHERE subject LIKE 'Anket sonucu%'").get();
  assert.strictEqual(resultMail.to_addr, 'ayse@firma.com.tr');
  assert.match(resultMail.html, /2\/3/);
  assert.match(resultMail.html, /Rengi çok güzel/);
  // MDL-0001: 5 ve 4 → 4,5; MDL-0002: yalnızca 2 (tarzım değil sayılmaz) → 2,0
  assert.match(resultMail.html, /4,5/);
  assert.match(resultMail.html, /2,0/);
  assert.ok(resultMail.html.indexOf('MDL-0001') < resultMail.html.indexOf('MDL-0002'));

  r = await req('GET', `/a/${ali.token}`);
  assert.match(r.text, /Anket kapandı/);

  r = await req('GET', `/anketler/${surveyId}/sonuclar.csv`);
  assert.match(r.text, /MDL-0002;Denim;%98 Pamuk %2 Elastan;2,0;1;1;0;1;0;0;0/);

  // İkinci tur aynı sonucu tekrar göndermez.
  await surveys.tick();
  assert.strictEqual(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE subject LIKE 'Anket sonucu%'").get().n, 1);
});

test('giriş yapmadan yönetim sayfaları açılmaz', async () => {
  cookie = '';
  const r = await req('GET', '/modeller');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.location, '/giris');
});
