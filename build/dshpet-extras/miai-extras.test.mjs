/**
 * miai-extras.test.mjs —— miai-extras.js（小黄鸭点击音效 + 点击仲裁互动层）的自检，
 * node 直跑、零依赖。
 *
 * 跑法：node build/dshpet-extras/miai-extras.test.mjs   （当前目录无关，路径按本文件定位）
 *
 * 两臂结构（缺一不可）：
 *  ① 正常臂：把 miai-extras.js 源码装进假 DOM / Audio / fetch / 定时器沙箱（node:vm），跑全部用例，必须全绿；
 *  ② 种坏臂（尺子自证）：对源码做已知缺陷改写，期望对应用例**转红**——绿了不算证据，红过才算。
 *     每条种坏的锚点必须**恰好命中一次**（0 次=响亮报错拒跑，不许"种坏没种进去"当绿跑）；
 *     另要求每条种坏至少留一条非预期用例仍绿（证明缺陷是外科式的，不是把脚本整个搞坏）。
 *
 * 与源码的耦合纪律：种坏锚点字符串就在本文件里。源码改动导致锚点漂移时，本文件**响亮失败**
 * （绝不静默跳过该条种坏）——改 miai-extras.js 时同步改这里。
 *
 * 【假时钟】脚本的连击窗口/延时全走 setTimeout + Date.now()；沙箱里两者都被换成
 * 受控桩（advance(ms) 推进并触发到期定时器）——不这样就得真等 320/420ms，且
 * 跨用例的挂起定时器会互相串味（"尺子自己制造假红"的最常见来源）。
 *
 * 覆盖清单：
 *  A. 小黄鸭（原有判据，全保留）：
 *   单击计数/fetch URL/blob Audio/捕获注册；120ms 防抖；懒加载缓存复用；fetch 与 play 失败
 *   写原因可重试；quackEnabled 开关；非左键；点空白；探针 play()；重复注入；BASE 缺失显式失败。
 *  B. 点击仲裁（v1 pet.html:304-383 的迁移判据）：
 *   单击→320ms 后 /miai/pat；双击→420ms 后 /miai/feed 且不发 pat；三连击停住→pat（不是 feed）；
 *   四连击停住→什么都不发；五连击→/miai/rua 且清掉排队的 pat；rua 后 600ms 锁（不响不排队）；
 *   连击超 3s 窗口→各算单击；拖拽撤销（位移>6px 撤销排队动作）；拖拽判据用**屏幕坐标**
 *   （clientX 大变而 screenX 不动仍算点击）。
 *  C. 音效闸门（宿主 /miai/flags）：
 *   首击默认放行（不等网络）；读到 sound:false 后不响不计数；失败写 flagsError 保留上次读数；
 *   音量 0~100 → Audio.volume 0~1。
 *  D. 互动上报口径：
 *   POST 失败写 actError 且不计数；宿主应答 ok!==true 同样不计数。
 *  E. 右键菜单（2026-10-06 晚）：
 *   悬停「关闭大肥鱼」项发一次 /miai/plead、同项内移动（子节点切换）不重发、移开再回算
 *   新一次、其他菜单项零 POST；上报失败写 menuPleadError（计数语义=派发，回包失败不倒退）；
 *   主题读数 dark/light 翻转 + 非 dark 值一律归一为 light；读数失败保留上一次读数并写
 *   menuThemeError、恢复后清空；菜单出现（MutationObserver）触发主题刷新且无关节点不刷；
 *   主题 <style> 注入含 dark/light 两组覆写选择器。
 *  F. 状态行（P3 ③ 2026-10-08；两段式 2026-10-09；读数行 V2-23 2026-10-15）：
 *   vitals 叶子经既有 goto 轮询缓存（首拉即采用；同 counter 不动事；data 缺失保留旧读数，
 *   affection 一并透传 —— V2-23 前它在归一化那步被丢）；菜单打开 → 既有菜单项**之前**
 *   前插一条三段式状态行：①标签文本固定格式 `/^🍚 饱腹度：\d+%$/`、②条宽 = 四舍五入
 *   satiety%、颜色按五档闭下界、③读数行固定格式 `🍙 大白饭 N 碗 · ❤ 好感度 K%`
 *   （非有限数画占位：好感 `--%`、大白饭 `--`）；
 *   vitals 缺 → **不摆坏行**（menuHungerSkips 计数，不是画 0%）；
 *   counter 更新 → 只刷新不重插；注入后重钳面板读菜单根 __dshPetClampRect 可见带
 *   （视口≠clamp 用 202 高咬：top 70、底 ≤198；不越界不动；读数缺席方才回落视口，
 *   且必计 menuReclampFallbacks + 留一条 warn —— 静默拿 vh 装成功是图三的病根）；
 *   档界常量与 src/shared/pet.ts 的 PET_HUNGER_*_AT 跨文件逐值对账（改一处即红）。
 *  G. 跟随 / 关闭挽留 / 漫游闸门（2026-10-09 补充模块一、二）：
 *   跟随叶子首拉即采用 + 逐帧趋近单调收窄 → ≤3px 收帧并把停下的地方记进 customPos
 *   （**口径**：落点是鱼中心；钳位按 pos 口径、比较/移动按中心口径——两处混用会停在
 *   离光标半个身位的地方还自称"到位"，有专门种坏咬它）；
 *   暂停守卫（拖拽中不起帧、途中拖拽立即收帧、松手后轮询拍兜底重起，全程不改 followOn）；
 *   off 叶子收帧、停在哪记哪、此后零帧；轮询节奏自适应（跟随生效 120ms / 平时 1000ms，
 *   119/999 不出、120/1000 出）；挽留 go 段用 body 钳位（命中区在屏、窗可探出 → parked
 *   + 回执 {seq,phase:go}）、back 段回原处并原样还原 customPos；走不成就当没发生
 *   （出发即拒/途中打断 → aborts 计数、零回执、看门狗下一拍归零）；
 *   漫游闸门六判据（挽留/跑腿/跟随/总闸/归零必拦、vitals 缺失放行）+ 分档节流
 *   （severe 180s 窗 179999/180000 边界）+ 指名 tryMove(name) 直通；
 *   HIT_HALF_*_RATIO 与 src/main/dshpet/host.ts 逐值对账（跟随/挽留共用同一钳位口径）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, 'miai-extras.js'), 'utf8');
/** BASE 桩值：形态对齐 constants.js:13 / :123 的真实默认形态（宿主本地路由） */
const BASE_STUB = 'http://127.0.0.1:3080/dsh-pet-7340';
const QUACK_FETCH_URL = BASE_STUB + '/miai/quack.wav';
const FLAGS_FETCH_URL = BASE_STUB + '/miai/flags';
const PAT_POST_URL = BASE_STUB + '/miai/pat';
const FEED_POST_URL = BASE_STUB + '/miai/feed';
const RUA_POST_URL = BASE_STUB + '/miai/rua';
const THEME_FETCH_URL = BASE_STUB + '/miai/theme';
const PLEAD_POST_URL = BASE_STUB + '/miai/plead';
const STATE_FETCH_URL = BASE_STUB + '/state';
const RECALL_ARRIVED_URL = BASE_STUB + '/miai/recall-arrived';

// ---------------------------------------------------------------- 通用小工具

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 一轮宏任务：足以排干整条微任务链（脚本内 promise 链最深处也只跨微任务） */
const flush = () => sleep(0);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
  }
}

// ---------------------------------------------------------------- 假 DOM 的查询/几何

