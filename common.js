// 共用小工具
(function () {
  "use strict";

  var timeFmt = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  var dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  });

  // 資料庫限制名稱 → 中文說明
  var CONSTRAINT_MESSAGES = {
    requests_purpose_other_check: "申請用途選「其他」時必須填寫說明（最多 100 字）。",
    requests_format_other_check: "需求格式選「其他」時必須填寫說明（最多 100 字）。",
    requests_department_other_check: "部門說明最多 100 字。",
    requests_items_check: "品號／零件名稱／規格必填，最多 3000 字。",
    requests_data_types_check: "申請資料別選項不正確。",
    requests_formats_check: "需求格式選項不正確。",
    requests_external_note_check: "備註說明最多 1000 字。",
  };

  window.Common = {
    // 建立元素；文字一律用 textContent，避免 XSS
    el: function (tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = text;
      return node;
    },
    formatTime: function (value) {
      if (!value) return "";
      var d = new Date(value);
      return isNaN(d.getTime()) ? "" : timeFmt.format(d);
    },
    // 台灣時間的今天，格式 yyyy-mm-dd
    todayTaipei: function () {
      return dateFmt.format(new Date());
    },
    showMessage: function (el, type, text) {
      el.className = "message " + type;
      el.textContent = text;
      el.hidden = false;
    },
    // 清單沒有資料時的空狀態（細線圖示＋說明）
    showEmpty: function (el, title, hint) {
      el.className = "empty-state";
      el.replaceChildren();
      var t = document.createElement("p");
      t.className = "empty-title";
      t.textContent = title;
      el.appendChild(t);
      if (hint) {
        var h = document.createElement("p");
        h.className = "empty-hint";
        h.textContent = hint;
        el.appendChild(h);
      }
      el.hidden = false;
    },
    hideMessage: function (el) {
      el.hidden = true;
      el.textContent = "";
    },
    describeError: function (error) {
      if (!error) return "發生未知錯誤，請稍後再試。";
      var msg = String(error.message || "");
      for (var key in CONSTRAINT_MESSAGES) {
        if (msg.indexOf(key) !== -1) return CONSTRAINT_MESSAGES[key];
      }
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "無法連線到伺服器，請檢查網路後再試。";
      if (error.code === "42501" && !/[一-鿿]/.test(msg)) return "沒有權限執行這個動作。";
      if (error.code === "PGRST301" || /JWT/i.test(msg)) return "登入已過期，請重新開啟頁面。";
      // 資料庫函式回傳的中文訊息直接顯示
      return msg || "操作失敗，請稍後再試。";
    },
    // 請後端發送待發的 LINE 通知（失敗不影響畫面，下次動作時會再補發）
    triggerNotify: function () {
      var cfg = window.APP_CONFIG;
      try {
        fetch(cfg.supabaseUrl + "/functions/v1/line-notify", {
          method: "POST",
          headers: { apikey: cfg.supabaseKey },
          keepalive: true,
        }).catch(function (err) { console.warn("LINE 通知觸發失敗", err); });
      } catch (err) {
        console.warn("LINE 通知觸發失敗", err);
      }
    },
    // ---------- 從 LINE 通知直接打開某張單（網址帶 ?tab=…&doc=單號） ----------
    // 只記下「要找哪個分頁的哪張單」；清單畫好後由 revealDoc 捲過去、展開並短暫標示。
    // 「待我簽核」「文管發放」登入時會先載入一次、切到分頁再載入一次，所以標示後 3 秒內重畫也會再標一次。
    pendingDoc: null,
    setPendingDoc: function (tab, doc) {
      this.pendingDoc = tab && doc ? { tab: tab, doc: doc, shownAt: 0 } : null;
    },
    revealDoc: function (tab, listEl, msgEl) {
      var p = this.pendingDoc;
      if (!p || p.tab !== tab) return;
      var view = listEl.closest("section");
      if (view && view.hidden) return;                       // 分頁還沒顯示：等下一次載入
      if (p.shownAt && Date.now() - p.shownAt > 3000) { this.pendingDoc = null; return; }
      var item = Array.prototype.find.call(listEl.children, function (li) { return li.dataset.doc === p.doc; });
      if (!item) {
        this.pendingDoc = null;
        if (msgEl && listEl.children.length) {
          this.showMessage(msgEl, "notice", "單號 " + p.doc + " 已不在這個清單裡，可能已經有人處理了。");   // 用 notice：清單重新載入時不會被清掉
        }
        return;
      }
      if (!p.shownAt) p.shownAt = Date.now();
      var head = item.querySelector('.item-head[aria-expanded="false"], .detail-toggle[aria-expanded="false"]');
      if (head) head.click();
      item.classList.add("spotlight");
      setTimeout(function () { item.classList.remove("spotlight"); }, 2600);
      requestAnimationFrame(function () { item.scrollIntoView({ block: "start", behavior: "smooth" }); });
    },
    // ---------- 頁內確認面板（取代瀏覽器原生的確認視窗） ----------
    // 用法：if (!(await C.confirm({ title, body, ok, danger }))) return;
    // 手機上從下方滑出、電腦上置中；Esc 或點背景＝取消；關閉後焦點回到原本的按鈕。
    confirm: function (opts) {
      opts = opts || {};
      var sheet = document.getElementById("confirm-sheet");
      if (!sheet) {
        sheet = document.createElement("div");
        sheet.id = "confirm-sheet";
        sheet.className = "sheet-backdrop";
        sheet.hidden = true;
        sheet.innerHTML =
          '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" aria-describedby="sheet-body">' +
          '<h3 id="sheet-title" class="sheet-title"></h3><p id="sheet-body" class="sheet-body"></p>' +
          '<div class="sheet-actions"><button type="button" class="secondary sheet-cancel">取消</button>' +
          '<button type="button" class="primary sheet-ok"></button></div></div>';
        document.body.appendChild(sheet);
      }
      var okBtn = sheet.querySelector(".sheet-ok"), cancelBtn = sheet.querySelector(".sheet-cancel");
      sheet.querySelector(".sheet-title").textContent = opts.title || "確定嗎？";
      sheet.querySelector(".sheet-body").textContent = opts.body || "";
      sheet.querySelector(".sheet-body").hidden = !opts.body;
      okBtn.textContent = opts.ok || "確定";
      okBtn.className = (opts.danger ? "danger-solid" : "primary") + " sheet-ok";
      cancelBtn.textContent = opts.cancel || "取消";
      var before = document.activeElement;
      sheet.hidden = false;
      document.documentElement.classList.add("sheet-open");
      // 危險動作預設停在「取消」，避免手滑
      (opts.danger ? cancelBtn : okBtn).focus();
      return new Promise(function (resolve) {
        function close(result) {
          sheet.hidden = true;
          document.documentElement.classList.remove("sheet-open");
          okBtn.removeEventListener("click", onOk);
          cancelBtn.removeEventListener("click", onCancel);
          sheet.removeEventListener("click", onBackdrop);
          document.removeEventListener("keydown", onKey, true);
          if (before && before.focus && document.contains(before)) before.focus();
          resolve(result);
        }
        function onOk() { close(true); }
        function onCancel() { close(false); }
        function onBackdrop(e) { if (e.target === sheet) close(false); }
        function onKey(e) {
          if (e.key === "Escape") { e.preventDefault(); close(false); }
          if (e.key === "Tab") {   // 焦點只在兩個按鈕之間切換
            e.preventDefault();
            (document.activeElement === okBtn ? cancelBtn : okBtn).focus();
          }
        }
        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);
        sheet.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKey, true);
      });
    },
    // 「明細」展開鈕：卡片預設只顯示摘要與動作，按下才展開完整明細
    detailToggle: function (panel, id) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "detail-toggle";
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-controls", id);
      panel.id = id;
      panel.hidden = true;
      var label = document.createElement("span");
      label.textContent = "查看明細";
      btn.appendChild(label);
      var chev = document.createElement("span");
      chev.className = "chev";
      chev.setAttribute("aria-hidden", "true");
      btn.appendChild(chev);
      btn.addEventListener("click", function () {
        panel.hidden = !panel.hidden;
        btn.setAttribute("aria-expanded", String(!panel.hidden));
        label.textContent = panel.hidden ? "查看明細" : "收起明細";
      });
      return btn;
    },
    // 品號第一筆＋另幾筆
    itemsSummary: function (items) {
      var lines = String(items || "").split("\n").filter(function (l) { return l.trim(); });
      return (lines[0] || "") + (lines.length > 1 ? "（另 " + (lines.length - 1) + " 筆）" : "");
    },
    // ---------- 急迫度：已等多久、離需要日期還有幾天 ----------
    // since：這一關開始等的時間（第一關＝送出、第二關＝第一關核准、發放＝第二關核准）
    // 回傳 { el: 標籤列, score: 越小越急, need: 需要日期, since }，清單用 compareUrgency 排序
    urgency: function (since, needDate) {
      var box = document.createElement("div");
      box.className = "urgency";
      var score = 3;
      var hours = since ? Math.max(0, (Date.now() - new Date(since).getTime()) / 3600000) : 0;
      var wait = hours < 1 ? "等待不到 1 小時" : hours < 24 ? "已等 " + Math.floor(hours) + " 小時" : "已等 " + Math.floor(hours / 24) + " 天";
      var w = document.createElement("span");
      w.className = "u-chip u-wait" + (hours >= 48 ? " u-late" : "");
      w.textContent = wait;
      box.appendChild(w);
      if (hours >= 48) score = 2;
      var need = needDate ? String(needDate).slice(0, 10) : "";
      if (need) {
        var days = Math.round((Date.parse(need + "T00:00:00Z") - Date.parse(this.todayTaipei() + "T00:00:00Z")) / 86400000);
        var n = document.createElement("span");
        var md = need.slice(5).replace("-", "/");
        if (days < 0) { n.className = "u-chip u-need u-over"; n.textContent = "需要日期已過 " + (-days) + " 天"; score = 0; }
        else if (days === 0) { n.className = "u-chip u-need u-over"; n.textContent = "今天就要（" + md + "）"; score = 0; }
        else if (days <= 2) { n.className = "u-chip u-need u-soon"; n.textContent = "需要日期剩 " + days + " 天（" + md + "）"; score = Math.min(score, 1); }
        else { n.className = "u-chip u-need"; n.textContent = "需要 " + md; }
        box.appendChild(n);
      }
      return { el: box, score: score, need: need || "9999-12-31", since: since || "" };
    },
    // 排序：需要日期已到或快到的最前面，再來是等超過 2 天的，其餘依等待時間（越久越前面）
    compareUrgency: function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      if (a.score <= 1 && a.need !== b.need) return a.need < b.need ? -1 : 1;
      return a.since < b.since ? -1 : a.since > b.since ? 1 : 0;
    },
    // 文字裡的 http(s) 網址變成可以點的連結（其餘一律當純文字，避免 XSS）
    linkify: function (text) {
      var frag = document.createDocumentFragment();
      String(text || "").split(/(https?:\/\/[^\s<>"'，。、）]+)/).forEach(function (part, i) {
        if (i % 2 === 1) {
          var a = document.createElement("a");
          a.href = part;
          a.textContent = part;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.className = "text-link";
          frag.appendChild(a);
        } else if (part) {
          frag.appendChild(document.createTextNode(part));
        }
      });
      return frag;
    },
    // 只存在這台手機上的小資料（草稿、上次選的部門）；瀏覽器不允許時就當作沒有
    store: {
      get: function (key) {
        try { var v = window.localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
      },
      set: function (key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 不能存就算了 */ }
      },
      remove: function (key) {
        try { window.localStorage.removeItem(key); } catch (e) { /* 不能刪就算了 */ }
      },
    },
    STATUS_CLASS: {
      "申請主管簽核中": "s-review",
      "核發主管簽核中": "s-review",
      "待文管發放": "s-issue",
      "已發放結案": "s-done",
      "已駁回": "s-rejected",
      "已撤回": "s-withdrawn",
    },
  };
})();
