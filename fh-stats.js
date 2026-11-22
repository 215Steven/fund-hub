/* 波動度、夏普、索提諾：全站共用同一套算法（分析視窗、組合試算、標的比較）。
   算法跟富邦官網「風險報酬」頁一致，已用 MLE24、JFP11、JFP7、ABB3、FRB18、DSP7 對過：

     1. 用「月報酬」，不是日報酬。從序列最後一天往回，每個月取同一天
        （例如最後一天是 11/20，就取每月 20 日；當天沒有淨值就取之前最近的一天）。
     2. 年化標準差 ＝ 月報酬的樣本標準差 × √12
     3. 夏普 ＝（月平均報酬 − 無風險利率 ÷ 12）÷ 月標準差，不年化
        國際上常見的「年化夏普」約為這個數字 × √12（約 3.46 倍），排名完全相同。
     4. 索提諾 ＝（月平均報酬 − 無風險利率 ÷ 12）÷ 月下方標準差，不年化，
        門檻同樣用無風險利率，跟夏普站在同一條基準線上。

   無風險利率富邦沒有公開，用 MLE24 歷年數字反推約年 1%，這裡固定用 1%。
   少於 2 筆月報酬（區間不滿 2 個月）時不算，畫面顯示「—」。 */
(function () {
  var RF = 1; // 年化無風險利率（%）

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { d = String(d); return d.length === 8 && d.indexOf('-') < 0 ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : d.slice(0, 10); }
  function lastLE(arr, d) {
    var lo = 0, hi = arr.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (arr[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }

  function monthly(dates, vals, rf) {
    rf = rf == null ? RF : rf;
    var n = dates && vals ? Math.min(dates.length, vals.length) : 0;
    if (n < 2) return null;
    var ds = [];
    for (var i = 0; i < n; i++) ds.push(iso(dates[i]));
    var end = ds[n - 1], y = +end.slice(0, 4), m = +end.slice(5, 7), day = end.slice(8, 10);
    var pts = [];
    for (var k = 0; k < 1200; k++) {
      var yy = y, mm = m - k;
      while (mm <= 0) { mm += 12; yy--; }
      var target = yy + '-' + pad(mm) + '-' + day;
      if (target < ds[0]) break;
      var j = lastLE(ds, target);
      if (j < 0) break;
      pts.unshift(vals[j]);
    }
    var r = [];
    for (i = 1; i < pts.length; i++) if (pts[i - 1] > 0 && pts[i] > 0) r.push(pts[i] / pts[i - 1] - 1);
    if (r.length < 2) return { n: r.length, vol: null, sharpe: null, sortino: null };
    var mean = r.reduce(function (s, x) { return s + x; }, 0) / r.length;
    var sd = Math.sqrt(r.reduce(function (s, x) { return s + (x - mean) * (x - mean); }, 0) / (r.length - 1));
    var rfm = rf / 1200;
    var down = Math.sqrt(r.reduce(function (s, x) { var e = Math.min(x - rfm, 0); return s + e * e; }, 0) / r.length);
    return {
      n: r.length,
      vol: sd * Math.sqrt(12) * 100,
      sharpe: sd > 0 ? (mean - rfm) / sd : null,
      sortino: down > 0 ? (mean - rfm) / down : null
    };
  }

  // 分析視窗、組合試算的 computeStats 改用月報酬算法。
  // 頁面原本的函式照跑（報酬、回撤等都不動），只換掉波動度與夏普，
  // 並把這次的結果記下來，讓補上索提諾的那段程式拿去用。
  var recent = [];
  function remember(cagr, mdd, m) {
    recent.push({ cagr: cagr, mdd: mdd, m: m });
    if (recent.length > 30) recent.shift();
  }
  function find(cagr, mdd) {
    for (var i = recent.length - 1; i >= 0; i--) {
      var x = recent[i];
      if (Math.abs(x.cagr - cagr) < 0.06 && Math.abs(Math.abs(x.mdd) - Math.abs(mdd)) < 0.06) return x.m;
    }
    return null;
  }
  var NOTES = {
    '年化波動度': '月報酬年化，同富邦',
    '夏普比率': '月報酬、扣 ' + RF + '% 無風險，未年化，同富邦'
  };
  function annotate() {
    var cs = document.querySelectorAll('.bt-stat');
    for (var i = 0; i < cs.length; i++) {
      var l = cs[i].querySelector('.bt-stat-label');
      var t = l && NOTES[l.textContent.trim()];
      if (!t || cs[i].querySelector('[data-fh-note]')) continue;
      var d = document.createElement('div');
      d.setAttribute('data-fh-note', '1');
      d.style.cssText = 'margin-top:3px;font-size:10.5px;line-height:1.45;color:#64748b';
      d.textContent = t;
      cs[i].appendChild(d);
    }
  }
  function patch() {
    var orig = window.computeStats;
    if (typeof orig !== 'function' || orig.__fh) return;
    var w = function (dates, navs) {
      var s = orig.apply(this, arguments);
      if (s && dates && navs) {
        var m = monthly(dates, navs);
        if (m) {
          if (m.vol != null) s.annVol = m.vol;
          s.sharpe = m.sharpe;
          s.sortinoM = m.sortino;
          s.monthsN = m.n;
          remember(s.cagr, s.mdd, m);
        }
        setTimeout(annotate, 0);
      }
      return s;
    };
    w.__fh = true;
    window.computeStats = w;
  }

  /* ── 含息序列：配息放在「發放日」再投入 ──
     各頁原本的 mapDivToIndex 把每個月的配息放在「該月最後一個交易日」。
     月中除息的基金（例如 JFP11 每月 7～11 日除息），除息後到月底那兩三週，
     含息線會先出現一段假的下跌、月底才補回來：波動度被高估、區間報酬也會偏掉
     （JFP11 近一年含息報酬算成 +7.10%，實際是 +6.0%，富邦公布 +6.05%）。
     改成用每筆配息的發放日，找當天或之後第一個有淨值的交易日放上去，
     跟富邦公布的含息報酬、標準差、夏普同一個算法。
     配息資料只有月份（舊資料）時，才退回原本「該月最後一個交易日」的做法。 */
  function firstGE(arr, d) {
    var lo = 0, hi = arr.length - 1, ans = arr.length;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (arr[mid] >= d) { ans = mid; hi = mid - 1; } else lo = mid + 1; }
    return ans;
  }
  function mapDivToIndex(dates, divs) {
    if (!divs || !divs.length || !dates || !dates.length) return null;
    var ds = dates.map(iso), out = {}, matched = 0, monthLast = null;
    divs.forEach(function (d) {
      if (!d || !(d.amount > 0)) return;
      var day = String(d.pay || d.ex || d.date || '').replace(/\//g, '-');
      if (day.length >= 10) {
        day = day.slice(0, 10);
        if (day <= ds[0] || day > ds[ds.length - 1]) return;
        var i = firstGE(ds, day);
        out[i] = (out[i] || 0) + d.amount; matched++;
      } else if (day.length >= 7) {
        if (!monthLast) { monthLast = {}; ds.forEach(function (x, k) { monthLast[x.slice(0, 7)] = k; }); }
        var k = monthLast[day.slice(0, 7)];
        if (k != null) { out[k] = (out[k] || 0) + d.amount; matched++; }
      }
    });
    return matched ? out : null;
  }
  // 工具頁的 buildAdjustedNav 用 淨值 ÷（淨值 − 配息），把除息後的淨值當成除息前，
  // 每次多算一點點；改成標準的（淨值 + 配息）÷ 淨值。組合試算那支本來就是這個算法，不動它。
  function buildAdjustedNav(dates, navs, divOnIdx) {
    if (!divOnIdx) return null;
    var out = new Array(navs.length), mult = 1;
    for (var i = 0; i < navs.length; i++) {
      var d = Number(divOnIdx[i]) || 0;
      if (d > 0 && navs[i] > 0) mult *= (navs[i] + d) / navs[i];
      out[i] = navs[i] * mult;
    }
    return out;
  }
  function patchDivs() {
    if (typeof window.mapDivToIndex === 'function' && !window.mapDivToIndex.__fh) {
      mapDivToIndex.__fh = true; window.mapDivToIndex = mapDivToIndex;
    }
    var b = window.buildAdjustedNav;
    if (typeof b === 'function' && !b.__fh && /mult/.test(String(b))) {
      buildAdjustedNav.__fh = true; window.buildAdjustedNav = buildAdjustedNav;
    }
  }

  window.FH_STATS = { RF: RF, monthly: monthly, find: find, remember: remember, patch: patch, annotate: annotate,
                     mapDivToIndex: mapDivToIndex, buildAdjustedNav: buildAdjustedNav };
  patch();
  patchDivs();
})();
