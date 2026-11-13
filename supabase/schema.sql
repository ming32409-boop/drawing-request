-- =====================================================================
-- 開發部圖面資料申請表：Supabase 資料庫結構
--
-- 執行方式：在 Supabase Dashboard → SQL Editor 貼上整份檔案後按 Run。
-- 本檔設計給「全新的專案」執行一次；重複執行會因資料表已存在而失敗。
--
-- 安全設計重點：
--   1. 未登入的訪客（anon）沒有任何權限。
--   2. 已登入的使用者（authenticated）只能「讀取」，而且 RLS 只讓他看到該看的資料。
--   3. 新增申請、簽核、撤回、發放，一律透過下方的資料庫函式（RPC）；
--      函式會檢查執行人的角色與案件目前狀態，前端無法直接改資料表。
--   4. 使用者的 LINE User ID 只有後端（service role）讀得到。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. 部門
-- ---------------------------------------------------------------------
create table public.departments (
  id          smallint generated always as identity primary key,
  name        text not null unique
              constraint departments_name_check check (char_length(btrim(name)) between 1 and 30),
  sort_order  smallint not null default 0,
  active      boolean not null default true,
  -- 部門主管（第一關簽核人），由系統管理員設定
  manager_id  uuid,
  created_at  timestamptz not null default now()
);
comment on table public.departments is '部門清單與部門主管設定';


-- ---------------------------------------------------------------------
-- 2. 使用者（LINE 登入後由後端建立）
-- ---------------------------------------------------------------------
create table public.profiles (
  -- 與 Supabase 登入帳號（auth.users）同一個 id
  id            uuid primary key references auth.users (id) on delete cascade,
  -- LINE User ID：只有後端讀得到，前端不開放
  line_user_id  text not null unique
                constraint profiles_line_user_id_check check (line_user_id ~ '^U[0-9a-f]{32}$'),
  display_name  text not null
                constraint profiles_display_name_check check (char_length(btrim(display_name)) between 1 and 50),
  is_admin      boolean not null default false,  -- 系統管理員
  is_issuer     boolean not null default false,  -- 核發主管（第二關）
  is_dcc        boolean not null default false,  -- 文管人員
  active        boolean not null default true,   -- 停用後不能再操作
  created_at    timestamptz not null default now()
);
comment on table public.profiles is '使用者與角色；部門主管另見 departments.manager_id';

alter table public.departments
  add constraint departments_manager_id_fkey
  foreign key (manager_id) references public.profiles (id) on delete set null;


