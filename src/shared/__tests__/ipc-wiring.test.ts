import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { IPC } from '../ipc-channels'
import { maskComments } from './mask-comments'

/**
 * IPC 接线闸门：preload 调的通道，主进程必须真的注册了。
 *
 * 【为什么值得单独钉一条】
 * 通道名对不上是**静默失败**：渲染层 invoke 一个主进程没注册的名字，
 * Electron 抛 `No handler registered for 'runner:run'`。
 * 而在运行器这边，这个异常会被 store 的 catch 兜住，最后显示给用户的是
 * 「哎呀，这次没能跑起来喵～再点一次试试？」——**和网络问题、代码超长
 * 用的是同一句话**。于是无论怎么重现、怎么debug，线索都指向"运行器坏了"，
 * 而真正的原因是一个字母之差。
 *
 * 这类 bug 靠手工点界面几乎测不出来（要点到那个具体功能才发现），
 * 靠类型也拦不住（通道名是字符串），所以用一条静态比对钉住。
 *
 * 【它是怎么比对】
 * 不跑 Electron，直接读源码文本，抓出两边的 `IPC.xxx` 引用做集合比对。
 * 正则匹配源码确实脆——所以下面每一条断言失败时都会打印具体是哪个通道，
 * 改了写法导致抓不到时，也会因为「抓到的数量是 0」而报出来，不会假绿。
 */
const root = join(__dirname, '..', '..')

/**
 * ⚠️ **读进来第一件事是剥注释**，否则最后那条「不许写裸通道字符串」会被
 * 注释里的说明文字绊倒：在注释里用反引号或引号提一下通道名
 * （比如写「``ai:cancel`` 不带参数」），会被当成代码违规报出来，
 * 而且报错信息说「你把通道名写死了」——**它指的方向是错的**。
 * 剥注释的代价只是一个共享的纯函数，收益是这条闸门从此不会冤枉人。
 */
const preloadSrc = maskComments(readFileSync(join(root, 'preload', 'index.ts'), 'utf8'))
// 开屏页有自己的一张小 preload（electron.vite.config.ts 双入口，sandbox:true）——
// 它也在调通道，不扫它的话 splashEvent/splashGet/splashFade/splashHold
// 会以「常量表里没人处理」的形态假红，报错方向完全指错。
const preloadSplashSrc = maskComments(readFileSync(join(root, 'preload', 'splash.ts'), 'utf8'))
// 桌宠窗的第三张小 preload（同款 sandbox 单文件理由）。它引用的
// petInit/petAct/petChat/petHit 不扫进来的话会在 orphan 那条上报「没人处理」，
// 而实际的处理在 main/index.ts 的薄转发里 —— 修法不是删通道。
const preloadPetSrc = maskComments(readFileSync(join(root, 'preload', 'pet.ts'), 'utf8'))
// 2026-10-06 桌宠换 dsh-pet 引擎时入口拆成两截：main/index.ts 变成三行的
// 「helper 子进程 or 本体」短路启动器（不再注册任何 IPC），全部注册搬进
// main/app.ts。扫描面改名跟随重构 —— 断言语义一字未动；两个文件都扫，
// 将来谁在启动器里加注册也不会漏。
const mainSrc = [
  maskComments(readFileSync(join(root, 'main', 'index.ts'), 'utf8')),
  maskComments(readFileSync(join(root, 'main', 'app.ts'), 'utf8'))
].join('\n')
// 开屏的时间线/渐隐/收场提示都是**主进程主动推**的，绑定点在 main/splash/index.ts。
const mainSplashSrc = maskComments(readFileSync(join(root, 'main', 'splash', 'index.ts'), 'utf8'))
// 桌宠的状态广播/行为指令同理：petState/petCmd 是**推**出去的，发点在控制器里
// （main/index.ts 只注册 handle/on 那五条，一条 send 都没有）。
const mainPetSrc = maskComments(readFileSync(join(root, 'main', 'pet', 'index.ts'), 'utf8'))
// 桌宠换 dsh-pet 引擎（2026-10-06）后主进程侧多出一个发点文件：
// main/dshpet/host.ts（appNav 推送）。不扫它的话，preload 的 onAppNav 会在
// 「主进程没人注册」那条上假红 —— 报得对，但修法是在这里补扫描面。
const mainDshpetSrc = maskComments(readFileSync(join(root, 'main', 'dshpet', 'host.ts'), 'utf8'))
/** 允许出现 `IPC.xxx` 引用的全部接线文件（裸字符串检查的扫描面） */
const wiringSources = [preloadSrc, preloadSplashSrc, preloadPetSrc, mainSrc, mainSplashSrc, mainPetSrc, mainDshpetSrc]

/** 抓某个文件里出现过的全部 `IPC.xxx` 引用 */
function channelsIn(src: string, pattern: RegExp): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(src)) !== null) out.push(m[1])
  return out
}

