-- PontoView Newsroom: Account -> Channel(workspace) -> Program -> Live Session
-- Preview/Program state, atomic TAKE, session notes, public overlay token and RLS.

alter table public.workspaces
  alter column product set default 'news_overlay'::public.pontoview_product;

alter table public.workspaces
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  default_template text not null default 'lower_third',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint programs_workspace_slug_key unique (workspace_id, slug),
  constraint programs_id_workspace_key unique (id, workspace_id)
);

create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  program_id uuid not null,
  name text not null default 'Sessão ao vivo',
  status text not null default 'draft' check (status in ('draft','ready','live','ended')),
  public_token uuid not null default gen_random_uuid() unique,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_sessions_program_workspace_fkey foreign key (program_id, workspace_id)
    references public.programs(id, workspace_id) on delete cascade,
  constraint live_sessions_id_workspace_key unique (id, workspace_id)
);

create table if not exists public.session_state (
  session_id uuid primary key,
  workspace_id uuid not null,
  preview_state jsonb not null default '{"template":"lower_third","content":{"tag":"","headline":"","detail":"","ticker":""},"style":{"primary":"#003366","secondary":"#ffffff","tickerBg":"#111827","tickerText":"#ffffff","font":"Inter","animation":"slide-up","logoUrl":"","showLogo":false,"showTime":true},"visibility":{"live":false,"tag":true,"headline":true,"detail":true,"ticker":false,"logo":false}}'::jsonb,
  program_state jsonb not null default '{"template":"lower_third","content":{"tag":"","headline":"","detail":"","ticker":""},"style":{"primary":"#003366","secondary":"#ffffff","tickerBg":"#111827","tickerText":"#ffffff","font":"Inter","animation":"slide-up","logoUrl":"","showLogo":false,"showTime":true},"visibility":{"live":false,"tag":false,"headline":false,"detail":false,"ticker":false,"logo":false}}'::jsonb,
  revision bigint not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint session_state_session_workspace_fkey foreign key (session_id, workspace_id)
    references public.live_sessions(id, workspace_id) on delete cascade
);

create table if not exists public.session_notes (
  session_id uuid primary key,
  workspace_id uuid not null,
  content text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint session_notes_session_workspace_fkey foreign key (session_id, workspace_id)
    references public.live_sessions(id, workspace_id) on delete cascade
);

alter table public.presets
  add column if not exists program_id uuid,
  add column if not exists template_key text not null default 'lower_third',
  add column if not exists state jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'presets_program_workspace_fkey') then
    alter table public.presets add constraint presets_program_workspace_fkey
      foreign key (program_id, workspace_id) references public.programs(id, workspace_id) on delete cascade;
  end if;
end $$;

create index if not exists programs_workspace_idx on public.programs(workspace_id);
create index if not exists live_sessions_workspace_idx on public.live_sessions(workspace_id);
create index if not exists live_sessions_program_idx on public.live_sessions(program_id);
create index if not exists live_sessions_status_idx on public.live_sessions(status);
create index if not exists session_state_workspace_idx on public.session_state(workspace_id);
create index if not exists session_notes_workspace_idx on public.session_notes(workspace_id);
create index if not exists presets_program_idx on public.presets(program_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.set_updated_at() from public;

drop trigger if exists trg_workspaces_updated_at on public.workspaces;
create trigger trg_workspaces_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
drop trigger if exists trg_programs_updated_at on public.programs;
create trigger trg_programs_updated_at before update on public.programs for each row execute function public.set_updated_at();
drop trigger if exists trg_live_sessions_updated_at on public.live_sessions;
create trigger trg_live_sessions_updated_at before update on public.live_sessions for each row execute function public.set_updated_at();
drop trigger if exists trg_session_notes_updated_at on public.session_notes;
create trigger trg_session_notes_updated_at before update on public.session_notes for each row execute function public.set_updated_at();
drop trigger if exists trg_presets_updated_at on public.presets;
create trigger trg_presets_updated_at before update on public.presets for each row execute function public.set_updated_at();

alter table public.programs enable row level security;
alter table public.live_sessions enable row level security;
alter table public.session_state enable row level security;
alter table public.session_notes enable row level security;

-- Existing tables: remove public/broad policies and enforce ownership.
drop policy if exists "workspaces: owner all" on public.workspaces;
drop policy if exists "workspaces: public read slug" on public.workspaces;
create policy "workspaces_select_owner" on public.workspaces for select to authenticated using ((select auth.uid()) = user_id);
create policy "workspaces_insert_owner" on public.workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "workspaces_update_owner" on public.workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "workspaces_delete_owner" on public.workspaces for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "profiles: owner read" on public.profiles;
drop policy if exists "profiles: owner update" on public.profiles;
create policy "profiles_select_owner" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_owner" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy if exists "subscriptions: owner read" on public.subscriptions;
create policy "subscriptions_select_owner" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "news_overlay: owner all" on public.news_overlay_settings;
drop policy if exists "news_overlay: public read" on public.news_overlay_settings;
create policy "news_settings_select_owner" on public.news_overlay_settings for select to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "news_settings_insert_owner" on public.news_overlay_settings for insert to authenticated with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "news_settings_update_owner" on public.news_overlay_settings for update to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))) with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "news_settings_delete_owner" on public.news_overlay_settings for delete to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

