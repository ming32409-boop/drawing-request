// 申請查詢：部門主管查本部門、核發主管與文管查全部（範圍由資料庫的資料列安全規則決定）
(function () {
  "use strict";
  var C = window.Common;
  var PAGE = 20;
  var ctx, listEl, msgEl, countEl, moreBtn, qEl, deptEl;
  var status = "", loaded = 0, total = 0, seq = 0, typingTimer = null;

  function canSearch() {
    return Boolean(ctx && ctx.profile.active &&
      (ctx.managedDepartmentIds.length > 0 || ctx.profile.is_issuer || ctx.profile.is_dcc));
  }
  function seesAll() { return ctx.profile.is_issuer || ctx.profile.is_dcc; }

  // 部門下拉：看全部的人列出所有部門；部門主管只列自己管的部門（只有一個就不顯示）
  function fillDepartments() {
    var mine = ctx.departments.filter(function (d) { return ctx.managedDepartmentIds.indexOf(d.id) !== -1; });
    var list = seesAll() ? ctx.departments : mine;
    deptEl.replaceChildren();
    var all = C.el("option", null, seesAll() ? "全部部門" : "我管理的部門");
    all.value = "";
    deptEl.appendChild(all);
    list.forEach(function (d) {
      var o = C.el("option", null, d.name);
      o.value = String(d.id);
      deptEl.appendChild(o);
    });
    deptEl.hidden = list.length < 2;
    document.getElementById("search-scope").textContent = seesAll()
      ? "可以查詢全部的申請。"
      : "可以查詢 " + mine.map(function (d) { return d.name; }).join("、") + " 的申請。";
  }

  async function load(more) {
    if (!canSearch()) return;
    var my = ++seq;
    if (!more) { loaded = 0; }
    moreBtn.disabled = true;
    if (!more) C.showMessage(msgEl, "info loading", "查詢中…");
    try {
      var res = await ctx.client.rpc("search_requests", {
        p_q: qEl.value.trim() || null,
        p_status: status || null,
        p_department_id: deptEl.value ? Number(deptEl.value) : null,
        p_limit: PAGE,
        p_offset: loaded,
      });
      if (my !== seq) return;   // 使用者已經換了條件，忽略舊的結果
      if (res.error) { C.showMessage(msgEl, "error", "無法查詢：" + C.describeError(res.error)); return; }
      var rows = res.data.rows || [];
      total = Number(res.data.total) || 0;
      if (!more) listEl.replaceChildren();
      rows.forEach(function (r) {
        var li = window.MyRequests.renderCard(r, { readonly: true, showApplicant: true });
        listEl.appendChild(li);
      });
      loaded += rows.length;
      countEl.textContent = total ? "共 " + total + " 筆" + (loaded < total ? "，目前顯示 " + loaded + " 筆" : "") : "";
      moreBtn.hidden = loaded >= total;
      if (!total) C.showEmpty(msgEl, "找不到符合的申請", "換個關鍵字，或把狀態改成「全部」試試看。");
      else C.hideMessage(msgEl);
    } catch (err) {
      if (my === seq) C.showMessage(msgEl, "error", "無法查詢：" + C.describeError(err));
    } finally {
      if (my === seq) moreBtn.disabled = false;
    }
  }

  function setStatus(btn) {
    status = btn.dataset.status;
    document.querySelectorAll("#view-search .status-filter button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b === btn));
    });
    load();
  }

  function init(context) {
    ctx = context;
    listEl = document.getElementById("search-list");
    msgEl = document.getElementById("search-message");
    countEl = document.getElementById("search-count");
    moreBtn = document.getElementById("search-more");
    qEl = document.getElementById("search-q");
    deptEl = document.getElementById("search-dept");
    document.querySelector('#tabs a[data-tab="search"]').hidden = !canSearch();
    if (!canSearch()) return;
    fillDepartments();
    document.getElementById("search-form").addEventListener("submit", function (e) {
      e.preventDefault();
      clearTimeout(typingTimer);
      qEl.blur();   // 手機上收起鍵盤，才看得到結果
      load();
    });
    // 打字停下 0.5 秒自動查詢
    qEl.addEventListener("input", function () {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(function () { load(); }, 500);
    });
    deptEl.addEventListener("change", function () { load(); });
    document.querySelectorAll("#view-search .status-filter button").forEach(function (b) {
      b.addEventListener("click", function () { setStatus(b); });
    });
    moreBtn.addEventListener("click", function () { load(true); });
  }

  window.SearchPanel = { init: init, load: function () { return load(false); }, canSearch: canSearch };
})();
