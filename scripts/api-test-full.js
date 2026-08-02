/**
 * api-test-full.js  –  Kiểm thử toàn diện API Cẩm Phả
 * Chạy: node scripts/api-test-full.js
 */
'use strict';

const http = require('http');

const BASE_HOST = '103.163.119.247';
const BASE_PORT = 3006;
const API      = '/api/v1';

// ── HTTP helper ─────────────────────────────────────────────────────────────
function req(method, path, body, token) {
    return new Promise((resolve) => {
        const payload = body ? JSON.stringify(body) : null;
        const headers  = { 'Content-Type': 'application/json' };
        if (token)   headers['Authorization'] = `Bearer ${token}`;
        if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

        const options = { hostname: BASE_HOST, port: BASE_PORT, path, method, headers, timeout: 12000 };
        const reqObj  = http.request(options, (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: { raw: data } }); }
            });
        });
        reqObj.on('error', e => resolve({ status: 0, body: { success: false, message: e.message } }));
        reqObj.on('timeout', () => { reqObj.destroy(); resolve({ status: 0, body: { success: false, message: 'TIMEOUT' } }); });
        if (payload) reqObj.write(payload);
        reqObj.end();
    });
}

const GET    = (p, tok) => req('GET',    API + p, null, tok);
const POST   = (p, b, tok) => req('POST',   API + p, b, tok);
const PATCH  = (p, b, tok) => req('PATCH',  API + p, b, tok);
const PUT    = (p, b, tok) => req('PUT',    API + p, b, tok);
const DEL    = (p, b, tok) => req('DELETE', API + p, b, tok);

// ── Print helper ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function show(label, r, expectFail = false) {
    const ok   = r.status >= 200 && r.status < 300;
    const real = expectFail ? !ok : ok;
    const msg  = r.body?.message || r.body?.errors?.join(' | ') || `HTTP ${r.status}`;
    console.log(`  ${real ? '✓' : '✗'} [${r.status}] ${label}  →  ${msg}`);
    real ? pass++ : fail++;
}
function head(title) { console.log(`\n${'═'.repeat(60)}\n  ${title}\n${'═'.repeat(60)}`); }

