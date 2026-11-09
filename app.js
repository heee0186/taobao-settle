/* 타오바오 정산 — 수파베이스 연결 정보는 config.js 에 있어요 */
const CFG = window.TB_CONFIG || {};
const TABLE = 'tb_docs';

const $ = s => document.querySelector(s);
const LK = 'tbSettle1';
let S = { orders: {}, cards: {}, assign: {}, people: ['나'], def: '나', ship: {} }, view = 'date', sel = null, pend = null, arm = null, ed = null, pe = null, parm = null, pm = false;
try { const r = localStorage.getItem(LK); if (r) S = Object.assign(S, JSON.parse(r)); } catch (e) {}
const saveLocal = () => { try { localStorage.setItem(LK, JSON.stringify(S)); } catch (e) {} };
const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const yu = n => '¥' + n.toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const msg = t => { $('#ms').textContent = t; };
const clone = v => JSON.parse(JSON.stringify(v));
function fixDef() { if (!S.people.length) S.people = ['나']; if (!S.people.includes(S.def)) S.def = S.people[0]; }
fixDef();
if (!S.ship || typeof S.ship !== 'object') S.ship = {};
// 지정 안 된 품목은 기본 구매자
const who = k => S.people.includes(S.assign[k]) ? S.assign[k] : S.def;

/* ---------- 저장: 이 브라우저 + 수파베이스 ---------- */
let SB = null, tmr = null, busy = false;
const dirty = new Set(), gone = new Set();
const SV = { on: ['', '저장됨'], saving: ['', '저장 중…'], off: ['', '이 기기에만 저장'], err: ['err', '저장 실패 · 다음 변경 때 다시 시도'], loadErr: ['err', '불러오기 실패 · 이 기기 내용 표시 중'] };
function setCloud(s) { const e = $('#sv'); e.className = 'sv ' + SV[s][0]; e.textContent = SV[s][1]; }
const docId = k => k === 'meta' ? 'meta' : k.startsWith('s:') ? 's_' + k.slice(2) : 'o_' + k;
function mark(...ks) { ks.forEach(k => { dirty.add(k); gone.delete(k); }); saveLocal(); sched(); }
function markGone(id) { gone.add(id); dirty.delete(id); saveLocal(); sched(); }
function sched() { if (!SB) return; clearTimeout(tmr); tmr = setTimeout(flush, 700); }
function orderDoc(id) {
  const o = S.orders[id]; if (!o) return null;
  const as = {}, p = id + ':';
  for (const k in S.assign) if (k.startsWith(p) && S.assign[k]) as[k.slice(p.length)] = S.assign[k];
  return Object.assign(clone(o), { as });
}
async function flush() {
  if (busy) { sched(); return; }
  busy = true; setCloud('saving');
  const ks = [...dirty], gs = [...gone];
  dirty.clear(); gone.clear();
  try {
    const rows = ks.map(k => ({ id: docId(k), body: k === 'meta' ? { people: S.people, cards: S.cards, def: S.def } : k.startsWith('s:') ? (S.ship[k.slice(2)] || null) : orderDoc(k), updated_at: new Date().toISOString() }))
      .filter(r => r.body);
    if (rows.length) { const { error } = await SB.from(TABLE).upsert(rows); if (error) throw error; }
    if (gs.length) { const { error } = await SB.from(TABLE).delete().in('id', gs.map(docId)); if (error) throw error; }
    setCloud('on');
  } catch (e) {
    console.error(e);
    ks.forEach(k => dirty.add(k)); gs.forEach(k => gone.add(k));
    setCloud('err');
  }
  busy = false;
}
const CLIENT = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { db: { schema: 'money' } }) : null;
async function initCloud() {
  if (!CLIENT) { setCloud('off'); return; }
  const sb = CLIENT;
  const docs = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(TABLE).select('id,body').range(from, from + 999);
      if (error) throw error;
      docs.push(...data);
      if (data.length < 1000) break;
    }
  } catch (e) { console.error(e); setCloud('loadErr'); return; }
  SB = sb;
  const R = { orders: {}, cards: {}, assign: {}, people: null, def: null, ship: {} };
  docs.forEach(d => {
    const v = d.body || {};
    if (d.id === 'meta') { R.people = v.people; R.cards = v.cards || {}; R.def = v.def || null; }
    else if (d.id.startsWith('s_') && v.id) R.ship[v.id] = v;
    else if (d.id.startsWith('o_') && v.id) { const as = v.as || {}; delete v.as; R.orders[v.id] = v; for (const k in as) R.assign[v.id + ':' + k] = as[k]; }
  });
  // 수파베이스 내용이 기준. 이 브라우저에만 있던 주문은 올림.
  const L = S, up = []; let meta = !R.people;
  for (const id in L.orders) if (!R.orders[id]) {
    R.orders[id] = L.orders[id]; up.push(id);
    for (const k in L.assign) if (k.startsWith(id + ':')) R.assign[k] = L.assign[k];
  }
  for (const id in (L.ship || {})) if (!R.ship[id]) { R.ship[id] = L.ship[id]; up.push('s:' + id); }
  if (!R.people) { R.people = L.people || ['나']; R.def = L.def; }
  for (const d in L.cards) if (+L.cards[d] && !(+R.cards[d])) { R.cards[d] = L.cards[d]; meta = true; }
  S = R; fixDef(); saveLocal(); setCloud('on');
  if (meta) up.push('meta');
  if (up.length) mark(...up);
  render();
  translate(null, true);
}


