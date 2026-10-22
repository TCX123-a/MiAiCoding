// 视差层 —— 移植 DSH src/parallax-layer.js（+ styles.js 视差段的 CSS，见 index.html）
// 改动：设置源从 selection 换成注入的 getSettings()；目标选择器 '.we-layer,.we-rope,.we-metrics'
// 换成 '.wp-slot'（P1 只有壁纸层，无吉祥物/柱状图）；变量名 --we-parallax-* → --wp-parallax-*。
//
// 不变量（上游口径）：
//   ① 一个 DOM 节点都不建，只写 CSS 变量；系数写 body（设置变了才写），步长写目标元素自己（每帧）；
//   ② 只能用 CSS 独立属性 translate / scale，绝不能用 transform（过场会内联写/清 transform）；
//   ③ 挂了才活、到位就停：光标不动时零帧零 CPU；帧率封顶 60Hz；帧循环期间加临时合成层类、
//      收工立刻摘（不留常驻合成层）；
//   ④ 设置每帧现读（拖滑块即时反馈）；事件幂等绑定（重复 sync 不叠监听）。
//
// 设置口径（v10 键）：parallax.enabled / parallax.amount(0..10 默认3) / parallax.smooth(0..98 默认85)。
// 百分比 = 「光标走完整条最长对角线时位移改变对角线长的百分之几」；scale=1+pct/100 补边。

const PARALLAX_DIRECTION = -1;
const PARALLAX_BG_MIN = 0;
const PARALLAX_BG_MAX = 10;
const PARALLAX_SMOOTH_MIN = 0;
const PARALLAX_SMOOTH_MAX = 98;
const PARALLAX_SETTLE_PX = 0.02;
const PARALLAX_FRAME_MS = 1000 / 60;
const PARALLAX_DT_MAX = 64;
const PARALLAX_MIN_FRAME_MS = PARALLAX_FRAME_MS * 0.75;
const PARALLAX_SETTLE_VISIBLE_PX = 0.25;
const PARALLAX_IDLE_MS = 180;
const PARALLAX_IDLE_VISIBLE_PX = 1;
const PARALLAX_TARGET_SELECTOR = '.wp-slot';
const PARALLAX_MOVING_CLASS = 'wp-parallax--moving';
const PARALLAX_TARGETS_MS = 250;
const PARALLAX_BG_DEFAULT = 3;
const PARALLAX_SMOOTH_DEFAULT = 85;
const PARALLAX_VAR_X = '--wp-parallax-x';
const PARALLAX_VAR_Y = '--wp-parallax-y';
const PARALLAX_VAR_BG = '--wp-parallax-bg';
const PARALLAX_ATTR = 'data-wp-parallax';

