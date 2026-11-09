/* 타오바오 배송 자동 확인 — 백그라운드
   정해진 간격(기본 3시간)마다 한 번 깨어나서
   1) 정산 사이트(수파베이스)에서 아직 안 받은 주문 목록을 읽고
   2) 타오바오에 그 주문들의 물류 기록을 천천히 하나씩 물어본 뒤
   3) 결과를 정산 사이트에 저장하고 다시 잠들어요. */
const DEF = { site: 'https://taobao-settle.vercel.app', every: 180 };
const TABLE = 'tb_docs', SCHEMA = 'money';
const MAX_PER_RUN = 60, GAP_MS = 450, NEW_ORDER_DAYS = 45;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 인터넷 요청: 연결 자체가 끊기면(Failed to fetch) 3초 뒤 한 번 더 시도하고, 그래도 안 되면 어느 단계인지 알려줌
async function net(label, url, opt) {
  for (let i = 0; i < 2; i++) {
    try { return await fetch(url, opt); }
    catch (e) { if (i) { const er = new Error(label + ' 연결 실패 (' + (e.message || e) + ')'); er.net = true; throw er; } await sleep(3000); }
  }
}
const get = keys => chrome.storage.local.get(keys);
const set = obj => chrome.storage.local.set(obj);

/* ---------- 설정 · 알람 ---------- */
async function settings() { const s = await get(['site', 'every']); return { site: s.site || DEF.site, every: s.every || DEF.every }; }
async function schedule() {
  const { every } = await settings();
  const a = await chrome.alarms.get('check');
  if (!a || a.periodInMinutes !== every) await chrome.alarms.create('check', { delayInMinutes: a ? every : 1, periodInMinutes: every });
}
chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'check') run('auto'); });

/* ---------- 정산 사이트 설정 읽기 (config.js) ---------- */
async function siteConfig() {
  const { site } = await settings();
  const t = await (await net('정산 사이트(' + site + ') 설정 읽기', site.replace(/\/+$/, '') + '/config.js', { cache: 'no-store' })).text();
  const url = (t.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/) || [])[1];
  const key = (t.match(/SUPABASE_ANON_KEY\s*:\s*['"]([^'"]+)['"]/) || [])[1];
  if (!url || !key) throw new Error('정산 사이트 설정(config.js)을 읽지 못했어요.');
  return { url: url.replace(/\/+$/, ''), key };
}

