const { html, raw } = require('./html');
const { modelCode, TEST_KONULARI } = require('./db');
const { formatTR } = require('./time');
const { formatAvg } = require('./results');
const kirilim = require('./kirilim');
const config = require('./config');
const { version, asset } = require('./surum');
const dil = require('./dil');
const { DRAFT_DAYS, draftExpiresAt } = require('./surveys');

const draftNote = (survey) => `Taslaklar ${DRAFT_DAYS} gün içinde gönderilmezse otomatik silinir. Bu taslak ${formatTR(draftExpiresAt(survey))} tarihinde silinecek.`;

function layout({ title, user, body, nav = true, active = '', lang = 'tr' }) {
  const link = (href, label, key) => html`<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  return `<!doctype html><html lang="${lang === 'en' ? 'en' : 'tr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${html`${title}`} · Model Beğeni Anketi</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="${asset('/static/style.css')}">
<script src="${asset('/static/outlook.js')}" defer></script>
<script src="${asset('/static/guncelle.js')}" defer></script>
<script src="${asset('/static/sil-onay.js')}" defer></script>
<meta name="app-version" content="${version}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/ikon-180.png">
<meta name="theme-color" content="#EAF4FF">
</head><body>
${nav && user ? html`<header class="bar"><div class="bar-in">
  <a class="brand" href="/modeller">Model Beğeni Anketi</a>
  <nav>${link('/modeller', 'Modeller', 'modeller')}${link('/anketler', 'Anketler', 'anketler')}${user.is_admin ? link('/yonetim', 'Yönetim', 'yonetim') : ''}</nav>
  <a class="linkbtn ${active === 'hesap' ? 'on' : ''}" href="/hesap" title="Hesabım"><span class="wide-only">${user.username}</span><span class="narrow-only">Hesap</span></a>
  <form method="post" action="/cikis" class="wide-only"><button class="linkbtn">Çıkış</button></form>
</div></header>` : ''}
<main class="page">${body}</main>
</body></html>`;
}

function errors(list) {
  if (!list || !list.length) return '';
  return html`<div class="alert">${list.map((e) => html`<div>${e}</div>`)}</div>`;
}

// Kullanıcı adı alanı: yazılan adın yanında şirket alan adı gösterilir (ad.soyad @lcwaikiki.com).
function usernameField(value, autocomplete = 'username', id = 'username', name = 'username') {
  return html`<label class="field"><span>Kullanıcı adı</span>
    <div class="domain-input"><input id="${id}" name="${name}" required autocomplete="${autocomplete}" autocapitalize="none" spellcheck="false" placeholder="ad.soyad" value="${value || ''}"><em>@${config.companyDomain}</em></div>
    <small>Şirket e-postanızın @ öncesi.</small></label>`;
}

function authPage({ mode, values = {}, errs, needsCode, flash }) {
  const isReg = mode === 'kayit';
  const isAdmin = mode === 'yonetici';
  return layout({
    title: isReg ? 'Hesap oluştur' : isAdmin ? 'Yönetici girişi' : 'Giriş',
    nav: false,
    body: html`
    <div class="auth ${isAdmin ? 'auth-admin' : ''}">
      ${isAdmin ? html`<div class="admin-badge" aria-hidden="true">YÖNETİCİ</div>` : html`<div class="auth-art" aria-hidden="true"><i class="sw sw1"></i><i class="sw sw2"></i></div>`}
      <h1>${isReg ? 'Hoş geldiniz' : isAdmin ? 'Yönetici girişi' : 'Tekrar hoş geldiniz'}</h1>
      <p class="sub">${isReg ? 'Hesabınızı bir kez oluşturun, sonra bu bilgilerle girin.' : isAdmin ? 'Kullanıcılar, şifre sıfırlama ve yedekler. Yalnızca yönetici hesapları girebilir.' : 'Kullanıcı adınız ve şifrenizle girin.'}</p>
      ${flash ? html`<div class="ok">${flash}</div>` : ''}
      ${errors(errs)}
      <form method="post" class="stack">
        ${usernameField(values.username)}
        <label class="field"><span>Şifre</span><input id="password" name="password" type="password" required minlength="${isReg ? 8 : 1}" autocomplete="${isReg ? 'new-password' : 'current-password'}">${isReg ? html`<small>En az 8 karakter.</small>` : ''}</label>
        ${isReg && needsCode ? html`<label class="field"><span>Kayıt kodu</span><input id="code" name="code" required value="${values.code || ''}"><small>Şirket yöneticinizden alabilirsiniz.</small></label>` : ''}
        <button class="btn ${isAdmin ? 'outlook' : ''}">${isReg ? 'Başlayalım' : isAdmin ? 'Yönetici olarak gir' : 'Giriş yap'}</button>
      </form>
      <p class="center small">${isReg ? html`Hesabınız var mı? <a href="/giris">Giriş yapın</a>`
    : isAdmin ? html`<a href="/sifremi-unuttum">Şifremi unuttum</a> · <a href="/giris">Kullanıcı girişi</a>`
      : html`<a href="/sifremi-unuttum">Şifremi unuttum</a> · İlk kez mi geldiniz? <a href="/kayit">Hesap oluşturun</a>`}</p>
      ${mode === 'giris' ? html`<p class="center small"><a class="muted-link" href="/yonetici">Yönetici girişi</a></p>` : ''}
    </div>`,
  });
}

function forgotPage({ sent, username, adminMailto }) {
  return layout({
    title: 'Şifremi unuttum', nav: false,
    body: html`
    <div class="auth">
      <div class="auth-art" aria-hidden="true"><i class="sw sw1"></i><i class="sw sw2"></i></div>
      <h1>Şifremi unuttum</h1>
      ${sent ? html`
      <div class="ok">İsteğiniz kaydedildi. Adminler size tek kullanımlık bir şifre sıfırlama linki gönderecek.</div>
      <p class="sub">Daha hızlı olması için adminlere Outlook'tan da yazabilirsiniz.</p>
      <a class="btn outlook" href="${adminMailto}">Adminlere Outlook ile yaz</a>
      <p class="center small"><a href="/giris">Girişe dön</a></p>` : html`
      <p class="sub">Kullanıcı adınızı yazın. Adminler size yeni şifre belirleyebileceğiniz bir link gönderir.</p>
      <form method="post" class="stack">
        ${usernameField(username)}
        <button class="btn">Sıfırlama iste</button>
      </form>
      <p class="center small"><a href="/giris">Girişe dön</a></p>`}
    </div>`,
  });
}

function passwordFields(withCurrent) {
  return html`
    ${withCurrent ? html`<label class="field"><span>Mevcut şifre</span><input id="current" name="current" type="password" required autocomplete="current-password"></label>` : ''}
    <label class="field"><span>Yeni şifre</span><input id="password" name="password" type="password" required minlength="8" autocomplete="new-password"><small>En az 8 karakter.</small></label>
    <label class="field"><span>Yeni şifre (tekrar)</span><input id="password2" name="password2" type="password" required minlength="8" autocomplete="new-password"></label>`;
}

function newPasswordPage({ username, errs }) {
  return layout({
    title: 'Yeni şifre', nav: false,
    body: html`
    <div class="auth">
      <div class="auth-art" aria-hidden="true"><i class="sw sw1"></i><i class="sw sw2"></i></div>
      <h1>Yeni şifre belirleyin</h1>
      <p class="sub">Kullanıcı adı: <b>${username}</b></p>
      ${errors(errs)}
      <form method="post" class="stack">${passwordFields(false)}<button class="btn">Şifreyi kaydet</button></form>
    </div>`,
  });
}

function accountPage({ user, errs, flash }) {
  return layout({
    title: 'Hesabım', user, active: 'hesap',
    body: html`
    <div class="head"><div><h1>Hesabım</h1><p class="sub">${user.username} · ${user.email}${user.is_admin ? ' · Admin' : ''}</p></div></div>
    ${flash ? html`<div class="ok">${flash}</div>` : ''}
    ${errors(errs)}
    <form method="post" class="card stack narrow"><div class="label">Şifre değiştir</div>${passwordFields(true)}<button class="btn">Şifreyi değiştir</button></form>
    <form method="post" action="/cikis"><button class="btn btn-soft">Çıkış yap</button></form>`,
  });
}

function formatSize(bytes) {
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function adminPage({ user, users, resetLink, backups, s3Enabled, localDays, remoteDays, flash }) {
  const requested = users.filter((u) => u.reset_requested_at).length;
  return layout({
    title: 'Yönetim', user, active: 'yonetim',
    body: html`
    <div class="head"><div><h1>Yönetim</h1><p class="sub">${users.length} kullanıcı${requested ? ` · ${requested} şifre sıfırlama isteği` : ''}</p></div></div>
    ${flash ? html`<div class="ok">${flash}</div>` : ''}
    ${resetLink ? html`<div class="card stack result-mail pending" id="sifirla">
      <div class="label">${resetLink.username} için sıfırlama linki</div>
      <p class="sub">Link 24 saat geçerli ve bir kez kullanılabilir. Kullanıcı yeni şifresini belirleyince açık oturumları kapanır.</p>
      <a class="btn outlook" href="${resetLink.mailto}">Linki ${resetLink.email} adresine Outlook ile gönder</a>
      ${copyField('resetlink', 'Sıfırlama linki', resetLink.url)}
    </div>` : ''}
    <h2>Kullanıcılar</h2>
    <div class="card"><table class="tbl"><thead><tr><th>Kullanıcı</th><th>Anket</th><th></th></tr></thead><tbody>
      ${users.map((u) => html`<tr>
        <td><b>${u.username}</b><div class="sub">${u.email}</div>${u.reset_requested_at ? html`<span class="pill wait">Şifre sıfırlama istedi</span>` : ''}</td>
        <td class="nw">${u.survey_count}</td>
        <td class="nw"><form method="post" action="/yonetim/sifirla/${u.id}"><button class="btn btn-sm ${u.reset_requested_at ? '' : 'btn-soft'}">Sıfırlama linki</button></form></td></tr>`)}
    </tbody></table></div>
    <h2>Yedekler</h2>
    <div class="card stack">
      <p class="sub">Her gün 03:00'ten sonra otomatik yedek alınır. Veritabanının kopyası ${localDays} gün sunucu diskinde tutulur${s3Enabled ? html`; ayrıca diskten bağımsız depolama alanına gönderilir (veritabanı ${remoteDays} gün, görseller kalıcı).` : html`. <b>Diskten bağımsız depolama alanı ayarlı değil.</b>`}</p>
      <form method="post" action="/yonetim/yedekle"><button class="btn btn-sm">Şimdi yedekle</button></form>
      ${backups.length ? html`<table class="tbl"><thead><tr><th>Tarih</th><th>Boyut</th><th>Depolama alanı</th><th></th></tr></thead><tbody>
        ${backups.map((b) => html`<tr><td class="nw">${formatTR(b.created_at.replace(' ', 'T') + 'Z')}</td><td class="nw">${formatSize(b.size)}</td>
          <td>${b.remote.startsWith('ok') ? html`<span class="pill done">${b.remote}</span>` : b.remote === 'kapalı' ? html`<span class="pill">kapalı</span>` : html`<span class="err">${b.remote}</span>`}</td>
          <td class="nw">${b.available ? html`<a href="/yonetim/yedek/${b.file}">İndir</a>` : html`<span class="sub">silindi</span>`}</td></tr>`)}
      </tbody></table>` : html`<p class="empty">Henüz yedek yok.</p>`}
    </div>`,
  });
}

function thumb(filename, cls = '') {
  return filename
    ? html`<img class="ph ${cls}" src="/uploads/${filename}" alt="" loading="lazy">`
    : html`<div class="ph ph-empty ${cls}">Görsel yok</div>`;
}

// Modeli siler; onay sorulur (sil-onay.js).
function deleteModelForm(m, compact) {
  return html`<form method="post" action="/modeller/${m.id}/sil" class="delete-form ${compact ? 'tile-del' : ''}"
    data-confirm="${modelCode(m.id)} · ${m.ana_kumas} modeli ve görselleri kalıcı olarak silinsin mi?">
    <button class="${compact ? 'icon-del round' : 'btn btn-sm btn-danger'}" title="Modeli sil" aria-label="${modelCode(m.id)} modelini sil">${compact ? '' : 'Modeli sil'}</button>
  </form>`;
}

function modelsPage({ user, models, q, marka, markas = [], flash }) {
  const filtered = Boolean(q || marka);
  return layout({
    title: 'Modeller', user, active: 'modeller',
    body: html`
    <div class="head">
      <div class="head-actions"><a class="btn btn-sm" href="/anketler/yeni">Anket oluştur</a></div>
      <div><h1>Modellerim</h1><p class="sub">${models.length} model${models[0] && !filtered ? ` · son eklenen ${modelCode(models[0].id)}` : ''}</p></div>
      <form class="search" method="get">
        <input id="q" name="q" placeholder="Numara, kumaş, içerik, grup ara" value="${q || ''}">
        ${markas.length ? html`<select id="marka" name="marka" aria-label="${kirilim.levels[0]}" onchange="this.form.submit()">
          <option value="">Tüm ${kirilim.levels[0].toLocaleLowerCase('tr')}</option>
          ${markas.map((mk) => html`<option ${mk === marka ? 'selected' : ''}>${mk}</option>`)}</select>` : ''}
      </form>
    </div>
    ${flash && flash.ok ? html`<div class="ok">${flash.ok}</div>` : ''}
    ${flash && flash.err ? html`<div class="alert">${flash.err}</div>` : ''}
    <div class="gallery">
      <a class="add-tile" href="/modeller/yeni"><b>+</b><span>Yeni model</span></a>
      ${models.map((m) => html`<div class="tile-wrap">
        <a class="tile" href="/modeller/${m.id}">
          <div class="tile-img">${thumb(m.image)}<span class="no">${modelCode(m.id)}</span>${m.ab_test && m.image_count > 1 ? html`<span class="ab">A/B · ${m.image_count} seçenek</span>` : m.image_count > 1 ? html`<span class="count">${m.image_count} görsel</span>` : ''}</div>
          <b>${m.ana_kumas}</b><span>${m.icerik}</span>
          ${m.kirilim.length > 1 ? html`<span class="kir">${m.kirilim.slice(1).join(' · ')}</span>` : ''}
          ${m.survey_count ? html`<span class="in-use">${m.survey_count} ankette</span>` : ''}
        </a>
        ${(user.is_admin || m.user_id === user.id) && !m.survey_count ? deleteModelForm(m, true) : ''}
      </div>`)}
    </div>
    ${!models.length && !filtered ? html`<p class="empty">Henüz model yok. <a href="/modeller/yeni">İlk modeli ekleyin</a>; numarası otomatik verilir.</p>` : ''}
    ${!models.length && filtered ? html`<p class="empty">Bu aramayla eşleşen model yok. <a href="/modeller">Filtreyi temizle</a></p>` : ''}`,
  });
}

// Alt kırılımlı seçim: her seviye bir öncekine göre dolar. Seviye sayısı kirilim.json'daki başlıklardan gelir.
function kirilimFields(value) {
  const path = Array.isArray(value) ? value : kirilim.parse(value);
  return html`<fieldset class="kirilim" id="kirilim">
    <legend>Ürün kırılımı</legend>
    ${kirilim.levels.map((label, i) => {
    const opts = i <= path.length ? kirilim.options(path.slice(0, i)) : [];
    return html`<label class="field"><span>${label}</span>
      <select id="k${i}" name="k${i}" data-level="${i}" ${i > path.length ? 'disabled' : ''}>
        <option value="">${i > path.length ? 'Önce üstteki alanı seçin' : 'Seçin'}</option>
        ${opts.map((o) => html`<option ${path[i] === o ? 'selected' : ''}>${o}</option>`)}
      </select></label>`;
  })}
  </fieldset>
  <script src="${asset('/static/kirilim.js')}"></script>`;
}

function modelFormPage({ user, model, images = [], nextCode, values = {}, errs, added, saved, canDelete, surveyCount }) {
  const isNew = !model;
  const v = model || values;
  return layout({
    title: isNew ? 'Yeni model' : modelCode(model.id), user, active: 'modeller',
    body: html`
    <a class="back" href="/modeller">← Modeller</a>
    <div class="head"><div><h1>${isNew ? 'Yeni model' : modelCode(model.id)}</h1>
      <p class="sub">${isNew ? html`Kaydedince <b>${nextCode}</b> numarası verilecek.` : `Eklenme: ${formatTR(model.created_at.replace(' ', 'T') + 'Z')}`}</p></div></div>
    ${errors(errs)}
    ${added || saved ? html`<div class="card next-step">
      <div><b>${modelCode(model.id)} ${added ? 'eklendi' : 'kaydedildi'}.</b><p class="sub">Bu modelle anket oluşturabilir ya da başka bir model ekleyebilirsiniz.</p></div>
      <div class="actions">
        <a class="btn" href="/anketler/yeni?model=${model.id}">Ankete ilerle</a>
        <a class="btn btn-soft" href="/modeller/yeni">Yeni model ekle</a>
      </div>
    </div>` : ''}
    <form class="stack" method="post" enctype="multipart/form-data" action="${isNew ? '/modeller' : `/modeller/${model.id}`}">
    ${!isNew && images.length ? html`<div class="card"><div class="label">Görseller</div><div class="img-grid">
      ${images.map((im) => html`<div class="img-cell">${thumb(im.filename)}<span class="no">${im.letter}</span>
        <button class="x" formaction="/modeller/${model.id}/gorsel/${im.id}/sil" formnovalidate title="Görseli kaldır" aria-label="${im.letter} görselini kaldır">×</button>
        <input class="vlabel" name="label_${im.id}" maxlength="80" placeholder="Seçenek adı, ör. Lacivert-beyaz" value="${im.label || ''}" aria-label="${im.letter} seçeneğinin adı"></div>`)}
    </div></div>` : ''}
    <div class="card stack">
      <label class="drop" for="images">
        <input id="images" name="images" type="file" accept="image/*" multiple ${isNew ? 'required' : ''}>
        <b>${isNew ? 'Görsel ekle' : 'Görsel ekle (isteğe bağlı)'}</b><span>Birden fazla seçebilir, telefonda fotoğraf çekebilirsiniz.</span>
      </label>
      <div class="preview" id="preview"></div>
      <fieldset class="abbox">
        <label class="switch"><input type="checkbox" id="ab_test" name="ab_test" value="1" ${v.ab_test ? 'checked' : ''}>
          <span><b>A/B testi: görseller bu modelin alternatifleri</b><small>Renk, jakar deseni, çizgi yerleşimi, doku, ekose renkleri gibi seçenekleri karşılaştırın. Katılımcı her seçeneği ayrı puanlar ve koleksiyonda hangisinin olmasını istediğini seçer. Kapalıysa görseller aynı ürünün farklı açıları sayılır.</small></span></label>
        <label class="field ab-only"><span>Neyi karşılaştırıyorsunuz?</span>
          <select id="test_konusu" name="test_konusu"><option value="">Seçin</option>
            ${TEST_KONULARI.map((k) => html`<option ${v.test_konusu === k ? 'selected' : ''}>${k}</option>`)}</select></label>
      </fieldset>
      <label class="field"><span>Ana kumaş</span><input id="ana_kumas" name="ana_kumas" required maxlength="120" placeholder="ör. Viskon krep" value="${v.ana_kumas || ''}"></label>
      <label class="field"><span>İçerik</span><input id="icerik" name="icerik" required maxlength="200" placeholder="ör. %100 Viskon" value="${v.icerik || ''}"></label>
      <label class="field"><span>Tuşe / model özelliği <em>isteğe bağlı</em></span><input id="ozellik" name="ozellik" maxlength="200" placeholder="ör. yumuşak tuşe, şardonlu, esnek, oversize kalıp" value="${v.ozellik || ''}"></label>
      ${kirilimFields(v.kirilim)}
      <div class="actions">
        <button class="btn">${isNew ? 'Modeli kaydet' : 'Değişiklikleri kaydet'}</button>
        <button class="btn btn-soft" name="next" value="anket">Kaydet ve ankete ilerle</button>
      </div>
    </div>
    </form>
    ${model && canDelete ? html`<div class="danger-zone">${surveyCount
    ? html`<p class="sub small">Bu model ${surveyCount} ankette kullanıldığı için silinemez. Silmek için önce o anketleri silin.</p>`
    : deleteModelForm(model, false)}</div>` : ''}
    <script src="${asset('/static/onizleme.js')}"></script>`,
  });
}

function surveyState(s) {
  if (!s.published_at) return 'taslak';
  if (s.closed_at || new Date(s.closes_at) <= new Date()) return 'kapali';
  return 'acik';
}

// Anketi siler; onay sorulur (sil-onay.js). Modeller silinmez.
function deleteSurveyForm(s, compact) {
  const answers = s.completed ? ` ve ${s.completed} yanıtı` : '';
  return html`<form method="post" action="/anketler/${s.id}/sil" class="delete-form"
    data-confirm="“${s.title}” anketi${answers} kalıcı olarak silinsin mi? Modeller silinmez.">
    <button class="${compact ? 'icon-del' : 'btn btn-sm btn-danger'}" title="Anketi sil" aria-label="${s.title} anketini sil">${compact ? '' : 'Anketi sil'}</button>
  </form>`;
}

function surveysPage({ user, surveys, flash }) {
  const status = (s) => ({
    taslak: html`<span class="pill wait">Taslak</span>`,
    acik: html`<span class="pill open">Canlıda</span>`,
    kapali: s.result_opened_at ? html`<span class="pill done">Kapandı</span>` : html`<span class="pill wait">Sonucu gönder</span>`,
  })[surveyState(s)];
  return layout({
    title: 'Anketler', user, active: 'anketler',
    body: html`
    <div class="head"><div><h1>Anketler</h1><p class="sub">${surveys.length} anket</p></div>
      <a class="btn btn-sm" href="/anketler/yeni">+ Yeni anket</a></div>
    ${flash ? html`<div class="ok">${flash}</div>` : ''}
    <div class="list">
      ${surveys.map((s) => html`<div class="row card survey-row">
        <a class="row-link" href="/anketler/${s.id}">
          <div class="row-main"><b>${s.title}${s.lang === 'en' ? html` <span class="lang-pill">EN</span>` : ''}</b><span class="sub">${s.model_count} model · ${s.invited ? `${s.completed}/${s.invited}` : s.completed} yanıt · ${s.published_at ? `kapanış ${formatTR(s.closes_at)}` : `gönderilince ${s.open_days} gün açık kalır`}</span>
            ${s.published_at ? '' : html`<small class="warn-note">${formatTR(draftExpiresAt(s))} tarihinde silinecek</small>`}</div>
          ${status(s)}</a>
        ${deleteSurveyForm(s, true)}
      </div>`)}
    </div>
    ${!surveys.length ? html`<p class="empty">Henüz anket yok. Önce modelleri ekleyin, sonra <a href="/anketler/yeni">anket oluşturun</a>.</p>` : ''}`,
  });
}

function newSurveyPage({ user, models, values = {}, errs }) {
  const selected = new Set((values.modelIds || []).map(Number));
  return layout({
    title: 'Yeni anket', user, active: 'anketler',
    body: html`
    <a class="back" href="/anketler">← Anketler</a>
    <div class="head"><div><h1>Anket oluştur</h1><p class="sub">Modelleri seçin, kişileri ekleyin, süreyi belirleyin. Hemen gönderebilir ya da taslak olarak kaydedip sonra gönderebilirsiniz.</p></div></div>
    ${errors(errs)}
    <form class="stack" method="post" action="/anketler">
      <div class="card stack">
        <fieldset class="lang-pick"><legend>Anket dili</legend>
          <label><input type="radio" name="lang" value="tr" ${values.lang === 'en' ? '' : 'checked'}><span><b>Türkçe</b><small>Katılımcılar Türkçe görür</small></span></label>
          <label><input type="radio" name="lang" value="en" ${values.lang === 'en' ? 'checked' : ''}><span><b>English</b><small>Türkçe yazın; anket İngilizceye otomatik çevrilir</small></span></label>
        </fieldset>
        <label class="field"><span>Anket adı</span><input id="title" name="title" required maxlength="120" placeholder="ör. Yaz 2027 · Elbise seçkisi" value="${values.title || ''}"></label>
      </div>
      <div class="card">
        <div class="label">Modeller <span class="sub" id="selcount"></span></div>
        ${models.length ? html`<div class="pick">${models.map((m) => html`
          <label class="pick-item"><input type="checkbox" name="models" value="${m.id}" ${selected.has(m.id) ? 'checked' : ''}>
            ${thumb(m.image)}<span class="no">${modelCode(m.id)}</span>${m.ab_test && m.image_count > 1 ? html`<span class="ab">A/B</span>` : ''}<small>${m.ana_kumas}</small></label>`)}</div>`
    : html`<p class="empty">Önce <a href="/modeller/yeni">model ekleyin</a>.</p>`}
      </div>
      <div class="card stack">
        <label class="field"><span>Kime gönderilsin? <em>isteğe bağlı</em></span>
          <textarea id="emails" name="emails" rows="4" placeholder="mehmet.yilmaz&#10;selin.kaya&#10;dis.tedarikci@ornek.com">${values.emails || ''}</textarea>
          <small>Kullanıcı adı (ad.soyad) ya da tam adres yazın; her satıra bir kişi ya da virgülle ayırın. Outlook'tan kopyaladığınız "Ad Soyad &lt;adres&gt;" listesi de olur. Gönderirken Outlook'ta gizli alıcı (BCC) olarak eklenir. Boş bırakırsanız alıcıları Outlook'ta kendiniz eklersiniz ya da anket linkini paylaşırsınız.</small></label>
      </div>
      <div class="card stack">
        <div class="two">
          <label class="field"><span>Kaç gün açık kalsın?</span>
            <div class="stepper"><button type="button" data-step="-1" aria-label="Azalt">−</button>
            <input id="days" name="days" type="number" min="0" max="60" required value="${values.days ?? 5}"><em>gün</em>
            <button type="button" data-step="1" aria-label="Artır">+</button></div></label>
          <label class="field"><span>Bitiş saati</span><input id="hour" name="hour" type="time" required value="${values.hour || '18:00'}"></label>
        </div>
        <p class="sub" id="closeinfo"></p>
        <label class="field"><span>Sonuç kime gelsin?</span><input id="result_emails" name="result_emails" required value="${values.result_emails ?? user.email}">
          <small>Birden fazla adresi virgülle ayırın.</small></label>
      </div>
      <div class="actions">
        <button class="btn" name="action" value="gonder">Oluştur ve Outlook'ta gönder</button>
        <button class="btn btn-soft" name="action" value="taslak">Taslak olarak kaydet</button>
      </div>
      <p class="sub small">Taslaklar ${DRAFT_DAYS} gün içinde gönderilmezse otomatik silinir.</p>
    </form>
    <script src="${asset('/static/anket-olustur.js')}"></script>`,
  });
}

function copyField(id, label, value, openLabel) {
  return html`<div class="field"><span>${label}</span>
    <div class="copy"><input id="${id}" readonly value="${value}">
      <button type="button" class="btn btn-sm btn-soft" data-copy="${id}">Kopyala</button>
      ${openLabel ? html`<a class="btn btn-sm btn-soft" href="${value}" target="_blank" rel="noopener">${openLabel}</a>` : ''}</div></div>`;
}

function resultsList(models) {
  return html`<div class="list">
      ${models.map((m, i) => html`<div class="card result ${m.ab ? 'abr' : ''}">
        <div class="rank">${i + 1}</div>
        ${thumb(m.image, 'sm')}
        <div class="result-main">
          <div><b>${m.code}</b> <span class="sub">· ${m.ana_kumas} · ${m.icerik}${m.ozellik ? ` · ${m.ozellik}` : ''}</span></div>
          ${m.kirilim.length ? html`<div class="kir">${m.kirilim.join(' · ')}</div>` : ''}
          <div class="meter"><i style="width:${m.avg === null ? 0 : Math.round((m.avg / 5) * 100)}%"></i></div>
          ${m.ab ? html`<div class="sub"><span class="ab inline">A/B</span> ${m.test_konusu || 'Seçenek karşılaştırması'} · ${m.winner ? html`önde: <b>${m.winner.letter}${m.winner.label ? ` · ${m.winner.label}` : ''}</b>` : 'henüz oy yok'}</div>
          <div class="variants">${m.variants.map((v) => html`<div class="variant ${m.winner && m.winner.imageId === v.imageId ? 'win' : ''}">
            <div class="tile-img">${thumb(v.filename)}<span class="no">${v.letter}</span></div>
            <div class="v-body"><b>${v.label || `Seçenek ${v.letter}`}</b>
              <div class="v-num"><span><em>${formatAvg(v.avg)}</em> ort.</span><span><em>${v.picks}</em> tercih</span></div>
              <div class="sub">${v.scored} puan · ${v.notMyStyle} tarzım değil</div>
              <div class="dist">${v.dist.map((n, k) => html`<span><b>${k + 1}</b>${n}</span>`)}</div></div></div>`)}</div>
          ${m.noPick ? html`<div class="sub">${m.noPick} kişi hiçbirini seçmedi</div>` : ''}`
    : html`<div class="sub">${m.scored} kişi puan verdi · ${m.notMyStyle} tarzım değil</div>
          <div class="dist">${m.dist.map((n, k) => html`<span><b>${k + 1}</b>${n}</span>`)}</div>`}
          ${m.comments.length ? html`<details><summary>${m.comments.length} yorum</summary>${m.comments.map((c) => html`<p class="comment">“${c.text}” <span class="sub">· ${c.email}${c.note ? ` · ${c.note}` : ''}</span></p>`)}</details>` : ''}
        </div>
        <div class="avg">${formatAvg(m.avg)}</div>
      </div>`)}
    </div>`;
}

// İngilizce ankette katılımcının göreceği metinler: Türkçesi, İngilizcesi (düzeltilebilir).
function translationsCard(survey, translations, engineName) {
  const missing = translations.filter((t) => !t.en).length;
  const copied = translations.filter((t) => t.copied).length;
  return html`<form class="card stack" id="ceviriler" method="post" action="/anketler/${survey.id}/ceviri">
    <div class="label">İngilizce metinler <span class="lang-pill">EN</span></div>
    <p class="sub">Metinler ${engineName} ile otomatik çevrilir. Kontrol edip gerekirse düzeltin; düzeltmeniz sonraki anketlerde de kullanılır.</p>
    ${missing ? html`<div class="info">${missing} metnin İngilizcesi eksik. “Eksikleri otomatik çevir” ile tekrar deneyin ya da aşağıya yazın. Eksik çeviri varken anket gönderilmez.</div>` : ''}
    ${copied ? html`<div class="info">${copied} metin şu an çevrilemedi, Türkçesi aynen kullanılacak. İsterseniz İngilizcesini yazın ya da “Eksikleri otomatik çevir” ile tekrar deneyin.</div>` : ''}
    <div class="tr-list">${translations.map((t) => html`<div class="tr-row">
      <div class="tr-src"><small>${t.label}</small><span>${t.source}</span></div>
      <input type="hidden" name="src" value="${t.source}">
      <input name="en" maxlength="500" placeholder="English" value="${t.en || ''}" aria-label="${t.label} İngilizcesi" class="${t.en && !t.copied ? '' : 'missing-input'}">
    </div>`)}</div>
    <div class="actions">
      <button class="btn btn-sm">İngilizce metinleri kaydet</button>
      ${missing || copied ? html`<button class="btn btn-sm btn-soft" formaction="/anketler/${survey.id}/ceviri/otomatik" formnovalidate>Eksikleri otomatik çevir</button>` : ''}
    </div>
  </form>`;
}

function surveyDetailPage({ user, isAdmin, testMailto, results, invitations, resultHtml, flash, translations, engineName, autoOpenOutlook, links, invite, invitedEmails, resultMailto }) {
  const { survey, invited, completed, models } = results;
  const state = surveyState(survey);
  const rate = invited ? Math.min(100, Math.round((completed / invited) * 100)) : 0;
  // Alıcı listesi boş bırakıldıysa (link paylaşıldıysa) oran yerine yalnızca yanıt sayısı gösterilir.
  const recipients = (n) => (n ? `${n} alıcı` : 'alıcısız (alıcıları Outlook’ta eklersiniz)');
  const subline = {
    taslak: `Taslak · gönderilince ${survey.open_days} gün açık kalır, ${survey.open_hour}'de kapanır`,
    acik: `Canlıda · ${formatTR(survey.closes_at)} tarihinde kapanır`,
    kapali: `Kapandı · ${formatTR(survey.closed_at || survey.closes_at)}`,
  }[state];

  const draftPanel = html`
    <div class="card stack steps-card">
      ${isAdmin ? html`
      <div class="stepline"><span class="num">1</span><div><b>Test edin <span class="pill">Admin</span></b><p class="sub">Anketi katılımcının göreceği şekilde deneyin. Test yanıtları kaydedilmez.</p></div></div>
      ${copyField('testlink', 'Test linki', links.test, 'Testi aç')}
      ${testMailto ? html`<a class="btn btn-sm btn-soft" href="${testMailto}">Test linkini adminlere Outlook ile gönder</a>` : ''}
      <div class="stepline"><span class="num">2</span><div><b>Gönderin</b><p class="sub">Kapanış zamanı gönderdiğiniz andan itibaren hesaplanır. Outlook, ${recipients(invitedEmails.length)} ve anket linkiyle hazır bir mail açar.</p></div></div>`
    : html`<div><b>Göndermeye hazır olduğunuzda</b><p class="sub">Kapanış zamanı gönderdiğiniz andan itibaren hesaplanır. Outlook, ${recipients(invitedEmails.length)} ve anket linkiyle hazır bir mail açar.</p></div>`}
      <form method="post" action="/anketler/${survey.id}/yayinla"><button class="btn outlook">Gönder ve Outlook'ta aç</button></form>
      <p class="warn-note">${draftNote(survey)}</p>
    </div>`;

  const livePanel = html`
    <div class="card stack">
      <div class="label">Davet maili</div>
      <a class="btn outlook" id="outlook" href="${invite ? invite.href : '#'}">Outlook'ta aç</a>
      ${completed ? '' : html`<form method="post" action="/anketler/${survey.id}/geri-al" class="undo">
        <button class="btn btn-soft">← Vazgeç, taslağa geri al</button>
        <small class="sub">Maili göndermediyseniz anketi taslağa geri alıp düzenleyebilirsiniz. Yanıt gelmeye başlayınca bu seçenek kalkar.</small>
      </form>`}
      ${invite && !invite.recipientsIncluded ? html`<div class="info">Alıcı listesi Outlook linkine sığmadı. Mail alıcısız açılır; aşağıdan adresleri kopyalayıp “Gizli” (BCC) alanına yapıştırın.</div>` : ''}
      <p class="sub">Outlook açılmazsa cihazınızda varsayılan mail uygulaması olarak Outlook'u seçin ya da aşağıdaki metinleri kopyalayıp kendiniz gönderin.</p>
      <details><summary>Alıcılar ve mail metni</summary>
        <div class="stack" style="margin-top:10px">
          ${copyField('alicilar', `Alıcılar (${invitedEmails.length})`, invitedEmails.join('; '))}
          ${invite ? html`<label class="field"><span>Mail metni</span><textarea id="mailbody" rows="8" readonly>${invite.body}</textarea>
            <button type="button" class="btn btn-sm btn-soft" data-copy="mailbody">Metni kopyala</button></label>` : ''}
        </div>
      </details>
      <a class="btn btn-soft" href="/anketler/${survey.id}/hatirlatici.ics">Kapanış hatırlatıcısını takvime ekle</a>
      <p class="sub small">Hatırlatıcı ${formatTR(survey.closes_at)}'de Outlook takviminizde çıkar; içindeki link sonuç maili sayfasını açar.</p>
      ${copyField('katilimlink', 'Katılımcı linki', links.public)}
      ${isAdmin ? copyField('testlink', 'Test linki (yalnızca admin, yanıt kaydetmez)', links.test, 'Testi aç') : ''}
    </div>`;

  return layout({
    title: survey.title, user, active: 'anketler',
    body: html`
    <a class="back" href="/anketler">← Anketler</a>
    <div class="head"><div><h1>${survey.title}${survey.lang === 'en' ? html` <span class="lang-pill">EN</span>` : ''}</h1><p class="sub">${subline}</p></div>
      ${state === 'taslak' ? html`<span class="pill wait">Taslak</span>` : ''}</div>
    ${flash ? html`<div class="ok">${flash}</div>` : ''}
    ${translations && state === 'taslak' ? translationsCard(survey, translations, engineName) : ''}
    ${state === 'taslak' ? draftPanel : ''}
    ${state === 'acik' ? livePanel : ''}
    ${state === 'kapali' ? html`<div class="card stack result-mail ${survey.result_opened_at ? '' : 'pending'}">
      <div class="label">Sonuç maili ${survey.result_opened_at ? html`<span class="pill done">Outlook'ta açıldı</span>` : ''}</div>
      <p class="sub">Mail sizin Outlook hesabınızdan <b>${survey.result_emails.replace(/,/g, ', ')}</b> adresine gider. Rapor görseli mailin içinde; PDF rapor, görsel ve Excel dosyaları ekte olur.</p>
      <a class="report-preview" href="/anketler/${survey.id}/rapor.png" target="_blank" rel="noopener"><img src="/anketler/${survey.id}/rapor.png" alt="Sonuç raporu görseli"></a>
      <div class="send-option" data-device="pc">
        <a class="btn outlook" href="/anketler/${survey.id}/sonuc.eml" data-ping="/anketler/${survey.id}/sonuc-acildi">Bilgisayar: Outlook taslağını aç</a>
        <p class="sub small">İnen dosyayı açın. Outlook'ta alıcısı ve konusu dolu, rapor görseli içinde, ekleri hazır yeni bir mail açılır; kontrol edip <b>Gönder</b>'e basın. Mail okunur halde açılırsa <b>İlet</b>'e basın, görsel ve ekler korunur.</p>
      </div>
      <div class="send-option" data-device="phone" hidden>
        <button type="button" class="btn outlook" data-share="${survey.id}" data-title="Anket sonucu: ${survey.title}" data-ping="/anketler/${survey.id}/sonuc-acildi">Telefon: Paylaş → Outlook</button>
        <p class="sub small">Paylaş menüsünden Outlook'u seçin; PDF rapor, görsel ve Excel dosyaları ekli yeni mail açılır. Alıcıya <b>${survey.result_emails.replace(/,/g, ', ')}</b> yazın.</p>
      </div>
      <details><summary>Diğer yol: raporu kopyalayıp yapıştır</summary>
        <div class="stack" style="margin-top:10px">
          <button type="button" class="btn btn-soft" id="sonuc-gonder" data-copy-html="rapor" data-then="${resultMailto}" data-ping="/anketler/${survey.id}/sonuc-acildi">Raporu kopyala ve Outlook'u aç</button>
          <p class="sub small">Outlook açılınca mailin gövdesine yapıştırın (Ctrl+V, telefonda uzun basıp Yapıştır).</p>
        </div>
      </details>
      <textarea id="rapor" hidden>${resultHtml || ''}</textarea>
      ${copyField('sonuclink', 'Sonuç sayfası (giriş gerektirmez)', links.result, 'Aç')}
    </div>` : ''}
    ${state !== 'taslak' ? html`<div class="stats">
      ${invited ? html`<div class="card stat"><div class="ring" style="--p:${rate}"><b>%${rate}</b></div><div><b>${completed} / ${invited}</b><div class="sub">davetli yanıtladı</div></div></div>`
    : html`<div class="card stat"><div class="ring" style="--p:100"><b>${completed}</b></div><div><b>${completed} kişi</b><div class="sub">yanıtladı</div></div></div>`}
      <div class="card stat-actions">
        ${state === 'acik' ? html`<form method="post" action="/anketler/${survey.id}/kapat"><button class="btn btn-sm">Şimdi kapat</button></form>` : ''}
        <a class="btn btn-sm btn-soft" href="/anketler/${survey.id}/sonuc.pdf">Sonuçları indir (PDF)</a>
        <a class="btn btn-sm btn-soft" href="/anketler/${survey.id}/sonuclar.csv">Sonuçları indir (Excel)</a>
      </div>
    </div>` : ''}
    ${state !== 'taslak' ? html`
    <h2>Sonuçlar ${state === 'acik' ? html`<span class="sub">· anlık</span>` : ''}</h2>
    <p class="sub">Ortalama yalnızca 1–5 puanlardan hesaplanır. “Tarzım değil” yanıtları ortalamaya katılmaz.</p>
    ${resultsList(models)}
    <h2>Katılımcılar</h2>
    <div class="card"><table class="tbl"><thead><tr><th>E-posta</th><th>Liste</th><th>Durum</th></tr></thead><tbody>
      ${invitations.map((i) => html`<tr><td>${i.email}</td>
        <td class="nw">${i.invited ? 'Davetli' : html`<span class="sub">Linkle katıldı</span>`}</td>
        <td class="nw">${i.completed_at ? html`<span class="pill done">Tamamladı</span>` : html`<span class="pill">Bekleniyor</span>`}</td></tr>`)}
    </tbody></table></div>` : html`
    <h2>Ankette ${models.length} model var</h2>
    <div class="pick">${models.map((m) => html`<div class="pick-item">${thumb(m.image)}<span class="no">${m.code}</span>${m.ab ? html`<span class="ab">A/B</span>` : ''}<small>${m.ana_kumas}</small></div>`)}</div>`}
    ${translations && state !== 'taslak' ? translationsCard(survey, translations, engineName) : ''}
    <div class="danger-zone">${deleteSurveyForm({ ...survey, completed }, false)}</div>
    <script src="${asset('/static/kopyala.js')}"></script>
    ${autoOpenOutlook && invite ? raw(`<script>setTimeout(function(){var a=document.getElementById('outlook');if(!a)return;if(window.openMail)window.openMail(a.getAttribute('href'));else window.location.href=a.href;},400);</script>`) : ''}`,
  });
}

