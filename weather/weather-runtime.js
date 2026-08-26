(() => {
  'use strict';

  const cfg = window.PV_WEATHER_CONFIG;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const root = document.getElementById('weather-root');
  const token = new URLSearchParams(location.search).get('token');
  const POLL_MS = 1200;

  let currentState = null;
  let currentRevision = -1;
  let currentStatus = null;
  let channel = null;
  let pollTimer = null;
  let weatherTimer = null;
  let rotationTimer = null;
  let refreshTimer = null;
  let refreshInFlight = false;
  let weatherInFlight = false;
  let cityIndex = 0;
  let nextRotationAt = 0;
  const weather = new Map();

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function normalize(raw) {
    const base = clone(cfg.defaultState);
    if (!raw || typeof raw !== 'object' || raw.product !== cfg.product) {
      base.visibility.widget = false;
      return base;
    }
    return {
      product: cfg.product,
      template: ['compact', 'informative', 'complete', 'multi'].includes(raw.template) ? raw.template : base.template,
      locations: Array.isArray(raw.locations) ? raw.locations.slice(0, 5).map((loc) => ({
        id: String(loc.id || `${loc.latitude},${loc.longitude}`),
        name: String(loc.name || 'Cidade'),
        admin1: String(loc.admin1 || ''),
        country: String(loc.country || ''),
        countryCode: String(loc.countryCode || ''),
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        timezone: String(loc.timezone || 'auto')
      })).filter((loc) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) : [],
      rotation: { ...base.rotation, ...(raw.rotation || {}) },
      style: { ...base.style, ...(raw.style || {}) },
      display: { ...base.display, ...(raw.display || {}) },
      visibility: { ...base.visibility, ...(raw.visibility || {}) }
    };
  }

  function weatherKey(loc) {
    return `${Number(loc.latitude).toFixed(4)},${Number(loc.longitude).toFixed(4)}`;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function conditionLabel(code) {
    code = Number(code);
    if (code === 0) return 'Céu limpo';
    if (code === 1) return 'Predomínio de sol';
    if (code === 2) return 'Parcialmente nublado';
    if (code === 3) return 'Nublado';
    if ([45, 48].includes(code)) return 'Neblina';
    if ([51, 53, 55, 56, 57].includes(code)) return 'Garoa';
    if ([61, 63, 65, 66, 67].includes(code)) return 'Chuva';
    if ([71, 73, 75, 77].includes(code)) return 'Neve';
    if ([80, 81, 82].includes(code)) return 'Pancadas de chuva';
    if ([85, 86].includes(code)) return 'Pancadas de neve';
    if ([95, 96, 99].includes(code)) return 'Trovoadas';
    return 'Tempo variável';
  }

  function weatherIconSvg(code, isDay = true) {
    code = Number(code);
    const sun = `<circle cx="32" cy="32" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
    const moon = `<path d="M43 43c-14 3-25-9-22-22 2-8 8-13 15-15-3 10 4 21 15 23-1 6-4 11-8 14Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`;
    const cloud = `<path d="M20 45h27c7 0 12-5 12-11 0-7-6-12-13-12h-2C41 14 35 10 27 11c-9 1-15 8-15 17-5 1-8 5-8 9 0 5 4 8 9 8h7Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    let body = '';
    if (code === 0 || code === 1) body = isDay ? sun : moon;
    else if ([2, 3, 45, 48].includes(code)) body = cloud;
    else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) body = `${cloud}<path d="M22 50l-4 7M34 50l-4 7M46 50l-4 7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
    else if ([71, 73, 75, 77, 85, 86].includes(code)) body = `${cloud}<path d="M22 52h0M34 52h0M46 52h0" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`;
    else if ([95, 96, 99].includes(code)) body = `${cloud}<path d="M36 48l-7 10h7l-4 8 13-14h-8l4-4" fill="currentColor"/>`;
    else body = cloud;
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
  }

  function formatTemp(value) {
    return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}` : '—';
  }

  function applyTheme(state) {
    root.style.setProperty('--w-primary', state.style.primary || '#003366');
    root.style.setProperty('--w-secondary', state.style.secondary || '#ffffff');
    root.style.setProperty('--w-surface', state.style.surface || '#ffffff');
    root.style.setProperty('--w-text', state.style.text || '#111827');
    root.style.setProperty('--w-muted', state.style.muted || '#667585');
    root.style.fontFamily = state.style.font || 'Inter';
  }

  async function fetchWeather(state = currentState, force = false) {
    if (weatherInFlight || !state?.locations?.length) return;
    const locations = state.locations;
    const allCached = locations.every((loc) => weather.has(weatherKey(loc)));
    if (!force && allCached) return;
    weatherInFlight = true;
    try {
      const url = new URL(cfg.openMeteo.forecastUrl);
      url.searchParams.set('latitude', locations.map((l) => l.latitude).join(','));
      url.searchParams.set('longitude', locations.map((l) => l.longitude).join(','));
      url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m');
      url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
      url.searchParams.set('timezone', 'auto');
      url.searchParams.set('forecast_days', '1');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
      const json = await response.json();
      const rows = Array.isArray(json) ? json : [json];
      rows.forEach((row, index) => {
        const loc = locations[index];
        if (!loc) return;
        weather.set(weatherKey(loc), {
          temperature: row.current?.temperature_2m,
          apparent: row.current?.apparent_temperature,
          humidity: row.current?.relative_humidity_2m,
          wind: row.current?.wind_speed_10m,
          code: row.current?.weather_code ?? row.daily?.weather_code?.[0],
          isDay: row.current?.is_day !== 0,
          min: row.daily?.temperature_2m_min?.[0],
          max: row.daily?.temperature_2m_max?.[0],
          updatedAt: row.current?.time || new Date().toISOString()
        });
      });
      if (currentState === state && state.visibility.widget) refreshVisibleWeather();
    } catch (error) {
      console.warn('PontoView Weather data:', error);
    } finally {
      weatherInFlight = false;
    }
  }

  function cityContentHtml(state, index) {
    const loc = state.locations[clamp(index, 0, state.locations.length - 1)];
    const w = weather.get(weatherKey(loc)) || {};
    const extras = [];
    if (state.display.showMinMax) extras.push(`<div class="weather-extra-row"><span>Mín / Máx</span><strong>${formatTemp(w.min)}° / ${formatTemp(w.max)}°</strong></div>`);
    if (state.display.showHumidity) extras.push(`<div class="weather-extra-row"><span>Umidade</span><strong>${Number.isFinite(Number(w.humidity)) ? `${Math.round(w.humidity)}%` : '—'}</strong></div>`);
    if (state.display.showWind) extras.push(`<div class="weather-extra-row"><span>Vento</span><strong>${Number.isFinite(Number(w.wind)) ? `${Math.round(w.wind)} km/h` : '—'}</strong></div>`);
    return `<div class="weather-icon-box">${weatherIconSvg(w.code, w.isDay)}</div><div class="weather-main"><div class="weather-temp">${formatTemp(w.temperature)}<sup>°C</sup></div><div class="weather-copy"><div class="weather-city">${escapeHtml(loc.name)}</div>${state.display.showCondition ? `<div class="weather-condition">${escapeHtml(conditionLabel(w.code))}</div>` : ''}</div></div>${extras.length ? `<div class="weather-extra">${extras.join('')}</div>` : ''}`;
  }

  function multiHtml(state) {
    return state.locations.map((loc) => {
      const w = weather.get(weatherKey(loc)) || {};
      return `<div class="weather-multi-item"><div class="weather-multi-city">${escapeHtml(loc.name)}</div><div class="weather-multi-data">${weatherIconSvg(w.code, w.isDay)}<span class="weather-multi-temp">${formatTemp(w.temperature)}°</span></div>${state.display.showCondition ? `<div class="weather-multi-cond">${escapeHtml(conditionLabel(w.code))}</div>` : ''}</div>`;
    }).join('');
  }

  function renderWidget(state, instant = false) {
    root.replaceChildren();
    if (!state.visibility.widget || !state.locations.length) return;
    applyTheme(state);

    const layer = document.createElement('div');
    layer.className = 'weather-layer';
    const widget = document.createElement('div');
    widget.className = `weather-widget pos-${state.style.position || 'top-left'}`;
    widget.style.scale = String(clamp(Number(state.style.scale || 1), .75, 1.35));

    if (state.template === 'multi') {
      widget.innerHTML = `<div class="weather-multi">${multiHtml(state)}</div><div class="weather-credit">Dados: Open-Meteo</div>`;
    } else {
      widget.innerHTML = `<div class="weather-card template-${state.template}"><div class="weather-accent"></div><div class="weather-city-content">${cityContentHtml(state, cityIndex)}</div></div><div class="weather-credit">Dados: Open-Meteo</div>`;
    }
    layer.appendChild(widget);
    root.appendChild(layer);

    if (instant) {
      gsap.set(widget, { clipPath: 'inset(0 0% 0 0)', opacity: 1, x: 0, y: 0 });
    } else {
      gsap.fromTo(widget, { clipPath: 'inset(0 100% 0 0)', opacity: 0, x: -22 }, { clipPath: 'inset(0 0% 0 0)', opacity: 1, x: 0, duration: .5, ease: 'power3.out', overwrite: true });
    }
  }

  function animateOut(done) {
    const widget = root.querySelector('.weather-widget');
    if (!widget) return done();
    gsap.killTweensOf(widget);
    gsap.to(widget, { clipPath: 'inset(0 100% 0 0)', opacity: 0, x: -18, duration: .22, ease: 'power2.in', overwrite: true, onComplete: done });
  }

  async function applyState(raw, instant = false) {
    const next = normalize(raw);
    currentState = next;
    cityIndex = clamp(Number(next.rotation.activeIndex || 0), 0, Math.max(0, next.locations.length - 1));
    nextRotationAt = Date.now() + Math.max(3, Number(next.rotation.interval || 8)) * 1000;
    if (next.locations.length) await fetchWeather(next, false);
    const commit = () => renderWidget(next, instant);
    if (instant || !root.querySelector('.weather-widget')) commit();
    else animateOut(commit);
  }

  function rotateCity() {
    const state = currentState;
    if (!state || !state.visibility.widget || state.template === 'multi' || !state.rotation.enabled || state.locations.length < 2) return;
    if (Date.now() < nextRotationAt) return;
    nextRotationAt = Date.now() + Math.max(3, Number(state.rotation.interval || 8)) * 1000;
    cityIndex = (cityIndex + 1) % state.locations.length;
    const content = root.querySelector('.weather-city-content');
    if (!content) return renderWidget(state, true);
    gsap.killTweensOf(content);
    gsap.to(content, {
      clipPath: 'inset(0 0 0 100%)',
      opacity: 0,
      x: 18,
      duration: .2,
      ease: 'power2.in',
      onComplete: () => {
        content.innerHTML = cityContentHtml(state, cityIndex);
        gsap.set(content, { clipPath: 'inset(0 100% 0 0)', opacity: 0, x: -14 });
        gsap.to(content, { clipPath: 'inset(0 0% 0 0)', opacity: 1, x: 0, duration: .34, ease: 'power3.out' });
      }
    });
  }

  function refreshVisibleWeather() {
    if (!currentState?.visibility.widget || !currentState.locations.length) return;
    if (currentState.template === 'multi') {
      const multi = root.querySelector('.weather-multi');
      if (multi) multi.innerHTML = multiHtml(currentState);
      return;
    }
    const content = root.querySelector('.weather-city-content');
    if (content) content.innerHTML = cityContentHtml(currentState, cityIndex);
  }

  async function refreshWeatherNow() {
    if (!currentState?.locations?.length) return;
    await fetchWeather(currentState, true);
  }

  async function refreshProgram({ instant = false, force = false } = {}) {
    if (refreshInFlight || !token) return;
    refreshInFlight = true;
    try {
      const { data, error } = await sb.rpc('get_overlay_state', { p_token: token });
      if (error) {
        console.error('PontoView Weather state:', error);
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.program_state) {
        currentStatus = 'ended';
        if (root.querySelector('.weather-widget')) animateOut(() => root.replaceChildren());
        return;
      }
      const revision = Number(row.revision ?? -1);
      currentStatus = row.status || null;
      if (!force && revision <= currentRevision) return;
      currentRevision = revision;
      await applyState(row.program_state, instant);
    } catch (error) {
      console.error('PontoView Weather refresh:', error);
    } finally {
      refreshInFlight = false;
    }
  }

  function scheduleCanonicalRefresh(delay = 60) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshProgram(), delay);
  }

  async function bootstrap() {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
      root.replaceChildren();
      console.error('PontoView Weather: token inválido.');
      return;
    }

    await refreshProgram({ instant: true, force: true });

    channel = sb.channel(`overlay:${token}`, { config: { private: false } })
      .on('broadcast', { event: 'program' }, () => scheduleCanonicalRefresh(35))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') scheduleCanonicalRefresh(0);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('PontoView Weather Realtime:', status, 'Polling permanece ativo.');
      });

    pollTimer = setInterval(() => refreshProgram(), POLL_MS);
    weatherTimer = setInterval(refreshWeatherNow, cfg.openMeteo.refreshMs);
    rotationTimer = setInterval(rotateCity, 250);
  }

  window.addEventListener('online', () => { scheduleCanonicalRefresh(0); refreshWeatherNow(); });
  window.addEventListener('focus', () => scheduleCanonicalRefresh(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { scheduleCanonicalRefresh(0); refreshWeatherNow(); } });
  window.addEventListener('beforeunload', () => {
    clearTimeout(refreshTimer);
    clearInterval(pollTimer);
    clearInterval(weatherTimer);
    clearInterval(rotationTimer);
    if (channel) sb.removeChannel(channel);
  });

  bootstrap();
})();
