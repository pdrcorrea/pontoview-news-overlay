(() => {
  'use strict';

  const monitorIds = ['preview-screen', 'program-screen'];

  function channelName() {
    const value = document.getElementById('crumb-channel')?.textContent?.trim();
    return value || 'CANAL';
  }

  function ensureMonitor(root) {
    if (!root || root.dataset.parityReady === '1') return;
    root.dataset.parityReady = '1';

    const gc = root.querySelector('.screen-gc');
    const tag = root.querySelector('.screen-tag');
    const logo = root.querySelector('.screen-logo');
    if (tag && tag.parentElement !== root) root.appendChild(tag);

    const side = document.createElement('div');
    side.className = 'pv-monitor-side';

    const brand = document.createElement('div');
    brand.className = 'pv-monitor-brand';

    const fallback = document.createElement('div');
    fallback.className = 'pv-monitor-fallback';
    fallback.textContent = channelName();

    const time = document.createElement('div');
    time.className = 'pv-monitor-time';
    time.textContent = '00:00';

    if (logo) brand.appendChild(logo);
    brand.appendChild(fallback);
    side.appendChild(brand);
    side.appendChild(time);
    root.appendChild(side);

    const sync = () => {
      fallback.textContent = channelName();
      const headline = root.querySelector('.screen-copy');
      const headlineVisible = !!headline && !headline.classList.contains('screen-hidden');
      side.classList.toggle('screen-hidden', !headlineVisible);

      const hasLogo = !!logo && !logo.classList.contains('hidden') && !!logo.getAttribute('src');
      if (logo) logo.style.display = hasLogo ? 'block' : 'none';
      fallback.style.display = hasLogo ? 'none' : 'flex';

      const preview = root.id === 'preview-screen';
      const showTime = preview ? (document.getElementById('f-show-time')?.checked !== false) : true;
      time.classList.toggle('hidden', !showTime);
      brand.classList.toggle('no-time', !showTime);
    };

    const observer = new MutationObserver(sync);
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['class', 'src'], childList: true, characterData: true });

    document.getElementById('f-show-time')?.addEventListener('change', sync);
    sync();
  }

  function tick() {
    const now = new Date();
    const value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    document.querySelectorAll('.pv-monitor-time').forEach((el) => { el.textContent = value; });
  }

  function boot() {
    monitorIds.forEach((id) => ensureMonitor(document.getElementById(id)));
    tick();
    setInterval(tick, 1000);

    const crumb = document.getElementById('crumb-channel');
    if (crumb) new MutationObserver(() => document.querySelectorAll('.pv-monitor-fallback').forEach((el) => { el.textContent = channelName(); }))
      .observe(crumb, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
