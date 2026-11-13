// 文管發放：文管人員選擇發放方式並結案
(function () {
  "use strict";
  var C = window.Common;
  var METHODS = ["Email", "雲端連結", "紙本或實體", "其他"];
  var ctx, listEl, msgEl, refreshBtn, countEl;

  var FIELDS = [
    "id", "doc_no", "created_at", "status", "is_external", "department_id", "department_other",
    "data_types", "items", "purpose", "purpose_other", "formats", "format_other", "need_date",
    "external_note", "stage1_result", "stage1_at", "stage2_at",
    "applicant:profiles!requests_applicant_id_fkey(display_name)",
    "stage1_by_profile:profiles!requests_stage1_by_fkey(display_name)",
    "stage2_by_profile:profiles!requests_stage2_by_fkey(display_name)",
    "department:departments(name)",
  ].join(", ");

  function canIssue() {
    return Boolean(ctx.profile.is_dcc);
  }

  function row(dl, label, value) {
    if (value === null || value === undefined || value === "") return;
    dl.appendChild(C.el("dt", null, label));
    dl.appendChild(C.el("dd", null, value));
  }

  async function deliver(r, method, other, buttons) {
    buttons.forEach(function (b) { b.disabled = true; });
    try {
      var res = await ctx.client.rpc("deliver_request", {
        p_request_id: r.id, p_method: method, p_method_other: method === "其他" ? other : null,
      });
      if (res.error) {
        C.showMessage(msgEl, "error", r.doc_no + "：" + C.describeError(res.error));
        buttons.forEach(function (b) { b.disabled = false; });
        load();
        return;
      }
      C.showMessage(msgEl, "success", r.doc_no + " 已發放結案，已通知申請人。");
      C.triggerNotify();
      load();
    } catch (err) {
      C.showMessage(msgEl, "error", C.describeError(err));
      buttons.forEach(function (b) { b.disabled = false; });
    }
  }

  function renderItem(r) {
    var li = C.el("li", "request-item issue-item");
    var box = C.el("div", "review-body");

    var top = C.el("div", "item-top");
    top.appendChild(C.el("span", "doc-no", r.doc_no));
    if (r.is_external) top.appendChild(C.el("span", "badge external-badge", "外部用途"));
    top.appendChild(C.el("span", "badge status s-issue", "待文管發放"));
    box.appendChild(top);

    var dl = C.el("dl", "detail");
    var dept = (r.department ? r.department.name : "") + (r.department_other ? "（" + r.department_other + "）" : "");
    row(dl, "申請人", (r.applicant ? r.applicant.display_name : "") + "（" + dept + "）");
    row(dl, "申請時間", C.formatTime(r.created_at));
    row(dl, "申請資料別", r.data_types.join("、"));
    row(dl, "申請用途", r.purpose + (r.purpose_other ? "（" + r.purpose_other + "）" : ""));
    row(dl, "需求格式", r.formats.map(function (f) {
      return f === "其他" && r.format_other ? "其他（" + r.format_other + "）" : f;
    }).join("、"));
    row(dl, "需要日期", r.need_date ? String(r.need_date).slice(0, 10) : "");
    row(dl, "外發對象／備註", r.external_note);
    var s1 = r.stage1_by_profile ? r.stage1_by_profile.display_name : "";
    var s2 = r.stage2_by_profile ? r.stage2_by_profile.display_name : "";
    row(dl, "第一關", r.stage1_result + (s1 ? "（" + s1 + "）" : ""));
    row(dl, "第二關", "已核准" + (s2 ? "（" + s2 + "，" + C.formatTime(r.stage2_at) + "）" : ""));
    box.appendChild(dl);
    box.appendChild(C.el("pre", "items-full", r.items));

    var form = C.el("div", "issue-form");
    var selId = "method-" + r.id;
    var label = C.el("label", null, "發放方式");
    label.setAttribute("for", selId);
    var sel = C.el("select", "method");
    sel.id = selId;
    var blank = C.el("option", null, "請選擇");
    blank.value = "";
    sel.appendChild(blank);
    METHODS.forEach(function (m) { var o = C.el("option", null, m); o.value = m; sel.appendChild(o); });
    var other = C.el("input", "other method-other");
    other.type = "text";
    other.maxLength = 100;
    other.placeholder = "請說明發放方式";
    other.hidden = true;
    var err = C.el("p", "field-error");
    var btn = C.el("button", "primary deliver", "確認已發放");
    btn.type = "button";
    form.appendChild(label);
    form.appendChild(sel);
    form.appendChild(other);
    form.appendChild(err);
    form.appendChild(btn);
    box.appendChild(form);

    sel.addEventListener("change", function () {
      other.hidden = sel.value !== "其他";
      err.textContent = "";
    });
    other.addEventListener("input", function () { err.textContent = ""; });
    btn.addEventListener("click", function () {
      if (!sel.value) { err.textContent = "請選擇發放方式。"; sel.focus(); return; }
      var note = other.value.trim();
      if (sel.value === "其他" && !note) { err.textContent = "選「其他」時請說明發放方式。"; other.focus(); return; }
      if (!window.confirm("確認 " + r.doc_no + " 已用「" + (sel.value === "其他" ? note : sel.value) + "」發放？確認後會通知申請人並結案。")) return;
      deliver(r, sel.value, note, [btn]);
    });

    li.appendChild(box);
    return li;
  }

  function setCount(n) {
    countEl.textContent = n > 0 ? String(n) : "";
    countEl.hidden = n === 0;
  }

  async function load() {
    if (!canIssue()) return;
    refreshBtn.disabled = true;
    if (!listEl.children.length) C.showMessage(msgEl, "info", "載入中…");
    try {
      var res = await ctx.client.from("requests").select(FIELDS)
        .eq("status", "待文管發放")
        .order("created_at", { ascending: true }).limit(100);
      if (res.error) { C.showMessage(msgEl, "error", "無法載入：" + C.describeError(res.error)); return; }
      listEl.replaceChildren();
      setCount(res.data.length);
      if (!res.data.length) {
        if (!msgEl.classList.contains("success") && !msgEl.classList.contains("error")) {
          C.showMessage(msgEl, "info", "目前沒有待發放的申請。");
        }
        return;
      }
      if (msgEl.classList.contains("info")) C.hideMessage(msgEl);
      res.data.forEach(function (r) { listEl.appendChild(renderItem(r)); });
    } catch (err) {
      C.showMessage(msgEl, "error", "無法載入：" + C.describeError(err));
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function init(context) {
    ctx = context;
    listEl = document.getElementById("issue-list");
    msgEl = document.getElementById("issue-message");
    refreshBtn = document.getElementById("issue-refresh");
    countEl = document.getElementById("issue-count");
    document.querySelector('#tabs a[data-tab="issue"]').hidden = !canIssue();
    refreshBtn.addEventListener("click", function () { C.hideMessage(msgEl); load(); });
    if (canIssue()) load();
  }

  window.IssueQueue = { init: init, load: load, canIssue: function () { return ctx && canIssue(); } };
})();
