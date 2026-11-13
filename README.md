# 開發部圖面資料申請表

需求見 [需求筆記.txt](需求筆記.txt)，專案規則見 [AGENTS.md](AGENTS.md)。

## 架構
- 網頁：GitHub Pages（`main` 分支根目錄），在 LINE 裡用 LIFF 開啟。目前是登入測試頁。
  - 網址：https://ming32409-boop.github.io/drawing-request/
  - LINE 裡開啟：https://liff.line.me/2012594772-22NJxRHt
- 登入：LINE Login
- 資料庫：Supabase（`supabase/schema.sql`）
- 通知：LINE 官方帳號（Messaging API），由 Supabase Edge Functions 發送（製作中）

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

### 資料庫重點
- 未登入的訪客沒有任何權限。
- 前端只能讀資料；新增、簽核、撤回、發放都要呼叫資料庫函式：
  - `submit_request(...)`：送出申請，回傳單號 `DOC-yyyyMMdd-001`
  - `review_request(申請單id, 核准true/駁回false, 駁回原因)`：自動判斷是第一關或第二關
  - `withdraw_request(申請單id)`：第一關簽核前撤回
  - `deliver_request(申請單id, 發放方式, 其他說明)`：文管發放結案
  - `request_stats()`：統計儀表板
- 每個動作寫入 `request_events`；要發的 LINE 通知寫入 `notifications`，由後端發送。

## LINE 登入（Edge Function `line-login`）
- 網頁用 LIFF 取得 LINE ID token → 呼叫 `line-login` → 向 LINE 驗證 → 建立或找出 Supabase 帳號 → 回傳登入 session。
- 新帳號預設「待啟用」，要由系統管理員啟用。
- 部署時要關閉 **Verify JWT**（`supabase/config.toml` 已設定）。
- 只使用 Supabase 自動提供的環境變數，不需要另外設定任何金鑰。
- LIFF 的 Endpoint URL：`https://ming32409-boop.github.io/drawing-request/`

### 第一位系統管理員
第一次用 LINE 登入後，在 SQL Editor 執行（把名字換成登入頁顯示的名字）：

```sql
update public.profiles
set active = true, is_admin = true, is_issuer = true
where display_name = '你的 LINE 名稱';
```

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
LINE_LOGIN_TEST=1 deno test --allow-env --allow-net=127.0.0.1 supabase/functions/line-login/
```

資料庫測試預設連 `localhost:5432`、使用者 `postgres`，可用 `PGHOST`、`PGPORT`、`PGUSER` 調整。測試會建立暫時資料庫，結束後自動刪除。
