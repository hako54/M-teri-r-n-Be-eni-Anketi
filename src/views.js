const { html, raw } = require('./html');
const { modelCode } = require('./db');
const { formatTR } = require('./time');
const { formatAvg } = require('./results');

const SOON_FIELDS = [
  ['buyer_grup', 'Buyer Grup'],
  ['merch_alt_grup', 'Merch Alt Grup'],
  ['klasman', 'Klasman'],
];

function layout({ title, user, body, nav = true, active = '' }) {
  const link = (href, label, key) => html`<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${html`${title}`} · Model Beğeni Anketi</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/static/style.css">
</head><body>
${nav && user ? html`<header class="bar"><div class="bar-in">
  <a class="brand" href="/modeller">Model Beğeni Anketi</a>
  <nav>${link('/modeller', 'Modeller', 'modeller')}${link('/anketler', 'Anketler', 'anketler')}</nav>
  <form method="post" action="/cikis"><button class="linkbtn" title="${user.username}">Çıkış</button></form>
</div></header>` : ''}
<main class="page">${body}</main>
</body></html>`;
}

function errors(list) {
  if (!list || !list.length) return '';
  return html`<div class="alert">${list.map((e) => html`<div>${e}</div>`)}</div>`;
}

function authPage({ mode, values = {}, errs, needsCode }) {
  const isReg = mode === 'kayit';
  return layout({
    title: isReg ? 'Hesap oluştur' : 'Giriş',
    nav: false,
    body: html`
    <div class="auth">
      <div class="auth-art" aria-hidden="true"><i class="sw sw1"></i><i class="sw sw2"></i></div>
      <h1>${isReg ? 'Hoş geldiniz' : 'Tekrar hoş geldiniz'}</h1>
      <p class="sub">${isReg ? 'Hesabınızı bir kez oluşturun, sonra bu bilgilerle girin.' : 'Kullanıcı adınız ve şifrenizle girin.'}</p>
      ${errors(errs)}
      <form method="post" class="stack">
        <label class="field"><span>Kullanıcı adı</span><input id="username" name="username" required autocomplete="username" value="${values.username || ''}"></label>
        ${isReg ? html`<label class="field"><span>E-posta</span><input id="email" name="email" type="email" required autocomplete="email" value="${values.email || ''}"></label>` : ''}
        <label class="field"><span>Şifre</span><input id="password" name="password" type="password" required minlength="${isReg ? 8 : 1}" autocomplete="${isReg ? 'new-password' : 'current-password'}"></label>
        ${isReg && needsCode ? html`<label class="field"><span>Kayıt kodu</span><input id="code" name="code" required value="${values.code || ''}"><small>Şirket yöneticinizden alabilirsiniz.</small></label>` : ''}
        <button class="btn">${isReg ? 'Başlayalım' : 'Giriş yap'}</button>
      </form>
      <p class="center small">${isReg ? html`Hesabınız var mı? <a href="/giris">Giriş yapın</a>` : html`İlk kez mi geldiniz? <a href="/kayit">Hesap oluşturun</a>`}</p>
    </div>`,
  });
}

function thumb(filename, cls = '') {
  return filename
    ? html`<img class="ph ${cls}" src="/uploads/${filename}" alt="" loading="lazy">`
    : html`<div class="ph ph-empty ${cls}">Görsel yok</div>`;
}

function modelsPage({ user, models, q }) {
  return layout({
    title: 'Modeller', user, active: 'modeller',
    body: html`
    <div class="head">
      <div><h1>Modellerim</h1><p class="sub">${models.length} model${models[0] ? ` · son eklenen ${modelCode(models[0].id)}` : ''}</p></div>
      <form class="search" method="get"><input id="q" name="q" placeholder="Numara, kumaş veya içerik ara" value="${q || ''}"></form>
    </div>
    <div class="gallery">
      <a class="add-tile" href="/modeller/yeni"><b>+</b><span>Yeni model</span></a>
      ${models.map((m) => html`
        <a class="tile" href="/modeller/${m.id}">
          <div class="tile-img">${thumb(m.image)}<span class="no">${modelCode(m.id)}</span>${m.image_count > 1 ? html`<span class="count">${m.image_count} görsel</span>` : ''}</div>
          <b>${m.ana_kumas}</b><span>${m.icerik}</span>
        </a>`)}
    </div>
    ${!models.length && !q ? html`<p class="empty">Henüz model yok. <a href="/modeller/yeni">İlk modeli ekleyin</a>; numarası otomatik verilir.</p>` : ''}
    ${!models.length && q ? html`<p class="empty">“${q}” ile eşleşen model yok.</p>` : ''}`,
  });
}

