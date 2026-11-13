// 我的申請：列表、明細、簽核紀錄、撤回
(function () {
  "use strict";
  var C = window.Common;
  var LIMIT = 50;
  var ctx, listEl, msgEl, refreshBtn;

  var REQUEST_FIELDS = [
    "id", "doc_no", "created_at", "status", "is_external",
    "department_other", "data_types", "items", "purpose", "purpose_other",
    "formats", "format_other", "need_date", "external_note",
    "stage1_result", "stage1_reason", "stage2_result", "stage2_reason",
    "delivery_method", "delivery_method_other", "delivered_at",
    "department:departments(name)",
  ].join(", ");

  function row(dl, label, value) {
    if (value === null || value === undefined || value === "") return;
    dl.appendChild(C.el("dt", null, label));
    dl.appendChild(C.el("dd", null, value));
  }

  function withOther(value, other) {
    return other ? value + "（" + other + "）" : value;
  }

  function formatsText(r) {
    return r.formats.map(function (f) { return f === "其他" && r.format_other ? "其他（" + r.format_other + "）" : f; }).join("、");
  }

  async function loadEvents(r, box) {
    box.replaceChildren(C.el("p", "muted", "載入簽核紀錄…"));
    var res = await ctx.client.from("request_events")
      .select("action, stage, note, created_at, actor:profiles!request_events_actor_id_fkey(display_name)")
      .eq("request_id", r.id).order("id", { ascending: true });
    box.replaceChildren();
    if (res.error) {
      box.appendChild(C.el("p", "muted", "無法載入簽核紀錄：" + C.describeError(res.error)));
      return;
    }
    var ol = C.el("ol", "timeline");
    res.data.forEach(function (ev) {
      var stage = ev.stage === 1 ? "第一關" : ev.stage === 2 ? "第二關" : ev.stage === 3 ? "文管" : "";
      var li = C.el("li");
      li.appendChild(C.el("span", "t-time", C.formatTime(ev.created_at)));
      var who = ev.actor ? ev.actor.display_name : "";
      li.appendChild(C.el("span", "t-what", (stage ? stage + " " : "") + ev.action + (who ? "｜" + who : "")));
      if (ev.note) li.appendChild(C.el("span", ev.action === "駁回" ? "t-note reject" : "t-note", ev.note));
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  async function withdraw(r, btn) {
    if (!window.confirm("確定要撤回申請 " + r.doc_no + " 嗎？撤回後不能復原。")) return;
    btn.disabled = true;
    var res = await ctx.client.rpc("withdraw_request", { p_request_id: r.id });
    if (res.error) {
      btn.disabled = false;
      C.showMessage(msgEl, "error", C.describeError(res.error));
      return;
    }
    C.showMessage(msgEl, "success", "已撤回 " + r.doc_no + "。");
    load();
  }

  function renderItem(r) {
    var li = C.el("li", "request-item");
    var head = C.el("button", "item-head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    var top = C.el("div", "item-top");
    top.appendChild(C.el("span", "doc-no", r.doc_no));
    if (r.is_external) top.appendChild(C.el("span", "badge external-badge", "外部用途"));
    top.appendChild(C.el("span", "badge status " + (C.STATUS_CLASS[r.status] || ""), r.status));
    head.appendChild(top);
    var firstLine = r.items.split("\n")[0];
    var more = r.items.split("\n").length - 1;
    head.appendChild(C.el("p", "item-summary", firstLine + (more > 0 ? "（另 " + more + " 筆）" : "")));
    head.appendChild(C.el("p", "item-meta", r.data_types.join("、") + "｜" + C.formatTime(r.created_at)));
    li.appendChild(head);

    var detail = C.el("div", "item-detail");
    detail.hidden = true;
    var dl = C.el("dl", "detail");
    row(dl, "所屬部門", withOther(r.department ? r.department.name : "", r.department_other));
    row(dl, "申請資料別", r.data_types.join("、"));
    row(dl, "申請用途", withOther(r.purpose, r.purpose_other));
    row(dl, "需求格式", formatsText(r));
    row(dl, "需要日期", r.need_date ? String(r.need_date).slice(0, 10) : "");
    row(dl, "外發對象／備註", r.external_note);
    row(dl, "第一關", r.stage1_result + (r.stage1_reason ? "：" + r.stage1_reason : ""));
    row(dl, "第二關", r.stage2_result + (r.stage2_reason ? "：" + r.stage2_reason : ""));
    if (r.delivered_at) {
      row(dl, "發放方式", withOther(r.delivery_method, r.delivery_method_other));
      row(dl, "發放時間", C.formatTime(r.delivered_at));
    }
    detail.appendChild(dl);
    var itemsBox = C.el("pre", "items-full", r.items);
    detail.appendChild(itemsBox);
    var events = C.el("div", "events");
    detail.appendChild(events);
    if (r.status === "申請主管簽核中" && r.stage1_result === "待簽核") {
      var wbtn = C.el("button", "danger", "撤回申請");
      wbtn.type = "button";
      wbtn.addEventListener("click", function () { withdraw(r, wbtn); });
      detail.appendChild(wbtn);
    }
    li.appendChild(detail);

    var loaded = false;
    head.addEventListener("click", function () {
      detail.hidden = !detail.hidden;
      head.setAttribute("aria-expanded", String(!detail.hidden));
      if (!detail.hidden && !loaded) { loaded = true; loadEvents(r, events); }
    });
    return li;
  }

  async function load() {
    refreshBtn.disabled = true;
    if (!listEl.children.length) C.showMessage(msgEl, "info", "載入中…");
    try {
      var res = await ctx.client.from("requests").select(REQUEST_FIELDS)
        .eq("applicant_id", ctx.profile.id)
        .order("created_at", { ascending: false }).limit(LIMIT);
      if (res.error) { C.showMessage(msgEl, "error", "無法載入：" + C.describeError(res.error)); return; }
      listEl.replaceChildren();
      if (!res.data.length) { C.showMessage(msgEl, "info", "還沒有申請紀錄。"); return; }
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
    listEl = document.getElementById("mine-list");
    msgEl = document.getElementById("mine-message");
    refreshBtn = document.getElementById("mine-refresh");
    refreshBtn.addEventListener("click", function () { C.hideMessage(msgEl); load(); });
  }

  window.MyRequests = { init: init, load: load };
})();
