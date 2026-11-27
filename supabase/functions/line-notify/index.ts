// LINE 通知發送
//
// 讀出資料庫的待發通知（notifications），用官方帳號（Messaging API）推播給對象，
// 成功後標記已發送。重複呼叫是安全的：每則通知只會成功發送一次。
//
// 呼叫時機：網頁在送出申請、簽核、發放後呼叫一次。
// 部署設定：關閉「Verify JWT」（呼叫內容不含任何資料，只是「請檢查待發通知」）。
// 機密：LINE_CHANNEL_ACCESS_TOKEN 存在 Supabase 的 Edge Function Secrets，不可寫進程式。
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const LIFF_URL = "https://liff.line.me/2012594772-22NJxRHt";
const ALLOWED_ORIGINS = ["https://ming32409-boop.github.io", "http://localhost:8000"];

// 申請單相關欄位：「新帳號待啟用」通知沒有申請單，這些欄位會是 null
export type Notice = {
  id: number;
  kind: string;
  line_user_id: string;
  doc_no: string;
  applicant: string;
  department: string;
  data_types: string[];
  items: string;
  purpose: string;
  is_external: boolean;
  stage1_reason: string | null;
  stage2_reason: string | null;
  delivery_method: string | null;
  delivery_note?: string | null;
  subject_name?: string | null;
};

// 通知連結：打開對的分頁，並直接捲到這張單（核准仍要本人在畫面上按按鈕）
export function link(tab: string, docNo?: string): string {
  return `${LIFF_URL}?tab=${tab}` + (docNo ? `&doc=${encodeURIComponent(docNo)}` : "");
}

export type Deps = {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  createClient: typeof createClient;
};

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function firstKey(env: Deps["env"], legacy: string, multi: string): string | undefined {
  const v = env(legacy);
  if (v) return v;
  const keys = env(multi);
  if (!keys) return undefined;
  try {
    const parsed = JSON.parse(keys);
    return parsed.default ?? (Object.values(parsed)[0] as string | undefined);
  } catch {
    return undefined;
  }
}

function itemsSummary(items: string): string {
  const lines = items.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const short = first.length > 60 ? first.slice(0, 60) + "…" : first;
  return lines.length > 1 ? `${short}（另 ${lines.length - 1} 筆）` : short;
}

// 組成通知文字
export function buildMessage(n: Notice): string {
  if (n.kind === "新帳號待啟用") {
    return [`【新帳號待啟用】${n.subject_name ?? "有同仁"} 剛用 LINE 登入圖面資料申請`,
      "請為這個帳號開通並設定角色；開通後系統會通知對方。", "", `開通：${link("admin")}`].join("\n");
  }
  if (n.kind === "帳號已開通") {
    const hello = n.subject_name ? `${n.subject_name} 你好，` : "";
    return [`【帳號已開通】${hello}你的圖面資料申請帳號已開通，可以開始使用了。`, "", `開始使用：${link("new")}`].join("\n");
  }
  const summary = [
    `單號：${n.doc_no}`,
    `申請人：${n.applicant}（${n.department}）`,
    `資料別：${n.data_types.join("、")}`,
    `品號：${itemsSummary(n.items)}`,
    `用途：${n.purpose}${n.is_external ? "　⚠ 外部用途" : ""}`,
  ];
  switch (n.kind) {
    case "待第一關簽核":
      return ["【待簽核】有一張圖面資料申請等你審核（第一關）", ...summary, "", `簽核：${link("review", n.doc_no)}`].join("\n");
    case "待第二關簽核":
      return ["【待核發】有一張圖面資料申請等你放行（第二關）", ...summary, "", `簽核：${link("review", n.doc_no)}`].join("\n");
    case "待發放":
      return ["【待發放】有一張圖面資料申請已核准，請備檔發放", ...summary, "", `處理：${link("issue", n.doc_no)}`].join("\n");
    case "已駁回": {
      const reason = n.stage2_reason ?? n.stage1_reason ?? "";
      return [`【已駁回】圖面資料申請 ${n.doc_no} 已被駁回`, `原因：${reason}`, `品號：${itemsSummary(n.items)}`, "",
        `如需調閱請修正後重新申請：${link("mine", n.doc_no)}`].join("\n");
    }
    case "已發放":
      return [`【已發放】圖面資料申請 ${n.doc_no} 已發放，請查收`, `發放方式：${n.delivery_method ?? ""}`,
        ...(n.delivery_note ? [`連結／備註：${n.delivery_note}`] : []),
        `品號：${itemsSummary(n.items)}`, "", `查看：${link("mine", n.doc_no)}`].join("\n");
    default:
      return [`圖面資料申請 ${n.doc_no} 有新的進度`, `查看：${LIFF_URL}`].join("\n");
  }
}

