---
version: alpha
name: Drawing Request — Title Block
description: 開發部圖面資料申請（申請頁、簽核、文管發放、管理看板）的設計規範。程式中的樣式值以本檔為準，實作在 theme.css。
colors:
  primary: "#1f3a60"
  on-primary: "#ffffff"
  primary-container: "#edf1f7"
  ink: "#16181d"
  secondary: "#4a4f58"
  muted: "#5f6570"
  neutral: "#f6f6f3"
  surface: "#ffffff"
  surface-dim: "#f1f1ed"
  surface-chip: "#e7e7e2"
  outline: "#e3e3de"
  outline-strong: "#d2d3cd"
  outline-field: "#8a8e88"
  accent: "#06c755"
  chart-1: "#2f62b5"
  success: "#0e6b3c"
  success-container: "#e4f3ea"
  info: "#2552a3"
  info-container: "#e8effb"
  warning: "#8a5600"
  warning-container: "#fbf0d9"
  error: "#b3261e"
  error-container: "#fbe9e7"
  primary-dark: "#a4c0ea"
  on-primary-dark: "#0f1a2c"
  primary-container-dark: "#1c2636"
  ink-dark: "#ececea"
  secondary-dark: "#b3b8c0"
  muted-dark: "#8d939c"
  neutral-dark: "#0f1012"
  surface-dark: "#16181b"
  surface-dim-dark: "#1c1f23"
  surface-chip-dark: "#262a2f"
  outline-dark: "#26292e"
  outline-strong-dark: "#33373d"
  outline-field-dark: "#767b83"
  chart-1-dark: "#5b8ddf"
  success-dark: "#6ad3a0"
  success-container-dark: "#1a2d26"
  info-dark: "#8fb4f2"
  info-container-dark: "#1f293b"
  warning-dark: "#f0bf5e"
  warning-container-dark: "#352c1b"
  error-dark: "#f28b82"
  error-container-dark: "#391f1e"
typography:
  headline-display:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.35
  numeral-hero:
    fontFamily: Geist
    fontSize: 64px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.035em
  numeral-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.02em
  body-lg:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  label-md:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  label-sm:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.02em
  overline:
    fontFamily: ui-monospace, SF Mono, Menlo, Consolas
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0.08em
  code-md:
    fontFamily: ui-monospace, SF Mono, Menlo, Consolas
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  hairline: 1px
  gutter: 16px
  page-max: 640px
  page-max-desktop: 880px
  dashboard-max: 1240px
  tap-min: 44px
