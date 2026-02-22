-- SafeDrive180: расписание рассылки погоды/прогноза через pg_cron + pg_net
--
-- Что делает:
-- - В 05:00 / 12:00 / 17:00 (по МСК) вызывает mchs-auto?action=cron (текущая погода)
-- - В 21:00 (по МСК) вызывает mchs-auto?action=cron (прогноз на завтра)
--
-- Важно:
-- - В Dashboard нужно включить extensions: pg_cron и pg_net.
-- - Секрет НЕ храните в репозитории. Вставьте его вручную при выполнении SQL.
--
-- URL Edge Function:
--   https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron
--
-- Заголовок:
--   x-cron-secret: <ваш_секрет>

-- 1) Включить расширения (если ещё не включены)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) (Рекомендуется) Проверить timezone для pg_cron
-- pg_cron по умолчанию часто работает в UTC.
-- Если нельзя сменить timezone на уровне БД, просто используйте расписание в UTC (см. ниже).
--
-- Посмотреть текущий timezone:
-- show timezone;
-- show cron.timezone;
--
-- Если получится (иногда права ограничены):
-- select cron.alter_job_timezone('Europe/Moscow'); -- может не существовать в вашей версии
-- alter database postgres set cron.timezone = 'Europe/Moscow';

-- 3) Настройка расписаний
-- ВАРИАНТ A: если cron.timezone = Europe/Moscow
--  - 05:00, 12:00, 17:00, 21:00
--
-- ВАРИАНТ B (без изменения таймзоны, если cron в UTC):
--  - 05:00 МСК = 02:00 UTC
--  - 12:00 МСК = 09:00 UTC
--  - 17:00 МСК = 14:00 UTC
--  - 21:00 МСК = 18:00 UTC
--
-- Выберите один вариант и закомментируйте другой.

-- ===== СЕКРЕТ (важно для pg_cron) =====
-- ВАЖНО: set_config/current_setting НЕ подходят для pg_cron, потому что каждая cron-джоба
-- выполняется в новой сессии и не видит set_config, выполненный в SQL Editor.
-- Поэтому секрет должен быть указан прямо в тексте задания (или быть задан на уровне БД через ALTER DATABASE SET).
--
-- Если не хотите хранить секрет в файле — вставьте его вручную прямо в 4 места ниже.
-- Текущее значение:
--   safedrive_mchs_cron_2026_secure_token_180_dpr

-- Общая команда вызова Edge Function
-- (pg_net): net.http_get(url, headers := jsonb)

-- ---- ВАРИАНТ A (MSK) ----
-- 05:00
select cron.schedule(
  'safedrive_weather_05_msk',
  '0 5 * * *',
  $$select net.http_get(
      'https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron',
      headers := jsonb_build_object(
        'x-cron-secret', 'safedrive_mchs_cron_2026_secure_token_180_dpr',
        'accept', 'application/json'
      )
    );$$
);

-- 12:00
select cron.schedule(
  'safedrive_weather_12_msk',
  '0 12 * * *',
  $$select net.http_get(
      'https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron',
      headers := jsonb_build_object(
        'x-cron-secret', 'safedrive_mchs_cron_2026_secure_token_180_dpr',
        'accept', 'application/json'
      )
    );$$
);

-- 17:00
select cron.schedule(
  'safedrive_weather_17_msk',
  '0 17 * * *',
  $$select net.http_get(
      'https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron',
      headers := jsonb_build_object(
        'x-cron-secret', 'safedrive_mchs_cron_2026_secure_token_180_dpr',
        'accept', 'application/json'
      )
    );$$
);

-- 21:00 (прогноз на завтра)
select cron.schedule(
  'safedrive_forecast_21_msk',
  '0 21 * * *',
  $$select net.http_get(
      'https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron',
      headers := jsonb_build_object(
        'x-cron-secret', 'safedrive_mchs_cron_2026_secure_token_180_dpr',
        'accept', 'application/json'
      )
    );$$
);

-- ---- ВАРИАНТ B (UTC) ----
-- Если у вас cron.timezone = UTC, используйте эти строки вместо варианта A:
--
-- select cron.schedule('safedrive_weather_05_msk__02_utc', '0 2 * * *', $$select net.http_get('https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron', headers := jsonb_build_object('x-cron-secret', current_setting('app.mchs_cron_secret', true), 'accept','application/json'));$$);
-- select cron.schedule('safedrive_weather_12_msk__09_utc', '0 9 * * *', $$select net.http_get('https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron', headers := jsonb_build_object('x-cron-secret', current_setting('app.mchs_cron_secret', true), 'accept','application/json'));$$);
-- select cron.schedule('safedrive_weather_17_msk__14_utc', '0 14 * * *', $$select net.http_get('https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron', headers := jsonb_build_object('x-cron-secret', current_setting('app.mchs_cron_secret', true), 'accept','application/json'));$$);
-- select cron.schedule('safedrive_forecast_21_msk__18_utc', '0 18 * * *', $$select net.http_get('https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto?action=cron', headers := jsonb_build_object('x-cron-secret', current_setting('app.mchs_cron_secret', true), 'accept','application/json'));$$);

-- 4) Проверка
-- Список заданий:
-- select * from cron.job order by jobid desc;
--
-- История запусков:
-- select * from cron.job_run_details order by start_time desc limit 50;
--
-- 5) Удаление задач (если нужно)
-- select cron.unschedule('safedrive_weather_05_msk');
-- select cron.unschedule('safedrive_weather_12_msk');
-- select cron.unschedule('safedrive_weather_17_msk');
-- select cron.unschedule('safedrive_forecast_21_msk');
