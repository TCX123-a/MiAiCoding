# P1 原型现场笔记（2026-10-04）

> 本文件记录 P1 原型排障结论与证据台账。跑通四特性后连同性能数据整理成 P1 报告交给主人。
> 纪律：不碰主工程 src/；Steam 库只读（实验副本一律在 prototype/app/cache/ 下）。

## 一、黑屏悬案（已闭环）

**根因 = 原型自己的槽位/过场 z 序逻辑，与引擎无关**（相机 −Z、audiophile 场景、材质/反射全部无辜）。

- `show()` 严格交替槽位（`idx = 1 - activeSlot`），两个槽 CSS 都是 `z-index:2`；同层时 DOM 靠后的 slotB 恒盖住 slotA。
- 旧 `retire()` 只清 `.wp-poster` 不清引擎画布 → 销毁后的画布幽灵留在槽里（GL 上下文已 lost，画面冻结）。
- `cut` 路径从不为新旧槽定 z 序 → **凡换到 A 槽的图整帧被 B 槽残留物盖死**。
- `transitions.mjs:142-146` 的动画路径本有显式 `outgoing z=1 / node z=2`，cut 路径漏了。

**修复**（renderer/app.mjs，均已应用 + node --check 通过）：
- `retire()`：`slot.innerHTML=''` 连画布一起移除；退役槽 `zIndex='1'`（压到活动槽之下）；清 transform/opacity/clipPath/--wp-switch-ms。
- `doShow` cut/降级两分支：先 `retire(oldIdx)` 再收回 `slot.style.zIndex=''`（回到 CSS 2）。
- no-src 与 mount-fail 降级路径同样先退役旧槽。

**判别证据**：perf-log 十条 r:switch 重建槽位账本（渲染全在 B：#3/#5/#9；黑全在 A：#2/#8/#10）；toggle 可见性分别截图 A 单独=渲染、B 单独=均匀灰 166（=白×0.65 scrim）；elementFromPoint 三处全部 `CANVAS parent=slotB`。
**回归**：cam-b→B 渲染 ✓、audiophile→A 渲染 ✓（A 槽从「必黑」变正常）、boot 路径 ✓。

## 二、音频响应链路（源码确证 + 实测）

链路：系统声 → loopback 采集（main.mjs setDisplayMediaRequestHandler `{audio:'loopback'}`）→ audio.mjs snapshot（左右 64 段 0..1）→ `rt.audioBridge` → hostAudio.pump → 引擎音频模拟 → shader。

**引擎事实（webwallgl.mjs，行号为定位点）**：
- `applyAudio(src)`(:52857)：`rt.audioDisabled = src===null`；`rt.audioBridge = () => src.snapshot()`。
- `audioSim.enabled`(:47285) **在挂载时捕获一次**；帧循环(:51289) `if (audioSim.enabled) { hostAudio.pump() … }`。
- `setAudio(src)`(:53083) 事后只翻 `rt.audioDisabled=false`，**不会更新已捕获的 audioSim.enabled**。
- **推论（P3 必读）**：会话中途「音频关→开」对已挂实例无效（mount 时 audio:null ⇒ audioSim.enabled=false ⇒ 帧循环永不 pump）。UI 上勾选「音频响应」必须**强制重挂**当前壁纸（show 挂载选项带 `audio: audio.source`），或上游修 setAudio。当前 isntance 若 mount 时音频已开，则中途 关→开 可原地恢复（snapshot 对象不变、enabled 已 true）。

**观测面（P1 踩坑）**：
- ✅ 正确：`window.__audioStats().host.*` = `{active, level, silent, bass, gain}`（引擎注册的全局，读我们的 bridge 通道）。
- ❌ 顶层 level/silent/bass 读 driverRef/sim 旧表；diag "audio: simulated stream" 同属过时——都别信。

**实证（2026-10-04 下午）**：
| 状态 | host.* | 截图 | 像素（1899×1146, scrim 0.35） |
|---|---|---|---|
| 静音基线 | silent:true, level:0 | r5-07 | min=4 max=35 **mean=10.4** |
| 放音中（440+880Hz 正弦，loopback） | **silent:false, level:0.093** | r5-10/11 | max=68 **mean=13.7/13.9**（bars 立起+整片变亮） |
| 放音结束回落 | silent:true, level:0（gain 11.86 自动增益爬升） | r5-12 | max=27 **mean=10.4**（bars 塌回） |

肉眼：静音帧无 bar、画面暗；放音帧两根亮绿竖条清晰、整体变亮 —— audiophile shader `position.y *= audio` + `color *= min(1, audio*0.8+0.2)`。

**测试音手段**（可复用）：node 写规范 WAV（`<workspace>/_blip.wav`，RIFF 44 头 + 440/880Hz 3s），PowerShell `(New-Object Media.SoundPlayer "<workspace>/_blip.wav").PlaySync()` 循环 7 次。**注意**：PowerShell MemoryStream 直接喂 SoundPlayer 会报「波形头已损坏」（_blip.ps1 是那条失败路线，勿用）；必须落盘文件再播。PS 内联命令必须 bash 单引号外包。

