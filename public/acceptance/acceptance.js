'use strict';

const state = {
  manifest: null,
  tokens: {},
  tests: [],
  activeModule: 'all',
  controller: null,
  startedAt: null,
  finishedAt: null,
};

const accounts = [
  { role: 'system_admin', email: 'admin@campha.gov.vn' },
  { role: 'ubnd_tp', email: 'ubnd@campha.gov.vn' },
  { role: 'so_tnmt', email: 'tnmt@campha.gov.vn' },
  { role: 'so_xd', email: 'xaydung@campha.gov.vn' },
  { role: 'citizen', email: 'citizen@campha.gov.vn' },
];
const labels = { core: 'Core', auth: 'Auth', cms: 'CMS', admin: 'Admin', gis: 'GIS / Map', field: 'Field / Raster', kttv: 'KTTV', security: 'RBAC / Security' };
const $ = (id) => document.getElementById(id);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const listItems = (body) => Array.isArray(body?.data) ? body.data : body?.data?.items || [];
const containsId = (body, id) => listItems(body).some((row) => Number(row.id) === Number(id));
const apiRoot = () => $('base-url').value.trim().replace(/\/$/, '');
const serverRoot = () => new URL(apiRoot(), window.location.origin).origin;
const safeJson = (value) => JSON.stringify(value, (key, item) => /token|password|secret|apiKey/i.test(key) ? '[REDACTED]' : item, 2);

async function request(path, options = {}) {
  const headers = { accept: 'application/json', ...(options.headers || {}) };
  if (options.role) {
    assert(state.tokens[options.role]?.accessToken, `Chưa login role ${options.role}`);
    headers.authorization = `Bearer ${state.tokens[options.role].accessToken}`;
  }
  const started = performance.now();
  const response = await fetch(`${path.startsWith('http') ? '' : apiRoot()}${path}`, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: state.controller?.signal,
  });
  const contentType = response.headers.get('content-type') || '';
  let body;
  if (options.binary) body = await response.arrayBuffer();
  else {
    const text = await response.text();
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  }
  return { response, body, duration: performance.now() - started, contentType };
}

