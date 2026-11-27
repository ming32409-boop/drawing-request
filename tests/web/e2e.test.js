// 網頁端對端測試：網頁 →（把 Supabase API 請求轉成 SQL）→ 本機 PostgreSQL
// 資料庫函式、權限、RLS 都是真的；LINE（LIFF）與登入後端用假資料代替。
// 執行：tests/run_web_tests.sh
const { chromium, devices } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { Pool } = require('pg');
const ROOT = path.resolve(__dirname, '..', '..');
const UMD = fs.readFileSync(require.resolve('@supabase/supabase-js/dist/umd/supabase.js'));
const SB = require(ROOT + '/tests/web/config-url.js');
const PORT = 8790;
const PAGE = `http://localhost:${PORT}/`;
const pool = new Pool({ host: process.env.PGHOST || 'localhost', port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres', database: process.argv[2], max: 4 });

// 靜態網頁伺服器（只提供儲存庫根目錄的檔案）
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, PAGE).pathname).replace(/\/$/, '/index.html'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT);
// 截圖時關閉動畫，畫面才不會停在動畫中途
const RM = { reducedMotion: process.env.SHOT_DIR ? 'reduce' : 'no-preference' };
const shot = async (pg, name) => { if (process.env.SHOT_DIR) await pg.screenshot({ path: process.env.SHOT_DIR + '/' + name + '.png', fullPage: true }); };
// 頁內確認面板：測試時預設自動按「確定」並記下內容（和原本自動接受瀏覽器確認視窗一樣）；
// 要測面板本身時，在頁面上設定 window.__autoSheet = false。
const AUTO_SHEET = `(() => {
  window.__sheetLog = []; window.__autoSheet = true;
  new MutationObserver(() => {
    const s = document.getElementById('confirm-sheet');
    if (!s) return;
    if (s.hidden) { s.dataset.seen = ''; return; }
    if (s.dataset.seen === '1' || !window.__autoSheet) return;
    s.dataset.seen = '1';
    window.__sheetLog.push(s.querySelector('.sheet-title').textContent + '\\n' + s.querySelector('.sheet-body').textContent);
    setTimeout(() => s.querySelector('.sheet-ok').click(), 0);
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
})();`;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtFor = uid => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.sig';
const subOf = h => { try { return JSON.parse(Buffer.from((h || '').replace('Bearer ', '').split('.')[1], 'base64url').toString()).sub; } catch { return null; } };

async function asUser(uid, sql, params) {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await c.query(sql, params); await c.query('commit'); return r.rows;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const REQ_COLS = `r.id, r.doc_no, r.created_at, r.status, r.is_external, r.department_id, r.department_other, r.data_types, r.items,
  r.purpose, r.purpose_other, r.formats, r.format_other, r.need_date, r.external_note, r.stage1_result, r.stage1_reason,
  r.stage2_result, r.stage2_reason, r.delivery_method, r.delivery_method_other, r.delivery_note, r.delivered_at`;
const rpcArgs = {
  submit_request: `p_department_id => ($1::jsonb->>'p_department_id')::smallint, p_department_other => $1::jsonb->>'p_department_other',
    p_data_types => array(select jsonb_array_elements_text($1::jsonb->'p_data_types')), p_items => $1::jsonb->>'p_items',
    p_purpose => $1::jsonb->>'p_purpose', p_purpose_other => $1::jsonb->>'p_purpose_other',
    p_formats => array(select jsonb_array_elements_text($1::jsonb->'p_formats')), p_format_other => $1::jsonb->>'p_format_other',
    p_need_date => ($1::jsonb->>'p_need_date')::date, p_external_note => $1::jsonb->>'p_external_note'`,
  withdraw_request: `p_request_id => ($1::jsonb->>'p_request_id')::uuid`,
  deliver_request: `p_request_id => ($1::jsonb->>'p_request_id')::uuid, p_method => $1::jsonb->>'p_method',
    p_method_other => $1::jsonb->>'p_method_other', p_note => $1::jsonb->>'p_note'`,
  dashboard_data: `p_from => ($1::jsonb->>'p_from')::date, p_to => ($1::jsonb->>'p_to')::date`,
  search_requests: `p_q => $1::jsonb->>'p_q', p_status => $1::jsonb->>'p_status',
    p_department_id => ($1::jsonb->>'p_department_id')::smallint, p_limit => ($1::jsonb->>'p_limit')::int,
    p_offset => ($1::jsonb->>'p_offset')::int`,
  claim_request: `p_request_id => ($1::jsonb->>'p_request_id')::uuid, p_claim => ($1::jsonb->>'p_claim')::boolean`,
  review_request: `p_request_id => ($1::jsonb->>'p_request_id')::uuid, p_approve => ($1::jsonb->>'p_approve')::boolean,
    p_reason => $1::jsonb->>'p_reason'`,
};
let notifyCalls = 0;
const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', 'content-type': 'application/json' };
const calls = [];
async function api(route) {
  const q = route.request(); const u = new URL(q.url()); const p = u.searchParams;
  if (q.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  const reply = (body, status = 200) => route.fulfill({ status, headers: H, body: JSON.stringify(body) });
  const uid = subOf(q.headers()['authorization']);
  calls.push(q.method() + ' ' + u.pathname);
  try {
    if (u.pathname === '/functions/v1/line-notify') { notifyCalls++; return reply({ sent: 0, failed: 0 }); }
    if (u.pathname === '/functions/v1/line-login') return reply({ access_token: jwtFor(global.CURRENT), refresh_token: 'r', expires_at: 9999999999 });
    if (u.pathname === '/auth/v1/user') return reply({ id: uid, aud: 'authenticated', role: 'authenticated' });
    if (u.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: H });
    // 管理設定：列出全部帳號、修改角色、部門的新增與修改（都以登入者身分執行，權限與觸發器都是真的）
    const SETTABLE = { profiles: ['active', 'is_admin', 'is_issuer', 'is_dcc'], departments: ['name', 'sort_order', 'active', 'manager_id'] };
    const tbl = u.pathname.replace('/rest/v1/', '');
    if (SETTABLE[tbl] && (q.method() === 'PATCH' || q.method() === 'POST')) {
      const body = JSON.parse(q.postData());
      const keys = Object.keys(body).filter(k => SETTABLE[tbl].includes(k));
      const vals = keys.map(k => body[k]);
      const ph = i => '$' + String(i + 1);
      const rows = q.method() === 'PATCH'
        ? await asUser(uid, 'update public.' + tbl + ' set ' + keys.map((k, i) => k + ' = ' + ph(i)).join(', ') +
            ' where id = ' + ph(keys.length) + ' returning id', [...vals, p.get('id').slice(3)])
        : await asUser(uid, 'insert into public.' + tbl + ' (' + keys.join(', ') + ') values (' +
            keys.map((k, i) => ph(i)).join(', ') + ') returning id', vals);
      return reply(rows, q.method() === 'POST' ? 201 : 200);
    }
    if (u.pathname === '/rest/v1/profiles' && !p.get('id')) {
      return reply(await asUser(uid, 'select id, display_name, is_admin, is_issuer, is_dcc, active, created_at from public.profiles'));
    }
    if (u.pathname === '/rest/v1/departments' && (p.get('select') || '').includes('sort_order')) {
      return reply(await asUser(uid, 'select id, name, sort_order, active, manager_id from public.departments order by sort_order, id'));
    }
    if (u.pathname === '/rest/v1/profiles') {
      const rows = await asUser(uid, 'select id, display_name, is_admin, is_issuer, is_dcc, active from public.profiles where id = $1', [p.get('id').slice(3)]);
      return q.headers()['accept'].includes('object') ? (rows.length ? reply(rows[0]) : reply({ code: 'PGRST116', message: 'no rows' }, 406)) : reply(rows);
    }
    if (u.pathname === '/rest/v1/departments') return reply(await asUser(uid, 'select id, name, manager_id from public.departments where active order by sort_order, id'));
    if (u.pathname === '/rest/v1/requests' && p.get('status')) {
      // 待我簽核：status=eq.X，可能有 department_id=in.(1,2)
      const ids = p.get('department_id') ? p.get('department_id').replace(/^in\.\(|\)$/g, '').split(',').map(Number) : null;
      return reply(await asUser(uid, `select ${REQ_COLS}, r.stage1_at, r.stage2_at, r.claimed_by, r.claimed_at,
          case when cp.id is null then null else json_build_object('display_name', cp.display_name) end as claimed_by_profile,
          case when s2.id is null then null else json_build_object('display_name', s2.display_name) end as stage2_by_profile,
          json_build_object('display_name', ap.display_name) as applicant,
          case when s1.id is null then null else json_build_object('display_name', s1.display_name) end as stage1_by_profile,
          case when d.id is null then null else json_build_object('name', d.name) end as department
        from public.requests r left join public.departments d on d.id = r.department_id
        left join public.profiles ap on ap.id = r.applicant_id left join public.profiles s1 on s1.id = r.stage1_by left join public.profiles s2 on s2.id = r.stage2_by
        left join public.profiles cp on cp.id = r.claimed_by
        where r.status = $1 and ($2::smallint[] is null or r.department_id = any($2)) order by r.created_at limit 100`,
        [p.get('status').slice(3), ids]));
    }
    if (u.pathname === '/rest/v1/requests') {
      return reply(await asUser(uid, `select ${REQ_COLS}, case when d.id is null then null else json_build_object('name', d.name) end as department,
          r.claimed_at, case when cp.id is null then null else json_build_object('display_name', cp.display_name) end as claimed_by_profile
        from public.requests r left join public.departments d on d.id = r.department_id left join public.profiles cp on cp.id = r.claimed_by
        where r.applicant_id = $1 order by r.created_at desc limit $2`, [p.get('applicant_id').slice(3), Number(p.get('limit'))]));
    }
    if (u.pathname === '/rest/v1/request_events') {
      return reply(await asUser(uid, `select e.action, e.stage, e.note, e.created_at,
        case when pr.id is null then null else json_build_object('display_name', pr.display_name) end as actor
        from public.request_events e left join public.profiles pr on pr.id = e.actor_id where e.request_id = $1 order by e.id`, [p.get('request_id').slice(3)]));
    }
    const m = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m && m[1] === 'export_requests') {
      return reply(await asUser(uid, `select * from public.export_requests(p_from => ($1::jsonb->>'p_from')::date, p_to => ($1::jsonb->>'p_to')::date)`, [q.postData()]));
    }
    if (m && rpcArgs[m[1]]) {
      const rows = await asUser(uid, `select public.${m[1]}(${rpcArgs[m[1]]}) as v`, [q.postData()]);
      return reply(rows[0].v);
    }
    return reply({ message: 'unexpected ' + u.pathname }, 500);
  } catch (e) { return reply({ code: e.code, message: e.message }, 400); }
}

