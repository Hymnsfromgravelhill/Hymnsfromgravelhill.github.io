// assets/js/search.js — AND-by-terms + prefix/partial matching + phrase boost
import { normalize } from './utils.js';

/**
 * Rules (updated):
 * - If query is a pure number -> exact hymn match fast-path.
 * - Quoted phrases (e.g. "amazing grace") are still honored strictly:
 *     each quoted phrase must appear contiguously in normalized title OR lyrics.
 * - Unquoted input is NOT phrase-by-default anymore:
 *     it becomes AND-by-terms (all significant terms must match).
 *     Each term supports:
 *       1) exact token match (fast),
 *       2) prefix expansion (so "grac" matches "grace"),
 *       3) optional substring fallback (length>=3) against normalized title/lyrics.
 * - Scoring:
 *     tf-idf with field weights on the actual matched terms,
 *     + big boost for contiguous phrase appearances (quoted phrases + unquoted multi-term phrase).
 */

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','had','has','have','he','her','hers','him','his','i',
  'in','is','it','its','me','my','mine','no','not','of','on','or','our','ours','she','that','the','their','them',
  'there','they','this','to','us','was','were','what','when','where','which','who','whom','why','with','you','your','yours',
  'o','oh','hallelujah','amen'
]);

const WEIGHTS = {
  title:        3.5,
  lyrics:       1.0,
  author:       1.4,
  tune:         1.4,
  scripture:    0.8,
  meter:        0.6,
  phraseTitle:  12.0,
  phraseLyrics: 6.0,
  exactNumber:  1000,

  // Small nudges when we only match via substring fallback (no token hits).
  substrTitle:  2.0,
  substrLyrics: 0.8,
};

const MAX_PREFIX_EXPANSIONS = 50;
const MAX_TERM_HITS_FOR_SCORING = 12;

