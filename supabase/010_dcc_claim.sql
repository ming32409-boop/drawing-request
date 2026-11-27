-- =====================================================================
-- 010：文管認領
--   文管按「我來處理」認領一張待發放的申請，其他文管與申請人會看到「某某 備檔中」，
--   避免多位文管同時準備同一張。認領與取消都會記在簽核紀錄。
--   認領不是發放的必要條件：認領的人請假時，其他文管仍然可以直接發放（畫面會先提醒）。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（009 之後）。
-- =====================================================================

alter table public.requests
  add column claimed_by uuid references public.profiles (id),
  add column claimed_at timestamptz;
comment on column public.requests.claimed_by is '認領這張申請、正在備檔的文管';

alter table public.request_events drop constraint request_events_action_check;
alter table public.request_events add constraint request_events_action_check
  check (action in ('送出', '核准', '免簽', '駁回', '撤回', '發放', '認領', '取消認領'));

-- p_claim = true：認領；false：取消認領（只有認領的本人可以取消）
create function public.claim_request(p_request_id uuid, p_claim boolean default true)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r      public.requests%rowtype;
  v_name text;
begin
  if not public.me_is_dcc() then
    raise exception '只有文管人員可以認領' using errcode = '42501';
  end if;
  select * into r from public.requests where id = p_request_id for update;
  if not found then
    raise exception '找不到這張申請單' using errcode = '22023';
  end if;
  if r.status <> '待文管發放' then
    raise exception '這張申請單目前狀態為「%」，不能認領', r.status using errcode = '22023';
  end if;

  if coalesce(p_claim, true) then
    if r.claimed_by = auth.uid() then
      return '已認領';
    end if;
    if r.claimed_by is not null then
      select display_name into v_name from public.profiles where id = r.claimed_by;
      raise exception '這張申請已由 % 認領', coalesce(v_name, '其他文管') using errcode = '22023';
    end if;
    update public.requests set claimed_by = auth.uid(), claimed_at = now() where id = r.id;
    perform public._log_event(r.id, '認領', 3::smallint, null);
    return '已認領';
  end if;

  if r.claimed_by is distinct from auth.uid() then
    raise exception '只有認領的人可以取消認領' using errcode = '22023';
  end if;
  update public.requests set claimed_by = null, claimed_at = null where id = r.id;
  perform public._log_event(r.id, '取消認領', 3::smallint, null);
  return '已取消認領';
end;
$$;

revoke all on function public.claim_request(uuid, boolean) from public, anon;
grant execute on function public.claim_request(uuid, boolean) to authenticated, service_role;

-- 申請查詢也帶出認領人（參數與回傳型別不變，直接替換）
create or replace function public.search_requests(
  p_q             text     default null,   -- 關鍵字：單號、品號／名稱、申請人名字（部分符合即可）
  p_status        text     default null,   -- 空白＝全部；「進行中」＝三個簽核／發放中的狀態；其他＝該狀態
  p_department_id smallint default null,
  p_limit         integer  default 30,
  p_offset        integer  default 0
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with args as (
    select
      -- % 與 _ 當一般文字，不當萬用字元
      nullif(replace(replace(replace(btrim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_'), '') as q,
      nullif(btrim(coalesce(p_status, '')), '') as st,
      greatest(1, least(coalesce(p_limit, 30), 100)) as lim,
      greatest(0, coalesce(p_offset, 0)) as off
  ), base as (
    select r.*, a.display_name as applicant_name, d.name as dept_name, cp.display_name as claimed_name
    from public.requests r
    join public.profiles a on a.id = r.applicant_id
    left join public.departments d on d.id = r.department_id
    left join public.profiles cp on cp.id = r.claimed_by
    cross join args
    where (args.st is null
           or (args.st = '進行中' and r.status in ('申請主管簽核中', '核發主管簽核中', '待文管發放'))
           or r.status = args.st)
      and (p_department_id is null or r.department_id = p_department_id)
      and (args.q is null
           or r.doc_no ilike '%' || args.q || '%'
           or r.items ilike '%' || args.q || '%'
           or a.display_name ilike '%' || args.q || '%')
  ), page as (
    select b.* from base b, args order by b.created_at desc, b.doc_no desc limit (select lim from args) offset (select off from args)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'doc_no', p.doc_no, 'created_at', p.created_at, 'status', p.status, 'is_external', p.is_external,
        'department_id', p.department_id, 'department_other', p.department_other,
        'data_types', p.data_types, 'items', p.items, 'purpose', p.purpose, 'purpose_other', p.purpose_other,
        'formats', p.formats, 'format_other', p.format_other, 'need_date', p.need_date, 'external_note', p.external_note,
        'stage1_result', p.stage1_result, 'stage1_reason', p.stage1_reason,
        'stage2_result', p.stage2_result, 'stage2_reason', p.stage2_reason,
        'delivery_method', p.delivery_method, 'delivery_method_other', p.delivery_method_other,
        'delivery_note', p.delivery_note, 'delivered_at', p.delivered_at,
        'department', jsonb_build_object('name', p.dept_name),
        'applicant', jsonb_build_object('display_name', p.applicant_name),
        'claimed_at', p.claimed_at,
        'claimed_by_profile', case when p.claimed_by is null then null else jsonb_build_object('display_name', p.claimed_name) end
      ) order by p.created_at desc, p.doc_no desc)
      from page p), '[]'::jsonb)
  )
$$;

