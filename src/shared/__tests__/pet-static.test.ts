/**
 * 宠物窗（src/renderer/public/pet.html）的静态闸门。
 *
 * 【为什么它需要静态测试】它和开屏页是同一类东西：public/ 下的**静态文件**，
 * import 不到 shared/pet.ts 的常量、也 import 不到 copy.ts —— 跨文件一致性
 * 只能靠「读源码文本 + 断言」。而它坏起来又特别安静：它是全工作区最大的一张
 * 透明置顶窗，挂掉的表现是桌面上什么都没有（用户只会以为"桌宠没开"）。
 *
 * 【四类必须钉死的东西】
 *   ① 哑视图的"哑"：台词/文案全部经 IPC 从 shared/copy.ts 送达，页面里
 *      **字符串与文本节点一个中文都不许有**（中文注释随便写 —— 剥掉注释再查）；
 *   ② 连点 rua 的阈值与 shared/pet.ts 同源：`var RUA_CLICKS = 5` 改了页面
 *      不改常量（或反过来），"连点几下会被嫌"就成了两个数字在打架；
 *   ③ 六座桥的名字：页面调 `api.{init,act,chat,hit,onCmd,onState}` ↔
 *      preload/pet.ts 暴露的 `miaiPet` 六个键 —— 对不上是
 *      `Cannot read properties of undefined`，而页面里到处是 `if (api)` 的
 *      防御，会把"桥断了"静默吞成"桌宠没反应"；
 *   ④ 精灵素材的命名与存在：文件名是从 kind + 尺寸拼出来的
 *      （`'pet/' + kind + '_' + SPR + '.png'`），拼错/改名 = 一条透明的空窗；
 *   ⑤ **命中层的开与关**：`#fish` 是 0×0 容器、`pointer-events:none` 撑起
 *      "全窗穿透"；它的 none 会被 `.spr` 子元素**继承** —— 可见层若不显式开回
 *      `auto`，整条鱼在浏览器命中测试里就不存在（摸头/双击/连点/右键全部
 *      静默失灵），而主进程的 hitRects 又照常把窗口从穿透切回可点，
 *      表现成"点了没反应"。这是 2026-10-06 抓到的真实 bug，钉死它。
 *
 * 【底线：去网络化】CSP `default-src 'none'` 是这页唯一的安全锚点，
 * 全页不许出现 http(s):// 字样（出现即红灯，让人来解释它）。
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { PET_RUA_CLICKS, PET_RUA_WINDOW_MS, PET_SIZE_DEFAULT, PET_SIZES } from '../pet'

// __dirname = src/shared/__tests__ → 上两级 = src
const root = join(__dirname, '..', '..')
const html = readFileSync(join(root, 'renderer', 'public', 'pet.html'), 'utf8')
const preloadSrc = readFileSync(join(root, 'preload', 'pet.ts'), 'utf8')

/**
 * 剥掉三种注释（HTML / JS 块 / JS 行）。**顺序有讲究**：HTML 注释先剥 ——
 * 反过来的话，一段被 `<!-- -->` 包住的 JS 行注释会把后面的 `-->` 也吃掉。
 */
function maskAllComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

