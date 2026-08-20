-- Keep the left brand block visible even when no logo is configured.
-- The public overlay RPC now returns the owning channel name as safe display text.

drop function if exists public.get_overlay_state(uuid);
drop function if exists private.overlay_state_by_token(uuid);

create function private.overlay_state_by_token(p_token uuid)
returns table(program_state jsonb, revision bigint, status text, channel_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select ss.program_state, ss.revision, ls.status, w.name
  from public.live_sessions ls
  join public.session_state ss on ss.session_id = ls.id
  join public.workspaces w on w.id = ls.workspace_id
  where ls.public_token = p_token and ls.status <> 'ended'
  limit 1;
$$;

revoke all on function private.overlay_state_by_token(uuid) from public;
grant execute on function private.overlay_state_by_token(uuid) to anon, authenticated;

create function public.get_overlay_state(p_token uuid)
returns table(program_state jsonb, revision bigint, status text, channel_name text)
language sql stable security invoker set search_path = public, private, pg_temp as $$
  select * from private.overlay_state_by_token(p_token);
$$;

revoke all on function public.get_overlay_state(uuid) from public;
grant execute on function public.get_overlay_state(uuid) to anon, authenticated;
