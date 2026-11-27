-- =====================================================================
-- 008：管理設定頁需要的安全檢查與通知
--   管理設定頁直接修改 profiles（啟用、角色）與 departments（部門、部門主管），
--   權限在 schema.sql 已經只開放給系統管理員；這裡再加上幾個「防呆」規則：
--   1. 至少要保留一位已啟用的系統管理員（避免把自己或最後一位管理員拿掉，系統就沒人能管理）。
--   2. 部門主管必須是已啟用的帳號。
--   3. 停用帳號前，如果他還是某個部門的主管，要先換人（不然那個部門的申請沒人能簽核）。
--   4. 帳號被啟用時，用 LINE 通知本人「可以開始使用了」。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（007 之後）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 + 3. 修改帳號時的檢查
-- ---------------------------------------------------------------------
create function public._guard_profile_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_depts text;
begin
  -- 拿掉管理員身分或停用管理員時，必須還有別的已啟用管理員
  if old.is_admin and old.active and not (new.is_admin and new.active) then
    perform 1 from public.profiles p where p.is_admin and p.active for update;   -- 避免兩人同時互相拿掉
    if not exists (select 1 from public.profiles p where p.id <> old.id and p.is_admin and p.active) then
      raise exception '至少要保留一位已啟用的系統管理員' using errcode = '22023';
    end if;
  end if;
  -- 停用部門主管前要先換人
  if old.active and not new.active then
    select string_agg(d.name, '、' order by d.sort_order, d.id) into v_depts
    from public.departments d where d.manager_id = old.id and d.active;
    if v_depts is not null then
      raise exception '這個帳號是「%」的部門主管，請先更換部門主管再停用', v_depts using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._guard_profile_update() from public, anon, authenticated;

create trigger profiles_guard_update
  before update of is_admin, active on public.profiles
  for each row execute function public._guard_profile_update();

-- ---------------------------------------------------------------------
-- 2. 部門主管必須是已啟用的帳號
-- ---------------------------------------------------------------------
create function public._guard_department_manager()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.manager_id is not null
     and not exists (select 1 from public.profiles p where p.id = new.manager_id and p.active) then
    raise exception '部門主管必須是已啟用的帳號' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public._guard_department_manager() from public, anon, authenticated;

create trigger departments_guard_manager
  before insert or update of manager_id on public.departments
  for each row execute function public._guard_department_manager();

-- ---------------------------------------------------------------------
-- 4. 帳號啟用時通知本人
-- ---------------------------------------------------------------------
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  '待第一關簽核', '待第二關簽核', '待發放', '已駁回', '已發放', '新帳號待啟用', '帳號已開通'));
alter table public.notifications drop constraint notifications_target_check;
alter table public.notifications add constraint notifications_target_check check (
  (kind in ('新帳號待啟用', '帳號已開通') and subject_id is not null)
  or (kind not in ('新帳號待啟用', '帳號已開通') and request_id is not null));

create function public._notify_account_activated()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.notifications (recipient_id, subject_id, kind) values (new.id, new.id, '帳號已開通');
  return new;
end;
$$;
revoke all on function public._notify_account_activated() from public, anon, authenticated;

create trigger profiles_notify_activated
  after update of active on public.profiles
  for each row when (not old.active and new.active)
  execute function public._notify_account_activated();
