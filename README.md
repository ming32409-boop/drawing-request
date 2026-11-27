# 開發部圖面資料申請表

需求見 [需求筆記.txt](需求筆記.txt)，專案規則見 [AGENTS.md](AGENTS.md)。

請同事測試時，發給他們 [文件/測試說明.pdf](文件/測試說明.pdf)（內容來源是 [文件/測試說明.md](文件/測試說明.md)，修改後要重新輸出 PDF）。
一頁式操作說明（可張貼或傳到 LINE）：[文件/一頁式操作說明.png](文件/一頁式操作說明.png)、[PDF](文件/一頁式操作說明.pdf)。

## 架構
- 網頁：GitHub Pages（`main` 分支根目錄），在 LINE 裡用 LIFF 開啟。目前有「新增申請」「我的申請」「待我簽核」「文管發放」。
  - 網址：https://ming32409-boop.github.io/drawing-request/
  - LINE 裡開啟：https://liff.line.me/2012594772-22NJxRHt
- 登入：LINE Login
- 資料庫：Supabase（`supabase/schema.sql`）
- 通知：LINE 官方帳號（Messaging API），由 Edge Function `line-notify` 發送

## 公開設定值
這些值本來就會出現在網頁裡，可以公開：

| 項目 | 值 |
|---|---|
| Supabase Project URL | `https://xpluguqndjgkzolvixxc.supabase.co` |
| Supabase publishable key | `sb_publishable_jFlA-xp8-tYgpBEQykYY4g_GdYBB8Au` |
| LINE Login Channel ID | `2012594772` |
| LIFF ID | `2012594772-22NJxRHt` |

Supabase secret key、LINE Channel secret、Channel access token **不可以**寫進任何檔案，只能存在 Supabase 後台的機密設定。

## 建立資料庫
在 Supabase Dashboard → **SQL Editor** 依序執行，每個檔案只執行一次：
1. `supabase/schema.sql`
2. `supabase/002_require_active.sql`
3. `supabase/003_grant_service_role.sql`（開放權限給後端；本專案設定為新資料表不自動開放，連後端也包含在內）
4. `supabase/004_notification_outbox.sql`（LINE 通知待發清單的領取與回報函式）
5. `supabase/005_dashboard.sql`（管理看板的統計與匯出函式）
6. `supabase/006_item_format.sql`（品號每一行必須是「品號/名稱」的格式檢查）
7. `supabase/007_flow_improvements.sql`（發放連結／備註、新帳號自動通知系統管理員、匯出加發放備註）

### 資料庫重點
- 未登入的訪客沒有任何權限。
- 前端只能讀資料；新增、簽核、撤回、發放都要呼叫資料庫函式：
  - `submit_request(...)`：送出申請，回傳單號 `DOC-yyyyMMdd-001`
  - `review_request(申請單id, 核准true/駁回false, 駁回原因)`：自動判斷是第一關或第二關
  - `withdraw_request(申請單id)`：第一關簽核前撤回
  - `deliver_request(申請單id, 發放方式, 其他說明, 連結／備註)`：文管發放結案；選「雲端連結」時必須附連結，會一起通知申請人
  - `request_stats()`：統計儀表板
- 每個動作寫入 `request_events`；要發的 LINE 通知寫入 `notifications`，由後端發送。

## LINE 登入（Edge Function `line-login`）
- 網頁用 LIFF 取得 LINE ID token → 呼叫 `line-login` → 向 LINE 驗證 → 建立或找出 Supabase 帳號 → 回傳登入 session。
- 新帳號預設「待啟用」，要由系統管理員啟用。
- 部署時要關閉 **Verify JWT**（`supabase/config.toml` 已設定）。
- 只使用 Supabase 自動提供的環境變數，不需要另外設定任何金鑰。
- LIFF 的 Endpoint URL：`https://ming32409-boop.github.io/drawing-request/`

## 管理看板（`dashboard.html`）
- 網址：https://ming32409-boop.github.io/drawing-request/dashboard.html （申請頁右上角也有「管理看板」連結）
- 限核發主管、文管、系統管理員；同樣用 LINE 登入，電腦瀏覽器也可以開。
- 內容：重點數字、①每月申請趨勢、②各關處理速度與目前等待中、③申請用途與外部用途（含常見外發對象）、④最常被調閱的品號、⑤駁回率與常見原因、各部門與各資料別件數。
- 期間可選本月、近 3 個月、近 12 個月、今年、全部或自訂；「匯出 Excel」下載 CSV（含 BOM，Excel 直接開啟中文不亂碼；開頭是 = + - @ 的內容會加上 ' 避免被當成公式）。
- 資料來自資料庫函式 `dashboard_data`、`export_requests`，函式內檢查角色。

