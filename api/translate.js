// 버셀 서버 함수: 중국어 → 한국어 번역 (DeepL API Free)
// 버셀 환경변수 DEEPL_API_KEY 에 키를 넣어 두면 돼요. 키는 페이지에 노출되지 않아요.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const key = process.env.DEEPL_API_KEY;
  if (!key) return res.status(500).json({ error: 'no_key' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const texts = body && Array.isArray(body.texts) ? body.texts.filter(t => typeof t === 'string').slice(0, 50) : [];
  if (!texts.length) return res.status(400).json({ error: 'empty' });
  if (texts.join('').length > 20000) return res.status(413).json({ error: 'too_long' });

  // 무료 키는 끝이 ":fx" 이고 api-free 주소를 써요
  const host = key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  try {
    const r = await fetch(host + '/v2/translate', {
      method: 'POST',
      headers: { 'Authorization': 'DeepL-Auth-Key ' + key.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texts, source_lang: 'ZH', target_lang: 'KO' })
    });
    if (!r.ok) {
      const error = r.status === 456 ? 'quota' : r.status === 403 ? 'auth' : 'deepl';
      return res.status(r.status).json({ error });
    }
    const j = await r.json();
    return res.status(200).json({ translations: (j.translations || []).map(t => t.text) });
  } catch (e) {
    return res.status(502).json({ error: 'network' });
  }
};
