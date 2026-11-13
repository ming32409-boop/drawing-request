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
