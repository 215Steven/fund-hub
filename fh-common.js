/* fh-common.js：三支工具頁（vcct／vbct／und）共用的行為補丁。

   原本是七個各自貼在三個檔案裡的 <script>，每次修正都要改三遍，
   幣別那次就是四個檔案各改一次。2026-11-11 搬到這裡，三頁在 </body> 前載入。

   保單代碼一律從網址判斷（/vcct、/embed/vcct 都認得），不再寫死在檔案裡。

   每一段各自包一層 try/catch：原本是獨立的 <script>，一段出錯不影響其他段；
   合成一個檔案之後要自己保留這個隔離，否則前面一段丟出例外，後面全部不會執行。

   段落順序跟原本一樣：fh-refresh 先把「立即更新」按鈕放上去，
   fh-refresh-fix 才能接手它的點擊行為。 */

/* ════════ 共用計時器 ════════
   fh-bt-default、fh-dd-detail、fh-ratios 原本各自 setInterval(apply, 400) 永久輪詢，
   分析視窗沒打開也一直在跑：每秒 7.5 次，三段各自查一次 DOM。
   改成一個共用的 400ms 計時器，分析視窗沒顯示時只做一次 querySelector 就返回。

   為什麼可以這樣擋：三段的 apply 本來就只在視窗顯示時才做事
   （bt-default、dd-detail 開頭都是 offsetParent === null 就 return），
   它們的「換了一檔要重來」是靠 _btState.dates 換了新陣列來判斷，
   不是靠「看到視窗關掉」，所以關著的時候不跑不會漏掉任何重置。

   三段仍各自保留 try/catch，其中一段出錯不會讓另外兩段停擺。 */
var FH_TICK = (function () {
  var fns = [];
  setInterval(function () {
    var m = document.querySelector('.bt-modal');
    if (!m || m.offsetParent === null) return;
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](); } catch (e) { if (window.console) console.error('[fh-common] tick', e); }
    }
  }, 400);
  return { add: function (fn) { fns.push(fn); } };
})();

/* ════════ 原地更新表格 ════════
   直接呼叫頁面自己的 startLoad(true) 重讀伺服器快照、重畫表格，不重載整頁。
   之前「立即更新」是重載頁面，結果重載那一步讀到瀏覽器存的舊回應，按完時間沒跳。
   _quietRefresh 設成 true：不閃進度條；萬一快照讀不到改走逐檔抓取，也不會先清空畫面。
   startLoad 結尾會把排序重設成「配息率由高到低」，這裡把使用者原本的排序放回去。 */
/* expect：伺服器回報的資料時間。剛強制重抓完的幾秒內，儲存端可能還回舊的快照，
   畫面沒換到 expect 就每 3 秒再讀一次，最多 6 次。 */
window.FH_APPLY = function (expect, tries) {
  tries = tries || 0;
  if (typeof window.startLoad !== 'function') return Promise.reject(new Error('no startLoad'));
  var col = window._sortCol, dir = window._sortDir;
  var mc = document.getElementById('ms-col'), md = document.getElementById('ms-dir');
  var mcv = mc ? mc.value : null, mdv = md ? md.value : null;
  var q = window._quietRefresh;
  window._quietRefresh = true;
  return Promise.resolve(window.startLoad(true)).then(function () {
    window._quietRefresh = q;
    if (typeof col === 'number' && col >= 0 && typeof window.sortBy === 'function' &&
        (col !== window._sortCol || dir !== window._sortDir)) {
      window.sortBy(col, dir);
    }
    if (mc && mcv !== null) mc.value = mcv;
    if (md && mdv !== null) md.value = mdv;
  }, function (e) { window._quietRefresh = q; throw e; }).then(function () {
    var s = document.getElementById('st4');
    if (expect && tries < 6 && !(s && s.textContent.indexOf(expect) >= 0)) {
      return new Promise(function (r) { setTimeout(r, 3000); })
        .then(function () { return window.FH_APPLY(expect, tries + 1); });
    }
  });
};

