import { defineConfig } from 'vitest/config'

// 纯逻辑单测：node 环境直接跑（不涉及 Electron 与 DOM 交互）
export default defineConfig({
  test: {
    include: [
      'src/shared/**/*.test.ts',
      'src/renderer/src/lib/**/*.test.ts',
      // store 是纯状态逻辑，不碰 DOM——把 window.miai 换成假货就能测。
      // 尤其是「运行中」这类开关，卡住的表现是按钮永久点不动，
      // 靠手工测试很难碰上，必须有机器守着。
      'src/renderer/src/stores/**/*.test.ts',
      'src/main/store/**/*.test.ts',
      'src/main/env/**/*.test.ts',
      'src/main/runner/**/*.test.ts',
      // AI 网络层：fetch 是注入的，塞个假货就能把 401/402/超时/断网/空内容
      // 每条失败分支跑一遍，一次都不用真的联网。
      // ⚠️ 漏掉这一行的话，deepseek 的测试会**静默不执行**，全绿是假的——
      // 这类「测试根本没跑」比「测试挂了」难发现得多。
      'src/main/ai/**/*.test.ts',
      // 素材导入执行体（src/main/media-import.ts，挂在 src/main 根下）：
      // 壁纸与开屏视频共用的拷贝 / 重名去重 / 体积与扩展名校验。
      // pickFile 是注入的，测试配真临时目录走真 fs，四条失败分支都能离线跑。
      // ⚠️ 老规矩：漏掉这行的话导入测试静默不执行，全绿是假的。
      'src/main/__tests__/**/*.test.ts',
      // 壁纸：protocol 的纯函数（Range 解析 / 路径围栏）与 window-state 的
      // 推送口径都能在 node 下测（protocol.ts 顶层 import electron 在 node 下
      // 拿到 undefined 但不炸——只测不碰 protocol 对象的纯函数）。
      // ⚠️ 同 ai 那条：漏掉这行的话壁纸测试静默不执行，全绿是假的。
      'src/main/wallpaper/**/*.test.ts',
      // 开屏：素材扫描的过滤/去重/排序（fs 夹具在系统临时目录现造现拆）。
      // ⚠️ 老规矩：漏掉这行的话开屏扫描测试静默不执行，全绿是假的。
      'src/main/splash/**/*.test.ts',
      // 构建期补丁的工具测试（webwallgl 文字热更，本体在 build/webwallgl-hotfix.ts）。
      // ⚠️ 老规矩：漏掉这行的话 build 下的测试静默不执行，全绿是假的。
      'build/**/*.test.ts',
      // 云账号网络层（src/main/cloud/：transport / account / base-url）：
      // fetch 是注入的，塞假货就能把超时/断网/状态码映射/零重试/凭据纪律
      // 每条分支离线跑一遍，一次都不用真的联网（同 ai 那层的先例）。
      // ⚠️ 老规矩：漏掉这行的话云层测试静默不执行，全绿是假的。
      'src/main/cloud/**/*.test.ts'
    ],
    environment: 'node',
    // 全局预算 30s（vitest 默认 5s 太贴边）。【为什么】本套件里有一批真起进程的
    // 用例（reg query / gcc 编译 / 真 fs 落盘），健康机器上单跑 0.2~2.7s，但
    // 2026-10-11 凌晨实测：机器被 26 个满核 python 孤儿进程压着时全量并发膨胀
    // 2~12 倍，5s 线上每轮随机轮换着假红（已实测：mergedPath 5007ms、nativeEnv
    // 5014ms、uplink 5341ms、challenge 5224ms……同一用例隔离单跑全绿）。
    // 这是**负载余量**不是性能契约：真死循环/真挂起照样超时会红，只是晚 25 秒。
    // 更重的用例（media-import 999 文件实测 44s）继续用各自的显式预算覆盖。
    testTimeout: 30_000
  }
})