function soonFields(model = {}) {
  return html`<div class="soon-row">${SOON_FIELDS.map(([key, label]) => html`
    <label class="field soon"><span>${label} <em>yakında</em></span><input id="${key}" disabled placeholder="${model[key] || 'Liste yakında eklenecek'}"></label>`)}</div>`;
}

function modelFormPage({ user, model, images = [], nextCode, values = {}, errs }) {
  const isNew = !model;
  const v = model || values;
  return layout({
    title: isNew ? 'Yeni model' : modelCode(model.id), user, active: 'modeller',
    body: html`
    <a class="back" href="/modeller">← Modeller</a>
    <div class="head"><div><h1>${isNew ? 'Yeni model' : modelCode(model.id)}</h1>
      <p class="sub">${isNew ? html`Kaydedince <b>${nextCode}</b> numarası verilecek.` : `Eklenme: ${formatTR(model.created_at.replace(' ', 'T') + 'Z')}`}</p></div></div>
    ${errors(errs)}
    ${!isNew && images.length ? html`<div class="card"><div class="label">Görseller</div><div class="img-grid">
      ${images.map((im) => html`<div class="img-cell">${thumb(im.filename)}
        <form method="post" action="/modeller/${model.id}/gorsel/${im.id}/sil"><button class="x" title="Görseli kaldır" aria-label="Görseli kaldır">×</button></form></div>`)}
    </div></div>` : ''}
    <form class="card stack" method="post" enctype="multipart/form-data" action="${isNew ? '/modeller' : `/modeller/${model.id}`}">
      <label class="drop" for="images">
        <input id="images" name="images" type="file" accept="image/*" multiple ${isNew ? 'required' : ''}>
        <b>${isNew ? 'Görsel ekle' : 'Görsel ekle (isteğe bağlı)'}</b><span>Birden fazla seçebilir, telefonda fotoğraf çekebilirsiniz.</span>
        <div class="preview" id="preview"></div>
      </label>
      <label class="field"><span>Ana kumaş</span><input id="ana_kumas" name="ana_kumas" required maxlength="120" placeholder="ör. Viskon krep" value="${v.ana_kumas || ''}"></label>
      <label class="field"><span>İçerik</span><input id="icerik" name="icerik" required maxlength="200" placeholder="ör. %100 Viskon" value="${v.icerik || ''}"></label>
      ${soonFields(v)}
      <button class="btn">${isNew ? 'Modeli kaydet' : 'Değişiklikleri kaydet'}</button>
    </form>
    <script src="/static/onizleme.js"></script>`,
  });
}

function surveysPage({ user, surveys }) {
  const status = (s) => {
    if (s.result_sent_at) return html`<span class="pill done">Sonuç gönderildi</span>`;
    if (s.closed_at || new Date(s.closes_at) <= new Date()) return html`<span class="pill wait">Kapanıyor</span>`;
    return html`<span class="pill open">Açık</span>`;
  };
  return layout({
    title: 'Anketler', user, active: 'anketler',
    body: html`
    <div class="head"><div><h1>Anketler</h1><p class="sub">${surveys.length} anket</p></div>
      <a class="btn btn-sm" href="/anketler/yeni">+ Yeni anket</a></div>
    <div class="list">
      ${surveys.map((s) => html`<a class="row card" href="/anketler/${s.id}">
        <div class="row-main"><b>${s.title}</b><span class="sub">${s.model_count} model · ${s.completed}/${s.invited} yanıt · kapanış ${formatTR(s.closes_at)}</span></div>
        ${status(s)}</a>`)}
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
    <div class="head"><div><h1>Anket oluştur</h1><p class="sub">Modelleri seçin, kişileri ekleyin, süreyi belirleyin.</p></div></div>
    ${errors(errs)}
    <form class="stack" method="post" action="/anketler">
      <div class="card stack">
        <label class="field"><span>Anket adı</span><input id="title" name="title" required maxlength="120" placeholder="ör. Yaz 2027 · Elbise seçkisi" value="${values.title || ''}"></label>
      </div>
      <div class="card">
        <div class="label">Modeller <span class="sub" id="selcount"></span></div>
        ${models.length ? html`<div class="pick">${models.map((m) => html`
          <label class="pick-item"><input type="checkbox" name="models" value="${m.id}" ${selected.has(m.id) ? 'checked' : ''}>
            ${thumb(m.image)}<span class="no">${modelCode(m.id)}</span><small>${m.ana_kumas}</small></label>`)}</div>`
    : html`<p class="empty">Önce <a href="/modeller/yeni">model ekleyin</a>.</p>`}
      </div>
      <div class="card stack">
        <label class="field"><span>Kime gönderilsin?</span>
          <textarea id="emails" name="emails" rows="4" required placeholder="mehmet@firma.com.tr&#10;selin@magaza.com">${values.emails || ''}</textarea>
          <small>Her satıra bir adres ya da virgülle ayırın. Her kişiye kendi linki gönderilir.</small></label>
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
      <button class="btn">Anketi başlat ve davetleri gönder</button>
    </form>
    <script src="/static/anket-olustur.js"></script>`,
  });
}

