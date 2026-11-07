// Runs before first paint so the app never flashes the wrong theme.
(function () {
  try {
    var t = localStorage.getItem('hymns.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: stay on auto */ }
})();
