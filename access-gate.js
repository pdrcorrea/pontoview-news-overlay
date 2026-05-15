/**
 * PontoView Studio — access-gate.js
 * Produto único PRO. Acesso liberado somente após pagamento confirmado.
 * Validação: tabela `subscriptions` no Supabase (status = active).
 *
 * COMO FUNCIONA:
 * 1. Usuário cria conta normalmente.
 * 2. Após login, este script verifica se existe subscription ativa.
 * 3. Se NÃO existir → exibe tela de pagamento com botão para o link do Mercado Pago.
 * 4. Se existir → libera o painel normalmente.
 * 5. Ao retornar do pagamento, o usuário clica em "Já paguei" → o sistema verifica novamente.
 *    (A confirmação automática é feita via webhook do Mercado Pago.)
 */

/* ── CONFIG — SUBSTITUA PELA SUA URL DO MERCADO PAGO ──────────────────── */
const MP_PAYMENT_LINK = 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_plan_id=d1ac77091a4a4c45bbc6fbe853e16c59';
const PRODUCT_NAME    = 'PontoView Studio PRO';
const PRODUCT_PRICE   = 'R$49/mês';
const SUPPORT_WA      = 'https://wa.me/5527999011689?text=Preciso+de+ajuda+com+o+PontoView+Studio';
/* ───────────────────────────────────────────────────────────────────────── */

let _accessGranted = false;

/* ── VERIFICAÇÃO DE ACESSO ─────────────────────────────────────────────── */
async function checkAccess() {
  if (!window.currentUser) return false;
  try {
    const { data } = await window.sb
      .from('subscriptions')
      .select('plan, status, expires_at')
      .eq('user_id', window.currentUser.id)
      .eq('status', 'active')
      .single();

    const valid =
      data &&
      (data.expires_at === null || new Date(data.expires_at) > new Date());

    _accessGranted = !!valid;
  } catch (e) {
    _accessGranted = false;
  }
  return _accessGranted;
}

