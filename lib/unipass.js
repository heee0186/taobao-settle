// 관세청 유니패스 화물통관진행정보 조회 (House B/L 번호로) — api/customs.js 와 api/cron-customs.js 가 같이 씀
const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>')); return m ? m[1].trim() : ''; };
const blocks = (xml, name) => xml.match(new RegExp('<' + name + '>[\\s\\S]*?</' + name + '>', 'g')) || [];
const dt = s => {  // 20260914171700 → 2026-09-14 17:17
  s = (s || '').replace(/\D/g, '');
  if (s.length < 8) return '';
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + (s.length >= 12 ? ' ' + s.slice(8, 10) + ':' + s.slice(10, 12) : '');
};
const BASE = 'https://unipass.customs.go.kr:38010/ext/rest/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo?crkyCn=';
async function query(key, hbl, yy) {
  return (await fetch(BASE + encodeURIComponent(key) + '&hblNo=' + encodeURIComponent(hbl) + '&blYy=' + yy)).text();
}
async function queryCarg(key, cargMtNo) {  // 화물관리번호로 조회 (상세 단계 포함)
  return (await fetch(BASE + encodeURIComponent(key) + '&cargMtNo=' + encodeURIComponent(cargMtNo))).text();
}
// 결과: { found:false, note } | { found:true, multi:true, list } | { found:true, status, prgs, ..., steps }
async function lookup(key, hblRaw, yyRaw) {
  const hbl = String(hblRaw || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  let yy = +(yyRaw || new Date().getFullYear());
  if (!hbl) throw Object.assign(new Error('empty'), { code: 'empty' });
  let xml = await query(key, hbl, yy), cnt = +tag(xml, 'tCnt') || 0;
  if (!cnt) { const x2 = await query(key, hbl, yy - 1); if (+tag(x2, 'tCnt') > 0) { xml = x2; cnt = +tag(x2, 'tCnt'); yy = yy - 1; } }
  const notice = tag(xml, 'ntceInfo');
  if (!cnt) return { found: false, note: notice || '아직 관세청에 등록되지 않았어요. 한국에 도착해서 입항 신고가 되면 조회돼요.' };
  // tCnt 가 1보다 커도 화물이 하나일 수 있어서, 실제 화물 블록 수로 판단
  let mains = blocks(xml, 'cargCsclPrgsInfoQryVo');
  if (mains.length > 1) return { found: true, multi: true, list: mains.map(b => ({ cargMtNo: tag(b, 'cargMtNo'), status: tag(b, 'csclPrgsStts'), name: tag(b, 'prnm') })) };
  // 상세 단계가 안 왔으면 화물관리번호로 한 번 더 조회
  if (!blocks(xml, 'cargCsclPrgsInfoDtlQryVo').length && mains[0] && tag(mains[0], 'cargMtNo')) {
    const x3 = await queryCarg(key, tag(mains[0], 'cargMtNo'));
    if (blocks(x3, 'cargCsclPrgsInfoQryVo').length) { xml = x3; mains = blocks(x3, 'cargCsclPrgsInfoQryVo'); }
  }
  const main = mains[0] || xml;
  const steps = blocks(xml, 'cargCsclPrgsInfoDtlQryVo').map(b => ({
    t: dt(tag(b, 'prcsDttm')), kind: tag(b, 'cargTrcnRelaBsopTpcd'), place: tag(b, 'shedNm'), note: tag(b, 'rlbrCn') || tag(b, 'bfhnGdncCn')
  })).filter(x => x.kind || x.t).sort((a, b) => (a.t < b.t ? 1 : -1));
  return {
    found: true, yy,
    status: tag(main, 'csclPrgsStts'), prgs: tag(main, 'prgsStts'), name: tag(main, 'prnm'),
    arrived: dt(tag(main, 'etprDt')), port: tag(main, 'dsprNm'), forwarder: tag(main, 'frwrEntsConm'), carrier: tag(main, 'shcoFlco'),
    count: tag(main, 'pckGcnt'), weight: tag(main, 'ttwg'), updated: dt(tag(main, 'prcsDttm')), cargMtNo: tag(main, 'cargMtNo'), steps
  };
}
const isDone = c => !!c && /반출/.test((c.status || '') + ' ' + (c.prgs || '') + ' ' + ((c.steps || [])[0] || {}).kind);
module.exports = { lookup, isDone };
