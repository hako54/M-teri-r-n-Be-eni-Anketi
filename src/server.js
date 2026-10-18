const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { db, tx, modelCode, modelImages, isAbTest, TEST_KONULARI } = require('./db');
const auth = require('./auth');
const views = require('./views');
const { closesAt, formatTR } = require('./time');
const { computeResults, resultsCsv, commentsCsv, firstImage } = require('./results');
const { renderReportPng } = require('./gorsel');
const { resultDraft } = require('./eml');
const { resultEmail } = require('./rapor');
const surveys = require('./surveys');
const kirilim = require('./kirilim');
const outlook = require('./outlook');
const yedek = require('./yedek');
const s3 = require('./s3');
const { companyAccount, toAddress } = require('./kullanici');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true }));
app.use(auth.loadUser);

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif', 'image/avif': '.avif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '.img')),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 60 },
  fileFilter: (req, file, cb) => cb(null, Boolean(EXT[file.mimetype])),
});

const send = (res, page, status = 200) => res.status(status).type('html').send(String(page));
const field = (v, max) => String(v ?? '').trim().slice(0, max);

// ---------- Hesap ----------
app.get('/', (req, res) => res.redirect(req.user ? '/modeller' : '/giris'));

const needsCode = () => Boolean(process.env.REGISTRATION_CODE);

app.get('/kayit', (req, res) => send(res, views.authPage({ mode: 'kayit', needsCode: needsCode() })));
app.post('/kayit', (req, res) => {
  const values = { username: field(req.body.username, 120), code: field(req.body.code, 80) };
  const password = String(req.body.password || '');
  const account = companyAccount(values.username);
  const errs = [];
  if (!account) errs.push(`Kullanıcı adınızı şirket e-postanızın @ öncesi olarak yazın (ör. ad.soyad). Yalnızca @${config.companyDomain} adresleri kayıt olabilir.`);
  if (password.length < 8) errs.push('Şifre en az 8 karakter olmalı.');
  if (needsCode() && values.code !== process.env.REGISTRATION_CODE) errs.push('Kayıt kodu hatalı.');
  if (!errs.length && db.prepare('SELECT 1 FROM users WHERE username = ? OR lower(email) = ?').get(account.username, account.email)) {
    errs.push('Bu kullanıcı adıyla zaten bir hesap var. Şifrenizi unuttuysanız “Şifremi unuttum”u kullanın.');
  }
  if (errs.length) return send(res, views.authPage({ mode: 'kayit', values, errs, needsCode: needsCode() }), 400);
  const { lastInsertRowid } = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(account.username, account.email, auth.hashPassword(password));
  auth.startSession(req, res, Number(lastInsertRowid));
  res.redirect('/modeller');
});

// Kullanıcı adı veya tam şirket e-postasıyla bulunur; eski sürümde açılmış hesapların adları da çalışır.
function findUser(input) {
  const raw = field(input, 120);
  const account = companyAccount(raw);
  return db.prepare('SELECT * FROM users WHERE username = ? OR lower(email) = ? OR username = ? ORDER BY id LIMIT 1')
    .get(account ? account.username : raw, account ? account.email : raw.toLowerCase(), raw);
}

app.get('/giris', (req, res) => (req.user ? res.redirect('/modeller') : send(res, views.authPage({ mode: 'giris', flash: req.query.m === 'sifre' ? 'Şifreniz değiştirildi. Yeni şifrenizle giriş yapın.' : null }))));
app.post('/giris', (req, res) => {
  const user = findUser(req.body.username);
  if (!user || !auth.verifyPassword(String(req.body.password || ''), user.password_hash)) {
    return send(res, views.authPage({ mode: 'giris', values: { username: field(req.body.username, 120) }, errs: ['Kullanıcı adı veya şifre hatalı.'] }), 401);
  }
  auth.startSession(req, res, user.id);
  res.redirect('/modeller');
});

