/**
 * miai 云端协议 · 唯一真源。
 *
 * 【这份文件是什么】客户端、主进程与服务端三方共用的协议常量与纯规则：
 * 协议版本号、文档类型与体积门、22 个错误码与状态码映射、挑战计分权重、
 * 大白饭 delta 白名单与日上限、难度默认规则表、能力位、限流数值、
 * 注册安全问答预设问题表（找回密码流程，2026-10-13 主人令）。
 *
 * 【两端逐字节同文】真源在客户端仓库 `src/shared/cloud/protocol.ts`；
 * 服务端 `server/src/protocol.ts` 是它的逐字节副本（服务端是独立 npm 包，
 * 不能跨包 import）。同步工具 `scripts/protocol-sync.mjs`：`copy` 把真源
 * 复制到服务端，`check` 断言两份文件逐字节相等。改动一律先改真源、再跑
 * `npm run protocol:sync`（副本不要就地手改；服务端侧纪律见 server/README.md）。
 *
 * 【依赖纪律】本文件不 import 任何模块（三个运行环境都要能直接加载）。
 * 它与客户端既有真源的数值一致性由 `src/shared/__tests__/cloud-protocol.test.ts`
 * 逐项断言（与 `difficulty.ts` 的默认规则矩阵、`pet.ts` 的饭碗常量、
 * `challenge.ts` 的题量——种坏值方法：改任一处必须见红）。
 */

export const API_VERSION = 1;

export const PROTOCOL_CURRENT = 1;
export const PROTOCOL_FLOOR = 1;

/** /v1/meta 的能力位（docs/26 §1.1 #8）；服务端实现齐备后由空数组填为这三项 */
export const CAPABILITIES = ['challenge_settle', 'rice_ledger', 'leaderboard'] as const;

