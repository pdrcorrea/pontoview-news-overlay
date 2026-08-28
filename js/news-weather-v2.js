(() => {
  'use strict';

  const cfg = window.PV_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token');
  const isPreview = qs.get('preview') === '1';
  const WEATHER_CHANNEL = 'pontoview-weather-v1';
  const DRAFT_KEY = `${WEATHER_CHANNEL}:draft`;
  const PROGRAM_KEY = `${WEATHER_CHANNEL}:program`;
  const API_URL = `${String(cfg.supabaseUrl || '').replace(/\/$/, '')}/functions/v1/weather-api`;
  const root = document.getElementById('weather-root');
  const sb = window.supabase?.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth:{ persistSession:!token, autoRefreshToken:!token, detectSessionInUrl:false }
  });
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  const weather = new Map();
  let current = null;
  let currentHash = '';
  let currentRevision = -1;
  let cityIndex = 0;
  let nextRotation = 0;
  let pollTimer = null;
  let localTimer = null;
  let rotationTimer = null;
  let weatherTimer = null;
  let lastWeatherAt = 0;
  let fetchBusy = false;
  let bc = null;

  const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
  const keyFor = (loc) => `${Number(loc.latitude).toFixed(4)},${Number(loc.longitude).toFixed(4)}`;
  const escapeHtml = (value='') => String(value).replace(/[&<>'"]/g,(ch)=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));
  const temp = (v) => Number.isFinite(Number(v)) ? `${Math.round(Number(v))}` : '—';
  const hash = (v) => { try { return JSON.stringify(v); } catch { return ''; } };

  function readJSON(key, fallback=null) { try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw):fallback; } catch { return fallback; } }

  function normalize(raw) {
    const x = raw && typeof raw === 'object' ? JSON.parse(JSON.stringify(raw)) : {};
    const locations = Array.isArray(x.locations) ? x.locations.slice(0,5).map((loc)=>({
      id:String(loc.id||`${loc.latitude},${loc.longitude}`),name:String(loc.name||'Cidade'),admin1:String(loc.admin1||''),country:String(loc.country||''),countryCode:String(loc.countryCode||loc.country_code||''),latitude:Number(loc.latitude),longitude:Number(loc.longitude),timezone:String(loc.timezone||'auto')
    })).filter((loc)=>Number.isFinite(loc.latitude)&&Number.isFinite(loc.longitude)) : [];
    const originalTemplate = x.template || 'informative';
    const multi = originalTemplate === 'multi';
    const template = multi ? 'informative' : (['compact','informative','complete'].includes(originalTemplate) ? originalTemplate : 'informative');
    const positions = ['top-left','top-center','top-right','middle-left','middle-center','middle-right','bottom-left','bottom-center','bottom-right'];
    const position = positions.includes(x.style?.position) ? x.style.position : (positions.includes(x.position) ? x.position : 'top-right');
    return {
      visible:!!x.visible,
      template,
      mode:multi ? 'panel' : (x.mode === 'panel' ? 'panel' : 'carousel'),
      locations,
      rotation:{ enabled:x.rotation?.enabled !== false, interval:[5,8,10,15,20].includes(Number(x.rotation?.interval))?Number(x.rotation.interval):8, activeIndex:clamp(Number(x.rotation?.activeIndex||0),0,Math.max(0,locations.length-1)) },
      display:{ showCondition:x.display?.showCondition !== false, showMinMax:x.display?.showMinMax !== false, showHumidity:!!(x.display?.showHumidity ?? x.showHumidity), showWind:!!(x.display?.showWind ?? x.showWind) },
      style:{ primary:x.style?.primary||'#175fb5',secondary:x.style?.secondary||'#fff',surface:x.style?.surface||'#fff',text:x.style?.text||'#082a54',muted:x.style?.muted||'#58708a',position,offsetX:Number(x.style?.offsetX||0),offsetY:Number(x.style?.offsetY||0) }
    };
  }

  function conditionLabel(code) {
    code=Number(code);
    if(code===0)return'Céu limpo'; if(code===1)return'Predomínio de sol'; if(code===2)return'Parcialmente nublado'; if(code===3)return'Nublado';
    if([45,48].includes(code))return'Neblina'; if([51,53,55,56,57].includes(code))return'Garoa'; if([61,63,65,66,67].includes(code))return'Chuva';
    if([71,73,75,77].includes(code))return'Neve'; if([80,81,82].includes(code))return'Pancadas de chuva'; if([85,86].includes(code))return'Pancadas de neve'; if([95,96,99].includes(code))return'Trovoadas'; return'Tempo variável';
  }

  function weatherIconSvg(code,isDay=true) {
    code=Number(code);
    const sun=`<circle cx="32" cy="32" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
    const moon=`<path d="M43 43c-14 3-25-9-22-22 2-8 8-13 15-15-3 10 4 21 15 23-1 6-4 11-8 14Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`;
    const cloud=`<path d="M20 45h27c7 0 12-5 12-11 0-7-6-12-13-12h-2C41 14 35 10 27 11c-9 1-15 8-15 17-5 1-8 5-8 9 0 5 4 8 9 8h7Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    let body='';
    if(code===0||code===1)body=isDay?sun:moon; else if([2,3,45,48].includes(code))body=cloud;
    else if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))body=`${cloud}<path d="M22 50l-4 7M34 50l-4 7M46 50l-4 7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`;
    else if([71,73,75,77,85,86].includes(code))body=`${cloud}<path d="M22 52h0M34 52h0M46 52h0" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`;
    else if([95,96,99].includes(code))body=`${cloud}<path d="M36 48l-7 10h7l-4 8 13-14h-8l4-4" fill="currentColor"/>`; else body=cloud;
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${body}</svg>`;
  }

  function displayCity(name,template) {
    const full=String(name||'Cidade').trim().toUpperCase();
    if(template==='compact'||full.length<=17)return full;
    const connectors=new Set(['DA','DE','DO','DAS','DOS','E']);
    const words=full.split(/\s+/).filter((w)=>w&&!connectors.has(w));
    if(words.length<2)return full;
    const last=words.pop();
    return `${words.map((w)=>`${w[0]}.`).join(' ')} ${last}`;
  }

  function supportHtml(state,w) {
    if(state.template==='compact')return'';
    if(state.template==='complete'){
      const pieces=[];
      if(state.display.showMinMax)pieces.push(`<span>↓ <b>${temp(w.min)}°</b></span><span>↑ <b>${temp(w.max)}°</b></span>`);
      if(state.display.showHumidity&&Number.isFinite(Number(w.humidity)))pieces.push(`<span>UR <b>${Math.round(w.humidity)}%</b></span>`);
      if(state.display.showWind&&Number.isFinite(Number(w.wind)))pieces.push(`<span>V <b>${Math.round(w.wind)}</b></span>`);
      return `<div class="weather-support"><div class="weather-minmax">${pieces.join('')}</div></div>`;
    }
    return state.display.showCondition ? `<div class="weather-support"><span class="condition">${escapeHtml(conditionLabel(w.code))}</span></div>` : '<div class="weather-support"></div>';
  }

  function cityContent(state,index) {
    const loc=state.locations[clamp(index,0,Math.max(0,state.locations.length-1))]; if(!loc)return'';
    const w=weather.get(keyFor(loc))||{};
    const name=displayCity(loc.name,state.template);
    const cityMarkup=state.template==='compact' ? `<span class="weather-city-marquee">${escapeHtml(name)}</span>` : escapeHtml(name);
    const inline=state.template==='complete'&&state.display.showCondition?`<div class="weather-condition-inline">${escapeHtml(conditionLabel(w.code))}</div>`:'';
    return `<div class="weather-top"><div class="weather-icon-box">${weatherIconSvg(w.code,w.isDay)}</div><div class="weather-main"><div class="weather-temp">${temp(w.temperature)}<sup>°C</sup></div><div class="weather-city">${cityMarkup}</div>${inline}</div></div>${supportHtml(state,w)}`;
  }

  function cardHtml(state,index){return `<div class="weather-card template-${state.template}"><div class="weather-accent"></div><div class="weather-city-content">${cityContent(state,index)}</div><div class="weather-flash"></div></div>`;}
  function anchorClass(pos){return pos.endsWith('left')?'anchor-left':pos.endsWith('center')?'anchor-center':'anchor-right';}

  function applyTheme(state){root.style.setProperty('--w-primary',state.style.primary);root.style.setProperty('--w-secondary',state.style.secondary);root.style.setProperty('--w-surface',state.style.surface);root.style.setProperty('--w-text',state.style.text);root.style.setProperty('--w-muted',state.style.muted);}

  function setupMarquee(scope=root){
    requestAnimationFrame(()=>scope.querySelectorAll('.weather-city').forEach((city)=>{
      const span=city.querySelector('.weather-city-marquee'); if(!span)return;
      const shift=Math.max(0,span.scrollWidth-city.clientWidth+6);
      city.classList.toggle('is-marquee',shift>3); city.style.setProperty('--city-shift',`${shift}px`); city.style.setProperty('--marquee-duration',`${Math.max(7,Math.min(14,6+shift/22))}s`);
    }));
  }

  function flash(card){if(reducedMotion||!card)return;const el=card.querySelector('.weather-flash');if(!el)return;gsap.killTweensOf(el);gsap.fromTo(el,{opacity:0,xPercent:-115},{opacity:.82,xPercent:110,duration:.32,ease:'power2.out',onComplete:()=>gsap.set(el,{opacity:0,xPercent:0})});}

  function render(instant=false){
    const state=current; root.replaceChildren(); if(!state?.visible||!state.locations.length)return; applyTheme(state);
    const layer=document.createElement('div');layer.className='weather-layer';const widget=document.createElement('div');const pos=state.style.position;widget.className=`weather-widget pos-${pos} ${anchorClass(pos)}`;widget.style.setProperty('--offset-x',`${state.style.offsetX}px`);widget.style.setProperty('--offset-y',`${state.style.offsetY}px`);
    widget.innerHTML=state.mode==='panel'?`<div class="weather-panel">${state.locations.map((_,i)=>cardHtml(state,i)).join('')}</div>`:cardHtml(state,cityIndex);
    layer.appendChild(widget);root.appendChild(layer);setupMarquee(widget);
    if(instant||reducedMotion){gsap.set(widget,{clipPath:'inset(0 0% 0 0)',opacity:1});return;}
    gsap.fromTo(widget,{clipPath:'inset(0 100% 0 0)',opacity:.12},{clipPath:'inset(0 0% 0 0)',opacity:1,duration:.58,ease:'power3.out',onComplete:()=>flash(widget.querySelector('.weather-card'))});
  }

  function hideAndRender(next,instant=false){
    const existing=root.querySelector('.weather-widget');current=next;cityIndex=clamp(next.rotation.activeIndex,0,Math.max(0,next.locations.length-1));nextRotation=Date.now()+next.rotation.interval*1000;
    if(!existing||instant||reducedMotion){render(instant);return;}
    gsap.killTweensOf(existing);gsap.to(existing,{clipPath:'inset(0 100% 0 0)',opacity:.08,duration:.4,ease:'power2.inOut',onComplete:()=>render(false)});
  }

  async function fetchWeather(force=false){
    if(fetchBusy||!current?.locations.length)return; if(!force&&Date.now()-lastWeatherAt<10*60*1000)return; fetchBusy=true;
    try{
      let payload,headers={ 'Content-Type':'application/json',apikey:cfg.supabaseKey };
      if(token) payload={mode:'overlay',token};
      else {
        const {data:{session}}=await sb.auth.getSession(); if(!session?.access_token)throw new Error('Sessão Weather indisponível no Preview.');
        headers.Authorization=`Bearer ${session.access_token}`; payload={mode:'preview',locations:current.locations};
      }
      const response=await fetch(API_URL,{method:'POST',headers,body:JSON.stringify(payload)});const json=await response.json().catch(()=>({}));if(!response.ok)throw new Error(json.error||`Weather backend ${response.status}`);
      (json.data||[]).forEach((row)=>weather.set(row.locationKey,row));lastWeatherAt=Date.now();
      if(root.querySelector('.weather-widget'))render(true);
    }catch(error){console.warn('PontoView News Weather:',error);}finally{fetchBusy=false;}
  }

  function applyWeather(raw,instant=false){
    const next=normalize(raw);const h=hash(next);if(!instant&&h===currentHash)return;currentHash=h;hideAndRender(next,instant);fetchWeather(false);
  }

  function rotate(){
    const state=current;if(!state?.visible||state.mode!=='carousel'||!state.rotation.enabled||state.locations.length<2||Date.now()<nextRotation)return;
    nextRotation=Date.now()+state.rotation.interval*1000;cityIndex=(cityIndex+1)%state.locations.length;const content=root.querySelector('.weather-city-content');const card=content?.closest('.weather-card');if(!content)return render(true);
    if(reducedMotion){content.innerHTML=cityContent(state,cityIndex);setupMarquee(content);return;}
    gsap.killTweensOf(content);gsap.to(content,{clipPath:'inset(0 0 0 100%)',opacity:.35,duration:.28,ease:'power2.inOut',onComplete:()=>{content.innerHTML=cityContent(state,cityIndex);setupMarquee(content);flash(card);gsap.set(content,{clipPath:'inset(0 100% 0 0)',opacity:.25});gsap.to(content,{clipPath:'inset(0 0% 0 0)',opacity:1,duration:.44,ease:'power3.out'});}});
  }

  async function remoteRead(force=false){
    if(!token||!sb)return;try{const{data,error}=await sb.rpc('get_overlay_state',{p_token:token});if(error)throw error;const row=Array.isArray(data)?data[0]:data;if(!row?.program_state){applyWeather({},force);return;}const rev=Number(row.revision??-1);if(!force&&rev<=currentRevision)return;currentRevision=rev;applyWeather(row.program_state.weather||{},force);await fetchWeather(force);}catch(error){console.warn('News Weather state:',error);}
  }

  function localRead(){const state=readJSON(isPreview?DRAFT_KEY:PROGRAM_KEY,{});applyWeather(state,!current);}

  function start(){
    rotationTimer=setInterval(rotate,250);weatherTimer=setInterval(()=>fetchWeather(false),60*1000);
    if(token){remoteRead(true);pollTimer=setInterval(()=>remoteRead(false),1000);}
    else{localRead();localTimer=setInterval(localRead,250);try{bc=new BroadcastChannel(WEATHER_CHANNEL);bc.onmessage=()=>localRead();}catch{}}
  }

  start();
  addEventListener('online',()=>fetchWeather(true));
  addEventListener('beforeunload',()=>{clearInterval(pollTimer);clearInterval(localTimer);clearInterval(rotationTimer);clearInterval(weatherTimer);try{bc?.close();}catch{}});
})();
