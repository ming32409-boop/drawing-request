// 產品明細（逐筆輸入）：每筆一張卡片，可從產品主檔搜尋帶入，找不到時手動輸入。
// 用法：ItemEditor.init(容器, 新增鈕, 計數, { client, onChange })；getItems()、setItems(list)、validate()、reset()
(function () {
  "use strict";
  var C = window.Common;
  var MAX = 10;
  var list, addBtn, countEl, opts, uid = 0;

  function el(tag, cls, text) { return C.el(tag, cls, text); }

  function cards() { return Array.prototype.slice.call(list.querySelectorAll(":scope > .item-card")); }

  // ---------- 一筆產品的卡片 ----------
  function makeCard(item) {
    item = item || {};
    var n = ++uid;
    var li = el("li", "item-card");
    li.picked = item.fromMaster ? item.code : "";   // 從主檔選的品號（品號被改掉就視為手動輸入）

    var head = el("div", "item-card-head");
    var no = el("span", "item-no");
    var src = el("span", "item-src");
    var remove = el("button", "item-remove", "刪除");
    remove.type = "button";
    head.appendChild(no);
    head.appendChild(src);
    head.appendChild(remove);
    li.appendChild(head);

    // 搜尋產品（combobox）
    var combo = el("div", "combo");
    var sLabel = el("label", null, "搜尋產品（品號／品名／規格）");
    sLabel.setAttribute("for", "item-s-" + n);
    var search = el("input", "item-search");
    search.type = "text";
    search.id = "item-s-" + n;
    search.autocomplete = "off";
    search.setAttribute("autocapitalize", "off");
    search.spellcheck = false;
    search.placeholder = "例如 FA-176426、槽鋼 2000";
    search.setAttribute("role", "combobox");
    search.setAttribute("aria-autocomplete", "list");
    search.setAttribute("aria-expanded", "false");
    search.setAttribute("aria-controls", "item-lb-" + n);
    var lb = el("ul", "combo-list");
    lb.id = "item-lb-" + n;
    lb.setAttribute("role", "listbox");
    lb.setAttribute("aria-label", "搜尋結果");
    lb.hidden = true;
    combo.appendChild(sLabel);
    combo.appendChild(search);
    combo.appendChild(lb);
    li.appendChild(combo);

    function field(cls, label, max, required, value, hint) {
      var id = "item-" + cls + "-" + n;
      var l = el("label", null, label + " ");
      l.setAttribute("for", id);
      l.appendChild(required ? el("span", "req", "*") : el("span", "sub", "選填"));
      var input = el("input", "item-" + cls);
      input.type = "text";
      input.id = id;
      input.maxLength = max;
      input.autocomplete = "off";
      input.value = value || "";
      var err = el("p", "field-error item-error");
      err.dataset.item = cls;
      li.appendChild(l);
      li.appendChild(input);
      if (hint) li.appendChild(el("p", "hint-text item-hint", hint));
      li.appendChild(err);
      return input;
    }
    var code = field("code", "產品編碼", 40, true, item.code, null);
    code.setAttribute("autocapitalize", "off");
    code.spellcheck = false;
    code.classList.add("mono-input");
    var name = field("name", "品名／規格", 100, true, item.name, null);
    var note = field("note", "產品備註", 200, false, item.note, null);
    note.placeholder = "只跟這一筆有關的補充說明";

    function updateSource() {
      var v = code.value.trim();
      if (!v) { src.textContent = ""; src.className = "item-src"; return; }
      var master = li.picked && v === li.picked;
      src.textContent = master ? "產品主檔" : "手動輸入";
      src.className = "item-src " + (master ? "is-master" : "is-manual");
    }
    li.updateSource = updateSource;
    code.addEventListener("input", function () { updateSource(); clearErr(li, "code"); });
    name.addEventListener("input", function () { clearErr(li, "name"); });
    remove.addEventListener("click", function () {
      var all = cards();
      var idx = all.indexOf(li);
      li.remove();
      if (!cards().length) list.appendChild(makeCard());
      renumber();
      var next = cards()[Math.min(idx, cards().length - 1)];
      if (next) next.querySelector(".item-search").focus();
      changed();
    });
    wireSearch(li, search, lb, code, name, note);
    updateSource();
    return li;
  }

  function clearErr(li, which) {
    var p = li.querySelector('.item-error[data-item="' + which + '"]');
    if (p) p.textContent = "";
    var input = li.querySelector(".item-" + which);
    if (input) input.classList.remove("invalid");
  }

  // ---------- 搜尋下拉 ----------
  function wireSearch(li, search, lb, code, name, note) {
    var timer = null, seq = 0, results = [], active = -1;
    function close() {
      lb.hidden = true;
      search.setAttribute("aria-expanded", "false");
      search.removeAttribute("aria-activedescendant");
      active = -1;
    }
    function highlight(i) {
      var opts = lb.querySelectorAll('[role="option"]');
      if (!opts.length) return;
      active = (i + opts.length) % opts.length;
      opts.forEach(function (o, k) { o.setAttribute("aria-selected", String(k === active)); });
      search.setAttribute("aria-activedescendant", opts[active].id);
      opts[active].scrollIntoView({ block: "nearest" });
    }
    function pick(p) {
      code.value = p.code;
      name.value = p.name + (p.spec ? " " + p.spec : "");
      li.picked = p.code;
      li.updateSource();
      clearErr(li, "code");
      clearErr(li, "name");
      search.value = "";
      close();
      note.focus();
      changed();
    }
    function render(q) {
      lb.replaceChildren();
      if (!results.length) {
        var none = el("li", "combo-empty", "找不到「" + q + "」，可以直接在下方手動輸入產品編碼與品名。");
        lb.appendChild(none);
      }
      results.forEach(function (p, k) {
        var o = el("li", "combo-option");
        o.id = search.id + "-opt-" + k;
        o.setAttribute("role", "option");
        o.setAttribute("aria-selected", "false");
        o.appendChild(el("span", "opt-code", p.code));
        o.appendChild(el("span", "opt-name", p.name + (p.spec ? " " + p.spec : "")));
        if (p.category) o.appendChild(el("span", "opt-cat", p.category));
        // mousedown：在輸入框失去焦點之前就選好
        o.addEventListener("mousedown", function (e) { e.preventDefault(); pick(p); });
        lb.appendChild(o);
      });
      lb.hidden = false;
      search.setAttribute("aria-expanded", "true");
      active = -1;
    }
    async function run() {
      var q = search.value.trim();
      if (q.length < 2) { close(); return; }
      var my = ++seq;
      var res = await opts.client.rpc("search_products", { p_q: q, p_limit: 8 });
      if (my !== seq || document.activeElement !== search) return;
      if (res.error) { results = []; lb.replaceChildren(el("li", "combo-empty", "搜尋失敗：" + C.describeError(res.error))); lb.hidden = false; return; }
      results = res.data || [];
      render(q);
    }
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(run, 250);
    });
    search.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (lb.hidden) run(); else highlight(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
      else if (e.key === "Enter") {
        e.preventDefault();   // 不要送出整張表單
        if (!lb.hidden && active >= 0 && results[active]) pick(results[active]);
        else if (!lb.hidden && results.length === 1) pick(results[0]);
      } else if (e.key === "Escape") { if (!lb.hidden) { e.preventDefault(); close(); } }
    });
    search.addEventListener("blur", function () { setTimeout(close, 120); });
  }

  // ---------- 整體 ----------
  function renumber() {
    var all = cards();
    all.forEach(function (li, k) {
      li.querySelector(".item-no").textContent = "產品 " + (k + 1);
      li.querySelector(".item-remove").setAttribute("aria-label", "刪除產品 " + (k + 1));
      li.querySelector(".item-remove").hidden = all.length === 1 && isEmpty(li);
    });
    var full = all.length >= MAX;
    addBtn.disabled = full;
    addBtn.textContent = full ? "已達 " + MAX + " 筆上限" : "＋ 新增一筆產品";
    countEl.textContent = all.length + "／" + MAX + " 筆";
  }
  function isEmpty(li) {
    return !li.querySelector(".item-code").value.trim() && !li.querySelector(".item-name").value.trim() &&
      !li.querySelector(".item-note").value.trim();
  }
  function changed() {
    renumber();
    if (opts.onChange) opts.onChange();
  }

  function getItems() {
    return cards().map(function (li) {
      var code = li.querySelector(".item-code").value.trim();
      return {
        code: code,
        name: li.querySelector(".item-name").value.trim(),
        note: li.querySelector(".item-note").value.trim(),
        fromMaster: Boolean(li.picked && code === li.picked),
      };
    });
  }
  function setItems(items) {
    list.replaceChildren();
    (items && items.length ? items : [{}]).slice(0, MAX).forEach(function (it) { list.appendChild(makeCard(it)); });
    renumber();
  }
  function reset() { setItems([]); }

  // 檢查每一筆；錯誤寫在該欄下方。回傳 { items: 要送出的清單, count: 錯誤數, first: 第一個有錯的欄位 }
  function validate() {
    var errors = 0, first = null, seen = {};
    var all = cards();
    // 整筆都空白、而且不是唯一一筆：略過
    var filled = all.filter(function (li, k) { return !isEmpty(li) || all.length === 1; });
    function fail(li, which, text) {
      var p = li.querySelector('.item-error[data-item="' + which + '"]');
      p.textContent = text;
      var input = li.querySelector(".item-" + which);
      input.classList.add("invalid");
      errors++;
      if (!first) first = input;
    }
    all.forEach(function (li) { clearErr(li, "code"); clearErr(li, "name"); });
    filled.forEach(function (li) {
      var no = all.indexOf(li) + 1;
      var code = li.querySelector(".item-code").value.trim();
      var name = li.querySelector(".item-name").value.trim();
      if (!code) fail(li, "code", "請填寫產品編碼，或用上方「搜尋產品」帶入。");
      else if (seen[code]) fail(li, "code", "與第 " + seen[code] + " 筆的產品編碼相同（大小寫視為不同）。");
      else seen[code] = no;
      if (!name) fail(li, "name", "請填寫品名或規格。");
    });
    var items = filled.map(function (li) {
      return {
        code: li.querySelector(".item-code").value.trim(),
        name: li.querySelector(".item-name").value.trim(),
        note: li.querySelector(".item-note").value.trim() || null,
      };
    });
    return { items: items, count: errors, first: first };
  }

  function init(listEl, addEl, countElement, options) {
    list = listEl;
    addBtn = addEl;
    countEl = countElement;
    opts = options || {};
    addBtn.addEventListener("click", function () {
      if (cards().length >= MAX) return;
      var li = makeCard();
      list.appendChild(li);
      changed();
      li.querySelector(".item-search").focus();
    });
    list.addEventListener("input", function () { renumber(); });
    setItems([]);
  }

  // 一張申請的品項（新申請有逐筆資料；舊申請依「品號/名稱」文字的第一個斜線拆開）
  function fromRequest(r) {
    var rows = r.request_items || r.item_list;
    if (rows && rows.length) {
      return rows.slice().sort(function (a, b) { return a.seq - b.seq; }).map(function (x) {
        return { code: x.code, name: x.name, note: x.note || "", fromMaster: Boolean(x.from_master) };
      });
    }
    return String(r.items || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      var pos = l.indexOf("/");
      return pos === -1 ? { code: "", name: l } : { code: l.slice(0, pos).trim(), name: l.slice(pos + 1).trim() };
    });
  }

  window.ItemEditor = { init: init, getItems: getItems, setItems: setItems, reset: reset, validate: validate, fromRequest: fromRequest, MAX: MAX };
})();
