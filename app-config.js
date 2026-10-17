(() => {
  'use strict';

  // Identidade visual e metadados instaláveis compartilhados pelo Studio.
  const ensureLink = (rel, href, extra = {}) => {
    if (document.querySelector(`link[rel="${rel}"][href*="${href.split('?')[0]}"]`)) return;
    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;
    Object.entries(extra).forEach(([key, value]) => link.setAttribute(key, value));
    document.head.appendChild(link);
  };
  ensureLink('stylesheet', './brand-glossy.css?v=20261017-1');
  ensureLink('manifest', './manifest.webmanifest?v=20261017-1');
  ensureLink('icon', './assets/IconeAzul.png?v=20261017-1', { type: 'image/png' });
  ensureLink('apple-touch-icon', './assets/IconeAzul.png?v=20261017-1');

  if (!document.querySelector('meta[name="theme-color"]')) {
    const theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#0b1726';
    document.head.appendChild(theme);
  }
  if (!document.querySelector('meta[name="application-name"]')) {
    const appName = document.createElement('meta');
    appName.name = 'application-name';
    appName.content = 'PontoView Studio';
    document.head.appendChild(appName);
  }
  if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
    const capable = document.createElement('meta');
    capable.name = 'mobile-web-app-capable';
    capable.content = 'yes';
    document.head.appendChild(capable);
  }
  if (!document.querySelector('meta[name="apple-mobile-web-app-capable"]')) {
    const appleCapable = document.createElement('meta');
    appleCapable.name = 'apple-mobile-web-app-capable';
    appleCapable.content = 'yes';
    document.head.appendChild(appleCapable);
  }

  const path = String(location.pathname || '');
  const isNewsControl = /(?:^|\/)control\.html$/i.test(path);
  if (isNewsControl) {
    const qs = new URLSearchParams(location.search);
    const workspace = qs.get('workspace');
    const program = qs.get('program');
    const session = qs.get('session');
    if (!workspace || !program || !session) {
      const selector = new URL('./news-workspaces.html', location.href);
      if (workspace) selector.searchParams.set('workspace', workspace);
      if (program) selector.searchParams.set('program', program);
      location.replace(selector.toString());
      return;
    }
  }

  window.PV_CONFIG = Object.freeze({
    supabaseUrl: 'https://fpdojntvnhiszagczfqr.supabase.co',
    supabaseKey: 'sb_publishable_hd9GQaTeJ18o3pwMIZevJQ_EgVIOVOp',
    product: 'news_overlay',
    supabaseJsVersion: '2.112.3',
    defaultState: {
      template: 'lower_third',
      content: { tag: '', headline: '', detail: '', ticker: '' },
      style: {
        primary: '#003366',
        secondary: '#ffffff',
        tickerBg: '#111827',
        tickerText: '#ffffff',
        font: 'Inter',
        animation: 'slide-up',
        logoUrl: '',
        showLogo: false,
        showTime: true,
        tickerSpeed: 80
      },
      visibility: {
        live: false,
        tag: true,
        headline: true,
        detail: true,
        ticker: false,
        logo: false
      }
    }
  });
})();