// Şifremi unuttum: sunucu mail göndermediği için istek adminlere iletilir; admin tek kullanımlık link oluşturur.
app.get('/sifremi-unuttum', (req, res) => send(res, views.forgotPage({})));
app.post('/sifremi-unuttum', (req, res) => {
  const username = field(req.body.username, 120);
  const user = findUser(username);
  if (user) db.prepare('UPDATE users SET reset_requested_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  // Hesabın var olup olmadığı açığa çıkmasın diye her durumda aynı sayfa gösterilir.
  send(res, views.forgotPage({ sent: true, username, adminMailto: outlook.resetRequestMailto({ username, to: config.adminEmails }) }));
});

const RESET_HOURS = 24;
const findReset = (token) => db.prepare(`
  SELECT r.*, u.username FROM password_resets r JOIN users u ON u.id = r.user_id
  WHERE r.token = ? AND r.used_at IS NULL AND r.expires_at > ?`).get(String(token), new Date().toISOString());

app.get('/sifre-sifirla/:token', (req, res) => {
  const reset = findReset(req.params.token);
  if (!reset) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu şifre sıfırlama linki kullanılmış ya da süresi dolmuş. Adminden yeni bir link isteyin.', link: { href: '/sifremi-unuttum', label: 'Yeni link iste' } }), 404);
  send(res, views.newPasswordPage({ username: reset.username }));
});

app.post('/sifre-sifirla/:token', (req, res) => {
  const reset = findReset(req.params.token);
  if (!reset) return res.redirect(`/sifre-sifirla/${encodeURIComponent(req.params.token)}`);
  const password = String(req.body.password || '');
  if (password.length < 8 || password !== String(req.body.password2 || '')) {
    return send(res, views.newPasswordPage({ username: reset.username, errs: ['Şifre en az 8 karakter olmalı ve iki alan aynı olmalı.'] }), 400);
  }
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ?, reset_requested_at = NULL WHERE id = ?').run(auth.hashPassword(password), reset.user_id);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE token = ?').run(new Date().toISOString(), reset.token);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
  });
  res.redirect('/giris?m=sifre');
});

// Giriş yapmış kullanıcı kendi şifresini değiştirir.
app.get('/hesap', auth.requireUser, (req, res) => send(res, views.accountPage({ user: req.user, flash: req.query.m === 'ok' ? 'Şifreniz değiştirildi.' : null })));
app.post('/hesap', auth.requireUser, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const password = String(req.body.password || '');
  const errs = [];
  if (!auth.verifyPassword(String(req.body.current || ''), user.password_hash)) errs.push('Mevcut şifre hatalı.');
  if (password.length < 8 || password !== String(req.body.password2 || '')) errs.push('Yeni şifre en az 8 karakter olmalı ve iki alan aynı olmalı.');
  if (errs.length) return send(res, views.accountPage({ user: req.user, errs }), 400);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), user.id);
  res.redirect('/hesap?m=ok');
});

// ---------- Yönetim (yalnızca admin): kullanıcılar, şifre sıfırlama, yedekler ----------
app.get('/yonetim', auth.requireAdmin, (req, res) => {
  const users = db.prepare(`SELECT u.id, u.username, u.email, u.reset_requested_at, u.created_at,
      (SELECT COUNT(*) FROM surveys s WHERE s.user_id = u.id) AS survey_count
    FROM users u ORDER BY u.reset_requested_at IS NULL, u.username`).all();
  let resetLink = null;
  if (req.query.sifirla) {
    const r = db.prepare(`SELECT r.token, u.username, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token = ? AND r.used_at IS NULL`).get(String(req.query.sifirla));
    if (r) {
      const url = `${config.baseUrl}/sifre-sifirla/${r.token}`;
      resetLink = { ...r, url, mailto: outlook.resetLinkMailto({ email: r.email, url, hours: RESET_HOURS }) };
    }
  }
  send(res, views.adminPage({
    user: req.user, users, resetLink, backups: yedek.listBackups(),
    s3Enabled: s3.enabled(), localDays: yedek.LOCAL_DAYS, remoteDays: yedek.REMOTE_DAYS,
    flash: { yedek: 'Yedek alındı.' }[req.query.m],
  }));
});

app.post('/yonetim/sifirla/:userId', auth.requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(req.params.userId) || 0);
  if (!target) return res.redirect('/yonetim');
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO password_resets (token, user_id, created_by, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, target.id, req.user.id, new Date(Date.now() + RESET_HOURS * 3600000).toISOString());
  res.redirect(`/yonetim?sifirla=${token}#sifirla`);
});

