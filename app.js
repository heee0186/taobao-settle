/* ===== 설정: 수파베이스 프로젝트 값 넣기 =====
   Supabase 대시보드 → Project Settings → API 에서 복사
   (비워 두면 이 브라우저에만 저장돼요) */
const SUPABASE_URL = 'https://pbzwcsaveufsqbmhygon.supabase.co/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiendjc2F2ZXVmc3FibWh5Z29uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxOTQ2MTgsImV4cCI6MjA5MDc3MDYxOH0.sq8gWEF7ntiA3pL9DeDQ59rVNuDzXBkJSDJmC2OHIOE';
const TABLE = 'tb_docs';

const $ = s => document.querySelector(s);
const LK = 'tbSettle1';
let S = { orders: {}, cards: {}, assign: {}, people: ['나'] }, sel = null, pend = null, arm = null, ed = null;
try { const r = localStorage.getItem(LK); if (r) S = Object.assign(S, JSON.parse(r)); } catch (e) {}
const saveLocal = () => { try { localStorage.setItem(LK, JSON.stringify(S)); } catch (e) {} };
const won = n => Math.round(n).toLocaleString('ko-KR') + '원';
const yu = n => '¥' + n.toFixed(2);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const msg = t => { $('#ms').textContent = t; };
const clone = v => JSON.parse(JSON.stringify(v));

/* ---------- 저장: 이 브라우저 + 수파베이스 ---------- */
let SB = null, tmr = null, busy = false;
const dirty = new Set(), gone = new Set();
const CS = {
  loading: ['', '저장소 연결 중…'],
  on: ['on', '수파베이스에 저장돼요. 다른 기기에서도 그대로 보여요.'],
  saving: ['', '저장 중…'],
  off: ['', '수파베이스 설정이 없어서 이 브라우저에만 저장돼요. app.js 맨 위에 주소와 키를 넣어 주세요.'],
  err: ['err', '수파베이스 저장에 실패했어요. 다음에 바꿀 때 다시 시도해요. 걱정되면 백업을 내보내 두세요.'],
  loadErr: ['err', '수파베이스에서 불러오지 못했어요. 지금은 이 브라우저에 있는 내용을 보여주고 있어요.']
};
function setCloud(s) { const e = $('#cs'); e.className = 'st ' + CS[s][0]; e.textContent = CS[s][1]; }
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
    const rows = ks.map(k => ({ id: docId(k), body: k === 'meta' ? { people: S.people, cards: S.cards } : orderDoc(k), updated_at: new Date().toISOString() }))
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
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) { setCloud('off'); return; }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
  const R = { orders: {}, cards: {}, assign: {}, people: null };
  docs.forEach(d => {
    const v = d.body || {};
    if (d.id === 'meta') { R.people = v.people; R.cards = v.cards || {}; }
    else if (d.id.startsWith('o_') && v.id) { const as = v.as || {}; delete v.as; R.orders[v.id] = v; for (const k in as) R.assign[v.id + ':' + k] = as[k]; }
  });
  // 수파베이스 내용이 기준. 이 브라우저에만 있던 주문은 올림.
  const L = S, up = []; let meta = !R.people;
  for (const id in L.orders) if (!R.orders[id]) {
    R.orders[id] = L.orders[id]; up.push(id);
    for (const k in L.assign) if (k.startsWith(id + ':')) R.assign[k] = L.assign[k];
  }
  const people = R.people || ['나'];
  (L.people || []).forEach(p => { if (!people.includes(p)) { people.push(p); meta = true; } });
  R.people = people;
  for (const d in L.cards) if (+L.cards[d] && !(+R.cards[d])) { R.cards[d] = L.cards[d]; meta = true; }
  S = R; saveLocal(); setCloud('on');
  if (meta) up.push('meta');
  if (up.length) mark(...up);
  render();
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

