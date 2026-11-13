"""資料庫權限與簽核流程測試。
用法：tests/run_db_tests.sh（會建立暫時資料庫，載入 Supabase 模擬環境與 schema.sql 後執行）
參數：python3 test_schema.py <socket 目錄或主機> <port> <資料庫名稱>
"""
import subprocess, sys, uuid
P, PORT, DB = sys.argv[1], sys.argv[2], sys.argv[3]
fails = 0
def run(sql, as_uid=None, role='authenticated'):
    pre = 'begin;\n'
    if role: pre += f"set local role {role};\n"
    if as_uid: pre += f"select set_config('request.jwt.claim.sub', '{as_uid}', true);\n"
    r = subprocess.run(['psql','-h',P,'-p',PORT,'-U','postgres','-d',DB,'-tAq','-v','ON_ERROR_STOP=1','-c',pre+sql.rstrip().rstrip(';')+';\ncommit;'],capture_output=True,text=True)
    return r.returncode, (r.stdout.strip().splitlines() or [''])[-1], r.stderr.strip()
def ok(c, m):
    global fails
    print(('PASS ' if c else 'FAIL ')+m); fails += (not c)
def expect_err(sql, uid, frag, m, role='authenticated'):
    rc, out, err = run(sql, uid, role); ok(rc != 0 and frag in err, m + (f'  [{err[-120:]}]' if not (rc!=0 and frag in err) else ''))
def val(sql, uid=None, role='authenticated'):
    rc, out, err = run(sql, uid, role)
    if rc: print('   ERR', err[-200:])
    return out

U = {k: str(uuid.uuid4()) for k in ['app','app2','qcmgr','devmgr','dcc1','dcc2','admin','off']}
for i,(k,u) in enumerate(U.items()):
    lid = 'U' + uuid.uuid4().hex
    val(f"insert into auth.users values ('{u}'); insert into public.profiles (id,line_user_id,display_name,is_issuer,is_dcc,is_admin,active) values ('{u}','{lid}','示範{k}',{str(k=='devmgr').lower()},{str(k.startswith('dcc')).lower()},{str(k=='admin').lower()},{str(k!='off').lower()});", role=None)
val(f"update departments set manager_id='{U['qcmgr']}' where name='品管課'; update departments set manager_id='{U['devmgr']}' where name='開發部';", role=None)
QC = val("select id from departments where name='品管課'", role=None)
DEV = val("select id from departments where name='開發部'", role=None)
OTHER = val("select id from departments where name='其他'", role=None)
BUY = val("select id from departments where name='採購課'", role=None)

def submit(uid, dept, purpose="'設計參考'", formats="array['2D PDF']", extra_other="null", fmt_other="null", dept_other="null", need="null", types="array['圖面']"):
    return f"select submit_request({dept}::smallint, {dept_other}, {types}, 'AB-CD-123456-1/示範固定座', {purpose}, {extra_other}, {formats}, {fmt_other}, {need}, null)"

# anon has nothing
expect_err("select * from requests", None, 'permission denied', 'anon cannot read requests', role='anon')
expect_err(submit(U['app'], QC), None, 'permission denied', 'anon cannot call submit_request', role='anon')
expect_err("select * from departments", None, 'permission denied', 'anon cannot read departments', role='anon')

# direct table writes blocked
expect_err(f"insert into requests (doc_no,applicant_id,department_id,data_types,items,purpose,formats) values ('DOC-20260101-001','{U['app']}',{QC},array['圖面'],'x','設計參考',array['2D PDF'])", U['app'], 'permission denied', 'authenticated cannot insert requests directly')
expect_err("update requests set status='已發放結案'", U['devmgr'], 'permission denied', 'authenticated cannot update requests directly')
expect_err("delete from request_events", U['admin'], 'permission denied', 'events cannot be deleted')
expect_err("select line_user_id from profiles", U['app'], 'permission denied', 'line_user_id hidden from frontend')
expect_err("select * from notifications", U['devmgr'], 'permission denied', 'notifications hidden from frontend')
expect_err("select _notify(gen_random_uuid(), gen_random_uuid(), '已發放')", U['app'], 'permission denied', 'internal _notify not callable')

