// line-notify 函式測試：用假的 Supabase 與 LINE 回應，不連真正的服務。
// 執行：LINE_NOTIFY_TEST=1 deno test --allow-env --allow-net=127.0.0.1 supabase/functions/line-notify/
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildMessage, handle, type Deps, type Notice } from "./index.ts";

const URL_ = "https://example-project.supabase.co";
const ORIGIN = "https://ming32409-boop.github.io";

function notice(over: Partial<Notice> = {}): Notice {
  return {
    id: 1, kind: "待第一關簽核", line_user_id: "U" + "a".repeat(32), doc_no: "DOC-20261113-001",
    applicant: "示範申請人", department: "品管課", data_types: ["圖面", "材質證明"],
    items: "AB-CD-123456-1/示範固定座\nAB-CD-123457-2/示範支架", purpose: "提供給客戶", is_external: true,
    stage1_reason: null, stage2_reason: null, delivery_method: null, ...over,
  };
}

function makeDeps(opts: { notices?: Notice[]; lineStatus?: number; token?: string | null } = {}) {
  const pushes: { to: string; text: string; auth: string }[] = [];
  const finished: { p_id: number; p_ok: boolean; p_error: string | null }[] = [];
  const env: Record<string, string> = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "svc" };
  if (opts.token !== null) env.LINE_CHANNEL_ACCESS_TOKEN = opts.token ?? "line-token";
  const fakeFetch: typeof fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    const body = req.body ? await req.text() : "";
    const j = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (req.url === `${URL_}/rest/v1/rpc/claim_notifications`) return j(opts.notices ?? [notice()]);
    if (req.url === `${URL_}/rest/v1/rpc/finish_notification`) { finished.push(JSON.parse(body)); return new Response(null, { status: 204 }); }
    if (req.url === "https://api.line.me/v2/bot/message/push") {
      const b = JSON.parse(body);
      pushes.push({ to: b.to, text: b.messages[0].text, auth: req.headers.get("authorization") ?? "" });
      const st = opts.lineStatus ?? 200;
      return st === 200 ? j({}) : j({ message: "The request body has 1 error(s)" }, st);
    }
    return j({ message: "unexpected " + req.url }, 500);
  };
  const deps: Deps = { env: (n) => env[n], fetch: fakeFetch, createClient };
  return { deps, pushes, finished };
}

const post = (origin = ORIGIN) => new Request("https://fn.local/line-notify", { method: "POST", headers: { Origin: origin } });

Deno.test("sends_pending_notifications_and_marks_sent", async () => {
  const { deps, pushes, finished } = makeDeps({ notices: [notice(), notice({ id: 2, kind: "已發放", delivery_method: "雲端連結" })] });
  const res = await handle(post(), deps);
  assertEquals(await res.json(), { sent: 2, failed: 0 });
  assertEquals(pushes.length, 2);
  assertEquals(pushes[0].to, "U" + "a".repeat(32));
  assertEquals(pushes[0].auth, "Bearer line-token");
  assertEquals(finished, [{ p_id: 1, p_ok: true, p_error: null }, { p_id: 2, p_ok: true, p_error: null }]);
});

Deno.test("records_line_errors_for_retry", async () => {
  const { deps, finished } = makeDeps({ lineStatus: 400 });
  const res = await handle(post(), deps);
  assertEquals(await res.json(), { sent: 0, failed: 1 });
  assertEquals(finished[0].p_ok, false);
  assertStringIncludes(finished[0].p_error!, "LINE 400");
});

Deno.test("requires_access_token_secret", async () => {
  const { deps, pushes } = makeDeps({ token: null });
  const res = await handle(post(), deps);
  assertEquals(res.status, 500);
  assertEquals(pushes.length, 0);
});

Deno.test("rejects_other_origins_and_methods", async () => {
  const { deps } = makeDeps();
  assertEquals((await handle(post("https://evil.example"), deps)).status, 403);
  assertEquals((await handle(new Request("https://fn.local/line-notify"), deps)).status, 405);
});

Deno.test("message_texts", () => {
  const m1 = buildMessage(notice());
  assertStringIncludes(m1, "【待簽核】");
  assertStringIncludes(m1, "DOC-20261113-001");
  assertStringIncludes(m1, "示範申請人（品管課）");
  assertStringIncludes(m1, "（另 1 筆）");
  assertStringIncludes(m1, "⚠ 外部用途");
  assertStringIncludes(m1, "?tab=review");
  assertStringIncludes(buildMessage(notice({ kind: "待第二關簽核" })), "【待核發】");
  assertStringIncludes(buildMessage(notice({ kind: "待發放" })), "?tab=issue");
  const rej = buildMessage(notice({ kind: "已駁回", stage1_reason: "用途不明" }));
  assertStringIncludes(rej, "原因：用途不明");
  assertStringIncludes(rej, "?tab=mine");
  assert(!buildMessage(notice({ is_external: false })).includes("外部用途"));
});
