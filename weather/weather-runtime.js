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
  let lastWeatherFetch = 0;
  let cityIndex = 0;
  let nextRotationAt = 0;
  const weather = new Map();

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const keyFor = (loc) => `${Number(loc.latitude).toFixed(4)},${Number(loc.longitude).toFixed(4)}`;

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function normalize(raw) {
    const base = clone(cfg.defaultState);
    if (!raw || typeof raw !== 'object' || raw.product !== cfg.product) {
      base.visibility.widget = false;
      return base;
    }
    const legacyMulti = raw.template === 'multi';
    const template = legacyMulti ? 'compact' : (['compact', 'informative', 'complete'].includes(raw.template) ? raw.template : base.template);
    const positions = ['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right'];
    const locations = Array.isArray(raw.locations) ? raw.locations.slice(0, 5).map((loc) => ({
      id: String(loc.id || `${loc.latitude},${loc.longitude}`),
      name: String(loc.name || 'Cidade'),
      admin1: String(loc.admin1 || ''),
      country: String(loc.country || ''),
      countryCode: String(loc.countryCode || ''),
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      timezone: String(loc.timezone || 'auto')
    })).filter((loc) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) : [];
    return {
      product: cfg.product,
      template,
      mode: legacyMulti ? 'panel' : (raw.mode === 'panel' ? 'panel' : 'carousel'),
      locations,
      rotation: { ...base.rotation, ...(raw.rotation || {}) },
      style: {
        ...base.style,
        ...(raw.style || {}),
        position: positions.includes(raw.style?.position) ? raw.style.position : base.style.position,
        offsetX: clamp(Number(raw.style?.offsetX || 0), -300, 300),
        offsetY: clamp(Number(raw.style?.offsetY || 0), -220, 220),
        scale: 1
      },
      display: { ...base.display, ...(raw.display || {}) },
      visibility: { ...base.visibility, ...(raw.visibility || {}) }
    };
  }

  function conditionLabel(code) {
    code = Number(code);
    if (code === 0) return 'Céu limpo';
    if (code === 1) return 'Predomínio de sol';
    if (code === 2) return 'Parcialmente nublado';
    if (code === 3) return 'Nublado';
    if ([45,48].includes(code)) return 'Neblina';
    if ([51,53,55,56,57].includes(code)) return 'Garoa';
    if ([61,63,65,66,67].includes(code)) return 'Chuva';
    if ([71,73,75,77].includes(code)) return 'Neve';
    if ([80,81,82].includes(code)) return 'Pancadas de chuva';
    if ([85,86].includes(code)) return 'Pancadas de neve';
    if ([95,96,99].includes(code)) return 'Trovoadas';
    return 'Tempo variável';
  }

  function weatherIconSvg(code, isDay = true) {
    code = Number(code);
    const sun = `<circle cx="32" cy="32" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
    const moon = `<path d="M43 43c-14 3-25-9-22-22 2-8 8-13 15-15-3 10 4 21 15 23-1 6-4 11-8 14Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`;
    const cloud = `<path d="M20 45h27c7 0 12-5 12-11 0-7-6-12-13-12h-2C41 14 35 10 27 11c-9 1-15 8-15 17-5 1-8 5-8 9 0 5 4 8 9 8h7Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    let body = '';
    if (code === 0 || code === 1) body = isDay ? sun : moon;
    else if ([2,3,45,48].includes(code)) body = cloud;
    else if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) body = `${cloud}<path d="M22 50l-4 7M34 50l-4 7M46 50l-4 7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
    else if ([71,73,75,77,85,86].includes(code)) body = `${cloud}<path d="M22 52h0M34 52h0M46 52h0" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`;
    else if ([95,96,99].includes(code)) body = `${cloud}<path d="M36 48l-7 10h7l-4 8 13-14h-8l4-4" fill="currentColor"/>`;
    else body = cloud;
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
  }

  const temp = (v) => Number.isFinite(Number(v)) ? `${Math.round(Number(v))}` : '—';

  async function fetchWeather(force = false) {
    if (weatherInFlight || !currentState?.locations?.length || !token) return;
    if (!force && Date.now() - lastWeatherFetch < cfg.refreshMs) return;
    weatherInFlight = true;
    try {
      const response = await fetch(cfg.weatherApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey },
        body: JSON.stringify({ mode: 'overlay', token })
      });
      if (!response.ok) throw new Error(`Weather backend ${response.status}`);
      const json = await response.json();
      (json.data || []).forEach((row) => weather.set(row.locationKey, row));
      lastWeatherFetch = Date.now();
      refreshVisibleWeather();
    } catch (error) {
      console.warn('PontoView Weather backend:', error);
    } finally {
      weatherInFlight = false;
    }
  }

  function supportHtml(state, w) {
    if (state.template === 'compact') return '';
    if (state.template === 'complete') {
      const pieces = [];
      if (state.display.showMinMax !== false) pieces.push(`<span>↓ <b>${temp(w.min)}°</b></span><span>↑ <b>${temp(w.max)}°</b></span>`);
      if (state.display.showHumidity && Number.isFinite(Number(w.humidity))) pieces.push(`<span>UR <b>${Math.round(w.humidity)}%</b></span>`);
      if (state.display.showWind && Number.isFinite(Number(w.wind))) pieces.push(`<span>V <b>${Math.round(w.wind)}</b></span>`);
      return `<div class="weather-support"><div class="weather-minmax">${pieces.join('')}</div></div>`;
    }
    return `<div class="weather-support"><span class="condition">${escapeHtml(conditionLabel(w.code))}</span></div>`;
  }

  function cityContentHtml(state, index) {
    const loc = state.locations[clamp(index, 0, Math.max(0, state.locations.length - 1))];
    if (!loc) return '';
    const w = weather.get(keyFor(loc)) || {};
    const conditionInline = state.template === 'complete' && state.display.showCondition !== false
      ? `<div class="weather-condition-inline">${escapeHtml(conditionLabel(w.code))}</div>` : '';
    return `<div class="weather-top"><div class="weather-icon-box">${weatherIconSvg(w.code, w.isDay)}</div><div class="weather-main"><div class="weather-temp">${temp(w.temperature)}<sup>°C</sup></div><div class="weather-city">${escapeHtml(loc.name)}</div>${conditionInline}</div></div>${supportHtml(state, w)}`;
  }

  function cardHtml(state, index) {
    return `<div class="weather-card template-${state.template}"><div class="weather-accent"></div><div class="weather-city-content">${cityContentHtml(state, index)}</div></div>`;
  }

  function anchorClass(position) {
    if (position.endsWith('left')) return 'anchor-left';
    if (position.endsWith('center')) return 'anchor-center';
    return 'anchor-right';
  }

  function applyTheme(state) {
    root.style.setProperty('--w-primary', state.style.primary || '#003366');
    root.style.setProperty('--w-secondary', state.style.secondary || '#ffffff');
    root.style.setProperty('--w-surface', state.style.surface || '#ffffff');
    root.style.setProperty('--w-text', state.style.text || '#111827');
    root.style.setProperty('--w-muted', state.style.muted || '#667585');
    root.style.fontFamily = state.style.font || 'Inter';
  }

  function renderWidget(state, instant = false) {
    root.replaceChildren();
    if (!state.visibility.widget || !state.locations.length) return;
    applyTheme(state);

    const layer = document.createElement('div');
    layer.className = 'weather-layer';
    const widget = document.createElement('div');
    const position = state.style.position || 'bottom-left';
    widget.className = `weather-widget pos-${position} ${anchorClass(position)}`;
    widget.style.setProperty('--offset-x', `${Number(state.style.offsetX || 0)}px`);
    widget.style.setProperty('--offset-y', `${Number(state.style.offsetY || 0)}px`);

    if (state.mode === 'panel') {
      widget.innerHTML = `<div class="weather-panel">${state.locations.map((_, i) => cardHtml(state, i)).join('')}</div><div class="weather-credit">Dados: Open-Meteo</div>`;
    } else {
      widget.innerHTML = `${cardHtml(state, cityIndex)}<div class="weather-credit">Dados: Open-Meteo</div>`;
    }
    layer.appendChild(widget);
    root.appendChild(layer);

    if (instant) gsap.set(widget, { clipPath: 'inset(0 0% 0 0)', opacity: 1 });
    else gsap.fromTo(widget, { clipPath: 'inset(0 100% 0 0)', opacity: 0 }, { clipPath: 'inset(0 0% 0 0)', opacity: 1, duration: .52, ease: 'power3.out', overwrite: true });
  }

  function animateOut(done) {
    const widget = root.querySelector('.weather-widget');
    if (!widget) return done();
    gsap.killTweensOf(widget);
    gsap.to(widget, { clipPath: 'inset(0 100% 0 0)', opacity: 0, duration: .22, ease: 'power2.in', overwrite: true, onComplete: done });
  }

  async function applyState(raw, instant = false) {
    const next = normalize(raw);
    currentState = next;
    cityIndex = clamp(Number(next.rotation.activeIndex || 0), 0, Math.max(0, next.locations.length - 1));
    nextRotationAt = Date.now() + Math.max(3, Number(next.rotation.interval || 8)) * 1000;
    await fetchWeather(true);
    const commit = () => renderWidget(next, instant);
    if (instant || !root.querySelector('.weather-widget')) commit(); else animateOut(commit);
  }

  function rotateCity() {
    const state = currentState;
    if (!state || !state.visibility.widget || state.mode !== 'carousel' || !state.rotation.enabled || state.locations.length < 2) return;
    if (Date.now() < nextRotationAt) return;
    nextRotationAt = Date.now() + Math.max(3, Number(state.rotation.interval || 8)) * 1000;
    cityIndex = (cityIndex + 1) % state.locations.length;
    const content = root.querySelector('.weather-city-content');
    if (!content) return renderWidget(state, true);
    gsap.killTweensOf(content);
    gsap.to(content, {
      clipPath: 'inset(0 0 0 100%)', opacity: 0, x: 12, duration: .18, ease: 'power2.in',
      onComplete: () => {
        content.innerHTML = cityContentHtml(state, cityIndex);
        gsap.set(content, { clipPath: 'inset(0 100% 0 0)', opacity: 0, x: -10 });
        gsap.to(content, { clipPath: 'inset(0 0% 0 0)', opacity: 1, x: 0, duration: .3, ease: 'power3.out' });
      }
    });
  }

  function refreshVisibleWeather() {
    if (!currentState?.visibility.widget || !currentState.locations.length) return;
    if (currentState.mode === 'panel') {
      const panel = root.querySelector('.weather-panel');
      if (panel) panel.innerHTML = currentState.locations.map((_, i) => cardHtml(currentState, i)).join('');
      return;
    }
    const content = root.querySelector('.weather-city-content');
    if (content) content.innerHTML = cityContentHtml(currentState, cityIndex);
  }

  async function refreshProgram({ instant = false, force = false } = {}) {
    if (refreshInFlight || !token) return;
    refreshInFlight = true;
    try {
      const { data, error } = await sb.rpc('get_overlay_state', { p_token: token });
      if (error) return console.error('PontoView Weather state:', error);
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
      .on('broadcast', { event: 'program' }, () => scheduleCanonicalRefresh(40))
      .subscribe((status) => { if (status === 'SUBSCRIBED') scheduleCanonicalRefresh(0); });
    pollTimer = setInterval(() => refreshProgram(), POLL_MS);
    rotationTimer = setInterval(rotateCity, 250);
    weatherTimer = setInterval(() => fetchWeather(false), 60 * 1000);
  }

  window.addEventListener('online', () => { scheduleCanonicalRefresh(0); fetchWeather(true); });
  window.addEventListener('focus', () => scheduleCanonicalRefresh(0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleCanonicalRefresh(0); });
  window.addEventListener('beforeunload', () => {
    clearTimeout(refreshTimer); clearInterval(pollTimer); clearInterval(rotationTimer); clearInterval(weatherTimer);
    if (channel) sb.removeChannel(channel);
  });

  bootstrap();
})();
