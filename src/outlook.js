// Outlook (veya cihazdaki varsayılan mail uygulaması) için mailto: linkleri.
// Sunucu mail göndermez; kullanıcı kendi şirket hesabından gönderir.
const config = require('./config');
const { formatTR } = require('./time');

// Windows Outlook ve bazı tarayıcılar ~2000 karakterden uzun mailto linklerini kesiyor.
const MAX_LENGTH = 1900;

const enc = encodeURIComponent;

function build({ to = [], bcc = [], subject, body }) {
  const params = [`subject=${enc(subject)}`, `body=${enc(body)}`];
  if (bcc.length) params.unshift(`bcc=${bcc.map(enc).join(',')}`);
  return `mailto:${to.map(enc).join(',')}?${params.join('&')}`;
}

function inviteText(survey, modelCount, ownerName) {
  const link = `${config.baseUrl}/k/${survey.public_token}`;
  return {
    subject: `Görüşünüz önemli: ${survey.title}`,
    body: [
      'Merhaba,',
      '',
      `${survey.title} anketi için ${modelCount} model hakkında görüşünüzü rica ediyorum.`,
      'Her modeli 1-5 arası puanlayabilir, size uygun değilse "Tarzım değil" seçebilirsiniz. A/B testli modellerde koleksiyona girmesini istediğiniz seçeneği de işaretleyin.',
      '',
      `Ankete katılmak için: ${link}`,
      '',
      `Anket ${formatTR(survey.closes_at)} tarihinde kapanır.`,
      '',
      'Teşekkürler,',
      ownerName,
    ].join('\n'),
    link,
  };
}

// Alıcılar gizli (BCC) eklenir. Link çok uzarsa alıcısız açılır; sayfadaki "Adresleri kopyala" ile eklenir.
function inviteMailto({ survey, modelCount, ownerName, ownerEmail, emails }) {
  const text = inviteText(survey, modelCount, ownerName);
  const full = build({ to: [ownerEmail], bcc: emails, ...text });
  if (full.length <= MAX_LENGTH) return { href: full, recipientsIncluded: true, ...text };
  return { href: build({ to: [ownerEmail], ...text }), recipientsIncluded: false, ...text };
}

function resultMailto({ results, to }) {
  const { survey, invited, completed, models } = results;
  const lines = models.slice(0, 15).map((m, i) => {
    const avg = m.avg === null ? '-' : m.avg.toFixed(1).replace('.', ',');
    const ab = m.ab && m.winner ? ` | A/B kazanan: ${m.winner.letter}${m.winner.label ? ` (${m.winner.label})` : ''}` : '';
    return `${i + 1}. ${m.code} ${m.ana_kumas}: ${avg}${ab}`;
  });
  const body = [
    `${survey.title} anketi sonuçlandı.`,
    `${completed} kişi yanıtladı (${invited} davetli).`,
    '',
    ...lines,
    models.length > 15 ? `… ve ${models.length - 15} model daha` : '',
    '',
    `Görselli sonuç raporu: ${config.baseUrl}/sonuc/${survey.result_token}`,
    '',
  ].join('\n');
  return build({ to, subject: `Anket sonucu: ${survey.title}`, body });
}

// Taslak anketin test linkini admin ekibine gönderir.
function testMailto({ survey, link, to }) {
  return build({
    to,
    subject: `Test: ${survey.title}`,
    body: [
      `${survey.title} anketi canlıya alınmadan önce test edilmeyi bekliyor.`,
      '',
      `Test linki (admin girişi gerekir, yanıtlar kaydedilmez): ${link}`,
    ].join('\n'),
  });
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

const icsDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Kapanış anında hatırlatan takvim etkinliği (Outlook, telefon ve bilgisayar takvimleri açar).
function closingReminderIcs({ survey, url }) {
  const start = icsDate(survey.closes_at);
  const end = icsDate(new Date(new Date(survey.closes_at).getTime() + 15 * 60000).toISOString());
  const text = `"${survey.title}" anketi kapandı. Sonuç mailini göndermek için açın: ${url}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Model Begeni Anketi//TR',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:anket-${survey.id}-${survey.public_token}@model-begeni-anketi`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsText(`Anket sonucu: ${survey.title}`)}`,
    `DESCRIPTION:${icsText(text)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT0M',
    `DESCRIPTION:${icsText(text)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

// Şifresini unutan kullanıcının adminlere yazdığı istek.
function resetRequestMailto({ username, to }) {
  return build({
    to,
    subject: 'Model Beğeni Anketi: şifre sıfırlama isteği',
    body: `Merhaba,\n\n"${username}" kullanıcı adlı hesabımın şifresini sıfırlamak istiyorum. Yönetim sayfasından sıfırlama linki oluşturabilir misiniz?\n\n${config.baseUrl}/yonetim\n\nTeşekkürler`,
  });
}

// Adminin kullanıcıya gönderdiği tek kullanımlık şifre sıfırlama linki.
function resetLinkMailto({ email, url, hours }) {
  return build({
    to: [email],
    subject: 'Model Beğeni Anketi: şifre sıfırlama linkiniz',
    body: `Merhaba,\n\nŞifrenizi yenilemek için bu linki açın (${hours} saat geçerli, bir kez kullanılabilir):\n${url}\n\nBu isteği siz yapmadıysanız bu maili dikkate almayın.`,
  });
}

module.exports = { inviteMailto, resultMailto, testMailto, closingReminderIcs, resetRequestMailto, resetLinkMailto };
