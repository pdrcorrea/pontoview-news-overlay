(() => {
  'use strict';

  const cfg = window.PV_CONFIG;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.sb = sb;

  const ctx = {
    user: null,
    channel: null,
    channelSettings: null,
    program: null,
    session: null,
    state: null,
    notes: null,
    plan: 'free',
    realtime: null,
    connected: false,
    previewTimer: null,
    noteTimer: null,
    savingPreview: false,
    applyingRemote: false
  };

  const TEMPLATES = {
    lower_third: { label: 'Lower Third', tag: 'AO VIVO', visibility: { live: false, tag: true, headline: true, detail: true } },
    interview:   { label: 'Identificação', tag: 'ENTREVISTA', visibility: { live: false, tag: true, headline: true, detail: true } },
    breaking:    { label: 'Breaking News', tag: 'BREAKING NEWS', visibility: { live: true, tag: true, headline: true, detail: true } },
    headline:    { label: 'Manchete', tag: 'NOTÍCIA', visibility: { live: false, tag: true, headline: true, detail: true } }
  };

  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const unwrap = (data) => Array.isArray(data) ? data[0] : data;

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function slugify(value = '') {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  function normalizeState(raw) {
    const base = clone(cfg.defaultState);
    if (!raw || typeof raw !== 'object') return base;
    return {
      template: raw.template || base.template,
      content: { ...base.content, ...(raw.content || {}) },
      style: { ...base.style, ...(raw.style || {}) },
      visibility: { ...base.visibility, ...(raw.visibility || {}) }
    };
  }

  function stateFromLegacyPreset(p) {
    const state = normalizeState(null);
    state.template = p.template_key || 'lower_third';
    state.content = {
      tag: p.tag || '', headline: p.person_name || '', detail: p.role || '', ticker: p.ticker || ''
    };
    state.style = {
      ...state.style,
      primary: p.color_bg || '#003366', secondary: p.color_text || '#ffffff',
      tickerBg: p.color_ticker_bg || '#111827', tickerText: p.color_ticker_text || '#ffffff',
      font: p.font || 'Inter', animation: p.animation || 'slide-up',
      logoUrl: p.logo_url || '', showLogo: !!p.show_logo, tickerSpeed: Number(p.ticker_speed || 80)
    };
    state.visibility.logo = !!p.show_logo;
    state.visibility.ticker = !!p.ticker;
    return state;
  }

  function showView(name) {
    ['auth-view', 'selector-view', 'studio-view'].forEach((id) => $(id)?.classList.add('hidden'));
    $(`${name}-view`)?.classList.remove('hidden');
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

  function setAuthMessage(message = '', isError = false) {
    const el = $('auth-msg');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
  }

  function setConnection(status) {
    const dot = $('conn-dot');
    const label = $('conn-label');
    const normalized = status === 'SUBSCRIBED' && navigator.onLine ? 'online' :
      (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || !navigator.onLine ? 'offline' : 'reconnecting');
    ctx.connected = normalized === 'online';
    dot?.classList.toggle('online', normalized === 'online');
    dot?.classList.toggle('reconnecting', normalized === 'reconnecting');
    if (label) label.textContent = normalized === 'online' ? 'Online' : normalized === 'reconnecting' ? 'Reconectando' : 'Offline';
    if ($('take-btn')) $('take-btn').disabled = !ctx.connected || !ctx.session || ctx.session.status === 'ended';
  }

  function updateHeader() {
    $('user-email').textContent = ctx.user?.email || '';
    $('plan-pill').textContent = ctx.plan === 'pro' ? 'PRO' : 'FREE';
    $('plan-pill').classList.toggle('pro', ctx.plan === 'pro');
    const status = ctx.session?.status || 'sem sessão';
    $('live-pill').textContent = status === 'live' ? '● LIVE' : status.toUpperCase();
    $('live-pill').classList.toggle('live', status === 'live');
    if ($('session-status-label')) $('session-status-label').textContent = status.toUpperCase();
    if ($('take-btn')) $('take-btn').disabled = !ctx.connected || !ctx.session || status === 'ended';
  }

  async function loadPlan() {
    try {
      const active = await window.PVAccess?.hasActiveNewsOverlay(ctx.user?.id);
      ctx.plan = active ? 'pro' : 'free';
    } catch (_) {
      ctx.plan = 'free';
    }
    updateHeader();
  }

  async function doAuth() {
    const email = $('auth-email').value.trim();
    const password = $('auth-password').value;
    const signup = $('auth-tab-signup').classList.contains('active');
    setAuthMessage();
    if (!email || password.length < 6) return setAuthMessage('Informe e-mail e senha com pelo menos 6 caracteres.', true);
    $('auth-submit').disabled = true;
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

  function switchAuth(mode) {
    const login = mode === 'login';
    $('auth-tab-login').classList.toggle('active', login);
    $('auth-tab-signup').classList.toggle('active', !login);
    $('auth-submit').textContent = login ? 'Entrar' : 'Criar conta';
    setAuthMessage();
  }

  async function logout() {
    await unsubscribeRealtime();
    await sb.auth.signOut();
    ctx.user = ctx.channel = ctx.program = ctx.session = ctx.state = ctx.notes = null;
    showView('auth');
    setConnection('CLOSED');
  }

  async function afterLogin(user) {
    ctx.user = user;
    await loadPlan();
    showView('selector');
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
    if (!data?.length) return list.innerHTML = '<div class="inline-msg">Nenhum canal. Crie o primeiro abaixo.</div>';
    list.innerHTML = data.map((ch) => `<div class="entity" data-channel="${ch.id}"><div><strong>${escapeHtml(ch.name)}</strong><small>/${escapeHtml(ch.slug)}</small></div><span class="material-symbols-rounded">chevron_right</span></div>`).join('');
    list.querySelectorAll('[data-channel]').forEach((el) => el.addEventListener('click', () => selectChannel(data.find((x) => x.id === el.dataset.channel))));
  }

  async function createChannel() {
    const name = $('new-channel-name').value.trim();
    const slug = slugify($('new-channel-slug').value || name);
    if (!name || !slug) return toast('Informe nome e slug do canal.', 'error');
    const { data, error } = await sb.from('workspaces').insert({ user_id: ctx.user.id, product: cfg.product, name, slug }).select().single();
    if (error) return toast(error.message.includes('duplicate') ? 'Esse slug já está em uso.' : error.message, 'error');
    await sb.from('news_overlay_settings').upsert({ workspace_id: data.id }, { onConflict: 'workspace_id' });
    $('new-channel-name').value = '';
    $('new-channel-slug').value = '';
    await loadChannels();
    await selectChannel(data);
  }

  async function selectChannel(channel) {
    ctx.channel = channel;
    ctx.program = ctx.session = ctx.state = ctx.notes = null;
    $('selected-channel').textContent = channel.name;
    $('program-panel').classList.remove('hidden');
    $('session-panel').classList.add('hidden');
    const { data } = await sb.from('news_overlay_settings').select('*').eq('workspace_id', channel.id).maybeSingle();
    ctx.channelSettings = data || null;
    await loadPrograms();
  }

  async function loadPrograms() {
    const list = $('program-list');
    list.innerHTML = '<div class="inline-msg">Carregando programas...</div>';
    const { data, error } = await sb.from('programs').select('*').eq('workspace_id', ctx.channel.id).order('created_at');
    if (error) return list.innerHTML = `<div class="inline-msg error">${escapeHtml(error.message)}</div>`;
    if (!data?.length) list.innerHTML = '<div class="inline-msg">Nenhum programa neste canal.</div>';
    else {
      list.innerHTML = data.map((p) => `<div class="entity" data-program="${p.id}"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.default_template)}</small></div><span class="material-symbols-rounded">chevron_right</span></div>`).join('');
      list.querySelectorAll('[data-program]').forEach((el) => el.addEventListener('click', () => selectProgram(data.find((x) => x.id === el.dataset.program))));
    }
  }

  async function createProgram() {
    if (!ctx.channel) return toast('Selecione um canal primeiro.', 'error');
    const name = $('new-program-name').value.trim();
    const slug = slugify($('new-program-slug').value || name);
    if (!name || !slug) return toast('Informe o nome do programa.', 'error');
    const { data, error } = await sb.from('programs').insert({ workspace_id: ctx.channel.id, name, slug, default_template: 'lower_third' }).select().single();
    if (error) return toast(error.message, 'error');
    $('new-program-name').value = '';
    $('new-program-slug').value = '';
    await loadPrograms();
    await selectProgram(data);
  }

  async function selectProgram(program) {
    ctx.program = program;
    ctx.session = ctx.state = ctx.notes = null;
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

  function channelDefaults(state) {
    const next = normalizeState(state);
    const s = ctx.channelSettings;
    if (s) {
      next.style.primary = s.primary_color || next.style.primary;
      next.style.secondary = s.secondary_color || next.style.secondary;
      next.style.logoUrl = s.logo_url || next.style.logoUrl;
      next.style.showLogo = !!s.logo_url;
      next.visibility.logo = !!s.logo_url;
      if (s.ticker_text && !next.content.ticker) next.content.ticker = s.ticker_text;
      next.visibility.ticker = !!s.show_ticker && !!next.content.ticker;
    }
    next.template = ctx.program?.default_template || next.template;
    return next;
  }

  async function selectSession(session, isNew = false) {
    await unsubscribeRealtime();
    ctx.session = session;
    const [{ data: stateData, error: stateError }, { data: noteData }] = await Promise.all([
      sb.from('session_state').select('*').eq('session_id', session.id).single(),
      sb.from('session_notes').select('*').eq('session_id', session.id).maybeSingle()
    ]);
    if (stateError) return toast(stateError.message, 'error');
    ctx.state = stateData;
    ctx.notes = noteData || { content: '' };

    if (isNew) {
      const initial = channelDefaults(ctx.state.preview_state);
      const saved = await savePreviewState(initial, ctx.state.revision, true);
      if (saved) ctx.state = saved;
    }

    showStudio();
    await subscribeRealtime();
    await loadPresets();
  }

  function showStudio() {
    showView('studio');
    $('crumb-channel').textContent = ctx.channel?.name || 'Canal';
    $('crumb-program').textContent = ctx.program?.name || 'Programa';
    $('crumb-session').textContent = ctx.session?.name || 'Sessão';
    $('overlay-url').value = getOverlayUrl();
    $('notes').value = ctx.notes?.content || '';
    fillForm(ctx.state.preview_state);
    renderAll();
    updateHeader();
  }

  function getOverlayUrl() {
    const base = new URL('overlay.html', window.location.href);
    base.search = '';
    base.searchParams.set('token', ctx.session?.public_token || '');
    return base.toString();
  }

  async function subscribeRealtime() {
    if (!ctx.session) return;
    ctx.realtime = sb.channel(`studio:${ctx.session.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'session_state', filter: `session_id=eq.${ctx.session.id}` }, (payload) => {
        const incoming = payload.new;
        if (!ctx.state || incoming.revision > ctx.state.revision) {
          ctx.state = incoming;
          ctx.applyingRemote = true;
          fillForm(incoming.preview_state);
          renderAll();
          ctx.applyingRemote = false;
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'session_notes', filter: `session_id=eq.${ctx.session.id}` }, (payload) => {
        ctx.notes = payload.new;
        if (document.activeElement !== $('notes')) $('notes').value = payload.new.content || '';
        $('notes-meta').textContent = `Atualizado ${new Date(payload.new.updated_at).toLocaleTimeString('pt-BR')}`;
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_sessions', filter: `id=eq.${ctx.session.id}` }, (payload) => {
        ctx.session = payload.new;
        updateHeader();
      })
      .subscribe((status) => setConnection(status));
  }

  async function unsubscribeRealtime() {
    if (ctx.realtime) {
      await sb.removeChannel(ctx.realtime);
      ctx.realtime = null;
    }
    ctx.connected = false;
  }

  async function reloadState(showConflict = false) {
    if (!ctx.session) return null;
    const { data, error } = await sb.from('session_state').select('*').eq('session_id', ctx.session.id).single();
    if (error) return null;
    ctx.state = data;
    ctx.applyingRemote = true;
    fillForm(data.preview_state);
    renderAll();
    ctx.applyingRemote = false;
    if (showConflict) toast('Preview alterado em outro dispositivo. Estado canônico recarregado.', 'error');
    return data;
  }

  function buildStateFromForm() {
    const next = normalizeState(ctx.state?.preview_state);
    next.template = document.querySelector('[data-template].active')?.dataset.template || next.template;
    next.content.tag = $('f-tag').value.trim();
    next.content.headline = $('f-headline').value.trim();
    next.content.detail = $('f-detail').value.trim();
    next.content.ticker = $('f-ticker').value.trim();
    next.style.primary = $('f-primary').value;
    next.style.secondary = $('f-secondary').value;
    next.style.tickerBg = $('f-ticker-bg').value;
    next.style.tickerText = $('f-ticker-text').value;
    next.style.font = $('f-font').value;
    next.style.animation = $('f-animation').value;
    next.style.logoUrl = $('f-logo').value.trim();
    next.style.showLogo = $('f-show-logo').checked;
    next.style.showTime = $('f-show-time').checked;
    next.style.tickerSpeed = Number($('f-ticker-speed').value || 80);
    next.visibility.live = $('v-live').checked;
    next.visibility.tag = $('v-tag').checked;
    next.visibility.headline = $('v-headline').checked;
    next.visibility.detail = $('v-detail').checked;
    next.visibility.ticker = $('v-ticker').checked;
    next.visibility.logo = $('v-logo').checked;
    return next;
  }

  function fillForm(rawState) {
    const state = normalizeState(rawState);
    document.querySelectorAll('[data-template]').forEach((b) => b.classList.toggle('active', b.dataset.template === state.template));
    $('f-tag').value = state.content.tag || '';
    $('f-headline').value = state.content.headline || '';
    $('f-detail').value = state.content.detail || '';
    $('f-ticker').value = state.content.ticker || '';
    $('f-primary').value = state.style.primary;
    $('f-secondary').value = state.style.secondary;
    $('f-ticker-bg').value = state.style.tickerBg;
    $('f-ticker-text').value = state.style.tickerText;
    $('f-font').value = state.style.font;
    $('f-animation').value = state.style.animation;
    $('f-logo').value = state.style.logoUrl || '';
    $('f-show-logo').checked = !!state.style.showLogo;
    $('f-show-time').checked = state.style.showTime !== false;
    $('f-ticker-speed').value = Number(state.style.tickerSpeed || 80);
    $('speed-output').textContent = `${$('f-ticker-speed').value}px/s`;
    $('v-live').checked = !!state.visibility.live;
    $('v-tag').checked = !!state.visibility.tag;
    $('v-headline').checked = !!state.visibility.headline;
    $('v-detail').checked = !!state.visibility.detail;
    $('v-ticker').checked = !!state.visibility.ticker;
    $('v-logo').checked = !!state.visibility.logo;
  }

  function schedulePreviewSave() {
    if (ctx.applyingRemote || !ctx.session) return;
    renderMonitor('preview', buildStateFromForm());
    clearTimeout(ctx.previewTimer);
    ctx.previewTimer = setTimeout(() => savePreview(), 320);
  }

  async function savePreviewState(state, expectedRevision, quiet = false) {
    const { data, error } = await sb.rpc('update_session_preview', {
      p_session_id: ctx.session.id,
      p_preview_state: state,
      p_expected_revision: expectedRevision
    });
    if (error) {
      if (String(error.message).includes('STATE_CONFLICT')) await reloadState(true);
      else if (!quiet) toast(`Preview não salvo: ${error.message}`, 'error');
      return null;
    }
    return unwrap(data);
  }

  async function savePreview(force = false) {
    if (!ctx.session || !ctx.state || ctx.savingPreview) return true;
    clearTimeout(ctx.previewTimer);
    ctx.savingPreview = true;
    try {
      const next = buildStateFromForm();
      const saved = await savePreviewState(next, ctx.state.revision, !force);
      if (!saved) return false;
      ctx.state = saved;
      renderAll();
      $('preview-meta').textContent = `r${saved.revision} · salvo ${new Date(saved.updated_at).toLocaleTimeString('pt-BR')}`;
      return true;
    } finally {
      ctx.savingPreview = false;
    }
  }

  async function take() {
    if (!ctx.connected) return toast('TAKE bloqueado: conexão Realtime indisponível.', 'error');
    const saved = await savePreview(true);
    if (!saved) return;
    $('take-btn').disabled = true;
    const { data, error } = await sb.rpc('take_session', { p_session_id: ctx.session.id, p_expected_revision: ctx.state.revision });
    if (error) {
      if (String(error.message).includes('STATE_CONFLICT')) await reloadState(true);
      else toast(`TAKE falhou: ${error.message}`, 'error');
      updateHeader();
      return;
    }
    ctx.state = unwrap(data);
    renderAll();
    toast('TAKE executado. Program atualizado.', 'ok');
    updateHeader();
  }

  async function clearProgram() {
    if (!ctx.connected) return toast('Sem conexão. O Program não foi alterado.', 'error');
    const { data, error } = await sb.rpc('clear_session_program', { p_session_id: ctx.session.id, p_expected_revision: ctx.state.revision });
    if (error) {
      if (String(error.message).includes('STATE_CONFLICT')) await reloadState(true);
      else toast(error.message, 'error');
      return;
    }
    ctx.state = unwrap(data);
    renderAll();
    toast('Program limpo. Preview preservado.', 'ok');
  }

  async function setSessionStatus(status) {
    const { data, error } = await sb.rpc('set_session_status', { p_session_id: ctx.session.id, p_status: status });
    if (error) return toast(error.message, 'error');
    ctx.session = unwrap(data);
    if (status === 'ended') await reloadState();
    updateHeader();
    toast(status === 'live' ? 'Sessão entrou em LIVE.' : status === 'ended' ? 'Sessão encerrada e Program limpo.' : `Sessão: ${status}`, 'ok');
  }

  function setTemplate(key) {
    const preset = TEMPLATES[key];
    if (!preset) return;
    document.querySelectorAll('[data-template]').forEach((b) => b.classList.toggle('active', b.dataset.template === key));
    if (!$('f-tag').value.trim()) $('f-tag').value = preset.tag;
    Object.entries(preset.visibility).forEach(([k, value]) => { const el = $(`v-${k}`); if (el) el.checked = value; });
    schedulePreviewSave();
  }

  function toggleVisibility(key) {
    const el = $(`v-${key}`);
    if (!el) return;
    el.checked = !el.checked;
    if (key === 'logo') $('f-show-logo').checked = el.checked;
    schedulePreviewSave();
  }

  function clearPreview() {
    $('f-tag').value = '';
    $('f-headline').value = '';
    $('f-detail').value = '';
    $('f-ticker').value = '';
    ['live','tag','headline','detail','ticker','logo'].forEach((key) => { $(`v-${key}`).checked = false; });
    schedulePreviewSave();
  }

  function renderAll() {
    if (!ctx.state) return;
    renderMonitor('preview', normalizeState(ctx.state.preview_state));
    renderMonitor('program', normalizeState(ctx.state.program_state));
    $('program-meta').textContent = `r${ctx.state.revision}`;
    $('preview-meta').textContent = `r${ctx.state.revision}`;
  }

  function renderMonitor(prefix, rawState) {
    const state = normalizeState(rawState);
    const root = $(`${prefix}-screen`);
    if (!root) return;
    root.style.setProperty('--m-primary', state.style.primary);
    root.style.setProperty('--m-secondary', state.style.secondary);
    root.style.setProperty('--m-ticker-bg', state.style.tickerBg);
    root.style.setProperty('--m-ticker-text', state.style.tickerText);
    root.style.setProperty('--m-font', state.style.font);
    const live = root.querySelector('.screen-live');
    const tag = root.querySelector('.screen-tag');
    const headline = root.querySelector('.screen-copy strong');
    const detail = root.querySelector('.screen-copy span');
    const ticker = root.querySelector('.screen-ticker');
    const logo = root.querySelector('.screen-logo');
    live.textContent = state.template === 'breaking' ? 'URGENTE' : 'AO VIVO';
    tag.textContent = state.content.tag || TEMPLATES[state.template]?.tag || '';
    headline.textContent = state.content.headline || 'Sem conteúdo';
    detail.textContent = state.content.detail || '';
    ticker.textContent = state.content.ticker || '';
    live.classList.toggle('screen-hidden', !state.visibility.live);
    tag.classList.toggle('screen-hidden', !state.visibility.tag);
    root.querySelector('.screen-copy').classList.toggle('screen-hidden', !state.visibility.headline);
    detail.classList.toggle('screen-hidden', !state.visibility.detail || !state.content.detail);
    ticker.classList.toggle('screen-hidden', !state.visibility.ticker || !state.content.ticker);
    if (state.style.logoUrl && state.visibility.logo && state.style.showLogo) {
      logo.src = state.style.logoUrl; logo.classList.remove('hidden');
    } else logo.classList.add('hidden');
  }

  async function saveNotes() {
    if (!ctx.session) return;
    clearTimeout(ctx.noteTimer);
    const content = $('notes').value;
    const { data, error } = await sb.from('session_notes')
      .update({ content, updated_by: ctx.user.id })
      .eq('session_id', ctx.session.id)
      .select().single();
    if (error) return toast(`Notas não salvas: ${error.message}`, 'error');
    ctx.notes = data;
    $('notes-meta').textContent = `Salvo ${new Date(data.updated_at).toLocaleTimeString('pt-BR')}`;
  }

  function scheduleNotes() {
    clearTimeout(ctx.noteTimer);
    $('notes-meta').textContent = 'Salvando...';
    ctx.noteTimer = setTimeout(saveNotes, 450);
  }

  async function loadPresets() {
    if (!ctx.channel || !ctx.program) return;
    const { data, error } = await sb.from('presets').select('*')
      .eq('workspace_id', ctx.channel.id)
      .or(`program_id.is.null,program_id.eq.${ctx.program.id}`)
      .order('created_at', { ascending: false });
    const list = $('preset-list');
    if (error) return list.innerHTML = `<div class="inline-msg error">${escapeHtml(error.message)}</div>`;
    if (!data?.length) return list.innerHTML = '<div class="inline-msg">Nenhum preset.</div>';
    list.innerHTML = data.map((p) => `<div class="preset-item"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.template_key || 'lower_third')}</small></div><div class="preset-item-actions"><button class="icon-btn" data-load-preset="${p.id}" title="Carregar no Preview"><span class="material-symbols-rounded">input</span></button><button class="icon-btn" data-delete-preset="${p.id}" title="Excluir"><span class="material-symbols-rounded">delete</span></button></div></div>`).join('');
    list.querySelectorAll('[data-load-preset]').forEach((el) => el.addEventListener('click', () => loadPreset(data.find((x) => x.id === el.dataset.loadPreset))));
    list.querySelectorAll('[data-delete-preset]').forEach((el) => el.addEventListener('click', () => deletePreset(el.dataset.deletePreset)));
  }

  async function savePreset() {
    const name = prompt('Nome do preset:');
    if (!name) return;
    const state = buildStateFromForm();
    const { error } = await sb.from('presets').insert({
      workspace_id: ctx.channel.id,
      program_id: ctx.program.id,
      name: name.trim(),
      template_key: state.template,
      state
    });
    if (error) return toast(error.message, 'error');
    await loadPresets();
    toast('Preset salvo.', 'ok');
  }

  function loadPreset(preset) {
    const state = preset.state && Object.keys(preset.state).length ? normalizeState(preset.state) : stateFromLegacyPreset(preset);
    ctx.applyingRemote = true;
    fillForm(state);
    ctx.applyingRemote = false;
    renderMonitor('preview', state);
    schedulePreviewSave();
    toast('Preset carregado no Preview. Use TAKE para colocar no ar.', 'ok');
  }

  async function deletePreset(id) {
    if (!confirm('Excluir este preset?')) return;
    const { error } = await sb.from('presets').delete().eq('id', id);
    if (error) return toast(error.message, 'error');
    await loadPresets();
  }

  async function saveChannelStyle() {
    const state = buildStateFromForm();
    const payload = {
      workspace_id: ctx.channel.id,
      primary_color: state.style.primary,
      secondary_color: state.style.secondary,
      logo_url: state.style.logoUrl || null,
      ticker_text: state.content.ticker || 'Ticker de notícias · Configure no painel · ',
      show_ticker: state.visibility.ticker
    };
    const { data, error } = await sb.from('news_overlay_settings').upsert(payload, { onConflict: 'workspace_id' }).select().single();
    if (error) return toast(error.message, 'error');
    ctx.channelSettings = data;
    toast('Identidade visual salva como padrão do canal.', 'ok');
  }

  async function copyOverlayUrl() {
    try {
      await navigator.clipboard.writeText(getOverlayUrl());
      toast('URL do OBS copiada.', 'ok');
    } catch (_) {
      $('overlay-url').select();
      toast('Selecione e copie a URL do overlay.', 'error');
    }
  }

  function bindEditor() {
    document.querySelectorAll('#editor-card input,#editor-card textarea,#editor-card select').forEach((el) => {
      el.addEventListener(el.type === 'range' ? 'input' : 'change', schedulePreviewSave);
      if (['text','textarea'].includes(el.type) || el.tagName === 'TEXTAREA') el.addEventListener('input', schedulePreviewSave);
    });
    $('f-ticker-speed').addEventListener('input', () => $('speed-output').textContent = `${$('f-ticker-speed').value}px/s`);
    document.querySelectorAll('[data-editor-tab]').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('[data-editor-tab]').forEach((x) => x.classList.toggle('active', x === tab));
      document.querySelectorAll('.editor-section').forEach((x) => x.classList.toggle('active', x.id === `editor-${tab.dataset.editorTab}`));
    }));
    document.querySelectorAll('[data-template]').forEach((btn) => btn.addEventListener('click', () => setTemplate(btn.dataset.template)));
  }

  function bindUI() {
    $('auth-submit').addEventListener('click', doAuth);
    $('auth-tab-login').addEventListener('click', () => switchAuth('login'));
    $('auth-tab-signup').addEventListener('click', () => switchAuth('signup'));
    $('auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
    $('logout-btn').addEventListener('click', logout);
    $('create-channel-btn').addEventListener('click', createChannel);
    $('new-channel-name').addEventListener('input', () => { if (!$('new-channel-slug').dataset.touched) $('new-channel-slug').value = slugify($('new-channel-name').value); });
    $('new-channel-slug').addEventListener('input', () => $('new-channel-slug').dataset.touched = '1');
    $('create-program-btn').addEventListener('click', createProgram);
    $('new-program-name').addEventListener('input', () => { if (!$('new-program-slug').dataset.touched) $('new-program-slug').value = slugify($('new-program-name').value); });
    $('new-program-slug').addEventListener('input', () => $('new-program-slug').dataset.touched = '1');
    $('create-session-btn').addEventListener('click', createSession);
    $('back-selector-btn').addEventListener('click', async () => { await unsubscribeRealtime(); showView('selector'); await loadSessions(); });
    $('take-btn').addEventListener('click', take);
    $('clear-program-btn').addEventListener('click', clearProgram);
    $('clear-preview-btn').addEventListener('click', clearPreview);
    $('live-btn').addEventListener('click', () => setSessionStatus('live'));
    $('end-btn').addEventListener('click', () => { if (confirm('Encerrar a sessão? O Program será limpo.')) setSessionStatus('ended'); });
    $('copy-overlay-btn').addEventListener('click', copyOverlayUrl);
    $('open-overlay-btn').addEventListener('click', () => window.open(getOverlayUrl(), '_blank', 'noopener'));
    $('toggle-ticker-btn').addEventListener('click', () => toggleVisibility('ticker'));
    $('toggle-logo-btn').addEventListener('click', () => toggleVisibility('logo'));
    $('toggle-clock-btn').addEventListener('click', () => { $('f-show-time').checked = !$('f-show-time').checked; schedulePreviewSave(); });
    $('save-channel-style-btn').addEventListener('click', saveChannelStyle);
    $('notes').addEventListener('input', scheduleNotes);
    $('save-preset-btn').addEventListener('click', savePreset);
    bindEditor();
    window.addEventListener('online', () => setConnection(ctx.realtime ? 'RECONNECTING' : 'CLOSED'));
    window.addEventListener('offline', () => setConnection('CHANNEL_ERROR'));
  }

  async function init() {
    bindUI();
    if (new URLSearchParams(location.search).get('mode') === 'signup') switchAuth('signup');
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) await afterLogin(session.user);
    else showView('auth');

    sb.auth.onAuthStateChange(async (event, sessionData) => {
      if (event === 'SIGNED_IN' && sessionData?.user && sessionData.user.id !== ctx.user?.id) await afterLogin(sessionData.user);
      if (event === 'SIGNED_OUT') showView('auth');
    });
  }

  init().catch((error) => {
    console.error(error);
    toast('Falha ao iniciar o Studio. Recarregue a página.', 'error');
  });
})();
