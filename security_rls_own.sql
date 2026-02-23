-- ============================================================
-- RLS ПОЛИТИКИ: ПОЛЬЗОВАТЕЛИ МОГУТ МЕНЯТЬ/УДАЛЯТЬ ТОЛЬКО СВОИ ЗАПИСИ
-- АДМИН (5118431735) МОЖЕТ ВСЁ
-- ============================================================
-- Запускайте в Supabase SQL Editor после настройки Auth
-- ============================================================

-- ============================================================
-- ВАЖНО (Telegram Auth):
-- Edge Function telegram-auth создаёт Supabase Auth пользователя и выдаёт access_token.
-- В этом JWT `sub` = UUID пользователя Supabase, а Telegram ID лежит в
-- `user_metadata.telegram_user_id`.
-- Таблицы приложения используют Telegram ID (author_id/user_id), поэтому
-- политики должны проверять именно telegram_user_id.
-- ============================================================

CREATE OR REPLACE FUNCTION jwt_tg_user_id()
RETURNS TEXT AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true), '')::json
        -> 'user_metadata'
        ->> 'telegram_user_id';
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION jwt_tg_user_id TO authenticated;

-- ============================================================
-- MARKERS (МЕТКИ)
-- ============================================================

ALTER TABLE public.markers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_markers" ON public.markers;
DROP POLICY IF EXISTS "markers_select_all" ON public.markers;
DROP POLICY IF EXISTS "markers_insert_own" ON public.markers;
DROP POLICY IF EXISTS "markers_update_own" ON public.markers;
DROP POLICY IF EXISTS "markers_delete_own" ON public.markers;
DROP POLICY IF EXISTS "markers_delete_admin" ON public.markers;

-- Просмотр: все могут видеть все метки
CREATE POLICY "markers_select_all" ON public.markers
    FOR SELECT TO authenticated USING (true);

-- Создание: любой авторизованный может создать метку
CREATE POLICY "markers_insert_own" ON public.markers
    FOR INSERT TO authenticated 
    WITH CHECK (author_id::text = jwt_tg_user_id());

-- Редактирование: только свои метки
CREATE POLICY "markers_update_own" ON public.markers
    FOR UPDATE TO authenticated 
    USING (author_id::text = jwt_tg_user_id())
    WITH CHECK (author_id::text = jwt_tg_user_id());

-- Удаление: только свои метки
CREATE POLICY "markers_delete_own" ON public.markers
    FOR DELETE TO authenticated 
    USING (author_id::text = jwt_tg_user_id());

-- Удаление: админ может удалять любые метки
CREATE POLICY "markers_delete_admin" ON public.markers
    FOR DELETE TO authenticated 
    USING (is_admin(jwt_tg_user_id()));

-- ============================================================
-- MESSAGES (СООБЩЕНИЯ)
-- ============================================================

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_messages" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_select" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_insert" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_update" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_delete" ON public.messages;
DROP POLICY IF EXISTS "auth_messages_delete_own" ON public.messages;
DROP POLICY IF EXISTS "auth_messages_delete_admin" ON public.messages;
DROP POLICY IF EXISTS "messages_select_all" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_own" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_admin" ON public.messages;

-- Просмотр: все могут видеть сообщения
CREATE POLICY "messages_select_all" ON public.messages
    FOR SELECT TO authenticated USING (true);

-- Создание: авторизованный может создать сообщение
CREATE POLICY "messages_insert_own" ON public.messages
    FOR INSERT TO authenticated 
    WITH CHECK (author_id::text = jwt_tg_user_id());

-- Редактирование: только свои сообщения
CREATE POLICY "messages_update_own" ON public.messages
    FOR UPDATE TO authenticated 
    USING (author_id::text = jwt_tg_user_id())
    WITH CHECK (author_id::text = jwt_tg_user_id());

