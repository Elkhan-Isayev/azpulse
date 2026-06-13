/* Azerbaijan Live Data Dashboard
 * Pure static app. Talks directly to the CKAN API behind opendata.az.
 * No backend, no build step, no API key.
 */
'use strict';

const DMS = 'https://admin.opendata.az';
const API = `${DMS}/api/3/action`;

// Category slug -> display label (AZ + EN) and color.
const CATEGORIES = {
  economics:          { az: 'İqtisadiyyat',       en: 'Economics',        color: '#4f8cff' },
  education:          { az: 'Təhsil',             en: 'Education',        color: '#2fb8a3' },
  transport:         { az: 'Nəqliyyat',          en: 'Transport',        color: '#ffb547' },
  health:            { az: 'Səhiyyə',            en: 'Health',           color: '#ff6b8a' },
  ecology:           { az: 'Ətraf mühit',        en: 'Environment',      color: '#7ed957' },
  trade:             { az: 'Ticarət',            en: 'Trade',            color: '#b48cff' },
  tourism:           { az: 'Turizm',             en: 'Tourism',          color: '#42c9ff' },
  culture:           { az: 'Mədəniyyət',         en: 'Culture',          color: '#ff9b54' },
  cartography:       { az: 'Coğrafi məlumatlar', en: 'Cartography',      color: '#9aa7c7' },
  security:          { az: 'Təhlükəsizlik',      en: 'Security',         color: '#ff5d6c' },
  hidrometeorologiya:{ az: 'Hidrometeorologiya', en: 'Hydrometeorology', color: '#56d6c0' },
  sport:             { az: 'İdman',              en: 'Sport',            color: '#c0d0f0' },
};

const $ = (sel) => document.querySelector(sel);
const t = (k, p) => I18N.t(k, p);
function catLabel(g) { const c = CATEGORIES[g.name]; return c ? c[I18N.lang] : g.display_name; }
let categoryChartRef = null;
let detailChartRef = null;
let activeCat = '';
let lastQuery = '';

/* ---------- CKAN client ---------- */
async function ckan(action, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/${action}${qs ? '?' + qs : ''}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${action} → HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`${action} → API error`);
  return json.result;
}

function setStatus(state, text) {
  const dot = $('#conn-dot');
  dot.className = 'dot ' + (state === 'ok' ? 'dot--ok' : state === 'err' ? 'dot--err' : 'dot--pending');
  $('#conn-text').textContent = text;
}

/* ---------- Overview / KPIs / category chart ---------- */
async function loadOverview() {
  setStatus('pending', t('status.connecting'));
  const r = await ckan('package_search', {
    rows: 0,
    'facet.field': '["groups","organization","res_format"]',
    'facet.limit': 100,
  });

  const groups = r.search_facets.groups.items;
  const orgs = r.search_facets.organization.items;
  const formats = r.search_facets.res_format.items;
  const csv = (formats.find((f) => f.name.toUpperCase() === 'CSV') || {}).count || 0;

  $('#kpi-datasets').textContent = r.count.toLocaleString();
  $('#kpi-categories').textContent = groups.length;
  $('#kpi-orgs').textContent = orgs.length;
  $('#kpi-csv').textContent = csv.toLocaleString();
  $('#signal-num').textContent = ((groups.find((g) => g.name === 'economics') || {}).count || 0).toLocaleString();

  renderCategoryChart(groups);
  renderChips(groups);

  setStatus('ok', t('status.live'));
  $('#refreshed').textContent = t('status.updated', { time: new Date().toLocaleTimeString() });
}

