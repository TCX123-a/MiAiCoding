// E3 发现链冒烟：vdf 严格解析（四夹具）+ 真机 9 条扫描 + project.json 归一
// 通过判据（docs/23 §7 E3）：四夹具全绿（含假阳性反例必须红）+ 真机 9 条类型/预览全部正确。
// 反例对照臂说明：naiveDshWE 只用于证明「DSH 口径会红」——绝不能进生产路径。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { parseKeyValues, parseLibraries, weLibraries } from '../lib/steam/vdf.mjs';
import { locateWallpaperEngine, librariesOwningWE, steamProbeDirs } from '../lib/steam/locate.mjs';
import { scanWallpapers, readSelectedWallpapers, inferType } from '../lib/steam/scan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const readFixture = (name) => readFile(join(HERE, 'fixtures', name), 'utf8');

const WE_ROOT = 'D:/Steam'; // 常见安装路径基线（docs/23 §4.2/§4.3）
const WE_INSTALL = `${WE_ROOT}/steamapps/common/wallpaper_engine`; // 扫描/读配置的入参语义 = 安装目录
const machineOk = existsSync(`${WE_INSTALL}/wallpaper32.exe`);

// ── DSH 口径的朴素匹配器（lib/index.js:330-337 逐字复刻；仅作反例对照臂）──
function naiveDshWE(text, appId = '431960') {
  const libs = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
    if (m) { current = m[1].replace(/\\\\/g, '\\'); continue; }
    if (current && line.includes(appId)) {
      if (!libs.includes(current)) libs.push(current);
    }
  }
  return libs;
}

// ── 夹具 A：基础归属 + 转义还原 ──
test('夹具A：基础库归属（转义双反斜杠还原为单）', async () => {
  const text = await readFixture('vdf-a-basic.vdf');
  const libs = parseLibraries(text);
  assert.deepEqual(
    libs.map((l) => [l.path, l.ownsWE]),
    [
      ['D:\\Steam', true],
      ['E:\\Games', false],
    ],
  );
  assert.deepEqual(weLibraries(text), ['D:\\Steam']);
});

// ── 夹具 B：子串假阳性（差异判据本体）──
test('夹具B：子串假阳性——我们的解析器必须绿、DSH 口径必须红', async () => {
  const text = await readFixture('vdf-b-substring.vdf');
  assert.deepEqual(weLibraries(text), ['D:\\SteamLibrary']);
  const naive = naiveDshWE(text);
  assert.ok(
    naive.includes('E:\\OtherGames'),
    `对照臂应把 tally=1431960 误判为拥有 WE（naive 实得：${JSON.stringify(naive)}）`,
  );
});

// ── 夹具 C：CRLF + 单反斜杠 ──
test('夹具C：CRLF 与单反斜杠路径都能解析', async () => {
  const lf = await readFixture('vdf-c-crlf-single.vdf');
  assert.ok(lf.includes('"D:\\Steam"'), '夹具本体必须是单反斜杠（防止被写盘转义成双）');
  for (const [label, text] of [
    ['LF', lf],
    ['CRLF', lf.replace(/\n/g, '\r\n')],
  ]) {
    assert.deepEqual(weLibraries(text), ['D:\\Steam'], `${label} 变体`);
  }
});

// ── 夹具 D：结构建模 ──
test('夹具D：path 在 apps 后 / apps 内假 path / 无 path 条目', async () => {
  const text = await readFixture('vdf-d-stray.vdf');
  const libs = parseLibraries(text);
  const byKey = Object.fromEntries(libs.map((l) => [l.key, l]));
  assert.equal(byKey['0'].path, 'F:\\Steam');
  assert.equal(byKey['0'].ownsWE, true, 'path 出现在 apps 之后也必须归属正确');
  assert.equal(byKey['1'].path, 'G:\\Games');
  assert.equal(byKey['1'].ownsWE, false);
  assert.equal(byKey['2'].path, null);
  assert.equal(byKey['2'].ownsWE, true);
  assert.deepEqual(weLibraries(text), ['F:\\Steam']);
  assert.ok(libs.every((l) => l.path !== 'X:\\Bogus'), 'apps 块内 path 键不得被当成库路径');
});

