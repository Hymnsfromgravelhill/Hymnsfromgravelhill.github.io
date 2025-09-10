// assets/js/search.js — phrase-by-default + strict mode
import { normalize } from './utils.js';

/**
 * Rules:
 * - If query is a pure number -> exact hymn match fast-path.
 * - If query has multiple words (ignoring punctuation), treat as a PHRASE by default:
 *     require that normalized title OR lyrics contain that contiguous phrase.
 *   (No quotes needed; quotes still work and behave the same.)
 * - If query is a single word:
 *     strict match (no OR fallback), with prefix expansion on the last word while typing.
 * - Scoring: tf-idf with field weights; phrase matches get a big boost.
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
};

const MAX_PREFIX_EXPANSIONS = 50;

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

    const nTitle     = normalize(titleRaw);
    const nLyrics    = normalize(lyricsRaw);
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

function hasAllTerms(doc, terms){
  for (const t of terms) if (!doc.terms.has(t)) return false;
  return true;
}

export function search(index, rows, q){
  const s = (q || '').trim();
  if (!s) return rows;

  const { N, docs, df, vocab } = index;

  // Extract quoted phrases (still honored)
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
    // strict: fall through to other logic if not found
  }

  // Decide mode: phrase-by-default when multi-word input (ignoring punctuation)
  const cleaned = simpleWords(rest);              // e.g., "thine the glory"
  const hasSpace = cleaned.includes(' ');
  const defaultPhrase = hasSpace ? cleaned : null;

  // Token set for single-word strict search
  const terms = tokenize(rest);

  const results = [];
  for (const doc of docs){
    // 1) All quoted phrases must appear (title or lyrics)
    let pass = true;
    for (const ph of nQuotedPhrases){
      if (!(strIncludes(doc.nTitle, ph) || strIncludes(doc.nLyrics, ph))){ pass = false; break; }
    }
    if (!pass) continue;

    // 2) If defaultPhrase is set (multi-word query without quotes), REQUIRE that phrase too
    if (defaultPhrase){
      if (!(strIncludes(doc.nTitle, defaultPhrase) || strIncludes(doc.nLyrics, defaultPhrase))) continue;
    } else {
      // Single-word strict: require that term (with prefix expansion while typing)
      if (terms.length){
        const last = terms[terms.length - 1];
        const expansions = expandPrefix(vocab, last);
        const required = terms.slice(0, -1); // earlier tokens must all be present (usually none for single-word)
        if (!hasAllTerms(doc, required)) continue;

        if (expansions.length){
          // last must match at least one expansion
          let ok = false;
          for (const t of expansions){ if (doc.terms.has(t)) { ok = true; break; } }
          if (!ok) continue;
        } else {
          // no expansions → the last must be present exactly
          if (!doc.terms.has(last)) continue;
        }
      }
    }

    // Score
    let score = 0;

    // Phrase boosts
    for (const ph of nQuotedPhrases){
      if (strIncludes(doc.nTitle, ph))  score += WEIGHTS.phraseTitle;
      if (strIncludes(doc.nLyrics, ph)) score += WEIGHTS.phraseLyrics;
    }
    if (defaultPhrase){
      if (strIncludes(doc.nTitle, defaultPhrase))  score += WEIGHTS.phraseTitle;
      if (strIncludes(doc.nLyrics, defaultPhrase)) score += WEIGHTS.phraseLyrics;
    }

    // TF-IDF scoring for terms (helps ranking among equals)
    const termSet = new Set(terms);
    for (const t of termSet){
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

    if (score > 0) results.push({ row: doc.row, score });
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