/* ---------- 백업 ---------- */
function exportData() {
  const data = JSON.stringify({ app: 'taobao-settle', v: 2, at: new Date().toISOString(), orders: S.orders, cards: S.cards, assign: S.assign, people: S.people });
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = 'taobao-settle-backup-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  msg('백업 파일을 내려받았어요.');
}
function importData(B) {
  if (!B || typeof B.orders !== 'object') { msg('백업 파일 형식이 아니에요.'); return; }
  const up = new Set(); let add = 0, meta = false;
  for (const id in B.orders) {
    const o = B.orders[id]; if (!o || !o.id || !Array.isArray(o.items)) continue;
    const cur = S.orders[id];
    if (!cur) { S.orders[id] = o; up.add(id); add++; continue; }
    cur.items.forEach((i, x) => {
      const j = o.items[x]; if (j && j.title === i.title) {
        if (!i.ko && j.ko) { i.ko = j.ko; up.add(id); } if (!i.optKo && j.optKo) { i.optKo = j.optKo; up.add(id); }
      }
    });
  }
  for (const k in B.assign || {}) { const v = B.assign[k]; const oid = k.split(':')[0]; if (v && S.assign[k] !== v && S.orders[oid]) { S.assign[k] = v; up.add(oid); } }
  for (const d in B.cards || {}) if (+B.cards[d] && S.cards[d] !== B.cards[d]) { S.cards[d] = B.cards[d]; meta = true; }
  (B.people || []).forEach(p => { if (typeof p === 'string' && p && !S.people.includes(p)) { S.people.push(p); meta = true; } });
  if (meta) up.add('meta');
  if (up.size) mark(...up);
  sel = null;
  msg('백업을 불러왔어요. 새 주문 ' + add + '건.');
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
const chips = (cur, attr) => S.people.map(p => '<button class="chip' + (cur === p ? ' on' : '') + '" ' + attr + ' data-p="' + esc(p) + '">' + esc(p) + '</button>').join('');
const allDates = () => [...new Set(Object.values(S.orders).map(o => o.date))].sort().reverse();

/* ---------- 화면 ---------- */
function summary(d) {
  const names = [...S.people, '미지정'], cur = {}, tot = {};
  names.forEach(n => { cur[n] = 0; tot[n] = 0; });
  allDates().forEach(dd => calc(dd).U.forEach(u => {
    const a = S.people.includes(S.assign[u.k]) ? S.assign[u.k] : '미지정';
    tot[a] += u.w; if (dd === d) cur[a] += u.w;
  }));
  return '<div class="card"><h2>사람별 지출</h2><table><tr><th></th><th>' + d + '</th><th>전체</th></tr>' +
    names.map(n => '<tr><td>' + esc(n) + '</td><td>' + won(cur[n]) + '</td><td>' + won(tot[n]) + '</td></tr>').join('') +
    '</table><div class="row"><span class="mut">사람 추가</span><span><input type="text" id="np" placeholder="이름"> <button class="sm" data-a="addp">추가</button></span></div></div>';
}
function titleRow(o, i, x) {
  const k = o.id + ':' + x;
  if (ed === k) return '<div class="ti"><input id="ek" class="wide" type="text" data-o="' + o.id + '" data-x="' + x + '" value="' + esc(i.ko || '') + '" placeholder="한국어 이름 (비우면 원문 표시)"></div><div class="zh">' + esc(i.title) + '</div>';
  return '<div class="ti"><span class="nm" title="' + esc(i.title) + '">' + esc(i.ko || i.title) + '</span><button class="lk" data-a="ed" data-k="' + k + '">수정</button></div>' +
    (i.ko ? '<div class="zh" title="' + esc(i.title) + '">' + esc(i.title) + '</div>' : '');
}
function detail(d) {
  const c = calc(d);
  const bad = c.os.filter(o => Math.abs(o.items.reduce((s, i) => s + i.price * i.qty, 0) + o.ship - o.paid) > 0.02).length;
  const need = c.os.some(o => o.items.some(i => !i.ko || (i.opt && !i.optKo)));
  let h = '<div class="card"><div class="row"><h2>' + d + '</h2>' +
    (arm === d ? '<button class="sm" data-a="del2" data-d="' + d + '">정말 삭제</button>' : '<button class="sm" data-a="del" data-d="' + d + '">이 날짜 삭제</button>') + '</div>' +
    '<div class="row"><label>카드 청구액 <input id="cd" type="number" inputmode="numeric" value="' + (c.card || '') + '" data-d="' + d + '" placeholder="0"> 원</label>' +
    '<span>' + c.os.length + '건 · ' + yu(c.tot) + (c.rate ? ' → <b>' + c.rate.toFixed(2) + '원/위안</b>' : '') + '</span></div>';
  if (c.tot < 199 || c.tot > 900) h += '<p class="wn">합계가 199~900위안 범위를 벗어났어요.</p>';
  if (bad) h += '<p class="wn">금액이 맞지 않는 주문이 ' + bad + '건 있어요. 붙여넣기에서 빠진 줄이 없는지 확인해 주세요.</p>';
  if (need || trD === d) h += '<div class="row"><span class="mut">' + esc(trD === d || trMsg ? trMsg : '상품명과 옵션을 한국어로 바꿀 수 있어요.') + '</span>' +
    '<button class="sm" data-a="tr" data-d="' + d + '"' + (trD ? ' disabled' : '') + '>' + (trD === d ? '번역 중…' : '한국어로 번역') + '</button></div>';
  else if (trMsg) h += '<p class="mut">' + esc(trMsg) + '</p>';
  h += '</div>';
  c.os.forEach(o => {
    const cnt = {}; o.items.forEach(i => cnt[i.title] = (cnt[i.title] || 0) + 1);
    h += '<div class="card"><div class="row"><b>' + esc(o.shop) + '</b><span class="mut">' + esc(o.status) + ' · ' + yu(o.paid) + (o.ship ? ' (중국 내 배송 ' + yu(o.ship) + ' 포함)' : '') + '</span></div>' +
      '<div class="row"><span class="mut">주문 전체</span><span class="chips">' + chips('', 'data-a="ord" data-o="' + o.id + '"') + '</span></div>';
    o.items.forEach((i, x) => {
      if (o.items.findIndex(j => j.title === i.title) === x) {
        h += titleRow(o, i, x);
        if (cnt[i.title] > 1) h += '<div class="row"><span class="wn">같은 상품을 옵션별로 여러 개 샀어요. 함께 산 물건일 수 있어요.</span><span class="chips">' + chips('', 'data-a="grp" data-o="' + o.id + '" data-x="' + x + '"') + '</span></div>';
      }
      c.U.filter(u => u.o.id === o.id && u.x === x).forEach(u => {
        h += '<div class="u"><span class="op" title="' + esc(i.opt) + '">' + esc(i.optKo || i.opt) + (i.qty > 1 ? ' (' + (u.u + 1) + '/' + i.qty + ')' : '') + '</span><span>' + yu(u.cny) + ' · ' + (c.card ? won(u.w) : '-') + '</span><span class="chips">' + chips(S.assign[u.k], 'data-a="as" data-k="' + u.k + '"') + '</span></div>';
      });
    });
    h += '</div>';
  });
  return h + summary(d);
}
function render() {
  const ds = allDates();
  if (!sel || !ds.includes(sel)) sel = ds[0] || null;
  $('#dl').innerHTML = ds.map(d => {
    const c = calc(d);
    return '<button class="dt' + (d === sel ? ' on' : '') + '" data-a="sel" data-d="' + d + '"><b>' + d + '</b><span>' + c.os.length + '건 · ' + yu(c.tot) + '</span><span>' + (c.card ? won(c.card) : '청구액 입력 필요') + '</span></button>';
  }).join('') || '<p class="mut">아직 주문이 없어요.</p>';
  let h = '';
  if (pend) h += '<div class="card"><b>여러 날짜가 섞여 있어요</b><p class="mut">포함할 날짜를 선택하세요. 보통 하루 단위로 결제하니, 가장 많은 날짜만 선택해 두었어요.</p>' +
    pend.ds.map(d => '<label><input type="checkbox" data-a="pd" data-d="' + d + '"' + (pend.on[d] ? ' checked' : '') + '> ' + d + ' (' + pend.c[d] + '건)</label>').join('') +
    '<div class="row"><span></span><span><button class="sm" data-a="pok">선택한 날짜 추가</button> <button class="sm" data-a="pno">취소</button></span></div></div>';
  h += sel ? detail(sel) : (pend ? '' : '<p class="mut">왼쪽에 주문 페이지를 붙여넣어 시작하세요.</p>');
  $('#dt').innerHTML = h;
  const ek = $('#ek'); if (ek) { ek.focus(); ek.select(); }
}

/* ---------- 입력 ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, D = b.dataset;
  if (a === 'pd') { pend.on[D.d] = b.checked; return; }
  if (a === 'exp') { exportData(); return; }
  if (a === 'tr') { translate(D.d); return; }
  if (a === 'parse') {
    const t = $('#t').value.trim();
    if (t) {
      let B = null; if (t[0] === '{') { try { B = JSON.parse(t); } catch (x) {} }
      if (B) importData(B); else addText(t);
      $('#t').value = '';
    }
  }
  else if (a === 'sel') { sel = D.d; arm = null; ed = null; trMsg = ''; }
  else if (a === 'ed') { ed = D.k; }
  else if (a === 'as') { S.assign[D.k] = S.assign[D.k] === D.p ? '' : D.p; mark(D.k.split(':')[0]); }
  else if (a === 'ord') { const o = S.orders[D.o]; o.items.forEach((i, x) => { for (let u = 0; u < i.qty; u++) S.assign[o.id + ':' + x + ':' + u] = D.p; }); mark(o.id); }
  else if (a === 'grp') { const o = S.orders[D.o], ti = o.items[+D.x].title; o.items.forEach((i, x) => { if (i.title === ti) for (let u = 0; u < i.qty; u++) S.assign[o.id + ':' + x + ':' + u] = D.p; }); mark(o.id); }
  else if (a === 'addp') { const v = $('#np').value.trim(); if (v && !S.people.includes(v)) { S.people.push(v); mark('meta'); } }
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
  else if (t.id === 'imf') {
    const f = t.files && t.files[0]; if (!f) return;
    f.text().then(s => { let B = null; try { B = JSON.parse(s); } catch (x) {} importData(B); render(); }).catch(() => msg('파일을 읽지 못했어요.'));
    t.value = '';
  }
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'ek' && e.key === 'Escape') { ed = null; render(); }
  else if (e.target.id === 'ek' && e.key === 'Enter') { e.target.blur(); }
  else if (e.target.id === 'np' && e.key === 'Enter') { document.querySelector('[data-a="addp"]').click(); }
});
render();
initCloud();
