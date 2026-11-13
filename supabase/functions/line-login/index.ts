// LINE 登入 → Supabase 登入
//
// 流程：
//   1. 網頁（LIFF）取得 LINE 的 ID token，POST 到這個函式。
//   2. 向 LINE 驗證 ID token，取得 LINE User ID 與顯示名稱。
//   3. 找出或建立對應的 Supabase 使用者與 profiles 資料。
//      新使用者預設「未啟用」，要由系統管理員啟用後才能送出申請。
//   4. 產生 Supabase 登入 session（access token、refresh token）回傳給網頁。
//
// 部署設定：這個函式要關閉「Verify JWT」，因為呼叫時使用者還沒登入。
// 機密：只使用 Supabase 自動提供的環境變數，不需要也不可以把任何金鑰寫進程式。
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// LINE Login 的 Channel ID（公開資訊）。可用環境變數覆蓋。
const DEFAULT_LINE_CHANNEL_ID = "2012594772";

// 允許呼叫的網頁來源
const ALLOWED_ORIGINS = [
  "https://ming32409-boop.github.io",
  "http://localhost:8000",
];

// Supabase 帳號需要 Email；用 LINE User ID 產生一個不會收信的內部識別用地址
const PSEUDO_EMAIL_DOMAIN = "line-login.invalid";

type LineProfile = { sub: string; name: string };

export type Deps = {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  createClient: typeof createClient;
};

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
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

// 取得後端專用金鑰（Supabase 自動提供，不寫在程式裡）
function serviceKey(env: Deps["env"]): string | undefined {
  const legacy = env("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = env("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      return parsed.default ?? Object.values(parsed)[0] as string | undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function publicKey(env: Deps["env"]): string | undefined {
  const legacy = env("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  const keys = env("SUPABASE_PUBLISHABLE_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      return parsed.default ?? Object.values(parsed)[0] as string | undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// 向 LINE 驗證 ID token
async function verifyLineIdToken(deps: Deps, idToken: string, channelId: string): Promise<LineProfile | null> {
  const res = await deps.fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (typeof data.sub !== "string" || !/^U[0-9a-f]{32}$/.test(data.sub)) return null;
  if (data.aud !== channelId) return null;
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 50) : "LINE 使用者";
  return { sub: data.sub, name };
}

// 找出或建立 Supabase 使用者，回傳使用者 id 與 Email
async function ensureUser(admin: SupabaseClient, line: LineProfile): Promise<{ id: string; email: string }> {
  const email = `${line.sub.toLowerCase()}@${PSEUDO_EMAIL_DOMAIN}`;

  const { data: existing, error: selectError } = await admin
    .from("profiles").select("id").eq("line_user_id", line.sub).maybeSingle();
  if (selectError) throw new Error("讀取使用者資料失敗：" + selectError.message);

  if (existing) {
    // 每次登入同步 LINE 顯示名稱
    await admin.from("profiles").update({ display_name: line.name }).eq("id", existing.id);
    return { id: existing.id, email };
  }

  let userId: string | undefined;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { provider: "line", display_name: line.name },
  });
  if (created?.user) {
    userId = created.user.id;
  } else {
    // 帳號已存在但 profiles 還沒建立（例如上次中途失敗）：用登入連結找回帳號
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (!link?.user) {
      throw new Error("建立帳號失敗：" + (createError?.message ?? linkError?.message ?? "未知錯誤"));
    }
    userId = link.user.id;
  }

  const { error: insertError } = await admin.from("profiles").upsert(
    { id: userId, line_user_id: line.sub, display_name: line.name, active: false },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (insertError) throw new Error("建立使用者資料失敗：" + insertError.message);
  return { id: userId!, email };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "只接受 POST" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: "不允許的來源" }, 403, origin);

  let idToken: unknown;
  try {
    idToken = (await req.json())?.id_token;
  } catch {
    return json({ error: "格式錯誤" }, 400, origin);
  }
  if (typeof idToken !== "string" || idToken.length < 20 || idToken.length > 5000) {
    return json({ error: "缺少 LINE ID token" }, 400, origin);
  }

  const url = deps.env("SUPABASE_URL");
  const secret = serviceKey(deps.env);
  const pub = publicKey(deps.env);
  if (!url || !secret || !pub) return json({ error: "伺服器設定不完整" }, 500, origin);

  const channelId = deps.env("LINE_LOGIN_CHANNEL_ID") ?? DEFAULT_LINE_CHANNEL_ID;
  const line = await verifyLineIdToken(deps, idToken, channelId);
  if (!line) return json({ error: "LINE 登入已過期或無效，請重新登入", code: "invalid_id_token" }, 401, origin);

  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: deps.fetch } };
  const admin = deps.createClient(url, secret, options);

  try {
    const user = await ensureUser(admin, line);
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
    const tokenHash = link?.properties?.hashed_token;
    if (!tokenHash) throw new Error("產生登入資訊失敗：" + (linkError?.message ?? "未知錯誤"));

    const anon = deps.createClient(url, pub, options);
    const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (!verified?.session) throw new Error("建立登入失敗：" + (verifyError?.message ?? "未知錯誤"));

    return json({
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
      expires_at: verified.session.expires_at,
    }, 200, origin);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : "登入失敗" }, 500, origin);
  }
}

// 測試時（設定 LINE_LOGIN_TEST=1）不啟動伺服器
if (Deno.env.get("LINE_LOGIN_TEST") !== "1") {
  Deno.serve((req) => handle(req, { env: (n) => Deno.env.get(n), fetch, createClient }));
}
