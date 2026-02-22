-- ============================================================
-- RLS ПОЛИТИКИ: ПОЛЬЗОВАТЕЛИ МОГУТ МЕНЯТЬ/УДАЛЯТЬ ТОЛЬКО СВОИ ЗАПИСИ
-- АДМИН (5118431735) МОЖЕТ ВСЁ
-- ============================================================
-- Запускайте в Supabase SQL Editor после настройки Auth
-- ============================================================

-- ============================================================
-- FIX СХЕМЫ BANS (ошибка: column "updated_at" does not exist)
-- ============================================================

ALTER TABLE public.bans
    ADD COLUMN IF NOT EXISTS banned_by TEXT,
    ADD COLUMN IF NOT EXISTS reason TEXT,
    ADD COLUMN IF NOT EXISTS ban_type TEXT DEFAULT 'temp',
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE public.bans
SET 
    created_at = COALESCE(created_at, NOW()),
    updated_at = COALESCE(updated_at, NOW()),
    ban_type = COALESCE(NULLIF(ban_type, ''), 'temp')
WHERE created_at IS NULL OR updated_at IS NULL OR ban_type IS NULL OR ban_type = '';



CREATE OR REPLACE FUNCTION public.ban_user_admin(
    p_admin_user_id TEXT, -- legacy, не используется
    p_target_user_id TEXT,
    p_banned_until TIMESTAMPTZ,
    p_ban_type TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_target_user_id BIGINT;
    v_admin_id TEXT;
BEGIN
    -- Безопасный search_path
    PERFORM set_config('search_path', 'public, pg_temp', false);
    -- Получаем sub из JWT (Supabase)
    v_admin_id := coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'));
    IF NOT is_admin(v_admin_id) THEN
        RAISE EXCEPTION 'Access denied: admin rights required';
    END IF;

    IF p_ban_type NOT IN ('temp', 'permanent') THEN
        RAISE EXCEPTION 'Invalid ban_type: must be temp or permanent';
    END IF;

    BEGIN
        v_target_user_id := p_target_user_id::BIGINT;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid target user id: expected bigint, got %', p_target_user_id;
    END;

    INSERT INTO public.bans (user_id, banned_until, ban_type, banned_by, reason, created_at, updated_at)
    VALUES (v_target_user_id, p_banned_until, p_ban_type, v_admin_id, p_reason, NOW(), NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
        banned_until = EXCLUDED.banned_until,
        ban_type = EXCLUDED.ban_type,
        banned_by = EXCLUDED.banned_by,
        reason = EXCLUDED.reason,
        updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.ban_user_admin(TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;



CREATE OR REPLACE FUNCTION public.unban_user_admin(
    p_admin_user_id TEXT, -- legacy, не используется
    p_target_user_id TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_target_user_id BIGINT;
    v_admin_id TEXT;
BEGIN
    PERFORM set_config('search_path', 'public, pg_temp', false);
    v_admin_id := coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'));
    IF NOT is_admin(v_admin_id) THEN
        RAISE EXCEPTION 'Access denied: admin rights required';
    END IF;

    BEGIN
        v_target_user_id := p_target_user_id::BIGINT;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Invalid target user id: expected bigint, got %', p_target_user_id;
    END;

    DELETE FROM public.bans WHERE user_id = v_target_user_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.unban_user_admin(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_unban_on_approval()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
        DELETE FROM public.bans WHERE user_id = (NEW.user_id)::BIGINT;
    END IF;
    RETURN NEW;
EXCEPTION WHEN invalid_text_representation THEN
    -- Если user_id в запросе не bigint-совместим, просто не удаляем и не ломаем обновление статуса
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_unban ON public.unban_requests;
CREATE TRIGGER trigger_auto_unban
    BEFORE UPDATE ON public.unban_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_unban_on_approval();

-- ============================================================
-- MARKERS (МЕТКИ)
-- ============================================================

ALTER TABLE public.markers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_markers" ON public.markers;
DROP POLICY IF EXISTS "markers_select_all" ON public.markers;
DROP POLICY IF EXISTS "markers_insert_own" ON public.markers;
DROP POLICY IF EXISTS "markers_update_own" ON public.markers;
DROP POLICY IF EXISTS "markers_update_admin" ON public.markers;
DROP POLICY IF EXISTS "markers_delete_own" ON public.markers;
DROP POLICY IF EXISTS "markers_delete_admin" ON public.markers;

-- Просмотр: все могут видеть все метки
CREATE POLICY "markers_select_all" ON public.markers
    FOR SELECT TO authenticated USING (true);

-- Создание: любой авторизованный может создать метку
CREATE POLICY "markers_insert_own" ON public.markers
    FOR INSERT TO authenticated 
    WITH CHECK (author_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Редактирование: только свои метки
CREATE POLICY "markers_update_own" ON public.markers
    FOR UPDATE TO authenticated 
    USING (author_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')))
    WITH CHECK (author_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Редактирование: админ может менять любые метки (в т.ч. exp для "удаления")
CREATE POLICY "markers_update_admin" ON public.markers
    FOR UPDATE TO authenticated
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))))
    WITH CHECK (true);

-- Удаление: только свои метки
CREATE POLICY "markers_delete_own" ON public.markers
    FOR DELETE TO authenticated 
    USING (author_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Удаление: админ может удалять любые метки
CREATE POLICY "markers_delete_admin" ON public.markers
    FOR DELETE TO authenticated 
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.markers TO authenticated;

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
    WITH CHECK (author_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Редактирование: только свои сообщения
CREATE POLICY "messages_update_own" ON public.messages
    FOR UPDATE TO authenticated 
    USING (author_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')))
    WITH CHECK (author_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Удаление: только свои сообщения
CREATE POLICY "messages_delete_own" ON public.messages
    FOR DELETE TO authenticated 
    USING (author_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Удаление: админ может удалять любые сообщения
CREATE POLICY "messages_delete_admin" ON public.messages
    FOR DELETE TO authenticated 
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

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

-- Просмотр: только админ
CREATE POLICY "unban_select_admin" ON public.unban_requests
    FOR SELECT TO authenticated USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

-- Создание: авторизованный может создать запрос
CREATE POLICY "unban_insert_own" ON public.unban_requests
    FOR INSERT TO authenticated 
    WITH CHECK (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Редактирование: только свои запросы (пока на рассмотрении)
CREATE POLICY "unban_update_own" ON public.unban_requests
    FOR UPDATE TO authenticated 
    USING (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')) AND status = 'pending')
    WITH CHECK (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')) AND status = 'pending');

-- Редактирование: админ может менять статус
CREATE POLICY "unban_update_admin" ON public.unban_requests
    FOR UPDATE TO authenticated 
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))))
    WITH CHECK (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

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
    USING (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Создание: только свои настройки
CREATE POLICY "settings_insert_own" ON public.user_settings
    FOR INSERT TO authenticated 
    WITH CHECK (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Редактирование: только свои настройки
CREATE POLICY "settings_update_own" ON public.user_settings
    FOR UPDATE TO authenticated 
    USING (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')))
    WITH CHECK (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Удаление: только свои настройки
CREATE POLICY "settings_delete_own" ON public.user_settings
    FOR DELETE TO authenticated 
    USING (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

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
    USING (reporter_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Просмотр: админ видит все жалобы
CREATE POLICY "reports_select_admin" ON public.reports
    FOR SELECT TO authenticated 
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

-- Создание: авторизованный может создать жалобу
CREATE POLICY "reports_insert_own" ON public.reports
    FOR INSERT TO authenticated 
    WITH CHECK (reporter_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- Редактирование: только свои жалобы (до обработки)
CREATE POLICY "reports_update_own" ON public.reports
    FOR UPDATE TO authenticated 
    USING (reporter_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')) AND status = 'pending')
    WITH CHECK (reporter_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')) AND status = 'pending');

-- Редактирование: админ может менять статус
CREATE POLICY "reports_update_admin" ON public.reports
    FOR UPDATE TO authenticated 
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))))
    WITH CHECK (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

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

-- Создание: только если user_id = JWT sub
CREATE POLICY "drivers_insert_own" ON public.drivers
    FOR INSERT TO authenticated 
    WITH CHECK (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

CREATE POLICY "drivers_update_own" ON public.drivers
    FOR UPDATE TO authenticated 
    USING (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')))
    WITH CHECK (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

-- BANS (только чтение для пользователей, админ управляет через функцию)
ALTER TABLE public.bans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_bans" ON public.bans;
DROP POLICY IF EXISTS "anon_bans_select" ON public.bans;
DROP POLICY IF EXISTS "bans_select_all" ON public.bans;
DROP POLICY IF EXISTS "bans_delete_admin" ON public.bans;

-- Только админ может читать
CREATE POLICY "bans_select_admin" ON public.bans
    FOR SELECT TO authenticated USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

CREATE POLICY "bans_delete_admin" ON public.bans
    FOR DELETE TO authenticated
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

GRANT SELECT, DELETE ON TABLE public.bans TO authenticated;

-- MARKER_CONFIRMATIONS (подтверждения меток)
ALTER TABLE public.marker_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_marker_confirmations" ON public.marker_confirmations;
DROP POLICY IF EXISTS "marker_conf_select_all" ON public.marker_confirmations;
DROP POLICY IF EXISTS "marker_conf_insert_own" ON public.marker_confirmations;

CREATE POLICY "marker_conf_select_all" ON public.marker_confirmations
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "marker_conf_insert_own" ON public.marker_confirmations
    FOR INSERT TO authenticated 
    WITH CHECK (user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')));

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
DROP POLICY IF EXISTS "beta_insert_admin" ON public.beta_invites;
DROP POLICY IF EXISTS "beta_update_admin" ON public.beta_invites;

-- Только админ может читать
CREATE POLICY "beta_select_admin" ON public.beta_invites
    FOR SELECT TO authenticated USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

CREATE POLICY "beta_insert_admin" ON public.beta_invites
    FOR INSERT TO authenticated
    WITH CHECK (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

CREATE POLICY "beta_update_admin" ON public.beta_invites
    FOR UPDATE TO authenticated 
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

GRANT SELECT, INSERT, UPDATE ON TABLE public.beta_invites TO authenticated;

-- APP_MAINTENANCE (техническое обслуживание)
ALTER TABLE public.app_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_app_maintenance" ON public.app_maintenance;
DROP POLICY IF EXISTS "anon_app_maintenance_all" ON public.app_maintenance;
DROP POLICY IF EXISTS "maintenance_select_all" ON public.app_maintenance;
DROP POLICY IF EXISTS "maintenance_insert_admin" ON public.app_maintenance;
DROP POLICY IF EXISTS "maintenance_update_admin" ON public.app_maintenance;
DROP POLICY IF EXISTS "maintenance_delete_admin" ON public.app_maintenance;

CREATE POLICY "maintenance_select_all" ON public.app_maintenance
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "maintenance_insert_admin" ON public.app_maintenance
    FOR INSERT TO authenticated
    WITH CHECK (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

CREATE POLICY "maintenance_update_admin" ON public.app_maintenance
    FOR UPDATE TO authenticated 
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

CREATE POLICY "maintenance_delete_admin" ON public.app_maintenance
    FOR DELETE TO authenticated
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_maintenance TO authenticated;

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
