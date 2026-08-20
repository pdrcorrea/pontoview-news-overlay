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

(() => {
  const path = window.location.pathname.toLowerCase();
  if (!path.endsWith('/control.html') && !path.endsWith('control.html')) return;

  ['./monitor-parity.css', './operation-ui.css'].forEach((href) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });

  ['./monitor-parity.js', './operation-ui.js'].forEach((src) => {
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  });
})();
