# Model Beğeni Anketi

Model görsellerini yükleyip beğeni anketi yapan web uygulaması. Davet ve sonuç mailleri anketi oluşturan kişinin kendi Outlook'undan gider; uygulama sunucudan mail göndermez, bu yüzden mail sunucusu izni gerekmez. Telefon ve bilgisayarda çalışır.

## Neler yapar

- **Hesap:** Kullanıcı adı şirket e-postasının @ öncesidir (`alihakan.baykal` → `alihakan.baykal@lcwaikiki.com`); yalnızca şirket alan adı kayıt olabilir. Kayıt kodu isteğe bağlıdır (`REGISTRATION_CODE`). Giriş kullanıcı adı ya da tam adresle yapılır.
- **Şifre:** "Şifremi unuttum" isteği adminlere düşer (Outlook ile de yazılabilir); admin Yönetim sayfasından 24 saat geçerli, tek kullanımlık sıfırlama linki oluşturup kullanıcıya Outlook ile gönderir. Kullanıcı Hesabım sayfasından şifresini değiştirebilir.
- **Günlük yedek:** Her gün 03:00'ten sonra veritabanının kopyası sunucu diskine (14 gün) ve diskten bağımsız depolama alanına (Railway bucket; veritabanı 30 gün, görseller kalıcı) alınır. Yönetim sayfasında yedekler listelenir, indirilir, istenirse elle alınır.
- **Modeller:** Sınırsız model, her modele birden fazla görsel. Her yeni model otomatik numara alır (`MDL-0001`, `MDL-0002`…). Ana kumaş ve içerik elle yazılır. Model kaydedilince "Ankete ilerle" ile model seçili olarak anket oluşturmaya geçilir; formda "Kaydet ve ankete ilerle" düğmesi de vardır.
- **Ürün kırılımı:** Marka Müdürlükleri → Gelecek Dönem Buyer Grup → Gelecek Dönem Merch Alt Grup Kod → Gelecek Dönem Ürün Klasman. Alt kırılımlı seçilir: üst seviye seçilince yalnızca ona ait alt seçenekler gelir. Her liste açılınca arama kutusu çıkar; yazdıkça süzülür (Türkçe karakter fark etmez: "sapka" → "ŞAPKA"), klavyeyle de seçilebilir. Galeri marka müdürlüğüne göre süzülebilir, Excel çıktısında her seviye ayrı sütundur.
- **A/B testi:** Bir modelin görselleri aynı ürünün alternatifleriyse (model rengi, jakar deseni, çizgi renkleri ve yerleşimi, kumaş dokusu, ekose renkleri, baskı) model "A/B testi" olarak işaretlenir. Her görsel bir seçenek olur (A, B, C…) ve isteğe bağlı bir ad alır. Katılımcı her seçeneği ayrı puanlar, sonra "Koleksiyona hangisi girsin?" sorusunda birini ya da "Hiçbiri"ni seçer. En çok tercih edilen seçenek (eşitlikte yüksek ortalama) kazanır.
- **Anket gönderme (Outlook):** "Oluştur ve Outlook'ta gönder" anketi canlıya alır ve cihazdaki Outlook'u; alıcılar gizli (BCC), konu ve anket linki hazır bir mail ile açar. Gönderen kişinin kendi şirket hesabı kullanılır. Herkes aynı linki alır; katılımcı linki açınca kullanıcı adını yazar (şirket dışı kişiler tam adresini) ve her kişi anketi bir kez doldurabilir. Alıcı listesine kullanıcı adları ya da Outlook'tan kopyalanan "Ad Soyad <adres>" listesi yazılabilir.
- **Taslak:** "Taslak olarak kaydet" ile kaydedilen anket sonra "Gönder" ile canlıya alınır. Gönderilmeyen taslaklar 7 gün sonra otomatik silinir.
- **Yönetici girişi:** `/yonetici` adresinde ayrı bir giriş sayfası. Hesaplar aynıdır; yalnızca `ADMIN_EMAILS` listesindeki hesaplar girebilir ve doğrudan Yönetim sayfasına yönlenir. Normal giriş sayfasının altında bağlantısı vardır.
- **Test linki (yalnızca admin):** Admin, anketi canlıya almadan önce katılımcının göreceği şekilde dener; test yanıtları kaydedilmez. Adminler `ADMIN_EMAILS` ayarındaki adreslerle kayıtlı kullanıcılardır.
- **Katılımcı ekranı:** Telefonda modeller tek tek gösterilir. Her model için 1–5 puan **veya "Tarzım değil"** seçilir (ortalamaya katılmaz); isteğe bağlı yorum yazılır.
- **Kapanış hatırlatıcısı:** Canlıdaki anket sayfasından kapanış anı için Outlook takvimine hatırlatıcı (.ics) eklenir; hatırlatıcıdaki link sonuç maili sayfasını açar.
- **Sonuç maili (ekli ve görselli):** Anket bitiş günü ve saatinde kendiliğinden kapanır. Sonuç raporu bir görsel (PNG) olarak üretilir.
  - *Bilgisayar:* "Outlook taslağını aç" bir `.eml` taslağı indirir; açılınca Outlook'ta alıcısı ("Sonuç kime gelsin?") ve konusu dolu, rapor görseli mailin içinde, görsel ve Excel dosyaları (`sonuclar.csv`, `yorumlar.csv`) ekte yeni bir mail açılır. Mail, Outlook'ta açık hesaptan, yani anketi oluşturanın adresinden gider.
  - *Telefon:* "Paylaş → Outlook" görseli ve Excel dosyalarını paylaşım menüsüyle Outlook'a ek olarak verir (alıcı elle yazılır).
  - *Diğer yol:* raporu panoya kopyalayıp Outlook'u açan düğme.
  Sonucu henüz gönderilmemiş anketler listede "Sonucu gönder" ile işaretlenir.

