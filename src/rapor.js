// Görselli sonuç raporu (HTML). Kullanıcı bunu panoya kopyalayıp Outlook'taki sonuç mailine yapıştırır;
// mail tablolarla ve satır içi stillerle yazıldı, çünkü Outlook başka biçimlendirmeyi düşürür.
const config = require('./config');
const { html, raw, esc } = require('./html');
const { formatTR } = require('./time');
const { formatAvg } = require('./results');

const C = { bg: '#EAF4FF', card: '#FFFFFF', ink: '#22385A', muted: '#6A80A3', accent: '#4C9AFF', soft: '#DDEBFF' };

function shell(title, inner) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:${C.bg};font-family:Nunito,Segoe UI,Arial,sans-serif;color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 14px;font-size:13px;font-weight:700;color:${C.accent}">Model Beğeni Anketi</td></tr>
${inner}
<tr><td style="padding:18px 4px 0;font-size:11px;color:${C.muted}">Bu rapor Model Beğeni Anketi uygulamasında hazırlandı.</td></tr>
</table></td></tr></table></body></html>`;
}

function card(inner, pad = 22) {
  return `<tr><td style="background:${C.card};border-radius:18px;padding:${pad}px">${inner}</td></tr><tr><td style="height:12px"></td></tr>`;
}

function imgUrl(filename) {
  return `${config.baseUrl}/uploads/${encodeURIComponent(filename)}`;
}

// A/B modeli: seçenekler yan yana, kazanan vurgulu.
function abBlock(m) {
  const cells = m.variants.map((v) => {
    const win = m.winner && m.winner.imageId === v.imageId;
    return html`<td valign="top" width="${Math.floor(100 / m.variants.length)}%" style="padding:3px">
      <div style="border:2px solid ${win ? C.accent : '#E3EDF9'};background:${win ? '#F5F9FF' : '#fff'};border-radius:12px;padding:5px">
        <img src="${imgUrl(v.filename)}" alt="${v.letter}" width="90" style="width:100%;max-width:120px;border-radius:8px;display:block">
        <div style="font-size:13px;font-weight:800;margin-top:4px">${v.letter}${win ? ' ✓' : ''}</div>
        ${v.label ? html`<div style="font-size:11px;color:${C.muted}">${v.label}</div>` : ''}
        <div style="font-size:12px;margin-top:3px"><b>${formatAvg(v.avg)}</b> ort. · <b>${v.picks}</b> tercih</div>
        <div style="font-size:11px;color:${C.muted}">${v.notMyStyle} tarzım değil</div>
      </div></td>`;
  });
  return html`<div style="font-size:12px;color:${C.muted};margin-bottom:4px"><b style="color:${C.accent}">A/B</b> · ${m.test_konusu || 'Seçenek karşılaştırması'}${m.noPick ? ` · ${m.noPick} kişi hiçbirini seçmedi` : ''}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
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
    const comments = m.comments.map((c) => html`<div style="font-size:12px;color:${C.ink};background:#F5F9FF;border-radius:10px;padding:7px 10px;margin-top:5px">“${c.text}” <span style="color:${C.muted}">${c.note ? `· ${c.note}` : ''}</span></div>`);
    return html`
      <tr><td style="padding:12px 0;border-bottom:1px solid #EEF3FA">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="26" valign="top" style="font-size:16px;font-weight:800;color:${C.accent}">${i + 1}</td>
          <td width="64" valign="top">${m.image ? raw(`<img src="${imgUrl(m.image)}" alt="" width="56" style="width:56px;border-radius:10px;display:block">`) : ''}</td>
          <td valign="top">
            <div style="font-size:14px;font-weight:800">${m.code} <span style="font-weight:400;color:${C.muted}">· ${m.ana_kumas}</span></div>
            <div style="font-size:12px;color:${C.muted}">${m.icerik}${m.ozellik ? ` · ${m.ozellik}` : ''}</div>
            <div style="background:${C.soft};border-radius:4px;height:7px;margin:7px 0 4px"><div style="background:${C.accent};border-radius:4px;height:7px;width:${pct}%"></div></div>
            ${m.ab ? abBlock(m) : html`<div style="font-size:12px;color:${C.muted}">${m.scored} kişi puan verdi · ${m.notMyStyle} tarzım değil</div>
            <div style="font-size:12px;color:${C.muted};margin-top:2px">${m.dist.map((n, k) => html`<span style="white-space:nowrap;margin-right:8px"><b style="color:${C.ink}">${k + 1}:</b> ${n}</span>`)}</div>`}
            ${comments}
          </td>
          <td width="48" valign="top" align="right" style="font-size:20px;font-weight:800">${formatAvg(m.avg)}</td>
        </tr></table>
      </td></tr>`;
  });

  const list = html`
    <div style="font-size:15px;font-weight:800;margin-bottom:4px">Model sıralaması</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    <div style="font-size:12px;color:${C.muted};margin-top:12px">Ayrıntılı ve güncel sonuçlar: ${config.baseUrl}/sonuc/${survey.result_token}</div>`;

  return shell(`Sonuç: ${survey.title}`, card(summary.toString()) + card(list.toString(), 18));
}

module.exports = { resultEmail };