app.post('/yonetim/yedekle', auth.requireAdmin, async (req, res) => {
  await yedek.runBackup();
  res.redirect('/yonetim?m=yedek');
});

app.get('/yonetim/yedek/:file', auth.requireAdmin, (req, res) => {
  const file = String(req.params.file);
  if (!/^anket-\d{4}-\d{2}-\d{2}\.db$/.test(file)) return res.redirect('/yonetim');
  const full = path.join(config.backupDir, file);
  if (!fs.existsSync(full)) return res.redirect('/yonetim');
  res.download(full, file);
});

app.post('/cikis', (req, res) => { auth.endSession(req, res); res.redirect('/giris'); });

// ---------- Modeller ----------
// q: numara, kumaş, içerik veya kırılım içinde arar; marka: ilk kırılım seviyesine göre süzer.
const modelList = (q = '', marka = '') => {
  const like = `%${q}%`;
  return db.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM model_images i WHERE i.model_id = m.id) AS image_count
    FROM models m
    WHERE (? = '' OR m.ana_kumas LIKE ? OR m.icerik LIKE ? OR m.kirilim LIKE ? OR printf('MDL-%04d', m.id) LIKE ?)
      AND (? = '' OR json_extract(m.kirilim, '$[0]') = ?)
    ORDER BY m.id DESC`).all(q, like, like, like, like, marka, marka)
    .map((m) => ({ ...m, image: firstImage(m.id), kirilim: kirilim.parse(m.kirilim) }));
};

const usedMarkas = () => db.prepare(`SELECT DISTINCT json_extract(kirilim, '$[0]') AS v FROM models
  WHERE json_extract(kirilim, '$[0]') IS NOT NULL`).all().map((r) => r.v).sort(new Intl.Collator('tr').compare);

const nextModelCode = () => {
  const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'models'").get();
  return modelCode((row ? row.seq : 0) + 1);
};

function removeFiles(files = []) {
  for (const f of files) fs.rm(f.path, { force: true }, () => {});
}

app.get('/modeller', auth.requireUser, (req, res) => {
  const q = field(req.query.q, 60);
  const marka = field(req.query.marka, 120);
  send(res, views.modelsPage({ user: req.user, models: modelList(q, marka), q, marka, markas: usedMarkas() }));
});

app.get('/modeller/yeni', auth.requireUser, (req, res) => send(res, views.modelFormPage({ user: req.user, nextCode: nextModelCode() })));

// A/B ayarı: görseller aynı modelin alternatifleriyse (renk, desen, doku…) ayrı ayrı oylanır.
function abFields(body) {
  const ab = body.ab_test === '1';
  const konu = field(body.test_konusu, 60);
  return { ab_test: ab ? 1 : 0, test_konusu: ab && TEST_KONULARI.includes(konu) ? konu : null };
}

// Kırılım seçimleri k0, k1, … alanlarından gelir; listede olmayan bir yol reddedilir.
function kirilimField(body) {
  const path = kirilim.normalize(kirilim.levels.map((_, i) => body[`k${i}`]));
  return path === null ? null : JSON.stringify(path);
}

// Kırılım seçeneklerini sırayla getirir; model formundaki açılır listeler bunu kullanır.
app.get('/kirilim', auth.requireUser, (req, res) => {
  const prefix = [].concat(req.query.p || []).map(String);
  res.json({ options: kirilim.options(prefix) });
});

app.post('/modeller', auth.requireUser, upload.array('images'), (req, res) => {
  const values = { ana_kumas: field(req.body.ana_kumas, 120), icerik: field(req.body.icerik, 200), ...abFields(req.body), kirilim: kirilimField(req.body) };
  const labels = [].concat(req.body.labels || []);
  const errs = [];
  if (!req.files || !req.files.length) errs.push('En az bir görsel ekleyin (JPG, PNG, WEBP, HEIC).');
  if (!values.ana_kumas) errs.push('Ana kumaşı yazın.');
  if (!values.icerik) errs.push('İçeriği yazın.');
  if (values.ab_test && (!req.files || req.files.length < 2)) errs.push('A/B testi için en az iki görsel ekleyin; her görsel bir seçenek olur.');
  if (values.ab_test && !values.test_konusu) errs.push('A/B testinde neyin karşılaştırıldığını seçin.');
  if (values.kirilim === null) errs.push('Kırılım seçimi listede bulunamadı; seçimleri yeniden yapın.');
  if (errs.length) {
    removeFiles(req.files);
    return send(res, views.modelFormPage({ user: req.user, nextCode: nextModelCode(), values: { ...values, kirilim: null }, errs }), 400);
  }
  const id = tx(() => {
    const { lastInsertRowid } = db.prepare('INSERT INTO models (user_id, ana_kumas, icerik, ab_test, test_konusu, kirilim) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, values.ana_kumas, values.icerik, values.ab_test, values.test_konusu, values.kirilim);
    const addImg = db.prepare('INSERT INTO model_images (model_id, filename, label, sort_order) VALUES (?, ?, ?, ?)');
    req.files.forEach((f, i) => addImg.run(lastInsertRowid, f.filename, field(labels[i], 80) || null, i));
    return lastInsertRowid;
  });
  res.redirect(`/modeller/${id}`);
});

const getModel = (id) => db.prepare('SELECT * FROM models WHERE id = ?').get(Number(id) || 0);

app.get('/modeller/:id', auth.requireUser, (req, res) => {
  const model = getModel(req.params.id);
  if (!model) return res.redirect('/modeller');
  send(res, views.modelFormPage({ user: req.user, model, images: modelImages(model.id) }));
});

app.post('/modeller/:id', auth.requireUser, upload.array('images'), (req, res) => {
  const model = getModel(req.params.id);
  if (!model) { removeFiles(req.files); return res.redirect('/modeller'); }
  const ana = field(req.body.ana_kumas, 120);
  const icerik = field(req.body.icerik, 200);
  const ab = abFields(req.body);
  const kir = kirilimField(req.body);
  const images = modelImages(model.id);
  const errs = [];
  if (kir === null) errs.push('Kırılım seçimi listede bulunamadı; seçimleri yeniden yapın.');
  if (!ana || !icerik) errs.push('Ana kumaş ve içerik boş bırakılamaz.');
  if (ab.ab_test && images.length + (req.files || []).length < 2) errs.push('A/B testi için en az iki görsel gerekli.');
  if (ab.ab_test && !ab.test_konusu) errs.push('A/B testinde neyin karşılaştırıldığını seçin.');
  if (errs.length) {
    removeFiles(req.files);
    return send(res, views.modelFormPage({ user: req.user, model: { ...model, ...ab }, images, errs }), 400);
  }
  const labels = [].concat(req.body.labels || []);
  tx(() => {
    db.prepare('UPDATE models SET ana_kumas = ?, icerik = ?, ab_test = ?, test_konusu = ?, kirilim = ? WHERE id = ?')
      .run(ana, icerik, ab.ab_test, ab.test_konusu, kir, model.id);
    const setLabel = db.prepare('UPDATE model_images SET label = ? WHERE id = ?');
    for (const im of images) {
      if (`label_${im.id}` in req.body) setLabel.run(field(req.body[`label_${im.id}`], 80) || null, im.id);
    }
    const start = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM model_images WHERE model_id = ?').get(model.id).n;
    const addImg = db.prepare('INSERT INTO model_images (model_id, filename, label, sort_order) VALUES (?, ?, ?, ?)');
    (req.files || []).forEach((f, i) => addImg.run(model.id, f.filename, field(labels[i], 80) || null, start + i));
  });
  res.redirect(`/modeller/${model.id}`);
});

app.post('/modeller/:id/gorsel/:imageId/sil', auth.requireUser, (req, res) => {
  const img = db.prepare('SELECT * FROM model_images WHERE id = ? AND model_id = ?').get(Number(req.params.imageId) || 0, Number(req.params.id) || 0);
  // Son görsel silinmez; ankette her modelin en az bir görseli olmalı.
  if (img && modelImages(img.model_id).length > 1) {
    db.prepare('DELETE FROM model_images WHERE id = ?').run(img.id);
    fs.rm(path.join(config.uploadDir, img.filename), { force: true }, () => {});
  }
  res.redirect(`/modeller/${req.params.id}`);
});

// ---------- Anketler ----------
app.get('/anketler', auth.requireUser, (req, res) => {
  const list = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM survey_models sm WHERE sm.survey_id = s.id) AS model_count,
      (SELECT COUNT(*) FROM invitations i WHERE i.survey_id = s.id AND i.invited = 1) AS invited,
      (SELECT COUNT(*) FROM invitations i WHERE i.survey_id = s.id AND i.completed_at IS NOT NULL) AS completed
    FROM surveys s WHERE s.user_id = ? ORDER BY s.id DESC`).all(req.user.id);
  send(res, views.surveysPage({ user: req.user, surveys: list }));
});