function rating(name, legend, L) {
  return html`<fieldset class="rate"><legend>${legend}</legend>
    <div class="stars">${[1, 2, 3, 4, 5].map((n) => html`<label><input type="radio" name="${name}" value="${n}" required><span>${n}</span></label>`)}</div>
    <div class="scale-hint"><span>${L.hateIt}</span><span>${L.loveIt}</span></div>
    <label class="nms"><input type="radio" name="${name}" value="nms"><span>${L.notMyStyle}</span></label>
  </fieldset>`;
}

// Modelin kumaş, içerik ve (varsa) tuşe/özellik satırı.
function modelInfo(m) {
  return html`<div class="step-info"><b>${m.code}</b><span>${m.ana_kumas} · ${m.icerik}</span>${m.ozellik ? html`<span class="ozellik">${m.ozellik}</span>` : ''}</div>`;
}

// A/B adımı: her seçenek ayrı puanlanır, sonra koleksiyon için bir tercih yapılır.
function abStep(m, L) {
  const name = (im) => im.label || L.option(im.letter);
  return html`
    ${modelInfo(m)}
    <div class="ab-intro"><span class="ab inline">A/B</span> <b>${m.test_konusu || L.abDefault}</b><br>
      ${L.abIntro(m.images.length)}</div>
    ${m.images.map((im) => html`<div class="variant-rate">
      <div class="tile-img"><img class="ph wide" src="/uploads/${im.filename}" alt="${m.code} ${im.letter}"><span class="no big">${im.letter}</span></div>
      ${rating(`r_${m.id}_${im.id}`, `${im.letter} · ${name(im)}`, L)}
    </div>`)}
    <fieldset class="rate pickset"><legend>${L.abQuestion}</legend>
      <div class="picks">${m.images.map((im) => html`<label><input type="radio" name="p_${m.id}" value="${im.id}" required>
        <span><img src="/uploads/${im.filename}" alt=""><b>${im.letter}</b><small>${im.label || ''}</small></span></label>`)}
        <label class="none"><input type="radio" name="p_${m.id}" value="0"><span><b>${L.none}</b></span></label></div>
    </fieldset>`;
}

