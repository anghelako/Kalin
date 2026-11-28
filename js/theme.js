/* Light / dark theme.
   Load this in <head> so the saved choice is applied before the page paints.
   With no saved choice the theme follows the device setting. */
(function () {
  const KEY = 'kalin-theme';
  const root = document.documentElement;
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch {
      return null;
    }
  }

  function current() {
    return saved() || (media && media.matches ? 'dark' : 'light');
  }

  function apply() {
    root.dataset.theme = current();
    syncButton();
  }

  function set(theme) {
    try { localStorage.setItem(KEY, theme); } catch { /* private mode: the choice lasts until reload */ }
    root.dataset.theme = theme;
    syncButton();
  }

  const MOON = '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>';
  const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';

  function syncButton() {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const dark = root.dataset.theme === 'dark';
    button.querySelector('svg').innerHTML = dark ? SUN : MOON;
    button.querySelector('span').textContent = dark ? 'Light mode' : 'Dark mode';
    button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  function addButton() {
    const menu = document.getElementById('profile-actions');
    if (!menu || document.getElementById('theme-toggle')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    button.id = 'theme-toggle';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"></svg><span></span>';
    button.addEventListener('click', () => set(root.dataset.theme === 'dark' ? 'light' : 'dark'));
    menu.insertBefore(button, menu.firstChild);
    syncButton();
  }

  window.KalinTheme = { current, set };
  if (media && media.addEventListener) media.addEventListener('change', apply);
  // Keep other open tabs in step
  window.addEventListener('storage', event => { if (event.key === KEY) apply(); });

  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton);
  else addButton();
})();
