// 버셀 서버 함수: 관세청 유니패스 화물통관진행정보 조회 (House B/L 번호로)
// 버셀 환경변수 UNIPASS_API_KEY 에 유니패스에서 발급받은 인증키를 넣어 두면 돼요.
const tag = (xml, name) => { const m = xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>')); return m ? m[1].trim() : ''; };
const blocks = (xml, name) => xml.match(new RegExp('<' + name + '>[\\s\\S]*?</' + name + '>', 'g')) || [];
const dt = s => {  // 20260914171700 → 2026-09-14 17:17
  s = (s || '').replace(/\D/g, '');
  if (s.length < 8) return '';
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + (s.length >= 12 ? ' ' + s.slice(8, 10) + ':' + s.slice(10, 12) : '');
};

async function query(key, hbl, yy) {
  const url = 'https://unipass.customs.go.kr:38010/ext/rest/cargCsclPrgsInfoQry/retrieveCargCsclPrgsInfo?crkyCn=' + encodeURIComponent(key) +
    '&hblNo=' + encodeURIComponent(hbl) + '&blYy=' + yy;
  const r = await fetch(url);
  const xml = await r.text();
  return xml;
}

module.exports = async (req, res) => {
  const key = process.env.UNIPASS_API_KEY;
  if (!key) return res.status(500).json({ error: 'no_key' });
  const hbl = String((req.query && req.query.hbl) || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  let yy = +((req.query && req.query.yy) || new Date().getFullYear());
  if (!hbl) return res.status(400).json({ error: 'empty' });
  try {
    let xml = await query(key, hbl, yy), cnt = +tag(xml, 'tCnt') || 0;
    if (!cnt) { const x2 = await query(key, hbl, yy - 1); if (+tag(x2, 'tCnt') > 0) { xml = x2; cnt = +tag(x2, 'tCnt'); yy = yy - 1; } }
    const notice = tag(xml, 'ntceInfo');
    if (!cnt) return res.status(200).json({ found: false, note: notice || '아직 관세청에 등록되지 않았어요. 한국에 도착해서 입항 신고가 되면 조회돼요.' });
    if (cnt > 1) {
      // 같은 번호로 여러 화물이 나오는 경우: 목록만 돌려줌
      return res.status(200).json({ found: true, multi: true, list: blocks(xml, 'cargCsclPrgsInfoQryVo').map(b => ({ cargMtNo: tag(b, 'cargMtNo'), status: tag(b, 'csclPrgsStts'), name: tag(b, 'prnm') })) });
    }
    const main = blocks(xml, 'cargCsclPrgsInfoQryVo')[0] || xml;
    const steps = blocks(xml, 'cargCsclPrgsInfoDtlQryVo').map(b => ({
      t: dt(tag(b, 'prcsDttm')),
      kind: tag(b, 'cargTrcnRelaBsopTpcd'),
      place: tag(b, 'shedNm'),
      note: tag(b, 'rlbrCn') || tag(b, 'bfhnGdncCn')
    })).filter(s => s.kind || s.t).sort((a, b) => (a.t < b.t ? 1 : -1));
    return res.status(200).json({
      found: true, yy,
      status: tag(main, 'csclPrgsStts'),      // 통관진행상태 (예: 반출완료, 수입신고수리)
      prgs: tag(main, 'prgsStts'),            // 진행상태
      name: tag(main, 'prnm'),                // 품명
      arrived: dt(tag(main, 'etprDt')),       // 입항일
      port: tag(main, 'dsprNm'),              // 양륙항
      forwarder: tag(main, 'frwrEntsConm'),   // 특송업체(포워더)
      carrier: tag(main, 'shcoFlco'),         // 선사/항공사
      count: tag(main, 'pckGcnt'), weight: tag(main, 'ttwg'),
      updated: dt(tag(main, 'prcsDttm')),
      steps
    });
  } catch (e) {
    return res.status(502).json({ error: 'network' });
  }
};