-- ---------------------------------------------------------------------
-- 3. 申請單
-- ---------------------------------------------------------------------
create table public.requests (
  id               uuid primary key default gen_random_uuid(),
  doc_no           text not null unique
                   constraint requests_doc_no_check check (doc_no ~ '^DOC-[0-9]{8}-[0-9]{3,}$'),
  created_at       timestamptz not null default now(),
  applicant_id     uuid not null references public.profiles (id),

  -- 申請人填寫的內容
  department_id    smallint not null references public.departments (id),
  department_other text,
  data_types       text[] not null
                   constraint requests_data_types_check check (
                     cardinality(data_types) between 1 and 4
                     and data_types <@ array['圖面', '材質證明', '測試報告', '樣品']::text[]),
  items            text not null
                   constraint requests_items_check check (char_length(btrim(items)) between 1 and 3000),
  purpose          text not null
                   constraint requests_purpose_check check (purpose in (
                     '提供給客戶', '廠商詢價或發包', '現場組裝或試作',
                     '品管進料或出貨檢驗', '設計參考', '其他')),
  purpose_other    text,
  formats          text[] not null
                   constraint requests_formats_check check (
                     cardinality(formats) between 1 and 6
                     and formats <@ array['2D PDF', '2D DWG或DXF', '3D STEP或STP',
                                          '3D 原始檔', '紙本或實體', '其他']::text[]),
  format_other     text,
  need_date        date,
  external_note    text
                   constraint requests_external_note_check check (char_length(external_note) <= 1000),

  -- 用途為「提供給客戶」或「廠商詢價或發包」時自動標記（重點標記，不加關卡）
  is_external      boolean generated always as (purpose in ('提供給客戶', '廠商詢價或發包')) stored,

  -- 案件狀態
  status           text not null default '申請主管簽核中'
                   constraint requests_status_check check (status in (
                     '申請主管簽核中', '核發主管簽核中', '待文管發放',
                     '已發放結案', '已駁回', '已撤回')),

  -- 第一關：部門主管
  stage1_result    text not null default '待簽核'
                   constraint requests_stage1_result_check check (stage1_result in ('待簽核', '已核准', '已駁回', '免簽')),
  stage1_by        uuid references public.profiles (id),
  stage1_at        timestamptz,
  stage1_reason    text,

  -- 第二關：核發主管
  stage2_result    text not null default '待第一關簽核'
                   constraint requests_stage2_result_check check (stage2_result in ('待第一關簽核', '待簽核', '已核准', '已駁回')),
  stage2_by        uuid references public.profiles (id),
  stage2_at        timestamptz,
  stage2_reason    text,

  -- 文管發放
  delivery_method       text
                        constraint requests_delivery_method_check check (delivery_method in ('Email', '雲端連結', '紙本或實體', '其他')),
  delivery_method_other text,
  delivered_by          uuid references public.profiles (id),
  delivered_at          timestamptz,

  -- 選「其他」時必須填說明；說明文字長度上限
  constraint requests_purpose_other_check check (
    (purpose <> '其他' or char_length(btrim(coalesce(purpose_other, ''))) > 0)
    and char_length(coalesce(purpose_other, '')) <= 100),
  constraint requests_format_other_check check (
    (not ('其他' = any (formats)) or char_length(btrim(coalesce(format_other, ''))) > 0)
    and char_length(coalesce(format_other, '')) <= 100),
  constraint requests_department_other_check check (char_length(coalesce(department_other, '')) <= 100),
  constraint requests_delivery_other_check check (
    (delivery_method is distinct from '其他' or char_length(btrim(coalesce(delivery_method_other, ''))) > 0)
    and char_length(coalesce(delivery_method_other, '')) <= 100),
  -- 已發放結案時必須有發放方式
  constraint requests_delivered_check check (
    status <> '已發放結案' or (delivery_method is not null and delivered_at is not null)),
  -- 駁回時必須有原因
  constraint requests_stage1_reason_check check (
    (stage1_result <> '已駁回' or char_length(btrim(coalesce(stage1_reason, ''))) > 0)
    and char_length(coalesce(stage1_reason, '')) <= 500),
  constraint requests_stage2_reason_check check (
    (stage2_result <> '已駁回' or char_length(btrim(coalesce(stage2_reason, ''))) > 0)
    and char_length(coalesce(stage2_reason, '')) <= 500)
);
comment on table public.requests is '圖面資料申請單';

create index requests_applicant_idx  on public.requests (applicant_id, created_at desc);
create index requests_department_idx on public.requests (department_id, created_at desc);
create index requests_status_idx     on public.requests (status, created_at desc);


-- ---------------------------------------------------------------------
-- 4. 簽核紀錄（只能新增，不能修改或刪除）
-- ---------------------------------------------------------------------
create table public.request_events (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.requests (id),
  action      text not null
              constraint request_events_action_check check (action in ('送出', '核准', '免簽', '駁回', '撤回', '發放')),
  stage       smallint
              constraint request_events_stage_check check (stage in (1, 2, 3)),
  actor_id    uuid not null references public.profiles (id),
  note        text,
  created_at  timestamptz not null default now()
);
create index request_events_request_idx on public.request_events (request_id, id);


