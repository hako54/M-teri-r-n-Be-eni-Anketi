const nodemailer = require('nodemailer');
const config = require('./config');
const { db } = require('./db');
const { html, raw, esc } = require('./html');
const { formatTR } = require('./time');
const { formatAvg } = require('./results');

const smtpReady = Boolean(config.mail.host);

const transport = smtpReady
  ? nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
  })
  : null;

// SMTP yoksa mail gönderilmez; giden kutusu tablosuna yazılır ve uygulamada görüntülenir.
async function sendMail({ to, subject, html: body, attachments }) {
  if (!transport) {
    db.prepare('INSERT INTO outbox (to_addr, subject, html) VALUES (?, ?, ?)').run(to, subject, body);
    return { stored: true };
  }
  return transport.sendMail({ from: config.mail.from, to, subject, html: body, attachments });
}

const C = { bg: '#EAF4FF', card: '#FFFFFF', ink: '#22385A', muted: '#6A80A3', accent: '#4C9AFF', soft: '#DDEBFF' };

function shell(title, inner) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:${C.bg};font-family:Nunito,Segoe UI,Arial,sans-serif;color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 14px;font-size:13px;font-weight:700;color:${C.accent}">Model Beğeni Anketi</td></tr>
${inner}
<tr><td style="padding:18px 4px 0;font-size:11px;color:${C.muted}">Bu mail Model Beğeni Anketi sistemi tarafından otomatik gönderildi.</td></tr>
</table></td></tr></table></body></html>`;
}

function card(inner, pad = 22) {
  return `<tr><td style="background:${C.card};border-radius:18px;padding:${pad}px">${inner}</td></tr><tr><td style="height:12px"></td></tr>`;
}

function imgUrl(filename) {
  return `${config.baseUrl}/uploads/${encodeURIComponent(filename)}`;
}

function inviteEmail({ survey, ownerName, token, models }) {
  const link = `${config.baseUrl}/a/${token}`;
  const thumbs = models.slice(0, 4).map((m) => (m.image
    ? `<td style="padding:3px" width="25%"><img src="${imgUrl(m.image)}" alt="${m.code}" width="120" style="width:100%;max-width:120px;border-radius:12px;display:block"></td>`
    : '')).join('');
  const inner = html`
    <div style="font-size:22px;font-weight:800;margin:0 0 6px">${survey.title}</div>
    <div style="font-size:14px;color:${C.muted};margin:0 0 16px">${ownerName} sizden ${models.length} model için görüşünüzü istiyor.</div>
    ${thumbs ? raw(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>${thumbs}</tr></table>`) : ''}
    <div style="font-size:14px;line-height:1.55;margin:0 0 18px">Her modeli 1–5 arası puanlayın. Size uygun değilse <b>Tarzım değil</b> seçebilirsiniz; bu seçim ortalamaya katılmaz. Dilerseniz yorum da bırakabilirsiniz.</div>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.accent};border-radius:999px">
      <a href="${link}" style="display:inline-block;padding:13px 30px;color:#fff;font-weight:800;font-size:15px;text-decoration:none">Ankete katıl</a>
    </td></tr></table>
    <div style="font-size:12px;color:${C.muted};margin-top:16px">Anket <b>${formatTR(survey.closes_at)}</b> tarihinde kapanır.<br>Buton çalışmazsa bu adresi açın: ${link}</div>`;
  return shell(survey.title, card(inner.toString()));
}

function resultEmail(results) {
  const { survey, invited, completed, models } = results;
  const rate = invited ? Math.round((completed / invited) * 100) : 0;
  const summary = html`
    <div style="font-size:12px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.08em">Anket tamamlandı</div>
    <div style="font-size:22px;font-weight:800;margin:4px 0 14px">${survey.title}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="background:${C.soft};border-radius:14px;padding:12px;text-align:center" width="33%"><div style="font-size:22px;font-weight:800">${completed}/${invited}</div><div style="font-size:11px;color:${C.muted}">yanıtlayan</div></td>
      <td width="8"></td>
      <td style="background:${C.soft};border-radius:14px;padding:12px;text-align:center" width="33%"><div style="font-size:22px;font-weight:800">%${rate}</div><div style="font-size:11px;color:${C.muted}">katılım</div></td>
      <td width="8"></td>
      <td style="background:${C.soft};border-radius:14px;padding:12px;text-align:center" width="33%"><div style="font-size:22px;font-weight:800">${models.length}</div><div style="font-size:11px;color:${C.muted}">model</div></td>
    </tr></table>
    <div style="font-size:12px;color:${C.muted};margin-top:12px">Kapanış: ${formatTR(survey.closed_at || survey.closes_at)}. Ortalama yalnızca 1–5 puanlardan hesaplanır, "Tarzım değil" yanıtları ayrı gösterilir.</div>`;

  const rows = models.map((m, i) => {
    const pct = m.avg === null ? 0 : Math.round((m.avg / 5) * 100);
    const comments = m.comments.map((c) => html`<div style="font-size:12px;color:${C.ink};background:#F5F9FF;border-radius:10px;padding:7px 10px;margin-top:5px">“${c.text}” <span style="color:${C.muted}">· ${c.notMyStyle ? 'Tarzım değil' : `${c.score} puan`}</span></div>`);
    return html`
      <tr><td style="padding:12px 0;border-bottom:1px solid #EEF3FA">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="26" valign="top" style="font-size:16px;font-weight:800;color:${C.accent}">${i + 1}</td>
          <td width="64" valign="top">${m.image ? raw(`<img src="${imgUrl(m.image)}" alt="" width="56" style="width:56px;border-radius:10px;display:block">`) : ''}</td>
          <td valign="top">
            <div style="font-size:14px;font-weight:800">${m.code} <span style="font-weight:400;color:${C.muted}">· ${m.ana_kumas}</span></div>
            <div style="font-size:12px;color:${C.muted}">${m.icerik}</div>
            <div style="background:${C.soft};border-radius:4px;height:7px;margin:7px 0 4px"><div style="background:${C.accent};border-radius:4px;height:7px;width:${pct}%"></div></div>
            <div style="font-size:12px;color:${C.muted}">${m.scored} kişi puan verdi · ${m.notMyStyle} tarzım değil</div>
            <div style="font-size:12px;color:${C.muted};margin-top:2px">${m.dist.map((n, k) => html`<span style="white-space:nowrap;margin-right:8px"><b style="color:${C.ink}">${k + 1}:</b> ${n}</span>`)}</div>
            ${comments}
          </td>
          <td width="48" valign="top" align="right" style="font-size:20px;font-weight:800">${formatAvg(m.avg)}</td>
        </tr></table>
      </td></tr>`;
  });

  const list = html`
    <div style="font-size:15px;font-weight:800;margin-bottom:4px">Model sıralaması</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <div style="font-size:12px;color:${C.muted};margin-top:12px">Ekte Excel ile açılabilen sonuç ve yorum dosyaları var. Ayrıntılar: ${config.baseUrl}/anketler/${survey.id}</div>`;

  return shell(`Sonuç: ${survey.title}`, card(summary.toString()) + card(list.toString(), 18));
}

module.exports = { sendMail, inviteEmail, resultEmail, smtpReady };
