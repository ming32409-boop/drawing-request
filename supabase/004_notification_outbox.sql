-- =====================================================================
-- 004：LINE 通知發送用的函式
--
-- notifications 是「待發清單」：資料庫函式（送出、簽核、發放）只負責寫入，
-- 由後端 Edge Function `line-notify` 讀出來發 LINE，發完標記已發送。
-- 這兩個函式只給後端（service_role）使用，前端不能呼叫。
--
-- 執行方式：在 Supabase SQL Editor 執行一次（003 之後）。
-- =====================================================================

alter table public.notifications
  add column attempts        smallint not null default 0,
  add column last_attempt_at timestamptz;

-- 取出最多 p_limit 筆待發通知，並標記「嘗試中」，避免兩個程式同時發同一則。
-- 失敗的通知 1 分鐘後可以重試，最多嘗試 3 次。
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
  delivery_method text
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
    returning n.id, n.kind, n.recipient_id, n.request_id
  )
  select c.id, c.kind, p.line_user_id, r.doc_no, a.display_name,
         coalesce(d.name, '') || coalesce('（' || r.department_other || '）', ''),
         r.data_types, r.items, coalesce(r.purpose_other, r.purpose), r.is_external,
         r.stage1_reason, r.stage2_reason,
         coalesce(r.delivery_method_other, r.delivery_method)
  from claimed c
  join public.profiles p on p.id = c.recipient_id
  join public.requests r on r.id = c.request_id
  join public.profiles a on a.id = r.applicant_id
  left join public.departments d on d.id = r.department_id
  order by c.id
$$;

-- 回報發送結果：成功標記已發送；失敗記下錯誤，之後重試
create function public.finish_notification(p_id bigint, p_ok boolean, p_error text default null)
returns void
language sql security definer set search_path = ''
as $$
  update public.notifications
  set sent_at = case when p_ok then now() else null end,
      error   = case when p_ok then null else left(p_error, 500) end
  where id = p_id
$$;

revoke all on function public.claim_notifications(integer) from public, anon, authenticated;
revoke all on function public.finish_notification(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_notifications(integer) to service_role;
grant execute on function public.finish_notification(bigint, boolean, text) to service_role;
