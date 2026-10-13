/**
 * Google 登入：驗證 ID token、發放本站 token、寫入名單。
 *
 * 驗證方式用 Google 的 tokeninfo 端點，不自己解 JWT 簽章，
 * 省掉一個套件也少一個出錯的地方。每次登入才呼叫一次，量很小。
 *
 * 必須檢查三件事：aud 是不是我們的 client id、iss 是不是 Google、email_verified。
 * 只檢查簽章不檢 aud 的話，別人網站的 token 也能拿來登入。
 */
const { sign, normEmail } = require('./_auth');
const { ensureUser, planOf } = require('./_plan');

const CLIENT_ID = '363837903541-k2gjq9hbcr32aqk37araiu24hilhd0q1.apps.googleusercontent.com';
const ISS = ['accounts.google.com', 'https://accounts.google.com'];

async function saveLead(rec) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 'no-store';
  const { put } = require('@vercel/blob');
  const name = 'leads/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json';
  await put(name, JSON.stringify(rec), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false
  });
  return 'ok';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const credential = String(body.credential || '');
  if (!credential) return res.status(400).json({ error: 'missing credential' });

  let info;
  try {
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential),
      { signal: AbortSignal.timeout(10000) });
    info = await r.json();
    if (!r.ok) throw new Error(info && info.error_description || 'tokeninfo ' + r.status);
  } catch (e) {
    return res.status(401).json({ error: '驗證失敗，請再試一次' });
  }

  if (info.aud !== CLIENT_ID) return res.status(401).json({ error: 'aud mismatch' });
  if (ISS.indexOf(info.iss) < 0) return res.status(401).json({ error: 'iss mismatch' });
  if (String(info.email_verified) !== 'true') return res.status(401).json({ error: 'email 未驗證' });
  if (Number(info.exp) * 1000 < Date.now()) return res.status(401).json({ error: 'token 已過期' });

  const email = normEmail(info.email);
  const name = String(info.name || '').slice(0, 40);
  const consent = !!body.consent;

  let stored = 'skip';
  try {
    stored = await saveLead({
      email: email,
      name: name,
      consent: consent,
      via: 'google',
      verified: true,
      at: new Date().toISOString(),
      ua: String(req.headers['user-agent'] || '').slice(0, 180),
      ref: String(req.headers['referer'] || '').slice(0, 180)
    });
  } catch (e) {
    console.error('saveLead failed:', e && e.message);
    stored = 'error';
  }

  // firstAt 只在第一次登入寫入，之後沿用。token 的 t 綁 firstAt，
  // 所以重登、換裝置都不會把體驗期重置。
  let plan = { plan: 'trial', active: true, daysLeft: null, endsAt: null };
  let firstMs = Date.now();
  try {
    const u = await ensureUser(email);
    firstMs = Date.parse(u.firstAt) || firstMs;
    plan = await planOf(email, firstMs);
  } catch (e) {
    console.error('plan failed:', e && e.message);
  }

  return res.status(200).json({
    token: sign({ e: email, n: name, t: firstMs, i: Date.now() }),
    email: email,
    name: name,
    picture: info.picture || '',
    plan: plan.plan,
    active: plan.active,
    daysLeft: plan.daysLeft,
    endsAt: plan.endsAt,
    stored: stored
  });
};
