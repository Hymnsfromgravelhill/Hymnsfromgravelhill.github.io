import {Router} from './router.js';
import {html, escapeHTML, $, decodeEntities} from './utils.js';
import {buildIndex, search} from './search.js';

const state = {
  config: null,
  datasets: [],
  currentDatasetIndex: 0,
  rows: [],
  index: null,
  sortMode: 'number',        // book | number | alpha
  viewFavorites: false,
  favs: new Set(),
  datasetMeta: {
    title: '',
    additionalInfoHtml: '',
    firstLineIsTitle: false,
    useTopText: false,
    useBottomText: false,
    useMeter: false,
    indexOrder: [],
  },
};

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

function datasetKey(){
  const ds = state.datasets[state.currentDatasetIndex] || {};
  return 'fav_' + (ds.path || String(state.currentDatasetIndex));
}
function loadFavorites(){
  try{ state.favs = new Set(JSON.parse(localStorage.getItem(datasetKey()) || '[]')); }
  catch{ state.favs = new Set(); }
}
function saveFavorites(){
  localStorage.setItem(datasetKey(), JSON.stringify(Array.from(state.favs)));
}
function isFav(id){ return state.favs.has(id); }
function toggleFav(id){
  if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
  saveFavorites();
}

function normalizeTitle(t=''){ return (t||'').toString().trim().toLowerCase(); }

function sortRows(rows){
  const out = [...rows];
  if (state.sortMode === 'alpha'){
    out.sort((a,b)=>{
      const at = normalizeTitle(a.title), bt = normalizeTitle(b.title);
      if (at !== bt) return at < bt ? -1 : 1;
      const an = parseInt(a.number||'0',10), bn = parseInt(b.number||'0',10);
      return an - bn;
    });
  } else if (state.sortMode === 'number'){
    out.sort((a,b)=> (parseInt(a.number||'0',10) - parseInt(b.number||'0',10)));
  } else {
    // book order (default)
    out.sort((a,b)=> ( (a._order ?? 1e9) - (b._order ?? 1e9) ));
  }
  return out;
}

function filterFavorites(rows){
  return state.viewFavorites ? rows.filter(r=> state.favs.has(r.id)) : rows;
}

function updateFavButtonLabel(){
  const btn = $('#favoritesToggle');
  if (!btn) return;
  const count = state.favs.size;
  if (state.viewFavorites){
    btn.textContent = 'Show All';
    btn.setAttribute('aria-pressed','true');
  } else {
    btn.textContent = `Show Favorites (${count})`;
    btn.setAttribute('aria-pressed','false');
  }
}

function currentQuery(){ return ($('#q')?.value || '').trim(); }

function renderFromState(){
  const q = currentQuery();
  const shouldSearch = q && (/^\d+$/.test(q) || q.length >= 2);
  let base = shouldSearch ? search(state.index, state.rows, q) : state.rows;
  base = filterFavorites(base);
  base = sortRows(base);
  drawList(base);

  const stats = $('#resultStats');
  if (stats){
    if (q) stats.textContent = `${base.length} results for “${q}”${state.viewFavorites ? ' (favorites)' : ''}`;
    else stats.textContent = `${base.length} hymn${base.length===1?'':'s'}${state.viewFavorites ? ' (favorites)' : ''}`;
  }

  updateFavButtonLabel();
}

async function loadConfig(){
  try{
    const res = await fetch('config.json');
    state.config = await res.json();
  }catch{
    state.config = window.__HFG_CONFIG__ || {datasets: []};
  }
  state.datasets = state.config.datasets || [];
  renderDatasetPicker();
}

function renderDatasetPicker(){
  const sel = $('#datasetSelect');
  sel.innerHTML = state.datasets.map((d,i)=> html`<option value="${i}">${escapeHTML(d.name || d.path)}</option>`).join('');
  sel.value = String(state.currentDatasetIndex);
  sel.addEventListener('change', ()=>{
    const next = parseInt(sel.value,10);
    if (Number.isNaN(next) || next === state.currentDatasetIndex) return;

    const parts = router.parse();
    const wasDetail = (parts[0] === 'hymn');
    if (wasDetail) history.replaceState(null, '', '#');

    state.currentDatasetIndex = next;
    hydrate().then(()=>{
      if (wasDetail) showList();
    });
  });
}

