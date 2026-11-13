-- =====================================================================
-- 005：管理看板
--
--   dashboard_data(起日, 迄日)    → 看板需要的全部統計（JSON）
--   export_requests(起日, 迄日)   → 明細，給「匯出 Excel」使用
--
-- 只有核發主管、文管、系統管理員可以呼叫（函式內檢查）。
-- 日期以台灣時間的「申請日期」計算，起迄日都包含在內；傳 null 代表不限制。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（004 之後）。
-- =====================================================================

create function public._can_view_dashboard() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.me_is_issuer() or public.me_is_dcc() or public.me_is_admin() $$;

create function public.dashboard_data(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public._can_view_dashboard() then
    raise exception '沒有權限查看管理看板' using errcode = '42501';
  end if;

  with base as (
    select r.*,
           (r.created_at at time zone 'Asia/Taipei')::date as day,
           d.name as department_name
    from public.requests r
    left join public.departments d on d.id = r.department_id
    where (p_from is null or (r.created_at at time zone 'Asia/Taipei')::date >= p_from)
      and (p_to   is null or (r.created_at at time zone 'Asia/Taipei')::date <= p_to)
  ),
  -- 每月：起訖月份間每個月都列出（沒有申請的月份為 0）
  months as (
    select generate_series(
             date_trunc('month', coalesce(p_from, (select min(day) from base), current_date)),
             date_trunc('month', coalesce(least(p_to, current_date), current_date)),
             interval '1 month')::date as m
  ),
  monthly as (
    select to_char(mo.m, 'YYYY-MM') as month,
           count(b.id) as total,
           count(b.id) filter (where b.status = '已發放結案') as issued,
           count(b.id) filter (where b.status = '已駁回') as rejected,
           count(b.id) filter (where b.status = '已撤回') as withdrawn,
           count(b.id) filter (where b.status in ('申請主管簽核中', '核發主管簽核中', '待文管發放')) as open
    from months mo
    left join base b on date_trunc('month', b.day) = mo.m
    group by mo.m
    order by mo.m
  ),
  -- 各關處理時間（小時）
  durations as (
    select 'stage1' as stage,
           extract(epoch from (stage1_at - created_at)) / 3600 as h
    from base where stage1_result in ('已核准', '已駁回') and stage1_at is not null
    union all
    select 'stage2', extract(epoch from (stage2_at - coalesce(stage1_at, created_at))) / 3600
    from base where stage2_result in ('已核准', '已駁回') and stage2_at is not null
    union all
    select 'issue', extract(epoch from (delivered_at - stage2_at)) / 3600
    from base where delivered_at is not null and stage2_at is not null
    union all
    select 'total', extract(epoch from (delivered_at - created_at)) / 3600
    from base where delivered_at is not null
  ),
  speed as (
    select stage,
           count(*) as n,
           round(avg(h)::numeric, 1) as avg_hours,
           round((percentile_cont(0.5) within group (order by h))::numeric, 1) as median_hours,
           round(max(h)::numeric, 1) as max_hours
    from durations group by stage
  ),
  -- 目前卡在各關的件數與等待時間（不受日期篩選影響：看的是「現在」）
  pending as (
    select stage, count(*) as n,
           round(max(h)::numeric, 1) as oldest_hours,
           round(avg(h)::numeric, 1) as avg_hours
    from (
      select 'stage1' as stage, extract(epoch from (now() - created_at)) / 3600 as h
      from public.requests where status = '申請主管簽核中'
      union all
      select 'stage2', extract(epoch from (now() - coalesce(stage1_at, created_at))) / 3600
      from public.requests where status = '核發主管簽核中'
      union all
      select 'issue', extract(epoch from (now() - stage2_at)) / 3600
      from public.requests where status = '待文管發放'
    ) x group by stage
  ),
  -- 品號：每行「品號/名稱規格」取斜線前的品號
  item_lines as (
    select b.id, b.day,
           upper(btrim(split_part(line, '/', 1))) as part,
           btrim(substr(line, length(split_part(line, '/', 1)) + 2)) as name
    from base b, unnest(string_to_array(b.items, E'\n')) as line
    where btrim(line) <> ''
  ),
  top_items as (
    select part,
           count(distinct id) as n,
           max(day) as last_day,
           (array_agg(nullif(name, '') order by day desc) filter (where nullif(name, '') is not null))[1] as name
    from item_lines where part <> ''
    group by part
    order by count(distinct id) desc, max(day) desc, part
    limit 20
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'kpi', (
      select jsonb_build_object(
        'total', count(*),
        'in_review', count(*) filter (where status in ('申請主管簽核中', '核發主管簽核中')),
        'to_issue', count(*) filter (where status = '待文管發放'),
        'issued', count(*) filter (where status = '已發放結案'),
        'rejected', count(*) filter (where status = '已駁回'),
        'withdrawn', count(*) filter (where status = '已撤回'),
        'external', count(*) filter (where is_external),
        -- 已有結果的申請（核准到待發放以後，或被駁回）
        'decided', count(*) filter (where status in ('待文管發放', '已發放結案', '已駁回')),
        'rejected_stage1', count(*) filter (where stage1_result = '已駁回'),
        'rejected_stage2', count(*) filter (where stage2_result = '已駁回')
      ) from base),
    'monthly', coalesce((select jsonb_agg(to_jsonb(monthly)) from monthly), '[]'::jsonb),
    'speed', coalesce((select jsonb_object_agg(stage, to_jsonb(speed) - 'stage') from speed), '{}'::jsonb),
    'pending', coalesce((select jsonb_object_agg(stage, to_jsonb(pending) - 'stage') from pending), '{}'::jsonb),
    'by_department', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'n', n) order by n desc, label)
      from (select coalesce(department_name, '（未知）') as label, count(*) as n from base group by 1) t), '[]'::jsonb),
    'by_data_type', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'n', n) order by n desc, label)
      from (select unnest(data_types) as label, count(*) as n from base group by 1) t), '[]'::jsonb),
    'by_purpose', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'n', n, 'external', ext) order by n desc, label)
      from (select purpose as label, count(*) as n, bool_or(is_external) as ext from base group by 1) t), '[]'::jsonb),
    'external_targets', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'n', n) order by n desc, label)
      from (select btrim(external_note) as label, count(*) as n from base
            where is_external and nullif(btrim(external_note), '') is not null
            group by 1 order by 2 desc, 1 limit 10) t), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object('part', part, 'name', name, 'n', n, 'last_day', last_day)
                       order by n desc, last_day desc, part)
      from top_items), '[]'::jsonb),
    'reject_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'n', n) order by n desc, label)
      from (select btrim(coalesce(stage2_reason, stage1_reason)) as label, count(*) as n from base
            where status = '已駁回' group by 1 order by 2 desc, 1 limit 10) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create function public.export_requests(p_from date default null, p_to date default null)
