// 버셀 서버 함수: 예약 작업용 — 배송 중인 소포의 관세청 통관 단계를 조회해서 수파베이스에 저장
// PC가 꺼져 있어도 깃허브 예약 작업(.github/workflows/customs.yml)이 1시간마다 이 주소를 불러요.
// 필요한 버셀 환경변수:
//   UNIPASS_API_KEY      관세청 유니패스 인증키
//   SUPABASE_SECRET_KEY  수파베이스 비밀 키 (Project Settings → API Keys 의 Secret key) — 서버에서만 씀
//   CRON_TOKEN           아무 긴 문자열. 깃허브 Secrets 의 CRON_TOKEN 과 같아야 함
const { lookup, isDone } = require('../lib/unipass.js');
const TABLE = 'tb_docs', SCHEMA = 'money';

async function supa(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https');
  const t = await (await fetch(proto + '://' + req.headers.host + '/config.js')).text();
  const url = (t.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)['"]/) || [])[1];
  if (!url) throw new Error('config.js 에서 SUPABASE_URL 을 찾지 못했어요');
  const key = process.env.SUPABASE_SECRET_KEY;
  const h = { apikey: key, 'Accept-Profile': SCHEMA, 'Content-Profile': SCHEMA, 'Content-Type': 'application/json' };
  if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key;  // 예전 형식(service_role JWT) 키
  return {
    get: async path => { const r = await fetch(url.replace(/\/+$/, '') + '/rest/v1/' + path, { headers: h }); if (!r.ok) throw new Error('읽기 실패 ' + r.status); return r.json(); },
    upsert: async rows => { const r = await fetch(url.replace(/\/+$/, '') + '/rest/v1/' + TABLE, { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, h), body: JSON.stringify(rows) }); if (!r.ok) throw new Error('저장 실패 ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
  };
}

// 정산 사이트(app.js parcels)와 같은 방식으로 소포를 묶고 조회할 번호를 고름
function parcels(ships) {
  const g = {};
  ships.forEach(s => { const k = s.pk ? 'p' + s.pk : 'o' + s.id; (g[k] = g[k] || []).push(s); });
  return Object.values(g).map(os => {
    const nos = os.map(s => s.no).filter(Boolean), one = [...new Set(nos)];
    const io = os.find(s => s.no && s.stage >= 2 && /集运|国际|韩国|菜鸟|CJ|大韩|韩进|乐天|EMS|海外/.test(s.ex || ''));
    const intl = (os.length > 1 && one.length === 1 && nos.length === os.length) ? one[0] : io ? io.no : '';
    const kr = (os.find(s => s.kr) || {}).kr || intl;
    const cus = (os.find(s => s.cus) || {}).cus || null;
    return { os, kr, cus, got: os.every(s => s.got), stage: Math.min(...os.map(s => s.stage)) };
  });
}

module.exports = async (req, res) => {
  const tok = process.env.CRON_TOKEN;
  if (!tok || (req.headers.authorization || '') !== 'Bearer ' + tok) return res.status(401).json({ error: 'unauthorized' });
  if (!process.env.UNIPASS_API_KEY) return res.status(500).json({ error: 'no UNIPASS_API_KEY' });
  if (!process.env.SUPABASE_SECRET_KEY) return res.status(500).json({ error: 'no SUPABASE_SECRET_KEY' });
  const out = { checked: 0, saved: 0, skipped: 0, errors: [] };
  try {
    const db = await supa(req);
    const rows = await db.get(TABLE + '?select=id,body&id=like.s_*');
    const ships = rows.map(r => r.body).filter(b => b && b.id);
    const todo = parcels(ships).filter(p => p.kr && !p.got && p.stage >= 2 && !isDone(p.cus)).slice(0, 20);
    const save = [];
    for (const p of todo) {
      out.checked++;
      try {
        const yy = ((p.os[0].pk || p.os[0].date || '') + '').slice(0, 4) || new Date().getFullYear();
        const v = Object.assign(await lookup(process.env.UNIPASS_API_KEY, p.kr, yy), { at: Date.now(), hbl: p.kr, by: 'cron' });
        p.os.forEach(s => save.push({ id: 's_' + s.id, body: Object.assign({}, s, { cus: v }), updated_at: new Date().toISOString() }));
      } catch (e) { out.errors.push(p.kr + ': ' + (e.message || e)); }
    }
    if (save.length) { await db.upsert(save); out.saved = save.length; }
    out.skipped = ships.length - save.length;
    return res.status(200).json(out);
  } catch (e) {
    out.errors.push(e.message || String(e));
    return res.status(500).json(out);
  }
};
