// Hymnal text parser for the app. Mirrors the rules used by the website (and by the original hymnal apps):
// header flags in the file decide which fixed lines follow the hymn number (title / top text / bottom text / metre).
// Pure functions, no DOM access.
const ENT = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00A0',lsquo:'\u2018',rsquo:'\u2019',ldquo:'\u201C',rdquo:'\u201D',mdash:'\u2014',ndash:'\u2013',hellip:'\u2026',copy:'\u00A9',egrave:'\u00E8',eacute:'\u00E9'};

export function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    const v = ENT[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}
const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');
export const plain = (s) => decode(stripTags(String(s).replace(/<br\s*\/?>/gi, ' '))).replace(/[ \t\u00A0]+/g, ' ').trim();
const nl = (s) => String(s).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const dropEnd = (s) => (s && ',-:;'.includes(s.slice(-1)) ? s.slice(0, -1) : s);
const isChorusMark = (t) => ['c', 'chorus', 'chorus:', 'c.'].includes(t.trim().toLowerCase());

// Only real section names start a section; a verse line beginning with "--" belongs to the lyrics.
const SECTION_NAMES = new Set(['title','additionalinfo','index','firstlineistitle','usetoptext','usebottomtext','usemeter','lyrics','tags','categories','audiourl','audio']);

function parseSections(text) {
  const sections = Object.create(null);
  let cur = null;
  for (const line of nl(text).split('\n')) {
    if (line.startsWith('--') && SECTION_NAMES.has(line.slice(2).trim().toLowerCase())) { cur = line.slice(2).trim().toLowerCase(); if (!(cur in sections)) sections[cur] = ''; continue; }
    if (cur) sections[cur] += line + '\n';
  }
  for (const k of Object.keys(sections)) if (sections[k].endsWith('\n')) sections[k] = sections[k].slice(0, -1);
  return sections;
}

function indexOrder(s) {
  const out = [], seen = new Set();
  for (const p of (s || '').trim().split(',')) {
    const n = p.split('|')[0].replace(/[\s.]/g, '');
    if (n && /^\d+$/.test(n) && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

function offsets(m) {
  let top = 1, bottom = 1, meter = 1, first = 2;
  if (!m.firstLineIsTitle) { first++; top++; bottom++; meter++; }
  if (m.useTopText) { first++; bottom++; meter++; }
  if (m.useBottomText) { first++; meter++; }
  if (m.useMeter) first++;
  return { top, bottom, meter, first };
}

function titleFromLyrics(lines) {
  let prefix = '';
  for (const raw of lines) {
    const t = plain(raw);
    if (!t) continue;
    if (t.toUpperCase().includes('(C)')) { prefix = '\u00A9 '; continue; }
    if (isChorusMark(t)) continue;
    return prefix + dropEnd(t);
  }
  return '';
}

function stanzasOf(lines) {
  const out = []; let buf = [], chorus = false;
  const flush = () => { if (buf.length) out.push({ chorus, lines: buf }); buf = []; chorus = false; };
  for (const raw of lines) {
    const t = raw.replace(/\r/g, '').trim();
    if (!t) { flush(); continue; }
    if (isChorusMark(t)) { flush(); chorus = true; continue; }
    if (t.toLowerCase() === '(c)') continue;           // copyright marker, not part of the words
    buf.push(raw.replace(/\r/g, ''));
  }
  flush();
  return out;
}

export function parseBook(text, fallbackName) {
  const sec = parseSections(text);
  const flag = (k) => String(sec[k] || '').trim().toLowerCase() === 'true';
  const meta = { firstLineIsTitle: flag('firstlineistitle'), useTopText: flag('usetoptext'), useBottomText: flag('usebottomtext'), useMeter: flag('usemeter') };
  const off = offsets(meta);
  const lines = nl(sec.lyrics || '').split('\n');
  const chunks = []; let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^\d+$/.test(t) && (i === 0 || lines[i - 1].trim() === '') && +t >= 0 && +t <= 2000) {
      if (cur) chunks.push(cur);
      cur = { number: String(parseInt(t, 10)), lines: [lines[i]] };
    } else if (cur) cur.lines.push(lines[i]);
  }
  if (cur) chunks.push(cur);

  const byNumber = new Map();
  for (const c of chunks) {
    const L = c.lines, get = (i) => (i >= 0 && i < L.length ? L[i] : '');
    const lyricLines = L.slice(off.first);
    const title = meta.firstLineIsTitle ? (titleFromLyrics(lyricLines) || `Hymn ${c.number}`) : dropEnd(plain(get(1)));
    const topHtml = meta.useTopText ? get(off.top) : '';
    const bottomHtml = meta.useBottomText ? get(off.bottom) : '';
    const meter = meta.useMeter ? plain(get(off.meter)) : '';
    const stanzas = stanzasOf(lyricLines);
    const lyrics = decode(stripTags(lyricLines.join('\n'))).replace(/\n{3,}/g, '\n\n').trim();
    byNumber.set(c.number, {
      id: c.number, number: c.number, title: title || `Hymn ${c.number}`,
      author: [plain(topHtml), plain(bottomHtml)].filter(Boolean).join(' \u2022 '), tune: '', scripture: '',
      meter, lyrics, topHtml, bottomHtml, stanzas,
    });
  }

  const ordered = [], seen = new Set(), order = indexOrder(sec.index);
  if (order.length) {
    for (const n of order) { const h = byNumber.get(n); if (h && !seen.has(n)) { seen.add(n); ordered.push(h); } }
    const rest = [...byNumber.values()].filter((h) => !seen.has(h.number)).sort((a, b) => +a.number - +b.number);
    ordered.push(...rest);
  } else ordered.push(...[...byNumber.values()].sort((a, b) => +a.number - +b.number));
  const ci = ordered.findIndex((h) => h.number === '0');
  if (ci > 0) ordered.unshift(...ordered.splice(ci, 1));
  ordered.forEach((h, i) => { h._order = i; });
  return { title: plain(sec.title || '') || fallbackName, aboutHtml: sec.additionalinfo || '', hymns: ordered };
}
