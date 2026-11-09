// 버셀 서버 함수: 관세청 유니패스 화물통관진행정보 조회 (House B/L 번호로)
// 버셀 환경변수 UNIPASS_API_KEY 에 유니패스에서 발급받은 인증키를 넣어 두면 돼요.
const { lookup, isDone } = require('../lib/unipass.js');
const { trackDomestic } = require('../lib/domestic.js');
module.exports = async (req, res) => {
  const key = process.env.UNIPASS_API_KEY;
  if (!key) return res.status(500).json({ error: 'no_key' });
  const q = req.query || {};
  if (!q.hbl) return res.status(400).json({ error: 'empty' });
  try {
    const v = await lookup(key, q.hbl, q.yy);
    if (isDone(v)) v.dom = await trackDomestic(q.hbl);  // 반출 뒤에는 국내 택배까지
    return res.status(200).json(v);
  }
  catch (e) { return res.status(e.code === 'empty' ? 400 : 502).json({ error: e.code || 'network' }); }
};