/* ---------- 확장 프로그램이 저장한 배송 기록을 다시 읽기 (탭으로 돌아올 때) ---------- */
let shipLoadedAt = Date.now();
async function reloadShip() {
  if (!SB || busy || Date.now() - shipLoadedAt < 60000) return;
  shipLoadedAt = Date.now();
  try {
    const { data, error } = await SB.from(TABLE).select('id,body').like('id', 's_%');
    if (error) throw error;
    let ch = false;
    data.forEach(d => {
      const v = d.body; if (!v || !v.id || dirty.has('s:' + v.id)) return;
      const cur = S.ship[v.id];
      if (!cur || cur.at !== v.at || cur.got !== v.got || cur.kr !== v.kr) { S.ship[v.id] = v; ch = true; }
    });
    if (ch) { saveLocal(); render(); translate(null, true); }
  } catch (e) { console.error(e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reloadShip(); });

/* ---------- 사람 관리 ---------- */
function touchOrdersOf(name) {
  const ids = new Set();
  for (const k in S.assign) if (S.assign[k] === name) ids.add(k.split(':')[0]);
  return ids;
}
function renamePerson(old, nw) {
  nw = nw.trim();
  if (!nw || nw === old) return;
  if (S.people.includes(nw)) { msg('"' + nw + '"은(는) 이미 있어요.'); return; }
  const ids = touchOrdersOf(old);
  for (const k in S.assign) if (S.assign[k] === old) S.assign[k] = nw;
  S.people = S.people.map(p => p === old ? nw : p);
  if (S.def === old) S.def = nw;
  mark('meta', ...ids);
}
function deletePerson(name) {
  if (S.people.length < 2) { msg('사람은 한 명 이상 있어야 해요.'); return; }
  const ids = touchOrdersOf(name);
  for (const k in S.assign) if (S.assign[k] === name) delete S.assign[k];
  S.people = S.people.filter(p => p !== name);
  fixDef();
  mark('meta', ...ids);
  msg('"' + name + '"을(를) 지웠어요. 그 사람 몫이던 품목은 ' + S.def + '(기본)으로 돌아갔어요.');
}
function setDefault(name) {
  // 기본을 바꿔도 지금 화면의 지정 결과는 그대로 유지
  const ids = new Set(), old = S.def;
  allUnits().forEach(k => {
    const cur = who(k);
    if (cur === old && S.assign[k] !== old) { S.assign[k] = old; ids.add(k.split(':')[0]); }
    if (S.assign[k] === name) { delete S.assign[k]; ids.add(k.split(':')[0]); }
  });
  S.def = name;
  mark('meta', ...ids);
}
function allUnits() {
  const ks = [];
  Object.values(S.orders).forEach(o => o.items.forEach((i, x) => { for (let u = 0; u < i.qty; u++) ks.push(o.id + ':' + x + ':' + u); }));
  return ks;
}
function assign(k, p) { if (p === S.def) delete S.assign[k]; else S.assign[k] = p; }

/* ---------- 백업 JSON 붙여넣기 복원 ---------- */
function importData(B) {
  if (!B || typeof B.orders !== 'object') { msg('백업 형식이 아니에요.'); return; }
  const up = new Set(); let add = 0, meta = false;
  for (const id in B.orders) {
    const o = B.orders[id]; if (!o || !o.id || !Array.isArray(o.items)) continue;
    if (!S.orders[id]) { S.orders[id] = o; up.add(id); add++; }
  }
  for (const k in B.assign || {}) { const v = B.assign[k], oid = k.split(':')[0]; if (v && !S.assign[k] && up.has(oid)) S.assign[k] = v; }
  for (const d in B.cards || {}) if (+B.cards[d] && !(+S.cards[d])) { S.cards[d] = B.cards[d]; meta = true; }
  (B.people || []).forEach(p => { if (typeof p === 'string' && p && !S.people.includes(p)) { S.people.push(p); meta = true; } });
  if (meta) up.add('meta');
  if (up.size) mark(...up);
  sel = null;
  msg('백업에서 주문 ' + add + '건을 가져왔어요.');
}

/* ---------- 붙여넣기 분석 ---------- */
function parse(t) {
  t = t.replace(/\[([^\n\[\]]*\[交易快照\])\]\(https?:[^)]*\)/g, '$1').replace(/\[([^\[\]\n]+)\]\(https?:[^)]*\)/g, '$1');
  const ms = [...t.matchAll(/(\d{4}-\d{2}-\d{2})\s*订单号:\s*(\d+)/g)], out = [];
  ms.forEach((m, i) => {
    const b = t.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : t.length);
    const L = b.split('\n').map(s => s.trim()).filter(Boolean);
    const shop = (L[0] || '').replace(/订单详情$/, '');
    const st = L.find(l => /^(卖家|买家|交易)/.test(l)) || '';
    const items = []; let it = null;
    for (let k = 0; k < L.length; k++) {
      const l = L[k];
      if (l.endsWith('[交易快照]')) { it = { title: l.replace(/\s*\[交易快照\]$/, ''), opt: L[k + 1] || '', p: [] }; k++; continue; }
      if (it) {
        const q = l.match(/^x(\d+)$/);
        if (q) { items.push({ title: it.title, opt: it.opt, price: it.p[0] || 0, qty: +q[1] }); it = null; }
        else { const p = l.match(/^[￥¥](\d+(?:\.\d+)?)$/); if (p) it.p.push(+p[1]); }
      }
    }
    const pm = b.match(/实付款[￥¥]\s*([\d.]+)/), sm = b.match(/大陆运费[:：]\s*[￥¥]\s*([\d.]+)/);
    out.push({ id: m[2], date: m[1], shop, status: st, paid: pm ? +pm[1] : 0, ship: sm ? +sm[1] : 0, items });
  });
  return out;
}
function knownKo(os) {
  // 예전에 번역해 둔 같은 상품명·옵션이면 바로 채움
  const T = {}, O = {};
  Object.values(S.orders).forEach(o => o.items.forEach(i => { if (i.ko) T[i.title] = i.ko; if (i.optKo) O[i.opt] = i.optKo; }));
  os.forEach(o => o.items.forEach(i => { if (!i.ko && T[i.title]) i.ko = T[i.title]; if (!i.optKo && O[i.opt]) i.optKo = O[i.opt]; }));
}
function addText(t) {
  const os = parse(t);
  if (!os.length) { msg('주문을 찾지 못했어요. 주문 페이지를 통째로 복사했는지 확인해 주세요.'); return; }
  knownKo(os);
  const c = {}; os.forEach(o => c[o.date] = (c[o.date] || 0) + 1);
  const ds = Object.keys(c).sort();
  if (ds.length > 1) { const top = ds.reduce((a, b) => c[b] > c[a] ? b : a); pend = { os, c, ds, on: { [top]: true } }; msg(''); return; }
  commit(os);
}
function commit(os) {
  let n = 0, d = 0; const ids = [];
  os.forEach(o => { if (S.orders[o.id]) d++; else { S.orders[o.id] = o; ids.push(o.id); n++; } });
  if (os.length) sel = os[0].date;
  mark(...ids); if (ids.length) setTimeout(() => translate(null, true), 0); msg(n + '건을 추가했어요' + (d ? ' (이미 있는 ' + d + '건은 제외)' : '') + '.');
}