export function createParallax({ getSettings, onPointer }) {
  let on = false;
  let bound = false;
  let raf = 0;
  let x = 0;
  let y = 0;
  let seen = false;
  let stepX = 0;
  let stepY = 0;
  let lastMs = 0;
  let stepKey = '';
  let ratioKey = '';
  let vw = 0;
  let vh = 0;
  let moveMs = 0;
  let targets = [];
  let targetsMs = 0;
  let suspended = false; // 暂停（最小化/失焦）期间全停

  const now = () => (window.performance && performance.now ? performance.now() : Date.now());
  const clamp = (v, lo, hi, fb) => {
    const n = typeof v === 'number' && isFinite(v) ? v : Number(v);
    if (!isFinite(n)) return fb;
    return Math.min(hi, Math.max(lo, n));
  };

  function settings() {
    const s = getSettings();
    return {
      on: s.enabled === true,
      bg: clamp(s.amount, PARALLAX_BG_MIN, PARALLAX_BG_MAX, PARALLAX_BG_DEFAULT),
      smooth: clamp(s.smooth, PARALLAX_SMOOTH_MIN, PARALLAX_SMOOTH_MAX, PARALLAX_SMOOTH_DEFAULT),
    };
  }

  function varOn(el, prop, value) {
    const style = el && el.style;
    if (!style || typeof style.setProperty !== 'function') return;
    if (typeof style.getPropertyValue === 'function' && style.getPropertyValue(prop) === value) return;
    style.setProperty(prop, value);
  }

  function readViewport() {
    const w = Math.round(Number(window.innerWidth));
    const h = Math.round(Number(window.innerHeight));
    vw = isFinite(w) && w > 0 ? w : 0;
    vh = isFinite(h) && h > 0 ? h : 0;
  }

  function targetLift(el, lift) {
    if (!el || !el.classList) return;
    if (lift) el.classList.add(PARALLAX_MOVING_CLASS);
    else el.classList.remove(PARALLAX_MOVING_CLASS);
  }

  function targetClear(rec) {
    const el = rec && rec.el;
    if (!el) return;
    targetLift(el, false);
    try {
      el.style.removeProperty(PARALLAX_VAR_X);
      el.style.removeProperty(PARALLAX_VAR_Y);
    } catch { /* ignore */ }
    rec.key = '';
  }

  function targetsClear() {
    for (const rec of targets) targetClear(rec);
    targets = [];
    targetsMs = 0;
  }

  function targetsRefresh(t) {
    const found = document.querySelectorAll(PARALLAX_TARGET_SELECTOR);
    const prev = targets;
    const next = [];
    let fresh = false;
    for (const el of found) {
      let rec = null;
      for (const p of prev) if (p.el === el) { rec = p; p.kept = true; break; }
      if (!rec) { rec = { el, key: '' }; fresh = true; }
      next.push(rec);
    }
    for (const p of prev) {
      if (p.kept) { p.kept = false; continue; }
      targetClear(p);
    }
    targets = next;
    targetsMs = t;
    if (fresh) stepKey = '';
  }

  function targetsSettle() {
    for (const rec of targets) targetLift(rec.el, false);
  }

  function ratios(st) {
    const key = String(st.bg);
    if (key === ratioKey) return;
    ratioKey = key;
    varOn(document.body, PARALLAX_VAR_BG, key);
  }

  function ratioClear() {
    try { document.body.style.removeProperty(PARALLAX_VAR_BG); } catch { /* ignore */ }
  }

  function steps() {
    if (!targets.length) return;
    const key = stepX.toFixed(2) + '|' + stepY.toFixed(2);
    if (key === stepKey) return;
    stepKey = key;
    const sx = stepX.toFixed(2) + 'px';
    const sy = stepY.toFixed(2) + 'px';
    for (const rec of targets) {
      rec.key = key;
      targetLift(rec.el, true);
      varOn(rec.el, PARALLAX_VAR_X, sx);
      varOn(rec.el, PARALLAX_VAR_Y, sy);
    }
  }

  function attr(onOff) {
    if (onOff) document.body.setAttribute(PARALLAX_ATTR, 'on');
    else document.body.removeAttribute(PARALLAX_ATTR);
  }

  function onMove(e) {
    if (!on || suspended) return;
    x = e.clientX;
    y = e.clientY;
    seen = true;
    moveMs = now();
    kick();
    if (onPointer) onPointer(e);
  }

  function onResize() {
    if (!on || suspended) return;
    readViewport();
    kick();
  }

  function bind() {
    if (bound) return;
    document.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    bound = true;
  }

  function unbind() {
    if (!bound) return;
    try {
      document.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
    } catch { /* ignore */ }
    bound = false;
  }

  function kick() {
    if (raf || suspended) return;
    if (typeof requestAnimationFrame !== 'function') return;
    raf = requestAnimationFrame(frame);
  }

  function frame(ms) {
    raf = 0;
    if (!on || suspended) return;
    const st = settings();
    if (!st.on) { stop(); return; }
    const t = typeof ms === 'number' ? ms : now();
    if (lastMs && t - lastMs < PARALLAX_MIN_FRAME_MS) { kick(); return; } // 帧率封顶 60Hz
    if (vw <= 0 || vh <= 0) readViewport();
    if (!targets.length || t - targetsMs >= PARALLAX_TARGETS_MS) targetsRefresh(t);
    const W = vw > 0 ? vw : 1;
    const H = vh > 0 ? vh : 1;
    const cx = seen ? x : W / 2;
    const cy = seen ? y : H / 2;
    const targetX = (PARALLAX_DIRECTION * (cx - W / 2)) / 100;
    const targetY = (PARALLAX_DIRECTION * (cy - H / 2)) / 100;
    if (st.bg <= 0) { // 系数 0：一次落位收工，一帧都不多排
      stepX = targetX;
      stepY = targetY;
      steps();
      targetsSettle();
      return;
    }
    const a = 1 - st.smooth / 100; // smooth=0 ⇒ a=1 ⇒ 直接落位
    const dt = lastMs ? Math.min(PARALLAX_DT_MAX, Math.max(1, t - lastMs)) : PARALLAX_FRAME_MS;
    lastMs = t;
    const f = a <= 0 ? 1 : 1 - Math.pow(1 - a, dt / PARALLAX_FRAME_MS);
    stepX += (targetX - stepX) * f;
    stepY += (targetY - stepY) * f;
    const idle = moveMs > 0 && t - moveMs >= PARALLAX_IDLE_MS;
    const settle = Math.max(PARALLAX_SETTLE_PX, (idle ? PARALLAX_IDLE_VISIBLE_PX : PARALLAX_SETTLE_VISIBLE_PX) / st.bg);
    const doneX = Math.abs(targetX - stepX) <= settle;
    const doneY = Math.abs(targetY - stepY) <= settle;
    if (doneX) stepX = targetX;
    if (doneY) stepY = targetY;
    ratios(st);
    steps();
    if (!doneX || !doneY) kick();
    else targetsSettle();
  }

  function start() {
    if (typeof requestAnimationFrame !== 'function') return;
    on = true;
    attr(true);
    readViewport();
    ratios(settings());
    bind();
    kick();
  }

  function stop() {
    on = false;
    if (raf) {
      try { cancelAnimationFrame(raf); } catch { /* ignore */ }
      raf = 0;
    }
    unbind();
    targetsClear();
    ratioClear();
    stepX = 0;
    stepY = 0;
    seen = false;
    lastMs = 0;
    moveMs = 0;
    stepKey = '';
    ratioKey = '';
    vw = 0;
    vh = 0;
    attr(false);
  }

  return {
    /** 设置变了就调一次（只决定该不该活，参数每帧现读） */
    sync() {
      if (settings().on && !suspended) start();
      else stop();
    },
    setSuspended(v) {
      suspended = !!v;
      if (suspended) stop();
      else this.sync();
    },
    stop,
  };
}
