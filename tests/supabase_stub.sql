-- 測試用：模擬 Supabase 的角色、auth schema 與預設權限
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- 模擬本專案的設定：新資料表「不自動開放」給任何角色（包含 service_role）。
-- 函式的 EXECUTE 預設仍開放給 PUBLIC（PostgreSQL 預設行為），schema.sql 會收回。