// ── 解析器微用例 ──
test('parseKeyValues：单行紧凑写法 + 注释', () => {
  const o = parseKeyValues('// 注释\n"a" { "b" { "c" "d" } /* 块注释 */ "e" "f" }\n');
  assert.deepEqual(o, { a: { b: { c: 'd' }, e: 'f' } });
});

test('inferType：mp4→video / html→web / exe→scene（回落）', () => {
  assert.equal(inferType('a.mp4'), 'video');
  assert.equal(inferType('B.MOV'), 'video');
  assert.equal(inferType('x.html'), 'web');
  assert.equal(inferType('main.js'), 'web');
  assert.equal(inferType('sheep.exe'), 'scene');
  assert.equal(inferType('audiophile.json'), 'scene');
});

// ── 真机 ──
test('真机：定位链（注册表/探针 → 安装目录 + 工坊库）', { skip: !machineOk && '本机 WE 不在常见路径' }, async () => {
  const t0 = performance.now();
  const probes = await steamProbeDirs();
  const install = await locateWallpaperEngine(probes);
  const libs = await librariesOwningWE(probes);
  // 注册表回传的盘符是小写（d:/steam），Windows 路径大小写不敏感 → 折叠比较
  assert.equal(install?.toLowerCase(), WE_INSTALL.toLowerCase());
  assert.ok(
    libs.some((l) => l.toLowerCase() === WE_ROOT.toLowerCase()),
    `工坊库含 ${WE_ROOT}（实得 ${JSON.stringify(libs)}）`,
  );
  console.log(`[E3] locate 用时 ${(performance.now() - t0).toFixed(1)}ms；probes=${JSON.stringify(probes)}`);
});

test('真机：扫描 9 条工坊（全 video、preview 齐）+ defaultprojects + 当前壁纸', { skip: !machineOk && '本机 WE 不在常见路径' }, async () => {
  const t0 = performance.now();
  const libs = await librariesOwningWE(await steamProbeDirs());
  const items = await scanWallpapers(WE_INSTALL, libs);
  const scanMs = performance.now() - t0;

  const workshop = items.filter((i) => i.source === 'workshop');
  const KNOWN = [
    '3515596237', '3543171082', '3542562564', '2936598627', '3284636810',
    '2801716159', '3695565774', '2834734886', '3177687800',
  ];
  for (const id of KNOWN) {
    assert.ok(workshop.some((w) => w.id === id), `工坊 ${id} 应在列表`);
  }
  assert.ok(workshop.every((w) => w.type === 'video'), `工坊全 video（实得 ${JSON.stringify(workshop.map((w) => [w.id, w.type]))}）`);
  assert.ok(workshop.every((w) => w.previewAbs), '工坊 9/9 有 preview');

  const def = items.filter((i) => i.source === 'default');
  assert.ok(def.length >= 19, `defaultprojects ≥19（实得 ${def.length}）`);
  const audiophile = items.find((i) => i.id === 'audiophile');
  assert.equal(audiophile?.type, 'scene');
  assert.ok(audiophile.mainFileAbs.endsWith('audiophile.json'), `audiophile 主文件应为 audiophile.json（实得 ${audiophile.mainFileAbs}）`);
  for (const id of ['sheep', 'techno']) {
    assert.equal(items.find((i) => i.id === id)?.type, 'scene', `${id} 无 type → scene`);
  }

  const { files } = await readSelectedWallpapers(WE_INSTALL);
  const current = files[0];
  assert.ok(current && current.includes('3284636810'), `当前壁纸应为 3284636810 佐助（实得 ${JSON.stringify(files)}）`);
  assert.ok(existsSync(current), `当前壁纸文件存在：${current}`);

  console.log(`[E3] scan 用时 ${scanMs.toFixed(1)}ms；共 ${items.length} 项（工坊 ${workshop.length} + 默认 ${def.length}）；当前壁纸=${current}`);
});