/* ── TELA DE PAGAMENTO ─────────────────────────────────────────────────── */
function showPaywallScreen() {
  /* Remove tela de paywall anterior se existir */
  const existing = document.getElementById('pv-paywall');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pv-paywall';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:radial-gradient(circle at 30% 20%,rgba(40,192,255,.15),transparent 40%),
               radial-gradient(circle at 70% 80%,rgba(90,124,255,.15),transparent 40%),
               rgba(7,17,31,.98);
    display:flex;align-items:center;justify-content:center;
    padding:24px;font-family:'Inter',sans-serif;
  `;

  overlay.innerHTML = `
    <div style="
      background:rgba(13,23,39,.95);border:1px solid rgba(40,192,255,.25);
      border-radius:28px;padding:44px 36px;max-width:460px;width:100%;
      box-shadow:0 0 0 1px rgba(40,192,255,.08),0 48px 120px rgba(0,0,0,.7);
      text-align:center;
    ">

      <!-- Ícone -->
      <div style="
        width:80px;height:80px;border-radius:22px;margin:0 auto 22px;
        background:linear-gradient(135deg,rgba(40,192,255,.18),rgba(90,124,255,.22));
        border:1px solid rgba(40,192,255,.3);
        display:flex;align-items:center;justify-content:center;
      ">
        <span class="material-symbols-rounded" style="font-size:36px;color:#28c0ff">workspace_premium</span>
      </div>

      <!-- Título -->
      <div style="font-size:11px;color:#28c0ff;font-weight:900;letter-spacing:.18em;text-transform:uppercase;margin-bottom:10px">Acesso exclusivo</div>
      <h2 style="margin:0 0 10px;font-size:26px;font-weight:900;color:#ecf3ff;line-height:1.2">${PRODUCT_NAME}</h2>
      <p style="margin:0 0 28px;color:#97a7c3;font-size:14px;line-height:1.7">
        Gerencie overlays profissionais, GCs, tickers e identidade visual do seu conteúdo em tempo real — direto do navegador.
      </p>

      <!-- Benefícios -->
      <ul style="
        list-style:none;padding:16px;margin:0 0 28px;
        background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);
        border-radius:16px;display:flex;flex-direction:column;gap:11px;text-align:left;
      ">
        <li style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#ecf3ff">
          <span class="material-symbols-rounded" style="font-size:16px;color:#19c37d">check_circle</span>
          Workspaces ilimitados por conta
        </li>
        <li style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#ecf3ff">
          <span class="material-symbols-rounded" style="font-size:16px;color:#19c37d">check_circle</span>
          Presets ilimitados com export/import
        </li>
        <li style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#ecf3ff">
          <span class="material-symbols-rounded" style="font-size:16px;color:#19c37d">check_circle</span>
          Logo personalizada (imagem ou URL)
        </li>
        <li style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#ecf3ff">
          <span class="material-symbols-rounded" style="font-size:16px;color:#19c37d">check_circle</span>
          Transmissão em tempo real via Supabase
        </li>
        <li style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#ecf3ff">
          <span class="material-symbols-rounded" style="font-size:16px;color:#19c37d">check_circle</span>
          Suporte prioritário via WhatsApp
        </li>
      </ul>

      <!-- Preço -->
      <div style="margin-bottom:20px">
        <span style="font-size:36px;font-weight:900;color:#ecf3ff">R$49</span>
        <span style="font-size:14px;color:#97a7c3">/mês</span>
        <div style="font-size:11px;color:#97a7c3;margin-top:4px">Cobrado mensalmente · Cancele quando quiser</div>
      </div>

      <!-- Botão de pagamento -->
      <a
        href="${MP_PAYMENT_LINK}"
        target="_blank"
        id="pv-pay-btn"
        style="
          display:flex;align-items:center;justify-content:center;gap:8px;
          width:100%;padding:17px;border-radius:16px;
          font-size:15px;font-weight:900;color:white;text-decoration:none;
          background:linear-gradient(135deg,#28c0ff,#5a7cff);
          box-shadow:0 10px 32px rgba(40,192,255,.32);
          margin-bottom:12px;transition:.15s transform;
          font-family:'Inter',sans-serif;
        "
        onmouseover="this.style.transform='translateY(-2px)'"
        onmouseout="this.style.transform='translateY(0)'"
      >
        <span class="material-symbols-rounded" style="font-size:18px">credit_card</span>
        Assinar agora — ${PRODUCT_PRICE}
      </a>

      <!-- Botão "já paguei" -->
      <button
        onclick="paywallCheckAfterPayment()"
        style="
          width:100%;padding:13px;border-radius:14px;
          font-size:13px;font-weight:800;color:#97a7c3;
          background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);
          cursor:pointer;font-family:'Inter',sans-serif;margin-bottom:14px;
          display:flex;align-items:center;justify-content:center;gap:6px;
        "
      >
        <span class="material-symbols-rounded" style="font-size:15px">check_circle</span>
        Já realizei o pagamento
      </button>

      <!-- Mensagem de verificação -->
      <div id="pv-paywall-msg" style="
        display:none;font-size:12px;border-radius:10px;
        padding:10px 14px;margin-bottom:14px;
      "></div>

      <!-- Suporte -->
      <div style="font-size:11px;color:#97a7c3">
        Dúvidas? <a href="${SUPPORT_WA}" target="_blank" style="color:#28c0ff;font-weight:700">Fale via WhatsApp</a>
        &nbsp;·&nbsp;
        <a href="#" onclick="doLogout&&doLogout();return false" style="color:#97a7c3">Sair</a>
      </div>

    </div>
  `;

  document.body.appendChild(overlay);
}

function paywallSetMsg(text, isError) {
  const el = document.getElementById('pv-paywall-msg');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  el.style.background = isError ? 'rgba(255,93,115,.1)' : 'rgba(25,195,125,.1)';
  el.style.border = isError ? '1px solid rgba(255,93,115,.25)' : '1px solid rgba(25,195,125,.25)';
  el.style.color = isError ? '#ff93a1' : '#87f0bd';
}

async function paywallCheckAfterPayment() {
  paywallSetMsg('Verificando pagamento...', false);
  const ok = await checkAccess();
  if (ok) {
    document.getElementById('pv-paywall')?.remove();
    paywallSetMsg('', false);
    /* Recarrega a tela de workspace normalmente */
    if (typeof showWsScreen === 'function') showWsScreen();
  } else {
    paywallSetMsg(
      'Pagamento ainda não identificado. Aguarde alguns instantes e tente novamente. Se o problema persistir, fale via WhatsApp.',
      true
    );
  }
}

/* ── HOOK NO afterLogin ────────────────────────────────────────────────── */
(function hookAfterLogin() {
  const _origAfterLogin = window.afterLogin;
  if (typeof _origAfterLogin !== 'function') {
    /* Aguarda o script principal */
    window.addEventListener('load', () => {
      const _o = window.afterLogin;
      if (typeof _o === 'function') _patchAfterLogin(_o);
    });
    return;
  }
  _patchAfterLogin(_origAfterLogin);
})();

function _patchAfterLogin(original) {
  window.afterLogin = async function () {
    /* Executa o login original (seta currentUser, badge, etc.) */
    await original.apply(this, arguments);

    /* Verifica acesso APÓS o login original rodar */
    const ok = await checkAccess();
    if (!ok) {
      /* Esconde tudo e mostra paywall */
      ['login-page','confirm-page','ws-page','main-panel'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      showPaywallScreen();
    }
    /* Se ok === true, o fluxo normal já mostrou o ws-screen */
  };
}

/* ── ATUALIZA BADGE — sempre PRO quando tem acesso ─────────────────────── */
(function hookUpdatePlanUI() {
  const _orig = window.updatePlanUI;
  window.updatePlanUI = function () {
    if (_accessGranted) window.userPlan = 'pro';
    if (typeof _orig === 'function') _orig.apply(this, arguments);
  };
})();
