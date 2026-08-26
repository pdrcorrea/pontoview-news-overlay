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
      primary: '#003366',
      secondary: '#ffffff',
      surface: '#ffffff',
      text: '#111827',
      muted: '#667585',
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
  const script = document.currentScript;
  const base = script?.src ? new URL('.', script.src) : new URL('./', location.href);

  if (!document.querySelector('link[data-pv-weather-visual-v2]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('weather-visual-v2.css', base).href;
    link.dataset.pvWeatherVisualV2 = 'true';
    document.head.appendChild(link);
  }

  if (!document.querySelector('script[data-pv-weather-effects]')) {
    const effects = document.createElement('script');
    effects.src = new URL('weather-visual-effects.js', base).href;
    effects.async = false;
    effects.dataset.pvWeatherEffects = 'true';
    document.head.appendChild(effects);
  }
})();
