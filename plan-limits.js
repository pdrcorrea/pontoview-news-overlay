/**
 * PontoView Studio — plan-limits.js
 * Restrições do plano Free e gatilhos de conversão ao Pro.
 * Carregado APÓS o script principal do control.html.
 */

/* ── CONSTANTES ────────────────────────────────────────── */
const FREE_LIMITS = { workspaces: 1, presets: 5 };
const UPGRADE_WA  = 'https://wa.me/5527999011689?text=Tenho+interesse+no+plano+Pro+do+PontoView+News+Overlay';

/* ── HELPERS INTERNOS ──────────────────────────────────── */
function _isPro()  { return typeof userPlan !== 'undefined' && userPlan === 'pro'; }
function _isFree() { return !_isPro(); }

function _openUpgrade(title, desc) {
  if (typeof openUpgradeModal === 'function') openUpgradeModal(title, desc);
}

/* ══════════════════════════════════════════════════════════
   1. BANNER PERSISTENTE — aparece no painel para usuários Free
   ══════════════════════════════════════════════════════════ */
function renderPersistentFreeBanner() {
  const existing = document.getElementById('pv-free-banner');
  if (existing) existing.remove();
  if (_isPro()) return;

  const bar = document.querySelector('.workspace-bar');
  if (!bar) return;

  const banner = document.createElement('div');
  banner.id = 'pv-free-banner';
  banner.innerHTML = `
    <span class="material-symbols-rounded" style="font-size:14px;color:#f6b73c">info</span>
    <span style="flex:1">
      <strong style="color:var(--text)">Plano Free</strong>
      <span style="color:var(--muted)"> · 1 workspace · ${FREE_LIMITS.presets} presets · sem logo personalizada · sem export/import</span>
    </span>
    <a href="${UPGRADE_WA}" target="_blank" style="
      font-size:11px;font-weight:900;color:#fff;
      background:linear-gradient(135deg,#28c0ff,#5a7cff);
      padding:6px 13px;border-radius:999px;text-decoration:none;
      white-space:nowrap;display:flex;align-items:center;gap:5px;flex-shrink:0
    ">
      <span class="material-symbols-rounded" style="font-size:13px">bolt</span> Upgrade Pro
    </a>`;
  banner.style.cssText = `
    display:flex;align-items:center;gap:10px;
    background:rgba(246,183,60,.07);border:1px solid rgba(246,183,60,.22);
    border-radius:16px;padding:11px 14px;margin-bottom:16px;font-size:12px;
  `;
  bar.insertAdjacentElement('afterend', banner);
}

/* ══════════════════════════════════════════════════════════
   2. WORKSPACE — bloqueia criação de 2º workspace no Free
   ══════════════════════════════════════════════════════════ */
async function applyWorkspaceFormRestriction() {
  if (_isPro()) return;

  const { data: wsList } = await window.sb.from('workspaces')
    .select('id').eq('user_id', window.currentUser.id);

  const wsForm = document.querySelector('.ws-new-form');
  if (!wsForm) return;

  if (wsList && wsList.length >= FREE_LIMITS.workspaces) {
    wsForm.innerHTML = `
      <div style="text-align:center;padding:10px 0">
        <div style="
          width:48px;height:48px;border-radius:14px;margin:0 auto 14px;
          background:rgba(246,183,60,.1);border:1px solid rgba(246,183,60,.25);
          display:flex;align-items:center;justify-content:center
        ">
          <span class="material-symbols-rounded" style="font-size:22px;color:#f6b73c">lock</span>
        </div>
        <div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:6px">
          Limite de workspaces atingido
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:16px">
          O plano Free permite apenas <strong style="color:var(--text)">1 workspace</strong>.<br>
          Faça upgrade para criar canais ilimitados.
        </div>
        <a href="${UPGRADE_WA}" target="_blank" style="
          display:flex;align-items:center;justify-content:center;gap:7px;
          width:100%;padding:13px;border-radius:14px;font-size:13px;font-weight:800;
          background:linear-gradient(135deg,#28c0ff,#5a7cff);color:white;text-decoration:none
        ">
          <span class="material-symbols-rounded" style="font-size:16px">bolt</span>
          Fazer upgrade — R$49/mês
        </a>
      </div>`;
  }
}