function tokenize(s){
  const nx = normalize(s);
  if (!nx) return [];
  const toks = nx.match(/[a-z0-9]+/g) || [];
  return toks.filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function simpleWords(s){
  // normalized letters/digits/spaces only; collapse spaces
  const nx = normalize(s);
  return (nx.replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim());
}

function strIncludes(hay, needle){ return hay && needle ? hay.indexOf(needle) !== -1 : false; }
function log1p(x){ return Math.log(1 + x); }

export function buildIndex(rows){
  const docs = [];
  const df = new Map();
  const vocab = new Set();

  for (let i = 0; i < rows.length; i++){
    const r = rows[i] || {};
    const titleRaw = r.title || '';
    const lyricsRaw = r.lyrics || '';
    const authorRaw = r.author || '';
    const tuneRaw = r.tune || '';
    const scriptureRaw = r.scripture || '';
    const meterRaw = r.meter || '';

    const nTitle      = normalize(titleRaw);
    const nLyrics     = normalize(lyricsRaw);
    const tfTitle     = countTokens(tokenize(titleRaw));
    const tfLyrics    = countTokens(tokenize(lyricsRaw));
    const tfAuthor    = countTokens(tokenize(authorRaw));
    const tfTune      = countTokens(tokenize(tuneRaw));
    const tfScripture = countTokens(tokenize(scriptureRaw));
    const tfMeter     = countTokens(tokenize(meterRaw));

    const seen = new Set([
      ...Object.keys(tfTitle), ...Object.keys(tfLyrics),
      ...Object.keys(tfAuthor), ...Object.keys(tfTune),
      ...Object.keys(tfScripture), ...Object.keys(tfMeter),
    ]);
    for (const t of seen){
      df.set(t, (df.get(t) || 0) + 1);
      vocab.add(t);
    }

    docs.push({
      id: r.id,
      row: r,
      num: (r.number ?? '').toString().toLowerCase(),
      nTitle, nLyrics,
      tfTitle, tfLyrics, tfAuthor, tfTune, tfScripture, tfMeter,
      terms: seen,
    });
  }

  return { N: rows.length, docs, df, vocab };
}

function countTokens(tokens){
  const m = Object.create(null);
  for (const t of tokens){ m[t] = (m[t] || 0) + 1; }
  return m;
}

function expandPrefix(vocab, prefix){
  if (!prefix || prefix.length < 2) return [];
  const out = [];
  const p = prefix.toLowerCase();
  let i = 0;
  for (const t of vocab){
    if (t.startsWith(p)){
      out.push(t);
      if (++i >= MAX_PREFIX_EXPANSIONS) break;
    }
  }
  return out;
}

function getQueryTerms(rest){
  const cleaned = simpleWords(rest);
  const raw = (cleaned.match(/[a-z0-9]+/g) || []).map(t => t.toLowerCase());
  // keep length>=2 terms; remove stopwords
  return raw.filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Match one query term against a document.
 * Returns:
 * - ok: boolean
 * - hits: array of actual vocab terms found in doc.terms (for scoring)
 * - subTitle/subLyrics: whether substring fallback matched normalized fields
 */
function matchOneTerm(doc, vocab, qt){
  if (!qt) return { ok: true, hits: [], subTitle: false, subLyrics: false };

  // exact token
  if (doc.terms.has(qt)) return { ok: true, hits: [qt], subTitle: false, subLyrics: false };

  // prefix expansion
  const ex = expandPrefix(vocab, qt);
  const hits = [];
  for (const t of ex){
    if (doc.terms.has(t)){
      hits.push(t);
      if (hits.length >= MAX_TERM_HITS_FOR_SCORING) break;
    }
  }
  if (hits.length) return { ok: true, hits, subTitle: false, subLyrics: false };

  // substring fallback (helps partials that aren't token-prefix friendly)
  if (qt.length >= 3){
    const inTitle = strIncludes(doc.nTitle, qt);
    const inLyrics = strIncludes(doc.nLyrics, qt);
    if (inTitle || inLyrics) return { ok: true, hits: [], subTitle: inTitle, subLyrics: inLyrics };
  }

  return { ok: false, hits: [], subTitle: false, subLyrics: false };
}

export function search(index, rows, q){
  const s = (q || '').trim();
  if (!s) return rows;

  const { N, docs, df, vocab } = index;

  // Extract quoted phrases (still honored strictly)
  const phraseRe = /"([^"]+)"/g;
  const quotedPhrases = [];
  let m;
  while ((m = phraseRe.exec(s))) quotedPhrases.push(m[1]);
  const nQuotedPhrases = quotedPhrases.map(p => simpleWords(p)).filter(Boolean);

  // Remaining text (unquoted)
  const rest = s.replace(phraseRe, ' ').trim();

  // Pure number? exact match fast-path
  if (/^\d+$/.test(rest)){
    const want = rest.toLowerCase();
    const hit = docs.find(d => d.num === want);
    if (hit) return [hit.row];
    // If not found, keep going (user might be searching number-like text)
  }

  const qTerms = getQueryTerms(rest);
  const phraseForBoost = (qTerms.length >= 2) ? qTerms.join(' ') : null;

  const results = [];
  for (const doc of docs){
    // 1) All quoted phrases must appear (title or lyrics)
    let pass = true;
    for (const ph of nQuotedPhrases){
      if (!(strIncludes(doc.nTitle, ph) || strIncludes(doc.nLyrics, ph))){ pass = false; break; }
    }
    if (!pass) continue;

    // 2) AND-by-terms (prefix/partial supported)
    const matchedTerms = new Set();
    let subTitleHit = false;
    let subLyricsHit = false;

    for (const qt of qTerms){
      const r = matchOneTerm(doc, vocab, qt);
      if (!r.ok){ pass = false; break; }
      for (const t of r.hits) matchedTerms.add(t);
      if (r.subTitle) subTitleHit = true;
      if (r.subLyrics) subLyricsHit = true;
    }
    if (!pass) continue;

    // Score
    let score = 0;

    // Phrase boosts (quoted)
    for (const ph of nQuotedPhrases){
      if (strIncludes(doc.nTitle, ph))  score += WEIGHTS.phraseTitle;
      if (strIncludes(doc.nLyrics, ph)) score += WEIGHTS.phraseLyrics;
    }

    // Phrase boost (unquoted multi-term) — boost only, not required
    if (phraseForBoost){
      if (strIncludes(doc.nTitle, phraseForBoost))  score += WEIGHTS.phraseTitle;
      if (strIncludes(doc.nLyrics, phraseForBoost)) score += WEIGHTS.phraseLyrics;
    }

    // Substring fallback nudges (so substring-only matches still rank and don't get dropped)
    if (subTitleHit) score += WEIGHTS.substrTitle;
    if (subLyricsHit) score += WEIGHTS.substrLyrics;

    // TF-IDF scoring for matched terms (actual tokens present in doc)
    for (const t of matchedTerms){
      const idf = log1p(N / ((df.get(t) || 0) + 1));
      const tfT = doc.tfTitle[t]     || 0;
      const tfL = doc.tfLyrics[t]    || 0;
      const tfA = doc.tfAuthor[t]    || 0;
      const tfU = doc.tfTune[t]      || 0;
      const tfS = doc.tfScripture[t] || 0;
      const tfM = doc.tfMeter[t]     || 0;

      const fieldSum =
        WEIGHTS.title     * Math.sqrt(tfT) +
        WEIGHTS.lyrics    * Math.sqrt(tfL) +
        WEIGHTS.author    * Math.sqrt(tfA) +
        WEIGHTS.tune      * Math.sqrt(tfU) +
        WEIGHTS.scripture * Math.sqrt(tfS) +
        WEIGHTS.meter     * Math.sqrt(tfM);

      score += idf * fieldSum;
    }

    // Extra nudge if a number was in the text and exactly matches this hymn
    if (/\b\d+\b/.test(rest) && doc.num === rest.toLowerCase()){
      score += WEIGHTS.exactNumber;
    }

    // If we matched via gating but still have a 0 score (rare), keep it with a tiny baseline
    if (score <= 0 && (qTerms.length || nQuotedPhrases.length)) score = 0.0001;

    results.push({ row: doc.row, score });
  }

  results.sort((a,b)=> b.score - a.score || numAsc(a.row,b.row) || titleAsc(a.row,b.row));
  return results.map(r => r.row);
}

function numAsc(a,b){
  const an = parseInt((a.number ?? '0'), 10);
  const bn = parseInt((b.number ?? '0'), 10);
  if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
  if (Number.isNaN(an)) return 1;
  if (Number.isNaN(bn)) return -1;
  return an - bn;
}
function titleAsc(a,b){
  const at = (a.title || '').toLowerCase();
  const bt = (b.title || '').toLowerCase();
  return at < bt ? -1 : at > bt ? 1 : 0;
}