create table if not exists public.weather_cache (
  location_key text primary key,
  latitude double precision not null,
  longitude double precision not null,
  provider text not null default 'open_meteo',
  temperature double precision,
  apparent_temperature double precision,
  humidity integer,
  wind_speed double precision,
  weather_code integer,
  is_day boolean,
  temp_min double precision,
  temp_max double precision,
  source_time text,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weather_cache_latitude_check check (latitude between -90 and 90),
  constraint weather_cache_longitude_check check (longitude between -180 and 180)
);

alter table public.weather_cache enable row level security;

revoke all on table public.weather_cache from anon, authenticated;
grant select, insert, update on table public.weather_cache to service_role;

create index if not exists weather_cache_fetched_at_idx on public.weather_cache (fetched_at);

comment on table public.weather_cache is
  'Server-side cache for PontoView Weather provider data. Browser clients have no direct access.';
