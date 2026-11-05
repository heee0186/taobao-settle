const $ = s => document.querySelector(s);
const send = m => new Promise(r => chrome.runtime.sendMessage(m, r));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const t = ms => { if (!ms) return '-'; const d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const EV = { 60: '1시간', 180: '3시간', 360: '6시간', 720: '12시간' };

async function draw(note) {
  const s = await send({ cmd: 'status' });
  let h = '<h1>타오바오 배송 자동 확인</h1>';
  if (!s.email) {
    h += '<p class="mut">정산 사이트와 같은 계정으로 한 번 로그인해 주세요. 비밀번호는 저장하지 않아요.</p>' +
      '<form id="lf"><label>이메일</label><input id="em" type="email" required><label>비밀번호</label><input id="pw" type="password" required>' +
      '<button class="go" id="lb">로그인</button></form>' + (note ? '<p class="err">' + esc(note) + '</p>' : '');
  } else {
    const L = s.last;
    h += '<div class="box">' + (s.running ? '지금 확인하는 중이에요…' : L ? (L.ok
      ? '마지막 확인 <b>' + t(L.at) + '</b><br><span class="mut">주문 ' + L.targets + '건 확인 · ' + L.saved + '건 저장' + (L.fail ? ' · ' + L.fail + '건 실패' : '') + '</span>' + (L.note ? '<br><span class="err">' + esc(L.note) + '</span>' : '')
      : '<span class="err">마지막 확인 실패 (' + t(L.at) + ')<br>' + esc(L.error) + '</span>') : '아직 확인한 적이 없어요.') +
      '</div><div class="row"><span class="mut">다음 확인 ' + t(s.next) + ' · ' + (EV[s.every] || s.every + '분') + '마다</span></div>' +
      '<button class="go" id="rn"' + (s.running ? ' disabled' : '') + '>지금 확인</button>' + (note ? '<p class="err">' + esc(note) + '</p>' : '') +
      '<details><summary>설정</summary><label>확인 간격</label><select id="ev">' + Object.keys(EV).map(k => '<option value="' + k + '"' + (+k === s.every ? ' selected' : '') + '>' + EV[k] + '마다</option>').join('') + '</select>' +
      '<label>정산 사이트 주소</label><input id="st" value="' + esc(s.site) + '"><button class="go" id="sv">설정 저장</button>' +
      '<div class="row" style="margin-top:10px"><span class="mut">' + esc(s.email) + '</span><button class="txt" id="lo">로그아웃</button></div></details>';
  }
  $('#app').innerHTML = h;
  const lf = $('#lf');
  if (lf) lf.onsubmit = async e => {
    e.preventDefault(); $('#lb').disabled = true; $('#lb').textContent = '확인 중…';
    const r = await send({ cmd: 'login', email: $('#em').value.trim(), password: $('#pw').value });
    draw(r && r.error ? r.error : '');
  };
  if ($('#rn')) $('#rn').onclick = async () => {
    $('#rn').disabled = true; $('#rn').textContent = '확인 중… (주문 수에 따라 몇십 초)';
    const r = await send({ cmd: 'run' });
    draw(r && r.error ? r.error : '');
  };
  if ($('#sv')) $('#sv').onclick = async () => { await send({ cmd: 'settings', every: $('#ev').value, site: $('#st').value.trim() }); draw('설정을 저장했어요.'); };
  if ($('#lo')) $('#lo').onclick = async () => { await send({ cmd: 'logout' }); draw(); };
}
draw();