# validation
expect_err(submit(U['app'], QC, formats="array[]::text[]"), U['app'], '請至少選擇一種需求格式', 'rejects empty formats')
expect_err(submit(U['app'], QC, purpose="'其他'"), U['app'], 'requests_purpose_other_check', 'rejects purpose 其他 without explanation')
expect_err(submit(U['app'], QC, formats="array['其他']"), U['app'], 'requests_format_other_check', 'rejects format 其他 without explanation')
expect_err(submit(U['app'], OTHER), U['app'], '必須填寫說明', 'rejects department 其他 without explanation')
expect_err(submit(U['app'], QC, types="array[]::text[]"), U['app'], '請至少選擇一種申請資料別', 'rejects empty data types')
expect_err(submit(U['app'], QC, types="array['藍圖']"), U['app'], 'requests_data_types_check', 'rejects unknown data type')
expect_err(submit(U['app'], BUY), U['app'], '尚未設定部門主管', 'rejects department without manager')
expect_err(submit(U['app'], QC, need="'2020-01-01'"), U['app'], '不能早於今天', 'rejects past need date')
expect_err(submit(U['off'], QC), U['off'], '停用', 'inactive user cannot submit')

# happy path
d1 = val(submit(U['app'], QC, purpose="'提供給客戶'"), U['app'])
d2 = val(submit(U['app2'], QC), U['app2'])
ok(d1.startswith('DOC-') and d1.endswith('-001') and d2.endswith('-002'), f'doc numbers {d1} {d2}')
R1 = val(f"select id from requests where doc_no='{d1}'", role=None); R2 = val(f"select id from requests where doc_no='{d2}'", role=None)
ok(val(f"select status||'|'||stage1_result||'|'||stage2_result||'|'||is_external from requests where id='{R1}'", role=None) == '申請主管簽核中|待簽核|待第一關簽核|true', 'initial state + external flag')
ok(val(f"select string_agg(kind,',') from notifications n join profiles p on p.id=n.recipient_id where request_id='{R1}' and p.id='{U['qcmgr']}'", role=None) == '待第一關簽核', 'dept manager notified')

# visibility
ok(val("select count(*) from requests", U['app']) == '1', 'applicant sees only own request')
ok(val("select count(*) from requests", U['qcmgr']) == '2', 'dept manager sees dept requests')
ok(val("select count(*) from requests", U['dcc1']) == '2', 'dcc sees all')
ok(val("select count(*) from requests", U['admin']) == '0', 'admin (non-issuer) sees no requests')
ok(val(f"select count(*) from request_events where request_id='{R2}'", U['app']) == '0', 'cannot see others events')

# stage 1
expect_err(f"select review_request('{R1}', true)", U['devmgr'], '只有該部門主管', 'other manager cannot approve stage1')
expect_err(f"select review_request('{R1}', true)", U['app'], '只有該部門主管', 'applicant cannot approve own')
expect_err(f"select review_request('{R1}', false, '  ')", U['qcmgr'], '必須填寫原因', 'reject requires reason')
ok(val(f"select review_request('{R1}', true)", U['qcmgr']) == '核發主管簽核中', 'stage1 approve')
expect_err(f"select review_request('{R1}', true)", U['qcmgr'], '只有核發主管', 'stage1 manager cannot approve stage2')
expect_err(f"select withdraw_request('{R1}')", U['app'], '不能撤回', 'cannot withdraw after stage1')
expect_err(f"select deliver_request('{R1}', 'Email')", U['dcc1'], '不能發放', 'cannot deliver before stage2')
ok(val(f"select count(*) from notifications where request_id='{R1}' and kind='待第二關簽核' and recipient_id='{U['devmgr']}'", role=None) == '1', 'issuer notified')
# stage 2
ok(val(f"select review_request('{R1}', true)", U['devmgr']) == '待文管發放', 'stage2 approve')
ok(val(f"select count(*) from notifications where request_id='{R1}' and kind='待發放'", role=None) == '2', 'both dcc notified')
expect_err(f"select review_request('{R1}', true)", U['devmgr'], '不能簽核', 'cannot approve twice')
expect_err(f"select deliver_request('{R1}', null)", U['dcc1'], '請選擇發放方式', 'deliver requires method')
expect_err(f"select deliver_request('{R1}', '其他')", U['dcc1'], '必須填寫說明', 'deliver 其他 requires note')
expect_err(f"select deliver_request('{R1}', 'Email')", U['qcmgr'], '只有文管', 'non-dcc cannot deliver')
ok(val(f"select deliver_request('{R1}', '雲端連結')", U['dcc1']) == '已發放結案', 'dcc delivers')
expect_err(f"select deliver_request('{R1}', 'Email')", U['dcc2'], '不能發放', 'second dcc cannot deliver again')
ok(val(f"select count(*) from notifications where request_id='{R1}' and kind='已發放' and recipient_id='{U['app']}'", role=None) == '1', 'applicant notified on delivery')
ok(val(f"select string_agg(action||coalesce(stage::text,''),',' order by id) from request_events where request_id='{R1}'", U['app']) == '送出,核准1,核准2,發放3', 'event log complete & visible to applicant')

