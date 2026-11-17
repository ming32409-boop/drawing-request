---
version: alpha
name: Drawing Request — Quiet Precision
description: 開發部圖面資料申請（申請頁、簽核、文管發放、管理看板）的設計規範。程式中的樣式值以本檔為準，實作在 theme.css。
colors:
  primary: "#15171a"
  on-primary: "#ffffff"
  secondary: "#4b5059"
  muted: "#626770"
  neutral: "#f0f0ee"
  surface: "#ffffff"
  surface-dim: "#f5f5f3"
  surface-chip: "#e3e3e1"
  accent: "#06c755"
  chart-1: "#2a78d6"
  success: "#0e6b3c"
  success-container: "#e4f3ea"
  info: "#2552a3"
  info-container: "#e8effb"
  warning: "#8a5600"
  warning-container: "#fbf0d9"
  error: "#b3261e"
  error-container: "#fbe9e7"
  primary-dark: "#f3f3f1"
  on-primary-dark: "#111214"
  secondary-dark: "#b9bcc2"
  muted-dark: "#8e939c"
  neutral-dark: "#0b0c0d"
  surface-dark: "#151618"
  surface-dim-dark: "#1c1d20"
  surface-chip-dark: "#28292a"
  chart-1-dark: "#3987e5"
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
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 36px
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 17px
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: 0.02em
  numeral-hero:
    fontFamily: Geist
    fontSize: 80px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.04em
    fontFeature: '"tnum" 1'
  numeral-lg:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: 640
    lineHeight: 1.1
    letterSpacing: -0.03em
    fontFeature: '"tnum" 1'
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
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.04em
  label-sm:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 12px
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: 0.04em
  eyebrow:
    fontFamily: Geist, PingFang TC, Noto Sans TC, Microsoft JhengHei
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: 0.22em
rounded:
  sm: 10px
  md: 16px
  lg: 22px
  xl: 28px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  bezel: 6px
  gutter: 14px
  page-max: 620px
  dashboard-max: 1240px
  tap-min: 44px
components:
  page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.body-lg}"
  page-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.primary-dark}"
  page-title:
    textColor: "{colors.primary}"
    typography: "{typography.headline-lg}"
  dashboard-title:
    textColor: "{colors.primary}"
    typography: "{typography.headline-display}"
  section-title:
    textColor: "{colors.primary}"
    typography: "{typography.headline-md}"
  helper-text:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
  helper-text-dark:
    backgroundColor: "{colors.neutral-dark}"
    textColor: "{colors.muted-dark}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.xl}"
    padding: "{spacing.lg}"
  card-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.primary-dark}"
  card-bezel:
    padding: "{spacing.bezel}"
    rounded: "{rounded.xl}"
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
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.full}"
    height: 52px
    padding: 26px
  button-primary-dark:
    backgroundColor: "{colors.primary-dark}"
    textColor: "{colors.on-primary-dark}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 38px
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.full}"
    height: "{spacing.tap-min}"
  button-danger-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.error-dark}"
  input:
    backgroundColor: "{colors.surface-dim}"
    textColor: "{colors.primary}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.md}"
    height: 52px
    padding: "{spacing.md}"
  input-dark:
    backgroundColor: "{colors.surface-dim-dark}"
    textColor: "{colors.primary-dark}"
  chip:
    backgroundColor: "{colors.surface-dim}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    height: 46px
  chip-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  tag:
    backgroundColor: "{colors.surface-chip}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
  tag-dark:
    backgroundColor: "{colors.surface-chip-dark}"
    textColor: "{colors.secondary-dark}"
  eyebrow-tag:
    backgroundColor: "{colors.surface-chip}"
    textColor: "{colors.secondary}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.full}"
  tab:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.full}"
    typography: "{typography.label-md}"
  tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  status-review:
    backgroundColor: "{colors.info-container}"
    textColor: "{colors.info}"
    typography: "{typography.label-sm}"
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
  tooltip:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
  kpi-hero:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.numeral-hero}"
    rounded: "{rounded.lg}"
  kpi-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.numeral-lg}"
    rounded: "{rounded.lg}"
  chart-bar:
    backgroundColor: "{colors.chart-1}"
    rounded: "{rounded.sm}"
  chart-bar-dark:
    backgroundColor: "{colors.chart-1-dark}"
  brand-dot:
    backgroundColor: "{colors.accent}"
    size: 8px
  progress-dot:
    backgroundColor: "{colors.primary}"
    size: 12px
    rounded: "{rounded.full}"
  spacing-sm:
    padding: "{spacing.sm}"
  spacing-xs:
    padding: "{spacing.xs}"
  spacing-xl:
    padding: "{spacing.xl}"
  spacing-2xl:
    padding: "{spacing.2xl}"
  layout-page:
    width: "{spacing.page-max}"
    padding: "{spacing.gutter}"
  layout-dashboard:
    width: "{spacing.dashboard-max}"
