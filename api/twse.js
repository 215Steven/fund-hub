/**
 * 台股 ETF 對照資料（非保單標的）
 *
 * 為什麼獨立一支，不併進 api/data：
 *   這五檔不在富邦投資型保單裡，保單買不到。混進同一份資料會讓人
 *   以為保單裡有，所以從資料層就分開，首頁也單獨一區並加註。
 *
 * 來源都是證交所公開資料：
 *   收盤價   /exchangeReport/STOCK_DAY?date=YYYYMMDD&stockNo=XXXX
 *   收益分配 /rwd/zh/ETF/etfDiv?stkNo=XXXX
 *
 * 拿不到的東西，就不要假裝有：
 *   風險等級 RR 是投信自行評等、證交所不公告 → 一律留 null。
 *   ETF 淨值由投信每日公告、證交所也沒有 → 改用收盤價，欄位就叫收盤價。
 *
 * 年化配息率的口徑跟保單那邊「不一樣」，這是故意的：
 *   保單標的清一色月配，所以那邊用「近6月月配平均 × 12 ÷ 淨值」。
 *   這裡 00919 月配、0056 季配、0050 半年配混在一起，套同一條公式
 *   會把季配放大 4 倍、半年配放大 6 倍，是嚴重誤導。
 *   所以改用「近 12 個月配息合計 ÷ 收盤價」，前端要把口徑寫出來。
 */

const TWSE = 'https://www.twse.com.tw';
const CACHE = 'public, s-maxage=43200, stale-while-revalidate=86400';
const SNAP_TTL = 26 * 3600 * 1000;      // 比排程間隔長，兩次預熱之間不會有人踩到現場重抓

const LIST = [
  { code: '0050',   name: '元大台灣50' },
  { code: '0056',   name: '元大高股息' },
  { code: '00878',  name: '國泰永續高股息' },
  { code: '00919',  name: '群益台灣精選高息' },
  { code: '006208', name: '富邦台50' }
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function getJson(url, ms) {
  const r = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': UA, 'Referer': TWSE + '/' },
    signal: AbortSignal.timeout(ms || 12000)
  });
  if (!r.ok) throw new Error(url.slice(0, 60) + ' -> ' + r.status);
  return r.json();
}