function renderCategoryChart(groups) {
  const sorted = [...groups].sort((a, b) => b.count - a.count);
  const labels = sorted.map((g) => catLabel(g));
  const data = sorted.map((g) => g.count);
  const colors = sorted.map((g) => CATEGORIES[g.name]?.color || '#4f8cff');
  const slugs = sorted.map((g) => g.name);

  if (categoryChartRef) categoryChartRef.destroy();
  categoryChartRef = new Chart($('#categoryChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6 }] },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => t('cat.tooltip', { n: c.parsed.x }) } } },
      scales: {
        x: { grid: { color: '#26304a' }, ticks: { color: '#93a0bb' } },
        y: { grid: { display: false }, ticks: { color: '#e8edf6' } },
      },
      onClick: (_e, els) => { if (els.length) selectCategory(slugs[els[0].index]); },
    },
  });
}

function renderChips(groups) {
  const wrap = $('#chips');
  const all = `<button class="chip ${activeCat === '' ? 'active' : ''}" data-cat="">${t('chip.all')}</button>`;
  const items = [...groups]
    .sort((a, b) => b.count - a.count)
    .map((g) => {
      const label = catLabel(g);
      return `<button class="chip ${activeCat === g.name ? 'active' : ''}" data-cat="${g.name}">${label} <span style="opacity:.6">${g.count}</span></button>`;
    })
    .join('');
  wrap.innerHTML = all + items;
}

/* ---------- Dataset browsing ---------- */
async function loadDatasets() {
  const results = $('#results');
  results.innerHTML = `<div class="empty"><span class="spinner"></span> ${t('res.loading')}</div>`;
  const params = { rows: 60, sort: 'metadata_modified desc' };
  if (lastQuery) params.q = lastQuery;
  if (activeCat) params.fq = `groups:${activeCat}`;
  try {
    const r = await ckan('package_search', params);
    renderResults(r.results, r.count);
  } catch (e) {
    results.innerHTML = `<div class="empty">${t('res.error', { e: escapeHtml(e.message) })}</div>`;
  }
}

function renderResults(list, total) {
  const results = $('#results');
  if (!list.length) {
    results.innerHTML = `<div class="empty">${t('res.none')}</div>`;
    $('#results-foot').textContent = '';
    return;
  }
  results.innerHTML = list
    .map((p, i) => {
      const fmts = [...new Set((p.resources || []).map((r) => (r.format || '').toUpperCase()).filter(Boolean))];
      const org = p.organization?.title || '';
      const fmtTags = fmts.slice(0, 4).map((f) => `<span class="tag tag--fmt">${f}</span>`).join('');
      return `<div class="card" data-idx="${i}">
        <h3>${escapeHtml(p.title || p.name)}</h3>
        <div class="card-meta">
          ${org ? `<span class="tag">${escapeHtml(org)}</span>` : ''}
          <span class="tag">${t('card.files', { n: (p.resources || []).length })}</span>
          ${fmtTags}
        </div>
      </div>`;
    })
    .join('');
  // attach data for click
  [...results.querySelectorAll('.card')].forEach((el, i) => {
    el.addEventListener('click', () => openDataset(list[i]));
  });
  $('#results-foot').textContent = t('res.showing', { n: list.length, total: total.toLocaleString() });
}

function selectCategory(slug) {
  activeCat = slug;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.cat === slug));
  loadDatasets();
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Dataset detail + auto chart ---------- */
async function openDataset(pkg) {
  const drawer = $('#drawer');
  const backdrop = $('#drawer-backdrop');
  const body = $('#drawer-body');
  drawer.hidden = false; backdrop.hidden = false;

  const csvRes = (pkg.resources || []).find((r) => (r.format || '').toUpperCase() === 'CSV') || (pkg.resources || [])[0];
  const org = pkg.organization?.title || '';
  const portalLang = I18N.lang === 'en' ? 'en' : 'az';
  body.innerHTML = `
    <h2>${escapeHtml(pkg.title || pkg.name)}</h2>
    <div class="sub">${escapeHtml(org)} · ${t('det.resources', { n: (pkg.resources || []).length })}
      · <a href="https://opendata.az/${portalLang}/datasets/${pkg.name}" target="_blank" rel="noopener">${t('det.viewportal')}</a></div>
    ${pkg.notes ? `<p class="muted">${escapeHtml(pkg.notes).slice(0, 320)}</p>` : ''}
    <div id="detail-chart-wrap"><div class="empty"><span class="spinner"></span> ${t('det.loading')}</div></div>`;

  if (!csvRes || !csvRes.url) {
    $('#detail-chart-wrap').innerHTML = `<div class="empty">${t('det.nocsv')}</div>`;
    return;
  }
  try {
    const text = await (await fetch(csvRes.url)).text();
    const parsed = Papa.parse(text.trim(), { header: true, dynamicTyping: false, skipEmptyLines: true });
    renderDetail(parsed.data, parsed.meta.fields || []);
  } catch (e) {
    $('#detail-chart-wrap').innerHTML = `<div class="empty">${t('det.csverror', { e: escapeHtml(e.message) })}</div>`;
  }
}

