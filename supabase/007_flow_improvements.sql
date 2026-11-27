-- =====================================================================
-- 007：流程改善
--   1. 文管發放時可以填「連結／備註」：選「雲端連結」時必填，會寫進給申請人的 LINE 通知。
--   2. 有人第一次用 LINE 登入（帳號待啟用）時，自動用 LINE 通知所有系統管理員。
--   3. 匯出 Excel 加上「發放連結／備註」欄。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（006 之後）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 發放連結／備註
-- ---------------------------------------------------------------------
alter table public.requests
  add column delivery_note text
  constraint requests_delivery_note_check check (delivery_note is null or char_length(delivery_note) between 1 and 500);
comment on column public.requests.delivery_note is '發放連結／備註（例如雲端連結網址）；選「雲端連結」時必填';

-- 參數變了，要先刪掉舊版再建立
drop function public.deliver_request(uuid, text, text);

create function public.deliver_request(p_request_id uuid, p_method text, p_method_other text default null,
                                       p_note text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r      public.requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
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
  if p_method = '雲端連結' and v_note is null then
    raise exception '發放方式選「雲端連結」時必須貼上連結' using errcode = '22023';
  end if;
  if char_length(v_note) > 500 then
    raise exception '連結／備註最多 500 字' using errcode = '22023';
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
    delivery_note = v_note,
    delivered_by = auth.uid(),
    delivered_at = now()
  where id = r.id;
  perform public._log_event(r.id, '發放', 3::smallint, p_method);
  perform public._notify(r.id, r.applicant_id, '已發放');
  return '已發放結案';
end;
$$;

revoke all on function public.deliver_request(uuid, text, text, text) from public, anon;
grant execute on function public.deliver_request(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. 新帳號待啟用 → 通知系統管理員
--    通知不一定屬於某張申請單：request_id 可以是空的，改用 subject_id 指向新帳號。
-- ---------------------------------------------------------------------
alter table public.notifications
  alter column request_id drop not null,
  add column subject_id uuid references public.profiles (id) on delete cascade;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  '待第一關簽核', '待第二關簽核', '待發放', '已駁回', '已發放', '新帳號待啟用'));
alter table public.notifications add constraint notifications_target_check check (
  (kind = '新帳號待啟用' and subject_id is not null) or (kind <> '新帳號待啟用' and request_id is not null));

-- 新增的帳號如果是「待啟用」，通知所有已啟用的系統管理員
create function public._notify_new_account()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not new.active then
    insert into public.notifications (recipient_id, subject_id, kind)
    select p.id, new.id, '新帳號待啟用'
    from public.profiles p
    where p.active and p.is_admin and p.id <> new.id;
  end if;
  return new;
end;
$$;
revoke all on function public._notify_new_account() from public, anon, authenticated;

create trigger profiles_notify_new_account
  after insert on public.profiles
  for each row execute function public._notify_new_account();

-- 取出待發通知：回傳的欄位多了「發放連結／備註」與「新帳號名稱」；
-- 新帳號通知沒有申請單，所以申請單相關欄位用 left join（會是空的）。
drop function public.claim_notifications(integer);

create function public.claim_notifications(p_limit integer default 20)
returns table (
  id            bigint,
  kind          text,
  line_user_id  text,
  doc_no        text,
  applicant     text,
  department    text,
  data_types    text[],
  items         text,
  purpose       text,
  is_external   boolean,
  stage1_reason text,
  stage2_reason text,
  delivery_method text,
  delivery_note text,
  subject_name  text
)
language sql security definer set search_path = ''
as $$
  with picked as (
    select n.id
    from public.notifications n
    where n.sent_at is null
      and n.attempts < 3
      and (n.last_attempt_at is null or n.last_attempt_at < now() - interval '1 minute')
    order by n.id
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ), claimed as (
    update public.notifications n
    set attempts = n.attempts + 1, last_attempt_at = now()
    from picked
    where n.id = picked.id
    returning n.id, n.kind, n.recipient_id, n.request_id, n.subject_id
  )
  select c.id, c.kind, p.line_user_id, r.doc_no, a.display_name,
         case when r.id is null then null
              else coalesce(d.name, '') || coalesce('（' || r.department_other || '）', '') end,
         r.data_types, r.items, coalesce(r.purpose_other, r.purpose), r.is_external,
         r.stage1_reason, r.stage2_reason,
         coalesce(r.delivery_method_other, r.delivery_method),
         r.delivery_note,
         s.display_name
  from claimed c
  join public.profiles p on p.id = c.recipient_id
  left join public.requests r on r.id = c.request_id
  left join public.profiles a on a.id = r.applicant_id
  left join public.departments d on d.id = r.department_id
  left join public.profiles s on s.id = c.subject_id
  order by c.id
$$;

revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;

-- ---------------------------------------------------------------------
-- 3. 匯出 Excel 加上「發放連結／備註」
-- ---------------------------------------------------------------------
drop function public.export_requests(date, date);

create function public.export_requests(p_from date default null, p_to date default null)
returns table (
  doc_no text, created_at timestamptz, applicant text, department text, data_types text, items text,
  purpose text, is_external boolean, formats text, need_date date, external_note text, status text,
  stage1_result text, stage1_by text, stage1_at timestamptz, stage1_reason text,
  stage2_result text, stage2_by text, stage2_at timestamptz, stage2_reason text,
  delivery_method text, delivery_note text, delivered_by text, delivered_at timestamptz
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
         r.delivery_method || coalesce('（' || r.delivery_method_other || '）', ''), r.delivery_note,
         dv.display_name, r.delivered_at
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

revoke all on function public.export_requests(date, date) from public, anon;
grant execute on function public.export_requests(date, date) to authenticated, service_role;