/* ---------- 상품명 한국어 번역 (DeepL, /api/translate) ---------- */
let trD = null, trMsg = '';
// 번역 전에 광고 문구를 걷어내서 결과를 짧게
function cleanTitle(s) {
  return s.replace(/【[^】]*】|\[[^\]]*\]/g, ' ')
    .replace(/(20\d{2}|2\d)年?(新款|秋冬|春夏|春秋|夏季|冬季|秋季|春季)?/g, ' ')
    .replace(/包邮|新款|爆款|网红|热卖|正品|官方|旗舰店?|同款|特价|清仓|促销|ins风?|抖音|小红书|推荐|百搭|高级感|ins/gi, ' ')
    .replace(/[★☆♥❤✨🔥!！~～]+/g, ' ')
    .replace(/\s+/g, ' ').trim() || s;
}
function cleanOpt(s) {
  return s.split(/[;；]/).map(p => p.replace(/^\s*[^:：]{1,6}[:：]\s*/, '').trim()).filter(Boolean).join(' / ') || s;
}
async function deepl(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 50) {
    const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: texts.slice(i, i + 50) }) });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || !Array.isArray(j.translations)) throw { status: r.status, error: j && j.error };
    out.push(...j.translations);
  }
  return out;
}
// 아직 번역 안 된 중국어(상품명·옵션·상점명·배송 기록)를 한 번에 번역
function shipLatest(sh) { const e = (sh.st || [])[0]; if (!e || /^\?+$/.test(e.p.trim())) return ''; return cleanShipText(e.p); }
async function translate(d, auto) {
  if (trD) return;
  const jobs = [], direct = new Set();  // [원문(번역에 보낼 글), 적용 함수]
  // 중국어가 없는 글(예: 'XL')은 번역 없이 그대로 씀
  const add = (src, fn) => { if (!src) return; if (/[\u4e00-\u9fff]/.test(src)) jobs.push([src, fn]); else direct.add(fn(src)); };
  Object.values(S.orders).forEach(o => {
    o.items.forEach(i => {
      if (!i.ko) add(cleanTitle(i.title), v => { i.ko = v; return o.id; });
      if (i.opt && !i.optKo) add(cleanOpt(i.opt), v => { i.optKo = v; return o.id; });
    });
    if (o.shop && !o.shopKo) add(o.shop, v => { o.shopKo = v; return o.id; });
  });
  Object.values(S.ship || {}).forEach(sh => {
    if (!S.orders[sh.id] && sh.title && !sh.tko) add(cleanTitle(sh.title), v => { sh.tko = v; return 's:' + sh.id; });
    if ([...openHist].some(k => k.split(',').includes(sh.id))) (sh.st || []).forEach(e => { const src = cleanShipText(e.p); if (!/^\?+$/.test(e.p.trim()) && !(sh.stk || {})[src]) add(src, v => { sh.stk = Object.assign({}, sh.stk, { [src]: v }); return 's:' + sh.id; }); });
    const lt = shipLatest(sh);
    if (lt && sh.lsrc !== lt) add(lt, v => { sh.lko = v; sh.lsrc = lt; return 's:' + sh.id; });
  });
  if (direct.size) mark(...direct);
  if (!jobs.length) { if (direct.size) render(); if (!auto) { trMsg = '이미 모두 번역돼 있어요.'; render(); } return; }
  trD = d || 'all'; trMsg = '번역하는 중이에요…'; render();
  try {
    const uniq = [...new Set(jobs.map(j => j[0]))];
    const tr = await deepl(uniq), map = {};
    uniq.forEach((x, k) => { if (typeof tr[k] === 'string' && tr[k].trim()) map[x] = tr[k].trim(); });
    const up = new Set();
    jobs.forEach(([src, fn]) => { if (map[src]) up.add(fn(map[src])); });
    if (up.size) mark(...up);
    trMsg = '';
  } catch (e) {
    const s = e && e.status, er = e && e.error;
    trMsg = er === 'no_key' ? '번역 키가 없어요. 버셀 환경변수에 DEEPL_API_KEY를 넣고 다시 배포해 주세요.' :
      s === 456 || er === 'quota' ? '이번 달 무료 번역량을 다 썼어요. 다음 달에 다시 되거나, "수정"으로 직접 적을 수 있어요.' :
      s === 403 || er === 'auth' ? 'DeepL 키가 맞지 않아요. 버셀 환경변수의 DEEPL_API_KEY를 확인해 주세요.' :
      s === 429 ? '요청이 많아 잠시 막혔어요. 조금 뒤에 다시 눌러 주세요.' :
      s === 404 || location.protocol === 'file:' ? '번역 서버(/api/translate)를 찾지 못했어요. 버셀에 배포된 주소에서 열어 주세요.' :
      '번역 중 문제가 생겼어요. 다시 눌러 주세요.' + (s ? ' [코드 ' + s + ']' : '');
  }
  trD = null; render();
}
// 원문 보기 (기본은 숨김)
let raw = false; try { raw = localStorage.getItem('tbRaw') === '1'; } catch (e) {}
const ST_KO = { '卖家已发货': '발송됨', '交易成功': '거래 완료', '买家已付款': '결제 완료', '等待买家付款': '결제 대기', '交易关闭': '거래 취소', '退款中': '환불 중', '退款成功': '환불 완료' };
const stKo = t => raw ? t : (Object.keys(ST_KO).find(k => (t || '').includes(k)) ? ST_KO[Object.keys(ST_KO).find(k => t.includes(k))] : '');
const EX_KO = [['申通', '신통택배'], ['中通', '중통택배'], ['圆通', '위안퉁택배'], ['韵达', '윈다택배'], ['顺丰', '순펑택배'], ['极兔', '지투택배'], ['京东', '징둥택배'], ['邮政', '중국우정'], ['EMS', 'EMS'], ['德邦', '더방택배'], ['百世', '바이스택배'], ['菜鸟', '차이냐오']];
const exKo = t => { if (raw || !t) return t; const f = EX_KO.find(([k]) => t.includes(k)); return f ? f[1] : /大韩|CJ/.test(t) ? 'CJ대한통운' : /韩进/.test(t) ? '한진택배' : /乐天/.test(t) ? '롯데택배' : /[\u4e00-\u9fff]/.test(t) ? '택배' : t; };
const shopKo = o => raw ? o.shop : (o.shopKo || o.shop);
const rawBtn = () => '<button class="txt" data-a="raw">' + (raw ? '원문 숨기기' : '원문 보기') + '</button>';
function setKo(oid, x, v) {
  const t = S.orders[oid].items[x].title, up = [];
  Object.values(S.orders).forEach(o => { let ch = false; o.items.forEach(i => { if (i.title === t) { if (v) i.ko = v; else delete i.ko; ch = true; } }); if (ch) up.push(o.id); });
  mark(...up);
}


