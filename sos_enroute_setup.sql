-- SafeDrive180: SOS "Я в пути" (кто едет помогать)
-- Запусти в Supabase SQL Editor

create table if not exists public.sos_enroute (
  id bigserial primary key,
  marker_id bigint not null references public.markers(id) on delete cascade,
  user_id text not null,
  status text not null default 'enroute',
  arrived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sos_enroute_unique unique (marker_id, user_id)
);

-- Миграция для уже созданной таблицы (идемпотентно)
alter table public.sos_enroute add column if not exists status text;
alter table public.sos_enroute alter column status set default 'enroute';
update public.sos_enroute set status = 'enroute' where status is null;
alter table public.sos_enroute alter column status set not null;

alter table public.sos_enroute add column if not exists arrived_at timestamptz;

create index if not exists idx_sos_enroute_marker_id on public.sos_enroute(marker_id);
create index if not exists idx_sos_enroute_user_id on public.sos_enroute(user_id);

alter table public.sos_enroute enable row level security;

-- Читать могут все авторизованные (и можно anon, если используете anon-режим)
drop policy if exists "sos_enroute_select" on public.sos_enroute;
create policy "sos_enroute_select" on public.sos_enroute
  for select to authenticated using (true);

drop policy if exists "sos_enroute_select_anon" on public.sos_enroute;
create policy "sos_enroute_select_anon" on public.sos_enroute
  for select to anon using (true);

-- Добавлять может только сам пользователь (user_id должен совпадать с sub)
drop policy if exists "sos_enroute_insert_own" on public.sos_enroute;
create policy "sos_enroute_insert_own" on public.sos_enroute
  for insert to authenticated
  with check (
    user_id = coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')
    )
  );

-- Если у вас включён anon-режим (как в supabase_setup.sql), разрешаем INSERT для anon.
-- ВНИМАНИЕ: в anon-режиме проверить подлинность user_id на стороне БД нельзя.
-- Это сделано для совместимости с текущей архитектурой проекта.
drop policy if exists "sos_enroute_insert_anon" on public.sos_enroute;
create policy "sos_enroute_insert_anon" on public.sos_enroute
  for insert to anon
  with check (true);

revoke update, delete on public.sos_enroute from anon, authenticated;
grant select on public.sos_enroute to anon, authenticated;
grant insert on public.sos_enroute to anon, authenticated;
grant usage, select on sequence public.sos_enroute_id_seq to authenticated;
grant usage, select on sequence public.sos_enroute_id_seq to anon;