// 民國 115/10/22 或 115年10月22日 → 2026-10-22
function rocToIso(s) {
  const m = String(s || '').match(/(\d{2,3})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const y = parseInt(m[1], 10) + 1911;
  const p = (n) => (n < 10 ? '0' : '') + n;
  return y + '-' + p(parseInt(m[2], 10)) + '-' + p(parseInt(m[3], 10));
}
function ymd(d) {
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
}
function num(s) {
  const n = parseFloat(String(s == null ? '' : s).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}
function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

/** 某個月的日收盤，回傳 [{date:'2026-10-22', close:106.9}, ...] */
async function monthCloses(code, dateObj) {
  const j = await getJson(TWSE + '/exchangeReport/STOCK_DAY?response=json&date=' + ymd(dateObj) + '&stockNo=' + code);
  if (!j || j.stat !== 'OK' || !Array.isArray(j.data)) return [];
  const out = [];
  for (const row of j.data) {
    const iso = rocToIso(row[0]);
    const c = num(row[6]);
    if (iso && c) out.push({ date: iso, close: c });
  }
  return out;
}

/** 目標日當天或之後最接近的一筆；沒有就取當月最後一筆 */
function pickOnOrAfter(rows, iso) {
  for (const r of rows) if (r.date >= iso) return r;
  return rows.length ? rows[rows.length - 1] : null;
}
function isoOf(d) {
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 收益分配：etfDiv 一次只回一個公告年度，近三年各抓一次 */
async function dividends(code) {
  const thisRoc = new Date().getFullYear() - 1911;
  const seen = {};
  const out = [];
  for (let i = 0; i < 3; i++) {
    let j = null;
    try {
      j = await getJson(TWSE + '/rwd/zh/ETF/etfDiv?stkNo=' + code + '&response=json&year=' + (thisRoc - i));
    } catch (e) { continue; }
    if (!j || !Array.isArray(j.data)) continue;
    for (const row of j.data) {
      const iso = rocToIso(row[2]);        // 除息交易日
      const amt = num(row[5]);             // 每受益權單位配息
      if (!iso || !amt || amt <= 0) continue;
      if (seen[iso]) continue;
      seen[iso] = 1;
      out.push({ date: iso, amount: amt });
    }
    await sleep(120);
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));   // 新到舊
  return out;
}

/** 由除息間隔推頻率，與 api/data.js 同一套判斷 */
function guessFreq(divs) {
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

function sumBetween(divs, fromIso, toIso) {
  let s = 0;
  for (const d of divs) if (d.date > fromIso && d.date <= toIso) s += d.amount;
  return s;
}

async function buildOne(item) {
  const code = item.code;

  // 只抓需要的那幾個月，不是整段歷史：今天 / 6個月前 / 1年前 / 3年前
  const marks = [0, 6, 12, 36].map(monthsAgo);
  const months = [];
  for (const d of marks) {
    months.push(await monthCloses(code, d));
    await sleep(120);
  }
  const cur = months[0];
  if (!cur.length) throw new Error(code + ' 無收盤價');
  const last = cur[cur.length - 1];

  const divs = await dividends(code);

  function ret(idx, back) {
    const target = isoOf(monthsAgo(back));
    const row = pickOnOrAfter(months[idx], target);
    if (!row || !row.close) return null;
    const div = sumBetween(divs, row.date, last.date);
    return ((last.close + div - row.close) / row.close) * 100;
  }

  const oneYearAgo = isoOf(monthsAgo(12));
  const div12 = sumBetween(divs, oneYearAgo, last.date);
  const halfYearAgo = isoOf(monthsAgo(6));

  return {
    code: code,
    name: item.name,
    close: last.close,
    closeDate: last.date,
    freq: guessFreq(divs),
    // 近 12 個月配息合計 ÷ 收盤價。與保單那邊的「近6月月配平均×12」不同，前端要標註。
    rate: last.close > 0 && div12 > 0 ? +((div12 / last.close) * 100).toFixed(2) : null,
    div12: +div12.toFixed(4),
    divs6m: divs.filter((d) => d.date > halfYearAgo),
    ret6m: ret(1, 6),
    ret1y: ret(2, 12),
    ret3y: ret(3, 36),
    rr: null,          // 證交所不公告，不猜
    url: 'https://www.twse.com.tw/zh/trading/historical/stock-day.html?stockNo=' + code
  };
}

const SNAP = 'snap/twse.json';
async function readSnap() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const { head } = require('@vercel/blob');
    const info = await head(SNAP);
    if (!info) return null;
    const r = await fetch(info.downloadUrl || info.url, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN }
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.fetchedAt || Date.now() - j.fetchedAt > SNAP_TTL) return null;
    return j;
  } catch (e) { return null; }
}
async function saveSnap(payload) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const { put } = require('@vercel/blob');
  await put(SNAP, JSON.stringify(payload), {
    access: 'private', contentType: 'application/json',
    addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const secret = process.env.CRON_SECRET;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer /i, '');
  const isCron = !!secret && (req.headers['x-cron'] === secret || bearer === secret);

  const cached = isCron ? null : await readSnap();
  if (cached) {
    res.setHeader('Cache-Control', CACHE);
    return res.status(200).json(cached);
  }

  const rows = [];
  const failed = [];
  for (const item of LIST) {
    try { rows.push(await buildOne(item)); }
    catch (e) { failed.push(item.code + ': ' + String((e && e.message) || e).slice(0, 80)); }
  }

  if (!rows.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: '證交所資料全部抓取失敗', failed: failed });
  }

  const savedAt = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const payload = { rows: rows, failed: failed, savedAt: savedAt, fetchedAt: Date.now() };

  // 全部成功才寫快照，免得把半殘的結果固定住 12 小時
  if (!failed.length) saveSnap(payload).catch(function () {});

  res.setHeader('Cache-Control', CACHE);
  return res.status(200).json(payload);
};
