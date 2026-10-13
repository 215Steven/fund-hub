/**
 * 身分與方案：學員永久開通，其餘 14 天體驗期。
 *
 * 體驗期的起算點是 user/<key>.json 的 firstAt。這個欄位只寫一次、之後不覆蓋，
 * 所以重新登入、換瀏覽器、清掉 localStorage 都不會把天數洗回來。
 * Email 一律先過 normEmail，Gmail 的 a.b+x@ 與 ab@ 算同一個人。
 */
const { normEmail, emailKey } = require('./_auth');

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 14);
const DAY = 86400000;

// 覆寫後的 Blob 網址不變，CDN 可能還端舊的內容出來，
// 光靠 cache:'no-store' 擋不住邊緣節點。加一個每次都不同的參數強制繞過。
function bust(url) {
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_cb=' + Date.now() + Math.random().toString(36).slice(2, 6);
}

async function fetchJson(url) {
  const r = await fetch(bust(url), {
    cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN,
      'Cache-Control': 'no-cache'
    }
  });
  if (!r.ok) return null;
  return await r.json();
}

async function readJson(path) {
  const { head } = require('@vercel/blob');
  try {
    const h = await head(path);
    return await fetchJson(h.downloadUrl || h.url);
  } catch (e) { return null; }
}

async function writeJson(path, obj) {
  const { put } = require('@vercel/blob');
  await put(path, JSON.stringify(obj), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    // 不設這個的話 Blob 預設會讓 CDN 快取很久，
    // 於是剛寫完的白名單或訂單，下一次讀到的還是舊版。
    cacheControlMaxAge: 0
  });
}

/* ---------- 學員白名單 ---------- */

// 快取只留 10 秒。白名單是跨 function 的共用狀態，admin 改完之後
// 其他 function 的執行實例不會知道，快取太久會變成「設成學員了卻還沒開通」。
const WL_TTL = 10000;
let _wl = null, _wlAt = 0;

async function whitelist(force) {
  if (!force && _wl && Date.now() - _wlAt < WL_TTL) return _wl;
  const j = await readJson('students/index.json');
  const arr = Array.isArray(j) ? j : (j && Array.isArray(j.emails) ? j.emails : []);
  _wl = arr.map(normEmail);
  _wlAt = Date.now();
  return _wl;
}

async function setWhitelist(emails) {
  const seen = {}, uniq = [];
  (emails || []).forEach(function (e) {
    const n = normEmail(e);
    if (n && n.indexOf('@') > 0 && !seen[n]) { seen[n] = 1; uniq.push(n); }
  });
  await writeJson('students/index.json', { emails: uniq, at: new Date().toISOString() });
  _wl = uniq; _wlAt = Date.now();
  return uniq;
}

async function isStudent(email) {
  return (await whitelist()).indexOf(normEmail(email)) >= 0;
}

/* ---------- 使用者首次出現時間 ---------- */

async function ensureUser(email) {
  const n = normEmail(email);
  const p = 'user/' + emailKey(n) + '.json';
  let u = await readJson(p);
  if (u && u.firstAt) return u;
  u = { email: n, firstAt: new Date().toISOString() };
  try { await writeJson(p, u); } catch (e) {}
  return u;
}

/* ---------- 方案判定 ---------- */

async function planOf(email, firstAt) {
  const n = normEmail(email);
  if (await isStudent(n)) {
    return { email: n, plan: 'student', active: true, daysLeft: null, endsAt: null };
  }
  const first = typeof firstAt === 'number'
    ? firstAt
    : (Date.parse(firstAt || '') || Date.now());
  const ends = first + TRIAL_DAYS * DAY;
  const left = Math.ceil((ends - Date.now()) / DAY);
  return {
    email: n,
    plan: 'trial',
    active: Date.now() < ends,
    daysLeft: left > 0 ? left : 0,
    endsAt: new Date(ends).toISOString()
  };
}

module.exports = {
  TRIAL_DAYS, planOf, isStudent, ensureUser,
  whitelist, setWhitelist, readJson, writeJson, fetchJson, bust
};