function renderDetail(rows, fields) {
  const wrap = $('#detail-chart-wrap');
  if (!rows.length || !fields.length) { wrap.innerHTML = `<div class="empty">${t('det.empty')}</div>`; return; }

  const { labelCol, numericCols, isTimeSeries, sortByYear } = analyzeColumns(rows, fields);
  wrap.innerHTML = '<div class="chart-box"><canvas id="detailChart"></canvas></div><div id="detail-table"></div>';

  if (!numericCols.length || !labelCol) {
    wrap.innerHTML = `<div class="empty">${t('det.nonumeric')}</div><div id="detail-table"></div>`;
    renderTable(rows, fields);
    return;
  }

  // Choose rows to plot.
  let viewRows = rows;
  let note = '';
  const maxSeries = isTimeSeries ? 6 : 5;
  if (sortByYear) {
    // Year-over-year: sort ascending by year so the trend reads left→right.
    viewRows = [...rows].filter((r) => String(r[labelCol] ?? '').trim() !== '')
      .sort((a, b) => parseInt(a[labelCol], 10) - parseInt(b[labelCol], 10));
    if (numericCols.length > maxSeries) note = t('det.note.series', { max: maxSeries, total: numericCols.length });
  } else if (!isTimeSeries && rows.length > 25) {
    const key = numericCols[0];
    viewRows = [...rows].sort((a, b) => num(b[key]) - num(a[key])).slice(0, 25);
    note = t('det.note.top', { total: rows.length, key });
  }

  const labels = viewRows.map((r) => r[labelCol]);
  const datasets = numericCols.slice(0, maxSeries).map((col, i) => ({
    label: col,
    data: viewRows.map((r) => num(r[col])),
    backgroundColor: palette(i) + 'cc',
    borderColor: palette(i),
    borderWidth: isTimeSeries ? 2 : 1,
    borderRadius: 5,
    tension: 0.25,
    fill: false,
  }));

  if (detailChartRef) detailChartRef.destroy();
  detailChartRef = new Chart($('#detailChart'), {
    type: isTimeSeries ? 'line' : 'bar',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#e8edf6' } } },
      scales: {
        x: { grid: { color: '#26304a' }, ticks: { color: '#93a0bb', maxRotation: 60, minRotation: 0 } },
        y: { grid: { color: '#26304a' }, ticks: { color: '#93a0bb' } },
      },
    },
  });

  renderTable(rows, fields, note);
}

function renderTable(rows, fields, note = '') {
  const head = fields.map((f) => `<th>${escapeHtml(f)}</th>`).join('');
  const bodyRows = rows.slice(0, 50).map(
    (r) => `<tr>${fields.map((f) => `<td>${escapeHtml(String(r[f] ?? ''))}</td>`).join('')}</tr>`
  ).join('');
  $('#detail-table').innerHTML =
    `${note ? `<div class="dnote">${note}</div>` : ''}
     <table class="dtable"><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table>
     ${rows.length > 50 ? `<div class="dnote">${t('det.table.limit', { total: rows.length })}</div>` : ''}`;
}