(async () => {
  const U = { app: 'aaaaaaaa-0000-4000-8000-000000000001', mgr: 'aaaaaaaa-0000-4000-8000-000000000002', off: 'aaaaaaaa-0000-4000-8000-000000000003' };
  await pool.query(`insert into auth.users values ($1),($2),($3);
    insert into public.profiles (id, line_user_id, display_name, active) values
      ($1, 'U${'1'.repeat(32)}', '示範申請人', true), ($2, 'U${'2'.repeat(32)}', '示範主管', true), ($3, 'U${'3'.repeat(32)}', '示範新人', false);
    update public.departments set manager_id = $2 where name in ('品管課', '開發部');`.replace(/\$1/g, `'${U.app}'`).replace(/\$2/g, `'${U.mgr}'`).replace(/\$3/g, `'${U.off}'`));

  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], ...RM });
  await ctx.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
    `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'9'.repeat(32)})};` }));
  await ctx.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
  await ctx.route(SB + '/**', api);
  await ctx.addInitScript(AUTO_SHEET);
  const p = await ctx.newPage();
  p.on('pageerror', e => ok(false, 'page error ' + e));
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

  global.CURRENT = U.app;
  await p.goto(PAGE);
  await p.waitForSelector('#tabs:not([hidden])');
  ok(await p.textContent('#who') === '示範申請人', 'header shows name');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/d-top.png' });
  ok(await p.locator('#view-new').isVisible(), 'default tab is 新增申請');
  ok((await p.$$eval('#department option', o => o.map(x => x.textContent))).join(',') === '請選擇,開發部,品管課,採購課,業務部,製造部,其他', 'department options from DB');

  // 空白送出
  const before = calls.length;
  await p.click('#submit-btn');
  ok(await p.textContent('[data-for=department]') === '請選擇所屬部門。' && await p.textContent('[data-for=data_types]') !== '' &&
     await p.textContent('[data-for=items]') !== '' && await p.textContent('[data-for=purpose]') !== '' && await p.textContent('[data-for=formats]') !== '', 'rejects_missing_required_fields');
  ok(!calls.slice(before).some(c => c.includes('rpc')), 'no RPC on invalid form');

  // 其他 需要說明
  await p.selectOption('#department', { label: '其他' });
  ok(await p.locator('#department_other').isVisible(), 'department 其他 shows explanation field');
  await p.selectOption('#purpose', '其他');
  await p.check('input[value="其他"][name=formats]');
  await p.click('#submit-btn');
  ok((await p.textContent('[data-for=department]')).includes('其他') && (await p.textContent('[data-for=purpose]')).includes('其他') && (await p.textContent('[data-for=formats]')).includes('其他'), 'rejects 其他 without explanation');
  await p.uncheck('input[value="其他"][name=formats]');

  // 伺服器端錯誤：採購課沒有主管
  await p.selectOption('#department', { label: '採購課' });
  await p.check('input[value="圖面"]');
  await p.fill('#items', 'AB-CD-000001-1/示範零件');
  await p.selectOption('#purpose', '設計參考');
  await p.check('input[value="2D PDF"]');
  await p.click('#submit-btn');
  await p.waitForSelector('#form-message.error');
  ok((await p.textContent('#form-message')).includes('尚未設定部門主管'), 'server error shown: ' + await p.textContent('#form-message'));

  // 品號格式防呆：指出第幾行有錯，不呼叫後端
  await p.fill('#items', 'AB-1 示範\n\n/只有名稱\nAB-2/\nAB-3');
  const nRpc = calls.filter(c => c.includes('rpc')).length;
  await p.click('#submit-btn');
  const itemErr = await p.textContent('[data-for=items]');
  ok(itemErr.includes('第 1 行缺少斜線') && itemErr.includes('第 3 行斜線前面缺少品號') && itemErr.includes('第 4 行斜線後面缺少名稱') && itemErr.includes('另有 1 行'),
     'rejects_bad_item_lines with line numbers: ' + itemErr);
  ok(calls.filter(c => c.includes('rpc')).length === nRpc, 'no RPC when item lines are invalid');
  if (process.env.SHOT_DIR) await p.locator('#items').locator('xpath=..').screenshot({ path: process.env.SHOT_DIR + '/d-item-error.png' });
  // 離開欄位時就提醒品號重複（大小寫視為相同），但不算錯誤
  await p.fill('#items', 'AB-1/示範甲\nab-1/示範乙');
  await p.locator('#items').blur();
  await p.waitForFunction(() => document.getElementById('items-warn').textContent !== '');
  ok((await p.textContent('#items-warn')).includes('品號重複') && (await p.textContent('#items-warn')).includes('第 1、2 行') && await p.textContent('[data-for=items]') === '',
     'duplicate part numbers warned on blur');
  if (process.env.SHOT_DIR) await p.locator('#items').locator('xpath=..').screenshot({ path: process.env.SHOT_DIR + '/d-item-dup.png' });
  await p.fill('#items', 'AB-1/示範甲');
  await p.locator('#items').blur();
  await p.waitForTimeout(600);
  ok(await p.textContent('#items-warn') === '', 'duplicate warning clears after fixing');

  // 成功送出（外部用途）
  await p.selectOption('#department', { label: '品管課' });
  await p.check('input[value="材質證明"]');
  await p.fill('#items', 'AB-CD-123456-1/示範固定座φ20x40mm\nAB-CD-123457-2/示範支架 Rev.C');
  await p.selectOption('#purpose', '提供給客戶');
  ok(await p.locator('#external-note').isVisible(), 'external purpose warning shown');
  ok(await p.textContent('#items-count') === '已輸入 2 筆', 'items count shows 2 lines');
  const tomorrow = new Date(Date.now() + 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  await p.fill('#need_date', tomorrow);
  await p.fill('#external_note', '示範客戶（虛構）');
  await shot(p, 'd-form');
  await p.click('#submit-btn');
  await p.waitForSelector('#form-message.success');
  const msg = await p.textContent('#form-message');
  const doc1 = (msg.match(/DOC-\d{8}-\d{3}/) || [])[0];
  ok(!!doc1, 'submits and shows doc number: ' + msg);
  ok(await p.getAttribute('#form-message .message-link', 'href') === '#mine', 'success message links to 我的申請');
  if (process.env.SHOT_DIR) await p.locator('.form-actions').screenshot({ path: process.env.SHOT_DIR + '/e-success.png' });
  const row = (await pool.query('select * from public.requests where doc_no = $1', [doc1])).rows[0];
  ok(row && row.status === '申請主管簽核中' && row.is_external && row.data_types.join() === '圖面,材質證明' && row.applicant_id === U.app && row.need_date.toISOString && row.items.split('\n').length === 2, 'DB row correct');
  ok(await p.inputValue('#items') === '' && !(await p.isChecked('input[value="圖面"]')), 'form resets after submit');
  const qcId = String((await pool.query("select id from public.departments where name = '品管課'")).rows[0].id);
  ok(await p.inputValue('#department') === qcId, 'remembers last department after submit');
  // 草稿：填到一半關掉，重新開啟會還原；按「清除重填」清空但保留部門
  await p.check('input[value="樣品"]');
  await p.fill('#items', 'DRAFT-1/草稿測試');
  await p.waitForTimeout(700);
  await p.reload();
  await p.waitForSelector('#tabs:not([hidden])');
  ok(await p.inputValue('#items') === 'DRAFT-1/草稿測試' && await p.isChecked('input[value="樣品"]') &&
     (await p.textContent('#prefill-note')).includes('已還原'), 'draft restored after reopening');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/e-draft.png' });
  await p.click('#draft-clear');
  ok(await p.inputValue('#items') === '' && !(await p.isChecked('input[value="樣品"]')) && await p.inputValue('#department') === qcId &&
     await p.locator('#prefill-note').isHidden(), 'clear draft empties form but keeps department');
  await p.reload();
  await p.waitForSelector('#tabs:not([hidden])');
  ok(await p.locator('#prefill-note').isHidden() && await p.inputValue('#items') === '', 'cleared draft does not come back');

  // XSS 測試用第二筆
  await p.selectOption('#department', { label: '品管課' });
  await p.check('input[value="測試報告"]');
  // 全形斜線會自動改成半形；品號重複時跳出確認，按確定仍可送出
  await p.fill('#items', '  X-1／<img src=x onerror="window.__xss=1">  \n\nx-1/重複的品號');
  await p.selectOption('#purpose', '設計參考');
  await p.check('input[value="3D STEP或STP"]');
  await p.click('#submit-btn');
  await p.waitForSelector('#form-message.success');
  const doc2 = (await p.textContent('#form-message')).match(/DOC-\d{8}-\d{3}/)[0];
  ok((await p.evaluate(() => window.__sheetLog)).some(m => m.includes('重複的品號') && m.includes('X-1')), 'duplicate part numbers ask for confirmation on submit');
  ok((await pool.query('select items from public.requests where doc_no = $1', [doc2])).rows[0].items === 'X-1/<img src=x onerror="window.__xss=1">\nx-1/重複的品號',
     'items saved normalized (fullwidth slash, trimmed, blank lines removed)');

  // 我的申請
  await p.click('a[data-tab=mine]');
  await p.waitForSelector('.request-item');
  ok(await p.locator('.request-item').count() === 2, 'mine lists 2 requests');
  const first = p.locator('.request-item').first();
  ok((await first.textContent()).includes(doc2), 'newest first');
  ok(await p.evaluate(() => !window.__xss) && await p.locator('.request-item img').count() === 0, 'HTML in items rendered as text');
  const second = p.locator('.request-item').nth(1);
  ok((await second.locator('.external-badge').count()) === 1 && (await second.locator('.badge.status').textContent()) === '申請主管簽核中', 'external badge + status');
  ok((await second.locator('.progress li').evaluateAll(l => l.map(x => x.className).join(','))) === 'done,current,todo,todo', 'progress stepper: waiting for dept manager');
  await second.locator('.item-head').click();
  await second.locator('.timeline li').first().waitFor();
  ok((await second.locator('.timeline').textContent()).includes('送出'), 'events timeline shows 送出');
  { const t = await second.locator('.detail').textContent(); ok(t.includes('品管課') && t.includes(tomorrow) && !t.includes('T00:00'), 'detail shows department and need date'); }
  await shot(p, 'd-mine');
  await p.evaluate(() => { window.__autoSheet = false; });
  await second.locator('button.danger').click();
  await p.waitForSelector('#confirm-sheet:not([hidden])');
  ok((await p.textContent('#confirm-sheet .sheet-title')).includes('撤回申請') &&
     await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('sheet-cancel')),
     'confirm sheet opens; danger action focuses 取消');
  await p.keyboard.press('Escape');
  await p.waitForSelector('#confirm-sheet', { state: 'hidden' });
  await second.locator('button.danger').click();
  await p.waitForSelector('#confirm-sheet:not([hidden])');
  if (process.env.SHOT_DIR) await p.screenshot({ path: process.env.SHOT_DIR + '/confirm-sheet.png' });
  await p.click('#confirm-sheet .sheet-cancel');
  await p.waitForSelector('#confirm-sheet', { state: 'hidden' });
  ok((await pool.query('select status from public.requests where doc_no=$1', [doc1])).rows[0].status === '申請主管簽核中' &&
     await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('danger')),
     'Esc and 取消 do not withdraw; focus returns to the button');
  await p.evaluate(() => { window.__autoSheet = true; });
  await second.locator('button.danger').click();
  await p.waitForSelector('#mine-message.success');
  await p.waitForFunction(d => [...document.querySelectorAll('.request-item')].some(li => li.textContent.includes(d) && li.textContent.includes('已撤回')), doc1);
  ok((await pool.query('select status from public.requests where doc_no=$1', [doc1])).rows[0].status === '已撤回', 'withdraw works (DB)');
  const itW = p.locator('.request-item', { hasText: doc1 });
  await itW.locator('.item-head').click();
  ok(await itW.locator('.copy-request').isVisible() && await p.locator('.request-item', { hasText: doc2 }).locator('.copy-request').count() === 0,
     'copy button only on withdrawn/rejected requests');

  // 主管核准第一關後：不能撤回，紀錄顯示
  const id2 = (await pool.query('select id from public.requests where doc_no=$1', [doc2])).rows[0].id;
  await asUser(U.mgr, 'select public.review_request($1, true)', [id2]);
  await p.click('#mine-refresh');
  await p.waitForFunction(d => [...document.querySelectorAll('.request-item')].some(li => li.textContent.includes(d) && li.textContent.includes('核發主管簽核中')), doc2);
  const it2 = p.locator('.request-item', { hasText: doc2 });
  ok((await it2.locator('.progress li').evaluateAll(l => l.map(x => x.className).join(','))) === 'done,done,current,todo', 'progress stepper: waiting for issuer');
  await it2.locator('.item-head').click();
  await it2.locator('.timeline li').nth(1).waitFor();
  ok((await it2.locator('.timeline').textContent()).includes('第一關 核准｜示範主管'), 'timeline shows stage1 approval with name');
  ok(await it2.locator('button.danger').count() === 0, 'no withdraw after stage1');
  const resX = await p.evaluate(async id => { const c = window.DrawingAuth.client; const r = await c.rpc('withdraw_request', { p_request_id: id }); return r.error && r.error.message; }, id2);
  ok(resX && resX.includes('不能撤回'), 'server refuses withdraw after stage1');
  await b.close();

  // 待啟用帳號
  const b2 = await chromium.launch(); const c2 = await b2.newContext({ ...devices['iPhone 13'], ...RM });
  await c2.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
    `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'8'.repeat(32)})};` }));
  await c2.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
  await c2.route(SB + '/**', api);
  await c2.addInitScript(AUTO_SHEET);
  global.CURRENT = U.off;
  const nPending = notifyCalls;
  const p2 = await c2.newPage(); await p2.goto(PAGE);
  await p2.waitForSelector('#pending-hint:not([hidden])');
  await p2.waitForFunction(() => true);
  ok(notifyCalls > nPending && (await p2.textContent('#pending-hint')).includes('已用 LINE 通知管理員'), 'pending screen triggers admin notification');
  ok(await p2.locator('#tabs').isHidden() && await p2.locator('#view-new').isHidden(), 'inactive user: no tabs/form');
  ok(await p2.locator('.welcome-title').isVisible() && await p2.locator('#pending-hint').isVisible(), 'inactive user sees welcome screen with pending hint');
  if (process.env.SHOT_DIR) await p2.screenshot({ path: process.env.SHOT_DIR + '/e-pending.png' });
  await b2.close();

  // ===== 第 7 步：待我簽核 =====
  const ISS = 'aaaaaaaa-0000-4000-8000-000000000004';
  await pool.query(`insert into auth.users values ('${ISS}');
    insert into public.profiles (id, line_user_id, display_name, active, is_issuer) values ('${ISS}', 'U${'4'.repeat(32)}', '示範核發主管', true, true);`);
  const b3 = await chromium.launch();
  async function openAs(uid, url) {
    const c = await b3.newContext({ ...devices['iPhone 13'], ...RM });
    await c.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
      `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'7'.repeat(32)})};` }));
    await c.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
    await c.route(SB + '/**', api);
    await c.addInitScript(AUTO_SHEET);
    global.CURRENT = uid;
    const pg = await c.newPage();
    pg.on('pageerror', e => ok(false, 'page error ' + e));
    pg.on('dialog', d => d.accept());
    await pg.goto(url);
    await pg.waitForSelector('#tabs:not([hidden])');
    return pg;
  }
  async function openAsDash(uid, viewport) {
    const opts = viewport ? { viewport, acceptDownloads: true, ...RM } : { ...devices['iPhone 13'], acceptDownloads: true, ...RM };
    const c = await b3.newContext(opts);
    await c.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
      `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'7'.repeat(32)})};` }));
    await c.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
    await c.route(SB + '/**', api);
    await c.addInitScript(AUTO_SHEET);
    global.CURRENT = uid;
    const pg = await c.newPage();
    pg.on('pageerror', e => ok(false, 'page error ' + e));
    await pg.goto(PAGE + 'dashboard.html');
    await pg.waitForFunction(() => !document.getElementById('status').textContent.includes('登入中'));
    return pg;
  }
  async function submitAs(uid, dept, items) {
    await asUser(uid, `select public.submit_request((select id from public.departments where name = $1), null, array['圖面'],
      $2, '設計參考', null, array['2D PDF'], null, null, null)`, [dept, items]);
  }
  await submitAs(U.app, '品管課', 'RV-0001/示範待核准');
  await submitAs(U.app, '品管課', 'RV-0002/示範待駁回');

  // 一般申請人看不到「待我簽核」，通知連結 ?tab=review 會退回新增申請
  let pg = await openAs(U.app, PAGE + '?tab=review');
  ok(await pg.locator('a[data-tab=review]').isHidden() && await pg.locator('#view-new').isVisible(), 'applicant: no review tab, ?tab=review falls back');
  await pg.context().close();

  // 部門主管：看到 2 筆，核准一筆、駁回一筆
  pg = await openAs(U.mgr, PAGE + '?tab=review');
  await pg.waitForSelector('#view-review:not([hidden]) .review-item');
  ok(await pg.locator('#view-review').isVisible(), 'manager: ?tab=review opens review tab');
  ok(await pg.textContent('#review-count') === '2' && await pg.locator('.review-item').count() === 2, 'manager sees 2 pending with count badge');
  ok(!(await pg.locator('#view-review').textContent()).includes('RV-OTHER'), 'only own department requests');
  // LINE 通知的連結帶單號：直接捲到那一張並標示；網址裡的參數會清掉
  const docRV2 = (await pool.query(`select doc_no from public.requests where items like 'RV-0002%'`)).rows[0].doc_no;
  const pgL = await openAs(U.mgr, PAGE + '?tab=review&doc=' + docRV2);
  await pgL.waitForSelector(`#review-list .review-item.spotlight[data-doc="${docRV2}"]`);
  ok(await pgL.locator(`.review-item[data-doc="${docRV2}"]`).isVisible() && !(await pgL.evaluate(() => location.search.includes('doc='))),
     'deep link spotlights the request and cleans the URL');
  await pgL.context().close();
  const pgN = await openAs(U.mgr, PAGE + '?tab=review&doc=DOC-20990101-001');
  await pgN.waitForFunction(() => document.getElementById('review-message').textContent.includes('已不在'));
  ok(await pgN.locator('.review-item').count() === 2, 'deep link to a handled request explains and keeps the list');
  await pgN.context().close();
  if (process.env.SHOT_DIR) await pg.screenshot({ path: process.env.SHOT_DIR + '/s7-review.png', fullPage: true });
  const n0 = notifyCalls;
  const itA = pg.locator('.review-item', { hasText: 'RV-0001' });
  await itA.locator('button.approve').click();
  await pg.waitForSelector('#review-message.success');
  await pg.waitForFunction(() => document.querySelectorAll('.review-item').length === 1);
  ok((await pool.query(`select status, stage1_by from public.requests where items like 'RV-0001%'`)).rows[0].status === '核發主管簽核中', 'approve stage1 updates DB');
  ok(notifyCalls > n0, 'approve triggers LINE notify');
  const itB = pg.locator('.review-item', { hasText: 'RV-0002' });
  await itB.locator('button.reject').click();
  await itB.locator('button.confirm-reject').click();
  ok((await itB.locator('.field-error').textContent()).includes('駁回原因'), 'reject requires reason (client)');
  // 常用原因：點一下帶入、再點另一個會接在後面、同一個不重複
  await itB.locator('.reason-chip', { hasText: '用途說明不足' }).click();
  await itB.locator('.reason-chip', { hasText: '品號或規格有誤' }).click();
  await itB.locator('.reason-chip', { hasText: '用途說明不足' }).click();
  ok(await itB.locator('textarea').inputValue() === '用途說明不足，請補充；品號或規格有誤，請確認' && await itB.locator('.field-error').textContent() === '',
     'quick reasons fill and append without duplicates');
  if (process.env.SHOT_DIR) await itB.screenshot({ path: process.env.SHOT_DIR + '/reject-reasons.png' });
  await itB.locator('textarea').fill('用途說明不足（測試）');
  await itB.locator('button.confirm-reject').click();
  await pg.waitForFunction(() => document.querySelectorAll('.review-item').length === 0);
  const rb = (await pool.query(`select status, stage1_reason from public.requests where items like 'RV-0002%'`)).rows[0];
  ok(rb.status === '已駁回' && rb.stage1_reason === '用途說明不足（測試）', 'reject stores reason');
  ok((await pg.textContent('#review-message')).includes('已駁回') && await pg.locator('#review-count').isHidden(), 'reject message, badge cleared');
  const nq = (await pool.query(`select count(*)::int n from public.notifications n join public.requests r on r.id=n.request_id where r.items like 'RV-0002%' and n.kind='已駁回'`)).rows[0].n;
  ok(nq === 1, 'reject queued notification for applicant');
  await pg.context().close();

  // 申請人：駁回原因顯示在我的申請
  pg = await openAs(U.app, PAGE + '?tab=mine');
  await pg.waitForSelector('#view-mine:not([hidden]) .request-item');
  const itRej = pg.locator('.request-item', { hasText: 'RV-0002' });
  ok((await itRej.locator('.progress li').evaluateAll(l => l.map(x => x.className).join(','))) === 'done,rejected,todo,todo', 'progress stepper: rejected at stage 1');
  ok((await itRej.locator('.badge.status').textContent()) === '已駁回', 'applicant sees 已駁回');
  await itRej.locator('.item-head').click();
  await itRej.locator('.t-note.reject').waitFor();
  ok((await itRej.locator('.t-note.reject').textContent()) === '用途說明不足（測試）', 'reject reason shown in red');
  // 複製內容重新申請：帶入原內容，修改後送出成為新的一張
  await itRej.locator('.copy-request').click();
  await pg.waitForSelector('#view-new:not([hidden])');
  ok(await pg.inputValue('#items') === 'RV-0002/示範待駁回' && await pg.locator('#department option:checked').textContent() === '品管課' &&
     await pg.isChecked('input[name=data_types][value="圖面"]') && await pg.isChecked('input[name=formats][value="2D PDF"]') && await pg.inputValue('#purpose') === '設計參考',
     'copy prefills the form');
  const note = await pg.textContent('#prefill-note');
  ok(note.includes('已帶入 DOC-') && note.includes('用途說明不足（測試）'), 'prefill note shows source and reject reason: ' + note);
  await shot(pg, 'd-copy');
  await pg.fill('#items', 'RV-0002/示範待駁回（已補充用途）');
  await pg.click('#submit-btn');
  await pg.waitForSelector('#form-message.success');
  const copies = (await pool.query(`select status from public.requests where items like 'RV-0002%' order by created_at`)).rows.map(r => r.status);
  ok(copies.join() === '已駁回,申請主管簽核中' && await pg.locator('#prefill-note').isHidden(), 'copy creates a new request; rejected one is kept');
  await pg.context().close();

  // 核發主管：看到第一關已核准的那筆，核准後待文管發放
  pg = await openAs(ISS, PAGE + '#review');
  await pg.waitForSelector('#view-review:not([hidden]) .review-item');
  const itI = pg.locator('.review-item', { hasText: 'RV-0001' });
  ok((await itI.textContent()).includes('第二關') && (await itI.textContent()).includes('已核准（示範主管）'), 'issuer sees stage2 with stage1 approver');
  await itI.locator('button.approve').click();
  await pg.waitForSelector('#review-message.success');
  ok((await pool.query(`select status from public.requests where items like 'RV-0001%'`)).rows[0].status === '待文管發放', 'issuer approve -> 待文管發放');
  await pg.context().close();

  // ===== 第 8 步：文管發放 =====
  const DCC = 'aaaaaaaa-0000-4000-8000-000000000005', DCC2 = 'aaaaaaaa-0000-4000-8000-000000000006';
  await pool.query(`insert into auth.users values ('${DCC}'), ('${DCC2}');
    insert into public.profiles (id, line_user_id, display_name, active, is_dcc) values
      ('${DCC}', 'U${'5'.repeat(32)}', '示範文管', true, true), ('${DCC2}', 'U${'6'.repeat(32)}', '示範文管二', true, true);`);
  // 沒有申請過的人：我的申請顯示空狀態
  pg = await openAs(DCC, PAGE + '?tab=mine');
  await pg.waitForSelector('#mine-message.empty-state');
  ok((await pg.textContent('#mine-message .empty-title')) === '還沒有申請紀錄', 'empty state for 我的申請');
  if (process.env.SHOT_DIR) await pg.screenshot({ path: process.env.SHOT_DIR + '/e-empty.png' });
  await pg.context().close();
  // 非文管看不到分頁，?tab=issue 退回新增申請
  pg = await openAs(ISS, PAGE + '?tab=issue');
  ok(await pg.locator('a[data-tab=issue]').isHidden() && await pg.locator('#view-new').isVisible(), 'non-dcc: no issue tab, ?tab=issue falls back');
  await pg.context().close();

  pg = await openAs(DCC, PAGE + '?tab=issue');
  await pg.waitForSelector('#view-issue:not([hidden]) .issue-item');
  ok(await pg.locator('#view-issue').isVisible() && await pg.textContent('#issue-count') === '1', 'dcc: ?tab=issue opens, count 1');
  const itD = pg.locator('.issue-item', { hasText: 'RV-0001' });
  ok((await itD.textContent()).includes('已核准（示範主管）') && (await itD.textContent()).includes('示範核發主管'), 'shows both approvers');
  if (process.env.SHOT_DIR) await pg.screenshot({ path: process.env.SHOT_DIR + '/s8-issue.png', fullPage: true });
  await itD.locator('button.deliver').click();
  ok((await itD.locator('.field-error').textContent()).includes('發放方式'), 'requires delivery method');
  await itD.locator('select.method').selectOption('雲端連結');
  ok((await itD.locator('.note-label').textContent()).includes('雲端連結'), 'note field becomes cloud link field');
  await itD.locator('button.deliver').click();
  ok((await itD.locator('.field-error').textContent()).includes('雲端連結'), '雲端連結 requires a link');
  if (process.env.SHOT_DIR) await itD.screenshot({ path: process.env.SHOT_DIR + '/e-cloud-link.png' });
  await itD.locator('select.method').selectOption('其他');
  await itD.locator('button.deliver').click();
  ok((await itD.locator('.field-error').textContent()).includes('其他'), '其他 requires note');
  await itD.locator('input.method-other').fill('現場交付（測試）');
  const n1 = notifyCalls;
  await itD.locator('button.deliver').click();
  await pg.waitForSelector('#issue-message.success');
  const rd = (await pool.query(`select status, delivery_method, delivery_method_other, delivered_by from public.requests where items like 'RV-0001%'`)).rows[0];
  ok(rd.status === '已發放結案' && rd.delivery_method === '其他' && rd.delivery_method_other === '現場交付（測試）' && rd.delivered_by === DCC, 'deliver updates DB');
  ok(notifyCalls > n1, 'deliver triggers LINE notify');
  ok((await pool.query(`select count(*)::int n from public.notifications n join public.requests r on r.id=n.request_id where r.items like 'RV-0001%' and n.kind='已發放'`)).rows[0].n === 1, 'applicant notification queued');
  await pg.waitForFunction(() => !document.querySelector('.issue-item'));
  ok(await pg.locator('#issue-count').isHidden(), 'list empty, badge cleared');
  await pg.context().close();

  // 兩位文管同時開著同一張：後按的人看到錯誤
  await submitAs(U.app, '品管課', 'RV-0003/示範同時發放');
  const id3 = (await pool.query(`select id from public.requests where items like 'RV-0003%'`)).rows[0].id;
  await asUser(U.mgr, 'select public.review_request($1, true)', [id3]);
  await asUser(ISS, 'select public.review_request($1, true)', [id3]);
  pg = await openAs(DCC2, PAGE + '#issue');
  await pg.waitForSelector('#view-issue:not([hidden]) .issue-item');
  await asUser(DCC, `select public.deliver_request($1, '雲端連結', null, 'https://drive.example.invalid/rv3')`, [id3]);
  const it3 = pg.locator('.issue-item', { hasText: 'RV-0003' });
  await it3.locator('select.method').selectOption('雲端連結');
  await it3.locator('input.delivery-note-input').fill('https://drive.example.invalid/late');
  await it3.locator('button.deliver').click();
  await pg.waitForSelector('#issue-message.error');
  ok((await pg.textContent('#issue-message')).includes('不能發放'), 'second dcc gets error: ' + await pg.textContent('#issue-message'));
  ok((await pool.query(`select delivery_note from public.requests where id=$1`, [id3])).rows[0].delivery_note === 'https://drive.example.invalid/rv3', 'first delivery kept');
  await pg.context().close();

  // 文管認領：我來處理 → 申請人看到備檔中 → 取消／再認領 → 另一位文管看到「某某 備檔中」，發放前提醒
  await submitAs(U.app, '品管課', 'RV-0004/示範認領');
  const id4 = (await pool.query(`select id from public.requests where items like 'RV-0004%'`)).rows[0].id;
  await asUser(U.mgr, 'select public.review_request($1, true)', [id4]);
  await asUser(ISS, 'select public.review_request($1, true)', [id4]);
  pg = await openAs(DCC, PAGE + '?tab=issue');
  const it4 = pg.locator('.issue-item', { hasText: 'RV-0004' });
  await it4.waitFor();
  ok((await it4.locator('.claim-state').textContent()) === '尚未有人處理', 'unclaimed request shows 尚未有人處理');
  await it4.locator('button.claim').click();
  await pg.waitForFunction(() => [...document.querySelectorAll('.issue-item .claim-state')].some(e => e.textContent.startsWith('你正在處理')));
  ok((await pool.query(`select claimed_by from public.requests where id=$1`, [id4])).rows[0].claimed_by === DCC, 'claim saved');
  if (process.env.SHOT_DIR) await pg.locator('.issue-item', { hasText: 'RV-0004' }).screenshot({ path: process.env.SHOT_DIR + '/claim-mine.png' });
  await pg.locator('.issue-item', { hasText: 'RV-0004' }).locator('button.unclaim').click();
  await pg.waitForFunction(() => [...document.querySelectorAll('.issue-item .claim-state')].some(e => e.textContent === '尚未有人處理'));
  await pg.locator('.issue-item', { hasText: 'RV-0004' }).locator('button.claim').click();
  await pg.waitForFunction(() => [...document.querySelectorAll('.issue-item .claim-state')].some(e => e.textContent.startsWith('你正在處理')));
  ok(true, 'unclaim and claim again');
  await pg.context().close();
  // 申請人看到誰在備檔
  pg = await openAs(U.app, PAGE + '?tab=mine');
  const itM4 = pg.locator('.request-item', { hasText: 'RV-0004' });
  await itM4.waitFor();
  ok((await itM4.locator('.claim-note').textContent()).includes('文管 示範文管 正在備檔'), 'applicant sees who is preparing the files');
  await pg.context().close();
  // 另一位文管：看到「示範文管 備檔中」、沒有認領鍵；硬要發放時先提醒
  pg = await openAs(DCC2, PAGE + '?tab=issue');
  const it4b = pg.locator('.issue-item', { hasText: 'RV-0004' });
  await it4b.waitFor();
  ok((await it4b.locator('.claim-state').textContent()).startsWith('示範文管 備檔中') && await it4b.locator('button.claim').count() === 0,
     'other dcc sees the claimer and cannot claim');
  await it4b.locator('select.method').selectOption('Email');
  await it4b.locator('button.deliver').click();
  await pg.waitForSelector('#issue-message.success');
  ok((await pg.evaluate(() => window.__sheetLog)).some(m => m.includes('示範文管 正在處理')) &&
     (await pool.query(`select status from public.requests where id=$1`, [id4])).rows[0].status === '已發放結案',
     'other dcc is warned before delivering a claimed request');
  await pg.context().close();

  // 申請人在我的申請看到發放方式
  const docRV1 = (await pool.query(`select doc_no from public.requests where items like 'RV-0001%'`)).rows[0].doc_no;
  pg = await openAs(U.app, PAGE + '?tab=mine&doc=' + docRV1);
  await pg.waitForSelector('#view-mine:not([hidden]) .request-item');
  const itM = pg.locator('.request-item', { hasText: 'RV-0001' });
  await itM.locator('.item-head[aria-expanded="true"]').waitFor();
  ok(true, 'deep link expands the request in 我的申請');
  ok((await itM.locator('.progress li').evaluateAll(l => l.map(x => x.className).join(','))) === 'done,done,done,done', 'progress stepper: all done after delivery');
  ok((await itM.locator('.badge.status').textContent()) === '已發放結案', 'applicant sees 已發放結案');
  ok((await itM.locator('.detail').textContent()).includes('其他（現場交付（測試））'), 'applicant sees delivery method');
  const it3M = pg.locator('.request-item', { hasText: 'RV-0003' });
  await it3M.locator('.item-head').click();
  ok(await it3M.locator('.delivery-note a.text-link').getAttribute('href') === 'https://drive.example.invalid/rv3', 'applicant gets a clickable cloud link');
  await pg.context().close();

  // ===== 第 9 步：管理看板 =====
  // 歷史資料：近幾個月，含處理時間、外部對象、駁回原因
  await pool.query(`
    insert into public.requests (doc_no, created_at, applicant_id, department_id, data_types, items, purpose, formats, external_note,
      status, stage1_result, stage1_by, stage1_at, stage2_result, stage2_by, stage2_at, stage1_reason,
      delivery_method, delivered_by, delivered_at)
    select 'DOC-19990101-' || lpad((900 + g)::text, 3, '0'),
           date_trunc('month', now()) - (g % 4) * interval '1 month' + interval '2 days',
           '${U.app}', (select id from public.departments where name = case when g % 3 = 0 then '品管課' else '開發部' end),
           case when g % 2 = 0 then array['圖面'] else array['圖面','材質證明'] end,
           'HP-' || (g % 3) || '/示範零件' || (g % 3) || E'\nHP-9/=SUM(A1)',
           case when g % 2 = 0 then '提供給客戶' else '設計參考' end, array['2D PDF'],
           case when g % 2 = 0 then '示範客戶B' end,
           case when g % 5 = 0 then '已駁回' else '已發放結案' end,
           case when g % 5 = 0 then '已駁回' else '已核准' end, '${U.mgr}',
           date_trunc('month', now()) - (g % 4) * interval '1 month' + interval '2 days 2 hours',
           case when g % 5 = 0 then '待第一關簽核' else '已核准' end, case when g % 5 = 0 then null else '${ISS}'::uuid end,
           case when g % 5 = 0 then null else date_trunc('month', now()) - (g % 4) * interval '1 month' + interval '2 days 10 hours' end,
           case when g % 5 = 0 then '資料不足（測試）' end,
           case when g % 5 = 0 then null else 'Email' end, case when g % 5 = 0 then null else '${DCC}'::uuid end,
           case when g % 5 = 0 then null else date_trunc('month', now()) - (g % 4) * interval '1 month' + interval '2 days 11 hours' end
    from generate_series(1, 20) g;
    update public.requests set external_note = '=1+1' where doc_no = 'DOC-19990101-902';`);

  // 一般申請人：沒有權限
  pg = await openAsDash(U.app);
  ok((await pg.textContent('#status')).includes('只開放給') && await pg.locator('#dash').isHidden(), 'dashboard: applicant denied');
  await pg.context().close();

  pg = await openAsDash(ISS, { width: 1280, height: 900 });
  await pg.waitForSelector('#tiles .tile');
  const total = (await pool.query(`select count(*)::int n from public.requests where (created_at at time zone 'Asia/Taipei')::date >= date_trunc('month', (now() at time zone 'Asia/Taipei') - interval '11 months')`)).rows[0].n;
  ok(await pg.locator('#tiles .tile .value').first().textContent() === String(total), 'tile total matches DB (' + total + ')');
  ok(await pg.locator('#monthly .col').count() === 12, '12 monthly columns for 近 12 個月');
  ok(await pg.locator('#tiles .tile').first().locator('.unit').count() === 0 && (await pg.locator('#tiles .tile .unit').allTextContents()).join('|').includes('%'), 'tile units: plain counts have no unit, percentages do');
  ok(await pg.locator('#speed .hbar').count() === 3 && await pg.locator('#speed .tag').count() === 1, 'speed: 3 stages, one marked 最久');
  ok((await pg.locator('#speed .hbar', { hasText: '第二關' }).locator('.tag').count()) === 1, 'stage2 (8h) is the slowest');
  ok((await pg.textContent('#top-items')).includes('HP-9') && (await pg.textContent('#top-items')).includes('HP-0'), 'top items lists part numbers');
  ok((await pg.textContent('#external-targets')).includes('示範客戶B'), 'external targets listed');
  ok((await pg.textContent('#reject-reasons')).includes('資料不足（測試）'), 'reject reasons listed');
  ok((await pg.locator('#purpose .flag').count()) >= 1, 'external purposes tagged 外部');
  // 先捲到圖表再移入滑鼠（捲動會關閉提示框，這是設計上的行為）
  await pg.locator('#monthly .col').last().scrollIntoViewIfNeeded();
  await pg.waitForTimeout(300);
  await pg.locator('#monthly .col').last().hover();
  ok(!(await pg.locator('#tooltip').isHidden()) && (await pg.textContent('#tooltip')).includes('申請'), 'hover tooltip on month column');
  await pg.locator('#speed .hbar').first().focus();
  ok(!(await pg.locator('#tooltip').isHidden()) && (await pg.textContent('#tooltip')).includes('中位數'), 'keyboard focus shows tooltip');
  if (process.env.SHOT_DIR) await pg.screenshot({ path: process.env.SHOT_DIR + '/s9-desktop.png', fullPage: true });

  // 篩選：本月
  await pg.click('#filters [data-preset=month]');
  await pg.waitForFunction(() => document.querySelectorAll('#monthly .col').length === 1);
  ok(await pg.inputValue('#from') !== '' && await pg.locator('#monthly .col').count() === 1, 'preset 本月 refilters');
  ok(await pg.getAttribute('#filters [data-preset=month]', 'aria-pressed') === 'true' && await pg.locator('#apply-btn').isHidden(), 'preset button shows as selected');

  // 匯出
  await pg.click('#filters [data-preset=all]');
  await pg.waitForFunction(() => document.querySelectorAll('#monthly .col').length > 1);
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#export-btn')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const allN = (await pool.query('select count(*)::int n from public.requests')).rows[0].n;
  ok(csv.charCodeAt(0) === 0xfeff && csv.split('\r\n')[0].startsWith('\ufeff單號,申請時間,申請人'), 'CSV has BOM + Chinese headers');
  ok(csv.split('\r\n').length === allN + 1, 'CSV has all rows (' + allN + ')');
  ok(csv.includes(",'=1+1,") && !csv.includes(",=1+1,"), 'CSV guards formula injection');
  ok(/^drawing-requests_all_\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), 'download filename ' + dl.suggestedFilename());
  await pg.context().close();

  pg = await openAsDash(ISS);
  await pg.waitForSelector('#tiles .tile');
  if (process.env.SHOT_DIR) await pg.screenshot({ path: process.env.SHOT_DIR + '/s9-mobile.png', fullPage: true });
  const overflow = await pg.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > document.documentElement.clientWidth + 1);
  ok(!overflow, 'dashboard: no horizontal scroll on phone');
  await pg.context().close();

  if (process.env.SHOT_DIR) {   // 深色模式截圖
    const darkPage = async (uid, url, sel) => {
      const cd = await b3.newContext({ ...devices['iPhone 13'], ...RM, colorScheme: 'dark' });
      await cd.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
        `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'7'.repeat(32)})};` }));
      await cd.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
      await cd.route(SB + '/**', api);
      await cd.addInitScript(AUTO_SHEET);
      global.CURRENT = uid;
      const pd = await cd.newPage();
      await pd.goto(url); await pd.waitForSelector(sel);
      return pd;
    };
    let pd = await darkPage(ISS, PAGE + 'dashboard.html', '#tiles .tile');
    await pd.screenshot({ path: process.env.SHOT_DIR + '/dark-dash.png' }); await pd.context().close();
    pd = await darkPage(U.app, PAGE + '?tab=mine', '#mine-list .request-item');
    await pd.screenshot({ path: process.env.SHOT_DIR + '/dark-mine.png' }); await pd.context().close();
    pd = await darkPage(U.app, PAGE, '#view-new:not([hidden])');
    await pd.screenshot({ path: process.env.SHOT_DIR + '/dark-form.png' }); await pd.context().close();
  }
  // 申請頁：有權限的人看到「管理看板」連結
  pg = await openAs(ISS, PAGE);
  ok(await pg.locator('#dash-link').isVisible(), 'issuer sees 管理看板 link');
  await pg.context().close();
  pg = await openAs(U.app, PAGE);
  ok(await pg.locator('#dash-link').isHidden(), 'applicant has no 管理看板 link');
  await pg.context().close();

  // ---------- 申請查詢 ----------
  // 一般申請人沒有查詢分頁
  pg = await openAs(U.app, PAGE + '?tab=search');
  ok(await pg.locator('a[data-tab=search]').isHidden() && await pg.locator('#view-new').isVisible(), 'applicant: no search tab, ?tab=search falls back');
  await pg.context().close();
  // 部門主管：只查得到自己管理的部門
  const mgrDepts = (await pool.query(`select count(*)::int n from public.requests r join public.departments d on d.id = r.department_id where d.manager_id = $1`, [U.mgr])).rows[0].n;
  const ps = await openAs(U.mgr, PAGE + '?tab=search');
  await ps.waitForSelector('#view-search:not([hidden]) #search-list .request-item');
  ok((await ps.textContent('#search-count')).includes('共 ' + mgrDepts + ' 筆') && (await ps.textContent('#search-scope')).includes('品管課'),
     'manager search scope is own departments (' + mgrDepts + ')');
  ok((await ps.locator('#search-list .request-item').count()) === Math.min(20, mgrDepts) && await ps.locator('#search-list .copy-request, #search-list .danger').count() === 0,
     'search results are read-only cards');
  // 關鍵字：單號
  const someDoc = (await pool.query(`select doc_no from public.requests where items like 'RV-0001%'`)).rows[0].doc_no;
  await ps.fill('#search-q', someDoc);
  await ps.press('#search-q', 'Enter');
  await ps.waitForFunction(d => document.querySelectorAll('#search-list .request-item').length === 1 && document.querySelector('#search-list .request-item').dataset.doc === d, someDoc);
  ok(true, 'search by doc number finds one');
  // 狀態篩選
  await ps.fill('#search-q', '');
  await ps.click('#view-search .status-filter button[data-status="已駁回"]');
  await ps.waitForFunction(() => document.querySelector('#search-list .request-item') && [...document.querySelectorAll('#search-list .badge.status')].every(b => b.textContent === '已駁回'));
  ok(true, 'status filter shows only 已駁回');
  // 找不到
  await ps.fill('#search-q', '不存在的品號ZZZ');
  await ps.press('#search-q', 'Enter');
  await ps.waitForSelector('#search-message.empty-state');
  ok((await ps.textContent('#search-message')).includes('找不到'), 'empty search result explained');
  if (process.env.SHOT_DIR) { await ps.fill('#search-q', ''); await ps.click('#view-search .status-filter button[data-status=""]'); await ps.waitForSelector('#search-list .request-item'); await ps.screenshot({ path: process.env.SHOT_DIR + '/search.png', fullPage: true }); }
  await ps.context().close();
  // 核發主管：查得到全部
  const searchAllN = (await pool.query('select count(*)::int n from public.requests')).rows[0].n;
  const ps2 = await openAs(ISS, PAGE + '?tab=search');
  await ps2.waitForSelector('#view-search:not([hidden]) #search-list .request-item');
  ok((await ps2.textContent('#search-count')).includes('共 ' + searchAllN + ' 筆') && (await ps2.textContent('#search-scope')).includes('全部'), 'issuer searches all (' + searchAllN + ')');
  if (searchAllN > 20) {
    await ps2.click('#search-more');
    await ps2.waitForFunction(n => document.querySelectorAll('#search-list .request-item').length === Math.min(40, n), searchAllN);
    ok(true, 'load more appends next page');
  }
  await ps2.context().close();

  // ---------- 待我簽核：急迫度 ----------
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const urgentDoc = (await asUser(U.app, `select public.submit_request((select id from public.departments where name = '品管課'), null, array['圖面'],
      'URG-1/今天要的零件', '設計參考', null, array['2D PDF'], null, $1::date, null) as d`, [today]))[0].d;
  await pool.query(`update public.requests set created_at = now() - interval '3 days' where items like 'RV-0002%' and status = '申請主管簽核中'`);
  const pu = await openAs(U.mgr, PAGE + '?tab=review');
  await pu.waitForSelector('#view-review:not([hidden]) .review-item');
  const firstItem = pu.locator('#review-list .review-item').first();
  ok(await firstItem.getAttribute('data-doc') === urgentDoc && (await firstItem.locator('.u-over').textContent()).includes('今天就要'),
     'urgent request (needed today) sorted first with red chip');
  ok(await firstItem.locator('.card-detail').isHidden() && await firstItem.locator('button.approve').isVisible(), 'card shows summary and actions, details collapsed');
  await firstItem.locator('.detail-toggle').click();
  ok(await firstItem.locator('.card-detail').isVisible() && (await firstItem.locator('.detail-toggle').textContent()).includes('收起'), 'details expand on tap');
  if (process.env.SHOT_DIR) await pu.screenshot({ path: process.env.SHOT_DIR + '/review-urgency.png', fullPage: true });
  await pu.context().close();

  // ---------- 管理設定（系統管理員） ----------
  const ADM = 'aaaaaaaa-0000-4000-8000-000000000009', NEWBIE = 'aaaaaaaa-0000-4000-8000-000000000010';
  await pool.query(`insert into auth.users values ('${ADM}'), ('${NEWBIE}');
    insert into public.profiles (id, line_user_id, display_name, active, is_admin) values ('${ADM}', 'U${'a'.repeat(32)}', '示範管理員', true, true);
    insert into public.profiles (id, line_user_id, display_name, active) values ('${NEWBIE}', 'U${'b'.repeat(32)}', '示範新同仁', false);`);
  ok((await pool.query(`select count(*)::int n from public.notifications where kind = '新帳號待啟用' and subject_id = '${NEWBIE}' and recipient_id = '${ADM}'`)).rows[0].n === 1,
     'new account queues a notice for the admin');
  // 非管理員看不到，?tab=admin 退回新增申請
  pg = await openAs(U.app, PAGE + '?tab=admin');
  ok(await pg.locator('a[data-tab=admin]').isHidden() && await pg.locator('#view-new').isVisible(), 'non-admin: no admin tab, ?tab=admin falls back');
  await pg.context().close();

  const pa = await openAs(ADM, PAGE + '?tab=admin');
  await pa.waitForSelector('#view-admin:not([hidden]) .pending-row');
  ok(await pa.textContent('#admin-count') === '2' && await pa.locator('.pending-row').count() === 2, 'admin sees pending accounts with count badge');
  // 一鍵啟用：通知本人，並自動展開角色設定
  const nAct = notifyCalls;
  await pa.click(`.pending-row[data-id="${NEWBIE}"] button.activate`);
  await pa.waitForSelector(`.user-row[data-id="${NEWBIE}"] .user-head[aria-expanded="true"]`);
  ok((await pa.textContent('#admin-message')).includes('已啟用 示範新同仁') && await pa.textContent('#admin-count') === '1', 'activate moves user to list and updates count');
  ok((await pool.query(`select active from public.profiles where id = '${NEWBIE}'`)).rows[0].active &&
     (await pool.query(`select count(*)::int n from public.notifications where kind = '帳號已開通' and recipient_id = '${NEWBIE}'`)).rows[0].n === 1 &&
     notifyCalls > nAct, 'activation saved and user notified');
  // 設定角色：開關即時儲存
  await pa.locator(`.user-row[data-id="${NEWBIE}"] input.switch[data-field="is_dcc"]`).check();
  await pa.waitForFunction(() => document.getElementById('admin-message').textContent.includes('文管 已開啟'));
  ok((await pool.query(`select is_dcc from public.profiles where id = '${NEWBIE}'`)).rows[0].is_dcc &&
     (await pa.locator(`.user-row[data-id="${NEWBIE}"] .user-tags`).textContent()).includes('文管'), 'role switch saves and updates tags');
  // 不能拿掉最後一位管理員（資料庫擋下，開關恢復原狀）
  await pa.click(`.user-row[data-id="${ADM}"] .user-head`);
  await pa.locator(`.user-row[data-id="${ADM}"] input.switch[data-field="is_admin"]`).uncheck();
  await pa.waitForSelector('#admin-message.error');
  ok((await pa.textContent('#admin-message')).includes('至少要保留一位') &&
     await pa.locator(`.user-row[data-id="${ADM}"] input.switch[data-field="is_admin"]`).isChecked() &&
     (await pool.query(`select is_admin from public.profiles where id = '${ADM}'`)).rows[0].is_admin, 'cannot remove the last admin; switch reverts');
  // 搜尋
  await pa.fill('#admin-search', '新同仁');
  ok(await pa.locator('#admin-user-list .user-row').count() === 1, 'search filters users');
  await pa.fill('#admin-search', '');
  if (process.env.SHOT_DIR) await pa.screenshot({ path: process.env.SHOT_DIR + '/admin-users.png', fullPage: true });
  // 部門主管
  await pa.click('#admin-tab-depts');
  const buyRow = pa.locator('.dept-row', { has: pa.locator('.dept-name', { hasText: /^採購課$/ }) });
  ok((await buyRow.textContent()).includes('未設定主管'), 'department without manager is flagged');
  await buyRow.locator('select.dept-manager').selectOption(NEWBIE);
  await pa.waitForFunction(() => document.getElementById('admin-message').textContent.includes('部門主管已設為'));
  ok((await pool.query(`select p.display_name from public.departments d join public.profiles p on p.id = d.manager_id where d.name = '採購課'`)).rows[0].display_name === '示範新同仁',
     'admin sets department manager');
  // 停用部門主管前要先換人
  await pa.click('#admin-tab-users');
  await pa.click(`.user-row[data-id="${NEWBIE}"] .user-head`);
  ok(await pa.locator('#admin-user-list .user-head[aria-expanded="true"]').count() === 1, 'only one user expanded at a time');
  await pa.locator(`.user-row[data-id="${NEWBIE}"] input.switch[data-field="active"]`).uncheck();
  await pa.waitForSelector('#admin-message.error');
  ok((await pa.textContent('#admin-message')).includes('採購課') && (await pool.query(`select active from public.profiles where id = '${NEWBIE}'`)).rows[0].active,
     'cannot deactivate a department manager');
  // 新增部門
  await pa.click('#admin-tab-depts');
  await pa.click('#admin-dept-add button[type=submit]');
  ok((await pa.textContent('#admin-dept-error')).includes('請填寫'), 'new department requires a name');
  await pa.fill('#admin-dept-name', '採購課');
  await pa.click('#admin-dept-add button[type=submit]');
  ok((await pa.textContent('#admin-dept-error')).includes('已經有'), 'duplicate department name rejected');
  await pa.fill('#admin-dept-name', '示範工務課');
  await pa.click('#admin-dept-add button[type=submit]');
  await pa.waitForSelector('.dept-row .dept-name:text-is("示範工務課")');
  const nd = (await pool.query(`select sort_order, active from public.departments where name = '示範工務課'`)).rows[0];
  ok(nd && nd.active && nd.sort_order < 99, 'admin adds a department (sorted before 其他)');
  if (process.env.SHOT_DIR) await pa.screenshot({ path: process.env.SHOT_DIR + '/admin-depts.png', fullPage: true });
  await pa.context().close();

  // ---------- 響應式（RWD）：從小手機到大螢幕，每個畫面都不能橫向捲動或超出畫面 ----------
  // 用「所有角色＋很長的名字」的帳號，讓頂部列與分頁處在最擠的情況
  const RWD = 'aaaaaaaa-0000-4000-8000-000000000007';
  await pool.query(`insert into auth.users values ('${RWD}');
    insert into public.profiles (id, line_user_id, display_name, active, is_admin, is_issuer, is_dcc)
      values ('${RWD}', 'U${'8'.repeat(32)}', '示範很長名字的系統管理員', true, true, true, true);
    update public.departments set manager_id = '${RWD}' where name = '採購課';`);
  async function openAt(uid, url, width, sel) {
    const phone = width < 768;   // 手機寬度模擬觸控（pointer: coarse）
    const c = await b3.newContext({ viewport: { width, height: phone ? 760 : 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, ...RM });
    await c.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
      `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'7'.repeat(32)})};` }));
    await c.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
    await c.route(SB + '/**', api);
    await c.addInitScript(AUTO_SHEET);
    global.CURRENT = uid;
    const p = await c.newPage();
    p.on('pageerror', e => ok(false, 'page error ' + e));
    await p.goto(url);
    await p.waitForSelector(sel);
    return p;
  }
  // 回傳版面問題：橫向捲動、超出畫面的元素、觸控裝置上小於 44px 的點擊目標
  const layoutIssues = () => {
    const vw = document.documentElement.clientWidth, out = [];
    const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    if (Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > vw + 1) out.push('horizontal scroll ' + document.documentElement.scrollWidth + ' > ' + vw);
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.table-scroll, .tabs, .seg, .tooltip')) continue;   // 這些容器本來就可以在內部左右捲動
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right > vw + 1 || r.left < -1) out.push('overflow ' + name(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
    }
    if (matchMedia('(pointer: coarse)').matches) {
      for (const el of document.querySelectorAll('button, a, select, input:not([type=checkbox]), summary, .chip span')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.height < 43.5) out.push('tap target ' + name(el) + ' ' + Math.round(r.height) + 'px');
      }
    }
    return out.slice(0, 6);
  };
  const VIEWS = [
    ['new', RWD, PAGE, '#view-new:not([hidden])'],
    ['mine', U.app, PAGE + '?tab=mine', '#mine-list .request-item'],
    ['review', RWD, PAGE + '?tab=review', '#view-review:not([hidden]) :is(.request-item, .empty-state)'],
    ['issue', RWD, PAGE + '?tab=issue', '#view-issue:not([hidden]) :is(.request-item, .empty-state)'],
    ['search', RWD, PAGE + '?tab=search', '#view-search:not([hidden]) #search-list .request-item'],
    ['admin', RWD, PAGE + '?tab=admin', '#view-admin:not([hidden]) .user-row'],
    ['dash', RWD, PAGE + 'dashboard.html', '#tiles .tile'],
  ];
  for (const w of [320, 375, 414, 768, 1024, 1280, 1440]) {
    for (const [view, uid, url, sel] of VIEWS) {
      const p = await openAt(uid, url, w, sel);
      if (view === 'mine') { await p.click('#mine-list .item-head'); await p.waitForSelector('#mine-list .timeline'); }
      if (view === 'review' && await p.locator('#review-list .reject').count()) await p.click('#review-list .reject');
      if (view === 'dash') await p.click('#filters [data-preset="custom"]');   // 顯示「套用」鍵，篩選列最寬的情況
      const issues = await p.evaluate(layoutIssues);
      ok(!issues.length, `rwd ${w}px ${view}` + (issues.length ? '：' + issues.join('；') : ''));
      if (process.env.SHOT_DIR) await p.screenshot({ path: `${process.env.SHOT_DIR}/rwd-${view}-${w}.png`, fullPage: true });
      await p.context().close();
    }
  }
  await b3.close();
  await pool.end(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
