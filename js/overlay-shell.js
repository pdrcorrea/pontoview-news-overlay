(() => {
  'use strict';

  const cfg = window.PV_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token');
  const isControlPreview = qs.get('preview') === '1';
  const isControlMonitor = qs.get('monitor') === '1';
  const CORE_CHANNEL = 'pontoview-overlay-v6';
  const PROGRAM_KEY = `${CORE_CHANNEL}:program`;
  const WEATHER_CHANNEL = 'pontoview-weather-v1';
  const WEATHER_PROGRAM_KEY = `${WEATHER_CHANNEL}:program`;
  const WEATHER_DRAFT_KEY = `${WEATHER_CHANNEL}:draft`;
  const DEFAULT_WEATHER = Object.freeze({ visible:false, cities:[], position:'top-right', layout:'row', unit:'celsius', showHumidity:true, showWind:false, refreshMinutes:10 });
  const POLL_MS = 1000;

  const core = document.getElementById('core');
  const layer = document.getElementById('weatherLayer');
  const clone = value => JSON.parse(JSON.stringify(value));
  const weatherCache = new Map();
  let sb = null;
  let signal = null;
  let pollTimer = null;
  let localTimer = null;
  let refreshTimer = null;
  let currentRevision = -1;
  let currentStateHash = '';
  let coreReady = false;
  let pendingState = null;
  let weatherRequestId = 0;

  function normalizeWeather(raw) {
    const x = { ...clone(DEFAULT_WEATHER), ...(raw && typeof raw === 'object' ? raw : {}) };
    x.cities = [...new Set((Array.isArray(x.cities) ? x.cities : []).map(v => String(v || '').trim()).filter(Boolean))].slice(0,5);
    x.visible = !!x.visible;
    x.showHumidity = x.showHumidity !== false;
    x.showWind = !!x.showWind;
    x.position = ['top-left','top-right','bottom-left','bottom-right'].includes(x.position) ? x.position : 'top-right';
    x.layout = x.layout === 'column' ? 'column' : 'row';
    x.unit = x.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
    x.refreshMinutes = Math.max(5, Number(x.refreshMinutes || 10));
    return x;
  }

  function readJSON(key, fallback = null) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
  }
  function stripWeather(state) {
    if (!state || typeof state !== 'object') return state;
    const x = clone(state); delete x.weather; return x;
  }
  function hash(value) { try { return JSON.stringify(value); } catch (_) { return ''; } }

  function postCore(state, initial = false) {
    if (!state || typeof state !== 'object') return;
    pendingState = { state:stripWeather(state), initial };
    if (!coreReady) return;
    core.contentWindow.postMessage({ type:'PONTOVIEW_PREVIEW', state:pendingState.state, meta:{ mode:pendingState.initial ? 'sync' : 'scene' } }, '*');
    pendingState = null;
  }

  function weatherCode(code) {
    const c = Number(code);
    if (c === 0) return ['☀','Céu limpo'];
    if ([1,2].includes(c)) return ['◐','Parcialmente nublado'];
    if (c === 3) return ['☁','Nublado'];
    if ([45,48].includes(c)) return ['≋','Neblina'];
    if ([51,53,55,56,57].includes(c)) return ['☂','Garoa'];
    if ([61,63,65,66,67,80,81,82].includes(c)) return ['☂','Chuva'];
    if ([71,73,75,77,85,86].includes(c)) return ['❄','Neve'];
    if ([95,96,99].includes(c)) return ['ϟ','Trovoadas'];
    return ['•','Condição atual'];
  }

  function buildLoading(weather) {
    layer.replaceChildren(); layer.hidden = false; layer.className = `wx-pos-${weather.position}`;
    const stack = document.createElement('div'); stack.className = `wx-stack ${weather.layout}`;
    weather.cities.forEach(city => {
      const card = document.createElement('div'); card.className = 'wx-card wx-loading';
      const name = document.createElement('div'); name.className = 'wx-city'; name.textContent = city;
      const main = document.createElement('div'); main.className = 'wx-main';
      const icon = document.createElement('div'); icon.className = 'wx-icon'; icon.textContent = '◌';
      const temp = document.createElement('div'); temp.className = 'wx-temp'; temp.textContent = '…';
      main.append(icon,temp); card.append(name,main); stack.appendChild(card);
    });
    layer.appendChild(stack);
  }

  async function fetchCityWeather(city, unit) {
    const cacheKey = `${city.toLowerCase()}|${unit}`;
    const cached = weatherCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 4 * 60 * 1000) return cached.value;
    const geoUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
    geoUrl.searchParams.set('name', city); geoUrl.searchParams.set('count', '1'); geoUrl.searchParams.set('language', 'pt'); geoUrl.searchParams.set('format', 'json');
    const geoRes = await fetch(geoUrl.toString(), { cache:'no-store' });
    if (!geoRes.ok) throw new Error(`Cidade não encontrada: ${city}`);
    const geo = await geoRes.json(), place = geo?.results?.[0];
    if (!place) throw new Error(`Cidade não encontrada: ${city}`);
    const wxUrl = new URL('https://api.open-meteo.com/v1/forecast');
    wxUrl.searchParams.set('latitude', String(place.latitude)); wxUrl.searchParams.set('longitude', String(place.longitude));
    wxUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m'); wxUrl.searchParams.set('timezone', 'auto'); wxUrl.searchParams.set('forecast_days', '1');
    if (unit === 'fahrenheit') wxUrl.searchParams.set('temperature_unit', 'fahrenheit');
    const wxRes = await fetch(wxUrl.toString(), { cache:'no-store' });
    if (!wxRes.ok) throw new Error(`Clima indisponível: ${city}`);
    const wx = await wxRes.json(), current = wx.current || {};
    const value = { city:place.name || city, region:place.admin1 || place.country || '', temperature:current.temperature_2m, humidity:current.relative_humidity_2m, wind:current.wind_speed_10m, code:current.weather_code };
    weatherCache.set(cacheKey, { at:Date.now(), value }); return value;
  }

  function renderWeatherCards(weather, results) {
    layer.replaceChildren();
    if (!weather.visible || !weather.cities.length) { layer.hidden = true; return; }
    layer.hidden = false; layer.className = `wx-pos-${weather.position}`;
    const stack = document.createElement('div'); stack.className = `wx-stack ${weather.layout}`;
    results.forEach((result, i) => {
      const city = weather.cities[i], card = document.createElement('div'); card.className = 'wx-card';
      const name = document.createElement('div'); name.className = 'wx-city';
      if (result.status !== 'fulfilled') {
        name.textContent = city;
        const condition = document.createElement('div'); condition.className = 'wx-condition'; condition.textContent = 'Dados temporariamente indisponíveis';
        const source = document.createElement('div'); source.className = 'wx-source'; source.textContent = 'Dados: Open-Meteo';
        card.append(name,condition,source); stack.appendChild(card); return;
      }
      const data = result.value, [iconText, conditionText] = weatherCode(data.code);
      name.textContent = data.region ? `${data.city} · ${data.region}` : data.city;
      const main = document.createElement('div'); main.className = 'wx-main';
      const icon = document.createElement('div'); icon.className = 'wx-icon'; icon.textContent = iconText;
      const copy = document.createElement('div');
      const temp = document.createElement('div'); temp.className = 'wx-temp'; temp.textContent = `${Math.round(Number(data.temperature))}°`;
      const condition = document.createElement('div'); condition.className = 'wx-condition'; condition.textContent = conditionText;
      copy.append(temp,condition); main.append(icon,copy); card.append(name,main);
      const meta = document.createElement('div'); meta.className = 'wx-meta';
      if (weather.showHumidity && data.humidity != null) { const el = document.createElement('span'); el.textContent = `UMID ${Math.round(Number(data.humidity))}%`; meta.appendChild(el); }
      if (weather.showWind && data.wind != null) { const el = document.createElement('span'); el.textContent = `VENTO ${Math.round(Number(data.wind))} km/h`; meta.appendChild(el); }
      if (meta.childNodes.length) card.appendChild(meta);
      const source = document.createElement('div'); source.className = 'wx-source'; source.textContent = 'Dados: Open-Meteo'; card.appendChild(source); stack.appendChild(card);
    });
    layer.appendChild(stack);
  }

  async function renderWeather(raw) {
    clearTimeout(refreshTimer);
    const weather = normalizeWeather(raw), requestId = ++weatherRequestId;
    if (!weather.visible || !weather.cities.length) { layer.hidden = true; layer.replaceChildren(); return; }
    buildLoading(weather);
    const results = await Promise.allSettled(weather.cities.map(city => fetchCityWeather(city, weather.unit)));
    if (requestId !== weatherRequestId) return;
    renderWeatherCards(weather, results);
    refreshTimer = setTimeout(() => renderWeather(weather), weather.refreshMinutes * 60 * 1000);
  }

  function applyFullState(state, initial = false) {
    const nextHash = hash(state); if (!initial && nextHash && nextHash === currentStateHash) return;
    currentStateHash = nextHash; postCore(state, initial); renderWeather(state?.weather || DEFAULT_WEATHER);
  }

  async function refreshRemote(force = false) {
    if (!token || !sb) return;
    const { data, error } = await sb.rpc('get_overlay_state', { p_token:token });
    if (error) { console.error('PontoView overlay:', error); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.program_state) { applyFullState({ visibility:{} }, force); layer.hidden = true; return; }
    const rev = Number(row.revision ?? -1); if (!force && rev <= currentRevision) return;
    currentRevision = rev; applyFullState(row.program_state, force || currentRevision < 0);
  }

  function startRemote() {
    if (!/^[0-9a-f-]{36}$/i.test(token || '')) { console.error('PontoView: token inválido.'); core.style.visibility='hidden'; layer.hidden = true; return; }
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
    refreshRemote(true); pollTimer = setInterval(() => refreshRemote(false), POLL_MS);
    signal = sb.channel(`overlay:${token}`, { config:{ private:false } }).on('broadcast', { event:'program' }, () => refreshRemote(false)).subscribe();
  }

  function startLocalMonitor() {
    let last = '';
    const read = () => {
      const program = readJSON(PROGRAM_KEY, null); if (!program) return;
      const full = { ...program, weather:normalizeWeather(readJSON(WEATHER_PROGRAM_KEY, DEFAULT_WEATHER)) }, h = hash(full);
      if (h === last) return; last = h; applyFullState(full, !currentStateHash);
    };
    read(); localTimer = setInterval(read, 180);
    try { const bc = new BroadcastChannel(WEATHER_CHANNEL); bc.onmessage = e => { if (e.data?.kind === 'program') read(); }; } catch (_) {}
  }

  function startControlPreview() {
    renderWeather(readJSON(WEATHER_DRAFT_KEY, DEFAULT_WEATHER));
    addEventListener('message', e => {
      if (e.data?.type !== 'PONTOVIEW_PREVIEW') return;
      const coreState = e.data.state || {}, full = { ...coreState, weather:normalizeWeather(readJSON(WEATHER_DRAFT_KEY, DEFAULT_WEATHER)) };
      applyFullState(full, false);
    });
    try { const bc = new BroadcastChannel(WEATHER_CHANNEL); bc.onmessage = e => { if (e.data?.kind === 'draft') renderWeather(e.data.state); }; } catch (_) {}
  }

  function announceReady() {
    if (isControlPreview) return;
    try { const bc = new BroadcastChannel(CORE_CHANNEL); bc.postMessage({ type:'OVERLAY_READY', version:'8.1-secure-shell' }); setTimeout(() => bc.close(), 600); } catch (_) {}
  }

  core.addEventListener('load', () => { coreReady = true; if (pendingState) postCore(pendingState.state, pendingState.initial); announceReady(); });
  core.src = './overlay-core.html?preview=1';

  if (token) startRemote();
  else if (isControlPreview) startControlPreview();
  else if (isControlMonitor) startLocalMonitor();
  else {
    core.style.visibility = 'hidden'; layer.hidden = true;
    console.error('PontoView: saída pública exige uma URL tokenizada gerada pelo controle.');
  }

  addEventListener('beforeunload', () => {
    clearInterval(pollTimer); clearInterval(localTimer); clearTimeout(refreshTimer);
    if (signal && sb) sb.removeChannel(signal);
  });
})();