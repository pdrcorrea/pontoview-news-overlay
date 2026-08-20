(() => {
  'use strict';

  const cfg = window.PV_CONFIG;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });

  const token = new URLSearchParams(location.search).get('token');
  const POLL_MS = 1200;
  const GROUPS = ['#live-label', '#tag-top', '#side-block', '#headline-wrapper', '#detail-box', '#ticker-wrap'];

  let current = null;
  let currentRevision = -1;
  let currentStatus = null;
  let tickerTween = null;
  let channel = null;
  let refreshTimer = null;
  let pollTimer = null;
  let refreshInFlight = false;

  const $ = (id) => document.getElementById(id);
  const clone = (value) => JSON.parse(JSON.stringify(value));

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
    return `${parseInt(clean.slice(1, 3), 16)},${parseInt(clean.slice(3, 5), 16)},${parseInt(clean.slice(5, 7), 16)}`;
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
    if (!el || !wrap) return;

    const parentW = wrap.offsetWidth;
    const selfW = el.offsetWidth;
    if (!parentW || !selfW) return;

    const speed = Math.max(20, Number(current.style.tickerSpeed || 80));
    gsap.set(el, { x: parentW });
    tickerTween = gsap.to(el, {
      x: -selfW,
      duration: (parentW + selfW) / speed,
      ease: 'none',
      repeat: -1
    });
  }

  function sideVisible(state) {
    const logoVisible = !!(state.style.logoUrl && state.style.showLogo && state.visibility.logo);
    return logoVisible || state.style.showTime !== false;
  }

  function visibleTargets(state) {
    if (!state) return [];
    const targets = [];
    if (state.visibility.live) targets.push('#live-label');
    if (state.visibility.tag && state.content.tag) targets.push('#tag-top');
    if (sideVisible(state)) targets.push('#side-block');
    if (state.visibility.headline && state.content.headline) targets.push('#headline-wrapper');
    if (state.visibility.detail && state.visibility.headline && state.content.detail) targets.push('#detail-box');
    if (state.visibility.ticker && state.content.ticker) targets.push('#ticker-wrap');
    return targets;
  }

  function animationVector(style) {
    switch (style) {
      case 'slide-left':
        return { x: -110, y: 0, scale: 1 };
      case 'fade':
        return { x: 0, y: 0, scale: 1 };
      case 'scale-up':
        return { x: 0, y: 0, scale: 0.92 };
      case 'slide-up':
      default:
        return { x: 0, y: 42, scale: 1 };
    }
  }

  function applyTheme(state) {
    const root = document.documentElement;
    root.style.setProperty('--tema', state.style.primary || '#003366');
    root.style.setProperty('--texto', state.style.secondary || '#ffffff');
    root.style.setProperty('--tema-rgb', hexToRgb(state.style.primary || '#003366'));
    root.style.setProperty('--font-family', `'${state.style.font || 'Inter'}'`);
    root.style.setProperty('--ticker-bg', state.style.tickerBg || '#111827');
    root.style.setProperty('--ticker-text', state.style.tickerText || '#ffffff');
    document.body.dataset.template = state.template || 'lower_third';
  }

  function applyContent(state) {
    $('live-label').textContent = state.template === 'breaking' ? 'URGENTE' : 'AO VIVO';
    $('tag-top').textContent = state.content.tag || '';
    $('main-text').textContent = state.content.headline || '';
    $('detail-box').textContent = state.content.detail || '';
    $('ticker-text').textContent = state.content.ticker || '';

    const logoArea = $('logo-area');
    logoArea.replaceChildren();
    if (state.style.logoUrl && state.style.showLogo && state.visibility.logo) {
      const img = document.createElement('img');
      img.src = state.style.logoUrl;
      img.alt = 'Logo do canal';
      img.referrerPolicy = 'no-referrer';
      logoArea.appendChild(img);
    }

    $('time-box').style.display = state.style.showTime !== false ? 'flex' : 'none';

    const detailVisible = !!(state.visibility.detail && state.visibility.headline && state.content.detail);
    gsap.set('#detail-box', {
      height: detailVisible ? '4vh' : 0,
      marginTop: detailVisible ? '2px' : 0
    });
  }

  function setAllHidden() {
    stopTicker();
    gsap.killTweensOf(GROUPS);
    GROUPS.forEach((selector) => {
      gsap.set(selector, {
        clipPath: 'inset(0 100% 0 0)',
        opacity: 0,
        x: 0,
        y: 0,
        scale: 1
      });
    });
  }

  function showInstant(state) {
    setAllHidden();
    const targets = visibleTargets(state);
    targets.forEach((selector) => {
      gsap.set(selector, {
        clipPath: 'inset(0 0% 0 0)',
        opacity: 1,
        x: 0,
        y: 0,
        scale: 1
      });
    });
    if (state.visibility.ticker && state.content.ticker) requestAnimationFrame(startTicker);
  }

  function animateIn(state) {
    setAllHidden();
    const targets = visibleTargets(state);
    if (!targets.length) return;

    const from = animationVector(state.style.animation);
    targets.forEach((selector) => {
      gsap.set(selector, {
        clipPath: 'inset(0 100% 0 0)',
        opacity: 0,
        x: from.x,
        y: from.y,
        scale: from.scale
      });
    });

    gsap.to(targets, {
      clipPath: 'inset(0 0% 0 0)',
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      duration: 0.52,
      stagger: 0.055,
      ease: state.style.animation === 'fade' ? 'power1.out' : 'power3.out',
      overwrite: true,
      onComplete: () => {
        if (state.visibility.ticker && state.content.ticker) startTicker();
      }
    });
  }

  function animateOut(done) {
    stopTicker();
    const targets = visibleTargets(current);
    if (!targets.length) {
      done();
      return;
    }

    gsap.killTweensOf(targets);
    gsap.to(targets, {
      clipPath: 'inset(0 100% 0 0)',
      opacity: 0,
      y: -12,
      duration: 0.2,
      stagger: 0.018,
      ease: 'power2.in',
      overwrite: true,
      onComplete: done
    });
  }

  function applyState(raw, instant = false) {
    const next = normalize(raw);

    const commit = () => {
      current = next;
      applyTheme(next);
      applyContent(next);
      if (instant) showInstant(next);
      else animateIn(next);
    };

    if (instant || !current) {
      commit();
      return;
    }

    animateOut(commit);
  }

  function blank(instant = false) {
    const state = normalize(null);
    Object.keys(state.visibility).forEach((key) => { state.visibility[key] = false; });
    state.style.showTime = false;
    applyState(state, instant);
  }

  async function refreshProgram({ instant = false, force = false } = {}) {
    if (refreshInFlight || !token) return;
    refreshInFlight = true;

    try {
      const { data, error } = await sb.rpc('get_overlay_state', { p_token: token });
      if (error) {
        console.error('PontoView overlay state:', error);
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.program_state) {
        if (currentStatus !== 'ended' || force) blank(instant);
        currentStatus = 'ended';
        return;
      }

      const revision = Number(row.revision ?? -1);
      currentStatus = row.status || null;
      if (!force && revision <= currentRevision) return;

      currentRevision = revision;
      applyState(row.program_state, instant);
    } catch (error) {
      console.error('PontoView overlay refresh:', error);
    } finally {
      refreshInFlight = false;
    }
  }

  function scheduleCanonicalRefresh(delay = 70) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshProgram(), delay);
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => refreshProgram(), POLL_MS);
  }

  async function bootstrap() {
    if (!token || !/^[0-9a-f-]{36}$/i.test(token)) {
      blank(true);
      console.error('PontoView: token de overlay inválido.');
      return;
    }

    await refreshProgram({ instant: true, force: true });

    channel = sb
      .channel(`overlay:${token}`, { config: { private: false } })
      .on('broadcast', { event: 'program' }, () => scheduleCanonicalRefresh(45))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') scheduleCanonicalRefresh(0);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('PontoView Realtime:', status, 'Polling canônico permanece ativo.');
        }
      });

    startPolling();
  }

  function startClock() {
    const tick = () => {
      const now = new Date();
      $('time-box').textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    };
    tick();
    setInterval(tick, 1000);
  }

  window.addEventListener('online', () => scheduleCanonicalRefresh(0));
  window.addEventListener('focus', () => scheduleCanonicalRefresh(0));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleCanonicalRefresh(0);
  });

  window.addEventListener('beforeunload', () => {
    clearTimeout(refreshTimer);
    clearInterval(pollTimer);
    stopTicker();
    if (channel) sb.removeChannel(channel);
  });

  startClock();
  bootstrap();
})();
