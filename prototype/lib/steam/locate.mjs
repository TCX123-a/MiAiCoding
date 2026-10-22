// Steam / Wallpaper Engine 定位链（照 DSH lib/index.js:186-364 移植，win32 面）
//
// 探针顺序：注册表 HKCU\Software\Valve\Steam /v SteamPath（5s 超时静默）
//   ∪ 环境变量（MIAI_WE_STEAM_ROOT，兼容 DSH_WE_STEAM_ROOT）
//   ∪ 常见安装目录探针（如 C:\Program Files (x86)\Steam）
// 60s TTL 缓存（含失败结果；Steam 未安装时别每次全盘探测）。
//
// wallpaper_engine 安装目录判定：{root}/steamapps/common/wallpaper_engine/wallpaper32.exe 存在。
// 工坊库判定：vdf 中 apps 拥有 431960 的库 + 「探针根本身也是库」的补丁
// （DSH :374-380：Steam 根从不作为 path 条目列出，WE 装在默认库时工坊内容就会静默消失）。

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { weLibraries } from './vdf.mjs';

export const WE_APPID = '431960';

export const STEAM_PROBE_DIRS = [
  'C:/Program Files (x86)/Steam',
  'C:/Program Files/Steam',
  'D:/Steam',
  'D:/SteamLibrary',
  'E:/SteamLibrary',
];

/** 反斜杠统一成正斜杠（fs 两种都吃，正斜杠便于拼 URL/断言） */
export function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

function pjoin(a, b) {
  return `${String(a).replace(/\/+$/, '')}/${b}`;
}

const REG_TIMEOUT_MS = 5000;
export function steamPathFromRegistry() {
  return new Promise((resolve) => {
    const reg = pjoin(process.env.SystemRoot || 'C:/Windows', 'System32/reg.exe');
    try {
      execFile(
        reg,
        ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
        { encoding: 'utf8', windowsHide: true, timeout: REG_TIMEOUT_MS },
        (err, stdout) => {
          if (err) return resolve(null);
          const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(stdout || '');
          resolve(m ? toPosix(m[1].trim()) : null);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

const PROBE_TTL_MS = 60 * 1000;
let probeCache = null; // { t, dirs }

/** 探针目录列表（注册表 + 环境变量 + 硬编码），60s TTL 缓存 */
export async function steamProbeDirs(env = process.env) {
  if (probeCache && Date.now() - probeCache.t < PROBE_TTL_MS) return probeCache.dirs;
  const reg = await steamPathFromRegistry();
  const raw = env.MIAI_WE_STEAM_ROOT || env.DSH_WE_STEAM_ROOT || '';
  const envRoots = raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(toPosix);
  const dirs = [...(reg ? [reg] : []), ...envRoots, ...STEAM_PROBE_DIRS];
  probeCache = { t: Date.now(), dirs };
  return dirs;
}

async function readTextOrNull(p) {
  try {
    return await readFile(p, 'utf8');
  } catch {
    return null;
  }
}

/** Windows 路径大小写不敏感：去重时折叠比较、保留首次出现的写法 */
function uniqCI(list) {
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** 拥有 WE（431960）工坊内容的库根列表 */
export async function librariesOwningWE(probes) {
  const list = probes || (await steamProbeDirs());
  const libs = [];
  for (const probe of list) {
    const root = toPosix(probe);
    const text = await readTextOrNull(pjoin(root, 'steamapps/libraryfolders.vdf'));
    if (text) for (const p of weLibraries(text, WE_APPID)) libs.push(toPosix(p));
    // Steam 根自己也是库但永不作为 path 条目出现（DSH :374-380）
    if (existsSync(pjoin(root, 'steamapps/common/wallpaper_engine'))) libs.push(root);
  }
  return uniqCI(libs);
}

/** WE 安装目录（含 wallpaper32.exe），找不到返回 null */
export async function locateWallpaperEngine(probes) {
  const list = probes || (await steamProbeDirs());
  const roots = [...uniqCI(list.map(toPosix)), ...(await librariesOwningWE(list))];
  for (const root of uniqCI(roots)) {
    const install = pjoin(root, 'steamapps/common/wallpaper_engine');
    if (existsSync(pjoin(install, 'wallpaper32.exe'))) return install;
  }
  return null;
}
