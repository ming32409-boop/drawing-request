// 新增申請表單
(function () {
  "use strict";
  var C = window.Common;
  var EXTERNAL_PURPOSES = ["提供給客戶", "廠商詢價或發包"];

  var form, deptSelect, deptOther, purposeSelect, purposeOther, formatOther,
      externalNote, needDate, submitBtn, msg, ctx;

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
      p_items: form.elements.items.value.trim(),
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
    if (!d.p_items) e.items = "請填寫品號／零件名稱／規格。";
    if (!d.p_purpose) e.purpose = "請選擇申請用途。";
    else if (!purposeOther.hidden && !d.p_purpose_other) e.purpose = "選「其他」時請說明用途。";
    if (!d.p_formats.length) e.formats = "請至少選擇一種需求格式。";
    else if (!formatOther.hidden && !d.p_format_other) e.formats = "選「其他」時請說明格式。";
    if (d.p_need_date && d.p_need_date < C.todayTaipei()) e.need_date = "需要日期不能早於今天。";

    ["department", "data_types", "items", "purpose", "formats", "need_date"].forEach(function (k) {
      setError(k, e[k]);
    });
    return { data: d, errors: e };
  }

  async function onSubmit(event) {
    event.preventDefault();
    C.hideMessage(msg);
    var r = readAndValidate();
    var first = Object.keys(r.errors)[0];
    if (first) {
      C.showMessage(msg, "error", "請修正標示紅字的欄位。");
      var target = form.querySelector('.field-error[data-for="' + first + '"]');
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "送出中…";
    try {
      var res = await ctx.client.rpc("submit_request", r.data);
      if (res.error) {
        C.showMessage(msg, "error", C.describeError(res.error));
        return;
      }
      var docNo = res.data;
      form.reset();
      setDefaults();
      updateOthers();
      C.showMessage(msg, "success", "已送出申請，單號 " + docNo + "。可以在「我的申請」查看進度。");
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
      if (name === "department_other") name = "department";
      if (name === "purpose_other") name = "purpose";
      if (name === "format_other") name = "formats";
      setError(name, "");
    });
    form.addEventListener("submit", onSubmit);
    updateOthers();
  }

  window.RequestForm = { init: init };
})();
