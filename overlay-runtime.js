(() => {
  'use strict';

  const cfg = window.PV_CONFIG;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const token = new URLSearchParams(location.search).get('token');
  let current = null;
  let tickerTween = null;
  let channel = null;

  const $ = (id) => document.getElementById(id);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function normalize(raw) {
    const base = clone(cfg.defaultState);
    if (!raw || typeof raw !== 'object') return base;
    return {
      template: raw.template || base.template,
      content: { ...base.content, ...(raw.content || {}) },
      style: { ...base.style, ...(raw.style || {}) },
      visibility: { ...base.visibility, ...(raw.visibility || {}) }
    };
  }

  function hexToRgb(hex = '#003366') {
    const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#003366';
    return `${parseInt(clean.slice(1,3),16)},${parseInt(clean.slice(3,5),16)},${parseInt(clean.slice(5,7),16)}`;
  }

  function stopTicker() {
    if (tickerTween) tickerTween.kill();
    tickerTween = null;
  }

  function startTicker() {
    stopTicker();
    if (!current?.visibility?.ticker || !current?.content?.ticker) return;
    const el = $('ticker-text');
    const wrap = $('ticker-wrap');
    const parentW = wrap.offsetWidth;
    const selfW = el.offsetWidth;
    if (!parentW || !selfW) return;
    const speed = Math.max(20, Number(current.style.tickerSpeed || 80));
    gsap.set(el, { x: parentW });
    tickerTween = gsap.to(el, { x: -selfW, duration: (parentW + selfW) / speed, ease: 'none', repeat: -1 });
  }

  function setVisibility(selector, visible, instant = false) {
    const el = document.querySelector(selector);
    if (!el) return;
    if (instant) return gsap.set(el, { clipPath: visible ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)', opacity: visible ? 1 : 0 });
    gsap.to(el, { clipPath: visible ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)', opacity: visible ? 1 : 0, duration: .42, ease: 'power3.inOut' });
  }

  function animationFromStyle(style) {
    switch (style) {
      case 'slide-left': return { x: -80, y: 0 };
      case 'fade': return { x: 0, y: 0, opacity: 0 };
      case 'scale-up': return { x: 0, y: 0, scale: .94, opacity: 0 };
      default: return { x: 0, y: 36, opacity: 0 };
    }
  }

  function applyState(raw, instant = false) {
    const state = normalize(raw);
    current = state;
    const root = document.documentElement;
    root.style.setProperty('--tema', state.style.primary);
    root.style.setProperty('--texto', state.style.secondary);
    root.style.setProperty('--tema-rgb', hexToRgb(state.style.primary));
    root.style.setProperty('--font-family', `'${state.style.font || 'Inter'}'`);
    root.style.setProperty('--ticker-bg', state.style.tickerBg || '#111827');
    root.style.setProperty('--ticker-text', state.style.tickerText || '#ffffff');

    $('live-label').textContent = state.template === 'breaking' ? 'URGENTE' : 'AO VIVO';
    $('tag-top').textContent = state.content.tag || '';
    $('main-text').textContent = state.content.headline || '';
    $('detail-box').textContent = state.content.detail || '';
    $('ticker-text').textContent = state.content.ticker || '';

    const logoArea = $('logo-area');
    if (state.style.logoUrl && state.style.showLogo && state.visibility.logo) {
      logoArea.replaceChildren();
      const img = document.createElement('img');
      img.src = state.style.logoUrl;
      img.alt = 'logo';
      logoArea.appendChild(img);
    } else {
      logoArea.replaceChildren();
    }
    $('time-box').style.display = state.style.showTime ? 'flex' : 'none';
    const sideVisible = (state.style.showLogo && state.visibility.logo && !!state.style.logoUrl) || state.style.showTime;

    const detailVisible = state.visibility.detail && !!state.content.detail && state.visibility.headline;
    if (instant) {
      gsap.set('#detail-box', { height: detailVisible ? '4vh' : 0, marginTop: detailVisible ? '2px' : 0, opacity: detailVisible ? 1 : 0 });
    } else {
      gsap.to('#detail-box', { height: detailVisible ? '4vh' : 0, marginTop: detailVisible ? '2px' : 0, opacity: detailVisible ? 1 : 0, duration: .32, ease: 'power2.out' });
    }

    setVisibility('#live-label', !!state.visibility.live, instant);
    setVisibility('#tag-top', !!state.visibility.tag && !!state.content.tag, instant);
    setVisibility('#headline-wrapper', !!state.visibility.headline && !!state.content.headline, instant);
    setVisibility('#detail-box', detailVisible, instant);
    setVisibility('#side-block', sideVisible, instant);
    setVisibility('#ticker-wrap', !!state.visibility.ticker && !!state.content.ticker, instant);

    stopTicker();
    if (state.visibility.ticker && state.content.ticker) setTimeout(startTicker, instant ? 0 : 420);

    if (!instant && state.visibility.headline && state.content.headline) {
      const from = animationFromStyle(state.style.animation);
      gsap.fromTo('#news-content', from, { x: 0, y: 0, scale: 1, opacity: 1, duration: .46, ease: 'power3.out' });
    }
  }

  function blank() {
    const state = normalize(null);
    Object.keys(state.visibility).forEach((key) => state.visibility[key] = false);
    state.style.showTime = false;
    applyState(state, true);
  }

  async function bootstrap() {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
      blank();
      console.error('PontoView: token de overlay inválido.');
      return;
    }

    const { data, error } = await sb.rpc('get_overlay_state', { p_token: token });
    if (error) console.error('PontoView bootstrap:', error);
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.program_state) applyState(row.program_state, true);
    else blank();

    channel = sb.channel(`overlay:${token}`)
      .on('broadcast', { event: 'program' }, ({ payload }) => {
        if (payload?.state) applyState(payload.state, false);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('PontoView Realtime:', status);
      });
  }

  function startClock() {
    const tick = () => {
      const now = new Date();
      $('time-box').textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  startClock();
  bootstrap();
})();