/** 四份同步文档（docs/22 §4.2 ③）。'challenge' 已在 DB CHECK 里预留（0003 迁移），v1.5 才进 API 面 */
export const DOC_TYPES = ['profile', 'wrongbook', 'favorites', 'practice'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** 文档体积门·按类型分档上限（docs/22 §4.4；单位=字节，量纲=octet_length(payload::text)） */
export const DOC_SIZE_LIMITS: Record<DocType, number> = {
  profile: 2 * 1024 * 1024,
  wrongbook: 4 * 1024 * 1024,
  favorites: 2 * 1024 * 1024,
  practice: 8 * 1024 * 1024,
};

/** 路由级 bodyLimit（docs/22 §4.4 ②三层结构） */
export const DOC_BODY_LIMIT = Math.ceil(9.5 * 1024 * 1024); // 文档 9.5MiB
export const AUTH_BODY_LIMIT = 16 * 1024; // 认证 JSON 16KB
export const AVATAR_BODY_LIMIT = 600 * 1024; // 头像 600KB（运输层；业务门 512KB 见 AVATAR_MAX_BYTES）
/** 头像业务上限（docs/22 §5.8：只收 image/png、≤512KB、服务端不重编码） */
export const AVATAR_MAX_BYTES = 512 * 1024;

// ---------------------------------------------------------------------------
// 注册安全问答（找回密码：忘记密码 → 校验账号 → 答安全问题 → 重置）
// ---------------------------------------------------------------------------

/**
 * 预设安全问题（2026-10-13 主人令的可选项清单；注册页下拉只从这里选）。
 * 【为什么是枚举而不是自由文本】问题本身要存库、要被 zod 校验、要在找回时原样回显
 * ——三方共用一个封闭集合，避免「用户自填问题被当成文案注入」「两端文案漂移」。
 * 服务端 zod `z.enum(SECURITY_QUESTIONS)` 与 DB 无 CHECK（问题进 DB 前已过 zod；
 * CHECK 加中文长串反而脆）——真源就是这份数组。
 * 【答案纪律】答案只在服务端归一化（NFKC + trim + 小写）后 argon2id 哈希存储，
 * 明文答案既不落库也不进日志；客户端不做答案预处理（原样上行，服务端归一）。
 */
export const SECURITY_QUESTIONS = [
  '你的第一只宠物叫什么？',
  '你小学班主任的名字是？',
  '你出生的城市是哪里？',
  '你最喜欢的动画片是哪部？',
  '你童年最好的朋友叫什么？',
  '你妈妈最拿手的一道菜是什么？',
  '你最喜欢的一本书是哪本？',
  '你最想去哪个城市旅行？',
] as const;

export type SecurityQuestion = (typeof SECURITY_QUESTIONS)[number];

/** 用户名规则（2026-10-13 主人令放宽）：2~30 位，中文/英文/数字/下划线，不能以数字开头 */
export const USERNAME_RE = /^[A-Za-z_一-鿿][A-Za-z0-9_一-鿿]{1,29}$/;

/** 头像 hash（服务端 = sha256(图片字节) 的小写十六进制；也是 GET /v1/avatar/:hash 的路径形状） */
export const AVATAR_HASH_RE = /^[0-9a-f]{64}$/;

/** 密码下限（2026-10-13 主人令：12 → 6 位；上限不变 128，黑名单相应扩充 6~11 位档） */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

/** 安全答案的长短界（归一化前的原始输入；归一化后为空串 → 400） */
export const SECURITY_ANSWER_MIN_LENGTH = 1;
export const SECURITY_ANSWER_MAX_LENGTH = 64;

/** 令牌（docs/22 §5.1）：32 字节 CSPRNG → `ms1_` 前缀 + 无填充 base64url（43 字符） */
export const TOKEN_PREFIX = 'ms1_';
export const TOKEN_BYTES = 32;
export const TOKEN_REGEX = /^ms1_[A-Za-z0-9_-]{43}$/;

/** 会话生命周期（docs/22 §5.1） */
export const SESSION_IDLE_DAYS = 30;
export const SESSION_ABSOLUTE_DAYS = 180;
export const SESSION_TOUCH_THROTTLE_MS = 60 * 60 * 1000; // last_seen 写节流 1h/次

/** 注销墓碑保留时长（docs/22 §5.7：sessions 置 account_deleted 保留 24h 供幂等重试） */
export const ACCOUNT_DELETION_TOMBSTONE_HOURS = 24;
/** 认证审计保留天数（docs/22 §5.7：每日清理任务删 90 天前） */
export const AUTH_AUDIT_RETENTION_DAYS = 90;

/** 同步协议头（docs/22 §3.4） */
export const SYNC_PROTOCOL_HEADER = 'x-sync-protocol';

/**
 * 错误码枚举（docs/22 §3.5 的 16 个 + docs/26 §4.7 新增 3 个 + 安全问答找回 2 个
 * + 违禁用户名 1 个 = 22 个）。
 * 状态码映射一并放这里（docs/22 §3.3：错误码枚举与状态码映射属协议真源内容）。
 * 找回密码两枚（2026-10-13 主人令）：NO_SECURITY_QUESTION=账号没设过安全问题（早期账号）；
 * BAD_SECURITY_ANSWER=答案不对——与 BAD_CREDENTIALS 分开，前端才能给出「再想想」级的提示。
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'BAD_CREDENTIALS',
  'FORBIDDEN',
  'NOT_FOUND',
  'USERNAME_TAKEN',
  'USERNAME_FORBIDDEN',
  'CONFLICT_STALE',
  'DOC_VER_BLOCKED',
  'CHALLENGE_DUPLICATE',
  'ENTRY_CONFLICT',
  'OVER_DAILY_CAP',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'PROTOCOL_TOO_OLD',
  'RATE_LIMITED',
  'INTERNAL',
  'DB_UNAVAILABLE',
  'NO_SECURITY_QUESTION',
  'BAD_SECURITY_ANSWER',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  BAD_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  USERNAME_FORBIDDEN: 400,
  CONFLICT_STALE: 409,
  DOC_VER_BLOCKED: 409,
  CHALLENGE_DUPLICATE: 409,
  ENTRY_CONFLICT: 409,
  OVER_DAILY_CAP: 409, // 语义码：以上行批量返回时逐条出现在 rejected[]，HTTP 仍为 200（docs/26 §4.6）
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PROTOCOL_TOO_OLD: 426,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  DB_UNAVAILABLE: 503,
  NO_SECURITY_QUESTION: 404,
  BAD_SECURITY_ANSWER: 401,
};

// ---------------------------------------------------------------------------
// 挑战与题目元数据（docs/26 §7.1）
// ---------------------------------------------------------------------------

export const LANGS = ['common', 'c', 'cpp', 'java', 'python'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * 挑战开赛前可勾选的语言（= LANGS 去 common，四门）。客户端勾选器、
 * challenge_days.picked_langs（迁移 0010）与排行榜「所选语言」列的取值域。
 */
export const CHALLENGE_PICKABLE_LANGS = ['c', 'cpp', 'java', 'python'] as const;
export type PickableLang = (typeof CHALLENGE_PICKABLE_LANGS)[number];

export const QUESTION_TYPES = ['choice', 'fill', 'code', 'codefill', 'codefix', 'codewrite'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'challenge'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** 阶段号值域：0~3（客户端 Stage 类型同域） */
export const MAX_STAGE = 3;

/** 每题基准分（docs/26 §5.2）。v3 起语言权重统一 100：easy × common 仍 = 100 分/题 */
export const BASE_POINTS_PER_QUESTION = 100;

/** 难度权重（整数百分数，docs/26 §5.3） */
export const DIFFICULTY_WEIGHTS: Record<Difficulty, number> = {
  easy: 100,
  medium: 150,
  hard: 200,
  challenge: 250,
};

/**
 * 语言权重（整数百分数）。2026-10-10 挑战 v3 主人令：**全部 100——C/C++/Java/Python 同权**。
 * 公式与签名保留（weightedPoints 照乘），它只是退化为恒等：
 * 单题得分从此只由难度决定，多语言不代表高分、专精一门也能霸榜。
 */
export const LANG_WEIGHTS: Record<Lang, number> = {
  common: 100,
  python: 100,
  java: 100,
  c: 100,
  cpp: 100,
};

/**
 * 单题得分（整数化，四舍五入；ok=false 由调用方计 0）。
 * 与 docs/26 §5.2 公式逐字对应：round(100 × D × L ÷ 10000)。
 * v3 起 L 恒 100，结果即难度分（easy 100 / medium 150 / hard 200 / challenge 250）。
 * 服务端结算与客户端离线预览共用这一份公式。
 */
export function weightedPoints(difficulty: Difficulty, lang: Lang): number {
  return Math.round((BASE_POINTS_PER_QUESTION * DIFFICULTY_WEIGHTS[difficulty] * LANG_WEIGHTS[lang]) / 10000);
}

/**
 * 每日挑战单批题数的**健全性上界**（不是产品规则）。
 * 2026-10-10 晚挑战 v3 主人令：取消「每天最多 20 题」——答对继续、答错即止，
 * 客户端一次抽**整个已学题库**（开始前可勾选今天想考的语言）。本常量只兜底防跑飞：
 * 全库实测 4169 题 + AI 段 20 道 = 4189（最坏值），取 5000 留余量。
 * 服务端结算接受 total ∈ [1, CHALLENGE_RUN_MAX]；DB 侧同名约束经迁移 0009 放宽到 1..5000。
 */
export const CHALLENGE_RUN_MAX = 5000;

/**
 * 结算 dateKey 的过去窗口（天）。与客户端本地存档保留期 CHALLENGE_KEEP_DAYS = 30 对齐：
 * 客户端还留着的日子都在窗内，超窗 = 伪造或病态时钟 → 服务端 400 拒 + 审计日志。
 * 未来方向容忍 DAY_KEY_WINDOW_DAYS 天（两端现在都以北京日为锚；容差继续吸收
 * 非中国时区客户端与时钟偏差）。
 */
export const CHALLENGE_SETTLE_PAST_DAYS = 30;

/** 单日理论满分 = 5000 × round(100×250×100÷10000) = 5000×250 = 1,250,000
 *  （v3 语言权重全 100 后的难度分制；正常打不到，纯应用层护栏——DB 对 score 只 CHECK >= 0） */
export const DAILY_SCORE_MAX = CHALLENGE_RUN_MAX * weightedPoints('challenge', 'cpp');

/**
 * 难度默认规则表（与客户端 `shared/difficulty.ts` 的 resolveDifficulty 同构，
 * 不含显式字段覆盖；服务端复核上报难度用——docs/26 §7.2「取低计分」）。
 * 等价性由 cloud-protocol.test.ts 用 (题型 × 阶段) 全矩阵逐项断言。
 */
export function defaultDifficulty(type: QuestionType, stage: number): Difficulty {
  switch (type) {
    case 'choice':
    case 'fill':
      return 'easy';
    case 'code':
    case 'codefill':
      return 'medium';
    case 'codefix':
      return stage >= 3 ? 'hard' : 'medium';
    case 'codewrite':
      return 'hard';
  }
}

// ---------------------------------------------------------------------------
// 大白饭镜像账（docs/26 §6）
// ---------------------------------------------------------------------------

export const RICE_LEDGER_KINDS = ['adopt', 'lesson', 'review', 'answer', 'run', 'feed', 'chase', 'chat', 'checkin'] as const;
export type RiceKind = (typeof RICE_LEDGER_KINDS)[number];

/**
 * delta 白名单（防伪造地基：条目形状固定，多报只能多条，不能一条报 999）。
 * 数值与客户端 `shared/pet.ts` 常量逐项等价（等价单测钉住）。
 * 【2026-10-10 夜更正两处口径（docs/26 §6.2 同步修）】
 *   · checkin 补进白名单：签到实发 2 碗（PET_REWARD_RICE.checkin）；原表漏了它
 *     —— 账本模型下 pet.json.rice 是 clamp(Σentries) 的镜像，漏掉的加饭会被
 *     下一次镜像重算抹掉（迁移 0011 重建 DB CHECK 到九项）；
 *   · chase/chat 与 PET_CHASE_COST/PET_CHAT_COST **无关**：实现里这两个动作
 *     扣的是**饱食度**（exertPet），不是饭 —— 原表「依据」列写错了实现事实。
 *     两行白名单保留（服务端宽容收），但 **v1 客户端从不上行这两个 kind**
 *     （客户端没有对应的饭事件；CHASE_CHAT 的 delta 是冻结值，无客户端依据）。
 */
export const RICE_DELTA_BY_KIND: Record<RiceKind, number> = {
  adopt: 0, // 来源标记，不携带余额（每 installId 一条、必须最早）
  lesson: 2, // = PET_REWARD_RICE.lesson
  review: 2, // = PET_REWARD_RICE.review
  answer: 1, // = PET_REWARD_RICE.answer
  run: 1, // = PET_RUN_REWARD_RICE
  feed: -1, // 喂饭
  chase: -1, // 冻结值，v1 客户不上行（详见上注）
  chat: -2, // 冻结值，v1 客户不上行（详见上注）
  checkin: 2, // = PET_REWARD_RICE.checkin（每日签到；日上限 1）
};

/** 余额上界（= 客户端 PET_RICE_MAX，两端同值；DB CHECK 同值） */
export const RICE_MAX = 999;

/**
 * kind 日上限（docs/26 §6.4；adopt 不设日上限——每 installId 一生的唯一性由规则管）。
 * chase/chat 的上限是冻结白名单值、无客户端依据（v1 不上行，见上注）；
 * checkin: 1 = 每日签到一次（PET 签到本就日一次，上限即语义本身）。
 */
export const RICE_DAILY_CAP_BY_KIND: Record<Exclude<RiceKind, 'adopt'>, number> = {
  lesson: 20,
  review: 20,
  answer: 300,
  run: 10, // = PET_RUN_REWARD_DAILY_MAX
  feed: 30,
  chase: 300, // 冻结值（无客户端依据）
  chat: 120, // 冻结值（无客户端依据）
  checkin: 1,
};

/** entryKey 形状 `${installId}:${localSeq}`（installId=uuid；DB CHECK 长度 8~80） */
export const RICE_ENTRY_KEY_MIN_LENGTH = 8;
export const RICE_ENTRY_KEY_MAX_LENGTH = 80;
export const RICE_ENTRY_KEY_RE = /^[0-9a-fA-F-]{36}:[0-9]{1,19}$/;

/** run 条目 ref.fingerprint 形状（= 客户端 pet.ts RUN_FP_RE；等价单测钉住） */
export const RICE_RUN_FINGERPRINT_RE = /^[0-9a-z]{1,10}:[0-9a-f]{1,8}$/;

/** dayKey 与服务器日容差（docs/26 §6.4 ③：差 >1 天拒收；北京日锚，容差吸收非 +8 客户端与时钟偏差） */
export const DAY_KEY_WINDOW_DAYS = 1;
/** at 与服务器时差超过此值 → 记 flag 照收（不罚诚实用户） */
export const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// 日期键（客户端北京日 UTC+8；服务端只校验形状与真实日期）
// ---------------------------------------------------------------------------

export const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;
/** 月榜 snapshot 键（2026-10-10 改版新增，与前端月榜页签对齐） */
export const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
/** 年榜 snapshot 键（2026-10-10 改版新增，与前端年榜页签对齐） */
export const YEAR_KEY_RE = /^\d{4}$/;

// ---------------------------------------------------------------------------
// 排行榜（docs/26 §4.5）
// ---------------------------------------------------------------------------

/** 榜单周期（2026-10-10 改版：补 monthly/yearly，与前端五页签日/周/月/年/总对齐） */
export const LEADERBOARD_PERIODS = ['daily', 'weekly', 'monthly', 'yearly', 'alltime'] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/** keyset 分页游标 = base64(score:accountId) */
export const LEADERBOARD_LIMIT_MAX = 100;
/** 挑战历史一次最多拉多少天（≤90） */
export const CHALLENGE_HISTORY_LIMIT_MAX = 90;
/** 流水下行一次最多拉多少条 */
export const RICE_PULL_LIMIT_MAX = 500;

// ---------------------------------------------------------------------------
// 限流数值（docs/22 §5.4 + docs/26 §4.7 的追加三行）
// ---------------------------------------------------------------------------

export const RATE_LIMITS = {
  /** 挑战提交：10 次/日/账号（重试同 submissionId 不计） */
  challengeSubmitPerDayPerAccount: 10,
  /** 流水上行：6 次/时/账号 */
  ricePushPerHourPerAccount: 6,
  /** 流水批量：≤200 条/次 */
  riceEntriesPerPush: 200,
  /** 流水日条数：≤1000 条/日 */
  riceEntriesPerDayPerAccount: 1000,
  /** 头像上传：10 次/时/账号 */
  avatarUploadPerHourPerAccount: 10,
  /** 改密：5 次/日/账号 */
  passwordChangePerDayPerAccount: 5,
  /** 改用户名：5 次/日/账号（2026-10-22 用户系统批次） */
  usernameChangePerDayPerAccount: 5,
  /** 注销：3 次/日/账号 */
  deleteAccountPerDayPerAccount: 3,
  /** 找回（取问题/验答案/重置共用一个桶）：10 次/15min/IP —— 2026-10-13 新增；
   *  防账号枚举扫描与答案爆破的 IP 面。账号是否存在在取问题处如实回答——榜面本就
   *  公开用户名，不构成新的枚举面。 */
  recoverPer15MinPerIp: 10,
  /** 找回-验答案 / 重置：10 次/日/账号（两端点共用一桶，叠加按用户名的指数退避——答案
   *  是弱秘密，防爆破靠退避+日闸两层；2026-10-13 新增） */
  recoverAttemptPerDayPerAccount: 10,
} as const;

// ---------------------------------------------------------------------------
// 用户名违禁词（2026-10-22 用户系统批次）
// ---------------------------------------------------------------------------

/**
 * 本地违禁词词库（客户端预检 + 服务端权威判定共用这一份）。
 *
 * 【口径】只收「明显辱骂 / 色情 / 违法危险 / 仇恨」的词，不做政治敏感大表：
 * 词库越宽，正常网名被误伤的概率越高（「散华」「巴比伦」这类词都是受害者）。
 * 匹配 = NFKC + 小写归一；中文按去空白后的子串匹配（防「傻 逼」），
 * 英文按 `\b` 词边界匹配（`Sussex` 里的 sex 不算 —— 词边界把这种误伤挡住）。
 * 被命中的词原样返回，供日志/测试定位；没命中返回 null。
 */
export const SENSITIVE_USERNAME_WORDS = [
  // 辱骂/人身攻击（中文）
  '傻逼',
  '煞笔',
  '沙比',
  '操你妈',
  '草泥马',
  '你妈的',
  '他妈的',
  '妈的逼',
  '日你妈',
  '干你娘',
  '死全家',
  '婊子',
  '贱人',
  '狗日的',
  '龟儿子',
  '杂种',
  '畜生',
  '王八蛋',
  '鸡巴',
  '屌你',
  // 色情/约炮
  '淫秽',
  '色情',
  '约炮',
  '一夜情',
  '裸聊',
  // 违法/危险/仇恨
  '法轮功',
  '台独',
  '港独',
  '藏独',
  '疆独',
  '反华',
  '颠覆国家',
  '恐怖分子',
  '恐怖主义',
  '纳粹',
  '希特勒',
  // 英文（词边界匹配，大小写不敏感）
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'rape',
  'hitler',
  'nazi',
  'porn',
  'sex',
  'dick',
  'pussy',
  'asshole',
  'bastard',
  'slut',
  'whore',
  'isis',
  // 英文连写（词边界挡不住，单列）
  'fuckyou',
  'fuckoff',
  'motherfucker',
  'shithead',
] as const;

const SENSITIVE_LATIN_SET = new Set<string>(
  SENSITIVE_USERNAME_WORDS.filter((word) => /^[a-z]+$/.test(word)),
);

/**
 * 命中违禁词 → 返回命中的词；干净 → null。
 * 纯函数、无依赖，三端（渲染层/主进程/服务端）可直接调用。
 */
export function findSensitiveUsernameWord(input: string): string | null {
  if (typeof input !== 'string' || input === '') return null;
  const normalized = input.normalize('NFKC').toLowerCase();
  // 中文：去掉空白/零宽/常见分隔符后按子串找
  const compact = normalized.replace(/[\s​-‏⁠﻿._-]+/g, '');
  for (const word of SENSITIVE_USERNAME_WORDS) {
    if (SENSITIVE_LATIN_SET.has(word)) continue;
    if (compact.includes(word)) return word;
  }
  // 英文：先把下划线/标点/非英文字符折成空格，再按词边界找 ——
  // `a_nazi_b` / `fuck-you` 命中；`Sussex` / `Scunthorpe` 不中（词边界挡住）。
  const latinWords = [...SENSITIVE_LATIN_SET];
  if (latinWords.length === 0) return null;
  const latinRe = new RegExp(`\\b(${latinWords.join('|')})\\b`, 'i');
  const hit = latinRe.exec(normalized.replace(/[_\W]+/g, ' '));
  return hit === null ? null : hit[1]!.toLowerCase();
}