app.get('/anketler/yeni', auth.requireUser, (req, res) => {
  const pre = req.query.model ? [Number(req.query.model)] : [];
  send(res, views.newSurveyPage({ user: req.user, models: modelList(), values: { modelIds: pre } }));
});

app.post('/anketler', auth.requireUser, (req, res) => {
  const rawIds = [].concat(req.body.models || []);
  const values = {
    title: field(req.body.title, 120),
    modelIds: rawIds.map(Number).filter(Boolean),
    emails: field(req.body.emails, 20000),
    days: Number(req.body.days),
    hour: field(req.body.hour, 5),
    result_emails: field(req.body.result_emails, 1000),
  };
  const errs = [];
  const emails = surveys.parseEmails(values.emails);
  const resultEmails = surveys.parseEmails(values.result_emails);
  const existing = values.modelIds.filter((id) => getModel(id));
  if (!values.title) errs.push('Anket adını yazın.');
  if (!existing.length) errs.push('En az bir model seçin.');
  if (!emails.valid.length) errs.push('En az bir geçerli e-posta adresi girin.');
  if (emails.invalid.length) errs.push(`Şu adresler geçersiz: ${emails.invalid.join(', ')}`);
  if (!resultEmails.valid.length || resultEmails.invalid.length) errs.push('Sonucun gönderileceği adresi kontrol edin.');
  if (!Number.isInteger(values.days) || values.days < 0 || values.days > 60) errs.push('Süre 0 ile 60 gün arasında olmalı.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(values.hour)) errs.push('Bitiş saatini SS:DD biçiminde girin.');
  if (!errs.length && new Date(closesAt(values.days, values.hour)) <= new Date()) {
    errs.push('Bitiş zamanı geçmişte kalıyor; gün sayısını artırın veya daha geç bir saat seçin.');
  }
  if (errs.length) return send(res, views.newSurveyPage({ user: req.user, models: modelList(), values, errs }), 400);

  const id = surveys.createSurvey({
    userId: req.user.id, title: values.title, modelIds: existing, emails: emails.valid,
    resultEmails: resultEmails.valid, days: values.days, hour: values.hour,
  });
  // "Oluştur ve gönder": hemen canlıya alır ve Outlook'u açar; "Taslak olarak kaydet": sonra gönderilir.
  if (req.body.action === 'gonder') {
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
    return res.redirect(`/anketler/${id}?m=${surveys.publishSurvey(survey) ? 'yayinda' : 'gecmis'}`);
  }
  res.redirect(`/anketler/${id}?m=taslak`);
});

const ownSurvey = (req) => db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(Number(req.params.id) || 0, req.user.id);
const invitedEmails = (surveyId) => db.prepare('SELECT email FROM invitations WHERE survey_id = ? AND invited = 1 ORDER BY id').all(surveyId).map((r) => r.email);

app.get('/anketler/:id', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  const flashes = {
    taslak: 'Anket taslak olarak kaydedildi. Hazır olduğunuzda “Gönder” ile canlıya alın.',
    yayinda: 'Anket canlıda. Outlook açıldıysa maili kontrol edip gönderin. Kapanışta sonucu göndermeyi unutmamak için hatırlatıcıyı takviminize ekleyin.',
    gecmis: 'Bitiş zamanı geçmişte kalıyor. Anketi yeniden oluşturun ya da daha uzun süre seçin.',
    kapatildi: 'Anket kapatıldı. Sonucu aşağıdan Outlook ile gönderebilirsiniz.',
  };
  const results = computeResults(survey.id);
  const owner = { name: req.user.username, email: req.user.email };
  send(res, views.surveyDetailPage({
    user: req.user,
    isAdmin: Boolean(req.user.is_admin),
    draftExpiresAt: surveys.draftExpiresAt(survey),
    results,
    invitations: db.prepare('SELECT * FROM invitations WHERE survey_id = ? ORDER BY completed_at IS NULL, invited DESC, email').all(survey.id),
    resultHtml: survey.closed_at || (survey.published_at && new Date(survey.closes_at) <= new Date()) ? resultEmail(results) : null,
    flash: flashes[req.query.m],
    autoOpenOutlook: req.query.m === 'yayinda',
    links: {
      test: `${config.baseUrl}/t/${survey.test_token}`,
      public: `${config.baseUrl}/k/${survey.public_token}`,
      result: `${config.baseUrl}/sonuc/${survey.result_token}`,
    },
    invite: survey.published_at ? outlook.inviteMailto({
      survey, modelCount: results.models.length, ownerName: owner.name, ownerEmail: owner.email, emails: invitedEmails(survey.id),
    }) : null,
    invitedEmails: invitedEmails(survey.id),
    resultMailto: outlook.resultMailto({ results, to: survey.result_emails.split(',').filter(Boolean) }),
    testMailto: req.user.is_admin ? outlook.testMailto({ survey, link: `${config.baseUrl}/t/${survey.test_token}`, to: config.adminEmails }) : null,
  }));
});

