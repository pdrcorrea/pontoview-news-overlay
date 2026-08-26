(() => {
  'use strict';

  const cfg = window.PV_WEATHER_CONFIG;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const ctx = {
    user: null,
    channel: null,
    program: null,
    session: null,
    state: null,
    draft: null,
    realtime: null,
    connected: false,
    saveTimer: null,
    savePromise: null,
    weather: new Map(),
    previewCityIndex: 0,
    programCityIndex: 0,
    lastWeatherAt: 0
  };

  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const unwrap = (data) => Array.isArray(data) ? data[0] : data;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function slugify(value = '') {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  function normalizeState(raw) {
    const base = clone(cfg.defaultState);
    if (!raw || typeof raw !== 'object' || raw.product !== cfg.product) return base;
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

  function toast(message, type = '') {
    const host = $('toast-host');
    if (!host) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  function showView(name) {
    ['auth-view', 'selector-view', 'studio-view'].forEach((id) => $(id)?.classList.add('hidden'));
    $(`${name}-view`)?.classList.remove('hidden');
  }

  function setAuthMessage(message = '', error = false) {
    const el = $('auth-msg');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', error);
  }

  function setConnection(status) {
    const normalized = status === 'SUBSCRIBED' && navigator.onLine ? 'online' :
      (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || !navigator.onLine ? 'offline' : 'reconnecting');
    ctx.connected = normalized === 'online';
    $('conn-dot')?.classList.toggle('online', normalized === 'online');
    $('conn-dot')?.classList.toggle('reconnecting', normalized === 'reconnecting');
    if ($('conn-label')) $('conn-label').textContent = normalized === 'online' ? 'Online' : normalized === 'reconnecting' ? 'Reconectando' : 'Offline';
    if ($('take-btn')) $('take-btn').disabled = !ctx.session || ctx.session.status === 'ended';
  }

  function updateHeader() {
    if ($('user-email')) $('user-email').textContent = ctx.user?.email || '';
    $('logout-btn')?.classList.toggle('hidden', !ctx.user);
    const status = ctx.session?.status || 'sem sessão';
    if ($('live-pill')) {
      $('live-pill').textContent = status === 'live' ? '● LIVE' : status.toUpperCase();
      $('live-pill').classList.toggle('live', status === 'live');
    }
    if ($('session-status-label')) $('session-status-label').textContent = status.toUpperCase();
  }

  function switchAuth(mode) {
    const login = mode === 'login';
    $('auth-tab-login').classList.toggle('active', login);
    $('auth-tab-signup').classList.toggle('active', !login);
    $('auth-submit').textContent = login ? 'Entrar' : 'Criar conta';
    setAuthMessage();
  }

  async function doAuth() {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const signup = $('auth-tab-signup').classList.contains('active');
    if (!email || password.length < 6) return setAuthMessage('Informe e-mail e senha com pelo menos 6 caracteres.', true);
    $('auth-submit').disabled = true;
    setAuthMessage();
    try {
      if (signup) {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setAuthMessage('Conta criada. Confirme o e-mail para entrar.');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      setAuthMessage(error.message || 'Falha ao autenticar.', true);
    } finally {
      $('auth-submit').disabled = false;
    }
  }

  async function logout() {
    await unsubscribeRealtime();
    await sb.auth.signOut();
    Object.assign(ctx, { user: null, channel: null, program: null, session: null, state: null, draft: null });
    showView('auth');
    setConnection('CLOSED');
    updateHeader();
  }

  async function afterLogin(user) {
    ctx.user = user;
    showView('selector');
    updateHeader();
    await loadChannels();
  }

  async function loadChannels() {
    const list = $('channel-list');
    list.innerHTML = '<div class="inline-msg">Carregando canais...</div>';
    const { data, error } = await sb.from('workspaces')
      .select('id,name,slug,product,created_at')
      .eq('user_id', ctx.user.id)
      .eq('product', cfg.product)
      .order('created_at');
    if (error) return list.innerHTML = `<div class="inline-msg error">${escapeHtml(error.message)}</div>`;
    if (!data?.length) return list.innerHTML = '<div class="inline-msg">Nenhum canal Weather. Crie o primeiro abaixo.</div>';
    list.innerHTML = data.map((ch) => `<div class="entity" data-channel="${ch.id}"><div><strong>${escapeHtml(ch.name)}</strong><small>/${escapeHtml(ch.slug)}</small></div><span class="material-symbols-rounded">chevron_right</span></div>`).join('');
    list.querySelectorAll('[data-channel]').forEach((el) => el.addEventListener('click', () => selectChannel(data.find((x) => x.id === el.dataset.channel))));
  }

  async function createChannel() {
    const name = $('new-channel-name').value.trim();
    const slug = slugify($('new-channel-slug').value || name);
    if (!name || !slug) return toast('Informe nome e slug do canal.', 'error');
    const { data, error } = await sb.from('workspaces').insert({ user_id: ctx.user.id, product: cfg.product, name, slug }).select().single();
    if (error) return toast(error.message.includes('duplicate') ? 'Esse slug já está em uso.' : error.message, 'error');
    $('new-channel-name').value = '';
    $('new-channel-slug').value = '';
    await loadChannels();
    await selectChannel(data);
  }

  async function selectChannel(channel) {
    ctx.channel = channel;
    ctx.program = ctx.session = ctx.state = ctx.draft = null;
    $('selected-channel').textContent = channel.name;
    $('program-panel').classList.remove('hidden');
    $('session-panel').classList.add('hidden');
    await loadPrograms();
  }

  async function loadPrograms() {
    const list = $('program-list');
    list.innerHTML = '<div class="inline-msg">Carregando programas...</div>';
    const { data, error } = await sb.from('programs').select('*').eq('workspace_id', ctx.channel.id).order('created_at');
    if (error) return list.innerHTML = `<div class="inline-msg error">${escapeHtml(error.message)}</div>`;
    if (!data?.length) list.innerHTML = '<div class="inline-msg">Nenhum programa neste canal.</div>';
    else {
      list.innerHTML = data.map((p) => `<div class="entity" data-program="${p.id}"><div><strong>${escapeHtml(p.name)}</strong><small>Weather · ${escapeHtml(p.slug)}</small></div><span class="material-symbols-rounded">chevron_right</span></div>`).join('');
      list.querySelectorAll('[data-program]').forEach((el) => el.addEventListener('click', () => selectProgram(data.find((x) => x.id === el.dataset.program))));
    }
  }

  async function createProgram() {
    if (!ctx.channel) return toast('Selecione um canal primeiro.', 'error');
    const name = $('new-program-name').value.trim();
    const slug = slugify($('new-program-slug').value || name);
    if (!name || !slug) return toast('Informe o nome do programa.', 'error');
    const { data, error } = await sb.from('programs').insert({
      workspace_id: ctx.channel.id,
      name,
      slug,
      default_template: 'weather_informative',
      settings: { product: cfg.product }
    }).select().single();
    if (error) return toast(error.message, 'error');
    $('new-program-name').value = '';
    $('new-program-slug').value = '';
    await loadPrograms();
    await selectProgram(data);
  }

  async function selectProgram(program) {
    ctx.program = program;
    ctx.session = ctx.state = ctx.draft = null;
    $('selected-program').textContent = program.name;
    $('session-panel').classList.remove('hidden');
    await loadSessions();
  }

  async function loadSessions() {
    const list = $('session-list');
    list.innerHTML = '<div class="inline-msg">Carregando sessões...</div>';
    const { data, error } = await sb.from('live_sessions').select('*').eq('program_id', ctx.program.id).order('created_at', { ascending: false }).limit(12);
    if (error) return list.innerHTML = `<div class="inline-msg error">${escapeHtml(error.message)}</div>`;
    if (!data?.length) list.innerHTML = '<div class="inline-msg">Nenhuma sessão. Crie uma para começar.</div>';
    else {
      list.innerHTML = data.map((s) => `<div class="entity" data-session="${s.id}"><div><strong>${escapeHtml(s.name)}</strong><small>${new Date(s.created_at).toLocaleString('pt-BR')}</small></div><span class="badge">${escapeHtml(s.status)}</span></div>`).join('');
      list.querySelectorAll('[data-session]').forEach((el) => el.addEventListener('click', () => selectSession(data.find((x) => x.id === el.dataset.session))));
    }
  }

  async function createSession() {
    if (!ctx.program) return toast('Selecione um programa.', 'error');
    const name = $('new-session-name').value.trim() || `${ctx.program.name} · ${new Date().toLocaleDateString('pt-BR')}`;
    const { data, error } = await sb.rpc('create_live_session', { p_program_id: ctx.program.id, p_name: name });
    const session = unwrap(data);
    if (error || !session) return toast(error?.message || 'Não foi possível criar a sessão.', 'error');
    $('new-session-name').value = '';
    await selectSession(session, true);
  }

  async function selectSession(session, isNew = false) {
    await unsubscribeRealtime();
    ctx.session = session;
    const { data, error } = await sb.from('session_state').select('*').eq('session_id', session.id).single();
    if (error) return toast(error.message, 'error');
    ctx.state = data;

    const previewIsWeather = data.preview_state?.product === cfg.product;
    if (isNew || !previewIsWeather) {
      const saved = await savePreviewState(clone(cfg.defaultState), data.revision, true);
      if (!saved) return;
      ctx.state = saved;
    }

    ctx.draft = normalizeState(ctx.state.preview_state);
    ctx.previewCityIndex = 0;
    ctx.programCityIndex = 0;
    showStudio();
    await subscribeRealtime();
    await loadPresets();
    await refreshWeather(true);
  }

  function getOverlayUrl() {
    const url = new URL('overlay.html', window.location.href);
    url.search = '';
    if (ctx.session?.public_token) url.searchParams.set('token', ctx.session.public_token);
    return url.toString();
  }

  function showStudio() {
    showView('studio');
    $('crumb-channel').textContent = ctx.channel?.name || 'Canal';
    $('crumb-program').textContent = ctx.program?.name || 'Programa';
    $('crumb-session').textContent = ctx.session?.name || 'Sessão';
    $('overlay-url').value = getOverlayUrl();
    fillForm(ctx.draft);
    renderAll();
    updateHeader();
  }

  async function subscribeRealtime() {
    await unsubscribeRealtime();
    if (!ctx.session) return;
    ctx.realtime = sb.channel(`weather-control:${ctx.session.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'session_state', filter: `session_id=eq.${ctx.session.id}` }, (payload) => {
        const incoming = payload.new;
        if (!incoming || !ctx.state || Number(incoming.revision) <= Number(ctx.state.revision)) return;
        ctx.state = incoming;
        if (!ctx.savePromise) {
          ctx.draft = normalizeState(incoming.preview_state);
          fillForm(ctx.draft);
        }
        renderAll();
      })
      .subscribe((status) => setConnection(status));
  }

  async function unsubscribeRealtime() {
    if (ctx.realtime) await sb.removeChannel(ctx.realtime);
    ctx.realtime = null;
    setConnection('CLOSED');
  }

  async function savePreviewState(state, expectedRevision, quiet = false) {
    const { data, error } = await sb.rpc('update_session_preview', {
      p_session_id: ctx.session.id,
      p_preview_state: state,
      p_expected_revision: expectedRevision
    });
    const saved = unwrap(data);
    if (error || !saved) {
      if (String(error?.message || '').includes('STATE_CONFLICT')) {
        const { data: canonical } = await sb.from('session_state').select('*').eq('session_id', ctx.session.id).single();
        if (canonical) {
          ctx.state = canonical;
          ctx.draft = normalizeState(canonical.preview_state);
          fillForm(ctx.draft);
          renderAll();
        }
        if (!quiet) toast('O Preview mudou em outro dispositivo. Recarreguei o estado mais recente.', 'error');
      } else if (!quiet) toast(error?.message || 'Falha ao salvar Preview.', 'error');
      return null;
    }
    return saved;
  }

  function scheduleSave(delay = 320) {
    clearTimeout(ctx.saveTimer);
    renderMonitor('preview', ctx.draft, ctx.previewCityIndex);
    ctx.saveTimer = setTimeout(() => savePreview(), delay);
  }

  async function savePreview(force = false) {
    clearTimeout(ctx.saveTimer);
    if (!ctx.state || !ctx.session) return false;
    if (ctx.savePromise) return ctx.savePromise;
    const operation = (async () => {
      const expected = ctx.state.revision;
      const saved = await savePreviewState(ctx.draft, expected, !force);
      if (!saved) return false;
      if (!ctx.state || Number(saved.revision) >= Number(ctx.state.revision)) ctx.state = saved;
      $('preview-meta').textContent = `r${saved.revision} · salvo ${new Date(saved.updated_at).toLocaleTimeString('pt-BR')}`;
      renderAll();
      return true;
    })().finally(() => { ctx.savePromise = null; });
    ctx.savePromise = operation;
    return operation;
  }

  async function take() {
    if (!ctx.session || !ctx.state) return;
    await savePreview(true);
    if (!ctx.state) return;
    $('take-btn').disabled = true;
    try {
      const { data, error } = await sb.rpc('take_session', { p_session_id: ctx.session.id, p_expected_revision: ctx.state.revision });
      const saved = unwrap(data);
      if (error || !saved) throw error || new Error('TAKE falhou.');
      ctx.state = saved;
      if (ctx.session.status !== 'live') {
        const { data: liveData } = await sb.rpc('set_session_status', { p_session_id: ctx.session.id, p_status: 'live' });
        const live = unwrap(liveData);
        if (live) ctx.session = live;
      }
      renderAll();
      updateHeader();
      toast('TAKE executado.', 'ok');
    } catch (error) {
      if (String(error?.message || '').includes('STATE_CONFLICT')) {
        const { data } = await sb.from('session_state').select('*').eq('session_id', ctx.session.id).single();
        if (data) { ctx.state = data; ctx.draft = normalizeState(data.preview_state); fillForm(ctx.draft); renderAll(); }
        toast('Estado atualizado por outro dispositivo. Revise o Preview e tente novamente.', 'error');
      } else toast(error?.message || 'Não foi possível executar o TAKE.', 'error');
    } finally {
      $('take-btn').disabled = false;
    }
  }

  async function quickAir(visible) {
    if (!ctx.session || !ctx.state) return;
    ctx.draft.visibility.widget = visible;
    fillForm(ctx.draft);
    const ok = await savePreview(true);
    if (!ok) return;
    await take();
  }

  function setPreviewVisibility(visible) {
    ctx.draft.visibility.widget = visible;
    scheduleSave(0);
  }

  function setTemplate(template) {
    ctx.draft.template = template;
    $('template-select').value = template;
    document.querySelectorAll('.layout-btn').forEach((b) => b.classList.toggle('active', b.dataset.template === template));
    renderMonitor('preview', ctx.draft, ctx.previewCityIndex);
    scheduleSave(0);
  }

  async function searchCities() {
    const query = $('city-search-input').value.trim();
    if (query.length < 2) return toast('Digite pelo menos 2 caracteres.', 'error');
    $('city-search-btn').disabled = true;
    $('city-search-results').innerHTML = '<div class="inline-msg">Buscando...</div>';
    try {
      const url = new URL(cfg.openMeteo.geocodingUrl);
      url.searchParams.set('name', query);
      url.searchParams.set('count', '8');
      url.searchParams.set('language', 'pt');
      url.searchParams.set('format', 'json');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Geocoding ${response.status}`);
      const json = await response.json();
      const results = json.results || [];
      if (!results.length) {
        $('city-search-results').innerHTML = '<div class="inline-msg">Nenhuma cidade encontrada.</div>';
        return;
      }
      $('city-search-results').innerHTML = results.map((r, i) => `<button class="search-result" data-result="${i}" type="button"><span><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml([r.admin1, r.country].filter(Boolean).join(' · '))}</small></span><span class="material-symbols-rounded">add_circle</span></button>`).join('');
      $('city-search-results').querySelectorAll('[data-result]').forEach((el) => el.addEventListener('click', () => addCity(results[Number(el.dataset.result)])));
    } catch (error) {
      $('city-search-results').innerHTML = '<div class="inline-msg error">Falha ao consultar cidades.</div>';
      toast(error.message || 'Falha ao buscar cidade.', 'error');
    } finally {
      $('city-search-btn').disabled = false;
    }
  }

  async function addCity(result) {
    if (ctx.draft.locations.length >= 5) return toast('O Weather aceita até 5 cidades.', 'error');
    const duplicate = ctx.draft.locations.some((l) => Math.abs(l.latitude - result.latitude) < .001 && Math.abs(l.longitude - result.longitude) < .001);
    if (duplicate) return toast('Essa cidade já está na lista.', 'error');
    ctx.draft.locations.push({
      id: String(result.id || `${result.latitude},${result.longitude}`),
      name: result.name,
      admin1: result.admin1 || '',
      country: result.country || '',
      countryCode: result.country_code || '',
      latitude: Number(result.latitude),
      longitude: Number(result.longitude),
      timezone: result.timezone || 'auto'
    });
    $('city-search-input').value = '';
    $('city-search-results').innerHTML = '';
    renderCityList();
    await refreshWeather(true);
    scheduleSave(0);
  }

  function moveCity(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= ctx.draft.locations.length) return;
    const [item] = ctx.draft.locations.splice(index, 1);
    ctx.draft.locations.splice(target, 0, item);
    ctx.previewCityIndex = clamp(ctx.previewCityIndex, 0, Math.max(0, ctx.draft.locations.length - 1));
    renderCityList();
    scheduleSave(0);
  }

  function removeCity(index) {
    ctx.draft.locations.splice(index, 1);
    ctx.previewCityIndex = clamp(ctx.previewCityIndex, 0, Math.max(0, ctx.draft.locations.length - 1));
    renderCityList();
    scheduleSave(0);
  }

  function renderCityList() {
    const list = $('city-list');
    const locations = ctx.draft?.locations || [];
    if (!locations.length) list.innerHTML = '<div class="inline-msg">Adicione de 1 a 5 cidades para montar o widget.</div>';
    else list.innerHTML = locations.map((loc, i) => `<div class="city-row"><span class="city-index">${i + 1}</span><div><strong>${escapeHtml(loc.name)}</strong><small>${escapeHtml([loc.admin1, loc.country].filter(Boolean).join(' · '))}</small></div><div class="city-row-actions"><button class="icon-btn" data-up="${i}" type="button" title="Subir"><span class="material-symbols-rounded">arrow_upward</span></button><button class="icon-btn" data-down="${i}" type="button" title="Descer"><span class="material-symbols-rounded">arrow_downward</span></button><button class="icon-btn" data-remove="${i}" type="button" title="Remover"><span class="material-symbols-rounded">delete</span></button></div></div>`).join('');
    $('city-limit').textContent = `${locations.length} / 5 cidades`;
    list.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => moveCity(Number(b.dataset.up), -1)));
    list.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => moveCity(Number(b.dataset.down), 1)));
    list.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeCity(Number(b.dataset.remove))));
  }

  function weatherKey(loc) {
    return `${Number(loc.latitude).toFixed(4)},${Number(loc.longitude).toFixed(4)}`;
  }

  async function refreshWeather(force = false) {
    const states = [ctx.draft, normalizeState(ctx.state?.program_state)];
    const unique = new Map();
    states.flatMap((s) => s?.locations || []).forEach((loc) => unique.set(weatherKey(loc), loc));
    const locations = [...unique.values()];
    if (!locations.length) {
      ctx.weather.clear();
      renderAll();
      return;
    }
    if (!force && Date.now() - ctx.lastWeatherAt < cfg.openMeteo.refreshMs) return;
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
        ctx.weather.set(weatherKey(loc), {
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
      ctx.lastWeatherAt = Date.now();
      const label = `Atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      if ($('preview-weather-meta')) $('preview-weather-meta').textContent = label;
      renderAll();
    } catch (error) {
      console.error('PontoView Weather:', error);
      toast('Não foi possível atualizar os dados meteorológicos.', 'error');
    }
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

  function applyStageTheme(stage, state) {
    stage.style.setProperty('--w-primary', state.style.primary);
    stage.style.setProperty('--w-secondary', state.style.secondary);
    stage.style.setProperty('--w-surface', state.style.surface);
    stage.style.setProperty('--w-text', state.style.text);
    stage.style.setProperty('--w-muted', state.style.muted || '#667585');
    stage.style.fontFamily = state.style.font || 'Inter';
  }

  function renderMonitor(kind, raw, index = 0) {
    const stage = $(`${kind}-stage`);
    if (!stage) return;
    const state = normalizeState(raw);
    applyStageTheme(stage, state);
    if (!state.visibility.widget) {
      stage.innerHTML = '<div class="weather-empty"><span><span class="material-symbols-rounded">visibility_off</span>Widget oculto</span></div>';
      return;
    }
    if (!state.locations.length) {
      stage.innerHTML = '<div class="weather-empty"><span><span class="material-symbols-rounded">add_location_alt</span>Adicione uma cidade</span></div>';
      return;
    }

    const scale = clamp(Number(state.style.scale || 1), .75, 1.35);
    const position = state.style.position || 'top-left';
    if (state.template === 'multi') {
      const items = state.locations.map((loc) => {
        const w = ctx.weather.get(weatherKey(loc)) || {};
        return `<div class="weather-multi-item"><div class="weather-multi-city">${escapeHtml(loc.name)}</div><div class="weather-multi-data">${weatherIconSvg(w.code, w.isDay)}<span class="weather-multi-temp">${formatTemp(w.temperature)}°</span></div>${state.display.showCondition ? `<div class="weather-multi-cond">${escapeHtml(conditionLabel(w.code))}</div>` : ''}</div>`;
      }).join('');
      stage.innerHTML = `<div class="weather-multi pos-${position}" style="transform:scale(${scale})">${items}</div>`;
      return;
    }

    const safeIndex = state.locations.length ? index % state.locations.length : 0;
    const loc = state.locations[safeIndex];
    const w = ctx.weather.get(weatherKey(loc)) || {};
    const extras = [];
    if (state.display.showMinMax) extras.push(`<div class="weather-extra-row"><span>Mín / Máx</span><strong>${formatTemp(w.min)}° / ${formatTemp(w.max)}°</strong></div>`);
    if (state.display.showHumidity) extras.push(`<div class="weather-extra-row"><span>Umidade</span><strong>${Number.isFinite(Number(w.humidity)) ? `${Math.round(w.humidity)}%` : '—'}</strong></div>`);
    if (state.display.showWind) extras.push(`<div class="weather-extra-row"><span>Vento</span><strong>${Number.isFinite(Number(w.wind)) ? `${Math.round(w.wind)} km/h` : '—'}</strong></div>`);
    stage.innerHTML = `<div class="weather-card template-${state.template} pos-${position}" style="transform:scale(${scale})"><div class="weather-accent"></div><div class="weather-icon-box">${weatherIconSvg(w.code, w.isDay)}</div><div class="weather-main"><div class="weather-temp">${formatTemp(w.temperature)}<sup>°C</sup></div><div class="weather-copy"><div class="weather-city">${escapeHtml(loc.name)}</div>${state.display.showCondition ? `<div class="weather-condition">${escapeHtml(conditionLabel(w.code))}</div>` : ''}</div></div>${extras.length ? `<div class="weather-extra">${extras.join('')}</div>` : ''}</div>`;
  }

  function renderAll() {
    if (!ctx.state || !ctx.draft) return;
    renderMonitor('preview', ctx.draft, ctx.previewCityIndex);
    renderMonitor('program', ctx.state.program_state, ctx.programCityIndex);
    const program = normalizeState(ctx.state.program_state);
    $('program-meta').textContent = program.visibility.widget && program.locations.length ? `r${ctx.state.revision} · no ar` : `r${ctx.state.revision} · fora do ar`;
    document.querySelectorAll('.layout-btn').forEach((b) => b.classList.toggle('active', b.dataset.template === ctx.draft.template));
  }

  function fillForm(state) {
    if (!state) return;
    $('rotation-enabled').checked = !!state.rotation.enabled;
    $('rotation-interval').value = String(state.rotation.interval || 8);
    $('position-select').value = state.style.position;
    $('template-select').value = state.template;
    $('show-condition').checked = !!state.display.showCondition;
    $('show-minmax').checked = !!state.display.showMinMax;
    $('show-humidity').checked = !!state.display.showHumidity;
    $('show-wind').checked = !!state.display.showWind;
    $('scale-range').value = String(state.style.scale || 1);
    $('scale-output').textContent = `${Math.round(Number(state.style.scale || 1) * 100)}%`;
    $('color-primary').value = state.style.primary;
    $('color-secondary').value = state.style.secondary;
    $('color-surface').value = state.style.surface;
    $('color-text').value = state.style.text;
    $('font-select').value = state.style.font;
    renderCityList();
    document.querySelectorAll('.layout-btn').forEach((b) => b.classList.toggle('active', b.dataset.template === state.template));
  }

  function bindDraftInputs() {
    const bindings = [
      ['rotation-enabled', 'change', (e) => { ctx.draft.rotation.enabled = e.target.checked; }],
      ['rotation-interval', 'change', (e) => { ctx.draft.rotation.interval = Number(e.target.value); }],
      ['position-select', 'change', (e) => { ctx.draft.style.position = e.target.value; }],
      ['template-select', 'change', (e) => { ctx.draft.template = e.target.value; }],
      ['show-condition', 'change', (e) => { ctx.draft.display.showCondition = e.target.checked; }],
      ['show-minmax', 'change', (e) => { ctx.draft.display.showMinMax = e.target.checked; }],
      ['show-humidity', 'change', (e) => { ctx.draft.display.showHumidity = e.target.checked; }],
      ['show-wind', 'change', (e) => { ctx.draft.display.showWind = e.target.checked; }],
      ['scale-range', 'input', (e) => { ctx.draft.style.scale = Number(e.target.value); $('scale-output').textContent = `${Math.round(Number(e.target.value) * 100)}%`; }],
      ['color-primary', 'input', (e) => { ctx.draft.style.primary = e.target.value; }],
      ['color-secondary', 'input', (e) => { ctx.draft.style.secondary = e.target.value; }],
      ['color-surface', 'input', (e) => { ctx.draft.style.surface = e.target.value; }],
      ['color-text', 'input', (e) => { ctx.draft.style.text = e.target.value; }],
      ['font-select', 'change', (e) => { ctx.draft.style.font = e.target.value; }]
    ];
    bindings.forEach(([id, event, fn]) => $(id).addEventListener(event, (e) => { if (!ctx.draft) return; fn(e); fillForm(ctx.draft); scheduleSave(); }));
  }

  async function savePreset() {
    if (!ctx.channel || !ctx.program || !ctx.draft) return;
    const name = window.prompt('Nome do preset:');
    if (!name?.trim()) return;
    const { error } = await sb.from('presets').insert({
      workspace_id: ctx.channel.id,
      program_id: ctx.program.id,
      name: name.trim(),
      template_key: `weather_${ctx.draft.template}`,
      state: ctx.draft
    });
    if (error) return toast(error.message, 'error');
    toast('Preset salvo.', 'ok');
    await loadPresets();
  }

  async function loadPresets() {
    const list = $('preset-list');
    if (!ctx.program) return;
    const { data, error } = await sb.from('presets').select('id,name,template_key,state,updated_at').eq('workspace_id', ctx.channel.id).eq('program_id', ctx.program.id).like('template_key', 'weather_%').order('updated_at', { ascending: false });
    if (error) return list.innerHTML = `<div class="inline-msg error">${escapeHtml(error.message)}</div>`;
    if (!data?.length) return list.innerHTML = '<div class="inline-msg">Nenhum preset Weather salvo.</div>';
    list.innerHTML = data.map((p) => `<div class="preset-item"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.template_key.replace('weather_', ''))}</small></div><div class="preset-item-actions"><button class="icon-btn" data-load-preset="${p.id}" title="Carregar"><span class="material-symbols-rounded">play_arrow</span></button><button class="icon-btn" data-delete-preset="${p.id}" title="Excluir"><span class="material-symbols-rounded">delete</span></button></div></div>`).join('');
    list.querySelectorAll('[data-load-preset]').forEach((b) => b.addEventListener('click', async () => {
      const preset = data.find((p) => p.id === b.dataset.loadPreset);
      ctx.draft = normalizeState(preset.state);
      ctx.previewCityIndex = 0;
      fillForm(ctx.draft);
      await refreshWeather(true);
      scheduleSave(0);
      toast('Preset carregado no Preview.', 'ok');
    }));
    list.querySelectorAll('[data-delete-preset]').forEach((b) => b.addEventListener('click', async () => {
      const { error: deleteError } = await sb.from('presets').delete().eq('id', b.dataset.deletePreset);
      if (deleteError) return toast(deleteError.message, 'error');
      await loadPresets();
    }));
  }

  function rotateMonitors() {
    if (!ctx.state || !ctx.draft) return;
    const now = Date.now();
    const previewInterval = Math.max(3, Number(ctx.draft.rotation.interval || 8)) * 1000;
    const program = normalizeState(ctx.state.program_state);
    const programInterval = Math.max(3, Number(program.rotation.interval || 8)) * 1000;
    if (ctx.draft.template !== 'multi' && ctx.draft.rotation.enabled && ctx.draft.locations.length > 1) ctx.previewCityIndex = Math.floor(now / previewInterval) % ctx.draft.locations.length;
    else ctx.previewCityIndex = clamp(Number(ctx.draft.rotation.activeIndex || 0), 0, Math.max(0, ctx.draft.locations.length - 1));
    if (program.template !== 'multi' && program.rotation.enabled && program.locations.length > 1) ctx.programCityIndex = Math.floor(now / programInterval) % program.locations.length;
    else ctx.programCityIndex = clamp(Number(program.rotation.activeIndex || 0), 0, Math.max(0, program.locations.length - 1));
    renderMonitor('preview', ctx.draft, ctx.previewCityIndex);
    renderMonitor('program', program, ctx.programCityIndex);
  }

  function bindUi() {
    $('auth-tab-login').addEventListener('click', () => switchAuth('login'));
    $('auth-tab-signup').addEventListener('click', () => switchAuth('signup'));
    $('auth-submit').addEventListener('click', doAuth);
    $('auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
    $('logout-btn').addEventListener('click', logout);
    $('create-channel-btn').addEventListener('click', createChannel);
    $('create-program-btn').addEventListener('click', createProgram);
    $('create-session-btn').addEventListener('click', createSession);
    $('back-btn').addEventListener('click', async () => { await unsubscribeRealtime(); showView('selector'); await loadSessions(); });
    $('refresh-weather-btn').addEventListener('click', () => refreshWeather(true));
    $('city-search-btn').addEventListener('click', searchCities);
    $('city-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchCities(); });
    $('take-btn').addEventListener('click', take);
    $('on-air-btn').addEventListener('click', () => quickAir(true));
    $('off-air-btn').addEventListener('click', () => quickAir(false));
    $('pvw-show-btn').addEventListener('click', () => setPreviewVisibility(true));
    $('pvw-hide-btn').addEventListener('click', () => setPreviewVisibility(false));
    document.querySelectorAll('.layout-btn').forEach((b) => b.addEventListener('click', () => setTemplate(b.dataset.template)));
    document.querySelectorAll('.editor-tab').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('.editor-tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.editor-section').forEach((s) => s.classList.remove('active'));
      $(`section-${tab.dataset.section}`).classList.add('active');
    }));
    $('copy-overlay-btn').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('overlay-url').value); toast('URL do overlay copiada.', 'ok'); }
      catch (_) { $('overlay-url').select(); document.execCommand('copy'); toast('URL do overlay copiada.', 'ok'); }
    });
    $('save-preset-btn').addEventListener('click', savePreset);
    bindDraftInputs();
  }

  async function bootstrap() {
    bindUi();
    const { data } = await sb.auth.getSession();
    if (data.session?.user) await afterLogin(data.session.user);
    else showView('auth');
    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user && session.user.id !== ctx.user?.id) setTimeout(() => afterLogin(session.user), 0);
      if (!session?.user && ctx.user) setTimeout(() => logout(), 0);
    });
    setInterval(rotateMonitors, 1000);
    setInterval(() => { if (ctx.session) refreshWeather(false); }, 60 * 1000);
    window.addEventListener('online', () => { setConnection('SUBSCRIBED'); if (ctx.session) refreshWeather(true); });
    window.addEventListener('offline', () => setConnection('CHANNEL_ERROR'));
  }

  bootstrap();
})();
