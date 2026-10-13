/* ═══ 工具集共用層 ═══
   1. 沒登入就退回首頁
   2. 所有 /api/ 請求自動帶上 Authorization，工具本身的程式不用改
   3. 自選清單：星號、「只看自選」、返回連結
   標的的 key 是「險種-代號」，四支工具共用同一份清單。 */
(function () {
  var CODE = (window.HUB_CODE || 'VCCT');
  var KEY = 'fh-session';
  var s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (!s || !s.token) { location.replace('/'); return; }

  // ① 幫所有同源 /api/ 請求補上 token
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

  // ② 樣式
  var st = document.createElement('style');
  st.textContent =
    '.hub-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0 2px}' +
    '.hub-bar a,.hub-bar button{font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;' +
      'border:1.5px solid #e2e8f0;background:#fff;color:#475569;border-radius:9px;padding:8px 12px;text-decoration:none}' +
    '.hub-bar button.on{background:#1d4ed8;color:#fff;border-color:#1d4ed8}' +
    '.hub-star{display:inline-block;width:22px;text-align:center;cursor:pointer;' +
      'font-size:15px;line-height:1;color:#cbd5e1;user-select:none;-webkit-tap-highlight-color:transparent}' +
    '.hub-star.on{color:#f59e0b}' +
    'tr.vr.hub-off{display:none !important}';
  document.head.appendChild(st);

  // ③ 清單狀態
  var set = {}, onlyFav = false, dirty = false;
  function keyOf(code) { return CODE + '-' + code; }
  function load() {
    return fetch('/api/watch').then(function (r) { return r.json(); }).then(function (j) {
      set = {};
      (j.list || []).forEach(function (k) { set[k] = 1; });
    }).catch(function () {});
  }
  function save() {
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

  // ④ 工具列
  var bar = document.createElement('div');
  bar.className = 'hub-bar';
  bar.innerHTML = '<a href="/">← 工具集</a><button type="button" id="hub-fav"></button>';
  function paintBar() {
    var n = Object.keys(set).filter(function (k) { return k.indexOf(CODE + '-') === 0; }).length;
    var b = document.getElementById('hub-fav');
    b.textContent = '只看自選' + (n ? '（' + n + '）' : '');
    b.classList.toggle('on', onlyFav);
  }

  // ⑤ 把星號裝到每一列
  function rowCode(tr) {
    var c = tr.querySelector('.mc-code');
    if (c) return (c.textContent || '').trim();
    var tds = [];
    for (var i = 0; i < tr.children.length; i++) if (tr.children[i].tagName === 'TD') tds.push(tr.children[i]);
    for (var j = 0; j < tds.length; j++) {
      var t = (tds[j].textContent || '').trim();
      if (/^[A-Z0-9]{2,8}$/.test(t)) return t;
    }
    return '';
  }
  function decorate() {
    var rows = document.querySelectorAll('table tbody tr.vr');
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var code = rowCode(tr);
      if (!code) continue;
      var k = keyOf(code);
      var host = tr.querySelector('.mc-nm') || tr.querySelector('td');
      if (!host) continue;
      var star = tr.querySelector('.hub-star');
      if (!star) {
        star = document.createElement('span');
        star.className = 'hub-star';
        star.title = '加入自選';
        host.insertBefore(star, host.firstChild);
        (function (k2, el, row) {
          el.addEventListener('click', function (ev) {
            ev.stopPropagation(); ev.preventDefault();
            if (set[k2]) { delete set[k2]; } else { set[k2] = 1; }
            dirty = true;
            el.classList.toggle('on', !!set[k2]);
            el.textContent = set[k2] ? '\u2605' : '\u2606';
            if (onlyFav) row.classList.toggle('hub-off', !set[k2]);
            paintBar();
          });
        })(k, star, tr);
      }
      var on = !!set[k];
      star.textContent = on ? '\u2605' : '\u2606';
      star.classList.toggle('on', on);
      tr.classList.toggle('hub-off', onlyFav && !on);
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
