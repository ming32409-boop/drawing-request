# 開發部圖面資料申請表｜專案規則

本儲存庫是「開發部圖面資料申請表」的專案，需求以 `需求筆記.txt` 為準。報修系統是另一個專案（`Repair-System` 儲存庫），不要混在一起。

## 每次開工
1. 先把工作區更新到 GitHub 上最新的 `main`：

   ```bash
   git fetch origin main
   git checkout -B <工作分支> origin/main
   ```

2. 開工前確認 `git status` 沒有未提交的變更；有的話先問使用者怎麼處理，不要直接丟掉。

## 完成後
1. 提交並推送到工作分支。
2. 用 GitHub 外掛（GitHub MCP 工具）建立 Pull Request，再用 GitHub 外掛合併進 `main`。
3. 回報 Pull Request 連結、合併結果，以及做過哪些驗證、哪些沒驗證。

## 金鑰與機密（最重要）
- 前端只能使用 Supabase **publishable key**。
- **secret key 不可以寫進任何檔案**，包含程式碼、設定檔、文件、測試、範例、commit 訊息與 Pull Request 說明。這條規則也適用於：
  - Supabase secret key、service_role key
  - LINE Channel secret、LINE Channel access token
  - 資料庫密碼
- 機密只能存在 Supabase 後台的機密設定（Edge Functions secrets），程式用環境變數讀取。
- 本機測試用的 `.env` 等檔案必須列在 `.gitignore`，不可提交。
- 發現機密已經被提交時，立刻停下來告訴使用者：要撤換金鑰，光刪檔案不夠。

## 資料與個資
- 一律使用虛構的姓名、部門、品號、客戶與廠商名稱。
- 不寫入真實的 LINE User ID、Email、電話或客戶資料，範例請用明顯的假值。

## 資料庫與權限
- 所有資料表都要啟用資料列安全（RLS），不開放未登入的匿名存取。
- 先收回預設權限，再只授予需要的權限（GRANT）。
- 核准、駁回、發放等狀態變更只能透過資料庫函式；函式內要檢查執行人的角色與案件目前狀態。
- 簽核紀錄只能新增，不能修改或刪除。
- 資料庫結構的變更寫成 SQL 檔放在 `supabase/`，不要只在後台手動改。

## 介面與命名
- 介面文字使用繁體中文，選項值照 `需求筆記.txt` 的寫法，不自行改名。
- 表單欄位、資料庫欄位、文件中的名稱要一致；資料庫欄位用英文小寫加底線。
- 網頁以手機（LINE 內開啟）為主要使用情境。

## 資料夾
- 根目錄的 `index.html`、`*.js`、`*.css`：網頁前端（GitHub Pages 從 `main` 的根目錄發佈，LIFF 開啟）
- `supabase/`：資料表、RLS、資料庫函式、Edge Functions
- `tests/`：測試
- `文件/`：Excel 欄位表、操作說明、簡報

## 測試
- 新增功能時一併加上測試，並在 `README.md` 寫明怎麼執行。
- 至少涵蓋：
  - 必填欄位檢查
  - 申請人只能看到自己的申請
  - 非該關主管不能核准
  - 狀態只能依順序前進
  - 重複發放只會成功一次
- 沒有實際連到 Supabase 或 LINE 測試時，要在回報中明確說明。

## Commit 與 Pull Request
- Commit 訊息用簡短的祈使句，例如「新增申請表單」。
- Pull Request 說明要寫：改了什麼、對應哪段需求、做了哪些驗證、介面變更附截圖。
- 「還沒決定的事」裡的項目，先問使用者，不要自行決定後直接實作。
