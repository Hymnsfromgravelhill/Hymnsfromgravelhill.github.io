// Light / dark / auto toggle. Saved in localStorage under "hfg_theme".
const KEY = 'hfg_theme';
const ORDER = ['auto', 'light', 'dark'];
const ICON = { auto: '\u25D0', light: '\u2600', dark: '\u263E' };
const LABEL = { auto: 'match device', light: 'light', dark: 'dark' };
const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
const originals = metas.map((m) => m.getAttribute('content'));

function read() {
  try { const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : 'auto'; } catch (e) { return 'auto'; }
}
function apply(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
  metas.forEach((m, i) => m.setAttribute('content', mode === 'light' ? '#233E5B' : mode === 'dark' ? '#000000' : originals[i]));
  const btn = document.getElementById('themeBtn');
  if (btn) {
    btn.textContent = ICON[mode];
    btn.setAttribute('aria-label', 'Colour theme: ' + LABEL[mode] + ' (tap to change)');
    btn.title = 'Colour theme: ' + LABEL[mode];
  }
}
function set(mode) { try { localStorage.setItem(KEY, mode); } catch (e) { /* ignore */ } apply(mode); }

apply(read());
document.getElementById('themeBtn')?.addEventListener('click', () => set(ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length]));
