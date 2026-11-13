-- =====================================================================
-- 003：開放權限給後端（service_role）
--
-- 原因：本專案設定為「新資料表不自動開放」，這個設定連後端專用的
--       service_role 也包含在內。後端 Edge Functions（LINE 登入、
--       LINE 通知）需要讀寫 profiles、notifications 等資料表。
-- service_role 只在 Supabase 後端使用（secret key），前端拿不到。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（002 之後）。可重複執行。
-- =====================================================================

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 之後新增的資料表、序列、函式也自動開放給後端
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