const definitions = [
  { module: 'core', name: 'Health endpoint', endpoint: 'GET /health', run: async () => {
    const result = await request(`${serverRoot()}/health`); assert(result.response.status === 200, `HTTP ${result.response.status}`); assert(result.body?.status === 'OK', 'Health status không OK'); return result;
  }},
  { module: 'core', name: 'Security headers', endpoint: 'GET /health', run: async () => {
    const result = await request(`${serverRoot()}/health`); const h = result.response.headers; assert(!h.get('x-powered-by'), 'Lộ X-Powered-By'); assert(h.get('x-content-type-options') === 'nosniff', 'Thiếu nosniff'); assert(h.get('content-security-policy'), 'Thiếu CSP'); return result;
  }},
  { module: 'core', name: 'Sensitive path blocked', endpoint: 'GET /.env', run: async () => {
    const result = await request(`${serverRoot()}/.env`); assert(result.response.status === 403, `Cần 403, nhận ${result.response.status}`); return result;
  }},
  { module: 'core', name: 'Unknown API route', endpoint: 'GET /api/v1/__missing__', run: async () => {
    const result = await request('/__missing__'); assert(result.response.status === 404, `Cần 404, nhận ${result.response.status}`); return result;
  }},
  ...accounts.map((account) => ({ module: 'auth', name: `Login ${account.role}`, endpoint: 'POST /auth/login', run: () => login(account) })),
  { module: 'auth', name: 'Profile citizen', endpoint: 'GET /auth/me', run: async () => {
    const result = await request('/auth/me', { role: 'citizen' }); assert(result.response.status === 200, `HTTP ${result.response.status}`); assert(result.body?.data?.user?.role?.code === 'citizen', 'Sai citizen role'); return result;
  }},
  { module: 'auth', name: 'Danh sách phiên citizen', endpoint: 'GET /auth/sessions', run: async () => {
    const result = await request('/auth/sessions', { role: 'citizen' }); assert(result.response.status === 200, `HTTP ${result.response.status}`); return result;
  }},
  { module: 'auth', name: 'Anonymous profile bị chặn', endpoint: 'GET /auth/me', run: async () => {
    const result = await request('/auth/me'); assert(result.response.status === 401, `Cần 401, nhận ${result.response.status}`); return result;
  }},
  { module: 'auth', name: 'Login payload invalid', endpoint: 'POST /auth/login', run: async () => {
    const result = await request('/auth/login', { method: 'POST', headers: {'content-type':'application/json'}, body: { email: 'invalid' } }); assert([400,422].includes(result.response.status), `Cần 400/422, nhận ${result.response.status}`); return result;
  }},
  { module: 'cms', name: 'Danh sách tin public', endpoint: 'GET /cms/news', run: async () => expectFixture('/cms/news?page=1&limit=20', state.manifest.fixtures.news.id) },
  { module: 'cms', name: 'Chi tiết tin fixture', endpoint: 'GET /cms/news/:id', run: async () => {
    const f=state.manifest.fixtures.news; const result=await request(`/cms/news/${f.id}`); assert(result.response.status===200,`HTTP ${result.response.status}`); assert(result.body?.data?.title===f.title,'Sai title fixture'); return result;
  }},
  { module: 'cms', name: 'Bình luận public', endpoint: 'GET /cms/news/:id/comments', run: async () => {
    const f=state.manifest.fixtures.news; return expectFixture(`/cms/news/${f.id}/comments?page=1&limit=100`,f.commentId);
  }},
  { module: 'cms', name: 'Danh sách văn bản', endpoint: 'GET /cms/documents', run: async () => expectFixture('/cms/documents?page=1&limit=100',state.manifest.fixtures.content.document.id) },
  { module: 'cms', name: 'Chi tiết PDF map', endpoint: 'GET /cms/pdf-maps/:id', run: async () => expectStatus(`/cms/pdf-maps/${state.manifest.fixtures.content.pdfMap.id}`,200) },
  { module: 'cms', name: 'Admin news list', endpoint: 'GET /admin/cms/news', run: async () => expectFixture('/admin/cms/news?page=1&limit=20',state.manifest.fixtures.news.id,'ubnd_tp') },
  { module: 'cms', name: 'Citizen tạo CMS bị chặn', endpoint: 'POST /admin/cms/news', run: async () => expectStatus('/admin/cms/news',403,'citizen',{method:'POST',headers:{'content-type':'application/json'},body:{title:'forbidden',content:'forbidden',visibility:'public',status:'draft'}}) },
  { module: 'admin', name: 'System admin user list', endpoint: 'GET /admin/users', run: async () => {
    const result=await request('/admin/users?page=1&limit=20',{role:'system_admin'}); assert(result.response.status===200,`HTTP ${result.response.status}`); assert(listItems(result.body).length>=5,'Thiếu tài khoản nền'); return result;
  }},
  { module: 'admin', name: 'Citizen user list bị chặn', endpoint: 'GET /admin/users', run: async () => expectStatus('/admin/users?page=1&limit=10',403,'citizen') },
  { module: 'admin', name: 'System logs', endpoint: 'GET /admin/system-logs', run: async () => expectStatus('/admin/system-logs?page=1&limit=20',200,'system_admin') },
  { module: 'admin', name: 'Citizen system logs bị chặn', endpoint: 'GET /admin/system-logs', run: async () => expectStatus('/admin/system-logs?page=1&limit=10',403,'citizen') },
  { module: 'gis', name: 'Web map catalog', endpoint: 'GET /web-map/layers', run: async () => expectFixture('/web-map/layers',state.manifest.fixtures.layer.id) },
  { module: 'gis', name: 'Basemap catalog', endpoint: 'GET /web-map/basemaps', run: async () => expectStatus('/web-map/basemaps',200) },
  { module: 'gis', name: 'Terrain catalog', endpoint: 'GET /web-map/terrain', run: async () => expectStatus('/web-map/terrain',200) },
  { module: 'gis', name: 'Admin layer list', endpoint: 'GET /admin/layers', run: async () => expectFixture('/admin/layers?page=1&limit=100',state.manifest.fixtures.layer.id,'so_tnmt') },
  { module: 'gis', name: 'Layer detail', endpoint: 'GET /admin/layers/:id', run: async () => expectStatus(`/admin/layers/${state.manifest.fixtures.layer.id}`,200,'so_tnmt') },
  { module: 'gis', name: 'Feature detail', endpoint: 'GET /mobile/layers/:id/features/:featureId', run: async () => expectStatus(`/mobile/layers/${state.manifest.fixtures.layer.id}/features/${state.manifest.fixtures.layer.featureId}`,200,'citizen') },
  { module: 'gis', name: 'Nearby feature', endpoint: 'GET /mobile/layers/:id/nearby', run: async () => expectStatus(`/mobile/layers/${state.manifest.fixtures.layer.id}/nearby?longitude=107.3&latitude=21&radiusMeters=2000&limit=20`,200,'citizen') },
  { module: 'gis', name: 'MVT binary non-empty', endpoint: 'GET /mobile/layers/:id/tiles/10/817/450.mvt', run: async () => {
    const result = await request(`/mobile/layers/${state.manifest.fixtures.layer.id}/tiles/10/817/450.mvt`, { role: 'citizen', binary: true });
    assert(result.response.status === 200, `HTTP ${result.response.status}`);
    assert(result.contentType.includes('mapbox-vector-tile'), 'Sai MVT content-type');
    assert(result.body.byteLength > 0, 'MVT fixture rỗng');
    return result;
  }},
  { module: 'gis', name: 'Citizen admin layer bị chặn', endpoint: 'GET /admin/layers', run: async () => expectStatus('/admin/layers?page=1&limit=10',403,'citizen') },
  { module: 'field', name: 'Raster metadata', endpoint: 'GET /remote-sensing/images/:id', run: async () => expectStatus(`/remote-sensing/images/${state.manifest.fixtures.raster.id}`,200) },
  { module: 'field', name: 'Raster signed URL', endpoint: 'GET /remote-sensing/images/:id/download-url', run: async () => expectStatus(`/remote-sensing/images/${state.manifest.fixtures.raster.id}/download-url?expireSeconds=60`,200,'citizen') },
  { module: 'field', name: 'Field reports public', endpoint: 'GET /field-reports/public', run: async () => expectFixture('/field-reports/public?page=1&limit=100',state.manifest.fixtures.fieldReport.id) },
  { module: 'field', name: 'Field reports nearby', endpoint: 'GET /field-reports/nearby', run: async () => expectFixture('/field-reports/nearby?longitude=107.31&latitude=21.01&radiusMeters=500&from=2026-01-01T00%3A00%3A00Z&to=2027-01-01T00%3A00%3A00Z',state.manifest.fixtures.fieldReport.id) },
  { module: 'field', name: 'Statistics sources', endpoint: 'GET /statistics/sources', run: async () => expectStatus('/statistics/sources',200,'so_tnmt') },
  { module: 'kttv', name: 'KTTV station fixture', endpoint: 'GET /admin/kttv/stations/:code', run: async () => expectStatus(`/admin/kttv/stations/${state.manifest.fixtures.kttv.station.code}`,200,'so_tnmt') },
  { module: 'kttv', name: 'Official scenarios', endpoint: 'GET /admin/kttv/scenarios/:id', run: async () => {
    for(const scenario of state.manifest.fixtures.kttv.scenarios){const result=await request(`/admin/kttv/scenarios/${scenario.id}`,{role:'so_tnmt'});assert(result.response.status===200,`HTTP ${result.response.status}`);assert(result.body?.data?.status==='official',`${scenario.code} chưa official`);} return { response:{status:200,headers:new Headers()}, body:{checked:state.manifest.fixtures.kttv.scenarios.length}, duration:0 };
  }},
  { module: 'kttv', name: 'Manual input matched', endpoint: 'GET /admin/kttv/inputs/:id', run: async () => expectInput(state.manifest.fixtures.kttv.manualInput.id,'manual') },
  { module: 'kttv', name: 'Automatic input matched', endpoint: 'GET /admin/kttv/inputs/:id', run: async () => expectInput(state.manifest.fixtures.kttv.automaticInput?.id,'automatic') },
  { module: 'kttv', name: 'Citizen KTTV write bị chặn', endpoint: 'POST /admin/kttv/sources', run: async () => expectStatus('/admin/kttv/sources',403,'citizen',{method:'POST',headers:{'content-type':'application/json'},body:{name:'forbidden',provider:'forbidden',serviceType:'REST',endpointUrl:'https://api.open-meteo.com/v1/forecast',responseFormat:'JSON',variables:{observedAtPath:'current.time',observedAtFormat:'iso',stationCode:'FORBIDDEN',mappings:[{path:'current.precipitation',variable:'rainfall',unit:'mm'}]}}}) },
  { module: 'security', name: 'Cache private khi có token', endpoint: 'GET /auth/me', run: async () => {
    const result=await request('/auth/me',{role:'citizen'}); assert(/private/i.test(result.response.headers.get('cache-control')||''),'Cache-Control không private'); assert(/Authorization/i.test(result.response.headers.get('vary')||''),'Vary thiếu Authorization'); return result;
  }},
  { module: 'security', name: 'Strict query validation', endpoint: 'GET /web-map/layers?unexpected=1', run: async () => {
    const result=await request('/web-map/layers?unexpected=1'); assert([400,422].includes(result.response.status),`Cần 400/422, nhận ${result.response.status}`); return result;
  }},
];

