// E2：音频 A 路验证（原生 loopback：setDisplayMediaRequestHandler + AnalyserNode）
//
// E2 分两路：A=Electron 原生 Windows loopback（本探针）；B=media-bridge exe（A 路失败才评估）。
// 判据（docs/23 §7 E2）：getDisplayMedia 拿到 audio track；自放正弦波 440/880Hz 后，
//   AnalyserNode 峰值频率跟得上、停声后能量塌陷（对照臂，防「分析器读的是死数据」）。
// 渲染层全部输出经 console 转发进 log.jsonl（主进程时钟 + 渲染层自带 t）。
//
// 纪律：只操作自己创建的窗口；绝无 taskkill；声音为 0.12 增益的 440/880Hz 短音（共约 3.5s）。

import { app, BrowserWindow, desktopCapturer, session } from 'electron';
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
let quitting = false;
function finish(reason) {
  if (quitting) return;
  quitting = true;
  log({ ev: 'finish', reason });
  setTimeout(() => app.quit(), 1200);
}

app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      log({
        ev: 'gdm-request',
        video: request.videoRequested,
        audio: request.audioRequested,
        origin: request.securityOrigin,
      });
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      log({ ev: 'gdm-sources', n: sources.length, first: sources[0]?.name });
      callback({ video: sources[0], audio: 'loopback' });
    },
    { useSystemPicker: false },
  );

  win = new BrowserWindow({
    width: 760,
    height: 420,
    x: 120,
    y: 120,
    show: true,
    autoHideMenuBar: true,
    title: 'E2 audio probe',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  win.webContents.on('console-message', (...args) => {
    const msg = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0].message : args[2];
    log({ ev: 'renderer', msg });
    if (typeof msg === 'string' && (msg.includes('E2 done') || msg.includes('E2 fail'))) finish('renderer-sentinel');
  });

  // 每 500ms 采一次进程级 CPU/内存（A 路成本基线用）
  const metrics = setInterval(() => {
    for (const m of app.getAppMetrics()) {
      log({
        ev: 'metric',
        type: m.type,
        pid: m.pid,
        cpu: Number((m.cpu?.percentCPUUsage ?? 0).toFixed(1)),
        memMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024),
      });
    }
  }, 500);

  setTimeout(() => finish('hard-timeout-30s'), 30000);

  await win.loadFile(join(HERE, 'page.html'));
  log({ ev: 'loaded' });

  win.on('closed', () => clearInterval(metrics));
});

app.on('will-quit', () => log({ ev: 'will-quit' }));
