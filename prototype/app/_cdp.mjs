// P1 原型 CDP 驱动：eval / shot / close（对照工作区 `_shot.mjs` 的管线，独立端口 9223）
// 用法：
//   node _cdp.mjs eval "<expr>"            # Runtime.evaluate，returnByValue
//   node _cdp.mjs shot <out.png>           # Page.captureScreenshot
//   node _cdp.mjs close                    # Browser.close（规范收尾；随后验端口）
// 纪律：收尾一律走 Browser.close，绝不 taskkill 按映像名。
import { writeFileSync } from 'node:fs';

const PORT = process.env.PROTO_PORT || '9223';
const [, , cmd, arg, arg2] = process.argv;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) {
  console.error('no page target:', JSON.stringify(targets.map((t) => [t.type, t.url])));
  process.exit(1);
}

if (cmd === 'close') {
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const myId = ++id;
  pending.set(myId, resolve);
  ws.send(JSON.stringify({ id: myId, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));

if (cmd === 'eval') {
  const res = await send('Runtime.evaluate', { expression: arg, returnByValue: true, awaitPromise: true, timeout: 30000 });
  const r = res.result;
  if (r.exceptionDetails) { console.error('EXCEPTION', JSON.stringify(r.exceptionDetails).slice(0, 800)); process.exit(2); }
  console.log(JSON.stringify(r.result?.value ?? r.result, null, 1));
} else if (cmd === 'shot') {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (!shot.result?.data) { console.error('screenshot failed:', JSON.stringify(shot).slice(0, 400)); process.exit(1); }
  writeFileSync(arg || 'shot.png', Buffer.from(shot.result.data, 'base64'));
  console.log('saved', arg || 'shot.png');
} else if (cmd === 'front') {
  const res = await send('Page.bringToFront', {});
  console.log('bringToFront', res.error ? JSON.stringify(res.error) : 'ok');
} else if (cmd === 'mouse') {
  const x = Number(arg), y = Number(arg2);
  if (!Number.isFinite(x) || !Number.isFinite(y)) { console.error('usage: node _cdp.mjs mouse <x> <y>'); process.exit(2); }
  const res = await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers: 0 });
  console.log('mouse', x, y, res.error ? JSON.stringify(res.error) : 'ok');
} else if (cmd === 'click') {
  const x = Number(arg), y = Number(arg2);
  if (!Number.isFinite(x) || !Number.isFinite(y)) { console.error('usage: node _cdp.mjs click <x> <y>'); process.exit(2); }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  const p = await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  const r = await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  console.log('click', x, y, p.error || r.error ? JSON.stringify(p.error || r.error) : 'ok');
} else {
  console.error('usage: node _cdp.mjs eval "<expr>" | shot <out.png> | close');
  process.exit(2);
}
process.exit(0);
