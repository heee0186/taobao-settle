// 국내 택배 조회 — 관세청 반출 뒤 국내 택배사 구간
// 타오바오 공식 직배송(티와이로지스)은 CJ대한통운 글로벌직구팀으로 넘어가서, 합배송 운송장 번호 그대로 CJ에서 조회돼요.
// 다른 택배사로 넘어가는 경우가 생기면 여기에 택배사를 하나씩 추가하면 돼요.
const CJ = {
  name: 'CJ대한통운',
  link: no => 'https://trace.cjlogistics.com/next/tracking.html?wblNo=' + encodeURIComponent(no),
  async track(no) {
    const r = await fetch('https://trace.cjlogistics.com/next/rest/selectTrackingDetailList.do', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      body: 'paramInvcNo=' + encodeURIComponent(no) + '&wblNo=' + encodeURIComponent(no)
    });
    const j = await r.json().catch(() => null);
    const list = (j && j.data && j.data.svcOutList) || [];
    return list.map(x => ({
      t: (x.workDt || '') + ' ' + (x.workHms || '').slice(0, 5),
      kind: x.crgStDnm || '',
      place: x.branNm || '',
      note: x.crgStDcdVal || ''
    })).filter(x => x.kind).sort((a, b) => (a.t < b.t ? 1 : -1));
  }
};
const CARRIERS = [CJ];

async function trackDomestic(no) {
  no = String(no || '').replace(/[^0-9A-Za-z]/g, '');
  if (!no) return null;
  for (const c of CARRIERS) {
    try {
      const steps = await c.track(no);
      if (steps.length) {
        const done = steps.some(s => /배달완료|배송완료/.test(s.kind));
        return { found: true, carrier: c.name, link: c.link(no), steps, done, status: steps[0].kind, at: Date.now() };
      }
    } catch (e) { /* 다음 택배사 시도 */ }
  }
  return { found: false, at: Date.now() };
}
module.exports = { trackDomestic };
