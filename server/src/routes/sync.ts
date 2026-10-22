/**
 * 四文档同步（docs/22 §3.4 #11-13、§4.3 CAS、§4.4 体积门）：
 *  - GET  /v1/docs            四文档摘要（不含 payload）；
 *  - GET  /v1/docs/:docType   拉取（ETag=revision，支持 If-None-Match → 304；无文档 → 404 NOT_FOUND）；
 *  - PUT  /v1/docs/:docType   条件写（CAS）：body {docVer, baseRevision, payload}；
 *                             docVer ≙ payload.version（不一致 → VALIDATION_FAILED）；
 *                             两条 CAS SQL 按 docs/22 §4.3 逐字执行（0 行 → 同事务补读分类 → 409）。
 * 体积门（§4.4）：量纲统一 = octet_length(payload::text)，写入前服务端按此校验（不信 Content-Length）；
 * 路由级 bodyLimit 9.5MiB 只管运输层，业务门 2/4/2/8 MiB 由本文件按实际字节执行。
 */
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { appError } from '../lib/errors.js';
import { num, toIso } from '../lib/util.js';
import { DOC_BODY_LIMIT, DOC_SIZE_LIMITS, DOC_TYPES, PROTOCOL_FLOOR, SYNC_PROTOCOL_HEADER, type DocType } from '../protocol.js';
import { requireAuth } from '../plugins/auth.js';
import { enforceRateLimit } from '../plugins/rate-limit.js';
import { takeApiRate, type AppInstance, type SharedDeps } from '../plugins/shared.js';

const docTypeSchema = z.enum(DOC_TYPES);

const docSummarySchema = z
  .object({
    revision: z.number(),
    docVer: z.number(),
    updatedAt: z.string(),
    sizeBytes: z.number(),
  })
  .nullable();

