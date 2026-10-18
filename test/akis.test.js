const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anket-test-'));
process.env.ADMIN_EMAILS = 'Ayse@Firma.com.tr; diger.admin@firma.com.tr';

const app = require('../src/server');
const { db } = require('../src/db');
const surveys = require('../src/surveys');
const kirilim = require('../src/kirilim');
const { computeResults } = require('../src/results');
const { resultEmail } = require('../src/rapor');
const { closesAt } = require('../src/time');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const BEBEK = ['BEBEK MARKA DİREKTÖRLÜĞÜ', 'AKSESUAR', 'CKB', 'ŞAPKA KEP'];

let server;
let base;

// Her kullanıcının kendi çerezi olur.
function client() {
  let cookie = '';
  return async function req(method, url, body) {
    let payload = body;
    if (body && !(body instanceof FormData) && !(body instanceof URLSearchParams)) payload = new URLSearchParams(body);
    const res = await fetch(base + url, { method, body: payload, headers: { cookie }, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  };
}

async function addModel(req, { kumas, icerik, k = [], ab, konu, labels }) {
  const fd = new FormData();
  fd.append('ana_kumas', kumas);
  fd.append('icerik', icerik);
  k.forEach((v, i) => fd.append(`k${i}`, v));
  if (ab) fd.append('ab_test', '1');
  if (konu) fd.append('test_konusu', konu);
  (labels || ['', '']).forEach((label, i) => {
    fd.append('images', new Blob([PNG], { type: 'image/png' }), `g${i}.png`);
    fd.append('labels', label);
  });
  return req('POST', '/modeller', fd);
}

function surveyBody({ title, models, emails, action }) {
  const body = new URLSearchParams({ title, emails, days: '3', hour: '18:00', result_emails: 'ayse@firma.com.tr', action });
  models.forEach((id) => body.append('models', String(id)));
  return body;
}

const anon = client();
async function join(token, email) {
  const r = await anon('POST', `/k/${token}`, { email });
  assert.strictEqual(r.status, 302, r.text);
  return r.location.split('/a/')[1];
}

let admin;
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  admin = client();
  await admin('POST', '/kayit', { username: 'ayse', email: 'ayse@firma.com.tr', password: 'gizli-sifre' });
});
test.after(() => server.close());

test('kapanış saati Türkiye saatine göre hesaplanır', () => {
  assert.strictEqual(closesAt(5, '18:00', new Date('2026-10-18T19:30:00Z')), '2026-10-23T15:00:00.000Z');
  assert.strictEqual(closesAt(0, '23:00', new Date('2026-10-18T21:30:00Z')), '2026-10-19T20:00:00.000Z');
});

test('kırılım: Excel başlıkları ve alt kırılımlar', async () => {
  assert.deepStrictEqual(kirilim.levels, ['Marka Müdürlükleri', 'Gelecek Dönem Buyer Grup', 'Gelecek Dönem Merch Alt Grup Kod', 'Gelecek Dönem Ürün Klasman']);
  assert.ok(kirilim.options([]).includes('BEBEK MARKA DİREKTÖRLÜĞÜ'));
  assert.ok(!kirilim.options([]).includes('Genel Toplam'));
  assert.ok(kirilim.options(['BEBEK MARKA DİREKTÖRLÜĞÜ']).includes('AKSESUAR'));
  assert.ok(kirilim.options(BEBEK.slice(0, 3)).includes('ŞAPKA KEP'));
  assert.deepStrictEqual(kirilim.normalize(BEBEK), BEBEK);
  assert.deepStrictEqual(kirilim.normalize([BEBEK[0], '', 'CKB']), [BEBEK[0]], 'boş seviyeden sonrası atılır');
  assert.strictEqual(kirilim.normalize([BEBEK[0], 'OLMAYAN GRUP']), null);

  const r = await admin('GET', `/kirilim?p=${encodeURIComponent(BEBEK[0])}&p=AKSESUAR`);
  assert.ok(JSON.parse(r.text).options.includes('CKB'));
});