/* ---------- Heuristics ---------- */
function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? NaN : n;
}
function isNumericCol(rows, col) {
  let ok = 0, seen = 0;
  for (const r of rows) {
    const v = r[col];
    if (v === '' || v === null || v === undefined) continue;
    seen++;
    if (!isNaN(num(v))) ok++;
  }
  return seen > 0 && ok / seen >= 0.7;
}
function isDateCol(rows, col) {
  const re = /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$|^\d{4}([.\/-]\d{1,2})?$/;
  let ok = 0, seen = 0;
  for (const r of rows) {
    const v = String(r[col] ?? '').trim();
    if (!v) continue;
    seen++;
    if (re.test(v)) ok++;
  }
  return seen > 0 && ok / seen >= 0.7;
}
// A "year column": >=80% of values are integers in 1900..2100, with several distinct values.
function isYearCol(rows, col) {
  let ok = 0, seen = 0;
  const distinct = new Set();
  for (const r of rows) {
    const raw = String(r[col] ?? '').trim();
    if (!raw) continue;
    seen++;
    const n = parseInt(raw, 10);
    if (String(n) === raw && n >= 1900 && n <= 2100) { ok++; distinct.add(n); }
  }
  return seen >= 3 && distinct.size >= 3 && ok / seen >= 0.8;
}

