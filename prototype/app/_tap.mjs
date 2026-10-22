// E4 控制台/违规捕获（CDP）：开 Runtime + Log 域 → 可选执行 expr → 收集 N 秒内全部
// console / 异常 / Log（含 CSP 违规 source=security）事件 → 落 JSON。
// 用法：node _tap.mjs <out.json> <seconds> [expr]
// 收尾仍走 _cdp.mjs close（Browser.close）；本工具只读事件，唯一副作用是 expr。
import { writeFileSync } from 'node:fs';

const PORT = process.env.PROTO_PORT || '9223';
const [, , outFile, secsArg, expr] = process.argv;
const secs = Number(secsArg) || 10;
if (!outFile) { console.error('usage: node _tap.mjs <out.json> <seconds> [expr]'); process.exit(2); }

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) { console.error('no page target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || [])
      .map((x) => (x.value !== undefined ? String(x.value) : x.description || x.type))
      .join(' ').slice(0, 600);
    events.push({ t: Date.now(), src: `console.${msg.params.type}`, text });
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails || {};
    const text = String((d.exception && d.exception.description) || d.text || '').slice(0, 600);
    events.push({ t: Date.now(), src: 'exception', text });
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry || {};
    events.push({ t: Date.now(), src: `log.${e.source}.${e.level}`, text: String(e.text || '').slice(0, 600) });
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const myId = ++id;
  pending.set(myId, resolve);
  ws.send(JSON.stringify({ id: myId, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Log.enable');
if (expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 30000 });
  const v = r.result && r.result.result ? r.result.result.value : undefined;
  console.error('expr ->', JSON.stringify(v ?? (r.result && r.result.exceptionDetails) ?? null).slice(0, 400));
}
await new Promise((r) => setTimeout(r, secs * 1000));
writeFileSync(outFile, JSON.stringify(events, null, 1));
console.log('tapped', events.length, 'events in', secs + 's ->', outFile);
process.exit(0);
