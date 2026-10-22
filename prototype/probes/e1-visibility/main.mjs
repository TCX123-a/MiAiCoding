// E1：Electron 可见性语义实测（最小化/失焦/隐藏/恢复的「事件 → 渲染停摆」时间表）
//
// 自驱动时序（相对 window 加载完成）：minimize@2s → restore@5s → hide@8s → show@11s
//   → 第二窗口抢焦点（触发 blur）@14s → 关第二窗回焦点@17s → quit@21s
// 输出：log.jsonl —— 主进程事件（main:*）与渲染层 console 转发（renderer）统一打主进程时钟。
// 渲染层自带 rAF/interval 计数（R 行），可读出「最后一次出帧」的精确时间。
//
// 纪律：本脚本只操作自己创建的窗口，绝不 taskkill、绝不碰其它进程。

import { app, BrowserWindow } from 'electron';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = join(HERE, 'log.jsonl');
writeFileSync(LOG, '');

const t0 = performance.now();
function log(obj) {
  appendFileSync(LOG, JSON.stringify({ t: Number(((performance.now() - t0) / 1000).toFixed(3)), ...obj }) + '\n');
}

let win = null;
let win2 = null;

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 900,
    height: 600,
    x: 80,
    y: 80,
    show: true,
    autoHideMenuBar: true,
    title: 'E1 visibility probe',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  // Electron 44 的事件对象签名；兼容旧三元组 (event, level, message)
  win.webContents.on('console-message', (...args) => {
    const msg = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0].message : args[2];
    log({ ev: 'renderer', msg });
  });

  for (const ev of ['minimize', 'restore', 'hide', 'show', 'blur', 'focus', 'closed']) {
    win.on(ev, () => log({ ev: `main:${ev}` }));
  }

  await win.loadFile(join(HERE, 'page.html'));
  log({ ev: 'loaded' });

  const at = (ms, label, fn) =>
    setTimeout(() => {
      log({ ev: 'step', label });
      try {
        fn();
      } catch (e) {
        log({ ev: 'step-error', label, msg: String(e) });
      }
    }, ms);

  at(2000, 'win.minimize()', () => win.minimize());
  at(5000, 'win.restore()+focus()', () => {
    win.restore();
    win.focus();
  });
  at(8000, 'win.hide()', () => win.hide());
  at(11000, 'win.show()+focus()', () => {
    win.show();
    win.focus();
  });
  at(14000, 'second-window focus', () => {
    win2 = new BrowserWindow({
      width: 320,
      height: 200,
      x: 1000,
      y: 80,
      show: true,
      autoHideMenuBar: true,
      title: 'E1 second',
    });
    win2.loadURL('data:text/html,<h3>E1 second window</h3>');
    win2.once('ready-to-show', () => win2.focus());
  });
  at(17000, 'close second window', () => {
    try {
      win2?.close();
    } catch {}
    win?.focus();
  });
  at(21000, 'quit', () => {
    log({ ev: 'done' });
    app.quit();
  });
});

app.on('will-quit', () => log({ ev: 'will-quit' }));