/* ---------- 배송 현황 (타오바오 물류 북마크로 가져온 기록) ---------- */
const STG = ['중국 배송', '창고 도착', '국제 운송', '한국 통관', '국내 배송', '받음'];
// 기록 전체를 보고 어디까지 왔는지와 단계별 시각을 뽑음
function classify(st) {
  const s = (st || []).slice().sort((a, b) => (a.t < b.t ? -1 : 1)); // 오래된 것부터
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
function importShip(B) {
  const list = Array.isArray(B.orders) ? B.orders : [];
  const up = []; let n = 0, linked = 0;
  list.forEach(o => {
    if (!o || !/^\d+$/.test(String(o.id))) return;
    const cur = S.ship[o.id] || {};
    const st = Array.isArray(o.st) ? o.st.filter(e => e && e.t && typeof e.p === 'string') : (cur.st || []);
    const c = classify(st);
    S.ship[o.id] = Object.assign({}, cur, {
      id: String(o.id), date: o.date || cur.date || '', shop: o.shop || cur.shop || '', title: o.title || cur.title || '',
      ex: o.ex || cur.ex || '', no: o.no || cur.no || '',
      st: st.slice().sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 14),
      stage: Math.max(c.stage, cur.got ? 5 : -1), m: c.m, pk: c.m.out || '',
      in: findIntl(st) || cur.in || '', at: B.at || new Date().toISOString(), kr: cur.kr || '', got: !!cur.got, tko: cur.tko || '', lko: cur.lko || '', lsrc: cur.lsrc || ''
    });
    if (S.orders[o.id]) linked++;
    up.push('s:' + o.id); n++;
  });
  if (up.length) mark(...up);
  view = 'ship';
  setTimeout(() => translate(null, true), 0);
  msg('주문 ' + n + '건의 배송 기록을 가져왔어요' + (n - linked ? ' (정산에 아직 없는 주문 ' + (n - linked) + '건 포함)' : '') + '.');
}
function findIntl(st) {  // 합배송 운송장: '…最新物流单号为300322309912…' (창고 출고 때 기록됨)
  const L = (st || []).map(e => e.p || '');
  for (const p of L) { const m = p.match(/最新(物流)?(运)?单号\s*[为是:：]?\s*([A-Z0-9]{8,20})/); if (m) return m[3]; }
  for (const p of L) { if (/入库|揽收/.test(p)) continue; const m = p.match(/(国际|转运|海外|韩国)(物流|运)?单号\s*[为是:：]?\s*([A-Z0-9]{8,20})/); if (m) return m[3]; }
  return '';
}
/* 관세청 통관 상세 (운송장 = House B/L 번호) */
const cusDone = c => !!c && /반출/.test((c.status || '') + ' ' + (c.prgs || '') + ' ' + ((c.steps || [])[0] || {}).kind);
let cusErr = '', cusBusy = false;
const openHist = new Set();
async function refreshCustoms(force) {
  if (cusBusy || cusErr === 'no_key') return;
  const todo = parcels().filter(p => p.kr && !p.got && (force || !p.cus || (!cusDone(p.cus) && Date.now() - (p.cus.at || 0) > 30 * 60000)));
  if (!todo.length) return;
  cusBusy = true;
  for (const p of todo) {
    try {
      const yy = ((p.os[0].pk || p.os[0].date || '') + '').slice(0, 4) || new Date().getFullYear();
      const r = await fetch('/api/customs?hbl=' + encodeURIComponent(p.kr) + '&yy=' + yy);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) { cusErr = (j && j.error) || 'net'; break; }
      cusErr = '';
      const v = Object.assign(j, { at: Date.now(), hbl: p.kr });
      shipKeys(p.key).forEach(id => { S.ship[id].cus = v; });
      mark(...shipKeys(p.key).map(id => 's:' + id));
    } catch (e) { cusErr = 'net'; break; }
  }
  cusBusy = false;
  if (view === 'ship') render();
}
function cusBlock(p) {
  if (!p.kr) return '';
  const c = p.cus;
  if (cusErr === 'no_key') return '<p class="mut cu">통관 상세를 보려면 관세청 유니패스 API 키가 필요해요. (README의 "통관 상세" 참고)</p>';
  if (!c) return '<p class="mut cu">' + (cusBusy ? '관세청에 조회하는 중이에요…' : '관세청 조회 대기 중이에요.') + '</p>';
  if (!c.found) return '<p class="mut cu">관세청: ' + esc(c.note || '아직 등록되지 않았어요.') + ' <span>(' + localAt(new Date(c.at).toISOString()) + ' 확인)</span></p>';
  if (c.multi) return '<p class="mut cu">관세청에 같은 번호의 화물이 ' + c.list.length + '건 있어요. 유니패스에서 확인해 주세요.</p>';
  let h = '<div class="cu"><div class="hd"><b>관세청 · ' + esc(c.status || c.prgs || '확인 중') + '</b><span class="mut">' + localAt(new Date(c.at).toISOString()) + ' 확인</span></div>' +
    '<div class="ms">' + (c.arrived ? '<span>입항 <b>' + md(c.arrived) + '</b></span>' : '') + (c.forwarder ? '<span>특송업체 <b>' + esc(c.forwarder) + '</b></span>' : '') + (c.name ? '<span>품명 <b>' + esc(c.name) + '</b></span>' : '') + '</div>';
  if ((c.steps || []).length) h += '<ul class="cs">' + c.steps.slice(0, 10).map(x => '<li><span class="mut">' + esc(hm(x.t)) + '</span><span>' + esc(x.kind) + (x.place ? ' <span class="mut">· ' + esc(x.place) + '</span>' : '') + '</span></li>').join('') + '</ul>';
  return h + '</div>';
}
function histBlock(p) {
  const s = p.os.slice().sort((a, b) => (b.st || []).length - (a.st || []).length)[0];
  if (!s || !(s.st || []).length) return '';
  const k = p.key, open = openHist.has(k);
  let h = '<details class="hist" data-g="' + k + '"' + (open ? ' open' : '') + '><summary>타오바오 기록 전체 보기</summary>';
  if (open) h += '<ul class="cs">' + s.st.map(e => {
    const src = cleanShipText(e.p), q = /^\?+$/.test(e.p.trim());
    const txt = q ? '(한국 구간 · 타오바오 기록에서 한글이 깨져 보이지 않아요)' : raw ? src : ((s.stk || {})[src] || '번역 중…');
    return '<li><span class="mut">' + esc(hm(e.t)) + '</span><span>' + esc(txt) + '</span></li>';
  }).join('') + '</ul>';
  return h + '</details>';
}
// 같은 시각에 창고에서 출고된 주문끼리 한 소포로 묶음
function parcels() {
  const g = {};
  Object.values(S.ship).forEach(s => { const k = s.pk ? 'p' + s.pk : 'o' + s.id; (g[k] = g[k] || []).push(s); });
  return Object.values(g).map(os => {
    let stage = Math.min(...os.map(s => s.got ? 5 : s.stage));
    const last = os.map(s => (s.st[0] || {}).t || '').sort().pop() || '';
    const cus = (os.find(s => s.cus) || {}).cus || null;
    // 합배송 운송장: 창고에서 묶인 뒤 주문들이 같은 번호를 갖거나, 국제·한국 택배 이름이 붙은 번호
    const nos = os.map(s => s.no).filter(Boolean), one = [...new Set(nos)];
    const io = os.find(s => s.no && s.stage >= 2 && /集运|国际|韩国|菜鸟|CJ|大韩|韩进|乐天|EMS|海外/.test(s.ex || ''));
    const tx = os.map(s => s.in || findIntl(s.st)).find(Boolean);
    const intl = tx ? { no: tx, ex: '' } : (os.length > 1 && one.length === 1 && nos.length === os.length) ? { no: one[0], ex: os[0].ex } : io ? { no: io.no, ex: io.ex } : null;
    const userKr = (os.find(s => s.kr) || {}).kr || '';
    if (cus && cus.found && stage < 5) stage = Math.max(stage, cusDone(cus) ? 4 : 3);  // 관세청 기록이 있으면 그 단계 반영
    return { os, stage, last, cus, intl, krAuto: !userKr && !!intl, kr: userKr || (intl ? intl.no : ''), got: os.every(s => s.got), key: os.map(s => s.id).join(',') };
  }).sort((a, b) => (a.got - b.got) || (b.stage - a.stage) || (a.last < b.last ? 1 : -1));
}
const md = t => t ? (+t.slice(5, 7)) + '/' + (+t.slice(8, 10)) : '';
const localAt = iso => { const d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const hm = t => t ? md(t) + ' ' + t.slice(11, 16) : '';
function shipName(s) {
  const o = S.orders[s.id];
  if (o && o.items[0]) return ((raw ? '' : o.items[0].ko) || o.items[0].title) + (o.items.length > 1 ? ' 외 ' + (o.items.length - 1) + '개' : '');
  return (raw ? '' : s.tko) || s.title || s.shop || s.id;
}
function cleanShipText(p) { return p.replace(/，?【?物流问题[^】]*】?|，?可关注[^，。]*|如遇问题[^，。]*|（[^）]*外呼[^）]*）/g, '').replace(/[，。\s]+$/, '').slice(0, 80); }
const STG_DESC = ['중국 택배로 웨이하이 창고에 가는 중이에요', '웨이하이 창고에서 합포장을 기다리는 중이에요', '한국으로 가는 중이에요', '한국 세관에서 통관 중이에요', '한국 택배로 배송 중이에요', '받았어요'];
function lastText(s) {
  const e = s.st[0]; if (!e) return '아직 발송 전이에요';
  if (/^\?+$/.test(e.p.trim())) return '한국 택배로 배송 중이에요. 운송장 번호로 조회해 보세요.';
  if (raw) return cleanShipText(e.p);
  const lt = cleanShipText(e.p);
  return (s.lko && s.lsrc === lt) ? s.lko : STG_DESC[Math.max(s.stage, 0)];
}
function bar(stage) {
  return '<div class="bar">' + STG.map((l, i) => '<span class="' + (i <= stage ? 'on' : '') + (i === stage ? ' cur' : '') + '" title="' + l + '"></span>').join('') + '</div>';
}
function parcelCard(p) {
  const s0 = p.os[0], m = s0.m || {};
  const ms = [['wh', '창고'], ['out', '출고'], ['sail', '출항'], ['arr', '한국 도착'], ['clr', '통관 완료'], ['dom', '택배 인수']].filter(([k]) => m[k]);
  let h = '<div class="card pc' + (p.got ? ' done' : '') + '"><div class="hd"><span class="stg s' + Math.max(p.stage, 0) + '">' + (p.stage < 0 ? '발송 전' : STG[p.stage]) + '</span>' +
    '<span class="mut">' + (p.os.length > 1 ? '주문 ' + p.os.length + '건 합포장 · ' : '') + (p.last ? '최근 ' + hm(p.last) : '') + '</span></div>' + bar(p.stage);
  if (!p.got) h += '<p class="lt">' + esc(lastText(p.os.slice().sort((a, b) => ((a.st[0] || {}).t < (b.st[0] || {}).t ? 1 : -1))[0])) + '</p>';
  if (ms.length) h += '<div class="ms">' + ms.map(([k, l]) => '<span>' + l + ' <b>' + md(m[k]) + '</b></span>').join('') + '</div>';
  h += '<ul class="po">' + p.os.map(s => '<li><span class="nm">' + esc(shipName(s)) + '</span><span class="mut">' + esc(md(s.date)) + ' 주문' +
    '' + (p.os.length > 1 && !p.got && s.stage !== p.stage && s.stage >= 0 ? ' · ' + STG[s.stage] : '') + '</span></li>').join('') + '</ul>';
  if (p.stage >= 2 || p.kr) {
    if (p.intl) h += '<div class="iw">합배송 운송장 <b>' + esc(p.intl.no) + '</b>' + (p.intl.ex ? ' <span class="mut">' + esc(exKo(p.intl.ex)) + '</span>' : '') + '</div>';
    h += '<label class="krl">' + (p.krAuto ? '통관·국내 조회에 쓰는 번호 (합배송 운송장 자동 사용 · 다르면 고쳐 넣으세요)' : '운송장 번호 (유니패스의 House B/L)') + '</label><div class="kr"><input type="text" class="krn" inputmode="numeric" data-g="' + p.key + '" value="' + esc(p.kr) + '" placeholder="H B/L 번호를 붙여넣으세요">' +
      (p.kr ? '<a class="btn" target="_blank" rel="noopener" href="https://search.naver.com/search.naver?query=' + encodeURIComponent(p.kr) + '">네이버 배송조회</a>' : '') + '</div>' + cusBlock(p);
  }
  h += histBlock(p);
  h += '<div class="hd ft"><span></span><button class="txt" data-a="got" data-g="' + p.key + '">' + (p.got ? '받음 취소' : '받았어요') + '</button></div></div>';
  return h;
}
function shipView() {
  const ps = parcels(), act = ps.filter(p => !p.got), done = ps.filter(p => p.got);
  const at = Object.values(S.ship).map(s => s.at).sort().pop();
  let h = '<div class="card"><div class="hd"><h2>배송 현황</h2><span class="mut">' + (at ? '기록 ' + localAt(at) + ' 기준 · ' : '') + rawBtn() + '</span></div>' +
    '<p class="sub" style="margin:8px 0 0">타오바오 주문 화면에서 <b>타오바오 물류</b> 북마크를 누르고, 복사한 내용을 왼쪽 입력칸에 붙여넣으면 최신 상태로 바뀌어요. ' +
    '<a href="bookmarklet.html" target="_blank" rel="noopener">북마크 설치 방법</a></p></div>';
  if (!ps.length) return h + '<p class="empty">아직 가져온 배송 기록이 없어요.<br><a href="bookmarklet.html" target="_blank" rel="noopener">북마크 버튼부터 설치해 주세요</a></p>';
  h += act.length ? act.map(parcelCard).join('') : '<p class="empty">배송 중인 소포가 없어요.</p>';
  setTimeout(() => refreshCustoms(false), 0);
  if (done.length) h += '<details class="dn"><summary>받은 소포 ' + done.length + '개</summary>' + done.slice(0, 20).map(parcelCard).join('') + '</details>';
  return h;
}
function shipKeys(g) { return g.split(',').filter(id => S.ship[id]); }

/* ---------- 계산 ---------- */
function calc(date) {
  const os = Object.values(S.orders).filter(o => o.date === date), U = [];
  os.forEach(o => {
    const sub = o.items.reduce((s, i) => s + i.price * i.qty, 0);
    o.items.forEach((i, x) => { for (let u = 0; u < i.qty; u++) U.push({ k: o.id + ':' + x + ':' + u, o, i, x, u, cny: i.price + (sub ? o.ship * i.price / sub : 0) }); });
  });
  const tot = os.reduce((s, o) => s + o.paid, 0), card = +S.cards[date] || 0;
  if (card && tot) {
    U.forEach(u => u.krw = u.cny * card / tot);
    const f = U.map(u => ({ u, fl: Math.floor(u.krw), r: u.krw - Math.floor(u.krw) }));
    const rem = Math.round(card - f.reduce((s, a) => s + a.fl, 0));
    f.sort((a, b) => b.r - a.r).forEach((a, j) => a.u.w = a.fl + (j < rem ? 1 : 0));
  } else U.forEach(u => u.w = 0);
  return { os, U, tot, card, rate: card && tot ? card / tot : 0 };
}
const allDates = () => [...new Set(Object.values(S.orders).map(o => o.date))].sort().reverse();
const opts = cur => S.people.map(p => '<option' + (p === cur ? ' selected' : '') + ' value="' + esc(p) + '">' + esc(p) + '</option>').join('');
const whoSel = k => { const w = who(k); return '<select class="who' + (w !== S.def ? ' set' : '') + '" data-k="' + k + '" aria-label="구매자">' + opts(w) + '</select>'; };
const allSel = (label, attrs) => '<select class="who all" ' + attrs + ' aria-label="' + label + '"><option value="" selected>' + label + '</option>' + opts(null) + '</select>';

/* ---------- 화면 ---------- */
function summary(d) {
  const cur = {}, tot = {};
  S.people.forEach(n => { cur[n] = 0; tot[n] = 0; });
  allDates().forEach(dd => calc(dd).U.forEach(u => { const a = who(u.k); tot[a] += u.w; if (dd === d) cur[a] += u.w; }));
  const row = n => {
    let h = '<div class="pp"><span class="pn">' + esc(n) + (n === S.def ? '<span class="tag">기본</span>' : '') + '</span><span>' + won(cur[n]) + '</span><span>' + won(tot[n]) + '</span></div>';
    if (!pm) return h;
    if (pe === n) return h + '<div class="pa"><input id="pe" type="text" data-p="' + esc(n) + '" value="' + esc(n) + '"><button class="btn" data-a="pesave">저장</button><button class="txt" data-a="pecancel">취소</button></div>';
    return h + '<div class="pa"><button class="txt" data-a="pedit" data-p="' + esc(n) + '">이름 수정</button>' +
      (n !== S.def ? '<button class="txt" data-a="pdef" data-p="' + esc(n) + '">기본으로</button>' : '') +
      (S.people.length > 1 ? (parm === n ? '<button class="txt danger" data-a="pdel2" data-p="' + esc(n) + '">정말 삭제</button>' : '<button class="txt" data-a="pdel" data-p="' + esc(n) + '">삭제</button>') : '') + '</div>';
  };
  return '<div class="card"><div class="hd"><h3>사람별 지출</h3><button class="txt" data-a="pm">' + (pm ? '완료' : '사람 관리') + '</button></div>' +
    '<div class="pp ph"><span></span><span>' + d.slice(5).replace('-', '/') + '</span><span>전체</span></div>' + S.people.map(row).join('') +
    (pm ? '<div class="addp"><input type="text" id="np" placeholder="새 사람 이름"><button class="btn" data-a="addp">추가</button></div>' : '') +
    '<p class="mut hint">따로 지정하지 않은 품목은 기본(' + esc(S.def) + ')으로 계산돼요.</p></div>';
}
function titleRow(o, i, x) {
  const k = o.id + ':' + x;
  if (ed === k) return '<div class="ti"><input id="ek" class="wide" type="text" data-o="' + o.id + '" data-x="' + x + '" value="' + esc(i.ko || '') + '" placeholder="한국어 이름 (비우면 원문)"></div><div class="zh">' + esc(i.title) + '</div>';
  return '<div class="ti"><span class="nm">' + esc((raw ? '' : i.ko) || i.title) + '</span><button class="txt" data-a="ed" data-k="' + k + '">수정</button></div>' +
    (i.ko && raw ? '<div class="zh" title="' + esc(i.title) + '">' + esc(i.title) + '</div>' : '');
}
function detail(d) {
  const c = calc(d);
  const bad = c.os.filter(o => Math.abs(o.items.reduce((s, i) => s + i.price * i.qty, 0) + o.ship - o.paid) > 0.02).length;
  const need = c.os.some(o => o.items.some(i => !i.ko || (i.opt && !i.optKo)));
  let h = '<div class="card"><div class="hd"><h2>' + d + '</h2><span class="hda">' + rawBtn() +
    (arm === d ? '<button class="txt danger" data-a="del2" data-d="' + d + '">정말 삭제</button>' : '<button class="txt" data-a="del" data-d="' + d + '">이 날짜 삭제</button>') + '</span></div>' +
    '<div class="pay"><label class="fld"><span>카드 청구액</span><span class="amt"><input id="cd" type="number" inputmode="numeric" value="' + (c.card || '') + '" data-d="' + d + '" placeholder="0">원</span></label>' +
    '<div class="rate">' + (c.rate ? '<b>' + c.rate.toFixed(2) + '</b> 원/위안' : '<span class="mut">청구액을 넣으면 환율이 나와요</span>') +
    '<span class="mut">주문 ' + c.os.length + '건 · ' + yu(c.tot) + '</span></div></div>';
  if (c.tot < 199 || c.tot > 900) h += '<p class="note">합계가 199~900위안 범위를 벗어났어요.</p>';
  if (bad) h += '<p class="note">금액이 맞지 않는 주문이 ' + bad + '건 있어요. 붙여넣기에서 빠진 줄이 없는지 확인해 주세요.</p>';
  if (need || trD || trMsg) h += '<div class="tr"><span class="sub">' + esc(trD || trMsg ? trMsg : '상품명이 아직 중국어예요.') + '</span>' +
    (need || trD ? '<button class="btn" data-a="tr" data-d="' + d + '"' + (trD ? ' disabled' : '') + '>' + (trD ? '번역 중…' : '한국어로 번역') + '</button>' : '') + '</div>';
  h += '</div>';
  c.os.forEach(o => {
    const cnt = {}; o.items.forEach(i => cnt[i.title] = (cnt[i.title] || 0) + 1);
    const sp = S.ship[o.id];
    h += '<div class="card ord"><div class="hd"><span class="shop">' + esc(shopKo(o)) + (sp ? ' <button class="stg s' + Math.max(sp.got ? 5 : sp.stage, 0) + '" data-a="view" data-v="ship">' + (sp.got ? '받음' : sp.stage < 0 ? '발송 전' : STG[sp.stage]) + '</button>' : '') + '</span>' + (S.people.length > 1 ? allSel('주문 전체', 'data-o="' + o.id + '"') : '') + '</div>' +
      '<div class="mut">' + (stKo(o.status) ? esc(stKo(o.status)) + ' · ' : '') + yu(o.paid) + (o.ship ? ' (중국 내 배송 ' + yu(o.ship) + ' 포함)' : '') + '</div>';
    let open = false;
    o.items.forEach((i, x) => {
      if (o.items.findIndex(j => j.title === i.title) === x) {
        if (open) h += '</div>';
        h += '<div class="prod">' + titleRow(o, i, x); open = true;
        if (cnt[i.title] > 1 && S.people.length > 1) h += '<div class="grp"><span>옵션 여러 개 · 함께 산 물건일 수 있어요</span>' + allSel('묶음 지정', 'data-o="' + o.id + '" data-x="' + x + '"') + '</div>';
      }
      c.U.filter(u => u.o.id === o.id && u.x === x).forEach(u => {
        h += '<div class="u"><span class="op" title="' + esc(i.opt) + '">' + esc((raw ? '' : i.optKo) || i.opt || '-') + (i.qty > 1 ? ' · ' + (u.u + 1) + '/' + i.qty : '') + '</span>' +
          '<span class="pr"><span class="mut">' + yu(u.cny) + '</span>' + (c.card ? won(u.w) : '') + '</span>' + whoSel(u.k) + '</div>';
      });
    });
    if (open) h += '</div>';
    h += '</div>';
  });
  return h + summary(d);
}
function render() {
  const ds = allDates();
  if (!sel || !ds.includes(sel)) sel = ds[0] || null;
  const ps = parcels(), act = ps.filter(p => !p.got);
  const shipBtn = '<button class="dt sh' + (view === 'ship' ? ' on' : '') + '" data-a="view" data-v="ship"><b>배송 현황</b><span class="r">' + (!ps.length ? '' : act.length ? '진행 중 ' + act.length : '모두 받음') + '</span>' +
    '<span class="mut">' + (!ps.length ? '타오바오 물류 가져오기' : act.length ? act.map(p => p.stage < 0 ? '발송 전' : STG[p.stage]).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).join(' · ') : '') + '</span><span></span></button>';
  $('#dl').innerHTML = shipBtn + ds.map(d => {
    const c = calc(d);
    return '<button class="dt' + (view === 'date' && d === sel ? ' on' : '') + '" data-a="sel" data-d="' + d + '"><b>' + d + '</b><span class="r">' + yu(c.tot) + '</span>' +
      '<span class="mut">' + c.os.length + '건</span><span class="r' + (c.card ? '' : ' need') + '">' + (c.card ? won(c.card) : '청구액 없음') + '</span></button>';
  }).join('');
  let h = '';
  if (pend) h += '<div class="card"><h3>여러 날짜가 섞여 있어요</h3><p class="sub">포함할 날짜를 고르세요. 가장 많은 날짜만 골라 두었어요.</p>' +
    pend.ds.map(d => '<label class="ck"><input type="checkbox" data-a="pd" data-d="' + d + '"' + (pend.on[d] ? ' checked' : '') + '> ' + d + ' <span class="mut">' + pend.c[d] + '건</span></label>').join('') +
    '<div class="hd" style="justify-content:flex-end;margin-top:10px"><button class="txt" data-a="pno">취소</button><button class="btn" data-a="pok">선택한 날짜 추가</button></div></div>';
  if (view === 'ship' && !pend) h += shipView();
  else h += sel ? detail(sel) : (pend ? '' : '<p class="empty">주문 페이지를 붙여넣고 분석해서 추가를 누르면 시작돼요.</p>');
  $('#dt').innerHTML = h;
  const f = $('#ek') || $('#pe'); if (f) { f.focus(); f.select(); }
}

