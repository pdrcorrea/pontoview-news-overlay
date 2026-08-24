import { supabase } from './supabase-client.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const authModal = $('#authModal');
const authMessage = $('#authMessage');
let authMode = 'signin';

function toggleMenu() {
  $('#navLinks')?.classList.toggle('open');
}
$('#menuButton')?.addEventListener('click', toggleMenu);
$$('#navLinks a').forEach(a => a.addEventListener('click', () => $('#navLinks')?.classList.remove('open')));

function openAuth(mode = 'signin') {
  authMode = mode;
  setAuthMode(mode);
  authModal?.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeAuth() {
  authModal?.classList.remove('open');
  document.body.style.overflow = '';
}
$$('[data-auth-open]').forEach(btn => btn.addEventListener('click', () => openAuth(btn.dataset.authOpen || 'signin')));
$('#closeAuth')?.addEventListener('click', closeAuth);
authModal?.addEventListener('click', e => { if (e.target === authModal) closeAuth(); });

function setAuthMode(mode) {
  authMode = mode;
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authMode === mode));
  const nameField = $('#nameField');
  if (nameField) nameField.style.display = mode === 'signup' ? 'block' : 'none';
  const submit = $('#authSubmit');
  if (submit) submit.textContent = mode === 'signup' ? 'Criar conta' : 'Entrar';
  if (authMessage) { authMessage.textContent = ''; authMessage.className = 'auth-message'; }
}
$$('.auth-tab').forEach(t => t.addEventListener('click', () => setAuthMode(t.dataset.authMode)));

async function submitAuth(e) {
  e.preventDefault();
  const email = $('#authEmail')?.value.trim();
  const password = $('#authPassword')?.value;
  const fullName = $('#authName')?.value.trim();
  if (!email || !password) return;
  authMessage.textContent = 'Conectando ao Studio…';
  authMessage.className = 'auth-message';
  $('#authSubmit').disabled = true;

  try {
    if (authMode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName || null },
          emailRedirectTo: `${location.origin}/studio.html`
        }
      });
      if (error) throw error;
      authMessage.textContent = 'Conta criada. Confira seu e-mail para confirmar o acesso.';
      authMessage.className = 'auth-message ok';
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.href = 'studio.html';
    }
  } catch (error) {
    authMessage.textContent = error?.message || 'Não foi possível concluir o acesso.';
    authMessage.className = 'auth-message error';
  } finally {
    $('#authSubmit').disabled = false;
  }
}
$('#authForm')?.addEventListener('submit', submitAuth);

$('#resetPassword')?.addEventListener('click', async () => {
  const email = $('#authEmail')?.value.trim();
  if (!email) {
    authMessage.textContent = 'Digite seu e-mail primeiro.';
    authMessage.className = 'auth-message error';
    return;
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/studio.html` });
  authMessage.textContent = error ? error.message : 'Enviamos as instruções de recuperação para seu e-mail.';
  authMessage.className = `auth-message ${error ? 'error' : 'ok'}`;
});

async function refreshHeaderAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  $$('[data-logged-out]').forEach(el => el.style.display = session ? 'none' : 'inline-flex');
  $$('[data-logged-in]').forEach(el => el.style.display = session ? 'inline-flex' : 'none');
}
refreshHeaderAuth();
supabase.auth.onAuthStateChange(() => refreshHeaderAuth());

$$('.faq-q').forEach(btn => btn.addEventListener('click', () => {
  const item = btn.closest('.faq-item');
  item.classList.toggle('open');
  const icon = btn.querySelector('.faq-icon');
  if (icon) icon.textContent = item.classList.contains('open') ? 'expand_less' : 'expand_more';
}));

const COOKIE_KEY = 'pv_cookie_preferences_v1';
const cookieBanner = $('#cookieBanner');
if (!localStorage.getItem(COOKIE_KEY)) cookieBanner?.classList.add('show');
function setCookies(analytics) {
  localStorage.setItem(COOKIE_KEY, JSON.stringify({ necessary: true, analytics, updatedAt: new Date().toISOString() }));
  cookieBanner?.classList.remove('show');
}
$('#cookieEssential')?.addEventListener('click', () => setCookies(false));
$('#cookieAccept')?.addEventListener('click', () => setCookies(true));
$$('[data-cookie-settings]').forEach(el => el.addEventListener('click', e => {
  e.preventDefault();
  cookieBanner?.classList.add('show');
}));

const pageParams = new URLSearchParams(location.search);
if (pageParams.get('cadastro') === '1') openAuth('signup');
if (pageParams.get('entrar') === '1') openAuth('signin');
