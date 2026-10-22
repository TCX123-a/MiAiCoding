import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { webwallglHotfixPlugin } from './build/webwallgl-hotfix'
import { dshpetVendorPlugin } from './build/dshpet-vendor'

/**
 * electron-vite 5.0.0 的 isolatedEntries 实现里有两条**没有 TTY 守卫**的
 * process.stdout 调用：嵌套构建的进度行（transformReporter → writeLine →
 * clearLine）和 isolateEntriesPlugin.renderStart 的 clearLine(-1)
 * （后者无条件执行，连 logLevel 都绕不开）。stdout 是管道时这三个方法不存在
 * （CI、`npm run build | tee`、Git Bash 下的 node —— mintty 给原生程序的就是
 * 管道），构建当场 `process.stdout.clearLine is not a function` 而死，
 * 报错还指向 transform 钩子，看不出根因。
 * 在**配置加载期**补齐缺失方法的空实现：真终端里方法本来就在（零行为变化），
 * 非终端里只把「擦除进度行」降级为无操作。放本文件是因为它紧挨着引入该依赖的
 * isolatedEntries 开关，且配置先于一切构建动作执行。
 * 上游修掉后这几行可整体删除（自判缺失才打补丁，留着也无害）。
 */
for (const s of [process.stdout, process.stderr] as unknown as Record<string, unknown>[]) {
  if (typeof s.clearLine !== 'function') s.clearLine = () => {}
  if (typeof s.moveCursor !== 'function') s.moveCursor = () => {}
  if (typeof s.cursorTo !== 'function') s.cursorTo = () => {}
}

