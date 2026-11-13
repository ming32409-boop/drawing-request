// line-login 函式測試：用假的 LINE 與 Supabase 回應，不連真正的服務。
// 執行：LINE_LOGIN_TEST=1 deno test --allow-env --allow-net=127.0.0.1 supabase/functions/line-login/
import { assertEquals, assert } from "jsr:@std/assert@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle, type Deps } from "./index.ts";

const URL_ = "https://example-project.supabase.co";
const ORIGIN = "https://ming32409-boop.github.io";
const LINE_SUB = "U" + "a".repeat(32);
const USER_ID = "11111111-1111-4111-8111-111111111111";

type Call = { method: string; url: string; body: string };

function makeDeps(opts: { lineOk?: boolean; existing?: boolean; aud?: string } = {}) {
  const calls: Call[] = [];
  const env: Record<string, string> = {
    SUPABASE_URL: URL_,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    SUPABASE_ANON_KEY: "test-anon-key",
  };
  const fakeFetch: typeof fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    const body = req.body ? await req.text() : "";
    const url = req.url;
    calls.push({ method: req.method, url, body });
    const j = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

    if (url === "https://api.line.me/oauth2/v2.1/verify") {
      if (opts.lineOk === false) return j({ error: "invalid_request", error_description: "IdToken expired." }, 400);
      return j({ iss: "https://access.line.me", sub: LINE_SUB, aud: opts.aud ?? "2012594772", name: "示範使用者" });
    }
    if (url.startsWith(`${URL_}/rest/v1/profiles`) && req.method === "GET") {
      return j(opts.existing ? [{ id: USER_ID }] : []);
    }
    if (url.startsWith(`${URL_}/rest/v1/profiles`)) return new Response(null, { status: 201 });
    if (url === `${URL_}/auth/v1/admin/users` && req.method === "POST") {
      return j({ id: USER_ID, email: `${LINE_SUB.toLowerCase()}@line-login.invalid`, aud: "authenticated" });
    }
    if (url === `${URL_}/auth/v1/admin/generate_link`) {
      return j({ id: USER_ID, email: "x", action_link: "https://x", email_otp: "123456", hashed_token: "hash-abc",
                 verification_type: "magiclink", redirect_to: "" });
    }
    if (url.startsWith(`${URL_}/auth/v1/verify`)) {
      return j({ access_token: "acc", refresh_token: "ref", expires_in: 3600, expires_at: 9999999999, token_type: "bearer",
                 user: { id: USER_ID, aud: "authenticated" } });
    }
    return j({ message: "unexpected " + req.method + " " + url }, 500);
  };
  const deps: Deps = { env: (n) => env[n], fetch: fakeFetch, createClient };
  return { deps, calls };
}

function post(body: unknown, origin = ORIGIN) {
  return new Request("https://fn.local/line-login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}
const TOKEN = "header.payload.signature-long-enough";

Deno.test("new_line_user_gets_session_and_inactive_profile", async () => {
  const { deps, calls } = makeDeps();
  const res = await handle(post({ id_token: TOKEN }), deps);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.access_token, "acc");
  assertEquals(data.refresh_token, "ref");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  const verify = calls.find((c) => c.url.includes("api.line.me"))!;
  assert(verify.body.includes("client_id=2012594772"), "verifies with channel id");
  const created = calls.find((c) => c.url.endsWith("/auth/v1/admin/users"))!;
  assert(created.body.includes(`${LINE_SUB.toLowerCase()}@line-login.invalid`));
  const profile = calls.find((c) => c.url.includes("/rest/v1/profiles") && c.method === "POST")!;
  const row = JSON.parse(profile.body);
  assertEquals(row.line_user_id, LINE_SUB);
  assertEquals(row.active, false, "new users start inactive");
});

Deno.test("existing_user_is_not_recreated", async () => {
  const { deps, calls } = makeDeps({ existing: true });
  const res = await handle(post({ id_token: TOKEN }), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.filter((c) => c.url.endsWith("/auth/v1/admin/users")).length, 0);
  assert(calls.some((c) => c.method === "PATCH" && c.url.includes("/rest/v1/profiles")), "display name synced");
});

Deno.test("rejects_invalid_line_token", async () => {
  const { deps, calls } = makeDeps({ lineOk: false });
  const res = await handle(post({ id_token: TOKEN }), deps);
  assertEquals(res.status, 401);
  assertEquals((await res.json()).code, "invalid_id_token");
  assertEquals(calls.filter((c) => c.url.startsWith(URL_)).length, 0, "no Supabase calls");
});

Deno.test("rejects_token_for_other_channel", async () => {
  const { deps } = makeDeps({ aud: "999" });
  const res = await handle(post({ id_token: TOKEN }), deps);
  assertEquals(res.status, 401);
});

Deno.test("rejects_missing_token_and_bad_origin", async () => {
  const { deps } = makeDeps();
  assertEquals((await handle(post({}), deps)).status, 400);
  assertEquals((await handle(post({ id_token: TOKEN }, "https://evil.example"), deps)).status, 403);
  const get = await handle(new Request("https://fn.local/line-login", { method: "GET" }), deps);
  assertEquals(get.status, 405);
});

Deno.test("answers_cors_preflight", async () => {
  const { deps } = makeDeps();
  const res = await handle(new Request("https://fn.local/line-login", { method: "OPTIONS", headers: { Origin: ORIGIN } }), deps);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});
