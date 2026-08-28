window.PV_WEATHER_VISUAL_VERSION = 'v4-20260828-1';
window.PV_WEATHER_CONFIG = Object.freeze({
  supabaseUrl: 'https://fpdojntvnhiszagczfqr.supabase.co',
  supabaseKey: 'sb_publishable_hd9GQaTeJ18o3pwMIZevJQ_EgVIOVOp',
  product: 'weather_overlay',
  supabaseJsVersion: '2.112.3',
  weatherApiUrl: 'https://fpdojntvnhiszagczfqr.supabase.co/functions/v1/weather-api',
  refreshMs: 10 * 60 * 1000,
  defaultState: {
    product: 'weather_overlay',
    template: 'informative',
    mode: 'carousel',
    locations: [],
    rotation: {
      enabled: true,
      interval: 8,
      activeIndex: 0
    },
    style: {
      primary: '#175fb5',
      secondary: '#ffffff',
      surface: '#ffffff',
      text: '#082a54',
      muted: '#58708a',
      font: 'Inter',
      position: 'bottom-left',
      offsetX: 0,
      offsetY: 0,
      animation: 'wipe',
      scale: 1
    },
    display: {
      showCondition: true,
      showMinMax: true,
      showHumidity: false,
      showWind: false,
      showUpdated: false
    },
    visibility: {
      widget: true
    }
  }
});

(() => {
  if (document.querySelector('link[data-pv-weather-polish-v4]')) return;
  const base = document.currentScript?.src ? new URL('.', document.currentScript.src) : new URL('./', location.href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('weather-polish-v4.css?v=20260828-1', base).href;
  link.dataset.pvWeatherPolishV4 = '1';
  document.head.appendChild(link);
})();
