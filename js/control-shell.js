(() => {
  'use strict';

  const cfg = window.PV_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const CORE_CHANNEL = 'pontoview-overlay-v6';
  const PROGRAM_KEY = `${CORE_CHANNEL}:program`;
  const DRAFT_KEY = `${CORE_CHANNEL}:draft`;
  const WEATHER_CHANNEL = 'pontoview-weather-v1';
  const WEATHER_PROGRAM_KEY = `${WEATHER_CHANNEL}:program`;
  const WEATHER_DRAFT_KEY = `${WEATHER_CHANNEL}:draft`;
  const DEFAULT_WEATHER = Object.freeze({ visible:false, cities:[], position:'top-right', layout:'row', unit:'celsius', showHumidity:true, showWind:false, refreshMinutes:10 });

  const $ = id => document.getElementById(id);
  const clone = value => JSON.parse(JSON.stringify(value));
  const core = $('core');
  const boot = $('boot');
  const modal = $('weatherModal');

  let client = null;
  let user = null;
  let workspace = null;
  let program = null;
  let liveSession = null;
  let revision = 0;
  let cloudQueue = Promise.resolve();
  let lastDraftHash = '';
  let lastProgramHash = '';
  let weatherBC = null;
  let overlaySignal = null;
  let elementObserver = null;

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
  function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  function stable(value) { try { return JSON.stringify(value); } catch (_) { return ''; } }
  function slugPart(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,38) || 'principal';
  }
  function getWeather(kind) { return normalizeWeather(readJSON(kind === 'program' ? WEATHER_PROGRAM_KEY : WEATHER_DRAFT_KEY, DEFAULT_WEATHER)); }
  function setWeather(kind, value) {
    const normalized = normalizeWeather(value);
    writeJSON(kind === 'program' ? WEATHER_PROGRAM_KEY : WEATHER_DRAFT_KEY, normalized);
    try { weatherBC?.postMessage({ type:'WEATHER', kind, state:normalized, nonce:Date.now() }); } catch (_) {}
    ensureWeatherRow();
    return normalized;
  }
  function stripWeather(state) {
    if (!state || typeof state !== 'object') return state;
    const next = clone(state); delete next.weather; return next;
  }
  function mergeWeather(coreState, weather) {
    if (!coreState || typeof coreState !== 'object') return null;
    return { ...clone(coreState), weather:normalizeWeather(weather) };
  }

  async function chooseContext() {
    const product = cfg.product || 'news_overlay';
    const { data:workspaces, error:wErr } = await client.from('workspaces')
      .select('id,name,slug,product,created_at').eq('user_id', user.id).eq('product', product).order('created_at');
    if (wErr) throw wErr;

    let rows = workspaces || [];
    if (!rows.length) {
      const base = `news-${user.id.replace(/-/g,'').slice(0,12)}`;
      const created = await client.from('workspaces').insert({ user_id:user.id, product, name:'Meu canal', slug:base })
        .select('id,name,slug,product,created_at').single();
      if (created.error) throw created.error;
      rows = [created.data];
    }

    const requestedWorkspace = qs.get('workspace');
    workspace = requestedWorkspace ? rows.find(x => x.id === requestedWorkspace) : null;
    if (!workspace && rows.length === 1) workspace = rows[0];
    if (!workspace && rows.length > 1) {
      location.replace('./news-workspaces.html');
      return false;
    }
    if (!workspace) throw new Error('Workspace News não encontrado.');

    const { data:programs, error:pErr } = await client.from('programs')
      .select('id,name,slug,settings,created_at').eq('workspace_id', workspace.id).order('created_at');
    if (pErr) throw pErr;
    let pRows = programs || [];
    if (!pRows.length) {
      const created = await client.from('programs').insert({
        workspace_id:workspace.id,
        name:'Programa principal',
        slug:slugPart('Programa principal'),
        settings:{ product:'news_overlay' }
      }).select('id,name,slug,settings,created_at').single();
      if (created.error) throw created.error;
      pRows = [created.data];
    }

    const requestedProgram = qs.get('program');
    program = requestedProgram ? pRows.find(x => x.id === requestedProgram) : null;
    if (!program && pRows.length === 1) program = pRows[0];
    if (!program && pRows.length > 1) {
      location.replace(`./news-workspaces.html?workspace=${encodeURIComponent(workspace.id)}`);
      return false;
    }
    if (!program) throw new Error('Programa News não encontrado.');
    return true;
  }

  async function ensureCloudSession() {
    const { data:{ session } } = await client.auth.getSession();
    if (!session?.user) { location.replace('./studio.html'); return false; }
    user = session.user;
    if (!(await chooseContext())) return false;

    let { data:sessionRow, error:sErr } = await client.from('live_sessions')
      .select('id,workspace_id,program_id,public_token,status,updated_at')
      .eq('workspace_id', workspace.id).eq('program_id', program.id).neq('status','ended')
      .order('updated_at', { ascending:false }).limit(1).maybeSingle();
    if (sErr) throw sErr;
    if (!sessionRow) {
      const created = await client.rpc('create_live_session', { p_program_id:program.id, p_name:'Sessão principal' });
      if (created.error) throw created.error;
      sessionRow = created.data;
    }
    liveSession = sessionRow;

    if (liveSession.status !== 'live') {
      const status = await client.rpc('set_session_status', { p_session_id:liveSession.id, p_status:'live' });
      if (status.error) throw status.error;
      if (status.data) liveSession = status.data;
    }

    const { data:stateRow, error:stateErr } = await client.from('session_state')
      .select('preview_state,program_state,revision').eq('session_id', liveSession.id).single();
    if (stateErr) throw stateErr;
    revision = Number(stateRow.revision || 0);
    hydrateFromCloud(stateRow);
    return true;
  }

  function hydrateFromCloud(row) {
    const remoteProgram = row?.program_state;
    const remoteDraft = row?.preview_state;
    if (remoteProgram?.theme) {
      writeJSON(PROGRAM_KEY, stripWeather(remoteProgram));
      setWeather('program', remoteProgram.weather || DEFAULT_WEATHER);
      lastProgramHash = stable(remoteProgram);
    }
    if (remoteDraft?.theme) {
      writeJSON(DRAFT_KEY, stripWeather(remoteDraft));
      setWeather('draft', remoteDraft.weather || remoteProgram?.weather || DEFAULT_WEATHER);
      lastDraftHash = stable(remoteDraft);
    } else if (remoteProgram?.theme) {
      writeJSON(DRAFT_KEY, stripWeather(remoteProgram));
      setWeather('draft', remoteProgram.weather || DEFAULT_WEATHER);
      lastDraftHash = stable(remoteProgram);
    }
  }

  function overlayUrl() {
    if (!liveSession?.public_token) return '';
    const url = new URL('./overlay.html', location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('token', liveSession.public_token);
    return url.toString();
  }

  async function copyOutputUrl() {
    const value = overlayUrl();
    if (!value) return;
    try { await navigator.clipboard.writeText(value); }
    catch (_) {
      const input = core.contentDocument?.getElementById('overlayUrl');
      if (input) { input.value = value; input.focus(); input.select(); try { core.contentDocument.execCommand('copy'); } catch (_) {} }
    }
  }

  async function rotateOutputUrl(button) {
    if (!liveSession?.id) return;
    if (button) { button.disabled = true; button.textContent = 'GERANDO…'; }
    try {
      const { data, error } = await client.rpc('rotate_overlay_token', { p_session_id:liveSession.id });
      if (error) throw error;
      if (overlaySignal) { try { await client.removeChannel(overlaySignal); } catch (_) {} }
      liveSession.public_token = data;
      overlaySignal = client.channel(`overlay:${liveSession.public_token}`, { config:{ private:false } });
      overlaySignal.subscribe();
      patchCore();
    } catch (error) {
      console.error('Falha ao regenerar URL:', error);
      alert('Não foi possível regenerar a URL do overlay.');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'REGERAR'; }
    }
  }

  function patchCore() {
    const doc = core.contentDocument;
    if (!doc) return;
    const white = doc.querySelector('.brand .logo-white');
    const blue = doc.querySelector('.brand .logo-blue');
    if (white) white.src = 'assets/PontoViewBranco.png';
    if (blue) blue.src = 'assets/PontoViewAzul.png';

    const out = doc.getElementById('overlayUrl');
    if (out && overlayUrl()) { out.value = overlayUrl(); out.readOnly = true; }

    const outputTools = out?.closest('.output-tools');
    if (outputTools && !doc.getElementById('pvRotateOutput')) {
      const rotate = doc.createElement('button');
      rotate.id = 'pvRotateOutput'; rotate.type = 'button'; rotate.className = 'output-button'; rotate.textContent = 'REGERAR';
      rotate.title = 'Revoga a URL atual e cria uma nova';
      rotate.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); rotateOutputUrl(rotate); });
      outputTools.appendChild(rotate);
    }

    if (!doc.documentElement.dataset.pvOutputGuard) {
      doc.documentElement.dataset.pvOutputGuard = '1';
      doc.addEventListener('click', e => {
        const btn = e.target.closest?.('.output-button');
        if (!btn || btn.id === 'pvRotateOutput') return;
        if (!/copiar/i.test(btn.textContent || '')) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); copyOutputUrl();
      }, true);
    }

    const actions = doc.querySelector('.header-actions');
    if (actions && !doc.getElementById('pvWorkspaceHeader')) {
      const btn = doc.createElement('button');
      btn.id = 'pvWorkspaceHeader'; btn.type = 'button'; btn.className = 'icon-button';
      btn.textContent = workspace?.name ? `Canal: ${workspace.name}` : 'Canal';
      btn.title = program?.name ? `${workspace.name} · ${program.name}` : 'Trocar canal ou programa';
      btn.addEventListener('click', () => location.href = `./news-workspaces.html?workspace=${encodeURIComponent(workspace.id)}`);
      actions.insertBefore(btn, actions.firstChild);
    }
    if (actions && !doc.getElementById('pvWeatherHeader')) {
      const btn = doc.createElement('button');
      btn.id = 'pvWeatherHeader'; btn.type = 'button'; btn.className = 'icon-button'; btn.textContent = 'Clima';
      btn.title = 'Configurar widget de clima'; btn.addEventListener('click', openWeather);
      actions.insertBefore(btn, actions.firstChild);
    }

    const list = doc.getElementById('elementList');
    if (list && !elementObserver) {
      elementObserver = new MutationObserver(() => ensureWeatherRow());
      elementObserver.observe(list, { childList:true });
    }
    ensureWeatherRow();
  }

  function ensureWeatherRow() {
    const doc = core.contentDocument;
    const list = doc?.getElementById('elementList');
    if (!list) return;
    let row = list.querySelector('[data-pv-weather-row]');
    if (!row) {
      row = doc.createElement('div'); row.className = 'element-row'; row.dataset.pvWeatherRow = '1';
      row.innerHTML = '<button class="element-select" type="button"><strong>Widget de clima</strong><small>Open-Meteo · até 5 cidades</small></button><button class="state-toggle pvw" type="button">PVW</button><button class="state-toggle pgm" type="button">PGM</button>';
      row.querySelector('.element-select').addEventListener('click', openWeather);
      row.querySelector('.pvw').addEventListener('click', () => { const w = getWeather('draft'); w.visible = !w.visible; setWeather('draft', w); syncWeatherButtons(row); });
      row.querySelector('.pgm').addEventListener('click', () => { const w = getWeather('program'); w.visible = !w.visible; setWeather('program', w); syncWeatherButtons(row); });
      list.appendChild(row);
    }
    syncWeatherButtons(row);
  }
  function syncWeatherButtons(row) {
    if (!row) return;
    const draftOn = getWeather('draft').visible, programOn = getWeather('program').visible;
    const pvw = row.querySelector('.pvw'), pgm = row.querySelector('.pgm');
    if (pvw) { pvw.classList.toggle('on', draftOn); pvw.textContent = draftOn ? 'ON' : 'OFF'; }
    if (pgm) { pgm.classList.toggle('on', programOn); pgm.textContent = programOn ? 'ON' : 'OFF'; }
    const header = core.contentDocument?.getElementById('pvWeatherHeader');
    if (header) header.textContent = programOn ? 'Clima ON' : 'Clima';
  }

  function fillWeatherForm() {
    const w = getWeather('draft');
    if ($('wxCities')) $('wxCities').value = w.cities.join('\n');
    if ($('wxPosition')) $('wxPosition').value = w.position;
    if ($('wxLayout')) $('wxLayout').value = w.layout;
    if ($('wxUnit')) $('wxUnit').value = w.unit;
    if ($('wxVisible')) $('wxVisible').checked = w.visible;
    if ($('wxHumidity')) $('wxHumidity').checked = w.showHumidity;
    if ($('wxWind')) $('wxWind').checked = w.showWind;
    setWxStatus('Preview independente do Program.');
  }
  function weatherFromForm() {
    const cities = ($('wxCities')?.value || '').split(/\n|;/).map(v => v.trim()).filter(Boolean).slice(0,5);
    return normalizeWeather({ visible:!!$('wxVisible')?.checked, cities, position:$('wxPosition')?.value, layout:$('wxLayout')?.value, unit:$('wxUnit')?.value, showHumidity:$('wxHumidity')?.checked, showWind:$('wxWind')?.checked, refreshMinutes:10 });
  }
  function setWxStatus(text, tone = '') { const el = $('wxStatus'); if (el) { el.textContent = text; el.className = `wx-status${tone ? ` ${tone}` : ''}`; } }
  function openWeather() { fillWeatherForm(); if (modal) modal.hidden = false; }
  function closeWeather() { if (modal) modal.hidden = true; }
  async function saveWeatherPreview() { const w = setWeather('draft', weatherFromForm()); setWxStatus(w.cities.length ? 'Clima salvo no Preview.' : 'Adicione pelo menos uma cidade.', w.cities.length ? 'ok' : 'error'); await syncNow(); }
  async function takeWeather() { const w = setWeather('draft', weatherFromForm()); setWeather('program', w); setWxStatus(w.visible && !w.cities.length ? 'Adicione pelo menos uma cidade.' : 'Widget aplicado no Program.', w.visible && !w.cities.length ? 'error' : 'ok'); await syncNow(); }
  async function outWeather() { const w = getWeather('program'); w.visible = false; setWeather('program', w); setWxStatus('Widget retirado do Program.', 'ok'); await syncNow(); }

  function enqueueCloud(kind, fullState) {
    const stateHash = stable(fullState);
    if (!stateHash) return Promise.resolve();
    if (kind === 'preview' && stateHash === lastDraftHash) return Promise.resolve();
    if (kind === 'program' && stateHash === lastProgramHash) return Promise.resolve();
    cloudQueue = cloudQueue.then(async () => {
      const rpc = kind === 'preview' ? 'update_session_preview' : 'set_session_program';
      const args = kind === 'preview'
        ? { p_session_id:liveSession.id, p_preview_state:fullState, p_expected_revision:revision }
        : { p_session_id:liveSession.id, p_program_state:fullState, p_expected_revision:revision };
      let { data, error } = await client.rpc(rpc, args);
      if (error && /STATE_CONFLICT/i.test(error.message || '')) {
        const fresh = await client.from('session_state').select('revision').eq('session_id', liveSession.id).single();
        if (!fresh.error) { revision = Number(fresh.data.revision || revision); args.p_expected_revision = revision; ({ data, error } = await client.rpc(rpc, args)); }
      }
      if (error) throw error;
      revision = Number(data?.revision ?? revision + 1);
      if (kind === 'preview') lastDraftHash = stateHash; else lastProgramHash = stateHash;
      if (kind === 'program') { try { await overlaySignal?.send({ type:'broadcast', event:'program', payload:{ revision } }); } catch (_) {} }
    }).catch(error => {
      console.error('PontoView cloud sync:', error);
      const doc = core.contentDocument, text = doc?.getElementById('connectionText'), dot = doc?.getElementById('connectionDot');
      if (text) text.textContent = 'falha ao sincronizar'; if (dot) dot.classList.remove('ok');
    });
    return cloudQueue;
  }
  async function syncNow() {
    if (!liveSession) return;
    const draftCore = readJSON(DRAFT_KEY, null), programCore = readJSON(PROGRAM_KEY, null);
    if (draftCore?.theme) await enqueueCloud('preview', mergeWeather(draftCore, getWeather('draft')));
    if (programCore?.theme) await enqueueCloud('program', mergeWeather(programCore, getWeather('program')));
  }
  function startSyncLoop() {
    setInterval(() => { patchCore(); syncNow(); }, 400);
  }
  function bindModal() {
    $('wxClose')?.addEventListener('click', closeWeather);
    modal?.addEventListener('click', e => { if (e.target === modal) closeWeather(); });
    $('wxSave')?.addEventListener('click', saveWeatherPreview);
    $('wxTake')?.addEventListener('click', takeWeather);
    $('wxOut')?.addEventListener('click', outWeather);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && !modal.hidden) closeWeather(); });
  }

  async function bootApp() {
    bindModal();
    try { weatherBC = new BroadcastChannel(WEATHER_CHANNEL); } catch (_) {}
    if (!window.supabase?.createClient || !cfg.supabaseUrl || !cfg.supabaseKey) throw new Error('Configuração do Supabase indisponível.');
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    const ready = await ensureCloudSession();
    if (!ready) return;
    overlaySignal = client.channel(`overlay:${liveSession.public_token}`, { config:{ private:false } });
    overlaySignal.subscribe();
    core.src = './control-core.html';
    core.addEventListener('load', () => { patchCore(); boot.hidden = true; setTimeout(syncNow, 250); }, { once:true });
    startSyncLoop();
  }

  bootApp().catch(error => {
    console.error(error);
    boot.textContent = `Não foi possível abrir o controle: ${error?.message || error}`;
  });
})();