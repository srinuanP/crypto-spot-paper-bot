const AUTO_REFRESH_KEY = 'dashboard.autoRefresh';
const THEME_KEY = 'dashboard.theme';
const REFRESH_INTERVAL_MS = 30_000;
const LOG_LIMIT = 400;
const PAPER_ROW_LIMIT = 6000;
const TRADE_ROW_LIMIT = 200;

const S = {
  theme: 'light',
  autoRefresh: true,
  executionMode: 'paper',
  validateOnly: true,
  report: null,
  reportSig: '',
  paperRows: [],
  trades: [],
  filteredTrades: [],
  tradePage: 1,
  pageSize: 25,
  filters: { search: '', symbol: '', strategy: '', side: '', sort: 'timeDesc' },
  logLines: [],
  queuedLogEvents: [],
  logPaused: false,
  paperTailLoaded: false,
  sseStatus: 'connecting',
  sseSource: null,
  paperMessage: '',
  timer: null,
  lastUpdated: { health: null, report: null, journal: null, paper: null }
};

const E = {
  modeBadge: document.getElementById('modeBadge'),
  validateBadge: document.getElementById('validateBadge'),
  sseBadge: document.getElementById('sseBadge'),
  healthBadge: document.getElementById('healthBadge'),
  reportBadge: document.getElementById('reportBadge'),
  journalBadge: document.getElementById('journalBadge'),
  paperBadge: document.getElementById('paperBadge'),
  paperMessage: document.getElementById('paperMessage'),
  summarySkeleton: document.getElementById('summarySkeleton'),
  summaryCards: document.getElementById('summaryCards'),
  summaryEmpty: document.getElementById('summaryEmpty'),
  tradesMeta: document.getElementById('tradesMeta'),
  tradesBody: document.getElementById('tradesBody'),
  journalView: document.getElementById('journalView'),
  liveLog: document.getElementById('liveLog'),
  lastUpdatedText: document.getElementById('lastUpdatedText'),
  refreshBtn: document.getElementById('refreshBtn'),
  themeToggle: document.getElementById('themeToggle'),
  autoRefreshToggle: document.getElementById('autoRefreshToggle'),
  openLogDrawerBtn: document.getElementById('openLogDrawerBtn'),
  closeLogDrawerBtn: document.getElementById('closeLogDrawerBtn'),
  pauseLogBtn: document.getElementById('pauseLogBtn'),
  clearLogBtn: document.getElementById('clearLogBtn'),
  logDrawer: document.getElementById('logDrawer'),
  logDrawerBackdrop: document.getElementById('logDrawerBackdrop'),
  toastRegion: document.getElementById('toastRegion'),
  tradeSearch: document.getElementById('tradeSearch'),
  filterSymbol: document.getElementById('filterSymbol'),
  filterStrategy: document.getElementById('filterStrategy'),
  filterSide: document.getElementById('filterSide'),
  sortTrades: document.getElementById('sortTrades'),
  pageSize: document.getElementById('pageSize'),
  clearFiltersBtn: document.getElementById('clearFiltersBtn'),
  prevPageBtn: document.getElementById('prevPageBtn'),
  nextPageBtn: document.getElementById('nextPageBtn'),
  pageInfo: document.getElementById('pageInfo')
};

const F = {
  num(v, d = 2) {
    if (typeof v !== 'number' || Number.isNaN(v)) return '-';
    if (!Number.isFinite(v)) return 'INF';
    return v.toFixed(d);
  },
  pct(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return '-';
    return `${(v * 100).toFixed(2)}%`;
  },
  date(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
  },
  time(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '-' : d.toLocaleTimeString();
  }
};

function badge(el, tone, text) {
  el.classList.remove('badge-neutral', 'badge-success', 'badge-warning', 'badge-danger');
  if (tone === 'success') el.classList.add('badge-success');
  else if (tone === 'warning') el.classList.add('badge-warning');
  else if (tone === 'danger') el.classList.add('badge-danger');
  else el.classList.add('badge-neutral');
  el.textContent = text;
}

function toast(msg, tone = 'success') {
  const n = document.createElement('div');
  n.className = `toast ${tone}`;
  n.textContent = msg;
  E.toastRegion.appendChild(n);
  window.setTimeout(() => n.remove(), 2600);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function getJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return { ok: res.ok, status: res.status, body: await res.json() };
  } catch (error) {
    return { ok: false, status: 0, body: { ok: false, message: error instanceof Error ? error.message : String(error) } };
  }
}