async function expectStatus(path, status, role, extra={}) { const result=await request(path,{...extra,role}); assert(result.response.status===status,`Cần ${status}, nhận ${result.response.status}`); return result; }
async function expectFixture(path,id,role) { const result=await request(path,{role}); assert(result.response.status===200,`HTTP ${result.response.status}`); assert(containsId(result.body,id),`Không thấy fixture ID ${id}`); return result; }
async function expectInput(id,mode) { if(!id) return {skip:`Thiếu ${mode} fixture`}; const result=await request(`/admin/kttv/inputs/${id}`,{role:'so_tnmt'}); assert(result.response.status===200,`HTTP ${result.response.status}`); assert(result.body?.data?.input_mode===mode,`Sai mode ${mode}`); assert(result.body?.data?.match_status==='matched',`${mode} chưa matched`); return result; }
async function login(account) { const password=$('password').value; assert(password,'Nhập mật khẩu test'); const result=await request('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:{email:account.email,password}}); assert(result.response.status===200,`HTTP ${result.response.status}`); assert(result.body?.data?.user?.role?.code===account.role,`Sai role ${account.role}`); state.tokens[account.role]={accessToken:result.body.data.accessToken,refreshToken:result.body.data.refreshToken}; renderAccounts(); return result; }

function buildTests(){state.tests=definitions.map((test,index)=>({...test,id:index+1,status:'pending',duration:0,detail:null}));renderTabs();renderTests();updateMetrics();}
function renderAccounts(){ $('account-grid').innerHTML=accounts.map(a=>`<div class="account ${state.tokens[a.role]?'logged':''}"><strong>${state.tokens[a.role]?'✓ ':''}${a.role}</strong><span>${a.email}</span></div>`).join(''); }
function renderTabs(){const modules=['all',...new Set(state.tests.map(t=>t.module))];$('module-tabs').innerHTML=modules.map(m=>`<button class="tab ${state.activeModule===m?'active':''}" data-module="${m}" role="tab">${m==='all'?'Tất cả':labels[m]} · ${m==='all'?state.tests.length:state.tests.filter(t=>t.module===m).length}</button>`).join('');document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{state.activeModule=btn.dataset.module;renderTabs();renderTests();});}
function renderTests(){const query=$('search-tests').value.toLowerCase();const status=$('status-filter').value;const visible=state.tests.filter(t=>(state.activeModule==='all'||t.module===state.activeModule)&&(status==='all'||t.status===status)&&`${t.name} ${t.endpoint} ${labels[t.module]}`.toLowerCase().includes(query));$('test-list').innerHTML=visible.length?visible.map(t=>`<button class="test-row ${t.status==='running'?'running':''}" data-id="${t.id}"><span class="test-number">${String(t.id).padStart(2,'0')}</span><span class="test-name"><strong>${t.name}</strong><span>${labels[t.module]}</span></span><span class="test-endpoint">${t.endpoint}</span><span class="status ${t.status==='pending'||t.status==='running'?'neutral':t.status}">${({pending:'Chờ',running:'Đang chạy',pass:'Đạt',fail:'Lỗi',skip:'Bỏ qua'})[t.status]}</span><span class="test-duration">${t.duration?t.duration.toFixed(0)+' ms':'—'}</span></button>`).join(''):'<div class="empty-state">Không có case phù hợp bộ lọc.</div>';document.querySelectorAll('.test-row').forEach(row=>row.onclick=()=>showDetail(Number(row.dataset.id)));}
function updateMetrics(){const count=(s)=>state.tests.filter(t=>t.status===s).length;const finished=count('pass')+count('fail');const score=finished?Math.round(count('pass')/finished*100):0;$('total-count').textContent=state.tests.length;$('pass-count').textContent=count('pass');$('fail-count').textContent=count('fail');$('skip-count').textContent=count('skip');$('score-value').textContent=finished?`${score}%`:'—';$('score-ring').style.setProperty('--score',score);$('score-title').textContent=!finished?'Chưa chạy':count('fail')?'Còn lỗi cần xử lý':'Gate tự động đạt';$('score-subtitle').textContent=!finished?'Cấu hình bên dưới rồi bắt đầu':`${count('pass')} đạt · ${count('fail')} lỗi · ${count('skip')} bỏ qua`;if(state.startedAt){const end=state.finishedAt||Date.now();$('duration-value').textContent=`${((end-state.startedAt)/1000).toFixed(1)}s`;}}
function showDetail(id){const test=state.tests.find(t=>t.id===id);if(!test)return;$('detail-title').textContent=test.name;$('detail-status').textContent=test.status;$('detail-status').className=`status ${test.status}`;$('detail-content').textContent=safeJson({module:labels[test.module],endpoint:test.endpoint,status:test.status,durationMs:Number(test.duration.toFixed(2)),detail:test.detail});$('detail-dialog').showModal();}
function serializeHeaders(headers){const result={};if(headers?.forEach)headers.forEach((value,key)=>{if(!/cookie|authorization/i.test(key))result[key]=value;});return result;}
async function runOne(test){test.status='running';renderTests();const started=performance.now();try{const result=await test.run();test.duration=performance.now()-started;if(result?.skip){test.status='skip';test.detail={reason:result.skip};}else{test.status='pass';test.detail={httpStatus:result.response?.status,headers:serializeHeaders(result.response?.headers),body:result.body instanceof ArrayBuffer?`Binary ${result.body.byteLength} bytes`:result.body};}}catch(error){test.duration=performance.now()-started;test.status=error.name==='AbortError'?'skip':'fail';test.detail={error:error.message};}updateMetrics();renderTests();}
async function runAll(){if(!$('password').value){$('password').focus();return;}state.controller=new AbortController();state.startedAt=Date.now();state.finishedAt=null;state.tokens={};state.tests.forEach(t=>{t.status='pending';t.detail=null;t.duration=0;});$('run-all').disabled=true;$('stop-run').disabled=false;$('download-report').disabled=true;renderAccounts();updateMetrics();renderTests();for(const test of state.tests){if(state.controller.signal.aborted)break;await runOne(test);}state.finishedAt=Date.now();state.controller=null;$('run-all').disabled=false;$('stop-run').disabled=true;$('download-report').disabled=false;updateMetrics();renderTests();}
async function loadManifest(){try{const response=await fetch('./fixtures.json',{cache:'no-store'});assert(response.ok,`HTTP ${response.status}`);state.manifest=await response.json();assert(state.manifest.database==='campha_mobile_acceptance','Manifest không thuộc acceptance DB');$('manifest-state').textContent='Đã tải';$('manifest-state').className='status pass';const dd=document.querySelectorAll('#manifest-facts dd');dd[0].textContent=state.manifest.database;dd[1].textContent=new Date(state.manifest.generatedAt).toLocaleString('vi-VN');dd[2].textContent=`${state.manifest.fixtures.layer.code} #${state.manifest.fixtures.layer.id}`;dd[3].textContent=state.manifest.fixtures.registry.slug;}catch(error){$('manifest-state').textContent='Lỗi';$('manifest-state').className='status fail';$('score-subtitle').textContent=`Manifest: ${error.message}`;}}
async function healthOnly(){const test=state.tests[0];await runOne(test);const online=test.status==='pass';$('runtime-pill').className=`runtime-pill ${online?'online':'offline'}`;$('runtime-label').textContent=online?'Server online':'Server offline';}
async function loginAll(){for(const account of accounts){try{await login(account);}catch(error){alert(`${account.role}: ${error.message}`);break;}}}
function clearSecrets(){state.tokens={};$('password').value='';renderAccounts();}
function downloadReport(){const report={schemaVersion:1,generatedAt:new Date().toISOString(),apiBaseUrl:apiRoot(),manifestGeneratedAt:state.manifest?.generatedAt,summary:{total:state.tests.length,pass:state.tests.filter(t=>t.status==='pass').length,fail:state.tests.filter(t=>t.status==='fail').length,skip:state.tests.filter(t=>t.status==='skip').length,durationMs:state.finishedAt-state.startedAt},tests:state.tests.map(({run,...test})=>test),limitations:['Product WebGIS SPA absent','QGIS/real GIS data UAT external','OAuth/SMTP/Firebase/GEE/load/restore/pentest external']};const blob=new Blob([safeJson(report)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`campha-web-api-acceptance-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();URL.revokeObjectURL(url);}

$('run-all').onclick=runAll;$('stop-run').onclick=()=>state.controller?.abort();$('health-check').onclick=healthOnly;$('login-all').onclick=loginAll;$('clear-secrets').onclick=clearSecrets;$('download-report').onclick=downloadReport;$('close-dialog').onclick=()=>$('detail-dialog').close();$('search-tests').oninput=renderTests;$('status-filter').onchange=renderTests;$('footer-time').textContent=new Date().toLocaleString('vi-VN');window.addEventListener('beforeunload',clearSecrets);renderAccounts();buildTests();loadManifest();healthOnly();
