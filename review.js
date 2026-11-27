// 待我簽核：部門主管（第一關）、核發主管（第二關）
(function () {
  "use strict";
  var C = window.Common;
  var ctx, listEl, msgEl, refreshBtn, countEl;
  // 常用的駁回原因：點一下帶入，可以再補充。用字統一，看板的「常見駁回原因」也比較準
  var REASONS = ["用途說明不足，請補充", "品號或規格有誤，請確認", "需求格式不適當，請調整", "請先與部門主管確認需求"];

  var FIELDS = [
    "id", "doc_no", "created_at", "status", "is_external", "department_id", "department_other",
    "data_types", "items", "purpose", "purpose_other", "formats", "format_other", "need_date",
    "external_note", "stage1_result", "stage1_at",
    "applicant:profiles!requests_applicant_id_fkey(display_name)",
    "stage1_by_profile:profiles!requests_stage1_by_fkey(display_name)",
    "department:departments(name)",
    "request_items(seq, code, name, note, from_master)",
  ].join(", ");

  function canReview() {
    return ctx.managedDepartmentIds.length > 0 || ctx.profile.is_issuer;
  }

  function row(dl, label, value) {
    if (value === null || value === undefined || value === "") return;
    dl.appendChild(C.el("dt", null, label));
    dl.appendChild(C.el("dd", null, value));
  }

  async function act(r, approve, reason, buttons) {
    buttons.forEach(function (b) { b.disabled = true; });
    try {
      var res = await ctx.client.rpc("review_request", {
        p_request_id: r.id, p_approve: approve, p_reason: approve ? null : reason,
      });
      if (res.error) {
        C.showMessage(msgEl, "error", r.doc_no + "：" + C.describeError(res.error));
        buttons.forEach(function (b) { b.disabled = false; });
        return;
      }
      C.showMessage(msgEl, "success", r.doc_no + (approve ? " 已核准，已通知下一關。" : " 已駁回，已通知申請人。"));
      C.triggerNotify();
      load();
    } catch (err) {
      C.showMessage(msgEl, "error", C.describeError(err));
      buttons.forEach(function (b) { b.disabled = false; });
    }
  }

  function renderItem(r) {
    var stage = r.status === "申請主管簽核中" ? "第一關・部門主管" : "第二關・核發主管";
    var li = C.el("li", "request-item review-item");
    li.dataset.doc = r.doc_no;
    var box = C.el("div", "review-body");

    var top = C.el("div", "item-top");
    top.appendChild(C.el("span", "doc-no", r.doc_no));
    if (r.is_external) top.appendChild(C.el("span", "badge external-badge", "外部用途"));
    top.appendChild(C.el("span", "badge status s-review", stage));
    box.appendChild(top);

    // 摘要：誰申請、要什麼、急不急；動作按鈕直接可按，完整明細收在「查看明細」
    var deptName = (r.department ? r.department.name : "") + (r.department_other ? "（" + r.department_other + "）" : "");
    box.appendChild(C.el("p", "item-summary", C.itemsSummary(r)));
    box.appendChild(C.el("p", "item-meta", (r.applicant ? r.applicant.display_name : "") + "（" + deptName + "）・" +
      (r.purpose + (r.purpose_other ? "（" + r.purpose_other + "）" : "")) + "・" + r.formats.join("、")));
    var u = C.urgency(r.status === "申請主管簽核中" ? r.created_at : (r.stage1_at || r.created_at), r.need_date);
    li.urgency = u;
    box.appendChild(u.el);

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
    if (r.status === "核發主管簽核中") {
      var who = r.stage1_by_profile ? r.stage1_by_profile.display_name : "";
      row(dl, "第一關", r.stage1_result + (who ? "（" + who + "）" : ""));
    }
    var more = C.el("div", "card-detail");
    more.appendChild(dl);
    more.appendChild(C.itemTable(r));
    box.appendChild(C.detailToggle(more, "review-detail-" + r.id));
    box.appendChild(more);

    var actions = C.el("div", "review-actions");
    var approveBtn = C.el("button", "primary approve", "核准");
    approveBtn.type = "button";
    var rejectBtn = C.el("button", "danger reject", "駁回");
    rejectBtn.type = "button";
    actions.appendChild(rejectBtn);
    actions.appendChild(approveBtn);
    box.appendChild(actions);

    var rejectBox = C.el("div", "reject-box");
    rejectBox.hidden = true;
    var label = C.el("label", null, "駁回原因（必填，會私訊給申請人）");
    var reasonId = "reason-" + r.id;
    label.setAttribute("for", reasonId);
    var reason = C.el("textarea");
    reason.id = reasonId;
    reason.rows = 3;
    reason.maxLength = 500;
    reason.placeholder = "例如：用途說明不足，請補充後重新申請";
    var reasonErr = C.el("p", "field-error");
    var confirmReject = C.el("button", "danger confirm-reject", "確認駁回");
    confirmReject.type = "button";
    var quick = C.el("div", "reason-chips");
    quick.setAttribute("role", "group");
    quick.setAttribute("aria-label", "常用原因");
    REASONS.forEach(function (text) {
      var b = C.el("button", "reason-chip", text);
      b.type = "button";
      b.addEventListener("click", function () {
        var cur = reason.value.trim();
        if (cur.indexOf(text) === -1) reason.value = cur ? cur + "；" + text : text;
        reasonErr.textContent = "";
        reason.classList.remove("invalid");
        reason.focus();
        reason.setSelectionRange(reason.value.length, reason.value.length);
      });
      quick.appendChild(b);
    });
    rejectBox.appendChild(label);
    rejectBox.appendChild(quick);
    rejectBox.appendChild(reason);
    rejectBox.appendChild(reasonErr);
    rejectBox.appendChild(confirmReject);
    box.appendChild(rejectBox);

    var buttons = [approveBtn, rejectBtn, confirmReject];
    approveBtn.addEventListener("click", async function () {
      if (!(await C.confirm({ title: "核准 " + r.doc_no + "？", body: C.itemsSummary(r) + "\n" +
        (r.applicant ? r.applicant.display_name : "") + "・" + r.purpose + (r.is_external ? "（外部用途）" : ""), ok: "核准" }))) return;
      act(r, true, null, buttons);
    });
    rejectBtn.addEventListener("click", function () {
      rejectBox.hidden = !rejectBox.hidden;
      if (!rejectBox.hidden) reason.focus();
    });
    confirmReject.addEventListener("click", function () {
      var text = reason.value.trim();
      if (!text) { reasonErr.textContent = "請填寫駁回原因。"; reason.focus(); return; }
      reasonErr.textContent = "";
      act(r, false, text, buttons);
    });

    li.appendChild(box);
    return li;
  }

  function setCount(n) {
    countEl.textContent = n > 0 ? String(n) : "";
    countEl.hidden = n === 0;
  }

  async function load() {
    if (!canReview()) return;
    refreshBtn.disabled = true;
    if (!listEl.children.length) C.showMessage(msgEl, "info loading", "載入中…");
    try {
      var queries = [];
      if (ctx.managedDepartmentIds.length) {
        queries.push(ctx.client.from("requests").select(FIELDS)
          .eq("status", "申請主管簽核中").in("department_id", ctx.managedDepartmentIds)
          .order("created_at", { ascending: true }).limit(100));
      }
      if (ctx.profile.is_issuer) {
        queries.push(ctx.client.from("requests").select(FIELDS)
          .eq("status", "核發主管簽核中")
          .order("created_at", { ascending: true }).limit(100));
      }
      var results = await Promise.all(queries);
      var rows = [];
      for (var i = 0; i < results.length; i++) {
        if (results[i].error) { C.showMessage(msgEl, "error", "無法載入：" + C.describeError(results[i].error)); return; }
        rows = rows.concat(results[i].data);
      }
      rows.sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
      listEl.replaceChildren();
      setCount(rows.length);
      if (!rows.length) {
        if (!msgEl.classList.contains("success")) C.showEmpty(msgEl, "目前沒有待簽核的申請", "有新的申請時，會用 LINE 通知你。");
        return;
      }
      if (msgEl.classList.contains("info") || msgEl.classList.contains("empty-state")) C.hideMessage(msgEl);
      // 依急迫度排序：需要日期已到／快到 → 等超過 2 天 → 等最久的
      rows.map(function (r) { return renderItem(r); })
        .sort(function (a, b) { return C.compareUrgency(a.urgency, b.urgency); })
        .forEach(function (li) { listEl.appendChild(li); });
      C.revealDoc("review", listEl, msgEl);
    } catch (err) {
      C.showMessage(msgEl, "error", "無法載入：" + C.describeError(err));
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function init(context) {
    ctx = context;
    listEl = document.getElementById("review-list");
    msgEl = document.getElementById("review-message");
    refreshBtn = document.getElementById("review-refresh");
    countEl = document.getElementById("review-count");
    document.querySelector('#tabs a[data-tab="review"]').hidden = !canReview();
    refreshBtn.addEventListener("click", function () { C.hideMessage(msgEl); load(); });
    if (canReview()) load();
  }

  window.ReviewQueue = { init: init, load: load, canReview: function () { return ctx && canReview(); } };
})();