## LINE 通知（Edge Function `line-notify`）
- 資料庫函式在送出、簽核、發放時把通知寫入 `notifications`；網頁動作完成後呼叫 `line-notify`，由它推播給對象並標記已發送。
- 同一則通知只會成功發送一次；失敗會記錄錯誤，1 分鐘後可重試，最多 3 次。
- 需要在 Supabase → Edge Functions → **Secrets** 設定 `LINE_CHANNEL_ACCESS_TOKEN`（官方帳號 Messaging API 的長期 Channel access token），**不可**寫進任何檔案。
- 部署時要關閉 **Verify JWT**（`supabase/config.toml` 已設定）。
- 通知連結：`https://liff.line.me/2012594772-22NJxRHt?tab=review&doc=單號`（待簽核）、`?tab=issue&doc=…`（待發放）、`?tab=mine&doc=…`（我的申請）。打開後會直接捲到那一張單並短暫加框標示；核准、發放仍要本人在畫面上按按鈕。
- 有人第一次用 LINE 登入（帳號待啟用）時，資料庫會排入「新帳號待啟用」通知給所有系統管理員，待啟用畫面會觸發發送。

### 第一位系統管理員
第一次用 LINE 登入後，在 SQL Editor 執行（把名字換成登入頁顯示的名字）：

```sql
update public.profiles
set active = true, is_admin = true, is_issuer = true
where display_name = '你的 LINE 名稱';
```

## 介面設計
- **設計規範在 `DESIGN.md`**（Google DESIGN.md 格式）：配色、字級、圓角、間距、元件的正式數值與使用原則。修改樣式前先看這份。
  - 檢查規範：`npx @google/design.md lint DESIGN.md`（含 WCAG 對比度檢查）
  - 檢查 `theme.css` 的顏色是否和規範一致：`python3 tests/check_design_tokens.py`
- `theme.css`：兩個頁面共用的配色、字型、按鈕、輸入框、面板樣式，支援深色模式（跟隨系統設定）。`style.css` 是申請頁版面，`dashboard.css` 是看板版面。
- 風格「Title Block（圖框標題欄）」：暖白紙底、白色面板、1px 細線分隔、普魯士藍當唯一的行動色；單號、品號、區段編號用等寬字。顏色只用來表示狀態（簽核中、已發放、已駁回、外部用途）和圖表資料。
- 申請頁在電腦上會改成「左欄區段標題、右欄欄位」；看板的重點數字是一條細線格，第一格（申請總數）放大。
- 英數字使用 Geist 字型（`fonts/geist-latin.woff2`，SIL Open Font License，授權見 `fonts/LICENSE-Geist.txt`）；中文使用裝置的系統字型，等寬字使用系統的 `ui-monospace`。
- 動畫只使用 `transform` 與 `opacity`；使用者設定「減少動態效果」時會自動關閉。
- 修改樣式或程式後，請把 `index.html`、`dashboard.html` 裡的 `?v=數字` 加 1，手機上的 LINE 才會讀到新版。

## 本機預覽
```bash
python3 -m http.server 8000
```
開啟 http://localhost:8000/ 。在一般瀏覽器開啟會轉到 LINE 登入頁。

## 測試
在本機 PostgreSQL 上模擬 Supabase 的角色，測試權限與簽核流程：

```bash
tests/run_db_tests.sh
```

Edge Function 測試（需要 Deno）：

```bash
LINE_LOGIN_TEST=1 LINE_NOTIFY_TEST=1 deno test --allow-env --allow-net=127.0.0.1 supabase/functions/
```

網頁端對端測試（需要 Node.js；第一次先在 `tests/` 執行 `npm install` 和 `npx playwright install chromium`）：

```bash
tests/run_web_tests.sh
```

網頁測試用真的資料庫函式與權限，只有 LINE 登入用假資料代替。

申請表單的「草稿」與「上次選的部門」只存在使用者自己手機的瀏覽器（localStorage，依帳號分開），不會上傳；送出成功後草稿會刪除。

網頁測試也會檢查響應式版面（RWD）：在 320、375、414、768、1024、1280、1440px 七種寬度打開申請頁各分頁與管理看板，確認沒有橫向捲動、沒有元素超出畫面，手機寬度下可點擊的東西至少 44px 高。設定 `SHOT_DIR=資料夾` 會另外存下每種寬度的截圖（`rwd-畫面-寬度.png`）。

資料庫測試預設連 `localhost:5432`、使用者 `postgres`，可用 `PGHOST`、`PGPORT`、`PGUSER` 調整。測試會建立暫時資料庫，結束後自動刪除。
