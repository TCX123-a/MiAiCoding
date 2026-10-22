/**
 * 头像端点（docs/22 §3.4 #14/#15、§5.4 限流、§5.7 随行删除）：
 *  - GET /v1/avatar/:hash：**按内容寻址取任意未封禁账号的头像**（2026-10-22 用户系统
 *    批次放宽：排行榜要显示别人的头像；hash = sha256(图片字节)，不可猜，且内容一旦
 *    上传不会变）。仍要求已登录（不是匿名公开端点）；账号禁用后其头像立即 404。
 *    未设/形状不对/已换掉 → 一律 404 NOT_FOUND（不泄露「存在但换了」的区别）。
 *  - PUT /v1/avatar：image/png ≤512KB（业务门 AVATAR_MAX_BYTES；运输层 600KB 见协议
 *    AVATAR_BODY_LIMIT，超运输层由 FST_ERR_CTP_BODY_TOO_LARGE → 413）；PNG magic 校验
 *    不过 → 415；10 次/时/账号；sha256 内容寻址 → 同内容幂等。
 *
 * 存储：users 行内（avatar_hash + avatar_png 同生共死，注销随行删除——备份天然覆盖）。
 * 响应头：image/png + X-Content-Type-Options: nosniff + immutable 缓存（hash 即内容版本）。
 */
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { appError } from '../lib/errors.js';
import { sha256HexBytes } from '../lib/util.js';
import { AVATAR_BODY_LIMIT, AVATAR_MAX_BYTES } from '../protocol.js';
import { requireAuth } from '../plugins/auth.js';
import { enforceRateLimit } from '../plugins/rate-limit.js';
import { takeApiRate, type AppInstance, type SharedDeps } from '../plugins/shared.js';

/** sha256 hex 的固定形状（大写/截断都算「不是我们发过的 hash」） */
const HASH_RE = /^[0-9a-f]{64}$/;

/** PNG 签名（RFC 2083 §3.1）：\x89PNG\r\n\x1a\n */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf: Buffer): boolean {
  return buf.length >= PNG_MAGIC.length && buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
}

export function avatarRoutes(app: AppInstance, deps: SharedDeps): void {
  const { db, rates, limiter } = deps;

  app.get(
    '/v1/avatar/:hash',
    {
      preHandler: app.authenticate,
      schema: { params: z.object({ hash: z.string() }) },
    },
    async (request, reply) => {
      requireAuth(request);
      takeApiRate(deps, request);
      const { hash } = request.params;
      if (!HASH_RE.test(hash)) throw appError('NOT_FOUND', 'no avatar for this hash');

      const { rows } = await db.query<{ avatar_png: Buffer | Uint8Array | null }>(
        `SELECT avatar_png FROM users WHERE avatar_hash = $1 AND disabled_at IS NULL`,
        [hash],
      );
      const png = rows[0]?.avatar_png;
      if (png === undefined || png === null) throw appError('NOT_FOUND', 'no avatar for this hash');

      reply.header('content-type', 'image/png');
      reply.header('x-content-type-options', 'nosniff');
      // 内容寻址 ⇒ 同一 URL 的字节永不改变；客户端可长期缓存（私有：不进共享缓存）
      reply.header('cache-control', 'private, max-age=31536000, immutable');
      // pg 驱动给 Buffer、PGlite 给 Uint8Array——归一化成 Buffer 再发（二进制原样，不走序列化器）
      return reply.send(Buffer.isBuffer(png) ? png : Buffer.from(png));
    },
  );

  app.put(
    '/v1/avatar',
    {
      preHandler: app.authenticate,
      bodyLimit: AVATAR_BODY_LIMIT,
      schema: { response: { 200: z.object({ hash: z.string() }) } },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      enforceRateLimit(limiter, {
        key: `avatar|a:${auth.accountId}`,
        limit: rates.avatarUploadPerHourPerAccount,
        windowMs: 3_600_000,
        message: 'too many avatar uploads',
      });

      // 没有注册 image/png parser 时走不到这里（fastify 直接 415）；有 parser 则 parseAs=buffer
      const body: unknown = request.body;
      if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
        throw appError('UNSUPPORTED_MEDIA_TYPE', 'request body must be image/png');
      }
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
      if (buf.length > AVATAR_MAX_BYTES) {
        throw appError('PAYLOAD_TOO_LARGE', `avatar must be at most ${AVATAR_MAX_BYTES} bytes`);
      }
      if (!isPng(buf)) throw appError('UNSUPPORTED_MEDIA_TYPE', 'request body is not a PNG');

      const hash = sha256HexBytes(buf);
      await db.query(`UPDATE users SET avatar_hash = $2, avatar_png = $3 WHERE id = $1`, [
        auth.accountId,
        hash,
        buf,
      ]);
      return { hash };
    },
  );
}
