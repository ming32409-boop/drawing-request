// 登入測試頁：確認 LINE 登入與 Supabase 已經接起來
(function () {
  "use strict";
  var statusEl = document.getElementById("status");
  var meEl = document.getElementById("me");
  var retryBtn = document.getElementById("retry-btn");

  function show(type, text) {
    statusEl.className = "message " + type;
    statusEl.textContent = text;
  }

  async function main() {
    show("info", "登入中…");
    retryBtn.hidden = true;
    try {
      var session = await window.DrawingAuth.signIn();
      var client = session.client;

      var me = await client.from("profiles")
        .select("id, display_name, is_admin, is_issuer, is_dcc, active")
        .eq("id", session.user.id).single();
      if (me.error) throw me.error;

      var roles = [];
      if (me.data.is_admin) roles.push("系統管理員");
      if (me.data.is_issuer) roles.push("核發主管");
      if (me.data.is_dcc) roles.push("文管");

      var depts = [];
      if (me.data.active) {
        var d = await client.from("departments").select("name").eq("manager_id", me.data.id);
        if (!d.error) depts = d.data.map(function (x) { return x.name; });
      }

      document.getElementById("me-name").textContent = me.data.display_name;
      document.getElementById("me-active").textContent = me.data.active ? "已啟用" : "待啟用";
      document.getElementById("me-roles").textContent = roles.length ? roles.join("、") : "一般同仁";
      document.getElementById("me-depts").textContent = depts.length ? depts.join("、") : "無";
      meEl.hidden = false;
      document.getElementById("pending-hint").hidden = me.data.active;
      show("success", "登入成功");
    } catch (err) {
      console.error(err);
      show("error", "登入失敗：" + (err && err.message ? err.message : err));
      retryBtn.hidden = false;
    }
  }

  retryBtn.addEventListener("click", async function () {
    await window.DrawingAuth.signOut();
    main();
  });
  main();
})();