function getEmbedded(path){
  try{
    const m = window.__HYMNALS_EMBED__ || null;
    return m ? (m[path] || null) : null;
  }catch{ return null; }
}

async function fetchTextWithFallback(path){
  if (location.protocol === 'file:'){
    const emb = getEmbedded(path);
    if (emb != null) return emb;
  }
  try{
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }catch(err){
    const emb = getEmbedded(path);
    if (emb != null) return emb;
    throw err;
  }
}

function normalizeNewlines(s=''){
  return String(s)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g,'\n')
    .replace(/\r/g,'\n');
}

function stripTags(s=''){
  return s.replace(/<[^>]*>/g,'');
}

function sanitizeInlineHtml(s=''){
  let out = String(s);
  out = out.replace(/<span\b[^>]*fa-pause-circle[^>]*><\/span>/gi, '');
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'\"]*\2/gi, ' $1="#"');
  // Strip links but keep inner text
  out = out.replace(/<a\b[^>]*>/gi, '').replace(/<\/a>/gi, '');
  return out;
}

function removeEndingPunctuation(line){
  const s = (line ?? '').toString();
  if (!s) return s;
  const last = s.slice(-1);
  if (last === ',' || last === '-' || last === ':' || last === ';') return s.slice(0,-1);
  return s;
}

function parseBool(s){
  return String(s||'').trim().toLowerCase() === 'true';
}

function parseSections(fullText){
  const t = normalizeNewlines(fullText);
  const lines = t.split('\n');
  const sections = Object.create(null);
  let cur = null;

  for (const raw of lines){
    const line = raw ?? '';
    if (line.startsWith('--')){
      cur = line.slice(2).trim();
      const key = cur.toLowerCase();
      if (!(key in sections)) sections[key] = '';
      continue;
    }
    if (cur){
      sections[cur.toLowerCase()] += line + '\n';
    }
  }

  for (const k of Object.keys(sections)){
    // trim one trailing newline
    if (sections[k].endsWith('\n')) sections[k] = sections[k].slice(0,-1);
  }
  return sections;
}

function parseIndexOrder(indexSectionText=''){
  const raw = (indexSectionText || '').trim();
  if (!raw) return [];
  const parts = raw.split(',').map(x=>x.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts){
    const songNum = p.split('|')[0].replace(/[\s\.]/g,'');
    // Allow hymn 0 (cover) as well as 1..N
    if (!songNum || !/^\d+$/.test(songNum)) continue;
    if (seen.has(songNum)) continue;
    seen.add(songNum);
    out.push(songNum);
  }
  return out;
}

function computeOffsets(meta){
  // Mirrors the APK logic (convertSong): fixed offsets after hymn number line.
  let topTextIndex = 1;
  let bottomTextIndex = 1;
  let meterIndex = 1;
  let firstLyricIndex = 2;

  if (!meta.firstLineIsTitle){
    firstLyricIndex++; topTextIndex++; bottomTextIndex++; meterIndex++;
  }
  if (meta.useTopText){
    firstLyricIndex++; bottomTextIndex++; meterIndex++;
  }
  if (meta.useBottomText){
    firstLyricIndex++; meterIndex++;
  }
  if (meta.useMeter){
    firstLyricIndex++;
  }
  return { topTextIndex, bottomTextIndex, meterIndex, firstLyricIndex };
}

function isHymnNumberLine(rawLine, prevLine){
  // Hymn numbers are digits-only lines (no meters like 10.6.10.6.).
  // Allow hymn 0 for "cover" entries. Keep blank-line guard to avoid false positives.
  const t = (rawLine ?? '').toString().trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;

  const n = parseInt(t, 10);
  if (!Number.isFinite(n) || n < 0 || n > 2000) return null;

  const prev = (prevLine ?? '').toString().trim();
  if (prev !== '') return null;

  return t;
}

function buildLyricsHtml(lyricsLines){
  // Original app behavior: chorus triggered by line that is only "c" or "chorus".
  const out = [];
  let buf = [];
  let mode = 'stanza';

  const flush = ()=>{
    if (!buf.length) return;
    const block = buf.map(l=>sanitizeInlineHtml(l)).join('<br>');
    out.push(`<div class="${mode}">${block}</div>`);
    buf = [];
  };

  for (const rawLine of lyricsLines){
    const line = (rawLine ?? '').replace(/\r/g,'');
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (!trimmed){
      flush();
      mode = 'stanza';
      continue;
    }

    if (lower === 'c' || lower === 'chorus' || lower === 'chorus:' || lower === 'c.'){
      flush();
      mode = 'chorus';
      continue;
    }

    buf.push(line);
  }
  flush();
  return out.join('\n');
}

