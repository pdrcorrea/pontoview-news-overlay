-- Defense in depth: legacy tables no longer need anonymous table access.
revoke all on table public.workspaces from public, anon;
revoke all on table public.news_overlay_settings from public, anon;
revoke all on table public.overlays from public, anon;
revoke all on table public.presets from public, anon;
revoke all on table public.profiles from public, anon;
revoke all on table public.subscriptions from public, anon;

-- Restore only the operations required by signed-in Studio clients.
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.news_overlay_settings to authenticated;
grant select, insert, update, delete on public.overlays to authenticated;
grant select, insert, update, delete on public.presets to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
