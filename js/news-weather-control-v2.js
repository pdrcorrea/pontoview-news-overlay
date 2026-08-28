(() => {
  'use strict';

  const cfg = window.PV_CONFIG || {};
  const WEATHER_CHANNEL = 'pontoview-weather-v1';
  const DRAFT_KEY = `${WEATHER_CHANNEL}:draft`;
  const PROGRAM_KEY = `${WEATHER_CHANNEL}:program`;
  const API_URL = `${String(cfg.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/weather-api`;
  const client = window.supabase?.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const $ = (id) => document.getElementById(id);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const POSITIONS = ['top-left','top-center','top-right','middle-left','middle-right','bottom-left','bottom-center','bottom-right'];
  const DEFAULT = {
    visible:false,
    cities:[],
    locations:[],
    template:'informative',
    mode:'carousel',
    position:'top-right',
    layout:'row',
    unit:'celsius',
    rotation:{ enabled:true, interval:8, activeIndex:0 },
    display:{ showCondition:true, showMinMax:true, showHumidity:false, showWind:false },
    style:{ primary:'#175fb5', secondary:'#ffffff', surface:'#ffffff', text:'#082a54', muted:'#58708a', position:'top-right', offsetX:0, offsetY:0 },
    showHumidity:false,
    showWind:false,
    refreshMinutes:10
  };

  let draft = normalize(readJSON(DRAFT_KEY, DEFAULT));
  let searchResults = [];
  let bc = null;
  let modalObserver = null;

  function escapeHtml(value='') {
    return String(value).replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));
  }

  function readJSON(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : clone(fallback); } catch { return clone(fallback); }
  }

  function normalize(raw) {
    const x = { ...clone(DEFAULT), ...(raw && typeof raw === 'object' ? raw : {}) };
    const locations = Array.isArray(x.locations) ? x.locations.slice(0,5).map((loc) => ({
      id:String(loc.id || `${loc.latitude},${loc.longitude}`), name:String(loc.name || 'Cidade'), admin1:String(loc.admin1 || ''), admin2:String(loc.admin2 || ''), country:String(loc.country || ''), countryCode:String(loc.countryCode || loc.country_code || ''), latitude:Number(loc.latitude), longitude:Number(loc.longitude), timezone:String(loc.timezone || 'auto'), population:Number.isFinite(Number(loc.population)) ? Number(loc.population) : null
    })).filter((loc) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) : [];
    x.locations = locations;
    x.cities = locations.length ? locations.map((loc) => loc.name) : (Array.isArray(x.cities) ? x.cities.slice(0,5).map(String) : []);
    x.visible = !!x.visible;
    x.template = ['compact','informative','complete','multi'].includes(x.template) ? x.template : 'informative';
    x.mode = x.template === 'multi' ? 'panel' : (x.mode === 'panel' ? 'panel' : 'carousel');
    x.rotation = { ...DEFAULT.rotation, ...(x.rotation || {}) };
    x.rotation.enabled = x.rotation.enabled !== false;
    x.rotation.interval = [5,8,10,15,20].includes(Number(x.rotation.interval)) ? Number(x.rotation.interval) : 8;
    x.rotation.activeIndex = clamp(Number(x.rotation.activeIndex || 0),0,Math.max(0,locations.length-1));
    x.display = { ...DEFAULT.display, ...(x.display || {}) };
    x.style = { ...DEFAULT.style, ...(x.style || {}) };
    const p = POSITIONS.includes(x.style.position) ? x.style.position : (POSITIONS.includes(x.position) ? x.position : 'top-right');
    x.style.position = p;
    x.position = ['top-left','top-right','bottom-left','bottom-right'].includes(p) ? p : 'top-right';
    x.layout = x.mode === 'panel' ? 'row' : 'column';
    x.showHumidity = !!x.display.showHumidity;
    x.showWind = !!x.display.showWind;
    return x;
  }

  function write(kind, value) {
    const state = normalize(value);
    localStorage.setItem(kind === 'program' ? PROGRAM_KEY : DRAFT_KEY, JSON.stringify(state));
    try { bc?.postMessage({ type:'WEATHER', kind, state, nonce:Date.now() }); } catch {}
    return state;
  }

  function setStatus(text, tone='') {
    const el = $('wxStatus');
    if (!el) return;
    el.textContent = text;
    el.className = `wx-status${tone ? ` ${tone}` : ''}`;
  }

  async function api(payload) {
    if (!client || !API_URL) throw new Error('Backend Weather indisponível.');
    const { data:{ session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
    const response = await fetch(API_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:cfg.supabaseKey, Authorization:`Bearer ${session.access_token}` },
      body:JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || `Weather backend ${response.status}`);
    return json;
  }

  function populationLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return `${new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(n)} hab.`;
  }

  async function searchCities() {
    const query = $('wx2Search')?.value.trim() || '';
    if (query.length < 2) return setStatus('Digite pelo menos 2 caracteres para pesquisar.', 'error');
    const button = $('wx2SearchBtn');
    button.disabled = true;
    $('wx2Results').innerHTML = '<div class="wx-empty">Buscando localidades…</div>';
    try {
      const json = await api({ mode:'geocode', query });
      searchResults = json.results || [];
      if (!searchResults.length) {
        $('wx2Results').innerHTML = '<div class="wx-empty">Nenhuma cidade encontrada. Inclua estado ou país para refinar.</div>';
        return;
      }
      $('wx2Results').innerHTML = searchResults.map((r,i) => {
        const where = [r.admin1,r.country].filter(Boolean).join(' · ');
        const pop = populationLabel(r.population);
        return `<button type="button" class="wx-result" data-wx-result="${i}"><div><b>${escapeHtml(r.name)}</b><small>${escapeHtml(where)}${pop ? ` · ${escapeHtml(pop)}` : ''} · ${Number(r.latitude).toFixed(3)}, ${Number(r.longitude).toFixed(3)}</small></div><span>ADICIONAR</span></button>`;
      }).join('');
      $('wx2Results').querySelectorAll('[data-wx-result]').forEach((el) => el.addEventListener('click', () => addLocation(searchResults[Number(el.dataset.wxResult)])));
    } catch (error) {
      $('wx2Results').innerHTML = `<div class="wx-empty">${escapeHtml(error.message || 'Falha na busca.')}</div>`;
    } finally { button.disabled = false; }
  }

  function addLocation(loc) {
    if (!loc || draft.locations.length >= 5) return setStatus('O limite é de 5 cidades.', 'error');
    const id = String(loc.id || `${loc.latitude},${loc.longitude}`);
    if (draft.locations.some((x) => x.id === id || (Math.abs(x.latitude-loc.latitude)<.0001 && Math.abs(x.longitude-loc.longitude)<.0001))) return setStatus('Essa cidade já está cadastrada.', 'error');
    draft.locations.push({ id, name:loc.name, admin1:loc.admin1 || '', admin2:loc.admin2 || '', country:loc.country || '', countryCode:loc.countryCode || '', latitude:Number(loc.latitude), longitude:Number(loc.longitude), timezone:loc.timezone || 'auto', population:loc.population ?? null });
    draft.cities = draft.locations.map((x) => x.name);
    searchResults = []; $('wx2Results').innerHTML = ''; $('wx2Search').value = '';
    renderLocations(); renderActiveCity();
    setStatus('Cidade adicionada ao Preview.', 'ok');
  }

  function removeLocation(index) {
    draft.locations.splice(index,1);
    draft.cities = draft.locations.map((x) => x.name);
    draft.rotation.activeIndex = clamp(draft.rotation.activeIndex,0,Math.max(0,draft.locations.length-1));
    renderLocations(); renderActiveCity();
  }

  function renderLocations() {
    const host = $('wx2Locations');
    if (!host) return;
    if (!draft.locations.length) {
      host.innerHTML = '<div class="wx-empty">Nenhuma cidade selecionada. Use a pesquisa acima ou importe do PontoView Weather.</div>';
      return;
    }
    host.innerHTML = draft.locations.map((loc,i) => `<div class="wx-location"><span class="wx-index">${i+1}</span><div><b>${escapeHtml(loc.name)}</b><small>${escapeHtml([loc.admin1,loc.country].filter(Boolean).join(' · '))}</small></div><button class="wx-remove" type="button" data-wx-remove="${i}" aria-label="Remover ${escapeHtml(loc.name)}">×</button></div>`).join('');
    host.querySelectorAll('[data-wx-remove]').forEach((el) => el.addEventListener('click', () => removeLocation(Number(el.dataset.wxRemove))));
  }

  function renderActiveCity() {
    const select = $('wx2ActiveCity');
    if (!select) return;
    select.innerHTML = draft.locations.length ? draft.locations.map((loc,i) => `<option value="${i}">${escapeHtml(loc.name)}</option>`).join('') : '<option value="0">Nenhuma cidade</option>';
    select.value = String(clamp(draft.rotation.activeIndex,0,Math.max(0,draft.locations.length-1)));
  }

  function fillForm() {
    draft = normalize(readJSON(DRAFT_KEY, DEFAULT));
    $('wx2Template').value = draft.template;
    $('wx2Mode').value = draft.mode;
    $('wx2Interval').value = String(draft.rotation.interval);
    $('wx2Position').value = draft.style.position;
    $('wx2Visible').checked = draft.visible;
    $('wx2Rotate').checked = draft.rotation.enabled;
    $('wx2Condition').checked = draft.display.showCondition !== false;
    $('wx2MinMax').checked = draft.display.showMinMax !== false;
    $('wx2Humidity').checked = !!draft.display.showHumidity;
    $('wx2Wind').checked = !!draft.display.showWind;
    renderLocations(); renderActiveCity();
    if (!draft.locations.length && draft.cities.length) setStatus('Configuração antiga detectada. Pesquise novamente as cidades para confirmar a localização.', 'error');
    else setStatus('Preview independente do Program.');
  }

  function stateFromForm() {
    const next = normalize(draft);
    next.visible = $('wx2Visible').checked;
    next.template = $('wx2Template').value;
    next.mode = next.template === 'multi' ? 'panel' : $('wx2Mode').value;
    next.rotation.enabled = $('wx2Rotate').checked;
    next.rotation.interval = Number($('wx2Interval').value);
    next.rotation.activeIndex = Number($('wx2ActiveCity').value || 0);
    next.style.position = $('wx2Position').value;
    next.position = ['top-left','top-right','bottom-left','bottom-right'].includes(next.style.position) ? next.style.position : 'top-right';
    next.display.showCondition = $('wx2Condition').checked;
    next.display.showMinMax = $('wx2MinMax').checked;
    next.display.showHumidity = $('wx2Humidity').checked;
    next.display.showWind = $('wx2Wind').checked;
    next.showHumidity = next.display.showHumidity;
    next.showWind = next.display.showWind;
    next.cities = next.locations.map((x) => x.name);
    return normalize(next);
  }

  async function importWeatherProduct() {
    const btn = $('wx2Import'); btn.disabled = true;
    setStatus('Procurando a configuração do PontoView Weather…');
    try {
      const { data:{ user } } = await client.auth.getUser();
      if (!user) throw new Error('Sessão expirada.');
      const { data:workspaces, error:wErr } = await client.from('workspaces').select('id,name,created_at').eq('user_id',user.id).eq('product','weather_overlay').order('created_at',{ascending:true}).limit(1);
      if (wErr) throw wErr;
      const workspace = workspaces?.[0];
      if (!workspace) throw new Error('Nenhum canal do PontoView Weather foi encontrado.');
      const { data:programs, error:pErr } = await client.from('programs').select('id,name,created_at').eq('workspace_id',workspace.id).order('created_at',{ascending:true}).limit(1);
      if (pErr) throw pErr;
      const program = programs?.[0]; if (!program) throw new Error('Nenhum programa Weather encontrado.');
      const { data:sessions, error:sErr } = await client.from('live_sessions').select('id,updated_at,created_at').eq('program_id',program.id).order('updated_at',{ascending:false}).limit(1);
      if (sErr) throw sErr;
      const session = sessions?.[0]; if (!session) throw new Error('Nenhuma sessão Weather encontrada.');
      const { data:state, error:stErr } = await client.from('session_state').select('preview_state,program_state').eq('session_id',session.id).single();
      if (stErr) throw stErr;
      const source = state?.preview_state?.product === 'weather_overlay' ? state.preview_state : state?.program_state;
      if (!source || source.product !== 'weather_overlay' || !Array.isArray(source.locations) || !source.locations.length) throw new Error('A sessão Weather não possui cidades configuradas.');
      draft.locations = source.locations.slice(0,5).map((x) => ({...x}));
      draft.cities = draft.locations.map((x) => x.name);
      draft.template = ['compact','informative','complete'].includes(source.template) ? source.template : draft.template;
      draft.mode = source.mode === 'panel' ? 'panel' : 'carousel';
      draft.rotation = { ...draft.rotation, ...(source.rotation || {}) };
      draft.display = { ...draft.display, ...(source.display || {}) };
      if (source.style?.position) draft.style.position = source.style.position;
      renderLocations(); renderActiveCity(); fillFormFromDraftOnly();
      setStatus('Cidades e comportamento importados do PontoView Weather.', 'ok');
    } catch (error) { setStatus(error.message || 'Não foi possível importar.', 'error'); }
    finally { btn.disabled = false; }
  }

  function fillFormFromDraftOnly() {
    $('wx2Template').value = draft.template;
    $('wx2Mode').value = draft.mode;
    $('wx2Interval').value = String(draft.rotation.interval);
    $('wx2Position').value = POSITIONS.includes(draft.style.position) ? draft.style.position : 'top-right';
    $('wx2Rotate').checked = draft.rotation.enabled !== false;
    $('wx2Condition').checked = draft.display.showCondition !== false;
    $('wx2MinMax').checked = draft.display.showMinMax !== false;
    $('wx2Humidity').checked = !!draft.display.showHumidity;
    $('wx2Wind').checked = !!draft.display.showWind;
  }

  function savePreview() {
    draft = write('draft', stateFromForm());
    setStatus(draft.locations.length ? 'Weather salvo no Preview.' : 'Adicione pelo menos uma cidade.', draft.locations.length ? 'ok' : 'error');
  }

  function take() {
    draft = write('draft', stateFromForm());
    if (draft.visible && !draft.locations.length) return setStatus('Adicione pelo menos uma cidade antes do TAKE.', 'error');
    write('program', draft);
    setStatus('Weather aplicado no Program.', 'ok');
  }

  function out() {
    const program = normalize(readJSON(PROGRAM_KEY, DEFAULT));
    program.visible = false;
    write('program', program);
    setStatus('Weather retirado do Program.', 'ok');
  }

  function bind() {
    try { bc = new BroadcastChannel(WEATHER_CHANNEL); } catch {}
    $('wx2SearchBtn')?.addEventListener('click', searchCities);
    $('wx2Search')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchCities(); });
    $('wx2Import')?.addEventListener('click', importWeatherProduct);
    $('wx2Save')?.addEventListener('click', savePreview);
    $('wx2Take')?.addEventListener('click', take);
    $('wx2Out')?.addEventListener('click', out);
    $('wx2Template')?.addEventListener('change', () => { if ($('wx2Template').value === 'multi') $('wx2Mode').value = 'panel'; });
    $('wx2ActiveCity')?.addEventListener('change', () => { draft.rotation.activeIndex = Number($('wx2ActiveCity').value || 0); });
    const modal = $('weatherModal');
    if (modal) {
      modalObserver = new MutationObserver(() => { if (!modal.hidden) fillForm(); });
      modalObserver.observe(modal,{attributes:true,attributeFilter:['hidden']});
    }
  }

  bind();
  window.addEventListener('beforeunload', () => { try { bc?.close(); } catch {} modalObserver?.disconnect(); });
})();
