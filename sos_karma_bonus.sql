-- ============================================================
-- SOS КАРМА: +50 очков за подтверждённую помощь
-- Запустите в Supabase SQL Editor после основных RLS-скриптов
-- ============================================================

-- Таблица начислений (одно начисление на helper + marker)
CREATE TABLE IF NOT EXISTS public.sos_help_rewards (
    id BIGSERIAL PRIMARY KEY,
    marker_id BIGINT NOT NULL REFERENCES public.markers(id) ON DELETE CASCADE,
    helper_id TEXT NOT NULL,
    marker_author_id TEXT,
    bonus_points INTEGER NOT NULL DEFAULT 50,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sos_help_rewards_unique UNIQUE (marker_id, helper_id)
);

CREATE INDEX IF NOT EXISTS idx_sos_help_rewards_helper_id ON public.sos_help_rewards(helper_id);
CREATE INDEX IF NOT EXISTS idx_sos_help_rewards_marker_id ON public.sos_help_rewards(marker_id);

ALTER TABLE public.sos_help_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sos_rewards_select_all" ON public.sos_help_rewards;
CREATE POLICY "sos_rewards_select_all" ON public.sos_help_rewards
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sos_rewards_select_admin_anon" ON public.sos_help_rewards;
CREATE POLICY "sos_rewards_select_admin_anon" ON public.sos_help_rewards
    FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "sos_rewards_insert_own" ON public.sos_help_rewards;
CREATE POLICY "sos_rewards_insert_own" ON public.sos_help_rewards
    FOR INSERT TO authenticated
    WITH CHECK (
        helper_id = coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')
        )
    );

REVOKE UPDATE, DELETE ON public.sos_help_rewards FROM anon, authenticated;
GRANT SELECT ON public.sos_help_rewards TO anon, authenticated;
GRANT INSERT ON public.sos_help_rewards TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.sos_help_rewards_id_seq TO authenticated;

-- Безопасная функция начисления +50 за SOS-помощь
CREATE OR REPLACE FUNCTION public.claim_sos_help_bonus(p_marker_id BIGINT)
RETURNS TABLE(granted BOOLEAN, points INTEGER, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid TEXT;
    v_marker_type TEXT;
    v_marker_author TEXT;
    v_has_stay BOOLEAN;
BEGIN
    v_uid := coalesce(
        current_setting('request.jwt.claim.sub', true),
        (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')
    );

    IF v_uid IS NULL OR v_uid = '' THEN
        RETURN QUERY SELECT FALSE, 0, 'Пользователь не авторизован'::TEXT;
        RETURN;
    END IF;

    SELECT m.type, m.author_id::TEXT
      INTO v_marker_type, v_marker_author
    FROM public.markers m
    WHERE m.id = p_marker_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 'Метка не найдена'::TEXT;
        RETURN;
    END IF;

    IF v_marker_type <> 'sos' THEN
        RETURN QUERY SELECT FALSE, 0, 'Бонус начисляется только для SOS-меток'::TEXT;
        RETURN;
    END IF;

    IF v_marker_author = v_uid THEN
        RETURN QUERY SELECT FALSE, 0, 'Нельзя начислить бонус за свою SOS-метку'::TEXT;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.marker_confirmations mc
        WHERE mc.marker_id = p_marker_id
          AND mc.user_id::TEXT = v_uid
          AND mc.status = 'stay'
    ) INTO v_has_stay;

    IF NOT v_has_stay THEN
        RETURN QUERY SELECT FALSE, 0, 'Сначала подтвердите SOS-метку как актуальную'::TEXT;
        RETURN;
    END IF;

    INSERT INTO public.sos_help_rewards (marker_id, helper_id, marker_author_id, bonus_points)
    VALUES (p_marker_id, v_uid, v_marker_author, 50)
    ON CONFLICT (marker_id, helper_id) DO NOTHING;

    IF FOUND THEN
        RETURN QUERY SELECT TRUE, 50, 'Начислено +50 очков кармы за SOS-помощь'::TEXT;
    ELSE
        RETURN QUERY SELECT FALSE, 0, 'Бонус за эту SOS-метку уже начислен'::TEXT;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sos_help_bonus(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_sos_help_bonus(BIGINT) TO authenticated;

-- Утилита: сумма бонусов кармы пользователя
CREATE OR REPLACE FUNCTION public.get_user_sos_bonus(p_user_id TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(SUM(bonus_points), 0)::INTEGER
    FROM public.sos_help_rewards
    WHERE helper_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_user_sos_bonus(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_sos_bonus(TEXT) TO anon, authenticated;