function extractTitleFromLyricsLines(lyricsLines){
  // Skip blank lines, copyright marker "(C)", and chorus markers at the very top.
  let i = 0;
  let prefix = '';
  while (i < lyricsLines.length){
    const raw = (lyricsLines[i] ?? '').toString();
    const t = decodeEntities(stripTags(raw)).trim();
    const up = t.toUpperCase();

    if (!t){ i++; continue; }

    // Copyright marker line (C) => title is the next meaningful line, prefixed with ©
    if (up.includes('(C)')){
      prefix = '© ';
      i++;
      continue;
    }

    // Chorus markers
    const low = t.toLowerCase();
    if (low === 'c' || low === 'chorus' || low === 'chorus:' || low === 'c.'){
      i++;
      continue;
    }

    return prefix + removeEndingPunctuation(t);
  }
  return '';
}

function parseHymnal(fullText){
  const sections = parseSections(fullText);

  // Header meta
  const meta = {
    title: (sections['title'] || '').trim(),
    additionalInfoHtml: sanitizeInlineHtml(sections['additionalinfo'] || sections['additionalInfo'] || ''),
    firstLineIsTitle: parseBool(sections['firstlineistitle']),
    useTopText: parseBool(sections['usetoptext']),
    useBottomText: parseBool(sections['usebottomtext']),
    useMeter: parseBool(sections['usemeter']),
    indexOrder: parseIndexOrder(sections['index'] || ''),
  };
  state.datasetMeta = meta;

  const lyricsText = normalizeNewlines(sections['lyrics'] || '');
  const lines = lyricsText.split('\n');

  const offsets = computeOffsets(meta);

  // Collect hymn chunks
  const chunks = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++){
    const n = isHymnNumberLine(lines[i], i>0 ? lines[i-1] : "");
    if (n){
      if (cur) chunks.push(cur);
      cur = { number: n, lines: [lines[i]] };
      continue;
    }
    if (cur) cur.lines.push(lines[i]);
  }
  if (cur) chunks.push(cur);

  const byNumber = new Map();

  for (const c of chunks){
    const hymnLines = c.lines;
    const number = c.number;

    // Defensive: ensure we have enough lines
    const getLine = (idx)=> (idx >= 0 && idx < hymnLines.length) ? hymnLines[idx] : '';

    let title = '';
    if (!meta.firstLineIsTitle){
      // Title is supplied on the line right after hymn number
      title = removeEndingPunctuation(decodeEntities(stripTags(getLine(1))).trim());
    }

    const topTextRaw = meta.useTopText ? getLine(offsets.topTextIndex) : '';
    const bottomTextRaw = meta.useBottomText ? getLine(offsets.bottomTextIndex) : '';
    const meterRaw = meta.useMeter ? getLine(offsets.meterIndex) : '';

    const lyricsLines = hymnLines.slice(offsets.firstLyricIndex);

    if (meta.firstLineIsTitle){
      title = extractTitleFromLyricsLines(lyricsLines) || `Hymn ${number}`;
    }

    // Plain-text fields for search/copy
    const topTextPlain = decodeEntities(stripTags(topTextRaw)).replace(/\s+/g,' ').trim();
    const bottomTextPlain = decodeEntities(stripTags(bottomTextRaw)).replace(/\s+/g,' ').trim();
    const meterPlain = decodeEntities(stripTags(meterRaw)).replace(/\s+/g,' ').trim();

    const lyricsPlain = decodeEntities(stripTags(lyricsLines.join('\n')))
      .replace(/\n{3,}/g,'\n\n')
      .trim();

    const lyricsHtml = buildLyricsHtml(lyricsLines);

    const metaSearch = [topTextPlain, bottomTextPlain].filter(Boolean).join(' • ');

    byNumber.set(number, {
      id: `${number}`,
      number,
      title: title || `Hymn ${number}`,
      // Reuse existing search weights by storing meta under author
      author: metaSearch,
      tune: '',
      meter: meterPlain,
      scripture: '',
      lyrics: lyricsPlain,
      _raw: {
        topTextHtml: sanitizeInlineHtml(topTextRaw || ''),
        bottomTextHtml: sanitizeInlineHtml(bottomTextRaw || ''),
        meterText: meterPlain,
        lyricsHtml,
      }
    });
  }

  // Order hymns: prefer --index order if provided.
  const ordered = [];
  const seen = new Set();

  if (meta.indexOrder && meta.indexOrder.length){
    let pos = 0;
    for (const n of meta.indexOrder){
      const h = byNumber.get(n);
      if (!h) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      h._order = pos++;
      ordered.push(h);
    }
    // Add anything not in index at the end (stable numeric)
    const rest = Array.from(byNumber.values()).filter(h=>!seen.has(h.number));
    rest.sort((a,b)=>parseInt(a.number,10)-parseInt(b.number,10));
    for (const h of rest){ h._order = pos++; ordered.push(h); }
  } else {
    const all = Array.from(byNumber.values());
    all.sort((a,b)=>parseInt(a.number,10)-parseInt(b.number,10));
    all.forEach((h,idx)=> h._order = idx);
    ordered.push(...all);
  }

  // Ensure hymn 0 (cover) is always first if present
  const coverIdx = ordered.findIndex(h => h.number === '0');
  if (coverIdx >= 0){
    const [cover] = ordered.splice(coverIdx, 1);
    ordered.unshift(cover);
    ordered.forEach((h,i)=> h._order = i);
  }

  return ordered;
}