---

# 開發部圖面資料申請｜設計規範

## Overview

**Quiet Precision（安靜的精準）**：像一件精密量具，冷靜、清楚、沒有多餘裝飾。

使用者是開發部、品管、採購、業務、製造的同事和主管，多半在 LINE 裡用手機開啟，常常是站在現場、單手操作。介面要讓人一眼看懂「現在要做什麼」「這張單卡在哪」。

- **專業而不冰冷**：銀灰底、白色卡片、墨色按鈕，看起來像一套正式的公司系統，而不是促銷網頁。
- **顏色只用來傳遞資訊**：狀態（簽核中、待發放、已發放、已駁回）、外部用途提醒、圖表資料。裝飾一律用中性色。
- **寬鬆的留白**：每一屏只做一件事，主要動作放在最明顯的位置。
- **觸感**：卡片有雙層邊框和柔和陰影，按下時會微微縮小，像實體按鍵。

## Colors

整體以高對比的中性色為主，只有一個品牌點綴色，加上一組狀態色。所有文字與背景的組合都要達到 WCAG AA（4.5:1）。

- **Ink Black 墨黑（#15171a）**：`primary`。標題、內文、主按鈕、選中的分頁與選項。是唯一的「行動色」。
- **Graphite 石墨（#4b5059）**：`secondary`。欄位標籤、次要資訊、未選中的分頁。
- **Slate Mist 霧灰（#626770）**：`muted`。說明文字、時間、提示。由舊值 #6e737c 調深，因為舊值在灰底上只有 4.18:1，未達 AA。
- **Silver Paper 銀紙（#f0f0ee）**：`neutral`，頁面背景。
- **Pure White 純白（#ffffff）**：`surface`，卡片內層。**Fog（#f5f5f3）**：`surface-dim`，輸入框、展開的明細。**Pebble（#e3e3e1）**：`surface-chip`，小標籤底色。
- **LINE Green（#06c755）**：`accent`。只用在品牌圖示的小圓點，代表「透過 LINE 通知」。白字放在這個綠色上對比只有 2.26:1，**不可以拿來當按鈕或文字底色**。
- **Chart Blue（#2a78d6）**：`chart-1`。圖表唯一的資料色，一個數列只用一個顏色。
- **狀態色**（文字色／底色，成對使用）：
  - `info` 藍（簽核中）、`warning` 琥珀（待文管發放、外部用途）、`success` 綠（已發放結案）、`error` 紅（已駁回、必填、錯誤）。
  - 狀態一定同時有文字標示，顏色不能單獨表達意思。
- **深色模式**：跟隨系統設定。每個顏色都有 `-dark` 版本（例如 `primary-dark` #f3f3f1），是同一組色相為深色背景重新調整的，不是自動反轉。

## Typography

英數字用 **Geist**（可變字重，隨網頁提供），中文用裝置的系統字型（iPhone 是蘋方、Windows 是微軟正黑體），兩者混排時字重保持一致。所有數字使用等寬數字（tabular numerals），單號、時間、件數上下對齊。

- **Headlines**：`headline-display`（看板大標，48px）、`headline-lg`（頁面標題，36px，手機上縮到約 30px）、`headline-md`（區段標題、卡片標題，17px）。字距略收，看起來更俐落。
- **Numerals**：`numeral-hero`（看板主卡的大數字，80px）、`numeral-lg`（其他數字卡，36px）。單位（%、小時）縮小成內文大小，放在數字右下。
- **Body**：`body-lg`（16px，表單輸入一律 16px 以上，iPhone 才不會自動放大）、`body-md`、`body-sm`（說明文字）。
- **Labels**：`label-md`（按鈕、分頁、欄位標籤）、`label-sm`（狀態標籤）、`eyebrow`（標題上方的小膠囊字，11px，字距拉開）。

