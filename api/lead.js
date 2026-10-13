/**
 * 收名單並發放 token。
 *
 * 個資注意：表單邊已有蒐集告知，行銷同意是獨立勾選、且不影響開通。
 * 沒設 BLOB_READ_WRITE_TOKEN 時不會失敗，只是名單不會落地（方便先試流程）。
 */
const { sign } = require('./_auth');

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

  const email = String(body.email || '').trim().toLowerCase();
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

  return res.status(200).json({
    token: sign({ e: email, n: name, t: Date.now() }),
    stored: stored
  });
};