app.post('/anketler/:id/yayinla', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  if (survey.published_at) return res.redirect(`/anketler/${survey.id}`);
  const closes = surveys.publishSurvey(survey);
  res.redirect(`/anketler/${survey.id}?m=${closes ? 'yayinda' : 'gecmis'}`);
});

app.post('/anketler/:id/kapat', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey || !survey.published_at) return res.redirect('/anketler');
  surveys.closeSurvey(survey.id);
  res.redirect(`/anketler/${survey.id}?m=kapatildi`);
});

const isClosed = (s) => Boolean(s.closed_at) || (Boolean(s.published_at) && new Date(s.closes_at) <= new Date());
const markResultOpened = (id) => db.prepare('UPDATE surveys SET result_opened_at = COALESCE(result_opened_at, ?) WHERE id = ?').run(new Date().toISOString(), id);

app.get('/anketler/:id/rapor.png', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey || !survey.published_at) return res.redirect('/anketler');
  res.type('png').set('Cache-Control', 'no-store').send(renderReportPng(computeResults(survey.id)));
});

app.get('/anketler/:id/yorumlar.csv', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  res.type('text/csv; charset=utf-8').attachment(`anket-${survey.id}-yorumlar.csv`).send(commentsCsv(computeResults(survey.id)));
});

