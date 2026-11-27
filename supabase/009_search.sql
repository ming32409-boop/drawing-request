-- =====================================================================
-- 009：申請查詢
--   部門主管查本部門、核發主管與文管查全部（範圍完全沿用 requests 的資料列安全規則，
--   函式用「呼叫者身分」執行，看不到的資料就查不到）。
--   可依關鍵字（單號、品號／名稱、申請人）、狀態、部門篩選，並分頁。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（008 之後）。
-- =====================================================================

create function public.search_requests(
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
    select r.*, a.display_name as applicant_name, d.name as dept_name
    from public.requests r
    join public.profiles a on a.id = r.applicant_id
    left join public.departments d on d.id = r.department_id
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
        'applicant', jsonb_build_object('display_name', p.applicant_name)
      ) order by p.created_at desc, p.doc_no desc)
      from page p), '[]'::jsonb)
  )
$$;

revoke all on function public.search_requests(text, text, smallint, integer, integer) from public, anon;
grant execute on function public.search_requests(text, text, smallint, integer, integer) to authenticated, service_role;
