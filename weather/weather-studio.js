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
    previewNextRotationAt: 0,
    programNextRotationAt: 0,
    lastWeatherAt: 0
  };

  const $ = (id) => document.getElementById(id);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const unwrap = (data) => Array.isArray(data) ? data[0] : data;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const keyFor = (loc) => `${Number(loc.latitude).toFixed(4)},${Number(loc.longitude).toFixed(4)}`;
  const POSITIONS = ['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right'];

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
    const legacyMulti = raw.template === 'multi';
    const locations = Array.isArray(raw.locations) ? raw.locations.slice(0, 5).map((loc) => ({
      id: String(loc.id || `${loc.latitude},${loc.longitude}`),
      name: String(loc.name || 'Cidade'),
      admin1: String(loc.admin1 || ''),
      admin2: String(loc.admin2 || ''),
      country: String(loc.country || ''),
      countryCode: String(loc.countryCode || loc.country_code || ''),
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      timezone: String(loc.timezone || 'auto')
    })).filter((loc) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) : [];
    return {
      product: cfg.product,
      template: legacyMulti ? 'compact' : (['compact','informative','complete'].includes(raw.template) ? raw.template : base.template),
      mode: legacyMulti ? 'panel' : (raw.mode === 'panel' ? 'panel' : 'carousel'),
      locations,
      rotation: {
        ...base.rotation,
        ...(raw.rotation || {}),
        interval: [5,8,10,15,20].includes(Number(raw.rotation?.interval)) ? Number(raw.rotation.interval) : base.rotation.interval,
        activeIndex: clamp(Number(raw.rotation?.activeIndex || 0), 0, Math.max(0, locations.length - 1))
      },
      style: {
        ...base.style,
        ...(raw.style || {}),
        position: POSITIONS.includes(raw.style?.position) ? raw.style.position : base.style.position,
        offsetX: clamp(Number(raw.style?.offsetX || 0), -300, 300),
        offsetY: clamp(Number(raw.style?.offsetY || 0), -220, 220),
        scale: 1
      },
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
    ['auth-view','selector-view','studio-view'].forEach((id) => $(id)?.classList.add('hidden'));
    $(`${name}-view`)?.classList.remove('hidden');
  }

  function setAuthMessage(message = '', isError = false) {
    const el = $('auth-msg');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
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
    const { data, error } = await sb.from('workspaces').select('id,name,slug,product,created_at')
      .eq('user_id', ctx.user.id).eq('product', cfg.product).order('created_at');
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
    $('new-channel-name').value = ''; $('new-channel-slug').value = '';
    await loadChannels(); await selectChannel(data);
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
    const { data, error } = await sb.from('programs').insert({ workspace_id: ctx.channel.id, name, slug, default_template: 'weather_informative', settings: { product: cfg.product } }).select().single();
    if (error) return toast(error.message, 'error');
    $('new-program-name').value = ''; $('new-program-slug').value = '';
    await loadPrograms(); await selectProgram(data);
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
    if (isNew || data.preview_state?.product !== cfg.product) {
      const saved = await savePreviewState(clone(cfg.defaultState), data.revision, true);
      if (!saved) return;
      ctx.state = saved;
    }
    ctx.draft = normalizeState(ctx.state.preview_state);
    ctx.previewCityIndex = ctx.draft.rotation.activeIndex || 0;
    const program = normalizeState(ctx.state.program_state);
    ctx.programCityIndex = program.rotation.activeIndex || 0;
    resetRotationClocks();
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
          ctx.previewCityIndex = ctx.draft.rotation.activeIndex || 0;
          fillForm(ctx.draft);
        }
        const pgm = normalizeState(incoming.program_state);
        ctx.programCityIndex = clamp(ctx.programCityIndex, 0, Math.max(0, pgm.locations.length - 1));
        resetRotationClocks();
        renderAll();
        refreshWeather(true);
      })
      .subscribe((status) => setConnection(status));
  }

  async function unsubscribeRealtime() {
    if (ctx.realtime) await sb.removeChannel(ctx.realtime);
    ctx.realtime = null;
    setConnection('CLOSED');
  }

  async function savePreviewState(state, expectedRevision, quiet = false) {
    const { data, error } = await sb.rpc('update_session_preview', { p_session_id: ctx.session.id, p_preview_state: state, p_expected_revision: expectedRevision });
    const saved = unwrap(data);
    if (error || !saved) {
      if (String(error?.message || '').includes('STATE_CONFLICT')) {
        const { data: canonical } = await sb.from('session_state').select('*').eq('session_id', ctx.session.id).single();
        if (canonical) { ctx.state = canonical; ctx.draft = normalizeState(canonical.preview_state); fillForm(ctx.draft); renderAll(); }
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
      ctx.draft.rotation.activeIndex = clamp(ctx.previewCityIndex, 0, Math.max(0, ctx.draft.locations.length - 1));
      const saved = await savePreviewState(ctx.draft, ctx.state.revision, !force);
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
    const savedPreview = await savePreview(true);
    if (!savedPreview || !ctx.state) return;
    $('take-btn').disabled = true;
    try {
      const { data, error } = await sb.rpc('take_session', { p_session_id: ctx.session.id, p_expected_revision: ctx.state.revision });
      const saved = unwrap(data);
      if (error || !saved) throw error || new Error('TAKE falhou.');
      ctx.state = saved;
      const program = normalizeState(saved.program_state);
      ctx.programCityIndex = program.rotation.activeIndex || 0;
      if (ctx.session.status !== 'live') {
        const { data: liveData } = await sb.rpc('set_session_status', { p_session_id: ctx.session.id, p_status: 'live' });
        const live = unwrap(liveData); if (live) ctx.session = live;
      }
      resetRotationClocks();
      await refreshWeather(true);
      renderAll(); updateHeader(); toast('TAKE executado.', 'ok');
    } catch (error) {
      if (String(error?.message || '').includes('STATE_CONFLICT')) {
        const { data } = await sb.from('session_state').select('*').eq('session_id', ctx.session.id).single();
        if (data) { ctx.state = data; ctx.draft = normalizeState(data.preview_state); fillForm(ctx.draft); renderAll(); }
        toast('Estado atualizado por outro dispositivo. Revise o Preview e tente novamente.', 'error');
      } else toast(error?.message || 'Não foi possível executar o TAKE.', 'error');
    } finally { $('take-btn').disabled = false; }
  }

  async function quickAir(visible) {
    if (!ctx.draft) return;
    ctx.draft.visibility.widget = visible;
    fillForm(ctx.draft);
    if (await savePreview(true)) await take();
  }

  function setPreviewVisibility(visible) {
    if (!ctx.draft) return;
    ctx.draft.visibility.widget = visible;
    scheduleSave(0);
  }

  async function apiRequest(payload) {
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData.session?.access_token;
    const response = await fetch(cfg.weatherApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || `Weather backend ${response.status}`);
    return json;
  }

  async function searchCities() {
    const query = $('city-search-input').value.trim();
    if (query.length < 2) return toast('Digite pelo menos 2 caracteres.', 'error');
    $('city-search-btn').disabled = true;
    $('city-search-results').innerHTML = '<div class="inline-msg">Buscando localidades...</div>';
    try {
      const json = await apiRequest({ mode: 'geocode', query });
      const results = json.results || [];
      if (!results.length) {
        $('city-search-results').innerHTML = '<div class="inline-msg">Nenhuma cidade encontrada. Tente incluir estado ou país, por exemplo “Springfield, Illinois”.</div>';
        return;
      }
      $('city-search-results').innerHTML = results.map((r, i) => {
        const where = [r.admin2, r.admin1, r.country].filter(Boolean).join(' · ');
        const pop = Number.isFinite(Number(r.population)) ? `${Number(r.population).toLocaleString('pt-BR')} hab.` : 'população n/d';
        const coord = `${Number(r.latitude).toFixed(3)}, ${Number(r.longitude).toFixed(3)}`;
        return `<button class="search-result" data-result="${i}" type="button"><span><strong>${escapeHtml(r.name)}${r.countryCode ? ` · ${escapeHtml(r.countryCode)}` : ''}</strong><small>${escapeHtml(where)}</small><span class="search-result-meta"><span class="search-chip">${escapeHtml(pop)}</span><span class="search-chip">${escapeHtml(coord)}</span></span></span><span class="search-add"><span class="material-symbols-rounded">add_circle</span></span></button>`;
      }).join('');
      $('city-search-results').querySelectorAll('[data-result]').forEach((el) => el.addEventListener('click', () => addCity(results[Number(el.dataset.result)])));
    } catch (error) {
      $('city-search-results').innerHTML = '<div class="inline-msg error">Falha ao consultar localidades.</div>';
      toast(error.message || 'Falha ao buscar cidade.', 'error');
    } finally { $('city-search-btn').disabled = false; }
  }

  async function addCity(result) {
    if (ctx.draft.locations.length >= 5) return toast('O Weather aceita até 5 cidades.', 'error');
    const duplicate = ctx.draft.locations.some((l) => Math.abs(l.latitude - result.latitude) < .001 && Math.abs(l.longitude - result.longitude) < .001);
    if (duplicate) return toast('Essa localização já está na lista.', 'error');
    ctx.draft.locations.push({
      id: String(result.id || `${result.latitude},${result.longitude}`), name: result.name, admin1: result.admin1 || '', admin2: result.admin2 || '', country: result.country || '', countryCode: result.countryCode || '', latitude: Number(result.latitude), longitude: Number(result.longitude), timezone: result.timezone || 'auto'
    });
    $('city-search-input').value = ''; $('city-search-results').innerHTML = '';
    if (ctx.draft.locations.length === 1) ctx.previewCityIndex = 0;
    ctx.draft.rotation.activeIndex = ctx.previewCityIndex;
    renderCityList(); renderManualCityBank();
    await refreshWeather(true); scheduleSave(0);
  }

  function moveCity(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= ctx.draft.locations.length) return;
    const selectedId = ctx.draft.locations[ctx.previewCityIndex]?.id;
    const [item] = ctx.draft.locations.splice(index, 1); ctx.draft.locations.splice(target, 0, item);
    ctx.previewCityIndex = Math.max(0, ctx.draft.locations.findIndex((l) => l.id === selectedId));
    ctx.draft.rotation.activeIndex = ctx.previewCityIndex;
    renderCityList(); renderManualCityBank(); scheduleSave(0);
  }

  function removeCity(index) {
    ctx.draft.locations.splice(index, 1);
    ctx.previewCityIndex = clamp(ctx.previewCityIndex, 0, Math.max(0, ctx.draft.locations.length - 1));
    ctx.draft.rotation.activeIndex = ctx.previewCityIndex;
    renderCityList(); renderManualCityBank(); scheduleSave(0); refreshWeather(true);
  }

  function selectPreviewCity(index) {
    if (!ctx.draft?.locations[index] || ctx.draft.mode === 'panel') return;
    ctx.previewCityIndex = index;
    ctx.draft.rotation.activeIndex = index;
    ctx.previewNextRotationAt = Date.now() + Number(ctx.draft.rotation.interval || 8) * 1000;
    renderCityList(); renderManualCityBank(); renderMonitor('preview', ctx.draft, index); scheduleSave(0);
  }

  function renderCityList() {
    const list = $('city-list');
    const locations = ctx.draft?.locations || [];
    if (!locations.length) list.innerHTML = '<div class="inline-msg">Adicione de 1 a 5 cidades. O texto digitado nunca é salvo como localização sem seleção.</div>';
    else list.innerHTML = locations.map((loc, i) => `<div class="city-row ${i === ctx.previewCityIndex && ctx.draft.mode === 'carousel' ? 'selected' : ''}"><button class="city-index" data-select-city="${i}" type="button" title="Selecionar no Preview">${i + 1}</button><div><strong>${escapeHtml(loc.name)}</strong><small>${escapeHtml([loc.admin2, loc.admin1, loc.country].filter(Boolean).join(' · '))} · ${loc.latitude.toFixed(3)}, ${loc.longitude.toFixed(3)}</small></div><div class="city-row-actions"><button class="icon-btn" data-up="${i}" type="button" title="Subir"><span class="material-symbols-rounded">arrow_upward</span></button><button class="icon-btn" data-down="${i}" type="button" title="Descer"><span class="material-symbols-rounded">arrow_downward</span></button><button class="icon-btn" data-remove="${i}" type="button" title="Remover"><span class="material-symbols-rounded">delete</span></button></div></div>`).join('');
    $('city-limit').textContent = `${locations.length} / 5 cidades`;
    list.querySelectorAll('[data-select-city]').forEach((b) => b.addEventListener('click', () => selectPreviewCity(Number(b.dataset.selectCity))));
    list.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => moveCity(Number(b.dataset.up), -1)));
    list.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => moveCity(Number(b.dataset.down), 1)));
    list.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeCity(Number(b.dataset.remove))));
  }

  function renderManualCityBank() {
    const bank = $('manual-city-bank');
    if (!bank || !ctx.draft) return;
    if (!ctx.draft.locations.length) { bank.innerHTML = '<span class="inline-msg">Nenhuma cidade cadastrada.</span>'; return; }
    bank.innerHTML = ctx.draft.locations.map((loc, i) => `<button class="manual-city-btn ${i === ctx.previewCityIndex ? 'active' : ''}" data-manual-city="${i}" type="button" ${ctx.draft.mode === 'panel' ? 'disabled' : ''}>${i + 1}. ${escapeHtml(loc.name)}</button>`).join('');
    bank.querySelectorAll('[data-manual-city]').forEach((b) => b.addEventListener('click', () => selectPreviewCity(Number(b.dataset.manualCity))));
  }

  async function refreshWeather(force = false) {
    if (!ctx.draft || !ctx.state) return;
    if (!force && Date.now() - ctx.lastWeatherAt < cfg.refreshMs) return;
    const preview = ctx.draft.locations || [];
    const program = normalizeState(ctx.state.program_state).locations || [];
    const unique = new Map(); [...preview, ...program].forEach((loc) => unique.set(keyFor(loc), loc));
    const locations = [...unique.values()];
    if (!locations.length) { ctx.weather.clear(); renderAll(); return; }
    try {
      const chunks = [];
      for (let i = 0; i < locations.length; i += 5) chunks.push(locations.slice(i, i + 5));
      const responses = await Promise.all(chunks.map((chunk) => apiRequest({ mode: 'preview', locations: chunk })));
      responses.flatMap((r) => r.data || []).forEach((row) => ctx.weather.set(row.locationKey, row));
      ctx.lastWeatherAt = Date.now();
      const label = `Backend · ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      if ($('preview-weather-meta')) $('preview-weather-meta').textContent = label;
      renderAll();
    } catch (error) {
      console.error('PontoView Weather:', error);
      toast('Não foi possível atualizar os dados meteorológicos.', 'error');
    }
  }

  function conditionLabel(code) {
    code = Number(code);
    if (code === 0) return 'Céu limpo'; if (code === 1) return 'Predomínio de sol'; if (code === 2) return 'Parcialmente nublado'; if (code === 3) return 'Nublado';
    if ([45,48].includes(code)) return 'Neblina'; if ([51,53,55,56,57].includes(code)) return 'Garoa'; if ([61,63,65,66,67].includes(code)) return 'Chuva';
    if ([71,73,75,77].includes(code)) return 'Neve'; if ([80,81,82].includes(code)) return 'Pancadas de chuva'; if ([85,86].includes(code)) return 'Pancadas de neve'; if ([95,96,99].includes(code)) return 'Trovoadas';
    return 'Tempo variável';
  }

  function weatherIconSvg(code, isDay = true) {
    code = Number(code);
    const sun = `<circle cx="32" cy="32" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
    const moon = `<path d="M43 43c-14 3-25-9-22-22 2-8 8-13 15-15-3 10 4 21 15 23-1 6-4 11-8 14Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`;
    const cloud = `<path d="M20 45h27c7 0 12-5 12-11 0-7-6-12-13-12h-2C41 14 35 10 27 11c-9 1-15 8-15 17-5 1-8 5-8 9 0 5 4 8 9 8h7Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    let body = '';
    if (code === 0 || code === 1) body = isDay ? sun : moon; else if ([2,3,45,48].includes(code)) body = cloud;
    else if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) body = `${cloud}<path d="M22 50l-4 7M34 50l-4 7M46 50l-4 7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
    else if ([71,73,75,77,85,86].includes(code)) body = `${cloud}<path d="M22 52h0M34 52h0M46 52h0" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`;
    else if ([95,96,99].includes(code)) body = `${cloud}<path d="M36 48l-7 10h7l-4 8 13-14h-8l4-4" fill="currentColor"/>`; else body = cloud;
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
  }

  const formatTemp = (v) => Number.isFinite(Number(v)) ? `${Math.round(Number(v))}` : '—';

  function cardContent(state, loc) {
    const w = ctx.weather.get(keyFor(loc)) || {};
    const inline = state.template === 'complete' && state.display.showCondition !== false ? `<div class="weather-condition-inline">${escapeHtml(conditionLabel(w.code))}</div>` : '';
    let support = '';
    if (state.template === 'informative') support = `<div class="weather-support"><span class="condition">${escapeHtml(conditionLabel(w.code))}</span></div>`;
    if (state.template === 'complete') {
      const bits = [];
      if (state.display.showMinMax !== false) bits.push(`<span>↓ <b>${formatTemp(w.min)}°</b></span><span>↑ <b>${formatTemp(w.max)}°</b></span>`);
      if (state.display.showHumidity && Number.isFinite(Number(w.humidity))) bits.push(`<span>UR <b>${Math.round(w.humidity)}%</b></span>`);
      if (state.display.showWind && Number.isFinite(Number(w.wind))) bits.push(`<span>V <b>${Math.round(w.wind)}</b></span>`);
      support = `<div class="weather-support"><div class="weather-minmax">${bits.join('')}</div></div>`;
    }
    return `<div class="weather-accent"></div><div class="weather-city-content"><div class="weather-top"><div class="weather-icon-box">${weatherIconSvg(w.code, w.isDay)}</div><div class="weather-main"><div class="weather-temp">${formatTemp(w.temperature)}<sup>°C</sup></div><div class="weather-city">${escapeHtml(loc.name)}</div>${inline}</div></div>${support}</div>`;
  }

  function monitorCard(state, loc) {
    return `<div class="weather-card template-${state.template}">${cardContent(state, loc)}</div>`;
  }

  function applyStageTheme(stage, state) {
    stage.style.setProperty('--w-primary', state.style.primary); stage.style.setProperty('--w-secondary', state.style.secondary); stage.style.setProperty('--w-surface', state.style.surface); stage.style.setProperty('--w-text', state.style.text); stage.style.setProperty('--w-muted', state.style.muted || '#667585'); stage.style.fontFamily = state.style.font || 'Inter';
  }

  function renderMonitor(kind, raw, index = 0) {
    const stage = $(`${kind}-stage`); if (!stage) return;
    const state = normalizeState(raw); applyStageTheme(stage, state);
    if (!state.visibility.widget) { stage.innerHTML = '<div class="weather-empty"><span><span class="material-symbols-rounded">visibility_off</span>Widget oculto</span></div>'; return; }
    if (!state.locations.length) { stage.innerHTML = '<div class="weather-empty"><span><span class="material-symbols-rounded">add_location_alt</span>Adicione uma cidade</span></div>'; return; }
    const pos = state.style.position || 'bottom-left';
    const ox = Math.round(Number(state.style.offsetX || 0) * .16); const oy = Math.round(Number(state.style.offsetY || 0) * .16);
    if (state.mode === 'panel') {
      stage.innerHTML = `<div class="weather-panel pos-${pos}" style="--offset-x:${ox}px;--offset-y:${oy}px">${state.locations.map((loc) => monitorCard(state, loc)).join('')}</div>`;
    } else {
      const loc = state.locations[clamp(index, 0, state.locations.length - 1)];
      stage.innerHTML = `<div class="weather-card template-${state.template} pos-${pos}" style="--offset-x:${ox}px;--offset-y:${oy}px">${cardContent(state, loc)}</div>`;
    }
  }

  function renderAll() {
    if (!ctx.state || !ctx.draft) return;
    renderMonitor('preview', ctx.draft, ctx.previewCityIndex);
    const program = normalizeState(ctx.state.program_state);
    renderMonitor('program', program, ctx.programCityIndex);
    $('program-meta').textContent = program.visibility.widget && program.locations.length ? `r${ctx.state.revision} · no ar` : `r${ctx.state.revision} · fora do ar`;
    updatePresetButtons();
  }

  function updatePresetButtons() {
    document.querySelectorAll('.layout-btn').forEach((b) => {
      const p = b.dataset.preset;
      const active = p === 'multi' ? ctx.draft?.mode === 'panel' : ctx.draft?.mode === 'carousel' && ctx.draft?.template === p;
      b.classList.toggle('active', !!active);
    });
  }

  function fillForm(state) {
    if (!state) return;
    $('mode-select').value = state.mode;
    $('rotation-enabled').checked = !!state.rotation.enabled;
    $('rotation-enabled').disabled = state.mode === 'panel';
    $('rotation-interval').value = String(state.rotation.interval || 8);
    $('rotation-interval').disabled = state.mode === 'panel';
    $('template-select').value = state.template;
    $('show-condition').checked = !!state.display.showCondition;
    $('show-minmax').checked = !!state.display.showMinMax;
    $('show-humidity').checked = !!state.display.showHumidity;
    $('show-wind').checked = !!state.display.showWind;
    $('offset-x').value = String(state.style.offsetX || 0); $('offset-x-output').textContent = `${state.style.offsetX || 0} px`;
    $('offset-y').value = String(state.style.offsetY || 0); $('offset-y-output').textContent = `${state.style.offsetY || 0} px`;
    $('color-primary').value = state.style.primary; $('color-secondary').value = state.style.secondary; $('color-surface').value = state.style.surface; $('color-text').value = state.style.text; $('font-select').value = state.style.font;
    document.querySelectorAll('[data-position]').forEach((b) => b.classList.toggle('active', b.dataset.position === state.style.position));
    renderCityList(); renderManualCityBank(); updatePresetButtons();
  }

  function applyBehaviorPreset(name) {
    if (!ctx.draft) return;
    if (name === 'multi') {
      ctx.draft.mode = 'panel'; ctx.draft.template = 'compact'; ctx.draft.rotation.enabled = false; ctx.draft.display.showCondition = false; ctx.draft.display.showMinMax = false;
    } else {
      ctx.draft.mode = 'carousel'; ctx.draft.template = name; ctx.draft.rotation.enabled = true;
      ctx.draft.display.showCondition = name !== 'compact'; ctx.draft.display.showMinMax = name === 'complete';
    }
    fillForm(ctx.draft); renderMonitor('preview', ctx.draft, ctx.previewCityIndex); scheduleSave(0);
  }

  function bindDraftInputs() {
    const bindings = [
      ['mode-select','change',(e) => { ctx.draft.mode = e.target.value === 'panel' ? 'panel' : 'carousel'; if (ctx.draft.mode === 'panel') ctx.draft.rotation.enabled = false; }],
      ['rotation-enabled','change',(e) => { ctx.draft.rotation.enabled = e.target.checked; }],
      ['rotation-interval','change',(e) => { ctx.draft.rotation.interval = Number(e.target.value); resetRotationClocks(); }],
      ['template-select','change',(e) => { ctx.draft.template = e.target.value; }],
      ['show-condition','change',(e) => { ctx.draft.display.showCondition = e.target.checked; }],
      ['show-minmax','change',(e) => { ctx.draft.display.showMinMax = e.target.checked; }],
      ['show-humidity','change',(e) => { ctx.draft.display.showHumidity = e.target.checked; }],
      ['show-wind','change',(e) => { ctx.draft.display.showWind = e.target.checked; }],
      ['offset-x','input',(e) => { ctx.draft.style.offsetX = Number(e.target.value); }],
      ['offset-y','input',(e) => { ctx.draft.style.offsetY = Number(e.target.value); }],
      ['color-primary','input',(e) => { ctx.draft.style.primary = e.target.value; }],
      ['color-secondary','input',(e) => { ctx.draft.style.secondary = e.target.value; }],
      ['color-surface','input',(e) => { ctx.draft.style.surface = e.target.value; }],
      ['color-text','input',(e) => { ctx.draft.style.text = e.target.value; }],
      ['font-select','change',(e) => { ctx.draft.style.font = e.target.value; }]
    ];
    bindings.forEach(([id,event,fn]) => $(id).addEventListener(event, (e) => { if (!ctx.draft) return; fn(e); fillForm(ctx.draft); scheduleSave(); }));
    document.querySelectorAll('[data-position]').forEach((b) => b.addEventListener('click', () => { if (!ctx.draft) return; ctx.draft.style.position = b.dataset.position; fillForm(ctx.draft); scheduleSave(0); }));
  }

  async function savePreset() {
    if (!ctx.channel || !ctx.program || !ctx.draft) return;
    const name = window.prompt('Nome do preset:'); if (!name?.trim()) return;
    const { error } = await sb.from('presets').insert({ workspace_id: ctx.channel.id, program_id: ctx.program.id, name: name.trim(), template_key: `weather_${ctx.draft.mode}_${ctx.draft.template}`, state: ctx.draft });
    if (error) return toast(error.message, 'error');
    toast('Preset salvo.', 'ok'); await loadPresets();
  }

  async function loadPresets() {
    const list = $('preset-list'); if (!ctx.program) return;
    const { data, error } = await sb.from('presets').select('id,name,template_key,state,updated_at').eq('workspace_id', ctx.channel.id).eq('program_id', ctx.program.id).like('template_key','weather_%').order('updated_at',{ ascending:false });
    if (error) return list.innerHTML = `<div class="inline-msg error">${escapeHtml(error.message)}</div>`;
    if (!data?.length) return list.innerHTML = '<div class="inline-msg">Nenhum preset Weather salvo.</div>';
    list.innerHTML = data.map((p) => `<div class="preset-item"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.template_key.replaceAll('_',' '))}</small></div><div class="preset-item-actions"><button class="icon-btn" data-load-preset="${p.id}" title="Carregar"><span class="material-symbols-rounded">play_arrow</span></button><button class="icon-btn" data-delete-preset="${p.id}" title="Excluir"><span class="material-symbols-rounded">delete</span></button></div></div>`).join('');
    list.querySelectorAll('[data-load-preset]').forEach((b) => b.addEventListener('click', async () => { const p = data.find((x) => x.id === b.dataset.loadPreset); ctx.draft = normalizeState(p.state); ctx.previewCityIndex = ctx.draft.rotation.activeIndex || 0; fillForm(ctx.draft); await refreshWeather(true); scheduleSave(0); toast('Preset carregado no Preview.', 'ok'); }));
    list.querySelectorAll('[data-delete-preset]').forEach((b) => b.addEventListener('click', async () => { const { error: e } = await sb.from('presets').delete().eq('id', b.dataset.deletePreset); if (e) return toast(e.message,'error'); await loadPresets(); }));
  }

  function resetRotationClocks() {
    const now = Date.now();
    ctx.previewNextRotationAt = now + Math.max(3, Number(ctx.draft?.rotation?.interval || 8)) * 1000;
    const pgm = normalizeState(ctx.state?.program_state);
    ctx.programNextRotationAt = now + Math.max(3, Number(pgm.rotation.interval || 8)) * 1000;
  }

  function rotateMonitors() {
    if (!ctx.state || !ctx.draft) return;
    const now = Date.now();
    if (ctx.draft.mode === 'carousel' && ctx.draft.rotation.enabled && ctx.draft.locations.length > 1 && now >= ctx.previewNextRotationAt) {
      ctx.previewCityIndex = (ctx.previewCityIndex + 1) % ctx.draft.locations.length;
      ctx.previewNextRotationAt = now + Math.max(3, Number(ctx.draft.rotation.interval || 8)) * 1000;
      renderMonitor('preview', ctx.draft, ctx.previewCityIndex); renderCityList(); renderManualCityBank();
    }
    const pgm = normalizeState(ctx.state.program_state);
    if (pgm.mode === 'carousel' && pgm.rotation.enabled && pgm.locations.length > 1 && now >= ctx.programNextRotationAt) {
      ctx.programCityIndex = (ctx.programCityIndex + 1) % pgm.locations.length;
      ctx.programNextRotationAt = now + Math.max(3, Number(pgm.rotation.interval || 8)) * 1000;
      renderMonitor('program', pgm, ctx.programCityIndex);
    }
  }

  function bindUi() {
    $('auth-tab-login').addEventListener('click', () => switchAuth('login')); $('auth-tab-signup').addEventListener('click', () => switchAuth('signup')); $('auth-submit').addEventListener('click', doAuth); $('auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); }); $('logout-btn').addEventListener('click', logout);
    $('create-channel-btn').addEventListener('click', createChannel); $('create-program-btn').addEventListener('click', createProgram); $('create-session-btn').addEventListener('click', createSession);
    $('back-btn').addEventListener('click', async () => { await unsubscribeRealtime(); showView('selector'); await loadSessions(); });
    $('take-btn').addEventListener('click', take); $('on-air-btn').addEventListener('click', () => quickAir(true)); $('off-air-btn').addEventListener('click', () => quickAir(false)); $('pvw-show-btn').addEventListener('click', () => setPreviewVisibility(true)); $('pvw-hide-btn').addEventListener('click', () => setPreviewVisibility(false));
    $('city-search-btn').addEventListener('click', searchCities); $('city-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchCities(); });
    $('refresh-weather-btn').addEventListener('click', () => refreshWeather(true)); $('save-preset-btn').addEventListener('click', savePreset);
    $('copy-overlay-btn').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('overlay-url').value); toast('URL do overlay copiada.', 'ok'); } catch { $('overlay-url').select(); document.execCommand('copy'); toast('URL copiada.', 'ok'); } });
    document.querySelectorAll('.layout-btn').forEach((b) => b.addEventListener('click', () => applyBehaviorPreset(b.dataset.preset)));
    document.querySelectorAll('.editor-tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.editor-tab').forEach((t) => t.classList.toggle('active', t === tab)); document.querySelectorAll('.editor-section').forEach((s) => s.classList.toggle('active', s.id === `section-${tab.dataset.section}`)); }));
    bindDraftInputs();
  }

  async function bootstrap() {
    bindUi();
    const { data } = await sb.auth.getSession();
    if (data.session?.user) await afterLogin(data.session.user); else showView('auth');
    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user && session.user.id !== ctx.user?.id) setTimeout(() => afterLogin(session.user), 0);
      if (!session?.user && ctx.user) setTimeout(() => logout(), 0);
    });
    setInterval(rotateMonitors, 500);
    setInterval(() => { if (ctx.session) refreshWeather(false); }, 60 * 1000);
    window.addEventListener('online', () => { if (ctx.session) refreshWeather(true); });
    window.addEventListener('offline', () => setConnection('CHANNEL_ERROR'));
  }

  bootstrap();
})();