## Kırılım listesini güncelleme / yeni başlık ekleme

Kırılım listesi `src/kirilim.json` dosyasından okunur ve Excel'den üretilir:

```bash
python3 scripts/kirilim_excel_to_json.py liste.xlsx
```

Excel'in ilk satırı başlıklardır ve soldan sağa kırılım sırasını belirler. Yeni bir başlık eklemek için Excel'e sağa yeni bir sütun ekleyip betiği tekrar çalıştırmak yeterli; uygulama başlık sayısından bağımsız çalışır.

Tasarım: `tasarim/tasarim-secenekleri.html` içindeki **B · Yumuşak Pastel** yönü.

## Çalıştırma

Node.js 22.5 veya üzeri gerekir.

```bash
npm install
npm start          # http://localhost:3000
npm test           # uçtan uca akış testi
```

Uygulama mail göndermez: davet, test ve sonuç mailleri `mailto:` linkleriyle kullanıcının cihazındaki mail uygulamasında (Outlook) hazır açılır ve kullanıcı kendi hesabından gönderir. Telefonda (iPhone/Android) mail linkleri varsayılan mail uygulaması yerine doğrudan Outlook uygulamasında açılır (`ms-outlook://compose`); Outlook kurulu değilse ekranın altında "Varsayılan mail uygulamasıyla aç" seçeneği çıkar. Bilgisayarda bilgisayarın varsayılan mail uygulaması açılır.

## Ayarlar

`.env.example` dosyasındaki değişkenleri sunucuda ortam değişkeni olarak tanımlayın:

| Değişken | Açıklama |
|---|---|
| `BASE_URL` | Uygulamanın internet adresi. Maildeki linkler ve görseller bununla oluşur. |
| `DATA_DIR` | Veritabanı ve görsellerin klasörü. Sunucuda **kalıcı disk** olmalı. |
| `REGISTRATION_CODE` | Doluysa yalnızca bu kodu bilenler hesap açabilir. |
| `COMPANY_DOMAIN` | Kullanıcı adlarının çevrildiği şirket alan adı (varsayılan `lcwaikiki.com`). |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | Yedeklerin gönderileceği S3 uyumlu depolama alanı. Railway'de bucket değişken referanslarıyla verilir (`${{yedek.ENDPOINT}}` …). Boşsa yalnızca diske yedeklenir. |
| `ADMIN_EMAILS` | Admin kullanıcıların e-postaları (noktalı virgül veya virgülle). Test linkini yalnızca onlar görür. |

## Yayına alma

Tek bir Node.js servisi ve kalıcı bir disk yeterli (örneğin Railway, Render ya da kendi sunucunuz). `DATA_DIR` kalıcı diske bakmalı; aksi halde her yeniden başlatmada veriler silinir. Zamanlayıcı uygulamanın içinde çalışır; her 30 saniyede süresi dolan anketleri kapatır ve süresi geçen taslakları siler.

## Yapı

```
src/server.js     rotalar (hesap, modeller, anketler, katılımcı linki)
src/db.js         SQLite tabloları
src/surveys.js    anket oluşturma, davet gönderimi, zamanlayıcı
src/results.js    ortalama, sıralama, CSV
src/outlook.js    Outlook (mailto) linkleri ve takvim hatırlatıcısı
src/rapor.js      sonuç raporu HTML'i (Outlook'a yapıştırılır)
src/gorsel.js     sonuç raporu görseli (PNG, assets/fonts ile çizilir)
src/eml.js        ekli ve görselli Outlook taslağı (.eml)
src/kirilim.js    alt kırılımlı ürün grupları
src/kullanici.js  kullanıcı adı ↔ şirket e-postası
src/yedek.js      günlük yedek (disk + depolama alanı)
src/s3.js         depolama alanına yükleme (AWS Signature V4)
src/views.js      sayfalar
public/           stil ve küçük tarayıcı betikleri
test/             uçtan uca test
```