const declared = Object.keys(IPC)
const preloadUsed = [
  ...channelsIn(preloadSrc, /ipcRenderer\.(?:invoke|on|send)\(\s*IPC\.(\w+)/g),
  ...channelsIn(preloadSplashSrc, /ipcRenderer\.(?:invoke|on|send)\(\s*IPC\.(\w+)/g),
  ...channelsIn(preloadPetSrc, /ipcRenderer\.(?:invoke|on|send)\(\s*IPC\.(\w+)/g)
]
// `handle` 之外多了 `on`：开屏页的 report 是单向下行（send→on），没有回执需求。
const mainHandled = channelsIn(mainSrc, /ipcMain\.(?:handle|on)\(\s*IPC\.(\w+)/g)
// 主进程第二条注册方式：main→renderer 推送。第一条推送是 wallpaper:state（docs/23 §2.4）。
// ⚠️ 推送的注册点**不在 send 调用上**：`win.webContents.send(channel, ...)` 住在
// window-state.ts 里，channel 是参数，主源码里根本没有 `send(IPC.xxx)` 这个文本。
// 真正的「通道↔常量绑定」发生在 index.ts 的 attachWindowStatePush(win, IPC.xxx) 调用上，
// 所以这里抓的是调用点。抓不到的话下面两条断言会对着 preload 里的
// onWallpaperState 报「没注册」—— 报得对，但修法不是删订阅。
const mainPushed = [
  ...channelsIn(mainSrc, /attachWindowStatePush\(\s*[^,)]+,\s*IPC\.(\w+)/g),
  // 开屏推送是第二个「通道名住在调用点、不在 send 的实参上」的形状：
  //   · splashHold / splashFade 走 `sendToSplash(IPC.xxx)`，真正的
  //     `win.webContents.send(channel)` 在 sendToSplash 内部，channel 是形参；
  //   · splashStats 是直接 `wc.send(IPC.splashStats, payload)`（此处 `wc` 是
  //     webContents 的局部别名，所以正则只认 `.send(` 后缀，不写死 `webContents`）。
  // 两个形状都抓不到的表现：preload 的 onSplashStats/onFade/onHold 会被
  // 报「没注册」——报得对，但修法不是删订阅，是把这里的正则补上。
  ...channelsIn(mainSplashSrc, /sendToSplash\(\s*IPC\.(\w+)/g),
  ...channelsIn(mainSplashSrc, /\.send\(\s*IPC\.(\w+)/g),
  // 桌宠的 petState/petCmd 是同一种「住在调用点」的形状：
  // `w.webContents.send(IPC.petState, snap)` / `win.webContents.send(IPC.petCmd, cmd)`
  // （`w`/`win` 都是局部别名，所以只认 `.send(` 后缀）。不抓的话这两个通道
  // 会在 orphan 那条上被误报成「常量声明了却没人处理」。
  ...channelsIn(mainPetSrc, /\.send\(\s*IPC\.(\w+)/g),
  // app.ts 自己也有直推：config:external（桌宠菜单「关闭大肥鱼」触发，2026-10-06）。
  // 同一形状（`w.webContents.send(IPC.xxx, pub)`），同一条正则口径。
  ...channelsIn(mainSrc, /\.send\(\s*IPC\.(\w+)/g),
  // 侧栏对话的增量与收尾（P1，docs/27 §8）：又是「住在调用点」的形状 ——
  // `sendToRenderer(wc, IPC.aiChatDelta, payload)`，真正的 `.send(channel)` 在
  // 那个 helper 里（channel 是形参）。helper 存在的理由是「窗口可能在流式途中
  // 被销毁」：isDestroyed 判空只该写一处，不该在四个发点各抄一遍。
  // 不抓这条的话 aiChatDelta/aiChatDone 会在 orphan 那条上被误报成
  // 「常量声明了却没人处理」—— 修法不是删通道，也不是放弃 helper。
  ...channelsIn(mainSrc, /sendToRenderer\(\s*[^,)]+,\s*IPC\.(\w+)/g),
  // dsh-pet 宿主的 appNav 推送（`mw.webContents.send(IPC.appNav, payload)`）。
  ...channelsIn(mainDshpetSrc, /\.send\(\s*IPC\.(\w+)/g)
]
const mainRegistered = [...mainHandled, ...mainPushed]

describe('IPC 接线', () => {
  it('正则确实抓到了东西——抓不到的话下面全是假绿', () => {
    // 这条是自检。哪天 preload 改成 `const { IPC } = ...` 解构再调用，
    // 或者换了个变量名，正则就抓不到了，上面两个数组会变成空的，
    // 后面所有断言都会「通过」——而那正是最危险的情况。
    expect(declared.length, 'IPC 常量表读不到，说明它改名了').toBeGreaterThan(0)
    expect(preloadUsed.length, 'preload 里一个 IPC.xxx 都没抓到，正则已失效').toBeGreaterThan(0)
    expect(
      mainRegistered.length,
      'main 里一个 IPC.xxx 注册都没抓到（handle/send），正则已失效'
    ).toBeGreaterThan(0)
    // 推送正则是后加的：抓不到的话，「注册了」只剩 handle 半边，
    // wallpaper:state 会被误报成「常量声明了却没人处理」。
    expect(
      mainPushed.length,
      'main 里一个 attachWindowStatePush(win, IPC.xxx) 都没抓到，推送正则已失效'
    ).toBeGreaterThan(0)
    // 开屏这对文件是 2026-10-05 加进来的第二个扫描面：任何一条正则失效，
    // 对应文件会以「0 个引用」静默退出比对——下面四条把它们各自钉住。
    expect(
      channelsIn(preloadSplashSrc, /ipcRenderer\.(?:invoke|on|send)\(\s*IPC\.(\w+)/g).length,
      'preload/splash.ts 里一个 IPC.xxx 都没抓到，开屏 preload 正则已失效'
    ).toBeGreaterThan(0)
    expect(
      channelsIn(mainSplashSrc, /sendToSplash\(\s*IPC\.(\w+)/g).length,
      'main/splash/index.ts 里一个 sendToSplash(IPC.xxx) 都没抓到，开屏推送正则已失效'
    ).toBeGreaterThan(0)
    expect(
      channelsIn(mainSplashSrc, /\.send\(\s*IPC\.(\w+)/g).length,
      'main/splash/index.ts 里一个 .send(IPC.xxx) 都没抓到（splashStats 直推），正则已失效'
    ).toBeGreaterThan(0)
    // 桌宠这对（preload/pet.ts + main/pet/index.ts）是 2026-10-06 加的第三个扫描面：
    // 任何一条正则失效，对应文件会以「0 个引用」静默退出比对 —— 各自钉住。
    expect(
      channelsIn(preloadPetSrc, /ipcRenderer\.(?:invoke|on|send)\(\s*IPC\.(\w+)/g).length,
      'preload/pet.ts 里一个 IPC.xxx 都没抓到，桌宠 preload 正则已失效'
    ).toBeGreaterThan(0)
    expect(
      channelsIn(mainPetSrc, /\.send\(\s*IPC\.(\w+)/g).length,
      'main/pet/index.ts 里一个 .send(IPC.xxx) 都没抓到（状态广播/指令推送），正则已失效'
    ).toBeGreaterThan(0)
    expect(
      channelsIn(mainSrc, /\.send\(\s*IPC\.(\w+)/g).length,
      'main（index.ts+app.ts）里一个 .send(IPC.xxx) 都没抓到（config:external 直推），正则已失效'
    ).toBeGreaterThan(0)
    expect(
      channelsIn(mainDshpetSrc, /\.send\(\s*IPC\.(\w+)/g).length,
      'main/dshpet/host.ts 里一个 .send(IPC.xxx) 都没抓到（appNav 推送），正则已失效'
    ).toBeGreaterThan(0)
    // 侧栏对话的推送（P1）：helper 里的 `.send(channel)` 抓不到，只能抓调用点。
    // 这条自检保证调用点正则没写歪 —— 否则 aiChatDelta/aiChatDone 会静默退出比对。
    expect(
      channelsIn(mainSrc, /sendToRenderer\(\s*[^,)]+,\s*IPC\.(\w+)/g).length,
      'main（app.ts）里一个 sendToRenderer(wc, IPC.xxx, ...) 都没抓到，侧栏推送正则已失效'
    ).toBeGreaterThan(0)
  })

  it('preload 用到的每个通道，主进程都注册了', () => {
    const handled = new Set(mainRegistered)
    const missing = preloadUsed.filter((c) => !handled.has(c))
    expect(
      missing,
      `这些通道 preload 在调、主进程没注册（用户会看到「没能跑起来喵」而毫无线索）：${missing.join(', ')}`
    ).toEqual([])
  })

  it('IPC 常量表里没有「声明了却没人处理」的通道', () => {
    // 反方向：加了个通道名却忘了在主进程注册，或者删了处理器忘了删常量。
    // 留着不影响运行，但会让人以为那个功能是通的。
    const handled = new Set(mainRegistered)
    const orphan = declared.filter((c) => !handled.has(c))
    expect(orphan, `这些通道名在 IPC 里但主进程没处理：${orphan.join(', ')}`).toEqual([])
  })

  it('业务代码里不许出现裸的通道字符串', () => {
    // 通道名的唯一真源是 IPC 常量表。写裸字符串的话，改常量时改不到它，
    // 又是一个静默失灵。
    const bare = Object.values(IPC).filter((v) => {
      const quoted = new RegExp(`['"\`]${v}['"\`]`)
      // 常量表本身会写一遍，其余任何接线文件里出现都算违规
      return wiringSources.some((s) => quoted.test(s))
    })
    expect(bare, `这些通道名被当裸字符串写死了，请改用 IPC 常量：${bare.join(', ')}`).toEqual([])
  })
})
