window.PV_WEATHER_CONFIG = Object.freeze({
  supabaseUrl: 'https://fpdojntvnhiszagczfqr.supabase.co',
  supabaseKey: 'sb_publishable_hd9GQaTeJ18o3pwMIZevJQ_EgVIOVOp',
  product: 'weather_overlay',
  supabaseJsVersion: '2.112.3',
  openMeteo: {
    geocodingUrl: 'https://geocoding-api.open-meteo.com/v1/search',
    forecastUrl: 'https://api.open-meteo.com/v1/forecast',
    refreshMs: 10 * 60 * 1000
  },
  defaultState: {
    product: 'weather_overlay',
    template: 'informative',
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
      position: 'top-left',
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
