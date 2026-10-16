/* ═══ 工具集共用層 ═══
   1. 沒登入就退回首頁
   2. 所有 /api/ 請求自動帶上 Authorization，工具本身的程式不用改
   3. 自選清單：獨立一欄的星號、「只看自選」、返回連結

   注意：桌機版 sortBy() 在沒有 data-c{n} 時會改用 td 索引取值，
   所以插星號欄之前必須先把原本的值寫成 data-c{n}，
   否則多一欄會把所有索引推掉一格，排序就全錯了。 */
(function () {
  var CODE = (window.HUB_CODE || 'VCCT');
  // 到期後要帶人去的地方。沒設就不顯示該連結，不會變成死連結。
  var COURSE_URL = window.HUB_COURSE_URL || '/support';
  var BLOG_URL = window.HUB_BLOG_URL || '';
  // 到期後整支擋掉的工具。三支配息率工具不在內——那些數字部落格本來就免費看得到，
  // 擋了只是把人推走，也會讓性質變成「付錢才看得到配息率分析」。
  var PAID_ONLY = ['PF'];
  var KEY = 'fh-session';
  // LINE 內建瀏覽器與 Safari 無痕／鎖定模式會擋掉 localStorage；
  // 只讀 localStorage 的話，這些人會被下面那行無限彈回首頁。
  var s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (!s || !s.token) {
    try {
      var ck = /(?:^|;\s*)fh=([^;]+)/.exec(document.cookie || '');
      if (ck) s = { token: decodeURIComponent(ck[1]) };
    } catch (e) {}
  }
  // 部落格文章用 /embed/<code> 內嵌，那是免費層（廣告長在部落格頁面上）。
  // 主網址是無廣告版，和自選清單、組合試算綁在一起，要開通才看得到。
  var EMBED = /^\/embed\//.test(location.pathname);
  var BLOG_POST = {
    VBCT: 'https://oosayhi.com/vbct/',
    VCCT: 'https://oosayhi.com/vcct/',
    UND:  'https://oosayhi.com/und/'
  };

  if (EMBED) {
    // 有人把內嵌網址直接貼到網址列時，送回部落格——那邊才有廣告收入。
    if (window.top === window.self) {
      location.replace(BLOG_POST[CODE] || 'https://oosayhi.com/');
      return;
    }
    embedBar();
    return;
  }

  if (!s || !s.token) { location.replace('/'); return; }

  // 內嵌版頁尾的升級提示：說明無廣告版多了什麼
  function embedBar() {
    if (document.getElementById('hub-embed')) return;
    var tbl = document.querySelector('table');
    if (!tbl || !tbl.parentElement || !tbl.parentElement.parentElement) return setTimeout(embedBar, 400);

    var st = document.createElement('style');
    st.textContent =
      '#hub-embed{display:flex;align-items:center;gap:12px;flex-wrap:wrap;'
      + 'margin:0 0 12px;padding:11px 14px;border:1px solid #dbe4f0;border-left:3px solid #2657a0;'
      + 'border-radius:8px;background:#f7f9fc;font-size:13px;line-height:1.65;color:#334155}'
      + '#hub-embed b{color:#0f172a}'
      + '#hub-embed .he-txt{flex:1 1 320px;min-width:0}'
      + '#hub-embed .he-cta{flex:0 0 auto;display:inline-block;padding:7px 14px;border-radius:7px;'
      + 'background:#2657a0;color:#fff;text-decoration:none;font-weight:600;white-space:nowrap}'
      + '#hub-embed .he-cta:hover{background:#1d4580}';
    document.head.appendChild(st);

    var bar = document.createElement('div');
    bar.id = 'hub-embed';
    bar.innerHTML =
      '<div class="he-txt"><b>這份清單免費，資料與無廣告版完全相同。</b>'
      + '無廣告版另外有自選清單（四支工具共用、換裝置也讀得到）與跨險種的組合試算。</div>'
      + '<a class="he-cta" href="https://fund.oosayhi.com/" target="_blank" rel="noopener">看無廣告版</a>';

    var box = tbl.parentElement;
    box.parentElement.insertBefore(bar, box);
  }

  var of = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      if (url.indexOf('/api/') === 0 || url.indexOf(location.origin + '/api/') === 0) {
        init = init || {};
        var h = new Headers(init.headers || (typeof input !== 'string' ? input.headers : null) || {});
        if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + s.token);
        init.headers = h;
      }
    } catch (e) {}
    return of.call(this, input, init);
  };

  var st = document.createElement('style');
  st.textContent =
    '.hub-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0 2px}' +
    '.hub-bar a,.hub-bar button{font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;' +
      'border:1.5px solid #e2e8f0;background:#fff;color:#475569;border-radius:9px;padding:8px 12px;text-decoration:none}' +
    '.hub-bar button.on{background:#1d4ed8;color:#fff;border-color:#1d4ed8}' +
    '.hub-star{display:inline-block;cursor:pointer;font-size:16px;line-height:1;color:#cbd5e1;' +
      'user-select:none;-webkit-tap-highlight-color:transparent;transition:color .12s}' +
    '.hub-star.on{color:#f59e0b}' +
    'th.hub-th,td.hub-td{width:34px;min-width:34px;max-width:34px;padding-left:4px !important;' +
      'padding-right:4px !important;text-align:center !important}' +
    /* ── 表格統一規格：列高 44px、內容 12.5px、內距 10·8 ── */
    /* 工具頁的 nth-child 規則是在插星號欄之前寫的，插完序號全部 +1， */
    /* 會藏錯欄位（直式平板曾經把「基金名稱」整欄藏掉）。 */
    /* 這裡全改用 data-label / data-col 定位，以後再插欄也不會錯位。 */
    'table[class$=\"-tbl\"]:not(.div-tbl) > thead > tr > th{font-size:11px;padding:10px 8px;line-height:1.35}' +
    'table[class$=\"-tbl\"]:not(.div-tbl) > tbody > tr > td{font-size:12.5px;padding:10px 8px;line-height:1.4}' +
    'table[class$=\"-tbl\"] > tbody > tr.vr{height:44px}' +
    /* 近6月配息折成兩行會把列擐到 59px，鎖成一行。 */
    'table[class$=\"-tbl\"] > tbody > tr.vr > td[data-label=\"近6月配息\"]{white-space:nowrap}' +
    'table[class$=\"-tbl\"] > tbody > tr.vr > td[data-label=\"近6月配息\"] > *{white-space:nowrap}' +
    /* 名稱過長就截斷，不折行。這樣每一列都是整齊的 44px， */
    /* 完整名稱滑鼠移上去（或點進去）看得到。 */
    'table[class$=\"-tbl\"] > tbody > tr.vr > td[data-label=\"基金名稱\"]{max-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    /* 操作按鈕不要折行，不然「加入」會被拆成兩行把列擐高。 */
    'table[class$=\"-tbl\"] > tbody > tr.vr > td[data-label=\"操作\"],' +
    'table[class$=\"-tbl\"] > tbody > tr.vr > td[data-label=\"分析\"]{white-space:nowrap}' +
    'table[class$=\"-tbl\"] > tbody > tr.vr > td[data-label=\"基金名稱\"] > a,' +
    'table[class$=\"-tbl\"] > tbody > tr.vr > td[data-label=\"基金名稱\"] > span{display:block;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    'table[class$=\"-tbl\"] > thead > tr > th.hub-th,' +
    'table[class$=\"-tbl\"] > tbody > tr.vr > td.hub-td{width:34px !important;min-width:34px !important;' +
      'padding-left:4px !important;padding-right:4px !important}' +
    'table[class$=\"-tbl\"] > thead > tr > th.hub-th + th,' +
    'table[class$=\"-tbl\"] > tbody > tr.vr > td.hub-td + td{min-width:220px !important}' +
    '@media (max-width:1023px){' +
      /* 先把被錯位規則藏掉的欄位全部讓它回來 */
      'table[class$=\"-tbl\"] > thead > tr > th[data-col],' +
      'table[class$=\"-tbl\"] > tbody > tr.vr > td[data-label]{display:table-cell !important}' +
      /* 再統一隱藏次要欄位 */
      'table[class$=\"-tbl\"]:not(.div-tbl) > thead > tr > th[data-col=\"幣別\"],' +
      'table[class$=\"-tbl\"]:not(.div-tbl) > tbody > tr.vr > td[data-label=\"幣別\"],' +
      'table[class$=\"-tbl\"]:not(.div-tbl) > thead > tr > th[data-col=\"標的類型\"],' +
      'table[class$=\"-tbl\"]:not(.div-tbl) > tbody > tr.vr > td[data-label=\"標的類型\"],' +
      'table[class$=\"-tbl\"]:not(.div-tbl) > thead > tr > th[data-col=\"近6月配息\"],' +
      'table[class$=\"-tbl\"]:not(.div-tbl) > tbody > tr.vr > td[data-label=\"近6月配息\"]{display:none !important}' +
      /* 欄位多，收緊內距才塞得下，不用左右滑。 */
      'table[class$=\"-tbl\"]:not(.div-tbl) > thead > tr > th,' +
      'table[class$=\"-tbl\"]:not(.div-tbl) > tbody > tr > td{padding:6px 4px !important}' +
      'table[class$=\"-tbl\"] > thead > tr > th.hub-th + th,' +
      'table[class$=\"-tbl\"] > tbody > tr.vr > td.hub-td + td{min-width:140px !important}' +
    '}' +
    'tr.vr.hub-off{display:none !important}' +
    '.hub-chip.warn{background:#fdf0e3;color:#a35b12;border-color:#f0d8bb}' + '.hub-chip{font-size:12px;font-weight:700;padding:7px 11px;border-radius:999px}' +
    '.hub-chip.trial{background:#f1f5f9;color:#475569}' +
    '.hub-chip.stu{background:#ede9fe;color:#6d28d9}' +
    '.hub-chip.end{background:#fee2e2;color:#dc2626}' +
    '.hub-bar a.cta{background:#1d4ed8;color:#fff;border-color:#1d4ed8}' +
    '.hub-star.lock{color:#e2e8f0;cursor:not-allowed}' +
    '.hub-gate{max-width:560px;margin:64px auto;padding:0 20px;text-align:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Noto Sans TC","PingFang TC",sans-serif;color:#1f2a37}' +
    '.hub-gate h2{font-size:20px;margin:0 0 10px}' +
    '.hub-gate p{color:#64748b;font-size:14.5px;line-height:1.75;margin:0 0 22px}' +
    '.hub-gate .acts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}' +
    '.hub-gate a{font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;' +
      'padding:11px 18px;border:1.5px solid #e2e8f0;color:#475569;background:#fff}' +
    '.hub-gate a.cta{background:#1d4ed8;border-color:#1d4ed8;color:#fff}' +
    /* 手機版：關鍵一行與標籤列都多一個 22px 欄 */
    '@media(max-width:767px){' +
      '.mc-key,.mc-lhead{grid-template-columns:22px 50px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 38px !important}' +
      '.mc-key .hub-star{justify-self:start;font-size:15px}' +
      '.mc-lhead i.hub-lh{text-align:left}' +
      'td.hub-td{display:none !important}' +
    '}';
  document.head.appendChild(st);

  var set = {}, onlyFav = false, dirty = false;
  var plan = 'trial', active = true, daysLeft = null;
  function keyOf(code) { return CODE + '-' + code; }

  // 同一檔基金在三張保單裡用同一組代碼（實測 173 個共用代碼，名稱 100% 一致），
  // 所以自選以「代碼」為準：在任何一張保單加入，其他兩張也會一起標記。
  // 資料仍以 險種-代碼 的形式存著，不需要搬舊資料。
  function codeOf(k) { var i = k.indexOf('-'); return i < 0 ? k : k.slice(i + 1); }

  function isFav(code) {
    for (var k in set) { if (codeOf(k) === code) return true; }
    return false;
  }

  // 組合試算的清單有 587 檔但只渲染前 60 筆，所以它必須在資料層自己篩，
  // 不能靠隱藏已渲染的列——那樣自選不在前 60 名時會整個空白。
  window.hubIsFav = function (code) { return isFav(code); };

  function setFav(code, on) {
    for (var k in set) { if (codeOf(k) === code) delete set[k]; }
    if (on) set[keyOf(code)] = 1;
  }

  // 自選筆數以不重複的代碼計算，才不會同一檔因為跨三張保單被算三次
  // 只算「這張保單的表格裡真的有」的自選檔數。
  // 自選是跨險種共用的，但 VBCT 頁面顯示 8 檔、實際只有 3 檔在這張保單裡，會讓人誤判。
  function favCount() {
    var rows = document.querySelectorAll('table tbody tr.vr');
    var seen = {}, n = 0;
    for (var i = 0; i < rows.length; i++) {
      var c = rowCode(rows[i]);
      if (c && !seen[c] && isFav(c)) { seen[c] = 1; n++; }
    }
    return n;
  }
  function load() {
    return fetch('/api/watch').then(function (r) { return r.json(); }).then(function (j) {
      set = {};
      (j.list || []).forEach(function (k) { set[k] = 1; });
      if (j.plan) plan = j.plan;
      if (typeof j.active === 'boolean') active = j.active;
      daysLeft = (typeof j.daysLeft === 'number') ? j.daysLeft : null;
    }).catch(function () {});
  }
  function save() {
    if (!active) { dirty = false; return; }
    if (!dirty) return;
    dirty = false;
    fetch('/api/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: Object.keys(set) })
    }).catch(function () { dirty = true; });
  }
  setInterval(save, 2500);
  window.addEventListener('beforeunload', save);

  var bar = document.createElement('div');
  bar.className = 'hub-bar';
  bar.innerHTML = '<a href="/">← 工具集</a><button type="button" id="hub-fav"></button>' +
    '<span id="hub-plan" class="hub-chip"></span><span id="hub-cta"></span>';
  function paintBar() {
    var b = document.getElementById('hub-fav');
    if (!b) return;
    var n = favCount();
    b.textContent = '只看自選' + (n ? '（' + n + '）' : '');
    b.classList.toggle('on', onlyFav);
    b.disabled = false;

    var chip = document.getElementById('hub-plan');
    var cta = document.getElementById('hub-cta');
    if (!chip) return;
    if (plan === 'student') {
      chip.className = 'hub-chip stu';
      chip.textContent = '學員・永久開通';
      if (cta) cta.innerHTML = '';
    } else if (!active) {
      chip.className = 'hub-chip end';
      chip.textContent = '體驗期已結束';
      chip.className = 'hub-chip warn';
      chip.title = '自選清單與組合試算已暫停，存過的清單我們留著。配息率資料在部落格上一直免費。';
      // 不留死巷：到期了也要有地方可以去
      if (cta) {
        var h = '';
        if (COURSE_URL) h += '<a class="cta" href="' + COURSE_URL + '">贊助開通</a>';
        if (BLOG_URL) h += '<a href="' + BLOG_URL + '">回部落格版</a>';
        cta.innerHTML = h;
      }
    } else {
      chip.className = 'hub-chip trial';
      chip.textContent = '體驗期' + (daysLeft == null ? '' : '剩 ' + daysLeft + ' 天');
      // 剩沒幾天就變色並說明到期會少什麼
      if (daysLeft != null && daysLeft <= 3) {
        chip.className = 'hub-chip warn';
        chip.title = '到期後：無廣告版、自選清單同步與組合試算會暫停。配息率資料在部落格上一直免費。';
      }
      if (cta) cta.innerHTML = (daysLeft != null && daysLeft <= 3 && COURSE_URL)
        ? '<a class="cta" href="' + COURSE_URL + '">贊助開通</a>' : '';
    }
  }

  // 把每一欄的 data-label 複製到表頭，讓 CSS 可以用欄位名稱定位。
  // 不用 nth-child 是因為我們會插星號欄，序號會整排位移。
  function tagCols() {
    var tbl = document.querySelector('table[class$="-tbl"]');
    if (!tbl) return;
    var row = tbl.querySelector('tbody tr.vr');
    if (!row) return;
    var ths = tbl.querySelectorAll('thead th');
    for (var i = 0; i < ths.length && i < row.cells.length; i++) {
      var lbl = row.cells[i].getAttribute('data-label');
      if (lbl && ths[i].getAttribute('data-col') !== lbl) ths[i].setAttribute('data-col', lbl);
    }
  }

  // 名稱欄會被截斷，把完整名稱放進 title，滑鼠移上去就看得到。
  function tagNames() {
    var cells = document.querySelectorAll('table[class$="-tbl"] > tbody > tr.vr > td[data-label="基金名稱"]');
    for (var i = 0; i < cells.length; i++) {
      var inner = cells[i].firstElementChild || cells[i];
      var txt = (inner.textContent || '').trim();
      if (txt && inner.getAttribute('title') !== txt) inner.setAttribute('title', txt);
    }
  }

  function tdsOf(tr) {
    var a = [];
    for (var i = 0; i < tr.children.length; i++) {
      if (tr.children[i].tagName === 'TD' && !tr.children[i].classList.contains('hub-td')) a.push(tr.children[i]);
    }
    return a;
  }
  function rowCode(tr) {
    var c = tr.querySelector('.mc-code');
    if (c) return (c.textContent || '').trim();
    var tds = tdsOf(tr);
    for (var j = 0; j < tds.length; j++) {
      if (tds[j].querySelector('.src-badge')) continue;
      var t = (tds[j].textContent || '').trim();
      if (/^[A-Z0-9]{2,8}$/.test(t)) return t;
    }
    return '';
  }
  function mkStar(k, row) {
    var el = document.createElement('span');
    el.className = 'hub-star';
    el.title = '加入自選';
    el.addEventListener('click', function (ev) {
      ev.stopPropagation(); ev.preventDefault();
      if (!active) { alert('體驗期已結束，自選清單暫停使用。\n既有的清單仍保留著，開通後原封不動還在。'); return; }
      setFav(codeOf(k), !isFav(codeOf(k)));
      dirty = true;
      paintStar(row, k);
      if (onlyFav) row.classList.toggle('hub-off', !isFav(codeOf(k)));
      paintBar();
    });
    return el;
  }
  function paintStar(tr, k) {
    var on = isFav(codeOf(k));
    var list = tr.querySelectorAll('.hub-star');
    for (var i = 0; i < list.length; i++) {
      list[i].textContent = on ? '\u2605' : '\u2606';
      list[i].classList.toggle('on', on);
      list[i].classList.toggle('lock', !active);
    }
  }

  function head() {
    var thead = document.querySelector('table thead tr');
    if (thead && !thead.querySelector('.hub-th')) {
      var th = document.createElement('th');
      th.className = 'hub-th';
      th.textContent = '\u2606';
      thead.insertBefore(th, thead.firstChild);
    }
    var lh = document.querySelector('.mc-lhead');
    if (lh && !lh.querySelector('.hub-lh')) {
      var i2 = document.createElement('i');
      i2.className = 'hub-lh';
      i2.textContent = '\u2606';
      lh.insertBefore(i2, lh.firstChild);
    }
  }

  function decorate() {
    head();
    var rows = document.querySelectorAll('table tbody tr.vr');
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var code = rowCode(tr);
      if (!code) continue;
      var k = keyOf(code);
      // 桌機版：先固定排序取值用的 data-c{n}，再插星號欄
      if (!tr.querySelector('td.hub-td')) {
        var tds = tdsOf(tr);
        for (var z = 0; z < tds.length; z++) {
          if (!tr.hasAttribute('data-c' + z)) tr.setAttribute('data-c' + z, (tds[z].textContent || '').trim());
        }
        var td = document.createElement('td');
        td.className = 'hub-td';
        td.appendChild(mkStar(k, tr));
        tr.insertBefore(td, tr.firstChild);
      }
      // 手機版：放進關鍵一行的第一格
      var mk = tr.querySelector('.mc-key');
      if (mk && !mk.querySelector('.hub-star')) mk.insertBefore(mkStar(k, tr), mk.firstChild);
      paintStar(tr, k);
      // 星號用跨險種的 isFav，這裡如果用 set[k]（帶險種前綴的 key），
      // 組合試算頁的 CODE 和实際標的險種不一致，會把自選全藏起來。
      tr.classList.toggle('hub-off', onlyFav && !isFav(code));
    }
    tagCols();
    tagNames();
    paintBar();
  }

  // 到期後把整頁換掉。不留死巷：一定要有地方可以去。
  function lockPage() {
    var h = '<div class="hub-gate">' +
      '<h2>體驗期已結束</h2>' +
      '<p>組合試算是開通後才有的功能。<br>' +
      '三張保單的配息率清單在部落格上仍然免費，資料完全相同。<br>' +
      '你存過的自選清單我們留著，開通後原封不動還在。</p>' +
      '<div class="acts">';
    if (COURSE_URL) h += '<a class="cta" href="' + COURSE_URL + '">贊助開通</a>';
    if (BLOG_URL) h += '<a href="' + BLOG_URL + '">回部落格版</a>';
    h += '<a href="/">回工具集</a></div></div>';
    document.body.innerHTML = h;
    document.head.appendChild(st);
  }

  function mount() {
    var tbl = document.querySelector('table');
    if (!tbl || !tbl.parentElement) return setTimeout(mount, 400);
    if (!document.getElementById('hub-fav')) {
      var box = tbl.parentElement;
      box.parentElement.insertBefore(bar, box);
      document.getElementById('hub-fav').addEventListener('click', function () {
        onlyFav = !onlyFav;
        if (typeof window.pfSetOnlyFav === 'function') window.pfSetOnlyFav(onlyFav);
        decorate();
      });
      // 組合試算入口：鎖定在本險種。內嵌版（部落格）不會執行到這裡，
      // 所以部落格上不會出現這顆按鈕，組合試算仍是開通後才有的功能。
      (function addPfLink() {
        if (PAID_ONLY.indexOf(CODE) >= 0) return;
        if (document.getElementById('hub-pf')) return;
        var bar = document.getElementById('hub-fav');
        if (!bar || !bar.parentElement) return;
        var a = document.createElement('a');
        a.id = 'hub-pf';
        a.href = '/portfolio?ins=' + CODE;
        a.textContent = '組合試算';
        a.style.cssText = 'display:inline-block;margin-left:8px;padding:7px 13px;border-radius:8px;'
          + 'border:1px solid #dbe4f0;background:#fff;color:#2657a0;font-size:13px;'
          + 'font-weight:600;text-decoration:none;vertical-align:middle';
        bar.parentElement.insertBefore(a, bar.nextSibling);
      })();
    }
    decorate();
  }

  load().then(function () {
    if (!active && PAID_ONLY.indexOf(CODE) >= 0) { lockPage(); return; }
    mount();
    setInterval(decorate, 700);
  });
})();