/** 假 DOM 选择器：只支持 `.class` 与 `tag`（脚本只用这两种；命中不了返回 null） */
function querySel(root, sel) {
  const match = (el) =>
    sel.startsWith('.')
      ? el.classList && el.classList.contains(sel.slice(1))
      : String(el.tagName).toLowerCase() === sel.toLowerCase();
  const walk = (el) => {
    for (const c of el.children || []) {
      if (match(c)) return c;
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
}

/**
 * 假几何（给 offsetHeight）：数值对齐真实量级 —— 状态行 54
 * （padding 12 + 标签 14 + gap 4 + 轨道 6 + gap 4 + 读数行 14，与 buildHungerBar 的注释同源）、
 * 菜单项 22、面板 = padding 8 + 子树和、菜单根 = 第一个子面板（vendor 只量 rootPanel）。
 * 面板是"算出来的"：注入状态行后自动增高 —— 正是要测的"后插撑高"。
 */
function fakeHeight(el) {
  if (el.classList.contains('miai-hunger-bar')) return 54;
  if (el.classList.contains('dsh-pet-menu-item')) return 22;
  if (el.classList.contains('dsh-pet-menu-column')) {
    let sum = 8;
    for (const c of el.children) sum += fakeHeight(c);
    return sum;
  }
  if (el.classList.contains('dsh-pet-menu')) {
    return el.children.length ? fakeHeight(el.children[0]) : 0;
  }
  return 0;
}

// ---------------------------------------------------------------- 假环境（桩）

/** 命中宠物：closest('.pet-hit') 返回元素（供体：sprite.js:143 的命中区类名） */
const HIT_TARGET = { closest: (sel) => (sel === '.pet-hit' ? { className: 'pet-hit' } : null) };
/** 页面空白处：有 closest，但任何选择器都命中不到 */
const BLANK_TARGET = { closest: () => null };
/** 连 closest 都没有的目标（防御分支路径） */
const BARE_TARGET = {};

/**
 * 假精灵（跟随/挽留/漫游闸门用例）：实例字段与 sprite.js 同形，原型上有 tryMove ——
 * 漫游闸门正是包装**原型**的 tryMove（实例级包装会被重建的新实例丢掉），所以这里
 * 必须给一个类实例，`Object.getPrototypeOf(sp)` 才拿得到可包装的原型。
 * 所有调用留痕：sendBounds（窗口位移）/ tryMove（原函数真的被调到没有）/ stopMove。
 */
function makeSprite(opts = {}) {
  const calls = { sendBounds: [], tryMove: [], stopMove: 0 };
  class FakeSprite {
    constructor() {
      this.pos = { x: opts.x ?? 0, y: opts.y ?? 0 };
      this.halfW = opts.halfW ?? 64;
      this.halfH = opts.halfH ?? 64;
      this.size = opts.size ?? 256;
      this.winH = opts.winH ?? 256;
      this.margin = opts.margin ?? { t: 0, r: 0, b: 0, l: 0 };
      this.dragState = { active: false };
      this.customPos = 'customPos' in opts ? opts.customPos : null;
      this.pendingMove = null;
      this.moveRef = null;
      this.throwRef = null;
    }
    sendBounds(x, y) {
      this.pos = { x: Number(x), y: Number(y) };
      calls.sendBounds.push([Number(x), Number(y)]);
    }
    stopMove() {
      calls.stopMove++;
      this.pendingMove = null;
      this.moveRef = null;
    }
    stopThrow() {
      this.throwRef = null;
    }
    tryMove(preferredName) {
      calls.tryMove.push(preferredName === undefined ? null : preferredName);
      return true; // 供体语义：受理返回 true（闸门被拦时也返回 true，所以判据要看原函数调用留痕）
    }
  }
  const sp = new FakeSprite();
  return { sp, calls };
}

/**
 * 一个独立沙箱：假 document / Audio / fetch / 定时器 / Date，全部按调用留痕。
 * @param {string} source 脚本源码
 * @param {{base?: string|null, raf?: boolean, sprites?: unknown[], view?: object}} [opts]
 *   base: undefined=用 BASE_STUB；null=故意不定义 BASE 全局
 *   raf: 装 requestAnimationFrame 队列（配 frame(ms) 手动步进）；sprites/view: 挂同名全局
 */
function makeHarness(source, opts = {}) {
  const registry = {
    fetchUrls: [],
    fetchImpl: null, // (url)=>Promise<response>；null = 默认按路由应答（见 defaultFetch）
    flags: null, // 覆盖 /miai/flags 的应答载荷（默认 {sound:true,volume:80}）
    actReply: null, // 覆盖互动 POST 的应答载荷（默认 {ok:true}）
    state: null, // 覆盖 /state 应答载荷（goto/vitals 叶子；默认见 defaultState）
    heightOf: null, // 覆盖元素 offsetHeight 计算（(el)=>number；null = 默认 fakeHeight）
    audioInstances: [],
    playImpl: null, // ()=>Promise<void>；null = 默认 resolve
    createdUrls: [],
    blobs: [],
    warns: [],
    styleTags: [], // <style> 注入留痕（主题覆写表）
    themeAttrs: [], // documentElement.setAttribute('data-miai-theme', v) 的历史（按序）
    observers: [], // MutationObserver 桩实例（测试经 .fire(records) 手动触发）
  };
  const listeners = [];
  /** 假元素：菜单/进度条用例需要的最小 DOM（类名/样式/子树/查询/几何都可观察） */
  const makeEl = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      style: {},
      children: [],
      textContent: '',
      parentNode: null,
      attrs: {},
      classList: {
        add(name) {
          if (!el.classList.contains(name)) el.className = (el.className ? el.className + ' ' : '') + name;
        },
        contains(name) {
          return String(el.className || '')
            .split(/\s+/)
            .indexOf(name) >= 0;
        },
      },
      appendChild(child) {
        el.children.push(child);
        child.parentNode = el;
        return child;
      },
      insertBefore(child, ref) {
        const i = el.children.indexOf(ref);
        if (i < 0) el.children.push(child);
        else el.children.splice(i, 0, child);
        child.parentNode = el;
        return child;
      },
      remove() {
        if (el.parentNode) {
          const i = el.parentNode.children.indexOf(el);
          if (i >= 0) el.parentNode.children.splice(i, 1);
          el.parentNode = null;
        }
      },
      setAttribute(name, value) {
        el.attrs[name] = String(value);
      },
      addEventListener() {},
      querySelector(sel) {
        return querySel(el, sel);
      },
      getBoundingClientRect() {
        return { top: parseFloat(el.style.top) || 0, left: parseFloat(el.style.left) || 0, width: 0, height: 0 };
      },
    };
    Object.defineProperty(el, 'firstChild', {
      get() {
        return el.children.length ? el.children[0] : null;
      },
    });
    Object.defineProperty(el, 'offsetHeight', {
      get() {
        return registry.heightOf ? registry.heightOf(el) : fakeHeight(el);
      },
    });
    return el;
  };
  const docBody = makeEl('body');
  const doc = {
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture: capture === true });
    },
    // —— 右键菜单主题的最小 DOM 桩（真实现：documentElement 挂属性 / head 收 <style> / body 给观察）——
    documentElement: (() => {
      const el = makeEl('html');
      const base = el.setAttribute;
      el.setAttribute = (name, value) => {
        base(name, value);
        if (name === 'data-miai-theme') registry.themeAttrs.push(String(value));
      };
      return el;
    })(),
    head: (() => {
      const el = makeEl('head');
      const base = el.appendChild;
      el.appendChild = (node) => {
        registry.styleTags.push(node);
        return base(node);
      };
      return el;
    })(),
    body: docBody,
    createElement(tag) {
      return makeEl(tag);
    },
    // 菜单是 append 到 body 的（vendor shared-core.js:726）：查询从 body 子树找
    querySelector(sel) {
      return querySel(docBody, sel);
    },
  };
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.playCalls = 0;
      registry.audioInstances.push(this);
    }
    play() {
      this.playCalls++;
      return registry.playImpl ? registry.playImpl() : Promise.resolve();
    }
  }
  const okBlob = () => ({ ok: true, status: 200, blob: () => Promise.resolve({ type: 'audio/wav', size: 8192 }) });
  const okJson = (payload) => ({ ok: true, status: 200, json: () => Promise.resolve(payload) });
  /** /state 缺省载荷：goto/vitals 叶子都在、data 为空（宿主叶子首拉前的形状） */
  const defaultState = () => ({
    pets: { main: { goto: { counter: 0, data: null }, vitals: { counter: 0, data: null } } },
  });
  const defaultFetch = (url) => {
    if (url === FLAGS_FETCH_URL) return Promise.resolve(okJson(registry.flags ?? { sound: true, volume: 80 }));
    if (url === QUACK_FETCH_URL) return Promise.resolve(okBlob());
    if (url === STATE_FETCH_URL) return Promise.resolve(okJson(registry.state ?? defaultState()));
    return Promise.resolve(okJson(registry.actReply ?? { ok: true }));
  };

  // ---- 受控时钟：Date.now() 与 setTimeout 同源，advance(ms) 推进并触发到期定时器 ----
  let fakeNow = 1_700_000_000_000;
  let timerSeq = 0;
  const timers = new Map();
  // ---- rAF 队列（opts.raf 才用到）：frame(ms) 一帧一跑；回调里再排的帧留到下一帧 ----
  let rafSeq = 0;
  const rafQueue = new Map();
  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(fakeNow);
      else super(...args);
    }
    static now() {
      return fakeNow;
    }
  }

  /** MutationObserver 桩：记录实例；.fire(records) 由测试手动触发回调（真实引擎不会按时） */
  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      registry.observers.push(this);
    }
    observe(target, opts) {
      this.target = target;
      this.opts = opts;
    }
    disconnect() {}
    fire(records) {
      this.cb(records);
    }
  }

  const sandbox = {
    window: { innerHeight: 'innerHeight' in opts ? opts.innerHeight : 800 },
    document: doc,
    MutationObserver: FakeMutationObserver,
    console: {
      log() {},
      warn: (...a) => registry.warns.push(a.join(' ')),
      error: (...a) => registry.warns.push(a.join(' ')),
    },
    Audio: FakeAudio,
    Date: FakeDate,
    setTimeout(fn, ms) {
      const id = ++timerSeq;
      timers.set(id, { fn, at: fakeNow + (Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    URL: {
      createObjectURL(blob) {
        registry.blobs.push(blob);
        const u = 'blob:miai-fake/' + registry.blobs.length;
        registry.createdUrls.push(u);
        return u;
      },
    },
    fetch: (url, init) => {
      registry.fetchUrls.push(String(url));
      const impl = registry.fetchImpl;
      try {
        // init 透传：用例要能读 POST 的 body（回执 seq/phase 这类判据不能靠猜）
        return impl ? impl(String(url), init) : defaultFetch(String(url));
      } catch (err) {
        return Promise.reject(err); // 桩自身同步异常也走失败路径，避免静默成功
      }
    },
  };
  const baseValue = 'base' in opts ? opts.base : BASE_STUB;
  if (baseValue !== null) sandbox.BASE = baseValue;
  if ('view' in opts) sandbox.VIEW = opts.view; // 视口（工作区外接矩形）：跟随/挽留的坐标换算
  if ('sprites' in opts) sandbox.sprites = opts.sprites; // 页面的精灵数组（currentSprite 读它）
  // 单调时钟与假 Date 同源：缓动/趋近的 dt 全在受控时间轴上（否则真实 performance.now
  // 会让帧步长不可预测，收敛判据变成看运气的死等）
  sandbox.performance = { now: () => fakeNow };
  if (opts.raf) {
    sandbox.requestAnimationFrame = (fn) => {
      const id = ++rafSeq;
      rafQueue.set(id, fn);
      return id;
    };
    sandbox.cancelAnimationFrame = (id) => {
      rafQueue.delete(id);
    };
  }
  vm.createContext(sandbox);
  const run = () => vm.runInContext(source, sandbox, { filename: 'miai-extras.js' });

  const makeEvent = (ev) => ({
    button: 'button' in ev ? ev.button : 0,
    target: 'target' in ev ? ev.target : HIT_TARGET,
    screenX: 'screenX' in ev ? ev.screenX : 1000,
    screenY: 'screenY' in ev ? ev.screenY : 500,
    clientX: 'clientX' in ev ? ev.clientX : 20,
    clientY: 'clientY' in ev ? ev.clientY : 20,
    buttons: 'buttons' in ev ? ev.buttons : 1,
  });
  const dispatch = (type, ev = {}) => {
    for (const l of listeners.filter((x) => x.type === type)) l.fn(makeEvent(ev));
  };

  run();
  return {
    registry,
    listeners,
    doc,
    window: sandbox.window, // 用例要能塞 window.__dshPetDebug（暂停守卫的菜单判据）
    run,
    okJson,
    okBlob,
    defaultFetch, // 包一层 fetchImpl 时转调它（既有应答形状一字不动）
    /** 派发一次 pointerdown（默认左键 + 命中宠物） */
    fire: (ev) => dispatch('pointerdown', ev),
    /** 派发一次 pointermove（拖拽判定用） */
    move: (ev) => dispatch('pointermove', ev),
    /** 派发一次 pointerup */
    release: (ev) => dispatch('pointerup', ev),
    /** 派发一次 mouseover（菜单挽留委托用；target 带 closest 即可） */
    hover: (ev) => dispatch('mouseover', ev),
    /** 推进假时钟并触发到期定时器（到期回调里若又排定时器，继续顺延到没有为止） */
    advance(ms) {
      fakeNow += ms;
      for (let guard = 0; ; guard++) {
        if (guard > 100) throw new Error('advance 死循环：定时器互相排队');
        let dueId = null;
        let dueAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= fakeNow && t.at < dueAt) {
            dueAt = t.at;
            dueId = id;
          }
        }
        if (dueId === null) break;
        const t = timers.get(dueId);
        timers.delete(dueId);
        t.fn();
      }
    },
    /** 步进一帧 rAF（默认 16ms）：推进假时钟 → 跑掉当帧全部回调（回调里新排的留到下一帧） */
    frame(ms = 16) {
      fakeNow += ms;
      const due = Array.from(rafQueue.values());
      rafQueue.clear();
      for (const fn of due) fn(fakeNow);
      return due.length;
    },
    /** 还有没有挂着的 rAF（判「收帧了没有」用：收帧后必须为 0） */
    rafPending: () => rafQueue.size,
    get api() {
      return sandbox.window.__miaiExtras;
    },
  };
}

/** 按 URL 过滤 fetch 留痕（flags/quack/互动混在一条流里，判据各取所需） */
const fetchCount = (h, url) => h.registry.fetchUrls.filter((u) => u === url).length;

/** documentElement 最近一次挂的 data-miai-theme（从没挂过 = null —— 供种坏臂见红） */
const lastThemeAttr = (h) =>
  h.registry.themeAttrs.length ? h.registry.themeAttrs[h.registry.themeAttrs.length - 1] : null;

/** 假菜单项：closest('.dsh-pet-menu-item') 命中自己；querySelector('span') 给出文案 */
function makeMenuItem(label) {
  const item = {
    closest: (sel) => (sel === '.dsh-pet-menu-item' ? item : null),
    querySelector: (sel) => (sel === 'span' ? { textContent: label } : null),
  };
  return item;
}
/** 菜单项内的子节点（span/文本节点等）：closest 命中所在项（模拟真实 mouseover 的目标形态） */
function makeItemChild(item) {
  return { closest: (sel) => (sel === '.dsh-pet-menu-item' ? item : null) };
}
/** 假菜单根节点（MutationObserver 记录里的 addedNode） */
function makeMenuNode() {
  return { classList: { contains: (c) => c === 'dsh-pet-menu' } };
}

// ---- 饱腹行用例的小工具（真元素版菜单：走假 DOM，类名/样式/子树/几何都可观察） ----

/** 真元素版菜单骨架：root(.dsh-pet-menu) > panel(.dsh-pet-menu-column) > 3×item(>span) */
function mountMenu(h, opts = {}) {
  const root = h.doc.createElement('div');
  root.className = 'dsh-pet-menu';
  const panel = h.doc.createElement('div');
  panel.className = 'dsh-pet-menu-column';
  panel.style.left = '20px';
  panel.style.top = 'top' in opts ? opts.top : '20px'; // 模拟 vendor 注入前按旧高钳过一次的落点
  for (const label of opts.items || ['item-a', 'item-b', 'item-c']) {
    const item = h.doc.createElement('div');
    item.className = 'dsh-pet-menu-item';
    const span = h.doc.createElement('span');
    span.textContent = label;
    item.appendChild(span);
    panel.appendChild(item);
  }
  root.appendChild(panel);
  if (opts.clamp) root.__dshPetClampRect = opts.clamp; // shared-core 补丁落的可见带读数（图三/图四批）
  h.doc.body.appendChild(root); // vendor 真实行为：菜单挂 body（shared-core.js:726）
  return { root, panel };
}

/** 菜单出现的观察器回调（与 vendor 真实变动同形状：root 作为 addedNode） */
function menuAppeared(h, root) {
  h.registry.observers[0].fire([{ addedNodes: [root] }]);
}

/** 子树全部文本节点内容（判「两段式里只有 label 一行固定格式文本」用） */
function textsOf(el) {
  const out = [];
  const walk = (n) => {
    if (typeof n.textContent === 'string' && n.textContent) out.push(n.textContent);
    for (const c of n.children || []) walk(c);
  };
  walk(el);
  return out;
}

/** 一套 vitals 叶子载荷（counter + data，叶子形状对齐宿主 /state） */
function stateWithVitals(counter, data) {
  return { pets: { main: { goto: { counter: 0, data: null }, vitals: { counter: counter, data: data } } } };
}

/** 一套 follow 叶子载荷（电平：{on,x,y}，落点 = 鱼中心的屏幕 DIP） */
function stateWithFollow(counter, data) {
  return { pets: { main: { goto: { counter: 0, data: null }, follow: { counter: counter, data: data } } } };
}

/** 一套 recall 叶子载荷（事件：counter 变了才算新命令；data = {seq, phase, x?, y?}） */
function stateWithRecall(counter, data) {
  return { pets: { main: { goto: { counter: 0, data: null }, recall: { counter: counter, data: data } } } };
}

// ---- 跟随/挽留/漫游闸门用例的小工具（假精灵 + 视口；rAF 手动步进） ----

/** 视口桩（工作区外接矩形）：1000×800、原点在屏幕 (0,0) —— 坐标换算判据全落整数好对账 */
const VIEW_STUB = { x: 0, y: 0, w: 1000, h: 800 };

/**
 * 带假精灵的沙箱（raf:true，帧要手动 frame() 步进）。缺省精灵：pos(0,0)、halfW/H=64、
 * size=256、winH=256、margin 全 0 —— 与 walkTo/clampBodyPos 的算式配合出的落点全是整数。
 */
function makeSpriteHarness(src, opts = {}) {
  const rig = makeSprite(opts.sprite || {});
  const h = makeHarness(src, { raf: true, sprites: [rig.sp], view: VIEW_STUB });
  return { h, sp: rig.sp, calls: rig.calls };
}

/** 抓 /miai/recall-arrived 的回执体（POST body 原样解析；其余路由形状不变） */
function captureRecallPosts(h) {
  const posts = [];
  h.registry.fetchImpl = (url, init) => {
    if (url === RECALL_ARRIVED_URL) posts.push(JSON.parse(init.body));
    return h.defaultFetch(url);
  };
  return posts;
}

// ---------------------------------------------------------------- 正常臂用例

async function singleClick(h) {
  h.fire();
  await flush();
}

const TESTS = [
  // ---------------- A. 小黄鸭（原有判据） ----------------
  {
    name: '单击：计数=1、fetch 命中 BASE+/miai/quack.wav、Audio 用 blob URL、捕获阶段注册',
    fn: async (src) => {
      const h = makeHarness(src);
      assert(h.api && typeof h.api === 'object', '未挂载 window.__miaiExtras');
      assertEq(h.api.version, '20261010', 'version');
      assertEq(h.api.quackEnabled, true, 'quackEnabled 初始值');
      assertEq(h.api.quackCount, 0, 'quackCount 初始值');
      assertEq(h.api.lastQuackAt, 0, 'lastQuackAt 初始值');
      assertEq(h.api.quackError, null, 'quackError 初始值');
      assertEq(typeof h.api.play, 'function', 'play 应为函数');
      const pd = h.listeners.filter((l) => l.type === 'pointerdown');
      assertEq(pd.length, 1, 'pointerdown 监听器数量');
      assertEq(pd[0].capture, true, '必须在捕获阶段注册');
      for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
        const ls = h.listeners.filter((l) => l.type === type);
        assertEq(ls.length, 1, type + ' 监听器数量');
        assertEq(ls[0].capture, true, type + ' 必须在捕获阶段注册');
      }
      await singleClick(h);
      assertEq(h.api.quackCount, 1, '单击后计数');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 1, 'quack fetch 次数');
      assertEq(h.registry.audioInstances.length, 1, 'Audio 实例数');
      assertEq(h.registry.createdUrls.length, 1, 'createObjectURL 调用次数');
      assertEq(h.registry.audioInstances[0].src, h.registry.createdUrls[0], 'Audio.src 应为 createObjectURL 产物');
      assertEq(h.registry.audioInstances[0].playCalls, 1, 'play() 调用次数');
      assertEq(h.api.quackError, null, '成功路径不该有错误');
      assertEq(h.registry.warns.length, 0, '成功路径不该有 warn');
    },
  },
  {
    name: '快速两击：只计 1 次（120ms 防抖）',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire();
      h.fire(); // 同一毫秒内连击
      await flush();
      assertEq(h.api.quackCount, 1, '快速两击计数');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 1, 'fetch 不应重复');
      assertEq(h.registry.audioInstances.length, 1, 'Audio 不应重建');
      assertEq(h.registry.audioInstances[0].playCalls, 1, '只应开播一次');
    },
  },
  {
    name: '间隔>120ms 两击：各计一次，音频只懒加载一次（缓存复用）',
    fn: async (src) => {
      const h = makeHarness(src);
      await singleClick(h);
      h.advance(140); // 过防抖窗（假时钟；顺带触发排定的 pat，与本用例无关）
      await flush();
      await singleClick(h);
      assertEq(h.api.quackCount, 2, '两击合计计数');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 1, '音频只懒加载一次');
      assertEq(h.registry.audioInstances.length, 1, '缓存复用同一 Audio 实例');
      assertEq(h.registry.audioInstances[0].playCalls, 2, '应开播两次');
    },
  },
  {
    name: 'fetch 拒绝：quackError 非空且计数不变；修复后可重试',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.fetchImpl = () => Promise.reject(new Error('net down'));
      await singleClick(h);
      assertEq(h.api.quackCount, 0, 'fetch 失败不计数');
      assert(h.api.quackError && h.api.quackError.includes('net down'), 'quackError 必须写明原因');
      assert(h.registry.warns.some((w) => w.includes('小黄鸭音效失败')), '失败必须同时 console.warn，不许静默吞');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 1, '失败那次 fetch 已发生');
      // 修复后（过防抖窗）重试：必须能恢复，且错误清空、重新 fetch
      h.registry.fetchImpl = null;
      h.advance(140);
      await flush();
      await singleClick(h);
      assertEq(h.api.quackCount, 1, '重试成功后计数');
      assertEq(h.api.quackError, null, '成功后清空历史错误');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 2, '重试应重新 fetch（失败不缓存阻塞）');
    },
  },
  {
    name: 'play() 拒绝：quackError 写原因且计数不变',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.playImpl = () => Promise.reject(new Error('NotAllowedError: 自动播放被拦'));
      await singleClick(h);
      assertEq(h.api.quackCount, 0, 'play 失败不计数');
      assert(h.api.quackError && h.api.quackError.includes('NotAllowedError'), 'quackError 必须写明 play 失败原因');
      assert(h.registry.warns.some((w) => w.includes('NotAllowedError')), '失败必须同时 console.warn');
    },
  },
  {
    name: 'quackEnabled=false：点击与 play() 全不动；置回 true 恢复',
    fn: async (src) => {
      const h = makeHarness(src);
      h.api.quackEnabled = false;
      h.fire();
      h.fire();
      assertEq(h.api.play(), false, '禁用时 play() 不受理');
      await flush();
      assertEq(h.api.quackCount, 0, '禁用不计数');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 0, '禁用零 fetch');
      assertEq(h.registry.audioInstances.length, 0, '禁用零 Audio');
      assertEq(h.api.lastQuackAt, 0, '禁用不动防抖时间');
      assertEq(h.api.quackError, null, '禁用不是错误，不得写 quackError');
      h.api.quackEnabled = true;
      await singleClick(h);
      assertEq(h.api.quackCount, 1, '恢复后点击生效');
    },
  },
  {
    name: '非左键（右键/中键）：不计数',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire({ button: 2 }); // 右键
      h.fire({ button: 1 }); // 中键
      await flush();
      assertEq(h.api.quackCount, 0, '非左键不计数');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 0, '非左键零 fetch');
    },
  },
  {
    name: '点空白（含无 closest 目标）：不计数且不抛错',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire({ target: BLANK_TARGET });
      h.fire({ target: BARE_TARGET }); // 无 closest：防御分支，监听器不许外抛
      await flush();
      assertEq(h.api.quackCount, 0, '点空白不计数');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 0, '点空白零 fetch');
      assertEq(h.api.quackError, null, '点空白不该产生错误');
    },
  },
  {
    name: '探针 play()：跳手势但同路径，防抖生效',
    fn: async (src) => {
      const h = makeHarness(src);
      assertEq(h.api.play(), true, 'play() 受理');
      assertEq(h.api.play(), false, '同窗二次 play() 被防抖丢弃');
      await flush();
      assertEq(h.api.quackCount, 1, 'play() 走同一路径计数');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 1, 'play() 的 fetch');
      assertEq(h.registry.fetchUrls.filter((u) => u === QUACK_FETCH_URL)[0], QUACK_FETCH_URL, 'play() 的 fetch URL');
      assertEq(h.registry.audioInstances[0].playCalls, 1, 'play() 真正开播');
    },
  },
  {
    name: '重复注入：不叠加监听、不替换实例',
    fn: async (src) => {
      const h = makeHarness(src);
      const first = h.api;
      h.run(); // 二次注入同一源码
      assert(h.api === first, '二次注入不得替换既有实例');
      assert(h.registry.warns.some((w) => w.includes('跳过')), '二次注入必须响亮提示');
      await singleClick(h);
      assertEq(h.api.quackCount, 1, '二次注入不得叠加监听（单击仍只计 1）');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 1, '二次注入不得重复 fetch');
    },
  },
  {
    name: 'BASE 缺失：显式失败，不猜地址不计数',
    fn: async (src) => {
      const h = makeHarness(src, { base: null }); // 故意不给 BASE 全局
      await singleClick(h);
      assertEq(h.api.quackCount, 0, 'BASE 缺失不计数');
      assert(h.api.quackError && h.api.quackError.includes('BASE 不可用'), '必须显式报 BASE 不可用');
      assertEq(h.registry.fetchUrls.length, 0, 'BASE 缺失不得发起 fetch');
    },
  },

  // ---------------- B. 点击仲裁（v1 迁移判据） ----------------
  {
    name: '单击（等过 320ms）：发 /miai/pat，不发 feed/rua',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire();
      await flush();
      assertEq(h.api.patCount, 0, '320ms 未到不该抢跑');
      assertEq(fetchCount(h, PAT_POST_URL), 0, '320ms 未到不该发 POST');
      h.advance(320);
      await flush();
      assertEq(fetchCount(h, PAT_POST_URL), 1, 'pat POST 次数');
      assertEq(h.api.patCount, 1, 'patCount');
      assertEq(fetchCount(h, FEED_POST_URL), 0, '单击不得喂饭');
      assertEq(fetchCount(h, RUA_POST_URL), 0, '单击不得 rua');
      assertEq(h.api.actError, null, '成功路径不该有 actError');
    },
  },
  {
    name: '双击停住（等过 420ms）：发 /miai/feed，且 pat 被撤销',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire();
      h.fire(); // 第二下清掉 pat 定时器、改排"双击"
      await flush();
      h.advance(420);
      await flush();
      assertEq(fetchCount(h, FEED_POST_URL), 1, 'feed POST 次数');
      assertEq(h.api.feedCount, 1, 'feedCount');
      assertEq(fetchCount(h, PAT_POST_URL), 0, '双击中途的 pat 必须被撤销（v1：第二下清 patTimer）');
      assertEq(h.api.patCount, 0, 'patCount 应为 0');
    },
  },
  {
    name: '三连击停住：算摸头（pat），不算双击（v1：1/3 下一档）',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire();
      h.fire();
      h.fire();
      await flush();
      h.advance(420);
      await flush();
      assertEq(fetchCount(h, PAT_POST_URL), 1, 'pat POST 次数');
      assertEq(fetchCount(h, FEED_POST_URL), 0, '三连击不是双击');
      assertEq(h.api.patCount, 1, 'patCount');
    },
  },
  {
    name: '四连击停住：什么都不发（不上不下的第 4 下）',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire();
      h.fire();
      h.fire();
      h.fire();
      await flush();
      h.advance(3000);
      await flush();
      assertEq(fetchCount(h, PAT_POST_URL), 0, '第 4 下不该补发 pat');
      assertEq(fetchCount(h, FEED_POST_URL), 0, '第 4 下不该补发 feed');
      assertEq(fetchCount(h, RUA_POST_URL), 0, '第 4 下不该 rua');
    },
  },
  {
    name: '五连击：发 /miai/rua，且排队的 pat 一次都不补发',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire();
      h.fire();
      h.fire();
      h.fire();
      h.fire();
      await flush();
      assertEq(fetchCount(h, RUA_POST_URL), 1, 'rua POST 次数');
      assertEq(h.api.ruaCount, 1, 'ruaCount');
      h.advance(3000);
      await flush();
      assertEq(fetchCount(h, PAT_POST_URL), 0, 'rua 时前面排定的 pat 必须被清掉');
      assertEq(fetchCount(h, FEED_POST_URL), 0, 'rua 时前面排定的 feed 必须被清掉');
    },
  },
  {
    name: 'rua 后 600ms 锁：锁内按下不响也不排队；锁过恢复',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire();
      h.fire();
      h.fire();
      h.fire();
      h.fire();
      await flush();
      const quackAtRua = h.api.quackCount;
      h.fire(); // 锁内（同一假时钟刻）
      await flush();
      assertEq(h.api.quackCount, quackAtRua, '锁内的按下不该响');
      h.advance(600);
      await flush();
      h.fire();
      h.advance(320);
      await flush();
      assertEq(fetchCount(h, PAT_POST_URL), 1, '锁过后第一次按下重新按单击算');
    },
  },
  {
    name: '连击超 3s 窗口：各自成单击，各发一次 pat',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire();
      h.advance(3300); // 超过 RUA_WINDOW_MS，且让第一下的 pat 定时器到期
      await flush();
      h.fire();
      h.advance(320);
      await flush();
      assertEq(fetchCount(h, PAT_POST_URL), 2, '两次孤立单击应各发一次 pat');
      assertEq(fetchCount(h, FEED_POST_URL), 0, '跨度超窗不该拼成双击');
    },
  },
  {
    name: '拖拽撤销：按下后位移 >6px → 排队的 pat 被撤掉',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire({ screenX: 1000, screenY: 500 });
      h.move({ screenX: 1012, screenY: 500 }); // 12px：拖不是点
      h.release({ screenX: 1012, screenY: 500 });
      h.advance(500);
      await flush();
      assertEq(fetchCount(h, PAT_POST_URL), 0, '拖拽后不该补发 pat');
      // 对照臂：同样按下、不移动 → pat 照发（证明上面的 0 不是"根本没装"造成的）
      const h2 = makeHarness(src);
      h2.fire({ screenX: 1000, screenY: 500 });
      h2.release({ screenX: 1000, screenY: 500 });
      h2.advance(500);
      await flush();
      assertEq(fetchCount(h2, PAT_POST_URL), 1, '未移动的对照臂必须发 pat');
    },
  },
  {
    name: '拖拽判据看屏幕坐标：clientX 大变、screenX 不动 → 仍算点击',
    fn: async (src) => {
      const h = makeHarness(src);
      h.fire({ screenX: 1000, screenY: 500, clientX: 5, clientY: 5 });
      h.move({ screenX: 1000, screenY: 500, clientX: 105, clientY: 5 }); // 窗口自己的移动会改 clientX
      h.release({ screenX: 1000, screenY: 500, clientX: 105, clientY: 5 });
      h.advance(500);
      await flush();
      assertEq(fetchCount(h, PAT_POST_URL), 1, '屏幕坐标没动就是点击（供体 sprite.js:831 同款口径）');
    },
  },

  // ---------------- C. 音效闸门 ----------------
  {
    name: '闸门默认放行：首击不等 flags 就响（宁响一声不哑）',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.flags = { sound: false, volume: 0 };
      assertEq(h.api.soundAllowed, true, 'soundAllowed 初始值应为放行');
      h.fire(); // flags 还在路上：这一击必须响
      await flush();
      assertEq(h.api.quackCount, 1, '首击必须响（不能等网络）');
      assertEq(h.api.soundAllowed, false, 'flags 到手后闸门应更新');
      assertEq(h.api.soundVolume, 0, 'flags 到手后音量应更新');
    },
  },
  {
    name: '闸门读到 sound:false：点击不响不计数；置回 true 恢复',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.flags = { sound: false, volume: 100 };
      await h.api.refreshFlags();
      assertEq(h.api.soundAllowed, false, 'refreshFlags 应写入读数');
      h.fire();
      await flush();
      assertEq(h.api.quackCount, 0, '静音时不计数');
      assertEq(fetchCount(h, QUACK_FETCH_URL), 0, '静音时连音频都不该去取');
      assertEq(h.api.quackError, null, '静音不是错误');
      h.registry.flags = { sound: true, volume: 100 };
      await h.api.refreshFlags();
      h.fire();
      await flush();
      assertEq(h.api.quackCount, 1, '恢复后点击生效');
    },
  },
  {
    name: '闸门读数失败：flagsError 写明原因、保留上一次读数（仍照常响）',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.fetchImpl = (url) =>
        url === FLAGS_FETCH_URL ? Promise.reject(new Error('flags down')) : Promise.resolve(h.okBlob());
      await h.api.refreshFlags();
      assert(h.api.flagsError && h.api.flagsError.includes('flags down'), 'flagsError 必须写明原因');
      assertEq(h.api.soundAllowed, true, '失败保留上一次读数（默认放行）');
      assert(h.registry.warns.some((w) => w.includes('音效闸门读数失败')), '失败必须 console.warn，不许静默吞');
      h.fire();
      await flush();
      assertEq(h.api.quackCount, 1, '读数失败不该把声音弄哑');
    },
  },
  {
    name: '音量：宿主 0~100 换算成 Audio.volume 0~1',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.flags = { sound: true, volume: 40 };
      await h.api.refreshFlags();
      h.fire();
      await flush();
      assertEq(h.registry.audioInstances.length, 1, 'Audio 已创建');
      assertEq(h.registry.audioInstances[0].volume, 0.4, '音量应换算成 0.4');
    },
  },
  {
    name: '跟不了的原因（V1-49）：/miai/flags.followBlock 透传；非字符串/缺席不动（不摆瞎猜的灰项）',
    fn: async (src) => {
      const h = makeHarness(src);
      assertEq(h.api.followBlock, '', '还没读到前缺省空串（表现为不出灰行）');
      assertEq(h.api.flagsFollowBlock, null, '原始读数初始 null');
      // 第一拍：没资格 + 原因 —— 两格都要写
      h.registry.flags = { sound: true, volume: 80, followEligible: false, followBlock: '饱腹 0%/50%' };
      await h.api.refreshFlags();
      assertEq(h.api.followBlock, '饱腹 0%/50%', '原因原样透传（渲染端不复述门槛）');
      assertEq(h.api.flagsFollowBlock, '饱腹 0%/50%', '原始读数同拍写入');
      assertEq(h.api.followEligible, false, '配套资格同拍写入');
      // 脏值（非字符串）：followBlock 那一格不采纳 —— 保留上一拍，不摆瞎猜的灰项；
      // 资格那一格照常采纳（两格独立判型，互不拖累）
      h.registry.flags = { sound: true, volume: 80, followEligible: true, followBlock: 42 };
      await h.api.refreshFlags();
      assertEq(h.api.followBlock, '饱腹 0%/50%', '非字符串不采纳（保留上一拍）');
      assertEq(h.api.flagsFollowBlock, '饱腹 0%/50%', '原始读数不被脏值污染');
      assertEq(h.api.followEligible, true, '资格照常采纳（判型互不拖累）');
      // 有资格：宿主给空串 —— 覆盖回 ''（灰行该消失）
      h.registry.flags = { sound: true, volume: 80, followEligible: true, followBlock: '' };
      await h.api.refreshFlags();
      assertEq(h.api.followBlock, '', '空串覆盖生效（灰行不许残留）');
      assertEq(h.api.flagsFollowBlock, '', '原始读数同拍清空');
    },
  },

  // ---------------- D. 互动上报口径 ----------------
  {
    name: '互动 POST 失败：actError 写明原因且不计数',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.fetchImpl = (url) => {
        if (url === FLAGS_FETCH_URL) return Promise.resolve(h.okJson({ sound: true, volume: 80 }));
        if (url === PAT_POST_URL) return Promise.reject(new Error('宿主掉线'));
        return Promise.resolve(h.okBlob());
      };
      h.fire();
      h.advance(320);
      await flush();
      assertEq(h.api.patCount, 0, 'POST 失败不计数');
      assert(h.api.actError && h.api.actError.includes('宿主掉线'), 'actError 必须写明原因');
      assert(h.registry.warns.some((w) => w.includes('互动上报失败')), '失败必须 console.warn');
    },
  },
  {
    name: '互动应答 ok!==true（宿主 404 之类）：不计数且 actError 写明',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.actReply = { ok: false, error: 'not-implemented' };
      h.fire();
      h.advance(320);
      await flush();
      assertEq(h.api.patCount, 0, '未受理不计数');
      assert(h.api.actError && h.api.actError.includes('ok!==true'), 'actError 必须写明应答不符');
    },
  },

  // ---------------- E. 右键菜单（挽留悬停 + 黑白主题，2026-10-06 晚） ----------------
  {
    name: '菜单挽留：悬停「关闭大肥鱼」项发一次 /miai/plead；同项内移动不重发；移开再回重发',
    fn: async (src) => {
      const h = makeHarness(src);
      const item = makeMenuItem('关闭大肥鱼');
      h.hover({ target: makeItemChild(item) });
      await flush();
      assertEq(fetchCount(h, PLEAD_POST_URL), 1, '悬停一次的 plead POST 次数');
      assertEq(h.api.menuPleadCount, 1, 'menuPleadCount');
      h.hover({ target: makeItemChild(item) }); // 同一项内（子节点间）再动：mouseover 会连发
      await flush();
      assertEq(fetchCount(h, PLEAD_POST_URL), 1, '同一项内移动不重发');
      h.hover({ target: BLANK_TARGET }); // 移出菜单（去重位清空）
      h.hover({ target: makeItemChild(item) }); // 再次进入同一项 = 新的一次悬停
      await flush();
      assertEq(fetchCount(h, PLEAD_POST_URL), 2, '移开再回来应重发');
      assertEq(h.api.menuPleadCount, 2, 'menuPleadCount 跟随');
      assertEq(h.api.menuPleadError, null, '成功派发不该有 menuPleadError');
    },
  },
  {
    name: '菜单挽留：悬停其他菜单项不发挽留',
    fn: async (src) => {
      const h = makeHarness(src);
      h.hover({ target: makeItemChild(makeMenuItem('摸摸鱼头')) });
      h.hover({ target: makeItemChild(makeMenuItem('重载宠物')) });
      await flush();
      assertEq(fetchCount(h, PLEAD_POST_URL), 0, '非「关闭大肥鱼」项零 POST');
      assertEq(h.api.menuPleadCount, 0, 'menuPleadCount 不动');
    },
  },
  {
    name: '菜单挽留上报失败：menuPleadError 写明原因 + console.warn；计数语义=派发（回包失败不倒退）',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.fetchImpl = (url) =>
        url === PLEAD_POST_URL ? Promise.reject(new Error('宿主掉线')) : Promise.resolve(h.okJson({ ok: true }));
      h.hover({ target: makeItemChild(makeMenuItem('关闭大肥鱼')) });
      await flush();
      assertEq(h.api.menuPleadCount, 1, '派发即计数（受理与否看宿主日志，不在这里翻案）');
      assert(h.api.menuPleadError && h.api.menuPleadError.includes('宿主掉线'), 'menuPleadError 必须写明原因');
      assert(h.registry.warns.some((w) => w.includes('菜单挽留上报失败')), '失败必须 console.warn');
    },
  },
  {
    name: '菜单挽留：BASE 缺失时零 fetch 且 menuPleadError 报 BASE 不可用',
    fn: async (src) => {
      const h = makeHarness(src, { base: null });
      h.hover({ target: makeItemChild(makeMenuItem('关闭大肥鱼')) });
      await flush();
      assertEq(fetchCount(h, PLEAD_POST_URL), 0, 'BASE 缺失不得发起 fetch');
      assertEq(h.api.menuPleadCount, 0, '没派发就不计数');
      assert(h.api.menuPleadError && h.api.menuPleadError.includes('BASE 不可用'), '必须显式报 BASE 不可用');
    },
  },
  {
    name: '菜单主题：读到 dark 挂 html 属性；再读 light 翻回；非 dark 值一律归一为 light',
    fn: async (src) => {
      const h = makeHarness(src);
      await flush(); // 先让加载时的暖缓存那一趟落账（else 测试自己的调用会共用它的 in-flight 链）
      assertEq(h.api.menuTheme, 'light', '初始缺省 light');
      assertEq(lastThemeAttr(h), 'light', '加载即挂缺省属性（菜单出现那一帧就对色）');
      h.registry.fetchImpl = (url) =>
        url === THEME_FETCH_URL ? Promise.resolve(h.okJson({ ok: true, theme: 'dark' })) : Promise.resolve(h.okJson({ ok: true }));
      await h.api.refreshMenuTheme();
      assertEq(h.api.menuTheme, 'dark', 'dark 应采纳');
      assertEq(lastThemeAttr(h), 'dark', '属性应重挂 dark');
      h.registry.fetchImpl = (url) =>
        url === THEME_FETCH_URL ? Promise.resolve(h.okJson({ ok: true, theme: 'blue' })) : Promise.resolve(h.okJson({ ok: true }));
      await h.api.refreshMenuTheme();
      assertEq(h.api.menuTheme, 'light', '非 dark 的怪值一律回 light（渲染端只认 dark 分支）');
      assertEq(lastThemeAttr(h), 'light', '属性翻回 light');
      assertEq(h.api.menuThemeError, null, '成功路径不该有 menuThemeError');
    },
  },
  {
    name: '菜单主题读数失败：保留上一次读数 + menuThemeError 写明；恢复后清空',
    fn: async (src) => {
      const h = makeHarness(src);
      await flush(); // 同前：暖缓存那趟先落账，再种失败（否则两趟共链，测的不是本意）
      h.registry.fetchImpl = (url) =>
        url === THEME_FETCH_URL ? Promise.reject(new Error('theme down')) : Promise.resolve(h.okJson({ ok: true }));
      await h.api.refreshMenuTheme();
      assertEq(h.api.menuTheme, 'light', '失败保留上一次读数');
      assert(h.api.menuThemeError && h.api.menuThemeError.includes('theme down'), 'menuThemeError 写明原因');
      assert(h.registry.warns.some((w) => w.includes('菜单主题读数失败')), '失败必须 console.warn');
      h.registry.fetchImpl = (url) =>
        url === THEME_FETCH_URL ? Promise.resolve(h.okJson({ ok: true, theme: 'dark' })) : Promise.resolve(h.okJson({ ok: true }));
      await h.api.refreshMenuTheme();
      assertEq(h.api.menuThemeError, null, '恢复后清空错误');
      assertEq(h.api.menuTheme, 'dark', '恢复后采纳');
    },
  },
  {
    name: '菜单主题并发：两拍同时调用共用同一趟 fetch（防慢的成功应答清掉新的失败读数）',
    fn: async (src) => {
      const h = makeHarness(src);
      await flush(); // 暖缓存那趟先落账，之后才是本用例的两拍
      const before = fetchCount(h, THEME_FETCH_URL);
      const p1 = h.api.refreshMenuTheme();
      const p2 = h.api.refreshMenuTheme();
      assert(p1 === p2, '第二拍应拿到同一趟的 promise');
      await Promise.all([p1, p2]);
      assertEq(fetchCount(h, THEME_FETCH_URL) - before, 1, '两拍只发一趟 /miai/theme');
      await flush(); // 收口后再拉：新的一拍必须能重新发（守卫不能在成功后把口焊死）
      const before2 = fetchCount(h, THEME_FETCH_URL);
      await h.api.refreshMenuTheme();
      assertEq(fetchCount(h, THEME_FETCH_URL) - before2, 1, '前一趟收口后应能再拉');
    },
  },
  {
    name: '菜单出现触发主题刷新：菜单节点 +1 次 /miai/theme；无关节点不刷',
    fn: async (src) => {
      const h = makeHarness(src);
      await flush(); // 等加载时那次暖缓存 fetch 落账
      const base = fetchCount(h, THEME_FETCH_URL);
      assertEq(h.registry.observers.length, 1, '应注册 1 个 MutationObserver');
      const obs = h.registry.observers[0];
      obs.fire([{ addedNodes: [{ tagName: 'BR' }] }]); // 气泡/动画等无关变动
      await flush();
      assertEq(fetchCount(h, THEME_FETCH_URL), base, '无关节点不该触发主题拉取');
      obs.fire([{ addedNodes: [makeMenuNode()] }]);
      await flush();
      assertEq(fetchCount(h, THEME_FETCH_URL), base + 1, '菜单出现应拉一次主题');
      assertEq(lastThemeAttr(h), 'light', '菜单出现时也应把缓存属性挂上');
    },
  },
  {
    name: '主题样式注入：<style> 进 head，含 dark/light 两组覆写选择器',
    fn: async (src) => {
      const h = makeHarness(src);
      assertEq(h.registry.styleTags.length, 1, '应注入 1 个 style');
      const css = String(h.registry.styleTags[0].textContent || '');
      assert(css.includes('html[data-miai-theme="dark"] .dsh-pet-menu-column'), '必须覆盖深色菜单面板');
      assert(css.includes('html[data-miai-theme="light"] .dsh-pet-menu-column'), '必须覆盖浅色菜单面板');
      assert(css.includes('.dsh-pet-menu-item:hover'), '悬停底色也要跟主题');
      assert(css.includes('backdrop-filter'), '毛玻璃（vendor 白底是实色）');
    },
  },

  // ---------------- F. 饱腹行（P3 ③ 2026-10-08；两段式 2026-10-09） ----------------
  {
    name: '状态行在场：vitals 首拍即采用；菜单打开 → 前插首项、宽度=satiety%、mild 黄、两行固定格式文本',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.state = stateWithVitals(1, { satiety: 73, rice: 12, mood: 'happy', affection: 64 });
      h.advance(500); // 首拍 goto 轮询（GOTO_POLL_OFFSET_MS=500）顺带拉 /state
      await flush();
      assertEq(h.api.vitalsCounter, 1, 'vitals 首拉即采用（不同于 goto 的首拉只记基线）');
      assertEq(h.api.petVitals && h.api.petVitals.satiety, 73, 'vitals 缓存 satiety');
      assertEq(h.api.petVitals && h.api.petVitals.affection, 64, 'vitals 缓存 affection（V2-23：以前在这步被丢）');
      assertEq(h.api.menuHungerBars, 0, '菜单没开时不许插条');
      const { root, panel } = mountMenu(h);
      menuAppeared(h, root);
      const bar = panel.querySelector('.miai-hunger-bar');
      assert(bar, '菜单出现且读数在 → 必须插条');
      assertEq(panel.children[0], bar, '条必须是首项（插在既有菜单项之前）');
      assertEq(panel.children[1].classList.contains('dsh-pet-menu-item'), true, '菜单项还在，只是被挤到后面');
      // 三段式结构：label 在上、track>fill 居中、读数行在下（契约点名的三段顺序）
      assertEq(bar.children.length, 3, '根节点三段：label + track + 读数行');
      assertEq(bar.children[0].classList.contains('miai-hunger-label'), true, '第一段是标签（在条上方）');
      assertEq(bar.children[1].classList.contains('miai-hunger-track'), true, '第二段是轨道');
      assertEq(bar.children[2].classList.contains('miai-vitals-line'), true, '第三段是读数行（V2-23）');
      assertEq(bar.querySelector('.miai-hunger-track').children[0].classList.contains('miai-hunger-fill'), true, '填充在轨道内');
      assertEq(bar.querySelector('.miai-hunger-fill').style.width, '73%', '填充宽度 = satiety 换算值');
      assertEq(bar.querySelector('.miai-hunger-fill').style.background, '#c9b32a', '73 属 mild 档（≥50 <80）→ 黄');
      const texts = textsOf(bar);
      assertEq(texts.length, 2, '三段式里两行文本：标签 + 读数行（图形段不带文本）');
      assert(/^🍚 饱腹度：\d+%$/.test(texts[0]), `标签必须是固定格式「🍚 饱腹度：N%」（实际 ${JSON.stringify(texts[0])}）`);
      assertEq(texts[0], '🍚 饱腹度：73%', '标签文本与宽度同源（同一发读数、同一个 hungerPercent）');
      assertEq(texts[1], '🍙 大白饭 12 碗 · ❤ 好感度 64%', '读数行固定格式且与读数同源（V2-23）');
      assertEq(h.api.menuHungerBars, 1, '前插计数');
      assertEq(h.api.menuHungerSkips, 0, '有读数不该走 skip');
      assertEq(h.api.menuHungerError, null, '构建路径不该有 menuHungerError');
      assertEq(h.api.menuHungerReclamps, 0, '大窗（800）不越界：不该动面板位置');
      menuAppeared(h, root); // 同一面板再来一拍（vendor 其它变动也会触发回调）：幂等，不重插
      assertEq(h.api.menuHungerBars, 1, '同面板只许 1 条');
      assertEq(panel.children.filter((c) => c.classList.contains('miai-hunger-bar')).length, 1, '面板里就一条');
    },
  },
  {
    name: '读数行（V2-23）：affection 随叶子透传 api.petVitals；缺席/坏值画占位（好感 --%、大白饭 --），不编 0',
    fn: async (src) => {
      // 臂 1：宿主旧版没带 affection（rice 在）→ 透传到 api（undefined 也是读数的一部分），行内画 --%
      const h = makeHarness(src);
      h.registry.state = stateWithVitals(1, { satiety: 60, rice: 7, mood: 'happy' });
      h.advance(500);
      await flush();
      assertEq(h.api.petVitals.affection, undefined, 'affection 缺失原样透传（不许补 0）');
      const m1 = mountMenu(h);
      menuAppeared(h, m1.root);
      const line1 = m1.panel.querySelector('.miai-vitals-line');
      assert(line1, '读数行必须在');
      assertEq(line1.textContent, '🍙 大白饭 7 碗 · ❤ 好感度 --%', 'affection 缺席 → --%（还没读到 ≠ 0，同侧栏口径）');
      // 臂 2：rice 也缺 → 大白饭位画 --（不带单位）
      const h2 = makeHarness(src);
      h2.registry.state = stateWithVitals(1, { satiety: 60, mood: 'happy' });
      h2.advance(500);
      await flush();
      const m2 = mountMenu(h2);
      menuAppeared(h2, m2.root);
      assertEq(
        m2.panel.querySelector('.miai-vitals-line').textContent,
        '🍙 大白饭 -- 碗 · ❤ 好感度 --%',
        'rice 缺席同样画占位',
      );
    },
  },
  {
    name: 'vitals 缺 ⇒ 不摆坏行：叶子没有 / data 为空都只记 skip，零条、首项仍是菜单项',
    fn: async (src) => {
      // 臂 1：/state 里根本没有 vitals 叶子（宿主旧版/还没启用）
      const h1 = makeHarness(src);
      h1.registry.state = { pets: { main: { goto: { counter: 0, data: null } } } };
      h1.advance(500);
      await flush();
      assertEq(h1.api.petVitals, null, '读不到 vitals 不许编一份');
      assertEq(h1.api.vitalsError, null, '叶子缺失不是「读数失败」（合法形状，不该报错）');
      const m1 = mountMenu(h1);
      menuAppeared(h1, m1.root);
      assertEq(h1.api.menuHungerBars, 0, 'vitals 缺失不许摆条（不是画一条 0% 的豁口）');
      assertEq(h1.api.menuHungerSkips, 1, '跳过必须可归因（skip 计数）');
      assertEq(m1.panel.children[0].classList.contains('dsh-pet-menu-item'), true, '首项必须还是菜单项');
      assertEq(m1.panel.querySelector('.miai-hunger-bar'), null, '面板里一条都没有');
      // 臂 2：vitals 叶子在但 data 是 null（宿主叶子还没写过）→ 同样不摆
      const h2 = makeHarness(src);
      h2.registry.state = { pets: { main: { goto: { counter: 0, data: null }, vitals: { counter: 0, data: null } } } };
      h2.advance(500);
      await flush();
      const m2 = mountMenu(h2);
      menuAppeared(h2, m2.root);
      assertEq(h2.api.menuHungerBars, 0, 'data=null 同样不许摆条');
      assertEq(h2.api.menuHungerSkips, 1, '同样必须可归因');
    },
  },
  {
    name: '读数更新（counter+1）：在场条只上色不重插；菜单重开则新面板各一条',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.state = stateWithVitals(1, { satiety: 73, rice: 12, mood: 'happy', affection: 64 });
      h.advance(500);
      await flush();
      const { root, panel } = mountMenu(h);
      menuAppeared(h, root);
      assertEq(h.api.menuHungerBars, 1, '第一轮：一条');
      h.registry.state = stateWithVitals(2, { satiety: 96, rice: 13, mood: 'happy', affection: 71 });
      h.advance(1000); // 下一拍轮询
      await flush();
      assertEq(h.api.vitalsCounter, 2, '第二拍应读到 counter 2');
      assertEq(h.api.menuHungerBars, 1, '读数更新是上色，不是重插');
      const bar = panel.querySelector('.miai-hunger-bar');
      assertEq(bar.querySelector('.miai-hunger-fill').style.width, '96%', '宽度跟上读数');
      assertEq(bar.querySelector('.miai-hunger-fill').style.background, '#34c759', '96 属 full 档 → 绿');
      assertEq(bar.querySelector('.miai-hunger-label').textContent, '🍚 饱腹度：96%', '标签跟上读数');
      assertEq(bar.querySelector('.miai-vitals-line').textContent, '🍙 大白饭 13 碗 · ❤ 好感度 71%', '读数行跟上读数（V2-23）');
      root.remove(); // 菜单重开：旧 root 撤、新 root 挂
      const again = mountMenu(h);
      menuAppeared(h, again.root);
      assertEq(h.api.menuHungerBars, 2, '新面板应补一条（每条面板各一条）');
      assertEq(again.panel.children[0], again.panel.querySelector('.miai-hunger-bar'), '新面板首项也是条');
    },
  },
  {
    name: '重钳读可见带：视口≠clamp（clamp 高 202 → top 70、底 ≤198）；不越界不动；读数缺席回落视口（计数+warn）',
    fn: async (src) => {
      // 臂 1：视口 250、clamp 可见带高 202（比视口矮 48 —— helper 窗探出屏幕的真实形状）、
      // 面板注入前 74 高、top=172（底边 246，已越过可见带下缘 198）——注入 54 高的状态行后
      // 必须按 **clamp** 重钳。拿 innerHeight 当上界（旧实现）会停在 118、底边 246 出带（图三原样）。
      const h1 = makeHarness(src, { innerHeight: 250 });
      h1.registry.state = stateWithVitals(1, { satiety: 40, rice: 5, mood: 'happy' });
      h1.advance(500);
      await flush();
      const m1 = mountMenu(h1, { top: '172px', clamp: { x: 0, y: 0, w: 400, h: 202 } });
      assertEq(m1.panel.offsetHeight, 74, '注入前面板高度（padding 8 + 3×22）');
      menuAppeared(h1, m1.root);
      assertEq(m1.panel.offsetHeight, 128, '注入后撑高 54（正是"后插撑高"要治的）');
      assertEq(h1.api.menuHungerReclamps, 1, '越界应重钳一次');
      const bottom1 = m1.panel.getBoundingClientRect().top + m1.panel.offsetHeight;
      assert(bottom1 <= 202 - 4, `面板底边必须留在可见带内（bottom=${bottom1}，可见带下缘 198）`);
      assertEq(m1.panel.style.top, '70px', '重钳后 top = 可见带底 − 4 − 高（70，不是视口口径的 118）');
      assertEq(h1.api.menuReclampFallbacks, 0, 'clamp 读数在场：不许走回落路径');
      // 臂 2：同一 clamp 带内不越界（top=20，底边 148 ≤ 198）—— 不许乱动（no-op 路径必须真 no-op）
      const h2 = makeHarness(src, { innerHeight: 250 });
      h2.registry.state = stateWithVitals(1, { satiety: 40, rice: 5, mood: 'happy' });
      h2.advance(500);
      await flush();
      const m2 = mountMenu(h2, { top: '20px', clamp: { x: 0, y: 0, w: 400, h: 202 } });
      menuAppeared(h2, m2.root);
      assertEq(h2.api.menuHungerBars, 1, '条照样在');
      assertEq(m2.panel.style.top, '20px', '不越界不许动 top');
      assertEq(h2.api.menuHungerReclamps, 0, '没钳制就不计数');
      // 臂 3：菜单根没有 clamp 读数（旧 vendor / 补丁没铺）→ 只许回落视口，且必须计数 + 留一条 warn：
      // 旧的"静默拿 vh 装成功"正是要杜绝的（读数坏掉时谁也不知道，底行继续出屏）
      const h3 = makeHarness(src, { innerHeight: 250 });
      h3.registry.state = stateWithVitals(1, { satiety: 40, rice: 5, mood: 'happy' });
      h3.advance(500);
      await flush();
      const m3 = mountMenu(h3, { top: '172px' }); // 无 clamp：读数缺席
      menuAppeared(h3, m3.root);
      assertEq(h3.api.menuHungerReclamps, 1, '回落视口也要真钳（top 172 → 118）');
      assertEq(m3.panel.style.top, '118px', '回落口径 = 视口 − 4 − 高');
      assertEq(h3.api.menuReclampFallbacks, 1, '回落必须可归因（menuReclampFallbacks 计数）');
      assert(
        h3.registry.warns.some((w) => w.includes('可见带读数缺席')),
        `回落必须留日志（warns=${JSON.stringify(h3.registry.warns)}）`,
      );
    },
  },
  {
    name: '档界常量与 pet.ts 对账：HUNGER_*_AT 逐值相等（改一处即红）',
    fn: async (src) => {
      const petSrc = readFileSync(join(HERE, '..', '..', 'src', 'shared', 'pet.ts'), 'utf8');
      const pick = (re, text, tag) => {
        const m = re.exec(text);
        assert(m, `${tag} 找不到`);
        return Number(m[1]);
      };
      // 尺子自证 ①：pet.ts 的真值先按人眼已知数对一遍（读空/读错文件会先在这里红）
      assertEq(pick(/PET_HUNGER_FULL_AT\s*=\s*(\d+)/, petSrc, 'pet.ts PET_HUNGER_FULL_AT'), 80, '尺子自证：full 档界');
      // 尺子自证 ②：编造的常量名必须找不到（防"正则松到随便命中"）
      assertEq(/PET_NO_SUCH_AT\s*=\s*(\d+)/.exec(petSrc), null, '尺子自证：编造常量名不许命中');
      for (const tag of ['FULL', 'MILD', 'MEDIUM', 'SEVERE']) {
        const want = pick(new RegExp(`PET_HUNGER_${tag}_AT\\s*=\\s*(\\d+)`), petSrc, `pet.ts PET_HUNGER_${tag}_AT`);
        const got = pick(new RegExp(`HUNGER_${tag}_AT\\s*=\\s*(\\d+)`), src, `miai-extras HUNGER_${tag}_AT`);
        assertEq(got, want, `HUNGER_${tag}_AT 与 pet.ts 的 PET_HUNGER_${tag}_AT 漂移`);
      }
    },
  },
  {
    name: 'vitals 坏读数（satiety 非有限数）：保留上一次读数 + vitalsError 写明；恢复后清空',
    fn: async (src) => {
      const h = makeHarness(src);
      h.registry.state = stateWithVitals(1, { satiety: 73, rice: 12, mood: 'happy' });
      h.advance(500);
      await flush();
      assertEq(h.api.petVitals.satiety, 73, '先有一份好读数');
      h.registry.state = stateWithVitals(2, { satiety: 'nope', rice: 12, mood: 'happy' });
      h.advance(1000);
      await flush();
      assert(h.api.vitalsError && h.api.vitalsError.includes('satiety'), 'vitalsError 必须写明原因');
      assert(h.registry.warns.some((w) => w.includes('vitals 读数失败')), '由好转坏必须 console.warn');
      assertEq(h.api.petVitals.satiety, 73, '坏读数不许覆盖旧读数（也不摆坏行）');
      h.registry.state = stateWithVitals(3, { satiety: 42, rice: 12, mood: 'happy' });
      h.advance(1000);
      await flush();
      assertEq(h.api.vitalsError, null, '恢复后清空错误');
      assertEq(h.api.petVitals.satiety, 42, '恢复后采纳新读数');
    },
  },

  // ---------------- G. 跟随 / 关闭挽留 / 漫游闸门（2026-10-09 补充模块一、二） ----------------
  {
    name: '跟随叶子：首拉即采用 → 逐帧趋近收窄 → 到位 ≤3px 收帧并记 customPos',
    fn: async (src) => {
      const { h, sp, calls } = makeSpriteHarness(src);
      assertEq(h.api.followOn, false, '叶子没读到前不跟随');
      h.registry.state = stateWithFollow(1, { on: true, x: 400, y: 300 });
      h.advance(500);
      await flush();
      assertEq(h.api.followOn, true, '首拉即采用（观测语义：读到的 on:true 就是事实）');
      assertEq(h.api.followTarget.x, 400, '落点 x 原样');
      assertEq(h.api.followTarget.y, 300, '落点 y 原样');
      assertEq(h.api.followMoving, true, '叶子应用即起趋近帧');
      assertEq(h.rafPending(), 1, '只有一条帧在烧（不叠第二条）');
      assertEq(h.api.followError, null, '正常起帧清掉历史失败');
      // 逐帧步进：每一帧的落点与目标（鱼中心 400,300）的距离必须单调收窄
      const distAt = (xy) => Math.hypot(xy[0] + 64 - 400, xy[1] + 64 - 300);
      let prev = distAt([sp.pos.x, sp.pos.y]);
      assert(prev > 300, `起点 (64,64) 应离目标很远（实际 ${prev}）`);
      let framesRan = 0;
      for (let i = 0; i < 400 && h.rafPending(); i++) {
        const n0 = calls.sendBounds.length;
        h.frame(16);
        framesRan++;
        if (calls.sendBounds.length > n0) {
          const d = distAt(calls.sendBounds[calls.sendBounds.length - 1]);
          assert(d < prev, `第 ${i} 帧距离应收窄（前 ${prev}，后 ${d}）`);
          prev = d;
        }
      }
      assertEq(h.rafPending(), 0, '到位应收帧（不逐帧空烧）');
      assertEq(h.api.followMoving, false, '到位后 followMoving=false');
      assert(
        prev < 3.01,
        `停在 ≤3px（实际 ${prev}；帧数 ${framesRan}，位移 ${calls.sendBounds.length}，` +
          `followError=${h.api.followError}，paused=${h.api.followPaused}，warns=${JSON.stringify(h.registry.warns)}）` +
          ` 尾迹=${JSON.stringify(calls.sendBounds.slice(-6).map(distAt))} 头迹=${JSON.stringify(calls.sendBounds.slice(0, 6).map(distAt))}` +
          ` pos=${JSON.stringify(sp.pos)} target=${JSON.stringify(h.api.followTarget)} 末点=${JSON.stringify(calls.sendBounds[calls.sendBounds.length - 1])}`,
      );
      assertEq(calls.sendBounds.length, h.api.followSteps, 'followSteps = 真实位移帧数');
      assert(Math.abs(sp.customPos.rx * 1000 - (sp.pos.x + 64)) < 1e-9, 'customPos 记的就是停下的地方（横向）');
      assert(Math.abs(sp.customPos.ry * 800 - (sp.pos.y + 64)) < 1e-9, 'customPos 记的就是停下的地方（纵向）');
      assert(Math.abs(sp.customPos.rx * 1000 - 400) <= 3.01, '换算回屏幕 DIP ≈ 落点 x');
      assert(Math.abs(sp.customPos.ry * 800 - 300) <= 3.01, '换算回屏幕 DIP ≈ 落点 y');
    },
  },
  {
    name: '跟随暂停守卫：拖拽中不起帧也不改 followOn；途中拖拽立即收帧；松手后轮询拍兜底重起',
    fn: async (src) => {
      const { h, sp, calls } = makeSpriteHarness(src, { sprite: { x: 200, y: 200 } });
      sp.dragState.active = true; // 用户正抓着鱼
      h.registry.state = stateWithFollow(1, { on: true, x: 400, y: 300 });
      h.advance(500);
      await flush();
      // 阶段 A：一起步就被守卫挡下
      assertEq(h.api.followOn, true, '守卫只挡位移，不改 followOn（菜单标签不许翻）');
      assertEq(h.api.followPaused, true, '暂停读数应为 true');
      assertEq(h.api.followMoving, false, '拖拽中不起趋近帧');
      assertEq(h.rafPending(), 0, '零帧');
      assertEq(calls.sendBounds.length, 0, '零位移');
      // 阶段 B：松手 → 下一拍轮询兜底重起 → 真的逐帧动起来
      sp.dragState.active = false;
      h.advance(1000);
      await flush();
      assertEq(h.api.followPaused, false, '松手后暂停读数翻回');
      assertEq(h.api.followMoving, true, '轮询拍兜底重起');
      for (let i = 0; i < 4; i++) h.frame(16);
      assert(calls.sendBounds.length >= 4, `松手后应逐帧位移（实际 ${calls.sendBounds.length}）`);
      // 阶段 C：途中再拖 → 帧体守卫立即收帧（停在哪记哪，followOn 仍不翻）
      sp.dragState.active = true;
      h.frame(16);
      assertEq(h.api.followPaused, true, '途中拖拽 → 暂停读数 true');
      assertEq(h.api.followMoving, false, '途中拖拽应立即收帧');
      assertEq(h.rafPending(), 0, '收帧后零挂起');
      const frozen = calls.sendBounds.length;
      for (let i = 0; i < 5; i++) h.frame(16);
      assertEq(calls.sendBounds.length, frozen, '守卫期间不许再位移');
      assertEq(h.api.followOn, true, '守卫期间 followOn 仍是 true');
      assert(sp.customPos && typeof sp.customPos.rx === 'number', '收帧时把停下的地方记进 customPos');
      // 阶段 D：再松手 → 再起 → 位置继续朝目标收窄（"到位"归 G1 管，这里只看重启）
      sp.dragState.active = false;
      h.advance(1000);
      await flush();
      assertEq(h.api.followMoving, true, '再次兜底重起');
      for (let i = 0; i < 4; i++) h.frame(16);
      assert(calls.sendBounds.length > frozen, '重起后真在动');
      const distOf = (xy) => Math.hypot(xy[0] + 64 - 400, xy[1] + 64 - 300);
      const first = calls.sendBounds[0];
      const last = calls.sendBounds[calls.sendBounds.length - 1];
      assert(distOf(last) < distOf(first), '重起后位置应比最初更接近目标');
    },
  },
  {
    name: '跟随 off 叶子：收帧 + 停在哪记哪；此后不再烧帧',
    fn: async (src) => {
      const { h, sp, calls } = makeSpriteHarness(src);
      h.registry.state = stateWithFollow(1, { on: true, x: 400, y: 300 });
      h.advance(500);
      await flush();
      for (let i = 0; i < 3; i++) h.frame(16); // 先走到半路
      assertEq(calls.sendBounds.length, 3, '前置：3 帧走了 3 步');
      const mid = calls.sendBounds[2];
      h.registry.state = stateWithFollow(2, { on: false, x: 0, y: 0 });
      h.advance(1000);
      await flush();
      assertEq(h.api.followOn, false, 'off 叶子 → followOn=false');
      assertEq(h.api.followTarget, null, '目标清空');
      assertEq(h.api.followMoving, false, '收帧');
      assertEq(h.api.followError, null, '正常读到一条 off：链路健康（不算失败）');
      const frozen = calls.sendBounds.length;
      for (let i = 0; i < 5; i++) h.frame(16);
      assertEq(calls.sendBounds.length, frozen, 'off 之后不再产生位移');
      assertEq(h.rafPending(), 0, '零挂起帧');
      assert(Math.abs(sp.customPos.rx * 1000 - (mid[0] + 64)) < 1e-9, '停在哪记哪（横向 = 半路落点）');
      assert(Math.abs(sp.customPos.ry * 800 - (mid[1] + 64)) < 1e-9, '停在哪记哪（纵向）');
    },
  },
  {
    name: '轮询节奏自适应：跟随生效 120ms 一拍 / 平时 1000ms（119/999 不出、120/1000 出）',
    fn: async (src) => {
      const { h } = makeSpriteHarness(src);
      h.advance(500);
      await flush();
      assertEq(fetchCount(h, STATE_FETCH_URL), 1, '第一拍在 GOTO_POLL_OFFSET_MS=500');
      h.advance(999);
      await flush();
      assertEq(fetchCount(h, STATE_FETCH_URL), 1, '平时节奏：差 1ms 不出新拍');
      h.advance(1);
      await flush();
      assertEq(fetchCount(h, STATE_FETCH_URL), 2, '满 1000ms 出新拍');
      // 跟随生效（follow 叶子 on）→ 收到 120ms 一拍（落点跟手）
      h.registry.state = stateWithFollow(1, { on: true, x: 400, y: 300 });
      h.advance(1000);
      await flush();
      const at = fetchCount(h, STATE_FETCH_URL);
      assertEq(h.api.followOn, true, '前置：跟随已生效');
      assertEq(at, 3, '前置：第 3 拍已到');
      h.advance(119);
      await flush();
      assertEq(fetchCount(h, STATE_FETCH_URL), at, '跟随生效：差 1ms 不出新拍');
      h.advance(1);
      await flush();
      assertEq(fetchCount(h, STATE_FETCH_URL), at + 1, '满 120ms 出新拍（自适应生效）');
    },
  },
  {
    name: '挽留 go：body 钳位（命中区在屏、窗可探出）→ parked + 回执 {seq,phase:go}',
    fn: async (src) => {
      const { h, sp, calls } = makeSpriteHarness(src, { sprite: { x: 100, y: 100 } });
      const posts = captureRecallPosts(h);
      h.registry.state = stateWithRecall(0, null);
      h.advance(500);
      await flush();
      assertEq(h.api.recallState, 'idle', '首拉只记基线（事件语义）');
      h.registry.state = stateWithRecall(1, { seq: 7, phase: 'go', x: 944, y: 65 });
      h.advance(1000);
      await flush();
      assertEq(h.api.recallState, 'going', 'counter 变了 → 出发');
      assertEq(h.api.chaseActive, true, '走路进行中');
      assertEq(h.rafPending(), 1, '一条 rAF 在烧');
      assertEq(h.api.recallGoArrived, 0, '还没到位');
      for (let i = 0; i < 400 && h.rafPending(); i++) h.frame(16);
      assertEq(h.rafPending(), 0, '到位收帧');
      assertEq(h.api.recallState, 'parked', 'go 到位 → parked（宿主随即播撒娇动画）');
      assertEq(h.api.recallGoArrived, 1, '到位计数 1');
      assertEq(h.api.recallAborts, 0, '零中止');
      assertEq(h.api.chaseActive, false, '走路结束');
      assert(calls.sendBounds.length > 10, '确实是"走"过去的（多帧）');
      // body 钳位分水岭：只保证命中区在屏（窗可以探出屏外）；误用 window 钳位会落 (736, 8)
      assertEq(sp.pos.x, 880, 'body 钳位落点 x=880（window 钳位会钳成 736）');
      assertEq(sp.pos.y, 1, 'body 钳位落点 y=1（window 钳位会钳成 8）');
      assert(Math.abs(sp.customPos.rx - 944 / 1000) < 1e-9, 'customPos = 到位中心（横向）');
      assert(Math.abs(sp.customPos.ry - 65 / 800) < 1e-9, 'customPos = 到位中心（纵向）');
      await flush();
      assertEq(posts.length, 1, '回执一次');
      assertEq(posts[0].seq, 7, '回执 seq 原样');
      assertEq(posts[0].phase, 'go', '回执 phase=go');
    },
  },
  {
    name: '挽留 back：回原处（body 钳位）→ customPos 原样还原 → idle + 回执 {seq,phase:back}',
    fn: async (src) => {
      const origCustom = { rx: 0.25, ry: 0.75 };
      const { h, sp } = makeSpriteHarness(src, { sprite: { x: 100, y: 100, customPos: origCustom } });
      const posts = captureRecallPosts(h);
      h.registry.state = stateWithRecall(0, null);
      h.advance(500);
      await flush();
      h.registry.state = stateWithRecall(1, { seq: 7, phase: 'go', x: 944, y: 65 });
      h.advance(1000);
      await flush();
      for (let i = 0; i < 400 && h.rafPending(); i++) h.frame(16);
      assertEq(h.api.recallState, 'parked', '前置：先停靠到关闭键旁');
      assertEq(h.api.recallGoArrived, 1, '前置：go 段已到位');
      h.registry.state = stateWithRecall(2, { seq: 8, phase: 'back' });
      h.advance(1000);
      await flush();
      assertEq(h.api.recallState, 'backing', 'counter 变了 → 归位');
      for (let i = 0; i < 400 && h.rafPending(); i++) h.frame(16);
      assertEq(h.rafPending(), 0, '到位收帧');
      assertEq(h.api.recallState, 'idle', 'back 到位 → idle');
      assertEq(h.api.recallBackArrived, 1, '到位计数 1');
      assertEq(h.api.recallAborts, 0, '零中止');
      assertEq(sp.pos.x, 100, '回到出发前的原处 x（body 钳位不改原处落点）');
      assertEq(sp.pos.y, 100, '回到出发前的原处 y');
      assertEq(sp.customPos.rx, 0.25, 'customPos 原样还原（不是本次走位）');
      assertEq(sp.customPos.ry, 0.75, '同上（纵向）');
      assert(sp.customPos !== origCustom, '还原的是拷贝（不共享对象）');
      await flush();
      assertEq(posts.length, 2, '两段各回执一次');
      assertEq(posts[1].seq, 8, 'back 回执 seq 原样');
      assertEq(posts[1].phase, 'back', 'back 回执 phase=back');
    },
  },
  {
    name: '挽留 back·贴底原处：回程 body 钳位精确回 pos.y=600（误用 window 钳位会钳到 536）',
    fn: async (src) => {
      // 第 9 轮 G8b 桌面实测的固化：跟随把鱼带到工作区下缘是常态（命中区在屏即可，
      // 窗可有一截在屏外），记下的原处因此**不满足** window 档。本夹具原处 pos.y=600：
      // 超 window 档上界 536（800−8−256−0）、但在 body 档上界 671（800−8−64−57）内。
      // 回程若误用缺省 window 钳位，归位点会缺 64 DIP（600→536）——G8b 那 237 DIP
      // 的真身就是这个语义，只是桌面上的缺口更大。
      const { h, sp } = makeSpriteHarness(src, { sprite: { x: 100, y: 600 } });
      const posts = captureRecallPosts(h);
      h.registry.state = stateWithRecall(0, null);
      h.advance(500);
      await flush();
      h.registry.state = stateWithRecall(1, { seq: 11, phase: 'go', x: 400, y: 300 });
      h.advance(1000);
      await flush();
      for (let i = 0; i < 400 && h.rafPending(); i++) h.frame(16);
      assertEq(h.api.recallState, 'parked', '前置：先停靠到关闭键旁');
      assertEq(h.api.recallGoArrived, 1, '前置：go 段已到位');
      h.registry.state = stateWithRecall(2, { seq: 12, phase: 'back' });
      h.advance(1000);
      await flush();
      assertEq(h.api.recallState, 'backing', 'counter 变了 → 归位');
      for (let i = 0; i < 400 && h.rafPending(); i++) h.frame(16);
      assertEq(h.rafPending(), 0, '到位收帧');
      assertEq(h.api.recallState, 'idle', 'back 到位 → idle');
      assertEq(h.api.recallBackArrived, 1, '到位计数 1');
      assertEq(h.api.recallAborts, 0, '零中止');
      assertEq(sp.pos.x, 100, '精确回原处 x');
      assertEq(sp.pos.y, 600, '精确回原处 y=600（window 钳位会落 536）');
      await flush();
      assertEq(posts.length, 2, '两段各回执一次');
      assertEq(posts[1].seq, 12, 'back 回执 seq 原样');
      assertEq(posts[1].phase, 'back', 'back 回执 phase=back');
    },
  },
  {
    name: '挽留走不成当没发生：出发即拒/途中打断 → aborts 计数、零回执；看门狗下一拍归零',
    fn: async (src) => {
      const { h, sp, calls } = makeSpriteHarness(src, { sprite: { x: 100, y: 100 } });
      const posts = captureRecallPosts(h);
      h.registry.state = stateWithRecall(0, null);
      h.advance(500);
      await flush();
      // 臂 1：出发即拒（用户正拖着鱼）
      sp.dragState.active = true;
      h.registry.state = stateWithRecall(1, { seq: 9, phase: 'go', x: 400, y: 300 });
      h.advance(1000);
      await flush();
      assertEq(h.api.recallState, 'idle', '走不成 → 状态直接归零');
      assertEq(h.api.recallAborts, 1, '中止计数 1');
      assertEq(h.api.chaseActive, false, '没有在走');
      assertEq(h.rafPending(), 0, '零帧');
      assertEq(calls.sendBounds.length, 0, '零位移');
      assertEq(sp.customPos, null, '拒绝的 walkTo 不许写 customPos');
      assertEq(posts.length, 0, '绝不编造到达回执');
      // 臂 2：途中被拖拽打断 → walkTo 取消路径不动状态，看门狗下一拍归零
      sp.dragState.active = false;
      h.registry.state = stateWithRecall(2, { seq: 10, phase: 'go', x: 400, y: 300 });
      h.advance(1000);
      await flush();
      assertEq(h.api.recallState, 'going', '第二段出发了');
      for (let i = 0; i < 3; i++) h.frame(16);
      assert(calls.sendBounds.length >= 3, '已在途中');
      sp.dragState.active = true; // 用户抓住它
      h.frame(16); // 帧体见拖拽 → cancelChase（不写 customPos、不回执）
      assertEq(h.api.chaseActive, false, '途中拖拽 → 立即中止');
      assertEq(h.rafPending(), 0, '中止后零帧');
      assertEq(h.api.recallState, 'going', '取消路径不动状态（等看门狗收尾）');
      const frozen = calls.sendBounds.length;
      for (let i = 0; i < 5; i++) h.frame(16);
      assertEq(calls.sendBounds.length, frozen, '中止后不再位移');
      h.advance(1000);
      await flush();
      assertEq(h.api.recallState, 'idle', '看门狗把状态归零');
      assertEq(h.api.recallAborts, 2, '中止计数 2');
      assertEq(posts.length, 0, '全程零回执');
    },
  },
  {
    name: '漫游闸门·分档节流：首掷放行即记账；severe 180s 窗内必拦、到点放行（179999/180000 边界）',
    fn: async (src) => {
      const { h, sp, calls } = makeSpriteHarness(src);
      assertEq(h.api.roamGated, true, '启动即装上闸门（精灵在场）');
      h.registry.state = stateWithVitals(1, { satiety: 10, rice: 5, mood: 'hungry' });
      h.advance(500);
      await flush();
      assertEq(h.api.petVitals.satiety, 10, '前置：重度饥饿读数已在（1-19 档）');
      assertEq(sp.tryMove(), true, '首掷放行（返回 true = tryMove 受理语义）');
      assertEq(calls.tryMove.length, 1, '首掷原函数被真的调到');
      const base = h.api.lastRoamAt;
      assert(base > 0, '放行即记基准（分档节流的记账点）');
      sp.tryMove();
      assertEq(calls.tryMove.length, 1, '紧接着再掷：窗内必拦');
      assertEq(h.api.roamSuppressed, 1, '拦截计数 1');
      h.advance(60000);
      await flush();
      h.advance(60000);
      await flush();
      h.advance(59999);
      await flush();
      sp.tryMove();
      assertEq(calls.tryMove.length, 1, '差 1ms 仍拦（179999 < 180000）');
      assertEq(h.api.roamSuppressed, 2, '拦截计数 2');
      h.advance(1);
      await flush();
      sp.tryMove();
      assertEq(calls.tryMove.length, 2, '满 180s 放行');
      assertEq(h.api.lastRoamAt, base + 180000, '放行刷新基准（窗起点后移）');
      // 分档：中度（20-49）窗是 90s —— 换新沙箱（不欠旧窗口的账）
      const rig2 = makeSpriteHarness(src);
      rig2.h.registry.state = stateWithVitals(1, { satiety: 30, rice: 5, mood: 'ok' });
      rig2.h.advance(500);
      await flush();
      assertEq(rig2.h.api.petVitals.satiety, 30, '前置：中度饥饿读数（20-49 档）');
      rig2.sp.tryMove();
      assertEq(rig2.calls.tryMove.length, 1, '中度档首掷放行');
      rig2.h.advance(45000);
      await flush();
      rig2.h.advance(44999);
      await flush();
      rig2.sp.tryMove();
      assertEq(rig2.calls.tryMove.length, 1, '中度档 89999ms 仍拦');
      rig2.h.advance(1);
      await flush();
      rig2.sp.tryMove();
      assertEq(rig2.calls.tryMove.length, 2, '中度档满 90s 放行');
    },
  },
  {
    name: '漫游闸门·六判据：挽留/跑腿/跟随/总闸/归零必拦，vitals 缺失放行；指名 tryMove(name) 不受管',
    fn: async (src) => {
      const { h, sp, calls } = makeSpriteHarness(src);
      assertEq(h.api.roamGated, true, '启动即装上闸门');
      assertEq(h.api.petVitals, null, '前置：还没有 vitals 读数');
      const n = () => calls.tryMove.length;
      const blocked = (label) => {
        const before = n();
        const s = h.api.roamSuppressed;
        assertEq(sp.tryMove(), true, `${label}：拦下必须返回 true（playIdle 原地踏步语义）`);
        assertEq(n(), before, `${label}：原函数不许被调`);
        assertEq(h.api.roamSuppressed, s + 1, `${label}：拦截计数 +1`);
      };
      const allowed = (label) => {
        const before = n();
        sp.tryMove();
        assertEq(n(), before + 1, `${label}：原函数应被调到`);
      };
      // 读数缺失（vitals 还没到）：放行 —— 宁可先照旧，也别让鱼在首拉前冻住
      allowed('vitals 缺失');
      h.api.recallState = 'parked';
      blocked('挽留在停靠');
      h.api.recallState = 'idle';
      allowed('挽留解除');
      h.api.chaseActive = true;
      blocked('跑腿在飞');
      h.api.chaseActive = false;
      allowed('跑腿结束');
      h.api.followOn = true;
      blocked('跟随生效');
      h.api.followOn = false;
      allowed('跟随关闭');
      h.api.roamAllowed = false;
      blocked('总闸关');
      h.api.roamAllowed = true;
      allowed('总闸开');
      h.api.petVitals = { satiety: 0, rice: 0, mood: 'empty' };
      blocked('饱腹度归零（趴窝）');
      h.api.petVitals = null;
      allowed('读数清空又放行');
      // 指名 tryMove(name) = 菜单点播的用户命令：总闸关 + 归零都拦不住它
      h.api.roamAllowed = false;
      h.api.petVitals = { satiety: 0, rice: 0, mood: 'empty' };
      sp.tryMove('sit');
      assertEq(calls.tryMove[n() - 1], 'sit', '指名调用直通原函数（闸门只拦无参漫游）');
      h.api.roamAllowed = true;
      h.api.petVitals = null;
    },
  },
  {
    name: 'HIT_HALF_*_RATIO 与 host.ts 对账：命中区比例逐值相等（跟随/挽留共用钳位口径）',
    fn: async (src) => {
      const hostSrc = readFileSync(join(HERE, '..', '..', 'src', 'main', 'dshpet', 'host.ts'), 'utf8');
      const pick = (re, text, tag) => {
        const m = re.exec(text);
        assert(m, `${tag} 找不到`);
        return Number(m[1]);
      };
      // 尺子自证 ①：host.ts 的 W 值先按规范数对一遍（读空/读错文件会先在这里红）
      assertEq(pick(/HIT_HALF_W_RATIO\s*=\s*([0-9.]+)/, hostSrc, 'host.ts HIT_HALF_W_RATIO'), 0.1875, '尺子自证：host.ts 真值');
      // 尺子自证 ②：编造的常量名必须找不到（防"正则松到随便命中"）
      assertEq(/HIT_HALF_NO_SUCH_RATIO\s*=\s*([0-9.]+)/.exec(hostSrc), null, '尺子自证：编造常量名不许命中');
      for (const tag of ['W', 'H']) {
        const re = new RegExp(`HIT_HALF_${tag}_RATIO\\s*=\\s*([0-9.]+)`);
        const want = pick(re, hostSrc, `host.ts HIT_HALF_${tag}_RATIO`);
        const got = pick(re, src, `miai-extras HIT_HALF_${tag}_RATIO`);
        assertEq(got, want, `HIT_HALF_${tag}_RATIO 与 host.ts 漂移`);
      }
    },
  },
];

