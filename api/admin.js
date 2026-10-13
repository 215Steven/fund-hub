/**
 * 名單管理：列表、匯出 CSV、刪除單筆。
 *
 * 用 ADMIN_KEY 環境變數保護（?key= 或 x-admin-key 標頭）。
 * 設有刪除是因為個資法下當事人可以要求刪除，你得有工具執行。
 */
const crypto = require('crypto');

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
    if (action === 'delete') {
      const email = String((req.query && req.query.email) || '').toLowerCase();
      if (!email) return res.status(400).json({ error: 'email required' });
      const { del } = require('@vercel/blob');
      const rows = await allLeads();
      const hit = rows.filter((r) => String(r.email || '').toLowerCase() === email);
      for (const h of hit) { try { await del(h._path); } catch (e) {} }
      // 連自選清單一併刪掉
      try {
        const key = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);
        await del('watch/' + key + '.json');
      } catch (e) {}
      return res.status(200).json({ deleted: hit.length });
    }

    const rows = await allLeads();

    if (action === 'csv') {
      const head = ['email', 'name', 'consent', 'via', 'at', 'ref'];
      const lines = [head.join(',')];
      rows.forEach((r) => {
        lines.push([r.email, r.name, r.consent ? 'Y' : 'N', r.via || 'email', r.at, r.ref].map(csvCell).join(','));
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
      // BOM 讓 Excel 不會把中文變亂碼
      return res.status(200).send('\uFEFF' + lines.join('\n'));
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({
      total: rows.length,
      consented: rows.filter((r) => r.consent).length,
      rows: rows.map((r) => ({ email: r.email, name: r.name, consent: !!r.consent, via: r.via || 'email', verified: !!r.verified, at: r.at }))
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
