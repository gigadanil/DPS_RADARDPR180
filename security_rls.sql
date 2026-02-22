-- ============================================================
-- SECURITY RLS: Защита от удаления + лимит меток (1 в 2 минуты)
-- Запускайте в Supabase SQL Editor
-- ============================================================

-- MARKERS
ALTER TABLE public.markers ENABLE ROW LEVEL SECURITY;
REVOKE DELETE ON public.markers FROM anon;

DROP POLICY IF EXISTS "anon_markers_select" ON public.markers;
DROP POLICY IF EXISTS "anon_markers_insert" ON public.markers;
DROP POLICY IF EXISTS "anon_markers_update" ON public.markers;

CREATE POLICY "anon_markers_select" ON public.markers
    FOR SELECT TO anon USING (true);

-- Лимит: 1 метка в 2 минуты на author_id (ts хранится в миллисекундах)
CREATE POLICY "anon_markers_insert" ON public.markers
    FOR INSERT TO anon
    WITH CHECK (
        author_id IS NOT NULL
        AND ts IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM public.markers m
            WHERE m.author_id = author_id
              AND m.ts > (EXTRACT(EPOCH FROM NOW()) * 1000 - 120000)
        )
    );

-- Разрешаем обновления (нужно для лайков/дизлайков)
CREATE POLICY "anon_markers_update" ON public.markers
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_markers_author_ts ON public.markers(author_id, ts DESC);

-- MESSAGES
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
REVOKE DELETE ON public.messages FROM anon;

DROP POLICY IF EXISTS "anon_messages_select" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_insert" ON public.messages;
DROP POLICY IF EXISTS "anon_messages_update" ON public.messages;

CREATE POLICY "anon_messages_select" ON public.messages
    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_messages_insert" ON public.messages
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_messages_update" ON public.messages
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- DRIVERS
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
REVOKE DELETE ON public.drivers FROM anon;

DROP POLICY IF EXISTS "anon_drivers_select" ON public.drivers;
DROP POLICY IF EXISTS "anon_drivers_insert" ON public.drivers;
DROP POLICY IF EXISTS "anon_drivers_update" ON public.drivers;

CREATE POLICY "anon_drivers_select" ON public.drivers
    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_drivers_insert" ON public.drivers
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_drivers_update" ON public.drivers
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- BANS (только чтение для клиентов)
ALTER TABLE public.bans ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.bans FROM anon;

DROP POLICY IF EXISTS "anon_bans_select" ON public.bans;
CREATE POLICY "anon_bans_select" ON public.bans
    FOR SELECT TO anon USING (true);

-- MARKER_CONFIRMATIONS
ALTER TABLE public.marker_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE DELETE ON public.marker_confirmations FROM anon;

DROP POLICY IF EXISTS "anon_marker_conf_select" ON public.marker_confirmations;
DROP POLICY IF EXISTS "anon_marker_conf_insert" ON public.marker_confirmations;
DROP POLICY IF EXISTS "anon_marker_conf_update" ON public.marker_confirmations;

CREATE POLICY "anon_marker_conf_select" ON public.marker_confirmations
    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_marker_conf_insert" ON public.marker_confirmations
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_marker_conf_update" ON public.marker_confirmations
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- REPORTS
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
REVOKE DELETE ON public.reports FROM anon;

DROP POLICY IF EXISTS "anon_reports_select" ON public.reports;
DROP POLICY IF EXISTS "anon_reports_insert" ON public.reports;
DROP POLICY IF EXISTS "anon_reports_update" ON public.reports;

CREATE POLICY "anon_reports_select" ON public.reports
    FOR SELECT TO anon USING (true);
CREATE POLICY "anon_reports_insert" ON public.reports
    FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_reports_update" ON public.reports
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- ПРИМЕЧАНИЕ ПО БЕЗОПАСНОСТИ
-- При использовании anon-ключа RLS не может надежно проверить владельца.
-- Для полной защиты используйте Supabase Auth или Edge Functions.
-- ============================================================