function analyzeColumns(rows, fields) {
  const sample = rows.slice(0, 300);
  const usable = fields.filter((f) => f && f.trim() !== ''); // drop blank/unnamed columns

  const yearCol = usable.find((f) => isYearCol(sample, f)) || null;
  const numericAll = usable.filter((f) => f !== yearCol && isNumericCol(sample, f));
  const dateCols = usable.filter((f) => f !== yearCol && isDateCol(sample, f) && !numericAll.includes(f));
  const textCols = usable.filter((f) => f !== yearCol && !numericAll.includes(f) && !dateCols.includes(f));

  // x-axis preference: explicit year column > varying date column > first text column.
  let labelCol = null, isTimeSeries = false, sortByYear = false;
  if (yearCol) { labelCol = yearCol; isTimeSeries = true; sortByYear = true; }
  else {
    const varyingDate = dateCols.find((c) => new Set(sample.map((r) => r[c])).size > 1);
    if (varyingDate) { labelCol = varyingDate; isTimeSeries = true; }
    else labelCol = textCols[0] || dateCols[0] || usable[0] || fields[0];
  }

  return { labelCol, numericCols: numericAll.filter((c) => c !== labelCol), isTimeSeries, sortByYear };
}
function palette(i) {
  const p = ['#4f8cff', '#2fb8a3', '#ffb547', '#ff6b8a', '#b48cff'];
  return p[i % p.length];
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Economy insight: sector demand ---------- */
const EMP_RESOURCE_ID = 'c31bc5d7-37fd-467a-b4ec-68f464ef3381';
const SECTOR_EN = {
  'Kənd təsərrüfatı, meşə təsərrüfatı və balıqçılıq': 'Agriculture, forestry & fishing',
  'Mədənçıxarma sənayesi': 'Mining & quarrying',
  'Emal sənayesi': 'Manufacturing',
  'Elektrik enerjisi, qaz və buxar istehsalı, bölüşdürülməsi və təchizatı': 'Electricity, gas & steam',
  'Su təchizatı, tullantıların təmizlənməsi və emalı': 'Water supply & waste mgmt',
  'Tikinti': 'Construction',
  'Ticarət, nəqliyyat vasitələrinin təmiri': 'Trade & vehicle repair',
  'Nəqliyyat və anbar təsərrüfatı': 'Transport & storage',
  'Turistlərin yerləşdirilməsi və ictimai iaşə': 'Hospitality (tourism & catering)',
  'İnformasiya və rabitə': 'Information & communication (IT/telecom)',
  'Maliyyə və sığorta fəaliyyəti': 'Finance & insurance',
  'Daşınmaz əmlakla əlaqədar əməliyyatlar': 'Real estate',
  'Peşə, elmi və texniki fəaliyyət': 'Professional, scientific & technical',
  'İnzibati və yardımçı xidmətlərin göstərilməsi': 'Administrative & support services',
  'Dövlət idarəetməsi və müdafiə, sosial təminat': 'Public administration & defence',
  'Təhsil': 'Education',
  'Əhaliyə səhiyyə və sosial xidmətlərin göstərilməsi': 'Health & social work',
  'İstirahət, əyləncə və incəsənət sahəsində fəaliyyət': 'Arts, entertainment & recreation',
  'Digər sahələrdə xidmətlərin göstərilməsi': 'Other services',
};
function sectorLabel(col) {
  const base = col.replace(/\(min nəfər\)/i, '').trim();
  return I18N.lang === 'en' ? (SECTOR_EN[base] || base) : base;
}

async function loadEconomyInsights() {
  const take = $('#econ-takeaway');
  take.innerHTML = `${t('econ.loading')} <span class="spinner"></span>`;
  try {
    const r = await ckan('package_search', { q: 'İqtisadi Fəaliyyət Növləri Təsnifatı üzrə məşğul əhalinin sayı', rows: 5 });
    let res = null;
    for (const p of r.results) {
      const c = (p.resources || []).find((x) => x.id === EMP_RESOURCE_ID);
      if (c) { res = c; break; }
    }
    if (!res) res = (r.results[0]?.resources || []).find((x) => (x.format || '').toUpperCase() === 'CSV');
    if (!res || !res.url) throw new Error('employment dataset not found');

    const text = await (await fetch(res.url)).text();
    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    renderEconomy(parsed.data, parsed.meta.fields || []);
  } catch (e) {
    take.innerHTML = t('econ.error', { e: escapeHtml(e.message) });
  }
}

function renderEconomy(rows, fields) {
  const yearCol = fields.find((f) => f && isYearCol(rows, f));
  if (!yearCol) { $('#econ-takeaway').textContent = t('econ.noyear'); return; }

  const sectorCols = fields.filter(
    (f) => f && f !== yearCol && isNumericCol(rows, f) && !/cəmi/i.test(f)
  );
  const byYear = {};
  rows.forEach((r) => { const y = parseInt(r[yearCol], 10); if (y >= 1900 && y <= 2100) byYear[y] = r; });
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (years.length < 2) { $('#econ-takeaway').textContent = t('econ.fewyears'); return; }

  const latest = years[years.length - 1];
  let base = latest - 5;
  while (!byYear[base] && base < latest) base++;        // nearest available year ≥ latest-5
  if (!byYear[base]) base = years[0];
  const desc = $('#econ-desc');
  desc.innerHTML = t('econ.desc', { range: `${base} → ${latest}` });
  desc.dataset.ready = '1';

  const items = [];
  for (const col of sectorCols) {
    const a = num(byYear[base][col]); const b = num(byYear[latest][col]);
    if (!isNaN(a) && !isNaN(b) && a > 0) items.push({ col, name: sectorLabel(col), g: (b - a) / a * 100, a, b });
  }
  items.sort((x, y) => y.g - x.g);

  // Keep everything needed for per-sector drill-down on click.
  const totalCol = fields.find((f) => /cəmi/i.test(f)) || null;
  window.__econData = { years, byYear, yearCol, totalCol, base, latest, items };

  // Takeaway: name the top movers.
  const top = items.slice(0, 3);
  const fmt = (n) => (n >= 0 ? '+' : '') + n.toFixed(0) + '%';
  const list = top.map((it) => `<b>${escapeHtml(it.name)}</b> (${fmt(it.g)})`).join(', ');
  $('#econ-takeaway').innerHTML = t('econ.takeaway', { base, latest, list });

  const labels = items.map((i) => i.name);
  const data = items.map((i) => +i.g.toFixed(1));
  const colors = items.map((i) => (i.g >= 0 ? 'rgba(126,217,87,.85)' : 'rgba(255,93,108,.85)'));

  if (window.__econChart) window.__econChart.destroy();
  window.__econChart = new Chart($('#econChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 5 }] },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => {
          const it = items[c.dataIndex];
          return t('econ.tooltip', { sign: c.parsed.x >= 0 ? '+' : '', x: c.parsed.x, a: it.a, b: it.b });
        } } },
      },
      scales: {
        x: { grid: { color: '#26304a' }, ticks: { color: '#93a0bb', callback: (v) => v + '%' }, title: { display: true, text: t('econ.axis', { base, latest }), color: '#93a0bb' } },
        y: { grid: { display: false }, ticks: { color: '#e8edf6', font: { size: 11 } } },
      },
      onClick: (_e, els) => { if (els.length) openSectorDetail(items[els[0].index]); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    },
  });
}