-- Удаление: только свои сообщения
CREATE POLICY "messages_delete_own" ON public.messages
    FOR DELETE TO authenticated 
    USING (author_id::text = jwt_tg_user_id());

-- Удаление: админ может удалять любые сообщения
CREATE POLICY "messages_delete_admin" ON public.messages
    FOR DELETE TO authenticated 
    USING (is_admin(jwt_tg_user_id()));

-- ============================================================
-- UNBAN_REQUESTS (ЗАПРОСЫ НА РАЗБАН)
-- ============================================================

ALTER TABLE public.unban_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_unban_requests" ON public.unban_requests;
DROP POLICY IF EXISTS "anon_unban_requests_all" ON public.unban_requests;
DROP POLICY IF EXISTS "unban_select_all" ON public.unban_requests;
DROP POLICY IF EXISTS "unban_insert_own" ON public.unban_requests;
DROP POLICY IF EXISTS "unban_update_own" ON public.unban_requests;
DROP POLICY IF EXISTS "unban_update_admin" ON public.unban_requests;

-- Просмотр: все могут видеть запросы
CREATE POLICY "unban_select_all" ON public.unban_requests
    FOR SELECT TO authenticated USING (true);

-- Создание: авторизованный может создать запрос
CREATE POLICY "unban_insert_own" ON public.unban_requests
    FOR INSERT TO authenticated 
    WITH CHECK (user_id::text = jwt_tg_user_id());

-- Редактирование: только свои запросы (пока на рассмотрении)
CREATE POLICY "unban_update_own" ON public.unban_requests
    FOR UPDATE TO authenticated 
    USING (user_id::text = jwt_tg_user_id() AND status = 'pending')
    WITH CHECK (user_id::text = jwt_tg_user_id() AND status = 'pending');

-- Редактирование: админ может менять статус
CREATE POLICY "unban_update_admin" ON public.unban_requests
    FOR UPDATE TO authenticated 
    USING (is_admin(jwt_tg_user_id()))
    WITH CHECK (is_admin(jwt_tg_user_id()));

-- ============================================================
-- USER_SETTINGS (НАСТРОЙКИ ПОЛЬЗОВАТЕЛЕЙ)
-- ============================================================

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_user_settings" ON public.user_settings;
DROP POLICY IF EXISTS "anon_settings_all" ON public.user_settings;
DROP POLICY IF EXISTS "user_settings_owner_only" ON public.user_settings;
DROP POLICY IF EXISTS "settings_select_own" ON public.user_settings;
DROP POLICY IF EXISTS "settings_insert_own" ON public.user_settings;
DROP POLICY IF EXISTS "settings_update_own" ON public.user_settings;
DROP POLICY IF EXISTS "settings_delete_own" ON public.user_settings;

-- Просмотр: только свои настройки
CREATE POLICY "settings_select_own" ON public.user_settings
    FOR SELECT TO authenticated 
    USING (user_id::text = jwt_tg_user_id());

-- Создание: только свои настройки
CREATE POLICY "settings_insert_own" ON public.user_settings
    FOR INSERT TO authenticated 
    WITH CHECK (user_id::text = jwt_tg_user_id());

-- Редактирование: только свои настройки
CREATE POLICY "settings_update_own" ON public.user_settings
    FOR UPDATE TO authenticated 
    USING (user_id::text = jwt_tg_user_id())
    WITH CHECK (user_id::text = jwt_tg_user_id());

-- Удаление: только свои настройки
CREATE POLICY "settings_delete_own" ON public.user_settings
    FOR DELETE TO authenticated 
    USING (user_id::text = jwt_tg_user_id());

