// Runs before first paint so the page never flashes the wrong theme.
(function () {
  var d = document.documentElement, t = 'auto';
  try { t = localStorage.getItem('hymns.theme') || 'auto'; } catch (e) {}
  if (t === 'light' || t === 'dark') d.setAttribute('data-theme', t);
  if (/[?&]app=1\b/.test(location.search) || window.HymnNative) d.setAttribute('data-mode', 'app');
})();
