/**
 * 工具集 — 伺服器端每日快照（?code=VCCT|VBCT|UND）
 *
 * 2026/10 富邦改版後，舊的 djjson 端點全數 404，這支改接新版 JSON API。
 * 一次把清單、報酬率、各檔配息明細抓齊並算好年化配息率，
 * 回傳前端可以直接渲染的 report。
 *
 * 為什麼要有這支：
 *   原本每個訪客各自跑一輪（一百多檔、每檔約 0.5 秒），首次開啟要等幾十秒；
 *   改成所有人共用 CDN 快取，每天只打富邦一次，對方負載也小很多。
 *
 * CDN 快取：s-maxage=30（30 秒）+ stale-while-revalidate=86400
 * 排程：vercel.json 的 cron 每天 UTC 06:00（台灣 14:00）預熱。
 *       排在下午是因為多數基金早上才公告當日淨值，中午跑會抓到前一天的。
 */

const FUBON_BASE = 'https://invest.fubonlife.com.tw';
const VALID = ['VCCT', 'VBCT', 'UND'];
const CONCURRENCY = 8;

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
  'Origin': FUBON_BASE,
  'Referer': FUBON_BASE + '/funds/overview',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

async function fbPost(path, body, ms) {
  const r = await fetch(FUBON_BASE + path, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(ms || 15000)
  });
  if (!r.ok) throw new Error(path + ' -> ' + r.status);
  const j = await r.json();
  return j && j.data;
}