// survey.title ve models, sunucuda anketin diline çevrilmiş olarak gelir.
function participantPage({ survey, title, models, email, test = false }) {
  const L = dil.t(survey.lang);
  const total = models.length;
  return layout({
    title, nav: false, lang: survey.lang,
    body: html`
    <form class="survey" method="post" id="survey">
      ${test ? html`<div class="testbar"><b>TEST</b> ${L.testBar}</div>` : ''}
      <div class="survey-head"><div class="sub">${total} ${L.model(total)} · ${survey.published_at ? L.openUntil(L.date(survey.closes_at)) : L.notLive}</div><h1>${title}</h1>
        ${email ? html`<div class="sub">${email}</div>` : ''}
        <div class="dots" aria-hidden="true">${models.map((_, i) => html`<i class="${i === 0 ? 'on' : ''}"></i>`)}</div></div>
      ${models.map((m, i) => html`
      <section class="step card" data-step="${i}">
        <div class="step-no">${i + 1} / ${total}</div>
        ${m.ab ? abStep(m, L) : html`
        <div class="step-imgs">${m.images.length ? m.images.map((im) => html`<img src="/uploads/${im.filename}" alt="${m.code}">`) : html`<div class="ph ph-empty">${L.noImage}</div>`}</div>
        ${modelInfo(m)}
        ${rating(`r_${m.id}`, L.howMuch, L)}`}
        <label class="field"><span>${L.comment} <em>${L.optional}</em></span><textarea name="c_${m.id}" rows="2" maxlength="1000" placeholder="${L.commentHint}"></textarea></label>
        <div class="step-nav">
          ${i > 0 ? html`<button type="button" class="btn btn-soft" data-go="-1">${L.back}</button>` : ''}
          ${i < total - 1 ? html`<button type="button" class="btn" data-go="1">${L.next}</button>` : html`<button class="btn">${test ? L.finishTest : L.submit}</button>`}
        </div>
      </section>`)}
    </form>
    <script src="${asset('/static/anket.js')}"></script>`,
  });
}