/** 跑整套用例（每条用例独立沙箱）；返回 [{name, ok, detail}] */
async function runSuite(source) {
  const results = [];
  for (const t of TESTS) {
    try {
      await t.fn.call(null, source);
      results.push({ name: t.name, ok: true });
    } catch (err) {
      results.push({ name: t.name, ok: false, detail: err && err.message ? err.message : String(err) });
    }
  }
  return results;
}

// ---------------------------------------------------------------- 种坏臂（尺子自证）

/**
 * 每条种坏 = 对源码的 1~2 处外科替换 + 预期转红的用例名（必须全部命中）。
 * replaceOnce 保证锚点恰好命中一次：缺失/重复/替换无效都响亮报错——宁可不跑，不许假种。
 */
const MUTATIONS = [
  {
    name: 'debounce-off（删防抖判定）',
    pairs: [['now - api.lastQuackAt < DEBOUNCE_MS', 'false /* 种坏：防抖失效 */']],
    expectRed: ['快速两击：只计 1 次（120ms 防抖）', '探针 play()：跳手势但同路径，防抖生效'],
  },
  {
    name: 'button-off（删左键判定）',
    pairs: [
      [
        'if (!e || e.button !== 0) return; // 只认左键（口径同 sprite.js:753）',
        'if (!e) return; // 种坏：丢弃左键判定',
      ],
    ],
    expectRed: ['非左键（右键/中键）：不计数'],
  },
  {
    name: 'hit-off（删 .pet-hit 命中判定）',
    pairs: [
      [
        "if (!t.closest('.pet-hit')) return; // 命中判据 = 真实可点区域选择器（供体：sprite.js:143）",
        '/* 种坏：命中判定被删 */',
      ],
    ],
    expectRed: ['点空白（含无 closest 目标）：不计数且不抛错'],
  },
  {
    name: 'error-swallowed（吞掉小黄鸭失败原因写入）',
    pairs: [["api.quackError = '小黄鸭音效失败：' + reason;", '/* 种坏：失败原因被吞 */']],
    expectRed: ['fetch 拒绝：quackError 非空且计数不变；修复后可重试', 'play() 拒绝：quackError 写原因且计数不变'],
  },
  {
    name: 'enabled-off（小黄鸭开关失效）',
    pairs: [['if (!api.quackEnabled) return false;', 'if (false) return false; // 种坏：开关失效']],
    expectRed: ['quackEnabled=false：点击与 play() 全不动；置回 true 恢复'],
  },
  {
    name: 'url-wrong（音效路径改错）',
    pairs: [["const QUACK_PATH = '/miai/quack.wav';", "const QUACK_PATH = '/miai/quack.wav.bak';"]],
    expectRed: ['单击：计数=1、fetch 命中 BASE+/miai/quack.wav、Audio 用 blob URL、捕获阶段注册', '探针 play()：跳手势但同路径，防抖生效'],
  },
  {
    name: 'count-on-accept（受理即计数，不等真开播）',
    pairs: [
      [
        '          api.quackCount++;\n          api.quackError = null; // 此刻开播成功：清掉历史失败（失败时仍会重新写入，不会静默吞）',
        '          api.quackError = null; // 此刻开播成功：清掉历史失败（失败时仍会重新写入，不会静默吞）',
      ],
      ['    api.lastQuackAt = now;', '    api.lastQuackAt = now;\n    api.quackCount++; // 种坏：受理即计数（不等真开播）'],
    ],
    expectRed: ['fetch 拒绝：quackError 非空且计数不变；修复后可重试', 'play() 拒绝：quackError 写原因且计数不变'],
  },
  {
    name: 'pat-call-off（摸头不动手上报）',
    pairs: [["        postAct(PAT_PATH, 'pat');", '        /* 种坏：摸头不发了 */']],
    expectRed: ['单击（等过 320ms）：发 /miai/pat，不发 feed/rua'],
  },
  {
    name: 'feed-call-off（双击不动手上报）',
    pairs: [["        postAct(FEED_PATH, 'feed');", '        /* 种坏：喂饭不发了 */']],
    expectRed: ['双击停住（等过 420ms）：发 /miai/feed，且 pat 被撤销'],
  },
  {
    name: 'rua-threshold-off（连点阈值失效）',
    pairs: [
      [
        'if (clickTimes.length >= RUA_CLICKS) {',
        'if (false) { // 种坏：连点阈值失效',
      ],
    ],
    expectRed: ['五连击：发 /miai/rua，且排队的 pat 一次都不补发', 'rua 后 600ms 锁：锁内按下不响也不排队；锁过恢复'],
  },
  {
    name: 'drag-cancel-off（拖拽不再撤销排队动作）',
    pairs: [
      [
        'if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {',
        'if (false) { // 种坏：拖拽撤销失效',
      ],
    ],
    expectRed: ['拖拽撤销：按下后位移 >6px → 排队的 pat 被撤掉'],
  },
  {
    name: 'coords-client（拖拽判据改用 clientX）',
    pairs: [
      [
        'const dx = e.screenX - pressSX;',
        'const dx = e.clientX - pressSX; // 种坏：改用 clientX（窗口一动就误判成拖）',
      ],
    ],
    expectRed: ['拖拽判据看屏幕坐标：clientX 大变、screenX 不动 → 仍算点击'],
  },
  {
    name: 'flags-ignored（音效闸门失效）',
    pairs: [
      [
        'if (!api.soundAllowed) return false; // 宿主说静音：不计数、不播放（读数见 api.soundAllowed）',
        'if (false) return false; // 种坏：闸门失效',
      ],
    ],
    expectRed: ['闸门读到 sound:false：点击不响不计数；置回 true 恢复'],
  },
  {
    name: 'volume-ignored（音量不套到播放器）',
    pairs: [['el.volume = Math.min(1, Math.max(0, api.soundVolume / 100));', '/* 种坏：音量不套 */']],
    expectRed: ['音量：宿主 0~100 换算成 Audio.volume 0~1'],
  },
  {
    name: 'followblock-drop（V1-49 灰行原因不透传：菜单只能瞎猜或不出灰项）',
    pairs: [
      [
        '          api.flagsFollowBlock = data.followBlock;\n          api.followBlock = data.followBlock;',
        '          api.flagsFollowBlock = data.followBlock;\n          // 种坏：原因不写进渲染端读数（透传断了）',
      ],
    ],
    expectRed: [
      '跟不了的原因（V1-49）：/miai/flags.followBlock 透传；非字符串/缺席不动（不摆瞎猜的灰项）',
    ],
  },
  {
    name: 'plead-label-off（挽留不再筛菜单项文案）',
    pairs: [
      [
        '      if (label !== PLEAD_LABEL) return; // 只认「关闭大肥鱼」那一项（字面量与 dshpet-patch.mjs 同步）',
        '      /* 种坏：不再筛菜单项文案 */',
      ],
    ],
    expectRed: ['菜单挽留：悬停其他菜单项不发挽留'],
  },
  {
    name: 'plead-dedupe-off（同一项内去重失效）',
    pairs: [
      [
        '      if (item === menuLastItem) return; // 同一项内移动（子节点间切换）会连发 mouseover：去重',
        '      /* 种坏：去重失效 */',
      ],
    ],
    expectRed: ['菜单挽留：悬停「关闭大肥鱼」项发一次 /miai/plead；同项内移动不重发；移开再回重发'],
  },
  {
    name: 'theme-attr-off（主题属性不挂 html）',
    pairs: [
      [
        "      document.documentElement.setAttribute('data-miai-theme', api.menuTheme);",
        '      /* 种坏：主题属性不挂 */',
      ],
    ],
    expectRed: ['菜单主题：读到 dark 挂 html 属性；再读 light 翻回；非 dark 值一律归一为 light'],
  },
  {
    name: 'theme-parse-off（主题应答永远读成 light）',
    pairs: [
      [
        "          const t = data && data.theme === 'dark' ? 'dark' : 'light';",
        "          const t = 'light'; // 种坏：永远亮色",
      ],
    ],
    expectRed: ['菜单主题：读到 dark 挂 html 属性；再读 light 翻回；非 dark 值一律归一为 light'],
  },
  {
    name: 'theme-guard-off（并发共用守卫失效：两拍各拉一趟）',
    pairs: [
      [
        '    if (menuThemeLoading) return menuThemeLoading; // 已有一趟在飞：共用（防慢的成功应答把新的失败读数清掉）\n',
        '',
      ],
    ],
    expectRed: ['菜单主题并发：两拍同时调用共用同一趟 fetch（防慢的成功应答清掉新的失败读数）'],
  },
  {
    name: 'menu-watch-off（菜单出现监听失效）',
    pairs: [['        if (!hit) return;', '        if (true) return; // 种坏：任何变动都提前返回']],
    expectRed: ['菜单出现触发主题刷新：菜单节点 +1 次 /miai/theme；无关节点不刷'],
  },

  // ---------------- F. 饱腹行（P3 ③） ----------------
  {
    name: 'draw-when-missing（vitals 缺也摆一条 0%）',
    pairs: [
      [
        '      if (!api.petVitals) {\n        api.menuHungerSkips++; // 读数没到：宁可不画，也不画一条假的 0%\n        return;\n      }\n',
        '',
      ],
    ],
    expectRed: ['vitals 缺 ⇒ 不摆坏行：叶子没有 / data 为空都只记 skip，零条、首项仍是菜单项'],
  },
  {
    name: 'reclamp-off（注入后不重钳面板位置）',
    pairs: [['      api.menuHungerBars++;\n      reclampMenuPanel(panel);', '      api.menuHungerBars++;']],
    expectRed: ['重钳读可见带：视口≠clamp（clamp 高 202 → top 70、底 ≤198）；不越界不动；读数缺席回落视口（计数+warn）'],
  },
  {
    name: 'reclamp-viewport-bound（重钳上界误用视口高：图三病根回潮）',
    pairs: [
      [
        '      const y0 = cr ? cr.y : 0;\n      const y1 = cr ? cr.y + cr.h : vh;\n',
        '      const y0 = 0;\n      const y1 = vh; // 种坏：上界误用视口高（图三根因）\n',
      ],
    ],
    expectRed: ['重钳读可见带：视口≠clamp（clamp 高 202 → top 70、底 ≤198）；不越界不动；读数缺席回落视口（计数+warn）'],
  },
  {
    name: 'vitals-update-off（读数更新不刷新在场行）',
    pairs: [['syncHungerBar(); // 菜单正开着：立刻把宽度/颜色/标签对上（不重插）', '/* 种坏：读数更新不刷新在场行 */']],
    expectRed: ['读数更新（counter+1）：在场条只上色不重插；菜单重开则新面板各一条'],
  },
  {
    name: 'bar-width-off（填充永远满格）',
    pairs: [["      fill.style.width = pct + '%';", "      fill.style.width = '100%';"]],
    expectRed: ['状态行在场：vitals 首拍即采用；菜单打开 → 前插首项、宽度=satiety%、mild 黄、两行固定格式文本'],
  },
  {
    name: 'label-format-off（标签丢前缀，只剩数字%）',
    pairs: [
      [
        "    if (label) label.textContent = HUNGER_LABEL_PREFIX + pct + '%';",
        "    if (label) label.textContent = pct + '%'; // 种坏：标签丢前缀",
      ],
    ],
    expectRed: [
      '状态行在场：vitals 首拍即采用；菜单打开 → 前插首项、宽度=satiety%、mild 黄、两行固定格式文本',
      '读数更新（counter+1）：在场条只上色不重插；菜单重开则新面板各一条',
    ],
  },
  {
    name: 'label-pos-off（三段顺序颠倒：条上、字下）',
    pairs: [
      [
        '    bar.appendChild(label);\n    bar.appendChild(track);',
        '    bar.appendChild(track);\n    bar.appendChild(label); // 种坏：顺序颠倒',
      ],
    ],
    expectRed: ['状态行在场：vitals 首拍即采用；菜单打开 → 前插首项、宽度=satiety%、mild 黄、两行固定格式文本'],
  },
  {
    name: 'vitals-line-drop（读数行丢好感段：只剩白饭碗数）',
    pairs: [
      [
        '    return VITALS_RICE_PREFIX + rice + VITALS_RICE_SUFFIX + aff;',
        "    return VITALS_RICE_PREFIX + rice + ' 碗'; // 种坏：读数行丢掉好感段",
      ],
    ],
    expectRed: [
      '状态行在场：vitals 首拍即采用；菜单打开 → 前插首项、宽度=satiety%、mild 黄、两行固定格式文本',
      '读数行（V2-23）：affection 随叶子透传 api.petVitals；缺席/坏值画占位（好感 --%、大白饭 --），不编 0',
      '读数更新（counter+1）：在场条只上色不重插；菜单重开则新面板各一条',
    ],
  },
  {
    name: 'affection-drop（归一化丢 affection：V2-23 的病根回潮）',
    pairs: [
      [
        '    api.petVitals = { satiety: satiety, rice: d.rice, mood: d.mood, affection: d.affection };',
        '    api.petVitals = { satiety: satiety, rice: d.rice, mood: d.mood }; // 种坏：丢掉 affection',
      ],
    ],
    expectRed: [
      '状态行在场：vitals 首拍即采用；菜单打开 → 前插首项、宽度=satiety%、mild 黄、两行固定格式文本',
      '读数更新（counter+1）：在场条只上色不重插；菜单重开则新面板各一条',
    ],
  },
  {
    name: 'threshold-drift（档界常量与 pet.ts 漂移）',
    pairs: [['  const HUNGER_FULL_AT = 80;', '  const HUNGER_FULL_AT = 70;']],
    expectRed: ['档界常量与 pet.ts 对账：HUNGER_*_AT 逐值相等（改一处即红）'],
  },

  // ---------------- G. 跟随 / 关闭挽留 / 漫游闸门（2026-10-09 补充模块一、二） ----------------
  {
    name: 'follow-stop-off（跟随到位不收帧）',
    pairs: [
      [
        '          if (Math.hypot(dx, dy) < FOLLOW_STOP_PX) {',
        '          if (false) { // 种坏：到位不收帧',
      ],
    ],
    expectRed: ['跟随叶子：首拉即采用 → 逐帧趋近收窄 → 到位 ≤3px 收帧并记 customPos'],
  },
  {
    name: 'follow-pause-off（暂停守卫两处全失效：起步门 + 帧体门）',
    pairs: [
      [
        '      if (followPausedNow()) {\n        api.followPaused = true;\n        return false;\n      }\n',
        '',
      ],
      [
        '          if (followPausedNow()) {\n            api.followPaused = true;\n            followStop(); // 守卫挡下：收帧，松手后轮询拍续上\n            return;\n          }\n',
        '',
      ],
    ],
    expectRed: ['跟随暂停守卫：拖拽中不起帧也不改 followOn；途中拖拽立即收帧；松手后轮询拍兜底重起'],
  },
  {
    name: 'recall-origin-off（出发前不记原处）',
    pairs: [
      [
        "      if (api.recallState === 'idle') saveRecallOrigin(); // 只在 idle 出发时记原处（途中触发不重记）",
        '      /* 种坏：不记原处 */',
      ],
    ],
    expectRed: ['挽留 back：回原处（body 钳位）→ customPos 原样还原 → idle + 回执 {seq,phase:back}'],
  },
  {
    name: 'recall-clamp-window（go 段误用 window 钳位）',
    pairs: [
      [
        "      if (!walkTo(x, y, seq, { clamp: 'body', arrive: onRecallGoArrived })) {",
        "      if (!walkTo(x, y, seq, { arrive: onRecallGoArrived })) { // 种坏：误用 window 钳位",
      ],
    ],
    expectRed: ['挽留 go：body 钳位（命中区在屏、窗可探出）→ parked + 回执 {seq,phase:go}'],
  },
  {
    name: 'recall-back-clamp-window（back 段误用 window 钳位：贴底原处回不到位）',
    pairs: [
      [
        "      if (!walkTo(origin.x, origin.y, seq, { clamp: 'body', arrive: onRecallBackArrived })) {",
        "      if (!walkTo(origin.x, origin.y, seq, { arrive: onRecallBackArrived })) { // 种坏：误用 window 钳位",
      ],
    ],
    expectRed: ['挽留 back·贴底原处：回程 body 钳位精确回 pos.y=600（误用 window 钳位会钳到 536）'],
  },
  {
    name: 'roam-gate-off（闸门不拦，漫游全放行）',
    pairs: [
      [
        '          if (preferredName === undefined && roamBlockedNow()) {\n            api.roamSuppressed++;\n            return true; // 「忙」：playIdle 重播当前动画，原地踏步（不退化播别的，见节顶）\n          }\n',
        '',
      ],
    ],
    expectRed: [
      '漫游闸门·分档节流：首掷放行即记账；severe 180s 窗内必拦、到点放行（179999/180000 边界）',
      '漫游闸门·六判据：挽留/跑腿/跟随/总闸/归零必拦，vitals 缺失放行；指名 tryMove(name) 不受管',
    ],
  },
  {
    name: 'roam-name-off（指名调用也被拦）',
    pairs: [
      [
        '          if (preferredName === undefined && roamBlockedNow()) {',
        '          if (roamBlockedNow()) { // 种坏：指名调用也拦',
      ],
    ],
    expectRed: ['漫游闸门·六判据：挽留/跑腿/跟随/总闸/归零必拦，vitals 缺失放行；指名 tryMove(name) 不受管'],
  },
  {
    name: 'follow-center-frame-off（落点中心口径退回 pos 口径：停在离光标半身位处）',
    pairs: [
      [
        '          const tpx = cb.x + halfW; // 钳位后的目标**中心**（视口坐标）\n          const tpy = cb.y + halfH;',
        '          const tpx = cb.x; // 种坏：把 pos 当中心\n          const tpy = cb.y;',
      ],
    ],
    expectRed: ['跟随叶子：首拉即采用 → 逐帧趋近收窄 → 到位 ≤3px 收帧并记 customPos'],
  },
  {
    name: 'follow-target-split-off（只写探针读数、不写帧体读的操作变量：drive 永远起不来）',
    pairs: [
      [
        '    followTarget = target;\n    api.followTarget = target;',
        '    api.followTarget = target; // 种坏：操作变量不写（叶子读到了、drive 是死的）',
      ],
    ],
    expectRed: [
      '跟随叶子：首拉即采用 → 逐帧趋近收窄 → 到位 ≤3px 收帧并记 customPos',
      '跟随暂停守卫：拖拽中不起帧也不改 followOn；途中拖拽立即收帧；松手后轮询拍兜底重起',
      '跟随 off 叶子：收帧 + 停在哪记哪；此后不再烧帧',
    ],
  },
  {
    name: 'follow-cadence-off（轮询节奏不自适应）',
    pairs: [
      [
        "    return api.followOn === true || api.recallState !== 'idle' ? FOLLOW_POLL_MS : GOTO_POLL_MS;",
        '    return GOTO_POLL_MS; // 种坏：节奏不自适应',
      ],
    ],
    expectRed: ['轮询节奏自适应：跟随生效 120ms 一拍 / 平时 1000ms（119/999 不出、120/1000 出）'],
  },
];