describe('宠物窗 ↔ 共享常量 / preload 的静态一致性', () => {
  it('剥注释器本身先自证：字符串里的中文**必须**被它留下来（否则"无中文"是假绿）', () => {
    // 必假反例：把中文放进字符串再剥注释 —— 剥不掉才说明这个尺子量得到东西。
    const sample = 'var a = "喵" // 注释里的喵\n/* 块注释喵 */ var b = 1'
    const masked = maskAllComments(sample)
    expect(masked).toContain('喵')
    expect(masked).not.toContain('注释里的喵')
    expect(masked).not.toContain('块注释喵')
    // 真实文件：剥完还得剩大半个文件（全体被剥没了 = 尺子失效，全绿也不算数）
    expect(maskAllComments(html).length).toBeGreaterThan(html.length / 3)
  })

  it('哑视图里一个中文都不许有（台词全部走 IPC，页面自己写文案 = 第二份会漂的真源）', () => {
    const codeOnly = maskAllComments(html)
    const cjk = codeOnly.match(/[一-鿿　-〿！-～]+/g) ?? []
    expect(cjk, `宠物窗代码/文本里出现中文：${cjk.slice(0, 5).join(' / ')}`).toEqual([])
  })

  it('内容安全策略：default-src none + 只放行内联脚本/样式与本地图（去网络化的机械保障）', () => {
    expect(html).toContain(`default-src 'none'`)
    expect(html).toContain(`img-src 'self' data: file:`)
    // 小黄鸭音效（Audio 元素）走 media-src —— 缺这条的话 CSP 会静默拒播，
    // 表现是"点了没声音"而控制台之外毫无痕迹
    expect(html, '小黄鸭音效要 media-src 放行本地文件').toContain(`media-src 'self' file:`)
    expect(html).toContain(`script-src 'unsafe-inline'`)
    expect(html).toContain(`style-src 'unsafe-inline'`)
    // 全页不许出现真正的网络 URL（`http-equiv` 属性除外，它不是地址）。
    expect(html, '宠物窗出现了 http(s):// —— 桌宠必须完全离线').not.toMatch(/https?:\/\//)
  })

  it('小黄鸭音效：宠物窗那份是主界面 quack 素材的副本，两份按字节一致（改一边不动另一边就红）', () => {
    const uiDuck = join(root, 'renderer', 'src', 'assets', 'sounds', 'duck-click.wav')
    const petDuck = join(root, 'renderer', 'public', 'pet', 'duck-click.wav')
    expect(existsSync(uiDuck), '主界面素材 duck-click.wav 不见了（sfx.ts 的 quack 靠它）').toBe(true)
    expect(existsSync(petDuck), '宠物窗副本缺失 —— 点鱼将没有声音').toBe(true)
    expect(
      readFileSync(petDuck).equals(readFileSync(uiDuck)),
      '两份 duck-click.wav 字节不一致 —— "和主界面 UI 点击音效一致"就破了'
    ).toBe(true)
    // 页面确实按这个路径加载（改名/改目录就断，文件名必须是 ASCII 原样）
    expect(html).toContain(`new Audio('pet/duck-click.wav')`)
    expect(html).toContain('function playQuack()')
    // 尺子自证：拿一段绝不相同的字节比一下，必须 false（否则这条对"恒相等"免疫）
    expect(readFileSync(petDuck).equals(Buffer.from([0, 1, 2, 3]))).toBe(false)
  })

  it('连点 rua 的两个阈值与 shared/pet.ts 同源（撞了跑一下这条就知道该改哪边）', () => {
    expect(PET_RUA_CLICKS).toBe(5) // 常量本身也别偷偷动：动了要连带想一遍台词与手感
    expect(PET_RUA_WINDOW_MS).toBe(3000)
    expect(html).toContain(`var RUA_CLICKS = ${PET_RUA_CLICKS}`)
    expect(html).toContain(`var RUA_WINDOW_MS = ${PET_RUA_WINDOW_MS}`)
  })

  it('六座桥：页面调的形状 ↔ preload 暴露的名字，一一在场', () => {
    expect(html).toContain(`window.miaiPet`)
    // init 的调用源文件里折成了两行（`api\n .init()`），所以用"允许空白"的正则 ——
    // 这条钉的是"六个桥方法都被调用了"，不是"排成一行"。
    for (const name of ['init', 'act', 'chat', 'hit', 'onCmd', 'onState']) {
      expect(
        html,
        `宠物窗没在用 api.${name}( —— 机制变了就得同步改这条测试的名单`
      ).toMatch(new RegExp(`api\\s*\\.\\s*${name}\\(`))
    }
    expect(preloadSrc).toContain(`exposeInMainWorld('miaiPet'`)
    for (const key of ['init:', 'act:', 'chat:', 'hit:', 'onCmd:', 'onState:']) {
      expect(preloadSrc, `preload 暴露面里缺 ${key}`).toContain(key)
    }
  })

  it('交互回传的动作形状：rua / pat / chat / menu / pos 都在，聊天开场白从指令里取', () => {
    for (const shape of [
      `{ action: 'rua' }`,
      `{ action: 'pat' }`,
      `{ action: 'chat' }`,
      `{ action: 'menu' }`,
      `{ action: 'pos'`
    ]) {
      expect(html, `回传动作缺了 ${shape}`).toContain(shape)
    }
    // chat-open 的第一条鱼话是主进程拼的（记忆回访在它手里）——页面只认 hello 字段
    expect(html).toContain(`cmd.kind === 'chat-open'`)
    expect(html).toContain('cmd.hello')
  })

  it('主进程指令的每一种 kind 与五种整段动作都接住了', () => {
    for (const kind of ['say', 'alert', 'chat-open', 'cursor', 'anim', 'sound', 'idle']) {
      expect(html, `指令分支缺了 kind=${kind}`).toContain(`cmd.kind === '${kind}'`)
    }
    for (const anim of ['spin', 'squash', 'stretch', 'hop', 'chomp']) {
      expect(html, `整段动作缺了 ${anim}`).toContain(`'${anim}'`)
    }
  })

  it('精灵素材：命名规则在页面里，九个文件在磁盘上（改名/漏导出 = 一条空窗）', () => {
    expect(html).toContain(`'pet/' + kind + '_' + SPR + '.png'`)
    for (const size of [187, 238, 306]) {
      for (const kind of ['front', 'side', 'back']) {
        const file = join(root, 'renderer', 'public', 'pet', `${kind}_${size}.png`)
        expect(existsSync(file), `精灵素材缺失：${kind}_${size}.png`).toBe(true)
      }
    }
  })

  it('精灵真的接得住鼠标：容器 none、可见层 auto（pointer-events 继承 bug 的静态闸门）', () => {
    const ruleOf = (src: string, sel: string): string =>
      new RegExp(`\\n\\s*${sel}\\s*\\{[^}]*\\}`).exec(src)?.[0] ?? ''
    // 容器层：0×0 + none 是全窗穿透的锚点，不许动
    expect(
      ruleOf(html, '#fish'),
      '#fish 规则本身必须保持 pointer-events:none（全窗穿透靠它）'
    ).toContain('pointer-events: none')
    // 可见层：必须显式开回 auto —— 继承来的 none 会让整条鱼点不到
    const onRule = ruleOf(html, '#fish\\s*\\.spr\\.on')
    expect(onRule, '#fish .spr.on 规则要在场').not.toBe('')
    expect(
      onRule,
      '可见精灵层缺 pointer-events: auto —— 从 #fish 继承的 none 会把整条鱼变成点不到的空气'
    ).toContain('pointer-events: auto')
    // 尺子自证：同一段提取器在一段"坏样本"上必须给不出 auto（否则这条是全绿假闸）
    const bad = '\n#fish .spr.on { opacity: 1; }'
    expect(ruleOf(bad, '#fish\\s*\\.spr\\.on')).not.toContain('pointer-events: auto')
    expect(ruleOf(bad, '#fish\\s*\\.spr\\.on')).not.toBe('')
  })

  it('精灵的锚点契约：render 把 #fish 原点直接放 pos，.spr 底边中点由 CSS 自锚（双份偏移 = 整条鱼错位一格的闸门）', () => {
    const ruleOf = (src: string, sel: string): string =>
      new RegExp(`\\n\\s*${sel}\\s*\\{[^}]*\\}`).exec(src)?.[0] ?? ''
    // 契约：pos 是全文件口径的**脚底中点**（reportHits / 气泡挂头顶 / 游走边界都这么算），
    // .spr 的底边中点又被 CSS 钉在 #fish 原点上 —— render 只许把原点放 pos。
    // 再减 (sprHW/2, SPR) 就是双份偏移：整条鱼画到脚点左上 (半宽, SPR)px 处
    // （2026-10-06 G2 实测：落点 = 锚点 − (91.8, 245.2)，分毫不差）。
    // 只查 render 那一行 —— sprHW/SPR 的减法在 reportHits 里是**正确**用法
    // （命中区本就该以脚点为中心张开），全文件扫会误伤
    const renderLine = /fishEl\.style\.transform = ([^\n]*)/.exec(html)?.[1] ?? ''
    expect(renderLine, '找不到 fishEl.style.transform 赋值行（判据已漂移）').not.toBe('')
    expect(renderLine, 'render 没有把 #fish 原点直接放在 pos').toContain(
      "translate3d(' + pos.x + 'px,' + pos.y + 'px,0)"
    )
    expect(renderLine, 'render 行里又出现了 sprHW/SPR 减法 —— 双份偏移').not.toMatch(/sprHW|SPR/)
    // CSS 侧契约：底边中点 = 原点，缺一不可
    const sprRule = ruleOf(html, '#fish\\s*\\.spr')
    expect(sprRule, '#fish .spr 规则要在场').not.toBe('')
    expect(sprRule, '.spr 少 bottom:0 —— 底边就贴不住 #fish 原点').toContain('bottom: 0')
    expect(sprRule, '.spr 少 translateX(-50%) —— 横向不再以原点居中').toContain('translateX(-50%)')
    // 尺子自证：两种坏样本（render 加回偏移 / CSS 改成 top 锚）必须都被抓住
    const badRenderLine = /fishEl\.style\.transform = ([^\n]*)/.exec(
      html.replace(
        "translate3d(' + pos.x + 'px,' + pos.y + 'px,0)",
        "translate3d(' + (pos.x - sprHW[1] / 2) + 'px,' + (pos.y - SPR) + 'px,0)"
      )
    )?.[1] ?? ''
    expect(badRenderLine).not.toContain("translate3d(' + pos.x + 'px,' + pos.y + 'px,0)")
    expect(badRenderLine).toMatch(/sprHW/)
    const badCss = '\n#fish .spr { position: absolute; left: 50%; top: 0; transform: translateX(-50%); }'
    expect(ruleOf(badCss, '#fish\\s*\\.spr')).not.toContain('bottom: 0')
    expect(ruleOf(badCss, '#fish\\s*\\.spr')).not.toBe('')
  })

  it('朝向契约：side 素材面朝左，镜像条件必须是 facing > 0（applyDir 与 render 两处一处都不许反）', () => {
    // 2026-10-06 逐张开图核实：side_187/238/306.png 全部面朝左。朝左走
    // （facing=-1）用原图、朝右走（facing=1）才 scaleX(-1)。条件写反过一次，
    // 表现是两个方向都倒着走（主人原话："这个倒退步走路有点太反人类了"）。
    const mirror = "dir === 'side' && facing > 0 ? ' scaleX(-1)' : ''"
    const n = html.split(mirror).length - 1
    expect(n, `镜像条件（facing > 0）出现 ${n} 次，应为 2（applyDir + render 各一）`).toBe(2)
    expect(html, '还留着写反的旧条件（facing < 0 才镜像）—— 鱼会倒着走').not.toContain(
      "dir === 'side' && facing < 0 ? ' scaleX(-1)' : ''"
    )
    // 尺子自证：同一段检查在"写反的旧文本"上必须给出 0 次（否则是全绿假闸）
    const bad = "x + (dir === 'side' && facing < 0 ? ' scaleX(-1)' : '')"
    expect(bad.split(mirror).length - 1).toBe(0)
    expect(bad).toContain('facing < 0')
  })

  it('体型契约：默认档与 shared 同源；换挡重贴图 + 重报命中区；快照两个入口都接', () => {
    // 默认档：页面的字面量必须与 PET_SIZE_DEFAULT 一致（各写一份就会漂）
    expect(html, '页面默认体型与 PET_SIZE_DEFAULT 不同源').toContain('var SPR = ' + PET_SIZE_DEFAULT)
    // 三档的键都得在 SIZES 表里（缺一档 = applySize 静默忽略，用户点了没反应）
    for (const s of PET_SIZES) {
      expect(html, `SIZES 表缺 ${s} 档`).toContain(s + ': [')
    }
    // 换挡函数：少 applyDir = 还挂着旧尺寸的图；少 reportHits = 点到旧尺寸的空气
    expect(html, '没有运行时换挡函数 applySize').toContain('function applySize(s)')
    const fn = /function applySize\(s\) \{([\s\S]*?)\n  \}/.exec(html)?.[1] ?? ''
    expect(fn, 'applySize 抠不出来（判据漂移？）').not.toBe('')
    expect(fn, '换挡没重新贴方向图（素材名含尺寸，不换图 = 还是旧尺寸的图）').toContain('applyDir()')
    expect(fn, '换挡没重报命中区（会点到旧尺寸的空气）').toContain('reportHits(true)')
    // 快照接入：广播口 + init 首帧兜底，两处都得吃 s.size
    const hooks = html.split('SIZES[s.size]').length - 1
    expect(hooks, `SIZES[s.size] 出现 ${hooks} 次，应为 2（onState 广播 + init 首帧兜底）`).toBe(2)
    // 尺子自证：坏样本（换挡只赋值）必须被同一段提取器抓住
    const bad = 'function applySize(s) {\n    SPR = s\n  }'
    const badFn = /function applySize\(s\) \{([\s\S]*?)\n  \}/.exec(bad)?.[1] ?? ''
    expect(badFn).not.toBe('')
    expect(badFn).not.toContain('applyDir()')
    expect(badFn).not.toContain('reportHits(true)')
  })

  it('走路物理：弹簧逼近 + 一快一慢 + 侧摆 + 步频绑定位移（"平移纸片人"的回归闸）', () => {
    // 弹簧逼近：速度朝目标拉，时间常数 tau
    expect(html).toContain('function approach(dt, tx, ty, tau)')
    // 加速/减速两条时间常数都在，且减速的更慢（"刹不住车"来自这个不对称）
    expect(html).toContain('TAU_GO')
    expect(html).toContain('TAU_STOP')
    // 侧摆（走出 S 形）与步频跟位移绑定
    expect(html).toContain('SWAY_AMP')
    expect(html).toContain('walkPhase += stepDist')
    // 到点的回弹余摆通道在场
    expect(html).toContain('settleT0')
    // 旧的硬平移（每帧直接赋值速度）不许回来
    expect(html, '硬平移速度的旧写法回来了 —— 那就是"纸片人"的根').not.toContain(
      'vx = (dx / d) * speed'
    )
    // 尺子自证：同一段检查在"旧写法"样本上必须见红
    const badOld = 'if (target) { vx = (dx / d) * speed }'
    expect(badOld).toContain('vx = (dx / d) * speed')
    expect(badOld).not.toContain('function approach(dt, tx, ty, tau)')
  })

  it('拖拽：阈值升级成拖 + 拖中每帧重报命中区（余量加大）+ 窗外松手兜底', () => {
    expect(html).toContain('DRAG_THRESHOLD')
    expect(html).toContain('function beginDrag(t)')
    expect(html).toContain('function endDrag(t)')
    expect(html).toContain('window.addEventListener(\'mousemove\', onWinMove)')
    expect(html).toContain('window.addEventListener(\'mouseup\', onWinUp)')
    // 拖中命中区余量放到 40px —— 否则指针甩得比轮询快时窗口转回穿透、事件断流
    expect(html).toContain('var pad = dragging ? 40 : 10')
    // 松手在窗外（任务栏）时 mouseup 收不到：mousemove 里用 buttons 位兜底收尾
    expect(html).toContain('(ev.buttons & 1) === 0')
    // 拖拽拉伸通道（被拎起来身体要拉长/压扁）
    expect(html).toContain('dragSX')
    expect(html).toContain('dragSY')
  })

  it('空闲睡眠：主进程 powerMonitor 轮询发 idle；宠物窗接住、会停走、戳一下会醒', () => {
    const petMain = readFileSync(join(root, 'main', 'pet', 'index.ts'), 'utf8')
    expect(petMain, '主进程没有读系统空闲时间').toContain('powerMonitor.getSystemIdleTime()')
    expect(petMain, '空闲指令没发（idle）').toContain(`{ kind: 'idle', on: shouldSleep }`)
    // 宠物窗这一侧：接住 idle、睡着停走、点击/警报唤醒
    expect(html).toContain('function wakeUp(t)')
    expect(html).toContain('if (asleep) wakeUp(t)')
    expect(html, '睡着要停游走（step 里必须有 asleep 守卫）').toContain('if (!asleep) {')
    // 瞌睡指示（ASCII 的 z，哑视图铁律）
    expect(html).toContain('zzzEl.classList.add(\'on\')')
  })

  it('一键直达：菜单项在菜单最上面 + 导航通道 + 落地页接住（三段链路各自在场）', () => {
    const petMain = readFileSync(join(root, 'main', 'pet', 'index.ts'), 'utf8')
    const iWall = petMain.indexOf('PET.MENU.SETTINGS_WALL')
    const iAi = petMain.indexOf('PET.MENU.SETTINGS_AI')
    const iFeed = petMain.indexOf('PET.MENU.FEED')
    expect(iWall, '菜单缺「打开壁纸设置」').toBeGreaterThan(-1)
    expect(iAi, '菜单缺「打开 AI 设置」').toBeGreaterThan(-1)
    expect(iWall, '两个快捷入口要在菜单最上面（主人点名的位置）').toBeLessThan(iFeed)
    expect(iAi).toBeLessThan(iFeed)
    // 拉起主窗三件套（最小化的窗口 show() 不会还原 —— 必须先 restore）
    expect(petMain).toContain('mw.restore()')
    expect(petMain).toContain('mw.show()')
    expect(petMain).toContain('mw.focus()')
    expect(petMain).toContain('IPC.appNav')
    // 通道注册 + preload 订阅口
    const channels = readFileSync(join(root, 'shared', 'ipc-channels.ts'), 'utf8')
    expect(channels).toContain(`appNav: 'app:nav'`)
    const preloadMain = readFileSync(join(root, 'preload', 'index.ts'), 'utf8')
    expect(preloadMain).toContain('onAppNav')
    // 渲染层落地：跳设置页 + 认卡片选择器 + query 驱动滚动
    const nav = readFileSync(join(root, 'renderer', 'src', 'lib', 'app-nav.ts'), 'utf8')
    expect(nav).toContain("path: '/settings'")
    const settings = readFileSync(join(root, 'renderer', 'src', 'views', 'SettingsView.vue'), 'utf8')
    expect(settings).toContain(`'.card.wall-card'`)
    expect(settings).toContain(`'.card.ai-card'`)
    expect(settings).toContain('applyCardQuery')
    // 文案真源：两个标签在 copy.ts（页面/主进程都不许自己写这两句话）
    const copy = readFileSync(join(root, 'shared', 'copy.ts'), 'utf8')
    expect(copy).toContain('SETTINGS_WALL')
    expect(copy).toContain('SETTINGS_AI')
    // 尺子自证：坏样本（顺序颠倒）必须被同一段比较判红
    const badOrder = 'PET.MENU.FEED ... PET.MENU.SETTINGS_WALL'
    expect(badOrder.indexOf('PET.MENU.SETTINGS_WALL')).toBeGreaterThan(
      badOrder.indexOf('PET.MENU.FEED')
    )
  })
})
