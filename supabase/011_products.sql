-- =====================================================================
-- 011：產品主檔與逐筆品項
--   1. 產品主檔 products：品號、分類、品名、規格（不存售價與庫存）。已啟用的同仁可以搜尋；
--      只有系統管理員能透過「管理設定 → 產品主檔」匯入／更新。
--   2. 逐筆品項 request_items：每張申請 1–10 筆，品號與品名分開存（品號可以含「/」，區分大小寫）。
--      舊申請的「品號/名稱」文字會依原本的規則（第一個斜線）轉入，看板統計改用逐筆資料。
--   3. submit_request_items：新的送出函式。檢查逐筆內容後，沿用原本的 submit_request
--      （部門、主管、通知等規則不變），並記下每一筆是否來自產品主檔。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（010 之後）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 產品主檔
-- ---------------------------------------------------------------------
create table public.products (
  code          text primary key
                constraint products_code_check check (char_length(code) between 1 and 40 and code !~ '[[:cntrl:]]' and code = btrim(code)),
  category      text,
  category_name text,
  name          text not null
                constraint products_name_check check (char_length(btrim(name)) between 1 and 100),
  spec          text
                constraint products_spec_check check (spec is null or char_length(spec) <= 100),
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);
comment on table public.products is '產品主檔（由 ERP 匯出後在管理設定匯入）；只存品號、分類、品名、規格';

alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
grant select on public.products to authenticated;
grant all on public.products to service_role;
create policy products_select on public.products
  for select to authenticated using (public.me_is_active());