/* ══════════════════════════════════════════════════════════
   3. PRESETS — bloqueia savePreset e mostra contador
   ══════════════════════════════════════════════════════════ */

/* Sobrescreve savePreset para validar limite antes */
(function patchSavePreset() {
  const _original = window.savePreset;
  if (typeof _original !== 'function') return;

  window.savePreset = async function () {
    if (_isFree()) {
      const { count } = await window.sb.from('presets')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', window.workspaceId);

      if (count >= FREE_LIMITS.presets) {
        _openUpgrade(
          `Limite de presets atingido (${FREE_LIMITS.presets}/${FREE_LIMITS.presets})`,
          `O plano Free permite salvar apenas ${FREE_LIMITS.presets} presets. Faça upgrade para salvar presets ilimitados e nunca perder um layout.`
        );
        return;
      }
    }
    return _original.apply(this, arguments);
  };
})();

/* Sobrescreve loadPresetsFromDB para injetar contador e badge */
(function patchLoadPresets() {
  const _original = window.loadPresetsFromDB;
  if (typeof _original !== 'function') return;

  window.loadPresetsFromDB = async function () {
    await _original.apply(this, arguments);
    renderPresetCounter();
  };
})();

function renderPresetCounter() {
  if (_isPro()) return;
  const total = (window.presetsCache || []).length;
  const panel = document.getElementById('mpanel-presets');
  if (!panel) return;

  let counter = document.getElementById('pv-preset-counter');
  if (!counter) {
    counter = document.createElement('div');
    counter.id = 'pv-preset-counter';
    const applyBtn = document.getElementById('btn-apply-preset');
    if (applyBtn) panel.insertBefore(counter, applyBtn);
    else panel.prepend(counter);
  }

  const pct = Math.round((total / FREE_LIMITS.presets) * 100);
  const color = total >= FREE_LIMITS.presets ? '#ff5d73' : total >= 3 ? '#f6b73c' : '#19c37d';
  counter.innerHTML = `
    <div style="
      background:rgba(255,255,255,.03);border:1px solid var(--line);
      border-radius:14px;padding:12px 14px;margin-bottom:12px;
    ">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:12px;font-weight:700;color:var(--muted)">Presets usados</span>
        <span style="font-size:13px;font-weight:900;color:${color}">${total}/${FREE_LIMITS.presets}</span>
      </div>
      <div style="height:5px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:.4s width"></div>
      </div>
      ${total >= FREE_LIMITS.presets ? `
        <div style="margin-top:10px;font-size:11px;color:#ff93a1;display:flex;align-items:center;gap:5px">
          <span class="material-symbols-rounded" style="font-size:14px">lock</span>
          Limite atingido — <a href="${UPGRADE_WA}" target="_blank" style="color:var(--accent);font-weight:800">faça upgrade para continuar salvando</a>
        </div>` : ''}
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   4. EXPORT / IMPORT — bloqueados no Free
   ══════════════════════════════════════════════════════════ */
function applyExportImportRestriction() {
  if (_isPro()) return;

  /* Aguarda os botões estarem no DOM */
  const btns = document.querySelectorAll('#mpanel-presets .preset-actions-row button');
  btns.forEach(btn => {
    btn.style.opacity = '0.45';
    btn.style.position = 'relative';
    btn.style.overflow = 'hidden';

    /* Adiciona ícone de cadeado */
    if (!btn.querySelector('.pv-lock')) {
      const lock = document.createElement('span');
      lock.className = 'material-symbols-rounded pv-lock';
      lock.textContent = 'lock';
      lock.style.cssText = 'font-size:14px;color:#f6b73c;margin-left:4px';
      btn.appendChild(lock);
    }

    /* Intercepta clique */
    btn.addEventListener('click', function (e) {
      if (_isFree()) {
        e.stopImmediatePropagation();
        _openUpgrade(
          'Recurso exclusivo do plano Pro',
          'Export e import de presets permitem fazer backup dos seus layouts e migrar entre workspaces. Disponível apenas no plano Pro.'
        );
      }
    }, true);
  });

  /* Bloqueia também o input de arquivo para import */
  const importInput = document.getElementById('import-file');
  if (importInput) {
    const _originalChange = importInput.onchange;
    importInput.onchange = function (e) {
      if (_isFree()) {
        importInput.value = '';
        _openUpgrade(
          'Recurso exclusivo do plano Pro',
          'Import de presets está disponível apenas no plano Pro.'
        );
        return;
      }
      if (_originalChange) _originalChange.call(this, e);
    };
  }
}

/* ══════════════════════════════════════════════════════════
   5. LOGO — bloqueia URL e Arquivo no Free
   ══════════════════════════════════════════════════════════ */
function applyLogoRestriction() {
  if (_isPro()) return;

  const select = document.getElementById('logo-mode');
  if (!select) return;

  /* Substitui opções bloqueadas por versões com cadeado */
  Array.from(select.options).forEach(opt => {
    if (opt.value === 'url') opt.text = '🔒 Link (URL) — Pro';
    if (opt.value === 'file') opt.text = '🔒 Arquivo local — Pro';
  });

  select.addEventListener('change', function () {
    if (_isFree() && (this.value === 'url' || this.value === 'file')) {
      this.value = 'text'; /* reverte */
      if (typeof toggleLogoFields === 'function') toggleLogoFields();
      _openUpgrade(
        'Logo personalizada — plano Pro',
        'No plano Free a logo é exibida apenas como texto. Faça upgrade para usar imagens e URLs como logo do seu canal.'
      );
    }
  });
}

/* ══════════════════════════════════════════════════════════
   INIT — chamado após o painel principal carregar
   ══════════════════════════════════════════════════════════ */
function initPlanLimits() {
  if (typeof userPlan === 'undefined') return; /* aguarda o plano carregar */
  renderPersistentFreeBanner();
  applyExportImportRestriction();
  applyLogoRestriction();
}

/* Hook na abertura do painel principal */
(function hookShowMainPanel() {
  const _orig = window.showMainPanel;
  if (typeof _orig !== 'function') {
    /* Aguarda o script principal terminar de carregar */
    window.addEventListener('load', () => {
      const _o = window.showMainPanel;
      if (typeof _o === 'function') {
        window.showMainPanel = function () {
          _o.apply(this, arguments);
          setTimeout(initPlanLimits, 120);
        };
      }
    });
    return;
  }
  window.showMainPanel = function () {
    _orig.apply(this, arguments);
    setTimeout(initPlanLimits, 120);
  };
})();

/* Hook na tela de workspace */
(function hookShowWsScreen() {
  const _orig = window.showWsScreen;
  if (typeof _orig !== 'function') return;
  window.showWsScreen = async function () {
    await _orig.apply(this, arguments);
    await applyWorkspaceFormRestriction();
  };
})();

/* Hook no openMainTab para reinicializar restrições ao trocar de aba */
(function hookOpenMainTab() {
  const _orig = window.openMainTab;
  if (typeof _orig !== 'function') return;
  window.openMainTab = function (name) {
    _orig.apply(this, arguments);
    if (name === 'presets') {
      setTimeout(() => {
        applyExportImportRestriction();
        renderPresetCounter();
      }, 50);
    }
    if (name === 'editor') {
      setTimeout(applyLogoRestriction, 50);
    }
  };
})();