// Click a sector bar → full data-driven explanation in the drawer.
function openSectorDetail(item) {
  const d = window.__econData;
  if (!d || !item) return;
  const { years, byYear, totalCol, latest } = d;

  // Full employment series for this sector across every available year.
  const series = years.map((y) => num(byYear[y][item.col]));
  const valLatest = num(byYear[latest][item.col]);
  const valFirst = series.find((v) => !isNaN(v));
  const yearFirst = years[series.findIndex((v) => !isNaN(v))];

  // Helper: growth between two years if both exist.
  const growthBetween = (y0, y1) => {
    const a = byYear[y0] ? num(byYear[y0][item.col]) : NaN;
    const b = byYear[y1] ? num(byYear[y1][item.col]) : NaN;
    return (!isNaN(a) && !isNaN(b) && a > 0) ? (b - a) / a * 100 : null;
  };
  const g5 = growthBetween(latest - 5, latest);
  const g10 = growthBetween(latest - 10, latest);
  const gAll = (valFirst && valFirst > 0) ? (valLatest - valFirst) / valFirst * 100 : null;

  // Acceleration: last 5y vs the previous 5y.
  const gPrev5 = growthBetween(latest - 10, latest - 5);
  let momentum = '';
  if (g5 != null && gPrev5 != null) {
    if (g5 > gPrev5 + 2) momentum = t('mom.accelerating');
    else if (g5 < gPrev5 - 2) momentum = t('mom.slowing');
    else momentum = t('mom.steady');
  }

  // Share of total employment.
  let share = null;
  if (totalCol && byYear[latest]) {
    const tot = num(byYear[latest][totalCol]);
    if (tot > 0) share = valLatest / tot * 100;
  }

  // Ranks among sectors.
  const byGrowth = [...d.items].sort((a, b) => b.g - a.g);
  const bySize = [...d.items].sort((a, b) => b.b - a.b);
  const rankGrowth = byGrowth.findIndex((x) => x.col === item.col) + 1;
  const rankSize = bySize.findIndex((x) => x.col === item.col) + 1;
  const n = d.items.length;

  const pct = (v) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');

  // Data-driven narrative.
  const verdict = (() => {
    const fast = item.g >= 15, grow = item.g > 0, big = share != null && share >= 8;
    const shareStr = share != null ? t('share.of', { x: share.toFixed(1) }) : t('share.minor');
    if (!grow) return t('verdict.contracting', { g: pct(item.g), base: d.base, latest });
    if (fast && !big) return t('verdict.emerging', { share: shareStr });
    if (fast && big) return t('verdict.bigfast', { g: pct(item.g) });
    if (grow && big) return t('verdict.mature', { g: pct(item.g) });
    return t('verdict.moderate', { g: pct(item.g) });
  })();

  $('#drawer').hidden = false;
  $('#drawer-backdrop').hidden = false;
  $('#drawer-body').innerHTML = `
    <h2>${escapeHtml(item.name)}</h2>
    <div class="sub">${t('sec.sub', { first: yearFirst, latest })}</div>

    <div class="stat-grid">
      <div class="stat"><div class="stat-v">${valLatest.toLocaleString()}<span class="stat-u"> ${t('sec.unit')}</span></div><div class="stat-l">${t('sec.employed', { year: latest })}</div></div>
      <div class="stat"><div class="stat-v">${pct(g5)}</div><div class="stat-l">${t('sec.5y')}</div></div>
      <div class="stat"><div class="stat-v">${pct(g10)}</div><div class="stat-l">${t('sec.10y')}</div></div>
      <div class="stat"><div class="stat-v">${share != null ? share.toFixed(1) + '%' : '—'}</div><div class="stat-l">${t('sec.share')}</div></div>
    </div>

    <div class="takeaway">${verdict}</div>

    <ul class="bullets">
      <li>${t('sec.rank', { rg: rankGrowth, rs: rankSize, n })}</li>
      <li>${valFirst != null ? t('sec.since', { year: yearFirst, a: valFirst.toLocaleString(), b: valLatest.toLocaleString(), g: pct(gAll) }) : '—'}</li>
      ${momentum ? `<li>${t('sec.momentum', { m: momentum, g5: pct(g5), gp: pct(gPrev5) })}</li>` : ''}
    </ul>

    <div class="chart-box" style="height:300px"><canvas id="sectorChart"></canvas></div>
    <p class="dnote">${t('sec.chartnote', { name: escapeHtml(item.name) })}</p>
  `;

  if (window.__sectorChart) window.__sectorChart.destroy();
  window.__sectorChart = new Chart($('#sectorChart'), {
    type: 'line',
    data: {
      labels: years,
      datasets: [{
        label: item.name,
        data: series,
        borderColor: item.g >= 0 ? '#7ed957' : '#ff5d6c',
        backgroundColor: (item.g >= 0 ? 'rgba(126,217,87,.15)' : 'rgba(255,93,108,.15)'),
        borderWidth: 2, tension: 0.25, fill: true, pointRadius: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => t('sec.tooltip', { y: c.parsed.y }) } } },
      scales: {
        x: { grid: { color: '#26304a' }, ticks: { color: '#93a0bb' } },
        y: { grid: { color: '#26304a' }, ticks: { color: '#93a0bb' } },
      },
    },
  });
}

