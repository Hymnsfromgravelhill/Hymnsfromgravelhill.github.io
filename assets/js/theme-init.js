// Applies the saved colour theme before first paint (no flash). "auto" follows the device.
(function () {
  try {
    var t = localStorage.getItem('hfg_theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: stay on auto */ }
})();
