/* DCC Order to Dispatch – app (hash routing, Supabase) */
(() => {
const C = window.O2D_CONFIG;
const sb = window.supabase.createClient(C.url, C.key);
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGE = 25;
const S = { user: null, me: null, steps: [], cfg: [], loc: 'all', page: 0, q: '', status: '', step: '', trade: '', lateOnly: false, taskStep: null, retTab: null, adminTab: 'users' };

const ICON = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  new: 'M12 8v8M8 12h8M12 21a9 9 0 100-18 9 9 0 000 18z',
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  orders: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  returns: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  reports: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  admin: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'
};
const STEP_FIELDS = {
  2: [['invoice_no', 'Invoice no.'], ['invoice_value', 'Invoice value (₹)', 'number']],
  3: [['eway_no', 'E-way bill no.']],
  4: [['vehicle_no', 'Vehicle no.'], ['driver_name', 'Driver name']],
  5: [['drive_url', 'Receiving copy – Google Drive link'], ['has_return', 'Goods returned?', 'check'], ['note', 'Note']],
  6: [['cn_no', 'Credit note no.'], ['cn_amount', 'Credit note amount (₹)', 'number']],
  7: [['grn_no', 'GRN no.']],
  8: [['note', 'Note']],
  9: [['handed_to', 'Handed to']],
  10: [['received_by', 'Received by']]
};
const TRADES = ['Modern Trade', 'General Trade', 'DCC Transfer', 'Sample', 'Distributor'];
const CHANNELS = ['Email', 'WhatsApp', 'Phone'];

const fmtDate = d => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDay = d => d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const money = v => v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const stepName = n => (S.steps.find(s => s.step_no === n) || {}).name || ('Step ' + n);
const locName = c => c === 'okhla' ? 'Okhla' : c === 'gurgaon' ? 'Gurgaon' : c;
const rel = d => { if (!d) return 'not set'; const m = Math.round((new Date(d) - Date.now()) / 60000), a = Math.abs(m); const t = a < 60 ? a + 'm' : a < 1440 ? Math.round(a / 60) + 'h' : Math.round(a / 1440) + 'd'; return m < 0 ? 'Late ' + t : 'In ' + t; };
const dur = ms => { const m = Math.round(Math.abs(ms) / 60000); return m < 60 ? m + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.floor(m / 1440) + 'd ' + Math.round((m % 1440) / 60) + 'h'; };
const ownerOf = (loc, n) => ((S.cfg.find(c => c.location === loc && c.step_no === n) || {}).owner_label) || '—';
const locFilter = q => S.loc === 'all' ? q : q.eq('location', S.loc);
const chipStatus = o => o.status === 'active' ? `<span class="chip c-act">Step ${o.current_step} · ${esc(stepName(o.current_step))}</span>` : `<span class="chip ${o.status === 'done' ? 'c-done' : 'c-can'}">${o.status}</span>`;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3000); }
function show(id) { ['login', 'noaccess', 'app'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id)); }
function countUp(el, target) {
  const t0 = performance.now(), dur = 1400;
  const tick = now => { const x = Math.min(1, (now - t0) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - x, 4))).toLocaleString('en-IN'); if (x < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
document.addEventListener('mousemove', e => { const c = e.target.closest && e.target.closest('.card'); if (!c) return; const r = c.getBoundingClientRect(); c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px'); });

// ---------- auth ----------
$('#lights').innerHTML = '<i class="bulb"></i>'.repeat(16);
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#loginErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  if (error) { $('#loginErr').textContent = error.message; return; }
  boot();
});
async function out() { await sb.auth.signOut(); show('login'); }

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return show('login');
  S.user = session.user;
  const { data: me } = await sb.from('app_users').select('*').eq('user_id', S.user.id).maybeSingle();
  if (!me || !me.active) { $('#uid').textContent = S.user.id; return show('noaccess'); }
  S.me = me;
  const [sd, sc] = await Promise.all([sb.from('step_defs').select('*').order('step_no'), sb.from('step_config').select('*').order('step_no')]);
  S.steps = sd.data || []; S.cfg = sc.data || [];
  const locs = me.role === 'admin' ? ['okhla', 'gurgaon'] : me.locations;
  S.locs = locs; S.loc = locs.length > 1 ? 'all' : locs[0];
  show('app');
  if (!location.hash) location.hash = '#/dashboard';
  route();
}
window.addEventListener('hashchange', () => { if (S.me) route(); });

// ---------- shell ----------
function canNew() { return S.me.role === 'admin' || (S.me.role === 'staff' && S.me.steps.includes(1)); }
function renderShell(active) {
  const items = [['dashboard', 'Dashboard'], ...(canNew() ? [['new', 'New order']] : []), ['tasks', 'My tasks'], ['orders', 'All orders'], ['returns', 'Returns & GRN'], ['reports', 'Reports'], ...(S.me.role === 'admin' ? [['admin', 'Admin']] : [])];
  const segs = (S.locs.length > 1 ? [['all', 'All']] : []).concat(S.locs.map(l => [l, locName(l)]));
  $('#sb').innerHTML = `
    <div style="position:relative;padding-top:2px"><div class="snow"></div><div class="lights">${'<i class="bulb"></i>'.repeat(14)}</div>
    <div style="display:flex;align-items:center;gap:11px;padding:16px 18px 14px"><div style="width:34px;height:34px;border-radius:10px;background:var(--ink);display:grid;place-items:center;color:#fff;font:400 20px 'Instrument Serif',serif;animation:drift 4s ease-in-out infinite">D</div>
    <div style="line-height:1.2"><div style="font-weight:600;font-size:14px">Order to Dispatch</div><div class="mut" style="font-size:12px">DCC Supply Chain</div></div></div></div>
    <div style="padding:4px 12px 12px"><div class="mut" style="font-size:11px;font-weight:500;padding:0 4px 6px;letter-spacing:.04em">LOCATION</div>
    <div class="seg">${segs.map(s => `<button data-loc="${s[0]}" class="${S.loc === s[0] ? 'on' : ''}">${s[1]}</button>`).join('')}</div></div>
    <nav style="padding:4px 12px;display:flex;flex-direction:column;gap:3px;flex:1"><div class="mut" style="font-size:11px;font-weight:500;padding:6px 4px 4px;letter-spacing:.04em">WORKSPACE</div>
    ${items.map(i => `<a class="nv ${i[0] === active ? 'on' : ''}" href="#/${i[0]}"><svg viewBox="0 0 24 24"><path d="${ICON[i[0]]}"></path></svg><span>${i[1]}</span>${i[0] === 'tasks' ? '<span class="cnt hidden" id="taskBadge"></span>' : ''}</a>`).join('')}</nav>
    <div style="padding:12px;border-top:1px solid var(--line)"><div style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px;background:#fff;border:1px solid var(--line)">
    <div class="av" style="background:linear-gradient(135deg,#c8102e,#f5c451)">${esc(S.me.full_name[0])}</div>
    <div style="line-height:1.25;flex:1;min-width:0"><div style="font-weight:500;font-size:13px">${esc(S.me.full_name)}</div><div class="mut" style="font-size:12px">${esc(S.me.role)} · ${S.locs.map(locName).join(' + ')}</div></div>
    <button id="signOut" aria-label="Sign out" style="border:0;background:transparent;color:var(--mute);cursor:pointer;width:28px;height:28px"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"></path></svg></button></div></div>`;
  $('#sb').querySelectorAll('[data-loc]').forEach(b => b.onclick = () => { S.loc = b.dataset.loc; S.page = 0; route(); });
  $('#signOut').onclick = out;
  badge();
}
async function badge() {
  let q = locFilter(sb.from('v_tasks').select('order_id', { count: 'exact', head: true }));
  if (S.me.role !== 'admin') q = q.in('step_no', S.me.steps.length ? S.me.steps : [0]);
  const { count } = await q; const b = $('#taskBadge'); if (b && count) { b.textContent = count; b.classList.remove('hidden'); }
}
function topbar(crumb, right = '') {
  $('#topbar').innerHTML = `<div class="crumb">Workspace / <b>${crumb}</b></div><div style="margin-left:auto;display:flex;gap:10px;align-items:center">${right}
    <div class="sr"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg><input id="gs" placeholder="Search orders, parties, invoices…" value="${esc(S.q)}"></div></div>`;
  $('#gs').onkeydown = e => { if (e.key === 'Enter') { S.q = e.target.value.trim(); S.status = ''; S.step = ''; S.page = 0; if (location.hash === '#/orders') route(); else location.hash = '#/orders'; } };
}