test('uçtan uca: model, gönder, Outlook, ortak link, sonuç', async () => {
  let r = await addModel(admin, { kumas: 'Viskon krep', icerik: '%100 Viskon', k: BEBEK });
  assert.strictEqual(r.status, 302, r.text);
  const m1 = Number(r.location.split('/').pop());
  r = await addModel(admin, { kumas: 'Denim', icerik: '%98 Pamuk %2 Elastan', k: [BEBEK[0], 'OLMAYAN'] });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /Kırılım seçimi listede bulunamadı/);
  r = await addModel(admin, { kumas: 'Denim', icerik: '%98 Pamuk %2 Elastan' });
  const m2 = Number(r.location.split('/').pop());

  r = await admin('GET', '/modeller');
  assert.match(r.text, /AKSESUAR · CKB · ŞAPKA KEP/);
  r = await admin('GET', `/modeller?marka=${encodeURIComponent(BEBEK[0])}`);
  assert.match(r.text, /Viskon krep/);
  assert.doesNotMatch(r.text, /Denim/);

  r = await admin('POST', '/anketler', surveyBody({ title: 'Yaz 2027', models: [m1, m2], emails: 'mehmet@firma.com.tr\nselin@magaza.com', action: 'gonder' }));
  assert.strictEqual(r.status, 302, r.text);
  assert.match(r.location, /m=yayinda/);
  const surveyId = Number(r.location.match(/anketler\/(\d+)/)[1]);
  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  assert.ok(survey.published_at);

  r = await admin('GET', `/anketler/${surveyId}?m=yayinda`);
  assert.match(r.text, /href="mailto:ayse%40firma.com.tr\?bcc=mehmet%40firma.com.tr,selin%40magaza.com&amp;subject=/);
  assert.ok(r.text.includes(encodeURIComponent(`/k/${survey.public_token}`)), 'mailde ortak link olmalı');
  assert.match(r.text, /window.location.href=a.href/, 'Outlook otomatik açılmalı');

  const mehmet = await join(survey.public_token, 'Mehmet@firma.com.tr');
  const selin = await join(survey.public_token, 'selin@magaza.com');
  const disaridan = await join(survey.public_token, 'ali@firma.com.tr');
  assert.strictEqual(await join(survey.public_token, 'mehmet@firma.com.tr'), mehmet, 'aynı adres aynı ankete döner');

  r = await anon('POST', `/a/${mehmet}`, { [`r_${m1}`]: '5' });
  assert.strictEqual(r.status, 400, 'eksik yanıt reddedilmeli');
  r = await anon('POST', `/a/${mehmet}`, { [`r_${m1}`]: '5', [`r_${m2}`]: 'nms', [`c_${m2}`]: 'Bana göre değil' });
  assert.match(r.text, /Teşekkürler/);
  r = await anon('POST', `/a/${selin}`, { [`r_${m1}`]: '4', [`r_${m2}`]: '2', [`c_${m1}`]: 'Rengi çok güzel' });
  assert.match(r.text, /Teşekkürler/);
  r = await anon('GET', `/a/${mehmet}`);
  assert.match(r.text, /tamamladınız/);

  r = await anon('GET', `/sonuc/${survey.result_token}`);
  assert.match(r.text, /Sonuç henüz hazır değil/);

  r = await admin('GET', `/anketler/${surveyId}/hatirlatici.ics`);
  assert.match(r.text, /BEGIN:VEVENT/);
  assert.ok(r.text.includes(`DTSTART:${survey.closes_at.replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`));
  assert.ok(r.text.includes(`/anketler/${surveyId}`));

  db.prepare('UPDATE surveys SET closes_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), surveyId);
  await surveys.tick();
  assert.ok(db.prepare('SELECT closed_at FROM surveys WHERE id = ?').get(surveyId).closed_at);

  const results = computeResults(surveyId);
  assert.strictEqual(results.invited, 2, 'linkle kendisi katılan davetli sayılmaz');
  assert.strictEqual(results.completed, 2);
  assert.strictEqual(results.models[0].avg, 4.5);
  assert.strictEqual(results.models[1].avg, 2);

  assert.ok(resultEmail(results).includes(`/sonuc/${survey.result_token}`));

  r = await anon('GET', `/a/${disaridan}`);
  assert.match(r.text, /Anket kapandı/);
  r = await anon('GET', `/sonuc/${survey.result_token}`);
  assert.match(r.text, /Rengi çok güzel/);
  assert.match(r.text, /4,5/);

  r = await admin('GET', '/anketler');
  assert.match(r.text, /Sonucu gönder/);
  r = await admin('GET', `/anketler/${surveyId}`);
  assert.match(r.text, /Raporu kopyala ve Outlook'u aç/);
  assert.match(r.text, /data-then="mailto:ayse%40firma.com.tr\?subject=Anket%20sonucu%3A%20Yaz%202027/);
  assert.match(r.text, /<textarea id="rapor" hidden>&lt;!doctype html&gt;/, 'görselli rapor kopyalanmaya hazır');
  assert.match(r.text, /Linkle katıldı/);
  r = await admin('POST', `/anketler/${surveyId}/sonuc-acildi`);
  assert.strictEqual(r.status, 204);
  r = await admin('GET', '/anketler');
  assert.doesNotMatch(r.text, /Sonucu gönder/);

  r = await admin('GET', `/anketler/${surveyId}/sonuclar.csv`);
  assert.match(r.text, /Marka Müdürlükleri;Gelecek Dönem Buyer Grup;Gelecek Dönem Merch Alt Grup Kod;Gelecek Dönem Ürün Klasman/);
  assert.match(r.text, /BEBEK MARKA DİREKTÖRLÜĞÜ;AKSESUAR;CKB;ŞAPKA KEP;;;;4,5/);
});

test('taslak: sonra gönderme, yalnızca admin test linki, 7 gün sonra silme', async () => {
  const user = client();
  await user('POST', '/kayit', { username: 'mehmet', email: 'mehmet@firma.com.tr', password: 'gizli-sifre' });
  let r = await addModel(user, { kumas: 'Triko', icerik: '%100 Yün' });
  const model = Number(r.location.split('/').pop());

  r = await user('POST', '/anketler', surveyBody({ title: 'Taslak anket', models: [model], emails: 'x@f.com', action: 'taslak' }));
  assert.match(r.location, /m=taslak/);
  const id = Number(r.location.match(/anketler\/(\d+)/)[1]);
  const draft = db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
  assert.strictEqual(draft.published_at, null);

  r = await user('GET', `/anketler/${id}`);
  assert.match(r.text, /Taslaklar 7 gün içinde gönderilmezse otomatik silinir/);
  assert.doesNotMatch(r.text, /Test linki/, 'test linki yalnızca admine görünür');
  r = await user('GET', `/t/${draft.test_token}`);
  assert.strictEqual(r.status, 403);
  r = await anon('GET', `/t/${draft.test_token}`);
  assert.strictEqual(r.status, 302);
  r = await anon('GET', `/k/${draft.public_token}`);
  assert.match(r.text, /henüz başlamadı/);

  // Admin başkasının taslağını göremez ama test linkini açabilir; adminlere gönderme düğmesi kendi anketinde görünür.
  r = await admin('GET', `/t/${draft.test_token}`);
  assert.match(r.text, /TEST/);
  r = await admin('POST', `/t/${draft.test_token}`, { [`r_${model}`]: '3' });
  assert.match(r.text, /Test tamamlandı/);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM invitations WHERE survey_id = ? AND completed_at IS NOT NULL').get(id).n, 0, 'test yanıtı kaydedilmez');

  r = await admin('POST', '/anketler', surveyBody({ title: 'Admin taslağı', models: [model], emails: 'x@f.com', action: 'taslak' }));
  r = await admin('GET', r.location);
  assert.match(r.text, /Test linkini adminlere Outlook ile gönder/);
  assert.match(r.text, /mailto:ayse%40firma.com.tr,diger.admin%40firma.com.tr\?subject=Test/);

  r = await user('POST', `/anketler/${id}/yayinla`);
  assert.match(r.location, /m=yayinda/);
  assert.ok(db.prepare('SELECT published_at FROM surveys WHERE id = ?').get(id).published_at);

  // Taslak 7 gün sonra silinir; gönderilmiş anket silinmez.
  r = await user('POST', '/anketler', surveyBody({ title: 'Eski taslak', models: [model], emails: 'x@f.com', action: 'taslak' }));
  const old = Number(r.location.match(/anketler\/(\d+)/)[1]);
  assert.strictEqual(surveys.deleteExpiredDrafts(new Date(Date.now() + 6 * 86400000)), 0);
  assert.strictEqual(surveys.deleteExpiredDrafts(new Date(Date.now() + 7 * 86400000 + 60000)), 2);
  assert.strictEqual(db.prepare('SELECT 1 FROM surveys WHERE id = ?').get(old), undefined);
  assert.ok(db.prepare('SELECT 1 FROM surveys WHERE id = ?').get(id));
});

test('A/B testi: seçenekler ayrı puanlanır, koleksiyon tercihi kazananı belirler', async () => {
  let r = await addModel(admin, { kumas: 'Ekose flanel', icerik: '%100 Pamuk', ab: true, labels: ['tek'] });
  assert.strictEqual(r.status, 400, 'tek görselle A/B testi olmaz');
  r = await addModel(admin, { kumas: 'Ekose flanel', icerik: '%100 Pamuk', ab: true, konu: 'Ekose renkleri', labels: ['Kırmızı-lacivert', 'Yeşil-bej', ''] });
  assert.strictEqual(r.status, 302, r.text);
  const modelId = Number(r.location.split('/').pop());
  const [A, B, C] = db.prepare('SELECT id FROM model_images WHERE model_id = ? ORDER BY sort_order').all(modelId).map((i) => i.id);

  r = await admin('POST', '/anketler', surveyBody({ title: 'Ekose testi', models: [modelId], emails: 'x@f.com, y@f.com, z@f.com', action: 'gonder' }));
  const surveyId = Number(r.location.match(/anketler\/(\d+)/)[1]);
  const { public_token: token } = db.prepare('SELECT public_token FROM surveys WHERE id = ?').get(surveyId);

  const x = await join(token, 'x@f.com');
  r = await anon('GET', `/a/${x}`);
  assert.match(r.text, /Koleksiyona hangisi girsin/);
  assert.match(r.text, /B · Yeşil-bej/);
  assert.match(r.text, /C · Seçenek C/);

  const k = (img) => `r_${modelId}_${img}`;
  const p = `p_${modelId}`;
  r = await anon('POST', `/a/${x}`, { [k(A)]: '5', [k(B)]: '3', [k(C)]: '2' });
  assert.strictEqual(r.status, 400, 'tercih yapılmadan gönderilemez');
  await anon('POST', `/a/${x}`, { [k(A)]: '4', [k(B)]: '5', [k(C)]: 'nms', [p]: String(B), [`c_${modelId}`]: 'Yeşil daha taze' });
  await anon('POST', `/a/${await join(token, 'y@f.com')}`, { [k(A)]: '5', [k(B)]: '4', [k(C)]: '1', [p]: String(B) });
  await anon('POST', `/a/${await join(token, 'z@f.com')}`, { [k(A)]: '5', [k(B)]: '2', [k(C)]: 'nms', [p]: '0' });

  const m = computeResults(surveyId).models[0];
  const [vA, vB, vC] = m.variants;
  assert.strictEqual(vA.avg, 14 / 3);
  assert.strictEqual(vB.picks, 2);
  assert.strictEqual(vC.notMyStyle, 2);
  assert.strictEqual(m.noPick, 1);
  assert.strictEqual(m.winner.letter, 'B', 'A ortalamada önde olsa da koleksiyon tercihi B');

  r = await admin('GET', `/anketler/${surveyId}/sonuclar.csv`);
  assert.match(r.text, /Ekose renkleri;B;Yeşil-bej;3,7;3;0;0;1;0;1;1;2;Evet/);

  await admin('POST', `/anketler/${surveyId}/kapat`);
  const rapor = resultEmail(computeResults(surveyId));
  assert.match(rapor, /B ✓/);
  assert.match(rapor, /1 kişi hiçbirini seçmedi/);
});

test('giriş yapmadan yönetim sayfaları açılmaz', async () => {
  const r = await client()('GET', '/modeller');
  assert.strictEqual(r.status, 302);
  assert.strictEqual(r.location, '/giris');
});