// Outlook taslağı: rapor görseli mailin içinde, görsel ve Excel dosyaları ekte, alıcı ve konu dolu.
app.get('/anketler/:id/sonuc.eml', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey || !isClosed(survey)) return res.redirect(`/anketler/${req.params.id}`);
  const results = computeResults(survey.id);
  const draft = resultDraft({
    results,
    ownerName: req.user.username,
    png: renderReportPng(results),
    csv: { results: resultsCsv(results), comments: commentsCsv(results) },
  });
  markResultOpened(survey.id);
  res.type('message/rfc822').attachment(`anket-${survey.id}-sonuc.eml`).send(draft);
});

// Sonuç maili Outlook'ta açıldı: listede "Sonucu gönder" uyarısı kalkar.
app.post('/anketler/:id/sonuc-acildi', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (survey) markResultOpened(survey.id);
  res.status(204).end();
});

// Outlook takvimi için kapanış hatırlatıcısı; içindeki link sonuç gönderme sayfasını açar.
app.get('/anketler/:id/hatirlatici.ics', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey || !survey.published_at) return res.redirect('/anketler');
  res.type('text/calendar; charset=utf-8')
    .attachment(`anket-${survey.id}-kapanis.ics`)
    .send(outlook.closingReminderIcs({ survey, url: `${config.baseUrl}/anketler/${survey.id}` }));
});

