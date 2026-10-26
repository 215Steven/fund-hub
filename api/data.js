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
 * CDN 快取：s-maxage=43200（12 小時）+ stale-while-revalidate=86400
 * 排程：vercel.json 的 cron 每天 UTC 04:00（台灣 12:00）預熱
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
const CACHE = 'public, s-maxage=43200, stale-while-revalidate=86400';

// 比排程間隔（24 小時）長，兩次預熱之間不會有人踩到現場重爬。
const SNAP_TTL = 26 * 3600 * 1000;
function snapPath(code) { return 'snap/' + code + '.json'; }
async function readSnap(code) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { head } = require('@vercel/blob');
    const info = await head(snapPath(code));
    if (!info) return null;
    const url = info.downloadUrl || info.url;
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


/* ─────────────────────────────────────────────────────────────
   台股 ETF 對照（?src=twse）— 非保單標的

   為什麼塞在這支而不是獨立一個 api/twse.js：
     Hobby 方案一次部署最多 12 個 Serverless Function，專案已經剛好 12 個，
     多一個檔案整包就 build 失敗。併進來只是多一個查詢參數，不佔名額。

   這五檔不在富邦投資型保單裡，保單買不到，所以資料分開存、首頁也分開放。

   拿不到的就留空，不要猜：
     風險等級 RR 是投信自行評等，證交所不公告 → 一律 null。
     ETF 淨值由投信公告，證交所也沒有 → 改用收盤價。

   年化配息率的算法跟保單那邊「故意不一樣」：
     保單標的清一色月配，那邊用「近6月月配平均 × 12 ÷ 淨值」。
     這裡 00919 月配、0056 季配、0050 半年配混在一起，套同一條公式
     會把季配放大 4 倍、半年配放大 6 倍。改用「近12個月配息合計 ÷ 收盤價」。
   ───────────────────────────────────────────────────────────── */
const TWSE_BASE = 'https://www.twse.com.tw';
const TW_LIST = [
  { code: '0050',   name: '元大台灣50' },
  { code: '0056',   name: '元大高股息' },
  { code: '00878',  name: '國泰永續高股息' },
  { code: '00919',  name: '群益台灣精選高息' },
  { code: '006208', name: '富邦台50' }
];

function twSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function twJson(url) {
  const r = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': HEADERS['User-Agent'],
      'Referer': TWSE_BASE + '/'
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!r.ok) throw new Error('twse ' + r.status);
  return r.json();
}

