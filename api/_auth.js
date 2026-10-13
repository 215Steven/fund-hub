/**
 * 簽章式 token：不需資料庫就能驗身。
 * payload：e = 正規化後的 Email，t = 這個帳號第一次出現的時間（體驗期由此起算），
 * i = 這張 token 的簽發時間（只用來算 token 自己的壽命）。
 * t 固定沿用既有的 firstAt，所以重新登入不會把體驗期重置。
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
/**
 * Email 正規化。Gmail 的點沒有意義，+ 後面那段是別名，
 * 不統一的話同一個人可以無限開分身，體驗期等於沒設。
 */
function normEmail(email) {
  var s = String(email || '').trim().toLowerCase();
  var at = s.lastIndexOf('@');
  if (at < 1) return s;
  var local = s.slice(0, at);
  var domain = s.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  var plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  return local + '@' + domain;
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
  // token 自身壽命看 i；舊 token 沒有 i 就退回看 t
  var issued = p.i || p.t;
  if (Date.now() - issued > MAX_AGE_DAYS * 86400000) return null;
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
  return crypto.createHash('sha256').update(normEmail(email)).digest('hex').slice(0, 32);
}

module.exports = { sign, verify, tokenOf, requireUser, emailKey, normEmail };