export default defineConfig({
  main: {
    /**
     * dshpetVendorPlugin（2026-10-06）：构建期把 node_modules/dsh-pet 的
     * helper 与 61MB 素材铺进 out/pet-helper/，sprite.js 与 index.html 顺路打上
     * 咪爱补丁。本体与理由见 build/dshpet-vendor.ts 头注释。
     * 它挂在 main 配置上：helper 是主进程 spawn 的子进程，与 main 同生共死。
     */
    plugins: [externalizeDepsPlugin(), dshpetVendorPlugin()],
    build: {
      rollupOptions: {
        /**
         * 双入口（2026-10-06，桌宠 helper 短路分支的配套）：
         * src/main/index.ts 只剩「检测 --dsh-pet-helper → require helper 的
         * main.js，否则 require('./app')」两行逻辑，本体全在 app.ts。
         *
         * 【为什么 app 必须也是显式入口】Rollup **不会**跟进运行期 `require('./app')`
         * ——它只做静态分析（import / 字面量 dynamic import）。单入口构建「成功」的
         * 样子是 out/main/index.js 只有 385 字节的启动器 + require 指向一个
         * **根本不存在**的 out/main/app.js：构建日志全绿、应用启动当场
         * "Cannot find module './app'"。这条静默坏法是构建产物级的，单测与
         * typecheck 都照不到，所以入口配置必须和启动器成对改。
         */
        input: {
          index: resolve('src/main/index.ts'),
          app: resolve('src/main/app.ts')
        }
      }
    }
  },
  preload: {
    /**
     * 三入口（2026-10-05 开屏 / 2026-10-06 桌宠）：`index` 是主窗的常规 preload，
     * `splash` 是开屏页的极小 preload（sandbox:true 下只能单文件，
     * 且开屏页只需要 report/getConfig/onFade/onHold 四件事），
     * `pet` 是桌宠透明窗的极小 preload（同样 sandbox:true 单文件，
     * 六件事：init/act/chat/hit/onCmd/onState）。
     * 不拆的话开屏页与宠物窗就得吃下整个 index preload 的全部面 —— 权限最小化
     * 对这两个窗口（一个全屏放视频、一个铺满工作区还永远置顶）尤其重要。
     * 产物：out/preload/index.js + out/preload/splash.js + out/preload/pet.js。
     *
     * 【为什么必须 isolatedEntries（2026-10-05 首轮探针全臂 33 红的根因）】
     * 双入口共享 src/shared/ipc-channels ⇒ 默认构建抽公共 chunk，产物里
     * splash.js 第一行就 `require("./chunks/ipc-channels-XXX.js")`。而开屏窗是
     * sandbox:true（main/splash/index.ts 的窗构造）：沙箱 preload 的 require
     * 只认 electron/少数内建，**相对路径当场抛** ⇒ 整个 preload 静默不注入
     * ⇒ 页面脚本第一行 api.onFade(...) 就死（桥 undefined）⇒ 黑屏零事件、
     * 无覆盖层，主进程一无所知（页面 report() 的 try/catch 把桥缺失也吞了），
     * 只能等 MEDIA_DEADLINE 6s 走 reason=no-frame。症状极具误导性：
     * 主窗一切正常（sandbox:false，同款 chunk require 无碍），只有开屏死。
     * isolatedEntries 让每个入口各自成一支自包含单文件（无 code splitting）；
     * 摘掉手动 externalizeDepsPlugin 是配套：文档要求 isolatedEntries 时
     * build.externalizeDeps=false，且手动插件在场会压制该选项
     * （electron-vite 5.0.0 的 hasExternalizeDepsPlugin 短路逻辑）。
     * 探针 preconditions() 已加产物级断言（splash.js 无相对 require）兜底：
     * 配置在≠产物对，这条复发的样子和历史坑一样安静。
     */
    build: {
      isolatedEntries: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          splash: resolve('src/preload/splash.ts'),
          pet: resolve('src/preload/pet.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), webwallglHotfixPlugin()],
    /**
     * webwallgl 的 bundle 里内嵌了 Mediabunny（MPL-2.0）。MPL 要求分发时不得
     * 移除许可证通告；压缩器默认可能把 `/*! ... *\/` 这类注释挪走或丢掉。
     * 这里显式要求 legal comments 原样内联，保证构建产物里的版权/许可横幅
     * 与依赖声明一致。npm 发行版本身没带横幅（见 THIRD-PARTY-NOTICES.md 2.3），
     * 所以这条是防御性的：将来上游补上横幅时不会被我们构建掉。
     */
    esbuild: {
      legalComments: 'inline'
    },
    /**
     * webwallgl 排除出依赖预打包：预打包产物是 esbuild 另起一份从
     * node_modules 烤的，我们的补丁插件**看不到它** —— 不排除的话 dev 里
     * 三个补丁（文字热更 / 音频闸门 / 帧率参照）静默失效（打包产物反而是好的），
     * 是典型的「只有 dev 坏」假象。
     * 排除后 dev 直接从模块图加载源码文件，transform 管线对 dev 与打包一致生效。
     * 补丁本体与升级核对流程见 build/webwallgl-hotfix.ts。
     */
    optimizeDeps: {
      exclude: ['webwallgl']
    },
    /**
     * 开发服务器明确绑到 IPv4 回环，别让它去解析 localhost。
     *
     * Vite 的 server.host 不填时默认是 'localhost'，Windows 上这个名字
     * 会优先解析到 IPv6 的 ::1 —— 于是 Vite 只在 [::1]:5173 上监听。
     * 而 electron-vite 又是拿这个 host 拼窗口要连的地址
     * （dist/chunks 里那句 `${protocol}//${resolveHostname(conf.host)}:${port}`），
     * 两边一旦在 v4/v6 上错开，现象是：dev 终端一切正常、窗口白屏或
     * ERR_CONNECTION_REFUSED，且**看不到任何报错线索**。
     *
     * 填死 127.0.0.1 后，绑定地址和连接地址都是同一个字面量 IP，
     * 中间不再经过域名解析，这类错位从根上没有了。
     * 只作用于 npm run dev，打包产物与此无关。
     */
    server: {
      host: '127.0.0.1'
    }
  }
})
