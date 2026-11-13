// 進入點：登入 → 讀取帳號 → 顯示對應頁面
(function () {
  "use strict";
  var C = window.Common;
  var statusEl = document.getElementById("status");
  var retryBtn = document.getElementById("retry-btn");
  var views = { status: "view-status", new: "view-new", mine: "view-mine" };
  var ready = false;

  function showView(name) {
    Object.keys(views).forEach(function (k) {
      document.getElementById(views[k]).hidden = k !== name;
    });
    document.querySelectorAll("#tabs a").forEach(function (a) {
      a.classList.toggle("active", a.dataset.tab === name);
      if (a.dataset.tab === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (name === "mine") window.MyRequests.load();
  }

  function route() {
    if (!ready) return;
    var tab = location.hash.replace("#", "");
    showView(tab === "mine" ? "mine" : "new");
  }

  async function main() {
    showView("status");
    C.showMessage(statusEl, "info", "登入中…");
    retryBtn.hidden = true;
    try {
      var session = await window.DrawingAuth.signIn();
      var client = session.client;
      var me = await client.from("profiles")
        .select("id, display_name, is_admin, is_issuer, is_dcc, active")
        .eq("id", session.user.id).single();
      if (me.error) throw me.error;
      document.getElementById("who").textContent = me.data.display_name;

      if (!me.data.active) {
        C.showMessage(statusEl, "info", "登入成功：" + me.data.display_name + "（待啟用）");
        document.getElementById("pending-hint").hidden = false;
        return;
      }

      var depts = await client.from("departments").select("id, name")
        .eq("active", true).order("sort_order").order("id");
      if (depts.error) throw depts.error;

      var ctx = { client: client, profile: me.data, departments: depts.data };
      window.RequestForm.init(Object.assign({}, ctx, {
        onSubmitted: function () { /* 送出後留在表單，顯示單號 */ },
      }));
      window.MyRequests.init(ctx);

      document.getElementById("tabs").hidden = false;
      ready = true;
      route();
    } catch (err) {
      console.error(err);
      C.showMessage(statusEl, "error", "登入失敗：" + C.describeError(err));
      retryBtn.hidden = false;
    }
  }

  window.addEventListener("hashchange", route);
  retryBtn.addEventListener("click", async function () {
    await window.DrawingAuth.signOut();
    main();
  });
  main();
})();