/** 锚点恰好命中一次的外科替换（缺失/重复/无效 → 抛错拒跑，绝不假种当绿） */
function replaceOnce(out, from, to, tag) {
  const parts = out.split(from);
  if (parts.length === 1) throw new Error(`锚点缺失（${tag}）：${JSON.stringify(from.slice(0, 56))}…`);
  if (parts.length > 2) throw new Error(`锚点不唯一（命中 ${parts.length - 1} 次，${tag}）：${JSON.stringify(from.slice(0, 56))}…`);
  const next = parts.join(to);
  if (next === out) throw new Error(`替换没有产生变化（${tag}）`);
  return next;
}

function applyMutation(m) {
  let out = SOURCE;
  for (const [from, to] of m.pairs) out = replaceOnce(out, from, to, m.name);
  if (out === SOURCE) throw new Error(`种坏没有任何效果（${m.name}）`);
  return out;
}

// ---------------------------------------------------------------- 运行两臂

async function main() {
  console.log('== miai-extras 自检 · 正常臂（必须全绿）==');
  const green = await runSuite(SOURCE);
  let normalRed = 0;
  for (const r of green) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' —— ' + r.detail}`);
    if (!r.ok) normalRed++;
  }
  console.log(`正常臂：${green.length - normalRed}/${green.length} 绿`);

  console.log('== miai-extras 自检 · 种坏臂（尺子自证：每条必须按预期转红）==');
  let plantBad = 0;
  for (const m of MUTATIONS) {
    let mutated;
    try {
      mutated = applyMutation(m);
    } catch (err) {
      plantBad++;
      console.log(`  ✗ ${m.name}：种坏未生效 —— ${err.message}`);
      continue;
    }
    const res = await runSuite(mutated);
    const failedNames = res.filter((r) => !r.ok).map((r) => r.name);
    const missed = m.expectRed.filter((n) => !failedNames.includes(n));
    const survivor = res.some((r) => r.ok && !m.expectRed.includes(r.name));
    if (missed.length === 0 && survivor) {
      console.log(`  ✓ ${m.name}：已见红（命中 ${failedNames.length} 条，含全部预期）`);
    } else {
      plantBad++;
      console.log(
        `  ✗ ${m.name}：${missed.length ? '预期转红未红：' + missed.join('、') + '；' : ''}` +
          `${!survivor ? '且全军覆没（疑似种坏搞坏加载而非命中判据）' : ''}`,
      );
      console.log(`     实际失败：${failedNames.join('、') || '（无）'}`);
    }
  }

  const ok = normalRed === 0 && plantBad === 0;
  console.log(
    ok
      ? `\n全部通过：正常臂 ${green.length}/${green.length} 绿，且 ${MUTATIONS.length} 条种坏全部被咬住。`
      : `\n失败：正常臂红 ${normalRed} 条，种坏臂异常 ${plantBad} 条。`,
  );
  process.exitCode = ok ? 0 : 1;
}

main().catch((err) => {
  console.error('自检运行器自身崩溃：', err);
  process.exitCode = 1;
});
