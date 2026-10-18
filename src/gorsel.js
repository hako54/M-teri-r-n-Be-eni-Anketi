// Sonuç raporunun görseli (PNG): Outlook mailinin içine "ekran görüntüsü" olarak konur ve ek olarak da gider.
// SVG olarak çizilir, resvg ile PNG'ye çevrilir; yazı tipi projeyle gelir, sistem fontuna güvenilmez.
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const config = require('./config');
const { esc } = require('./html');
const { formatTR } = require('./time');
const { formatAvg } = require('./results');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONTS = ['Nunito_400Regular.ttf', 'Nunito_700Bold.ttf', 'Nunito_800ExtraBold.ttf'].map((f) => path.join(FONT_DIR, f));

const C = { bg: '#EAF4FF', card: '#FFFFFF', ink: '#22385A', muted: '#6A80A3', accent: '#4C9AFF', accentInk: '#2F6FD0', soft: '#DDEBFF', line: '#E3EDF9' };
const W = 1000;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

const trunc = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// HEIC/AVIF gibi çizilemeyen biçimlerde null döner; yerine boş kutu çizilir.
function imageData(filename) {
  if (!filename) return null;
  const mime = MIME[path.extname(filename).toLowerCase()];
  if (!mime) return null;
  try {
    return `data:${mime};base64,${fs.readFileSync(path.join(config.uploadDir, filename)).toString('base64')}`;
  } catch {
    return null;
  }
}