-- ---------------------------------------------------------------------
-- 5. LINE 通知待發清單（由後端 Edge Function 讀取並發送）
-- ---------------------------------------------------------------------
create table public.notifications (
  id            bigint generated always as identity primary key,
  request_id    uuid not null references public.requests (id),
  recipient_id  uuid not null references public.profiles (id),
  kind          text not null
                constraint notifications_kind_check check (kind in (
                  '待第一關簽核', '待第二關簽核', '待發放', '已駁回', '已發放')),
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  error         text
);
create index notifications_unsent_idx on public.notifications (id) where sent_at is null;


-- ---------------------------------------------------------------------
-- 6. 單號流水號（每天從 001 開始，以台灣時間計算日期）
-- ---------------------------------------------------------------------
create table public.doc_counters (
  day   date primary key,
  last  integer not null
);


-- =====================================================================
-- 輔助函式：判斷目前登入者的角色
-- =====================================================================
create function public.me_is_active() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select p.active from public.profiles p where p.id = auth.uid()), false) $$;

create function public.me_is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select p.active and p.is_admin from public.profiles p where p.id = auth.uid()), false) $$;

create function public.me_is_issuer() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select p.active and p.is_issuer from public.profiles p where p.id = auth.uid()), false) $$;

create function public.me_is_dcc() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select p.active and p.is_dcc from public.profiles p where p.id = auth.uid()), false) $$;

-- 目前登入者是否為某個部門的主管
create function public.me_manages(p_department_id smallint) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.me_is_active() and exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.manager_id = auth.uid())
$$;

-- 目前登入者能不能看這張申請單
create function public.me_can_view(p_request_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.requests r
    where r.id = p_request_id
      and (r.applicant_id = auth.uid()
           or public.me_manages(r.department_id)
           or public.me_is_issuer()
           or public.me_is_dcc()))
$$;


-- =====================================================================
-- 內部函式：寫入簽核紀錄與通知（只給下方的函式使用）
-- =====================================================================
create function public._log_event(p_request_id uuid, p_action text, p_stage smallint, p_note text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.request_events (request_id, action, stage, actor_id, note)
  values (p_request_id, p_action, p_stage, auth.uid(), p_note)
$$;

create function public._notify(p_request_id uuid, p_recipient uuid, p_kind text)
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (request_id, recipient_id, kind)
  select p_request_id, p.id, p_kind
  from public.profiles p
  where p.id = p_recipient and p.active
$$;

-- 通知所有核發主管
create function public._notify_issuers(p_request_id uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (request_id, recipient_id, kind)
  select p_request_id, p.id, '待第二關簽核'
  from public.profiles p
  where p.active and p.is_issuer
$$;

-- 通知所有文管人員
create function public._notify_dcc(p_request_id uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (request_id, recipient_id, kind)
  select p_request_id, p.id, '待發放'
  from public.profiles p
  where p.active and p.is_dcc
$$;


-- =====================================================================
-- 對外函式（前端用 supabase.rpc 呼叫）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 新增申請：回傳單號
-- 申請人本身是該部門主管時，第一關自動「免簽」，直接送核發主管。
-- ---------------------------------------------------------------------
create function public.submit_request(
  p_department_id    smallint,
  p_department_other text,
  p_data_types       text[],
  p_items            text,
  p_purpose          text,
  p_purpose_other    text,
  p_formats          text[],
  p_format_other     text,
  p_need_date        date,
  p_external_note    text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_dept     public.departments%rowtype;
  v_day      date := (now() at time zone 'Asia/Taipei')::date;
  v_seq      integer;
  v_doc_no   text;
  v_id       uuid;
  v_skip     boolean;
begin
  if not public.me_is_active() then
    raise exception '帳號尚未啟用或已停用' using errcode = '42501';
  end if;

  select * into v_dept from public.departments where id = p_department_id and active;
  if not found then
    raise exception '部門不存在或已停用' using errcode = '22023';
  end if;
  if v_dept.name = '其他' and char_length(btrim(coalesce(p_department_other, ''))) = 0 then
    raise exception '所屬部門選「其他」時必須填寫說明' using errcode = '22023';
  end if;
  if v_dept.manager_id is null then
    raise exception '此部門尚未設定部門主管，請聯絡系統管理員' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_data_types), 0) = 0 then
    raise exception '請至少選擇一種申請資料別' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_formats), 0) = 0 then
    raise exception '請至少選擇一種需求格式' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_items, ''))) = 0 then
    raise exception '請填寫品號／零件名稱／規格' using errcode = '22023';
  end if;
  if p_need_date is not null and p_need_date < v_day then
    raise exception '需要日期不能早於今天' using errcode = '22023';
  end if;

  v_skip := (v_dept.manager_id = auth.uid());

  -- 取得當天流水號（同時送出也不會重複）
  insert into public.doc_counters as c (day, last) values (v_day, 1)
  on conflict (day) do update set last = c.last + 1
  returning last into v_seq;
  v_doc_no := 'DOC-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');

  insert into public.requests (
    doc_no, applicant_id, department_id, department_other, data_types, items,
    purpose, purpose_other, formats, format_other, need_date, external_note,
    status, stage1_result, stage1_by, stage1_at, stage2_result)
  values (
    v_doc_no, auth.uid(), p_department_id,
    nullif(btrim(coalesce(p_department_other, '')), ''),
    (select array_agg(distinct x order by x) from unnest(p_data_types) x),
    btrim(p_items),
    p_purpose, nullif(btrim(coalesce(p_purpose_other, '')), ''),
    (select array_agg(distinct x order by x) from unnest(p_formats) x),
    nullif(btrim(coalesce(p_format_other, '')), ''),
    p_need_date, nullif(btrim(coalesce(p_external_note, '')), ''),
    case when v_skip then '核發主管簽核中' else '申請主管簽核中' end,
    case when v_skip then '免簽' else '待簽核' end,
    case when v_skip then auth.uid() end,
    case when v_skip then now() end,
    case when v_skip then '待簽核' else '待第一關簽核' end)
  returning id into v_id;

  perform public._log_event(v_id, '送出', null, null);
  if v_skip then
    perform public._log_event(v_id, '免簽', 1::smallint, '申請人為部門主管');
    perform public._notify_issuers(v_id);
  else
    perform public._notify(v_id, v_dept.manager_id, '待第一關簽核');
  end if;

  return v_doc_no;
