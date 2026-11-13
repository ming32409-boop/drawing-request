// 管理看板：讀取 dashboard_data，畫出重點數字與圖表；匯出 Excel（CSV）
(function () {
  "use strict";
  var C = window.Common;
  var el = C.el;
  var client = null;
  var statusEl = document.getElementById("status");
  var msgEl = document.getElementById("dash-message");
  var tip = document.getElementById("tooltip");
  var presetSel = document.getElementById("preset");
  var fromIn = document.getElementById("from");
  var toIn = document.getElementById("to");
  var exportBtn = document.getElementById("export-btn");

  var STAGE_LABEL = { stage1: "第一關（部門主管）", stage2: "第二關（核發主管）", issue: "文管發放" };

  // ---------- 格式 ----------
  function fmtHours(h) {
    if (h === null || h === undefined || h === "") return "—";
    h = Number(h);
    if (h < 1) return Math.round(h * 60) + " 分鐘";
    if (h < 48) return h.toFixed(1) + " 小時";
    return (h / 24).toFixed(1) + " 天";
  }
  function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 + "%" : "—"; }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function todayTaipei() { return C.todayTaipei(); }

  function rangeFor(preset) {
    var t = todayTaipei();
    var y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    function first(yy, mm) { return ymd(new Date(Date.UTC(yy, mm - 1, 1))); }
    switch (preset) {
      case "month": return [first(y, m), t];
      case "3m": return [first(y, m - 2), t];
      case "12m": return [first(y, m - 11), t];
      case "year": return [y + "-01-01", t];
      case "all": return ["", ""];
      default: return [fromIn.value, toIn.value];
    }
  }

  // ---------- 提示框（滑鼠與鍵盤都能顯示） ----------
  function attachTip(node, text) {
    node.tabIndex = 0;
    node.setAttribute("aria-label", text.replace(/\n/g, "，"));
    function show() {
      tip.textContent = text;
      tip.hidden = false;
      var r = node.getBoundingClientRect();
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
      var top = r.top - th - 8;
      if (top < 8) top = r.bottom + 8;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }
    function hide() { tip.hidden = true; }
    node.addEventListener("mouseenter", show);
    node.addEventListener("mouseleave", hide);
    node.addEventListener("focus", show);
    node.addEventListener("blur", hide);
  }

  // ---------- 元件 ----------
  function tile(label, value, hint) {
    var t = el("div", "tile");
    t.appendChild(el("div", "label", label));
    t.appendChild(el("div", "value", value));
    if (hint) t.appendChild(el("div", "hint", hint));
    return t;
  }

  // 橫條圖：rows = [{label, n, text?, flag?, tag?, tip?}]
  function hbars(container, rows, opts) {
    opts = opts || {};
    container.replaceChildren();
    if (!rows.length) { container.appendChild(el("p", "empty", opts.empty || "期間內沒有資料。")); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return Number(r.n) || 0; })) || 1;
    rows.forEach(function (r) {
      var row = el("div", "hbar");
      var name = el("span", "name");
      if (r.flag) name.appendChild(el("span", "flag", r.flag));
      name.appendChild(document.createTextNode(r.label));
      row.appendChild(name);
      var track = el("div", "track");
      var fill = el("div", "fill");
      fill.style.width = Math.max(0.5, (Number(r.n) / max) * 100) + "%";
      track.appendChild(fill);
      row.appendChild(track);
      var val = el("span", "val", r.text !== undefined ? r.text : String(r.n));
      if (r.tag) val.appendChild(el("span", "tag", r.tag));
      row.appendChild(val);
      attachTip(row, r.tip || (r.label + "\n" + (r.text !== undefined ? r.text : r.n + " 件")));
      container.appendChild(row);
    });
  }

  function table(container, headers, rows, numericCols, colClasses) {
    container.replaceChildren();
    if (!rows.length) { container.appendChild(el("p", "empty", "期間內沒有資料。")); return; }
    var wrap = el("div", "table-scroll");
    var t = el("table", "data");
    var thead = el("thead"), tr = el("tr");
    headers.forEach(function (h, i) { var th = el("th", numericCols && numericCols.indexOf(i) >= 0 ? "n" : null, h); th.scope = "col"; tr.appendChild(th); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el("tbody");
    rows.forEach(function (r) {
      var row = el("tr");
      r.forEach(function (c, i) {
        var td = el("td", numericCols && numericCols.indexOf(i) >= 0 ? "n" : (colClasses && colClasses[i]) || null);
        if (c instanceof Node) td.appendChild(c); else td.textContent = c === null || c === undefined ? "" : String(c);
        if (td.className === "part") td.title = td.textContent;
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    container.appendChild(wrap);
  }

  // ---------- 各區塊 ----------
  function renderTiles(d) {
    var k = d.kpi, box = document.getElementById("tiles");
    box.replaceChildren();
    box.appendChild(tile("申請總數", String(k.total), "期間內送出的申請"));
    box.appendChild(tile("簽核中", String(k.in_review), "第一關或第二關"));
    box.appendChild(tile("待文管發放", String(k.to_issue)));
    box.appendChild(tile("已發放結案", String(k.issued)));
    box.appendChild(tile("駁回率", pct(k.rejected, k.decided), k.rejected + " / " + k.decided + " 件已有結果"));
    box.appendChild(tile("外部用途比例", pct(k.external, k.total), k.external + " 件提供給公司外部"));
    var total = d.speed.total;
    box.appendChild(tile("平均申請到發放", total ? fmtHours(total.avg_hours) : "—", total ? "中位數 " + fmtHours(total.median_hours) + "，共 " + total.n + " 件" : "期間內尚無結案"));
  }

  function renderMonthly(d) {
    var box = document.getElementById("monthly");
    box.replaceChildren();
    box.parentNode.querySelectorAll(".col-labels").forEach(function (n) { n.remove(); });
    var rows = d.monthly;
    var tableBox = document.getElementById("monthly-table");
    if (!rows.length) { box.appendChild(el("p", "empty", "期間內沒有資料。")); tableBox.replaceChildren(); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.total; })) || 1;
    var labels = el("div", "col-labels");
    // 依寬度決定每幾個月標一次，避免標籤擠在一起（每個標籤約需 44px）
    var fit = Math.max(3, Math.floor((box.clientWidth || 320) / 44));
    var step = Math.max(1, Math.ceil(rows.length / fit));
    rows.forEach(function (r, i) {
      var col = el("div", "col");
      // 數字標示：只標最大值與最後一個月，避免每根都有數字
      if (r.total === max || i === rows.length - 1) col.appendChild(el("span", "num", String(r.total)));
      var bar = el("div", "bar");
      bar.style.height = (r.total / max) * 85 + "%";
      if (r.total > 0) bar.style.minHeight = "2px";
      col.appendChild(bar);
      attachTip(col, r.month + "\n申請 " + r.total + " 件\n已發放 " + r.issued + "・進行中 " + r.open + "\n已駁回 " + r.rejected + "・已撤回 " + r.withdrawn);
      box.appendChild(col);
      labels.appendChild(el("span", null, i % step === 0 ? r.month.slice(2).replace("-", "/") : ""));
    });
    box.after(labels);
    table(tableBox, ["月份", "申請", "已發放", "進行中", "已駁回", "已撤回"],
      rows.map(function (r) { return [r.month, r.total, r.issued, r.open, r.rejected, r.withdrawn]; }), [1, 2, 3, 4, 5]);
  }

  function renderSpeed(d) {
    var stages = ["stage1", "stage2", "issue"].filter(function (s) { return d.speed[s]; });
    var slowest = stages.reduce(function (a, s) { return !a || Number(d.speed[s].avg_hours) > Number(d.speed[a].avg_hours) ? s : a; }, null);
    hbars(document.getElementById("speed"), stages.map(function (s) {
      var x = d.speed[s];
      return {
        label: STAGE_LABEL[s], n: Number(x.avg_hours),
        text: fmtHours(x.avg_hours) + "（" + fmtHours(x.median_hours) + "）",
        tag: stages.length > 1 && s === slowest ? "最久" : "",
        tip: STAGE_LABEL[s] + "\n平均 " + fmtHours(x.avg_hours) + "\n中位數 " + fmtHours(x.median_hours) + "\n最長 " + fmtHours(x.max_hours) + "\n共 " + x.n + " 件",
      };
    }), { empty: "期間內還沒有完成任何一關。" });
    table(document.getElementById("pending"), ["關卡", "件數", "平均已等", "最久已等"],
      ["stage1", "stage2", "issue"].map(function (s) {
        var p = d.pending[s];
        return [STAGE_LABEL[s], p ? p.n : 0, p ? fmtHours(p.avg_hours) : "—", p ? fmtHours(p.oldest_hours) : "—"];
      }), [1, 2, 3]);
  }

  function renderReject(d) {
    var k = d.kpi, box = document.getElementById("reject-summary");
    box.replaceChildren();
    [["駁回率", pct(k.rejected, k.decided)], ["第一關駁回", k.rejected_stage1 + " 件"], ["第二關駁回", k.rejected_stage2 + " 件"]]
      .forEach(function (p) { var c = el("div"); c.appendChild(el("div", "k", p[0])); c.appendChild(el("div", "v", p[1])); box.appendChild(c); });
    hbars(document.getElementById("reject-reasons"), d.reject_reasons.map(function (r) { return { label: r.label, n: r.n, text: r.n + " 件" }; }),
      { empty: "期間內沒有駁回。" });
  }

  function renderExternal(d) {
    hbars(document.getElementById("purpose"), d.by_purpose.map(function (r) {
      return { label: r.label, n: r.n, flag: r.external ? "⚠" : "", text: r.n + " 件", tip: r.label + (r.external ? "（外部用途）" : "") + "\n" + r.n + " 件" };
    }));
    hbars(document.getElementById("external-targets"), d.external_targets.map(function (r) { return { label: r.label, n: r.n, text: r.n + " 件" }; }),
      { empty: "期間內沒有填寫外發對象的外部用途申請。" });
  }

  function renderItems(d) {
    var max = d.top_items.length ? d.top_items[0].n : 1;
    table(document.getElementById("top-items"), ["#", "品號", "名稱（最近一次）", "次數", "最近申請"],
      d.top_items.map(function (r, i) {
        var n = el("span");
        var bar = el("span", "item-bar");
        bar.style.width = Math.max(4, (r.n / max) * 60) + "px";
        n.appendChild(bar);
        n.appendChild(document.createTextNode(String(r.n)));
        var day = String(r.last_day).slice(0, 10);
        // 今年的日期只顯示月-日，節省手機版空間
        if (day.slice(0, 4) === todayTaipei().slice(0, 4)) day = day.slice(5);
        return [i + 1, r.part, r.name || "", n, day];
      }), [0, 3], [null, "part", null, null, "nowrap"]);
  }

  function renderSimple(id, rows) {
    hbars(document.getElementById(id), rows.map(function (r) { return { label: r.label, n: r.n, text: r.n + " 件" }; }));
  }

  // ---------- 讀資料 ----------
  async function load() {
    var range = rangeFor(presetSel.value);
    fromIn.value = range[0];
    toIn.value = range[1];
    C.hideMessage(msgEl);
    var res = await client.rpc("dashboard_data", { p_from: range[0] || null, p_to: range[1] || null });
    if (res.error) { C.showMessage(msgEl, "error", "無法載入看板：" + C.describeError(res.error)); return; }
    var d = res.data;
    renderTiles(d);
    renderMonthly(d);
    renderSpeed(d);
    renderReject(d);
    renderExternal(d);
    renderItems(d);
    renderSimple("by-department", d.by_department);
    renderSimple("by-data-type", d.by_data_type);
  }

  // ---------- 匯出 Excel（CSV，加 BOM 讓 Excel 正確顯示中文） ----------
  var EXPORT_COLUMNS = [
    ["doc_no", "單號"], ["created_at", "申請時間"], ["applicant", "申請人"], ["department", "部門"],
    ["data_types", "申請資料別"], ["items", "品號／零件名稱／規格"], ["purpose", "申請用途"], ["is_external", "外部用途"],
    ["formats", "需求格式"], ["need_date", "需要日期"], ["external_note", "外發對象／備註"], ["status", "狀態"],
    ["stage1_result", "第一關"], ["stage1_by", "第一關簽核人"], ["stage1_at", "第一關時間"], ["stage1_reason", "第一關駁回原因"],
    ["stage2_result", "第二關"], ["stage2_by", "第二關簽核人"], ["stage2_at", "第二關時間"], ["stage2_reason", "第二關駁回原因"],
    ["delivery_method", "發放方式"], ["delivered_by", "發放人"], ["delivered_at", "發放時間"],
  ];
  var TIME_COLS = ["created_at", "stage1_at", "stage2_at", "delivered_at"];

  function csvCell(v) {
    var s = v === null || v === undefined ? "" : String(v);
    // 避免以 = + - @ 開頭的內容被 Excel 當成公式執行
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  async function exportCsv() {
    exportBtn.disabled = true;
    try {
      var range = rangeFor(presetSel.value);
      var res = await client.rpc("export_requests", { p_from: range[0] || null, p_to: range[1] || null });
      if (res.error) { C.showMessage(msgEl, "error", "匯出失敗：" + C.describeError(res.error)); return; }
      var lines = [EXPORT_COLUMNS.map(function (c) { return c[1]; }).join(",")];
      res.data.forEach(function (r) {
        lines.push(EXPORT_COLUMNS.map(function (c) {
          var v = r[c[0]];
          if (TIME_COLS.indexOf(c[0]) >= 0) v = C.formatTime(v);
          if (c[0] === "is_external") v = v ? "是" : "否";
          if (c[0] === "need_date" && v) v = String(v).slice(0, 10);
          return csvCell(v);
        }).join(","));
      });
      var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      // 檔名只用英數字，各種瀏覽器（含 LINE 內建瀏覽器）都能正確存檔
      a.download = "drawing-requests_" + (range[0] || "all") + "_" + (range[1] || todayTaipei()) + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      C.showMessage(msgEl, "success", "已匯出 " + res.data.length + " 筆。若在 LINE 裡無法下載，請改用電腦瀏覽器開啟本頁。");
    } catch (err) {
      C.showMessage(msgEl, "error", "匯出失敗：" + C.describeError(err));
    } finally {
      exportBtn.disabled = false;
    }
  }

  // ---------- 啟動 ----------
  async function main() {
    try {
      var session = await window.DrawingAuth.signIn();
      client = session.client;
      var me = await client.from("profiles").select("id, display_name, is_admin, is_issuer, is_dcc, active")
        .eq("id", session.user.id).single();
      if (me.error) throw me.error;
      document.getElementById("who").textContent = me.data.display_name;
      if (!me.data.active || !(me.data.is_admin || me.data.is_issuer || me.data.is_dcc)) {
        C.showMessage(statusEl, "error", "管理看板只開放給核發主管、文管與系統管理員。");
        return;
      }
      C.hideMessage(statusEl);
      document.getElementById("dash").hidden = false;
      await load();
    } catch (err) {
      console.error(err);
      C.showMessage(statusEl, "error", "登入失敗：" + C.describeError(err));
    }
  }

  presetSel.addEventListener("change", function () { if (presetSel.value !== "custom") load(); });
  [fromIn, toIn].forEach(function (i) { i.addEventListener("change", function () { presetSel.value = "custom"; }); });
  document.getElementById("filters").addEventListener("submit", function (e) { e.preventDefault(); load(); });
  exportBtn.addEventListener("click", exportCsv);
  window.addEventListener("scroll", function () { tip.hidden = true; }, { passive: true });
  main();
})();
