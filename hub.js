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
  var COURSE_URL = window.HUB_COURSE_URL || '';
  var BLOG_URL = window.HUB_BLOG_URL || '';
  var KEY = 'fh-session';
  var s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (!s || !s.token) { location.replace('/'); return; }

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
    'tr.vr.hub-off{display:none !important}' +
    '.hub-chip{font-size:12px;font-weight:700;padding:7px 11px;border-radius:999px}' +
    '.hub-chip.trial{background:#f1f5f9;color:#475569}' +
    '.hub-chip.stu{background:#ede9fe;color:#6d28d9}' +
    '.hub-chip.end{background:#fee2e2;color:#dc2626}' +
    '.hub-bar a.cta{background:#1d4ed8;color:#fff;border-color:#1d4ed8}' +
    '.hub-star.lock{color:#e2e8f0;cursor:not-allowed}' +
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
    var n = Object.keys(set).filter(function (k) { return k.indexOf(CODE + '-') === 0; }).length;
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
      // 不留死巷：到期了也要有地方可以去
      if (cta) {
        var h = '';
        if (COURSE_URL) h += '<a class="cta" href="' + COURSE_URL + '">看課程</a>';
        if (BLOG_URL) h += '<a href="' + BLOG_URL + '">回部落格版</a>';
        cta.innerHTML = h;
      }
    } else {
      chip.className = 'hub-chip trial';
      chip.textContent = '體驗期' + (daysLeft == null ? '' : '剩 ' + daysLeft + ' 天');
      if (cta) cta.innerHTML = (daysLeft != null && daysLeft <= 3 && COURSE_URL)
        ? '<a class="cta" href="' + COURSE_URL + '">看課程</a>' : '';
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
      if (set[k]) { delete set[k]; } else { set[k] = 1; }
      dirty = true;
      paintStar(row, k);
      if (onlyFav) row.classList.toggle('hub-off', !set[k]);
      paintBar();
    });
    return el;
  }
  function paintStar(tr, k) {
    var on = !!set[k];
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
      tr.classList.toggle('hub-off', onlyFav && !set[k]);
    }
    paintBar();
  }

  function mount() {
    var tbl = document.querySelector('table');
    if (!tbl || !tbl.parentElement) return setTimeout(mount, 400);
    if (!document.getElementById('hub-fav')) {
      var box = tbl.parentElement;
      box.parentElement.insertBefore(bar, box);
      document.getElementById('hub-fav').addEventListener('click', function () {
        onlyFav = !onlyFav; decorate();
      });
    }
    decorate();
  }

  load().then(function () {
    mount();
    setInterval(decorate, 700);
  });
})();
