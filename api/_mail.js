/**
 * 寄信。走 Resend 的 REST API，不裝 SDK。
 *
 * 沒設 RESEND_API_KEY 就整條靜默跳過並回報 skipped，
 * 這樣排程在你還沒申請寄信服務之前也不會噴錯。
 *
 * 每封信都必須帶退訂連結——這不是禮貌問題，是個資法 §20 的要求。
 */
const { normEmail } = require('./_auth');
const { sigOf } = require('./unsub');

const FROM = process.env.MAIL_FROM || '';
const SITE = process.env.SITE_URL || 'https://fund-hub-navy.vercel.app';
const REPLY_TO = process.env.MAIL_REPLY_TO || '';

function unsubUrl(email) {
  const e = normEmail(email);
  return SITE + '/api/unsub?e=' + encodeURIComponent(e) + '&s=' + sigOf(e);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 把內文包成完整信件，頁尾自動補上退訂連結
function wrap(bodyHtml, email) {
  const u = unsubUrl(email);
  const font = "-apple-system,BlinkMacSystemFont,'Noto Sans TC','PingFang TC',sans-serif";
  return '<div style="max-width:520px;margin:0 auto;padding:24px;color:#1f2a37;line-height:1.8;font-family:' + font + '">' +
    bodyHtml +
    '<hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 14px">' +
    '<p style="color:#94a3b8;font-size:12px;line-height:1.7;margin:0">' +
    '你會收到這封信，是因為你在基金配息率工具集開通過帳號。<br>' +
    '本信僅供參考，不構成投資建議。<br>' +
    '<a href="' + u + '" style="color:#94a3b8">不想再收到這類信件</a>' +
    '</p></div>';
}

async function sendMail(to, subject, bodyHtml) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !FROM) return { skipped: true, reason: 'mail not configured' };

  const payload = {
    from: FROM,
    to: [normEmail(to)],
    subject: subject,
    html: wrap(bodyHtml, to),
    headers: { 'List-Unsubscribe': '<' + unsubUrl(to) + '>' }
  };
  if (REPLY_TO) payload.reply_to = REPLY_TO;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error((j && (j.message || j.name)) || ('resend ' + r.status));
  return { id: j.id || null };
}

module.exports = { sendMail, unsubUrl, wrap, esc, SITE };
