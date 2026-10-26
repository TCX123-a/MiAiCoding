import { app, shell, BrowserWindow, ipcMain, nativeTheme, dialog, session, desktopCapturer, safeStorage, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { extname, join } from 'path'
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { copyFile, mkdir, rename, rm } from 'fs/promises'
import { spawn } from 'child_process'
import { IPC } from '../shared/ipc-channels'
import { APP_NAME, AVATAR_PICK, GALLERY, IDE_PICK, MEDIA_IMPORT, STORAGE_PREFLIGHT } from '../shared/copy'
import { SPLASH_UPLOAD_EXTS, WALLPAPER_UPLOAD_EXTS, type MediaImportResult } from '../shared/media-import'
import { grantReward, isGalleryId } from '../shared/gallery'
import { titleSymbolColorOf, windowBgOf } from '../shared/theme'
import { todayKey, parseDateKey } from '../shared/dates'
import { codeFingerprint } from '../shared/code-hash'
import { createJsonStore } from './store/json-store'
import { createStores } from './store/stores'
import type { BoxStamp } from './store/box'
import type { DocWriteResult, StampedDoc } from '../shared/doc-write'
import { attemptDocWrite } from './store/doc-write'
import { applyProfileSave } from './store/profile-apply'
import { DEVICE_FILE_VERSION, ensureDeviceFile, saveDeviceFile, type DeviceInfo } from './store/device'
import { mergeConfigPayload, toPublicConfig, withPetEnabled } from './store/config-merge'
import { migrateConfig } from '../shared/config-migrate'
import { applyCheckin, migrateProfile } from '../shared/profile-migrate'
// 日键正则从冻结区 import（protocol.ts 一个字不动，只读它的常量；它零依赖，无环）
import { AVATAR_HASH_RE, DATE_KEY_RE, SECURITY_QUESTIONS, type LeaderboardPeriod } from '../shared/cloud/protocol'
import { PET_CHECKIN_RICE, PET_RICE_MAX } from '../shared/pet'
import { challengeToday, mergeChallengeDay } from './store/challenge-merge'
import {
  applyWrongRecord,
  applyWrongUpdate,
  normalizeWrongbook
} from './store/wrongbook-merge'
import { applyFavoritesSave, normalizeFavorites } from './store/favorites-merge'
import { cleanMemo, sanitizeMemo } from './store/memo-merge'
import { appendPractice, normalizePractice } from './store/practice-merge'
import { questionsWithCache, type AiCacheFile } from './store/ai-cache'
import { detectAll, nativeEnv, refreshLangs } from './env/detect'
import { enqueueRun, killAllLiveChildren, MAX_CODE_BYTES, MAX_STDIN_BYTES } from './runner/runner'
import { enqueueNativeRun, nativeGateReason } from './runner/native'
import { exportCodeToFile, openInNativeIde } from './runner/native-ide'
import { createNativeWatcher } from './runner/native-watch'
import { detectIdes } from './runner/detect-ide'
import { scanRewardOverrides } from './rewards/override'
import { registerWallSchemePrivileges } from './wallpaper/protocol'
import { addProtocolRootProvider, getWallpaperCatalog, primeWallProtocol, setCustomWallpaperDirProvider } from './wallpaper/catalog'
import { attachWindowStatePush, readWindowState } from './wallpaper/window-state'
import { decideNavigation, isExternalUrlAllowed } from './window-guards'
import { readWallpaperProps } from './wallpaper/props'
import { createSplashGate, type SplashGate } from './splash'
import { startDshPetHost, type DshPetHost } from './dshpet/host'
import { scanSplashMaterials, splashMaterialDirs } from './splash/material'
import { importMedia, type PickFileRequest } from './media-import'
import { explainError, generateQuestions, testConnection, type AiDeps } from './ai/deepseek'
import { createChatGate, runChat } from './ai/chat'
import {
  appendChatMessage,
  clearChatFile,
  normalizeChatFile,
  type AiChatFile
} from './store/ai-chat'
import {
  AccountFlowError,
  accountDirOf,
  activateAccount,
  addSettle,
  CLOUD_DOC_MERGERS,
  createApiProvider,
  createCloudAccountClient,
  createCloudAvatarClient,
  createCloudChallengeClient,
  createCloudLeaderboardClient,
  createCloudRiceClient,
  createPendingOpsStore,
  createRiceJournal,
  createSessionTokenStore,
  createSyncEngine,
  createUplink,
  cloudFail,
  cloudOk,
  drainWithCap,
  isAccountActivated,
  leaveToGuest,
  logoutLocal,
  parseSettlePayload,
  readAvatarPick,
  resolveCloudBaseUrl,
  restoreOnStartup,
  type AccountFlowDeps,
  type ActivateMode,
  type AvatarBatchView,
  type AvatarPickView,
  type AvatarUploadResponse,
  type CloudAccountState,
  type CloudActivatePreviewView,
  type CloudActivateView,
  type CloudCredentials,
  type CloudRegisterInput,
  type CloudResult,
  type FetchLike,
  type PendingSettleOp
} from './cloud'
import { isCanonicalUuid } from './store/account-id'
import { createPetStore } from './pet/store'
import type {
  AiChatDeltaPayload,
  AiChatDonePayload,
  AiChatHistoryView,
  AiChatStartInput,
  AiChatStartResult,
  AiExplainInput,
  AiGenerateInput,
  AiResult,
  AppConfig,
  ChallengeDay,
  ChallengeToday,
  CheckinSubmitResult,
  ConfigSavePayload,
  ExportCodeResult,
  FavoritesFile,
  GallerySaveResult,
  GlossaryTerm,
  IdeDetectResult,
  IdeOpenResult,
  LangOfCode,
  MemoFile,
  MiThemeName,
  PickExeResult,
  PracticeFile,
  PracticeRecordInput,
  PublicAppConfig,
  RewardOverridesInfo,
  RunRequest,
  UserProfile,
  WrongBookEntry,
  WrongRecordItem,
  WrongUpdateItem
} from '../shared/types'
import type { WallpaperCatalog, WallpaperPropsResult, WallpaperWindowState } from '../shared/wallpaper'
import type { PoolItem } from '../shared/challenge'
import { gradeByRun } from '../shared/run-grading'
import {
  CURRENT_WRONGBOOK_VERSION,
  DEFAULT_APP_CONFIG,
  DEFAULT_PROFILE,
  LANG_OF_CODE
} from '../shared/types'

const isDev = !app.isPackaged

/**
 * 开发期诊断开关：只有显式设了 `MIAI_DEBUG_PORT` 才开远程调试端口。
 *
 * 【为什么要留这个口子】
 * 「光标乱跳、选不中字」这类问题**没法靠读代码下结论**——它取决于真实的
 * DOM 布局和事件时序，猜出来的根因十有八九是错的。这次就是现成的例子：
 * 接上真编辑器、真的敲键盘按 Ctrl+A 之后才发现，主人报的现象里
 * **有一条是真的**（点完「运行」焦点永远回不到编辑器，所以 Ctrl+A 没反应），
 * **另一条复现不出来**（「光标一直在跳」）。没有这个端口，只能靠猜，
 * 而「照着猜出来的根因改代码」比什么都不改更危险。
 *
 * 【为什么必须用环境变量守住】
 * 这个端口能把渲染进程扒得一干二净。要是打包进用户装的版本里，
 * 等于给每个用户的机器开了个后门。所以默认**必须是关的**，
 * 只有手动设了变量才会开。
 */
const debugPort = process.env['MIAI_DEBUG_PORT']
if (debugPort) app.commandLine.appendSwitch('remote-debugging-port', debugPort)

/*
 * miai-wall:// 特权协议（壁纸资产通道，docs/23 §2.2）。
 *
 * **必须在 app ready 之前**：scheme 的 privileges 只能在 ready 前声明，
 * 晚了这个 scheme 就不是 standard/secure 上下文 —— 表现是视频加载被当成
 * 跨源脏请求挡掉，或者 `miai-wall:` 根本不算合法 origin。
 * 装 handler（哪些目录可访问）在 ready 后、**建窗口之前**：
 * primeWallProtocol()（见它的注释 —— 渲染进程出生后再装就晚了）；
 * 根白名单不在这里定，挂在 catalog 的扫描快照上（活读口），重扫自动跟上。
 */
registerWallSchemePrivileges()

/** 数据目录：便携版随 exe 走（data/ 子目录），安装版走 userData（%APPDATA%\咪爱编程） */
function storageDir(): string {
  const portable = process.env['PORTABLE_EXECUTABLE_DIR']
  return portable ? join(portable, 'data') : app.getPath('userData')
}

// ---------------------------------------------------------------- 启动前置检查（D2，2026-10-17）

/**
 * 数据目录可写性前置检查 —— 只读 / 满盘时**出声退出**，绝不静默闪退。
 *
 * 【为什么用真实写探针，不用 accessSync(W_OK)】Windows 的 access() 只看文件的
 * 只读属性，**不评估 ACL**：被 icacls 拒绝写入的目录照样报「可写」，探针就成了
 * 摆设。mkdir + write + unlink 走的是真正会失败的那条系统调用，EACCES/EPERM
 * （拒绝访问）与 ENOSPC（满盘）都会如实抛出来。
 *
 * 【为什么查两个目录】storageDir() 是我们的数据落点（便携版 = exe 旁的 data/、
 * 安装版 = userData）；userData 同时是 Chromium 的 profile 目录 —— 它不可写时
 * Chromium 连 lock file 都建不出来（实测：无窗口、无对话框、静默退出 0）。两个
 * 都探，把能查到的失败一次说清。
 *
 * 【时序】模块顶层执行，早于 whenReady 与任何窗口创建；dialog.showErrorBox
 * 明确支持 ready 前调用（Electron 文档口径），且是阻塞框 —— 弹出的这一刻后续
 * 启动流程不会继续往前跑。用户点掉后 app.exit(1)，退出码不再是「成功」的 0。
 *
 * 【为什么不在 index.ts】index.ts 是薄入口，`--dsh-pet-helper` 分支会在 require
 * 真正的 app 之前 return —— 检查放那里会连桌宠 helper 一起拦。app.ts 只有本体
 * 才 require，检查放这里天然只覆盖本体。
 */
function probeWritableDir(dir: string): string | null {
  const probe = join(dir, `.miai-write-probe-${process.pid}-${Date.now()}`)
  try {
    mkdirSync(dir, { recursive: true }) // 首启目录可能不存在：先建，否则 ENOENT 假报警
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return null
  } catch (err) {
    try {
      unlinkSync(probe)
    } catch {
      /* 没写成、或删不掉：都交给下面这条错误信息 */
    }
    const code = (err as NodeJS.ErrnoException).code
    return `${code ? code + ': ' : ''}${err instanceof Error ? err.message : String(err)}`
  }
}

function ensureStorageWritableOrExit(): void {
  const targets: string[] = []
  const failures: string[] = []
  try {
    targets.push(app.getPath('userData'))
  } catch (err) {
    failures.push(`userData: ${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const dir = storageDir()
    if (!targets.includes(dir)) targets.push(dir)
  } catch (err) {
    failures.push(`storageDir: ${err instanceof Error ? err.message : String(err)}`)
  }
  for (const dir of targets) {
    const failure = probeWritableDir(dir)
    if (failure !== null) failures.push(STORAGE_PREFLIGHT.DETAIL(dir, failure))
  }
  if (failures.length === 0) return
  // 诊断留痕：GUI 对话框的正文不进日志，stderr 这一行是排查时唯一的机器可读证据
  console.error('[miai] storage preflight failed:', failures.join(' | '))
  // 文案统一住 shared/copy.ts（文案闸门扫整棵 src/，主进程弹框也不许写死中文）
  dialog.showErrorBox(
    STORAGE_PREFLIGHT.TITLE,
    STORAGE_PREFLIGHT.BODY_HEAD +
      STORAGE_PREFLIGHT.BODY_CAUSE +
      STORAGE_PREFLIGHT.BODY_ACTION +
      STORAGE_PREFLIGHT.TECH_HEAD +
      failures.join('\n\n')
  )
  app.exit(1)
}

ensureStorageWritableOrExit()

/**
 * 奖励图覆盖目录：`<数据目录>/rewards` —— 把 `gNN.png`（或 jpg/jpeg/webp）
 * 丢进去即替换对应奖励图（机制与扫描口径见 rewards/override.ts 文件头）。
 * 「目录在哪」只在主进程拼这一份：设置页显示路径、IPC 现扫、协议白名单、
 * 保存图片四处都吃它，散着拼迟早有一处拼歪。
 */
function rewardsDir(): string {
  return join(storageDir(), 'rewards')
}

/**
 * 弹一个「挑一个文件」的系统对话框（导入壁纸 / 导入开屏视频共用，2026-10-06）。
 *
 * 【为什么只回路径，别的什么都不做】校验扩展名、查体积、拷贝、重名去重
 * 全在 media-import.ts 里 —— 那个文件零 electron 依赖，可以被 Vitest 配
 * 真临时目录整条测。这里只剩「弹框」这一步（electron-only，测不了）：
 * 取消 → null（不是错误，与 dialogPickExe 的既有口径一致）。
 */
async function pickFileViaDialog(event: IpcMainInvokeEvent, req: PickFileRequest): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options: OpenDialogOptions = {
    title: req.title,
    properties: ['openFile'],
    filters: [{ name: req.filterName, extensions: [...req.exts] }]
  }
  const { canceled, filePaths } = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  const picked = filePaths[0]
  if (canceled || !picked) return null
  return picked
}

/**
 * 盒装存储（P10.1）：**跟人走**的六个文件全部经 StoreBox 路由。
 *
 * 【盒子怎么分】客人盒 = 数据目录（`storageDir()`）本身 —— 老档案一个字节不搬
 * （收编语义的红线：客人档案在任何路径下都不移动）；账号盒在
 * `<数据目录>/accounts/<accountId>/` 下。切盒走 `box.switchTo(...)`（P10.5 接线）。
 *
 * 【谁不进盒】config.json（设备级设置，含 apiKey——永不同步）与 ai-cache.json
 * （本机算过的缓存，同步它没有意义）留在下面单独建；pet.json 同理
 * （docs/26 拍板：桌宠状态继续是设备显示状态）。device.json 也不是盒内文件 ——
 * 它是设备的身份证，一个设备一份（见 device() 的注释）。
 */
// stores 对象本身要留给 P10.5 的账号流程（AccountFlowDeps.stores：收编/切盒/
// 装账本都从它拿），故先命名再解构 —— 用具名对象拼一份假的只会在 store 加字段
// 时静默漏掉一个键。
const stores = createStores(storageDir())
const {
  // box（P10.x 上行接线起在这里取）：大白饭账本与结算队列都按**当前盒目录**
  // 现读（客人盒 = 数据目录本身，账号盒在 accounts/<id>/ 下）；切盒时的
  // 账本 reload 与会话扫描在 P10.5 接线
  box,
  // 学习档案（M3-04）：profile.json 原子写 + .bak 双副本
  profile: profileStore,
  // 错题本（M4-05）：wrongbook.json。2026-09-29 起根是**信封**（`{version, entries}`），
  // 老文件是裸数组 —— 形状的兼容与清洗全在 normalizeWrongbook（读口 readWrongbook）
  wrongbook: wrongbookStore,
  /**
   * 每日挑战（M6）：challenge.json —— **单独一个文件，不塞进 profile.json**。
   *
   * 【为什么不复用 profile.json】
   * 塞进去就要写迁移函数（老档案没有这个字段，读出来得补默认值），
   * 而本项目的迁移基建目前是 0 —— 为一个新功能先造一套迁移，代价远大于多一个文件。
   * 而且挑战记录和「学习档案」的生命周期不一样：档案是要跟人一辈子的，
   * 挑战记录只留 30 天。放一起，将来想清挑战记录都不敢动手。
   */
  challenge: challengeStore,
  // 收藏的**题目**（学习闭环，2026-09-29）：favorites.json。
  // ⚠️ 和 profile.favorites（**课级**收藏，存在学习档案里）同名不同义，别合并
  favorites: favoritesStore,
  // 练习史（学习闭环）：practice.json —— 每日复习按错误率加权的**真源**。
  // 一次做完的练习落一条；上限与裁剪见 shared/types.ts 的 PRACTICE_KEEP_SESSIONS
  practice: practiceStore,
  // 大肥鱼备忘录（P3 ②）：memo.json —— 用户自己攒的代码片段与知识备忘。
  // 和 favorites 同型：只有渲染层一个写方，整份读整份存；清洗与校形在 store/memo-merge.ts
  // （读口宽松、写口抛错 —— 备忘是用户自己敲的字，丢一条的代价比收藏一道题还大）
  memo: memoStore
} = stores

// 设置（M5-01 环境缓存 / M6 设置页）：config.json —— **设备级，不进盒**（文件头有账）
const configStore = createJsonStore<AppConfig>(storageDir(), 'config.json')

// AI 出题缓存（学习闭环阶段 7）：ai-cache.json —— 同一个问题只花一次钱。
// **只有成功的响应才进来**（规矩在 store/ai-cache.ts 的 cachePut 抬头）；
// 键是 prompt 的哈希，换模型/改提示词自动失效，不需要"清缓存"这个动作
const aiCacheStore = createJsonStore<AiCacheFile>(storageDir(), 'ai-cache.json')

/**
 * 侧栏对话历史（P1，docs/27 §10）：`chat.json` —— **设备级，不进盒**。
 *
 * 【为什么不进盒】AI 缓存与它同类：是本机这一台机器上发生过的对话。
 * 云同步的四份文档（档案/错题/收藏/练习）是"学习成果"，对话是"聊天记录"，
 * 混进盒会让同步体积和隐私面同时变大，而 docs/27 没要求它跟着人走。
 *
 * 【为什么不用 ai-cache 那个文件】见 store/ai-chat.ts 抬头：长文本、不命中、
 * 会挤掉出题缓存。两个文件、两套上限，各自坏各自修。
 */
const aiChatStore = createJsonStore<AiChatFile>(storageDir(), 'chat.json')

/**
 * 读配置，缺了就给一份默认的（**别把 DEFAULT_APP_CONFIG 直接交出去**，它是共享常量）。
 *
 * 【迁移为什么挂在这里】这是全项目**唯一**读 config.json 的地方
 * （`configStore.read()` 的其它调用点一个都没有）。铁律 6 要求「加字段就写迁移」，
 * 迁移要有个地方跑——挂在读口上，就**不存在「漏了某条路径没迁」这种可能**，
 * 因为所有路径都从这里过。
 *
 * 【为什么迁完要落一次盘】
 * 不落盘也能用（每次读重新迁一遍，结果一样）。但那样文件里的 `version`
 * 会**永远停在 1**，而内存里跑的是 v2 —— 将来排查问题时打开 config.json，
 * 看到的版本号和实际行为对不上，这类误导比多写一次盘贵得多。
 * 只在版本真的变了时才写，正常启动一次都不写。
 *
 * 写失败（磁盘满、没权限）**不阻塞读取**：这次用内存里迁好的配置照常干活，
 * 顶多下次读再迁一遍。迁移是幂等的，重复跑没有任何副作用。
 */
function readConfig(): AppConfig {
  const raw = configStore.read()
  if (raw === null) return structuredClone(DEFAULT_APP_CONFIG)

  const cfg = migrateConfig(raw)
  if (raw.version !== cfg.version) {
    try {
      configStore.write(cfg)
    } catch {
      /* 落盘失败不影响本次使用，下次读会再迁一遍 */
    }
  }
  return cfg
}

/**
 * 校验「{ lang, code }」形状的入参（runner:open-ide / runner:export-code 共用）。
 * **形状不对就抛**（同 runner:run 的规矩）：那是调用方写错了，
 * 翻译成一句温和的失败只会把 bug 藏起来。
 *
 * 【为什么不顺手把 runner:run 也改成用它】那条是 3.0 起就稳定运行的路径，
 * 还多验 native / stdin 两个字段 —— 为了「消一处重复」去动它，不值。
 */
function parseCodePayload(input: unknown): { lang: LangOfCode; code: string; own: boolean } {
  if (
    !input ||
    typeof input !== 'object' ||
    typeof (input as { lang?: unknown }).lang !== 'string' ||
    !(LANG_OF_CODE as readonly string[]).includes((input as { lang: string }).lang) ||
    typeof (input as { code?: unknown }).code !== 'string'
  ) {
    throw new Error('invalid code payload')
  }
  const { lang, code } = input as { lang: LangOfCode; code: string }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) throw new Error('code too large')
  // own（2026-10-06）：渲染层在**发起这次导出时**做的「这段是用户自己写的」
  // 一次性判定（种子比对，见 runner store 的 seedFp）。老调用方不带 = 按 false
  // 收（保守：宁可漏发奖，不把官方示例代码记成用户作品）；带了但不是布尔 =
  // 调用方坏了，如实抛（同其它字段的形状纪律）。
  const rawOwn = (input as { own?: unknown }).own
  if (rawOwn !== undefined && typeof rawOwn !== 'boolean') throw new Error('invalid code payload')
  return { lang, code, own: rawOwn === true }
}

/**
 * 「本地 IDE 打开 / 导出」成功后的编译观察挂表（2026-10-06，原生路径的运行奖）。
 *
 * 【为什么只认 own】own 是渲染层发起这一次导出时的种子比对 ——「编辑器里这段
 * 不是官方示例代码」。示例代码导出/打开不挂表，于是「跑官方示例不奖励」这条
 * 规则在原生路径上也有机械保障（内置编辑器那条路同样只带 own 上报）。
 *
 * 【为什么指纹在这里算一次随表带入】用户接着会在 IDE 里改代码再编译（这正是
 * 「导出到本地」的用法）；确认那一刻重算指纹，奖励会记到一段我们**从没交出去**
 * 的代码头上（native-watch.ts 的契约注释写过这条）。指纹的身份是「交出去的那份」。
 *
 * python 不收（没有编译产物可观察）—— 由 native-watch 自己按语言划界，
 * 这里不做第二份判断。
 */
function trackNativeCompile(
  result: IdeOpenResult | ExportCodeResult,
  lang: LangOfCode,
  code: string,
  own: boolean
): void {
  if (!result.ok || !own) return
  // ok 分支的 path 在两条返回类型里都是必填 string；再挡一手空串（防御性）
  if (result.path === '') return
  nativeWatcher.track({
    sourceFile: result.path,
    fingerprint: codeFingerprint(code),
    lang,
    startedAt: Date.now()
  })
}

/**
 * 读学习档案 —— 和 `readConfig()` 是**同一套收口**，理由也同源。
 *
 * 【为什么必须收口】
 * 档案原来有两处裸读写（`profile:get` 直接 `read()`、`profile:save` 直接 `write()`），
 * 意思是「文件里是什么就信什么」。老档案（v1）里没有 `rewards` 这一节，
 * 新代码一读它就是 `undefined` —— 发奖逻辑 `.gallery.includes(...)` 当场抛错。
 * 收成一个读口之后，**迁移只有可能漏在一条路上**（就是把 `profileStore.read()`
 * 再加回来），而那种漏法是能一眼看出来的。
 *
 * 【为什么迁完要落一次盘】和 readConfig 一字不差：不落盘也能用，但文件里的
 * `version` 会永远停在 1 而内存里跑的是 v2，将来排查问题时对不上号。
 * 只在版本真的变了时才写；写失败不阻塞读取（迁移幂等，下次读再迁一遍）。
 *
 * ⚠️ 别把 `DEFAULT_PROFILE` 直接交出去 —— 它是共享常量，调用方一改就污染全局。
 */
/**
 * 内部读口：**完整**档案（含 learnedAt / favoriteAt / tombstones 这些合并内部账）。
 * 主进程自己用（写口 apply 的基底、签到/发奖的读改写）。**别直接递给渲染层** ——
 * 对渲染层的读口是下面那个 readProfile()，它负责剥掉墓碑区再出门。
 */
function readProfileRaw(): UserProfile {
  const raw = profileStore.read()
  if (raw === null) return structuredClone(DEFAULT_PROFILE)

  const profile = migrateProfile(raw)
  if (raw.version !== profile.version) {
    try {
      profileStore.write(profile)
    } catch {
      /* 落盘失败不影响本次使用，下次读会再迁一遍 */
    }
  }
  return profile
}

/**
 * 对渲染层的读口（profile:get）：剥掉**墓碑区**再出门。
 *
 * 【为什么剥】墓碑是「这台设备上删过什么」的证据，只有合并逻辑有读者；
 * 渲染层拿着它没有用，但拿着就有回传的可能 —— 让它**看不见**，
 * 「墓碑归主进程独占」就从口头约定变成结构事实（docs/21 §8.3：读口剥离、
 * 写口维护）。时间戳（learnedAt / favoriteAt）不剥：它们没有删改语义，
 * 留着还便于将来界面显示「什么时候学会的」。写口也另有双保险（不听入参里的它们）。
 */
function readProfile(): UserProfile {
  const raw = readProfileRaw()
  const pub: Partial<UserProfile> = { ...raw }
  delete pub.tombstones
  return pub as UserProfile
}

/**
 * 读错题本 —— 读口唯一入口，形状兼容（裸数组 / 信封）全在 `normalizeWrongbook` 里。
 *
 * 【为什么必须收口】和 profile 同款：这个文件的根**换了形状**（裸数组 → 信封），
 * 而且条目加了 source / removed / hole。任何一处绕过它直接 `wrongbookStore.read()`，
 * 拿到的就是一份「类型说是信封、实际是数组」的东西 —— 而 TS 不会报错，
 * 因为磁盘上的形状它根本看不见。
 *
 * 【为什么会写盘】认出裸数组、或者这次迁掉了坏条目 → 把干净的信封写回去，
 * 顺手给文件补上版本号（和 readConfig 的「迁完落一次盘」同一笔账）。
 * 写失败不阻塞读取：内存里这份是好的，顶多下次读再迁一遍（幂等）。
 */
function readWrongbook(): WrongBookEntry[] {
  const { file, needsRewrite } = normalizeWrongbook(wrongbookStore.read())
  if (needsRewrite) {
    try {
      wrongbookStore.write(file)
    } catch {
      /* 落盘失败不影响本次使用 */
    }
  }
  return file.entries
}

/**
 * 写错题本：**只走这里**，免得某处写回一个裸数组把刚补上的信封又拆了。
 *
 * 【为什么没有条件写戳（P10.6 定案）】错题本三条写口是**操作型**：主进程
 * 拿到最新盘面自己 RMW，任何时刻写下的都是最新数据 —— 天然无冲突。
 * 给它加戳只会把「用户刚答错一题」延迟成「重载 + 重放」，而那个冲突
 * 根本防不住任何东西（没有第二个写者会覆盖它）。
 */
function writeWrongbook(entries: WrongBookEntry[]): void {
  wrongbookStore.write({ version: CURRENT_WRONGBOOK_VERSION, entries })
}

/** 读收藏夹（favorites.json）：读口，清洗与兼容都在 normalizeFavorites 里 */
function readFavorites(): FavoritesFile {
  const { file, needsRewrite } = normalizeFavorites(favoritesStore.read())
  if (needsRewrite) {
    try {
      favoritesStore.write(file)
    } catch {
      /* 落盘失败不影响本次使用 */
    }
  }
  return file
}

/** 读备忘录（memo.json）：读口，清洗与兼容都在 cleanMemo 里 */
function readMemo(): MemoFile {
  const { file, needsRewrite } = cleanMemo(memoStore.read())
  if (needsRewrite) {
    try {
      memoStore.write(file)
    } catch {
      /* 落盘失败不影响本次使用 */
    }
  }
  return file
}

/**
 * 设备身份（P10.1 第 2 项）：device.json 在**数据目录根**（不是盒内文件 ——
 * 一台设备一份，跟着盒搬家才是错的）。惰性建、记忆化；正常路径下
 * ensureDeviceFile 幂等（文件在就一个字节都不写，连 mtime 都不动）。
 *
 * 【建不出来怎么办】磁盘只读/权限异常时 ensureDeviceFile 会抛 —— 但那不该
 * 连坐 practice 的读（今天是能读的）。退回**本次进程内**的随机 id：uid 只需要
 * 唯一性（前缀把各台设备的数字 id 分开），它一样能把会话分开；而且那种磁盘上
 * uid 也写不进去（practice 的写口同样失败），不会留下"半真半假"的档。
 */
let memoDevice: DeviceInfo | null = null
function device(): DeviceInfo {
  if (memoDevice === null) {
    try {
      memoDevice = ensureDeviceFile(storageDir())
    } catch (err) {
      console.warn('[miai] device.json unavailable, using a volatile install id this session', err)
      memoDevice = {
        version: DEVICE_FILE_VERSION,
        installId: crypto.randomUUID(),
        clientLabel: 'device'
      }
    }
  }
  return memoDevice
}

// ---------------------------------------------------------------- 云上行接线（P10.x）

/**
 * 设备级大白饭序号分配器（rice-journal 的 nextSeq 出口）。
 *
 * 【语义】device.json.riceSeq = **已发出的最大序号**（0/缺省 = 还没发过号）。
 * 下一个 = max(riceSeq+1, 账本里本机最大 seq+1, 1) —— 三个来源取最大：
 *   · riceSeq+1：正常路径（设备记忆，跨启动单调）；
 *   · 账本最大+1：安全网 —— device.json 丢了/读坏时从账本恢复，绝不回卷
 *     （回卷 = 新条目撞服务端幂等键被当重放静默丢弃，饭就没了）；
 *   · 1：下界（seq 0 保留给 genesis，见 rice-journal 文件头）。
 * 【先发号落盘、后记账】号发出去就先写 device.json：发号之后、记账之前崩了，
 * 只烧掉一个号（空洞无害）；反过来（先记账后落号）崩在中间就会回卷。
 * 落号失败不抛：内存里 memoDevice 已带上新号，进程内仍单调；跨启动由账本
 * 安全网兜住（已落盘的条目在账本里，max+1 只会更大）。
 */
function nextRiceSeq(ledgerMaxSeq: number): number {
  const dev = device()
  const next = Math.max((dev.riceSeq ?? 0) + 1, ledgerMaxSeq + 1, 1)
  memoDevice = { ...dev, riceSeq: next }
  try {
    saveDeviceFile(storageDir(), memoDevice)
  } catch (err) {
    console.warn('[miai] failed to persist device rice seq', err)
  }
  return next
}

/** 设备 pet.json 的读口（只读）—— genesis 取存量饭数用；不是盒内文件，见文件头账 */
const petStoreForLedger = createPetStore(storageDir())

/**
 * 大白饭账本（docs/26 §6）：`<盒>/rice-ledger.json`，记一切饭变动。
 * pet.json.rice 从此只是 balanceOf(账本) 的**镜像** —— brain 的每笔饭变动
 * 都经 sink（startPet 的 onRice）进这里，返回值覆盖 brain 里算出的数。
 * 【装载时机】启动时 load 一次（建 genesis/读档）；切盒时由 P10.5 的会话
 * 接线再调 load() 换档（本模块不自己监听切盒，见 rice-journal 的 deps.dir 注释）。
 */
const riceJournal = createRiceJournal({
  dir: () => box.currentDir(),
  installId: device().installId,
  nextSeq: nextRiceSeq,
  carriedRice: () => petStoreForLedger.load(new Date().toISOString()).state.rice
})

/** 挑战结算待办队列（`<盒>/.sync/pending-ops.json`）：断网/未登录时排着，触达再发 */
const settleQueue = createPendingOpsStore(() => box.currentDir())

/**
 * 云客户端共用的三件：baseUrl（启动时裁决一次）、token store、fetch。
 * 【token 的落盘实现（P10.5）】登录成功即把完整会话（safeStorage 加密）写进
 * `accounts/<sub>/session.bin`，重启由 restoreOnStartup 扫描接回；登出/换号清
 * 旧文件（「至多一份」不变式见 session-store.ts 文件头）。
 * safeStorage 直接传：Electron 的 isEncryptionAvailable/encryptString/
 * decryptString 与 SafeStorageLike 端口结构同形 —— 没有第二种实现要换，包一层
 * 适配器只是多一层间接。
 */
const cloudBaseUrl = resolveCloudBaseUrl({ packaged: app.isPackaged, env: process.env })
const cloudTokens = createSessionTokenStore({ baseDir: storageDir(), safe: safeStorage })
const cloudFetch: FetchLike = (url, init) => globalThis.fetch(url, init)

const cloudRiceClient = createCloudRiceClient({
  baseUrl: cloudBaseUrl,
  fetch: cloudFetch,
  tokens: cloudTokens
})
const cloudChallengeClient = createCloudChallengeClient({
  baseUrl: cloudBaseUrl,
  fetch: cloudFetch,
  tokens: cloudTokens
})
// 榜面客户端（P10.6）：读榜 + opt-in 开关 + me 汇总。与上面几件共用同一个
// token store —— 登录一次，榜面就看得到（未登录时客户端自己零网络 UNLOGGED）。
const cloudLeaderboardClient = createCloudLeaderboardClient({
  baseUrl: cloudBaseUrl,
  fetch: cloudFetch,
  tokens: cloudTokens
})
// 头像客户端（2026-10-22 用户系统批次）：二进制上传/读取 + 按 hash 的内存缓存。
// 与其余客户端共用同一个 token store —— 上传成功后它顺手把 avatarHash 写进
// 会话快照（重启后不联网也能显示自己的头像）。
const cloudAvatarClient = createCloudAvatarClient({
  baseUrl: cloudBaseUrl,
  fetch: cloudFetch,
  tokens: cloudTokens
})

/**
 * 云提供方（P10.1 第 11 项组装层）：账号 + docs 两个客户端共用上面这一份令牌
 * —— 登录一次，收编预览、文档同步全看得到。令牌实现换了它一行不动（见
 * provider-impl.ts 文件头）。
 */
const cloudProvider = createApiProvider({
  baseUrl: cloudBaseUrl,
  fetch: cloudFetch,
  tokens: cloudTokens
})

/**
 * 同步引擎（P10.3）：四份文档「拉→合并→条件写回」。合并函数用唯一那份装配
 * （CLOUD_DOC_MERGERS）—— 首激活收编与常规同步必须同一组，分开装会在改一处
 * 忘一处时分叉（见 mergers.ts 文件头）。触发节拍在渲染层（cloud:sync-now）。
 */
const cloudSync = createSyncEngine({
  provider: cloudProvider,
  stores,
  installId: device().installId,
  mergers: CLOUD_DOC_MERGERS,
  log: (line) => console.log(`[miai] sync| ${line}`)
})

/**
 * 上行 runner（流水推 → 流水拉 → 挑战结算，一趟跑完）。
 * 【触发节拍】启动一次 + 结算入队后一次（见 cloud:challenge-settle handler）——
 * 都是 fire-and-forget：未登录（客人盒）时 run() 零网络直接 skip。
 * 【为什么不在每次记账后触发】服务端 push 限流 6 次/时/账号；饭变动可以是
 * 秒级的（连答对几题），按记账触发就是拿限流当节拍器。渲染层的同步节拍
 * （P10.5 接线，按"每小时几次"设计）会再补上常规触发点。
 */
const uplink = createUplink({
  box,
  journal: riceJournal,
  settleQueue,
  rice: cloudRiceClient,
  challenge: cloudChallengeClient,
  installId: device().installId,
  log: (line) => console.log(`[miai] uplink| ${line}`)
})

/**
 * 账号流程的依赖袋（P10.5）：激活（收编/直达）/ 干涸 / 启动恢复的唯一入口。
 * 【nextSeq 必须就是 nextRiceSeq 本体】收编 marker 与日常记账共用一个号池 ——
 * 分开两个池会撞号（撞号的条目被服务端幂等键当重放静默丢弃，饭就没了）。
 */
const accountFlowDeps: AccountFlowDeps = {
  baseDir: storageDir(),
  stores,
  journal: riceJournal,
  sessions: cloudTokens,
  safe: safeStorage,
  installId: device().installId,
  nextSeq: nextRiceSeq,
  log: (line) => console.log(`[miai] account| ${line}`)
}

/**
 * 把账本余额（唯一事实）镜像进 pet.json（brain.mirrorRice，相等 = 真 no-op）。
 * 【调用点】上行轮结束、激活 / 登出、启动恢复、pet 宿主刚起来 —— 一切可能让
 * 账本余额与 pet.json 分叉的节点。宿主没起时 petHost 是 null，这里 no-op；
 * startPet 里再补一次，保证「宿主晚于账本装载出生」也最终一致。
 */
function syncRiceMirror(): void {
  petHost?.mirrorRice(riceJournal.balance())
}

/** 读练习史（practice.json）：读口，清洗与裁剪都在 normalizePractice 里 */
function readPractice(): PracticeFile {
  // installId 只为老会话回填 uid（v1→v2；回填结果会随 needsRewrite 落盘）
  const { file, needsRewrite } = normalizePractice(practiceStore.read(), device().installId)
  if (needsRewrite) {
    try {
      practiceStore.write(file)
    } catch {
      /* 落盘失败不影响本次使用 */
    }
  }
  return file
}

/**
 * 按 id 找奖励图的**源文件**（「保存图片」要把这张拷到用户选的位置）。
 *
 * 【为什么有两套路径】打包会把文件搬走、还会改名：
 *   · dev —— vite 直接从源码目录伺服，图就在
 *     `src/renderer/src/assets/gallery/g01.png`（精确名字；GIF 则是 `.gif`）；
 *   · 打包 —— 图被 vite 落在 `out/renderer/assets/` 下，**文件名带内容哈希**
 *     （`g01-3f9a2c.png` / `g227-9b1e04.gif`），只能按 `g01-` 前缀扫。
 * 两处都找不到就老实返回 null —— 调用方回「missing」，不糊弄成"已保存"。
 *
 * ⚠️ 只接受经过 `isGalleryId` 的 id（调用方先卡）：这里要拿 id 拼路径，
 * 拼之前不先卡值域的话，一个 `../` 就能把"保存图片"变成"拷任意文件出去"。
 */
const SAVE_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  png: { name: 'PNG', extensions: ['png'] },
  jpg: { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  jpeg: { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  webp: { name: 'WebP', extensions: ['webp'] },
  gif: { name: 'GIF', extensions: ['gif'] }
}

function findGalleryImage(id: string): string | null {
  // 用户覆盖优先（<数据目录>/rewards，2026-10-16）：屏幕显示（渲染层
  // rewardImageUrl）与「保存图片」（这里）必须同吃一份覆盖 —— 顺序反了会出现
  // 「屏幕是我换的图、保存出去是官方图」的静默不一致（覆盖机制就白做了）。
  const override = scanRewardOverrides(rewardsDir())[id]
  if (override) return override
  const devDir = join(app.getAppPath(), 'src', 'renderer', 'src', 'assets', 'gallery')
  // dev 两种扩展名都认（2026-10-17 起 GIF 入册）；先 png 后 gif，与渲染层
  // rewardImageUrl 的优先级一字不差 —— 两处挑到不同文件 = 屏幕与保存不一致
  const devPath = join(devDir, `${id}.png`)
  if (existsSync(devPath)) return devPath
  const devGif = join(devDir, `${id}.gif`)
  if (existsSync(devGif)) return devGif
  const assetsDir = join(app.getAppPath(), 'out', 'renderer', 'assets')
  try {
    // 带短横的前缀：`g01-` 不会误配 `g010-...`（第三位就对不上），
    // id 再长也不会串味
    const hit = readdirSync(assetsDir).find(
      (n) => n.startsWith(`${id}-`) && (n.endsWith('.png') || n.endsWith('.gif'))
    )
    return hit ? join(assetsDir, hit) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- AI 单飞

/**
 * 当前在飞的 AI 请求的取消控制器。`null` = 没有在飞的请求。
 *
 * 【为什么是单飞（同时只允许一个）】
 * `ai:cancel` 通道**不带参数** —— 它只能说「掐掉现在那个」。
 * 要是有两个请求同时在飞，这一句话就说不清掐的是哪个了。
 * 让「同时最多一个」成为不变式，取消才有无歧义的含义。
 *
 * 【新请求为什么直接顶掉旧的】
 * 旧的那个已经没人看了（界面同一处只会显示一个 spinner），但它的 token **还在烧**。
 * 不顶掉的话，它要一直跑到 30 秒超时才自己停 —— 用户的钱。
 * 顶掉之后旧请求会拿到 `canceled`，这是**如实报告**：它确实是被取消了。
 */
let aiAbort: AbortController | null = null

/**
 * 跑一次 AI 请求，顺便管好单飞与取消。
 *
 * 用 `try/finally` 把「谁清 aiAbort」写死在一处，而不是让每个 handler 自己记得清 ——
 * 忘了清的后果是**取消按钮偶尔会掐掉一个已经结束的请求**（无害），
 * 或者更糟：掐掉下一个请求（用户会看到莫名奇妙的「已取消」）。
 */
async function withAi<T>(run: (deps: AiDeps) => Promise<AiResult<T>>): Promise<AiResult<T>> {
  aiAbort?.abort()
  const ac = new AbortController()
  aiAbort = ac
  try {
    return await run({
      // Electron 主进程自带全局 fetch（Node 18+ 的 undici），不用额外引库
      fetch: (url, init) => globalThis.fetch(url, init),
      getConfig: readConfig,
      signal: ac.signal
    })
  } finally {
    // 只有「自己还是当前那个」才清空 —— 否则会把后来者的控制器抹掉
    if (aiAbort === ac) aiAbort = null
  }
}

// ---------------------------------------------------------------- 侧栏对话的并发与限流（P1，docs/27 §8.2 / §8.3）

/**
 * 侧栏对话在飞的请求：`requestId → 控制器`。
 *
 * 【为什么是 Map，而既有三条主链还是单个 `aiAbort`】
 * 两种语义不能共用一个变量：
 *   · 旧链路（讲报错 / 出题 / 测连接）是**新请求顶掉旧请求**的单飞，
 *     `ai:cancel` 不带参时"掐掉现在那个"才有意义；
 *   · 侧栏是**长连接**，要能单独掐、要能同时和出题并存（docs/27 §8.2 明确要求
 *     「两者互不干扰」）。共用单例的话，用户一边等出题一边聊两句，第二次发送
 *     就会把出题掐了，表现是"AI 出题莫名失败"。
 *
 * 【谁负责清】请求真结束的那一刻（成功/失败/取消）删自己那一项。
 * 用 try/finally 把清理写在一处也好，但异步链里 `finally` 容易和"发 done"
 * 的顺序打架（docs/27 §12.7：done 必须先于界面清理），所以"谁结束谁删"更好查。
 */
const aiChatInflight = new Map<string, AbortController>()

/**
 * 侧栏的限流闸门（同一会话最小间隔 800ms、连败 3 次退避 30s）。
 *
 * 【为什么闸门在主进程，而不是界面禁用按钮】
 * 按钮的 disabled 是"界面自觉"；这条闸管的却是**用户自己的钱**。
 * 渲染层写错一处、或者将来多一个入口直接 invoke，自觉就没了。
 */
const aiChatGate = createChatGate()

/**
 * 安全地推一条事件给渲染层。
 *
 * 【为什么每次都要判 isDestroyed】窗口可能在流式途中被关掉（用户直接关软件）。
 * 对着已销毁的 webContents send 会抛，而这一抛发生在异步链里 ——
 * 没有 catch 就是一条 unhandled rejection，进程日志里一片红，且**没有任何用户可见收益**。
 */
function sendToRenderer(
  wc: IpcMainInvokeEvent['sender'],
  channel: string,
  payload: AiChatDeltaPayload | AiChatDonePayload
): void {
  if (wc.isDestroyed()) return
  try {
    wc.send(channel, payload)
  } catch {
    /* 窗口在这两行之间被销毁了：事件本来就没人接，丢掉即可 */
  }
}

/**
 * 复核一道 AI 出的 `code` 题：**真的在本机跑一遍**，输出对上 `answer`（或任一
 * `accept`）才算通过。生成时就把关，而不是等学员答错才发现题目本身是错的。
 *
 * 【为什么走 enqueueRun 而不是直接 spawn】它和学员点「运行」是同一条链路：
 * 同一套编译参数、同一个队列、同一套输出解码。自己再造一条，两边的判分口径
 * 迟早漂移（`-std` 改一处、另一边没改，AI 题就会莫名全被丢）。
 *
 * 【没有编译器怎么办】`report[lang].found === false` 直接返回 false ——
 * 宁可这次一道 code 题都不出，也**不能把没验过的代码题端给用户**。
 * choice/fill 不受影响，照常返回。
 */
async function verifyAiCodeQuestion(item: PoolItem): Promise<boolean> {
  const q = item.question
  if (q.type !== 'code') return true

  const cfg = readConfig()
  const { report, rechecked } = await refreshLangs(cfg.envCache.report, q.lang)
  if (rechecked.length > 0) {
    // 与 runner:run 同口径：await 之后现读一次，只覆盖 envCache 一格
    const fresh = readConfig()
    fresh.envCache = { report, at: new Date().toISOString() }
    configStore.write(fresh)
  }
  if (!report[q.lang]?.found) return false

  const r = await enqueueRun(
    { lang: q.lang, code: q.code, stdin: '', timeoutSec: 5 },
    report
  )
  if (!r.ok) return false

  const expected = [q.answer, ...(q.accept ?? [])]
  return expected.some((want) => gradeByRun(want, r.stdout))
}

/** 入参校验：不合法就抛。理由见下面每个 handler 的注释 */
function assertLang(v: unknown): asserts v is LangOfCode {
  if (typeof v !== 'string' || !(LANG_OF_CODE as readonly string[]).includes(v)) {
    throw new Error('invalid ai payload')
  }
}

function assertTerms(v: unknown): asserts v is GlossaryTerm[] {
  if (!Array.isArray(v)) throw new Error('invalid ai payload')
}

function assertAiExplain(input: unknown): asserts input is AiExplainInput {
  const i = input as AiExplainInput | null
  if (!i || typeof i !== 'object') throw new Error('invalid ai payload')
  assertLang(i.lang)
  if (typeof i.code !== 'string' || typeof i.error !== 'string') {
    throw new Error('invalid ai payload')
  }
  assertTerms(i.terms)
}

/**
 * `ai:chat-start` 的入参校验。
 *
 * 【为什么校验得比别处细】这条链上有两样东西是**用户付钱**的：
 * 发出去的 token、和"历史被写成什么样"。渲染层是网页环境（CSP 再严也挡不住
 * 它自己被改坏），而主进程是最后一道 —— 畸形数据在这里抛，比让它进提示词强。
 *
 * 【为什么只抛不"修正"】入参形状不对 = 我们自己写错了（调用点传错），
 * 和 runner:run 一个规矩：炸得响亮才有人修。「顺手洗一遍」会把调用点的 bug
 * 变成一条永远发不出去的悄悄话，查都没法查。
 */
function assertAiChatStart(input: unknown): asserts input is AiChatStartInput {
  const i = input as AiChatStartInput | null
  if (!i || typeof i !== 'object') throw new Error('invalid ai payload')
  if (!Array.isArray(i.messages) || i.messages.length === 0) throw new Error('invalid ai payload')
  // 上限：渲染层每次最多带 ~几十条；给到 200 是防"某个调用点把全量历史灌进来"
  if (i.messages.length > 200) throw new Error('invalid ai payload')
  for (const m of i.messages) {
    if (!m || typeof m !== 'object') throw new Error('invalid ai payload')
    if (m.role !== 'user' && m.role !== 'assistant') throw new Error('invalid ai payload')
    if (typeof m.content !== 'string') throw new Error('invalid ai payload')
  }

  const ctx = i.context
  if (ctx === undefined) return
  if (!ctx || typeof ctx !== 'object') throw new Error('invalid ai payload')
  if (ctx.code !== undefined && typeof ctx.code !== 'string') throw new Error('invalid ai payload')
  if (ctx.runOutput !== undefined && typeof ctx.runOutput !== 'string') {
    throw new Error('invalid ai payload')
  }
  if (ctx.lang !== undefined) assertLang(ctx.lang)
  if (ctx.terms !== undefined) assertTerms(ctx.terms)
  if (ctx.selection !== undefined) {
    const s = ctx.selection
    if (!s || typeof s !== 'object') throw new Error('invalid ai payload')
    if (typeof s.text !== 'string') throw new Error('invalid ai payload')
    if (typeof s.fromLine !== 'number' || typeof s.toLine !== 'number') {
      throw new Error('invalid ai payload')
    }
  }
}

function assertAiGenerate(input: unknown): asserts input is AiGenerateInput {
  const i = input as AiGenerateInput | null
  if (!i || typeof i !== 'object') throw new Error('invalid ai payload')
  if (!Array.isArray(i.topics) || i.topics.length === 0) throw new Error('invalid ai payload')
  for (const t of i.topics) {
    if (!t || typeof t.lessonId !== 'string' || typeof t.title !== 'string') {
      throw new Error('invalid ai payload')
    }
    if (!Array.isArray(t.tags) || !Array.isArray(t.stems)) throw new Error('invalid ai payload')
  }
  if (typeof i.count !== 'number' || !Number.isInteger(i.count) || i.count < 1) {
    throw new Error('invalid ai payload')
  }
  if (typeof i.dateKey !== 'string') throw new Error('invalid ai payload')
  assertTerms(i.terms)
}

/**
 * 入参校验：云凭据只认 `{username, password}` 两个字符串，不合法就抛（同
 * assertAiExplain 的规矩：形状不对 = 我们自己传错了，翻译成「服务器异常」
 * 会把人引去查网络）。**只重建认识的键** —— IPC 入参不可信，多带的字段
 * 在门口就剔掉，不让它们跟着请求体发出去。
 * ⚠️ 只查类型不查策略（长度/字符集都是服务端的事）：登录侧短密码要能走到
 * BAD_CREDENTIALS（防枚举），客户端提前按长度拦下会破坏服务端刻意的分流。
 */
function cloudCredentials(input: unknown): CloudCredentials {
  const c = input as { username?: unknown; password?: unknown } | null
  if (!c || typeof c !== 'object') throw new Error('invalid cloud credentials payload')
  if (typeof c.username !== 'string' || typeof c.password !== 'string') {
    throw new Error('invalid cloud credentials payload')
  }
  return { username: c.username, password: c.password }
}

/**
 * 入参校验：cloud:register 的载荷 = 凭据 + 安全问答（2026-10-13 主人令）。
 * 口径同 cloudCredentials（形状不对 = 我们自己接线传错了，抛），**只重建认识的键**。
 * securityQuestion 必须命中 protocol.SECURITY_QUESTIONS 闭集 —— 这是**客户端侧**
 * 的枚举守卫（写侧本来就该只从这份清单选）；服务端 zod 的同一份枚举才是权威，
 * 两层都拦是因为"我们传错"与"有人在 IPC 层伪造"是两件事。answer 只查类型与非空
 * （长度/归一化交服务端，客户端不做预处理 —— protocol.ts 的答案纪律）。
 */
function cloudRegisterInput(input: unknown): CloudRegisterInput {
  const c = input as
    | { username?: unknown; password?: unknown; securityQuestion?: unknown; securityAnswer?: unknown }
    | null
  if (!c || typeof c !== 'object') throw new Error('invalid cloud register payload')
  const base = cloudCredentials(c)
  if (
    typeof c.securityQuestion !== 'string' ||
    !(SECURITY_QUESTIONS as readonly string[]).includes(c.securityQuestion)
  ) {
    throw new Error('invalid security question')
  }
  if (typeof c.securityAnswer !== 'string' || c.securityAnswer.trim().length === 0) {
    throw new Error('invalid security answer')
  }
  return {
    ...base,
    securityQuestion: c.securityQuestion as CloudRegisterInput['securityQuestion'],
    securityAnswer: c.securityAnswer
  }
}

/**
 * 入参校验：找回三步链的载荷（cloud:recover-*）。三步的字段各不相同，
 * 按其需要收必填字符串，**只重建认识的键**（同 cloudCredentials 先例）。
 * 长度/归一化/枚举一律不在这一层判 —— 那是服务端 zod 的事。
 */
function requireStringField(raw: unknown, field: string): string {
  const c = raw as Record<string, unknown> | null
  if (!c || typeof c !== 'object') throw new Error('invalid recover payload')
  const v = c[field]
  if (typeof v !== 'string') throw new Error(`invalid recover payload: ${field}`)
  return v
}

/**
 * 入参校验：cloud:get-avatars 的载荷 = hash 字符串数组（2026-10-22）。
 * 口径：**只重建合法的**——非法项静默跳过（它来自服务端的榜面条目，跳过 =
 * 那个人显示默认头像，不能让一张坏 hash 把整页头像都变成异常）；
 * 去重 + 上限 100（一页榜单 + me + 预读，超过就是调用方在乱传）。
 */
function parseAvatarHashList(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error('invalid avatar hash list')
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of raw) {
    if (typeof value !== 'string' || !AVATAR_HASH_RE.test(value)) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= 100) break
  }
  return out
}

/** 入参校验：cloud:upload-avatar 的载荷是裸 Uint8Array（兼容 `{png: ...}` 形态） */
function requireAvatarBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) return raw
  if (typeof raw === 'object' && raw !== null) {
    const inner = (raw as { png?: unknown }).png
    if (inner instanceof Uint8Array) return inner
  }
  throw new Error('invalid avatar payload')
}

/**
 * 入参校验：cloud:activate 的载荷是 `undefined`（重登直达）或 `{adopt?}`。
 * 口径同 cloudCredentials：形状不对 = 我们自己接线传错了，抛；**只重建认识
 * 的键**（IPC 入参不可信）。返回 null = 未给口径（首激活时 account-flow 会
 * 按「必须给 mode」拒绝，直达时忽略）。
 */
function parseAdoptMode(raw: unknown): ActivateMode | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object') throw new Error('invalid activate payload')
  const adopt = (raw as { adopt?: unknown }).adopt
  if (adopt === undefined || adopt === null) return null
  if (adopt === 'merge-local' || adopt === 'cloud-only') return adopt
  throw new Error('invalid adopt mode')
}

/**
 * 入参校验：cloud:sync-now 的载荷是 `undefined` 或 `{force?}`（force =
 * 手动触发跳退避窗口）。口径同 parseAdoptMode。
 */
function parseSyncOpts(raw: unknown): { force?: boolean } | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') throw new Error('invalid sync options')
  const force = (raw as { force?: unknown }).force
  if (force === undefined || force === null) return undefined
  if (typeof force !== 'boolean') throw new Error('invalid sync force flag')
  return { force }
}

/**
 * 入参校验：cloud:leaderboard 的载荷是 `undefined` 或 `{period?, dateKey?, cursor?}`。
 * 口径同 parseSyncOpts：形状不对 = 我们自己接线传错，抛；**只重建认识的键**。
 * 【period 只查类型不查值域】值域（五个键）是 shared/cloud/protocol 的字面量
 * 联合，客户端层（main/cloud/leaderboard.ts 的 assertPeriod）有自己的 TypeError
 * 护栏、且**一个包都不发** —— 这里再抄一份键表就是第二处真源，改一处忘一处。
 * 【dateKey 同理不查形状】它是渲染层 todayKey() 造出来的本地日；±1 天窗口的
 * 裁决在服务端（400 VALIDATION_FAILED 原样透传），客户端不抢先判。
 */
function parseLeaderboardQuery(
  raw: unknown
): { period?: LeaderboardPeriod; dateKey?: string; cursor?: string } | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') throw new Error('invalid leaderboard query')
  const o = raw as { period?: unknown; dateKey?: unknown; cursor?: unknown }
  const out: { period?: LeaderboardPeriod; dateKey?: string; cursor?: string } = {}
  if (o.period !== undefined) {
    if (typeof o.period !== 'string') throw new Error('invalid leaderboard period')
    out.period = o.period as LeaderboardPeriod
  }
  if (o.dateKey !== undefined) {
    if (typeof o.dateKey !== 'string') throw new Error('invalid leaderboard dateKey')
    out.dateKey = o.dateKey
  }
  if (o.cursor !== undefined) {
    if (typeof o.cursor !== 'string') throw new Error('invalid leaderboard cursor')
    out.cursor = o.cursor
  }
  return out
}

/**
 * 入参校验：cloud:leaderboard-opt-in 的载荷必须是 `{optIn: boolean}`。
 * 布尔以外一律抛（同 cloudCredentials 先例）—— 不替调用方猜「'true' 算真吗」。
 */
function parseOptInFlag(raw: unknown): boolean {
  const o = raw as { optIn?: unknown } | null
  if (!o || typeof o !== 'object' || typeof o.optIn !== 'boolean') {
    throw new Error('invalid opt-in payload')
  }
  return o.optIn
}

/** 模块级引用：开屏窗（applyNativeTheme 遍历时要跳过它，second-instance 优先聚焦它） */
let splashWin: BrowserWindow | null = null
/** 模块级引用：开屏闸门（IPC handler 的转发口；跳过路径它也在 —— 还要推时间线） */
let splashGate: SplashGate | null = null

/**
 * 模块级引用：dsh-pet 桌宠宿主（2026-10-06 换引擎，第一版大肥鱼引擎退役）。
 *
 * 【为什么活到模块级】主窗可能重建（activate 分支），宿主里的
 * getMainWindow 闭包必须每次现取**当前**主窗 —— 捕获旧窗的话，重建后
 * 「打开壁纸设置」会把指令发给一个已销毁的窗口（不报任何错）。
 * petMainWin 单独存一份就是给这个闭包用的。
 */
let petHost: DshPetHost | null = null
let petMainWin: BrowserWindow | null = null

/**
 * 桌宠窗此刻有没有焦点（2026-10-06）。点桌宠会让主窗 blur，但壁纸不该因此
 * 暂停（主人口径：暂停只认最小化/彻底失焦，不认桌宠互动）。这个布尔由宿主的
 * onPetFocus 回调维护，经 getter 喂给窗口状态推送 —— 壁纸层的 pauseOnBlur
 * 追问它一句就能分拣「失焦」的原因。
 */
let petWinFocused = false
/** 窗口状态推送的即时强推口（attachWindowStatePush 的 poke；主窗未建/已关时为 null） */
let pokeWinState: ((ev?: string) => void) | null = null

/**
 * 原生编译路径的运行观察器（native-watch）：用户把练习场代码「本地 IDE 打开」
 * 或「导出」后，盯着同目录产物（.exe/.class）mtime 越过源文件那一刻 ——
 * 编译成功 = 用户自己写的代码跑起来了 = 大白饭 +1（经济闭环的第三条奖励来源，
 * 另两条是渲染层的内置运行与原生查看器）。接线口在 runnerOpenIde /
 * runnerExportCode 两个 handler 里（trackNativeCompile）。
 */
const nativeWatcher = createNativeWatcher({
  onCompiled: (ev) => {
    petHost?.grantRun(ev.fingerprint)
  }
})

/**
 * 构造主窗（**不显示、不加载**）—— 2026-10-05 开屏动画重接线：
 * 「构造 / 接线 / 加载 / 显示」拆成四件事，显示与加载的时机在 whenReady 里
 * 由开屏闸门统管（无开屏：加载完 ready-to-show 就 show；有开屏：开屏收场后
 * 由闸门的 handoff 统一 show）。拆开是交接状态机把主窗串进去的前提，
 * 也是「开屏期间至少一个窗口存活」的堵法：主窗先构造（隐藏），
 * 开屏窗才是第二个窗口——任何时刻 window-all-closed 都够不着。
 */
function createWindow(): BrowserWindow {
  /*
   * 原生层底色，跟着主题走。
   *
   * 【为什么非设不可 —— 它跟「开屏别闪白」其实没关系】
   * 窗口是 `show: false` + `ready-to-show` 才显形的，显出来时渲染进程早已画完第一帧，
   * 所以**开屏那一瞬间本来就看不见白屏**（这条别误会，下面那句注释里也写了）。
   *
   * 真正会露出来的是**拖窗口大小的时候**：新露出的那条区域在 Chromium 补上内容之前，
   * 由原生层直接刷这个底色。不设就是默认白 —— 深色主题下拖一下窗口是一道白杠，
   * 而且拖得越快闪得越凶。**这才是本字段唯一的存在理由。**
   *
   * 【为什么这里只读一次，而「改了要跟着变」交给 applyNativeTheme】
   * 建窗口这一刻只有这一件事可做：把当前主题写进去 —— 窗口还不存在，没别的地方可更新。
   * 但**这个值会一直留着**。2026-09-21 主人指出的正是这一点：
   * 启动后再切到夜间，窗口尺寸没变，原生层确实没机会露脸（所以当场看不出来），
   * 可**下一次拖窗口**时露出来的是**启动时那个主题**的底色 ——
   * 深色界面上拖一下就是一道白杠，而且拖得越快闪得越凶。
   * 所以这个值必须跟着主题走；更新那条路放在 `applyNativeTheme` 里 ——
   * 和标题栏同一个入口，不多出第三个"要知道主题"的地方。
   */
  const theme = readConfig().theme
  // 先告诉原生层，再建窗口：反过来的话，深色用户开屏会看见一条白标题栏
  // 跳成深色 —— 和 `<html data-theme>` 那个「晚一帧就闪白」是同一个道理。
  applyNativeTheme(theme)
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: windowBgOf(theme),
    autoHideMenuBar: true,
    title: APP_NAME,
    /*
     * Window Controls Overlay（顶条玻璃化，2026-10-05 主人工单）：
     * 隐掉系统标题栏、整窗交给网页画 —— 系统只把三个窗口按钮（最小化 /
     * 最大化 / 关闭）以悬浮层画在右上角。**按钮本体仍是系统画的**：命中判定
     * 在原生层先于网页发生，网页任何东西都盖不住、也拦不了它 ——
     * 这正是「透明顶条绝不能拦按钮点击」这条底线的机械保障。
     * 顶条长什么样由渲染层的 TopBar.vue 决定（玻璃底 + 拖拽区）。
     * 按钮符号色跟主题走：建窗这一刻喂当前主题；运行时改主题走
     * applyNativeTheme 里的 setTitleBarOverlay —— 与窗口底色同一条路。
     */
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000', // 透明：顶端那条底由网页画，系统别刷自己的色
      symbolColor: titleSymbolColorOf(theme)
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // ⚠️ 这里**不再**是「ready-to-show → show()」（旧行为）—— 显示时机归开屏
  // 闸门：wireMainReady 拿同一个事件当「主窗已就绪」信号，由闸门的 handoff
  // 统一 show。别把 show() 加回来：加了之后开屏还没放完主窗就先蹦出来，
  // 渐隐交接变成硬切，而且开屏窗白放。

  // 窗口状态推送（docs/23 §2.4；本工程第一条 main→renderer 推送通道）：
  // 失焦/最小化/隐藏这些「原生事实」只有主进程知道，渲染层的壁纸层拿它
  // 推导暂停语义（失焦全停是默认）。唯一推送方在 wallpaper/window-state.ts。
  // petFocused 是 getter 现读（宿主上报焦点变化时 poke 强推，不等 3s 自愈轮询）：
  // 点桌宠的失焦不是「主人离开了程序」，暂停策略追问这一句才能分拣。
  const winStatePush = attachWindowStatePush(mainWindow, IPC.wallpaperState, undefined, () => petWinFocused)
  pokeWinState = winStatePush.poke
  mainWindow.on('closed', () => {
    winStatePush.detach()
    pokeWinState = null
  })

  // 外部链接一律交给系统浏览器，应用内不打开网页。
  // 【P10.1 起不再"盲丢"】旧实现不看 URL 就 shell.openExternal —— 那是
  // 「渲染层任何一段代码（含被注入的）都能让系统执行任意 scheme」的一条缝。
  // 白名单（http/https）在 window-guards.ts（纯函数，单测在那边）；非白名单照旧 deny。
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isExternalUrlAllowed(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 应用内导航守卫（P10.1）：同源内跳转与 hash 变化放行（dev server 重载、路由），
  // 其余一律挡下 —— 把"整个窗口被导航去别处"这条路关死（判据同样在 window-guards.ts）。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (decideNavigation(url, mainWindow.webContents.getURL()) === 'block') {
      event.preventDefault()
    }
  })
  // 本应用没有任何 webview，出现即挡 —— 不做例外（将来真要加，走一次显式评审）
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  return mainWindow
}

/**
 * 主窗就绪承诺 —— 供开屏闸门决定「什么时候可以交接」。
 *
 * 三个兑现口缺一不可：
 *   ① ready-to-show        —— 正常路径（渲染进程画完第一帧）
 *   ② did-fail-load 主框架 —— 加载失败（文件缺失/URL 错）：不能干等，
 *      否则开屏只得靠 15s 硬上限收场，用户多盯 15 秒黑屏
 *   ③ render-process-gone  —— 渲染进程崩溃：同上，如实放行
 * ② ③ 放行后主窗是个坏窗口，但「显示一个坏窗口」比「什么都不显示」
 * 可排障（用户能截图、能看到菜单）——绝不静默悬挂。
 *
 * ⚠️ 必须在建窗后**立刻**挂（一次性事件，事后挂会等不到）；
 * resolve 幂等（多个口先后触发都无害）。
 */
function wireMainReady(win: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const settle = (): void => {
      if (done) return
      done = true
      resolve()
    }
    win.once('ready-to-show', settle)
    win.webContents.on('did-fail-load', (_e, _code, desc, _url, isMainFrame) => {
      if (isMainFrame) {
        console.error('[miai] main window load failed:', desc)
        settle()
      }
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error('[miai] main renderer gone:', details.reason)
      settle()
    })
  })
}

/** 加载主窗内容（dev 走 Vite URL，打包走 file:// 的 index.html） */
function loadMainWindow(win: BrowserWindow): void {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 把应用主题告诉**原生层** —— 系统画的三个窗口按钮
 * （最小化 / 最大化 / 关闭）和窗口底色，都跟着应用一起变深。
 *
 * 【为什么非设不可 —— 2026-09-21 主人 2.0 验收截图里的 Bug 1；
 *  2026-10-05 顶条玻璃化后**这条仍然要设**】
 * 三个窗口按钮是**系统画的**，不是我们画的：顶条改造只换了
 * 「谁画那条底」（`titleBarStyle: 'hidden'` + `titleBarOverlay`，见 createWindow），
 * 按钮本体一直在原生层。系统只认 `nativeTheme` 和我们喂进去的 `symbolColor`，
 * **完全看不见**渲染进程里那个 `<html data-theme="dark">`。
 * 不给符号色的话，深色主题下那三个符号停在系统默认的深色，
 * 压在深色玻璃条上几乎看不见 —— 和当年「一条白杠横在深色界面上」是同一处
 * 病、换了张脸。符号色由这里喂，和底色同一条路。
 *
 * 【为什么不需要自己的映射表】
 * `themeSource` 的取值正好就是我们的主题名（`THEME_NAMES = ['light', 'dark']`，
 * 见 `shared/types.ts`），一一对应。底色与符号色都出自 `shared/theme.ts`
 * 的两张表，它们和 tokens.css 的 `--mi-canvas` / `--mi-text` 由
 * `theme.test.ts` 一起钉死。**少一张会走岔的对照表**，也就少一个
 * 「CSS 改了这里没改」的漂移点。
 *
 * 【为什么窗口底色也挂在这里 —— 主人 2026-09-21 补的一条】
 * `BrowserWindow` 的 `backgroundColor` 只在构造时给一次。启动后切主题时窗口尺寸
 * 没变、原生层没机会露脸，**当场看不出来**；可它的值会一直留着，于是下一次
 * 拖窗口，新露出的那一条用的是**启动时**那个主题的底色。它和窗口按钮
 * （符号色 2026-10-05 加入这个循环）是同一类东西
 * （都是"原生层需要知道主题"），所以共用这一个入口，不另开第三个调用点。
 *
 * ⚠️ 建窗口那一刻这里**一个窗口都没有**（本函数先于 `new BrowserWindow` 调用），
 * 遍历是空转。这不是漏，是分工：**首帧的底色与符号色由构造函数那些字段负责，
 * 运行时改主题由这里负责**，两条路都盖到了。
 *
 * 【为什么只有两个调用点，且必须从这里过】
 * 能改主题的只有两件事：**启动时读配置**、**设置页存配置**。
 * 前者在建窗口之前（第一帧就得对），后者在 `config:save` 写完之后。
 * 将来多一个改主题的入口，也必须走 `config:save` —— 别在控件里顺手写第三遍，
 * 漏一处的症状是「这个入口切不动标题栏」，而且不会报任何错。
 */
function applyNativeTheme(theme: MiThemeName): void {
  nativeTheme.themeSource = theme
  for (const w of BrowserWindow.getAllWindows()) {
    // 开屏窗（2026-10-05）：透明无边框、没有标题栏覆盖层可设 —— 刷底色会
    // 破坏它的透明（backgroundColor 只在构造时可给带 alpha 的值），
    // setTitleBarOverlay 对一个 frame:false 的窗口也没有意义。整窗跳过。
    // （旧桌宠窗曾因同样理由在这里跳过；2026-10-06 换 dsh-pet 引擎后宠物窗
    // 生在另一个进程里，根本不会出现在这个列表 —— 那条判据随之删除。）
    if (w === splashWin || w.isDestroyed()) continue
    w.setBackgroundColor(windowBgOf(theme))
    // 窗口按钮符号色跟着主题走（WCO；理由见函数头注释）
    w.setTitleBarOverlay({ color: '#00000000', symbolColor: titleSymbolColorOf(theme) })
  }
}

/**
 * 起一次桌宠（2026-10-06 换 dsh-pet 引擎）：建宿主、让它的 getMainWindow
 * 闭包指向当前主窗。
 *
 * 【为什么是函数而不是 whenReady 里的一段】主窗有两条诞生路径：正常启动、
 * 以及 activate 重建（全部窗口关闭后 macOS 惯例开新窗）。两条都必须调 ——
 * 抄两遍的下场是第二条路径上主窗引用静默变陈旧。宿主本体只建一次
 * （幂等）：helper 是独立进程，主窗关了它也不会死，重建窗口只需要把
 * petMainWin 换到新窗上。
 */
function startPet(mainWindow: BrowserWindow): void {
  petMainWin = mainWindow
  if (petHost) return
  petHost = startDshPetHost({
    helperDir: join(__dirname, '../pet-helper'),
    packaged: app.isPackaged,
    // 行为大脑的账本家：pet.json 与 config.json 住同一间（portable 下是 data/）
    storageDir: storageDir(),
    getMainWindow: () => petMainWin,
    // 桌宠窗焦点变化（宿主 /miai/pet-focus 上报）→ 立即强推窗口状态：点桌宠
    // 那一下主窗刚 blur，壁纸的暂停/恢复不该等 3s 自愈轮询（人眼可感）。
    // 只在真变化时推（宿主已去抖），此处再等值短路一层。
    onPetFocus: (focused) => {
      if (petWinFocused === focused) return
      petWinFocused = focused
      pokeWinState?.('pet')
    },
    // 右键菜单「关闭大肥鱼」（宠物 helper POST /miai/pet-off → 宿主转发到
    // 这里）：把 enabled 落成 false 并广播 config:external —— 设置页若正
    // 开着，开关跟着灭；宿主随后 applySettings() 读到 false 收窗（见
    // host.ts 该路由的注释：写盘失败会抛回去，宿主只记日志**不收窗** ——
    // 宁可宠物还在、失败可见，不许假装关掉了）。
    //
    // 【为什么不走 mergeConfigPayload】它的入参契约是「渲染层提交的**全量**
    // config:save 载荷」（reviewEnabled / runTimeoutSec / ai 缺一即 throw，
    // 那是防渲染层传错参数的闸）——主进程自发的单字段改写硬造一份假全量
    // 载荷，等于把两套契约揉成一团。走 withPetEnabled（config-merge.ts 里
    // 同文件同规矩的专用函数）。写盘用 configStore.write 而非任何"读改写
    // 带校验"的口：readConfig 已经过 migrateConfig，形状可信。
    onMenuDisable: () => {
      const cur = readConfig()
      if (!cur.pet.enabled) return // 已关（重复点击/竞态）：不写盘不广播，幂等
      const saved = withPetEnabled(cur, false)
      configStore.write(saved)
      // 广播放写盘**之后**（同 config:save 里 applyNativeTheme 的位置口径）：
      // 写失败就该抛出去，不能先让设置页显示"已关闭"而配置其实没落盘。
      const pub = toPublicConfig(saved)
      for (const w of BrowserWindow.getAllWindows()) {
        if (w.isDestroyed()) continue
        try {
          w.webContents.send(IPC.configExternal, pub)
        } catch {
          /* 半死窗口：丢了这条推送不影响主流程，下次 configGet 会纠正 */
        }
      }
    },
    // 整份配置读口：宠物旋钮宿主现读 pet 段，聊天每次现读 ai 段
    //（用户在设置页改了 Key/模型，不必等重启，deepseek.ts 的既有口径）
    getConfig: readConfig,
    // 大白饭镜像出口（P10.x 上行接线）：brain 每笔真实过账的饭变动从这里
    // 进账本（riceJournal），返回值 = 新余额镜像，brain 拿它覆盖 pet.ts 的
    // 本地算术（语义见 brain.ts 的 PetBrainDeps.onRice）。
    // 【失败为什么返回 null 而不是抛】记账失败（磁盘坏等极端路径）只该让
    // "记账"这件事退化，不该把喂饭/发奖整条动作带崩 —— 返回 null = brain
    // 保留本地算术，余额显示照常，代价只是这一笔没进账本（下次会再试）。
    onRice: (ev) => {
      try {
        return riceJournal.record(ev)
      } catch (err) {
        console.warn('[miai] rice journal record failed, keeping local arithmetic', err)
        return null
      }
    },
    // 小黄鸭音效闸门：宠物窗是独立进程读不到 config，这条闭包是它唯一的读口
    // （判定口径同 v1：开关关掉或音量 0 都算静音）
    getSound: () => {
      const c = readConfig()
      return { enabled: c.soundEnabled, volume: c.sfxVolume }
    },
    debugPort: process.env['MIAI_PET_DEBUG_PORT']
  })
  // 宿主刚起来：账本余额对齐进 pet.json（brain 初始化读的是 pet.json 里的
  // 旧值 —— 启动恢复/启动上行可能已经改过账本）。相等则 no-op（brain 侧判）。
  syncRiceMirror()
}

// 单实例锁：重复启动时聚焦已有窗口，不重复开窗口
/*
 * Windows 任务栏分组/通知的 AppUserModelID 必须与 electron-builder 的
 * `appId` 一致（2026-10-17 分享版）：不设的话打包后进程仍自称
 * `com.electron.app`，任务栏会按「另一个 Electron 应用」分组，钉住的图标
 * 和通知都指不到我们自己的快捷方式。必须在 whenReady 之前设。
 */
if (process.platform === 'win32') app.setAppUserModelId('com.miai.biancheng')
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 开屏期间主窗还没上屏：把开屏窗拿到前面 —— 它就是用户此刻正在看的
    // 那个窗口（主窗是隐藏的，聚焦它等于「第二次启动毫无反应」）。
    const target =
      splashWin && !splashWin.isDestroyed() ? splashWin : BrowserWindow.getAllWindows()[0]
    if (target) {
      if (target.isMinimized()) target.restore()
      target.focus()
    }
  })

  app.whenReady().then(() => {
    ipcMain.handle(IPC.appGetVersion, () => app.getVersion())

    // 读口 = readProfile()（迁移挂在它身上）。**不许直接 profileStore.read()**：
    // 那条路会把一份 v1 老档案原样交给渲染进程，而渲染层拿到的 rewards 是
    // undefined，下次它防抖保存回来时，那一节就**永远没了**。
    // P10.6 起带戳回话（本地写协议）：渲染层收着 {epoch, rev}，整份写时原样带回。
    ipcMain.handle(
      IPC.profileGet,
      (): StampedDoc<UserProfile | null> => ({ data: readProfile(), stamp: profileStore.stamp() })
    )

    ipcMain.handle(
      IPC.profileSave,
      (_e, profile: UserProfile, stamp?: BoxStamp | null): DocWriteResult<UserProfile | null> =>
        attemptDocWrite({
          write: () => {
            // 写口在 store/profile-apply.ts（纯函数，单测在那边）：以**磁盘原始 JSON 为
            // 基底** apply 业务字段（未知键全保留 —— P10.1 头号 bug 的修复），并按 diff
            // 维护 learnedAt / favoriteAt / tombstones（主进程独占，入参里的一律不听）。
            // 「version / rewards / checkin 归主进程」那笔账（防抖保存抹掉刚发的奖励图、
            // 刚签的到）整个搬进了那个文件的头注释 —— 别在这里再建一份白名单重建对象。
            const next = applyProfileSave({
              diskRaw: profileStore.read(),
              current: readProfileRaw(),
              payload: profile,
              now: new Date().toISOString()
            })
            profileStore.write(next, stamp ?? undefined)
          },
          readCurrent: () => readProfile(),
          stamp: () => profileStore.stamp()
        })
    )

    // ---- 错题本（M4-05，学习闭环扩）
    //
    // 三条路全部走 readWrongbook() / writeWrongbook()：读口负责把老形状搬成信封、
    // 写口保证永远写出信封。**别在这里再出现裸的 wrongbookStore.read()**。
    ipcMain.handle(IPC.wrongbookGet, () => readWrongbook())

    ipcMain.handle(IPC.wrongbookRecord, (_e, items: WrongRecordItem[]) => {
      if (!Array.isArray(items)) throw new Error('invalid wrongbook payload')
      // 合并 + 裁剪 + 复活名单**一次算完**，全在 applyWrongRecord 里（纯函数，
      // 单测在 store/__tests__）。里面三条规矩都是「错了不会报错」的那种：
      // AI 题必带本体、AI 题封顶、**复活名单要在合并前问**（合并会把"删过"的证据抹掉，
      // 顺序反了提示就永久沉默）。顺序收在纯函数里，才有测试守得住 —— 见它的注释
      const { entries, revived } = applyWrongRecord(
        readWrongbook(),
        items,
        new Date().toISOString()
      )
      writeWrongbook(entries)
      // 返回给渲染层 → finish() 弹「这条你删过，又答错了喵」。
      // 返回类型从 void 变成 string[] 是**加法**，老调用点忽略返回值即可
      return revived
    })

    ipcMain.handle(IPC.wrongbookClear, (_e, keys: string[]) => {
      if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
        throw new Error('invalid wrongbook payload')
      }
      const all = readWrongbook()
      const now = new Date().toISOString()
      // AI 题和内置题走**同一套**：答对就标 cleared，不特殊对待。
      // 给某一类题开个例外（比如「答对了直接删」）看着只多一行，
      // 代价是「历史会保留」那句话从此只对一半的题成立，而用户没法知道是哪一半
      for (const e of all) {
        if (!e.cleared && keys.includes(e.key)) {
          e.cleared = true
          e.clearedAt = now
        }
      }
      writeWrongbook(all)
    })

    // 用户手动动一条：软删 / 恢复 / 标漏洞（学习闭环）。
    // 合并逻辑在 applyWrongUpdate（纯函数，单测在 store/__tests__），这里只管形状与落盘。
    // 返回**新列表**，渲染层的错题本 store 直接用它刷新快照。
    ipcMain.handle(IPC.wrongbookUpdate, (_e, updates: WrongUpdateItem[]) => {
      if (!Array.isArray(updates)) throw new Error('invalid wrongbook payload')
      const next = applyWrongUpdate(readWrongbook(), updates, new Date().toISOString())
      writeWrongbook(next)
      return next
    })

    // ---- 收藏的题目（学习闭环）
    //
    // 和 profile 同型：**只有渲染层一个写方**，所以整份读、整份存，
    // 载入 + 防抖 + 退出冲刷那套落在渲染层的 favorites store 里（照 progress.ts）。
    // 主进程这层只管两件事：读时清洗（坏文件不丢用户数据）、写时校形（写错就抛）。
    ipcMain.handle(
      IPC.favoritesGet,
      (): StampedDoc<FavoritesFile> => ({ data: readFavorites(), stamp: favoritesStore.stamp() })
    )

    ipcMain.handle(
      IPC.favoritesSave,
      (_e, file: FavoritesFile, stamp?: BoxStamp | null): DocWriteResult<FavoritesFile> =>
        attemptDocWrite({
          write: () => {
            // 写口在 store/favorites-merge.ts 的 applyFavoritesSave（纯函数，单测在那边）：
            // 入参校形会抛（形状不对**一个字节都不写**，和 config:save 一个规矩）；
            // 以磁盘原始 JSON 为基底保未知键；按 diff 维护 updatedAt 与两张墓碑表
            // （渲染层交上来的 updatedAt / 墓碑一律不听）；内置题误带的 ai 本体照旧剥掉、
            // 指向已删文件夹的 folderId 照旧摘回未分组
            const next = applyFavoritesSave({
              diskRaw: favoritesStore.read(),
              current: readFavorites(),
              payload: file,
              now: new Date().toISOString()
            })
            favoritesStore.write(next, stamp ?? undefined)
          },
          readCurrent: () => readFavorites(),
          stamp: () => favoritesStore.stamp()
        })
    )

    // ---- 大肥鱼备忘录（P3 ②）
    //
    // 同 favorites：**只有渲染层一个写方**，所以整份读、整份存 ——
    // 载入 + 防抖 + 退出冲刷那套落在渲染层的 memo store 里（照 favorites.ts）。
    // 主进程这层只管两件事：读时清洗（坏文件不丢用户敲的字）、写时校形（写错就抛）。
    ipcMain.handle(
      IPC.memoGet,
      (): StampedDoc<MemoFile> => ({ data: readMemo(), stamp: memoStore.stamp() })
    )

    ipcMain.handle(
      IPC.memoSave,
      (_e, file: MemoFile, stamp?: BoxStamp | null): DocWriteResult<MemoFile> =>
        attemptDocWrite({
          write: () => {
            // sanitize 里会抛：坏条目（id 空/重复、kind 不认识、body 非串或超 64KB）
            // **一个字节都不写**，磁盘上那份原样留着 —— 备忘丢了用户自己都复述不出来，
            // 所以这里比收藏那边更不允许"顺手丢一条"
            memoStore.write(sanitizeMemo(file), stamp ?? undefined)
          },
          readCurrent: () => readMemo(),
          stamp: () => memoStore.stamp()
        })
    )

    // ---- 练习史（学习闭环）
    //
    // 记账的唯一落点在渲染层的 finish()（见 docs/20 §2.2）—— 这里只负责
    // 校验入参、铸 id、追加、按上限裁剪，全是纯函数（practice-merge.ts）。
    ipcMain.handle(IPC.practiceRecord, (_e, input: PracticeRecordInput) => {
      // 返回新文件：渲染层手里那份（每日复习加权要用）顺手就换掉了，
      // 省一次 getPractice 往返，也就没有「写成功了、读到的还是旧的」这种缝
      const next = appendPractice(
        readPractice(),
        input,
        new Date().toISOString(),
        device().installId
      )
      practiceStore.write(next)
      return next
    })

    ipcMain.handle(IPC.practiceGet, () => readPractice())

    // ---- 奖励图（学习闭环 §7：每天第一次复习完发一张，2026-10-17 起不看分数）
    //
    // 【为什么发奖必须是一条通道，不是渲染层自己往档案里塞】
    // `profile.rewards` 归主进程所有：profile:save 无条件丢弃入参里的 rewards、
    // 一律取磁盘现值（见上面那段注释）。渲染层自己 push 的那张，会在下一次
    // 防抖保存时被**静默抹掉** —— 用户看到奖励弹窗、点保存，图却永远不算数。
    //
    // 挑哪张图由渲染层决定（它要用同一个 id 当场把图显示出来，
    // 见 shared/gallery.ts 的 pickRewardId），这里只做校验、合并、落盘。
    // id 允许为 null：图库全收集完时没有新图可发，但这一轮全对照样记一笔
    // （perfectPasses +1）—— grantReward 里两个字段各记各的，理由见它注释。
    // `perfect` 也由渲染层送：判分只在渲染层（verdictOf 是唯一入口），
    // 主进程拿不到卷面。它只决定全对次数这一个台账，不参与发图裁决。
    //
    // 【日子由**主进程**现取，不信渲染层送来的（每日一次，V1-38）】
    // "今天发过没有"的判据 `day <= lastImageDay` 用的必须是主进程此刻的
    // todayKey()：渲染层可以传 id，但日子要是也让它送，一个改过的渲染层
    // （或者只是它那边的活时钟过零点慢了一拍）就能绕开每日限制。
    // 主进程取日子的地方都走同一个 todayKey()（签到、挑战同理），口径只有一份。
    ipcMain.handle(IPC.rewardsGrant, (_e, input: { id?: unknown; perfect?: unknown } | null) => {
      // 形如 `{id: 'g03', perfect: true}`；null / 值域外的 id 走 grantReward 的"不发图"分支
      const id = typeof input?.id === 'string' ? input.id : null
      // 没有真凭实据就不记全对：`=== true` 之外的任何值（缺失、字符串、1）一律 false。
      // 这条不是"默认失败"，是"全对台账只收明确的 true"。
      const perfect = input?.perfect === true
      // **readProfileRaw**（不是对外的 readProfile）：下面整份摊开写回，
      // 用剥过墓碑的那份就等于把墓碑区抹了 —— 发一张图顺手清掉删除证据
      const current = readProfileRaw()
      // kind：渲染层按它决定「弹奖励弹窗（granted）/ 只说句话（full / daily-limit）」——
      // 满池不空弹（V1-38）。perfectPasses 只在 perfect=true 时 +1，见 grantReward 注释。
      const { rewards: next, kind } = grantReward(current.rewards, id, todayKey(), perfect)
      // 整份 current 摊开写回：只换 rewards，别的字段（含将来新加的）一个不动
      profileStore.write({ ...current, rewards: next })
      // 返回新的 rewards **与写后的档案戳**（P10.6）：渲染层直接换上 rewards，
      // 顺手 noteStamp —— 这条 RMW 顶掉了它手里那份戳，不带回去的话下一次
      // 防抖保存必然撞 STALE_REV 假冲突（冲突机制用来报"别人改过"，不该被
      // 我们自己的写口触发）
      return { rewards: next, stamp: profileStore.stamp(), kind }
    })

    // ---- 每日签到（P3 ①，2026-10-08）
    //
    // 【判重 → 写档 → 发饭，三步为什么必须挨着做、且全在主进程】
    // 渲染层写不了档案（profile:save 会把 checkin 顶掉，见上面那段）；而判重
    // 和发饭一旦分开（两次 IPC / 崩在中途）就会出「同一日键两碗饭」或
    // 「签了名没领到饭」。幂等判据是 **days 里有没有这天**（不是 lastDate）——
    // 时钟回拨玩法下 lastDate 会被写旧，只看它同一个日键能重复领饭（C9）。
    ipcMain.handle(IPC.checkinSubmit, (_e, rawDay: unknown): CheckinSubmitResult => {
      // 日键合法性在门口就拦：后面每条路都信任 day 是合法日键（进 days、算 streak），
      // 一个 '2026-2-3' 混进去会在月历上变成谁也画不出的格子。**抛**而不是回
      // ok:false —— 这是"载荷不合法"（代码 bug），不是"签到失败"这个业务结果；
      // CHECKIN_FAILED 那条 toast 留给真正的写盘失败。
      if (typeof rawDay !== 'string' || !DATE_KEY_RE.test(rawDay) || parseDateKey(rawDay) === null) {
        throw new Error('invalid checkin payload')
      }
      // readProfileRaw（不是对外的 readProfile）：下面整份摊开写回，必须带上
      // 墓碑区与时间戳 —— 用剥过的那份 = 签一次到顺手清掉全部删除证据
      const current = readProfileRaw()
      const { checkin, awarded, streakReset } = applyCheckin(current.checkin, rawDay)
      // 已签过：不写盘、不发饭、不出声（幂等重放不是错误；awarded=false 如实回报）。
      // 现戳照带（P10.6）：渲染层每次都拿它 noteStamp 对齐，见 CheckinSubmitResult.stamp
      if (!awarded) {
        return {
          ok: true,
          awarded: false,
          // 幂等重放什么都没发生：连"断没断签"都不该有结论（applyCheckin 同口径回 false）
          streakReset: false,
          checkin,
          riceGranted: false,
          riceCredited: null,
          stamp: profileStore.stamp()
        }
      }

      // 先写档案再发饭：宁可"签了但饭没端稳"（如实播报，饭改天补），
      // 不可"发了饭没签上"（重启后同一日键还能再领一份 —— 多发的饭追不回来）。
      // 写盘失败在这行当场抛 → 渲染层 catch → CHECKIN_FAILED，本地不标记（可再点）。
      profileStore.write({
        ...current,
        checkin,
        // 连续天数是派生镜像（照 learnedCount 先例）：签完就地同步，
        // 不然界面上「月历变了、连续天数没变」要等下次读档才修
        stats: { ...current.stats, streakDays: checkin.streakDays }
      })

      // 发饭：riceGranted / riceCredited 只由**宿主 act 的真实返回**判定（C1）——
      // petHost 没起来（用户关了桌宠）或载荷被 brain 丢弃时这里必然是 null /
      // 快照对不上，如实报，不许默认成功。act 返回的是发饭后的快照：
      //   · riceGranted —— "这次 grant 有没有被执行"（和按上限钳制的预期值
      //     对账：饭盒满仓时 rice 不会涨，那是正常，不是失败）；
      //   · riceCredited —— **真进盒几碗**（V1-42 / 空转[1]）：满仓 999 时是 0。
      //     渲染层拿它决定播报哪句 —— 拿着名义常量报"2 碗到手"而实际一粒没进，
      //     就是假报成功。
      let riceGranted = false
      let riceCredited: number | null = null
      try {
        const before = petHost?.init() ?? null
        const after = petHost?.act({ action: 'grant', reward: 'checkin' }) ?? null
        if (before !== null && after !== null) {
          riceGranted = after.rice === Math.min(PET_RICE_MAX, before.rice + PET_CHECKIN_RICE)
          riceCredited = after.rice - before.rice
        }
      } catch {
        // 宿主内部炸了：签到已经落盘，只有饭没发出去 —— 如实说。
        // 不做"重试发饭"的假补偿：这里没有可信的"没发过"凭据，重发就是二次发饭。
        riceGranted = false
        riceCredited = null
      }
      return {
        ok: true,
        awarded: true,
        streakReset,
        checkin,
        riceGranted,
        riceCredited,
        stamp: profileStore.stamp()
      }
    })

    // 「保存图片」：主进程弹保存框 + 从磁盘拷一份 png 出去。
    //
    // 【为什么由主进程找文件，渲染层只传 id】打包后图片名带 vite 的哈希
    // （`g01-3f9a2c.png`），且 dev 与打包两种形态下文件不在同一处 ——
    // 这条缝只有主进程分得清（app.getAppPath() / isDev）。渲染层手里那个 URL
    // 在 dev 是 devserver 地址、在打包版是 file 协议，都不适合再翻译回"源文件"。
    //
    // 【用户取消不是错误】取消 → `{ok:false, reason:'cancelled'}`，不抛异常 ——
    // 取消是日常操作，右一个红字报错反而吓人（照 AiResult 那套"失败即值"的语义）。
    ipcMain.handle(
      IPC.gallerySaveImage,
      async (event, input: { id?: unknown } | null): Promise<GallerySaveResult> => {
        const id = typeof input?.id === 'string' ? input.id : ''
        // 先卡值域再拼路径：这一句同时是**路径穿越的闸**（见 findGalleryImage 注释）
        if (!isGalleryId(id)) return { ok: false, reason: 'missing' }
        const src = findGalleryImage(id)
        if (!src) return { ok: false, reason: 'missing' }

        // 父窗口取发起请求的那个（不是"聚焦窗口"——请求也可能来自一个没聚焦的窗口）
        const win = BrowserWindow.fromWebContents(event.sender)
        // 保存框的扩展名/过滤器必须跟着**源文件**走（2026-10-17）：GIF 要存成
        // .gif（保住动画），用户覆盖进来的 jpg/webp 也不能被硬写成 .png
        // （内容与扩展名不符）。认不出的扩展名才退回 png。
        const srcExt = extname(src).slice(1).toLowerCase()
        const ext = SAVE_FILTERS[srcExt] ? srcExt : 'png'
        const options = {
          defaultPath: join(app.getPath('pictures'), GALLERY.FILE_NAME(id, ext)),
          filters: [SAVE_FILTERS[ext] ?? SAVE_FILTERS.png]
        }
        const { canceled, filePath } = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        if (canceled || !filePath) return { ok: false, reason: 'cancelled' }

        // 【异步拷贝 + tmp/rename 原子替换】（2026-10-14 修）
        // 与 media-import.ts（同日的同类修复）是同一类病：目标
        // 路径由用户在系统对话框里挑（任意位置/任意盘），copyFileSync 在整段
        // 拷贝期间占住主进程事件循环 —— 期间所有窗口的 IPC、窗口状态推送、
        // 壁纸帧调度全部停摆。单张素材仍小（2026-10-17 扩池后 200 张共约 38MB，
        // 单张 ~200KB），属预防性修复；闸门在 __tests__/gallery-save-io.test.ts。
        // 先拷到同名 `.tmp` 再 rename：拷贝中途失败（盘满、被杀）时用户挑的
        // 位置**不会留下半截文件** —— filePath 要么原样不动（覆盖已有文件的
        // 情形），要么根本不存在。rename 在 Windows 上是
        // MOVEFILE_REPLACE_EXISTING，覆盖已有文件也是原子的。
        const tmp = `${filePath}.tmp`
        try {
          await copyFile(src, tmp)
          await rename(tmp, filePath)
        } catch (err) {
          // 拷不过去的原因五花八门（盘满、目标被占用、没权限），对用户是同一句
          // "没能保存"；但日志里要留真原因，不然以后没法排查
          try {
            await rm(tmp, { force: true })
          } catch {
            /* 清理失败不改变对用户的结论：这一次保存就是没成 */
          }
          console.error('[gallery] save image failed:', err)
          return { ok: false, reason: 'failed' }
        }
        return { ok: true, path: filePath }
      }
    )

    // ---- 奖励图覆盖文件夹（2026-10-16，机制 =「丢文件即替换」）----
    // 读取：现扫、无缓存（目录小；空/不存在 = 空映射，失败即值不抛）。
    ipcMain.handle(IPC.rewardsOverridesGet, async (): Promise<RewardOverridesInfo> => {
      const dir = rewardsDir()
      return { dir, map: scanRewardOverrides(dir) }
    })
    // 打开文件夹：**路径不入参**（原则同 runnerOpenIde 的「exe 不在入参里」）。
    // 目录不存在先 mkdir —— 首次点击就得到一个空文件夹，正好是「把图丢这里」
    // 的说明书。
    //
    // 【为什么不用 shell.openPath（2026-10-16 活窗 + OS 层对照实测，别改回去）】
    // 本机 ShellExecute 通道对目录装死：openPath 返回空串（Electron 约定 = 成功）
    // 却什么窗口都不弹，`cmd /c start`（同一个 ShellExecute 层）对照同样开不出；
    // 而 `explorer.exe <反斜杠路径>` 直开稳定出窗。于是改直拉 explorer，并照
    // runner/native-ide.ts 的纪律等 'spawn'/'error' 二选一——等事实、不设人工
    // 超时。'spawn' = CreateProcess 成功，这是本机能拿到的诚实上限；「窗口真的
    // 弹出来」由活窗探针 openfolder-live.mjs 端到端验证。
    ipcMain.handle(IPC.rewardsOpenFolder, async (): Promise<{ ok: boolean; reason?: string }> => {
      const dir = rewardsDir()
      try {
        await mkdir(dir, { recursive: true })
      } catch (err) {
        console.error('[rewards] mkdir failed:', err)
        return { ok: false, reason: 'mkdir' }
      }
      // detached：explorer 不随应用生命周期；反斜杠路径是 explorer 唯一认的形态
      //（正斜杠会被它当参数吃掉、弹「文档」——对照实验见 diag-openfolder.mjs）。
      const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' })
      const started = await new Promise<{ ok: true } | { ok: false; err: Error }>((resolve) => {
        let settled = false
        child.once('spawn', () => {
          if (!settled) {
            settled = true
            resolve({ ok: true })
          }
        })
        child.once('error', (err) => {
          if (!settled) {
            settled = true
            resolve({ ok: false, err })
          }
        })
      })
      child.unref()
      if (!started.ok) {
        console.error('[rewards] explorer spawn failed:', started.err)
        return { ok: false, reason: 'open' }
      }
      return { ok: true }
    })

    // ---- 设置（M5-01 / M6）
    //
    // ⚠️ 出口**必须**过 toPublicConfig：它会把 ai.apiKey 抹成一个 hasKey 布尔。
    // 这里是 Key 唯一的漏点 —— 直接 `return configStore.read()` 就等于把明文
    // 送进渲染进程，一次 XSS 就没了。合并与裁剪的规矩详见 store/config-merge.ts。
    ipcMain.handle(IPC.configGet, (): PublicAppConfig => toPublicConfig(readConfig()))

    ipcMain.handle(IPC.configSave, (_e, cfg: ConfigSavePayload) => {
      // 入参非法就抛，**一个字节都不写**。读了现有配置再合并，
      // 是因为 apiKey 是三态：空串/不传 = 保持原样（渲染进程根本不知道真 Key）。
      const saved = mergeConfigPayload(readConfig(), cfg)
      configStore.write(saved)
      // 主题同时是**原生层**的事：设置页一切换，系统那条标题栏要跟着变
      // （见 applyNativeTheme）。放在写盘**之后** —— 写失败就该抛出去，
      // 不能让标题栏先变了而配置其实没存下，那两边就对不上了。
      applyNativeTheme(saved.theme)
      // 桌宠设置（开关/体型/落点）跟着每次保存走一次：宿主自己 diff，没变就是
      // 空转，变了才重启 helper。放写盘之后同 applyNativeTheme 的理由。
      petHost?.applySettings()
    })

    // ---- 环境检测（M5-01）：结果写穿缓存进 config.envCache
    ipcMain.handle(IPC.envDetect, async () => {
      const report = await detectAll()
      const cfg = readConfig()
      cfg.envCache = { report, at: new Date().toISOString() }
      configStore.write(cfg)
      return report
    })

    // ---- AI（M6-04）。**这四个会抛错，只因为「我们自己传错了参数」**。
    //
    // 为什么不学 deepseek.ts 那样「失败也返回结果」：
    // 那边处理的是**网络失败**（断网、Key 过期），是使用 AI 的日常；
    // 这里处理的是**入参形状不对**，那是内容包坏了或者调用方写错了 ——
    // 把它翻译成「AI 服务异常」，用户会去查网络，而真正坏掉的是我们自己的数据。
    // 所以入参非法一律抛，和 runner:run 一个规矩。
    //
    // AI 请求本身的失败（超时、401、余额不足）**不抛**，照常返回 AiResult。

    ipcMain.handle(IPC.aiExplain, (_e, input: AiExplainInput) => {
      assertAiExplain(input)
      return withAi((deps) => explainError(deps, input))
    })

    /*
     * 学习闭环阶段 7：出题前先查 ai-cache —— 每日复习补题和延展练习补题
     * 天天问的还是那几个老知识点，命中就是纯赚（token 是不问第二次的）。
     *
     * 查/问/存的编排全在 `questionsWithCache` 里（依赖注入、有单测）——
     * 这里只负责把主进程的三样东西接上去：磁盘 store、配置（模型名进缓存键）、
     * 以及**仍然走 withAi 的真生成**（单飞 + 取消的规矩一个字没少）。
     * 命中缓存时不经过 withAi：没发请求，就没有"在飞的请求"可取消。
     */
    ipcMain.handle(IPC.aiGenerateQuestions, (_e, input: AiGenerateInput) => {
      assertAiGenerate(input)
      const cfg = readConfig()
      return questionsWithCache({
        dynamicEnabled: cfg.ai.dynamicEnabled === true,
        model: cfg.ai.model,
        input,
        read: () => aiCacheStore.read(),
        write: (f) => aiCacheStore.write(f),
        now: () => new Date().toISOString(),
        generate: () =>
          withAi((deps) =>
            // verifyCode 只在**真生成**这条路上注入；命中缓存时用的就是当时
            // 已经验过的结果，不会再跑一遍编译器。
            generateQuestions({ ...deps, verifyCode: verifyAiCodeQuestion }, input)
          )
      })
    })

    ipcMain.handle(IPC.aiTestConnection, () => withAi((deps) => testConnection(deps)))

    /**
     * 取消。**没有请求在飞时调用它是安全的** —— abort 一个已经结束的控制器
     * 是空操作，这是 AbortController 保证的，不用额外判空。
     *
     * 【P1 起多了个可选参数】（docs/27 §8.1「扩展 1 条」）
     *   · 带 `{requestId}`：只掐那一条侧栏对话；
     *   · 省略参数：取消**全部** —— 旧单飞通道 + 所有在飞的侧栏对话。
     *     旧调用点（设置页测试连接、挑战抽题）调的就是这一支，而旧世界里
     *     "全部"恰好等于"现在那一个"，所以**旧语义逐字节不变**（§5.2）。
     *
     * 【为什么省略时也要掐侧栏】用户按下"取消"的意思是"别再花钱了"。
     * 只掐旧通道、放任侧栏继续烧，是把他那句话理解反了。
     * 侧栏自己的取消按钮一定带 requestId，所以正常使用中不会误伤（§12.2）。
     */
    ipcMain.handle(IPC.aiCancel, (_e, payload?: { requestId?: string }) => {
      const requestId =
        payload && typeof payload === 'object' ? (payload as { requestId?: unknown }).requestId : undefined
      if (typeof requestId === 'string' && requestId !== '') {
        aiChatInflight.get(requestId)?.abort()
        return
      }
      aiAbort?.abort()
      for (const ac of aiChatInflight.values()) ac.abort()
    })

    // ---- AI 侧栏对话（P1，docs/27 §8）
    //
    // 五条通道的分工：
    //   start   渲染层要开一条对话 → **立刻**回 requestId，不等模型
    //   delta   主进程 → 渲染层：正文增量（每个块一条）
    //   done    主进程 → 渲染层：统一收尾（成功/失败/取消都是这一条）
    //   history 重启后把 chat.json 读回来（docs/27 §8.1 未列，见通道注释）
    //   clear   清空 chat.json

    /**
     * 开一条侧栏对话。
     *
     * 【为什么 invoke 立刻返回、正文走事件】**这是流式的全部意义**：
     * 等模型说完再 return 的话，invoke 会挂 20~120 秒，渲染层连"正在输入"
     * 都画不出来（它连 requestId 都还没拿到）。
     *
     * 【为什么先落盘主人这句】他确实说过；失败时历史里保留这一句，
     * 下次打开还能看到"我问过、它没答上来"，比凭空消失诚实。
     */
    ipcMain.handle(IPC.aiChatStart, (e, raw: unknown): AiChatStartResult => {
      assertAiChatStart(raw)

      /*
       * id 优先沿用渲染层预生成的那个（见 types.ts 的 AiChatStartInput.requestId：
       * 渲染层先生成才能保证"事件到的时候它已经知道自己叫什么"）。
       * 只在缺失/形状可疑时自己生成 —— 长度上限防的是"某个调用点把整段文本当 id 灌进来"。
       */
      const wantId = raw.requestId
      const requestId =
        typeof wantId === 'string' && wantId !== '' && wantId.length <= 64
          ? wantId
          : crypto.randomUUID()
      const now = Date.now()

      // 闸门顺序：先限流、再看有没有在飞的 —— 两者的提示不同（§8.3 vs §8.2）
      const throttled = aiChatGate.tryStart(now)
      if (throttled !== null) return { requestId, accepted: false, reason: throttled }
      if (aiChatInflight.size > 0) return { requestId, accepted: false, reason: 'busy' }

      const ac = new AbortController()
      aiChatInflight.set(requestId, ac)
      const wc = e.sender

      const last = raw.messages[raw.messages.length - 1]
      if (last.role === 'user') {
        aiChatStore.write(appendChatMessage(aiChatStore.read(), last))
      }

      void runChat(
        {
          // Electron 主进程自带全局 fetch（Node 18+ 的 undici），不用额外引库
          fetch: (url, init) => globalThis.fetch(url, init),
          getConfig: readConfig,
          signal: ac.signal
        },
        raw,
        (delta) => {
          // 已经取消/结束的请求不许再往界面推：否则"取消"之后还会冒出几个字，
          // 看起来像取消没生效（用户会再点一次，而那一次真的会重复计费）
          if (ac.signal.aborted) return
          sendToRenderer(wc, IPC.aiChatDelta, { requestId, delta })
        }
      ).then(
        (res) => {
          aiChatInflight.delete(requestId)
          if (res.ok) {
            aiChatGate.noteResult('ok', Date.now())
            // 助手这一句也落盘：不落的话，重启后历史里只剩主人单方面在问
            aiChatStore.write(appendChatMessage(aiChatStore.read(), { role: 'assistant', content: res.data }))
            sendToRenderer(wc, IPC.aiChatDone, { requestId, ok: true })
            return
          }
          aiChatGate.noteResult(res.reason === 'canceled' ? 'cancel' : 'fail', Date.now())
          sendToRenderer(wc, IPC.aiChatDone, {
            requestId,
            ok: false,
            reason: res.reason,
            detail: res.detail
          })
        },
        // runChat 按设计不抛（失败即值）；能到这里的只有"我们自己的代码炸了"。
        // 照样要发 done —— 不发的话界面永远卡在"正在输入"（docs/27 §12.7）。
        (err: unknown) => {
          aiChatInflight.delete(requestId)
          aiChatGate.noteResult('fail', Date.now())
          sendToRenderer(wc, IPC.aiChatDone, {
            requestId,
            ok: false,
            reason: 'bad-response',
            detail: err instanceof Error ? err.message : String(err)
          })
        }
      )

      return { requestId, accepted: true }
    })

    /** 读会话历史（最多 200 条）。文件坏掉时返回空列表 —— 不是错误，是"重启从头来" */
    ipcMain.handle(IPC.aiChatHistory, (): AiChatHistoryView => ({
      messages: normalizeChatFile(aiChatStore.read()).messages
    }))

    /** 清空对话。写一份空结构而不是删文件：删文件会让 .bak 在下次读取时"复活"它 */
    ipcMain.handle(IPC.aiChatClear, () => {
      aiChatStore.write(clearChatFile())
    })

    // ---- 每日挑战（M6）
    //
    // 这里**只管存取**，不管出题。出题要读内容包（在渲染进程手里）、
    // 要调 AI（走上面那两条通道），放主进程就得把内容包再读一份 ——
    // 两份内容包意味着两套题库，改一处另一处不会报错。
    //
    // 主进程负责的是**渲染进程够不着的两件事**：
    //   1. 文件读写（渲染进程没有 fs）
    //   2. 30 天裁剪 —— 这是「文件别无限长」的责任，跟界面无关，
    //      放这里一处生效，而且纯函数好测

    ipcMain.handle(IPC.challengeGet, (_e, dateKey: string): ChallengeToday => {
      if (typeof dateKey !== 'string') throw new Error('invalid challenge payload')
      return challengeToday(challengeStore.read(), dateKey)
    })

    ipcMain.handle(IPC.challengeSave, (_e, day: ChallengeDay) => {
      // 裁剪的「今天」用**主进程的时钟**：这个日期只用来判断「哪些批次太老了」，
      // 差一天不会让任何一天的记录消失（窗口是 30 天，不是 1 天）。
      // 真正要跟用户时区对齐的是「今天是哪天」—— 那个由渲染进程算好传进来。
      // 无戳（P10.6）：逐日 upsert 是操作型写口，天然无冲突（同 wrongbook）。
      challengeStore.write(mergeChallengeDay(challengeStore.read(), day, todayKey()))
    })

    // ---- 代码运行（M5-02）：入参校验 → 环境报告（缓存保鲜）→ 单任务队列
    //
    // 【3.0 加了原生模式，两条路是同一条队、但互不兜底】
    // req.native === true 时走 native.ts（借用户自己的 PATH + cmd.exe），否则走托管运行。
    // **不许有任何一条「这条不通就换那条」的分支**（红线 17）：原生失败必须原样报告失败，
    // 静默换回去的后果是用户以为自己跑的是自己装的编译器，其实不是。
    ipcMain.handle(IPC.runnerRun, async (_e, req: RunRequest) => {
      if (
        !req ||
        typeof req !== 'object' ||
        typeof req.lang !== 'string' ||
        !(LANG_OF_CODE as readonly string[]).includes(req.lang) ||
        typeof req.code !== 'string'
      ) {
        throw new Error('invalid run payload')
      }
      if (req.native !== undefined && typeof req.native !== 'boolean') {
        throw new Error('invalid run payload')
      }
      if (Buffer.byteLength(req.code, 'utf8') > MAX_CODE_BYTES) throw new Error('code too large')
      if (req.stdin != null && Buffer.byteLength(req.stdin, 'utf8') > MAX_STDIN_BYTES) {
        throw new Error('stdin too large')
      }

      const cfg = configStore.read() ?? structuredClone(DEFAULT_APP_CONFIG)

      // ⚠️ 闸门放在**读配置之后、环境检测之前**：开关没开却带 native:true 的请求，
      // 连检测都不做就拒掉。这条路径只有两种来法 —— 旧版渲染层，或有人手工发 IPC ——
      // 两者都意味着「用户从没在设置页打开过这个开关」，那时候替他换编译器是越权。
      // 判定抽成纯函数（native.ts）是为了能单测：写反极性 = 用户没要求却走用户外壳。
      const gate = nativeGateReason(cfg.nativeRunEnabled === true, req.native)
      if (gate !== null) throw new Error(gate)

      // 缓存里报「没找到」的那门当场复核（只查它一个，跑代码用不到别的语言）。
      // 旧写法是 `if (!report)` —— 只要缓存存在就再也不检，等于工具链装好了也永远说「没装」，
      // 重启应用都治不好。规则与完整经过见 shared/env-cache.ts。
      const { report, rechecked } = await refreshLangs(
        cfg.envCache.report,
        req.lang as LangOfCode
      )
      if (rechecked.length > 0) {
        // 【写回前现读一次，别拿 await 之前的快照】（2026-10-14 修）`cfg` 是
        // `refreshLangs` **之前**读的，而中间隔着一次 await（真起检测进程，
        // 几百毫秒）。这期间渲染层完全可能 `config:save` 了别的东西（用户切了个
        // 开关、改了超时）—— 拿旧快照原样写回，会把那次改动**整份抹掉**，
        // 而用户那边的保存已经返回成功，从头到尾没有一处会报错。
        // （与 P10.1 收藏那笔账同族：无戳的写口顶掉别人带戳的写。）
        // 口径对齐同文件里的 `envDetect`：**读在 await 之后**，只覆盖 envCache 一格。
        const fresh = readConfig()
        fresh.envCache = { report, at: new Date().toISOString() }
        configStore.write(fresh)
      }
      const full = { ...req, timeoutSec: req.timeoutSec ?? cfg.runTimeoutSec }
      if (req.native === true) {
        // nativeEnv() 在**每一次原生运行前**重算：用户刚装好工具链、PATH 刚被改，
        // 这条才是「当下的事实」（进程启动时那份 PATH 早就过期了）。
        // 只在这一条分支上付这份开销（两次 reg query），托管运行一个字节都不多付。
        return enqueueNativeRun(full, report, { env: await nativeEnv() })
      }
      return enqueueRun(full, report)
    })

    // ---- 本地 IDE 联动（2026-10-01）：练习场「本地 IDE 打开 / 导出并复制路径」+ 设置页选程序
    //
    // 三条通道都是「**失败即值，不抛**」：没配置 / 程序不在 / 用户取消，都是使用它的
    // 日常，不该逼每个调用点写 try/catch；只有**入参形状不对**才抛（parseCodePayload）。
    //
    // ⚠️ exe 路径**不在任何入参里**：openInNativeIde 自己从 readConfig() 现读 ——
    // 让渲染层传 exe 的话，这条通道就成了「任意程序执行」。
    ipcMain.handle(IPC.dialogPickExe, async (event): Promise<PickExeResult> => {
      // 父窗口取发起请求的那个（照上面 gallery:save-image）
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: IDE_PICK.TITLE,
        properties: ['openFile'],
        // 只放 .exe 进来：桌面快捷方式（.lnk）spawn 不起来（CreateProcess 不解析），
        // 放它进来只会把错误推迟到点「本地 IDE 打开」的那一刻，还多一段没人看得懂的报错。
        filters: [{ name: IDE_PICK.FILTER_NAME, extensions: ['exe'] }]
      }
      const { canceled, filePaths } = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const picked = filePaths[0]
      if (canceled || !picked) return { ok: false, reason: 'cancelled' }
      return { ok: true, path: picked }
    })

    ipcMain.handle(IPC.runnerOpenIde, async (_e, input: unknown): Promise<IdeOpenResult> => {
      const { lang, code, own } = parseCodePayload(input)
      // deps 只给 readConfig：exe 的来源必须是那个带迁移的唯一读口（不是配置快照）
      const result = await openInNativeIde(lang, code, { readConfig })
      trackNativeCompile(result, lang, code, own)
      return result
    })

    ipcMain.handle(IPC.runnerExportCode, (_e, input: unknown): ExportCodeResult => {
      const { lang, code, own } = parseCodePayload(input)
      // deps 只给 readConfig：导出编码跟随该语言配好的 IDE（v9 起），
      // 来源同样必须是那个带迁移的唯一读口（不是配置快照）。
      const result = exportCodeToFile(lang, code, { readConfig })
      trackNativeCompile(result, lang, code, own)
      return result
    })

    // 自动探测本机装了哪些 IDE（设置页 / 练习场「🔍 自动检测」）。
    // 【shell 为什么在这里注入】detect-ide.ts 故意不 import electron ——
    // 否则 vitest 一 import 它就会去加载 electron（见该文件头的依赖注入说明）。
    // 解 .lnk 只有主进程的 shell 能做，所以 readShortcut 在接线处传进去。
    ipcMain.handle(IPC.runnerDetectIde, (): Promise<IdeDetectResult> =>
      detectIdes({ readShortcut: (p) => shell.readShortcutLink(p).target })
    )

    // ---- 动态壁纸（docs/23；P3 步 1：只到「列清单 + 窗口状态」）
    //
    // 失败即值：没装 Steam 时 catalog.available=false + 空列表，不抛 ——
    // 没装是完全正常的使用形态，不该逼调用方 try/catch（同 runner:detect-ide）。
    // 首次调用现扫（注册表探针 + 逐目录读 project.json），带 60s TTL 缓存；
    // 顺带装 miai-wall:// 的 handler，根白名单挂在扫描结果上（见 catalog.ts）。
    // force 严格收窄成 true 才放行（IPC 入参不可信，truthy 垃圾不许穿透 TTL）：
    // 渲染层「刷新」按钮要的是即刻重扫，不是最多 60 秒前的旧快照。
    ipcMain.handle(
      IPC.wallpaperList,
      (_e, force?: unknown): Promise<WallpaperCatalog> => getWallpaperCatalog(force === true)
    )

    // 读一张壁纸的自带属性**原文**（「壁纸属性」面板）。**只读文件、不解析** ——
    // 解析器是 shared 的纯计算、还要和渲染层存储的覆盖值合并，只有一份实现
    // （分工见 main/wallpaper/props.ts 文件头）。入参不可信：非空字符串才放行，
    // 否则直接给空结果，不抛（同 wallpaperList 的收窄口径）。
    ipcMain.handle(IPC.wallpaperProps, (_e, itemId?: unknown): Promise<WallpaperPropsResult> => {
      if (typeof itemId !== 'string' || itemId === '') {
        return Promise.resolve({ project: null, path: null })
      }
      return readWallpaperProps(itemId)
    })

    // ---- 导入自定义壁纸（2026-10-06）----
    // 无入参：路径只能主进程弹框现选（让渲染层传路径 = 开一条任意文件拷进
    // 数据目录的通道，见 ipc-channels.ts 的通道注释）。拷贝成功后**强制重扫**
    // 壁纸清单 —— 新条目带目录进扫描快照，miai-wall:// 白名单随之覆盖它
    // （白名单挂在快照上，见 catalog.ts 的 currentRoots）。
    const customWallpaperDir = join(storageDir(), 'wallpapers')
    ipcMain.handle(IPC.wallpaperImport, async (event): Promise<MediaImportResult> => {
      const result = await importMedia({
        pickFile: (req) => pickFileViaDialog(event, req),
        destDir: customWallpaperDir,
        allowedExts: WALLPAPER_UPLOAD_EXTS,
        title: MEDIA_IMPORT.WALL_TITLE,
        filterName: MEDIA_IMPORT.WALL_FILTER_NAME
      })
      if (result.ok) {
        // 重扫失败不把导入翻案成失败（文件已经落盘，之后任何一次刷新都会
        // 带上它），但要留痕 —— 静默吞掉等于把「列表没出现」变成无头案。
        try {
          await getWallpaperCatalog(true)
        } catch (err) {
          console.warn('[miai] wallpaper rescan after import failed:', err)
        }
      }
      return result
    })

    // 读一次当前窗口状态：订阅建立前的首帧兜底（did-finish-load 的强制推
    // 发生在渲染层挂载之前，那一刻没有任何人在听，见 preload 的契约注释）。
    ipcMain.handle(IPC.wallpaperStateGet, (e): WallpaperWindowState => {
      const win = BrowserWindow.fromWebContents(e.sender)
      // 走到这里没有窗口 = 调用方不是本进程的窗口（不可能发生）；如实抛，
      // 不编一个「全 false」的状态 —— 那会让壁纸永远暂停且查不出原因。
      if (!win) throw new Error('wallpaper:state:get: no window for sender')
      return readWindowState(win, 'poll', () => petWinFocused)
    })

    // ---- 系统声回采（壁纸「音频响应」的数据源；P3 第三步，2026-10-05）
    //
    // 【为什么必须有这一段】渲染层 getDisplayMedia 在 Electron 里没有主进程
    // 应答就是 "Not supported" 直接抛——而且那是运行时错误，编译期一切正常。
    // audio: 'loopback' = 回采**系统播放声**（不是麦克风）：这是对照 WE 的做法，
    // 壁纸随音乐律动靠的就是它。真实捕获在渲染层是**设置里勾选后**才发起
    // （audio.ts enable()），这里只是把通道备好；没人勾选时没有任何捕获发生。
    //
    // useSystemPicker: false —— 不走系统选择器（我们是无声回采，没有"选哪个
    // 屏幕"的用户交互可言；Windows 上本就没有该选择器，显式关掉防 macOS 行为分叉）。
    // 失败回调 null = 渲染层拿到 getDisplayMedia 拒绝，按「开启失败」处理（toast）。
    //
    // 【2026-10-06：日志 + 超时】（主人实测「首载音频监控失效」排查配套）
    // 老版本这里零日志、getSources 无超时 —— 采集端卡在哪一步全靠猜。现在
    // 成功/失败都落一条 console（耗时 + 源数量），getSources 4s 未回即判失败
    // 并 callback(null)：渲染层那边 8s 超时 + 自动重试，这里先给结论不叠等待。
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        const t0 = Date.now()
        let timer: NodeJS.Timeout | undefined
        try {
          const sources = await Promise.race([
            desktopCapturer.getSources({ types: ['screen'] }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('desktopCapturer.getSources timeout')), 4000)
            })
          ])
          // Electron 44 的 d.ts 把回调参数写成 Streams（不含 null），而官方文档与
          // 运行时都认 null = 拒绝本次请求（类型落后于运行时）—— 按文档口径传，
          // 收窄处用 Parameters 取回调参数类型过桥，别为它改运行时语义。
          const streams = sources.length
            ? { video: sources[0], audio: 'loopback' as const }
            : null
          if (!streams) console.warn('[miai] display-media request: no screen source available')
          else console.log('[miai] display-media request served in', Date.now() - t0, 'ms; sources:', sources.length)
          callback(streams as Parameters<typeof callback>[0])
        } catch (e) {
          console.warn('[miai] display-media request failed:', e)
          callback(null as unknown as Parameters<typeof callback>[0])
        } finally {
          if (timer) clearTimeout(timer)
        }
      },
      { useSystemPicker: false }
    )

    // ---- 开屏动画（docs/24，2026-10-05）的三条 IPC 通道 ----
    // 转发给闸门；闸门变量在下面才赋值，但这些 handler 要到运行时才碰它。
    // · splash:event     开屏页上报（gate 内部按 sender 校验来源）
    // · splash:get       开屏页拉播放配置（没在播/来源不对 → null）
    // · splash:stats:get 主窗补拉时间线（没开过屏 → null）
    ipcMain.on(IPC.splashEvent, (e, ev: unknown) => splashGate?.onEvent(e.sender, ev))
    ipcMain.handle(IPC.splashGet, (e) => splashGate?.getPayload(e.sender) ?? null)
    ipcMain.handle(IPC.splashStatsGet, () => splashGate?.stats() ?? null)

    // ---- 桌宠 IPC（2026-10-06 换 dsh-pet 引擎后的转接壳）----
    //
    // 宠物窗由 dsh-pet helper（独立进程）掌管，主进程与渲染层之间不再有
    // 活体宠物窗；但渲染层的 lib/pet-bridge.ts 仍在**活着上报**（学完发奖、
    // 运行结果、答错题）。这些上报现在转发给宿主里的行为大脑（dshpet/brain.ts，
    // 2026-10-06 从旧引擎逐条迁移），宠物照样冒泡、照样记账。
    // 宿主由 startPet() 在主窗诞生时建；?. 兜住「窗口还没出生就有人上报」的
    // 时序空隙（丢一条上报可以接受，崩掉不可以）。
    ipcMain.handle(IPC.petInit, () => petHost?.init() ?? null)
    ipcMain.handle(IPC.petAct, (_e, raw: unknown) => petHost?.act(raw) ?? null)
    // 聊天面板是旧引擎的设施，新引擎零 API（红线）：保持如实的空应答 ——
    // 渲染层没有活调用点，删掉它要连类型与桥一起动，不在迁移这一步里。
    ipcMain.handle(IPC.petChat, () => null)
    // pet:report-run / pet:hit 是单向上报通道（report-run 转发给大脑，
    // 运行失败时鱼要开口说报错语言；pet:hit 是旧宠物窗的点击上报，新引擎的
    // 点击在扩展脚本里本地处理，这里保留空监听 —— 见
    // shared/__tests__/ipc-wiring.test.ts，修法不是删通道）。
    ipcMain.on(IPC.petReportRun, (_e, raw: unknown) => petHost?.reportRun(raw))
    // 学习收工事件（P3 ④ 好感度）：载荷 kind 由 parsePetAction 校验，
    // 垃圾值在 act 内被丢弃并留日志，这里不重复写校验。
    ipcMain.on(IPC.petEvent, (_e, kind: unknown) => petHost?.act({ action: 'event', kind }))
    ipcMain.on(IPC.petHit, () => {})
    // 挽留台词（设置卡「叫它出来」开关悬停 → 撒娇）。失败即忽略：宿主没起 =
    // 「关的就是它」，没人要听是正常态，不该影响开关本身的动作（见通道注释）。
    ipcMain.handle(IPC.petPlead, () => {
      petHost?.plead()
    })
    // 正文编辑区的位置上报（跟随鼠标的「绝不遮挡代码」让位规则，2026-10-09
    // 补充模块一）。整流形校验在宿主 reportWorkRect 里做（坏载荷按 null 处理
    // + 日志）—— 这里只转发，不重复第二份判据。
    ipcMain.on(IPC.petReportWorkRect, (_e, raw: unknown) => petHost?.reportWorkRect(raw))

    // ---- 云账号 IPC（P10.3 第一步，2026-10-10；P10.5 扩成账号通道）----
    // handler 转发给 main/cloud 的客户端与账号流程（注册/登录/登出/会话探测/
    // 激活/预览/状态/同步）。
    //
    // 【为什么 handler 注册在**本文件**而不是 main/cloud/】ipc-wiring 闸门
    // （src/shared/__tests__/ipc-wiring.test.ts）的扫描面钉死是 main/index.ts +
    // 本文件：通道必须有字面量 `ipcMain.handle(IPC.xxx, ...)` 出现在扫描面里，
    // 只导出一个 registerCloudIpc() 到这里调一下，orphan 断言当场红 ——
    // 这正是那条闸门要防的「接线藏进新文件」。
    //
    // 【失败即值】这些口都不抛网络/协议类失败（CloudResult 上行；理由见
    // shared/cloud/dto.ts）—— 只有载荷形状不对（cloudCredentials /
    // parseAdoptMode / parseSyncOpts）才抛。
    //
    // 【客户端在这里建】baseUrl 由 resolveCloudBaseUrl 在启动时裁决一次
    // （打包版恒走生产地址、忽略环境变量；开发版默认
    // http://127.0.0.1:8787，可用 MIAI_CLOUD_BASE_URL 覆盖）。
    // token 的落盘实现在模块级统一（P10.5 起是
    // session-store.ts 的 safeStorage 实现），baseUrl/token/fetch/同步引擎
    // 都在模块级共享 —— 账号、流水、结算、排行榜、同步必须看到同一个登录态。
    // clientLabel = 设备显示名（device.json，P10.1 第 2 项）：注册/登录时告诉
    // 服务端"这是哪台设备"，P10.6 的账号页拿它列设备。
    const cloudClient = createCloudAccountClient({
      baseUrl: cloudBaseUrl,
      fetch: cloudFetch,
      tokens: cloudTokens,
      clientLabel: device().clientLabel
    })
    ipcMain.handle(IPC.cloudRegister, (_e, input: unknown) => cloudClient.register(cloudRegisterInput(input)))
    ipcMain.handle(IPC.cloudLogin, (_e, input: unknown) => cloudClient.login(cloudCredentials(input)))
    // 登出 = 干涸协议（docs/21 §3.5.1）：①等两条写口停稳（whenIdle **不新起**
    // 轮/趟）②登出（失败保留令牌与盒子 —— 网络抖一下 ≠ 要登出，见 account.ts
    // 的 logout 注释）③成功才回客人盒。
    //
    // 【V1-62：第 ① 步带 5 秒上限】断网时在飞的同步/上推轮次可能挂在网络
    // 等待与退避里，whenIdle 跟着一起钉住 —— 按钮转圈，"退出登录"这个用户
    // 意志被扣为人质。drainWithCap 到点就放行（语义与判据见 cloud/drain.ts）：
    // 干涸只是尽力而为的收尾，两条写口都是幂等重试的。allSettled 的纵深
    // （任何一侧异常都不许吞掉"登出"动作本身）移进了 drainWithCap 体内。
    ipcMain.handle(IPC.cloudLogout, async () => {
      await drainWithCap([uplink.whenIdle(), cloudSync.whenIdle()])
      const res = await cloudClient.logout()
      if (res.ok) {
        leaveToGuest(accountFlowDeps)
        syncRiceMirror()
      }
      return res
    })
    // 仅本机退出（V1-62，2026-10-16）：零网络的出路 —— 丢本地令牌 + 回客人盒，
    // **一个包都不发**（所以没有 drainWithCap：不会被任何在飞轮次扣住；切盒的
    // epoch 屏障会替我们把在飞同步轮的后续动作拒掉，已经飞出网的那一次请求
    // 就算落地了也是这个账号自己的数据、合并幂等，不构成脏写）。
    // 语义与代价见 account-flow.ts 的 logoutLocal 头注释；恒成功（没有失败分支），
    // 返回云调用的同形状只是让两个出口在渲染层可以走同一条路。
    ipcMain.handle(IPC.cloudLogoutLocal, () => {
      logoutLocal(accountFlowDeps)
      syncRiceMirror()
      return cloudOk(null)
    })
    ipcMain.handle(IPC.cloudSession, () => cloudClient.session())

    // ---- 找回密码三步链（2026-10-13 主人令）----
    // 载荷逐字段收（requireStringField，"我们自己传错形状"才抛，同上面的先例）；
    // 三个口都不碰本地会话/token（服务端有意不发 token），防爆破限流在服务端、
    // 429 原样透传（界面按 retryAfterMs 说"歇一会儿"）。
    ipcMain.handle(IPC.cloudRecoverQuestion, (_e, raw: unknown) =>
      cloudClient.recoverQuestion({ username: requireStringField(raw, 'username') })
    )
    ipcMain.handle(IPC.cloudRecoverVerify, (_e, raw: unknown) =>
      cloudClient.recoverVerify({
        username: requireStringField(raw, 'username'),
        answer: requireStringField(raw, 'answer')
      })
    )
    ipcMain.handle(IPC.cloudRecoverReset, (_e, raw: unknown) =>
      cloudClient.recoverReset({
        username: requireStringField(raw, 'username'),
        answer: requireStringField(raw, 'answer'),
        newPassword: requireStringField(raw, 'newPassword')
      })
    )

    // ---- 账号通道 IPC（P10.5）----
    // 激活（收编/直达）、收编预览、状态读口、同步触发。语义分别在
    // main/cloud/account-flow.ts、provider.listDocs、sync-engine + uplink。
    //
    // 【activate 的失败为什么是 CloudResult】LEDGER_CORRUPT 是磁盘状态的裁决
    // （账号盒的账本读不回）：渲染层要按失败码出文案、给"证据原样保留"的出路，
    // 不能塌成抛异常。TypeError（会话对不上 / 盒停别处 / 首激活没给 mode）照旧
    // 抛 —— 那是我们自己的接线 bug，翻译成温和失败只会把 bug 藏起来。
    ipcMain.handle(IPC.cloudActivate, (_e, raw: unknown): CloudResult<CloudActivateView> => {
      const adopt = parseAdoptMode(raw)
      const session = cloudTokens.current()
      if (session === null) {
        return cloudFail('UNAUTHENTICATED', 'not signed in')
      }
      try {
        const out = activateAccount(accountFlowDeps, session.sub, adopt)
        syncRiceMirror()
        return cloudOk({ outcome: out.outcome, adopt: out.adopt, accountId: out.accountId })
      } catch (err) {
        if (err instanceof AccountFlowError) {
          return cloudFail(err.code, err.message)
        }
        throw err
      }
    })

    // 收编预览：云端这一账号有没有档案（四键全 null ⇒ 空号，"合并本地"没有
    // 可合的对象，界面据此把两个选项的说明文案分开）。未登录 = 空号 ——
    // 预览只是给界面看的，真正的闸在 activateAccount 的会话一致性断言里。
    ipcMain.handle(IPC.cloudActivatePreview, async (): Promise<CloudResult<CloudActivatePreviewView>> => {
      const res = await cloudProvider.listDocs()
      if (!res.ok) return res
      const d = res.data
      const cloudEmpty =
        d.profile === null && d.wrongbook === null && d.favorites === null && d.practice === null
      return cloudOk({ cloudEmpty })
    })

    // 账号状态（纯本地读盘，零网络）：界面用它决定登录页回跳 / 激活引导。
    // signedIn && !activated 是**正常中间态**（登录了还没收编，盒子停在客人位）。
    ipcMain.handle(IPC.cloudAccountState, (): CloudAccountState => {
      const session = cloudTokens.current()
      const accountId = session === null ? null : session.sub.toLowerCase()
      const activated =
        accountId !== null && isCanonicalUuid(accountId)
          ? isAccountActivated(accountDirOf(storageDir(), accountId))
          : false
      return {
        signedIn: session !== null,
        accountId,
        // 资料快照（2026-10-22）：登录/注册/会话探测/改名/换头像时由客户端写入，
        // 旧会话文件没有这两个键 = null（界面按「未读到名字/默认头像」处理）
        username: session?.username ?? null,
        avatarHash: session?.avatarHash ?? null,
        activated,
        boxAccountId: box.currentAccountId()
      }
    })

    // 同步触发（渲染层的同步节拍与手动按钮）：文档轮 + 上行轮**并行**（各飞
    // 各的，互不阻塞），都等完再回。force = 手动按钮跳过退避窗口。未登录时
    // 两轮各自零网络 skip（sync 轮 skipped:'signed-out'、上行轮同款）。
    ipcMain.handle(IPC.cloudSyncNow, async (_e, raw: unknown) => {
      const opts = parseSyncOpts(raw)
      const [sync, up] = await Promise.all([cloudSync.syncNow(opts), uplink.run()])
      // 上行可能拉了流水（余额变）—— 镜像进 pet.json 再回渲染层
      syncRiceMirror()
      return { sync, uplink: up }
    })

    // 取消在飞的同步轮（V1-65，2026-10-16）：只竖旗，不等待 —— 在飞的那一轮
    // 会在文档之间停下（在飞的请求由自己的 10s 超时闸收束），它的回话带
    // canceled:true。上行轮（uplink）不在取消语义里：它每次网络等待同样有
    // 10s 超时闸、有上限批数，且它出事不影响文档同步的收尾（Promise.all
    // 等两趟都回，取消只缩短 sync 那半边）。没有在飞轮时调用 = 立旗作废。
    ipcMain.handle(IPC.cloudSyncCancel, () => {
      cloudSync.cancel()
    })

    // 榜面（P10.6）：读榜 + opt-in 开关。两条都不在渲染层等出重活 ——
    // 一次调用 = 一次往返（客户端层零缓存、零轮询，"上次拉到的快照"由
    // 渲染层的 leaderboard store 保存，见 stores/leaderboard.ts）。
    // 读口的失败（未登录/超时/形状怪）全是 CloudResult 值：界面按码出文案，
    // 只有载荷形状不对抛（parseLeaderboardQuery / parseOptInFlag 先例）。
    ipcMain.handle(IPC.cloudLeaderboard, (_e, raw: unknown) =>
      cloudLeaderboardClient.getBoard(parseLeaderboardQuery(raw))
    )
    ipcMain.handle(IPC.cloudLeaderboardOptIn, (_e, raw: unknown) =>
      cloudLeaderboardClient.setOptIn({ optIn: parseOptInFlag(raw) })
    )

    // ---- 用户资料（2026-10-22 用户系统批次）----
    //
    // 改名：载荷是裸字符串（形状不对 = 我们接线传错，抛）。限流/违禁词/重名
    // 全由服务端裁决，failure 原样上行；成功后客户端的 TokenStore 快照已刷新。
    ipcMain.handle(IPC.cloudUpdateUsername, (_e, raw: unknown) => {
      if (typeof raw !== 'string') throw new Error('invalid username payload')
      return cloudClient.updateUsername(raw)
    })

    // 选头像：对话框只是「挑哪个文件」，判据在 readAvatarPick（后缀/2MB/magic
    // 一律按磁盘上的真实字节验）。用户取消 = ok(null)——不是错误。
    ipcMain.handle(IPC.cloudPickAvatar, async (event): Promise<CloudResult<AvatarPickView | null>> => {
      if (cloudTokens.get() === null) return cloudFail('UNAUTHENTICATED', 'not signed in')
      const picked = await pickFileViaDialog(event, {
        title: AVATAR_PICK.TITLE,
        filterName: AVATAR_PICK.FILTER_NAME,
        exts: ['png', 'jpg', 'jpeg']
      })
      if (picked === null) return cloudOk(null)
      return readAvatarPick(picked)
    })

    // 上传头像：载荷是渲染层裁好的 PNG 字节（≤512KB 由客户端与服务端双闸）。
    // 服务端回的 hash 会与本地 sha256 对拍（见 main/cloud/avatar.ts）。
    ipcMain.handle(IPC.cloudUploadAvatar, (_e, raw: unknown): Promise<CloudResult<AvatarUploadResponse>> =>
      cloudAvatarClient.upload(requireAvatarBytes(raw))
    )

    // 批量读头像：界面上榜的一页几十个人，一次 IPC 取齐（渲染层不必逐张往返）。
    // 拉不到的 hash **不出现在结果里** —— 渲染层落到默认大肥鱼头像（失败即值
    // 的降级方向：缺一张图不该让整个榜面报错）。并发 4，遇限流/未登录立即
    // 停住本批剩余请求：头像只是装饰，不能把账号的 120 次/分钟额度打光。
    ipcMain.handle(IPC.cloudGetAvatars, async (_e, raw: unknown): Promise<AvatarBatchView> => {
      const hashes = parseAvatarHashList(raw)
      const images: Record<string, string> = {}
      // 服务端明确说「这个 hash 不存在」的：内容寻址下不会自己回来，交回渲染层
      // 记住（不再每 60s 重试）。断网/限流/超时不是 dead —— 它们走重试窗口。
      const dead: string[] = []
      let stopped = false
      let next = 0
      const worker = async (): Promise<void> => {
        while (!stopped) {
          const index = next
          next += 1
          if (index >= hashes.length) return
          const hash = hashes[index]
          if (hash === undefined) return
          const res = await cloudAvatarClient.read(hash)
          if (res.ok) {
            images[hash] = res.data.dataUrl
          } else if (res.failure.code === 'NOT_FOUND') {
            dead.push(hash)
          } else if (
            res.failure.code === 'RATE_LIMITED' ||
            res.failure.code === 'UNAUTHENTICATED' ||
            res.failure.code === 'TOKEN_EXPIRED'
          ) {
            stopped = true
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, hashes.length) }, worker))
      return { images, dead }
    })

    // 挑战结算入队（P10.x 上行接线）：渲染层收工时把一天的挑战成绩交上来。
    // 【为什么是"入队"而不是"发请求"】结算不能指望"提交那一刻正好在线"：
    // 断网/未登录时排进 .sync/pending-ops.json，下次触达服务端再发（幂等键 =
    // submissionId + 提交体 sha256，重试逐字节复用，见 pending-ops 文件头）。
    // invoke 只回"排上了没有"——网络结果不在渲染层的等待里。
    // 【载荷不合法就抛】照 checkinSubmit 的先例：那是渲染层传错了参数（我们
    // 自己的代码 bug），翻译成温和的失败只会把 bug 藏起来。
    ipcMain.handle(IPC.cloudChallengeSettle, (_e, raw: unknown) => {
      const payload = parseSettlePayload(raw)
      if (!payload) throw new Error('invalid settle payload')
      const op: PendingSettleOp = {
        submissionId: crypto.randomUUID(),
        dateKey: payload.dateKey,
        payload,
        attempts: 0,
        lastError: null,
        queuedAt: new Date().toISOString()
      }
      const before = settleQueue.read()
      const after = addSettle(before, op)
      const queued = after !== before
      if (queued) {
        settleQueue.write(after)
        // 入队即触发一次上行（fire-and-forget）。未登录 = 零网络 skip；
        // 已在飞的一轮会把它并进去（uplink 单飞），不会叠请求。
        void uplink.run().then(
          () => syncRiceMirror(),
          () => {
            /* run 除编程错误外不抛；真抛了也不该连坐"入队已成功"这个事实 */
          }
        )
      }
      return { queued }
    })

    // 账本装载（建 genesis / 读档）→ 启动恢复（P10.5）→ 启动触发一次上行。
    // 【为什么在 whenReady 里而不是模块顶层】pet 宿主在本块之后才起，load
    // 只要先于第一笔 record 即可；放一起让"启动时序"只有一处可读。
    // 【load 失败不连坐启动】磁盘坏是极端路径：出声、照常开窗（brain 的
    // sink 会因 record 抛错退回本地算术 —— 余额显示不中断，就是没记账）。
    try {
      riceJournal.load()
    } catch (err) {
      console.warn('[miai] rice ledger load failed', err)
    }
    // 启动恢复：扫描 session.bin，把已激活账号的盒接回来（还原会话 + 装账号
    // 账本）。【needsActivation 为什么不切盒】切过去界面看到空盒 = "数据没了"
    // —— 停在客人盒，由 cloud:state 读出 activated=false、界面引导收编
    // （P10.6）。【失败不连坐启动】扫描/装载异常出声报修，照常开窗在客人盒。
    try {
      const restore = restoreOnStartup(accountFlowDeps)
      if (restore.restored) {
        console.log(`[miai] account| session restored: ${String(restore.accountId)}`)
      } else if (restore.needsActivation) {
        console.log('[miai] account| signed in, activation pending')
      }
    } catch (err) {
      console.warn('[miai] session restore failed', err)
    }
    void uplink.run().then(
      () => syncRiceMirror(),
      () => {
        /* 同上：启动触发失败不该挡住开窗 */
      }
    )

    // 开屏素材目录登记进 miai-wall 协议白名单。provider 是活读口，注册一次；
    // 顺序钉死在这里（primeWallProtocol 之前）：协议服务的根读取时刻虽然
    // 是每次请求现读，但「登记先于协议安装」这条顺序写死最省心。
    const splashDirs = splashMaterialDirs({
      isDev,
      appPath: app.getAppPath(),
      mainDir: __dirname,
      storageDir: storageDir()
    })
    addProtocolRootProvider(() => splashDirs)

    // 奖励图覆盖目录：同样以活读 provider 登记（2026-10-16）。目录可以先不
    // 存在 —— 白名单是路径字符串比较，第一次往文件夹丢图不需要任何重登记。
    addProtocolRootProvider(() => [rewardsDir()])

    // 自定义壁纸目录：以活读 provider 登记进 catalog（注册时机不受 ready
    // 判定与扫描次序影响，同 extraRootProviders 的理由）。它的 miai-wall://
    // 白名单跟着扫描快照走 —— 导入后 wallpaperImport 的强制重扫会让条目
    // 带着这个目录进快照，白名单自然覆盖（见 catalog.ts 的注释）。
    setCustomWallpaperDirProvider(() => customWallpaperDir)

    // 开屏素材池 / 导入（2026-10-06）：素材列表**现扫**（导入后勾选列表要
    // 立刻看到新素材，缓存只会添乱 —— 目录不大，不设 TTL）；导入的落点是
    // splashMaterialDirs 里那个用户目录（同一份路径算法，别各拼各的）。
    ipcMain.handle(IPC.splashMaterials, () => scanSplashMaterials(splashDirs))
    ipcMain.handle(IPC.splashImport, (event): Promise<MediaImportResult> => {
      return importMedia({
        pickFile: (req) => pickFileViaDialog(event, req),
        destDir: join(storageDir(), 'splash'),
        allowedExts: SPLASH_UPLOAD_EXTS,
        title: MEDIA_IMPORT.SPLASH_TITLE,
        filterName: MEDIA_IMPORT.SPLASH_FILTER_NAME
      })
    })

    // ⚠️ 必须早于 createWindow：渲染进程对 miai-wall:// 的认知在它出生那一刻
    // 就定型了，装晚了该窗口里所有壁纸请求都是 ERR_UNKNOWN_URL_SCHEME ——
    // 而主进程 fetch 同一 URL 完全正常（见 primeWallProtocol 的注释，实测定论）
    primeWallProtocol()

    // 主窗**先构造**（隐藏）——「开屏期间至少一个窗口存活」的堵法（上方
    // createWindow 头注释），随后才轮到开屏窗出生、最后才是加载。
    const mainWindow = createWindow()
    const mainReady = wireMainReady(mainWindow)

    splashGate = createSplashGate({
      mainWindow,
      mainReady,
      config: readConfig().splash,
      materialDirs: splashDirs,
      preloadPath: join(__dirname, '../preload/splash.js'),
      rendererDir: join(__dirname, '../renderer'),
      rendererUrl: isDev ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null,
      noSplashFlag: process.env['MIAI_NO_SPLASH'] === '1' || process.argv.includes('--no-splash'),
      force: process.env['MIAI_SPLASH_FORCE'] === '1'
    })
    splashWin = splashGate.splashWindow

    // 桌宠宿主（2026-10-06 dsh-pet 引擎）：helper 是独立进程，宠物窗的显隐
    // 节奏由它自己管（随窗口拖拽、屏内行走都在它的渲染端里）。这一句只是
    // 「建宿主 + 把主窗引用交给它」，它与开屏闸门互不等待 —— 宠物想要先出来
    // 就等 helper 自己拉起来，不需要主窗先上屏。
    startPet(mainWindow)

    loadMainWindow(mainWindow)

    app.on('activate', () => {
      // macOS 惯例；Windows 上无影响。重建的窗口**没有开屏闸门** ——
      // 开屏只在启动那一次，activate 是二次开窗，直接「就绪即显示」。
      if (BrowserWindow.getAllWindows().length === 0) {
        const w = createWindow()
        void wireMainReady(w).then(() => {
          if (!w.isDestroyed()) w.show()
        })
        startPet(w)
        loadMainWindow(w)
      }
    })
  })

  // 退出前收割还在跑的编译/运行子进程：超时杀树靠主进程定时器，而主人跑着
  // 死循环程序直接点 X 时定时器随进程消亡 —— 不收割就是孤儿进程继续烧 CPU
  app.on('before-quit', () => {
    killAllLiveChildren()
    // 原生编译观察器收摊（清表 + 停轮询）
    nativeWatcher.stop()
    // 桌宠收摊：停碎碎念定时器、杀 helper 子进程（它自己也认 DSH_PET_HOST_PID
    // 这道二层防线 —— 宿主没了它就自杀，这里是第一层）
    petHost?.stop()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
