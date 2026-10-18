// Kullanıcı adı, şirket e-postasının @ öncesidir: "alihakan.baykal" -> "alihakan.baykal@lcwaikiki.com".
// Kullanıcı tam adresi yazarsa da kabul edilir.
const config = require('./config');

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

// Kayıt ve giriş için: yalnızca şirket alan adı. Geçersizse null.
function companyAccount(input) {
  let value = String(input || '').trim().toLowerCase();
  const at = value.indexOf('@');
  if (at >= 0) {
    if (value.slice(at + 1) !== config.companyDomain) return null;
    value = value.slice(0, at);
  }
  if (!USERNAME_RE.test(value)) return null;
  return { username: value, email: `${value}@${config.companyDomain}` };
}

// Anket alıcıları ve katılımcılar için: kullanıcı adı şirket adresine çevrilir, başka alan adlı tam adres olduğu gibi kalır.
function toAddress(input) {
  const value = String(input || '').trim().toLowerCase();
  if (!value) return null;
  if (value.includes('@')) return EMAIL_RE.test(value) ? value : null;
  return USERNAME_RE.test(value) ? `${value}@${config.companyDomain}` : null;
}

module.exports = { companyAccount, toAddress };
