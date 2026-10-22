/** 小工具：时间归一化 + bigint 列归一化（pg 把 int8 返成 string，PGlite 可能返 number/bigint）+ 规范化 JSON/sha256。 */
import { createHash } from 'node:crypto';

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.length > 0) return Number(value);
  throw new Error(`expected a numeric column value, got ${typeof value}`);
}

/**
 * 规范化 JSON（键排序、无多余空白）：提交体 sha256 与流水条目内容对拍共用。
 * 输入恒为 JSON.parse 的产物（challenge/rice 请求体），值域天然是 JSON 可表示集合；
 * undefined 成员按 JSON.stringify 语义丢弃（对象成员级）。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
  return `{${parts.join(',')}}`;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 字节内容寻址（头像上传：sha256 of the raw PNG bytes）。 */
export function sha256HexBytes(input: Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * 时间戳健全域：ISO 字符串解析成功且落在 [1900-01-01, 2100-01-01)——
 * PG 的 timestamptz 能存到公元 294276 年，但业务时间戳没有一个是那个时代的；
 * 让越界值在入口变成 400 而不是 INSERT 时的 500（连接错误码之外的裸炸）。
 */
const TIMESTAMP_MIN_MS = Date.parse('1900-01-01T00:00:00Z');
const TIMESTAMP_MAX_MS = Date.parse('2100-01-01T00:00:00Z');
export function parseSaneTimestamp(value: string): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < TIMESTAMP_MIN_MS || ms >= TIMESTAMP_MAX_MS) return null;
  return ms;
}