## Layout

- **申請頁**：手機單欄，最大寬度 620px，左右留 14px。區塊間距用 8px 為基本單位的刻度（4 / 8 / 16 / 24 / 32 / 48）。
- **管理看板**：最大寬度 1240px。電腦上用 12 欄不對稱格線（主圖 8 欄＋側欄 4 欄、5＋7、4＋4＋4），手機收成單欄。
- **可點擊的東西至少 44px 高**：按鈕、選項膠囊、分頁、展開箭頭。
- **分頁**：浮在頁面上方的膠囊，捲動時跟著，不貼滿整個寬度。

## Elevation & Depth

深度靠「托盤＋面板」和非常淡的陰影，不用粗邊框或深色陰影。

- **雙層邊框卡片**：外層是 6px 的淺色托盤（`spacing.bezel`），內層是白色面板，圓角同心（外 28px）。內層上緣有一條極淡的白色高光。
- **柔和陰影**：大範圍、低透明度、往下偏移（例如 `0 30px 60px -32px rgba(21,23,26,0.2)`），只用來讓卡片「浮起來」。浮動元素（分頁、主按鈕、提示框）陰影稍深。
- **毛玻璃**：只用在固定位置的分頁列，不用在會捲動的內容上。
- **背景**：頁面背景有固定不動、極淡的光暈，增加一點空間感，不影響閱讀。

## Shapes

- **膠囊（`rounded.full`）**：所有按鈕、分頁、選項、狀態標籤、期間選擇。
- **大圓角（`rounded.xl` 28px）**：卡片。數字卡用 `rounded.lg` 22px。
- **中圓角（`rounded.md` 16px）**：輸入框、訊息、提示框。
- **小圓角（`rounded.sm` 10px）**：表格內的小元素。
- **線條圖示**：細線（1.4px）、圓頭圓角，不用填滿的粗圖示。

## Components

- **主按鈕**：墨黑膠囊，高 52px，右側有一顆圓形箭頭（按鈕中的按鈕），滑鼠移上時箭頭往右滑一點，按下時整顆縮成 98%。每一屏只有一個主按鈕。
- **次按鈕**：白底、細框膠囊，用在「重新整理」「套用」等次要動作。
- **危險按鈕**：紅字、紅細框，用在「駁回」「撤回」。一定會再跳確認或要求填原因。
- **輸入框**：淺灰凹槽，聚焦時變白並出現墨色外框和柔和光暈；有錯時外框變紅，下方顯示紅字說明。
- **選項膠囊**：可複選的項目，選中後變墨黑並顯示 ✓。
- **狀態標籤**：小膠囊，前面有一個同色圓點，文字永遠寫出狀態名稱。
- **進度條**：四個圓點（送出 → 部門主管 → 核發主管 → 文管發放），完成是實心墨黑，目前這關是空心加光暈，被駁回是紅色。
- **數字卡**：看板最重要的數字（申請總數）用墨黑大卡，其餘白卡；數字大、單位小。
- **空狀態**：清單沒有資料時，顯示細線圖示＋一句說明，而不是空白。
- **提示框**：墨黑底白字，滑鼠移上或用鍵盤選到圖表時出現。

## Do's and Don'ts

- Do：每一屏只放一個墨黑主按鈕。
- Do：狀態一定「顏色＋文字」一起出現，不能只靠顏色。
- Do：文字和背景至少 4.5:1；新增顏色前先用 `npx @google/design.md lint DESIGN.md` 檢查。
- Do：動畫只動 `transform` 和 `opacity`，使用同一條緩動曲線；使用者設定「減少動態效果」時關閉。
- Do：修改 `theme.css` 的顏色時，同步修改本檔（`tests/check_design_tokens.py` 會檢查兩邊是否一致）。
- Don't：不要把 LINE 綠用在按鈕或文字底色（白字對比不足）。
- Don't：不要用粗邊框、深色陰影或彩色漸層當裝飾。
- Don't：不要在會捲動的內容上用毛玻璃或模糊效果（手機會卡）。
- Don't：圖表一個數列只用一個顏色，不要用顏色深淺重複表達長條長度。
