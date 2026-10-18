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
  adminEmails: (process.env.ADMIN_EMAILS || '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
};
