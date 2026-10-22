// miai-wall:// 特权协议 —— P1 原型（同时是 E4 前置实验的载体）
//
// 协议面硬需求逐条来自 _p0-notes/sources.md（引擎渲染端「会发出的全部请求」的逆向清单）：
//   ① Range 随机读：mediabunny UrlSource 每次请求都带 `Range: bytes=N-`（首请求 bytes=0-）；
//      必须回 206 + `Content-Range: bytes A-B/SIZE`（fileSize 从 /\/(\d+)/ 正则推），
//      否则降级为整份下载（仍能用、但丢随机读）；N ≥ size → 416 + `bytes */SIZE`；
//   ② body 必须是真 ReadableStream（缺了直接抛「Missing HTTP response body stream」）；
//   ③ CORS：Range 不是 safelisted 请求头 → 跨源先发 OPTIONS 预检 ⇒ 需 Allow-Headers: range；
//      mediabunny 要读 Content-Range/Content-Length ⇒ 需 Expose-Headers；
//   ④ 松散场景：任意相对路径 200+字节流 / 不存在 404（引擎自带 5s 负缓存）；
//      路径按段 encodeURIComponent，服务端按段 decode（中文文件名）；
//   ⑤ 路径围栏：拒绝 `..` / `.` / 空段 / NUL / 反斜杠；根目录白名单前缀（大小写不敏感）。
//
// 与参考实现（host/wallpaper-host.ts:339 的 ACAO *）对齐；HEAD 是零成本保险（Q7 不确定项）。

import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

/** 必须在 app ready 之前调用 */
export function registerWallSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'miai-wall',
      privileges: {
        standard: true,        // URL 按标准解析（有 host 段）
        secure: true,          // 视为安全上下文
        supportFetchAPI: true, // 渲染端 fetch() 可达（引擎全部走 fetch）
        stream: true,          // 允许流式 body（视频大文件不能整块进内存）
        corsEnabled: true,     // 参与 CORS 校验 —— 因此响应必须自带 CORS 头
      },
    },
  ]);
}

const MIME = {
  mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
  json: 'application/json', js: 'text/javascript', mjs: 'text/javascript',
  html: 'text/html', htm: 'text/html', css: 'text/css', txt: 'text/plain', xml: 'text/xml',
  frag: 'text/plain', vert: 'text/plain', glsl: 'text/plain',
  ttf: 'font/ttf', otf: 'font/otf', ttc: 'font/collection', woff: 'font/woff', woff2: 'font/woff2',
  pkg: 'application/octet-stream', tex: 'application/octet-stream',
  bin: 'application/octet-stream', mdl: 'application/octet-stream', tex_json: 'application/json',
};

function mimeFor(p) {
  const name = p.split('/').pop() || '';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return MIME[ext] || 'application/octet-stream';
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'range',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
    'Accept-Ranges': 'bytes',
  };
}

/** 解析单段 Range。返回 {start,end} | 'invalid' | null（null=没带/不认识的形态，按 200 全量处理） */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  let start;
  let end;
  if (a === '') {
    const n = Number(b); // bytes=-N → 末尾 N 字节
    if (!Number.isFinite(n) || n <= 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

/** 路径拆段 + 围栏校验。返回 {ok:true, segs} 或 {ok:false, why} */
export function pathFence(pathname) {
  let segs;
  try {
    segs = pathname.split('/').slice(1).map((s) => decodeURIComponent(s));
  } catch {
    return { ok: false, why: 'decode-fail' };
  }
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return { ok: false, why: 'dot-or-empty' };
    if (s.includes('\0') || s.includes('\\')) return { ok: false, why: 'nul-or-backslash' };
  }
  return { ok: true, segs };
}

/**
 * 安装处理器。
 * @param {object} opts
 * @param {string[]} opts.roots 允许的根目录（绝对路径，posix 形态；大小写不敏感前缀比对）
 * @param {(line: object) => void} [opts.log] 请求台账（E4 判据：Range 命中计数 > 1）
 * @param {() => boolean} [opts.logBodies] 是否记录每次请求（默认 true）
 * 返回 { stats() }。
 */
export function installWallProtocol({ roots, log }) {
  const normRoots = roots.map((r) => String(r).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase());
  const counters = { total: 0, byStatus: {}, rangeHits: 0, byName: {} };

  function allowed(full) {
    const key = full.toLowerCase();
    return normRoots.some((r) => key === r || key.startsWith(r + '/'));
  }

  protocol.handle('miai-wall', async (request) => {
    const started = Date.now();
    const method = request.method || 'GET';
    let u;
    try {
      u = new URL(request.url);
    } catch {
      return new Response('bad url', { status: 400, headers: corsHeaders() });
    }

    const reply = (status, res, extra) => {
      counters.total += 1;
      counters.byStatus[status] = (counters.byStatus[status] || 0) + 1;
      if (log) {
        log({ t: Date.now(), ms: Date.now() - started, method, range: request.headers.get('range') || null, path: u.pathname, status, ...(extra || {}) });
      }
      return res;
    };
    const deny = (status, why) => reply(status, new Response(why, { status, headers: { ...corsHeaders(), 'Content-Type': 'text/plain' } }), { why });

    if (u.host !== 's') return deny(404, 'unknown host');

    // 预检：Chromium 对带 Range 的跨源 GET 会先发 OPTIONS
    if (method === 'OPTIONS') {
      return reply(204, new Response(null, { status: 204, headers: corsHeaders() }));
    }
    if (method !== 'GET' && method !== 'HEAD') return deny(405, 'method not allowed');

    const fence = pathFence(u.pathname);
    if (!fence.ok) return deny(403, fence.why);
    const full = fence.segs.join('/');
    if (!allowed(full)) return deny(403, 'outside-roots');

    let st;
    try {
      st = await stat(full);
    } catch {
      return deny(404, 'not found');
    }
    if (!st.isFile()) return deny(404, 'not a file');

    const size = st.size;
    const type = mimeFor(full);
    const baseHeaders = { ...corsHeaders(), 'Content-Type': type, 'Cache-Control': 'no-store' };
    const range = parseRange(request.headers.get('range'), size);

    if (range === 'invalid') {
      return reply(416, new Response(null, {
        status: 416,
        headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` },
      }));
    }

    if (range) {
      counters.rangeHits += 1;
      const name = full.split('/').pop();
      counters.byName[name] = (counters.byName[name] || 0) + 1;
      const len = range.end - range.start + 1;
      const headers = {
        ...baseHeaders,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(len),
      };
      if (method === 'HEAD') return reply(206, new Response(null, { status: 206, headers }), { len });
      const body = Readable.toWeb(createReadStream(full, { start: range.start, end: range.end }));
      return reply(206, new Response(body, { status: 206, headers }), { len });
    }

    const headers = { ...baseHeaders, 'Content-Length': String(size) };
    if (method === 'HEAD') return reply(200, new Response(null, { status: 200, headers }), { len: size });
    const body = Readable.toWeb(createReadStream(full));
    return reply(200, new Response(body, { status: 200, headers }), { len: size });
  });

  return {
    stats: () => ({ ...counters, byStatus: { ...counters.byStatus }, byName: { ...counters.byName } }),
  };
}