async function push(deps: Deps, token: string, to: string, text: string): Promise<string | null> {
  const res = await deps.fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
  });
  if (res.ok) return null;
  const body = await res.text().catch(() => "");
  return `LINE ${res.status} ${body.slice(0, 300)}`;
}

// 本月（台灣時間）1 號 00:00 的時間點
export function monthStartTaipei(now = new Date()): string {
  const tw = new Date(now.getTime() + 8 * 3600_000);
  const y = tw.getUTCFullYear(), m = tw.getUTCMonth();
  return new Date(Date.UTC(y, m, 1) - 8 * 3600_000).toISOString();
}

// 管理看板用：查詢本月 LINE 推播用量（只給核發主管、文管、系統管理員）
// 呼叫方式：POST {"action":"quota"}，Authorization 帶登入者的 access token。
type Roles = { active: boolean; is_admin: boolean; is_issuer: boolean; is_dcc: boolean };
async function quota(req: Request, deps: Deps, admin: SupabaseClient, token: string, origin: string | null) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "請先登入" }, 401, origin);
  const { data: who, error: authError } = await admin.auth.getUser(jwt);
  if (authError || !who?.user) return json({ error: "請先登入" }, 401, origin);
  const { data: me } = await admin.from("profiles").select("active, is_admin, is_issuer, is_dcc").eq("id", who.user.id).maybeSingle<Roles>();
  if (!me || !me.active || !(me.is_admin || me.is_issuer || me.is_dcc)) return json({ error: "沒有權限" }, 403, origin);

  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [q, c] = await Promise.all([
    deps.fetch("https://api.line.me/v2/bot/message/quota", auth),
    deps.fetch("https://api.line.me/v2/bot/message/quota/consumption", auth),
  ]);
  if (!q.ok || !c.ok) return json({ error: `LINE 回應錯誤（${q.status}／${c.status}）` }, 502, origin);
  const qj = await q.json(), cj = await c.json();
  // 本月發送失敗（重試 3 次仍失敗）的通知數：用量滿了時會開始出現
  const { count } = await admin.from("notifications").select("id", { count: "exact", head: true })
    .is("sent_at", null).gte("attempts", 3).gte("created_at", monthStartTaipei());
  return json({
    type: qj.type,                                   // limited＝有上限、none＝沒有上限
    limit: qj.type === "limited" ? Number(qj.value) : null,
    used: Number(cj.totalUsage) || 0,
    failed: count ?? 0,
  }, 200, origin);
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "只接受 POST" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "不允許的來源" }, 403, origin);

  const url = deps.env("SUPABASE_URL");
  const secret = firstKey(deps.env, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS");
  const token = deps.env("LINE_CHANNEL_ACCESS_TOKEN");
  if (!url || !secret) return json({ error: "伺服器設定不完整" }, 500, origin);
  if (!token) return json({ error: "尚未設定 LINE_CHANNEL_ACCESS_TOKEN" }, 500, origin);

  const admin = deps.createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: deps.fetch },
  });
  // 管理看板查詢用量；其他呼叫（沒有內容）都是「請發送待發通知」
  const body = await req.text().catch(() => "");
  if (body) {
    let action: unknown;
    try { action = JSON.parse(body)?.action; } catch { action = null; }
    if (action === "quota") return quota(req, deps, admin, token, origin);
  }

  const { data, error } = await admin.rpc("claim_notifications", { p_limit: 20 });
  if (error) return json({ error: "讀取待發通知失敗：" + error.message }, 500, origin);

  let sent = 0, failed = 0;
  for (const n of (data ?? []) as Notice[]) {
    let err: string | null;
    try {
      err = await push(deps, token, n.line_user_id, buildMessage(n));
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
    }
    if (err) {
      failed++;
      console.error(`notification ${n.id} failed: ${err}`);
    } else {
      sent++;
    }
    await admin.rpc("finish_notification", { p_id: n.id, p_ok: !err, p_error: err });
  }
  return json({ sent, failed }, 200, origin);
}

// 測試時（設定 LINE_NOTIFY_TEST=1）不啟動伺服器
if (Deno.env.get("LINE_NOTIFY_TEST") !== "1") {
  Deno.serve((req) => handle(req, { env: (n) => Deno.env.get(n), fetch, createClient }));
}
