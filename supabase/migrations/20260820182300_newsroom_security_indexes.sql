-- Follow-up hardening after Supabase security/performance advisors.
revoke all on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon, authenticated;

create or replace function public.has_active_product(p_product public.pontoview_product)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.subscriptions
    where user_id = (select auth.uid())
      and product = p_product
      and active = true
      and (expires_at is null or expires_at > now())
  );
$$;
revoke all on function public.has_active_product(public.pontoview_product) from public;
grant execute on function public.has_active_product(public.pontoview_product) to authenticated;

create index if not exists workspaces_user_id_idx on public.workspaces(user_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
create index if not exists presets_workspace_id_idx on public.presets(workspace_id);
create index if not exists presets_program_workspace_idx on public.presets(program_id, workspace_id);
create index if not exists live_sessions_program_workspace_idx on public.live_sessions(program_id, workspace_id);
create index if not exists session_state_session_workspace_idx on public.session_state(session_id, workspace_id);
create index if not exists session_state_updated_by_idx on public.session_state(updated_by);
create index if not exists session_notes_session_workspace_idx on public.session_notes(session_id, workspace_id);
create index if not exists session_notes_updated_by_idx on public.session_notes(updated_by);
