(() => {
  const RETURN_KEY = 'selinaProfileManagerReturnTo';
  const TOKEN_KEY = 'selinaDashboardToken';
  const params = new URLSearchParams(location.search);
  const isOAuthCallback = Boolean(params.get('code') && params.get('state'));

  function safeReturnUrl() {
    let raw = '';
    try { raw = localStorage.getItem(RETURN_KEY) || ''; } catch {}
    if (!raw) return null;

    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return null;
      if (url.pathname !== '/admin/profile/') return null;
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }

  const returnTo = isOAuthCallback ? safeReturnUrl() : null;

  if (returnTo) {
    const started = Date.now();
    const timer = setInterval(() => {
      let token = '';
      try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch {}

      if (token) {
        clearInterval(timer);
        try { localStorage.removeItem(RETURN_KEY); } catch {}
        location.replace(returnTo);
        return;
      }

      if (Date.now() - started > 30000) {
        clearInterval(timer);
      }
    }, 200);
  }

  function installProfileManagerShortcut() {
    const sidefoot = document.querySelector('.sidefoot');
    if (!sidefoot || document.getElementById('profileManagerShortcut')) return;

    const style = document.createElement('style');
    style.textContent = `
      #profileManagerShortcut {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        width: 100%;
        min-height: 38px;
        margin: 8px 0 2px;
        padding: 8px 10px;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 10px;
        background: rgba(255,255,255,.035);
        color: inherit;
        text-decoration: none;
        font-size: 12px;
        font-weight: 700;
        transition: background .18s ease, border-color .18s ease, transform .18s ease;
      }
      #profileManagerShortcut:hover {
        background: rgba(255,255,255,.07);
        border-color: rgba(255,255,255,.17);
        transform: translateY(-1px);
      }
    `;
    document.head.append(style);

    const link = document.createElement('a');
    link.id = 'profileManagerShortcut';
    link.href = 'https://xm5o.github.io/admin/profile/';
    link.innerHTML = '<span>Site Profile Manager</span><span aria-hidden="true">↗</span>';
    link.setAttribute('aria-label', 'Open Site Profile Manager');

    const signOut = sidefoot.querySelector('#disconnectButton');
    if (signOut) sidefoot.insertBefore(link, signOut);
    else sidefoot.append(link);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installProfileManagerShortcut, { once: true });
  } else {
    installProfileManagerShortcut();
  }

  const core = document.createElement('script');
  core.src = './app-core.js?v=20260915-1';
  core.async = false;
  document.body.append(core);
})();