/* ════════ fh-refresh ════════ */
try {
/* 手動更新：回富邦重抓一次，結果寫進共用快照，所以一個人按、所有人都拿到新的。

   為什麼另外做一顆、不直接改原本的「載入配息資料」：
   那顆走的是初次載入同一條路徑，加上 force 會害隨機進站的訪客等十幾秒。
   更新應該是明確的動作，不是副作用。

   /api/data 那邊對 force 設了 30 分鐘下限。剛更新過就按，不會重抓，
   這時回傳的快照年齡會明顯大於 0，用這點判斷要不要重新整理頁面。 */
(function () {
  var CODE = ((location.pathname.match(/(vcct|vbct|und)/i) || [])[1] || '').toUpperCase();
  if (!CODE) return;
  function mount() {
    if (document.getElementById('fh-refresh')) return true;
    var box = [].slice.call(document.querySelectorAll('div[class$="-stat"]'))
      .filter(function (e) { return /最後更新/.test(e.textContent); })[0];
    if (!box) return false;
    var b = document.createElement('button');
    b.id = 'fh-refresh';
    b.type = 'button';
    b.textContent = '立即更新';
    b.title = '回富邦重抓一次。更新後所有人都會看到新資料。';
    b.style.cssText = 'margin-left:8px;min-height:24px;padding:4px 10px;border-radius:8px;' +
      'border:1px solid #c7d7ee;background:#fff;color:#2657a0;font-size:12px;cursor:pointer';
    b.addEventListener('click', function () {
      if (b.disabled) return;
      var old = b.textContent;
      b.disabled = true;
      b.textContent = '更新中…';
      fetch('/api/data?code=' + CODE + '&force=1&t=' + Date.now())
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var ageMin = (Date.now() - (Number(j && j.fetchedAt) || 0)) / 60000;
          if (ageMin > 2) {
            // 沒有真的重抓：剛剛才有人更新過
            b.textContent = '已是最新';
            setTimeout(function () { b.textContent = old; b.disabled = false; }, 2500);
          } else {
            location.reload();
          }
        })
        .catch(function () {
          b.textContent = '更新失敗';
          setTimeout(function () { b.textContent = old; b.disabled = false; }, 2500);
        });
    });
    box.appendChild(b);
    return true;
  }
  if (!mount()) {
    var n = 0, t = setInterval(function () { if (mount() || ++n > 40) clearInterval(t); }, 250);
  }
})();
} catch (e) { if (window.console) console.error('[fh-common] fh-refresh', e); }