## 三、启动与驱动

```
# 起动（后台）：
unset ELECTRON_RUN_AS_NODE; MSYS_NO_PATHCONV=1 PROTO_DEBUG=1 \
  <repo>/node_modules/electron/dist/electron.exe \
  <repo>/prototype/app/main.mjs --user-data-dir=<repo>/prototype/.userdata
# CDP（cwd=prototype/app）：node _cdp.mjs eval "<expr>" | node _cdp.mjs shot <png> | node _cdp.mjs close
# 收尾一律 Browser.close 并验端口，绝不 taskkill。
```
- 台账：`prototype/app/perf-log.jsonl`（kind: scan/winstate/loaded/renderer/r:switch/r:audio/r:pause-change/tick+metrics）。
- 像素统计：`node <workspace>/_pngstat.mjs <png>`（纯 node，自校验过；只支持 8bit 非隔行 RGB/RGBA）。
- 实验副本（cache 根下，只读副本可改）：`exp-ctl/techno`（原样）、`exp-cam*/techno`（camera 改 audiophile 值）。showRaw 路径必须指向**含松散入口 json 的场景目录本身**（不是 cache 根）。
- 调试面：`window.__proto`（show/showRaw/next/set/audioOn/pauseInfo/audioInfo/stats…）；`window.__PROTO_HOOKS=true` 后**重载**可开引擎 debugHooks（注意重载会清掉它，每次重载后要重设）。

## 四、待办（P1 剩余）—— 全部完成（2026-10-04）

1. ~~音频响应实证~~ ✅（§二表）
2. ~~鼠标透视~~ ✅ CDP 鼠标移动 → 断言三件套全过：body `data-wp-parallax=on`、活动槽内联 `--wp-parallax-x/y` 非零（例 targetX=−5.47 → translate≈−16.4px）、`.wp-parallax--moving` 出现/回落；截图 r6-01..05（中心/左/右/幅度10 越界左右两臂）。
3. ~~渐变切换~~ ✅ 7 种矩阵 cut/fade(ms2880)/push(1120)/wipe(1120)/iris(1280)/zoom(1440)/bars(1280) + 换向（A/B 两槽）+ 过场中帧截图 r7-02..07 + stress 连切 6 发不叠层（r7-09）；mountMs/dir 全在 `_perf-log-run1.jsonl` 的 tr-* 记录里。arm C（出货 CSP）下 cut/fade 复验过。
4. ~~调节面板~~ ✅ dim60/blur4 截图 r6-06/07；E5 battery：hit-test 栈正确（UI 在壁纸之上）、drawer scrollTop=120、CDP 真实点击开关抽屉（className `panel-open` ↔ `panel-open drawer-open`）；r8-03/04 UI 叠壁纸全屏图。
5. ~~性能档~~ ✅ 五档全部可从归档日志复算（§六表；`node <workspace>/_perf-agg.mjs <log> [tMin] [tMax]`）。
6. ~~P0 收尾~~ ✅ E4 三臂 / E5 / E6 全绿（§六）。
7. ~~汇总 P1 报告~~ ✅ 已发主人（性能五档 + 截图 + E4/E5/E6 结论），待主人裁定是否进 P3。

## 五、其它现场记录

- 本机 WE 当前壁纸 = `3284636810/佐助-壁纸.mp4`（video 型，非场景 pkg）——素材认知已向主人如实报告；场景线用 defaultprojects 真实松散场景 + audiophile。
- scrim 恒 0.35：所有截图像素 = 原图×0.65，纯黑（0）= 被不透明黑盖死；max 上限 166。
- 窗口 1899×1146 物理像素（1266×764 CSS × 1.5 DPR）。
- 前台 sleep 被禁：等待用 `node -e "setTimeout(()=>process.exit(0),Nms)"`。

## 六、E4 三臂 / E5 / E6 收官（2026-10-04）

### E4 CSP 三臂（判据与实测）
| 臂 | PROTO_CSP | 引擎脚本探针 | 页面原生 new Function 自检 | 判定 |
|---|---|---|---|---|
| A | （空=无 CSP） | probe=2（razer#0/#1） | ok | 基线 |
| B | noeval（种坏） | **probe=0** | **抛 Error**（message=违规文本） | 红成立 |
| C | 1（出货 CSP 逐字） | probe=2（与 A 逐项同） | ok | 绿 |