// '13.80%' -> 13.8；'N/A' -> null
function pctNum(s) {
  if (s === null || s === undefined) return null;
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}
function daysSince(d) {
  if (!d) return 99999;
  const t = Date.parse(String(d).replace(/\//g, '-'));
  return isNaN(t) ? 99999 : (Date.now() - t) / 86400000;
}
function ymdAgo(days) {
  const d0 = new Date(Date.now() - days * 86400000);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d0.getFullYear() + '/' + p(d0.getMonth() + 1) + '/' + p(d0.getDate());
}
// 新版清單沒有配息頻率欄位，先由名稱猜，拿到明細後再用配息間隔修正
function freqFromName(name) {
  const s = String(name || '');
  if (/月配|月中配息|月撥|月收益/.test(s)) return '月配';
  if (/季配/.test(s)) return '季配';
  if (/半年配/.test(s)) return '半年配';
  if (/年配/.test(s)) return '年配';
  return '無';
}
function guessFreq(rows) {
  if (!rows || rows.length < 3) return null;
  const ds = rows.slice(0, 5)
    .map((r) => Date.parse(String(r.recordDate || r.dividendDate || r.date || '').replace(/\//g, '-')))
    .filter((t) => !isNaN(t));
  if (ds.length < 3) return null;
  let gap = 0;
  for (let i = 1; i < ds.length; i++) gap += Math.abs(ds[i - 1] - ds[i]) / 86400000;
  gap = gap / (ds.length - 1);
  if (gap < 45) return '月配';
  if (gap < 135) return '季配';
  if (gap < 225) return '半年配';
  return '年配';
}
// 與前端同一套：基金按月份去重取 6 筆，ETF 直接取前 6 筆
function get6MonthDivs(divs, isETF) {
  if (!divs || divs.length === 0) return [];
  if (isETF) return divs.slice(0, 6);
  const seen = {}, r = [];
  for (let i = 0; i < divs.length; i++) {
    const key = divs[i].date.substring(0, 7);
    if (!seen[key]) { seen[key] = true; r.push(divs[i]); }
    if (r.length >= 6) break;
  }
  return r;
}
function calcRate(nav, r6) {
  if (!r6 || r6.length === 0 || nav <= 0) return null;
  const avg = r6.reduce((s, d) => s + d.amount, 0) / r6.length;
  return (avg * 12) / nav * 100;
}

// 回傳內容對所有人完全相同，而且一天只變一次，放給 CDN 共用。
// 早期這支要驗身分才擋成 no-store，登入要求拿掉之後那個理由就不成立了。
// stale-while-revalidate：過期後先把舊的丟出去，背景再更新，使用者不用等。
// s-maxage 原本是 43200（12 小時）。那會讓「排程或手動更新完」之後，
// CDN 上的舊副本最長還要再送 12 小時，等於更新了使用者也看不到。
// 縮到 10 分鐘，配合 stale-while-revalidate：使用者永遠拿到即時回應，
// 背景去換新，所以更新最多十分鐘就會擴散出去。
// s-maxage 原本 600。問題是：有人按「立即更新」把快照換新之後，
// 邊緣節點還留著舊的那份，之後十分鐘內讀到的都是舊資料，
// 畫面上的「最後更新」也不會動 —— 看起來就像更新沒有效果。
// 2026-11-10 實測：force 後快照是 22:01，不帶 cache-buster 讀回來還是 11:50（x-vercel-cache: HIT）。
// 壓到 30 秒。這層快取本來就只是擋瞬間尖峰，不是拿來省重爬的（重爬有 Blob 快照擋著）。
const CACHE = 'public, s-maxage=30, stale-while-revalidate=86400';

// 手動更新：前端按「載入配息資料」會帶 force=1。
// 沒有 CRON_SECRET 也能用，所以一定要設年齡下限，否則外部可以連續觸發重爬。
// 快照還很新就忽略 force（維持秒回），夠舊才真的回源重抓；
// 重抓的結果寫進共用快照，所以一個人更新，大家都拿到新的。
const MIN_FORCE_AGE = 30 * 60 * 1000;

// 比排程間隔長，兩次預熱之間才不會有人踩到現場重爬（要等十幾秒）。
// 26 小時不夠：Vercel 的 cron 有 ±1 小時的彈性窗，
// 前一次跑在 13:05、下一次跑在 15:43 的話間隔就是 26.6 小時，剛好穿過去。
// 2026-11-10 早上就是這樣，UND 與 VBCT 的快照過期，當天第一個訪客現場重爬。
// 改 30 小時留 4 小時緩衝。代價是極端情況下資料可能舊到 30 小時，
// 但畫面上有「最後更新」時間，想要當下最新的人可以按「立即更新」。
const SNAP_TTL = 30 * 3600 * 1000;
function snapPath(code) { return 'snap/' + code + '.json'; }
async function readSnap(code) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { head } = require('@vercel/blob');
    const info = await head(snapPath(code));
    if (!info) return null;
    // Blob 覆寫後網址不變，邊緣節點可能還端舊的內容出來，光靠 cache:'no-store'
    // 擋不住（_plan.js 早就踩過這個坑）。加一個每次都不同的參數強制繞過，
    // 否則剛寫完馬上讀會拿到舊快照，force 的 30 分鐘下限就形同虛設。
    const raw = info.downloadUrl || info.url;
    const url = raw + (raw.indexOf('?') >= 0 ? '&' : '?') +
      '_cb=' + Date.now() + Math.random().toString(36).slice(2, 6);
    const r = await fetch(url, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN }
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.fetchedAt || Date.now() - j.fetchedAt > SNAP_TTL) return null;
    return j;
  } catch (e) { return null; }
}
async function saveSnap(code, payload) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const { put } = require('@vercel/blob');
  await put(snapPath(code), JSON.stringify(payload), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 這道門是為了識別使用者與收名單，不是資料授權；
  // 相同內容在部落格的免費版本上本來就公開。
  // 排程預熱時要強制重抓，否則快照永遠不會更新。
  var secret = process.env.CRON_SECRET;
  var bearer = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  var isCron = !!secret && (req.headers['x-cron'] === secret || bearer === secret);
  // 配息率與報酬率本來就是公開資訊，部落格版也一直免費，因此不再要求登入。
  // 需要身分的是「自選清單」(watch) 與「組合試算」，那兩支仍然擋著。
  // 組合試算要的是未經加工的 getAssets 原始清單，三個險種共用同一份。
  // 前端原本直接打 /api/post 現抓，一趟就要十秒；而且三個險種同時發，
  // 在第一趟回來前各自都看到快取是空的，等於白打三趟。
  // 這裡沿用下面同一套 Blob 快照 + CDN，回應內容對所有人完全相同。
  if (String((req.query && req.query.src) || '') === 'assets') {
    const hitA = isCron ? null : await readSnap('ASSETS');
    if (hitA) {
      res.setHeader('Cache-Control', CACHE);
      return res.status(200).json(hitA);
    }
    try {
      const all = await fbPost('/api/asset/getAssets', {}, 25000);
      if (!all || !all.length) throw new Error('getAssets 回傳空資料');
      const payloadA = { data: all, count: all.length, fetchedAt: Date.now() };
      try { await saveSnap('ASSETS', payloadA); } catch (e) {}
      res.setHeader('Cache-Control', CACHE);
      return res.status(200).json(payloadA);
    } catch (e) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: String((e && e.message) || e) });
    }
  }

  const INSURANCE = String((req.query && req.query.code) || 'VCCT').toUpperCase();
  if (VALID.indexOf(INSURANCE) < 0) return res.status(400).json({ error: 'code' });

  // 有效快照就直接回，避免每次重跑一輪
  const wantForce = isCron || String((req.query && req.query.force) || '') === '1';
  let cached = await readSnap(INSURANCE);
  // 帶 secret 的排程無條件重抓；一般人的手動更新要隔 MIN_FORCE_AGE 才算數
  if (cached && wantForce &&
      (isCron || Date.now() - (Number(cached.fetchedAt) || 0) > MIN_FORCE_AGE)) {
    cached = null;
  }
  if (cached) {
    res.setHeader('Cache-Control', CACHE);
    return res.status(200).json(cached);
  }

  try {
    // ① 一次拿全部標的，再篩出本險種
    const assets = await fbPost('/api/asset/getAssets', {}, 25000);
    if (!assets || !assets.length) throw new Error('getAssets 回傳空資料');
    const mine = assets.filter((a) =>
      (a.insurances || []).some((x) => x.code === INSURANCE));
    if (!mine.length) throw new Error('找不到 ' + INSURANCE + ' 的標的');

    const byCode = {};
    const report = mine.map((a) => {
      const isDisc = a.optionType === 'DIA' || /全權委託/.test(a.assetType || '');
      const row = {
        name: (a.assetChName || '').trim(),
        code: a.assetFbCode || '',
        type: (a.assetType || '').trim(),
        cur:  a.currencyName || '',
        rr:   a.riskLevel || '',
        freq: freqFromName(a.assetChName),
        nav:  Number(a.netAssetValue) || 0,
        rate: '', divs: null, rn: 0,
        url:  FUBON_BASE + '/funds/overview/' + a.optionType + '/' + a.optionCompany + '/' + a.assetFbCode,
        isDisc: isDisc,
        ret6m: pctNum(a.sixMonthReturn),
        ret1y: pctNum(a.oneYearReturn),
        ret3y: pctNum(a.threeYearReturn),
        v40: a.assetFbCode || '',
        v41: a.optionType === 'ETF' ? 'C' : (isDisc ? 'D' : (a.optionType === 'WFUND' ? 'B' : 'A'))
      };
      byCode[row.v40] = row;
      return row;
    });

    // ② 配息明細：只抓「最近一次配息在 45 天內」的候選
    const cands = mine.filter((a) => !/全權委託/.test(a.assetType || '')
      && a.optionType !== 'DIA' && daysSince(a.dividendDate) <= 45);
    let idx = 0;
    async function worker() {
      while (idx < cands.length) {
        const a = cands[idx++];
        const isETF = a.optionType === 'ETF';
        try {
          const rows = await fbPost(
            isETF ? '/api/etf/getEtfDividends' : '/api/fund/getFundDividends',
            { assetFbCode: a.assetFbCode, startDate: ymdAgo(400), endDate: ymdAgo(0) },
            10000);
          const divs = (rows || []).map((x) => {
            const ds = x.recordDate || x.dividendDate || x.date || '';
            const am = parseFloat(x.dividendPerUnit);
            if (!ds || isNaN(am) || am <= 0) return null;
            return { date: String(ds).replace(/\//g, '-').substring(0, 7), amount: am };
          }).filter(Boolean);
          const row = byCode[a.assetFbCode];
          if (!row) continue;
          const fq = guessFreq(rows);
          if (fq) row.freq = fq;
          if (row.freq === '月配' && divs.length) {
            const r6 = get6MonthDivs(divs, isETF);
            const rate = calcRate(row.nav, r6);
            row.rate = rate !== null ? rate.toFixed(2) : '';
            row.divs = r6;
            row.rn = rate || 0;
          }
        } catch (_) { /* 個別基金失敗不中斷 */ }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const monthlyCount = report.filter((r) => r.freq === '月配' && !r.isDisc).length;
    const rated = report.filter((r) => r.rate).length;
    const savedAt = new Date().toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    res.setHeader('Cache-Control', CACHE);

    const payload = {
      insurance: INSURANCE,
      report: report,
      totalFunds: report.length,
      monthlyCount: monthlyCount,
      rated: rated,
      savedAt: savedAt,
      fetchedAt: Date.now()
    };
    // 寫回 Blob，下一個請求就不用重算（失敗不影響本次回應）
    // 一定要等寫完才回應。serverless 送出回應後行程可能被凍結，
    // fire-and-forget 的寫入會悄悄掉；而「一個人更新、大家拿到新的」
    // 完全靠這個寫入成立，掉了就沒意義。
    if (rated >= 10) { try { await saveSnap(INSURANCE, payload); } catch (e) {} }
    return res.status(200).json(payload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
