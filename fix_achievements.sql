-- ============================================================
-- ФИКС: Добавление UNIQUE constraint для user_achievements
-- Запускай этот скрипт в Supabase SQL Editor
-- ============================================================

-- 1. Сначала удаляем возможные дубликаты
-- Оставляем только самую раннюю запись для каждой пары (user_id, key)
DELETE FROM public.user_achievements a
USING public.user_achievements b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.key = b.key;

-- 2. Добавляем UNIQUE constraint на пару (user_id, key)
ALTER TABLE public.user_achievements
ADD CONSTRAINT unique_user_achievement UNIQUE (user_id, key);

-- Готово! Теперь нельзя вставить дубликат ачивки для одного пользователя