// ---------- router ----------
function route() {
  const h = (location.hash || '#/dashboard').replace(/^#\//, '').split('?')[0].split('/');
  const page = h[0] || 'dashboard';
  const adminOnly = page === 'admin' && S.me.role !== 'admin';
  const p = adminOnly ? 'dashboard' : page;
  renderShell(p === 'order' ? 'orders' : p);
  const v = $('#view'); v.innerHTML = '<div class="empty">Loading…</div>';
  if (p === 'orders' && h[1]) return detail(+h[1]);
  ({ dashboard, new: newOrder, tasks, orders, returns, reports, admin }[p] || dashboard)();
}

// ---------- dashboard ----------
async function count(status, extra) {
  let q = locFilter(sb.from('orders').select('id', { count: 'exact', head: true }));
  if (status) q = q.eq('status', status);
  if (extra) q = extra(q);
  const { count: c } = await q; return c ?? 0;
}
async function dashboard() {
  topbar('Dashboard');
  const v = $('#view');
  const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
  const [act, done, mon, pipe, recent, late, lateRows] = await Promise.all([
    count('active'), count('done'), count(null, q => q.gte('received_at', month.toISOString())),
    sb.from('v_pipeline').select('*'),
    locFilter(sb.from('orders').select('id,location,so_no,party_name,status,current_step,received_at').order('received_at', { ascending: false }).limit(6)),
    locFilter(sb.from('v_tasks').select('order_id', { count: 'exact', head: true }).eq('is_late', true)),
    locFilter(sb.from('v_tasks').select('order_id,so_no,party_name,step_no,planned_at').eq('is_late', true).order('planned_at').limit(5))
  ]);
  const per = {}, byLoc = { okhla: 0, gurgaon: 0 };
  (pipe.data || []).forEach(r => { byLoc[r.location] = (byLoc[r.location] || 0) + r.orders; if (S.loc === 'all' || r.location === S.loc) per[r.step_no] = (per[r.step_no] || 0) + r.orders; });
  const max = Math.max(1, ...Object.values(per)), tot = Math.max(1, byLoc.okhla + byLoc.gurgaon);
  const hr = +new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
  v.innerHTML = `
  <div class="dots" style="position:absolute;left:0;right:0;top:0;height:320px;opacity:.7"></div><div style="position:relative">
  <div class="row rise" style="--i:0;align-items:flex-end;justify-content:space-between;margin-bottom:26px"><div><h1 class="h1">Good ${hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'}, ${esc(S.me.full_name.split(' ')[0])}</h1><div class="sub">${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })} · ${S.loc === 'all' ? 'both locations' : locName(S.loc)}</div></div>
  ${canNew() ? '<a class="btn" href="#/new" style="text-decoration:none">+ New order</a>' : ''}</div>
  <div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    <div class="card kpi rise" style="--i:2"><div class="row" style="justify-content:space-between"><span class="mut">Active orders</span><span class="chip c-act">in flight</span></div><div class="n" data-n="${act}">0</div></div>
    <div class="card kpi rise" style="--i:3"><div class="row" style="justify-content:space-between"><span class="mut">Dispatched / done</span><span class="chip c-done">complete</span></div><div class="n" data-n="${done}">0</div></div>
    <div class="card kpi rise" style="--i:4"><div class="row" style="justify-content:space-between"><span class="mut">Received this month</span><span class="chip c-step">${new Date().toLocaleString('en-IN', { month: 'short' })}</span></div><div class="n" data-n="${mon}">0</div></div>
    <div class="card kpi beam rise" style="--i:5;border-radius:14px"><div class="row" style="justify-content:space-between"><span class="mut">Late tasks</span><span class="chip c-late">needs action</span></div><div class="n" style="color:var(--red)" data-n="${late.count ?? 0}">0</div></div>
  </div>
  <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);margin-top:16px">
    <div class="card flat rise" style="--i:6;padding:22px"><div style="font-weight:600;font-size:15px">Where the active orders are</div><div class="mut" style="font-size:12.5px;margin-top:2px">Click a step to open its orders</div>
    <div style="margin-top:14px;display:flex;flex-direction:column;gap:2px">${S.steps.map((s, i) => `<a class="pr" data-step="${s.step_no}" href="#/orders"><span class="pn">${s.step_no}</span><div><div style="font-size:13.5px">${esc(s.name)}</div><div class="bar" style="margin-top:6px"><i style="width:${Math.max(per[s.step_no] ? 3 : 0, (per[s.step_no] || 0) / max * 100)}%;--i:${i}"></i></div></div><span class="mono" style="text-align:right">${per[s.step_no] || 0}</span></a>`).join('')}</div></div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card flat rise" style="--i:7;padding:22px"><div style="font-weight:600;font-size:15px">By location</div><div style="margin-top:16px;display:grid;gap:16px">
        <div><div class="row" style="justify-content:space-between;font-size:13px"><span>Okhla</span><span class="mono">${byLoc.okhla} active</span></div><div class="bar" style="margin-top:8px;height:8px"><i style="width:${byLoc.okhla / tot * 100}%;--i:3"></i></div></div>
        <div><div class="row" style="justify-content:space-between;font-size:13px"><span>Gurgaon</span><span class="mono">${byLoc.gurgaon} active</span></div><div class="bar" style="margin-top:8px;height:8px"><i class="g" style="width:${byLoc.gurgaon / tot * 100}%;--i:5"></i></div></div></div></div>
      <div class="card flat rise" style="--i:8;padding:22px;flex:1"><div class="row" style="justify-content:space-between"><div style="font-weight:600;font-size:15px">Late right now</div><a href="#/tasks" class="mut" style="font-size:12.5px">View all</a></div>
      <div style="margin-top:10px">${(lateRows.data || []).map(t => `<a href="#/orders/${t.order_id}" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line2);text-decoration:none;color:inherit"><span class="mono mut">${t.so_no}</span><span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.party_name)}</span><span class="chip c-late">Step ${t.step_no}</span></a>`).join('') || '<div class="empty" style="padding:20px">Nothing late 🎁</div>'}</div></div>
    </div></div>
  <div class="card flat rise" style="--i:9;margin-top:16px"><div class="row" style="justify-content:space-between;padding:18px 22px"><div style="font-weight:600;font-size:15px">Latest orders</div><a href="#/orders" class="mut" style="font-size:12.5px">All orders →</a></div>
  <table><thead><tr><th>SO</th><th>Party</th><th>Location</th><th>Received</th><th>Status</th></tr></thead><tbody>${(recent.data || []).map((o, i) => `<tr style="--i:${i}" data-go="${o.id}"><td class="mono">${o.so_no}</td><td>${esc(o.party_name)}</td><td class="mut">${locName(o.location)}</td><td class="mut">${fmtDay(o.received_at)}</td><td>${chipStatus(o)}</td></tr>`).join('')}</tbody></table></div></div>`;
  v.querySelectorAll('[data-n]').forEach(el => countUp(el, +el.dataset.n));
  v.querySelectorAll('.pr').forEach(r => r.onclick = () => { S.status = 'active'; S.step = r.dataset.step; S.q = ''; S.trade = ''; S.page = 0; });
  v.querySelectorAll('tr[data-go]').forEach(r => r.onclick = () => location.hash = '#/orders/' + r.dataset.go);
}

// ---------- orders ----------
async function orders() {
  topbar('All orders', canNew() ? '<a class="btn" href="#/new" style="text-decoration:none">+ New order</a>' : '');
  const v = $('#view');
  const bq = await locFilter(sb.from('orders').select('brand')).limit(5000);
  const brands = [...new Set((bq.data || []).map(r => r.brand).filter(Boolean))].sort();
  v.innerHTML = `<div class="rise" style="--i:0"><h1 class="h1">All orders</h1><div class="sub" id="osub"></div></div>
  <div class="row rise" style="--i:1;margin:22px 0 14px;flex-wrap:wrap">
    <div class="seg2">${[['', 'All'], ['active', 'Active'], ['done', 'Done'], ['cancelled', 'Cancelled']].map(s => `<button data-st="${s[0]}" class="${S.status === s[0] ? 'on' : ''}">${s[1]}</button>`).join('')}</div>
    <select class="sel" id="fst"><option value="">Any step</option>${S.steps.map(s => `<option value="${s.step_no}" ${String(S.step) === String(s.step_no) ? 'selected' : ''}>${s.step_no}. ${esc(s.name)}</option>`).join('')}</select>
    <select class="sel" id="ft"><option value="">All trade types</option>${TRADES.map(t => `<option ${S.trade === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select class="sel" id="fbr"><option value="">All brands</option>${brands.map(b => `<option ${S.brand === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>
    <select class="sel" id="fgrn"><option value="">GRN: any</option><option value="1" ${S.grn === '1' ? 'selected' : ''}>GRN required</option><option value="0" ${S.grn === '0' ? 'selected' : ''}>No GRN</option></select>
    <label class="mut" style="font-size:12.5px;display:flex;align-items:center;gap:6px">From <input class="inp" id="ffrom" type="date" style="height:38px;width:150px" value="${S.from || ''}"></label>
    <label class="mut" style="font-size:12.5px;display:flex;align-items:center;gap:6px">To <input class="inp" id="fto" type="date" style="height:38px;width:150px" value="${S.to || ''}"></label>
    ${(S.status || S.step || S.trade || S.brand || S.grn || S.from || S.to || S.q) ? '<button class="btn sec" id="fclear" style="height:38px">Clear filters</button>' : ''}
    ${S.q ? `<span class="chip c-step" style="height:38px;padding:0 14px;cursor:pointer" id="clrq">Search: ${esc(S.q)} ✕</span>` : ''}
  </div><div class="card flat rise" style="--i:2" id="otable"><div class="empty">Loading…</div></div>`;
  v.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { S.status = b.dataset.st; S.page = 0; orders(); });
  $('#fst').onchange = e => { S.step = e.target.value; S.page = 0; orders(); };
  $('#ft').onchange = e => { S.trade = e.target.value; S.page = 0; orders(); };
  $('#fbr').onchange = e => { S.brand = e.target.value; S.page = 0; orders(); };
  $('#fgrn').onchange = e => { S.grn = e.target.value; S.page = 0; orders(); };
  $('#ffrom').onchange = e => { S.from = e.target.value; S.page = 0; orders(); };
  $('#fto').onchange = e => { S.to = e.target.value; S.page = 0; orders(); };
  if ($('#fclear')) $('#fclear').onclick = () => { S.status = S.step = S.trade = S.brand = S.grn = S.from = S.to = S.q = ''; S.page = 0; orders(); };
  if ($('#clrq')) $('#clrq').onclick = () => { S.q = ''; S.page = 0; orders(); };
  let q = locFilter(sb.from('orders').select('id,location,so_no,received_at,party_name,brand,trade_category,status,current_step,invoice_no,invoice_value', { count: 'exact' }));
  if (S.status) q = q.eq('status', S.status);
  if (S.step) q = q.eq('current_step', +S.step);
  if (S.trade) q = q.eq('trade_category', S.trade);
  if (S.brand) q = q.eq('brand', S.brand);
  if (S.grn) q = q.eq('grn_required', S.grn === '1');
  if (S.from) q = q.gte('received_at', new Date(S.from + 'T00:00:00+05:30').toISOString());
  if (S.to) q = q.lte('received_at', new Date(S.to + 'T23:59:59+05:30').toISOString());
  if (S.q) { const s = S.q.replace(/[%,()]/g, ' '); q = q.or(`party_name.ilike.%${s}%,invoice_no.ilike.%${s}%,po_number.ilike.%${s}%${/^\d+$/.test(s) ? ',so_no.eq.' + s : ''}`); }
  const { data, count: total, error } = await q.order('received_at', { ascending: false }).range(S.page * PAGE, S.page * PAGE + PAGE - 1);
  const box = $('#otable');
  if (error) { box.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  $('#osub').textContent = `${total ?? 0} orders · ${S.loc === 'all' ? 'both locations' : locName(S.loc)}`;
  box.innerHTML = `<table><thead><tr><th>SO</th><th>Received</th><th>Party</th><th>Brand</th><th>Trade</th><th>Invoice</th><th style="text-align:right">Value</th><th>Status</th></tr></thead><tbody>${(data || []).map((o, i) => `<tr style="--i:${i}" data-go="${o.id}"><td class="mono">${o.so_no}${S.loc === 'all' ? `<div class="mut" style="font-size:11px;font-family:Inter">${locName(o.location)}</div>` : ''}</td><td class="mut">${fmtDay(o.received_at)}</td><td style="font-weight:500">${esc(o.party_name)}</td><td class="mut">${esc(o.brand || '—')}</td><td class="mut">${esc(o.trade_category || '—')}</td><td class="mono">${esc(o.invoice_no || '—')}</td><td class="mono" style="text-align:right">${money(o.invoice_value)}</td><td>${chipStatus(o)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No orders match</td></tr>'}</tbody></table>
  <div class="row" style="justify-content:space-between;padding:14px 18px;color:var(--mute);font-size:13px"><span>Page ${S.page + 1} of ${Math.max(1, Math.ceil((total ?? 0) / PAGE))}</span><span class="row"><button class="btn sec" style="height:32px" id="pp" ${S.page === 0 ? 'disabled' : ''}>Prev</button><button class="btn sec" style="height:32px" id="pn" ${(S.page + 1) * PAGE >= (total ?? 0) ? 'disabled' : ''}>Next</button></span></div>`;
  box.querySelectorAll('tr[data-go]').forEach(r => r.onclick = () => location.hash = '#/orders/' + r.dataset.go);
  $('#pp').onclick = () => { S.page--; orders(); }; $('#pn').onclick = () => { S.page++; orders(); };
}

// ---------- order detail ----------
const canDo = (loc, step) => S.me.role === 'admin' || (S.me.role === 'staff' && S.me.locations.includes(loc) && S.me.steps.includes(step));
async function detail(id) {
  const v = $('#view');
  const [o, st, docs, ev] = await Promise.all([
    sb.from('orders').select('*').eq('id', id).single(),
    sb.from('order_steps').select('*').eq('order_id', id).order('step_no'),
    sb.from('documents').select('*').eq('order_id', id).order('created_at'),
    sb.from('order_events').select('*').eq('order_id', id).order('at', { ascending: false }).limit(8)
  ]);
  if (o.error) { topbar('Order'); v.innerHTML = `<div class="empty">${esc(o.error.message)}</div>`; return; }
  const ord = o.data, steps = st.data || [], dl = docs.data || [], log = ev.data || [];
  topbar(`<a href="#/orders" style="color:inherit;text-decoration:none">All orders</a> / <b>SO ${ord.so_no}</b>`);
  const reqDone = steps.filter(s => s.required && ['done', 'inferred'].includes(s.state)).length, reqAll = steps.filter(s => s.required).length;
  const cur = steps.find(s => s.step_no === ord.current_step && ord.status === 'active');
  v.innerHTML = `
  <div class="row rise" style="--i:0;justify-content:space-between;align-items:flex-end"><div><div class="mono mut">${locName(ord.location)} · SO ${ord.so_no}${ord.po_number ? ' · PO ' + esc(ord.po_number) : ''}</div><h1 class="h1" style="margin-top:6px">${esc(ord.party_name)}</h1></div><span class="row" style="font-size:13px">${chipStatus(ord)}${ord.status === 'active' && canDo(ord.location, 1) ? '<button class="btn sec" id="cancelOrder" style="height:32px;color:var(--red)">Cancel order</button>' : ''}</span></div>
  <div class="grid" style="grid-template-columns:minmax(0,300px) minmax(0,1fr) minmax(0,300px);margin-top:24px;align-items:start">
  <div style="display:flex;flex-direction:column;gap:16px">
    <div class="card flat rise" style="--i:1;padding:20px"><div style="font-weight:600;margin-bottom:14px">Order</div><dl class="kv" style="margin:0"><dt>Brand</dt><dd>${esc(ord.brand || '—')}</dd><dt>Trade</dt><dd>${esc(ord.trade_category || '—')}</dd><dt>PO received</dt><dd>${fmtDate(ord.received_at)}</dd><dt>Received via</dt><dd>${esc(ord.order_channel || '—')}</dd><dt>Party location</dt><dd>${esc(ord.party_location || '—')}</dd><dt>Invoice</dt><dd class="mono">${esc(ord.invoice_no || '—')}</dd><dt>Value</dt><dd class="mono">${money(ord.invoice_value)}</dd><dt>GRN needed</dt><dd>${ord.grn_required ? 'Yes' : 'No'}${ord.is_d2c ? ' · D2C' : ''}</dd><dt>Delivery TAT</dt><dd>${ord.delivery_days ?? '—'} day(s)</dd></dl></div>
    <div class="card flat rise" style="--i:2;padding:20px"><div class="row" style="justify-content:space-between;margin-bottom:12px"><b style="font-weight:600">Documents</b><span class="kbd">Google Drive</span></div>
    ${dl.map(d => `<a href="${esc(d.drive_url)}" target="_blank" rel="noopener" class="row" style="padding:9px 10px;border:1px solid var(--line);border-radius:10px;margin-bottom:8px;text-decoration:none;color:var(--ink);font-size:13px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6"></path></svg>${esc(d.kind.replace(/_/g, ' '))}<span style="margin-left:auto;color:var(--mute)">↗</span></a>`).join('') || '<div class="mut" style="font-size:13px">No documents yet.</div>'}</div></div>
  <div class="card flat rise" style="--i:2;padding:24px 26px"><div class="row" style="justify-content:space-between;margin-bottom:20px"><div style="font-weight:600;font-size:15px">Progress</div><span class="mut" style="font-size:12.5px">${reqDone} of ${reqAll} required steps done</span></div>
  ${steps.map((s, i) => stepHtml(ord, s, dl, i)).join('')}</div>
  <div style="display:flex;flex-direction:column;gap:16px">
    <div class="card flat rise" style="--i:3;padding:20px"><div style="font-weight:600;margin-bottom:6px">Timing</div>
      <div class="row" style="justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line2)"><span class="mut">Current step</span><span>${cur ? esc(stepName(cur.step_no)) : '—'}</span></div>
      <div class="row" style="justify-content:space-between;padding:10px 0"><span class="mut">Planned</span><span class="mono">${cur ? fmtDate(cur.planned_at) : '—'}</span></div>
      ${cur && cur.planned_at ? `<div class="row" style="justify-content:space-between;font-size:12.5px"><span class="mut">Status</span><span class="chip ${new Date(cur.planned_at) < new Date() ? 'c-late' : 'c-done'}">${rel(cur.planned_at)}</span></div>` : ''}</div>
    <div class="card flat rise" style="--i:4;padding:20px"><div style="font-weight:600;margin-bottom:4px">Activity</div>${log.map((l, i) => `<div class="lgi" style="--i:${i}"><span class="pdot" style="margin-top:6px;flex:none;background:${l.action === 'created' ? '#c8102e' : '#0f7b4a'};animation:none"></span><div><div>${l.action === 'created' ? 'Order created' : l.action === 'cancelled' ? 'Order cancelled' : 'Step ' + l.step_no + ' done'}</div><div class="mut" style="font-size:12px">${fmtDate(l.at)}</div></div></div>`).join('') || '<div class="mut" style="font-size:13px;padding-top:8px">No activity logged yet.</div>'}</div>
  </div></div>`;
  v.insertAdjacentHTML('beforeend', stepTable(ord, steps));
  const btn = v.querySelector('[data-done]');
  if (btn) btn.onclick = () => completeStep(ord, +btn.dataset.done, btn);
  const cb = $('#cancelOrder');
  if (cb) cb.onclick = async () => {
    if (!confirm('Cancel SO ' + ord.so_no + ' for ' + ord.party_name + '? This cannot be undone.')) return;
    const reason = prompt('Reason for cancelling (optional):') || '';
    const { error } = await sb.rpc('cancel_order', { p_order: ord.id, p_reason: reason });
    if (error) return toast(error.message);
    toast('Order cancelled'); detail(ord.id);
  };
}
function stepTable(ord, steps) {
  const now = Date.now();
  const rows = steps.map((s, i) => {
    const p = s.planned_at ? new Date(s.planned_at).getTime() : null, a = s.actual_at ? new Date(s.actual_at).getTime() : null;
    let res = '<span class="mut">—</span>';
    if (s.state === 'not_required') res = '<span class="mut">Not required</span>';
    else if (s.state === 'inferred') res = '<span class="chip c-done">Done (old sheet)</span>';
    else if (s.state === 'done') res = p && a ? (a <= p ? `<span class="chip c-done">On time</span>` : `<span class="chip c-late">Late ${dur(a - p)}</span>`) : '<span class="chip c-done">Done</span>';
    else if (p) res = p < now ? `<span class="chip c-late">Late ${dur(now - p)}</span>` : `<span class="chip c-act">Due in ${dur(p - now)}</span>`;
    else res = '<span class="chip c-step">Not planned</span>';
    const who = s.state === 'done' && s.done_by_name ? `${esc(ownerOf(ord.location, s.step_no))}<div class="mut" style="font-size:11.5px">done by ${esc(s.done_by_name)}</div>` : esc(ownerOf(ord.location, s.step_no));
    return `<tr style="--i:${i}${s.state === 'not_required' ? ';opacity:.5' : ''}"><td class="mono">${s.step_no}</td><td style="font-weight:500">${esc(stepName(s.step_no))}</td><td>${who}</td><td class="mono">${fmtDate(s.planned_at)}</td><td class="mono">${s.state === 'done' || s.state === 'inferred' ? fmtDate(s.actual_at) : '—'}</td><td>${res}</td></tr>`;
  }).join('');
  return `<div class="card flat rise" style="--i:5;margin-top:16px"><div style="padding:18px 22px;font-weight:600;font-size:15px">Step timeline <span class="mut" style="font-weight:400;font-size:12.5px">· who, planned time, actual time</span></div><table><thead><tr><th>#</th><th>Step</th><th>Owner</th><th>Planned</th><th>Actual</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function stepHtml(ord, s, dl, i) {
  const isCur = ord.status === 'active' && ord.current_step === s.step_no && s.state === 'pending';
  const cls = isCur ? 'cur' : (s.state === 'pending' || s.state === 'not_required') ? 'todo' : '';
  const data = Object.entries(s.data || {}).filter(([, x]) => x !== '' && x != null && x !== false);
  const _p = s.planned_at ? new Date(s.planned_at).getTime() : null, _a = s.actual_at ? new Date(s.actual_at).getTime() : null;
  const _res = s.state === 'done' && _p && _a ? (_a <= _p ? ' <span class="chip c-done">On time</span>' : ` <span class="chip c-late">Late ${dur(_a - _p)}</span>`) : (s.state === 'pending' && _p ? (_p < Date.now() ? ` <span class="chip c-late">Late ${dur(Date.now() - _p)}</span>` : ` <span class="chip c-act">Due in ${dur(_p - Date.now())}</span>`) : '');
  const meta = s.state === 'not_required' ? 'Not required for this order' : `<div style="text-align:right;line-height:1.7"><div><span class="mut">Who</span> <b style="font-weight:600">${esc(ownerOf(ord.location, s.step_no))}</b></div><div><span class="mut">Planned</span> ${s.planned_at ? fmtDate(s.planned_at) : 'not set'}</div><div><span class="mut">${s.state === 'pending' ? 'Not done yet' : 'Done'}</span>${s.state !== 'pending' ? ' ' + (s.actual_at ? fmtDate(s.actual_at) : '—') + (s.done_by_name ? ' · by <b style="font-weight:600">' + esc(s.done_by_name) + '</b>' : s.state === 'inferred' ? ' · old sheet' : '') : ''}${_res}</div></div>`;
  let form = '';
  if (isCur && canDo(ord.location, s.step_no) && STEP_FIELDS[s.step_no]) {
    form = `<div class="card beam flat" style="margin-top:12px;padding:16px;border-radius:14px;overflow:visible"><div class="grid" style="gap:12px" id="f${s.step_no}">${STEP_FIELDS[s.step_no].map(([k, l, t]) => t === 'check' ? `<label class="row" style="font-size:13px"><input type="checkbox" data-k="${k}" style="width:auto;height:auto"> ${l}</label>` : `<label class="f">${l}<input class="inp" data-k="${k}" type="${t || 'text'}" ${k === 'drive_url' ? 'placeholder="https://drive.google.com/open?id=…"' : ''}></label>`).join('')}
    <div class="row" style="justify-content:flex-end"><button class="btn red" data-done="${s.step_no}">Mark step ${s.step_no} done →</button></div></div></div>`;
  } else if (isCur) form = '<div class="mut" style="font-size:12.5px;margin-top:6px">Waiting on the step owner.</div>';
  return `<div class="st ${cls}" style="--i:${i}"><div class="dot">${['done', 'inferred'].includes(s.state) ? '✓' : s.state === 'not_required' ? '–' : s.step_no}</div><div>
  <div class="row" style="justify-content:space-between;align-items:flex-start"><b style="font-weight:600">${esc(stepName(s.step_no))}</b><span style="font-size:12.5px">${meta}</span></div>
  ${data.length ? `<div class="row" style="margin-top:7px;flex-wrap:wrap;gap:6px">${data.map(([k, x]) => `<span class="tag">${esc(k.replace(/_/g, ' '))}: ${esc(x === true ? 'yes' : x)}</span>`).join('')}</div>` : ''}${form}</div></div>`;
}
async function completeStep(ord, n, btn) {
  const data = {}; let driveUrl = '';
  document.querySelectorAll(`#f${n} [data-k]`).forEach(i => {
    if (i.type === 'checkbox') { if (i.checked) data[i.dataset.k] = true; return; }
    const val = i.value.trim(); if (val === '') return;
    if (i.dataset.k === 'drive_url') { driveUrl = val; return; }
    data[i.dataset.k] = i.type === 'number' ? Number(val) : val;
  });
  if (n === 2 && !data.invoice_no) return toast('Enter the invoice number first');
  btn.disabled = true;
  const { error } = await sb.rpc('complete_step', { p_order: ord.id, p_step: n, p_data: data });
  if (error) { btn.disabled = false; return toast(error.message); }
  if (driveUrl) { const m = driveUrl.match(/[-\w]{25,}/); await sb.from('documents').insert({ order_id: ord.id, step_no: n, kind: 'receiving_copy', drive_url: driveUrl, drive_file_id: m ? m[0] : null }); }
  toast('Step ' + n + ' done ✓'); detail(ord.id);
}

// ---------- my tasks ----------
async function tasks() {
  topbar('My tasks');
  const v = $('#view');
  const mine = S.me.role === 'admin' ? [2, 3, 4, 5, 6, 7, 8, 9, 10] : S.me.steps.filter(x => x > 1);
  if (!mine.length) { v.innerHTML = '<div class="empty">No steps are assigned to you yet.</div>'; return; }
  if (!mine.includes(S.taskStep)) S.taskStep = mine[0];
  const { data: pipe } = await sb.from('v_pipeline').select('*');
  const cnt = {}; (pipe || []).forEach(r => { if (S.loc === 'all' || r.location === S.loc) cnt[r.step_no] = (cnt[r.step_no] || 0) + r.orders; });
  v.innerHTML = `<div class="rise" style="--i:0"><h1 class="h1">My tasks</h1><div class="sub">What is waiting for you, oldest planned time first.</div></div>
  <div class="row rise" style="--i:1;margin:22px 0 14px;flex-wrap:wrap;gap:6px">${mine.map(k => `<button class="tab ${k === S.taskStep ? 'on' : ''}" data-s="${k}">${k} · ${esc(stepName(k))}<span class="tc">${cnt[k] || 0}</span></button>`).join('')}</div>
  <div class="row rise" style="--i:2;margin-bottom:12px;flex-wrap:wrap"><input class="inp" id="tq" placeholder="Search SO or party…" value="${esc(S.tq || '')}" style="max-width:240px;height:38px"><select class="sel" id="ttr"><option value="">All trade types</option>${TRADES.map(t => `<option ${S.ttr === t ? 'selected' : ''}>${t}</option>`).join('')}</select><div class="seg2"><button data-late="" class="${!S.lateOnly ? 'on' : ''}">All</button><button data-late="1" class="${S.lateOnly ? 'on' : ''}">Late only</button></div></div>
  <div class="card flat rise" style="--i:3" id="tlist"><div class="empty">Loading…</div></div>`;
  $('#tq').onkeydown = e => { if (e.key === 'Enter') { S.tq = e.target.value.trim(); tasks(); } };
  $('#ttr').onchange = e => { S.ttr = e.target.value; tasks(); };
  v.querySelectorAll('[data-late]').forEach(b => b.onclick = () => { S.lateOnly = b.dataset.late === '1'; tasks(); });
  v.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { S.taskStep = +b.dataset.s; tasks(); });
  let tq = locFilter(sb.from('v_tasks').select('*').eq('step_no', S.taskStep));
  if (S.lateOnly) tq = tq.eq('is_late', true);
  if (S.ttr) tq = tq.eq('trade_category', S.ttr);
  if (S.tq) { const t = S.tq.replace(/[%,()]/g, ' '); tq = tq.or(`party_name.ilike.%${t}%${/^\d+$/.test(t) ? ',so_no.eq.' + t : ''}`); }
  const { data, error } = await tq.order('planned_at', { nullsFirst: false }).limit(100);
  const box = $('#tlist');
  if (error) { box.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  box.innerHTML = `<div class="tk" style="padding:11px 22px;background:var(--bg2);border-bottom:1px solid var(--line);animation:none;font:500 12px Inter;color:var(--mute)"><span>SO</span><span>Party</span><span>Brand / trade</span><span>Planned</span><span></span></div>${(data || []).map((r, i) => `<div class="tk" style="--i:${i}"><span class="mono">${r.so_no}</span><div><div style="font-weight:500">${esc(r.party_name)}</div><div class="mut" style="font-size:12px">${locName(r.location)}</div></div><span class="mut">${esc(r.brand || '—')} · ${esc(r.trade_category || '—')}</span><span class="chip ${r.is_late ? 'c-late' : r.planned_at ? 'c-act' : 'c-step'}">${r.planned_at ? rel(r.planned_at) : 'not planned'}</span><span class="row" style="justify-content:flex-end"><a class="btn" href="#/orders/${r.order_id}" style="text-decoration:none;height:34px">Open</a></span></div>`).join('') || '<div class="empty">🎁 Nothing waiting for this step.</div>'}`;
}

// ---------- new order ----------
function newOrder() {
  topbar('New order');
  const v = $('#view');
  if (!canNew()) { v.innerHTML = '<div class="empty">You do not have access to create orders.</div>'; return; }
  const locs = S.locs; let loc = S.loc === 'all' ? locs[0] : S.loc, trade = 0;
  v.innerHTML = `<div class="rise" style="--i:0"><h1 class="h1">New order</h1><div class="sub">Enter the PO once. The app creates all 10 steps for you.</div></div>
  <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,340px);margin-top:24px;align-items:start">
  <div class="card flat rise" style="--i:1;padding:26px"><div class="grid" style="gap:20px">
    <div><div class="mut" style="font-size:12.5px;font-weight:500;margin-bottom:8px">Location</div><div class="tg" id="nloc">${locs.map(l => `<button data-l="${l}" class="${l === loc ? 'on' : ''}">${locName(l)}</button>`).join('')}</div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px"><label class="f">SO number (from Tally)<input class="inp mono" id="n_so" type="number" placeholder="e.g. 88150"></label><label class="f">PO received at<input class="inp" id="n_at" type="datetime-local"></label><label class="f">Party / store name<input class="inp" id="n_party"></label><label class="f">Brand<input class="inp" id="n_brand" placeholder="Dairy / Ice cream"></label><label class="f">PO number<input class="inp mono" id="n_po"></label><label class="f">Party location<input class="inp" id="n_loc"></label></div>
    <div><div class="mut" style="font-size:12.5px;font-weight:500;margin-bottom:8px">Order received via</div><div class="tg" id="nchan">${CHANNELS.map((c, i) => `<button data-c="${i}" class="${i === 0 ? 'on' : ''}">${c}</button>`).join('')}</div></div>
    <div><div class="mut" style="font-size:12.5px;font-weight:500;margin-bottom:8px">Trade category</div><div class="tg" id="ntrade">${TRADES.map((t, i) => `<button data-t="${i}" class="${i === trade ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:16px"><label class="f">Delivery days<input class="inp" id="n_days" type="number" value="1" step="0.5"></label><label class="f">GRN required<select class="inp" id="n_grn"><option value="0">No</option><option value="1">Yes</option></select></label><label class="f">D2C order<select class="inp" id="n_d2c"><option value="0">No</option><option value="1">Yes</option></select></label></div>
    <div class="err" id="nerr"></div>
    <div class="row" style="justify-content:flex-end"><a class="btn sec" href="#/orders" style="text-decoration:none">Cancel</a><button class="btn red" id="ncreate">Create order →</button></div></div></div>
  <div class="card beam flat rise" style="--i:2;padding:22px;border-radius:14px;overflow:visible"><div style="font-weight:600">What happens next</div><div class="ink2" style="font-size:13px;line-height:1.7;margin-top:8px">1. Enter the SO number from Tally (the next free number is filled in for you).<br>2. All 10 steps are created and step 1 is marked done.<br>3. The invoice owner sees it in My tasks.</div></div></div>`;
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset()); $('#n_at').value = now.toISOString().slice(0, 16);
  let chan = 0;
  async function suggestSO() { const { data } = await sb.from('orders').select('so_no').eq('location', loc).order('so_no', { ascending: false }).limit(1); $('#n_so').value = data && data[0] ? Number(data[0].so_no) + 1 : ''; }
  suggestSO();
  $('#nchan').onclick = e => { const b = e.target.closest('button'); if (!b) return; chan = +b.dataset.c; $('#nchan').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#nloc').onclick = e => { const b = e.target.closest('button'); if (!b) return; loc = b.dataset.l; $('#nloc').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); suggestSO(); };
  $('#ntrade').onclick = e => { const b = e.target.closest('button'); if (!b) return; trade = +b.dataset.t; $('#ntrade').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
  $('#ncreate').onclick = async () => {
    $('#nerr').textContent = ''; const btn = $('#ncreate'); btn.disabled = true;
    const { data, error } = await sb.rpc('create_order', { p_location: loc, p_so_no: +$('#n_so').value || null, p_channel: CHANNELS[chan], p_received_at: $('#n_at').value ? new Date($('#n_at').value).toISOString() : null, p_party: $('#n_party').value, p_brand: $('#n_brand').value, p_party_location: $('#n_loc').value, p_po: $('#n_po').value, p_trade: TRADES[trade], p_grn: $('#n_grn').value === '1', p_days: +$('#n_days').value || null, p_d2c: $('#n_d2c').value === '1' });
    if (error) { btn.disabled = false; $('#nerr').textContent = error.message; return; }
    toast('Order created ✓'); location.hash = '#/orders/' + data;
  };
}

// ---------- returns & GRN ----------
async function returns() {
  topbar('Returns & GRN');
  const v = $('#view');
  let rq = locFilter(sb.from('v_tasks').select('*').in('step_no', [6, 7, 8]));
  if (S.lateOnly) rq = rq.eq('is_late', true);
  if (S.rq) { const t = S.rq.replace(/[%,()]/g, ' '); rq = rq.or(`party_name.ilike.%${t}%${/^\d+$/.test(t) ? ',so_no.eq.' + t : ''}`); }
  const { data, error } = await rq.order('planned_at', { nullsFirst: false }).limit(300);
  if (error) { v.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  const cols = [[6, 'Credit note'], [7, 'GRN pending'], [8, 'Credit note email']];
  v.innerHTML = `<div class="rise" style="--i:0"><h1 class="h1">Returns &amp; GRN</h1><div class="sub">Credit notes, GRN follow-ups and credit note emails in one board.</div></div>
  <div class="row rise" style="--i:1;margin:18px 0 0;flex-wrap:wrap"><input class="inp" id="rq" placeholder="Search SO or party…" value="${esc(S.rq || '')}" style="max-width:240px;height:38px"><div class="seg2"><button data-rl="" class="${!S.lateOnly ? 'on' : ''}">All</button><button data-rl="1" class="${S.lateOnly ? 'on' : ''}">Late only</button></div></div>
  <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:26px;align-items:start">${cols.map(([n, t], ci) => { const rows = (data || []).filter(r => r.step_no === n); return `<div class="col rise" style="--i:${ci + 1}"><div class="row" style="justify-content:space-between;padding:4px"><b style="font-weight:600">${t}<span class="tc">${rows.length}</span></b><span class="mut" style="font-size:12px">Step ${n}</span></div>${rows.slice(0, 12).map((r, i) => `<a class="cd" href="#/orders/${r.order_id}" style="--i:${i}"><div class="row" style="justify-content:space-between"><span class="mono mut">${r.so_no}</span><span class="chip ${r.is_late ? 'c-late' : r.planned_at ? 'c-act' : 'c-step'}">${r.planned_at ? rel(r.planned_at) : 'not planned'}</span></div><b style="font-weight:600">${esc(r.party_name)}</b><div class="mut" style="font-size:12.5px">${locName(r.location)} · ${esc(r.brand || '')}</div></a>`).join('') || '<div class="empty" style="padding:24px">Nothing here 🎁</div>'}${rows.length > 12 ? `<div class="mut" style="text-align:center;font-size:12.5px">+ ${rows.length - 12} more</div>` : ''}</div>`; }).join('')}</div>`;
  $('#rq').onkeydown = e => { if (e.key === 'Enter') { S.rq = e.target.value.trim(); returns(); } };
  v.querySelectorAll('[data-rl]').forEach(b => b.onclick = () => { S.lateOnly = b.dataset.rl === '1'; returns(); });
}

// ---------- reports ----------
async function reports() {
  topbar('Reports');
  const v = $('#view');
  const [late, done] = await Promise.all([
    locFilter(sb.from('v_tasks').select('step_no,is_late,location')).limit(2000),
    sb.from('order_steps').select('planned_at,actual_at,done_by_name,step_no').eq('state', 'done').not('planned_at', 'is', null).not('actual_at', 'is', null).limit(5000)
  ]);
  const byStep = {}; (late.data || []).filter(r => r.is_late).forEach(r => byStep[r.step_no] = (byStep[r.step_no] || 0) + 1);
  const totalLate = Object.values(byStep).reduce((a, b) => a + b, 0), mx = Math.max(1, ...Object.values(byStep));
  const d = done.data || [], ok = d.filter(r => new Date(r.actual_at) <= new Date(r.planned_at)).length;
  const pct = d.length ? Math.round(ok / d.length * 100) : 0;
  const per = {}; d.forEach(r => { const k = r.done_by_name; if (!k) return; per[k] = per[k] || { done: 0, ok: 0 }; per[k].done++; if (new Date(r.actual_at) <= new Date(r.planned_at)) per[k].ok++; });
  const people = Object.entries(per).sort((a, b) => b[1].done - a[1].done).slice(0, 10);
  v.innerHTML = `<div class="rise" style="--i:0"><h1 class="h1">Reports</h1><div class="sub">Where time is lost, and who is on time.</div></div>
  <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);margin-top:24px">
  <div class="card flat rise" style="--i:1;padding:22px"><div style="font-weight:600;font-size:15px">Late tasks by step</div><div class="mut" style="font-size:12.5px;margin-top:2px">${totalLate} late right now</div>
  <div class="cols">${[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n, i) => `<div class="cl"><span class="mono" style="font-size:12px">${byStep[n] || 0}</span><div class="cb" style="height:${Math.max(byStep[n] ? 4 : 1, (byStep[n] || 0) / mx * 100)}%;--i:${i}"></div><span class="mut" style="font-size:12px">Step ${n}</span></div>`).join('')}</div></div>
  <div class="card flat rise" style="--i:2;padding:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px"><div style="font-weight:600;font-size:15px;align-self:flex-start">On-time rate</div><div class="ring" style="--p:${pct}"><div><span class="serif" style="font-size:44px">${pct}%</span></div></div><div class="mut" style="font-size:12.5px;text-align:center">Steps finished before the planned time (${d.length} checked)</div></div></div>
  <div class="card flat rise" style="--i:3;margin-top:16px"><div style="padding:18px 22px;font-weight:600;font-size:15px">By person</div>
  <table><thead><tr><th>Person</th><th style="text-align:right">Done</th><th>On time</th></tr></thead><tbody>${people.map(([n, p], i) => `<tr style="--i:${i}"><td style="font-weight:500">${esc(n)}</td><td class="mono" style="text-align:right">${p.done}</td><td style="width:260px"><div class="row"><div class="bar" style="flex:1"><i class="g" style="width:${Math.round(p.ok / p.done * 100)}%;--i:${i}"></i></div><span class="mono">${Math.round(p.ok / p.done * 100)}%</span></div></td></tr>`).join('') || '<tr><td colspan="3" class="empty">Person-wise numbers appear as your team completes steps in the app.</td></tr>'}</tbody></table></div>`;
}

// ---------- admin ----------
async function admin() {
  topbar('Admin');
  const v = $('#view');
  const [u, hol] = await Promise.all([sb.from('app_users').select('*').order('full_name'), sb.from('holidays').select('*').order('day')]);
  const users = u.data || [], hols = hol.data || [];
  const T = S.adminTab;
  let body = '';
  if (T === 'users') body = `<table><thead><tr><th>Person</th><th>Role</th><th>Locations</th><th>Steps they complete</th><th>Active</th></tr></thead><tbody>${users.map((x, i) => `<tr style="--i:${i}"><td><div class="row"><span class="av" style="background:#52525b">${esc(x.full_name[0])}</span><div><div style="font-weight:500">${esc(x.full_name)}</div><div class="mut" style="font-size:12px">${esc(x.emp_id || '')}</div></div></div></td><td><span class="chip c-step">${x.role}</span></td><td class="mut">${(x.locations || []).map(locName).join(', ') || '—'}</td><td>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<span class="sp ${(x.steps || []).includes(n) ? 'on' : ''}">${n}</span>`).join('')}</td><td><button class="sw ${x.active ? 'on' : ''}" data-u="${x.user_id}" data-a="${x.active}" aria-label="Active"></button></td></tr>`).join('')}</tbody></table><div class="mut" style="padding:14px 22px;font-size:12.5px">To add a person: create the login in Supabase (Authentication → Users), then add their row in the app_users table.</div>`;
  else if (T === 'cfg') body = `<table><thead><tr><th>Step</th><th>Location</th><th>Owner</th><th>TAT</th><th>Rule</th><th>Confirmed</th></tr></thead><tbody>${S.cfg.map((c, i) => `<tr style="--i:${i}"><td style="font-weight:500">${c.step_no} · ${esc(stepName(c.step_no))}</td><td class="mut">${locName(c.location)}</td><td class="mut">${esc(c.owner_label)}</td><td class="mono">${c.tat_value ?? '—'} ${esc(c.tat_kind)}</td><td class="mut" style="font-size:12.5px;white-space:normal;max-width:280px">${esc(c.rule || '—')}</td><td><span class="chip ${c.confirmed ? 'c-done' : 'c-act'}">${c.confirmed ? 'Confirmed' : 'Please confirm'}</span></td></tr>`).join('')}</tbody></table>`;
  else body = `<div class="row" style="padding:16px 22px;gap:10px"><input class="inp" id="hd" type="date" style="max-width:180px"><input class="inp" id="hn" placeholder="Holiday name" style="max-width:260px"><button class="btn" id="hadd">Add holiday</button></div><table><thead><tr><th>Date</th><th>Holiday</th><th></th></tr></thead><tbody>${hols.slice(-40).reverse().map((h, i) => `<tr style="--i:${i}"><td class="mono">${h.day}</td><td>${esc(h.name || '—')}</td><td style="text-align:right"><button class="btn sec" style="height:30px" data-hd="${h.day}">Remove</button></td></tr>`).join('')}</tbody></table>`;
  v.innerHTML = `<div class="rise" style="--i:0"><h1 class="h1">Admin</h1><div class="sub">Users, who does which step, turnaround times and holidays.</div></div>
  <div class="row rise" style="--i:1;margin:22px 0 14px;gap:6px">${[['users', 'Users'], ['cfg', 'Step owners & TAT'], ['hol', 'Holidays']].map(t => `<button class="tab ${T === t[0] ? 'on' : ''}" data-t="${t[0]}">${t[1]}</button>`).join('')}</div>
  <div class="card flat rise" style="--i:2">${body}</div>`;
  v.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { S.adminTab = b.dataset.t; admin(); });
  v.querySelectorAll('[data-u]').forEach(b => b.onclick = async () => { if (b.dataset.u === S.user.id) return toast('You cannot switch off your own account'); const { error } = await sb.from('app_users').update({ active: b.dataset.a !== 'true' }).eq('user_id', b.dataset.u); if (error) toast(error.message); admin(); });
  if ($('#hadd')) $('#hadd').onclick = async () => { const d = $('#hd').value; if (!d) return toast('Pick a date'); const { error } = await sb.from('holidays').upsert({ day: d, name: $('#hn').value.trim() || null }); if (error) toast(error.message); admin(); };
  v.querySelectorAll('[data-hd]').forEach(b => b.onclick = async () => { await sb.from('holidays').delete().eq('day', b.dataset.hd); admin(); });
}

$('#noaccessOut').onclick = out;
boot();
})();
