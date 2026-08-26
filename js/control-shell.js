(() => {
  'use strict';

  const cfg = window.PV_CONFIG || {};
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

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function getWeather(kind) {
    return normalizeWeather(readJSON(kind === 'program' ? WEATHER_PROGRAM_KEY : WEATHER_DRAFT_KEY, DEFAULT_WEATHER));
  }

  function setWeather(kind, value) {
    const normalized = normalizeWeather(value);
    writeJSON(kind === 'program' ? WEATHER_PROGRAM_KEY : WEATHER_DRAFT_KEY, normalized);
    try { weatherBC?.postMessage({ type:'WEATHER', kind, state:normalized, nonce:Date.now() }); } catch (_) {}
    ensureWeatherRow();
    return normalized;
  }

  function stripWeather(state) {
    if (!state || typeof state !== 'object') return state;
    const next = clone(state);
    delete next.weather;
    return next;
  }

  function mergeWeather(coreState, weather) {
    if (!coreState || typeof coreState !== 'object') return null;
    return { ...clone(coreState), weather:normalizeWeather(weather) };
  }

  function stable(value) { try { return JSON.stringify(value); } catch (_) { return ''; } }

  function slugPart(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30) || 'principal';
  }

  async function ensureCloudSession() {
    const { data:{ session } } = await client.auth.getSession();
    if (!session?.user) {
      location.replace('./studio.html');
      return false;
    }
    user = session.user;

    let { data:workspace, error:wErr } = await client.from('workspaces').select('id,name,slug').eq('user_id', user.id).eq('product', cfg.product || 'news_overlay').order('created_at', { ascending:true }).limit(1).maybeSingle();
    if (wErr) throw wErr;
    if (!workspace) {
      const base = `news-${user.id.replace(/-/g,'').slice(0,12)}`;
      const created = await client.from('workspaces').insert({ user_id:user.id, product:cfg.product || 'news_overlay', name:'Meu canal', slug:base }).select('id,name,slug').single();
      if (created.error) throw created.error;
      workspace = created.data;
    }

    let { data:program, error:pErr } = await client.from('programs').select('id,name,slug').eq('workspace_id', workspace.id).order('created_at', { ascending:true }).limit(1).maybeSingle();
    if (pErr) throw pErr;
    if (!program) {
      const created = await client.from('programs').insert({ workspace_id:workspace.id, name:'Programa principal', slug:slugPart('Programa principal'), settings:{} }).select('id,name,slug').single();
      if (created.error) throw created.error;
      program = created.data;
    }

    let { data:sessionRow, error:sErr } = await client.from('live_sessions').select('id,public_token,status,updated_at').eq('workspace_id', workspace.id).eq('program_id', program.id).neq('status','ended').order('updated_at', { ascending:false }).limit(1).maybeSingle();
    if (sErr) throw sErr;
    if (!sessionRow) {
      const created = await client.rpc('create_live_session', { p_program_id:program.id, p_name:'Sessão principal' });
      if (created.error) throw created.error;
      sessionRow = created.data;
    }
    liveSession = sessionRow;

    if (liveSession.status !== 'live') {
      const status = await client.rpc('set_session_status', { p_session_id:liveSession.id, p_status:'live' });
      if (!status.error && status.data) liveSession = status.data;
    }

    const { data:stateRow, error:stateErr } = await client.from('session_state').select('preview_state,program_state,revision').eq('session_id', liveSession.id).single();
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
    url.searchParams.set('token', liveSession.public_token);
    return url.toString();
  }

  function patchCore() {
    const doc = core.contentDocument;
    if (!doc) return;
    const white = doc.querySelector('.brand .logo-white');
    const blue = doc.querySelector('.brand .logo-blue');
    if (white) white.src = 'assets/PontoViewBranco.png';
    if (blue) blue.src = 'assets/PontoViewAzul.png';

    const out = doc.getElementById('overlayUrl');
    if (out && overlayUrl()) out.value = overlayUrl();

    const actions = doc.querySelector('.header-actions');
    if (actions && !doc.getElementById('pvWeatherHeader')) {
      const btn = doc.createElement('button');
      btn.id = 'pvWeatherHeader';
      btn.type = 'button';
      btn.className = 'icon-button';
      btn.textContent = 'Clima';
      btn.title = 'Configurar widget de clima';
      btn.addEventListener('click', openWeather);
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
      row = doc.createElement('div');
      row.className = 'element-row';
      row.dataset.pvWeatherRow = '1';
      row.innerHTML = '<button class="element-select" type="button"><strong>Widget de clima</strong><small>Open-Meteo · até 5 cidades</small></button><button class="state-toggle pvw" type="button">PVW</button><button class="state-toggle pgm" type="button">PGM</button>';
      row.querySelector('.element-select').addEventListener('click', openWeather);
      row.querySelector('.pvw').addEventListener('click', () => {
        const w = getWeather('draft'); w.visible = !w.visible; setWeather('draft', w); syncWeatherButtons(row);
      });
      row.querySelector('.pgm').addEventListener('click', () => {
        const w = getWeather('program'); w.visible = !w.visible; setWeather('program', w); syncWeatherButtons(row);
      });
      list.appendChild(row);
    }
    syncWeatherButtons(row);
  }

  function syncWeatherButtons(row) {
    if (!row) return;
    const draftOn = getWeather('draft').visible;
    const programOn = getWeather('program').visible;
    const pvw = row.querySelector('.pvw');
    const pgm = row.querySelector('.pgm');
    if (pvw) { pvw.classList.toggle('on', draftOn); pvw.textContent = draftOn ? 'ON' : 'OFF'; }
    if (pgm) { pgm.classList.toggle('on', programOn); pgm.textContent = programOn ? 'ON' : 'OFF'; }
    const header = core.contentDocument?.getElementById('pvWeatherHeader');
    if (header) header.textContent = programOn ? 'Clima ON' : 'Clima';
  }

  function fillWeatherForm() {
    const w = getWeather('draft');
    $('wxCities').value = w.cities.join('\n');
    $('wxPosition').value = w.position;
    $('wxLayout').value = w.layout;
    $('wxUnit').value = w.unit;
    $('wxVisible').checked = w.visible;
    $('wxHumidity').checked = w.showHumidity;
    $('wxWind').checked = w.showWind;
    setWxStatus('Preview independente do Program.');
  }

  function weatherFromForm() {
    const cities = $('wxCities').value.split(/\n|;/).map(v => v.trim()).filter(Boolean).slice(0,5);
    return normalizeWeather({
      visible:$('wxVisible').checked,
      cities,
      position:$('wxPosition').value,
      layout:$('wxLayout').value,
      unit:$('wxUnit').value,
      showHumidity:$('wxHumidity').checked,
      showWind:$('wxWind').checked,
      refreshMinutes:10
    });
  }

  function setWxStatus(text, tone = '') {
    const el = $('wxStatus');
    el.textContent = text;
    el.className = `wx-status${tone ? ` ${tone}` : ''}`;
  }

  function openWeather() { fillWeatherForm(); modal.hidden = false; }
  function closeWeather() { modal.hidden = true; }

  async function saveWeatherPreview() {
    const w = setWeather('draft', weatherFromForm());
    setWxStatus(w.cities.length ? 'Clima salvo no Preview.' : 'Adicione pelo menos uma cidade.', w.cities.length ? 'ok' : 'error');
    await syncNow();
  }

  async function takeWeather() {
    const w = setWeather('draft', weatherFromForm());
    setWeather('program', w);
    setWxStatus(w.visible && !w.cities.length ? 'Adicione pelo menos uma cidade.' : 'Widget aplicado no Program.', w.visible && !w.cities.length ? 'error' : 'ok');
    await syncNow();
  }

  async function outWeather() {
    const w = getWeather('program');
    w.visible = false;
    setWeather('program', w);
    setWxStatus('Widget retirado do Program.', 'ok');
    await syncNow();
  }

  function enqueueCloud(kind, fullState) {
    const hash = stable(fullState);
    if (!hash) return Promise.resolve();
    if (kind === 'preview' && hash === lastDraftHash) return Promise.resolve();
    if (kind === 'program' && hash === lastProgramHash) return Promise.resolve();

    cloudQueue = cloudQueue.then(async () => {
      const rpc = kind === 'preview' ? 'update_session_preview' : 'set_session_program';
      const args = kind === 'preview'
        ? { p_session_id:liveSession.id, p_preview_state:fullState, p_expected_revision:revision }
        : { p_session_id:liveSession.id, p_program_state:fullState, p_expected_revision:revision };
      let { data, error } = await client.rpc(rpc, args);
      if (error && /STATE_CONFLICT/i.test(error.message || '')) {
        const fresh = await client.from('session_state').select('revision').eq('session_id', liveSession.id).single();
        if (!fresh.error) {
          revision = Number(fresh.data.revision || revision);
          args.p_expected_revision = revision;
          ({ data, error } = await client.rpc(rpc, args));
        }
      }
      if (error) throw error;
      revision = Number(data?.revision ?? revision + 1);
      if (kind === 'preview') lastDraftHash = hash; else lastProgramHash = hash;
      if (kind === 'program') {
        try { await overlaySignal?.send({ type:'broadcast', event:'program', payload:{ revision } }); } catch (_) {}
      }
    }).catch(error => {
      console.error('PontoView cloud sync:', error);
      const doc = core.contentDocument;
      const text = doc?.getElementById('connectionText');
      const dot = doc?.getElementById('connectionDot');
      if (text) text.textContent = 'falha ao sincronizar';
      if (dot) dot.classList.remove('ok');
    });
    return cloudQueue;
  }

  async function syncNow() {
    if (!liveSession) return;
    const draftCore = readJSON(DRAFT_KEY, null);
    const programCore = readJSON(PROGRAM_KEY, null);
    if (draftCore?.theme) await enqueueCloud('preview', mergeWeather(draftCore, getWeather('draft')));
    if (programCore?.theme) await enqueueCloud('program', mergeWeather(programCore, getWeather('program')));
  }

  function startSyncLoop() {
    setInterval(() => {
      patchCore();
      syncNow();
      const out = core.contentDocument?.getElementById('overlayUrl');
      if (out && overlayUrl() && out.value !== overlayUrl()) out.value = overlayUrl();
    }, 350);
  }

  function bindModal() {
    $('wxClose').addEventListener('click', closeWeather);
    modal.addEventListener('click', e => { if (e.target === modal) closeWeather(); });
    $('wxSave').addEventListener('click', () => saveWeatherPreview());
    $('wxTake').addEventListener('click', () => takeWeather());
    $('wxOut').addEventListener('click', () => outWeather());
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeWeather(); });
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
    core.addEventListener('load', () => {
      patchCore();
      boot.hidden = true;
      setTimeout(syncNow, 250);
    }, { once:true });
    startSyncLoop();
  }

  bootApp().catch(error => {
    console.error(error);
    boot.textContent = `Não foi possível abrir o controle: ${error?.message || error}`;
  });
})();
