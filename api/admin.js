/**
 * 名單管理：列表、匯出 CSV、刪除單筆。
 *
 * 用 ADMIN_KEY 環境變數保護（?key= 或 x-admin-key 標頭）。
 * 設有刪除是因為個資法下當事人可以要求刪除，你得有工具執行。
 */
const crypto = require('crypto');
const { normEmail } = require('./_auth');
const { whitelist, setWhitelist, planOf, readJson, writeJson, TRIAL_DAYS } = require('./_plan');

function ok(req) {
  const want = process.env.ADMIN_KEY;
  if (!want) return false;
  const got = (req.query && req.query.key) || req.headers['x-admin-key'] || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(want));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function csvCell(v) {
  const s = String(v === null || v === undefined ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function allLeads() {
  const { list } = require('@vercel/blob');
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: 'leads/', cursor: cursor, limit: 1000 });
    for (const b of page.blobs) out.push(b);
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor);
  // 一次拿 20 筆，避免一口氣發太多請求
  const rows = [];
  for (let i = 0; i < out.length; i += 20) {
    const part = await Promise.all(out.slice(i, i + 20).map(async (b) => {
      try {
        const r = await fetch(b.downloadUrl || b.url, {
          cache: 'no-store',
          headers: { Authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN }
        });
        if (!r.ok) return null;
        const j = await r.json();
        j._path = b.pathname;
        return j;
      } catch (e) { return null; }
    }));
    part.forEach((x) => { if (x) rows.push(x); });
  }
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return rows;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!ok(req)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'blob not configured' });
  }

  const action = String((req.query && req.query.action) || 'list');

  try {
    // 待確認的贊助回報
    if (action === 'orders') {
      const { list } = require('@vercel/blob');
      const blobs = [];
      let cur;
      do {
        const page = await list({ prefix: 'orders/', cursor: cur, limit: 1000 });
        page.blobs.forEach((b) => blobs.push(b));
        cur = page.hasMore ? page.cursor : null;
      } while (cur);
      const orders = [];
      for (let i = 0; i < blobs.length; i += 20) {
        const part = await Promise.all(blobs.slice(i, i + 20).map(async (b) => {
          try {
            const r = await fetch(b.downloadUrl || b.url, {
              cache: 'no-store',
              headers: { Authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN }
            });
            if (!r.ok) return null;
            const j = await r.json();
            j._path = b.pathname;
            return j;
          } catch (e) { return null; }
        }));
        part.forEach((x) => { if (x) orders.push(x); });
      }
      orders.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      return res.status(200).json({ orders: orders });
    }

    // 確認或駁回一筆贊助。confirm 會順手加進白名單。
    if (action === 'order-set') {
      const email = normEmail((req.query && req.query.email) || '');
      const to = String((req.query && req.query.status) || '');
      if (!email) return res.status(400).json({ error: 'email required' });
      if (['confirmed', 'rejected', 'pending'].indexOf(to) < 0) {
        return res.status(400).json({ error: 'bad status' });
      }
      const key = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
      const path = 'orders/' + key + '.json';
      const rec = await readJson(path);
      if (!rec) return res.status(404).json({ error: 'order not found' });
      rec.status = to;
      rec.handledAt = new Date().toISOString();
      await writeJson(path, rec);

      const wl = await whitelist(true);
      if (to === 'confirmed' && wl.indexOf(email) < 0) {
        await setWhitelist(wl.concat([email]));
      }
      return res.status(200).json({ ok: true, order: rec });
    }

    // 讀目前學員白名單
    if (action === 'students') {
      return res.status(200).json({ emails: await whitelist(true), trialDays: TRIAL_DAYS });
    }

    // 整份覆寫白名單。前端把貼上的文字切好後送 JSON { emails: [...] }
    if (action === 'students-set') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const arr = (body && Array.isArray(body.emails)) ? body.emails : [];
      if (arr.length > 5000) return res.status(400).json({ error: 'too many' });
      const saved = await setWhitelist(arr);
      return res.status(200).json({ emails: saved, count: saved.length });
    }

    if (action === 'delete') {
      // 兩邊都先正規化。名單列表顯示的是正規化後的 Email，
      // 這裡若用原字串比對，有 + 別名的那幾筆會刪不掉。
      const email = normEmail((req.query && req.query.email) || '');
      if (!email) return res.status(400).json({ error: 'email required' });
      const { del } = require('@vercel/blob');
      const rows = await allLeads();
      const hit = rows.filter((r) => normEmail(r.email) === email);
      for (const h of hit) { try { await del(h._path); } catch (e) {} }
      // 自選清單與使用者檔案一併刪掉，不然體驗期起算時間會留著
      const key = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
      try { await del('watch/' + key + '.json'); } catch (e) {}
      try { await del('user/' + key + '.json'); } catch (e) {}
      try { await del('orders/' + key + '.json'); } catch (e) {}
      // 也從學員白名單移除
      try {
        const wl = await whitelist(true);
        if (wl.indexOf(email) >= 0) await setWhitelist(wl.filter((x) => x !== email));
      } catch (e) {}
      return res.status(200).json({ deleted: hit.length });
    }

    const rows = await allLeads();

    if (action === 'csv') {
      const wl2 = await whitelist(true);
      const head = ['email', 'name', 'consent', 'via', 'plan', 'at', 'ref'];
      const lines = [head.join(',')];
      rows.forEach((r) => {
        const n = normEmail(r.email);
        lines.push([n, r.name, r.consent ? 'Y' : 'N', r.via || 'email',
          wl2.indexOf(n) >= 0 ? 'student' : 'trial', r.at, r.ref].map(csvCell).join(','));
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
      // BOM 讓 Excel 不會把中文變亂碼
      return res.status(200).send('\uFEFF' + lines.join('\n'));
    }

    // 同一個人可能有多筆（重複登入），依正規化後的 Email 併成一筆，
    // 時間取最早的那次——體驗期是從第一次算起。
    const byUser = {};
    rows.forEach((r) => {
      const n = normEmail(r.email);
      if (!byUser[n]) {
        byUser[n] = { email: n, name: r.name, consent: !!r.consent,
                      via: r.via || 'email', at: r.at, hits: 1 };
      } else {
        const u = byUser[n];
        u.hits++;
        if (r.consent) u.consent = true;
        if (r.name && !u.name) u.name = r.name;
        if (r.via === 'google') u.via = 'google';
        if (String(r.at || '') < String(u.at || '')) u.at = r.at;
      }
    });
    const users = Object.keys(byUser).map((k) => byUser[k]);

    const wl = await whitelist(true);
    await Promise.all(users.map(async (u) => {
      const prof = await readJson('user/' + crypto.createHash('sha256')
        .update(u.email).digest('hex').slice(0, 32) + '.json');
      const first = (prof && prof.firstAt) || u.at;
      u.firstAt = first;
      const p = await planOf(u.email, first);
      u.plan = p.plan; u.active = p.active;
      u.daysLeft = p.daysLeft; u.endsAt = p.endsAt;
    }));
    users.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({
      total: users.length,
      consented: users.filter((r) => r.consent).length,
      students: wl.length,
      trialDays: TRIAL_DAYS,
      rows: users
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