function starSvg(){
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.3l-6.18 3.25 1.18-6.88L1 8.99l6.91-1L12 1.75l3.09 6.24 6.91 1-5 4.68 1.18 6.88z"/></svg>`;
}

function drawList(rows){
  const ul = $('#results');
  ul.innerHTML = rows.map(r => html`
    <li data-id="${escapeHTML(r.id)}">
      <button class="fav-btn ${isFav(r.id) ? 'filled' : ''}" data-id="${escapeHTML(r.id)}" title="${isFav(r.id) ? 'Unfavorite' : 'Favorite'}" aria-label="${isFav(r.id) ? 'Unfavorite' : 'Favorite'}">
        ${starSvg()}
      </button>
      <span class="hymn-no">${escapeHTML(r.number || '—')}</span>
      <a href="#/hymn/${state.currentDatasetIndex}/${encodeURIComponent(r.id)}" class="hymn-title">${escapeHTML(r.title || '(Untitled)')}</a>
    </li>
  `).join('');
}

function renderDetail(h){
  $('#hymnTitle').textContent = (h.number ? h.number + '. ' : '') + (h.title || '(Untitled)');

  const top = h._raw?.topTextHtml || '';
  const bottom = h._raw?.bottomTextHtml || '';
  const meter = h._raw?.meterText || '';

  const topEl = $('#hymnTopText');
  const bottomEl = $('#hymnBottomText');
  const meterEl = $('#hymnMeter');

  topEl.innerHTML = top ? top : '';
  bottomEl.innerHTML = bottom ? bottom : '';
  meterEl.textContent = meter ? meter : '';

  topEl.classList.toggle('hidden', !top);
  bottomEl.classList.toggle('hidden', !bottom);
  meterEl.classList.toggle('hidden', !meter);

  $('#hymnLyrics').innerHTML = h._raw?.lyricsHtml || escapeHTML(h.lyrics || '').replace(/\n/g,'<br>');

  const favBtn = $('#favBtnDetail');
  const pressed = isFav(h.id);
  favBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  favBtn.textContent = pressed ? '★' : '☆';
}

function showList(){
  $('#detailView').classList.add('hidden');
  $('#listView').classList.remove('hidden');
  history.replaceState(null, '', '#');
}

function showDetail(id){
  const h = state.rows.find(r => r.id === id);
  if (!h){ showList(); return; }
  renderDetail(h);
  $('#listView').classList.add('hidden');
  $('#detailView').classList.remove('hidden');
  window.scrollTo(0,0);
}

async function hydrate(){
  const ds = state.datasets[state.currentDatasetIndex];
  if (!ds) return;

  const txt = await fetchTextWithFallback(ds.path);
  state.rows = parseHymnal(txt);
  state.index = buildIndex(state.rows);

  loadFavorites();
  renderFromState();
  router.handle();
}