/* ════════ fh-bt-default ════════ */
try {
/* fh-bt-default：分析視窗的兩項預設修正。

   ① 有配息的標的，統計卡預設用「含息（再投入）」。
      表格的六個月／一年／三年是含息口徑，但視窗預設停在淨值，
      同一檔基金會在表格顯示 -0.86%、在這裡顯示 -13.49%，差十幾個百分點，
      使用者只會以為壞掉。而且圖上兩條線一直都在，大字卻跟著走勢相反的那條。
      只在開窗時套一次；使用者自己切回淨值之後就不再干涉。

   ② 資料長度不足的區間鈕不顯示。
      資料只有 2.3 年時，3年／4年／5年 按下去跟「全部」結果完全一樣，
      標籤卻讓人以為真的是三年。拿兩檔基金對照時，老基金的「3年」是真三年、
      這檔的「3年」是 2.3 年，兩個數字不能並排比。

   用 setBtMode／setBtRange 這兩個既有入口，不去點 DOM——直接點按鈕會跟頁面
   自己的重繪互相打架。判斷長度要用 _btState.dates（完整序列），不能用畫面上的
   「資料區間」，那一行已經被目前選取的範圍裁過了。 */
(function () {
  var seen = null;      // 上次處理的 dates 參考，用來辨識新開的視窗
  var modeDone = false; // 本次開窗是否已自動切過一次含息

  function apply() {
    var m = document.querySelector('.bt-modal');
    if (!m || m.offsetParent === null) return;
    var st = window._btState;
    if (!st || !st.dates || st.dates.length < 2) return;

    if (st.dates !== seen) { seen = st.dates; modeDone = false; }

    var yrs = (Date.parse(st.dates[st.dates.length - 1]) - Date.parse(st.dates[0])) / (365.25 * 86400000);
    var needReset = false;
    [].slice.call(m.querySelectorAll('.bt-range-btn')).forEach(function (b) {
      var n = Number((b.textContent.trim().match(/^(\d+)年$/) || [])[1]);
      if (!n || n <= yrs + 0.02) return;
      if (b.style.display !== 'none') {
        b.style.display = 'none';
        if (b.classList.contains('active')) needReset = true;
      }
    });
    if (needReset && typeof setBtRange === 'function') setBtRange(null);

    if (!modeDone && st.adjNavs && st.mode === 'raw' && typeof setBtMode === 'function') {
      modeDone = true;
      setBtMode('adj');
    }
  }
  // 用輪詢而不是只靠 MutationObserver：資料載入完成時不一定還有 DOM 變動，
  // 只掛觀察器會錯過最後一次狀態更新。整段是冪等的，重複跑沒有副作用。
  if (window.FH_TICK) FH_TICK.add(apply); else setInterval(apply, 400);
})();
} catch (e) { if (window.console) console.error('[fh-common] fh-bt-default', e); }

/* ════════ fh-dd-detail ════════ */
try {
/* fh-dd-detail：最大回撤補上「跌多久、多久回本、哪一段」。

   原本這些資訊只出現在走勢圖圖例的小字裡（「最大回撤：下跌 75 天，回本 80 天」），
   統計卡上只有 -21.73% 這個深度。但對要抱著的人來說，
   跌多久、會不會回得來，比跌多深更需要先看到。

   自己從 _btState 重算而不是去剖析圖例文字：圖例沒有日期，只有天數。
   重算的深度與天數已逐一比對過圖例，三種情境（含息已回本／淨值未回本／
   一年區間未回本）都完全一致。

   用畫面上的「資料區間」定位索引，因為那一行已經反映目前選取的範圍；
   模式切換時 adjNavs/rawNavs 也會跟著換，所以每次輪詢都重算。 */
(function () {
  function sh(s) { return s.slice(2); }   // 2025-01-23 → 25-01-23
  function apply() {
    var m = document.querySelector('.bt-modal');
    if (!m || m.offsetParent === null) return;
    var st = window._btState;
    if (!st || !st.dates || !st.dates.length) return;
    var all = st.mode === 'adj' ? st.adjNavs : st.rawNavs;
    if (!all || all.length !== st.dates.length) return;

    var txt = m.textContent.replace(/\s+/g, ' ');
    var r = txt.match(/資料區間：([\d-]+) ～ ([\d-]+)/);
    if (!r) return;
    var a = st.dates.indexOf(r[1]), b = st.dates.indexOf(r[2]);
    if (a < 0 || b <= a) return;

    var navs = all.slice(a, b + 1), ds = st.dates.slice(a, b + 1);
    var peak = navs[0], pi = 0, bd = 0, bpi = 0, bti = 0;
    for (var i = 0; i < navs.length; i++) {
      if (navs[i] > peak) { peak = navs[i]; pi = i; }
      var dd = (navs[i] - peak) / peak;
      if (dd < bd) { bd = dd; bpi = pi; bti = i; }
    }
    if (!(bd < 0)) return;

    var ri = -1;
    for (var k = bti; k < navs.length; k++) { if (navs[k] >= navs[bpi]) { ri = k; break; } }
    var day = function (x, y) { return Math.round((Date.parse(y) - Date.parse(x)) / 86400000); };
    var l1 = ri >= 0
      ? '跌 ' + day(ds[bpi], ds[bti]) + ' 天 · 回本 ' + day(ds[bti], ds[ri]) + ' 天'
      : '跌 ' + day(ds[bpi], ds[bti]) + ' 天 · 尚未回本';
    var l2 = ri >= 0
      ? sh(ds[bpi]) + ' → ' + sh(ds[ri])
      : sh(ds[bpi]) + ' → 低點 ' + sh(ds[bti]);

    var card = null, cs = m.querySelectorAll('.bt-stat');
    for (var j = 0; j < cs.length; j++) {
      var lab = cs[j].querySelector('.bt-stat-label');
      if (lab && /最大回撤/.test(lab.textContent)) { card = cs[j]; break; }
    }
    if (!card) return;

    var sub = card.querySelector('.fh-dd');
    if (!sub) {
      sub = document.createElement('div');
      sub.className = 'fh-dd';
      sub.style.cssText = 'margin-top:3px;font-size:10.5px;line-height:1.45;' +
        'color:#64748b;white-space:nowrap';
      card.appendChild(sub);
    }
    var h = l1 + '<br>' + l2;
    if (sub.innerHTML !== h) sub.innerHTML = h;
  }
  if (window.FH_TICK) FH_TICK.add(apply); else setInterval(apply, 400);
})();
} catch (e) { if (window.console) console.error('[fh-common] fh-dd-detail', e); }