app.get('/anketler/:id/sonuclar.csv', auth.requireUser, (req, res) => {
  const survey = ownSurvey(req);
  if (!survey) return res.redirect('/anketler');
  res.type('text/csv; charset=utf-8')
    .attachment(`anket-${survey.id}-sonuclar.csv`)
    .send(resultsCsv(computeResults(survey.id)));
});

// ---------- Katılımcı (giriş gerekmez) ----------
const isOpen = (survey) => Boolean(survey.published_at) && !survey.closed_at && new Date(survey.closes_at) > new Date();
const closedText = (survey) => `Bu anket ${formatTR(survey.closed_at || survey.closes_at)} tarihinde kapandı.`;

function participantModels(surveyId) {
  return surveys.surveyModels(surveyId).map((m) => {
    const images = modelImages(m.id);
    return { ...m, images, ab: isAbTest(m, images) };
  });
}

// Formdaki yanıtları okur; eksik varsa ilgili model numarasını döner.
function parseAnswers(surveyId, body) {
  const parseRating = (value) => {
    const r = String(value || '');
    if (r === 'nms') return { score: null, notMyStyle: true };
    if (/^[1-5]$/.test(r)) return { score: Number(r), notMyStyle: false };
    return null;
  };
  const answers = [];
  for (const m of surveys.surveyModels(surveyId)) {
    const images = modelImages(m.id);
    const answer = { modelId: m.id, ratings: [], comment: field(body[`c_${m.id}`], 1000) };
    if (isAbTest(m, images)) {
      for (const im of images) {
        const rating = parseRating(body[`r_${m.id}_${im.id}`]);
        if (!rating) return { missing: m.code };
        answer.ratings.push({ imageId: im.id, ...rating });
      }
      const pick = Number(body[`p_${m.id}`]);
      if (body[`p_${m.id}`] === undefined || !(pick === 0 || images.some((im) => im.id === pick))) return { missing: m.code };
      answer.pick = pick;
    } else {
      const rating = parseRating(body[`r_${m.id}`]);
      if (!rating) return { missing: m.code };
      answer.ratings.push({ imageId: 0, ...rating });
    }
    answers.push(answer);
  }
  return { answers };
}

const missingPage = (res, code) => send(res, views.messagePage({ title: 'Eksik yanıt', text: `${code} için bütün seçenekleri değerlendirin. Geri dönüp tamamlayabilirsiniz.` }), 400);

// Ortak link (Outlook mailindeki): katılımcı e-postasını yazar, kendine ait ankete yönlenir.
const surveyByPublic = (token) => db.prepare('SELECT * FROM surveys WHERE public_token = ?').get(String(token));

app.get('/k/:token', (req, res) => {
  const survey = surveyByPublic(req.params.token);
  if (!survey) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu anket linki bulunamadı. Maildeki linki eksiksiz açtığınızdan emin olun.' }), 404);
  if (!survey.published_at) return send(res, views.messagePage({ title: 'Anket henüz başlamadı', text: 'Bu anket henüz canlıya alınmadı.' }));
  if (!isOpen(survey)) return send(res, views.messagePage({ title: 'Anket kapandı', text: closedText(survey) }));
  send(res, views.joinPage({ survey, modelCount: surveys.surveyModels(survey.id).length }));
});

app.post('/k/:token', (req, res) => {
  const survey = surveyByPublic(req.params.token);
  if (!survey || !isOpen(survey)) return res.redirect(`/k/${encodeURIComponent(req.params.token)}`);
  const entered = field(req.body.email, 120);
  const email = toAddress(entered);
  if (!email) {
    return send(res, views.joinPage({ survey, modelCount: surveys.surveyModels(survey.id).length, email: entered, errs: ['Kullanıcı adınızı şirket e-postanızın @ öncesi olarak yazın (ör. ad.soyad).'] }), 400);
  }
  const invitation = surveys.joinSurvey(survey.id, email);
  res.redirect(`/a/${invitation.token}`);
});

