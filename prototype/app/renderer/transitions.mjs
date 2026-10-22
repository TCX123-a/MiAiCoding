// 过场机制 —— 逐字移植 DSH（client.js:890-997 / layer-core.js:84-105 / live-layer.js:2191-2200）
// 只改：类名前缀 we- → wp-、砍掉音频闸与 Edge canvas 收尾（P1 无音频外放与 Edge 通道）。
//
// 铁律（上游注释逐字口径）：
//   ① 每种过场只动 transform / opacity / clip-path —— 全是合成器友好属性；
//   ② 所有过场都守同一条：**旧层保持不透明垫在新层之下**（没有「淡到黑」的中间态）；
//   ③ cut 不走本函数：调用方走「立即拆旧层」的硬切路径；
//   ④ 时序（ms = 基准 × 速度档，cut=0）：openAudioGate→旧层 zIndex=-3→写 inFrom→
//      写 --wp-switch-ms→className 重写（顺带脱 --pending）→非 fade 给旧层挂 switch-out→
//      void offsetWidth 强制 reflow→写 inTo/outTo→ms+100 移除旧层→ms+60 清新层样式。

export const SWITCH_TRANSITIONS = [
  { id: 'cut', label: '硬切', ms: 0 },
  { id: 'fade', label: '交叉淡化', ms: 1800 },
  { id: 'push', label: '推移', ms: 700 },
  { id: 'wipe', label: '擦除', ms: 700 },
  { id: 'iris', label: '光圈', ms: 800 },
  { id: 'zoom', label: '缩放', ms: 900 },
  { id: 'bars', label: '条带', ms: 800 },
];
export const SWITCH_SPEEDS = [
  { id: 'fast', label: '快', factor: 0.6 },
  { id: 'normal', label: '标准', factor: 1 },
  { id: 'slow', label: '慢', factor: 1.6 },
];
export const SWITCH_DIRS = ['left', 'right', 'up', 'down'];
export const SWITCH_DIRECTIONAL = ['push', 'wipe', 'bars'];
export const SWITCH_BARS_TEETH = 7;
const DEFAULT_DIR = 'left'; // DSH 默认 switchTransitionDir = left

/** {id, dir, directional, ms}；ms = max(60, round(base×factor))，cut 恒 0 */
export function transitionSpec(id, speedId, dir) {
  const def = SWITCH_TRANSITIONS.find((t) => t.id === id) || SWITCH_TRANSITIONS[1];
  const speed = SWITCH_SPEEDS.find((s) => s.id === speedId) || SWITCH_SPEEDS[1];
  const d = SWITCH_DIRS.includes(dir) ? dir : DEFAULT_DIR;
  return {
    id: def.id,
    dir: d,
    directional: SWITCH_DIRECTIONAL.includes(def.id),
    ms: def.ms > 0 ? Math.max(60, Math.round(def.ms * speed.factor)) : 0,
  };
}

/** 'random' 时随机挑一个非 cut 过场（cut 作为「随机」选项没有意义） */
export function randomTransitionId(rand = Math.random) {
  const pool = SWITCH_TRANSITIONS.filter((t) => t.id !== 'cut');
  return pool[Math.floor(rand() * pool.length) % pool.length].id;
}

/** 擦除的起始 inset：从新画面「进入」的那一侧长出来（left = 新画面自右进入） */
function wipeInset(dir) {
  if (dir === 'right') return 'inset(0 100% 0 0)';
  if (dir === 'up') return 'inset(100% 0 0 0)';
  if (dir === 'down') return 'inset(0 0 100% 0)';
  return 'inset(0 0 0 100%)'; // left
}

/**
 * 条带 / 百叶窗：N 块独立的板从「进入侧」一起长出来，板间留缝。
 * outer = 进入侧（left/up 取 1，right/down 取 0），深度 depth=p；脊（spine ≤0.4%）
 * 把不相连的板串成一个连通区域（polygon 只能画一个连通区域）；点数恒 4N+1 才可平滑插值。
 */
function barsPolygon(dir, p) {
  const horizontal = dir === 'left' || dir === 'right';
  const fromEnd = dir === 'left' || dir === 'up';
  const outer = fromEnd ? 1 : 0;
  const inward = fromEnd ? -1 : 1;
  const n = SWITCH_BARS_TEETH;
  const period = 1 / n;
  const depth = p;
  const spine = Math.min(0.004, depth);
  const slat = p / n;
  const pt = (a, t) => (horizontal ? [outer + inward * a, t] : [t, outer + inward * a]);
  const pts = [pt(0, 0)];
  for (let i = 0; i < n; i++) {
    const y0 = i * period;
    pts.push(pt(depth, y0));
    pts.push(pt(depth, y0 + slat));
    if (i < n - 1) {
      pts.push(pt(spine, y0 + slat));
      pts.push(pt(spine, y0 + period));
    }
  }
  pts.push(pt(spine, 1));
  pts.push(pt(0, 1));
  return 'polygon(' + pts.map(([x, y]) => (x * 100).toFixed(2) + '% ' + (y * 100).toFixed(2) + '%').join(', ') + ')';
}

