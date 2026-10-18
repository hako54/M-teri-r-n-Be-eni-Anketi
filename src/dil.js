// Katılımcının gördüğü sabit metinler (Türkçe / İngilizce). Anketin dili survey.lang ile belirlenir.
const { formatTR } = require('./time');
const config = require('./config');

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatEN(iso) {
  const d = new Date(new Date(iso).getTime() + config.tzOffsetMinutes * 60000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS_EN[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} (Türkiye time)`;
}

const T = {
  tr: {
    date: formatTR,
    openUntil: (date) => `${date} tarihine kadar açık`,
    notLive: 'henüz canlıda değil',
    model: () => 'model',
    testBar: 'Bu bir deneme. Yanıtlar kaydedilmez ve sonuçlara katılmaz.',
    noImage: 'Görsel yok',
    howMuch: 'Bu modeli ne kadar beğendiniz?',
    hateIt: 'Hiç beğenmedim',
    loveIt: 'Çok beğendim',
    notMyStyle: 'Tarzım değil',
    comment: 'Yorumunuz',
    optional: 'isteğe bağlı',
    commentHint: 'Kalıp, renk, kumaş hakkında bir not…',
    back: 'Geri',
    next: 'Sonraki',
    submit: 'Anketi gönder',
    finishTest: 'Testi bitir',
    option: (letter) => `Seçenek ${letter}`,
    abDefault: 'Seçenek karşılaştırması',
    abIntro: (n) => `Bu modelin ${n} seçeneği var. Her birini puanlayın, sonra koleksiyonda hangisinin olmasını istediğinizi seçin.`,
    abQuestion: 'Koleksiyonda hangisinin olmasını istersiniz?',
    none: 'Hiçbiri',
    joinIntro: (n, date) => `${n} model · ${date} tarihine kadar açık. Başlamak için kullanıcı adınızı yazın.`,
    start: 'Ankete başla',
    joinNote: 'Her kişi anketi bir kez doldurabilir. Şirket dışından katılıyorsanız tam e-posta adresinizi yazın.',
    joinError: 'Kullanıcı adınızı şirket e-postanızın @ öncesi olarak yazın (ör. ad.soyad).',
    username: 'Kullanıcı adı',
    usernameHint: 'Şirket e-postanızın @ öncesi.',
    invalidTitle: 'Link geçersiz',
    invalidText: 'Bu anket linki bulunamadı. Maildeki linki eksiksiz açtığınızdan emin olun.',
    notStartedTitle: 'Anket henüz başlamadı',
    notStartedText: 'Bu anket henüz canlıya alınmadı.',
    closedTitle: 'Anket kapandı',
    closedText: (date) => `Bu anket ${date} tarihinde kapandı.`,
    thanksTitle: 'Teşekkürler',
    alreadyDone: 'Bu anketi tamamladınız. Görüşleriniz kaydedildi.',
    saved: (date) => `Görüşleriniz kaydedildi. Anket ${date} tarihinde kapanacak.`,
    missingTitle: 'Eksik yanıt',
    missingText: (code) => `${code} için bütün seçenekleri değerlendirin. Geri dönüp tamamlayabilirsiniz.`,
    testDoneTitle: 'Test tamamlandı',
    testDoneText: 'Anket sorunsuz çalışıyor. Bu test yanıtları kaydedilmedi ve sonuçlara katılmaz.',
    testAgain: 'Testi tekrarla',
  },
  en: {
    date: formatEN,
    openUntil: (date) => `open until ${date}`,
    notLive: 'not live yet',
    model: (n) => (n === 1 ? 'model' : 'models'),
    testBar: 'This is a test. Answers are not saved and do not count in the results.',
    noImage: 'No image',
    howMuch: 'How much do you like this model?',
    hateIt: 'Not at all',
    loveIt: 'Love it',
    notMyStyle: 'Not my style',
    comment: 'Your comment',
    optional: 'optional',
    commentHint: 'A note on fit, colour or fabric…',
    back: 'Back',
    next: 'Next',
    submit: 'Submit survey',
    finishTest: 'Finish test',
    option: (letter) => `Option ${letter}`,
    abDefault: 'Option comparison',
    abIntro: (n) => `This model has ${n} options. Rate each one, then choose which one you would like to see in the collection.`,
    abQuestion: 'Which one would you like to see in the collection?',
    none: 'None',
    joinIntro: (n, date) => `${n} ${n === 1 ? 'model' : 'models'} · open until ${date}. Enter your username to start.`,
    start: 'Start survey',
    joinNote: 'Each person can complete the survey once. If you are outside the company, enter your full email address.',
    joinError: 'Enter your username as the part of your company email before the @ (e.g. name.surname).',
    username: 'Username',
    usernameHint: 'The part of your company email before the @.',
    invalidTitle: 'Invalid link',
    invalidText: 'This survey link was not found. Make sure you opened the full link from the email.',
    notStartedTitle: 'Survey not started yet',
    notStartedText: 'This survey has not been published yet.',
    closedTitle: 'Survey closed',
    closedText: (date) => `This survey closed on ${date}.`,
    thanksTitle: 'Thank you',
    alreadyDone: 'You have already completed this survey. Your answers were saved.',
    saved: (date) => `Your answers were saved. The survey closes on ${date}.`,
    missingTitle: 'Missing answer',
    missingText: (code) => `Please rate every option for ${code}. Go back to complete it.`,
    testDoneTitle: 'Test complete',
    testDoneText: 'The survey works. These test answers were not saved and do not count in the results.',
    testAgain: 'Run the test again',
  },
};

const t = (lang) => T[lang === 'en' ? 'en' : 'tr'];

module.exports = { t, formatEN };
