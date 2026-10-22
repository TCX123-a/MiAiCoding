// P1 原型主进程：Steam 扫描 → 定位当前壁纸 → miai-wall:// 协议 → 窗口 + 可见性推送 + 台账
//
// 纪律：不碰主工程 src/；不装全局依赖；日志只写 prototype/app/ 内。
// 启动（Git Bash，注意先摘掉 ELECTRON_RUN_AS_NODE）：
//   unset ELECTRON_RUN_AS_NODE
//   MSYS_NO_PATHCONV=1 ./node_modules/electron/dist/electron.exe \
//     ./prototype/app/main.mjs --user-data-dir=./prototype/.userdata
//   （在仓库根目录执行；相对路径不会触发 MSYS 的路径改写）

import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installWallProtocol, registerWallSchemePrivileges } from './protocol.mjs';
import { librariesOwningWE, locateWallpaperEngine, steamProbeDirs, toPosix } from '../lib/steam/locate.mjs';
import { readSelectedWallpapers, scanWallpapers } from '../lib/steam/scan.mjs';

registerWallSchemePrivileges(); // 必须早于 app ready

// CDP 调试口（截图/驱动用）：PROTO_DEBUG=1 时开
if (process.env.PROTO_DEBUG === '1') {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.PROTO_PORT || '9223');
}

const HERE = dirname(fileURLToPath(import.meta.url));
const PERF_LOG = join(HERE, 'perf-log.jsonl');
const PROTO_LOG = join(HERE, 'proto-log.jsonl');
const CACHE_DIR = join(HERE, 'cache');
mkdirSync(CACHE_DIR, { recursive: true });
writeFileSync(PERF_LOG, '');
writeFileSync(PROTO_LOG, '');

// E4 三臂：PROTO_CSP=1 → 出货 CSP（docs/23 §2.2 逐字）；PROTO_CSP=noeval → 同文本
// 去掉 'unsafe-eval'（种坏对照臂：引擎 new Function 编译作者脚本必被拒）。空 = 现状无 CSP。
const CSP_FULL = "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: miai-wall:; media-src 'self' blob: miai-wall:; font-src 'self' data: blob:; connect-src 'self' miai-wall:; frame-src 'self' blob: miai-wall:; worker-src 'self' blob:";
const CSP_ARM = process.env.PROTO_CSP || '';
appendFileSync(PERF_LOG, JSON.stringify({ t: -1, kind: 'csp-arm', arm: CSP_ARM || '(none)' }) + '\n');
function pageHtmlPath() {
  if (!CSP_ARM) return join(HERE, 'renderer', 'index.html');
  const csp = CSP_ARM === 'noeval' ? CSP_FULL.replace(" 'unsafe-eval'", '') : CSP_FULL;
  const html = readFileSync(join(HERE, 'renderer', 'index.html'), 'utf8')
    .replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
  const out = join(HERE, 'renderer', `__csp-${CSP_ARM}.html`);
  writeFileSync(out, html);
  return out;
}

let protoLogBuf = [];
function flushProtoLog() {
  if (!protoLogBuf.length) return;
  try {
    appendFileSync(PROTO_LOG, protoLogBuf.map((o) => JSON.stringify(o)).join('\n') + '\n');
  } catch { /* 别让日志拖垮协议 */ }
  protoLogBuf = [];
}

const t0 = Date.now();

let win = null;
let items = [];
let currentItem = null;
let installDir = null;
let libs = [];
let wallProto = null;

function publicItem(it) {
  return {
    id: it.id, source: it.source, dir: it.dir, title: it.title, type: it.type,
    mainFileAbs: it.mainFileAbs, previewAbs: it.previewAbs,
  };
}

async function discover() {
  const probes = await steamProbeDirs();
  installDir = await locateWallpaperEngine(probes);
  libs = await librariesOwningWE(probes);
  items = installDir ? await scanWallpapers(installDir, libs) : [];
  let wanted = [];
  if (installDir) {
    const sel = await readSelectedWallpapers(installDir);
    wanted = sel.files.map((p) => toPosix(p).toLowerCase());
  }
  currentItem = items.find((it) => wanted.includes(toPosix(it.mainFileAbs).toLowerCase()))
    || items.find((it) => wanted.includes(toPosix(it.dir).toLowerCase()))
    || null;
  return { installDir, libs: [...libs], n: items.length, current: currentItem ? currentItem.id : null };
}

function winStatePayload() {
  return {
    focused: win ? win.isFocused() : false,
    minimized: win ? win.isMinimized() : false,
    visible: win ? win.isVisible() : false,
    at: Date.now(),
  };
}

function pushWinState(ev) {
  if (!win || win.isDestroyed()) return;
  const s = winStatePayload();
  win.webContents.send('wp:winstate', s);
  appendFileSync(PERF_LOG, JSON.stringify({ t: Date.now() - t0, kind: 'winstate', ev, ...s }) + '\n');
}

app.whenReady().then(async () => {
  // 音频回采（E2 口径逐字）：必须给 getDisplayMedia 挂主进程 handler，
  // 否则渲染层直接报 "getDisplayMedia: Not supported"。loopback = 系统声回采。
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback(sources.length ? { video: sources[0], audio: 'loopback' } : null);
    } catch {
      callback(null);
    }
  }, { useSystemPicker: false });

  const scan = await discover();
  appendFileSync(PERF_LOG, JSON.stringify({ t: Date.now() - t0, kind: 'scan', ...scan, libs: libs.map(toPosix) }) + '\n');

  const roots = [];
  if (installDir) roots.push(toPosix(installDir));
  for (const lib of libs) roots.push(`${toPosix(lib).replace(/\/+$/, '')}/steamapps/workshop/content/431960`);
  roots.push(toPosix(CACHE_DIR));
  wallProto = installWallProtocol({
    roots,
    log: (line) => {
      protoLogBuf.push(line);
      if (protoLogBuf.length >= 200) flushProtoLog();
    },
  });
  setInterval(flushProtoLog, 1000);

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'miai-wall P1 prototype',
    webPreferences: {
      preload: join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide', 'maximize', 'unmaximize']) {
    win.on(ev, () => pushWinState(ev));
  }
  win.on('closed', () => { win = null; });

  win.webContents.on('console-message', (...args) => {
    const msg = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0].message : args[2];
    appendFileSync(PERF_LOG, JSON.stringify({ t: Date.now() - t0, kind: 'renderer', msg: String(msg).slice(0, 600) }) + '\n');
  });

  ipcMain.handle('wp:list', () => ({
    installDir, libs: libs.map(toPosix), roots,
    items: items.map(publicItem),
    current: currentItem ? publicItem(currentItem) : null,
    machine: { totalMemGB: +(os.totalmem() / 1073741824).toFixed(1), cpus: os.cpus().length, platform: process.platform },
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  }));
  ipcMain.handle('wp:winstate:get', () => winStatePayload());
  ipcMain.handle('wp:proto-stats', () => wallProto.stats());
  ipcMain.on('wp:tick', (_e, sample) => {
    flushProtoLog();
    const metrics = app.getAppMetrics().map((m) => ({
      type: m.type, pid: m.pid,
      cpu: +((m.cpu && m.cpu.percentCPUUsage) || 0).toFixed(1),
      memMB: Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024),
    }));
    appendFileSync(PERF_LOG, JSON.stringify({ t: Date.now() - t0, ...sample, metrics }) + '\n');
  });

  await win.loadFile(pageHtmlPath());
  appendFileSync(PERF_LOG, JSON.stringify({ t: Date.now() - t0, kind: 'loaded' }) + '\n');
});

app.on('window-all-closed', () => app.quit());
