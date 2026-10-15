/**
 * 收名單並發放 token。
 *
 * 個資注意：表單邊已有蒐集告知，行銷同意是獨立勾選、且不影響開通。
 * 沒設 BLOB_READ_WRITE_TOKEN 時不會失敗，只是名單不會落地（方便先試流程）。
 */
const { sign, normEmail } = require('./_auth');
const { ensureUser, planOf } = require('./_plan');

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function saveLead(rec) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return 'no-store';
  const { put } = require('@vercel/blob');
  const name = 'leads/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json';
  await put(name, JSON.stringify(rec), {
    access: 'private',   // 名單是個資，不能公開可讀
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

  const email = normEmail(body.email);
  const name  = String(body.name || '').trim().slice(0, 40);
  const consent = !!body.consent;

  if (!EMAIL_RE.test(email) || email.length > 160) {
    return res.status(400).json({ error: 'Email 格式不正確' });
  }

  let stored = 'skip';
  try {
    stored = await saveLead({
      email: email,
      name: name,
      consent: consent,
      at: new Date().toISOString(),
      ua: String(req.headers['user-agent'] || '').slice(0, 180),
      ref: String(req.headers['referer'] || '').slice(0, 180)
    });
  } catch (e) {
    // 名單寫入失敗不該擋住使用者，記下來就好
    console.error('saveLead failed:', e && e.message);
    stored = 'error:' + String((e && e.message) || e).slice(0, 120);
  }

  let plan = { plan: 'trial', active: true, daysLeft: null, endsAt: null };
  let firstMs = Date.now();
  try {
    const u = await ensureUser(email);
    firstMs = Date.parse(u.firstAt) || firstMs;
    plan = await planOf(email, firstMs);
  } catch (e) {
    console.error('plan failed:', e && e.message);
  }

  const token = sign({ e: email, n: name, t: firstMs, i: Date.now() });

  // LINE 內建瀏覽器與 Safari 無痕模式會擋掉 localStorage；
  // 只存 localStorage 的話，這些人會永遠卡在登入畫面。
  // 伺服器端 Set-Cookie 不受 Safari 對 script 寫 cookie 的 7 天上限限制。
  res.setHeader('Set-Cookie',
    'fh=' + encodeURIComponent(token) + '; Path=/; Max-Age=15552000; SameSite=Lax; Secure');

  return res.status(200).json({
    token: token,
    plan: plan.plan,
    active: plan.active,
    daysLeft: plan.daysLeft,
    endsAt: plan.endsAt,
    stored: stored
  });
};
