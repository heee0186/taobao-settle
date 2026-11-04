/* 타오바오 정산 — 수파베이스 연결 정보는 config.js 에 있어요 */
const CFG = window.TB_CONFIG || {};
const TABLE = 'tb_docs';

const $ = s => document.querySelector(s);
const LK = 'tbSettle1';
let S = { orders: {}, cards: {}, assign: {}, people: ['나'], def: '나' }, sel = null, pend = null, arm = null, ed = null, pe = null, parm = null, pm = false;
try { const r = localStorage.getItem(LK); if (r) S = Object.assign(S, JSON.parse(r)); } catch (e) {}
const saveLocal = () => { try { localStorage.setItem(LK, JSON.stringify(S)); } catch (e) {} };
const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const yu = n => '¥' + n.toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const msg = t => { $('#ms').textContent = t; };
const clone = v => JSON.parse(JSON.stringify(v));
function fixDef() { if (!S.people.length) S.people = ['나']; if (!S.people.includes(S.def)) S.def = S.people[0]; }
fixDef();
// 지정 안 된 품목은 기본 구매자
const who = k => S.people.includes(S.assign[k]) ? S.assign[k] : S.def;

/* ---------- 저장: 이 브라우저 + 수파베이스 ---------- */
let SB = null, tmr = null, busy = false;
const dirty = new Set(), gone = new Set();
const SV = { on: ['', '저장됨'], saving: ['', '저장 중…'], off: ['', '이 기기에만 저장'], err: ['err', '저장 실패 · 다음 변경 때 다시 시도'], loadErr: ['err', '불러오기 실패 · 이 기기 내용 표시 중'] };
function setCloud(s) { const e = $('#sv'); e.className = 'sv ' + SV[s][0]; e.textContent = SV[s][1]; }
const docId = k => k === 'meta' ? 'meta' : 'o_' + k;
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
    const rows = ks.map(k => ({ id: docId(k), body: k === 'meta' ? { people: S.people, cards: S.cards, def: S.def } : orderDoc(k), updated_at: new Date().toISOString() }))
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
async function initCloud() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) { setCloud('off'); return; }
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
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
  const R = { orders: {}, cards: {}, assign: {}, people: null, def: null };
  docs.forEach(d => {
    const v = d.body || {};
    if (d.id === 'meta') { R.people = v.people; R.cards = v.cards || {}; R.def = v.def || null; }
    else if (d.id.startsWith('o_') && v.id) { const as = v.as || {}; delete v.as; R.orders[v.id] = v; for (const k in as) R.assign[v.id + ':' + k] = as[k]; }
  });
  // 수파베이스 내용이 기준. 이 브라우저에만 있던 주문은 올림.
  const L = S, up = []; let meta = !R.people;
  for (const id in L.orders) if (!R.orders[id]) {
    R.orders[id] = L.orders[id]; up.push(id);
    for (const k in L.assign) if (k.startsWith(id + ':')) R.assign[k] = L.assign[k];
  }
  if (!R.people) { R.people = L.people || ['나']; R.def = L.def; }
  for (const d in L.cards) if (+L.cards[d] && !(+R.cards[d])) { R.cards[d] = L.cards[d]; meta = true; }
  S = R; fixDef(); saveLocal(); setCloud('on');
  if (meta) up.push('meta');
  if (up.length) mark(...up);
  render();
}

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
  mark(...ids); msg(n + '건을 추가했어요' + (d ? ' (이미 있는 ' + d + '건은 제외)' : '') + '.');
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
async function translate(d) {
  if (trD) return;
  const T = [], O = [];
  Object.values(S.orders).filter(o => o.date === d).forEach(o => o.items.forEach(i => {
    if (!i.ko && !T.includes(i.title)) T.push(i.title);
    if (i.opt && !i.optKo && !O.includes(i.opt)) O.push(i.opt);
  }));
  if (!T.length && !O.length) { trMsg = '이미 모두 번역돼 있어요.'; render(); return; }
  trD = d; trMsg = '번역하는 중이에요…'; render();
  try {
    const src = [...T.map(cleanTitle), ...O.map(cleanOpt)];
    const uniq = [...new Set(src)];
    const tr = await deepl(uniq), map = {};
    uniq.forEach((s, x) => { if (typeof tr[x] === 'string' && tr[x].trim()) map[s] = tr[x].trim(); });
    const mt = {}, mo = {};
    T.forEach((s, x) => { const v = map[src[x]]; if (v) mt[s] = v; });
    O.forEach((s, x) => { const v = map[src[T.length + x]]; if (v) mo[s] = v; });
    const up = [];
    Object.values(S.orders).forEach(od => {
      let ch = false;
      od.items.forEach(i => {
        if (!i.ko && mt[i.title]) { i.ko = mt[i.title]; ch = true; }
        if (!i.optKo && mo[i.opt]) { i.optKo = mo[i.opt]; ch = true; }
      });
      if (ch) up.push(od.id);
    });
    if (up.length) mark(...up);
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
function setKo(oid, x, v) {
  const t = S.orders[oid].items[x].title, up = [];
  Object.values(S.orders).forEach(o => { let ch = false; o.items.forEach(i => { if (i.title === t) { if (v) i.ko = v; else delete i.ko; ch = true; } }); if (ch) up.push(o.id); });
  mark(...up);
}

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
  return '<div class="ti"><span class="nm" title="' + esc(i.title) + '">' + esc(i.ko || i.title) + '</span><button class="txt" data-a="ed" data-k="' + k + '">수정</button></div>' +
    (i.ko ? '<div class="zh" title="' + esc(i.title) + '">' + esc(i.title) + '</div>' : '');
}
function detail(d) {
  const c = calc(d);
  const bad = c.os.filter(o => Math.abs(o.items.reduce((s, i) => s + i.price * i.qty, 0) + o.ship - o.paid) > 0.02).length;
  const need = c.os.some(o => o.items.some(i => !i.ko || (i.opt && !i.optKo)));
  let h = '<div class="card"><div class="hd"><h2>' + d + '</h2>' +
    (arm === d ? '<button class="txt danger" data-a="del2" data-d="' + d + '">정말 삭제</button>' : '<button class="txt" data-a="del" data-d="' + d + '">이 날짜 삭제</button>') + '</div>' +
    '<div class="pay"><label class="fld"><span>카드 청구액</span><span class="amt"><input id="cd" type="number" inputmode="numeric" value="' + (c.card || '') + '" data-d="' + d + '" placeholder="0">원</span></label>' +
    '<div class="rate">' + (c.rate ? '<b>' + c.rate.toFixed(2) + '</b> 원/위안' : '<span class="mut">청구액을 넣으면 환율이 나와요</span>') +
    '<span class="mut">주문 ' + c.os.length + '건 · ' + yu(c.tot) + '</span></div></div>';
  if (c.tot < 199 || c.tot > 900) h += '<p class="note">합계가 199~900위안 범위를 벗어났어요.</p>';
  if (bad) h += '<p class="note">금액이 맞지 않는 주문이 ' + bad + '건 있어요. 붙여넣기에서 빠진 줄이 없는지 확인해 주세요.</p>';
  if (need || trD === d || trMsg) h += '<div class="tr"><span class="sub">' + esc(trD === d || trMsg ? trMsg : '상품명이 아직 중국어예요.') + '</span>' +
    (need || trD === d ? '<button class="btn" data-a="tr" data-d="' + d + '"' + (trD ? ' disabled' : '') + '>' + (trD === d ? '번역 중…' : '한국어로 번역') + '</button>' : '') + '</div>';
  h += '</div>';
  c.os.forEach(o => {
    const cnt = {}; o.items.forEach(i => cnt[i.title] = (cnt[i.title] || 0) + 1);
    h += '<div class="card ord"><div class="hd"><span class="shop">' + esc(o.shop) + '</span>' + (S.people.length > 1 ? allSel('주문 전체', 'data-o="' + o.id + '"') : '') + '</div>' +
      '<div class="mut">' + esc(o.status) + ' · ' + yu(o.paid) + (o.ship ? ' (중국 내 배송 ' + yu(o.ship) + ' 포함)' : '') + '</div>';
    let open = false;
    o.items.forEach((i, x) => {
      if (o.items.findIndex(j => j.title === i.title) === x) {
        if (open) h += '</div>';
        h += '<div class="prod">' + titleRow(o, i, x); open = true;
        if (cnt[i.title] > 1 && S.people.length > 1) h += '<div class="grp"><span>옵션 여러 개 · 함께 산 물건일 수 있어요</span>' + allSel('묶음 지정', 'data-o="' + o.id + '" data-x="' + x + '"') + '</div>';
      }
      c.U.filter(u => u.o.id === o.id && u.x === x).forEach(u => {
        h += '<div class="u"><span class="op" title="' + esc(i.opt) + '">' + esc(i.optKo || i.opt || '-') + (i.qty > 1 ? ' · ' + (u.u + 1) + '/' + i.qty : '') + '</span>' +
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
  $('#dl').innerHTML = ds.map(d => {
    const c = calc(d);
    return '<button class="dt' + (d === sel ? ' on' : '') + '" data-a="sel" data-d="' + d + '"><b>' + d + '</b><span class="r">' + yu(c.tot) + '</span>' +
      '<span class="mut">' + c.os.length + '건</span><span class="r' + (c.card ? '' : ' need') + '">' + (c.card ? won(c.card) : '청구액 없음') + '</span></button>';
  }).join('');
  let h = '';
  if (pend) h += '<div class="card"><h3>여러 날짜가 섞여 있어요</h3><p class="sub">포함할 날짜를 고르세요. 가장 많은 날짜만 골라 두었어요.</p>' +
    pend.ds.map(d => '<label class="ck"><input type="checkbox" data-a="pd" data-d="' + d + '"' + (pend.on[d] ? ' checked' : '') + '> ' + d + ' <span class="mut">' + pend.c[d] + '건</span></label>').join('') +
    '<div class="hd" style="justify-content:flex-end;margin-top:10px"><button class="txt" data-a="pno">취소</button><button class="btn" data-a="pok">선택한 날짜 추가</button></div></div>';
  h += sel ? detail(sel) : (pend ? '' : '<p class="empty">왼쪽에 주문 페이지를 붙여넣어 시작하세요.</p>');
  $('#dt').innerHTML = h;
  const f = $('#ek') || $('#pe'); if (f) { f.focus(); f.select(); }
}

/* ---------- 입력 ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'SELECT') return;
  const a = b.dataset.a, D = b.dataset;
  if (a === 'pd') { pend.on[D.d] = b.checked; return; }
  if (a === 'tr') { translate(D.d); return; }
  if (a !== 'pdel' && a !== 'pdel2') parm = null;
  if (a === 'parse') {
    const t = $('#t').value.trim();
    if (t) {
      let B = null; if (t[0] === '{') { try { B = JSON.parse(t); } catch (x) {} }
      if (B) importData(B); else addText(t);
      $('#t').value = '';
    }
  }
  else if (a === 'sel') { sel = D.d; arm = null; ed = null; pe = null; trMsg = ''; }
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
document.addEventListener('keydown', e => {
  const id = e.target.id;
  if (id === 'ek' && e.key === 'Escape') { ed = null; render(); }
  else if (id === 'ek' && e.key === 'Enter') { e.target.blur(); }
  else if (id === 'np' && e.key === 'Enter') { $('[data-a="addp"]').click(); }
  else if (id === 'pe' && e.key === 'Enter') { $('[data-a="pesave"]').click(); }
  else if (id === 'pe' && e.key === 'Escape') { pe = null; render(); }
});
render();
initCloud();
