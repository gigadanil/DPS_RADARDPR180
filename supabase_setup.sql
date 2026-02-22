-- ============================================================
-- ANON-РЕЖИМ: ПОЛНЫЙ ДОСТУП КО ВСЕМ ТАБЛИЦАМ
-- ============================================================

ALTER TABLE IF EXISTS public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.marker_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.unban_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.beta_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_maintenance ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.drivers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.markers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marker_confirmations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reports TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.feedback TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.unban_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_achievements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_settings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.beta_invites TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_maintenance TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

DROP POLICY IF EXISTS "anon_all_drivers" ON public.drivers;
CREATE POLICY "anon_all_drivers" ON public.drivers
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_markers" ON public.markers;
CREATE POLICY "anon_all_markers" ON public.markers
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_messages" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_select" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_insert" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_update" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_delete" ON public.messages;
DROP POLICY IF EXISTS "auth_messages_delete_own" ON public.messages;
DROP POLICY IF EXISTS "auth_messages_delete_admin" ON public.messages;
CREATE POLICY "anon_messages_select" ON public.messages
    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_messages_insert" ON public.messages
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_messages_update" ON public.messages
    FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_messages_delete" ON public.messages
    FOR DELETE TO anon USING (true);
CREATE POLICY "auth_messages_delete_own" ON public.messages
    FOR DELETE TO authenticated
    USING (author_id::text = auth.uid()::text);
CREATE POLICY "auth_messages_delete_admin" ON public.messages
    FOR DELETE TO authenticated
    USING (is_admin(auth.uid()::text));

DROP POLICY IF EXISTS "anon_all_bans" ON public.bans;
CREATE POLICY "anon_all_bans" ON public.bans
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_marker_confirmations" ON public.marker_confirmations;
CREATE POLICY "anon_all_marker_confirmations" ON public.marker_confirmations
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_reports" ON public.reports;
CREATE POLICY "anon_all_reports" ON public.reports
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_feedback" ON public.feedback;
CREATE POLICY "anon_all_feedback" ON public.feedback
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_unban_requests" ON public.unban_requests;
CREATE POLICY "anon_all_unban_requests" ON public.unban_requests
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_user_achievements" ON public.user_achievements;
CREATE POLICY "anon_all_user_achievements" ON public.user_achievements
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_user_settings" ON public.user_settings;
CREATE POLICY "anon_all_user_settings" ON public.user_settings
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_beta_invites" ON public.beta_invites;
CREATE POLICY "anon_all_beta_invites" ON public.beta_invites
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_app_maintenance" ON public.app_maintenance;
CREATE POLICY "anon_all_app_maintenance" ON public.app_maintenance
    FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- RLS ПОЛИТИКИ ДЛЯ FEEDBACK
-- ============================================================

DROP POLICY IF EXISTS "anon_feedback_create" ON public.feedback;
DROP POLICY IF EXISTS "anon_feedback_read" ON public.feedback;
DROP POLICY IF EXISTS "anon_feedback_update" ON public.feedback;
DROP POLICY IF EXISTS "anon_feedback_delete" ON public.feedback;

CREATE POLICY "anon_feedback_create" ON public.feedback
    FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_feedback_read" ON public.feedback
    FOR SELECT TO anon USING (true);

CREATE POLICY "anon_feedback_update" ON public.feedback
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_feedback_delete" ON public.feedback
    FOR DELETE TO anon USING (true);

-- ============================================================
-- RLS ПОЛИТИКИ ДЛЯ UNBAN_REQUESTS ⭐
-- ============================================================

DROP POLICY IF EXISTS "anon_unban_requests_all" ON public.unban_requests;

CREATE POLICY "anon_unban_requests_all" ON public.unban_requests
    FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- RLS ПОЛИТИКИ ДЛЯ USER_SETTINGS
-- ============================================================

DROP POLICY IF EXISTS "anon_settings_all" ON public.user_settings;
DROP POLICY IF EXISTS "user_settings_owner_only" ON public.user_settings;

-- ============================================================
-- RLS ПОЛИТИКИ ДЛЯ BETA_INVITES
-- ============================================================

DROP POLICY IF EXISTS "anon_beta_invites_select" ON public.beta_invites;
DROP POLICY IF EXISTS "anon_beta_invites_update" ON public.beta_invites;
DROP POLICY IF EXISTS "anon_beta_invites_insert" ON public.beta_invites;

