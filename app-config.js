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