/* ---------- 로그인 (비밀번호는 저장하지 않고 토큰만 보관) ---------- */
async function login(email, password) {
  const c = await siteConfig();
  const r = await net('정산 사이트 로그인', c.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.msg || j.message || '로그인하지 못했어요.');
  await set({ auth: { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email } });
  await schedule();
  return email;
}
async function token(c) {
  const { auth } = await get('auth');
  if (!auth) throw new Error('NEED_LOGIN');
  if (auth.exp - 60000 > Date.now()) return auth.access;
  const r = await net('정산 사이트 로그인 연장', c.url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: c.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: auth.refresh }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { await chrome.storage.local.remove('auth'); throw new Error('NEED_LOGIN'); }
  await set({ auth: { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: auth.email } });
  return j.access_token;
}
async function rest(c, path, opt = {}) {
  const t = await token(c);
  const r = await net(opt.method === 'POST' ? '정산 사이트에 저장' : '정산 사이트에서 주문 읽기', c.url + '/rest/v1/' + path, {
    method: opt.method || 'GET',
    headers: Object.assign({ apikey: c.key, Authorization: 'Bearer ' + t, 'Accept-Profile': SCHEMA, 'Content-Profile': SCHEMA, 'Content-Type': 'application/json' }, opt.headers || {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  if (r.status === 401) { await chrome.storage.local.remove('auth'); throw new Error('NEED_LOGIN'); }
  if (!r.ok) throw new Error('정산 사이트 저장소 오류 (' + r.status + ')');
  return r.status === 204 || opt.method === 'POST' ? null : r.json();
}

/* ---------- 타오바오 물류 조회 ---------- */
function parseTb(buf) {
  const j = JSON.parse(new TextDecoder('gbk').decode(buf));
  return { ex: j.expressName || '', no: j.expressId || '', st: (j.address || []).map(a => ({ t: a.time, p: a.place })) };
}
// 1순위: 백그라운드에서 바로 조회 (웨일의 타오바오 로그인 쿠키 사용)
async function tbDirect(id) {
  const r = await fetch('https://buyertrade.taobao.com/trade/json/transit_step.do?bizOrderId=' + id, { method: 'POST', credentials: 'include' });
  return parseTb(await r.arrayBuffer());  // 로그인 안 돼 있으면 JSON이 아니라서 여기서 실패
}
// 2순위: 열려 있는 타오바오 주문 화면 안에서 조회
async function tbTab(ids) {
  const tabs = await chrome.tabs.query({ url: 'https://buyertrade.taobao.com/*' });
  if (!tabs.length) return null;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id }, world: 'MAIN', args: [ids, GAP_MS],
    func: async (ids, gap) => {
      const out = {};
      for (const id of ids) {
        try {
          const r = await fetch('/trade/json/transit_step.do?bizOrderId=' + id, { method: 'POST', credentials: 'include' });
          const j = JSON.parse(new TextDecoder('gbk').decode(await r.arrayBuffer()));
          out[id] = { ex: j.expressName || '', no: j.expressId || '', st: (j.address || []).map(a => ({ t: a.time, p: a.place })) };
        } catch (e) { out[id] = null; }
        await new Promise(r => setTimeout(r, gap));
      }
      return out;
    }
  });
  return res && res.result;
}

/* ---------- 단계 판단 (정산 사이트와 같은 규칙) ---------- */
function classify(st) {
  const s = (st || []).slice().sort((a, b) => (a.t < b.t ? -1 : 1));
  const first = (re, after) => { const x = s.find(e => re.test(e.p) && (!after || e.t >= after)); return x ? x.t : null; };
  const m = {};
  m.cn = s.length ? s[0].t : null;
  m.wh = first(/集运仓|到达仓库|入库成功/);
  m.out = first(/包裹已出库|已交接成功/);
  m.sail = first(/离港|干线出发|航班起飞/);
  { const x = s.find(e => /到达目的|抵达|到港|目的港|进港|入境|到达(韩国|仁川|平泽|釜山)/.test(e.p) && !/预计|离港/.test(e.p)); m.arr = x ? x.t : null; }  // '预计…到目的港'(도착 예정)은 제외
  m.cus = m.arr ? first(/清关/, m.arr) : null;
  m.clr = m.arr ? first(/清关完成|清关成功|放行/, m.arr) : null;
  m.dom = m.arr ? first(/目的地物流商|目的地分拨|派送|派件|揽收|转交/, m.arr) : null;
  m.got = m.arr ? first(/签收|妥投|已送达/, m.arr) : null;
  const stage = !s.length ? -1 : m.got ? 5 : (m.dom || m.clr) ? 4 : (m.arr || m.cus) ? 3 : (m.out || m.sail) ? 2 : m.wh ? 1 : 0;
  return { stage, m };
}
function shipBody(id, info, cur, base) {
  const c = classify(info.st);
  return Object.assign({}, cur, {  // 사이트에서 넣은 운송장·통관·번역 정보는 그대로 둠
    id, date: cur.date || base.date || '', shop: cur.shop || base.shop || '', title: cur.title || base.title || '',
    ex: info.ex || cur.ex || '', no: info.no || cur.no || '',
    st: info.st.slice().sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 14),
    stage: Math.max(c.stage, cur.got ? 5 : -1), m: c.m, pk: c.m.out || '',
    at: new Date().toISOString(), kr: cur.kr || '', got: !!cur.got, tko: cur.tko || '', lko: cur.lko || '', lsrc: cur.lsrc || ''
  });
}