/* ════════ fh-ratios ════════ */
try {
/* fh-ratios：在夏普旁邊補上索提諾與 Calmar。

   三個比率回答不同問題：
     夏普    每承擔一單位「總波動」換到多少報酬
     索提諾  每承擔一單位「下跌波動」換到多少（上漲不罰）
     Calmar  每承擔一單位「最深的那次跌幅」換到多少
   Calmar 的分母只來自單一事件，換個區間可能差很多，別拿它單獨下結論。

   口徑刻意跟站上現有的夏普完全一致：分子用同一個幾何年化報酬，
   分母用日報酬年化。這樣三個數字可以並排比較，也跟畫面上的夏普對得起來。

   MAR（索提諾的門檻）設 0，因為站上夏普的無風險利率也是 0，
   兩者才站在同一條基準線。注意 MAR=0 且 rf=0 時索提諾必定大於夏普，
   那是數學必然，不代表這檔特別好。

   會跟著含息／淨值切換走。配息型標的用淨值序列算，索提諾會嚴重失真
   （每月除息製造假下跌，而索提諾只罰下跌），所以預設已經是含息。 */
(function () {
  function series() {
    var scope = document.querySelector('.bt-modal') || document.body;
    var txt = scope.textContent.replace(/\s+/g, ' ');
    var rg = txt.match(/資料區間[：:]\s*([\d-]+)\s*[～~]\s*([\d-]+)/);
    if (!rg) return null;
    var bs = window._btState, ps = window._pfState;
    if (bs && bs.dates && bs.rawNavs) {
      var a = bs.dates.indexOf(rg[1]), b = bs.dates.indexOf(rg[2]);
      if (a < 0 || b <= a) return null;
      var s = (bs.mode === 'adj' && bs.adjNavs) ? bs.adjNavs : bs.rawNavs;
      return s.slice(a, b + 1);
    }
    if (ps && ps.dates && ps.funds && ps.funds.length) {
      var a2 = ps.dates.indexOf(rg[1]), b2 = ps.dates.indexOf(rg[2]);
      if (a2 < 0 || b2 <= a2) return null;
      var out = [];
      for (var i = a2; i <= b2; i++) {
        var v = 0, ok = true;
        for (var j = 0; j < ps.funds.length; j++) {
          var fd = ps.funds[j];
          var sj = (ps.mode === 'adj' && fd.filledAdj) ? fd.filledAdj : fd.filledRaw;
          if (!(sj[a2] > 0) || !(sj[i] > 0)) { ok = false; break; }
          v += fd.wNorm * (sj[i] / sj[a2]);
        }
        if (!ok) return null;
        out.push(v);
      }
      return out;
    }
    return null;
  }
  function mk(id, label, note) {
    var c = document.createElement('div');
    c.className = 'bt-stat'; c.setAttribute('data-fh', id);
    c.innerHTML = '<div class="bt-stat-label">' + label +
      '</div><div class="bt-stat-val"></div>' +
      '<div style="margin-top:3px;font-size:10.5px;line-height:1.45;color:#64748b">' + note + '</div>';
    return c;
  }
  function apply() {
    var scope = document.querySelector('.bt-modal') || document;
    var sharpe = null, grid = null, cs = scope.querySelectorAll('.bt-stat');
    for (var i = 0; i < cs.length; i++) {
      var l = cs[i].querySelector('.bt-stat-label');
      if (l && /夏普比率/.test(l.textContent)) { sharpe = cs[i]; grid = cs[i].parentElement; break; }
    }
    if (!sharpe || !grid) return;
    var txt = scope.textContent.replace(/\s+/g, ' ');
    var num = function (lab) {
      var x = txt.match(new RegExp(lab + '\\s*([+\\-]?[\\d.]+)'));
      return x ? parseFloat(x[1]) : null;
    };
    var ann = num('年化報酬'), dd = num('最大回撤');
    if (ann == null || dd == null) return;
    dd = Math.abs(dd);
    var s = series();
    if (!s || s.length < 30) return;
    var sum = 0, n = 0;
    for (var k = 1; k < s.length; k++) {
      if (!(s[k - 1] > 0) || !(s[k] > 0)) continue;
      var r = s[k] / s[k - 1] - 1;
      if (r < 0) sum += r * r;   // MAR = 0：只累計虧損的期間
      n++;
    }
    if (!n) return;
    var dsd = Math.sqrt(sum / n) * Math.sqrt(252) * 100;
    var c1 = grid.querySelector('[data-fh=sortino]');
    if (!c1) { c1 = mk('sortino', '索提諾比率', 'MAR 0%'); sharpe.insertAdjacentElement('afterend', c1); }
    var c2 = grid.querySelector('[data-fh=calmar]');
    if (!c2) { c2 = mk('calmar', 'Calmar 比率', '年化 ÷ 最大回撤'); c1.insertAdjacentElement('afterend', c2); }
    var set = function (card, v) {
      var el = card.querySelector('.bt-stat-val');
      var s2 = (v == null || !isFinite(v)) ? '—' : v.toFixed(2);
      if (el.textContent !== s2) el.textContent = s2;
    };
    set(c1, dsd > 0 ? ann / dsd : null);
    set(c2, dd > 0 ? ann / dd : null);
  }
  if (window.FH_TICK) FH_TICK.add(apply); else setInterval(apply, 400);
})();
} catch (e) { if (window.console) console.error('[fh-common] fh-ratios', e); }

