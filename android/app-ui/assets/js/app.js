import { parseBook } from './parser.js';
import { buildIndex, search } from './search.js';

const $ = (id) => document.getElementById(id);
const APP = document.documentElement.getAttribute('data-mode') === 'app';
const NATIVE = window.HymnNative || null;
const PAGE = 150;

const FALLBACK_BOOKS = [
  ['The Believers Hymn Book', 'hymnals/BHB.txt'], ['The New Believers Hymnbook', 'hymnals/BHB_new.txt'],
  ['The Gospel Hymn Book (2001)', 'hymnals/2001_GHB.txt'], ['The Gospel Hymn Book (1989)', 'hymnals/1989_GHB.txt'],
  ['Gospel Hymn Book UK (1996)', 'hymnals/UKGHB-1996.txt'], ['UK Gospel Hymn Book (1897)', 'hymnals/UK-gospel-hb_1897.txt'],
  ['Gospel Hymns [modern English]', 'hymnals/Gospel_Hymns.txt'], ['Good Old Gospel Hymns', 'hymnals/Old_Gospel.txt'],
  ['Choice Hymns of the Faith', 'hymnals/choice_hymns.txt'], ['Favorite Hymns', 'hymnals/favoritehymns.txt'],
  ["The Children's Hymn Book 1987", 'hymnals/childrens.txt'], ['Seed Sowers Hymnal (2015)', 'hymnals/SS2.txt'],
  ['Sacred Songs and Solos', 'hymnals/sacred_songs_solos.txt'],
  ['Sacred Songs for Singing Saints (Songs of Thanksgiving & Praise)', 'hymnals/SSFSS.txt'],
  ['Songs of Praise and Thanksgiving (Updated)', 'hymnals/Songs_of_Praise_and_Thanksgiving.txt'],
  ['Christian Teen Camp (PEI)', 'hymnals/Christian_Teen_Camp_PEI.txt'], ['Songs of Salvation (Revised)', 'hymnals/Songs_of_Salvation_Revised.txt'],
].map(([name, path]) => ({ name, path }));

// ---------- storage (every access guarded; private mode / blocked storage must not break the app) ----------
const store = {
  raw(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  rawSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  get(k, d) { try { const v = localStorage.getItem('hymns.' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('hymns.' + k, v); } catch (e) { /* ignore */ } },
};
const favKey = (book) => 'fav_' + book.path;
function favSet(book) {
  if (!book.favs) {
    try { book.favs = new Set(JSON.parse(store.raw(favKey(book)) || '[]').map(String)); } catch (e) { book.favs = new Set(); }
  }
  return book.favs;
}
const isFav = (book, id) => favSet(book).has(String(id));
function toggleFav(book, id) {
  const f = favSet(book); id = String(id);
  if (f.has(id)) f.delete(id); else f.add(id);
  store.rawSet(favKey(book), JSON.stringify([...f]));
}

// ---------- state ----------
let books = [];
let cur = null;           // current book
let curHymn = null;
let query = '';
let sort = ['book', 'number', 'alpha'].includes(store.get('sort', 'book')) ? store.get('sort', 'book') : 'book';
const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
let favOnly = false;
let shown = PAGE;
let results = [];
let scale = Math.min(1.8, Math.max(0.85, parseFloat(store.get('scale', '1')) || 1));

const slugOf = (p) => p.split('/').pop().replace(/\.txt$/i, '');
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 1800); }
// Hymn files contain a little inline markup (<i>, <br>, &nbsp; indents). Only a short allow-list is rendered; the rest is text.
const ALLOWED = new Set(['I', 'B', 'EM', 'STRONG', 'U', 'SUP', 'SUB', 'BR', 'P', 'SMALL']);
function appendHtml(parent, html) {
  const doc = new DOMParser().parseFromString('<body>' + html, 'text/html');   // inert: scripts never run
  const walk = (src, dst) => {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) dst.appendChild(document.createTextNode(n.nodeValue));
      else if (n.nodeType === 1) {
        if (ALLOWED.has(n.tagName)) { const e = document.createElement(n.tagName.toLowerCase()); walk(n, e); dst.appendChild(e); }
        else if (n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') walk(n, dst);
      }
    }
  };
  walk(doc.body, parent);
}

