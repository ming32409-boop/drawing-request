// 進入點：登入 → 讀取帳號 → 顯示對應頁面
(function () {
  "use strict";
  var C = window.Common;
  var statusEl = document.getElementById("status");
  var retryBtn = document.getElementById("retry-btn");
  var views = { status: "view-status", new: "view-new", mine: "view-mine", review: "view-review", issue: "view-issue", admin: "view-admin" };
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
    updateTabsOverflow();
    if (name === "mine") window.MyRequests.load();
    if (name === "review") window.ReviewQueue.load();
    if (name === "issue") window.IssueQueue.load();
    if (name === "admin") window.AdminPanel.load();
  }

  // 分頁太多、手機放不下時：右邊淡出提示可以左右滑，並把目前的分頁捲進畫面
  function updateTabsOverflow() {
    var tabs = document.getElementById("tabs");
    if (tabs.hidden) return;
    var more = tabs.scrollWidth > tabs.clientWidth + 1;
    tabs.classList.toggle("more", more && tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 4);
    var active = tabs.querySelector("a.active");
    if (more && active) {
      var l = active.offsetLeft, r = l + active.offsetWidth;
      if (l < tabs.scrollLeft || r > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = r - tabs.clientWidth + 24;
    }
  }
  document.getElementById("tabs").addEventListener("scroll", function () {
    var tabs = this;
    tabs.classList.toggle("more", tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 4);
  }, { passive: true });
  window.addEventListener("resize", updateTabsOverflow);

  function route() {
    if (!ready) return;
    var tab = location.hash.replace("#", "");
    if (tab === "review" && !window.ReviewQueue.canReview()) tab = "new";
    if (tab === "issue" && !window.IssueQueue.canIssue()) tab = "new";
    if (tab === "admin" && !window.AdminPanel.canAdmin()) tab = "new";
    showView(views[tab] && tab !== "status" ? tab : "new");
  }

  // LINE 通知的連結會帶 ?tab=review&doc=單號 等參數：轉成頁面內的分頁，並記下要捲到哪張單
  function applyTabParam() {
    var params = new URLSearchParams(location.search);
    var tab = params.get("tab");
    if (!tab) return;
    var doc = params.get("doc");
    if (doc && /^DOC-\d{8}-\d{3,}$/.test(doc)) C.setPendingDoc(tab, doc);
    params.delete("tab");
    params.delete("doc");
    var qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + "#" + tab);
  }

  async function main() {
    showView("status");
    C.showMessage(statusEl, "info loading", "登入中…");
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
      document.getElementById("dash-link").hidden =
        !(me.data.active && (me.data.is_admin || me.data.is_issuer || me.data.is_dcc));

      if (!me.data.active) {
        C.showMessage(statusEl, "info", "登入成功：" + me.data.display_name + "（待啟用）");
        document.getElementById("pending-hint").hidden = false;
        C.triggerNotify();   // 送出「新帳號待啟用」通知給系統管理員（登入時已排入待發清單）
        return;
      }

      var depts = await client.from("departments").select("id, name, manager_id")
        .eq("active", true).order("sort_order").order("id");
      if (depts.error) throw depts.error;
      var managed = depts.data.filter(function (d) { return d.manager_id === me.data.id; })
        .map(function (d) { return d.id; });

      var ctx = { client: client, profile: me.data, departments: depts.data, managedDepartmentIds: managed };
      window.RequestForm.init(ctx);
      window.MyRequests.init(Object.assign({}, ctx, {
        // 複製內容重新申請：切到「新增申請」並帶入內容
        onCopy: function (r) {
          location.hash = "#new";
          showView("new");
          window.RequestForm.prefill(r);
        },
      }));
      window.ReviewQueue.init(ctx);
      window.IssueQueue.init(ctx);
      window.AdminPanel.init(ctx);

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
