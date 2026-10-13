/**
 * 退訂。個資法 §20：當事人表示拒絕行銷時，應立即停止。
 *
 * 連結帶簽章，否則任何人把別人的信箱填進網址就能幫人退訂。
 * 一鍵完成，不要求登入——強迫登入才能退訂等於沒有提供退訂管道。
 * 退訂只停行銷信，帳號與自選清單不動（那要走後台刪除）。
 */
const crypto = require('crypto');
const { normEmail, emailKey } = require('./_auth');
const { readJson, writeJson } = require('./_plan');

const SECRET = process.env.HUB_SECRET || 'dev-only-secret-change-me';

function sigOf(email) {
  return crypto.createHmac('sha256', SECRET)
    .update('unsub:' + normEmail(email)).digest('hex').slice(0, 24);
}

async function isOptedOut(email) {
  const r = await readJson('optout/' + emailKey(email) + '.json');
  return !!(r && r.out);
}

async function setOptOut(email, out) {
  await writeJson('optout/' + emailKey(email) + '.json', {
    email: normEmail(email), out: !!out, at: new Date().toISOString()
  });
}

function page(title, body) {
  return '<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + title + '</title><style>' +
    'body{margin:0;background:#f3f6fb;color:#1f2a37;line-height:1.8;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","PingFang TC",sans-serif}' +
    '.w{max-width:480px;margin:72px auto;padding:0 22px;text-align:center}' +
    'h1{font-size:21px;margin:0 0 12px}p{color:#64748b;font-size:14.5px;margin:0 0 20px}' +
    'a{display:inline-block;font-size:14px;font-weight:700;text-decoration:none;color:#475569;' +
    'border:1.5px solid #e2e8f0;background:#fff;border-radius:10px;padding:11px 18px}' +
    '</style></head><body><div class="w">' + body + '</div></body></html>';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const q = req.query || {};
  const email = normEmail(q.e || '');
  const sig = String(q.s || '');

  if (!email || email.indexOf('@') < 1) {
    return res.status(400).send(page('連結有誤',
      '<h1>連結有誤</h1><p>這個退訂連結不完整。你可以直接回信告訴我，我手動幫你移除。</p>'));
  }

  // 定長比對，順便擋掉長度不同造成的例外
  const want = sigOf(email);
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).send(page('連結已失效',
      '<h1>連結已失效</h1><p>這個退訂連結無法驗證。請用最近一封信裡的連結，或直接回信給我。</p>'));
  }

  try {
    await setOptOut(email, true);
  } catch (e) {
    console.error('unsub failed:', e && e.message);
    return res.status(500).send(page('暫時無法處理',
      '<h1>暫時無法處理</h1><p>系統出了點問題，請稍後再試，或直接回信給我，我手動處理。</p>'));
  }

  return res.status(200).send(page('已退訂',
    '<h1>已退訂</h1><p>' + email + ' 之後不會再收到行銷信。<br>' +
    '你的帳號與自選清單都還在，工具照常可以使用。<br>' +
    '要連帳號一起刪除的話，回信告訴我。</p>' +
    '<a href="/">回工具集</a>'));
};

module.exports.sigOf = sigOf;
module.exports.isOptedOut = isOptedOut;
module.exports.setOptOut = setOptOut;
