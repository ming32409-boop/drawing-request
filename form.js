// 新增申請表單
(function () {
  "use strict";
  var C = window.Common;
  var EXTERNAL_PURPOSES = ["提供給客戶", "廠商詢價或發包"];

  var form, deptSelect, deptOther, purposeSelect, purposeOther, formatOther,
      externalNote, needDate, submitBtn, msg, itemsWarn, prefillNote, blurTimer, draftTimer, ctx;

  // ---------- 草稿與上次的部門：只存在這台手機上，依登入帳號分開 ----------
  function draftKey() { return "drawing-request.draft." + ctx.profile.id; }
  function deptKey() { return "drawing-request.last-dept." + ctx.profile.id; }

  function snapshot() {
    return {
      department: deptSelect.value, department_other: deptOther.value,
      data_types: checked("data_types"), items: form.elements.items.value,
      purpose: purposeSelect.value, purpose_other: purposeOther.value,
      formats: checked("formats"), format_other: formatOther.value,
      need_date: needDate.value, external_note: form.elements.external_note.value,
    };
  }
  // 只有部門被自動帶入、其他都沒填：不算草稿
  function isBlank(d) {
    return !d.data_types.length && !d.items.trim() && !d.purpose && !d.formats.length &&
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
    form.elements.items.value = d.items || "";
    purposeSelect.value = d.purpose || "";
    updateOthers();
    deptOther.value = d.department_other || "";
    purposeOther.value = d.purpose_other || "";
    formatOther.value = d.format_other || "";
    needDate.value = d.need_date && d.need_date >= C.todayTaipei() ? d.need_date : "";
    form.elements.external_note.value = d.external_note || "";
    updateItemsCount();
  }
  // 清空表單（保留上次的部門），並刪掉草稿
  function clearForm() {
    form.reset();
    ["department", "data_types", "items", "purpose", "formats", "need_date"].forEach(function (k) { setError(k, ""); });
    showDuplicateWarning([]);
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

  // ---------- 品號檢查 ----------
  // 每行必須是「品號/名稱」。回傳 { errors: [說明…], duplicates: [說明…], clean: 整理後的文字 }
  function checkItems(raw) {
    var errors = [], seen = {}, dupes = {}, cleanLines = [];
    raw.split("\n").forEach(function (line, i) {
      var no = i + 1;
      // 全形斜線視為斜線；去掉前後空白（含全形空白）
      var text = line.replace(/／/g, "/").replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
      if (!text) return;
      var pos = text.indexOf("/");
      var part = pos === -1 ? "" : text.slice(0, pos).replace(/[\s\u3000]+$/, "");
      var name = pos === -1 ? "" : text.slice(pos + 1).replace(/^[\s\u3000]+/, "");
      if (pos === -1) { errors.push("第 " + no + " 行缺少斜線"); return; }
      if (!part) { errors.push("第 " + no + " 行斜線前面缺少品號"); return; }
      if (!name) { errors.push("第 " + no + " 行斜線後面缺少名稱"); return; }
      var key = part.toUpperCase();
      // 重複時顯示第一次出現的寫法
      if (seen[key]) { (dupes[key] = dupes[key] || { part: seen[key].part, lines: [seen[key].no] }).lines.push(no); }
      else seen[key] = { no: no, part: part };
      cleanLines.push(part + "/" + name);
    });
    return {
      errors: errors,
      duplicates: Object.keys(dupes).map(function (k) { return dupes[k].part + "（第 " + dupes[k].lines.join("、") + " 行）"; }),
      clean: cleanLines.join("\n"),
    };
  }

  function itemsErrorText(errors) {
    var shown = errors.slice(0, 3).join("；");
    return shown + (errors.length > 3 ? "；另有 " + (errors.length - 3) + " 行" : "") + "。格式是「品號/名稱」，一行一筆。";
  }

  // 顯示或清除「品號重複」的提醒（不擋送出）
  function showDuplicateWarning(duplicates) {
    itemsWarn.textContent = duplicates.length ? "提醒：品號重複 " + duplicates.join("、") + "。" : "";
  }

  // 離開品號欄時先檢查一次，不用等到送出
  function checkItemsOnBlur() {
    var raw = form.elements.items.value;
    if (!raw.trim()) { showDuplicateWarning([]); return; }
    var c = checkItems(raw);
    setError("items", c.errors.length ? itemsErrorText(c.errors) : "");
    showDuplicateWarning(c.errors.length ? [] : c.duplicates);
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
      p_items: "",
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
    var items = checkItems(form.elements.items.value);
    d.p_items = items.clean;
    if (!form.elements.items.value.trim()) e.items = "請填寫品號／零件名稱／規格。";
    else if (items.errors.length) e.items = itemsErrorText(items.errors);
    showDuplicateWarning(e.items ? [] : items.duplicates);
    if (!d.p_purpose) e.purpose = "請選擇申請用途。";
    else if (!purposeOther.hidden && !d.p_purpose_other) e.purpose = "選「其他」時請說明用途。";
    if (!d.p_formats.length) e.formats = "請至少選擇一種需求格式。";
    else if (!formatOther.hidden && !d.p_format_other) e.formats = "選「其他」時請說明格式。";
    if (d.p_need_date && d.p_need_date < C.todayTaipei()) e.need_date = "需要日期不能早於今天。";

    ["department", "data_types", "items", "purpose", "formats", "need_date"].forEach(function (k) {
      setError(k, e[k]);
    });
    return { data: d, errors: e, duplicates: e.items ? [] : items.duplicates };
  }

  async function onSubmit(event) {
    event.preventDefault();
    clearTimeout(blurTimer);
    C.hideMessage(msg);
    var r = readAndValidate();
    var first = Object.keys(r.errors)[0];
    if (first) {
      C.showMessage(msg, "error", "請修正標示紅字的欄位。");
      var target = form.querySelector('.field-error[data-for="' + first + '"]');
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (r.duplicates.length &&
        !(await C.confirm({ title: "有重複的品號，仍然要送出嗎？", body: r.duplicates.join("\n"), ok: "仍然送出", cancel: "回去修改" }))) {
      form.elements.items.focus();
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
      C.triggerNotify();
      C.store.set(deptKey(), { id: r.data.p_department_id, other: r.data.p_department_other || "" });
      clearTimeout(draftTimer);
      C.store.remove(draftKey());
      form.reset();
      setDefaults();
      updateOthers();
      applyLastDept();
      showDuplicateWarning([]);
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
    updateItemsCount();
  }

  // 顯示目前輸入了幾筆品號（一行一筆）
  function updateItemsCount() {
    var n = form.elements.items.value.split("\n").filter(function (l) { return l.trim(); }).length;
    document.getElementById("items-count").textContent = n ? "已輸入 " + n + " 筆" : "";
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
    form.elements.items.value = r.items || "";
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
    checkItemsOnBlur();

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
    itemsWarn = document.getElementById("items-warn");
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
      if (name === "department_other") name = "department";
      if (name === "purpose_other") name = "purpose";
      if (name === "format_other") name = "formats";
      setError(name, "");
    });
    form.elements.items.addEventListener("input", function () {
      clearTimeout(blurTimer);
      updateItemsCount();
      showDuplicateWarning([]);
    });
    // 離開欄位後稍等一下再顯示檢查結果：使用者常常是點下一個欄位而離開，
    // 如果訊息在按下的瞬間出現，畫面會往下推，手指會點空。
    form.elements.items.addEventListener("blur", function () {
      clearTimeout(blurTimer);
      blurTimer = setTimeout(checkItemsOnBlur, 350);
    });
    form.addEventListener("submit", onSubmit);
    // 每次修改都自動暫存草稿（停手 0.4 秒後存）
    form.addEventListener("input", scheduleSave);
    form.addEventListener("change", scheduleSave);
    updateOthers();
    restoreDraft();
  }

  window.RequestForm = { init: init, prefill: prefill };
})();