/* ════════ fh-refresh-fix ════════ */
try {
(function () {
  /* fh-refresh-fix：讓「立即更新」真的看得出有沒有更新。

     原本的問題：按鈕確實叫伺服器重抓了（快照時間會變新），
     但頁面自己在 localStorage 存了一份快取，到期時間是「下一個台灣中午 12 點」。
     所以 location.reload() 之後又讀回同一份舊資料，畫面上的「最後更新」完全沒動，
     使用者只看到按鈕轉一下就恢復原狀，根本不知道成功了沒有。

     修法兩件事：
       1. 重抓成功後先清掉這一頁自己的 localStorage 快取，再重載，畫面才會換成新的。
          順便會把舊版本的 key（例如 -v2）一起清掉。
       2. 重載後顯示一行結果（已更新到幾點／失敗），六秒後淡出。
          訊息靠 sessionStorage 傳遞，因為中間隔了一次 reload。
  */
  var CODE = (location.pathname.match(/(vcct|vbct|und)/i) || [])[1];
  if (!CODE) return;
  CODE = CODE.toUpperCase();
  var PRE = CODE.toLowerCase() + '-v';
  var FLAG = 'fh-refresh-result';

  function chip() {
    var all = [].slice.call(document.querySelectorAll('div[class$="-stat"]'));
    for (var i = 0; i < all.length; i++) if (/最後更新/.test(all[i].textContent)) return all[i];
    return null;
  }

  /* 訊息做成浮動的 toast，不放進統計卡裡面。
     放進卡裡會把那一列撐寬，手機版量到 121px 的橫向溢出。
     fixed + max-width 以 vw 為準，寬度不可能影響版面。 */
  function msg(text, color) {
    var old = document.querySelector('[data-fh-msg]'); if (old) old.parentNode.removeChild(old);
    var s = document.createElement('div');
    s.setAttribute('data-fh-msg', '1');
    s.textContent = text;
    s.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
      'max-width:calc(100vw - 28px);box-sizing:border-box;z-index:99999;' +
      'padding:9px 15px;border-radius:10px;background:#fff;border:1px solid #d8e3f2;' +
      'box-shadow:0 2px 10px rgba(20,45,80,.14);font-size:13px;line-height:1.5;' +
      'text-align:center;transition:opacity .6s;color:' + color;
    document.body.appendChild(s);
    setTimeout(function () { s.style.opacity = '0'; }, 6000);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 6800);
  }
  function clearLocal() {
    try {
      var kill = [], i, k;
      for (i = 0; i < localStorage.length; i++) { k = localStorage.key(i); if (k && k.indexOf(PRE) === 0) kill.push(k); }
      for (i = 0; i < kill.length; i++) localStorage.removeItem(kill[i]);
      return kill;
    } catch (e) { return []; }
  }

  /* reload 之後把結果講出來 */
  try {
    var done = sessionStorage.getItem(FLAG);
    if (done !== null) {
      sessionStorage.removeItem(FLAG);
      if (done.indexOf('!') === 0) msg('更新失敗：' + done.slice(1), '#c0392b');
      else msg('已更新 · 資料時間 ' + done, '#1e8449');
    }
  } catch (e) {}

  /* 換掉按鈕的 click handler（clone 會丟掉舊的 listener） */
  function hijack() {
    var box = chip(); if (!box) return false;
    var b = box.querySelector('button');
    if (!b || b.getAttribute('data-fh-fixed')) return !!b;
    var nb = b.cloneNode(true);
    nb.setAttribute('data-fh-fixed', '1');
    nb.disabled = false;
    nb.textContent = '立即更新';
    b.parentNode.replaceChild(nb, b);
    nb.addEventListener('click', function () {
      if (nb.disabled) return;
      nb.disabled = true; nb.textContent = '更新中…';
      msg('正在重新抓取，約需十幾秒…', '#5b6b7f');
      fetch('/api/data?code=' + CODE + '&force=1&_cb=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          var at = j && j.savedAt ? String(j.savedAt) : '';
          // 原地重畫，按完畫面立刻是新的時間；不行才退回舊做法（清快取＋重載）
          var shownEl = document.getElementById('st4');
          var same = !!(at && shownEl && shownEl.textContent.indexOf(at) >= 0);
          var fallback = function () {
            clearLocal();
            try { sessionStorage.setItem(FLAG, at); } catch (e) {}
            location.reload();
          };
          if (typeof window.FH_APPLY !== 'function') return fallback();
          window.FH_APPLY(at).then(function () {
            nb.disabled = false; nb.textContent = '立即更新';
            msg(same ? '目前已是最新資料 · 資料時間 ' + at : '已更新 · 資料時間 ' + at, '#1e8449');
          }, fallback);
        })
        .catch(function (e) {
          nb.disabled = false; nb.textContent = '立即更新';
          msg('更新失敗，請稍後再試（' + (e && e.message ? e.message : '連線問題') + '）', '#c0392b');
        });
    });
    return true;
  }
  var tries = 0;
  var iv = setInterval(function () { if (hijack() || ++tries > 40) clearInterval(iv); }, 300);
  hijack();
})();
} catch (e) { if (window.console) console.error('[fh-common] fh-refresh-fix', e); }

