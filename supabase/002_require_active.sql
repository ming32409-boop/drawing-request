-- =====================================================================
-- 002：未啟用的帳號不能讀取部門與其他使用者資料
--
-- 原因：任何人用 LINE 登入都會建立帳號（預設未啟用），
--       未啟用的帳號只應該看得到自己的帳號狀態，不能看到員工名單。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（schema.sql 之後）。
-- =====================================================================

-- 部門：啟用中的使用者才看得到
drop policy departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated using (public.me_is_active());

-- 使用者：自己的資料一定看得到；其他人的名字與角色要啟用中才看得到
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.me_is_active());
