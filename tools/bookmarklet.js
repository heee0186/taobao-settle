/* 타오바오 물류 가져오기 — 已买到的宝贝 화면에서 실행하는 북마크 버튼
   화면에 보이는 주문들의 물류 기록을 타오바오에 하나씩(천천히) 물어보고,
   정산 사이트에 붙여넣을 내용을 만들어 줘요. 아무것도 바꾸거나 누르지 않아요. */
(async () => {
  if (window.__tbShipRunning) return;
  if (!/(^|\.)taobao\.com$/.test(location.hostname)) { alert('타오바오 已买到的宝贝 화면에서 눌러 주세요.'); return; }
  window.__tbShipRunning = true;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;right:20px;top:20px;width:340px;padding:18px;background:#fff;color:#18202b;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:14px/1.5 "Malgun Gothic",sans-serif';
  const say = h => { box.innerHTML = '<div style="font-weight:700;margin-bottom:6px">타오바오 물류 가져오기</div>' + h; };
  document.body.appendChild(box);
  const close = () => { box.remove(); window.__tbShipRunning = false; };

  const txt = document.body.innerText;
  const ms = [...txt.matchAll(/(\d{4}-\d{2}-\d{2})\s*订单号[:：]\s*(\d+)/g)];
  const seen = new Set(), list = [];
  ms.forEach((m, i) => {
    if (seen.has(m[2])) return; seen.add(m[2]);
    const chunk = txt.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : txt.length);
    const L = chunk.split('\n').map(s => s.trim()).filter(Boolean);
    const shop = (L.find(l => !/^(天猫|淘宝|\d+)$/.test(l)) || '').replace(/订单详情.*$/, '').replace(/^天猫\s*/, '').trim();
    const tl = L.find(l => /\[交易快照\]$/.test(l)) || '';
    list.push({ id: m[2], date: m[1], shop, title: tl.replace(/\s*\[交易快照\]$/, '') });
  });
  if (!list.length) { say('이 화면에서 주문을 찾지 못했어요. 已买到的宝贝(구매한 상품) 화면에서 눌러 주세요.<div style="text-align:right;margin-top:10px"><button id="tbx">닫기</button></div>'); box.querySelector('#tbx').onclick = close; return; }

  const wait = ms2 => new Promise(r => setTimeout(r, ms2));
  let fail = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    say('주문 ' + (i + 1) + ' / ' + list.length + ' 물류 확인 중…<div style="height:6px;background:#eee;border-radius:3px;margin-top:10px"><div style="height:6px;border-radius:3px;background:#0f766e;width:' + Math.round((i / list.length) * 100) + '%"></div></div>');
    try {
      const r = await fetch('/trade/json/transit_step.do?bizOrderId=' + o.id, { method: 'POST', credentials: 'include' });
      const j = JSON.parse(new TextDecoder('gbk').decode(await r.arrayBuffer()));
      o.ex = j.expressName || ''; o.no = j.expressId || '';
      o.st = (j.address || []).map(a => ({ t: a.time, p: a.place }));
    } catch (e) { o.err = 1; fail++; }
    await wait(450);
  }
  const data = JSON.stringify({ app: 'tb-logistics', v: 1, at: new Date().toISOString(), orders: list });
  say('주문 ' + list.length + '건의 물류를 가져왔어요' + (fail ? ' (' + fail + '건 실패)' : '') + '.<br>아래 버튼으로 복사한 뒤 정산 사이트 입력칸에 붙여넣으세요.' +
    '<textarea id="tbt" readonly style="width:100%;height:60px;margin-top:10px;font-size:11px"></textarea>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button id="tbx" style="padding:6px 12px">닫기</button><button id="tbc" style="padding:6px 14px;background:#0f766e;color:#fff;border:0;border-radius:8px;font-weight:700">복사하기</button></div>');
  const ta = box.querySelector('#tbt'); ta.value = data;
  box.querySelector('#tbx').onclick = close;
  box.querySelector('#tbc').onclick = async e => {
    let ok = false;
    try { await navigator.clipboard.writeText(data); ok = true; } catch (x) { ta.select(); try { ok = document.execCommand('copy'); } catch (y) {} }
    e.target.textContent = ok ? '복사됐어요' : '직접 복사해 주세요 (Ctrl+C)';
    if (!ok) { ta.focus(); ta.select(); }
  };
})();