- 断言①协议：206（bytes 0-99/5421、len=100、ACAO `*`、accept-ranges bytes）、416（bytes \*/5421 + ACAO）、OPTIONS 204（ACAO `*`、allow-headers: range）——全绿；proto-log byStatus {200:44, 204:1, 206:6, 404:2, 416:1}（404 两条 = 场景相对查找 genericimage2.frag / common_blending.h，三臂一致且原始目录本就没有，非故障）。
- ②视频开放式 Range 命中 5 次（bytes=0- / 16777216- / 25165824- / 33554432- / 41943040-，mediabunny/WebCodecs 逐帧路径）；③场景经协议挂载成立（13 资产全 200）；④B 红机理：引擎 :27268 catch 在常量脚本路径不传 onError ⇒ EvalError 全静默吞（无 diag、无 console）；⑤ worker-src blob: 实建 Worker=worker-alive（CDP 发起，支持性证据）。
- **关键事实**：CDP Runtime.evaluate 自带 DevTools 豁免、不受页面 CSP 约束——测页面 CSP 必须用页面代码自测。Chromium 现版本 CSP 拦 new Function 不再另发 console/Log 违规条目（B 臂静默的另一半原因）。
- 附注：razer 场景 3 个脚本只跑到 2 个（第 3 个在引擎绘制路径懒求值覆盖差异，A/C 一致，非 CSP 引起）。
- 遗物：[E4-TEMP] 自检块（renderer/app.mjs 末尾）与 `renderer/__csp-*.html` 是 E4 判据专用，验收后删（或 P3 动工时清）。

### E5 进程层叠冒烟
UI 绘在壁纸之上（r8-04）；hit-test 栈正确、drawer 可滚（scrollTop=120）、真实 CDP 鼠标点击开关抽屉成功（`panel-open` ↔ `panel-open drawer-open`）。
⚠ 教训：首轮 battery 全返回 CANVAS——eval 在读数前先执行了 `classList.remove('ui-hidden')`，整条电池是在 UI display:none 状态下量的（rect 全零）。**判据自证数据别在读数前动状态**。

### E6 上游基线（实跑口径）
- `npm run verify:all` **不存在**（全仓 grep 仅 docs/23 提及；上游报文口径「2257 ✓」仓内无此脚本可复现）⇒ 实跑仓内真实等价套件：
- `npm run typecheck` ✓；`npm test` ✓ **84 files / 2074 passed + 1 todo**（24.4s）；`npm run build` ✓（含 build:content）。
- 六个 check:* 全绿（2026-10-04 补跑）：validate:content ✓ / check:samples ✓（全部课文样例真编译）/ check:questions ✓ / check:answers ✓（code 452 + codefill 263 真跑通过）/ check:bank ✓（2577 道凭验证戳免跑）/ check:packed ✓（内容包与源码一致、已打进产物）。
- 命令原文 + 输出全文：`<workspace>/_e6-verify-all.log`。

### 性能五档（run2 窗口复算；`node <workspace>/_perf-agg.mjs _perf-log-run2.jsonl <tMin> <tMax>`）
| 档 | 窗口(t) | ticks | fps | CPU 合计(均) | 内存合计(均) | 备注 |
|---|---|---|---|---|---|---|
| 正常（视频） | 15744-64449 | 49 | 29.3 | 0.52% | 769MB | perf2-setup 后稳态 |
| 最小化 | 64449-100299 | 35 | 0 | 0.00% | 646MB | winstate minimize |
| 被遮挡（hidden） | 100319-453073 | 352 | 0 | 0.00% | 640MB | restore 后仍被盖住：Electron 报 visible=false |
| 恢复后（视频） | 453073-540844 | 88 | 29.2 | 0.84% | 664MB | 遮挡解除后 auto-resume |
| 轮播（fade 换张） | 540844-572589 | 32 | 24.8 | 1.03% | 583MB | GPU 峰 2.1% / Tab 峰 0.8%；mountMs 51.9 |
| 场景（techno __raw） | 572589-604997 | 32 | 30.0 | 0.84% | 554MB | mountMs 393.4 |

- run1 长时参照：normal 全段 1797s = 0.48%/601MB/29.9fps；blur（真失焦）0.54%/823MB。
- 三臂 normal 段：CPU 0.93~0.99%、29.5~30fps——出货 CSP 不改变性能行为。
- **遮挡发现**：窗口被其它窗口完全盖住时 Electron `isVisible()=false` → 暂停（0% CPU，rAF 冻结）；CDP 探针在遮挡期间会把「rAF 冻住」误判成功能坏了——驱动测试前先 bringToFront。

### 归档清单（<workspace>/）
- perf：`_perf-log-run1.jsonl`、`_perf-log-run2.jsonl`、`_perf-log-arm{A,B,C}.jsonl`
- proto：`_proto-log-run2.jsonl`、`_proto-log-arm{A,B,C}.jsonl`
- tap：`_e4-arm{A,B,C}-tap.json`、`_e4-armB-reload-tap.json`
- 截图：r5（音频）r6（视差+面板）r7（过场矩阵）r8（E4 三臂 + UI）；**r8-05/06 含库抽屉成人标题，不可外发**；r8-07/08 干净可用
- E6 全文：`_e6-verify-all.log`
