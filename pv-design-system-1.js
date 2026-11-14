/* PontoView Light Motion — interface Studio (sem interferir no broadcast). */
(() => {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.addEventListener('pointermove', (event) => {
    const el = event.target instanceof Element ? event.target.closest('body:not(.pv-app-body) .pv-btn, body.pv-app-body .pv-button') : null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--x', (event.clientX - rect.left) + 'px');
    el.style.setProperty('--y', (event.clientY - rect.top) + 'px');
  }, { passive: true });
})();
