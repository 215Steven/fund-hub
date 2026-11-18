/* 配息變動的判斷規則：首頁「配息變動」與三個工具頁配息欄共用這一份。
   改規則只改這裡，兩邊就會一致。

   FH_DIV.verdict(divs) 回傳 null（不用列）或 { kind, pct, to, from }：
     jump   單次變動：這次增減 TH% 以上；配息本來就忽高忽低的，要超過平常變動的 2 倍
     fixed  固定配息調整：前 3 期配息都一樣，這次調整 TH% 以上（不套用 2 倍）
     trend  連續 2 期：這次不到 TH%，但兩期同方向、跟兩期前比合計 TH% 以上；
            平常變動只看這兩期以前，同樣要超過 2 倍
     trend3 連續 3 期：三期都沒有反向（中間可持平）、這次也有動，合計 TH% 以上（不套用 2 倍）
   相鄰的一期用除息日判斷（相隔 20～45 天），中間漏一期就不往前比。
   divs 由新到舊排列：[{ date:'YYYY-MM', ex:'YYYY-MM-DD', amount }, ...] */
(function () {
  var TH = 5;
  function mi(s) { var p = String(s).split('-'); return (+p[0]) * 12 + (+p[1]); }
  function adj(a, b) {
    if (a.ex && b.ex) { var g = (Date.parse(a.ex) - Date.parse(b.ex)) / 86400000; return g >= 20 && g <= 45; }
    return mi(a.date) - mi(b.date) === 1;
  }
  function pc(a, b) { return (a.amount - b.amount) / b.amount * 100; }
  function median(arr) {
    if (arr.length < 2) return 0;
    var s = arr.map(Math.abs).sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  }

  function verdict(d, th) {
    th = th || TH;
    if (!d || d.length < 2) return null;
    var ch = [];
    for (var i = 0; i < d.length - 1; i++) {
      if (!adj(d[i], d[i + 1]) || !(d[i + 1].amount > 0)) break;
      ch.push(pc(d[i], d[i + 1]));
    }
    if (!ch.length) return null;
    var c0 = ch[0], prev = ch.slice(1);

    var flat = prev.length >= 2 && Math.abs(prev[0]) < 0.01 && Math.abs(prev[1]) < 0.01;
    if (flat && Math.abs(c0) >= th) return { kind: 'fixed', pct: c0, to: d[0], from: d[1] };

    if (Math.abs(c0) >= Math.max(th, 2 * median(prev))) return { kind: 'jump', pct: c0, to: d[0], from: d[1] };

    if (ch.length >= 2 && c0 !== 0 && Math.abs(c0) < th && (c0 > 0) === (ch[1] > 0)) {
      var c2 = pc(d[0], d[2]);
      if (Math.abs(c2) >= Math.max(th, 2 * median(ch.slice(2)))) return { kind: 'trend', pct: c2, to: d[0], from: d[2] };
    }

    if (ch.length >= 3 && c0 !== 0) {
      var up = ch[0] >= 0 && ch[1] >= 0 && ch[2] >= 0, dn = ch[0] <= 0 && ch[1] <= 0 && ch[2] <= 0;
      if (up || dn) {
        var c3 = pc(d[0], d[3]);
        if (Math.abs(c3) >= th) return { kind: 'trend3', pct: c3, to: d[0], from: d[3] };
      }
    }
    return null;
  }

  // 除息日顯示成 MM/DD；舊資料沒有除息日就退回 YY-MM
  function label(x) { return x && x.ex ? x.ex.substring(5).replace('-', '/') : String(x && x.date || '').substring(2); }

  window.FH_DIV = {
    TH: TH,
    verdict: verdict,
    label: label,
    KIND: { jump: '', fixed: '固定配息調整', trend: '連續 2 期', trend3: '連續 3 期' }
  };
})();