function surveyDetailPage({ user, results, invitations, smtpReady, flash }) {
  const { survey, invited, completed, models } = results;
  const isClosed = Boolean(survey.closed_at) || new Date(survey.closes_at) <= new Date();
  const failed = invitations.filter((i) => i.send_error && !i.sent_at).length;
  const rate = invited ? Math.round((completed / invited) * 100) : 0;
  return layout({
    title: survey.title, user, active: 'anketler',
    body: html`
    <a class="back" href="/anketler">← Anketler</a>
    <div class="head"><div><h1>${survey.title}</h1>
      <p class="sub">${isClosed ? `Kapandı · ${formatTR(survey.closed_at || survey.closes_at)}` : `Açık · ${formatTR(survey.closes_at)} tarihinde kapanır`}
      ${survey.result_sent_at ? ` · sonuç ${survey.result_emails.replace(/,/g, ', ')} adresine gönderildi` : ''}</p></div></div>
    ${flash ? html`<div class="ok">${flash}</div>` : ''}
    ${!smtpReady ? html`<div class="info">Mail sunucusu henüz ayarlı değil. Mailler gerçekten gönderilmiyor, <a href="/giden-kutusu">Giden kutusu</a> sayfasında görebilirsiniz.</div>` : ''}
    <div class="stats">
      <div class="card stat"><div class="ring" style="--p:${rate}"><b>%${rate}</b></div><div><b>${completed} / ${invited}</b><div class="sub">kişi yanıtladı</div></div></div>
      <div class="card stat-actions">
        ${!survey.result_sent_at ? html`<form method="post" action="/anketler/${survey.id}/kapat"><button class="btn btn-sm">${isClosed ? 'Sonucu şimdi gönder' : 'Şimdi kapat ve sonucu gönder'}</button></form>` : ''}
        ${failed && !isClosed ? html`<form method="post" action="/anketler/${survey.id}/yeniden-gonder"><button class="btn btn-sm btn-soft">${failed} gönderilemeyen daveti tekrar dene</button></form>` : ''}
        <a class="btn btn-sm btn-soft" href="/anketler/${survey.id}/sonuclar.csv">Sonuçları indir (Excel)</a>
      </div>
    </div>
    <h2>Sonuçlar ${isClosed ? '' : html`<span class="sub">· anlık</span>`}</h2>
    <p class="sub">Ortalama yalnızca 1–5 puanlardan hesaplanır. “Tarzım değil” yanıtları ortalamaya katılmaz.</p>
    <div class="list">
      ${models.map((m, i) => html`<div class="card result">
        <div class="rank">${i + 1}</div>
        ${thumb(m.image, 'sm')}
        <div class="result-main">
          <div><b>${m.code}</b> <span class="sub">· ${m.ana_kumas} · ${m.icerik}</span></div>
          <div class="meter"><i style="width:${m.avg === null ? 0 : Math.round((m.avg / 5) * 100)}%"></i></div>
          <div class="sub">${m.scored} kişi puan verdi · ${m.notMyStyle} tarzım değil</div>
          <div class="dist">${m.dist.map((n, k) => html`<span><b>${k + 1}</b>${n}</span>`)}</div>
          ${m.comments.length ? html`<details><summary>${m.comments.length} yorum</summary>${m.comments.map((c) => html`<p class="comment">“${c.text}” <span class="sub">· ${c.email} · ${c.notMyStyle ? 'Tarzım değil' : `${c.score} puan`}</span></p>`)}</details>` : ''}
        </div>
        <div class="avg">${formatAvg(m.avg)}</div>
      </div>`)}
    </div>
    <h2>Katılımcılar</h2>
    <div class="card"><table class="tbl"><thead><tr><th>E-posta</th><th>Davet</th><th>Durum</th></tr></thead><tbody>
      ${invitations.map((i) => html`<tr><td>${i.email}</td>
        <td class="nw">${i.sent_at ? 'Gönderildi' : i.send_error ? html`<span class="err" title="${i.send_error}">Gönderilemedi</span>` : 'Bekliyor'}</td>
        <td class="nw">${i.completed_at ? html`<span class="pill done">Tamamladı</span>` : html`<span class="pill">Bekleniyor</span>`}</td></tr>`)}
    </tbody></table></div>`,
  });
}