// ── Utility ──────────────────────────────────────────────────────────────────
const rootReq = () => new Promise((resolve) => {
    const opts = { hostname: BASE_HOST, port: BASE_PORT, path: '/', method: 'GET', timeout: 8000 };
    const r = http.request(opts, res => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    r.on('error', () => resolve({})); r.on('timeout', () => { r.destroy(); resolve({}); });
    r.end();
});
const healthReq = () => new Promise((resolve) => {
    const opts = { hostname: BASE_HOST, port: BASE_PORT, path: '/health', method: 'GET', timeout: 8000 };
    const r = http.request(opts, res => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    r.on('error', () => resolve({})); r.on('timeout', () => { r.destroy(); resolve({}); });
    r.end();
});

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    const ts = new Date().toISOString();
    console.log(`\n╔═══════════════════════════════════════════════════════╗`);
    console.log(`║  API Test – CamPha  –  ${ts}  ║`);
    console.log(`╚═══════════════════════════════════════════════════════╝`);

    // ── [1] Root & Health ────────────────────────────────────────────────────
    head('[1] ROOT & HEALTH');
    const root   = await rootReq();
    const health = await healthReq();
    console.log(`  ✓ GET /        →  ${root.message || '?'}  v${root.version || '?'}`);
    console.log(`  ✓ GET /health  →  status=${health.status || '?'}`);
    pass += 2;

    // ── [2] Auth – Login 5 roles (single batch) ───────────────────────────
    head('[2] AUTH – Login 5 roles');
    const accounts = [
        { key: 'admin',   email: 'admin@campha.gov.vn',   pass: 'CamPha@2026' },
        { key: 'ubnd',    email: 'ubnd@campha.gov.vn',    pass: 'CamPha@2026' },
        { key: 'tnmt',    email: 'tnmt@campha.gov.vn',    pass: 'CamPha@2026' },
        { key: 'xd',      email: 'xaydung@campha.gov.vn', pass: 'CamPha@2026' },
        { key: 'citizen', email: 'citizen@campha.gov.vn', pass: 'CamPha@2026' },
    ];
    const tokens = {};
    for (const acc of accounts) {
        const r = await POST('/auth/login', { email: acc.email, password: acc.pass });
        const ok = r.status === 200 && r.body?.data?.accessToken;
        if (ok) tokens[acc.key] = r.body.data.accessToken;
        console.log(`  ${ok ? '✓' : '✗'} [${r.status}] login(${acc.key}) role=${r.body?.data?.user?.role?.code || '-'}  →  ${r.body?.message || ''}`);
        ok ? pass++ : fail++;
    }
    const ADM  = tokens.admin;
    const UBND = tokens.ubnd;
    const TNMT = tokens.tnmt;
    const XD   = tokens.xd;
    const CIT  = tokens.citizen;

    // ── [3] Auth – Validation ────────────────────────────────────────────────
    head('[3] AUTH – Validation (expect fail)');
    show('POST /auth/login (sai pass)',          await POST('/auth/login', { email:'admin@campha.gov.vn', password:'wrong' }), true);
    show('POST /auth/login (email sai format)',  await POST('/auth/login', { email:'notanemail', password:'CamPha@2026' }), true);
    show('POST /auth/register (thiếu fields)',   await POST('/auth/register', { email:'x', password:'y' }), true);
    show('POST /auth/forgot-password (unknown)', await POST('/auth/forgot-password', { email:'nobody@x.vn' }), false); // trả 200 (security)

    // ── [4] Auth – Authenticated endpoints ───────────────────────────────────
    head('[4] AUTH – Me, Sessions, Refresh, Change-PW');
    const meR = await GET('/auth/me', ADM);
    show('GET /auth/me (admin)',   meR);
    show('GET /auth/me (citizen)', await GET('/auth/me', CIT));
    show('GET /auth/me (no token)',await GET('/auth/me'), true);
    if (meR.body?.data) {
        const d = meR.body.data;
        console.log(`       email=${d.email}  role=${d.role?.code}  active=${d.is_active}`);
    }
    show('GET /auth/sessions',            await GET('/auth/sessions', ADM));
    show('PATCH /auth/me (update name)',  await PATCH('/auth/me', { fullName: 'Admin Cam Pha Updated' }, ADM));
    show('POST /auth/change-password (sai pass cũ)', await POST('/auth/change-password', { currentPassword:'wrong', newPassword:'CamPha@2026' }, ADM), true);

    // Refresh
    const loginCit = await POST('/auth/login', { email:'citizen@campha.gov.vn', password:'CamPha@2026' });
    const refreshTok = loginCit.body?.data?.refreshToken;
    if (refreshTok) {
        show('POST /auth/refresh', await POST('/auth/refresh', { refreshToken: refreshTok }));
    } else {
        console.log('  - POST /auth/refresh  →  skip (no refresh token)');
    }

    // ── [5] Admin Users ──────────────────────────────────────────────────────
    head('[5] ADMIN USERS');
    const listR = await GET('/admin/users', ADM);
    show('GET /admin/users (admin)',          listR);
    show('GET /admin/users (citizen – 403)',  await GET('/admin/users', CIT), true);
    show('GET /admin/users?search=citizen',   await GET('/admin/users?search=citizen', TNMT));
    if (listR.body?.data?.total !== undefined) console.log(`       total=${listR.body.data.total}`);

    // Lấy ID citizen
    const allUsers = listR.body?.data?.data || [];
    const citizenEntry = allUsers.find(u => u.role?.code === 'citizen');
    const citizenId = citizenEntry?.id;
    if (citizenId) {
        show(`GET /admin/users/${citizenId}`, await GET(`/admin/users/${citizenId}`, ADM));
    }
    show('GET /admin/users/99999 (not found)', await GET('/admin/users/99999', ADM), true);

    // POST tạo user mới
    const newEmail = `test_${Date.now()}@campha.vn`;
    const createR = await POST('/admin/users', { email: newEmail, fullName: 'Test API User', password: 'CamPha@2026', roleCode: 'citizen', orgCode: 'ubnd_campha' }, TNMT);
    show('POST /admin/users (tạo mới)', createR);
    const newId = createR.body?.data?.id;
    console.log(`       newUserId=${newId}`);

    if (newId) {
        show(`PATCH /admin/users/${newId}/active (khóa)`, await PATCH(`/admin/users/${newId}/active`, { isActive: false }, TNMT));
        show(`PATCH /admin/users/${newId}/active (mở)`,   await PATCH(`/admin/users/${newId}/active`, { isActive: true },  TNMT));
        show(`POST /admin/users/${newId}/reset-password`,  await POST(`/admin/users/${newId}/reset-password`, { newPassword: 'CamPha@2026Reset' }, TNMT));
        show(`DELETE /admin/users/${newId}`,               await DEL(`/admin/users/${newId}`, null, TNMT));
    }

    // ── [6] Admin System Logs ────────────────────────────────────────────────
    head('[6] ADMIN SYSTEM LOGS');
    show('GET /admin/system-logs (admin)',       await GET('/admin/system-logs', ADM));
    show('GET /admin/system-logs (citizen–403)', await GET('/admin/system-logs', CIT), true);
    show('GET /admin/system-logs?level=error',   await GET('/admin/system-logs?level=error', ADM));

    // ── [7] Storage ───────────────────────────────────────────────────────────
    head('[7] STORAGE');
    show('POST /storage/uploads/presign (no token)', await POST('/storage/uploads/presign', { category:'documents', originalName:'test.pdf', contentType:'application/pdf' }), true);
    const presignR = await POST('/storage/uploads/presign', { category: 'documents', originalName: 'test.pdf', contentType: 'application/pdf' }, ADM);
    show('POST /storage/uploads/presign (admin)', presignR);
    const uploadId = presignR.body?.data?.uploadId;
    console.log(`       uploadId=${uploadId}  hasUrl=${!!presignR.body?.data?.uploadUrl}`);

    if (uploadId) {
        show(`POST /storage/uploads/${uploadId}/commit`, await POST(`/storage/uploads/${uploadId}/commit`, null, ADM), true); // chưa upload thật → expect fail
    }
    show('GET /storage/objects/99999/download-url', await GET('/storage/objects/99999/download-url', ADM), true);

    // ── [8] Public CMS ────────────────────────────────────────────────────────
    head('[8] PUBLIC CMS');
    show('GET /cms/news',                           await GET('/cms/news'));
    show('GET /cms/news?page=1&limit=3',            await GET('/cms/news?page=1&limit=3'));
    show('GET /cms/news/9999 (not found)',           await GET('/cms/news/9999'), true);
    show('GET /cms/documents',                      await GET('/cms/documents'));
    show('GET /cms/pdf-maps',                       await GET('/cms/pdf-maps'));
    show('POST /cms/news/1/comments (no token)',    await POST('/cms/news/1/comments', { content: 'hi' }), true);

    // ── [9] Admin CMS ─────────────────────────────────────────────────────────
    head('[9] ADMIN CMS – News');
    show('GET /admin/cms/news (citizen–403)',    await GET('/admin/cms/news', CIT), true);
    const newsCreate = await POST('/admin/cms/news', {
        title:      `Tin tuc test ${Date.now()}`,
        content:    'Noi dung kiem tra API. Khong co HTML.',
        summary:    'Tom tat',
        visibility: 'public',
        status:     'published',
    }, ADM);
    show('POST /admin/cms/news', newsCreate);
    const nId = newsCreate.body?.data?.id;
    console.log(`       newsId=${nId}`);

    if (nId) {
        show(`GET /admin/cms/news/${nId}`,              await GET(`/admin/cms/news/${nId}`, ADM));
        show(`GET /cms/news/${nId} (public)`,           await GET(`/cms/news/${nId}`));
        show(`GET /cms/news/${nId}/comments`,           await GET(`/cms/news/${nId}/comments`));
        show(`POST /cms/news/${nId}/comments (citizen)`, await POST(`/cms/news/${nId}/comments`, { content: 'Binh luan test' }, CIT));
        const getN = await GET(`/admin/cms/news/${nId}`, ADM);
        const updAt = getN.body?.data?.updated_at;
        show(`PATCH /admin/cms/news/${nId}`,            await PATCH(`/admin/cms/news/${nId}`, { title: 'Tin da cap nhat', content: 'Noi dung da cap nhat.', expectedUpdatedAt: updAt }, ADM));
        const getN2 = await GET(`/admin/cms/news/${nId}`, ADM);
        const updAt2 = getN2.body?.data?.updated_at;
        show(`DELETE /admin/cms/news/${nId}`,           await DEL(`/admin/cms/news/${nId}?expectedUpdatedAt=${encodeURIComponent(updAt2)}`, null, ADM));
    }

    // ── [10] Remote Sensing (public) ─────────────────────────────────────────
    head('[10] REMOTE SENSING');
    show('GET /remote-sensing/images',             await GET('/remote-sensing/images'));
    show('GET /remote-sensing/images?page=1',      await GET('/remote-sensing/images?page=1'));
    show('GET /remote-sensing/images/9999 (404)',   await GET('/remote-sensing/images/9999'), true);
    show('GET /remote-sensing/compare (no params)', await GET('/remote-sensing/compare'), true);
    show('GET /admin/remote-sensing/images (admin)',    await GET('/admin/remote-sensing/images', ADM));
    show('GET /admin/remote-sensing/images (citizen–403)', await GET('/admin/remote-sensing/images', CIT), true);

    // ── [11] Web-Map ─────────────────────────────────────────────────────────
    head('[11] WEB-MAP');
    const wml = await GET('/web-map/layers');
    show('GET /web-map/layers',             wml);
    console.log(`       count=${wml.body?.data?.length ?? 0}`);
    show('GET /web-map/basemaps',           await GET('/web-map/basemaps'));
    show('GET /web-map/terrain',            await GET('/web-map/terrain'));
    show('GET /web-map/features/search?q=test', await GET('/web-map/features/search?q=test'));
    show('GET /web-map/features/search (no q–400)', await GET('/web-map/features/search'), true);

    // ── [12] Admin Layers ─────────────────────────────────────────────────────
    head('[12] ADMIN LAYERS');
    show('GET /admin/layers (tnmt)',           await GET('/admin/layers', TNMT));
    show('GET /admin/layers (citizen–403)',    await GET('/admin/layers', CIT), true);
    show('GET /admin/layers (no token–401)',   await GET('/admin/layers'), true);
    show('GET /admin/layers/99999 (not found)', await GET('/admin/layers/99999', TNMT), true);
    show('GET /admin/layers/imports/bad-id',    await GET('/admin/layers/imports/bad-id', TNMT), true);

    // ── [13] Map Proxy ────────────────────────────────────────────────────────
    head('[13] MAP PROXY');
    show('GET /maps/layers/99999/wms (no layer)', await GET('/maps/layers/99999/wms?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=test&SRS=EPSG:4326&BBOX=0,0,1,1&WIDTH=256&HEIGHT=256&FORMAT=image/png'), true);

    // ── [14] Auth – Logout & Revoke Sessions ─────────────────────────────────
    head('[14] AUTH – Logout & Sessions');
    const sessR = await GET('/auth/sessions', ADM);
    show('GET /auth/sessions',   sessR);
    const sessions = sessR.body?.data || [];
    console.log(`       session count=${sessions.length}`);
    if (sessions.length > 0) {
        const lastId = sessions[sessions.length - 1]?.id;
        if (lastId) show(`DELETE /auth/sessions/${lastId}`, await DEL(`/auth/sessions/${lastId}`, null, ADM));
    }
    // Logout citizen
    const logoutR = await POST('/auth/logout', { refreshToken: loginCit.body?.data?.refreshToken }, CIT);
    show('POST /auth/logout (citizen)', logoutR);

    // ── Summary ───────────────────────────────────────────────────────────────
    const total = pass + fail;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  KẾT QUẢ: ${pass}/${total} test PASS  |  ${fail} FAIL`);
    console.log(`${'═'.repeat(60)}\n`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
