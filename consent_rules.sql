-- ============================================================
-- ЛОГ СОГЛАСИЯ С ПРАВИЛАМИ (SERVER-SIDE)
-- Выполните в Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_consents (
    user_id TEXT NOT NULL,
    consent_key TEXT NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, consent_key)
);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consents_select_own" ON public.user_consents;
DROP POLICY IF EXISTS "consents_insert_own" ON public.user_consents;
DROP POLICY IF EXISTS "consents_update_own" ON public.user_consents;
DROP POLICY IF EXISTS "consents_select_admin" ON public.user_consents;

CREATE POLICY "consents_select_own" ON public.user_consents
    FOR SELECT TO authenticated
    USING (
        user_id::text = coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')
        )
    );

CREATE POLICY "consents_insert_own" ON public.user_consents
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id::text = coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')
        )
    );

CREATE POLICY "consents_update_own" ON public.user_consents
    FOR UPDATE TO authenticated
    USING (
        user_id::text = coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')
        )
    )
    WITH CHECK (
        user_id::text = coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')
        )
    );

CREATE POLICY "consents_select_admin" ON public.user_consents
    FOR SELECT TO authenticated
    USING (
        is_admin(
            coalesce(
                current_setting('request.jwt.claim.sub', true),
                (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')
            )
        )
    );

GRANT SELECT, INSERT, UPDATE ON TABLE public.user_consents TO authenticated;
REVOKE ALL ON TABLE public.user_consents FROM anon;

-- ============================================================
-- ✅ Готово
-- Таблица хранит подтверждение правил по user_id + consent_key
-- ============================================================
