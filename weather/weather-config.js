window.PV_WEATHER_VISUAL_VERSION = 'v2.1-20260826-4';
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
