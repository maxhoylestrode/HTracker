// Applies a cached theme choice before first paint, so switching pages (or a
// fresh load) doesn't flash the default dark theme before snapping to the
// user's actual choice. common.js reconciles this with the server value
// once the session loads, in case the theme was changed on another device.
(function () {
  try {
    var t = localStorage.getItem('htracker-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    // localStorage unavailable (private browsing etc.) — falls back to default dark theme
  }
})();
