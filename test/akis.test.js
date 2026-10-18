const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anket-test-'));
process.env.ADMIN_EMAILS = 'Ayse@Firma.com.tr; diger.admin@firma.com.tr';
process.env.COMPANY_DOMAIN = 'firma.com.tr';
process.env.REGISTRATION_CODE = 'KOD-123';

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

const modelIdFrom = (r) => Number(r.location.match(/modeller\/(\d+)/)[1]);

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
// Ham fetch gerektiren (ikili yanıt) istekler için admin çerezini yeniden alır.
async function adminCookie() {
  const res = await fetch(`${base}/giris`, { method: 'POST', body: new URLSearchParams({ username: 'ayse', password: 'gizli-sifre' }), redirect: 'manual' });
  return res.headers.get('set-cookie').split(';')[0];
}
test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  admin = client();
  await admin('POST', '/kayit', { username: 'ayse', password: 'gizli-sifre', code: 'KOD-123' });
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
  const m1 = modelIdFrom(r);
  r = await addModel(admin, { kumas: 'Denim', icerik: '%98 Pamuk %2 Elastan', k: [BEBEK[0], 'OLMAYAN'] });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /Kırılım seçimi listede bulunamadı/);
  r = await addModel(admin, { kumas: 'Denim', icerik: '%98 Pamuk %2 Elastan' });
  const m2 = modelIdFrom(r);

  r = await admin('GET', `/modeller/${m1}?m=eklendi`);
  assert.match(r.text, /eklendi\./);
  assert.match(r.text, new RegExp(`href="/anketler/yeni\\?model=${m1}">Ankete ilerle`));
  r = await admin('GET', `/anketler/yeni?model=${m1}&model=${m2}`);
  assert.match(r.text, new RegExp(`value="${m1}" checked`));
  assert.match(r.text, new RegExp(`value="${m2}" checked`));
  const fd = new FormData();
  fd.append('ana_kumas', 'Poplin'); fd.append('icerik', '%100 Pamuk'); fd.append('next', 'anket');
  fd.append('images', new Blob([PNG], { type: 'image/png' }), 'p.png');
  r = await admin('POST', '/modeller', fd);
  assert.match(r.location, /^\/anketler\/yeni\?model=\d+$/, 'kaydet ve ankete ilerle');

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

  const mehmet = await join(survey.public_token, 'Mehmet');
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
  const png = await fetch(`${base}/anketler/${surveyId}/rapor.png`, { headers: { cookie: await adminCookie() } });
  assert.strictEqual(png.headers.get('content-type'), 'image/png');
  assert.deepStrictEqual([...Buffer.from(await png.arrayBuffer()).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  r = await admin('GET', `/anketler/${surveyId}/sonuc.eml`);
  assert.match(r.text, /^To: ayse@firma.com.tr\r\n/);
  assert.match(r.text, /\r\nX-Unsent: 1\r\n/, 'Outlook taslak olarak açar');
  assert.doesNotMatch(r.text, /^From:/m, 'gönderen Outlook hesabıdır');
  assert.match(r.text, /Content-ID: <rapor-\d+@model-begeni-anketi>/);
  assert.strictEqual((r.text.match(/Content-Disposition: attachment/g) || []).length, 3, 'görsel + 2 Excel eki');
  const htmlPart = r.text.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('--')[0];
  assert.match(Buffer.from(htmlPart, 'base64').toString('utf8'), /<img src="cid:rapor-\d+@model-begeni-anketi"/);

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
  await user('POST', '/kayit', { username: 'Mehmet', password: 'gizli-sifre', code: 'KOD-123' });
  let r = await addModel(user, { kumas: 'Triko', icerik: '%100 Yün' });
  const model = modelIdFrom(r);

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
  const modelId = modelIdFrom(r);
  const [A, B, C] = db.prepare('SELECT id FROM model_images WHERE model_id = ? ORDER BY sort_order').all(modelId).map((i) => i.id);

  r = await admin('POST', '/anketler', surveyBody({ title: 'Ekose testi', models: [modelId], emails: 'x@f.com, y@f.com, z@f.com', action: 'gonder' }));
  const surveyId = Number(r.location.match(/anketler\/(\d+)/)[1]);
  const { public_token: token } = db.prepare('SELECT public_token FROM surveys WHERE id = ?').get(surveyId);

  const x = await join(token, 'x@f.com');
  r = await anon('GET', `/a/${x}`);
  assert.match(r.text, /Koleksiyonda hangisinin olmasını istersiniz\?/);
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

test('hesap: kullanıcı adı = şirket e-postasının @ öncesi; şifre sıfırlama ve değiştirme', async () => {
  const c = client();
  let r = await c('POST', '/kayit', { username: 'baska@gmail.com', password: 'gizli-sifre', code: 'KOD-123' });
  assert.strictEqual(r.status, 400, 'şirket dışı adres kayıt olamaz');
  r = await c('POST', '/kayit', { username: 'selin.kaya', password: 'gizli-sifre', code: 'YANLIS' });
  assert.match(r.text, /Kayıt kodu hatalı/);
  r = await c('POST', '/kayit', { username: 'Selin.Kaya@FIRMA.com.tr', password: 'gizli-sifre', code: 'KOD-123' });
  assert.strictEqual(r.status, 302);
  const selin = db.prepare("SELECT * FROM users WHERE username = 'selin.kaya'").get();
  assert.strictEqual(selin.email, 'selin.kaya@firma.com.tr');
  r = await client()('POST', '/kayit', { username: 'selin.kaya', password: 'gizli-sifre', code: 'KOD-123' });
  assert.match(r.text, /zaten bir hesap var/);

  // Giriş: kullanıcı adı ya da tam adresle
  r = await client()('POST', '/giris', { username: 'SELIN.KAYA', password: 'gizli-sifre' });
  assert.strictEqual(r.location, '/modeller');
  r = await client()('POST', '/giris', { username: 'selin.kaya@firma.com.tr', password: 'gizli-sifre' });
  assert.strictEqual(r.location, '/modeller');

  // Yönetim yalnızca admin
  r = await c('GET', '/yonetim');
  assert.strictEqual(r.status, 403);
  r = await client()('POST', '/yonetici', { username: 'selin.kaya', password: 'gizli-sifre' });
  assert.match(r.text, /yönetici yetkisi yok/);
  assert.strictEqual(r.status, 403, 'admin olmayan yönetici girişinden giremez');
  r = await client()('GET', '/yonetim');
  assert.strictEqual(r.location, '/yonetici');
  r = await client()('GET', '/yonetici');
  assert.match(r.text, /Yönetici girişi/);
  r = await client()('POST', '/yonetici', { username: 'ayse', password: 'gizli-sifre' });
  assert.strictEqual(r.location, '/yonetim');
  r = await client()('GET', '/giris');
  assert.match(r.text, /href="\/yonetici"/);

  // Şifremi unuttum -> admin link oluşturur -> kullanıcı yeni şifre belirler, eski oturum kapanır
  r = await client()('POST', '/sifremi-unuttum', { username: 'selin.kaya' });
  assert.match(r.text, /Adminlere Outlook ile yaz/);
  assert.match(r.text, /mailto:ayse%40firma.com.tr,diger.admin%40firma.com.tr/);
  r = await client()('POST', '/sifremi-unuttum', { username: 'olmayan.kisi' });
  assert.match(r.text, /İsteğiniz kaydedildi/, 'hesabın varlığı açığa çıkmaz');
  r = await admin('GET', '/yonetim');
  assert.match(r.text, /Şifre sıfırlama istedi/);
  r = await admin('POST', `/yonetim/sifirla/${selin.id}`);
  const token = r.location.match(/sifirla=([^#]+)/)[1];
  r = await admin('GET', r.location);
  assert.match(r.text, /mailto:selin.kaya%40firma.com.tr\?subject=/);

  const anon2 = client();
  r = await anon2('POST', `/sifre-sifirla/${token}`, { password: 'yeni-sifre-1', password2: 'farkli' });
  assert.strictEqual(r.status, 400);
  r = await anon2('POST', `/sifre-sifirla/${token}`, { password: 'yeni-sifre-1', password2: 'yeni-sifre-1' });
  assert.strictEqual(r.location, '/giris?m=sifre');
  r = await anon2('GET', `/sifre-sifirla/${token}`);
  assert.strictEqual(r.status, 404, 'link bir kez kullanılır');
  r = await c('GET', '/modeller');
  assert.strictEqual(r.location, '/giris', 'eski oturum kapanır');
  r = await client()('POST', '/giris', { username: 'selin.kaya', password: 'gizli-sifre' });
  assert.strictEqual(r.status, 401);
  const c2 = client();
  r = await c2('POST', '/giris', { username: 'selin.kaya', password: 'yeni-sifre-1' });
  assert.strictEqual(r.location, '/modeller');
  assert.strictEqual(db.prepare('SELECT reset_requested_at FROM users WHERE id = ?').get(selin.id).reset_requested_at, null);

  // Hesabım: şifre değiştirme
  r = await c2('POST', '/hesap', { current: 'yanlis', password: 'ucuncu-sifre', password2: 'ucuncu-sifre' });
  assert.match(r.text, /Mevcut şifre hatalı/);
  r = await c2('POST', '/hesap', { current: 'yeni-sifre-1', password: 'ucuncu-sifre', password2: 'ucuncu-sifre' });
  assert.strictEqual(r.location, '/hesap?m=ok');
});

test('katılımcı listesi: kullanıcı adları ve Outlook kopyası', () => {
  const { valid, invalid } = surveys.parseEmails('ALI HAKAN BAYKAL <ALIHAKAN.BAYKAL@Lcwaikiki.com>; yusuf.bas\ndis@ornek.com, bozuk@');
  assert.deepStrictEqual(valid, ['alihakan.baykal@lcwaikiki.com', 'yusuf.bas@firma.com.tr', 'dis@ornek.com']);
  assert.deepStrictEqual(invalid, ['bozuk@']);
});

test('yedek: günlük kopya 03:00 sonrası bir kez alınır, admin indirebilir', async () => {
  const yedek = require('../src/yedek');
  const gece = new Date('2030-01-10T23:30:00Z'); // TR 11 Ocak 02:30
  assert.strictEqual(await yedek.backupIfDue(gece), null, '03:00 öncesi yedek alınmaz');
  const sabah = new Date('2030-01-11T01:00:00Z'); // TR 04:00
  const b = await yedek.backupIfDue(sabah);
  assert.strictEqual(b.day, '2030-01-11');
  assert.strictEqual(b.remote, 'kapalı');
  assert.ok(b.size > 0);
  assert.strictEqual(await yedek.backupIfDue(new Date('2030-01-11T10:00:00Z')), null, 'aynı gün ikinci kez alınmaz');

  // Yedek dosyası gerçek bir veritabanı ve kullanıcıları içerir.
  const { DatabaseSync } = require('node:sqlite');
  const copy = new DatabaseSync(path.join(process.env.DATA_DIR, 'yedekler', 'anket-2030-01-11.db'));
  assert.ok(copy.prepare('SELECT COUNT(*) AS n FROM users').get().n >= 2);
  copy.close();

  let r = await admin('GET', '/yonetim');
  assert.match(r.text, /href="\/yonetim\/yedek\/anket-2030-01-11.db"/);
  r = await admin('GET', '/yonetim/yedek/..%2Fanket.db');
  assert.strictEqual(r.status, 302, 'yedek klasörü dışı dosya verilmez');
  r = await admin('POST', '/yonetim/yedekle');
  assert.strictEqual(r.location, '/yonetim?m=yedek');
});

test('güncelleme: sürüm numaralı dosyalar, önbelleksiz sayfalar, ana ekran simgesi', async () => {
  const { version } = require('../src/surum');
  let res = await fetch(`${base}/giris`);
  assert.strictEqual(res.headers.get('cache-control'), 'no-cache');
  const page = await res.text();
  assert.ok(page.includes(`/static/style.css?v=${version}`));
  assert.ok(page.includes(`<meta name="app-version" content="${version}">`));
  assert.ok(page.includes('rel="manifest"'));
  res = await fetch(`${base}/static/style.css?v=${version}`);
  assert.match(res.headers.get('cache-control'), /immutable/);
  res = await fetch(`${base}/surum`);
  assert.deepStrictEqual(await res.json(), { v: version });
  res = await fetch(`${base}/ikon-180.png`);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  res = await fetch(`${base}/manifest.webmanifest`);
  assert.strictEqual((await res.json()).short_name, 'Beğeni Anketi');
});
