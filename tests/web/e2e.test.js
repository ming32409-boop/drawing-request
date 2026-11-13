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
const REQ_COLS = `r.id, r.doc_no, r.created_at, r.status, r.is_external, r.department_other, r.data_types, r.items,
  r.purpose, r.purpose_other, r.formats, r.format_other, r.need_date, r.external_note, r.stage1_result, r.stage1_reason,
  r.stage2_result, r.stage2_reason, r.delivery_method, r.delivery_method_other, r.delivered_at`;
const rpcArgs = {
  submit_request: `p_department_id => ($1::jsonb->>'p_department_id')::smallint, p_department_other => $1::jsonb->>'p_department_other',
    p_data_types => array(select jsonb_array_elements_text($1::jsonb->'p_data_types')), p_items => $1::jsonb->>'p_items',
    p_purpose => $1::jsonb->>'p_purpose', p_purpose_other => $1::jsonb->>'p_purpose_other',
    p_formats => array(select jsonb_array_elements_text($1::jsonb->'p_formats')), p_format_other => $1::jsonb->>'p_format_other',
    p_need_date => ($1::jsonb->>'p_need_date')::date, p_external_note => $1::jsonb->>'p_external_note'`,
  withdraw_request: `p_request_id => ($1::jsonb->>'p_request_id')::uuid`,
  deliver_request: `p_request_id => ($1::jsonb->>'p_request_id')::uuid, p_method => $1::jsonb->>'p_method',
    p_method_other => $1::jsonb->>'p_method_other'`,
  dashboard_data: `p_from => ($1::jsonb->>'p_from')::date, p_to => ($1::jsonb->>'p_to')::date`,
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
    if (u.pathname === '/rest/v1/profiles') {
      const rows = await asUser(uid, 'select id, display_name, is_admin, is_issuer, is_dcc, active from public.profiles where id = $1', [p.get('id').slice(3)]);
      return q.headers()['accept'].includes('object') ? (rows.length ? reply(rows[0]) : reply({ code: 'PGRST116', message: 'no rows' }, 406)) : reply(rows);
    }
    if (u.pathname === '/rest/v1/departments') return reply(await asUser(uid, 'select id, name, manager_id from public.departments where active order by sort_order, id'));
    if (u.pathname === '/rest/v1/requests' && p.get('status')) {
      // 待我簽核：status=eq.X，可能有 department_id=in.(1,2)
      const ids = p.get('department_id') ? p.get('department_id').replace(/^in\.\(|\)$/g, '').split(',').map(Number) : null;
      return reply(await asUser(uid, `select ${REQ_COLS}, r.department_id, r.stage1_at, r.stage2_at,
          case when s2.id is null then null else json_build_object('display_name', s2.display_name) end as stage2_by_profile,
          json_build_object('display_name', ap.display_name) as applicant,
          case when s1.id is null then null else json_build_object('display_name', s1.display_name) end as stage1_by_profile,
          case when d.id is null then null else json_build_object('name', d.name) end as department
        from public.requests r left join public.departments d on d.id = r.department_id
        left join public.profiles ap on ap.id = r.applicant_id left join public.profiles s1 on s1.id = r.stage1_by left join public.profiles s2 on s2.id = r.stage2_by
        where r.status = $1 and ($2::smallint[] is null or r.department_id = any($2)) order by r.created_at limit 100`,
        [p.get('status').slice(3), ids]));
    }
    if (u.pathname === '/rest/v1/requests') {
      return reply(await asUser(uid, `select ${REQ_COLS}, case when d.id is null then null else json_build_object('name', d.name) end as department
        from public.requests r left join public.departments d on d.id = r.department_id
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
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  await ctx.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
    `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'9'.repeat(32)})};` }));
  await ctx.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
  await ctx.route(SB + '/**', api);
  const p = await ctx.newPage();
  p.on('pageerror', e => ok(false, 'page error ' + e));
  p.on('dialog', d => d.accept());

  global.CURRENT = U.app;
  await p.goto(PAGE);
  await p.waitForSelector('#tabs:not([hidden])');
  ok(await p.textContent('#who') === '示範申請人', 'header shows name');
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

  // 成功送出（外部用途）
  await p.selectOption('#department', { label: '品管課' });
  await p.check('input[value="材質證明"]');
  await p.fill('#items', 'AB-CD-123456-1/示範固定座φ20x40mm\nAB-CD-123457-2/示範支架 Rev.C');
  await p.selectOption('#purpose', '提供給客戶');
  ok(await p.locator('#external-note').isVisible(), 'external purpose warning shown');
  const tomorrow = new Date(Date.now() + 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  await p.fill('#need_date', tomorrow);
  await p.fill('#external_note', '示範客戶（虛構）');
  await p.click('#submit-btn');
  await p.waitForSelector('#form-message.success');
  const msg = await p.textContent('#form-message');
  const doc1 = (msg.match(/DOC-\d{8}-\d{3}/) || [])[0];
  ok(!!doc1, 'submits and shows doc number: ' + msg);
  const row = (await pool.query('select * from public.requests where doc_no = $1', [doc1])).rows[0];
  ok(row && row.status === '申請主管簽核中' && row.is_external && row.data_types.join() === '圖面,材質證明' && row.applicant_id === U.app && row.need_date.toISOString && row.items.split('\n').length === 2, 'DB row correct');
  ok(await p.inputValue('#items') === '' && !(await p.isChecked('input[value="圖面"]')), 'form resets after submit');

  // XSS 測試用第二筆
  await p.selectOption('#department', { label: '品管課' });
  await p.check('input[value="測試報告"]');
  await p.fill('#items', '<img src=x onerror="window.__xss=1">');
  await p.selectOption('#purpose', '設計參考');
  await p.check('input[value="3D STEP或STP"]');
  await p.click('#submit-btn');
  await p.waitForSelector('#form-message.success');
  const doc2 = (await p.textContent('#form-message')).match(/DOC-\d{8}-\d{3}/)[0];

  // 我的申請
  await p.click('a[data-tab=mine]');
  await p.waitForSelector('.request-item');
  ok(await p.locator('.request-item').count() === 2, 'mine lists 2 requests');
  const first = p.locator('.request-item').first();
  ok((await first.textContent()).includes(doc2), 'newest first');
  ok(await p.evaluate(() => !window.__xss) && await p.locator('.request-item img').count() === 0, 'HTML in items rendered as text');
  const second = p.locator('.request-item').nth(1);
  ok((await second.locator('.external-badge').count()) === 1 && (await second.locator('.badge.status').textContent()) === '申請主管簽核中', 'external badge + status');
  await second.locator('.item-head').click();
  await second.locator('.timeline li').first().waitFor();
  ok((await second.locator('.timeline').textContent()).includes('送出'), 'events timeline shows 送出');
  { const t = await second.locator('.detail').textContent(); ok(t.includes('品管課') && t.includes(tomorrow) && !t.includes('T00:00'), 'detail shows department and need date'); }
  await second.locator('button.danger').click();
  await p.waitForSelector('#mine-message.success');
  await p.waitForFunction(d => [...document.querySelectorAll('.request-item')].some(li => li.textContent.includes(d) && li.textContent.includes('已撤回')), doc1);
  ok((await pool.query('select status from public.requests where doc_no=$1', [doc1])).rows[0].status === '已撤回', 'withdraw works (DB)');

  // 主管核准第一關後：不能撤回，紀錄顯示
  const id2 = (await pool.query('select id from public.requests where doc_no=$1', [doc2])).rows[0].id;
  await asUser(U.mgr, 'select public.review_request($1, true)', [id2]);
  await p.click('#mine-refresh');
  await p.waitForFunction(d => [...document.querySelectorAll('.request-item')].some(li => li.textContent.includes(d) && li.textContent.includes('核發主管簽核中')), doc2);
  const it2 = p.locator('.request-item', { hasText: doc2 });
  await it2.locator('.item-head').click();
  await it2.locator('.timeline li').nth(1).waitFor();
  ok((await it2.locator('.timeline').textContent()).includes('第一關 核准｜示範主管'), 'timeline shows stage1 approval with name');
  ok(await it2.locator('button.danger').count() === 0, 'no withdraw after stage1');
  const resX = await p.evaluate(async id => { const c = window.DrawingAuth.client; const r = await c.rpc('withdraw_request', { p_request_id: id }); return r.error && r.error.message; }, id2);
  ok(resX && resX.includes('不能撤回'), 'server refuses withdraw after stage1');
  await b.close();

  // 待啟用帳號
  const b2 = await chromium.launch(); const c2 = await b2.newContext({ ...devices['iPhone 13'] });
  await c2.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
    `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'8'.repeat(32)})};` }));
  await c2.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
  await c2.route(SB + '/**', api);
  global.CURRENT = U.off;
  const p2 = await c2.newPage(); await p2.goto(PAGE);
  await p2.waitForSelector('#pending-hint:not([hidden])');
  ok(await p2.locator('#tabs').isHidden() && await p2.locator('#view-new').isHidden(), 'inactive user: no tabs/form');
  await b2.close();

  // ===== 第 7 步：待我簽核 =====
  const ISS = 'aaaaaaaa-0000-4000-8000-000000000004';
  await pool.query(`insert into auth.users values ('${ISS}');
    insert into public.profiles (id, line_user_id, display_name, active, is_issuer) values ('${ISS}', 'U${'4'.repeat(32)}', '示範核發主管', true, true);`);
  const b3 = await chromium.launch();
  async function openAs(uid, url) {
    const c = await b3.newContext({ ...devices['iPhone 13'] });
    await c.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
      `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'7'.repeat(32)})};` }));
    await c.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
    await c.route(SB + '/**', api);
    global.CURRENT = uid;
    const pg = await c.newPage();
    pg.on('pageerror', e => ok(false, 'page error ' + e));
    pg.on('dialog', d => d.accept());
    await pg.goto(url);
    await pg.waitForSelector('#tabs:not([hidden])');
    return pg;
  }
  async function openAsDash(uid, viewport) {
    const opts = viewport ? { viewport, acceptDownloads: true } : { ...devices['iPhone 13'], acceptDownloads: true };
    const c = await b3.newContext(opts);
    await c.route('https://static.line-scdn.net/**', r => r.fulfill({ contentType: 'application/javascript', body:
      `window.liff={init:async()=>{},isLoggedIn:()=>true,login:()=>{},logout:()=>{},getIDToken:()=>'fake.id.token-for-testing',getDecodedIDToken:()=>({sub:'U'+'7'.repeat(32)})};` }));
    await c.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: UMD, contentType: 'application/javascript' }));
    await c.route(SB + '/**', api);
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
  ok((await itRej.locator('.badge.status').textContent()) === '已駁回', 'applicant sees 已駁回');
  await itRej.locator('.item-head').click();
  await itRej.locator('.t-note.reject').waitFor();
  ok((await itRej.locator('.t-note.reject').textContent()) === '用途說明不足（測試）', 'reject reason shown in red');
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
  await asUser(DCC, `select public.deliver_request($1, 'Email')`, [id3]);
  const it3 = pg.locator('.issue-item', { hasText: 'RV-0003' });
  await it3.locator('select.method').selectOption('雲端連結');
  await it3.locator('button.deliver').click();
  await pg.waitForSelector('#issue-message.error');
  ok((await pg.textContent('#issue-message')).includes('不能發放'), 'second dcc gets error: ' + await pg.textContent('#issue-message'));
  ok((await pool.query(`select delivery_method from public.requests where id=$1`, [id3])).rows[0].delivery_method === 'Email', 'first delivery kept');
  await pg.context().close();

  // 申請人在我的申請看到發放方式
  pg = await openAs(U.app, PAGE + '?tab=mine');
  await pg.waitForSelector('#view-mine:not([hidden]) .request-item');
  const itM = pg.locator('.request-item', { hasText: 'RV-0001' });
  ok((await itM.locator('.badge.status').textContent()) === '已發放結案', 'applicant sees 已發放結案');
  await itM.locator('.item-head').click();
  ok((await itM.locator('.detail').textContent()).includes('其他（現場交付（測試））'), 'applicant sees delivery method');
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
  ok(await pg.locator('#speed .hbar').count() === 3 && await pg.locator('#speed .tag').count() === 1, 'speed: 3 stages, one marked 最久');
  ok((await pg.locator('#speed .hbar', { hasText: '第二關' }).locator('.tag').count()) === 1, 'stage2 (8h) is the slowest');
  ok((await pg.textContent('#top-items')).includes('HP-9') && (await pg.textContent('#top-items')).includes('HP-0'), 'top items lists part numbers');
  ok((await pg.textContent('#external-targets')).includes('示範客戶B'), 'external targets listed');
  ok((await pg.textContent('#reject-reasons')).includes('資料不足（測試）'), 'reject reasons listed');
  ok((await pg.locator('#purpose .flag').count()) >= 1, 'external purposes flagged ⚠');
  await pg.locator('#monthly .col').last().hover();
  ok(!(await pg.locator('#tooltip').isHidden()) && (await pg.textContent('#tooltip')).includes('申請'), 'hover tooltip on month column');
  await pg.locator('#speed .hbar').first().focus();
  ok(!(await pg.locator('#tooltip').isHidden()) && (await pg.textContent('#tooltip')).includes('中位數'), 'keyboard focus shows tooltip');
  if (process.env.SHOT_DIR) await pg.screenshot({ path: process.env.SHOT_DIR + '/s9-desktop.png', fullPage: true });

  // 篩選：本月
  await pg.selectOption('#preset', 'month');
  await pg.waitForFunction(() => document.querySelectorAll('#monthly .col').length === 1);
  ok(await pg.inputValue('#from') !== '' && await pg.locator('#monthly .col').count() === 1, 'preset 本月 refilters');

  // 匯出
  await pg.selectOption('#preset', 'all');
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

  // 申請頁：有權限的人看到「管理看板」連結
  pg = await openAs(ISS, PAGE);
  ok(await pg.locator('#dash-link').isVisible(), 'issuer sees 管理看板 link');
  await pg.context().close();
  pg = await openAs(U.app, PAGE);
  ok(await pg.locator('#dash-link').isHidden(), 'applicant has no 管理看板 link');
  await pg.context().close();
  await b3.close();
  await pool.end(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
