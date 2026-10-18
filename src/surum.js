// Uygulama sürümü: kod ve tarayıcı dosyalarının içeriğinden üretilir, her güncellemede değişir.
// Stil/betik adresleri bununla çağrılır (eski dosya önbellekten gelmez) ve açık sayfalar yeni sürümü fark edip yenilenir.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? filesIn(full) : [full];
  });
}

const hash = crypto.createHash('sha1');
for (const file of ['src', 'public'].flatMap((d) => filesIn(path.join(ROOT, d))).sort()) {
  hash.update(path.relative(ROOT, file)).update(fs.readFileSync(file));
}
const version = hash.digest('hex').slice(0, 10);

const asset = (url) => `${url}?v=${version}`;

module.exports = { version, asset };