end;
$$;


-- ---------------------------------------------------------------------
-- 簽核：依案件目前狀態判斷是第一關或第二關
-- p_approve = true 核准；false 駁回（必須填 p_reason）
-- ---------------------------------------------------------------------
create function public.review_request(p_request_id uuid, p_approve boolean, p_reason text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r        public.requests%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_approve is null then
    raise exception '請選擇核准或駁回' using errcode = '22023';
  end if;
  if not p_approve and v_reason is null then
    raise exception '駁回時必須填寫原因' using errcode = '22023';
  end if;

  -- 鎖住這張單，避免兩個人同時簽核
  select * into r from public.requests where id = p_request_id for update;
  if not found then
    raise exception '找不到這張申請單' using errcode = '22023';
  end if;

  if r.status = '申請主管簽核中' and r.stage1_result = '待簽核' then
    if not public.me_manages(r.department_id) then
      raise exception '只有該部門主管可以簽核第一關' using errcode = '42501';
    end if;
    if p_approve then
      update public.requests set
        stage1_result = '已核准', stage1_by = auth.uid(), stage1_at = now(),
        stage2_result = '待簽核', status = '核發主管簽核中'
      where id = r.id;
      perform public._log_event(r.id, '核准', 1::smallint, null);
      perform public._notify_issuers(r.id);
    else
      update public.requests set
        stage1_result = '已駁回', stage1_by = auth.uid(), stage1_at = now(),
        stage1_reason = v_reason, status = '已駁回'
      where id = r.id;
      perform public._log_event(r.id, '駁回', 1::smallint, v_reason);
      perform public._notify(r.id, r.applicant_id, '已駁回');
    end if;

  elsif r.status = '核發主管簽核中' and r.stage2_result = '待簽核' then
    if not public.me_is_issuer() then
      raise exception '只有核發主管可以簽核第二關' using errcode = '42501';
    end if;
    if p_approve then
      update public.requests set
        stage2_result = '已核准', stage2_by = auth.uid(), stage2_at = now(),
        status = '待文管發放'
      where id = r.id;
      perform public._log_event(r.id, '核准', 2::smallint, null);
      perform public._notify_dcc(r.id);
    else
      update public.requests set
        stage2_result = '已駁回', stage2_by = auth.uid(), stage2_at = now(),
        stage2_reason = v_reason, status = '已駁回'
      where id = r.id;
      perform public._log_event(r.id, '駁回', 2::smallint, v_reason);
      perform public._notify(r.id, r.applicant_id, '已駁回');
      -- 第一關是部門主管核准的，也通知他（免簽時不重複通知）
      if r.stage1_result = '已核准' and r.stage1_by <> r.applicant_id then
        perform public._notify(r.id, r.stage1_by, '已駁回');
      end if;
    end if;

  else
    raise exception '這張申請單目前狀態為「%」，不能簽核', r.status using errcode = '22023';
  end if;

  return (select status from public.requests where id = r.id);
end;
$$;


-- ---------------------------------------------------------------------
-- 撤回：只有申請人本人，且第一關還沒簽核前
-- ---------------------------------------------------------------------
create function public.withdraw_request(p_request_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests%rowtype;
begin
  select * into r from public.requests where id = p_request_id for update;
  if not found or r.applicant_id <> auth.uid() then
    raise exception '只能撤回自己的申請' using errcode = '42501';
  end if;
  if not (r.status = '申請主管簽核中' and r.stage1_result = '待簽核') then
    raise exception '第一關已簽核，不能撤回' using errcode = '22023';
  end if;

  update public.requests set status = '已撤回' where id = r.id;
  perform public._log_event(r.id, '撤回', null, null);
  return '已撤回';
end;
$$;


-- ---------------------------------------------------------------------
-- 文管發放結案：多位文管同時按，只有第一個成功
-- ---------------------------------------------------------------------
create function public.deliver_request(p_request_id uuid, p_method text, p_method_other text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.requests%rowtype;
begin
  if not public.me_is_dcc() then
    raise exception '只有文管人員可以發放' using errcode = '42501';
  end if;
  if p_method is null or p_method not in ('Email', '雲端連結', '紙本或實體', '其他') then
    raise exception '請選擇發放方式' using errcode = '22023';
  end if;
  if p_method = '其他' and char_length(btrim(coalesce(p_method_other, ''))) = 0 then
    raise exception '發放方式選「其他」時必須填寫說明' using errcode = '22023';
  end if;

  select * into r from public.requests where id = p_request_id for update;
  if not found then
    raise exception '找不到這張申請單' using errcode = '22023';
  end if;
  if r.status <> '待文管發放' then
    raise exception '這張申請單目前狀態為「%」，不能發放', r.status using errcode = '22023';
  end if;

  update public.requests set
    status = '已發放結案',
    delivery_method = p_method,
    delivery_method_other = nullif(btrim(coalesce(p_method_other, '')), ''),
    delivered_by = auth.uid(),
    delivered_at = now()
  where id = r.id;
  perform public._log_event(r.id, '發放', 3::smallint, p_method);
  perform public._notify(r.id, r.applicant_id, '已發放');
  return '已發放結案';
end;
$$;


-- ---------------------------------------------------------------------
-- 統計儀表板：核發主管、文管、系統管理員可以看
-- ---------------------------------------------------------------------
create function public.request_stats()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (public.me_is_issuer() or public.me_is_dcc() or public.me_is_admin()) then
    raise exception '沒有權限查看統計' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total',     (select count(*) from public.requests),
    'in_review', (select count(*) from public.requests where status in ('申請主管簽核中', '核發主管簽核中')),
    'to_issue',  (select count(*) from public.requests where status = '待文管發放'),
    'issued',    (select count(*) from public.requests where status = '已發放結案'),
    'rejected',  (select count(*) from public.requests where status = '已駁回'),
    'withdrawn', (select count(*) from public.requests where status = '已撤回'),
    'by_department', coalesce((
      select jsonb_agg(jsonb_build_object('department', d.name, 'count', x.n) order by x.n desc, d.sort_order)
      from (select department_id, count(*) n from public.requests group by department_id) x
      join public.departments d on d.id = x.department_id), '[]'::jsonb),
    'by_data_type', coalesce((
      select jsonb_agg(jsonb_build_object('data_type', t, 'count', n) order by n desc)
      from (select unnest(data_types) t, count(*) n from public.requests group by 1) y), '[]'::jsonb)
  );
end;
$$;


-- =====================================================================
-- 權限（GRANT）
-- =====================================================================

-- 先收回所有預設權限
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- 已登入的使用者：只能讀取（實際看得到哪些列由 RLS 決定）
grant select on public.departments, public.requests, public.request_events to authenticated;
-- profiles 不開放 line_user_id 欄位
grant select (id, display_name, is_admin, is_issuer, is_dcc, active, created_at)
  on public.profiles to authenticated;

-- 系統管理員維護部門與角色（RLS 會再檢查是不是管理員）
grant insert (name, sort_order, active, manager_id) on public.departments to authenticated;
grant update (name, sort_order, active, manager_id) on public.departments to authenticated;
grant update (is_admin, is_issuer, is_dcc, active)   on public.profiles    to authenticated;

-- notifications、doc_counters 不開放給前端（只有後端與函式使用）

-- 後端（service_role，只在 Edge Functions 使用）需要讀寫所有資料表
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 前端可以呼叫的函式
grant execute on function
  public.me_is_active(), public.me_is_admin(), public.me_is_issuer(), public.me_is_dcc(),
  public.me_manages(smallint), public.me_can_view(uuid),
  public.submit_request(smallint, text, text[], text, text, text, text[], text, date, text),
  public.review_request(uuid, boolean, text),
  public.withdraw_request(uuid),
  public.deliver_request(uuid, text, text),
  public.request_stats()
to authenticated;
-- _log_event、_notify 等內部函式不開放


-- =====================================================================
-- 資料列安全（RLS）
-- =====================================================================
alter table public.departments    enable row level security;
alter table public.profiles       enable row level security;
alter table public.requests       enable row level security;
alter table public.request_events enable row level security;
alter table public.notifications  enable row level security;
alter table public.doc_counters   enable row level security;

-- 部門：登入的人都看得到（申請表要列出部門）；只有管理員能新增、修改
create policy departments_select on public.departments
  for select to authenticated using (true);
create policy departments_insert on public.departments
  for insert to authenticated with check (public.me_is_admin());
create policy departments_update on public.departments
  for update to authenticated using (public.me_is_admin()) with check (public.me_is_admin());

-- 使用者：登入的人看得到名字與角色（顯示簽核人用）；只有管理員能改角色
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update on public.profiles
  for update to authenticated using (public.me_is_admin()) with check (public.me_is_admin());

-- 申請單：本人、該部門主管、核發主管、文管看得到
create policy requests_select on public.requests
  for select to authenticated
  using (applicant_id = auth.uid()
         or public.me_manages(department_id)
         or public.me_is_issuer()
         or public.me_is_dcc());

-- 簽核紀錄：看得到申請單的人才看得到
create policy request_events_select on public.request_events
  for select to authenticated using (public.me_can_view(request_id));

-- notifications、doc_counters 沒有任何政策：前端一律拒絕


-- =====================================================================
-- 初始資料：部門清單（主管在使用者第一次登入後再設定）
-- =====================================================================
insert into public.departments (name, sort_order) values
  ('開發部', 1), ('品管課', 2), ('採購課', 3), ('業務部', 4), ('製造部', 5), ('其他', 99);
