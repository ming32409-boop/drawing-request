// 管理設定（系統管理員）：開通帳號、設定角色、部門與部門主管
// 權限與防呆都在資料庫：只有系統管理員能改；至少保留一位管理員；部門主管必須是已啟用帳號；
// 停用部門主管前要先換人。畫面只負責操作與顯示資料庫回傳的原因。
(function () {
  "use strict";
  var C = window.Common;
  var ctx, users = [], depts = [], openId = null;
  var msgEl, countEl, refreshBtn, searchEl;

  var ROLES = [
    ["active", "啟用帳號", "停用後不能使用系統；過去的申請與簽核紀錄會保留。"],
    ["is_admin", "系統管理員", "開通帳號、設定角色與部門。"],
    ["is_issuer", "核發主管（第二關）", "簽核所有申請的第二關，一般是開發部主管。"],
    ["is_dcc", "文管", "發放資料並結案，可以有多位。"],
  ];

  function canAdmin() {
    return Boolean(ctx && ctx.profile.active && ctx.profile.is_admin);
  }
  function byName(a, b) { return a.display_name.localeCompare(b.display_name, "zh-Hant"); }
  function managedBy(id) {
    return depts.filter(function (d) { return d.active && d.manager_id === id; }).map(function (d) { return d.name; });
  }
  function userById(id) { return users.find(function (u) { return u.id === id; }); }
  function errText(err) {
    if (err && err.code === "23505") return "已經有這個部門名稱。";
    return C.describeError(err);
  }
  function show(type, text) { C.showMessage(msgEl, type, text); }

  // ---------- 待啟用 ----------
  function renderPending() {
    var box = document.getElementById("admin-pending");
    var list = document.getElementById("admin-pending-list");
    var pending = users.filter(function (u) { return !u.active; })
      .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    list.replaceChildren();
    countEl.textContent = pending.length ? String(pending.length) : "";
    countEl.hidden = !pending.length;
    document.getElementById("admin-pending-n").textContent = pending.length ? String(pending.length) : "";
    box.hidden = !pending.length;
    pending.forEach(function (u) {
      var li = C.el("li", "pending-row");
      li.dataset.id = u.id;
      var info = C.el("div", "pending-info");
      info.appendChild(C.el("span", "user-name", u.display_name));
      info.appendChild(C.el("span", "user-meta", "首次登入 " + C.formatTime(u.created_at)));
      li.appendChild(info);
      var btn = C.el("button", "primary small activate", "啟用");
      btn.type = "button";
      btn.addEventListener("click", function () { activate(u, btn); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  async function activate(u, btn) {
    btn.disabled = true;
    var res = await ctx.client.from("profiles").update({ active: true }).eq("id", u.id).select("id");
    if (res.error || !res.data || !res.data.length) {
      btn.disabled = false;
      show("error", "無法啟用 " + u.display_name + "：" + (res.error ? errText(res.error) : "沒有權限。"));
      return;
    }
    C.triggerNotify();   // 送出「帳號已開通」通知給本人
    openId = u.id;
    await load();
    show("success", "已啟用 " + u.display_name + "，系統已用 LINE 通知對方。接著請在下方設定角色。");
    var row = document.querySelector('#admin-user-list .user-row[data-id="' + u.id + '"]');
    if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // ---------- 使用者與角色 ----------
  function tags(u) {
    var box = C.el("span", "user-tags");
    if (u.is_admin) box.appendChild(C.el("span", "badge role-admin", "系統管理員"));
    if (u.is_issuer) box.appendChild(C.el("span", "badge", "核發主管"));
    if (u.is_dcc) box.appendChild(C.el("span", "badge", "文管"));
    managedBy(u.id).forEach(function (n) { box.appendChild(C.el("span", "badge", n + "主管")); });
    if (!box.children.length) box.appendChild(C.el("span", "user-meta", "一般申請人"));
    return box;
  }

  function renderUserRow(u) {
    var li = C.el("li", "user-row");
    li.dataset.id = u.id;
    var head = C.el("button", "user-head");
    head.type = "button";
    var name = C.el("span", "user-name", u.display_name);
    if (u.id === ctx.profile.id) name.appendChild(C.el("span", "you", "（你）"));
    head.appendChild(name);
    head.appendChild(tags(u));
    var chev = C.el("span", "chev");
    chev.setAttribute("aria-hidden", "true");
    head.appendChild(chev);
    li.appendChild(head);

    var edit = C.el("div", "user-edit");
    var editId = "user-edit-" + u.id;
    edit.id = editId;
    head.setAttribute("aria-controls", editId);
    ROLES.forEach(function (r) {
      var row = C.el("label", "switch-row");
      var text = C.el("span", "switch-text");
      text.appendChild(C.el("span", "switch-title", r[1]));
      text.appendChild(C.el("span", "switch-desc", r[2]));
      row.appendChild(text);
      var sw = C.el("input", "switch");
      sw.type = "checkbox";
      sw.setAttribute("role", "switch");
      sw.dataset.field = r[0];
      sw.checked = Boolean(u[r[0]]);
      sw.addEventListener("change", function () { setRole(u, r, sw); });
      row.appendChild(sw);
      edit.appendChild(row);
    });
    var m = managedBy(u.id);
    edit.appendChild(C.el("p", "manager-note", m.length
      ? "部門主管：" + m.join("、") + "（在「部門與主管」更換）"
      : "不是任何部門的主管（在「部門與主管」設定）"));
    li.appendChild(edit);

    var open = openId === u.id;
    head.setAttribute("aria-expanded", String(open));
    edit.hidden = !open;
    head.addEventListener("click", function () {
      var nowOpen = edit.hidden;
      // 一次只展開一位：先收起其他人
      if (nowOpen) {
        document.querySelectorAll('#admin-user-list .user-head[aria-expanded="true"]').forEach(function (h) {
          h.setAttribute("aria-expanded", "false");
          h.nextElementSibling.hidden = true;
        });
      }
      edit.hidden = !nowOpen;
      head.setAttribute("aria-expanded", String(nowOpen));
      openId = nowOpen ? u.id : null;
    });
    return li;
  }

  async function setRole(u, role, sw) {
    var field = role[0], value = sw.checked, self = u.id === ctx.profile.id;
    var confirmText = null;
    if (field === "active" && !value) confirmText = "確定停用 " + u.display_name + "？停用後對方不能再使用系統。";
    if (field === "is_admin" && !value && self) confirmText = "確定拿掉你自己的系統管理員身分？拿掉後你就不能再進入管理設定。";
    if (confirmText && !window.confirm(confirmText)) { sw.checked = !value; return; }
    sw.disabled = true;
    var patch = {};
    patch[field] = value;
    var res = await ctx.client.from("profiles").update(patch).eq("id", u.id).select("id");
    sw.disabled = false;
    if (res.error || !res.data || !res.data.length) {
      sw.checked = !value;
      show("error", res.error ? errText(res.error) : "沒有權限修改。");
      return;
    }
    u[field] = value;
    var word = value ? "已開啟" : "已關閉";
    show("success", u.display_name + "：" + role[1] + " " + word + "。" +
      (self ? "你自己的權限變更，重新開啟頁面後生效。" : ""));
    if (field === "active") { openId = null; renderAll(); return; }
    var row = sw.closest(".user-row");
    row.querySelector(".user-tags").replaceWith(tags(u));
  }

  function renderUsers() {
    var list = document.getElementById("admin-user-list");
    var q = searchEl.value.trim().toLowerCase();
    var active = users.filter(function (u) { return u.active; }).sort(byName);
    document.getElementById("admin-users-n").textContent = String(active.length);
    list.replaceChildren();
    var shown = active.filter(function (u) { return !q || u.display_name.toLowerCase().indexOf(q) !== -1; });
    shown.forEach(function (u) { list.appendChild(renderUserRow(u)); });
    if (!shown.length) list.appendChild(C.el("li", "empty", q ? "找不到符合的名字。" : "還沒有已啟用的帳號。"));
  }

  // ---------- 部門與部門主管 ----------
  function renderDepts() {
    var list = document.getElementById("admin-dept-list");
    list.replaceChildren();
    var candidates = users.filter(function (u) { return u.active; }).sort(byName);
    depts.forEach(function (d) {
      var li = C.el("li", "dept-row" + (d.active ? "" : " is-off"));
      li.dataset.id = String(d.id);
      var top = C.el("div", "dept-top");
      top.appendChild(C.el("span", "dept-name", d.name));
      if (!d.active) top.appendChild(C.el("span", "badge s-withdrawn", "已停用"));
      else if (!d.manager_id) top.appendChild(C.el("span", "badge s-issue", "未設定主管"));
      li.appendChild(top);

      var selId = "dept-mgr-" + d.id;
      var label = C.el("label", "dept-label", "部門主管");
      label.setAttribute("for", selId);
      var sel = C.el("select", "dept-manager");
      sel.id = selId;
      var none = C.el("option", null, "（未設定）");
      none.value = "";
      sel.appendChild(none);
      candidates.forEach(function (u) {
        var o = C.el("option", null, u.display_name);
        o.value = u.id;
        sel.appendChild(o);
      });
      sel.value = d.manager_id && userById(d.manager_id) && userById(d.manager_id).active ? d.manager_id : "";
      sel.addEventListener("change", function () { setManager(d, sel); });
      li.appendChild(label);
      li.appendChild(sel);

      var row = C.el("label", "switch-row compact");
      var text = C.el("span", "switch-text");
      text.appendChild(C.el("span", "switch-title", "啟用部門"));
      text.appendChild(C.el("span", "switch-desc", "停用後，申請表的部門選單不再出現。"));
      row.appendChild(text);
      var sw = C.el("input", "switch");
      sw.type = "checkbox";
      sw.setAttribute("role", "switch");
      sw.checked = d.active;
      sw.addEventListener("change", function () { setDeptActive(d, sw); });
      row.appendChild(sw);
      li.appendChild(row);
      list.appendChild(li);
    });
  }

  async function setManager(d, sel) {
    var before = d.manager_id || "";
    sel.disabled = true;
    var res = await ctx.client.from("departments").update({ manager_id: sel.value || null }).eq("id", d.id).select("id");
    sel.disabled = false;
    if (res.error || !res.data || !res.data.length) {
      sel.value = before;
      show("error", res.error ? errText(res.error) : "沒有權限修改。");
      return;
    }
    d.manager_id = sel.value || null;
    var who = d.manager_id ? userById(d.manager_id).display_name : "";
    show("success", d.manager_id
      ? d.name + " 的部門主管已設為 " + who + "。還沒簽核的申請會改由 " + who + " 簽核。"
      : d.name + " 已取消部門主管。設定新主管前，選這個部門的申請會無法送出。");
    renderAll();
  }

  async function setDeptActive(d, sw) {
    var value = sw.checked;
    if (!value && !window.confirm("確定停用「" + d.name + "」？申請表將不再出現這個部門。")) { sw.checked = true; return; }
    sw.disabled = true;
    var res = await ctx.client.from("departments").update({ active: value }).eq("id", d.id).select("id");
    sw.disabled = false;
    if (res.error || !res.data || !res.data.length) {
      sw.checked = !value;
      show("error", res.error ? errText(res.error) : "沒有權限修改。");
      return;
    }
    d.active = value;
    show("success", "「" + d.name + "」已" + (value ? "啟用" : "停用") + "。");
    renderAll();
  }

  async function addDept(ev) {
    ev.preventDefault();
    var input = document.getElementById("admin-dept-name");
    var err = document.getElementById("admin-dept-error");
    var name = input.value.trim();
    err.textContent = "";
    input.classList.remove("invalid");
    if (!name) { err.textContent = "請填寫部門名稱。"; input.classList.add("invalid"); input.focus(); return; }
    if (depts.some(function (d) { return d.name === name; })) {
      err.textContent = "已經有這個部門名稱。"; input.classList.add("invalid"); input.focus(); return;
    }
    // 排在「其他」（99）前面
    var order = depts.reduce(function (m, d) { return d.sort_order < 99 ? Math.max(m, d.sort_order) : m; }, 0) + 1;
    var res = await ctx.client.from("departments").insert({ name: name, sort_order: Math.min(order, 98) }).select("id");
    if (res.error) { err.textContent = errText(res.error); input.classList.add("invalid"); return; }
    input.value = "";
    await load();
    show("success", "已新增「" + name + "」。請記得設定部門主管。");
  }

  // ---------- 載入 ----------
  function renderAll() {
    renderPending();
    renderUsers();
    renderDepts();
  }

  async function load() {
    if (!canAdmin()) return;
    refreshBtn.disabled = true;
    try {
      var r = await Promise.all([
        ctx.client.from("profiles").select("id, display_name, is_admin, is_issuer, is_dcc, active, created_at"),
        ctx.client.from("departments").select("id, name, sort_order, active, manager_id").order("sort_order").order("id"),
      ]);
      var failed = r[0].error || r[1].error;
      if (failed) { show("error", "無法載入：" + errText(failed)); return; }
      users = r[0].data;
      depts = r[1].data;
      renderAll();
    } catch (err) {
      show("error", "無法載入：" + errText(err));
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function selectTab(which) {
    var usersTab = document.getElementById("admin-tab-users"), deptsTab = document.getElementById("admin-tab-depts");
    usersTab.setAttribute("aria-selected", String(which === "users"));
    deptsTab.setAttribute("aria-selected", String(which === "depts"));
    document.getElementById("admin-users").hidden = which !== "users";
    document.getElementById("admin-depts").hidden = which !== "depts";
  }

  function init(context) {
    ctx = context;
    msgEl = document.getElementById("admin-message");
    countEl = document.getElementById("admin-count");
    refreshBtn = document.getElementById("admin-refresh");
    searchEl = document.getElementById("admin-search");
    document.querySelector('#tabs a[data-tab="admin"]').hidden = !canAdmin();
    if (!canAdmin()) return;
    refreshBtn.addEventListener("click", function () { C.hideMessage(msgEl); load(); });
    searchEl.addEventListener("input", renderUsers);
    document.getElementById("admin-tab-users").addEventListener("click", function () { selectTab("users"); });
    document.getElementById("admin-tab-depts").addEventListener("click", function () { selectTab("depts"); });
    document.getElementById("admin-dept-add").addEventListener("submit", addDept);
    load();   // 先載入一次，分頁上顯示待啟用人數
  }

  window.AdminPanel = { init: init, load: load, canAdmin: canAdmin };
})();