drop policy if exists overlays_select on public.overlays;
drop policy if exists overlays_insert on public.overlays;
drop policy if exists overlays_update on public.overlays;
drop policy if exists overlays_delete on public.overlays;
create policy "overlays_select_owner" on public.overlays for select to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "overlays_insert_owner" on public.overlays for insert to authenticated with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "overlays_update_owner" on public.overlays for update to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))) with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "overlays_delete_owner" on public.overlays for delete to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

drop policy if exists presets_select on public.presets;
drop policy if exists presets_insert on public.presets;
drop policy if exists presets_update on public.presets;
drop policy if exists presets_delete on public.presets;
create policy "presets_select_owner" on public.presets for select to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "presets_insert_owner" on public.presets for insert to authenticated with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "presets_update_owner" on public.presets for update to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))) with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "presets_delete_owner" on public.presets for delete to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

create policy "programs_select_owner" on public.programs for select to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "programs_insert_owner" on public.programs for insert to authenticated with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "programs_update_owner" on public.programs for update to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))) with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "programs_delete_owner" on public.programs for delete to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

create policy "live_sessions_select_owner" on public.live_sessions for select to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "live_sessions_insert_owner" on public.live_sessions for insert to authenticated with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "live_sessions_update_owner" on public.live_sessions for update to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))) with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "live_sessions_delete_owner" on public.live_sessions for delete to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

create policy "session_state_select_owner" on public.session_state for select to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "session_state_insert_owner" on public.session_state for insert to authenticated with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "session_state_update_owner" on public.session_state for update to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))) with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

create policy "session_notes_select_owner" on public.session_notes for select to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "session_notes_insert_owner" on public.session_notes for insert to authenticated with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));
create policy "session_notes_update_owner" on public.session_notes for update to authenticated using (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))) with check (exists (select 1 from public.workspaces w where w.id = workspace_id and w.user_id = (select auth.uid())));

revoke all on public.programs, public.live_sessions, public.session_state, public.session_notes from anon;
grant select, insert, update, delete on public.programs to authenticated;
grant select, insert, update, delete on public.live_sessions to authenticated;
grant select, insert, update on public.session_state to authenticated;
grant select, insert, update on public.session_notes to authenticated;
grant select, insert, update, delete on public.workspaces to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert, update, delete on public.news_overlay_settings to authenticated;
grant select, insert, update, delete on public.overlays to authenticated;
grant select, insert, update, delete on public.presets to authenticated;

create or replace function public.create_live_session(p_program_id uuid, p_name text default null)
returns public.live_sessions language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_workspace_id uuid; v_session public.live_sessions;
begin
  select workspace_id into v_workspace_id from public.programs where id = p_program_id;
  if v_workspace_id is null then raise exception 'PROGRAM_NOT_FOUND'; end if;
  insert into public.live_sessions (workspace_id, program_id, name, status)
    values (v_workspace_id, p_program_id, coalesce(nullif(trim(p_name), ''), 'Sessão ao vivo'), 'ready') returning * into v_session;
  insert into public.session_state (session_id, workspace_id, updated_by) values (v_session.id, v_workspace_id, (select auth.uid()));
  insert into public.session_notes (session_id, workspace_id, updated_by) values (v_session.id, v_workspace_id, (select auth.uid()));
  return v_session;
end;
$$;
revoke all on function public.create_live_session(uuid, text) from public;
grant execute on function public.create_live_session(uuid, text) to authenticated;

create or replace function public.update_session_preview(p_session_id uuid, p_preview_state jsonb, p_expected_revision bigint)
returns public.session_state language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_state public.session_state;
begin
  update public.session_state set preview_state = p_preview_state, revision = revision + 1, updated_by = (select auth.uid()), updated_at = now()
  where session_id = p_session_id and revision = p_expected_revision returning * into v_state;
  if v_state.session_id is null then raise exception 'STATE_CONFLICT'; end if;
  return v_state;
end;
$$;
revoke all on function public.update_session_preview(uuid, jsonb, bigint) from public;
grant execute on function public.update_session_preview(uuid, jsonb, bigint) to authenticated;