/* ════════ fh-cur-fix ════════ */
try {
(function () {
  /* fh-cur-fix：幣別選「台幣」永遠 0 筆。

     資料裡的字串是「新臺幣」（臺），下拉選單的 value 卻寫「台幣」（台），
     比對是精確相等，所以永遠對不上 —— 而三張保單各有 50 檔左右是新臺幣計價，
     等於有五十幾檔用幣別篩不出來。美元、澳幣、日圓都沒事，就差這一個字。

     順便：選單是寫死的，裡面有些幣別該保單根本沒有（VCCT 沒有南非幣），
     選了就是 0 筆的死選項；組合試算那邊則反過來，只有台幣與美元兩個選項，
     澳幣、歐元、日圓、紐幣根本選不到。改成照實際資料重建，有什麼才列什麼。

     做法：option 的 value 用資料裡的原字串，顯示文字用口語的「台幣」。
     這樣原本的精確比對不用動，只是餵給它對的值。
  */
  var LABEL = { '新臺幣': '台幣', '新台幣': '台幣' };

  function dataRows() {
    if (Array.isArray(window._fundUniverse) && window._fundUniverse.length) return window._fundUniverse;
    for (var k in window) {
      try {
        var v = window[k];
        if (/_ROWS$/.test(k) && Array.isArray(v) && v.length && v[0] && ('cur' in v[0])) return v;
      } catch (e) {}
    }
    return null;
  }

  function fix(sel) {
    if (!sel || sel.getAttribute('data-fh-cur')) return;
    var data = dataRows();
    if (!data || !data.length) return;
    var seen = [], i, c;
    for (i = 0; i < data.length; i++) {
      c = data[i] && data[i].cur;
      if (c && seen.indexOf(c) < 0) seen.push(c);
    }
    if (!seen.length) return;

    var ntd = [], usd = [], rest = [];
    seen.forEach(function (x) {
      if ((LABEL[x] || x) === '台幣') ntd.push(x);
      else if (x === '美元') usd.push(x);
      else rest.push(x);
    });
    var list = ntd.concat(usd, rest);

    /* 第一個選項的字各頁不一樣（工具頁是「全部」，組合試算是「不限」），照抄原本的 */
    var keepText = sel.options.length ? sel.options[0].textContent : '全部';
    var old = sel.value;
    sel.innerHTML = '';
    var o0 = document.createElement('option');
    o0.value = ''; o0.textContent = keepText;
    sel.appendChild(o0);
    list.forEach(function (x) {
      var o = document.createElement('option');
      o.value = x; o.textContent = LABEL[x] || x;
      sel.appendChild(o);
    });

    if (old) {
      var want = (old === '台幣' || old === '新台幣') ? (ntd[0] || '') : old;
      if (list.indexOf(want) >= 0) {
        sel.value = want;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    sel.setAttribute('data-fh-cur', '1');
  }

  var tries = 0;
  var iv = setInterval(function () {
    fix(document.getElementById('ffc'));
    fix(document.getElementById('pf-f-cur'));
    if (++tries > 60) clearInterval(iv);
  }, 500);
})();
} catch (e) { if (window.console) console.error('[fh-common] fh-cur-fix', e); }

/* ════════ fh-pm-refresh ════════ */
try {
(function () {
  /* 自動更新：頁面開著時自己去問伺服器有沒有更新的快照，有就原地換上，不用按。
     ・載入 2.5 秒後問一次，之後每 10 分鐘、以及切回這個分頁時再問。
     ・伺服器在 12:30～21:00 發現快照太舊，會先回舊的、背景重抓（約 15 秒）；
       這段期間「最後更新」後面顯示「・更新中…」，每 8 秒問一次，新的一到就自動換上。
     ・分析視窗開著時先不換，等關掉再換，避免看到一半後面的表格在動。
     判斷「太舊」的規則要跟 api/data.js 的 afternoonStale 一致。 */
  var CODE = ((location.pathname.match(/(vcct|vbct|und)/i) || [])[1] || '').toUpperCase();
  if (!CODE) return;
  function stale(fa, now) {
    var tw = new Date(now + 8 * 3600000);
    var mins = tw.getUTCHours() * 60 + tw.getUTCMinutes();
    if (mins < 12 * 60 + 30 || mins >= 21 * 60) return false;
    var cut = Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate(), 12, 30) - 8 * 3600000;
    return fa < cut || now - fa > 2 * 3600000;
  }
  function ask() {
    return fetch('/api/data?code=' + CODE + '&_cb=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }
  function st4() { return document.getElementById('st4'); }
  function ready() {
    var e = st4();
    return !!(e && /\d{1,2}\/\d{1,2}/.test(e.textContent) && e.textContent.indexOf('更新中') < 0);
  }
  function shownHas(s) { var e = st4(); return !!(e && s && e.textContent.indexOf(s) >= 0); }
  function setBusy(on) {
    var e = st4(); if (!e) return;
    var s = e.querySelector('[data-fh-busy]');
    if (on && !s) {
      s = document.createElement('span');
      s.setAttribute('data-fh-busy', '1');
      s.textContent = '・更新中…';
      s.style.cssText = 'color:#b7791f;margin-left:2px';
      e.appendChild(s);
    }
    if (!on && s) s.parentNode.removeChild(s);
  }
  function modalOpen() { var m = document.querySelector('.bt-modal'); return !!(m && m.offsetParent !== null); }
  function toast(text) {
    var old = document.querySelector('[data-fh-msg]'); if (old) old.parentNode.removeChild(old);
    var s = document.createElement('div');
    s.setAttribute('data-fh-msg', '1');
    s.textContent = text;
    s.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
      'max-width:calc(100vw - 28px);box-sizing:border-box;z-index:99999;' +
      'padding:9px 15px;border-radius:10px;background:#fff;border:1px solid #d8e3f2;' +
      'box-shadow:0 2px 10px rgba(20,45,80,.14);font-size:13px;line-height:1.5;' +
      'text-align:center;transition:opacity .6s;color:#1e8449';
    document.body.appendChild(s);
    setTimeout(function () { s.style.opacity = '0'; }, 5000);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 5800);
  }
  var busy = false;
  function apply(savedAt) {
    if (modalOpen() || !ready()) { setTimeout(function () { apply(savedAt); }, 2000); return; }
    if (typeof window.FH_APPLY !== 'function') return;
    window.FH_APPLY(savedAt).then(function () {
      toast('已自動更新為最新淨值 · 資料時間 ' + savedAt);
    }, function () {});
  }
  function check() {
    if (busy) return;
    if (!ready()) { setTimeout(check, 2000); return; }
    ask().then(function (j) {
      if (!j || !j.savedAt) return;
      if (!shownHas(j.savedAt)) { apply(j.savedAt); return; }
      var fa = Number(j.fetchedAt) || 0;
      if (!fa || !stale(fa, Date.now())) return;
      busy = true; setBusy(true);
      var n = 0;
      var iv = setInterval(function () {
        if (++n > 8) { clearInterval(iv); busy = false; setBusy(false); return; }
        ask().then(function (k) {
          if (k && k.savedAt && Number(k.fetchedAt) > fa) {
            clearInterval(iv); busy = false; setBusy(false); apply(k.savedAt);
          }
        }).catch(function () {});
      }, 8000);
    }).catch(function () {});
  }
  setTimeout(check, 2500);
  setInterval(function () { if (document.visibilityState !== 'hidden') check(); }, 10 * 60000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
})();
} catch (e) { if (window.console) console.error('[fh-common] fh-pm-refresh', e); }
