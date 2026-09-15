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

  const core = document.createElement('script');
  core.src = './app-core.js?v=20260915-1';
  core.async = false;
  document.body.append(core);
})();