function show(id) {
  for (const v of ['homeView', 'listView', 'favView', 'settingsView', 'detailView']) $(v).classList.toggle('hidden', v !== id);
  document.body.dataset.view = id;
  const showTools = id === 'listView';
  $('sortFavBar').classList.toggle('hidden', !showTools);
  document.querySelectorAll('#tabbar button').forEach((b) => {
    const t = b.dataset.tab;
    const on = (t === 'books' && (id === 'homeView')) || (t === 'search' && (id === 'listView' || id === 'detailView')) ||
               (t === 'favs' && id === 'favView') || (t === 'settings' && id === 'settingsView');
    b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

// ---------- data ----------
async function loadConfig() {
  try {
    const r = await fetch('config.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const c = await r.json();
    const list = (c.datasets || []).filter((d) => d && typeof d.path === 'string' && /^hymnals\/[\w.\-]+\.txt$/.test(d.path));
    if (list.length) return list.map((d) => ({ name: String(d.name || d.path), path: d.path }));
  } catch (e) { /* fall through */ }
  return FALLBACK_BOOKS;
}
async function ensureLoaded(book) {
  if (book.data) return book.data;
  if (!book.promise) {
    book.promise = fetch(book.path).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then((t) => { book.data = parseBook(t, book.name); book.index = buildIndex(book.data.hymns); return book.data; })
      .catch((e) => { book.promise = null; throw e; });
  }
  return book.promise;
}

// ---------- search / sort ----------
const byNum = (x, y) => parseInt(x.number, 10) - parseInt(y.number, 10);
const byTitle = (x, y) => norm(x.title).localeCompare(norm(y.title)) || byNum(x, y);
function computeResults() {
  const book = cur; if (!book || !book.data) { results = []; return; }
  const all = book.data.hymns;
  const q = query.trim();
  const searching = q && (/^\d+$/.test(q) || q.length >= 2);
  let list = searching ? search(book.index, all, q) : all.slice();   // same relevance search as the website
  if (favOnly) list = list.filter((h) => isFav(book, h.id));
  if (sort === 'number') list.sort(byNum);
  else if (sort === 'alpha') list.sort(byTitle);
  else if (!searching) list.sort((x, y) => x._order - y._order);    // book order; relevance order while searching
  results = list;
}
function snippet(h, q) {
  const toks = norm(q).split(' ').filter(Boolean);
  if (!toks.length || /^\d+$/.test(toks[0])) return h.author || '';
  const nt = norm(h.title);
  if (toks.every((t) => nt.includes(t))) return h.author || '';
  for (const line of h.lyrics.split('\n')) { const n = norm(line); if (n && toks.some((t) => n.includes(t))) return '\u201C' + line.trim() + '\u201D'; }
  return h.author || '';
}

// ---------- rendering ----------
function hymnItem(book, h, sub) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = '#' + encodeURIComponent(book.slug) + '/' + encodeURIComponent(h.id);
  const num = document.createElement('span'); num.className = 'num'; num.textContent = h.number;
  const body = document.createElement('span'); body.className = 'body';
  const t = document.createElement('span'); t.className = 'ttl'; t.textContent = h.title;
  body.appendChild(t);
  if (sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = sub; body.appendChild(s); }
  a.append(num, body);
  if (isFav(book, h.id)) { const f = document.createElement('span'); f.className = 'fav'; f.textContent = '\u2605'; f.setAttribute('aria-label', 'favorite'); a.appendChild(f); }
  li.appendChild(a);
  return li;
}
function renderList() {
  const ul = $('results'); ul.textContent = '';
  const total = cur && cur.data ? cur.data.hymns.length : 0;
  $('listTitle').textContent = cur ? cur.name : '';
  const frag = document.createDocumentFragment();
  for (const h of results.slice(0, shown)) frag.appendChild(hymnItem(cur, h, snippet(h, query)));
  ul.appendChild(frag);
  const q = query.trim();
  let msg = `${results.length} hymn${results.length === 1 ? '' : 's'}`;
  if (q || favOnly) msg = `${results.length} of ${total} hymns` + (q ? ` match \u201C${q}\u201D` : '') + (favOnly ? ' (favorites)' : '');
  if (!results.length && cur && cur.data) msg = q ? `No hymns match \u201C${q}\u201D.` : 'No favorites in this book yet.';
  $('resultStats').textContent = msg;
  const more = results.length - shown;
  $('moreBtn').classList.toggle('hidden', more <= 0);
  $('moreBtn').textContent = `Show more (${Math.max(more, 0)})`;
  const about = cur && cur.data && cur.data.aboutHtml;
  $('aboutBook').classList.toggle('hidden', !about); $('aboutText').textContent = ''; if (about) appendHtml($('aboutText'), about);
  updateFavCount();
}
function updateFavCount() {
  const n = cur ? favSet(cur).size : 0;
  $('favoritesToggle').textContent = `Show Favorites (${n})`;
  $('favoritesToggle').setAttribute('aria-pressed', String(favOnly));
  $('favoritesToggle').classList.toggle('on', favOnly);
}
function refresh(resetPaging = true) { if (resetPaging) shown = PAGE; computeResults(); renderList(); }

function renderHome() {
  const g = $('bookGrid'); g.textContent = '';
  books.forEach((b, i) => {
    const a = document.createElement('a'); a.className = 'book-card'; a.href = '#' + encodeURIComponent(b.slug);
    a.style.setProperty('--h', String((i * 47) % 360));
    const t = document.createElement('span'); t.className = 'book-name'; t.textContent = b.name;
    const c = document.createElement('span'); c.className = 'book-count'; c.textContent = b.data ? `${b.data.hymns.length} hymns` : 'Tap to open';
    a.append(t, c); g.appendChild(a);
  });
}
async function renderFavs() {
  const ul = $('favList'); ul.textContent = '';
  const frag = document.createDocumentFragment(); let count = 0;
  for (const b of books) {
    if (!favSet(b).size) continue;
    try { await ensureLoaded(b); } catch (e) { continue; }
    for (const h of b.data.hymns.filter((x) => favSet(b).has(x.id)).sort(byNum)) {
      const li = hymnItem(b, h, b.name); frag.appendChild(li); count++;
    }
  }
  ul.appendChild(frag);
  $('favEmpty').classList.toggle('hidden', count > 0);
}
function hymnToText(book, h) {
  const out = [`${h.number}. ${h.title}`, book.name];
  if (h.author) out.push(h.author);
  if (h.meter) out.push(h.meter);
  out.push('', h.lyrics);
  return out.join('\n').trim();
}
function renderDetail(book, h) {
  curHymn = h;
  $('hymnBook').textContent = `${book.name} \u00B7 #${h.number}`;
  $('hymnTitle').textContent = h.title;
  const fill = (id, html) => { const el = $(id); el.textContent = ''; if (html) appendHtml(el, html); el.classList.toggle('hidden', !el.textContent.trim()); };
  fill('hymnTopText', h.topHtml); fill('hymnBottomText', h.bottomHtml);
  $('hymnMeter').textContent = h.meter; $('hymnMeter').classList.toggle('hidden', !h.meter);
  const ly = $('hymnLyrics'); ly.textContent = '';
  for (const st of h.stanzas) {
    const p = document.createElement('p'); p.className = 'stanza' + (st.chorus ? ' chorus' : '');
    st.lines.forEach((line, i) => { if (i) p.appendChild(document.createElement('br')); appendHtml(p, line); });
    ly.appendChild(p);
  }
  updateDetailFav(); applyScale();
  document.title = `${h.title} \u2013 ${book.name}`;
  const i = book.data.hymns.indexOf(h);
  $('prevBtn').disabled = i <= 0; $('nextBtn').disabled = i >= book.data.hymns.length - 1;
}
function updateDetailFav() {
  if (!curHymn || !cur) return;
  const on = isFav(cur, curHymn.id);
  $('favBtnDetail').textContent = on ? '\u2605' : '\u2606'; $('favBtnDetail').setAttribute('aria-pressed', String(on));
}
function applyScale() { document.documentElement.style.setProperty('--lyric-scale', String(scale)); const s = $('setSize'); if (s) s.value = String(scale); }

// ---------- routing ----------
async function selectBook(slug) {
  const b = books.find((x) => x.slug === slug) || books[0];
  cur = b; store.set('book', b.slug); $('datasetSelect').value = b.slug;
  if (!b.data) {
    $('listTitle').textContent = b.name; $('results').textContent = '';
    $('resultStats').textContent = 'Loading\u2026'; $('moreBtn').classList.add('hidden');
    try { await ensureLoaded(b); }
    catch (e) { if (cur === b) $('resultStats').textContent = 'Could not load this hymn book. Check your connection and try again.'; throw e; }
  }
  return b;
}
async function route() {
  const raw = location.hash.slice(1);
  let h = raw; try { h = decodeURIComponent(raw); } catch (e) { /* keep raw */ }
  document.title = 'Hymns from Gravel Hill';
  if (h === 'settings') { show('settingsView'); return; }
  if (h === 'favs') { show('favView'); await renderFavs(); return; }
  if (h === '' && APP) { renderHome(); show('homeView'); return; }
  const [slug, numStr] = h.split('/');
  const target = slug || store.get('book', books[0].slug);
  show('listView');
  try { await selectBook(target); } catch (e) { return; }
  if (numStr !== undefined && /^\d+$/.test(numStr)) {
    const hy = cur.data.hymns.find((x) => x.id === String(parseInt(numStr, 10)));
    if (hy) { renderDetail(cur, hy); show('detailView'); return; }
  }
  refresh(); show('listView');
}
function goList() { history.replaceState(null, '', '#' + encodeURIComponent(cur ? cur.slug : books[0].slug)); show('listView'); document.title = 'Hymns from Gravel Hill'; }

// ---------- actions ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fallback */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove(); return ok;
}
function setTheme(t) {
  store.set('theme', t);
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  $('setTheme').value = t;
  const eff = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  $('themeBtn').textContent = t === 'auto' ? '\u25D0' : eff === 'dark' ? '\u263E' : '\u2600';
  $('themeBtn').title = 'Theme: ' + (t === 'auto' ? 'match device' : t);
}
async function setAwake(on) {
  store.set('awake', on ? '1' : '0');
  if (NATIVE && NATIVE.keepScreenOn) { try { NATIVE.keepScreenOn(!!on); } catch (e) { /* ignore */ } return; }
  try {
    if (on && navigator.wakeLock) setAwake.lock = await navigator.wakeLock.request('screen');
    else if (setAwake.lock) { await setAwake.lock.release(); setAwake.lock = null; }
  } catch (e) { /* unsupported */ }
}

function wire() {
  const q = $('q');
  q.addEventListener('input', () => {
    query = q.value; $('qClear').hidden = !query;
    if (document.body.dataset.view !== 'listView') {            // typing from a hymn/other screen shows results at once
      if (!cur) cur = books.find((b) => b.slug === store.get('book', books[0].slug)) || books[0];
      selectBook(cur.slug).then(() => { goList(); refresh(); }).catch(() => {});
      return;
    }
    refresh();
  });
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; q.dispatchEvent(new Event('input')); } });
  $('qClear').addEventListener('click', () => { q.value = ''; q.dispatchEvent(new Event('input')); q.focus(); });
  $('datasetSelect').addEventListener('change', (e) => { favOnly = false; location.hash = '#' + encodeURIComponent(e.target.value); });
  $('sortSelect').addEventListener('change', (e) => { sort = e.target.value; store.set('sort', sort); if (cur && cur.data) refresh(); });
  $('favoritesToggle').addEventListener('click', () => { favOnly = !favOnly; refresh(); });
  $('moreBtn').addEventListener('click', () => { shown += PAGE; renderList(); });
  $('brandLink').addEventListener('click', (e) => { e.preventDefault(); location.hash = APP ? '' : '#' + encodeURIComponent((cur || books[0]).slug); });
  $('backBtn').addEventListener('click', () => { if (history.length > 1 && document.referrer.startsWith(location.origin)) history.back(); else goList(); });
  const step = (d) => { if (!cur || !curHymn) return; const arr = cur.data.hymns, i = arr.indexOf(curHymn) + d; if (arr[i]) history.replaceState(null, '', '#' + encodeURIComponent(cur.slug) + '/' + encodeURIComponent(arr[i].id)), renderDetail(cur, arr[i]), window.scrollTo(0, 0); };
  $('prevBtn').addEventListener('click', () => step(-1)); $('nextBtn').addEventListener('click', () => step(1));
  $('copyBtn').addEventListener('click', async () => toast((await copyText(hymnToText(cur, curHymn))) ? 'Copied' : 'Copy failed'));
  $('printBtn').addEventListener('click', () => window.print());
  if (NATIVE && NATIVE.share || navigator.share) {
    $('shareBtn').classList.remove('hidden');
    $('shareBtn').addEventListener('click', async () => {
      const text = hymnToText(cur, curHymn);
      try { if (NATIVE && NATIVE.share) NATIVE.share(curHymn.title, text); else await navigator.share({ title: curHymn.title, text }); } catch (e) { /* cancelled */ }
    });
  }
  const fav = () => { if (!curHymn) return; toggleFav(cur, curHymn.id); updateDetailFav(); updateFavCount(); };
  $('favBtnDetail').addEventListener('click', fav);
  const bump = (d) => { scale = Math.min(1.8, Math.max(0.85, Math.round((scale + d) * 100) / 100)); store.set('scale', String(scale)); applyScale(); };
  $('smallerBtn').addEventListener('click', () => bump(-0.1)); $('biggerBtn').addEventListener('click', () => bump(0.1));
  $('themeBtn').addEventListener('click', () => { const o = ['auto', 'light', 'dark']; setTheme(o[(o.indexOf(store.get('theme', 'auto')) + 1) % 3]); });
  $('setTheme').addEventListener('change', (e) => setTheme(e.target.value));
  $('setSize').addEventListener('input', (e) => { scale = parseFloat(e.target.value) || 1; store.set('scale', String(scale)); applyScale(); });
  $('setAwake').addEventListener('change', (e) => setAwake(e.target.checked));
  document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tab;
    if (t === 'books') location.hash = '';
    else if (t === 'favs') location.hash = '#favs';
    else if (t === 'settings') location.hash = '#settings';
    else { const slug = (cur || books[0]).slug; if (document.body.dataset.view !== 'listView') location.hash = '#' + encodeURIComponent(slug); setTimeout(() => q.focus(), 60); }
  }));
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); q.focus(); }
    else if (!typing && document.body.dataset.view === 'detailView') { if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1); }
  });
  window.addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTheme(store.get('theme', 'auto')));
}

(async function init() {
  const cfg = await loadConfig();
  const seen = new Set();
  books = cfg.map((b) => { let slug = slugOf(b.path), i = 2; while (seen.has(slug)) slug = slugOf(b.path) + i++; seen.add(slug); return { ...b, slug, data: null, promise: null }; });
  const sel = $('datasetSelect');
  for (const b of books) { const o = document.createElement('option'); o.value = b.slug; o.textContent = b.name; sel.appendChild(o); }
  $('sortSelect').value = sort; $('setAwake').checked = store.get('awake', '0') === '1';
  $('tabbar').classList.toggle('hidden', !APP);
  try { if (NATIVE && NATIVE.appVersion) $('appVersion').textContent = 'Version ' + NATIVE.appVersion(); } catch (e) { /* ignore */ }
  setTheme(store.get('theme', 'auto')); applyScale(); wire();
  if (store.get('awake', '0') === '1') setAwake(true);
  await route();
})();
