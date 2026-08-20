/**
 * PontoView Studio — subscription helper.
 * Uses the canonical pontoview-backend subscriptions schema.
 * This file intentionally does not block the newsroom UI; it only reports
 * whether the current account has an active News Overlay subscription.
 */
(function () {
  async function hasActiveNewsOverlay(userId) {
    if (!window.sb || !userId) return false;
    const { data, error } = await window.sb
      .from('subscriptions')
      .select('active, expires_at')
      .eq('user_id', userId)
      .eq('product', 'news_overlay')
      .eq('active', true)
      .maybeSingle();

    if (error || !data) return false;
    return data.expires_at === null || new Date(data.expires_at) > new Date();
  }

  window.PVAccess = Object.freeze({ hasActiveNewsOverlay });
})();
