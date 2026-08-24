import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

const config = window.PV_CONFIG;
if (!config?.supabaseUrl || !config?.supabaseKey) {
  throw new Error('Configuração do PontoView Studio indisponível.');
}

export const supabase = createClient(config.supabaseUrl, config.supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
