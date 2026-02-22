-- ============================================================
-- SECURITY HARDENING + RATE LIMIT
-- Run in Supabase SQL Editor for existing DB
-- ============================================================

-- RLS hardening and delete protection
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'markers') THEN
        ALTER TABLE public.markers ENABLE ROW LEVEL SECURITY;
        REVOKE DELETE ON TABLE public.markers FROM anon;
        GRANT SELECT, INSERT, UPDATE ON TABLE public.markers TO anon;
        DROP POLICY IF EXISTS "anon_markers_select" ON public.markers;
        DROP POLICY IF EXISTS "anon_markers_insert" ON public.markers;
        DROP POLICY IF EXISTS "anon_markers_update" ON public.markers;
        DROP POLICY IF EXISTS "anon_markers_delete" ON public.markers;
        CREATE POLICY "anon_markers_select" ON public.markers FOR SELECT TO anon USING (true);
        CREATE POLICY "anon_markers_insert" ON public.markers FOR INSERT TO anon WITH CHECK (true);
        CREATE POLICY "anon_markers_update" ON public.markers FOR UPDATE TO anon USING (true) WITH CHECK (true);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
        ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
        REVOKE DELETE ON TABLE public.messages FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reports') THEN
        ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
        REVOKE DELETE ON TABLE public.reports FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feedback') THEN
        ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
        REVOKE DELETE ON TABLE public.feedback FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_achievements') THEN
        ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
        REVOKE DELETE ON TABLE public.user_achievements FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'unban_requests') THEN
        ALTER TABLE public.unban_requests ENABLE ROW LEVEL SECURITY;
        REVOKE DELETE ON TABLE public.unban_requests FROM anon;
    END IF;
END $$;

-- Anti-spam: 1 marker per 2 minutes
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
