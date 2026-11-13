// LINE 通知發送
//
// 讀出資料庫的待發通知（notifications），用官方帳號（Messaging API）推播給對象，
// 成功後標記已發送。重複呼叫是安全的：每則通知只會成功發送一次。
//
// 呼叫時機：網頁在送出申請、簽核、發放後呼叫一次。
// 部署設定：關閉「Verify JWT」（呼叫內容不含任何資料，只是「請檢查待發通知」）。
// 機密：LINE_CHANNEL_ACCESS_TOKEN 存在 Supabase 的 Edge Function Secrets，不可寫進程式。
import { createClient } from "npm:@supabase/supabase-js@2";

const LIFF_URL = "https://liff.line.me/2012594772-22NJxRHt";
const ALLOWED_ORIGINS = ["https://ming32409-boop.github.io", "http://localhost:8000"];

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
};

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
  const summary = [
    `單號：${n.doc_no}`,
    `申請人：${n.applicant}（${n.department}）`,
    `資料別：${n.data_types.join("、")}`,
    `品號：${itemsSummary(n.items)}`,
    `用途：${n.purpose}${n.is_external ? "　⚠ 外部用途" : ""}`,
  ];
  switch (n.kind) {
    case "待第一關簽核":
      return ["【待簽核】有一張圖面資料申請等你審核（第一關）", ...summary, "", `簽核：${LIFF_URL}?tab=review`].join("\n");
    case "待第二關簽核":
      return ["【待核發】有一張圖面資料申請等你放行（第二關）", ...summary, "", `簽核：${LIFF_URL}?tab=review`].join("\n");
    case "待發放":
      return ["【待發放】有一張圖面資料申請已核准，請備檔發放", ...summary, "", `處理：${LIFF_URL}?tab=issue`].join("\n");
    case "已駁回": {
      const reason = n.stage2_reason ?? n.stage1_reason ?? "";
      return [`【已駁回】圖面資料申請 ${n.doc_no} 已被駁回`, `原因：${reason}`, `品號：${itemsSummary(n.items)}`, "",
        `如需調閱請修正後重新申請：${LIFF_URL}?tab=mine`].join("\n");
    }
    case "已發放":
      return [`【已發放】圖面資料申請 ${n.doc_no} 已發放，請查收`, `發放方式：${n.delivery_method ?? ""}`,
        `品號：${itemsSummary(n.items)}`, "", `查看：${LIFF_URL}?tab=mine`].join("\n");
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
