/**
 * 每日預熱：強制重抓三個險種的快照。
 *
 * 為什麼需要這支：
 *   /api/data 自己有 26 小時的 Blob 快照，但快照只會在「有人請求且快照已過期」時更新，
 *   等於是讓某個倒霉的訪客在前台等一輪完整重爬（一百多檔）。
 *   改由排程在半夜把三份快照都換新，白天就沒有人會踩到那條慢路徑。
 *
 * 為什麼要帶 prewarm 參數：
 *   /api/data 現在進 CDN 共用快取，直接打同一個網址只會拿到邊緣節點的舊副本，
 *   function 根本不會被喚醒。加一個每次都不同的參數才會真的跑到後端。
 *
 * 三個險種並行跑，不然三輪加起來會超過 function 的時間上限。
 */
const CODES = ['VCCT', 'VBCT', 'UND'];

function allowed(req) {
  const want = process.env.CRON_SECRET;
  const got = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  // Vercel 的 cron 會帶 Authorization: Bearer <CRON_SECRET>
  if (want) return got === want || req.headers['x-cron'] === want;
  // 沒設 secret 時退而求其次，只認 Vercel 自己的 user-agent
  return /vercel-cron/i.test(req.headers['user-agent'] || '');
}

function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + host;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!allowed(req)) return res.status(401).json({ error: 'unauthorized' });

  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET not set' });

  const root = baseUrl(req);
  const stamp = Date.now();

  const results = await Promise.all(CODES.map(async function (code) {
    const t = Date.now();
    try {
      const r = await fetch(root + '/api/data?code=' + code + '&prewarm=' + stamp, {
        headers: { 'x-cron': secret },
        signal: AbortSignal.timeout(55000)
      });
      let j = null;
      try { j = await r.json(); } catch (e) {}
      return {
        code: code,
        status: r.status,
        ms: Date.now() - t,
        total: (j && j.totalFunds) || 0,
        rated: (j && j.rated) || 0,
        savedAt: (j && j.savedAt) || null,
        error: (j && j.error) || null
      };
    } catch (e) {
      return { code: code, status: 0, ms: Date.now() - t, error: String((e && e.message) || e).slice(0, 120) };
    }
  }));

  // 有任何一支沒抓到就回 502，Vercel 的 cron 記錄會標紅，方便事後看得出來
  const ok = results.every(function (x) { return x.status === 200 && !x.error && x.rated > 0; });
  return res.status(ok ? 200 : 502).json({ ok: ok, ms: Date.now() - stamp, results: results });
};