const getDocResponseSchema = z.object({
  docVer: z.number(),
  revision: z.number(),
  updatedAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const putDocBodySchema = z.object({
  // 上限 = int4 上界（user_docs.doc_ver 列型）：超界会被 PG 以 22003 拒绝，
  // 在此拦下给客户端确定的 400（安全审查 F1 向量③）
  docVer: z.number().int().min(1).max(2_147_483_647),
  baseRevision: z.number().int().min(1).nullable(),
  payload: z.record(z.string(), z.unknown()),
});

const putDocResponseSchema = z.object({
  revision: z.number(),
  docVer: z.number(),
  updatedAt: z.string(),
});

/** F1 ① 深度上限：远高于任何真实文档（<20 层），但远低于 V8 stringify 的爆栈点（约 5~6 千层） */
const MAX_PAYLOAD_DEPTH = 128;

/**
 * 客户端可控输入绝不允许落 500（docs/22 §3.5）：深嵌套 JSON 会在 JSON.stringify
 * 与 PG jsonb 转换上抛错（RangeError / 54001）。迭代式深度检查（检查器自身绝不能递归），
 * 超限 → 400 VALIDATION_FAILED。安全审查 F1 向量①。
 */
function assertPayloadDepth(payload: unknown, maxDepth: number): void {
  if (typeof payload !== 'object' || payload === null) return;
  const stack: Array<{ value: object; depth: number }> = [{ value: payload, depth: 1 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (depth > maxDepth) {
      throw appError('VALIDATION_FAILED', `payload nesting exceeds the maximum depth of ${maxDepth}`);
    }
    for (const child of Object.values(value)) {
      if (typeof child === 'object' && child !== null) {
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
}

/** docs/22 自由度 #13：X-Sync-Protocol 缺失视为 1；低于 floor → 426 */
function checkSyncProtocol(request: FastifyRequest): void {
  const raw = request.headers[SYNC_PROTOCOL_HEADER];
  if (raw === undefined) return;
  const text = Array.isArray(raw) ? raw[0] : raw;
  const value = Number(text);
  if (!Number.isInteger(value)) {
    throw appError('BAD_REQUEST', 'X-Sync-Protocol header must be an integer');
  }
  if (value < PROTOCOL_FLOOR) {
    throw appError('PROTOCOL_TOO_OLD', `sync protocol ${value} is below the floor ${PROTOCOL_FLOOR}`);
  }
}

/**
 * 0 行返回时同事务补读分类（docs/22 §4.3）：
 * doc_ver > 入参 doc_ver ⇒ 409 DOC_VER_BLOCKED；否则 409 CONFLICT_STALE（附当前值供重合并）。
 */
async function classifyConflict(
  tx: Queryable,
  accountId: string,
  docType: string,
  incomingDocVer: number,
): Promise<never> {
  const { rows } = await tx.query<{ revision: number | string; doc_ver: number | string }>(
    `SELECT revision, doc_ver FROM user_docs WHERE account_id = $1 AND doc_type = $2`,
    [accountId, docType],
  );
  const current = rows[0];
  const details = {
    currentRevision: current ? num(current.revision) : null,
    currentDocVer: current ? num(current.doc_ver) : null,
  };
  if (current && num(current.doc_ver) > incomingDocVer) {
    throw appError('DOC_VER_BLOCKED', 'incoming doc_ver is older than the stored one', { details });
  }
  throw appError('CONFLICT_STALE', 'base revision does not match the current revision', { details });
}

export function syncRoutes(app: AppInstance, deps: SharedDeps): void {
  const { db, limiter, rates } = deps;

  app.get(
    '/v1/docs',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: z.object({
            profile: docSummarySchema,
            wrongbook: docSummarySchema,
            favorites: docSummarySchema,
            practice: docSummarySchema,
          }),
        },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      checkSyncProtocol(request);

      const { rows } = await db.query<{
        doc_type: string;
        revision: number | string;
        doc_ver: number | string;
        size: number | string;
        updated_at: Date | string;
      }>(
        `SELECT doc_type, revision, doc_ver, octet_length(payload::text) AS size, updated_at
           FROM user_docs
          WHERE account_id = $1`,
        [auth.accountId],
      );

      const summary: Record<DocType, { revision: number; docVer: number; updatedAt: string; sizeBytes: number } | null> = {
        profile: null,
        wrongbook: null,
        favorites: null,
        practice: null,
      };
      for (const row of rows) {
        if (!(DOC_TYPES as readonly string[]).includes(row.doc_type)) continue; // CHECK 约束保证不会走到
        const docType = row.doc_type as DocType;
        summary[docType] = {
          revision: num(row.revision),
          docVer: num(row.doc_ver),
          updatedAt: toIso(row.updated_at),
          sizeBytes: num(row.size),
        };
      }
      return summary;
    },
  );

  app.get(
    '/v1/docs/:docType',
    {
      preHandler: app.authenticate,
      schema: {
        params: z.object({ docType: docTypeSchema }),
        response: { 200: getDocResponseSchema, 304: z.void() },
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      checkSyncProtocol(request);
      const { docType } = request.params;

      const { rows } = await db.query<{
        revision: number | string;
        doc_ver: number | string;
        payload: Record<string, unknown>;
        updated_at: Date | string;
      }>(
        `SELECT revision, doc_ver, payload, updated_at
           FROM user_docs
          WHERE account_id = $1 AND doc_type = $2`,
        [auth.accountId, docType],
      );
      const row = rows[0];
      if (!row) {
        throw appError('NOT_FOUND', 'document does not exist in the cloud');
      }

      const revision = num(row.revision);
      const etag = `"${revision}"`;
      reply.header('etag', etag);
      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }
      return {
        docVer: num(row.doc_ver),
        revision,
        updatedAt: toIso(row.updated_at),
        payload: row.payload,
      };
    },
  );

  app.put(
    '/v1/docs/:docType',
    {
      preHandler: app.authenticate,
      bodyLimit: DOC_BODY_LIMIT,
      schema: {
        params: z.object({ docType: docTypeSchema }),
        body: putDocBodySchema,
        response: { 200: putDocResponseSchema },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      takeApiRate(deps, request);
      checkSyncProtocol(request);
      // 安全审查 A5：本端点是全 API 里唯一能把 8MiB 正文送进 JSON 解析与 jsonb
      // 转换的写口（practice 上限），而此前只受全局 120/min 约束 ⇒ 960MiB/分钟/账号。
      // 按账号分桶（不是 IP）：同一台机器换 IP 绕不过去，且配额跟着人走。
      enforceRateLimit(limiter, {
        key: `docs|a:${auth.accountId}`,
        limit: rates.docsWritePerHourPerAccount,
        windowMs: 3_600_000,
        message: 'too many document writes',
      });
      const { docType } = request.params;
      const { docVer, baseRevision, payload } = request.body;

      if (payload.version !== docVer) {
        throw appError('VALIDATION_FAILED', 'docVer must equal payload.version');
      }
      assertPayloadDepth(payload, MAX_PAYLOAD_DEPTH);
      let payloadJson: string;
      try {
        payloadJson = JSON.stringify(payload);
      } catch (err) {
        // 兜底（F1）：任何序列化异常收敛为 400，绝不落 500
        throw appError('VALIDATION_FAILED', 'payload could not be serialized', { cause: err });
      }
      const limitBytes = DOC_SIZE_LIMITS[docType];

      return await db.withTransaction(async (tx) => {
        // 体积门：量纲 = octet_length(payload::text)（docs/22 §4.4），按实际字节校验
        const sizeRes = await tx.query<{ size: number | string }>(
          `SELECT octet_length($1::jsonb::text) AS size`,
          [payloadJson],
        );
        const sizeBytes = num(sizeRes.rows[0]!.size);
        if (sizeBytes > limitBytes) {
          throw appError('PAYLOAD_TOO_LARGE', `${docType} exceeds its sync size limit`, {
            details: { docType, sizeBytes, limitBytes },
          });
        }

        if (baseRevision === null) {
          // 首次推送（baseRevision = null）：建行为准；已有行则 0 行返回 → 补读分类（同事务）
          const res = await tx.query<{ revision: number | string }>(
            `INSERT INTO user_docs (account_id, doc_type, revision, doc_ver, payload)
             VALUES ($1, $2, 1, $3, $4)
             ON CONFLICT DO NOTHING
             RETURNING revision`,
            [auth.accountId, docType, docVer, payloadJson],
          );
          if (res.rows.length === 0) {
            await classifyConflict(tx, auth.accountId, docType, docVer);
          }
        } else {
          // 条件更新：revision 必须相符，且 doc_ver 不回退
          const res = await tx.query<{ revision: number | string }>(
            `UPDATE user_docs
                SET payload = $3, doc_ver = $4, revision = revision + 1, updated_at = now()
              WHERE account_id = $1 AND doc_type = $2 AND revision = $5 AND doc_ver <= $4
              RETURNING revision`,
            [auth.accountId, docType, payloadJson, docVer, baseRevision],
          );
          if (res.rows.length === 0) {
            await classifyConflict(tx, auth.accountId, docType, docVer);
          }
        }

        const { rows } = await tx.query<{ revision: number | string; updated_at: Date | string }>(
          `SELECT revision, updated_at FROM user_docs WHERE account_id = $1 AND doc_type = $2`,
          [auth.accountId, docType],
        );
        const row = rows[0]!;
        return { revision: num(row.revision), docVer, updatedAt: toIso(row.updated_at) };
      });
    },
  );
}
