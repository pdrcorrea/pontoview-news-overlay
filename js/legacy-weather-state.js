/**
 * PontoView Studio — compatibilidade do estado Weather legado do News.
 * Fonte única para normalização usada pelo controle e pela saída de vídeo.
 * Não substitui o modelo V2 de cidades verificadas (locations).
 */
(() => {
  'use strict';

  const DEFAULT_WEATHER = Object.freeze({
    visible: false,
    cities: [],
    position: 'top-right',
    layout: 'row',
    unit: 'celsius',
    showHumidity: true,
    showWind: false,
    refreshMinutes: 10
  });

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function normalizeWeather(raw) {
    const x = { ...clone(DEFAULT_WEATHER), ...(raw && typeof raw === 'object' ? raw : {}) };
    x.cities = [...new Set((Array.isArray(x.cities) ? x.cities : []).map(v => String(v || '').trim()).filter(Boolean))].slice(0, 5);
    x.visible = !!x.visible;
    x.showHumidity = x.showHumidity !== false;
    x.showWind = !!x.showWind;
    x.position = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(x.position) ? x.position : 'top-right';
    x.layout = x.layout === 'column' ? 'column' : 'row';
    x.unit = x.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
    x.refreshMinutes = Math.max(5, Number(x.refreshMinutes || 10));
    return x;
  }

  function readJSON(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function stripWeather(state) {
    if (!state || typeof state !== 'object') return state;
    const next = clone(state);
    delete next.weather;
    return next;
  }

  window.PVLegacyWeather = Object.freeze({
    DEFAULT_WEATHER,
    normalizeWeather,
    readJSON,
    stripWeather
  });
})();
