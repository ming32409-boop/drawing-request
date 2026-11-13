// LINE 登入 → Supabase 登入（所有頁面共用）
// 用法：const { client, user } = await window.DrawingAuth.signIn();
(function () {
  "use strict";
  var cfg = window.APP_CONFIG;
  var SUB_KEY = "drawing-line-sub";

  var client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "drawing-auth" },
  });

  async function exchange(idToken) {
    var res = await fetch(cfg.supabaseUrl + "/functions/v1/line-login", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.supabaseKey },
      body: JSON.stringify({ id_token: idToken }),
    });
    var data = {};
    try { data = await res.json(); } catch (e) { /* 忽略 */ }
    if (!res.ok) {
      var err = new Error(data.error || "登入失敗（" + res.status + "）");
      err.code = data.code;
      throw err;
    }
    return data;
  }

  async function signIn() {
    await liff.init({ liffId: cfg.liffId, withLoginOnExternalBrowser: true });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return new Promise(function () {}); // 轉到 LINE 登入頁
    }
    var decoded = liff.getDecodedIDToken();
    var sub = decoded && decoded.sub;

    // 已有 Supabase 登入，且是同一個 LINE 帳號：直接使用
    var current = (await client.auth.getSession()).data.session;
    if (current && sub && localStorage.getItem(SUB_KEY) === sub) {
      return { client: client, user: current.user };
    }

    var idToken = liff.getIDToken();
    if (!idToken) throw new Error("無法取得 LINE 登入資訊，請確認 LIFF 已開啟 openid 權限");
    var tokens;
    try {
      tokens = await exchange(idToken);
    } catch (err) {
      if (err.code === "invalid_id_token") {
        // LINE 登入過期：重新登入一次
        liff.logout();
        liff.login({ redirectUri: location.href });
        return new Promise(function () {});
      }
      throw err;
    }
    var result = await client.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    if (result.error) throw result.error;
    if (sub) localStorage.setItem(SUB_KEY, sub);
    return { client: client, user: result.data.user };
  }

  async function signOut() {
    await client.auth.signOut();
    localStorage.removeItem(SUB_KEY);
    if (window.liff && liff.isLoggedIn()) liff.logout();
  }

  window.DrawingAuth = { client: client, signIn: signIn, signOut: signOut };
})();
