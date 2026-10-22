// E4 探针注入器：向 <场景目录>/scene.json 内每个 "script" 字符串末尾追加探针语句
//（追加在尾部，'use strict' 指令序言仍在最前）。
//
// 关键事实（webwallgl.mjs:25674 scriptToFunctionBody / 25930 sandboxGlobal）：
// 脚本沙箱把 globalThis/self/window 三个形参都绑到假对象 {console}（console 还是全空操作的），
// 所以探针不能用 globalThis / console —— 必须从对象字面量的真内部槽
// ({ }).constructor.constructor 拿真 Function 逃逸回页面真 window，再写 __scriptProbe。
// 没有 CSP 或带 'unsafe-eval' 时逃逸成立；无 unsafe-eval 时外层 new Function 先抛 EvalError，
// 脚本体根本不会执行（探针=0 即种坏臂的正确红色）。
//
// 用法：node _inject-probe.mjs <场景目录> [标记前缀]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = String(process.argv[2] || '').replace(/\/+$/, '');
const tag = String(process.argv[3] || dir.split('/').filter(Boolean).pop() || 'probe');
if (!dir) { console.error('usage: node _inject-probe.mjs <sceneDir> [tag]'); process.exit(2); }

const file = join(dir, 'scene.json');
const json = JSON.parse(readFileSync(file, 'utf8'));
let n = 0;
const probeFor = (i) =>
  `\ntry{var __pg=({}).constructor.constructor('return globalThis')();` +
  `__pg.__scriptProbe=(__pg.__scriptProbe||0)+1;` +
  `(__pg.__scriptProbeLog=__pg.__scriptProbeLog||[]).push('${tag}#${i}');}catch(e){}\n`;

const walk = (o) => {
  if (Array.isArray(o)) { for (const v of o) walk(v); return; }
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) {
      if (k === 'script' && typeof o[k] === 'string') { o[k] += probeFor(n); n++; }
      else walk(o[k]);
    }
  }
};
walk(json);
writeFileSync(file, JSON.stringify(json, null, '\t'));
console.log('injected', n, 'probe(s) into', file, '| tag =', tag);