components:
  page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
  page-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.ink-dark}"
  app-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    height: 60px
  app-bar-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
  page-title:
    textColor: "{colors.ink}"
    typography: "{typography.headline-lg}"
  dashboard-title:
    textColor: "{colors.ink}"
    typography: "{typography.headline-display}"
  section-title:
    textColor: "{colors.ink}"
    typography: "{typography.headline-md}"
  section-index:
    textColor: "{colors.muted}"
    typography: "{typography.overline}"
  section-index-dark:
    textColor: "{colors.muted-dark}"
  helper-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
  helper-text-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.muted-dark}"
  field-label:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label-md}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  card-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
  card-border:
    backgroundColor: "{colors.outline}"
    width: "{spacing.hairline}"
  card-border-dark:
    backgroundColor: "{colors.outline-dark}"
  divider-strong:
    backgroundColor: "{colors.outline-strong}"
  divider-strong-dark:
    backgroundColor: "{colors.outline-strong-dark}"
  card-meta:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.body-md}"
  card-meta-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.secondary-dark}"
  card-detail:
    backgroundColor: "{colors.surface-dim}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
  card-detail-dark:
    backgroundColor: "{colors.surface-dim-dark}"
    textColor: "{colors.muted-dark}"
  doc-number:
    textColor: "{colors.ink}"
    typography: "{typography.code-md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: 48px
    padding: 20px
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.on-primary-dark}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: 40px
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.md}"
    height: "{spacing.tap-min}"
  button-danger-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.error-dark}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.md}"
    height: 48px
    padding: 14px
  input-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
  input-border:
    backgroundColor: "{colors.outline-field}"
    width: "{spacing.hairline}"
  input-border-dark:
    backgroundColor: "{colors.outline-field-dark}"
  checkbox-option:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "{spacing.tap-min}"
  checkbox-option-selected:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.primary}"
  checkbox-option-selected-dark:
    backgroundColor: "{colors.primary-container-dark}"
    textColor: "{colors.primary-dark}"
  tab:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.muted}"
    typography: "{typography.body-md}"
    height: 48px
  tab-active:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.ink}"
  tab-indicator:
    backgroundColor: "{colors.primary}"
    height: 2px
  segmented:
    backgroundColor: "{colors.surface-dim}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
  segmented-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  segmented-selected-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
  tag:
    backgroundColor: "{colors.surface-chip}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
  tag-dark:
    backgroundColor: "{colors.surface-chip-dark}"
    textColor: "{colors.secondary-dark}"
  status-review:
    backgroundColor: "{colors.info-container}"
    textColor: "{colors.info}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.sm}"
  status-review-dark:
    backgroundColor: "{colors.info-container-dark}"
    textColor: "{colors.info-dark}"
  status-issue:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.warning}"
  status-issue-dark:
    backgroundColor: "{colors.warning-container-dark}"
    textColor: "{colors.warning-dark}"
  status-done:
    backgroundColor: "{colors.success-container}"
    textColor: "{colors.success}"
  status-done-dark:
    backgroundColor: "{colors.success-container-dark}"
    textColor: "{colors.success-dark}"
  status-rejected:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.error}"
  status-rejected-dark:
    backgroundColor: "{colors.error-container-dark}"
    textColor: "{colors.error-dark}"
  external-badge:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warning}"
  progress-done:
    backgroundColor: "{colors.primary}"
    height: 4px
  progress-todo:
    backgroundColor: "{colors.surface-chip}"
    height: 4px
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
  kpi-hero:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral-hero}"
  kpi-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral-lg}"
    rounded: "{rounded.lg}"
  chart-bar:
    backgroundColor: "{colors.chart-1}"
    rounded: "{rounded.sm}"
    width: 24px
  chart-bar-dark:
    backgroundColor: "{colors.chart-1-dark}"
  brand-dot:
    backgroundColor: "{colors.accent}"
    size: 8px
  count-badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
  spacing-sm:
    padding: "{spacing.sm}"
  spacing-xs:
    padding: "{spacing.xs}"
  spacing-md:
    padding: "{spacing.md}"
  spacing-xl:
    padding: "{spacing.xl}"
  spacing-2xl:
    padding: "{spacing.2xl}"
  layout-page:
    width: "{spacing.page-max}"
    padding: "{spacing.gutter}"
  layout-page-desktop:
    width: "{spacing.page-max-desktop}"
  layout-dashboard:
    width: "{spacing.dashboard-max}"
---

# 開發部圖面資料申請｜設計規範

## Overview

**Title Block（圖框標題欄）**：靈感來自工程圖面右下角的標題欄——一格一格、細線分隔、字小而清楚。高級感來自克制：少裝飾、少顏色、多留白，每個元素都對齊。

使用者是開發部、品管、採購、業務、製造的同事和主管，多半在 LINE 裡用手機開啟，常常站在現場單手操作；主管與文管也會用電腦開管理看板。

- **安靜**：暖白紙底、白色面板、1px 細線。不用陰影堆疊、漸層、毛玻璃當裝飾。
- **一個行動色**：普魯士藍（`primary`）只用在主按鈕、選中狀態、目前分頁的底線、進度、聚焦外框。其他文字一律中性色。
- **顏色只用來傳遞資訊**：狀態（簽核中、待發放、已發放、已駁回）、外部用途提醒、圖表資料。
- **像圖面的編號**：單號、品號、區段編號（01、02、03）、日期刻度用等寬字。

## Colors

所有文字與背景的組合都要達到 WCAG AA（4.5:1）；輸入框外框等「辨認元件用」的線條至少 3:1。

