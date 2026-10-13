/**
 * 自選清單：綁 Email，四支工具共用一份。
 *
 * GET  /api/watch        → { list: ['VCCT-ACE17', ...] }
 * POST /api/watch {list} → 整份覆寫
 *
 * 尚未接上 Blob 時回傳 stored:false，前端會自己用 localStorage 擐著，
 * 功能不會壞，只是不能跨裝置。
 */
const { requireUser, emailKey } = require('./_auth');
const { planOf } = require('./_plan');

const MAX_ITEMS = 200;

function pathOf(email) { return 'watch/' + emailKey(email) + '.json'; }

async function readList(email) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { head } = require('@vercel/blob');
  let info;
  try { info = await head(pathOf(email)); } catch (e) { return []; }
  if (!info || !info.url) return [];
  const r = await fetch(info.downloadUrl || info.url, {
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN }
  });
  if (!r.ok) return [];
  const j = await r.json().catch(function () { return null; });
  return (j && Array.isArray(j.list)) ? j.list : [];
}

async function writeList(email, list) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
  const { put } = require('@vercel/blob');
  await put(pathOf(email), JSON.stringify({ list: list, at: Date.now() }), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const user = requireUser(req, res);
  if (!user) return;

  try {
    // 讀永遠放行：體驗期過了還是看得到自己存過什麼，
    // 之後買課開通，清單原封不動還在。
    if (req.method === 'GET') {
      const list = await readList(user.e);
      const p = await planOf(user.e, user.t);
      return res.status(200).json({
        list: list || [], stored: list !== null,
        plan: p.plan, active: p.active, daysLeft: p.daysLeft, endsAt: p.endsAt
      });
    }
    if (req.method === 'POST') {
      // 寫入要在期限內
      const p = await planOf(user.e, user.t);
      if (!p.active) {
        return res.status(403).json({
          error: 'trial_ended', plan: p.plan, endsAt: p.endsAt
        });
      }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const raw = (body && Array.isArray(body.list)) ? body.list : [];
      // 去重、限長、只收得進「險種-代號」這種形式
      const seen = {}, list = [];
      for (let i = 0; i < raw.length && list.length < MAX_ITEMS; i++) {
        const v = String(raw[i] || '').trim().slice(0, 32);
        if (!/^[A-Za-z0-9_\-]+$/.test(v) || seen[v]) continue;
        seen[v] = true; list.push(v);
      }
      const stored = await writeList(user.e, list);
      return res.status(200).json({ list: list, stored: stored, plan: p.plan, active: true, daysLeft: p.daysLeft });
    }
    return res.status(405).json({ error: 'method' });
  } catch (e) {
    console.error('watch failed:', e && e.message);
    return res.status(200).json({ list: [], stored: false, warn: String((e && e.message) || e).slice(0, 120) });
  }
};
