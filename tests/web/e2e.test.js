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
};
const H = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*', 'content-type': 'application/json' };
const calls = [];
async function api(route) {
  const q = route.request(); const u = new URL(q.url()); const p = u.searchParams;
  if (q.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  const reply = (body, status = 200) => route.fulfill({ status, headers: H, body: JSON.stringify(body) });
  const uid = subOf(q.headers()['authorization']);
  calls.push(q.method() + ' ' + u.pathname);
  try {
    if (u.pathname === '/functions/v1/line-login') return reply({ access_token: jwtFor(global.CURRENT), refresh_token: 'r', expires_at: 9999999999 });
    if (u.pathname === '/auth/v1/user') return reply({ id: uid, aud: 'authenticated', role: 'authenticated' });
    if (u.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: H });
    if (u.pathname === '/rest/v1/profiles') {
      const rows = await asUser(uid, 'select id, display_name, is_admin, is_issuer, is_dcc, active from public.profiles where id = $1', [p.get('id').slice(3)]);
      return q.headers()['accept'].includes('object') ? (rows.length ? reply(rows[0]) : reply({ code: 'PGRST116', message: 'no rows' }, 406)) : reply(rows);
    }
    if (u.pathname === '/rest/v1/departments') return reply(await asUser(uid, 'select id, name from public.departments where active order by sort_order, id'));
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
  await b2.close(); await pool.end(); server.close();
})().catch(e => { console.error(e); process.exitCode = 1; pool.end(); server.close(); });
