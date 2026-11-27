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
      var head = item.querySelector('.item-head[aria-expanded="false"]');
      if (head) head.click();
      item.classList.add("spotlight");
      setTimeout(function () { item.classList.remove("spotlight"); }, 2600);
      requestAnimationFrame(function () { item.scrollIntoView({ block: "start", behavior: "smooth" }); });
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