// Ortak linkten gelen katılımcı kullanıcı adını yazar.
function joinPage({ survey, title, modelCount, email = '', errs }) {
  const L = dil.t(survey.lang);
  return layout({
    title, nav: false, lang: survey.lang,
    body: html`
    <div class="auth">
      <div class="auth-art" aria-hidden="true"><i class="sw sw1"></i><i class="sw sw2"></i></div>
      <h1>${title}</h1>
      <p class="sub">${L.joinIntro(modelCount, L.date(survey.closes_at))}</p>
      ${errors(errs)}
      <form method="post" class="stack">
        <label class="field"><span>${L.username}</span>
          <div class="domain-input"><input id="email" name="email" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="ad.soyad" value="${email}"><em>@${config.companyDomain}</em></div>
          <small>${L.usernameHint}</small></label>
        <button class="btn">${L.start}</button>
      </form>
      <p class="center small sub">${L.joinNote}</p>
    </div>`,
  });
}

function publicResultPage({ results }) {
  const { survey, invited, completed, models } = results;
  return layout({
    title: `Sonuç: ${survey.title}`, nav: false,
    body: html`
    <div class="head"><div><div class="sub">Anket sonucu</div><h1>${survey.title}</h1>
      <p class="sub">Kapandı · ${formatTR(survey.closed_at || survey.closes_at)} · ${completed} yanıt${invited ? ` (${invited} davetli)` : ''}</p></div></div>
    <a class="btn btn-sm btn-soft" href="/sonuc/${survey.result_token}/rapor.pdf">Sonuçları indir (PDF)</a>
    <p class="sub">Ortalama yalnızca 1–5 puanlardan hesaplanır. “Tarzım değil” yanıtları ortalamaya katılmaz.</p>
    ${resultsList(models)}`,
  });
}

function messagePage({ title, text, link, lang }) {
  return layout({
    title, nav: false, lang,
    body: html`<div class="auth center"><div class="auth-art" aria-hidden="true"><i class="sw sw1"></i><i class="sw sw2"></i></div><h1>${title}</h1><p class="sub">${text}</p>
      ${link ? html`<a class="btn btn-soft" href="${link.href}">${link.label}</a>` : ''}</div>`,
  });
}

module.exports = {
  authPage, modelsPage, modelFormPage, surveysPage, newSurveyPage, surveyDetailPage,
  participantPage, joinPage, publicResultPage, messagePage, forgotPage, newPasswordPage, accountPage, adminPage, raw,
};
