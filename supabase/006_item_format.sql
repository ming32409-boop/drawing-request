-- =====================================================================
-- 006：品號格式檢查
--
-- 「品號／零件名稱／規格」每一行都必須是「品號/名稱」：
--   要有斜線，斜線前面要有品號，斜線後面要有名稱。空白行會略過。
-- 網頁送出前會先檢查並指出是第幾行；這裡是資料庫端的第二道防線。
-- 同一張單品號重複只在網頁上提醒，資料庫不擋。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（005 之後）。可重複執行。
-- =====================================================================

-- 檢查每一行的格式；有錯回傳說明文字（含行號），沒錯回傳 null
create or replace function public.check_item_lines(p_items text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_line text;
  v_no   integer := 0;
  v_pos  integer;
  v_trim constant text := E' \t\r' || '　';   -- 半形空白、Tab、換行符、全形空白
begin
  foreach v_line in array string_to_array(coalesce(p_items, ''), E'\n') loop
    v_no := v_no + 1;
    v_line := btrim(v_line, v_trim);
    continue when v_line = '';
    v_pos := position('/' in v_line);
    if v_pos = 0 then
      return '第 ' || v_no || ' 行缺少斜線，格式是「品號/名稱」';
    elsif btrim(left(v_line, v_pos - 1), v_trim) = '' then
      return '第 ' || v_no || ' 行斜線前面缺少品號';
    elsif btrim(substr(v_line, v_pos + 1), v_trim) = '' then
      return '第 ' || v_no || ' 行斜線後面缺少名稱';
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.check_item_lines(text) from public, anon, authenticated;
grant execute on function public.check_item_lines(text) to service_role;

-- 送出申請：加入品號格式檢查（其餘內容與 schema.sql 相同）
create or replace function public.submit_request(
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
  v_item_error text;
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
  v_item_error := public.check_item_lines(p_items);
  if v_item_error is not null then
    raise exception '%', v_item_error using errcode = '22023';
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
