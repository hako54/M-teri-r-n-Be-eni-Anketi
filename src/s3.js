// S3 uyumlu depolamaya (Railway bucket) dosya yükleme ve silme; AWS Signature V4 ile imzalanır.
// Yalnızca yedekleme için gereken iki işlem var, bu yüzden ağır bir SDK yerine burada yazıldı.
const crypto = require('node:crypto');
const config = require('./config');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

const enabled = () => Boolean(config.s3.endpoint && config.s3.bucket && config.s3.accessKey && config.s3.secretKey);

// Sanal host biçimi: https://<bucket>.<endpoint-host>/<key>
function objectUrl(key) {
  const endpoint = new URL(config.s3.endpoint);
  const path = '/' + key.split('/').map(encodeURIComponent).join('/');
  return new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}${path}`);
}

// AWS Signature V4: imzalanacak başlıklardan Authorization değerini üretir.
function authorization({ method, path, headers, payloadHash, amzDate, region, accessKey, secretKey }) {
  const day = amzDate.slice(0, 8);
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, path, '', ...names.map((n) => `${n}:${lower[n]}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  let key = hmac(`AWS4${secretKey}`, day);
  for (const part of [region, 's3', 'aws4_request']) key = hmac(key, part);
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
}

async function request(method, key, body = Buffer.alloc(0), contentType = 'application/octet-stream') {
  const url = objectUrl(key);
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const payloadHash = sha256(body);
  const headers = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (method === 'PUT') headers['content-type'] = contentType;
  const auth = authorization({
    method, path: url.pathname, headers, payloadHash, amzDate,
    region: config.s3.region, accessKey: config.s3.accessKey, secretKey: config.s3.secretKey,
  });

  const res = await fetch(url, {
    method,
    body: method === 'PUT' ? body : undefined,
    headers: {
      ...headers,
      authorization: auth,
    },
  });
  if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`Depolama ${method} ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

const putObject = (key, body, contentType) => request('PUT', key, body, contentType);
const deleteObject = (key) => request('DELETE', key);

module.exports = { enabled, putObject, deleteObject, authorization };
