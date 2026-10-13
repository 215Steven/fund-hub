/**
 * 簽章式 token：不需資料庫就能驗身。
 * payload 是 Email 與簽發時間，後面接 HMAC-SHA256。
 * 這道門的目的是識別使用者與收名單，不是防馭客——
 * 同一份資料在部落格上本來就是免費公開的。
 */
const crypto = require('crypto');

const SECRET = process.env.HUB_SECRET || 'dev-only-secret-change-me';
const MAX_AGE_DAYS = 365;

function b64u(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  return body + '.' + mac;
}
function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  const body = parts[0], mac = parts[1];
  const want = b64u(crypto.createHmac('sha256', SECRET).update(body).digest());
  // 定長比對，避免時間差攻擊
  if (mac.length !== want.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  let p;
  try { p = JSON.parse(unb64u(body)); } catch (e) { return null; }
  if (!p || !p.e || !p.t) return null;
  if (Date.now() - p.t > MAX_AGE_DAYS * 86400000) return null;
  return p;
}
// 從 Authorization: Bearer xxx 或 ?token= 取
function tokenOf(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (h && /^Bearer /i.test(h)) return h.slice(7).trim();
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}
function requireUser(req, res) {
  const p = verify(tokenOf(req));
  if (!p) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return p;
}
function emailKey(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 32);
}

module.exports = { sign, verify, tokenOf, requireUser, emailKey };
