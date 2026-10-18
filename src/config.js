const path = require('node:path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  port: Number(process.env.PORT) || 3000,
  // Maillerdeki linkler ve görseller bu adresle oluşturulur.
  baseUrl: (process.env.BASE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`).replace(/\/$/, ''),
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  // Türkiye 2016'dan beri yıl boyu UTC+3 kullanıyor.
  tzOffsetMinutes: 180,
  sessionDays: 30,
  // Bu adreslerle kayıtlı kullanıcılar admindir (test linki). Virgül veya noktalı virgülle ayrılır.
  // Kullanıcı adları bu alan adına çevrilir: alihakan.baykal -> alihakan.baykal@lcwaikiki.com
  companyDomain: (process.env.COMPANY_DOMAIN || 'lcwaikiki.com').toLowerCase(),
  backupDir: path.join(dataDir, 'yedekler'),
  // Yedeklerin diskten bağımsız kopyası için S3 uyumlu depolama (Railway bucket). Boşsa yalnızca diske yedeklenir.
  s3: {
    endpoint: process.env.BACKUP_S3_ENDPOINT || '',
    bucket: process.env.BACKUP_S3_BUCKET || '',
    region: process.env.BACKUP_S3_REGION || 'auto',
    accessKey: process.env.BACKUP_S3_ACCESS_KEY_ID || '',
    secretKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY || '',
  },
  // İngilizce anketlerde otomatik çeviri için DeepL API anahtarı (ücretsiz anahtarlar ':fx' ile biter).
  deeplKey: (process.env.DEEPL_API_KEY || '').trim(),
  adminEmails: (process.env.ADMIN_EMAILS || '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
};