function signature(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '0';
  const step = Math.max(1, Math.floor(arr.length / 24));
  let acc = 0;
  for (let i = 0; i < arr.length; i += step) acc += (Number(arr[i]) || 0) * (i + 1);
  return `${arr.length}:${Number(arr[0] || 0).toFixed(4)}:${Number(arr.at(-1) || 0).toFixed(4)}:${acc.toFixed(2)}`;
}

function drawdown(curve) {
  if (!Array.isArray(curve) || curve.length === 0) return [];
  let peak = Number(curve[0]) || 0;
  return curve.map((v) => {
    const cur = Number(v) || 0;
    if (cur > peak) peak = cur;
    if (peak <= 0) return 0;
    return (cur - peak) / peak;
  });
}

function createChart(canvas, tooltip, options) {
  const ctx = canvas.getContext('2d');
  const pad = { t: 20, r: 16, b: 30, l: 58 };
  let data = [];
  let sig = '0';
  let hover = -1;

  const col = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;

  function fit() {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const w = Math.max(280, Math.floor(canvas.clientWidth || 0));
    const h = Number(canvas.getAttribute('height') || 240);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { w, h };
  }

  function pt(i, v, min, max, w, h) {
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;
    return {
      x: pad.l + (i / Math.max(1, data.length - 1)) * cw,
      y: pad.t + ch - ((v - min) / Math.max(1e-9, max - min)) * ch
    };
  }
  function grid(w, h, min, max) {
    const ch = h - pad.t - pad.b;
    const cw = w - pad.l - pad.r;
    ctx.strokeStyle = col('--border', '#d4dde8');
    ctx.lineWidth = 1;
    ctx.font = '12px "IBM Plex Sans", sans-serif';
    ctx.fillStyle = col('--muted', '#526479');
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.t + (i / 4) * ch;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(options.format(max - ((max - min) * i) / 4), 8, y + 4);
    }
    ctx.fillText('1', pad.l, h - 8);
    ctx.fillText(String(data.length), w - pad.r - 26, h - 8);
    ctx.fillStyle = col('--text', '#13253b');
    ctx.font = '600 12px "IBM Plex Sans", sans-serif';
    ctx.fillText(options.label, w - pad.r - 130, 14);
    return cw > 0;
  }

  function paint(active) {
    const { w, h } = fit();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = col('--surface-elevated', '#fcfdff');
    ctx.fillRect(0, 0, w, h);
    if (data.length < 2) {
      ctx.fillStyle = col('--muted', '#526479');
      ctx.font = '14px "IBM Plex Sans", sans-serif';
      ctx.fillText('ยังไม่มีข้อมูลเพียงพอสำหรับกราฟ', 18, 34);
      tooltip.classList.add('hidden');
      return;
    }

    const min0 = Math.min(...data);
    const max0 = Math.max(...data);
    const span = Math.max(1e-9, max0 - min0);
    const min = min0 - span * 0.12;
    const max = max0 + span * 0.12;
    if (!grid(w, h, min, max)) return;

    const color = col(options.colorVar, '#0a7b82');
    const bottom = h - pad.b;
    const grad = ctx.createLinearGradient(0, pad.t, 0, bottom);
    grad.addColorStop(0, `${color}4d`);
    grad.addColorStop(1, `${color}06`);

    ctx.beginPath();
    data.forEach((v, i) => {
      const p = pt(i, v, min, max, w, h);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.lineTo(w - pad.r, bottom);
    ctx.lineTo(pad.l, bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    data.forEach((v, i) => {
      const p = pt(i, v, min, max, w, h);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (active >= 0 && active < data.length) {
      const p = pt(active, data[active], min, max, w, h);
      ctx.beginPath();
      ctx.moveTo(p.x, pad.t);
      ctx.lineTo(p.x, bottom);
      ctx.strokeStyle = col('--muted', '#526479');
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = col('--surface', '#ffffff');
      ctx.stroke();
      tooltip.innerHTML = `<strong>${options.label}</strong><div>${options.format(data[active])}</div><div>จุดที่ ${active + 1}/${data.length}</div>`;
      tooltip.classList.remove('hidden');
      tooltip.style.left = `${Math.min(w - 180, Math.max(8, p.x + 10))}px`;
      tooltip.style.top = `${Math.max(8, p.y - 46)}px`;
    } else {
      tooltip.classList.add('hidden');
    }
  }

  canvas.addEventListener('mousemove', (ev) => {
    if (data.length < 2) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const cw = rect.width - pad.l - pad.r;
    const idx = Math.round(((x - pad.l) / Math.max(1, cw)) * (data.length - 1));
    hover = Math.max(0, Math.min(data.length - 1, idx));
    paint(hover);
  });
  canvas.addEventListener('mouseleave', () => {
    hover = -1;
    paint(-1);
  });
  new ResizeObserver(() => paint(hover)).observe(canvas);

  return {
    set(values) {
      const clean = Array.isArray(values) ? values.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : [];
      const next = signature(clean);
      if (next === sig) return;
      data = clean;
      sig = next;
      hover = -1;
      paint(-1);
    },
    redraw() {
      paint(hover);
    }
  };
}

const charts = {
  equity: createChart(document.getElementById('equityCanvas'), document.getElementById('equityTooltip'), {
    label: 'Equity',
    colorVar: '--accent',
    format: (v) => F.num(v, 2)
  }),
  drawdown: createChart(document.getElementById('drawdownCanvas'), document.getElementById('drawdownTooltip'), {
    label: 'Drawdown',
    colorVar: '--danger',
    format: (v) => `${(v * 100).toFixed(2)}%`
  })
};

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  S.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  E.themeToggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
  charts.equity.redraw();
  charts.drawdown.redraw();
}

function renderSummary(report) {
  E.summarySkeleton.classList.add('hidden');
  if (!report || !report.metrics) {
    E.summaryCards.classList.add('hidden');
    E.summaryEmpty.classList.remove('hidden');
    badge(E.reportBadge, 'warning', 'Report: Not found');
    return;
  }

  const t = Array.isArray(report.trades) ? report.trades : [];
  const pnl = t.map((x) => Number(x?.pnl)).filter((x) => Number.isFinite(x));
  let exp = null;
  if (pnl.length > 0) {
    const wins = pnl.filter((x) => x > 0);
    const losses = pnl.filter((x) => x < 0).map((x) => Math.abs(x));
    const wr = wins.length / pnl.length;
    const aw = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const al = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
    exp = wr * aw - (1 - wr) * al;
  }

  const cards = [
    ['Total Return', F.pct(report.metrics.totalReturn), report.metrics.totalReturn >= 0 ? 'pos' : 'neg'],
    ['Max Drawdown', F.pct(report.metrics.maxDrawdown), 'neg'],
    ['Win Rate', F.pct(report.metrics.winRate), ''],
    ['Profit Factor', F.num(report.metrics.profitFactor, 2), ''],
    ['Trades', String(report.metrics.numberOfTrades ?? '-'), ''],
    ['Expectancy', exp === null ? '-' : F.num(exp, 4), exp === null ? '' : (exp >= 0 ? 'pos' : 'neg')],
    ['Report Time', report.generatedAt ? F.date(report.generatedAt) : '-', ''],
    ['Last Sync', F.date(S.lastUpdated.report), '']
  ];

  E.summaryCards.innerHTML = cards.map(([label, value, tone]) => `
    <article class="metric-card">
      <div class="metric-label">${label}</div>
      <div class="metric-value${tone ? ` ${tone}` : ''}">${value}</div>
    </article>
  `).join('');

  E.summaryCards.classList.remove('hidden');
  E.summaryEmpty.classList.add('hidden');
  badge(E.reportBadge, 'success', `Report: ${report.strategy || 'Loaded'}`);
}

function updateCharts(report) {
  const equity = Array.isArray(report?.equityCurve) ? report.equityCurve : [];
  charts.equity.set(equity);
  charts.drawdown.set(drawdown(equity));
}
function normalizeTrades(rows, report) {
  const strategyFallback = rows.filter((r) => r.event === 'CONFIG').map((r) => r.strategy).filter(Boolean).at(-1) || report?.strategy || '';
  const symbolFallback = report?.symbol || '';

  const fromPaper = rows
    .filter((r) => r.event === 'BUY' || r.event === 'SELL')
    .slice(-TRADE_ROW_LIMIT)
    .map((r, i) => ({
      id: `${r.ts || 0}-${r.event}-${i}`,
      ts: Number(r.ts || 0),
      symbol: r.symbol || symbolFallback,
      strategy: r.strategy || strategyFallback,
      side: r.event,
      price: Number(r.fill || r.price || 0),
      qty: Number(r.qty || 0),
      pnl: typeof r.realizedPnl === 'number' ? r.realizedPnl : null,
      reason: r.reason || ''
    }));

  if (fromPaper.length > 0) return fromPaper.sort((a, b) => b.ts - a.ts);
  if (!Array.isArray(report?.trades)) return [];

  return report.trades.slice(-TRADE_ROW_LIMIT).map((t, i) => ({
    id: `${t.exitTime || t.entryTime || 0}-${i}`,
    ts: Number(t.exitTime || t.entryTime || 0),
    symbol: report.symbol || '',
    strategy: report.strategy || '',
    side: 'SELL',
    price: Number(t.exitPrice || 0),
    qty: Number(t.qty || 0),
    pnl: Number.isFinite(Number(t.pnl)) ? Number(t.pnl) : null,
    reason: t.reason || ''
  })).sort((a, b) => b.ts - a.ts);
}

function updateFilterOptions() {
  const symbols = Array.from(new Set(S.trades.map((x) => x.symbol).filter(Boolean))).sort();
  const strategies = Array.from(new Set(S.trades.map((x) => x.strategy).filter(Boolean))).sort();
  const selSymbol = S.filters.symbol;
  const selStrategy = S.filters.strategy;

  E.filterSymbol.innerHTML = `<option value="">All</option>${symbols.map((v) => `<option value="${v}">${v}</option>`).join('')}`;
  E.filterStrategy.innerHTML = `<option value="">All</option>${strategies.map((v) => `<option value="${v}">${v}</option>`).join('')}`;
  E.filterSymbol.value = selSymbol;
  E.filterStrategy.value = selStrategy;
}

function filteredTrades() {
  const q = S.filters.search.trim().toLowerCase();
  const rows = S.trades.filter((t) => {
    if (S.filters.symbol && t.symbol !== S.filters.symbol) return false;
    if (S.filters.strategy && t.strategy !== S.filters.strategy) return false;
    if (S.filters.side && t.side !== S.filters.side) return false;
    if (!q) return true;
    return `${t.symbol} ${t.strategy} ${t.side} ${t.reason}`.toLowerCase().includes(q);
  });

  rows.sort((a, b) => {
    if (S.filters.sort === 'timeAsc') return a.ts - b.ts;
    if (S.filters.sort === 'pnlDesc') return (b.pnl ?? Number.NEGATIVE_INFINITY) - (a.pnl ?? Number.NEGATIVE_INFINITY);
    if (S.filters.sort === 'pnlAsc') return (a.pnl ?? Number.POSITIVE_INFINITY) - (b.pnl ?? Number.POSITIVE_INFINITY);
    return b.ts - a.ts;
  });
  return rows;
}

let tradeRenderQueued = false;
function renderTrades(resetPage = false) {
  if (resetPage) S.tradePage = 1;
  if (tradeRenderQueued) return;
  tradeRenderQueued = true;
  requestAnimationFrame(() => {
    tradeRenderQueued = false;
    S.filteredTrades = filteredTrades();
    const total = S.filteredTrades.length;
    const pages = Math.max(1, Math.ceil(total / S.pageSize));
    S.tradePage = Math.min(S.tradePage, pages);
    const start = (S.tradePage - 1) * S.pageSize;
    const rows = S.filteredTrades.slice(start, start + S.pageSize);

    E.tradesBody.innerHTML = '';
    if (rows.length === 0) {
      E.tradesBody.innerHTML = '<tr><td colspan="8" class="empty-row">ไม่พบรายการตามเงื่อนไขที่เลือก</td></tr>';
    } else {
      for (const row of rows) {
        const tr = document.createElement('tr');
        const pnlClass = typeof row.pnl === 'number' ? (row.pnl >= 0 ? 'pnl-positive' : 'pnl-negative') : '';
        const sideClass = row.side === 'BUY' ? 'side-buy' : 'side-sell';
        tr.innerHTML = `
          <td>${F.date(row.ts)}</td>
          <td>${row.symbol || '-'}</td>
          <td>${row.strategy || '-'}</td>
          <td><span class="side-chip ${sideClass}">${row.side || '-'}</span></td>
          <td>${F.num(row.price, 4)}</td>
          <td>${F.num(row.qty, 6)}</td>
          <td class="${pnlClass}">${typeof row.pnl === 'number' ? F.num(row.pnl, 4) : '-'}</td>
          <td>${row.reason || '-'}</td>
        `;
        E.tradesBody.appendChild(tr);
      }
    }

    const from = total === 0 ? 0 : start + 1;
    const to = Math.min(total, start + S.pageSize);
    E.tradesMeta.textContent = `แสดง ${from}-${to} จาก ${total} รายการ (ทั้งหมด ${S.trades.length})`;
    E.pageInfo.textContent = `Page ${S.tradePage}/${pages}`;
    E.prevPageBtn.disabled = S.tradePage <= 1;
    E.nextPageBtn.disabled = S.tradePage >= pages;
  });
}

let logRenderQueued = false;
function renderLog() {
  if (logRenderQueued) return;
  logRenderQueued = true;
  requestAnimationFrame(() => {
    logRenderQueued = false;
    E.liveLog.textContent = S.logLines.join('\n');
    E.liveLog.scrollTop = E.liveLog.scrollHeight;
  });
}

function refreshLastUpdated() {
  const p = [];
  if (S.lastUpdated.report) p.push(`report ${F.time(S.lastUpdated.report)}`);
  if (S.lastUpdated.paper) p.push(`paper ${F.time(S.lastUpdated.paper)}`);
  if (S.lastUpdated.journal) p.push(`journal ${F.time(S.lastUpdated.journal)}`);
  if (S.lastUpdated.health) p.push(`health ${F.time(S.lastUpdated.health)}`);
  E.lastUpdatedText.textContent = p.length > 0 ? `Last updated: ${p.join(' | ')}` : 'Last updated: -';
}

function renderPaperStatus() {
  if (!S.paperTailLoaded) badge(E.paperBadge, 'warning', 'Paper: Waiting');
  else if (S.logPaused) badge(E.paperBadge, 'warning', 'Paper: Paused');
  else badge(E.paperBadge, 'success', 'Paper: Streaming');
  E.paperMessage.textContent = S.paperMessage;
}

function onPaperLine(line, row) {
  if (S.logPaused) {
    S.queuedLogEvents.push({ line, row });
    if (S.queuedLogEvents.length > LOG_LIMIT) S.queuedLogEvents = S.queuedLogEvents.slice(-LOG_LIMIT);
    S.paperMessage = `Paused (${S.queuedLogEvents.length} queued)`;
    renderPaperStatus();
    return;
  }

  S.logLines.push(line);
  if (S.logLines.length > LOG_LIMIT) S.logLines = S.logLines.slice(-LOG_LIMIT);
  renderLog();

  if (row && typeof row === 'object') {
    S.paperRows.push(row);
    if (S.paperRows.length > PAPER_ROW_LIMIT) S.paperRows = S.paperRows.slice(-PAPER_ROW_LIMIT);
    S.lastUpdated.paper = Date.now();
    S.paperMessage = `Events: ${S.paperRows.length}`;
    S.trades = normalizeTrades(S.paperRows, S.report);
    updateFilterOptions();
    renderTrades(false);
  }

  renderPaperStatus();
  refreshLastUpdated();
}
function setSseStatus(status) {
  if (S.sseStatus === status) return;
  S.sseStatus = status;
  if (status === 'connected') {
    badge(E.sseBadge, 'success', 'SSE: Connected');
    toast('Paper stream connected', 'success');
  } else if (status === 'reconnecting') {
    badge(E.sseBadge, 'warning', 'SSE: Reconnecting');
    toast('SSE reconnecting...', 'warning');
  } else {
    badge(E.sseBadge, 'danger', 'SSE: Disconnected');
    toast('SSE disconnected', 'danger');
  }
}

function renderMode() {
  if (S.executionMode === 'testnet') {
    badge(E.modeBadge, 'warning', 'Mode: TESTNET');
    badge(E.validateBadge, S.validateOnly ? 'warning' : 'danger', S.validateOnly ? 'Validate-only: ON' : 'Validate-only: OFF');
    return;
  }
  badge(E.modeBadge, 'success', 'Mode: PAPER');
  badge(E.validateBadge, 'success', 'Paper simulation');
}

async function loadRuntimeStatus() {
  const r = await getJson('/api/runtime/status');
  if (!r.ok || !r.body?.ok) {
    S.executionMode = 'paper';
    S.validateOnly = true;
  } else {
    S.executionMode = r.body?.data?.executionMode === 'testnet' ? 'testnet' : 'paper';
    S.validateOnly = typeof r.body?.data?.validateOnly === 'boolean' ? r.body.data.validateOnly : S.executionMode === 'paper';
  }
  renderMode();
}

async function loadHealth() {
  const r = await getJson('/api/health');
  if (!r.ok || !r.body?.ok) {
    badge(E.healthBadge, 'danger', 'Health: Offline');
    return;
  }
  S.lastUpdated.health = Date.now();
  badge(E.healthBadge, 'success', 'Health: OK');
}

async function loadReport() {
  E.summarySkeleton.classList.remove('hidden');
  const r = await getJson('/api/report/latest');
  E.summarySkeleton.classList.add('hidden');
  if (!r.ok || !r.body?.ok) {
    S.report = null;
    S.reportSig = 'none';
    renderSummary(null);
    charts.equity.set([]);
    charts.drawdown.set([]);
    return;
  }

  const next = r.body.data;
  const sig = JSON.stringify({
    strategy: next?.strategy,
    generatedAt: next?.generatedAt,
    metrics: next?.metrics,
    equityLen: Array.isArray(next?.equityCurve) ? next.equityCurve.length : 0
  });

  S.lastUpdated.report = Date.now();
  if (sig !== S.reportSig) {
    S.reportSig = sig;
    S.report = next;
    renderSummary(next);
    updateCharts(next);
    S.trades = normalizeTrades(S.paperRows, S.report);
    updateFilterOptions();
    renderTrades(false);
  } else {
    renderSummary(next);
  }
}

async function loadPaperTail() {
  const r = await getJson('/api/paper/tail?lines=500');
  if (!r.ok || !r.body?.ok) {
    S.paperRows = [];
    S.paperMessage = 'ไม่สามารถอ่าน paper-log.jsonl';
    renderPaperStatus();
    return;
  }

  const items = Array.isArray(r.body.items) ? r.body.items : [];
  S.paperRows = items.slice(-PAPER_ROW_LIMIT);
  S.paperTailLoaded = true;
  S.lastUpdated.paper = Date.now();
  S.paperMessage = r.body.message || `Loaded ${items.length} events`;
  S.logLines = items.slice(-200).map((row) => JSON.stringify(row));
  renderLog();
  S.trades = normalizeTrades(S.paperRows, S.report);
  updateFilterOptions();
  renderTrades(false);
  renderPaperStatus();
}

async function loadJournal() {
  const r = await getJson('/api/journal/latest');
  if (!r.ok || !r.body?.ok) {
    E.journalView.textContent = 'ยังไม่พบ journal/latest.json หรือ journal/latest.md';
    badge(E.journalBadge, 'warning', 'Journal: Not found');
    return;
  }
  S.lastUpdated.journal = Date.now();
  if (r.body.format === 'markdown') E.journalView.textContent = r.body.data;
  else E.journalView.textContent = JSON.stringify(r.body.data, null, 2);
  badge(E.journalBadge, 'success', `Journal: ${r.body.format}`);
}

async function refreshAll({ includePaper = false, toastMessage = false } = {}) {
  await loadRuntimeStatus();
  await loadHealth();
  await loadReport();
  await loadJournal();
  if (includePaper) await loadPaperTail();
  refreshLastUpdated();
  if (toastMessage) toast('Dashboard refreshed', 'success');
}

function setAutoRefresh(enabled) {
  S.autoRefresh = enabled;
  localStorage.setItem(AUTO_REFRESH_KEY, enabled ? 'true' : 'false');
  E.autoRefreshToggle.checked = enabled;
  if (S.timer) {
    clearInterval(S.timer);
    S.timer = null;
  }
  if (enabled) {
    S.timer = setInterval(() => {
      void refreshAll({ includePaper: false, toastMessage: false });
    }, REFRESH_INTERVAL_MS);
  }
}

async function copyCommand(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied command', 'success');
  } catch {
    toast('Clipboard unavailable', 'warning');
  }
}

function openDrawer() {
  E.logDrawer.classList.add('is-open');
  E.logDrawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  E.logDrawer.classList.remove('is-open');
  E.logDrawer.setAttribute('aria-hidden', 'true');
}

function bindEvents() {
  const searchDebounced = debounce(() => {
    S.filters.search = E.tradeSearch.value || '';
    renderTrades(true);
  }, 180);

  E.tradeSearch.addEventListener('input', searchDebounced);
  E.filterSymbol.addEventListener('change', () => { S.filters.symbol = E.filterSymbol.value; renderTrades(true); });
  E.filterStrategy.addEventListener('change', () => { S.filters.strategy = E.filterStrategy.value; renderTrades(true); });
  E.filterSide.addEventListener('change', () => { S.filters.side = E.filterSide.value; renderTrades(true); });
  E.sortTrades.addEventListener('change', () => { S.filters.sort = E.sortTrades.value; renderTrades(true); });
  E.pageSize.addEventListener('change', () => { S.pageSize = Number(E.pageSize.value) || 25; renderTrades(true); });
  E.prevPageBtn.addEventListener('click', () => { if (S.tradePage > 1) { S.tradePage -= 1; renderTrades(false); } });
  E.nextPageBtn.addEventListener('click', () => { S.tradePage += 1; renderTrades(false); });
  E.clearFiltersBtn.addEventListener('click', () => {
    S.filters = { search: '', symbol: '', strategy: '', side: '', sort: 'timeDesc' };
    E.tradeSearch.value = '';
    E.filterSymbol.value = '';
    E.filterStrategy.value = '';
    E.filterSide.value = '';
    E.sortTrades.value = 'timeDesc';
    renderTrades(true);
  });

  E.themeToggle.addEventListener('click', () => applyTheme(S.theme === 'dark' ? 'light' : 'dark'));
  E.refreshBtn.addEventListener('click', () => { void refreshAll({ includePaper: true, toastMessage: true }); });
  E.autoRefreshToggle.addEventListener('change', () => setAutoRefresh(E.autoRefreshToggle.checked));

  E.openLogDrawerBtn.addEventListener('click', openDrawer);
  E.closeLogDrawerBtn.addEventListener('click', closeDrawer);
  E.logDrawerBackdrop.addEventListener('click', closeDrawer);
  E.pauseLogBtn.addEventListener('click', () => {
    S.logPaused = !S.logPaused;
    E.pauseLogBtn.textContent = S.logPaused ? 'Resume' : 'Pause';
    if (!S.logPaused) {
      const queue = [...S.queuedLogEvents];
      S.queuedLogEvents = [];
      for (const item of queue) onPaperLine(item.line, item.row);
    }
    renderPaperStatus();
  });
  E.clearLogBtn.addEventListener('click', () => {
    S.logLines = [];
    renderLog();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeDrawer();
  });

  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      void copyCommand(btn.getAttribute('data-copy') || '');
    });
  });

  document.querySelectorAll('[data-panel-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.panel-collapsible');
      if (!panel) return;
      const collapsed = panel.classList.toggle('is-collapsed');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.textContent = collapsed ? 'Expand' : 'Collapse';
    });
  });

  window.addEventListener('beforeunload', () => {
    if (S.sseSource) S.sseSource.close();
  });
}

function connectSse() {
  if (S.sseSource) {
    S.sseSource.close();
    S.sseSource = null;
  }
  setSseStatus('reconnecting');
  const src = new EventSource('/api/paper/stream');
  S.sseSource = src;

  src.onopen = () => setSseStatus('connected');
  src.onerror = () => setSseStatus('reconnecting');
  src.addEventListener('paper-log', (event) => {
    try {
      const p = JSON.parse(event.data);
      onPaperLine(p?.line || JSON.stringify(p?.row || {}), p?.row ?? null);
    } catch {
      onPaperLine(event.data, null);
    }
  });
}

async function init() {
  const theme = localStorage.getItem(THEME_KEY);
  const preferred = theme === 'dark' || theme === 'light'
    ? theme
    : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(preferred);
  const auto = localStorage.getItem(AUTO_REFRESH_KEY);
  setAutoRefresh(auto === null ? true : auto === 'true');

  bindEvents();
  await refreshAll({ includePaper: true, toastMessage: false });
  connectSse();
  renderPaperStatus();
}

void init();