- **Prussian Ink 普魯士藍（#1f3a60）**：`primary`。主按鈕、選中的選項與分段、目前分頁底線、進度條完成段、聚焦外框、待辦數字圓點。白字對比 11.5:1。
- **Ink 墨（#16181d）**：`ink`。標題、內文、欄位標籤。
- **Graphite 石墨（#4a4f58）**：`secondary`。次要資訊、數值、圖表標註。
- **Slate 霧灰（#5f6570）**：`muted`。說明文字、時間、區段編號、表頭。在 `surface-dim` 上也有 5.2:1。
- **Paper 紙（#f6f6f3）**：`neutral`，頁面底色。**White（#ffffff）**：`surface`，面板與輸入框。**Fog（#f1f1ed）**：`surface-dim`，展開的明細、分段軌道、滑過時的底色。**Pebble（#e7e7e2）**：`surface-chip`，小標籤、進度條未完成段。
- **Hairline 細線**：`outline`（#e3e3de）面板外框與分隔線；`outline-strong`（#d2d3cd）次按鈕外框、表頭下緣；`outline-field`（#8a8e88）輸入框與核取方塊外框（白底上 3.3:1）。
- **Selected 選中底色（#edf1f7）**：`primary-container`，選中的核取選項、筆數標籤。
- **LINE Green（#06c755）**：`accent`。只用在品牌圖示的小圓點，代表「透過 LINE 通知」。**不可以拿來當按鈕或文字底色**（白字對比只有 2.26:1）。
- **Chart Blue（#2f62b5）**：`chart-1`。圖表唯一的資料色（單一數列不需要圖例），已用 dataviz 驗證器檢查亮度區間、彩度與對 `surface` 的 3:1 對比。普魯士藍太深（亮度 0.35）不適合當資料色。
- **狀態色**（文字色／底色，成對使用）：`info` 藍（簽核中）、`warning` 琥珀（待文管發放、外部用途）、`success` 綠（已發放結案）、`error` 紅（已駁回、必填、錯誤）。狀態一定同時有文字標示。
- **深色模式**：跟隨系統設定。每個顏色都有 `-dark` 版本，是為深色背景重新挑選的，不是自動反轉。深色的主色是淺藍（#a4c0ea），上面用深藍字（#0f1a2c）。

## Typography

英數字用 **Geist**（可變字重，隨網頁提供），中文用裝置的系統字型（iPhone 是蘋方、Windows 是微軟正黑體）。等寬字用系統的 `ui-monospace`（iPhone 是 SF Mono）。

- **Headlines**：`headline-display`（看板大標，40px）、`headline-lg`（頁面標題，30px，手機上約 26px）、`headline-md`（區段與卡片標題，17px）。字重 600，字距略收。
- **Numerals**：`numeral-hero`（看板唯一的大數字「申請總數」，64px）、`numeral-lg`（其他數字，32px）。單獨的大數字用比例數字（`proportional-nums`），表格與刻度用等寬數字（`tabular-nums`）才會上下對齊。單位（%、小時）縮小成標籤大小，放在數字右側。
- **Body**：`body-lg`（16px，表單輸入一律 16px 以上，iPhone 才不會自動放大）、`body-md`、`body-sm`（說明文字）。
- **Labels**：`label-md`（欄位標籤、按鈕，14px／500）、`label-sm`（狀態標籤，12px／600）。
- **Mono**：`overline`（標題上方的小字、區段編號 01／02／03，12px，字距拉開）、`code-md`（單號、品號，14px／600）。

## Layout