function setupUI(){
  // Inside-input clear button wiring
  const q = $('#q');
  const qClear = $('#qClear');

  function syncClear(){
    if (!qClear) return;
    const hasText = (q?.value || '').trim().length > 0;
    qClear.classList.toggle('is-visible', hasText);
  }

  let _renderTimer = null;
  q.addEventListener('input', () => {
    syncClear();
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(() => renderFromState(), 80); // 60–120ms feels good
  });

  if (qClear){
    qClear.addEventListener('click', () => {
      q.value = '';
      syncClear();
      renderFromState();
      q.focus();
    });
  }

  // Initialize visibility on load (in case input is prefilled)
  syncClear();

  $('#sortSelect').addEventListener('change', (e)=>{ state.sortMode = e.target.value; renderFromState(); });
  $('#sortSelect').value = state.sortMode;

  $('#favoritesToggle').addEventListener('click', ()=>{ state.viewFavorites = !state.viewFavorites; renderFromState(); });

  // Favorite toggles in list
  $('#results').addEventListener('click', (e)=>{
    const btn = e.target.closest('.fav-btn');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    toggleFav(id);
    renderFromState();

    const parts = router.parse();
    if (parts[0]==='hymn' && parts[2]){
      const curId = decodeURIComponent(parts[2]);
      const h = state.rows.find(r=> r.id===curId);
      if (h) renderDetail(h);
    }
  });

  $('#backBtn').addEventListener('click', ()=> history.back());

  $('#favBtnDetail').addEventListener('click', ()=>{
    const parts = router.parse();
    if (!(parts[0]==='hymn' && parts[2])) return;
    const id = decodeURIComponent(parts[2]);
    toggleFav(id);
    const h = state.rows.find(r=> r.id===id);
    if (h) renderDetail(h);
    renderFromState();
  });

  $('#copyBtn').addEventListener('click', async ()=>{
    const parts = router.parse();
    if (!(parts[0]==='hymn' && parts[2])) return;
    const id = decodeURIComponent(parts[2]);
    const h = state.rows.find(r=> r.id===id);
    if (!h) return;

    const lines = [];
    lines.push(`${h.number}. ${h.title}`);

    const topPlain = decodeEntities(stripTags(h._raw?.topTextHtml || '')).trim();
    const bottomPlain = decodeEntities(stripTags(h._raw?.bottomTextHtml || '')).trim();
    const meterPlain = (h._raw?.meterText || '').trim();

    if (topPlain) lines.push(topPlain);
    if (bottomPlain) lines.push(bottomPlain);
    if (meterPlain) lines.push(meterPlain);

    lines.push('');
    lines.push(h.lyrics || '');

    const text = lines.join('\n');
    try{ await navigator.clipboard.writeText(text); }catch{ /* ignore */ }
  });

  $('#printBtn').addEventListener('click', ()=> window.print());
}

// Keep subbar pinned correctly even if header wraps on mobile
let headerResizeObs = null;
function updateHeaderHeight(){
  const header = document.querySelector('header');
  if (!header) return;
  const h = Math.max(0, Math.round(header.getBoundingClientRect().height));
  document.documentElement.style.setProperty('--header-h', `${h}px`);
}
function watchHeader(){
  updateHeaderHeight();
  const header = document.querySelector('header');
  if (!header) return;
  headerResizeObs?.disconnect?.();
  if ('ResizeObserver' in window){
    headerResizeObs = new ResizeObserver(updateHeaderHeight);
    headerResizeObs.observe(header);
  } else {
    addEventListener('resize', updateHeaderHeight);
  }
}

const router = new Router();
router.onRoute = (parts)=>{
  if (parts[0]==='hymn' && parts.length>=3){
    const ds = parseInt(parts[1],10);
    const id = decodeURIComponent(parts[2]);
    if (!Number.isNaN(ds) && ds !== state.currentDatasetIndex){
      state.currentDatasetIndex = Math.max(0, Math.min(ds, state.datasets.length-1));
      $('#datasetSelect').value = String(state.currentDatasetIndex);
      hydrate().then(()=> showDetail(id));
      return;
    }
    showDetail(id);
  } else {
    showList();
  }
};

(async function init(){
  await loadConfig();
  setupUI();
  watchHeader();
  await hydrate();
  router.start();
})();