returns table (
  doc_no text, created_at timestamptz, applicant text, department text, data_types text, items text,
  purpose text, is_external boolean, formats text, need_date date, external_note text, status text,
  stage1_result text, stage1_by text, stage1_at timestamptz, stage1_reason text,
  stage2_result text, stage2_by text, stage2_at timestamptz, stage2_reason text,
  delivery_method text, delivered_by text, delivered_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public._can_view_dashboard() then
    raise exception '沒有權限匯出資料' using errcode = '42501';
  end if;
  return query
  select r.doc_no, r.created_at, a.display_name,
         coalesce(d.name, '') || coalesce('（' || r.department_other || '）', ''),
         array_to_string(r.data_types, '、'), r.items,
         r.purpose || coalesce('（' || r.purpose_other || '）', ''), r.is_external,
         array_to_string(r.formats, '、') || coalesce('（' || r.format_other || '）', ''),
         r.need_date, r.external_note, r.status,
         r.stage1_result, s1.display_name, r.stage1_at, r.stage1_reason,
         r.stage2_result, s2.display_name, r.stage2_at, r.stage2_reason,
         r.delivery_method || coalesce('（' || r.delivery_method_other || '）', ''), dv.display_name, r.delivered_at
  from public.requests r
  join public.profiles a on a.id = r.applicant_id
  left join public.departments d on d.id = r.department_id
  left join public.profiles s1 on s1.id = r.stage1_by
  left join public.profiles s2 on s2.id = r.stage2_by
  left join public.profiles dv on dv.id = r.delivered_by
  where (p_from is null or (r.created_at at time zone 'Asia/Taipei')::date >= p_from)
    and (p_to   is null or (r.created_at at time zone 'Asia/Taipei')::date <= p_to)
  order by r.created_at desc;
end;
$$;

revoke all on function public._can_view_dashboard() from public, anon, authenticated;
revoke all on function public.dashboard_data(date, date) from public, anon;
revoke all on function public.export_requests(date, date) from public, anon;
grant execute on function public.dashboard_data(date, date) to authenticated, service_role;
grant execute on function public.export_requests(date, date) to authenticated, service_role;
grant execute on function public._can_view_dashboard() to service_role;