/* ---------- 한 번 확인하기 ---------- */
let running = false;
async function run(why) {
  if (running) return { busy: true };
  running = true;
  const started = Date.now();
  let status;
  try {
    const c = await siteConfig();
    const ships = await rest(c, TABLE + '?select=id,body&id=like.s_*');
    const orders = await rest(c, TABLE + '?select=id,date:body->>date,shop:body->>shop,title:body->items->0->>title&id=like.o_*');
    const S = {}; ships.forEach(r => { if (r.body && r.body.id) S[r.body.id] = r.body; });
    const cutoff = new Date(Date.now() - NEW_ORDER_DAYS * 864e5).toISOString().slice(0, 10);
    const base = {};
    orders.forEach(o => { base[o.id.slice(2)] = o; });
    // 안 받은 주문 + 정산에는 있는데 아직 배송 기록이 없는 최근 주문
    const targets = [
      ...Object.values(S).filter(s => !s.got && s.stage < 5).map(s => s.id),
      ...orders.filter(o => !S[o.id.slice(2)] && (o.date || '') >= cutoff).map(o => o.id.slice(2))
    ].filter((v, i, a) => /^\d+$/.test(v) && a.indexOf(v) === i).slice(0, MAX_PER_RUN);
    const got = {}; let fail = [], via = 'direct';
    for (const id of targets) {
      try { got[id] = await tbDirect(id); } catch (e) { fail.push(id); }
      await sleep(GAP_MS);
      if (fail.length >= 3 && !Object.keys(got).length) break;  // 로그인 쿠키를 못 쓰는 상황: 바로 2순위로
    }
    if (fail.length) {
      const rest2 = targets.filter(id => !got[id]);
      let r2 = null; try { r2 = await tbTab(rest2); } catch (e) { r2 = null; }
      if (r2) { via = Object.keys(got).length ? 'mixed' : 'tab'; fail = []; rest2.forEach(id => { if (r2[id]) got[id] = r2[id]; else fail.push(id); }); }
      else fail = rest2;
    }
    const rows = Object.keys(got).filter(id => got[id].st.length || !S[id]).map(id => ({ id: 's_' + id, body: shipBody(id, got[id], S[id] || {}, base[id] || {}), updated_at: new Date().toISOString() }));
    if (rows.length) await rest(c, TABLE, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows });
    const active = rows.filter(r => r.body.stage < 5 && !r.body.got).length;
    status = { ok: true, at: Date.now(), why, targets: targets.length, saved: rows.length, fail: fail.length, via, active, ms: Date.now() - started,
      note: fail.length && !Object.keys(got).length ? '타오바오에 조회하지 못했어요. 웨일에서 타오바오 로그인이 풀렸을 수 있어요. 타오바오에 다시 로그인한 뒤 지금 확인을 눌러 주세요. (그래도 안 되면 타오바오 주문 화면을 열어둔 채로 눌러 주세요)' : '' };
  } catch (e) {
    status = { ok: false, at: Date.now(), why, error: e.message === 'NEED_LOGIN' ? '정산 사이트 로그인이 필요해요.' : (e.message || String(e)) };
  }
  await set({ last: status });
  chrome.action.setBadgeText({ text: status.ok ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
  running = false;
  return status;
}

/* ---------- 팝업과 대화 ---------- */
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  (async () => {
    if (m.cmd === 'status') {
      const [{ auth, last }, st, a] = await Promise.all([get(['auth', 'last']), settings(), chrome.alarms.get('check')]);
      return { email: auth && auth.email, last, site: st.site, every: st.every, next: a && a.scheduledTime, running };
    }
    if (m.cmd === 'login') return { email: await login(m.email, m.password) };
    if (m.cmd === 'logout') { await chrome.storage.local.remove('auth'); return {}; }
    if (m.cmd === 'run') return await run('manual');
    if (m.cmd === 'settings') { await set({ site: m.site || DEF.site, every: +m.every || DEF.every }); await chrome.alarms.clear('check'); await schedule(); return {}; }
  })().then(reply, e => reply({ error: e.message || String(e) }));
  return true;
});