- **申請頁**：手機單欄，內容寬 640px，左右留 16px。電腦（960px 以上）內容寬 880px，表單改成「左欄區段標題（200px）＋右欄欄位」，送出鍵對齊右欄。
- **管理看板**：最大寬度 1240px。重點數字是一整條「標題欄」：格子之間用 1px 細線，第一格（申請總數）放大並跨兩列。圖表用 12 欄不對稱格線（8＋4、5＋7、4＋4＋4），手機收成單欄。
- **頂部列與分頁**：白色頂部列，下緣一條細線；分頁是貼齊頂端的文字分頁，目前分頁下方有 2px 藍色底線。內容的左右邊界和頁面內容對齊。
- 間距以 8px 為基本單位（4／8／16／24／32／48）。
- **可點擊的東西至少 44px 高**：按鈕、核取選項、分頁、展開箭頭；觸控裝置上小按鈕自動加高。

## Elevation & Depth

層次靠細線和底色，不靠陰影。

- **面板**：白底＋1px `outline` 外框＋幾乎看不到的 1px 陰影；深色模式不用陰影。
- **浮動元素**（提示框）才有明顯的陰影。
- **毛玻璃**：只用在貼齊頂端的分頁列，不用在會捲動的內容上。

## Shapes

- **中圓角（`rounded.md` 10px）**：按鈕、輸入框、核取選項、訊息框、分段控制。
- **大圓角（`rounded.lg` 14px）**：面板、申請單卡片、重點數字條。
- **小圓角（`rounded.sm` 6px）**：狀態標籤、小標籤。
- **全圓（`rounded.full`）**：只用在待辦數字圓點。
- **線條圖示**：1.4～1.5px 細線、圓頭圓角，不用填滿的粗圖示，也不用表情符號（⚠ 等）當圖示。

## Components

- **主按鈕**：普魯士藍實色，高 48px（送出申請 52px，右側有箭頭，滑過時箭頭往右一點）。每一屏只有一個主按鈕。
- **次按鈕**：白底、細框，用在「重新整理」「套用」「複製內容重新申請」。
- **危險按鈕**：紅字、淡紅框，用在「駁回」「撤回」。一定會再確認或要求填原因。
- **輸入框**：白底、`outline-field` 外框；聚焦時外框變藍並出現 3px 淡藍光圈；有錯時外框變紅，下方顯示「圖示＋紅字」說明。
- **核取選項**：整顆可點，左側有核取方塊；選中後外框與文字變藍、底色淡藍、方塊填滿並打勾。
- **狀態標籤**：小方角標籤，前面有同色圓點，文字永遠寫出狀態名稱。
- **進度**：四段細條（送出 → 部門主管 → 核發主管 → 文管發放）。完成是藍色實心，目前這關填一半並加粗文字，被駁回是紅色，尚未開始是灰色。
- **明細**：像標題欄，一列一個欄位，左邊灰色欄名、右邊內容，細線分隔。品號清單用等寬字。
- **重點數字**：一條細線格；數字大、單位小，下方一行灰色說明。
- **圖表**：單一數列一種藍；直條最寬 24px、頂端 4px 圓角、底部貼齊基準線；只標最大值與最後一個月；滑鼠或鍵盤選到時顯示提示框；每張圖都有表格可對照。
- **分段控制**（看板期間）：灰色軌道，選中的那一格變白浮起。
- **空狀態**：清單沒有資料時，顯示細線圖示＋一句說明，而不是空白。

## Do's and Don'ts

- Do：每一屏只放一個藍色主按鈕。
- Do：狀態一定「顏色＋文字」一起出現，不能只靠顏色。
- Do：文字和背景至少 4.5:1，輸入框外框至少 3:1；新增顏色前先用 `npx @google/design.md lint DESIGN.md` 檢查。
- Do：動畫只動 `transform` 和 `opacity`，0.2～0.4 秒；使用者設定「減少動態效果」時關閉。
- Do：修改 `theme.css` 的顏色時，同步修改本檔（`tests/check_design_tokens.py` 會檢查兩邊是否一致）。
- Don't：不要把 LINE 綠用在按鈕或文字底色（白字對比不足）。
- Don't：不要用粗邊框、深色陰影、彩色漸層或毛玻璃當裝飾。
- Don't：不要用表情符號當圖示；用細線 SVG。
- Don't：圖表一個數列只用一個顏色，不要用顏色深淺重複表達長條長度；圖表文字用中性色，不用資料色。
