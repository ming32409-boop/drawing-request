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
    "claimed_by", "claimed_at", "claimed_by_profile:profiles!requests_claimed_by_fkey(display_name)",
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

  // 認領列：誰在處理這張；沒人處理時可以「我來處理」
  function claimRow(r) {
    var row = C.el("div", "claim-row");
    var mine = r.claimed_by === ctx.profile.id;
    var when = r.claimed_at ? "（" + C.formatTime(r.claimed_at).slice(5) + "）" : "";
    if (!r.claimed_by) {
      row.appendChild(C.el("span", "claim-state", "尚未有人處理"));
      var b = C.el("button", "secondary small claim", "我來處理");
      b.type = "button";
      b.addEventListener("click", function () { claim(r, true, b); });
      row.appendChild(b);
    } else if (mine) {
      row.appendChild(C.el("span", "claim-state is-mine", "你正在處理" + when));
      var u = C.el("button", "secondary small unclaim", "取消認領");
      u.type = "button";
      u.addEventListener("click", function () { claim(r, false, u); });
      row.appendChild(u);
    } else {
      var name = r.claimed_by_profile ? r.claimed_by_profile.display_name : "其他文管";
      row.appendChild(C.el("span", "claim-state is-other", name + " 備檔中" + when));
    }
    return row;
  }

  async function claim(r, yes, btn) {
    btn.disabled = true;
    var res = await ctx.client.rpc("claim_request", { p_request_id: r.id, p_claim: yes });
    if (res.error) {
      btn.disabled = false;
      C.showMessage(msgEl, "error", r.doc_no + "：" + C.describeError(res.error));
      load();
      return;
    }
    C.showMessage(msgEl, "success", yes ? r.doc_no + " 已由你認領，其他文管與申請人會看到你正在備檔。" : r.doc_no + " 已取消認領。");
    load();
  }

  async function deliver(r, method, other, note, buttons) {
    buttons.forEach(function (b) { b.disabled = true; });
    try {
      var res = await ctx.client.rpc("deliver_request", {
        p_request_id: r.id, p_method: method, p_method_other: method === "其他" ? other : null,
        p_note: note || null,
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
    li.dataset.doc = r.doc_no;
    var box = C.el("div", "review-body");

    var top = C.el("div", "item-top");
    top.appendChild(C.el("span", "doc-no", r.doc_no));
    if (r.is_external) top.appendChild(C.el("span", "badge external-badge", "外部用途"));
    top.appendChild(C.el("span", "badge status s-issue", "待文管發放"));
    box.appendChild(top);

    // 摘要：要發什麼、什麼格式、急不急；發放表單直接可填，完整明細收在「查看明細」
    var deptName = (r.department ? r.department.name : "") + (r.department_other ? "（" + r.department_other + "）" : "");
    box.appendChild(C.el("p", "item-summary", C.itemsSummary(r.items)));
    box.appendChild(C.el("p", "item-meta", (r.applicant ? r.applicant.display_name : "") + "（" + deptName + "）・" +
      r.data_types.join("、") + "・" + r.formats.map(function (f) {
        return f === "其他" && r.format_other ? "其他（" + r.format_other + "）" : f;
      }).join("、")));
    var u = C.urgency(r.stage2_at || r.created_at, r.need_date);
    li.urgency = u;
    box.appendChild(u.el);
    box.appendChild(claimRow(r));

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
    var more = C.el("div", "card-detail");
    more.appendChild(dl);
    more.appendChild(C.el("pre", "items-full", r.items));
    box.appendChild(C.detailToggle(more, "issue-detail-" + r.id));
    box.appendChild(more);

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
    // 連結／備註：選「雲端連結」時必填，會一起用 LINE 通知申請人
    var noteId = "note-" + r.id;
    var noteLabel = C.el("label", "note-label");
    noteLabel.setAttribute("for", noteId);
    var noteInput = C.el("input", "delivery-note-input");
    noteInput.id = noteId;
    noteInput.type = "text";
    noteInput.maxLength = 500;
    noteInput.autocomplete = "off";
    var noteHint = C.el("p", "hint-text note-hint");
    function updateNote() {
      var cloud = sel.value === "雲端連結";
      noteLabel.replaceChildren(document.createTextNode(cloud ? "雲端連結 " : "連結／備註 "));
      noteLabel.appendChild(cloud ? C.el("span", "req", "*") : C.el("span", "sub", "選填"));
      noteInput.inputMode = cloud ? "url" : "text";
      noteInput.placeholder = cloud ? "貼上雲端資料夾或檔案的連結" : "例如：已寄到申請人信箱、放在開發部櫃台";
      noteHint.textContent = cloud ? "連結會一起用 LINE 傳給申請人，也會顯示在「我的申請」。" : "會一起通知申請人。";
    }
    updateNote();
    var err = C.el("p", "field-error");
    var btn = C.el("button", "primary deliver", "確認已發放");
    btn.type = "button";
    form.appendChild(label);
    form.appendChild(sel);
    form.appendChild(other);
    form.appendChild(noteLabel);
    form.appendChild(noteInput);
    form.appendChild(noteHint);
    form.appendChild(err);
    form.appendChild(btn);
    box.appendChild(form);

    sel.addEventListener("change", function () {
      other.hidden = sel.value !== "其他";
      updateNote();
      err.textContent = "";
    });
    other.addEventListener("input", function () { err.textContent = ""; });
    noteInput.addEventListener("input", function () { err.textContent = ""; noteInput.classList.remove("invalid"); });
    btn.addEventListener("click", async function () {
      if (!sel.value) { err.textContent = "請選擇發放方式。"; sel.focus(); return; }
      var note = other.value.trim();
      if (sel.value === "其他" && !note) { err.textContent = "選「其他」時請說明發放方式。"; other.focus(); return; }
      var link = noteInput.value.trim();
      if (sel.value === "雲端連結" && !link) {
        err.textContent = "請貼上雲端連結，申請人才拿得到檔案。";
        noteInput.classList.add("invalid");
        noteInput.focus();
        return;
      }
      var byOther = r.claimed_by && r.claimed_by !== ctx.profile.id;
      var claimer = r.claimed_by_profile ? r.claimed_by_profile.display_name : "其他文管";
      if (!(await C.confirm({ title: byOther ? claimer + " 正在處理 " + r.doc_no + "，確定由你發放？" : "確認 " + r.doc_no + " 已發放？", body: "發放方式：" + (sel.value === "其他" ? note : sel.value) +
        (link ? "\n連結／備註：" + link : "") + "\n確認後會通知申請人並結案。", ok: "確認已發放" }))) return;
      deliver(r, sel.value, note, link, [btn]);
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
    if (!listEl.children.length) C.showMessage(msgEl, "info loading", "載入中…");
    try {
      var res = await ctx.client.from("requests").select(FIELDS)
        .eq("status", "待文管發放")
        .order("created_at", { ascending: true }).limit(100);
      if (res.error) { C.showMessage(msgEl, "error", "無法載入：" + C.describeError(res.error)); return; }
      listEl.replaceChildren();
      setCount(res.data.length);
      if (!res.data.length) {
        if (!msgEl.classList.contains("success") && !msgEl.classList.contains("error")) {
          C.showEmpty(msgEl, "目前沒有待發放的申請", "主管核准後，會用 LINE 通知你備檔發放。");
        }
        return;
      }
      if (msgEl.classList.contains("info") || msgEl.classList.contains("empty-state")) C.hideMessage(msgEl);
      res.data.map(function (r) { return renderItem(r); })
        .sort(function (a, b) { return C.compareUrgency(a.urgency, b.urgency); })
        .forEach(function (li) { listEl.appendChild(li); });
      C.revealDoc("issue", listEl, msgEl);
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
