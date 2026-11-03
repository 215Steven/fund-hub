/**
 * 每日預熱：把三個險種的報表、以及組合試算用的標的清單都換成新的。
 *
 * 為什麼需要這支：
 *   /api/data 自己有 Blob 快照，但快照只會在「有人請求且快照已過期」時更新，
 *   等於讓某個倒楣的訪客在前台等一輪完整重爬（一百多檔）。
 *   改由排程把快照換新，白天就沒有人會踩到那條慢路徑。
 *
 * 為什麼排在下午（UTC 06:00 / 台灣 14:00）：
 *   多數基金早上才公告當日淨值，中午以前跑會抓到前一天的數字。
 *
 * 為什麼並行而不是循序：
 *   maxDuration 是 60 秒，三輪完整重爬循序跑一定超時。
 *   但同時開三輪容易被對方限流，所以每支錯開 1.5 秒再出發。
 *
 * 關於 CRON_SECRET：
 *   有設：Vercel 的 cron 會自動帶 Authorization: Bearer <secret>，
 *         我們再用 x-cron 轉給 /api/data，請它無條件重抓。
 *   沒設：改認 Vercel cron 的 user-agent，並用 force=1 請 /api/data 重抓。
 *         force 那條路徑在 /api/data 有 30 分鐘的年齡下限，不會被外部濫用。
 *   兩種情況都能跑，不再因為少一個環境變數就整支掛掉。
 */
const CODES = ['VCCT', 'VBCT', 'UND'];

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function allowed(req) {
  const want = process.env.CRON_SECRET;
  const got = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  if (want) return got === want || req.headers['x-cron'] === want;
  return /vercel-cron/i.test(req.headers['user-agent'] || '');
}

function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + host;
}

// prewarm 參數每次都不同，否則只會拿到 CDN 邊緣節點的舊副本，function 根本不會被喚醒
async function hit(root, qs, secret, stamp) {
  const url = root + '/api/data?' + qs + '&force=1&prewarm=' + stamp;
  const headers = secret ? { 'x-cron': secret } : {};
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: headers, signal: AbortSignal.timeout(50000) });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    return { status: r.status, ms: Date.now() - t, json: j };
  } catch (e) {
    return { status: 0, ms: Date.now() - t, error: String((e && e.message) || e).slice(0, 120) };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!allowed(req)) return res.status(401).json({ error: 'unauthorized' });

  const secret = process.env.CRON_SECRET || '';
  const root = baseUrl(req);
  const stamp = Date.now();

  const results = await Promise.all(CODES.map(async function (code, i) {
    await sleep(i * 1500);
    const r = await hit(root, 'code=' + code, secret, stamp);
    const j = r.json || {};
    return {
      code: code,
      status: r.status,
      ms: r.ms,
      total: j.totalFunds || 0,
      rated: j.rated || 0,
      savedAt: j.savedAt || null,
      error: r.error || j.error || null
    };
  }));

  // 組合試算的基金清單吃同一套快照，一起換新
  const ra = await hit(root, 'src=assets', secret, stamp);
  const ja = ra.json || {};
  const assets = {
    status: ra.status,
    ms: ra.ms,
    count: ja.count || 0,
    error: ra.error || ja.error || null
  };

  const ok = results.every(function (x) { return x.status === 200 && !x.error && x.rated > 0; })
    && assets.status === 200 && assets.count > 0;

  // hasSecret 放進回應，下次壞掉時一眼就知道走的是哪條路
  return res.status(ok ? 200 : 502).json({
    ok: ok,
    hasSecret: !!secret,
    ms: Date.now() - stamp,
    results: results,
    assets: assets
  });
};