/* ---------- Wiring ---------- */
function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-backdrop').hidden = true;
  if (detailChartRef) { detailChartRef.destroy(); detailChartRef = null; }
  if (window.__sectorChart) { window.__sectorChart.destroy(); window.__sectorChart = null; }
}

function debounce(fn, ms) { let timer; return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); }; }

// Apply translations to all static [data-i18n*] elements + reflect active language.
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPh)); });
  document.documentElement.lang = I18N.lang;
  document.querySelectorAll('.lang-btn').forEach((b) => b.classList.toggle('active', b.dataset.lang === I18N.lang));
  // econ description carries a dynamic range; show a placeholder until data loads.
  const desc = $('#econ-desc');
  if (desc && !desc.dataset.ready) desc.innerHTML = t('econ.desc', { range: '…' });
}

function switchLang(l) {
  if (l === I18N.lang) return;
  I18N.set(l);
  applyStaticI18n();
  closeDrawer();
  loadOverview().catch((e) => setStatus('err', t('status.failed', { e: e.message })));
  loadEconomyInsights();
  loadDatasets();
}

function init() {
  applyStaticI18n();
  $('.lang').addEventListener('click', (e) => {
    const b = e.target.closest('.lang-btn');
    if (b) switchLang(b.dataset.lang);
  });

  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) selectCategory(b.dataset.cat);
  });
  document.querySelectorAll('[data-cat]').forEach((el) => {
    if (el.classList.contains('btn')) el.addEventListener('click', () => selectCategory(el.dataset.cat));
  });
  $('#search').addEventListener('input', debounce((e) => { lastQuery = e.target.value.trim(); loadDatasets(); }, 350));

  loadOverview().catch((e) => setStatus('err', t('status.failed', { e: e.message })));
  loadEconomyInsights();
  loadDatasets();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