// 民國 115/10/22 或 115年10月22日 → 2026-10-22
function rocToIso(s) {
  const m = String(s || '').match(/(\d{2,3})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const p = (n) => (n < 10 ? '0' : '') + n;
  return (parseInt(m[1], 10) + 1911) + '-' + p(parseInt(m[2], 10)) + '-' + p(parseInt(m[3], 10));
}
function twNum(s) {
  const n = parseFloat(String(s == null ? '' : s).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}
function twMonthsAgo(n) { const d = new Date(); d.setMonth(d.getMonth() - n); return d; }
function twYmd(d) { const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()); }
function twIso(d) { const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

async function twMonthCloses(code, dateObj) {
  const j = await twJson(TWSE_BASE + '/exchangeReport/STOCK_DAY?response=json&date=' + twYmd(dateObj) + '&stockNo=' + code);
  if (!j || j.stat !== 'OK' || !Array.isArray(j.data)) return [];
  const out = [];
  for (const row of j.data) {
    const iso = rocToIso(row[0]), c = twNum(row[6]);
    if (iso && c) out.push({ date: iso, close: c });
  }
  return out;
}
function twPick(rows, iso) {
  for (const r of rows) if (r.date >= iso) return r;
  return rows.length ? rows[rows.length - 1] : null;
}

// etfDiv 一次只回一個公告年度，近三年各抓一次
async function twDividends(code) {
  const nowRoc = new Date().getFullYear() - 1911;
  const seen = {}, out = [];
  for (let i = 0; i < 3; i++) {
    let j = null;
    try { j = await twJson(TWSE_BASE + '/rwd/zh/ETF/etfDiv?response=json&stkNo=' + code + '&year=' + (nowRoc - i)); }
    catch (e) { continue; }
    if (!j || !Array.isArray(j.data)) continue;
    for (const row of j.data) {
      const iso = rocToIso(row[2]);      // 除息交易日
      const amt = twNum(row[5]);         // 每受益權單位配息
      if (!iso || !amt || amt <= 0 || seen[iso]) continue;
      seen[iso] = 1;
      out.push({ date: iso, amount: amt });
    }
    await twSleep(120);
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}

function twFreq(divs) {
  if (!divs || divs.length < 2) return '無';
  const ts = divs.slice(0, 5).map((d) => Date.parse(d.date)).filter((t) => !isNaN(t));
  if (ts.length < 2) return '無';
  let gap = 0;
  for (let i = 1; i < ts.length; i++) gap += Math.abs(ts[i - 1] - ts[i]) / 86400000;
  gap = gap / (ts.length - 1);
  if (gap < 45) return '月配';
  if (gap < 135) return '季配';
  if (gap < 225) return '半年配';
  return '年配';
}
function twSum(divs, fromIso, toIso) {
  let s = 0;
  for (const d of divs) if (d.date > fromIso && d.date <= toIso) s += d.amount;
  return s;
}

async function twBuildOne(item) {
  // 只抓需要的那幾個月，不是整段歷史
  const months = [];
  for (const back of [0, 6, 12, 36]) {
    months.push(await twMonthCloses(item.code, twMonthsAgo(back)));
    await twSleep(120);
  }
  if (!months[0].length) throw new Error('無收盤價');
  const last = months[0][months[0].length - 1];
  const divs = await twDividends(item.code);

  function ret(idx, back) {
    const row = twPick(months[idx], twIso(twMonthsAgo(back)));
    if (!row || !row.close) return null;
    // 含息＝期間價格變化＋期間配息，不含再投入複利（與站上歷史區間回顧同口徑）
    return ((last.close + twSum(divs, row.date, last.date) - row.close) / row.close) * 100;
  }

  const div12 = twSum(divs, twIso(twMonthsAgo(12)), last.date);
  const half = twIso(twMonthsAgo(6));
  return {
    code: item.code, name: item.name,
    close: last.close, closeDate: last.date,
    freq: twFreq(divs),
    rate: last.close > 0 && div12 > 0 ? +((div12 / last.close) * 100).toFixed(2) : null,
    div12: +div12.toFixed(4),
    divs6m: divs.filter((d) => d.date > half),
    ret6m: ret(1, 6), ret1y: ret(2, 12), ret3y: ret(3, 36),
    rr: null
  };
}

async function twBuildAll() {
  const rows = [], failed = [];
  for (const item of TW_LIST) {
    try { rows.push(await twBuildOne(item)); }
    catch (e) { failed.push(item.code + ': ' + String((e && e.message) || e).slice(0, 60)); }
  }
  return { rows: rows, failed: failed };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // 這道門是為了識別使用者與收名單，不是資料授權；
  // 相同內容在部落格的免費版本上本來就公開。
  // 排程預熱時要強制重抓，否則快照永遠不會更新。
  var secret = process.env.CRON_SECRET;
  var bearer = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  var isCron = !!secret && (req.headers['x-cron'] === secret || bearer === secret);

  // 台股 ETF 對照：非保單標的，資料另外存一份快照
  if (String((req.query && req.query.src) || '') === 'twse') {
    const twCached = isCron ? null : await readSnap('TWSE');
    if (twCached) { res.setHeader('Cache-Control', CACHE); return res.status(200).json(twCached); }
    const built = await twBuildAll();
    if (!built.rows.length) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(502).json({ error: '證交所資料全部抓取失敗', failed: built.failed });
    }
    const twPayload = {
      rows: built.rows, failed: built.failed,
      savedAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      fetchedAt: Date.now()
    };
    // 全部成功才寫快照，免得把半殘結果固定住 12 小時
    if (!built.failed.length) saveSnap('TWSE', twPayload).catch(function () {});
    res.setHeader('Cache-Control', CACHE);
    return res.status(200).json(twPayload);
  }

  // 配息率與報酬率本來就是公開資訊，部落格版也一直免費，因此不再要求登入。
  // 需要身分的是「自選清單」(watch) 與「組合試算」，那兩支仍然擋著。
  const INSURANCE = String((req.query && req.query.code) || 'VCCT').toUpperCase();
  if (VALID.indexOf(INSURANCE) < 0) return res.status(400).json({ error: 'code' });

  // 有效快照就直接回，避免每次重跑一輪
  const cached = isCron ? null : await readSnap(INSURANCE);
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
    if (rated >= 10) { saveSnap(INSURANCE, payload).catch(function () {}); }
    return res.status(200).json(payload);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
