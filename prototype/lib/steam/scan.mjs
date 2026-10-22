// 壁纸库扫描与归一（照 DSH lib/index.js:384-499、:2536-2590 移植）
//
// 扫描根 = WE 安装目录 projects/{defaultprojects,myprojects}
//         + 每个工坊库 steamapps/workshop/content/431960
// 归一：project.json → { id, title, type, file, preview, contentrating }
//   type 规则（DSH :411-412 逐字）：有 type 字符串 → toLowerCase；否则 inferType(file)；
//   仍不在 KINDS → 回落 'scene'。
// 主容器（scene）：declared → scene.pkg → scene.json → 目录里唯一 *.pkg（DSH :439-451）。

import { readdir, readFile, stat } from 'node:fs/promises';

import { WE_APPID } from './locate.mjs';

export const KINDS = ['scene', 'video', 'web', 'application'];
export const PREVIEW_CANDIDATES = ['preview.jpg', 'preview.png', 'preview.gif', 'preview.webp'];

export function inferType(file) {
  if (/\.(mp4|webm|mkv|avi|mov)$/i.test(file)) return 'video';
  if (/\.(html?|js)$/i.test(file)) return 'web';
  return 'scene';
}

function pjoin(a, b) {
  return `${String(a).replace(/\/+$/, '')}/${b}`;
}

export async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** 读一个壁纸目录的 project.json → 归一对象；无 project.json / 无 file 字段返回 null */
export async function readProject(dir) {
  const pj = pjoin(dir, 'project.json');
  if (!(await pathExists(pj))) return null;
  try {
    const o = JSON.parse((await readFile(pj, 'utf8')).replace(/^﻿/, ''));
    if (!o || typeof o !== 'object' || !o.file) return null;
    let type = typeof o.type === 'string' ? o.type.toLowerCase() : inferType(o.file);
    if (!KINDS.includes(type)) type = 'scene';
    return {
      id: dir.split(/[\\/]/).filter(Boolean).pop(),
      title: typeof o.title === 'string' ? o.title : dir.split(/[\\/]/).filter(Boolean).pop(),
      type,
      file: o.file,
      preview: typeof o.preview === 'string' ? o.preview : null,
      contentrating: typeof o.contentrating === 'string' ? o.contentrating : null,
    };
  } catch {
    return null;
  }
}

/** 场景主容器解析：declared → scene.pkg → scene.json → 唯一 *.pkg；全无返回 null */
export async function resolveSceneMainFile(dir, declared) {
  for (const candidate of [declared, 'scene.pkg', 'scene.json']) {
    if (!candidate) continue;
    if (await pathExists(pjoin(dir, candidate))) return candidate;
  }
  let pkgs = [];
  try {
    pkgs = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith('.pkg'));
  } catch {
    return null;
  }
  return pkgs.length === 1 ? pkgs[0] : null;
}

/**
 * 扫描壁纸库 → 归一列表（按 title 排序）。
 * @param {string|null} installDir WE 安装目录（可空）
 * @param {string[]} libraryDirs 工坊库根列表
 */
export async function scanWallpapers(installDir, libraryDirs, { chunk = 24 } = {}) {
  const found = new Map();
  const roots = []; // { root, source }
  if (installDir) {
    for (const sub of ['defaultprojects', 'myprojects']) {
      const p = pjoin(installDir, `projects/${sub}`);
      if (await pathExists(p)) roots.push({ root: p, source: sub === 'defaultprojects' ? 'default' : 'my' });
    }
  }
  for (const lib of libraryDirs) {
    const ws = pjoin(lib, `steamapps/workshop/content/${WE_APPID}`);
    if (await pathExists(ws)) roots.push({ root: ws, source: 'workshop' });
  }

  const dirs = [];
  for (const { root, source } of roots) {
    let entries = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = pjoin(root, entry);
      if (await isDir(dir)) dirs.push({ dir, source });
    }
  }

  for (let i = 0; i < dirs.length; i += chunk) {
    const slice = dirs.slice(i, i + chunk);
    const results = await Promise.all(
      slice.map(async ({ dir, source }) => {
        const p = await readProject(dir);
        return p ? { dir, source, p } : null;
      }),
    );
    for (const hit of results) {
      if (!hit) continue;
      const { dir, source, p } = hit;
      if (found.has(p.id)) continue; // 同名以先见者为准（defaultprojects 先于工坊）
      let previewAbs = p.preview ? pjoin(dir, p.preview) : null;
      if (previewAbs && !(await pathExists(previewAbs))) previewAbs = null;
      if (!previewAbs) {
        for (const c of PREVIEW_CANDIDATES) {
          const t = pjoin(dir, c);
          if (await pathExists(t)) {
            previewAbs = t;
            break;
          }
        }
      }
      const mainFile = p.type === 'scene' ? (await resolveSceneMainFile(dir, p.file)) || p.file : p.file;
      found.set(p.id, {
        id: p.id,
        source,
        dir,
        title: p.title,
        type: p.type,
        file: p.file,
        mainFileAbs: pjoin(dir, mainFile),
        previewAbs,
        contentrating: p.contentrating,
      });
    }
  }
  return [...found.values()].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

/**
 * 从 WE config.json 读「当前正在运行的壁纸」文件路径列表。
 * 口径：只认 {user}.general.wallpaperconfig.selectedwallpapers（含各显示器 file 字段；
 * playlist 形态取 items）；刻意不扫 wallpaperconfigrecent（那是历史记录，不是当前）。
 */
export async function readSelectedWallpapers(installDir) {
  const cfgPath = pjoin(installDir, 'config.json');
  if (!(await pathExists(cfgPath))) return { files: [], monitors: {} };
  let cfg;
  try {
    cfg = JSON.parse((await readFile(cfgPath, 'utf8')).replace(/^﻿/, ''));
  } catch {
    return { files: [], monitors: {} };
  }
  const files = [];
  const monitors = {};
  for (const [userKey, userVal] of Object.entries(cfg || {})) {
    if (userKey.startsWith('?') || !userVal || typeof userVal !== 'object') continue;
    const sel = userVal.general?.wallpaperconfig?.selectedwallpapers;
    if (!sel || typeof sel !== 'object') continue;
    for (const [monitor, row] of Object.entries(sel)) {
      if (!row || typeof row !== 'object') continue;
      const entry = { file: null, playlist: null };
      if (typeof row.file === 'string' && row.file) entry.file = row.file;
      if (row.playlist && typeof row.playlist === 'object' && Array.isArray(row.playlist.items)) {
        entry.playlist = row.playlist.items.filter((x) => typeof x === 'string');
      }
      monitors[`${userKey}/${monitor}`] = entry;
      if (entry.file) files.push(entry.file);
      if (entry.playlist) files.push(...entry.playlist);
    }
  }
  return { files, monitors };
}