function participantPage({ survey, invitation, models }) {
  const total = models.length;
  return layout({
    title: survey.title, nav: false,
    body: html`
    <form class="survey" method="post" id="survey">
      <div class="survey-head"><div class="sub">${total} model · ${formatTR(survey.closes_at)} tarihine kadar açık</div><h1>${survey.title}</h1>
        <div class="dots" aria-hidden="true">${models.map((_, i) => html`<i class="${i === 0 ? 'on' : ''}"></i>`)}</div></div>
      ${models.map((m, i) => html`
      <section class="step card" data-step="${i}">
        <div class="step-no">${i + 1} / ${total}</div>
        <div class="step-imgs">${m.images.length ? m.images.map((f) => html`<img src="/uploads/${f}" alt="${m.code}">`) : html`<div class="ph ph-empty">Görsel yok</div>`}</div>
        <div class="step-info"><b>${m.code}</b><span>${m.ana_kumas} · ${m.icerik}</span></div>
        <fieldset class="rate"><legend>Bu modeli ne kadar beğendiniz?</legend>
          <div class="stars">${[1, 2, 3, 4, 5].map((n) => html`<label><input type="radio" name="r_${m.id}" value="${n}" required><span>${n}</span></label>`)}</div>
          <div class="scale-hint"><span>Hiç beğenmedim</span><span>Çok beğendim</span></div>
          <label class="nms"><input type="radio" name="r_${m.id}" value="nms"><span>Tarzım değil</span></label>
        </fieldset>
        <label class="field"><span>Yorumunuz <em>isteğe bağlı</em></span><textarea name="c_${m.id}" rows="2" maxlength="1000" placeholder="Kalıp, renk, kumaş hakkında bir not…"></textarea></label>
        <div class="step-nav">
          ${i > 0 ? html`<button type="button" class="btn btn-soft" data-go="-1">Geri</button>` : ''}
          ${i < total - 1 ? html`<button type="button" class="btn" data-go="1">Sonraki</button>` : html`<button class="btn">Anketi gönder</button>`}
        </div>
      </section>`)}
      <input type="hidden" name="token" value="${invitation.token}">
    </form>
    <script src="/static/anket.js"></script>`,
  });
}

function messagePage({ title, text }) {
  return layout({
    title, nav: false,
    body: html`<div class="auth center"><div class="auth-art" aria-hidden="true"><i class="sw sw1"></i><i class="sw sw2"></i></div><h1>${title}</h1><p class="sub">${text}</p></div>`,
  });
}

function outboxPage({ user, mails }) {
  return layout({
    title: 'Giden kutusu', user,
    body: html`
    <div class="head"><div><h1>Giden kutusu</h1><p class="sub">Mail sunucusu ayarlanana kadar gönderilecek mailler burada birikir. Link ile anketi kendiniz deneyebilirsiniz.</p></div></div>
    <div class="list">${mails.map((m) => html`<a class="row card" href="/giden-kutusu/${m.id}"><div class="row-main"><b>${m.subject}</b><span class="sub">${m.to_addr} · ${formatTR(m.created_at.replace(' ', 'T') + 'Z')}</span></div></a>`)}</div>
    ${!mails.length ? html`<p class="empty">Henüz mail yok.</p>` : ''}`,
  });
}

module.exports = {
  authPage, modelsPage, modelFormPage, surveysPage, newSurveyPage, surveyDetailPage,
  participantPage, messagePage, outboxPage, raw,
};
