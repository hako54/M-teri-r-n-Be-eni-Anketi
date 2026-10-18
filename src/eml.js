// Outlook taslağı (.eml): açıldığında alıcısı, konusu, gövdedeki rapor görseli ve ekleri hazır yeni bir mail olur.
// "X-Unsent: 1" Outlook'a bunun gönderilmemiş bir taslak olduğunu söyler. "From" yazılmaz; mail, Outlook'ta
// açık olan hesaptan, yani anketi oluşturan kişinin kendi adresinden gider. Sunucu mail göndermez.
const crypto = require('node:crypto');
const config = require('./config');
const { esc } = require('./html');

const CRLF = '\r\n';

// RFC 2047: Türkçe karakterli başlıklar için.
const encodeHeader = (value) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const base64Lines = (buf) => buf.toString('base64').replace(/.{1,76}/g, (line) => line + CRLF);

function part(headers, body) {
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join(CRLF) + CRLF + CRLF + base64Lines(body);
}

// files: [{ filename, contentType, content: Buffer }]; inlineImage: { cid, filename, content } gövdede gösterilir.
function buildDraft({ to, subject, html, inlineImage, files = [] }) {
  const mixed = `mix_${crypto.randomBytes(8).toString('hex')}`;
  const related = `rel_${crypto.randomBytes(8).toString('hex')}`;
  const lines = [
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'X-Unsent: 1',
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/related; boundary="${related}"`,
    '',
    `--${related}`,
    part({ 'Content-Type': 'text/html; charset=UTF-8', 'Content-Transfer-Encoding': 'base64' }, Buffer.from(html, 'utf8')),
  ];
  if (inlineImage) {
    lines.push(`--${related}`, part({
      'Content-Type': `image/png; name="${inlineImage.filename}"`,
      'Content-Transfer-Encoding': 'base64',
      'Content-ID': `<${inlineImage.cid}>`,
      'Content-Disposition': `inline; filename="${inlineImage.filename}"`,
    }, inlineImage.content));
  }
  lines.push(`--${related}--`, '');
  for (const f of files) {
    lines.push(`--${mixed}`, part({
      'Content-Type': `${f.contentType}; name="${f.filename}"`,
      'Content-Transfer-Encoding': 'base64',
      'Content-Disposition': `attachment; filename="${f.filename}"`,
    }, f.content));
  }
  lines.push(`--${mixed}--`, '');
  return lines.join(CRLF);
}

function resultDraft({ results, ownerName, png, csv }) {
  const { survey, invited, completed } = results;
  const link = `${config.baseUrl}/sonuc/${survey.result_token}`;
  const cid = `rapor-${survey.id}@model-begeni-anketi`;
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#22385A">
<p>Merhaba,</p>
<p><b>${esc(survey.title)}</b> anketi sonuçlandı. ${completed} kişi yanıtladı (${invited} davetli). Sonuçların özeti aşağıda; ayrıntılı puanlar ve yorumlar ekteki Excel dosyalarında.</p>
<p><img src="cid:${cid}" alt="Anket sonucu" width="760" style="max-width:100%;border-radius:12px"></p>
<p>Görselli sonuç sayfası: <a href="${link}">${link}</a></p>
<p>${esc(ownerName)}</p>
</body></html>`;
  return buildDraft({
    to: survey.result_emails.split(',').filter(Boolean),
    subject: `Anket sonucu: ${survey.title}`,
    html,
    inlineImage: { cid, filename: 'anket-sonucu.png', content: png },
    files: [
      { filename: 'anket-sonucu.png', contentType: 'image/png', content: png },
      { filename: 'sonuclar.csv', contentType: 'text/csv; charset=UTF-8', content: Buffer.from(csv.results, 'utf8') },
      { filename: 'yorumlar.csv', contentType: 'text/csv; charset=UTF-8', content: Buffer.from(csv.comments, 'utf8') },
    ],
  });
}

module.exports = { buildDraft, resultDraft };