/* ---------- 입력 ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'SELECT') return;
  const a = b.dataset.a, D = b.dataset;
  if (a === 'pd') { pend.on[D.d] = b.checked; return; }
  if (a === 'tr') { translate(D.d); return; }
  if (a === 'raw') { raw = !raw; try { localStorage.setItem('tbRaw', raw ? '1' : '0'); } catch (x) {} }
  if (a !== 'pdel' && a !== 'pdel2') parm = null;
  if (a === 'parse') {
    const t = $('#t').value.trim();
    if (t) {
      let B = null; if (t[0] === '{') { try { B = JSON.parse(t); } catch (x) {} }
      if (B && B.app === 'tb-logistics') importShip(B); else if (B) importData(B); else { addText(t); view = 'date'; }
      $('#t').value = '';
    }
  }
  else if (a === 'view') { view = D.v; }
  else if (a === 'got') { const ks = shipKeys(D.g), v = !ks.every(id => S.ship[id].got); ks.forEach(id => { S.ship[id].got = v; }); mark(...ks.map(id => 's:' + id)); }
  else if (a === 'sel') { view = 'date'; sel = D.d; arm = null; ed = null; pe = null; trMsg = ''; }
  else if (a === 'ed') { ed = D.k; }
  else if (a === 'addp') { const v = $('#np').value.trim(); if (v && !S.people.includes(v)) { S.people.push(v); mark('meta'); } }
  else if (a === 'pm') { pm = !pm; pe = null; }
  else if (a === 'pedit') { pe = D.p; }
  else if (a === 'pesave') { const i = $('#pe'); renamePerson(i.dataset.p, i.value); pe = null; }
  else if (a === 'pecancel') { pe = null; }
  else if (a === 'pdef') { setDefault(D.p); }
  else if (a === 'pdel') { parm = D.p; }
  else if (a === 'pdel2') { deletePerson(D.p); parm = null; }
  else if (a === 'del') { arm = D.d; }
  else if (a === 'del2') {
    Object.values(S.orders).filter(o => o.date === D.d).forEach(o => {
      delete S.orders[o.id]; for (const k in S.assign) if (k.startsWith(o.id + ':')) delete S.assign[k]; markGone(o.id);
    });
    delete S.cards[D.d]; arm = null; sel = null; mark('meta');
  }
  else if (a === 'pok') { commit(pend.os.filter(o => pend.on[o.date])); pend = null; }
  else if (a === 'pno') { pend = null; }
  render();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.classList.contains('krn')) { const v = t.value.replace(/[^0-9A-Za-z]/g, ''); const ks = shipKeys(t.dataset.g); ks.forEach(id => { S.ship[id].kr = v; delete S.ship[id].cus; }); mark(...ks.map(id => 's:' + id)); render(); if (v) refreshCustoms(true); return; }
  if (t.id === 'cd') { S.cards[t.dataset.d] = +t.value || 0; mark('meta'); render(); }
  else if (t.id === 'ek') { setKo(t.dataset.o, +t.dataset.x, t.value.trim()); ed = null; render(); }
  else if (t.classList.contains('who')) {
    const p = t.value; if (!p) return;
    if (t.dataset.k) { assign(t.dataset.k, p); mark(t.dataset.k.split(':')[0]); }
    else if (t.dataset.o) {
      const o = S.orders[t.dataset.o], ti = t.dataset.x != null ? o.items[+t.dataset.x].title : null;
      o.items.forEach((i, x) => { if (ti === null || i.title === ti) for (let u = 0; u < i.qty; u++) assign(o.id + ':' + x + ':' + u, p); });
      mark(o.id);
    }
    render();
  }
});
document.addEventListener('toggle', e => {
  const d = e.target; if (!d.classList || !d.classList.contains('hist')) return;
  const k = d.dataset.g;
  if (d.open && !openHist.has(k)) { openHist.add(k); render(); translate(null, true); }
  else if (!d.open) openHist.delete(k);
}, true);
document.addEventListener('keydown', e => {
  const id = e.target.id;
  if (id === 'ek' && e.key === 'Escape') { ed = null; render(); }
  else if (id === 'ek' && e.key === 'Enter') { e.target.blur(); }
  else if (id === 'np' && e.key === 'Enter') { $('[data-a="addp"]').click(); }
  else if (id === 'pe' && e.key === 'Enter') { $('[data-a="pesave"]').click(); }
  else if (id === 'pe' && e.key === 'Escape') { pe = null; render(); }
});
/* ---------- 로그인 (주인만 수파베이스 자료를 읽고 씀) ---------- */
let started = false;
function loginErrorText(error) {
  const code = error && (error.code || '');
  const msg = (error && error.message) || '';
  if (code === 'invalid_credentials' || /Invalid login credentials/i.test(msg))
    return '이메일 또는 비밀번호가 맞지 않아요.\n(계정은 프로젝트 2 wlrenrjgwqefumsenihc 쪽 계정이어야 해요)';
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg))
    return '이메일 확인이 안 된 계정이에요.\nSupabase → Authentication → Users 에서 계정을 Confirm 해 주세요.';
  if (/api key|apikey|jwt/i.test(msg))
    return '앱의 Supabase 키가 맞지 않아요. [' + msg + ']';
  return '로그인하지 못했어요. [' + (code ? code + ': ' : '') + msg + ']';
}
async function isOwner() {
  const { data, error } = await CLIENT.rpc('is_owner');
  if (error) throw error;
  return data === true;
}
function showGate(m) {
  $('#gate').hidden = false; $('#lo').hidden = true;
  $('#gm').textContent = m || '';
  const b = $('#gb'); b.disabled = false; b.textContent = '로그인';
  setTimeout(() => $('#ge').focus(), 50);
}
function enter() {
  $('#gate').hidden = true; $('#lo').hidden = false;
  if (!started) { started = true; initCloud(); }
}
async function initAuth() {
  if (!CLIENT) { setCloud('off'); return; }
  try {
    const { data } = await CLIENT.auth.getSession();
    if (data.session && await isOwner()) return enter();
    if (data.session) await CLIENT.auth.signOut();
    showGate();
  } catch (e) { console.error(e); showGate('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
}
$('#gf').addEventListener('submit', async e => {
  e.preventDefault();
  const b = $('#gb'); b.disabled = true; b.textContent = '확인 중…'; $('#gm').textContent = '';
  try {
    const { error } = await CLIENT.auth.signInWithPassword({ email: $('#ge').value.trim(), password: $('#gp').value });
    if (error) { console.error(error); return showGate(loginErrorText(error)); }
    if (!(await isOwner())) { await CLIENT.auth.signOut(); return showGate('이 계정은 볼 권한이 없어요.'); }
    $('#gp').value = ''; enter();
  } catch (x) { console.error(x); showGate('로그인 중 문제가 생겼어요. [' + ((x && (x.code ? x.code + ': ' : '') + (x.message || x)) || '') + ']'); }
});
$('#lo').addEventListener('click', async () => {
  if (!confirm('로그아웃할까요?')) return;
  if (dirty.size || gone.size) { clearTimeout(tmr); await flush(); }
  await CLIENT.auth.signOut();
});
if (CLIENT) CLIENT.auth.onAuthStateChange(ev => {
  if (ev === 'SIGNED_OUT') { SB = null; started = false; showGate(); }
});

render();
initAuth();