create or replace function public.take_session(p_session_id uuid, p_expected_revision bigint)
returns public.session_state language plpgsql security invoker set search_path = public, realtime, pg_temp as $$
declare v_state public.session_state; v_token uuid;
begin
  update public.session_state set program_state = preview_state, revision = revision + 1, updated_by = (select auth.uid()), updated_at = now()
  where session_id = p_session_id and revision = p_expected_revision returning * into v_state;
  if v_state.session_id is null then raise exception 'STATE_CONFLICT'; end if;
  select public_token into v_token from public.live_sessions where id = p_session_id;
  perform realtime.send(jsonb_build_object('state', v_state.program_state, 'revision', v_state.revision), 'program', 'overlay:' || v_token::text, false);
  return v_state;
end;
$$;
revoke all on function public.take_session(uuid, bigint) from public;
grant execute on function public.take_session(uuid, bigint) to authenticated;

create or replace function public.clear_session_program(p_session_id uuid, p_expected_revision bigint)
returns public.session_state language plpgsql security invoker set search_path = public, realtime, pg_temp as $$
declare v_state public.session_state; v_token uuid; v_hidden jsonb := '{"live":false,"tag":false,"headline":false,"detail":false,"ticker":false,"logo":false}'::jsonb;
begin
  update public.session_state set program_state = coalesce(program_state, '{}'::jsonb) || jsonb_build_object('visibility', v_hidden), revision = revision + 1, updated_by = (select auth.uid()), updated_at = now()
  where session_id = p_session_id and revision = p_expected_revision returning * into v_state;
  if v_state.session_id is null then raise exception 'STATE_CONFLICT'; end if;
  select public_token into v_token from public.live_sessions where id = p_session_id;
  perform realtime.send(jsonb_build_object('state', v_state.program_state, 'revision', v_state.revision), 'program', 'overlay:' || v_token::text, false);
  return v_state;
end;
$$;
revoke all on function public.clear_session_program(uuid, bigint) from public;
grant execute on function public.clear_session_program(uuid, bigint) to authenticated;

create or replace function public.set_session_status(p_session_id uuid, p_status text)
returns public.live_sessions language plpgsql security invoker set search_path = public, realtime, pg_temp as $$
declare v_session public.live_sessions; v_state public.session_state;
begin
  if p_status not in ('draft','ready','live','ended') then raise exception 'INVALID_SESSION_STATUS'; end if;
  update public.live_sessions set status = p_status,
    started_at = case when p_status = 'live' then coalesce(started_at, now()) else started_at end,
    ended_at = case when p_status = 'ended' then now() when status = 'ended' and p_status <> 'ended' then null else ended_at end,
    updated_at = now() where id = p_session_id returning * into v_session;
  if v_session.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  if p_status = 'ended' then
    update public.session_state set program_state = coalesce(program_state, '{}'::jsonb) || jsonb_build_object('visibility', '{"live":false,"tag":false,"headline":false,"detail":false,"ticker":false,"logo":false}'::jsonb), revision = revision + 1, updated_by = (select auth.uid()), updated_at = now()
    where session_id = p_session_id returning * into v_state;
    perform realtime.send(jsonb_build_object('state', v_state.program_state, 'revision', v_state.revision, 'status', 'ended'), 'program', 'overlay:' || v_session.public_token::text, false);
  end if;
  return v_session;
end;
$$;
revoke all on function public.set_session_status(uuid, text) from public;
grant execute on function public.set_session_status(uuid, text) to authenticated;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;
create or replace function private.overlay_state_by_token(p_token uuid)
returns table(program_state jsonb, revision bigint, status text)
language sql stable security definer set search_path = public, pg_temp as $$
  select ss.program_state, ss.revision, ls.status from public.live_sessions ls
  join public.session_state ss on ss.session_id = ls.id
  where ls.public_token = p_token and ls.status <> 'ended' limit 1;
$$;
revoke all on function private.overlay_state_by_token(uuid) from public;
grant execute on function private.overlay_state_by_token(uuid) to anon, authenticated;
create or replace function public.get_overlay_state(p_token uuid)
returns table(program_state jsonb, revision bigint, status text)
language sql stable security invoker set search_path = public, private, pg_temp as $$
  select * from private.overlay_state_by_token(p_token);
$$;
revoke all on function public.get_overlay_state(uuid) from public;
grant execute on function public.get_overlay_state(uuid) to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='session_state') then alter publication supabase_realtime add table public.session_state; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='session_notes') then alter publication supabase_realtime add table public.session_notes; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_sessions') then alter publication supabase_realtime add table public.live_sessions; end if;
end $$;
