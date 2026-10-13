/**
 * 目前身分：方案、是否仍在期限內、剩幾天。
 *
 * 前端每次載入都問一次，因為方案會變——有人今天買課，
 * 手上那張 token 不用換，下一次問就會變成 student。
 */
const { requireUser } = require('./_auth');
const { planOf, TRIAL_DAYS } = require('./_plan');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');

  const u = requireUser(req, res);
  if (!u) return;

  try {
    const p = await planOf(u.e, u.t);
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