/** 每种过场的「入场层初态 / 入场层终态 / 退场层终态」，直接写成内联样式 */
export function switchFrames(id, dir) {
  const inFrom = { left: 'translate3d(100%, 0, 0)', right: 'translate3d(-100%, 0, 0)', up: 'translate3d(0, 100%, 0)', down: 'translate3d(0, -100%, 0)' }[dir];
  const outTo = { left: 'translate3d(-100%, 0, 0)', right: 'translate3d(100%, 0, 0)', up: 'translate3d(0, -100%, 0)', down: 'translate3d(0, 100%, 0)' }[dir];
  if (id === 'push') {
    return { inFrom: { transform: inFrom }, inTo: { transform: 'translate3d(0, 0, 0)' }, outTo: { transform: outTo } };
  }
  if (id === 'wipe') {
    return { inFrom: { clipPath: wipeInset(dir) }, inTo: { clipPath: 'inset(0)' }, outTo: {} };
  }
  if (id === 'iris') {
    // circle(75%) 覆盖全视口（100% 参考长度 = 对角线/√2，角点距离 ≈ 70.7%）
    return { inFrom: { clipPath: 'circle(0% at 50% 50%)' }, inTo: { clipPath: 'circle(75% at 50% 50%)' }, outTo: {} };
  }
  if (id === 'zoom') {
    return {
      inFrom: { transform: 'scale(1.06)', opacity: '0' },
      inTo: { transform: 'scale(1)', opacity: '1' },
      // 旧层只轻微前推、不改 opacity（保持不透明垫底）
      outTo: { transform: 'scale(1.04)' },
    };
  }
  if (id === 'bars') {
    return { inFrom: { clipPath: barsPolygon(dir, 0) }, inTo: { clipPath: barsPolygon(dir, 1) }, outTo: {} };
  }
  return { inFrom: { opacity: '0' }, inTo: { opacity: '1' }, outTo: {} }; // fade
}

export function applyInlineStyle(node, style) {
  if (!node || !node.style) return;
  for (const k in style) {
    try { node.style[k] = style[k]; } catch { /* ignore */ }
  }
}

/** 过场收尾：新层必须回到「干净」状态（见上游注释——不留常驻合成层） */
export function resetSwitchStyles(node, baseClass = 'wp-slot') {
  if (!node) return;
  try { node.className = baseClass; } catch { /* ignore */ }
  try {
    node.style.transform = '';
    node.style.opacity = '';
    node.style.clipPath = '';
    node.style.removeProperty('--wp-switch-ms');
    node.style.removeProperty('will-change');
  } catch { /* ignore */ }
}

/**
 * 启动一次过场。node=入场层（新），outgoing=退场层（旧）。
 * hooks.onRetire：旧层移除点（ms+100）——调用方在此 destroy 引擎实例并清场。
 * hooks.baseClass：层基础类名（默认 'wp-slot'）。
 */
export function startLayerTransition(node, outgoing, tr, hooks = {}) {
  const base = hooks.baseClass || 'wp-slot';
  // 两者默认都是同层 z-index，谁在上面靠 DOM 顺序 —— 过场期间显式把旧层压到新层之下
  try { outgoing.style.zIndex = '1'; } catch { /* ignore */ }
  try { node.style.zIndex = '2'; } catch { /* ignore */ }
  const frames = switchFrames(tr.id, tr.dir);
  applyInlineStyle(node, frames.inFrom);
  try { node.style.setProperty('--wp-switch-ms', tr.ms + 'ms'); } catch { /* ignore */ }
  node.className = `${base} ${base}--switch`; // 顺带脱掉 --pending
  // 除 fade 外都给旧层挂 switch-out（上游口径：注释说只有推移/缩放，代码是除 fade 外全挂；
  // wipe/iris/bars 的 outTo={} 故无可见差别）
  if (tr.id !== 'fade') outgoing.className = `${base} ${base}--switch ${base}--switch-out`;
  void node.offsetWidth; // 强制 reflow：让初态成为 transition 起点
  applyInlineStyle(node, frames.inTo);
  applyInlineStyle(outgoing, frames.outTo);
  window.setTimeout(() => {
    if (hooks.onRetire) hooks.onRetire();
  }, tr.ms + 100);
  window.setTimeout(() => resetSwitchStyles(node, base), tr.ms + 60);
}
