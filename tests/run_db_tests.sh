#!/usr/bin/env bash
# 在本機 PostgreSQL 建立暫時資料庫，執行 schema.sql 並跑權限與流程測試。
# 需要：psql、python3，以及可連線的 PostgreSQL（預設 localhost:5432、使用者 postgres）。
# 可用環境變數調整：PGHOST、PGPORT、PGUSER。
set -euo pipefail
cd "$(dirname "$0")"
HOST="${PGHOST:-localhost}"; PORT="${PGPORT:-5432}"; export PGUSER="${PGUSER:-postgres}"
DB="drawing_test_$$"
psql -h "$HOST" -p "$PORT" -d postgres -qc "create database $DB"
trap 'psql -h "$HOST" -p "$PORT" -d postgres -qc "drop database if exists $DB"' EXIT
psql -h "$HOST" -p "$PORT" -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase_stub.sql -f ../supabase/schema.sql -f ../supabase/002_require_active.sql -f ../supabase/003_grant_service_role.sql -f ../supabase/004_notification_outbox.sql -f ../supabase/005_dashboard.sql
python3 test_schema.py "$HOST" "$PORT" "$DB"
