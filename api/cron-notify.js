/**
 * 每日掃描：體驗期剩 3 天與剩 1 天各寄一次提醒。
 *
 * 寄過就在 user/<key>.json 記下來，不會重寄。學員與已退訂的跳過。
 * 沒設 RESEND_API_KEY 時 sendMail 回 skipped，整條照跑但不寄信，
 * 所以你還沒申請寄信服務之前，排程不會一直噴錯。
 *
 * Vercel 的 cron 會帶 Authorization: Bearer <CRON_SECRET>。
 * 沒設 CRON_SECRET 就只允許 Vercel 自己的 user-agent，避免被外部亂打。
 */
const { emailKey } = require('./_auth');
const { planOf, readJson, writeJson, TRIAL_DAYS } = require('./_plan');
const { sendMail, SITE } = require('./_mail');
const { isOptedOut } = require('./unsub');

const STAGES = [3, 1];

function allowed(req) {
  const want = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer /i, '');
  if (want) return got === want;
  return /vercel-cron/i.test(req.headers['user-agent'] || '');
}

function body(daysLeft) {
  const h = '<p style="font-size:15px;margin:0 0 14px">嗨，</p>';
  if (daysLeft <= 1) {
    return h +
      '<p style="font-size:15px;margin:0 0 14px">你在<b>基金配息率工具集</b>的體驗期<b>明天就到了</b>。</p>' +
      '<p style="font-size:15px;margin:0 0 14px">到期後，三張保單的配息率清單在部落格上還是免費看得到，' +
      '資料完全一樣；暫停的是無廣告版、自選清單與跨險種組合試算。' +
      '你存過的自選清單我們留著，不會刪。</p>';
  }
  return h +
    '<p style="font-size:15px;margin:0 0 14px">你在<b>基金配息率工具集</b>的體驗期還剩 <b>' + daysLeft + ' 天</b>。</p>' +
    '<p style="font-size:15px;margin:0 0 14px">先說清楚：到期後配息率的數字你還是看得到，部落格版一直是免費的。' +
    '會暫停的只有無廣告、自選清單和組合試算這些方便性。</p>';
}

function cta() {
  return '<p style="margin:22px 0 0"><a href="' + SITE + '/support" ' +
    'style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;' +
    'font-weight:700;font-size:14px;border-radius:10px;padding:12px 20px">贊助開通</a></p>';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!allowed(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(500).json({ error: 'blob not configured' });

  const { list } = require('@vercel/blob');
  const out = { scanned: 0, sent: 0, skipped: 0, failed: 0, dry: !process.env.RESEND_API_KEY };

  try {
    const blobs = [];
    let cur;
    do {
      const page = await list({ prefix: 'user/', cursor: cur, limit: 1000 });
      page.blobs.forEach((b) => blobs.push(b));
      cur = page.hasMore ? page.cursor : null;
    } while (cur);

    for (const b of blobs) {
      out.scanned++;
      let u = null;
      try {
        const r = await fetch(b.downloadUrl || b.url, {
          cache: 'no-store',
          headers: { Authorization: 'Bearer ' + process.env.BLOB_READ_WRITE_TOKEN }
        });
        if (r.ok) u = await r.json();
      } catch (e) {}
      if (!u || !u.email) { out.skipped++; continue; }

      const p = await planOf(u.email, u.firstAt);
      if (p.plan === 'student' || !p.active) { out.skipped++; continue; }

      // 只在剛好踩到 3 天與 1 天那兩天寄
      const stage = STAGES.indexOf(p.daysLeft) >= 0 ? p.daysLeft : null;
      if (stage === null) { out.skipped++; continue; }

      const sentList = Array.isArray(u.notified) ? u.notified : [];
      if (sentList.indexOf(stage) >= 0) { out.skipped++; continue; }

      if (await isOptedOut(u.email)) { out.skipped++; continue; }

      try {
        const r = await sendMail(u.email,
          stage <= 1 ? '你的體驗期明天到期' : '體驗期還剩 ' + stage + ' 天',
          body(stage) + cta());
        if (r && r.skipped) { out.skipped++; continue; }
        // 寄成功才記，失敗下次還會再試
        u.notified = sentList.concat([stage]);
        await writeJson('user/' + emailKey(u.email) + '.json', u);
        out.sent++;
      } catch (e) {
        console.error('notify failed', u.email, e && e.message);
        out.failed++;
      }
    }

    return res.status(200).json(Object.assign({ ok: true, trialDays: TRIAL_DAYS }, out));
  } catch (e) {
    console.error('cron-notify failed:', e && e.message);
    return res.status(500).json({ error: String((e && e.message) || e).slice(0, 200) });
  }
};
