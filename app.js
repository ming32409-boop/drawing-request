// 進入點：登入 → 讀取帳號 → 顯示對應頁面
(function () {
  "use strict";
  var C = window.Common;
  var statusEl = document.getElementById("status");
  var retryBtn = document.getElementById("retry-btn");
  var views = { status: "view-status", new: "view-new", mine: "view-mine", review: "view-review" };
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
    if (name === "review") window.ReviewQueue.load();
  }

  function route() {
    if (!ready) return;
    var tab = location.hash.replace("#", "");
    if (tab === "review" && !window.ReviewQueue.canReview()) tab = "new";
    showView(views[tab] && tab !== "status" ? tab : "new");
  }

  // LINE 通知的連結會帶 ?tab=review 等參數，轉成頁面內的分頁
  function applyTabParam() {
    var params = new URLSearchParams(location.search);
    var tab = params.get("tab");
    if (!tab) return;
    params.delete("tab");
    var qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + "#" + tab);
  }

  async function main() {
    showView("status");
    C.showMessage(statusEl, "info", "登入中…");
    retryBtn.hidden = true;
    try {
      var session = await window.DrawingAuth.signIn();
      applyTabParam();
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

      var depts = await client.from("departments").select("id, name, manager_id")
        .eq("active", true).order("sort_order").order("id");
      if (depts.error) throw depts.error;
      var managed = depts.data.filter(function (d) { return d.manager_id === me.data.id; })
        .map(function (d) { return d.id; });

      var ctx = { client: client, profile: me.data, departments: depts.data, managedDepartmentIds: managed };
      window.RequestForm.init(ctx);
      window.MyRequests.init(ctx);
      window.ReviewQueue.init(ctx);

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
