/**
 * 贊助回報：使用者匯款後自己回報，等管理端對帳確認。
 *
 * 信箱不從表單拿，一律用 token 裡的身分，所以不會出現
 * 「報名填一個、登入用另一個」這種對不起來的狀況。
 * 這裡只記錄回報，不會自動開通——開通是對帳之後的人工動作。
 */
const { requireUser, emailKey } = require('./_auth');
const { planOf, readJson, writeJson } = require('./_plan');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');

  const user = requireUser(req, res);
  if (!user) return;

  const path = 'orders/' + emailKey(user.e) + '.json';

  try {
    if (req.method === 'GET') {
      const cur = await readJson(path);
      const p = await planOf(user.e, user.t);
      return res.status(200).json({ order: cur || null, plan: p.plan, active: p.active });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};

      const amount = Math.round(Number(body.amount) || 0);
      const last5 = String(body.last5 || '').replace(/\D/g, '').slice(0, 5);
      const note = String(body.note || '').slice(0, 200);

      if (!(amount > 0 && amount <= 100000)) {
        return res.status(400).json({ error: '金額不正確' });
      }
      if (last5.length < 4) {
        return res.status(400).json({ error: '請填匯款帳號末 5 碼' });
      }

      const prev = await readJson(path);
      const rec = {
        email: user.e,
        name: user.n || '',
        amount: amount,
        last5: last5,
        note: note,
        status: 'pending',
        at: new Date().toISOString(),
        // 重複回報就覆蓋，但留著第一次的時間方便你看他等多久了
        firstAt: (prev && prev.firstAt) || new Date().toISOString()
      };
      await writeJson(path, rec);
      return res.status(200).json({ ok: true, order: rec });
    }

    return res.status(405).json({ error: 'method' });
  } catch (e) {
    console.error('order failed:', e && e.message);
    return res.status(500).json({ error: '回報沒有存成功，請再試一次或直接寫信給我' });
  }
};