let clipId = 0;
function image(filename, x, y, w, h, r = 12) {
  const data = imageData(filename);
  const id = `c${clipId++}`;
  if (!data) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${C.soft}"/>
      <text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="13" fill="${C.muted}">Görsel</text>`;
  }
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>
    <image href="${data}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
}

const text = (x, y, value, { size = 15, weight = 400, fill = C.ink, anchor = 'start' } = {}) =>
  `<text xml:space="preserve" x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;

function bar(x, y, w, avg) {
  const filled = avg === null ? 0 : Math.round((avg / 5) * w);
  return `<rect x="${x}" y="${y}" width="${w}" height="10" rx="5" fill="${C.soft}"/>
    ${filled ? `<rect x="${x}" y="${y}" width="${filled}" height="10" rx="5" fill="${C.accent}"/>` : ''}`;
}

const distText = (dist) => `Puan dağılımı  ${dist.map((n, k) => `${k + 1}: ${n}`).join('  ·  ')}`;

// Bir modelin başlık satırı (görsel, numara, kumaş, kırılım, çubuk, ortalama).
function modelHead(m, i, y) {
  const parts = [
    text(52, y + 44, String(i + 1), { size: 26, weight: 800, fill: C.accent }),
    image(m.image, 88, y + 18, 104, 136),
    text(214, y + 46, `${m.code} · ${trunc(m.ana_kumas, 40)}`, { size: 21, weight: 800 }),
    text(214, y + 70, trunc(m.icerik, 70), { size: 15, fill: C.muted }),
  ];
  if (m.kirilim.length) parts.push(text(214, y + 92, trunc(m.kirilim.join(' · '), 95), { size: 13, weight: 700, fill: C.accentInk }));
  parts.push(bar(214, y + 106, 600, m.avg));
  parts.push(text(950, y + 56, formatAvg(m.avg), { size: 38, weight: 800, anchor: 'end' }));
  parts.push(text(950, y + 78, 'ortalama', { size: 13, fill: C.muted, anchor: 'end' }));
  const counts = `${m.scored} puan · ${m.notMyStyle} tarzım değil${m.comments.length ? ` · ${m.comments.length} yorum` : ''}`;
  parts.push(text(214, y + 140, m.ab ? `A/B · ${m.test_konusu || 'Seçenek karşılaştırması'} · ${counts}` : `${distText(m.dist)}    |    ${counts}`, { size: 14, fill: C.muted }));
  return parts.join('');
}

const VAR_W = 146;
const VAR_H = 236;
const VAR_PER_ROW = 5;

function variantTile(m, v, x, y) {
  const win = m.winner && m.winner.imageId === v.imageId;
  return `<rect x="${x}" y="${y}" width="${VAR_W}" height="${VAR_H}" rx="14" fill="${win ? '#F5F9FF' : C.card}" stroke="${win ? C.accent : C.line}" stroke-width="${win ? 3 : 2}"/>
    ${image(v.filename, x + 8, y + 8, VAR_W - 16, 118, 10)}
    <rect x="${x + 14}" y="${y + 14}" width="30" height="24" rx="12" fill="#FFFFFF"/>
    ${text(x + 29, y + 31, v.letter, { size: 15, weight: 800, anchor: 'middle' })}
    ${win ? `<rect x="${x + VAR_W - 92}" y="${y + 14}" width="78" height="24" rx="12" fill="${C.accent}"/>${text(x + VAR_W - 53, y + 31, 'KAZANAN', { size: 12, weight: 800, fill: '#FFFFFF', anchor: 'middle' })}` : ''}
    ${text(x + 10, y + 148, trunc(v.label || `Seçenek ${v.letter}`, 17), { size: 14, weight: 700 })}
    ${text(x + 10, y + 176, formatAvg(v.avg), { size: 22, weight: 800 })}
    ${text(x + 58, y + 176, 'ort.', { size: 13, fill: C.muted })}
    ${text(x + 10, y + 200, `${v.picks} tercih`, { size: 14, weight: 700, fill: C.accentInk })}
    ${text(x + 10, y + 222, `${v.notMyStyle} tarzım değil`, { size: 12, fill: C.muted })}`;
}

function modelHeight(m) {
  if (!m.ab) return 176;
  return 176 + Math.ceil(m.variants.length / VAR_PER_ROW) * (VAR_H + 12) + (m.noPick ? 22 : 4);
}

function buildReportSvg(results) {
  clipId = 0;
  const { survey, invited, completed, models } = results;
  const rate = invited ? Math.min(100, Math.round((completed / invited) * 100)) : 0;
  const out = [];
  let y = 0;

  out.push(text(40, 46, 'Model Beğeni Anketi', { size: 15, weight: 800, fill: C.accent }));
  out.push(text(40, 78, 'ANKET SONUCU', { size: 13, weight: 800, fill: C.muted }));
  out.push(text(40, 116, trunc(survey.title, 48), { size: 34, weight: 800 }));
  out.push(text(40, 144, `Kapanış: ${formatTR(survey.closed_at || survey.closes_at)}`, { size: 15, fill: C.muted }));
  const tiles = [[`${completed}/${invited}`, 'yanıtlayan'], [`%${rate}`, 'katılım'], [String(models.length), 'model']];
  tiles.forEach(([big, small], k) => {
    const x = 40 + k * 312;
    out.push(`<rect x="${x}" y="166" width="296" height="82" rx="16" fill="${C.card}"/>`);
    out.push(text(x + 148, 207, big, { size: 30, weight: 800, anchor: 'middle' }));
    out.push(text(x + 148, 232, small, { size: 14, fill: C.muted, anchor: 'middle' }));
  });
  out.push(text(40, 290, 'Model sıralaması', { size: 19, weight: 800 }));
  out.push(text(960, 290, 'Ortalama yalnızca 1–5 puanlardan; "Tarzım değil" ortalamaya katılmaz', { size: 13, fill: C.muted, anchor: 'end' }));
  y = 306;

  models.forEach((m, i) => {
    const h = modelHeight(m);
    out.push(`<rect x="30" y="${y}" width="940" height="${h}" rx="18" fill="${C.card}"/>`);
    out.push(modelHead(m, i, y));
    if (m.ab) {
      m.variants.forEach((v, k) => {
        const row = Math.floor(k / VAR_PER_ROW);
        out.push(variantTile(m, v, 88 + (k % VAR_PER_ROW) * (VAR_W + 10), y + 166 + row * (VAR_H + 12)));
      });
      if (m.noPick) out.push(text(88, y + h - 10, `${m.noPick} kişi hiçbirini seçmedi`, { size: 13, fill: C.muted }));
    }
    y += h + 14;
  });

  out.push(text(40, y + 22, `Yorumlar ve ayrıntılar: ${config.baseUrl}/sonuc/${survey.result_token}`, { size: 13, fill: C.muted }));
  const height = y + 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" font-family="Nunito">
    <rect width="${W}" height="${height}" fill="${C.bg}"/>${out.join('')}</svg>`;
}

function renderReportPng(results) {
  const resvg = new Resvg(buildReportSvg(results), {
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Nunito' },
    fitTo: { mode: 'width', value: W },
  });
  return resvg.render().asPng();
}

// Ana ekran simgesi: iki kumaş parçası (giriş ekranındaki gibi), mavi zemin.
const icons = {};
function appIcon(size) {
  if (!icons[size]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
      <defs><pattern id="s" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#F2F6FB"/><rect width="4" height="12" fill="#9DB7DE"/></pattern>
      <pattern id="d" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#FBF7F1"/><circle cx="5" cy="5" r="2.6" fill="#F4C9C2"/><circle cx="14" cy="13" r="2.6" fill="#BCD3F2"/></pattern></defs>
      <rect width="180" height="180" fill="${C.accent}"/>
      <rect x="34" y="38" width="54" height="78" rx="12" fill="url(#s)"/>
      <rect x="94" y="54" width="54" height="78" rx="12" fill="url(#d)"/>
      <rect x="40" y="134" width="100" height="10" rx="5" fill="#FFFFFF" opacity=".9"/>
    </svg>`;
    icons[size] = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
  }
  return icons[size];
}

module.exports = { buildReportSvg, renderReportPng, appIcon };
