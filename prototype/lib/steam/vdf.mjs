// 严格版 Valve KeyValues 解析（libraryfolders.vdf 专用面 + 通用树）
//
// 设计口径（docs/23 §4.2）：先在 "apps" 对象内按「键名完全等于 appId」判定，
// 再做任何结论 —— 绝不使用 DSH 的 `line.includes('431960')` 子串扫描。
// 已实测假阳性：某库 `update_clean_bytes_tally "1431960"` 会被 DSH 误判为拥有 WE。
//
// 与 DSH 的差异（这是我们自己的判据要守的）：
//   1. 结构建模（path→apps 归属显式），path 出现在 apps 块之后也正确；
//   2. apps 块内的 "path" 键不会被当成库路径；
//   3. 判 appId 是 key 级全等，不是子串。
//
// 支持的语法：引号字符串（\\ \" \n \t 转义；未知转义保留原字符，容忍单反斜杠路径）、
// 嵌套对象、单行 `"k" { "a" "b" }` 紧凑写法、// 行注释、/* 块注释、# 指令行（跳过整行）。

export function parseKeyValues(text) {
  let i = 0;
  const n = text.length;

  function fail(msg) {
    throw new Error(`vdf: ${msg} @${i}: ${JSON.stringify(String(text).slice(i, i + 24))}`);
  }

  function skipWs() {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (i >= n) return;
      if (text[i] === '/' && text[i + 1] === '/') {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? n : nl + 1;
        continue;
      }
      if (text[i] === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      if (text[i] === '#') {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? n : nl + 1;
        continue;
      }
      return;
    }
  }

  function parseString() {
    // 前置：text[i] === '"'
    i++;
    let out = '';
    while (i < n) {
      const c = text[i];
      if (c === '"') { i++; return out; }
      if (c === '\\' && i + 1 < n) {
        const d = text[i + 1];
        if (d === '\\' || d === '"') { out += d; i += 2; continue; }
        if (d === 'n') { out += '\n'; i += 2; continue; }
        if (d === 't') { out += '\t'; i += 2; continue; }
        out += c; i += 1; continue; // 未知转义：保留反斜杠本身（单反斜杠路径用例）
      }
      out += c; i++;
    }
    fail('未闭合的字符串');
  }

  function parseObject() {
    // 前置：text[i] === '{'
    i++;
    const obj = {};
    for (;;) {
      skipWs();
      if (i >= n) fail('未闭合的对象');
      if (text[i] === '}') { i++; return obj; }
      if (text[i] !== '"') fail('对象内期待键字符串');
      const key = parseString();
      skipWs();
      if (text[i] === '{') {
        obj[key] = parseObject();
      } else if (text[i] === '"') {
        obj[key] = parseString();
      } else {
        fail(`键 ${JSON.stringify(key)} 缺少值`);
      }
    }
  }

  skipWs();
  if (i >= n) return null;
  if (text[i] === '{') return parseObject();
  if (text[i] !== '"') fail('文件根部期待键字符串或对象');
  const key = parseString();
  skipWs();
  if (text[i] === '{') return { [key]: parseObject() };
  if (text[i] === '"') return { [key]: parseString() };
  fail('根键缺少值');
}

/**
 * 解析 libraryfolders.vdf → 库条目数组。
 * 返回 [{ key, path, ownsWE, appsIds }]：
 *   - path: 字符串或 null（条目里 path 缺失/非字符串时为 null，调用方须丢弃）
 *   - ownsWE: apps 对象内存在「键名全等 appId」的条目
 *   - appsIds: apps 的全部键（诊断用）
 */
export function parseLibraries(text, appId = '431960') {
  const root = parseKeyValues(text);
  if (!root || typeof root !== 'object' || Array.isArray(root)) return [];
  const container =
    root.libraryfolders && typeof root.libraryfolders === 'object' && !Array.isArray(root.libraryfolders)
      ? root.libraryfolders
      : root;
  const out = [];
  for (const [key, entry] of Object.entries(container)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const apps =
      entry.apps && typeof entry.apps === 'object' && !Array.isArray(entry.apps) ? entry.apps : null;
    const path =
      typeof entry.path === 'string' && entry.path.trim() ? entry.path.trim() : null;
    if (!apps && !path) continue; // 不是库条目（顶层杂键）
    out.push({
      key,
      path,
      ownsWE: !!(apps && Object.prototype.hasOwnProperty.call(apps, appId)),
      appsIds: apps ? Object.keys(apps) : [],
    });
  }
  return out;
}

/** 拥有 WE 工坊内容的库路径列表（只含 path 有效者） */
export function weLibraries(text, appId = '431960') {
  return parseLibraries(text, appId)
    .filter((l) => l.ownsWE && l.path)
    .map((l) => l.path);
}
