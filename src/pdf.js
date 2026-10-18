// Sonuç raporu PDF'i: önce rapor görseli A4 sayfalara bölünmüş halde (bir model kartı iki sayfaya bölünmez),
// ardından yorumlar seçilebilir metin olarak.
const PDFDocument = require('pdfkit');
const { renderReportPages, FONTS } = require('./gorsel');
const { formatTR } = require('./time');

const A4 = [595.28, 841.89];
const PX_TO_PT = A4[0] / 1000; // rapor görseli 1000 px genişliğinde, sayfaya kenardan kenara oturur
const PAGE_PX = Math.floor(A4[1] / PX_TO_PT);
const INK = '#22385A';
const MUTED = '#6A80A3';
const ACCENT = '#2F6FD0';

function buildResultPdf(results) {
  const { survey, models } = results;
  const doc = new PDFDocument({
    size: A4, margin: 0, autoFirstPage: false,
    info: { Title: `Anket sonucu: ${survey.title}`, Author: 'Model Beğeni Anketi' },
  });
  doc.registerFont('regular', FONTS[0]);
  doc.registerFont('bold', FONTS[1]);
  doc.registerFont('black', FONTS[2]);

  for (const png of renderReportPages(results, PAGE_PX)) {
    doc.addPage();
    doc.image(png, 0, 0, { width: A4[0] });
  }

  const withComments = models.filter((m) => m.comments.length);
  doc.addPage({ margin: 50 });
  doc.font('black').fontSize(20).fillColor(INK).text('Yorumlar');
  doc.font('regular').fontSize(10).fillColor(MUTED)
    .text(`${survey.title} · kapanış ${formatTR(survey.closed_at || survey.closes_at)}`);
  doc.moveDown(1);
  if (!withComments.length) {
    doc.font('regular').fontSize(11).fillColor(MUTED).text('Bu ankette yorum yazılmadı.');
  }
  for (const m of withComments) {
    if (doc.y > A4[1] - 120) doc.addPage({ margin: 50 });
    doc.font('bold').fontSize(13).fillColor(INK).text(`${m.code} · ${m.ana_kumas}`);
    if (m.kirilim.length) doc.font('regular').fontSize(9).fillColor(ACCENT).text(m.kirilim.join(' · '));
    doc.moveDown(0.3);
    for (const c of m.comments) {
      doc.font('regular').fontSize(11).fillColor(INK).text(`“${c.text}”`, { indent: 10 });
      doc.font('regular').fontSize(9).fillColor(MUTED).text([c.email, c.note].filter(Boolean).join(' · '), { indent: 10 });
      doc.moveDown(0.4);
    }
    doc.moveDown(0.6);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { buildResultPdf };
