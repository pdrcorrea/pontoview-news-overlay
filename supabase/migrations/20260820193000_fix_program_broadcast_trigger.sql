-- Reliable Program -> OBS propagation.
-- Database broadcasts need elevated execution to write realtime.messages.
-- Keep client RPCs SECURITY INVOKER and isolate elevation in a trigger-only helper.

create or replace function private.broadcast_session_program_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid;
begin
  select ls.public_token into v_token
  from public.live_sessions ls
  where ls.id = new.session_id;

  if v_token is null then
    return new;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'state', new.program_state,
      'revision', new.revision
    ),
    'program',
    'overlay:' || v_token::text,
    false
  );

  return new;
end;
$$;

revoke all on function private.broadcast_session_program_change() from public, anon, authenticated;

drop trigger if exists trg_session_state_program_broadcast on public.session_state;
create trigger trg_session_state_program_broadcast
after update of program_state on public.session_state
for each row
when (old.program_state is distinct from new.program_state)
execute function private.broadcast_session_program_change();

create or replace function public.take_session(p_session_id uuid, p_expected_revision bigint)
returns public.session_state
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_state public.session_state;
begin
  update public.session_state
     set program_state = preview_state,
         revision = revision + 1,
         updated_by = (select auth.uid()),
         updated_at = now()
   where session_id = p_session_id
     and revision = p_expected_revision
  returning * into v_state;

  if v_state.session_id is null then
    raise exception 'STATE_CONFLICT';
  end if;

  return v_state;
end;
$$;
revoke all on function public.take_session(uuid, bigint) from public;
grant execute on function public.take_session(uuid, bigint) to authenticated;

create or replace function public.clear_session_program(p_session_id uuid, p_expected_revision bigint)
returns public.session_state
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_state public.session_state;
  v_hidden jsonb := '{"live":false,"tag":false,"headline":false,"detail":false,"ticker":false,"logo":false}'::jsonb;
begin
  update public.session_state
     set program_state = coalesce(program_state, '{}'::jsonb) || jsonb_build_object('visibility', v_hidden),
         revision = revision + 1,
         updated_by = (select auth.uid()),
         updated_at = now()
   where session_id = p_session_id
     and revision = p_expected_revision
  returning * into v_state;

  if v_state.session_id is null then
    raise exception 'STATE_CONFLICT';
  end if;

  return v_state;
end;
$$;
revoke all on function public.clear_session_program(uuid, bigint) from public;
grant execute on function public.clear_session_program(uuid, bigint) to authenticated;

create or replace function public.set_session_status(p_session_id uuid, p_status text)
returns public.live_sessions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_session public.live_sessions;
  v_hidden jsonb := '{"live":false,"tag":false,"headline":false,"detail":false,"ticker":false,"logo":false}'::jsonb;
begin
  if p_status not in ('draft','ready','live','ended') then
    raise exception 'INVALID_SESSION_STATUS';
  end if;

  update public.live_sessions
     set status = p_status,
         started_at = case when p_status = 'live' then coalesce(started_at, now()) else started_at end,
         ended_at = case when p_status = 'ended' then now() when status = 'ended' and p_status <> 'ended' then null else ended_at end,
         updated_at = now()
   where id = p_session_id
  returning * into v_session;

  if v_session.id is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if p_status = 'ended' then
    update public.session_state
       set program_state = coalesce(program_state, '{}'::jsonb) || jsonb_build_object('visibility', v_hidden),
           revision = revision + 1,
           updated_by = (select auth.uid()),
           updated_at = now()
     where session_id = p_session_id;
  end if;

  return v_session;
end;
$$;
revoke all on function public.set_session_status(uuid, text) from public;
grant execute on function public.set_session_status(uuid, text) to authenticated;
