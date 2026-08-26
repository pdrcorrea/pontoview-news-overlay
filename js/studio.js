(() => {
  'use strict';

  const config = window.PV_CONFIG || {};
  const CHECKOUT_URL = './checkout.html';
  const PRODUCT_URLS = Object.freeze({
    news_overlay: './control.html',
    weather_overlay: './weather/control.html'
  });
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => [...r.querySelectorAll(s)];
  const fmtDate = value => value ? new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'short', year:'numeric' }).format(new Date(value)) : '—';
  const initials = name => (name || 'PontoView').split(/\s+/).filter(Boolean).slice(0,2).map(v => v[0]).join('').toUpperCase();

  let client = null;
  let currentUser = null;
  let accessActive = false;
  let productAccess = new Map();

  const authScreen = qs('#authScreen');
  const studioShell = qs('#studioShell');

  function initClient() {
    if (window.supabase?.createClient && config.supabaseUrl && config.supabaseKey) {
      client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
      });
    }
  }

  function showApp() {
    authScreen?.setAttribute('hidden', '');
    if (authScreen) authScreen.style.display = 'none';
    studioShell?.removeAttribute('hidden');
    if (studioShell) studioShell.style.display = '';
    document.body.classList.add('is-authenticated');
  }

  function showAuth() {
    studioShell?.setAttribute('hidden', '');
    if (studioShell) studioShell.style.display = 'none';
    authScreen?.removeAttribute('hidden');
    if (authScreen) authScreen.style.display = '';
    document.body.classList.remove('is-authenticated');
  }

  function applyUser(user, profile = null) {
    const email = user?.email || 'conta@pontoview.com.br';
    const name = profile?.full_name || user?.user_metadata?.full_name || email.split('@')[0].replace(/[._-]/g, ' ') || 'Conta PontoView';
    const init = initials(name);
    const firstName = name.split(' ')[0];
    currentUser = user;

    const values = {
      '#userName': name,
      '#userEmail': email,
      '#userInitials': init,
      '#welcomeTitle': `Olá, ${firstName}.`,
      '#accountName': name,
      '#accountEmail': email,
      '#accountAvatar': init,
      '#accountNameRow': name,
      '#accountEmailRow': email
    };
    Object.entries(values).forEach(([selector, value]) => {
      const el = qs(selector);
      if (el) el.textContent = value;
    });
  }

  function isValidSubscription(subscription) {
    return !!(subscription?.active && (!subscription.expires_at || new Date(subscription.expires_at) > new Date()));
  }

  function applyAccess(subscriptions = []) {
    const validSubscriptions = (Array.isArray(subscriptions) ? subscriptions : [subscriptions]).filter(isValidSubscription);
    productAccess = new Map(validSubscriptions.map(subscription => [subscription.product, subscription]));
    accessActive = productAccess.size > 0;

    const chip = qs('#subscriptionChip');
    if (chip) {
      chip.classList.remove('is-checking', 'is-active', 'is-locked');
      chip.classList.add(accessActive ? 'is-active' : 'is-locked');
      const label = chip.querySelector('span');
      if (label) label.textContent = accessActive ? 'Studio ativo' : 'Assinatura necessária';
    }

    const paywall = qs('#paywallBanner');
    if (paywall) paywall.hidden = accessActive;

    const billingSubscription = productAccess.get('news_overlay') || productAccess.get('weather_overlay') || validSubscriptions[0] || null;
    const billingStatus = qs('#billingStatus');
    if (billingStatus) {
      billingStatus.textContent = accessActive ? 'ATIVA' : 'INATIVA';
      billingStatus.className = `pv-billing-status ${accessActive ? 'active' : 'locked'}`;
    }
    const started = qs('#billingStarted');
    const expires = qs('#billingExpires');
    if (started) started.textContent = fmtDate(billingSubscription?.started_at);
    if (expires) expires.textContent = fmtDate(billingSubscription?.expires_at);

    qsa('[data-product]').forEach(card => {
      const unlocked = productAccess.has(card.dataset.product);
      card.classList.toggle('is-locked', !unlocked);
    });
    qsa('[data-open-product]').forEach(btn => {
      const unlocked = productAccess.has(btn.dataset.openProduct);
      btn.textContent = unlocked ? 'Abrir overlay' : 'Assinar para usar';
    });
    qsa('[data-action="subscribe"]').forEach(btn => {
      btn.textContent = accessActive ? 'Gerenciar assinatura' : 'Assinar';
    });
  }

  function setView(view) {
    const validView = ['library', 'billing', 'account'].includes(view) ? view : 'library';
    qsa('[data-view-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.viewPanel === validView));
    qsa('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === validView));
    const titles = { library:'Overlays', billing:'Assinatura', account:'Conta' };
    const title = qs('#topbarTitle');
    if (title) title.textContent = titles[validView];
    window.scrollTo({ top:0, behavior:'smooth' });
    qs('.pv-sidebar')?.classList.remove('open');
  }

  function openModal(title, copy) {
    const modal = qs('#noticeModal');
    if (!modal) return;
    qs('#modalTitle').textContent = title;
    qs('#modalCopy').textContent = copy;
    modal.hidden = false;
  }

  function bindUI() {
    qsa('[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    qs('#accountMenuButton')?.addEventListener('click', () => setView('account'));
    qs('#sidebarToggle')?.addEventListener('click', () => qs('.pv-sidebar')?.classList.toggle('open'));

    qsa('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => { const modal = qs('#noticeModal'); if (modal) modal.hidden = true; }));
    qs('#noticeModal')?.addEventListener('click', e => { if (e.target === qs('#noticeModal')) e.currentTarget.hidden = true; });

    qsa('[data-action="subscribe"]').forEach(btn => btn.addEventListener('click', () => { location.href = CHECKOUT_URL; }));
    qsa('[data-action="billing-help"]').forEach(btn => btn.addEventListener('click', () => {
      location.href = 'mailto:suporte@pontoview.com.br?subject=Ajuda%20com%20cobrança%20PontoView%20Studio';
    }));
    qsa('[data-action="password-reset"]').forEach(btn => btn.addEventListener('click', async () => {
      if (!client || !currentUser?.email) return;
      const { error } = await client.auth.resetPasswordForEmail(currentUser.email, { redirectTo:`${location.origin}/studio.html` });
      openModal('Alterar senha', error ? error.message : 'Enviamos as instruções para o seu e-mail.');
    }));

    qsa('[data-open-product]').forEach(btn => btn.addEventListener('click', () => {
      const product = btn.dataset.openProduct;
      if (!productAccess.has(product)) { location.href = CHECKOUT_URL; return; }
      const target = PRODUCT_URLS[product];
      if (target) location.href = target;
    }));

    qs('#logoutButton')?.addEventListener('click', async () => {
      if (client) await client.auth.signOut();
      currentUser = null;
      accessActive = false;
      productAccess.clear();
      showAuth();
    });
  }

  async function loadAccount(user) {
    const [{ data:profile }, { data:subscriptions, error:subscriptionError }] = await Promise.all([
      client.from('profiles').select('full_name,email,avatar_url').eq('id', user.id).maybeSingle(),
      client.from('subscriptions').select('product,active,started_at,expires_at,created_at').eq('user_id', user.id).eq('active', true).order('created_at', { ascending:false })
    ]);

    applyUser(user, profile || null);
    if (subscriptionError) console.warn('Não foi possível consultar as assinaturas:', subscriptionError.message);
    applyAccess(subscriptions || []);
  }

  async function authenticate(email, password) {
    if (!client) throw new Error('Serviço de autenticação indisponível.');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showApp();
    setView('library');
    await loadAccount(data.user);
  }

  function bindAuth() {
    qs('#loginForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = qs('#loginMessage');
      if (msg) { msg.textContent = 'Entrando…'; msg.className = 'pv-form-message'; }
      try {
        await authenticate(qs('#loginEmail').value.trim(), qs('#loginPassword').value);
      } catch (err) {
        if (msg) { msg.textContent = err?.message || 'Não foi possível entrar.'; msg.className = 'pv-form-message error'; }
      }
    });

    qs('#forgotPassword')?.addEventListener('click', async () => {
      const email = qs('#loginEmail').value.trim();
      const msg = qs('#loginMessage');
      if (!email) {
        if (msg) { msg.textContent = 'Digite seu e-mail primeiro.'; msg.className = 'pv-form-message error'; }
        return;
      }
      if (!client) return;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo:`${location.origin}/studio.html` });
      if (msg) {
        msg.textContent = error ? error.message : 'Confira seu e-mail para continuar.';
        msg.className = `pv-form-message ${error ? 'error' : 'ok'}`;
      }
    });

    qs('#createAccountButton')?.addEventListener('click', () => { location.href = './index.html?cadastro=1'; });
  }

  async function boot() {
    initClient();
    bindUI();
    bindAuth();
    if (!client) { showAuth(); return; }

    const { data:{ session } } = await client.auth.getSession();
    if (session?.user) {
      showApp();
      setView('library');
      await loadAccount(session.user);
    } else {
      showAuth();
    }

    client.auth.onAuthStateChange(async (_event, sessionNow) => {
      if (sessionNow?.user) {
        showApp();
        setView('library');
        await loadAccount(sessionNow.user);
      } else {
        showAuth();
      }
    });
  }

  boot();
})();