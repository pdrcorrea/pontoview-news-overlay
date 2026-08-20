(() => {
  'use strict';

  const controls = [
    { key: 'live', label: 'AO VIVO', input: 'v-live' },
    { key: 'side', label: 'BLOCO LATERAL', composite: true },
    { key: 'tag', label: 'TAG', input: 'v-tag' },
    { key: 'headline', label: 'GC', input: 'v-headline' },
    { key: 'detail', label: 'DETALHE', input: 'v-detail' },
    { key: 'ticker', label: 'TICKER', input: 'v-ticker' },
    { key: 'clock', label: 'RELÓGIO', input: 'f-show-time' }
  ];

  const $ = (id) => document.getElementById(id);

  function dispatchToggle(el, checked) {
    if (!el) return;
    el.checked = checked;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function sideIsOn() {
    return !!($('v-logo')?.checked || $('f-show-time')?.checked);
  }

  function controlIsOn(control) {
    if (control.composite) return sideIsOn();
    return !!$(control.input)?.checked;
  }

  function toggleControl(control) {
    if (control.composite) {
      const next = !sideIsOn();
      if (next) {
        dispatchToggle($('v-logo'), true);
      } else {
        dispatchToggle($('v-logo'), false);
        dispatchToggle($('f-show-time'), false);
      }
      return;
    }
    const el = $(control.input);
    if (el) dispatchToggle(el, !el.checked);
  }

  function refreshButtons() {
    document.querySelectorAll('.op-toggle[data-control]').forEach((button) => {
      const control = controls.find((item) => item.key === button.dataset.control);
      if (!control) return;
      const on = controlIsOn(control);
      button.dataset.on = String(on);
      button.setAttribute('aria-pressed', String(on));
      const state = button.querySelector('.op-state');
      if (state) state.textContent = on ? 'ON' : 'OFF';
    });
  }

  function createVisibilityBank() {
    const bank = document.createElement('section');
    bank.className = 'operation-bank';
    bank.setAttribute('aria-label', 'Controles de visibilidade do Preview');

    const head = document.createElement('div');
    head.className = 'operation-bank-head';
    head.innerHTML = '<div class="operation-bank-title"><span class="material-symbols-rounded">tune</span>Elementos do Preview</div><div class="operation-bank-hint">Prepare aqui e envie ao ar somente com TAKE</div>';

    const grid = document.createElement('div');
    grid.className = 'operation-switches';

    controls.forEach((control) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'op-toggle';
      button.dataset.control = control.key;
      button.innerHTML = `<span class="op-toggle-label">${control.label}</span><span class="op-state">OFF</span>`;
      button.addEventListener('click', () => {
        toggleControl(control);
        requestAnimationFrame(refreshButtons);
      });
      grid.appendChild(button);
    });

    bank.append(head, grid);
    return bank;
  }

  function createMasterDock(takeStack) {
    const dock = document.createElement('div');
    dock.className = 'operation-dock';

    const master = document.createElement('div');
    master.className = 'operation-master';

    const clearProgram = $('clear-program-btn');
    const take = $('take-btn');
    const clearPreview = $('clear-preview-btn');
    [clearProgram, take, clearPreview].filter(Boolean).forEach((node) => master.appendChild(node));

    dock.appendChild(master);
    dock.appendChild(createVisibilityBank());

    const quickBank = takeStack?.querySelector('.quick-bank');
    if (quickBank) {
      quickBank.classList.add('operation-templates');
      const title = quickBank.querySelector('h3');
      if (title) title.textContent = 'Templates rápidos';
      dock.appendChild(quickBank);
    }

    return dock;
  }

  function renameDetailedControls() {
    const logoToggle = $('v-logo')?.closest('.toggle');
    if (logoToggle) {
      const label = logoToggle.querySelector('span');
      if (label) label.textContent = 'Bloco lateral';
    }

    const showLogo = $('f-show-logo')?.closest('.toggle');
    if (showLogo) {
      const label = showLogo.querySelector('span');
      if (label) label.textContent = 'Usar imagem da logo';
    }
  }

  function wireStateSync() {
    const ids = ['v-live', 'v-logo', 'v-tag', 'v-headline', 'v-detail', 'v-ticker', 'f-show-time'];
    ids.forEach((id) => {
      const el = $(id);
      el?.addEventListener('input', refreshButtons);
      el?.addEventListener('change', refreshButtons);
    });

    const previewScreen = $('preview-screen');
    if (previewScreen) new MutationObserver(refreshButtons).observe(previewScreen, { subtree: true, attributes: true, childList: true });

    setInterval(() => {
      if (!$('studio-view')?.classList.contains('hidden')) refreshButtons();
    }, 500);
  }

  function boot() {
    const studio = $('studio-view');
    const grid = studio?.querySelector('.console-grid');
    const takeStack = grid?.querySelector('.take-stack');
    if (!studio || !grid || !takeStack || studio.dataset.operationUi === '1') return;

    studio.dataset.operationUi = '1';
    renameDetailedControls();

    const dock = createMasterDock(takeStack);
    grid.before(dock);

    wireStateSync();
    refreshButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
