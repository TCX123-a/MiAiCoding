/**
 * 密码策略（docs/22 §5.3；2026-10-13 主人令放宽：最短 12 → **6**，上限 128 不变）。
 * 不做大小写/符号组合规则（对齐 NIST）；离线弱密码黑名单（Top 常见密码 + 用户名子串包含检查）。
 * 失败一律 VALIDATION_FAILED 且文案不区分细节（防枚举口径）。
 *
 * 长短界真源在 src/protocol.ts（PASSWORD_MIN/MAX_LENGTH，两端逐字节同文），这里 re-export
 * 保持既有导入面（auth.ts 等从本文件 import）。
 */
import { appError } from './errors.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../protocol.js';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

/**
 * 常见弱密码（小写全等比较）。
 * 2026-10-13 放宽最短到 6 位后，**6~11 位段不再是「长度规则先挡」的死区**——
 * 本批把该段的常见弱密码补进名单（此前 >50 条中的 12+ 位档全部保留）。
 */
const WEAK_PASSWORDS = new Set([
  // —— 6~11 位档（2026-10-13 新增）——
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '654321',
  '111111',
  '000000',
  '222222',
  '333333',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',
  '123123',
  '112233',
  '121212',
  '123321',
  '5201314',
  '1314520',
  '520520',
  '521521',
  '1qaz2wsx',
  '1q2w3e4r',
  'qwerty',
  'qwerty1',
  'qwerty12',
  'qwertyui',
  'asdfgh',
  'asdfghj',
  'asdf123',
  'zxcvbn',
  'zxcvbnm',
  'abc123',
  'abcd1234',
  'a123456',
  'aa123456',
  'password',
  'password1',
  'password12',
  'passwd',
  'passwd1',
  'pass123',
  'admin',
  'admin123',
  'admin888',
  'root123',
  'test123',
  'test1234',
  'guest123',
  'letmein',
  'letmein1',
  'welcome',
  'welcome1',
  'welcome12',
  'monkey',
  'monkey123',
  'dragon',
  'dragon123',
  'sunshine',
  'sunshine1',
  'princess',
  'football',
  'baseball',
  'superman',
  'iloveyou',
  'woaini',
  'woaini520',
  'woaini521',
  'woaini1314',
  'miaimiai',
  'miaimiai123',
  'miaimiai1234',
  // —— 12+ 位档（既有，全保留）——
  '123456789012',
  '1234567890123',
  '1234567891011',
  '111111111111',
  '000000000000',
  'aaaaaaaaaaaa',
  'password123',
  'password1234',
  'password12345',
  'passwordpassword',
  'qwertyuiop123',
  'qwerty123456',
  'iloveyou1234',
  'admin1234567',
  'administrator',
  '1qaz2wsx3edc',
  '1q2w3e4r5t6y',
  'asdfghjkl123',
  'zxcvbnm12345',
  'letmein12345',
  'welcome12345',
  'monkey123456',
  'dragon123456',
  'abc123456789',
  'p@ssw0rd1234',
  'passw0rd1234',
  'sunshine1234',
  'princess1234',
  'football1234',
  'baseball1234',
  'superman1234',
  'trustno11234',
  'changeme1234',
  'rootrootroot',
  'totototo1234',
  'miaimiaimiai',
]);

export interface PasswordPolicyResult {
  ok: boolean;
}

/**
 * 校验密码策略；不合规抛 AppError('VALIDATION_FAILED')。
 * 文案固定单条（不区分「太短/在黑名单/含用户名」细节）。
 * 子串门槛 >=3：2 个字符的子串会把太多正常密码误伤（放宽到 2 位用户名后仍保持）。
 */
export function enforcePasswordPolicy(password: string, username: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw appError('VALIDATION_FAILED', 'password does not meet the policy requirements');
  }
  const lower = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) {
    throw appError('VALIDATION_FAILED', 'password does not meet the policy requirements');
  }
  const userLower = username.toLowerCase();
  if (userLower.length >= 3 && lower.includes(userLower)) {
    throw appError('VALIDATION_FAILED', 'password does not meet the policy requirements');
  }
}
