-- ============================================================
-- Подписчики Telegram-бота взаимопомощи
-- ============================================================

CREATE TABLE IF NOT EXISTS public.telegram_help_subscribers (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    chat_id TEXT NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    radius_km INTEGER NOT NULL DEFAULT 10,
    home_lat DOUBLE PRECISION,
    home_lon DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_help_subscribers_active ON public.telegram_help_subscribers(is_active);

ALTER TABLE public.telegram_help_subscribers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tg_help_subscribers_select_admin" ON public.telegram_help_subscribers;
CREATE POLICY "tg_help_subscribers_select_admin" ON public.telegram_help_subscribers
    FOR SELECT TO authenticated
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

DROP POLICY IF EXISTS "tg_help_subscribers_insert_own" ON public.telegram_help_subscribers;
CREATE POLICY "tg_help_subscribers_insert_own" ON public.telegram_help_subscribers
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))
        OR is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')))
    );

DROP POLICY IF EXISTS "tg_help_subscribers_update_own" ON public.telegram_help_subscribers;
CREATE POLICY "tg_help_subscribers_update_own" ON public.telegram_help_subscribers
    FOR UPDATE TO authenticated
    USING (
        user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))
        OR is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')))
    )
    WITH CHECK (
        user_id::text = coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))
        OR is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')))
    );

DROP POLICY IF EXISTS "tg_help_subscribers_delete_admin" ON public.telegram_help_subscribers;
CREATE POLICY "tg_help_subscribers_delete_admin" ON public.telegram_help_subscribers
    FOR DELETE TO authenticated
    USING (is_admin(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub'))));

GRANT SELECT, INSERT, UPDATE ON public.telegram_help_subscribers TO authenticated;
GRANT DELETE ON public.telegram_help_subscribers TO authenticated;
