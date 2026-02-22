-- SafeDrive180: разовая выдача ачивки "Первопроходец (Beta-Tester)" всем текущим пользователям
--
-- Что делает:
-- - Берёт всех известных пользователей из drivers.user_id и markers.author_id
-- - Выдаёт им запись в public.user_achievements с key='beta_tester'
-- - Дубликаты игнорируются (работает даже без unique(user_id,key))

-- Рекомендуется после разовой выдачи применить fix_achievements.sql (unique constraint),
-- чтобы в будущем исключить дубликаты на уровне БД.

insert into public.user_achievements (user_id, key)
select distinct u.user_id, 'beta_tester' as key
from (
  select d.user_id::text as user_id
  from public.drivers d
  where d.user_id is not null and d.user_id::text <> ''

  union

  select m.author_id::text as user_id
  from public.markers m
  where m.author_id is not null and m.author_id::text <> ''
) u
where not exists (
  select 1
  from public.user_achievements ua
  where ua.user_id::text = u.user_id::text
    and ua.key = 'beta_tester'
);

-- Проверка сколько выдано:
-- select count(*) from public.user_achievements where key='beta_tester';
