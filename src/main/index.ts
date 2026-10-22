import { dirname, join } from 'path'

/**
 * 主进程入口 · 两分支短路（2026-10-06，为 dsh-pet helper 子进程而拆）
 *
 * 【为什么入口要这么薄】桌宠引擎（dsh-pet）的 helper 是一整个 Electron 应用，
 * 官方姿势是「再 spawn 一个 electron 可执行文件跑它的 main.js」。开发模式下
 * process.execPath 就是 electron 本体，`electron <helperPath>` 直接成立；
 * 但**打包后**我们自己的 exe 不再认「app 目录」参数 —— 唯一能把同一个 exe
 * 变成「只跑 helper」的办法，就是在入口最顶上按 argv 短路：
 *
 *   本进程 argv 带 --dsh-pet-helper → require 桌宠 helper 的 main.js，之后的
 *   一切（单实例锁、开屏、IPC、窗口…）全部不执行。这个进程从出生起就只是
 *   一只宠物的宿主，跟咪爱本体没有任何共享状态（宿主通信走 stdout 协议桥）。
 *
 *  否则 → require('./app')，咪爱编程本体照常启动。
 *
 * 【为什么 require 而不是 import】两个分支必须是**运行期**语义：静态 import
 * 会被打包器提到顶部无条件执行 —— 那样 helper 子进程会先跑一遍咪爱本体的
 * 模块顶层代码（单实例锁！），字面意义上「另一个自己」当场把宠物进程顶掉。
 * 这个文件因此必须保持第一行可执行代码就是那个 if。
 */

const HELPER_MAIN_ENV = 'MIAI_PET_HELPER_MAIN'

if (process.argv.includes('--dsh-pet-helper')) {
  // 打包姿势：helper 的 main.js 躺在 out/pet-helper/（构建期由 dshpet-vendor
  // 插件铺进去）。主进程 spawn 时会把绝对路径塞进环境变量（它的 __dirname
  // 在打包后不是我们能稳定猜出来的位置）；环境变量缺席时退回相对入口的推导，
  // 让「有人手改启动参数」这种场景也尽量能活。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const helperMain = (process.env[HELPER_MAIN_ENV] as string | undefined) || join(__dirname, '../pet-helper/main.js')
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { app } = require('electron')
  /* eslint-enable @typescript-eslint/no-var-requires */
  // 【必须改 getAppPath，否则宠物窗白屏】helper 的 main.js:488 是
  // `win.loadFile('index.html')` —— loadFile 会把相对路径按 **app.getAppPath()**
  // 解析，而这两种启动姿势下 app 根都是咪爱本体（打包：resources/app；
  // `electron .`：仓库根），不是 pet-helper 目录。不改的话它去找
  // resources/app/index.html：窗口照开、内容空白、没有任何报错指向根因。
  // helper 全程只有 loadFile 这一处用 getAppPath（预加载器用的是 __dirname），
  // 把读取口指到 helper 自己所在的目录，正好还原官方 standalone 的语义。
  app.getAppPath = () => dirname(helperMain)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require(helperMain)
} else {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./app')
}
