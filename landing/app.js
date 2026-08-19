(() => {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');

  toggle?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  nav?.querySelectorAll('.nav-links a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle?.setAttribute('aria-expanded', 'false');
    });
  });

  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('app');
  const configured = window.PLUSONE_APP_URL;
  // Same-origin `/app` when this page is deployed next to the Expo bundle;
  // otherwise the production messenger.
  const production = 'https://broskie-h.up.railway.app';
  const sameOriginApp = `${window.location.origin}/app`;
  const appBase = configured || fromQuery || (window.PLUSONE_USE_LOCAL_APP ? sameOriginApp : production);

  function appHref(mode) {
    try {
      const url = new URL(appBase, window.location.origin);
      if (mode) url.searchParams.set('start', mode);
      return url.toString();
    } catch {
      return production;
    }
  }

  document.querySelectorAll('[data-app-link]').forEach((el) => {
    const mode = el.getAttribute('data-mode');
    el.setAttribute('href', appHref(mode));
  });
})();
