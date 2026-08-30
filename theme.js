/* Shared dark-mode toggle for the Everything PDF suite (home page, pics2pdf,
   PDF Editor). Include as the first thing in <head>, before any stylesheet,
   so the .dark class lands on <html> before first paint — no flash of the
   wrong theme. Each page still owns its own :root/.dark token values;
   this file only owns the on/off switch and its persistence. */
(function () {
  var KEY = 'epdf-theme';
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  var theme = stored || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.classList.toggle('dark', theme === 'dark');

  window.EPDFTheme = {
    get: function () {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    },
    set: function (next) {
      document.documentElement.classList.toggle('dark', next === 'dark');
      try { localStorage.setItem(KEY, next); } catch (e) {}
    },
    toggle: function () {
      var next = this.get() === 'dark' ? 'light' : 'dark';
      this.set(next);
      return next;
    },
    // Wires a button to flip the theme and keep its icon/label in sync.
    // Expects a Phosphor <i> icon child; swaps ph-moon <-> ph-sun.
    wireToggleButton: function (btn) {
      var self = this;
      function sync() {
        var dark = self.get() === 'dark';
        btn.setAttribute('aria-pressed', String(dark));
        btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
        var icon = btn.querySelector('i');
        if (icon) icon.className = dark ? 'ph ph-sun' : 'ph ph-moon';
      }
      sync();
      btn.addEventListener('click', function () {
        self.toggle();
        sync();
      });
    }
  };
})();