-- SELECT: любой может видеть активные коды
CREATE POLICY "anon_beta_invites_select" ON public.beta_invites
    FOR SELECT TO anon USING (true);

-- INSERT: админ может создавать новые коды
CREATE POLICY "anon_beta_invites_insert" ON public.beta_invites
    FOR INSERT TO anon WITH CHECK (true);

-- UPDATE: админ может обновлять коды (отмечать использованными или деактивировать)
CREATE POLICY "anon_beta_invites_update" ON public.beta_invites
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- RLS ПОЛИТИКИ ДЛЯ APP_MAINTENANCE (Техническое обслуживание)
-- ============================================================

DROP POLICY IF EXISTS "anon_app_maintenance_all" ON public.app_maintenance;

CREATE POLICY "anon_app_maintenance_all" ON public.app_maintenance
    FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- ФУНКЦИЯ АДМИНИСТРАТОРА - ПРОВЕРКА
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin(user_id_to_check TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN user_id_to_check IN (
        '5118431735'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

GRANT EXECUTE ON FUNCTION is_admin TO anon;

-- ============================================================
-- ФУНКЦИЯ ПРОВЕРКИ ВАЛИДНОСТИ КОДА ПРИГЛАШЕНИЯ
-- ============================================================

CREATE OR REPLACE FUNCTION validate_beta_invite(p_code TEXT)
RETURNS TABLE (is_valid BOOLEAN, message TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN inv.id IS NULL THEN FALSE
            WHEN inv.is_active = FALSE THEN FALSE
            WHEN inv.current_uses >= inv.max_uses THEN FALSE
            ELSE TRUE
        END AS is_valid,
        CASE
            WHEN inv.id IS NULL THEN 'Код не найден'::TEXT
            WHEN inv.is_active = FALSE THEN 'Код деактивирован'::TEXT
            WHEN inv.current_uses >= inv.max_uses THEN 'Код использован'::TEXT
            ELSE 'OK'::TEXT
        END AS message
    FROM public.beta_invites inv
    WHERE inv.code = p_code;
    
    -- Если ничего не найдено, возвращаем несоответствие по умолчанию
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Код не найден'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION validate_beta_invite TO anon;

-- ============================================================
-- ФУНКЦИЯ ИСПОЛЬЗОВАНИЯ КОДА ПРИГЛАШЕНИЯ
-- ============================================================

CREATE OR REPLACE FUNCTION claim_beta_invite(p_code TEXT, p_user_id TEXT)
RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
DECLARE
    v_invite_id BIGINT;
    v_current_uses INTEGER;
    v_max_uses INTEGER;
BEGIN
    -- Проверяем существование и валидность кода
    SELECT id, current_uses, max_uses INTO v_invite_id, v_current_uses, v_max_uses
    FROM public.beta_invites
    WHERE code = p_code AND is_active = TRUE;
    
    IF v_invite_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Код не найден или деактивирован'::TEXT;
        RETURN;
    END IF;
    
    IF v_current_uses >= v_max_uses THEN
        RETURN QUERY SELECT FALSE, 'Код использован'::TEXT;
        RETURN;
    END IF;
    
    -- Отмечаем код как использованный
    UPDATE public.beta_invites
    SET 
        used_by = p_user_id,
        used_at = NOW(),
        current_uses = current_uses + 1
    WHERE id = v_invite_id;
    
    RETURN QUERY SELECT TRUE, 'Доступ предоставлен'::TEXT;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION claim_beta_invite TO anon;

-- ============================================================
-- АВТОМАТИЧЕСКИЙ РАЗБАН ПРИ ОДОБРЕНИИ
-- ============================================================

CREATE OR REPLACE FUNCTION auto_unban_on_approval()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
        DELETE FROM public.bans WHERE user_id = (NEW.user_id)::BIGINT;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_unban ON public.unban_requests;

CREATE TRIGGER trigger_auto_unban
    BEFORE UPDATE ON public.unban_requests
    FOR EACH ROW
    EXECUTE FUNCTION auto_unban_on_approval();

-- ============================================================
-- ФУНКЦИЯ ОЧИСТКИ ИСТЕКШИХ БАНОВ
-- ============================================================

CREATE OR REPLACE FUNCTION cleanup_expired_bans()
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    DELETE FROM public.bans
    WHERE banned_until < NOW()
      AND ban_type = 'temp';
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION cleanup_expired_bans TO anon;

-- ============================================================
-- ФУНКЦИЯ АДМИНИСТРАТОРА - БАН ПОЛЬЗОВАТЕЛЯ
-- ============================================================

CREATE OR REPLACE FUNCTION ban_user_admin(
    p_admin_user_id TEXT,
    p_target_user_id TEXT,
    p_banned_until TIMESTAMPTZ,
    p_ban_type TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    IF NOT is_admin(p_admin_user_id) THEN
        RAISE EXCEPTION 'Access denied: admin rights required';
    END IF;
    
    IF p_ban_type NOT IN ('temp', 'permanent') THEN
        RAISE EXCEPTION 'Invalid ban_type: must be temp or permanent';
    END IF;
    
    INSERT INTO public.bans (user_id, banned_until, ban_type, banned_by, reason, created_at, updated_at)
    VALUES (p_target_user_id, p_banned_until, p_ban_type, p_admin_user_id, p_reason, NOW(), NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
        banned_until = p_banned_until,
        ban_type = p_ban_type,
        banned_by = p_admin_user_id,
        reason = p_reason,
        updated_at = NOW();
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION ban_user_admin TO anon;


-- ============================================================
-- АНТИ-СПАМ: 1 МЕТКА В 2 МИНУТЫ
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_marker_rate_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_last_ts_type TEXT;
    v_last_ts_bigint BIGINT;
    v_last_ts_time TIMESTAMPTZ;
    v_now_ms BIGINT;
BEGIN
    SELECT pg_typeof(ts)::text INTO v_last_ts_type
    FROM public.markers
    WHERE author_id = NEW.author_id AND ts IS NOT NULL
    ORDER BY ts DESC
    LIMIT 1;

    IF v_last_ts_type IS NULL THEN
        RETURN NEW;
    END IF;

    IF v_last_ts_type IN ('bigint', 'integer', 'numeric') THEN
        SELECT MAX(ts)::bigint INTO v_last_ts_bigint
        FROM public.markers
        WHERE author_id = NEW.author_id AND ts IS NOT NULL;

        v_now_ms := (extract(epoch from now()) * 1000)::bigint;
        IF (v_now_ms - v_last_ts_bigint) < 120000 THEN
            RAISE EXCEPTION 'rate limit: 1 marker per 2 minutes';
        END IF;
    ELSE
        SELECT MAX(ts)::timestamptz INTO v_last_ts_time
        FROM public.markers
        WHERE author_id = NEW.author_id AND ts IS NOT NULL;

        IF (now() - v_last_ts_time) < interval '2 minutes' THEN
            RAISE EXCEPTION 'rate limit: 1 marker per 2 minutes';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_marker_rate_limit ON public.markers;
CREATE TRIGGER trigger_marker_rate_limit
    BEFORE INSERT ON public.markers
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_marker_rate_limit();

-- ============================================================
-- ✅ ПРОВЕРКА - ТАБЛИЦЫ СОЗДАНЫ
-- ============================================================

SELECT 
    'user_settings' as table_name,
    COUNT(*) as row_count
FROM public.user_settings
UNION ALL
SELECT 'feedback', COUNT(*) FROM public.feedback
UNION ALL
SELECT 'unban_requests', COUNT(*) FROM public.unban_requests;

-- ✅ ГОТОВО! Теперь приложение может:
-- ✓ Создавать запросы на разбан
-- ✓ Сохранять обратную связь
-- ✓ Хранить настройки пользователя
-- ✓ Автоматически разбанить при одобрении

-- ============================================================
-- ТЕСТОВЫЕ КОДЫ ПРИГЛАШЕНИЙ (созданы автоматически)
-- Выполните эти INSERT в Supabase SQL Editor, если хотите добавить тестовых пользователей
-- ============================================================

INSERT INTO public.beta_invites (code, created_by, max_uses, current_uses, description) VALUES
('BZ7K9P', '5118431735', 1, 0, 'Тестовый код 1'),
('H4T9XM', '5118431735', 1, 0, 'Тестовый код 2'),
('Q8W2ER', '5118431735', 2, 0, 'Тестовый код 3 (2 uses)'),
('M5N6LK', '5118431735', 5, 0, 'Тестовый код 4 (5 uses)'),
('Z3X1CV', '5118431735', 1, 0, 'Тестовый код 5')
ON CONFLICT (code) DO NOTHING;

-- После выполнения вы можете просмотреть таблицу:
-- SELECT * FROM public.beta_invites ORDER BY created_at DESC LIMIT 20;
