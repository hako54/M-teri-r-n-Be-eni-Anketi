# Model Beğeni Anketi

Model görsellerini yükleyip mail ile beğeni anketi gönderen, süre dolunca sonucu otomatik mail atan web uygulaması. Telefon ve bilgisayarda çalışır.

## Neler yapar

- **Tek seferlik hesap:** Kullanıcı adı, e-posta ve şifre ile kayıt; sonra giriş.
- **Modeller:** Sınırsız model, her modele birden fazla görsel. Her yeni model otomatik numara alır (`MDL-0001`, `MDL-0002`…). Ana kumaş ve içerik elle yazılır.
- **Yakında:** Buyer Grup, Merch Alt Grup ve Klasman alanları formda yer tutucu olarak duruyor. Listeler gelince doldurulacak.
- **Anket:** Modeller seçilir, katılımcı mailleri girilir, kaç gün açık kalacağı ve bitiş saati (Türkiye saati) belirlenir. Her katılımcıya kendine özel linkle davet maili gider.
- **Katılımcı ekranı:** Telefonda modeller tek tek gösterilir. Her model için 1–5 puan **veya "Tarzım değil"** seçilir; isteğe bağlı yorum yazılır.
- **"Tarzım değil":** Ortalamaya ve puan sayısına katılmaz, ayrı sayılır.
- **A/B testi:** Bir modelin görselleri aynı ürünün alternatifleriyse (model rengi, jakar deseni, çizgi renkleri ve yerleşimi, kumaş dokusu, ekose renkleri, baskı) model "A/B testi" olarak işaretlenir. Her görsel bir seçenek olur (A, B, C…) ve isteğe bağlı bir ad alır. Katılımcı her seçeneği ayrı puanlar, sonra "Koleksiyona hangisi girsin?" sorusunda birini ya da "Hiçbiri"ni seçer. Sonuçta her seçeneğin ortalaması ve tercih sayısı görünür; en çok tercih edilen seçenek (eşitlikte yüksek ortalama) kazanan olarak işaretlenir.
- **Otomatik sonuç:** Bitiş günü ve saatinde anket kapanır; sıralama, puan dağılımı ve yorumları içeren sonuç maili gider. Ekinde Excel'de açılan `sonuclar.csv` ve `yorumlar.csv` dosyaları vardır. İstenirse anket "Şimdi kapat" ile erken bitirilebilir.

Tasarım: `tasarim/tasarim-secenekleri.html` içindeki **B · Yumuşak Pastel** yönü.

## Çalıştırma

Node.js 22.5 veya üzeri gerekir.

```bash
npm install
npm start          # http://localhost:3000
npm test           # uçtan uca akış testi
```

Mail sunucusu ayarlanmadıysa mailler gönderilmez, uygulamadaki **/giden-kutusu** sayfasına yazılır. Böylece maildeki linke tıklayarak anketi kendiniz deneyebilirsiniz.

## Ayarlar

`.env.example` dosyasındaki değişkenleri sunucuda ortam değişkeni olarak tanımlayın:

| Değişken | Açıklama |
|---|---|
| `BASE_URL` | Uygulamanın internet adresi. Maildeki linkler ve görseller bununla oluşur. |
| `DATA_DIR` | Veritabanı ve görsellerin klasörü. Sunucuda **kalıcı disk** olmalı. |
| `REGISTRATION_CODE` | Doluysa yalnızca bu kodu bilenler hesap açabilir. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Şirket mail sunucusu (Office 365, Google Workspace vb.) veya bir mail servisi (SendGrid, Resend, Brevo). |
| `MAIL_FROM` | Gönderen adı ve adresi. |

## Yayına alma

Tek bir Node.js servisi ve kalıcı bir disk yeterli (örneğin Railway, Render ya da kendi sunucunuz). `DATA_DIR` kalıcı diske bakmalı; aksi halde her yeniden başlatmada veriler silinir. Zamanlayıcı uygulamanın içinde çalışır ve her 30 saniyede süresi dolan anketleri kontrol eder. Uygulama kapalıyken süresi dolan bir anketin sonucu, uygulama açılır açılmaz gönderilir.

## Yapı

```
src/server.js     rotalar (hesap, modeller, anketler, katılımcı linki)
src/db.js         SQLite tabloları
src/surveys.js    anket oluşturma, davet gönderimi, zamanlayıcı
src/results.js    ortalama, sıralama, CSV
src/mail.js       mail gönderimi ve mail şablonları
src/views.js      sayfalar
public/           stil ve küçük tarayıcı betikleri
test/             uçtan uca test
```