-- ============================================================
-- REPORTS (ЖАЛОБЫ) - только свои для просмотра/редактирования
-- ============================================================

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_reports" ON public.reports;
DROP POLICY IF EXISTS "anon_reports_select" ON public.reports;
DROP POLICY IF EXISTS "anon_reports_insert" ON public.reports;
DROP POLICY IF EXISTS "anon_reports_update" ON public.reports;
DROP POLICY IF EXISTS "reports_select_own" ON public.reports;
DROP POLICY IF EXISTS "reports_select_admin" ON public.reports;
DROP POLICY IF EXISTS "reports_insert_own" ON public.reports;
DROP POLICY IF EXISTS "reports_update_own" ON public.reports;
DROP POLICY IF EXISTS "reports_update_admin" ON public.reports;

-- Просмотр: только свои жалобы
CREATE POLICY "reports_select_own" ON public.reports
    FOR SELECT TO authenticated 
    USING (reporter_id::text = jwt_tg_user_id());

-- Просмотр: админ видит все жалобы
CREATE POLICY "reports_select_admin" ON public.reports
    FOR SELECT TO authenticated 
    USING (is_admin(jwt_tg_user_id()));

-- Создание: авторизованный может создать жалобу
CREATE POLICY "reports_insert_own" ON public.reports
    FOR INSERT TO authenticated 
    WITH CHECK (reporter_id::text = jwt_tg_user_id());

-- Редактирование: только свои жалобы (до обработки)
CREATE POLICY "reports_update_own" ON public.reports
    FOR UPDATE TO authenticated 
    USING (reporter_id::text = jwt_tg_user_id() AND status = 'pending')
    WITH CHECK (reporter_id::text = jwt_tg_user_id() AND status = 'pending');

-- Редактирование: админ может менять статус
CREATE POLICY "reports_update_admin" ON public.reports
    FOR UPDATE TO authenticated 
    USING (is_admin(jwt_tg_user_id()))
    WITH CHECK (is_admin(jwt_tg_user_id()));

-- ============================================================
-- ОСТАЛЬНЫЕ ТАБЛИЦЫ: ПРОСМОТР ДЛЯ ВСЕХ
-- ============================================================

-- DRIVERS (прочие могут только смотреть)
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_drivers" ON public.drivers;
DROP POLICY IF EXISTS "drivers_select_all" ON public.drivers;
DROP POLICY IF EXISTS "drivers_insert_own" ON public.drivers;
DROP POLICY IF EXISTS "drivers_update_own" ON public.drivers;

CREATE POLICY "drivers_select_all" ON public.drivers
    FOR SELECT TO authenticated USING (true);

-- Создание: любой авторизованный может зарегистрироваться как водитель
CREATE POLICY "drivers_insert_own" ON public.drivers
    FOR INSERT TO authenticated 
    WITH CHECK (user_id::text = jwt_tg_user_id());

CREATE POLICY "drivers_update_own" ON public.drivers
    FOR UPDATE TO authenticated 
    USING (user_id::text = jwt_tg_user_id())
    WITH CHECK (user_id::text = jwt_tg_user_id());

-- BANS (только чтение для пользователей, админ управляет через функцию)
ALTER TABLE public.bans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_bans" ON public.bans;
DROP POLICY IF EXISTS "anon_bans_select" ON public.bans;
DROP POLICY IF EXISTS "bans_select_all" ON public.bans;

CREATE POLICY "bans_select_all" ON public.bans
    FOR SELECT TO authenticated USING (true);

-- MARKER_CONFIRMATIONS (подтверждения меток)
ALTER TABLE public.marker_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_marker_confirmations" ON public.marker_confirmations;
DROP POLICY IF EXISTS "marker_conf_select_all" ON public.marker_confirmations;
DROP POLICY IF EXISTS "marker_conf_insert_own" ON public.marker_confirmations;

CREATE POLICY "marker_conf_select_all" ON public.marker_confirmations
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "marker_conf_insert_own" ON public.marker_confirmations
    FOR INSERT TO authenticated 
    WITH CHECK (user_id::text = jwt_tg_user_id());

