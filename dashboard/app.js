// app.js — renders the token radar from window.RADAR (written by main.ts).
// No network, no framework: the page reads the data script beside it and
// renders the board, the filters and the per-protocol detail view.

(function () {
  'use strict';

  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('snapshot-meta').textContent = 'No radar data found.';
    return;
  }

  var params = new URLSearchParams(window.location.search);

  /* ---------- small helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n) {
    if (n === null || n === undefined) return '<span class="flat">—</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    var sign = n > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + n.toFixed(1) + '%</span>';
  }

  function age(days) {
    if (days === null || days === undefined) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return (days / 30.4).toFixed(1) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }

  function mult(n) {
    return n.toFixed(2) + '×';
  }

  /* ---------- header, stats, methodology ---------- */

  var top = R.rows[0];
  document.getElementById('snapshot-meta').innerHTML =
    'Snapshot <b>' + esc(R.as_of) + '</b> · DefiLlama protocols<br>' +
    'Watchlist floor <b>' + money(R.floor_usd) + '</b> · Board total <b>' + money(R.total_implied_usd) + '</b>';

  document.getElementById('stats').innerHTML =
    stat(R.scanned, 'protocols scanned', '') +
    stat(R.watchlist_size, 'on the watchlist', '') +
    stat(R.board_size, 'ranked pre-token', 'hot') +
    stat(money(R.total_implied_usd), 'total implied value', '') +
    stat(top ? esc(top.name) : '—', 'rank 1 · ' + (top ? money(top.implied_value_usd) : ''), 'hot');

  function stat(value, label, cls) {
    return '<div class="stat ' + cls + '"><div class="k">' + esc(label) +
      '</div><div class="v">' + value + '</div></div>';
  }

  document.getElementById('formula').textContent = R.model.formula;
  document.getElementById('factors').innerHTML =
    '<li><b>Category multiple</b> — median mcap/TVL of the tokenised peers in the same category.</li>' +
    '<li><b>' + esc(R.model.growth_note) + '</b></li>' +
    '<li><b>' + esc(R.model.maturity_note) + '</b></li>' +
    '<li><b>' + esc(R.model.breadth_note) + '</b></li>';

  /* ---------- multiples + live peers ---------- */

  document.getElementById('multiples').innerHTML = R.categories.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + mult(c.multiple) +
      '</td><td class="num">' + c.peers + '</td><td class="num">' + money(c.median_peer_mcap) + '</td></tr>';
  }).join('');

  document.getElementById('live').innerHTML = R.live.map(function (p) {
    return '<tr><td><b>' + esc(p.name) + '</b> <span class="slug">' + esc(p.slug) +
      '</span></td><td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) +
      '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + mult(p.multiple) + '</td></tr>';
  }).join('');

  /* ---------- controls ---------- */

  var qEl = document.getElementById('q');
  var catEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var wlEl = document.getElementById('watchlist');
  var tvlEl = document.getElementById('mintvl');
  var sortEl = document.getElementById('sort');

  var cats = [];
  var chains = [];
  R.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  cats.forEach(function (c) { catEl.add(new Option(c, c)); });
  chains.forEach(function (c) { chainEl.add(new Option(c, c)); });

  qEl.value = params.get('q') || '';
  catEl.value = params.get('category') || '';
  chainEl.value = params.get('chain') || '';
  wlEl.checked = params.get('watchlist') === '1';
  tvlEl.value = params.get('mintvl') || '0';
  sortEl.value = params.get('sort') || 'rank';

  [qEl, catEl, chainEl, wlEl, tvlEl, sortEl].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });

  /* ---------- board ---------- */

  var maxImplied = R.rows.length ? R.rows[0].implied_value_usd : 1;

  function filtered() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catEl.value;
    var chain = chainEl.value;
    var wl = wlEl.checked;
    var minTvl = Number(tvlEl.value) || 0;
    var list = R.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (wl && !r.on_watchlist) return false;
      if (r.tvl_usd < minTvl) return false;
      return true;
    });
    var key = sortEl.value;
    list.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === 'age') return (b.age_days || 0) - (a.age_days || 0);
      if (key === 'name') return a.name.localeCompare(b.name);
      return a.rank - b.rank;
    });
    return list;
  }

  function rowHtml(r) {
    var dot = r.on_watchlist ? '<span class="watchdot" title="On the watchlist"></span>' : '';
    var width = Math.max(2, Math.round(100 * r.implied_value_usd / maxImplied));
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="num">' + r.rank + '</td>' +
      '<td class="name">' + dot + '<b>' + esc(r.name) + '</b><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + age(r.age_days) + '</td>' +
      '<td class="num"><span class="val">' + money(r.implied_value_usd) +
      '</span><div class="bar"><i style="width:' + width + '%"></i></div></td>' +
      '<td><button class="farmbtn" data-slug="' + esc(r.slug) + '">Farm plan</button></td>' +
      '</tr>';
  }

  function render() {
    var list = filtered();
    document.getElementById('rows').innerHTML = list.map(rowHtml).join('');
    document.getElementById('empty').hidden = list.length !== 0;
    document.getElementById('count').textContent =
      list.length + ' of ' + R.rows.length + ' protocols shown';
  }

  document.getElementById('rows').addEventListener('click', function (ev) {
    var t = ev.target.closest('tr[data-slug], button[data-slug]');
    if (!t) return;
    openDetail(t.getAttribute('data-slug'));
  });

  /* ---------- detail view ---------- */

  function openDetail(slug) {
    var r = null;
    R.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    var box = document.getElementById('detail');
    if (!r) { box.hidden = true; return; }

    var found = null;
    (R.peer_examples || []).forEach(function (entry) {
      if (entry.category === (r.category || 'Uncategorised')) found = entry.peers;
    });
    var peers = found || R.live.slice(0, 3);

    box.innerHTML =
      '<div class="crumb"><a href="#" id="back">← Back to the board</a> · Rank #' + r.rank + ' of ' + R.rows.length + '</div>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · tracked since ' + esc(r.listed_at || 'unknown') + ' (' + age(r.age_days) + ')' +
      ' · ' + (r.on_watchlist ? 'on the watchlist' : 'below the watchlist floor') + '</p>' +
      '<div class="badges">' +
      (r.on_watchlist ? '<span class="badge watch">★ Watchlist</span>' : '<span class="badge">Early find — below the $50M floor</span>') +
      r.chains.map(function (c) { return '<span class="badge chain">' + esc(c) + '</span>'; }).join('') +
      '<span class="badge">Records no token</span></div>' +
      '<h3>How the value is built</h3>' +
      '<table class="breakdown"><thead><tr><th>Step</th><th>Figure</th><th class="num">Value</th></tr></thead><tbody>' +
      '<tr><td>TVL in the snapshot</td><td class="note">as fetched 2026-11-14</td><td>' + moneyFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple (' + esc(r.category || 'Uncategorised') + ')</td><td class="note">' +
      (r.multiple_basis === 'category'
        ? 'median of ' + r.peer_count + ' priced peers'
        : r.peer_count > 0
          ? 'global median — only ' + r.peer_count + ' priced peer' + (r.peer_count === 1 ? '' : 's') + ' in this category'
          : 'global median — no priced peers in this category') +
      '</td><td>' + mult(r.multiple) + '</td></tr>' +
      '<tr><td>Growth factor</td><td class="note">7-day TVL change ' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '%') + '</td><td>' + r.growth_factor.toFixed(3) + '×</td></tr>' +
      '<tr><td>Maturity factor</td><td class="note">' + age(r.age_days) + ' tracked with no token</td><td>' + r.maturity_factor.toFixed(3) + '×</td></tr>' +
      '<tr><td>Chain-breadth factor</td><td class="note">' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</td><td>' + r.breadth_factor.toFixed(3) + '×</td></tr>' +
      '<tr class="total"><td>Implied launch value</td><td class="note">TVL × multiple × growth × maturity × breadth</td><td>' + moneyFull(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<h3>Peer context — priced near this ' + mult(r.multiple) + ' multiple</h3>' +
      '<table class="breakdown"><thead><tr><th>Tokenised peer</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' +
      peers.map(function (p) {
        return '<tr><td>' + esc(p.name) + '</td><td class="num">' + money(p.tvl_usd) +
          '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + mult(p.multiple) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<h3>Farm plan — about $' + r.capital_usd.toLocaleString('en-US') + ' working capital</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="plain">A plan is guidance, not a promise: a token may never be issued, and any position can lose money.</p>';

    box.hidden = false;
    document.getElementById('back').addEventListener('click', function (ev) {
      ev.preventDefault();
      box.hidden = true;
      params.delete('slug');
      history.replaceState(null, '', window.location.pathname + '?' + params.toString());
      render();
    });
    var url = new URL(window.location.href);
    url.searchParams.set('slug', slug);
    history.replaceState(null, '', url.toString());
    box.scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  render();

  var slug = params.get('slug');
  if (slug) openDetail(slug);
})();
