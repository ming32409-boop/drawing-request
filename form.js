// 新增申請表單
(function () {
  "use strict";
  var C = window.Common;
  var EXTERNAL_PURPOSES = ["提供給客戶", "廠商詢價或發包"];

  var form, deptSelect, deptOther, purposeSelect, purposeOther, formatOther,
      externalNote, needDate, submitBtn, msg, prefillNote, draftTimer, ctx;
  var Items = window.ItemEditor;

  // ---------- 草稿與上次的部門：只存在這台手機上，依登入帳號分開 ----------
  function draftKey() { return "drawing-request.draft." + ctx.profile.id; }
  function deptKey() { return "drawing-request.last-dept." + ctx.profile.id; }

  function snapshot() {
    return {
      department: deptSelect.value, department_other: deptOther.value,
      data_types: checked("data_types"), items: Items.getItems(),
      purpose: purposeSelect.value, purpose_other: purposeOther.value,
      formats: checked("formats"), format_other: formatOther.value,
      need_date: needDate.value, external_note: form.elements.external_note.value,
    };
  }
  // 只有部門被自動帶入、其他都沒填：不算草稿
  function isBlank(d) {
    var noItems = !Array.isArray(d.items) || d.items.every(function (x) { return !x.code && !x.name && !x.note; });
    return !d.data_types.length && noItems && !d.purpose && !d.formats.length &&
      !d.need_date && !d.external_note.trim();
  }
  function saveDraft() {
    var d = snapshot();
    if (isBlank(d)) { C.store.remove(draftKey()); return; }
    d.saved_at = new Date().toISOString();
    C.store.set(draftKey(), d);
  }
  function scheduleSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }
  function setChecks(name, values) {
    Array.prototype.forEach.call(form.querySelectorAll('input[name="' + name + '"]'), function (i) {
      i.checked = (values || []).indexOf(i.value) !== -1;
    });
  }
  function hasDept(id) {
    return ctx.departments.some(function (d) { return String(d.id) === String(id); });
  }
  // 帶入上次送出時選的部門
  function applyLastDept() {
    var last = C.store.get(deptKey());
    if (!last || !hasDept(last.id)) return;
    deptSelect.value = String(last.id);
    updateOthers();
    deptOther.value = last.other || "";
  }
  function applyDraft(d) {
    deptSelect.value = hasDept(d.department) ? String(d.department) : "";
    setChecks("data_types", d.data_types);
    setChecks("formats", d.formats);
    // 舊版草稿的品號是一整段文字
    Items.setItems(Array.isArray(d.items) ? d.items : Items.fromRequest({ items: d.items || "" }));
    purposeSelect.value = d.purpose || "";
    updateOthers();
    deptOther.value = d.department_other || "";
    purposeOther.value = d.purpose_other || "";
    formatOther.value = d.format_other || "";
    needDate.value = d.need_date && d.need_date >= C.todayTaipei() ? d.need_date : "";
    form.elements.external_note.value = d.external_note || "";
  }
  // 清空表單（保留上次的部門），並刪掉草稿
  function clearForm() {
    form.reset();
    ["department", "data_types", "items", "purpose", "formats", "need_date"].forEach(function (k) { setError(k, ""); });
    Items.reset();
    prefillNote.hidden = true;
    C.store.remove(draftKey());
    setDefaults();
    updateOthers();
    applyLastDept();
  }
  // 開啟頁面時：有沒送出的草稿就還原，並告訴使用者可以清除
  function restoreDraft() {
    var d = C.store.get(draftKey());
    if (!d || isBlank(d)) { applyLastDept(); return; }
    applyDraft(d);
    var when = d.saved_at ? C.formatTime(d.saved_at) : "";
    prefillNote.className = "message info prefill-note";
    prefillNote.replaceChildren();
    prefillNote.appendChild(C.el("span", "message-text", "已還原上次還沒送出的內容" + (when ? "（" + when + "）" : "") + "。"));
    var clear = C.el("button", "message-link", "清除重填");
    clear.type = "button";
    clear.id = "draft-clear";
    clear.addEventListener("click", function () { clearForm(); deptSelect.focus(); });
    prefillNote.appendChild(clear);
    prefillNote.hidden = false;
  }

  function checked(name) {
    return Array.prototype.slice.call(form.querySelectorAll('input[name="' + name + '"]:checked'))
      .map(function (i) { return i.value; });
  }

  function selectedDeptName() {
    var opt = deptSelect.options[deptSelect.selectedIndex];
    return opt && opt.value ? opt.textContent : "";
  }

  function setError(name, text) {
    var p = form.querySelector('.field-error[data-for="' + name + '"]');
    if (p) p.textContent = text || "";
    var input = form.elements[name];
    if (input && input.classList) input.classList.toggle("invalid", Boolean(text));
  }

  // 依選項顯示或隱藏「其他」說明欄與外部用途提示
  function updateOthers() {
    deptOther.hidden = selectedDeptName() !== "其他";
    purposeOther.hidden = purposeSelect.value !== "其他";
    formatOther.hidden = checked("formats").indexOf("其他") === -1;
    externalNote.hidden = EXTERNAL_PURPOSES.indexOf(purposeSelect.value) === -1;
  }

  function readAndValidate() {
    var d = {
      p_department_id: deptSelect.value ? Number(deptSelect.value) : null,
      p_department_other: deptOther.hidden ? null : deptOther.value.trim(),
      p_data_types: checked("data_types"),
      p_item_list: [],
      p_purpose: purposeSelect.value,
      p_purpose_other: purposeOther.hidden ? null : purposeOther.value.trim(),
      p_formats: checked("formats"),
      p_format_other: formatOther.hidden ? null : formatOther.value.trim(),
      p_need_date: needDate.value || null,
      p_external_note: form.elements.external_note.value.trim() || null,
    };
    var e = {};
    if (!d.p_department_id) e.department = "請選擇所屬部門。";
    else if (!deptOther.hidden && !d.p_department_other) e.department = "選「其他」時請填寫部門名稱。";
    if (!d.p_data_types.length) e.data_types = "請至少選擇一種申請資料別。";
    var items = Items.validate();
    d.p_item_list = items.items;
    if (!items.items.length) e.items = "請至少填寫 1 筆產品。";
    else if (items.count) e.items = "產品明細有 " + items.count + " 個地方要修正（見各筆紅字）。";
    if (!d.p_purpose) e.purpose = "請選擇申請用途。";
    else if (!purposeOther.hidden && !d.p_purpose_other) e.purpose = "選「其他」時請說明用途。";
    if (!d.p_formats.length) e.formats = "請至少選擇一種需求格式。";
    else if (!formatOther.hidden && !d.p_format_other) e.formats = "選「其他」時請說明格式。";
    if (d.p_need_date && d.p_need_date < C.todayTaipei()) e.need_date = "需要日期不能早於今天。";

    ["department", "data_types", "items", "purpose", "formats", "need_date"].forEach(function (k) {
      setError(k, e[k]);
    });
    return { data: d, errors: e, firstItem: items.first };
  }

  async function onSubmit(event) {
    event.preventDefault();
    C.hideMessage(msg);
    var r = readAndValidate();
    var first = Object.keys(r.errors)[0];
    if (first) {
      C.showMessage(msg, "error", "請修正標示紅字的欄位。");
      var target = first === "items" && r.firstItem ? r.firstItem : form.querySelector('.field-error[data-for="' + first + '"]');
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    try {
      var res = await ctx.client.rpc("submit_request_items", r.data);
      if (res.error) {
        C.showMessage(msg, "error", C.describeError(res.error));
        return;
      }
      var docNo = res.data;
      C.triggerNotify();
      C.store.set(deptKey(), { id: r.data.p_department_id, other: r.data.p_department_other || "" });
      clearTimeout(draftTimer);
      C.store.remove(draftKey());
      form.reset();
      setDefaults();
      updateOthers();
      applyLastDept();
      Items.reset();
      prefillNote.hidden = true;
      C.showMessage(msg, "success", "");
      var text = document.createElement("span");
      text.className = "message-text";
      text.appendChild(document.createTextNode("已送出申請，單號 "));
      var no = document.createElement("strong");
      no.className = "nowrap";
      no.textContent = docNo;
      text.appendChild(no);
      text.appendChild(document.createTextNode("。主管會收到 LINE 通知。"));
      msg.appendChild(text);
      var link = document.createElement("a");
      link.href = "#mine";
      link.className = "message-link";
      link.textContent = "查看進度";
      msg.appendChild(link);
      if (ctx.onSubmitted) ctx.onSubmitted(docNo);
    } catch (err) {
      C.showMessage(msg, "error", C.describeError(err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "送出申請";
    }
  }

  function setDefaults() {
    needDate.min = C.todayTaipei();
  }


  // 把一張舊申請的內容帶入表單（複製內容重新申請）。送出後會是一張新的申請。
  function prefill(r) {
    form.reset();
    ["department", "data_types", "items", "purpose", "formats", "need_date"].forEach(function (k) { setError(k, ""); });
    C.hideMessage(msg);
    var deptOk = ctx.departments.some(function (d) { return d.id === r.department_id; });
    deptSelect.value = deptOk ? String(r.department_id) : "";
    Array.prototype.forEach.call(form.querySelectorAll('input[name="data_types"]'), function (i) {
      i.checked = r.data_types.indexOf(i.value) !== -1;
    });
    Array.prototype.forEach.call(form.querySelectorAll('input[name="formats"]'), function (i) {
      i.checked = r.formats.indexOf(i.value) !== -1;
    });
    Items.setItems(Items.fromRequest(r));
    purposeSelect.value = r.purpose || "";
    updateOthers();
    deptOther.value = r.department_other || "";
    purposeOther.value = r.purpose_other || "";
    formatOther.value = r.format_other || "";
    // 需要日期已經過了就不帶入
    var need = r.need_date ? String(r.need_date).slice(0, 10) : "";
    needDate.value = need && need >= C.todayTaipei() ? need : "";
    form.elements.external_note.value = r.external_note || "";
    setDefaults();

    var reason = r.stage2_reason || r.stage1_reason;
    prefillNote.className = "message info prefill-note";
    prefillNote.textContent = "已帶入 " + r.doc_no + " 的內容，請修改後送出，會成為一張新的申請。" +
      (reason ? "上次的駁回原因：" + reason : "");
    prefillNote.hidden = false;
    saveDraft();
    window.scrollTo(0, 0);
  }

  function init(context) {
    ctx = context;
    form = document.getElementById("request-form");
    deptSelect = document.getElementById("department");
    deptOther = document.getElementById("department_other");
    purposeSelect = document.getElementById("purpose");
    purposeOther = document.getElementById("purpose_other");
    formatOther = document.getElementById("format_other");
    externalNote = document.getElementById("external-note");
    needDate = document.getElementById("need_date");
    submitBtn = document.getElementById("submit-btn");
    msg = document.getElementById("form-message");
    prefillNote = document.getElementById("prefill-note");

    ctx.departments.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = String(d.id);
      opt.textContent = d.name;
      deptSelect.appendChild(opt);
    });

    setDefaults();
    form.addEventListener("change", function () {
      if (msg.classList.contains("error")) C.hideMessage(msg);
      updateOthers();
    });
    form.addEventListener("input", function (ev) {
      if (msg.classList.contains("error")) C.hideMessage(msg);
      var name = ev.target.name;
      if (ev.target.closest && ev.target.closest(".item-card")) name = "items";   // 改了任一筆就清掉「產品明細」的總提示
      if (name === "department_other") name = "department";
      if (name === "purpose_other") name = "purpose";
      if (name === "format_other") name = "formats";
      setError(name, "");
    });
    form.addEventListener("submit", onSubmit);
    Items.init(document.getElementById("item-list"), document.getElementById("item-add"), document.getElementById("items-count"), {
      client: ctx.client,
      onChange: scheduleSave,   // 新增、刪除、從主檔帶入時也要存草稿
    });
    // 每次修改都自動暫存草稿（停手 0.4 秒後存）
    form.addEventListener("input", scheduleSave);
    form.addEventListener("change", scheduleSave);
    updateOthers();
    restoreDraft();
  }

  window.RequestForm = { init: init, prefill: prefill };
})();