-- 搜尋產品：關鍵字以空白分開，每個字都要出現在「品號 品名 規格」裡（不分大小寫）。
-- 排序：品號完全相同 → 品號開頭相同 → 品號包含 → 其他。只找啟用中的產品。
create function public.search_products(p_q text, p_limit integer default 8)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with args as (
    select btrim(coalesce(p_q, '')) as q, greatest(1, least(coalesce(p_limit, 8), 20)) as lim
  ), terms as (
    select array(
      select replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_')
      from regexp_split_to_table((select q from args), '\s+') as t where t <> ''
    ) as arr
  ), hits as (
    select p.code, p.name, p.spec, p.category_name,
           case when p.code = (select q from args) then 0
                when p.code ilike replace(replace(replace((select q from args), '\', '\\'), '%', '\%'), '_', '\_') || '%' then 1
                when p.code ilike '%' || replace(replace(replace((select q from args), '\', '\\'), '%', '\%'), '_', '\_') || '%' then 2
                else 3 end as rank
    from public.products p, terms
    where p.active
      and cardinality(terms.arr) > 0
      and not exists (select 1 from unnest(terms.arr) t
                      where (p.code || ' ' || p.name || ' ' || coalesce(p.spec, '')) not ilike '%' || t || '%')
    order by rank, p.code
    limit (select lim from args)
  )
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'spec', spec, 'category', category_name)
                            order by rank, code), '[]'::jsonb)
  from hits
$$;
revoke all on function public.search_products(text, integer) from public, anon;
grant execute on function public.search_products(text, integer) to authenticated, service_role;

-- 產品主檔概況（管理設定顯示用）
create function public.product_summary()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object('total', count(*), 'active', count(*) filter (where active), 'updated_at', max(updated_at))
  from public.products
$$;
revoke all on function public.product_summary() from public, anon;
grant execute on function public.product_summary() to authenticated, service_role;

-- 匯入一批產品（系統管理員）：已有的品號更新內容並重新啟用，新的品號新增。
-- p_rows：[{code, category, category_name, name, spec}, ...]，一次最多 2000 筆。
create function public.import_products(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_before integer;
  v_n      integer;
begin
  if not public.me_is_admin() then
    raise exception '只有系統管理員可以匯入產品主檔' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception '沒有可匯入的產品' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception '一次最多匯入 2000 筆' using errcode = '22023';
  end if;
  select count(*) into v_before from public.products;
  insert into public.products as p (code, category, category_name, name, spec, active, updated_at)
  select btrim(x->>'code'), nullif(btrim(x->>'category'), ''), nullif(btrim(x->>'category_name'), ''),
         btrim(x->>'name'), nullif(btrim(x->>'spec'), ''), true, now()
  from jsonb_array_elements(p_rows) x
  on conflict (code) do update set
    category = excluded.category, category_name = excluded.category_name,
    name = excluded.name, spec = excluded.spec, active = true, updated_at = now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('saved', v_n, 'added', (select count(*) from public.products) - v_before);
end;
$$;
revoke all on function public.import_products(jsonb) from public, anon;
grant execute on function public.import_products(jsonb) to authenticated, service_role;

-- 匯入完成後：不在這次清單裡的產品改為停用（不刪除，舊申請仍可對照）
create function public.deactivate_missing_products(p_codes text[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.me_is_admin() then
    raise exception '只有系統管理員可以更新產品主檔' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_codes), 0) = 0 then
    raise exception '清單是空的，不能停用全部產品' using errcode = '22023';
  end if;
  update public.products set active = false, updated_at = now()
  where active and not (code = any (p_codes));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.deactivate_missing_products(text[]) from public, anon;
grant execute on function public.deactivate_missing_products(text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. 逐筆品項
-- ---------------------------------------------------------------------
create table public.request_items (
  request_id  uuid not null references public.requests (id) on delete cascade,
  seq         smallint not null constraint request_items_seq_check check (seq >= 1),
  code        text not null constraint request_items_code_check check (char_length(code) between 1 and 40),
  name        text not null constraint request_items_name_check check (char_length(name) between 1 and 100),
  note        text constraint request_items_note_check check (note is null or char_length(note) <= 200),
  from_master boolean not null default false,   -- 送出時品號在產品主檔裡（false＝手動輸入）
  primary key (request_id, seq)
);
comment on table public.request_items is '申請的逐筆品項（品號與品名分開）';

alter table public.request_items enable row level security;
revoke all on public.request_items from anon, authenticated;
grant select on public.request_items to authenticated;
grant all on public.request_items to service_role;
create policy request_items_select on public.request_items
  for select to authenticated using (public.me_can_view(request_id));

-- 舊申請：把「品號/名稱」文字依原本規則（第一個斜線）轉成逐筆
insert into public.request_items (request_id, seq, code, name, from_master)
select r.id, x.n,
       left(coalesce(nullif(btrim(split_part(x.line, '/', 1)), ''), '（未填）'), 40),
       left(coalesce(nullif(btrim(substr(x.line, length(split_part(x.line, '/', 1)) + 2)), ''), '（未填名稱）'), 100),
       false
from public.requests r
cross join lateral (
  select l.line, row_number() over (order by l.ord) as n
  from unnest(string_to_array(r.items, E'\n')) with ordinality as l(line, ord)
  where btrim(l.line) <> ''
) x;

-- 新的送出函式：p_item_list＝[{code, name, note}, ...]，1–10 筆
create function public.submit_request_items(
  p_department_id    smallint,
  p_department_other text,
  p_data_types       text[],
  p_item_list        jsonb,
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
  v_n     integer;
  v_i     integer := 0;
  v_x     jsonb;
  v_code  text;
  v_name  text;
  v_note  text;
  v_codes text[] := '{}';
  v_names text[] := '{}';
  v_notes text[] := '{}';
  v_dup   integer;
  v_doc   text;
  v_id    uuid;
begin
  if jsonb_typeof(p_item_list) is distinct from 'array' or jsonb_array_length(p_item_list) = 0 then
    raise exception '請至少填寫 1 筆產品' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_item_list);
  if v_n > 10 then
    raise exception '每張申請最多 10 筆產品' using errcode = '22023';
  end if;
  for v_x in select value from jsonb_array_elements(p_item_list) loop
    v_i := v_i + 1;
    v_code := btrim(coalesce(v_x->>'code', ''));
    v_name := btrim(coalesce(v_x->>'name', ''));
    v_note := nullif(btrim(coalesce(v_x->>'note', '')), '');
    if v_code = '' then raise exception '第 % 筆缺少產品編碼', v_i using errcode = '22023'; end if;
    if char_length(v_code) > 40 then raise exception '第 % 筆產品編碼最多 40 字', v_i using errcode = '22023'; end if;
    if v_name = '' then raise exception '第 % 筆缺少品名／規格', v_i using errcode = '22023'; end if;
    if char_length(v_name) > 100 then raise exception '第 % 筆品名／規格最多 100 字', v_i using errcode = '22023'; end if;
    if char_length(v_note) > 200 then raise exception '第 % 筆產品備註最多 200 字', v_i using errcode = '22023'; end if;
    if v_code ~ '[[:cntrl:]]' or v_name ~ '[[:cntrl:]]' or v_note ~ '[[:cntrl:]]' then
      raise exception '第 % 筆不能有換行', v_i using errcode = '22023';
    end if;
    v_dup := array_position(v_codes, v_code);   -- 區分大小寫
    if v_dup is not null then
      raise exception '第 % 筆與第 % 筆的產品編碼重複（%）', v_i, v_dup, v_code using errcode = '22023';
    end if;
    v_codes := v_codes || v_code;
    v_names := v_names || v_name;
    v_notes := v_notes || v_note;
  end loop;

  -- 沿用原本的送出流程；品項文字維持「品號/名稱」一行一筆（通知、匯出、關鍵字查詢使用）
  v_doc := public.submit_request(p_department_id, p_department_other, p_data_types,
    (select string_agg(v_codes[k] || '/' || v_names[k], E'\n' order by k) from generate_subscripts(v_codes, 1) k),
    p_purpose, p_purpose_other, p_formats, p_format_other, p_need_date, p_external_note);
  select id into v_id from public.requests where doc_no = v_doc;
  insert into public.request_items (request_id, seq, code, name, note, from_master)
  select v_id, k, v_codes[k], v_names[k], v_notes[k],
         exists (select 1 from public.products p where p.code = v_codes[k] and p.active)
  from generate_subscripts(v_codes, 1) k;
  return v_doc;
end;
$$;
revoke all on function public.submit_request_items(smallint, text, text[], jsonb, text, text, text[], text, date, text) from public, anon;
grant execute on function public.submit_request_items(smallint, text, text[], jsonb, text, text, text[], text, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. 看板的「最常被調閱的品號」改用逐筆品項（參數與回傳不變，直接替換）
-- ---------------------------------------------------------------------
create or replace function public.dashboard_data(p_from date default null, p_to date default null)
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
  -- 品號：用逐筆品項（品號可含「/」、區分大小寫）；沒有逐筆資料的舊申請，才用「品號/名稱」文字取斜線前的品號
  item_lines as (
    select b.id, b.day, ri.code as part, ri.name
    from base b join public.request_items ri on ri.request_id = b.id
    union all
    select b.id, b.day,
           upper(btrim(split_part(line, '/', 1))) as part,
           btrim(substr(line, length(split_part(line, '/', 1)) + 2)) as name
    from base b, unnest(string_to_array(b.items, E'\n')) as line
    where btrim(line) <> '' and not exists (select 1 from public.request_items ri where ri.request_id = b.id)
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

-- ---------------------------------------------------------------------
-- 4. 申請查詢帶出逐筆品項，關鍵字也會比對產品備註（參數與回傳不變，直接替換）
-- ---------------------------------------------------------------------
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
           or exists (select 1 from public.request_items ri where ri.request_id = r.id and ri.note ilike '%' || args.q || '%')
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
        'claimed_by_profile', case when p.claimed_by is null then null else jsonb_build_object('display_name', p.claimed_name) end,
        'request_items', (select jsonb_agg(jsonb_build_object('seq', ri.seq, 'code', ri.code, 'name', ri.name, 'note', ri.note,
                                                              'from_master', ri.from_master) order by ri.seq)
                          from public.request_items ri where ri.request_id = p.id)
      ) order by p.created_at desc, p.doc_no desc)
      from page p), '[]'::jsonb)
  )
$$;

