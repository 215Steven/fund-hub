/**
 * 目前身分：方案、是否仍在期限內、剩幾天。
 *
 * 前端每次載入都問一次，因為方案會變——有人今天買課，
 * 手上那張 token 不用換，下一次問就會變成 student。
 */
const { requireUser, emailKey } = require('./_auth');
const { planOf, TRIAL_DAYS, readJson, writeJson } = require('./_plan');

// 記下最後一次使用的時間。一天最多寫一次——每次載入都寫會拖慢回應，
// 而且這個數字只用來判斷「這個人還活著嗎」，不需要精確到分鐘。
const TOUCH_GAP = 12 * 3600 * 1000;

async function touch(email) {
  const p = 'user/' + emailKey(email) + '.json';
  const rec = await readJson(p);
  if (!rec) return;
  const last = Date.parse(rec.lastSeenAt || '') || 0;
  if (Date.now() - last < TOUCH_GAP) return;
  rec.lastSeenAt = new Date().toISOString();
  rec.seenDays = (rec.seenDays || 0) + 1;
  await writeJson(p, rec);
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');

  const u = requireUser(req, res);
  if (!u) return;

  try {
    const p = await planOf(u.e, u.t);
    // 失敗不影響回應，這只是統計用
    try { await touch(u.e); } catch (e) {}
    return res.status(200).json({
      email: p.email,
      name: u.n || '',
      plan: p.plan,
      active: p.active,
      daysLeft: p.daysLeft,
      endsAt: p.endsAt,
      trialDays: TRIAL_DAYS
    });
  } catch (e) {
    // 判定失敗時不要把人鎖在外面，當成還在期限內
    console.error('me failed:', e && e.message);
    return res.status(200).json({
      email: u.e, name: u.n || '', plan: 'trial', active: true,
      daysLeft: null, endsAt: null, trialDays: TRIAL_DAYS, degraded: true
    });
  }
};