# withdraw / reject paths
expect_err(f"select withdraw_request('{R2}')", U['app'], '只能撤回自己', 'cannot withdraw others')
ok(val(f"select withdraw_request('{R2}')", U['app2']) == '已撤回', 'withdraw before stage1')
expect_err(f"select review_request('{R2}', true)", U['qcmgr'], '不能簽核', 'cannot approve withdrawn')
d3 = val(submit(U['app'], QC), U['app']); R3 = val(f"select id from requests where doc_no='{d3}'", role=None)
val(f"select review_request('{R3}', true)", U['qcmgr'])
ok(val(f"select review_request('{R3}', false, '用途不明')", U['devmgr']) == '已駁回', 'stage2 reject')
ok(val(f"select string_agg(p.display_name,',' order by p.display_name) from notifications n join profiles p on p.id=n.recipient_id where request_id='{R3}' and kind='已駁回'", role=None) == '示範app,示範qcmgr', 'stage2 reject notifies applicant + stage1 manager')
# manager self-submit skips stage1
d4 = val(submit(U['qcmgr'], QC), U['qcmgr']); R4 = val(f"select id from requests where doc_no='{d4}'", role=None)
ok(val(f"select status||'|'||stage1_result from requests where id='{R4}'", role=None) == '核發主管簽核中|免簽', 'manager own request skips stage1')
expect_err(f"select withdraw_request('{R4}')", U['qcmgr'], '不能撤回', 'cannot withdraw after 免簽')

# 002：未啟用帳號只看得到自己
ok(val("select count(*) from departments", U['off']) == '0', 'inactive user cannot list departments')
ok(val("select count(*) from profiles", U['off']) == '1', 'inactive user sees only own profile')
ok(val("select count(*) from profiles", U['app']) == str(len(U)), 'active user sees all profiles')
ok(val("select count(*) from departments", U['app']) == '6', 'active user lists departments')

# stats
expect_err("select request_stats()", U['app'], '沒有權限', 'applicant cannot see stats')
st = val("select request_stats()->>'total'||','||(request_stats()->>'issued')", U['admin'])
ok(st == '4,1', 'admin sees stats ' + st)
# admin
ok(val(f"with u as (update profiles set is_admin=true where id='{U['app']}' returning 1) select count(*) from u", U['app']) == '0', 'non-admin cannot change roles')
ok(val(f"with u as (update profiles set is_dcc=true where id='{U['app2']}' returning 1) select count(*) from u", U['admin']) == '1', 'admin can change roles')
expect_err(f"update profiles set line_user_id='U'||repeat('0',32) where id='{U['app2']}'", U['admin'], 'permission denied', 'admin cannot change line_user_id')
ok(val("with u as (insert into departments(name) values ('測試課') returning 1) select count(*) from u", U['admin']) == '1', 'admin can add department')
expect_err("insert into departments(name) values ('測試課2')", U['app'], 'row-level security', 'non-admin cannot add department')
# concurrency of doc numbers
import concurrent.futures as cf
with cf.ThreadPoolExecutor(8) as ex:
    nos = list(ex.map(lambda _: val(submit(U['app'], QC), U['app']), range(8)))
ok(len(set(nos)) == 8 and all(n.startswith('DOC-') for n in nos), 'concurrent submits get unique doc numbers')
print('FAILS', fails); sys.exit(1 if fails else 0)