-- FEEDBACK (обратная связь)
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_feedback" ON public.feedback;
DROP POLICY IF EXISTS "anon_feedback_create" ON public.feedback;
DROP POLICY IF EXISTS "anon_feedback_read" ON public.feedback;
DROP POLICY IF EXISTS "anon_feedback_update" ON public.feedback;
DROP POLICY IF EXISTS "anon_feedback_delete" ON public.feedback;
DROP POLICY IF EXISTS "feedback_select_all" ON public.feedback;
DROP POLICY IF EXISTS "feedback_insert_own" ON public.feedback;

CREATE POLICY "feedback_select_all" ON public.feedback
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "feedback_insert_own" ON public.feedback
    FOR INSERT TO authenticated WITH CHECK (true);

-- USER_ACHIEVEMENTS (достижения)
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_user_achievements" ON public.user_achievements;
DROP POLICY IF EXISTS "achievements_select_all" ON public.user_achievements;

CREATE POLICY "achievements_select_all" ON public.user_achievements
    FOR SELECT TO authenticated USING (true);

-- BETA_INVITES (коды приглашений)
ALTER TABLE public.beta_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_beta_invites" ON public.beta_invites;
DROP POLICY IF EXISTS "anon_beta_invites_select" ON public.beta_invites;
DROP POLICY IF EXISTS "anon_beta_invites_insert" ON public.beta_invites;
DROP POLICY IF EXISTS "anon_beta_invites_update" ON public.beta_invites;
DROP POLICY IF EXISTS "beta_select_all" ON public.beta_invites;
DROP POLICY IF EXISTS "beta_update_admin" ON public.beta_invites;

CREATE POLICY "beta_select_all" ON public.beta_invites
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "beta_update_admin" ON public.beta_invites
    FOR UPDATE TO authenticated 
    USING (is_admin(jwt_tg_user_id()));

-- APP_MAINTENANCE (техническое обслуживание)
ALTER TABLE public.app_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_app_maintenance" ON public.app_maintenance;
DROP POLICY IF EXISTS "anon_app_maintenance_all" ON public.app_maintenance;
DROP POLICY IF EXISTS "maintenance_select_all" ON public.app_maintenance;
DROP POLICY IF EXISTS "maintenance_update_admin" ON public.app_maintenance;

CREATE POLICY "maintenance_select_all" ON public.app_maintenance
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance_update_admin" ON public.app_maintenance
    FOR UPDATE TO authenticated 
    USING (is_admin(jwt_tg_user_id()));

-- ============================================================
-- ФУНКЦИЯ АДМИНИСТРАТОРА
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin(user_id_to_check TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN user_id_to_check IN (
        '5118431735'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

GRANT EXECUTE ON FUNCTION is_admin TO authenticated;

-- ============================================================
-- ОТЗЫВ ПРАВ У ANON (для безопасности)
-- ============================================================

REVOKE ALL ON TABLE public.markers FROM anon;
REVOKE ALL ON TABLE public.messages FROM anon;
REVOKE ALL ON TABLE public.unban_requests FROM anon;
REVOKE ALL ON TABLE public.user_settings FROM anon;
REVOKE ALL ON TABLE public.reports FROM anon;
REVOKE ALL ON TABLE public.drivers FROM anon;
REVOKE ALL ON TABLE public.bans FROM anon;
REVOKE ALL ON TABLE public.marker_confirmations FROM anon;
REVOKE ALL ON TABLE public.feedback FROM anon;
REVOKE ALL ON TABLE public.user_achievements FROM anon;
REVOKE ALL ON TABLE public.beta_invites FROM anon;
REVOKE ALL ON TABLE public.app_maintenance FROM anon;

-- ============================================================
-- ✅ ГОТОВО!
-- ============================================================
-- После запуска этого скрипта:
-- 1. Пользователи (authenticated) могут менять/удалять только свои записи
-- 2. Админ (5118431735) может удалять любые метки и сообщения
-- 3. Остальные могут только смотреть
-- 4. anon ключ больше не имеет доступа (нужна авторизация)
-- ============================================================
