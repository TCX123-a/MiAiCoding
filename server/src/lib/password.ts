/**
 * 密码哈希（docs/22 §5.2 拍板 #5）。
 *
 * 实现 = Node 24 内置 `node:crypto` 的 argon2/argon2Sync（零原生依赖）。
 * 本机实测（2026-10-07, Node v24.20.0）确认：
 *  - `crypto.argon2(algorithm, parameters, callback)`（回调式）与 `crypto.argon2Sync(algorithm, parameters)`；
 *  - algorithm 必须是字符串 `"argon2id"`；parameters 键：message/nonce(salt)/parallelism/tagLength/
 *    memory(单位 KiB)/passes/secret/associatedData；
 *  - RFC 9106 §5.3 argon2id 官方向量逐位一致（0d640df5…e659），OWASP 参数本机约 18ms/次。
 *
 * 存储格式（自描述，docs/22 §4.2 ①）：
 *   $argon2id$v=19$m=19456,t=2,p=1$<b64(salt,16B,无填充)>$<b64(tag,32B,无填充)>
 *
 * 并发闸（docs/22 §5.2）：2 并发 + 队列 16，超限快速 503（复用 DB_UNAVAILABLE + Retry-After，
 * 见 docs/22 自由度 #5：不私加错误码）。
 */
import * as nodeCrypto from 'node:crypto';
import { appError } from './errors.js';

interface Argon2Parameters {
  message: Buffer | Uint8Array;
  nonce: Buffer | Uint8Array;
  parallelism: number;
  tagLength: number;
  memory: number; // KiB
  passes: number;
  secret?: Buffer | Uint8Array;
  associatedData?: Buffer | Uint8Array;
}

type Argon2Callback = (err: Error | null, derivedKey?: Buffer) => void;

// @types/node 是否覆盖 crypto.argon2 取决于版本；这里以最小结构化签名访问，运行时已实测存在。
const nativeArgon2 = (nodeCrypto as unknown as {
  argon2: (algorithm: string, parameters: Argon2Parameters, callback: Argon2Callback) => void;
}).argon2;

export const PASSWORD_HASH_PARAMS = {
  memoryKiB: 19456, // 19 MiB（OWASP 推荐档）
  passes: 2,
  parallelism: 1,
  tagLength: 32,
  saltLength: 16,
} as const;

export const HASH_CONCURRENCY = 2;
export const HASH_QUEUE_LIMIT = 16;

export interface Argon2RawInput {
  salt: Buffer;
  memoryKiB: number;
  passes: number;
  parallelism: number;
  tagLength: number;
  secret?: Buffer;
  associatedData?: Buffer;
}

/** 低层 argon2id 入口·原始字节消息（RFC 向量自检测试走这条路，与生产共用同一参数通道） */
export function argon2idRawBytes(message: Buffer, input: Argon2RawInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const parameters: Argon2Parameters = {
      message,
      nonce: input.salt,
      parallelism: input.parallelism,
      tagLength: input.tagLength,
      memory: input.memoryKiB,
      passes: input.passes,
    };
    if (input.secret) parameters.secret = input.secret;
    if (input.associatedData) parameters.associatedData = input.associatedData;
    nativeArgon2('argon2id', parameters, (err, derivedKey) => {
      if (err) reject(err);
      else if (!derivedKey) reject(new Error('argon2 returned no derived key'));
      else resolve(derivedKey);
    });
  });
}

/** 低层 argon2id 入口（字符串口令版） */
export function argon2idRaw(password: string, input: Argon2RawInput): Promise<Buffer> {
  return argon2idRawBytes(Buffer.from(password, 'utf8'), input);
}

// ---------------------------------------------------------------------------
// 并发闸：2 并发 + 16 排队，超限快速 503
// ---------------------------------------------------------------------------
let active = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> | void {
  if (active < HASH_CONCURRENCY) {
    active += 1;
    return;
  }
  if (waiters.length >= HASH_QUEUE_LIMIT) {
    throw appError('DB_UNAVAILABLE', 'password hashing queue is full, retry shortly', { retryAfterMs: 1000 });
  }
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) next(); // 槽位直接移交，active 不变
  else active -= 1;
}

async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

// ---------------------------------------------------------------------------
// PHC 字符串编解码
// ---------------------------------------------------------------------------
const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function toBase64NoPad(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '');
}

interface ParsedHash {
  memoryKiB: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  tag: Buffer;
}

export function decodePasswordHash(encoded: string): ParsedHash | null {
  const match = PHC_PATTERN.exec(encoded);
  if (!match) return null;
  const [, m, t, p, saltB64, tagB64] = match;
  const memoryKiB = Number(m);
  const passes = Number(t);
  const parallelism = Number(p);
  if (!Number.isInteger(memoryKiB) || !Number.isInteger(passes) || !Number.isInteger(parallelism)) return null;
  if (memoryKiB < 8 || passes < 1 || parallelism < 1) return null;
  const salt = Buffer.from(saltB64 as string, 'base64');
  const tag = Buffer.from(tagB64 as string, 'base64');
  if (salt.length === 0 || tag.length === 0) return null;
  return { memoryKiB, passes, parallelism, salt, tag };
}

export function encodePasswordHash(salt: Buffer, tag: Buffer, params: {
  memoryKiB: number;
  passes: number;
  parallelism: number;
}): string {
  return `$argon2id$v=19$m=${params.memoryKiB},t=${params.passes},p=${params.parallelism}$${toBase64NoPad(salt)}$${toBase64NoPad(tag)}`;
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------
export async function hashPassword(password: string): Promise<string> {
  const salt = nodeCrypto.randomBytes(PASSWORD_HASH_PARAMS.saltLength);
  const tag = await withHashSlot(() =>
    argon2idRaw(password, {
      salt,
      memoryKiB: PASSWORD_HASH_PARAMS.memoryKiB,
      passes: PASSWORD_HASH_PARAMS.passes,
      parallelism: PASSWORD_HASH_PARAMS.parallelism,
      tagLength: PASSWORD_HASH_PARAMS.tagLength,
    }),
  );
  return encodePasswordHash(salt, tag, PASSWORD_HASH_PARAMS);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = decodePasswordHash(encoded);
  if (!parsed) return false;
  const tag = await withHashSlot(() =>
    argon2idRaw(password, {
      salt: parsed.salt,
      memoryKiB: parsed.memoryKiB,
      passes: parsed.passes,
      parallelism: parsed.parallelism,
      tagLength: parsed.tag.length,
    }),
  );
  if (tag.length !== parsed.tag.length) return false;
  return nodeCrypto.timingSafeEqual(tag, parsed.tag);
}

let dummyEncoded: string | undefined;

/**
 * 未知账号登录时做的等价计时操作（防用户名枚举的时序差）。
 * 与一次真实 verify 同参数、同开销。
 */
export async function absorbUnknownUserTiming(password: string): Promise<void> {
  if (!dummyEncoded) {
    dummyEncoded = await hashPassword(nodeCrypto.randomBytes(32).toString('hex'));
  }
  await verifyPassword(password, dummyEncoded);
}