function loadInvitation(token) {
  const invitation = db.prepare('SELECT * FROM invitations WHERE token = ?').get(String(token));
  if (!invitation) return {};
  return { invitation, survey: db.prepare('SELECT * FROM surveys WHERE id = ?').get(invitation.survey_id) };
}

app.get('/a/:token', (req, res) => {
  const { invitation, survey } = loadInvitation(req.params.token);
  if (!invitation) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu anket linki bulunamadı.' }), 404);
  if (invitation.completed_at) return send(res, views.messagePage({ title: 'Teşekkürler', text: 'Bu anketi tamamladınız. Görüşleriniz kaydedildi.' }));
  if (!isOpen(survey)) return send(res, views.messagePage({ title: 'Anket kapandı', text: closedText(survey) }));
  send(res, views.participantPage({ survey, models: participantModels(survey.id), email: invitation.email }));
});

app.post('/a/:token', (req, res) => {
  const { invitation, survey } = loadInvitation(req.params.token);
  if (!invitation || invitation.completed_at || !isOpen(survey)) return res.redirect(`/a/${encodeURIComponent(req.params.token)}`);
  const { answers, missing } = parseAnswers(survey.id, req.body);
  if (missing) return missingPage(res, missing);
  surveys.submitResponses(invitation.id, answers);
  send(res, views.messagePage({ title: 'Teşekkürler', text: `Görüşleriniz kaydedildi. Anket ${formatTR(survey.closes_at)} tarihinde kapanacak.` }));
});

// Test linki: yalnızca admin; anketi canlıya almadan önce ve sonra denemek için. Yanıtlar kaydedilmez.
const surveyByTest = (token) => db.prepare('SELECT * FROM surveys WHERE test_token = ?').get(String(token));

app.get('/t/:token', auth.requireAdmin, (req, res) => {
  const survey = surveyByTest(req.params.token);
  if (!survey) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu test linki bulunamadı.' }), 404);
  send(res, views.participantPage({ survey, models: participantModels(survey.id), test: true }));
});

app.post('/t/:token', auth.requireAdmin, (req, res) => {
  const survey = surveyByTest(req.params.token);
  if (!survey) return res.redirect(`/t/${encodeURIComponent(req.params.token)}`);
  const { missing } = parseAnswers(survey.id, req.body);
  if (missing) return missingPage(res, missing);
  send(res, views.messagePage({
    title: 'Test tamamlandı',
    text: 'Anket sorunsuz çalışıyor. Bu test yanıtları kaydedilmedi ve sonuçlara katılmaz.',
    link: { href: `/t/${survey.test_token}`, label: 'Testi tekrarla' },
  }));
});

// Sonuç sayfası: giriş gerektirmez, anket kapandıktan sonra açılır. Outlook ile paylaşılan sonuç mailindeki link.
app.get('/sonuc/:token', (req, res) => {
  const survey = db.prepare('SELECT * FROM surveys WHERE result_token = ?').get(String(req.params.token));
  if (!survey) return send(res, views.messagePage({ title: 'Link geçersiz', text: 'Bu sonuç linki bulunamadı.' }), 404);
  if (isOpen(survey) || !survey.published_at) {
    return send(res, views.messagePage({ title: 'Sonuç henüz hazır değil', text: `Anket ${formatTR(survey.closes_at)} tarihinde kapanınca sonuçlar burada görünecek.` }));
  }
  send(res, views.publicResultPage({ results: computeResults(survey.id) }));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const text = err.code === 'LIMIT_FILE_SIZE' ? 'Bir görsel 20 MB sınırını aşıyor.' : 'Görseller yüklenemedi.';
    return send(res, views.messagePage({ title: 'Yükleme hatası', text }), 400);
  }
  console.error(err);
  send(res, views.messagePage({ title: 'Bir sorun oluştu', text: 'İşlem tamamlanamadı. Sayfayı yenileyip tekrar deneyin.' }), 500);
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Model Beğeni Anketi çalışıyor: ${config.baseUrl}`);
    surveys.startScheduler();
    yedek.backupIfDue();
    setInterval(() => yedek.backupIfDue(), 60000);
  });
}

module.exports = app;
