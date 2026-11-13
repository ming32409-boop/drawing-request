#!/usr/bin/env bash
# 網頁端對端測試：建立暫時資料庫 → 載入 schema → 用瀏覽器操作網頁。
# 需要：PostgreSQL、Node.js；第一次請先在 tests/ 執行 npm install（並安裝 Playwright 的 Chromium）。
# 可用環境變數調整：PGHOST、PGPORT、PGUSER。
set -euo pipefail
cd "$(dirname "$0")"
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
DB="drawing_web_$$"
psql -d postgres -qc "create database $DB"
trap 'psql -d postgres -qc "drop database if exists $DB"' EXIT
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase_stub.sql \
  -f ../supabase/schema.sql -f ../supabase/002_require_active.sql -f ../supabase/003_grant_service_role.sql
node web/e2e.test.js "$DB"
