// P1 原型渲染层：双槽 A/B 层管理 + 四特性纵切 + 最小设置面板 + 暂停驱动
//
// 结构（docs/23 §2.1 渲染层模块表的 P1 简化版）：
//   slots[2]        —— 两个常驻层节点，引擎 canvas 挂进槽里；过场在槽之间跑
//   show/doShow     —— 挂载（等待首帧）→ 过场 → 旧层 ms+100 退役（内容闸=旧层垫着不离屏）
//   transitions.mjs —— 逐字移植的 7 种过场
//   parallax.mjs    —— 逐字移植的视差层（独立属性 translate/scale）
//   audio.mjs       —— E2 A 路工程化：loopback → 64 段双声道
//   暂停驱动        —— document.hidden || 最小化 || !visible || (失焦 && pauseOnBlur)；
//                      主进程事件 + 渲染层事件双通道 + 3s 复核自愈（docs/23 §2.4）
//
// 红线：不碰主工程 src/；不写死「默认成功」——mount 失败走三形态兜底（poster 降级 + 留旧层）。

import { httpSource, mediaSource, mount } from '../../node_modules/webwallgl/webwallgl.mjs';
import { createAudioCapture } from './audio.mjs';
import { createParallax } from './parallax.mjs';
import { applyInlineStyle, randomTransitionId, startLayerTransition, transitionSpec } from './transitions.mjs';

const $ = (id) => document.getElementById(id);
const ASSET_BASE = 'miai-wall://s/';

function assetUrl(abs) {
  return ASSET_BASE + String(abs).split('/').map(encodeURIComponent).join('/');
}

const t0 = performance.now();
const perfLog = [];
function perfEvent(kind, data) {
  const line = { t: +((performance.now() - t0) / 1000).toFixed(3), kind, ...data };
  perfLog.push(line);
  try { window.wpHost.tick({ kind: 'r:' + kind, ...data }); } catch { /* ignore */ }
  console.log('[perf]', JSON.stringify(line));
}

const state = {
  items: [],
  currentId: null,
  machine: null,
  settings: {
    dim: 35,
    blur: 0,
    transition: 'fade',
    speed: 'normal',
    fps: 30,
    parallax: { enabled: true, amount: 3, smooth: 85 },
    audio: { enabled: false, gain: 50 },
    rotation: { enabled: false, intervalMin: 5 },
    pauseOnBlur: true,
  },
};
const byId = (id) => state.items.find((it) => it.id === id) || null;

// ── 槽与实例 ────────────────────────────────────────────────────────────────
const slots = [$('slotA'), $('slotB')];
let activeSlot = 0;
const instances = [null, null];
let switching = false;
let pendingSwitch = null;

const audio = createAudioCapture({ getGain: () => state.settings.audio.gain });

function currentInstance() { return instances[activeSlot]; }

function effectiveFps() {
  const f = state.settings.fps;
  if (paused) return f; // 恢复时再用
  return winNow.focused ? f : Math.min(15, f); // 失焦逃生门：降档不暂停
}

// ── 暂停驱动 ────────────────────────────────────────────────────────────────
const winNow = { focused: true, minimized: false, visible: true };
let paused = false;
let resumeTimer = 0;

function shouldPause() {
  return document.hidden || winNow.minimized || !winNow.visible
    || (!winNow.focused && state.settings.pauseOnBlur);
}

function applyPauseState() {
  const next = shouldPause();
  if (next === paused) { renderHud(); return; }
  paused = next;
  if (paused) {
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = 0; }
    for (const inst of instances) { try { inst?.pause(); } catch { /* ignore */ } }
    parallax.setSuspended(true);
    audio.setActive(false);
  } else {
    // 恢复去抖 300ms（docs/23 §2.4）：连点最小化/还原不来回 resume
    resumeTimer = window.setTimeout(() => {
      resumeTimer = 0;
      if (shouldPause()) { applyPauseState(); return; }
      for (const inst of instances) { try { inst?.resume(); } catch { /* ignore */ } }
      parallax.setSuspended(false);
      audio.setActive(true);
      for (const inst of instances) { try { inst?.setFps(effectiveFps()); } catch { /* ignore */ } }
      if (rotationDue) { rotationDue = false; rotateNext('resume-deferred'); }
    }, 300);
  }
  perfEvent('pause-change', { paused, win: { ...winNow }, hidden: document.hidden });
  renderHud();
}

window.addEventListener('visibilitychange', applyPauseState);
window.addEventListener('blur', () => {
  winNow.focused = false;
  for (const inst of instances) { try { inst?.pointerLeave(); } catch { /* ignore */ } }
  applyPauseState();
});
window.addEventListener('focus', () => { winNow.focused = true; applyPauseState(); });
window.wpHost.onWinState((s) => {
  winNow.focused = s.focused;
  winNow.minimized = s.minimized;
  winNow.visible = s.visible;
  applyPauseState();
});
// 3s 复核自愈（主进程事件丢包/时序错位时的兜底）
setInterval(async () => {
  try {
    const s = await window.wpHost.winState();
    if (s.focused !== winNow.focused || s.minimized !== winNow.minimized || s.visible !== winNow.visible) {
      winNow.focused = s.focused;
      winNow.minimized = s.minimized;
      winNow.visible = s.visible;
      perfEvent('winstate-recheck-fix', { ...s });
      applyPauseState();
    }
  } catch { /* ignore */ }
}, 3000);

// ── 视差 ────────────────────────────────────────────────────────────────────
const parallax = createParallax({
  getSettings: () => state.settings.parallax,
  onPointer: (e) => {
    const inst = currentInstance();
    if (!inst || typeof inst.pushPointer !== 'function') return;
    const mods = (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
    try { inst.pushPointer(e.clientX / window.innerWidth, e.clientY / window.innerHeight, e.buttons, mods); } catch { /* ignore */ }
  },
});

// ── 层管理 ──────────────────────────────────────────────────────────────────
function buildSource(item) {
  if (item.type === 'video') return mediaSource(assetUrl(item.mainFileAbs));
  if (item.type === 'scene') return httpSource(assetUrl(item.dir.replace(/\/+$/, '')));
  return null; // web/application —— v1 裁剪（docs/23 §6），降级主图
}

function degradeToPoster(slot, item, why) {
  slot.innerHTML = '';
  if (item.previewAbs) {
    const img = document.createElement('img');
    img.className = 'wp-poster';
    img.src = assetUrl(item.previewAbs);
    img.alt = item.title;
    slot.appendChild(img);
  }
  slot.className = 'wp-slot';
  toast(`「${item.title}」降级为静态主图（${why}）`);
  perfEvent('degrade', { item: item.id, type: item.type, why });
}

function retire(idx) {
  const inst = instances[idx];
  instances[idx] = null;
  if (inst) { try { inst.destroy(); } catch (e) { perfEvent('destroy-fail', { msg: String(e) }); } }
  const slot = slots[idx];
  slot.innerHTML = ''; // 连引擎画布一起移除：只删 .wp-poster 会让画布幽灵留在槽里盖住对面槽
  slot.className = 'wp-slot';
  try {
    // 退役槽压到活动槽（CSS z-index:2）之下：两槽同层时 DOM 靠后的 slotB 恒在 slotA 上，
    // 换到 A 槽的图会被 B 槽残留内容整帧盖住（2026-10-04 实测的黑屏根因）
    slot.style.zIndex = '1';
    slot.style.transform = '';
    slot.style.opacity = '';
    slot.style.clipPath = '';
    slot.style.removeProperty('--wp-switch-ms');
  } catch { /* ignore */ }
  if (idx === activeSlot) { activeSlot = 1 - idx; } // 理论上不会走到（退役的总是非活动槽）
}

async function show(item, opts = {}) {
  if (!item) { toast('找不到该壁纸'); return; }
  if (switching) { pendingSwitch = { item, opts }; return; }
  switching = true;
  try {
    await doShow(item, opts);
  } catch (e) {
    perfEvent('show-error', { item: item.id, msg: String(e) });
    console.warn('[proto] show error', e);
  } finally {
    switching = false;
  }
  if (pendingSwitch) {
    const p = pendingSwitch;
    pendingSwitch = null;
    await show(p.item, p.opts); // 排队的最新一次（连点选壁纸不叠层）
  }
}

async function doShow(item, { transition = state.settings.transition, speed = state.settings.speed, reason = 'manual' } = {}) {
  const idx = 1 - activeSlot;
  const oldIdx = activeSlot;
  const slot = slots[idx];
  const oldSlot = slots[oldIdx];
  const src = buildSource(item);
  if (!src) { retire(oldIdx); slot.style.zIndex = ''; degradeToPoster(slot, item, `type=${item.type} 不在 v1 支持面`); activeSlot = idx; state.currentId = item.id; renderDrawer(); return; }

  const tid = transition === 'random' ? randomTransitionId() : transition;
  const tr = transitionSpec(tid, speed, 'left');
  const tCall = performance.now();

  const opts = {
    source: src,
    fit: 'cover',
    fps: effectiveFps(),
    volume: 0,
    audio: state.settings.audio.enabled ? audio.source : null,
    media: null, // v1 裁剪 Now Playing（docs/23 §6）：显式禁用，避免模拟 Now Playing 乱动
    mountTimeoutMs: 60000,
    // 引擎调试钩子总开关（__noMeshMaterial / __shaderPatch 等）：默认关；
    // CDP 里 `window.__PROTO_HOOKS = true` 后下一次挂载生效（P1 排障用）。
    debugHooks: window.__PROTO_HOOKS === true,
    onDiagnostic: (d) => console.log('[diag]', JSON.stringify(d).slice(0, 400)),
    onError: (err) => console.warn('[proto] mount onError', String(err && err.message ? err.message : err)),
  };

  slot.className = 'wp-slot wp-slot--pending';
  let inst = null;
  try {
    inst = await mount(slot, opts);
  } catch (e) {
    const salv = e && e.instance;
    if (salv) { try { salv.destroy(); } catch { /* ignore */ } }
    perfEvent('mount-fail', { item: item.id, type: item.type, ms: +(performance.now() - tCall).toFixed(1), msg: String(e && e.message ? e.message : e) });
    retire(oldIdx); // 降级也要先退役旧槽：否则旧画面留在上面，海报根本露不出来
    slot.style.zIndex = '';
    degradeToPoster(slot, item, 'mount 失败');
    activeSlot = idx;
    state.currentId = item.id;
    renderDrawer();
    return;
  }
  const firstFrameMs = performance.now() - tCall;
  instances[idx] = inst;
  try { if (paused) inst.pause(); } catch { /* ignore */ }

  if (tr.id === 'cut' || !instances[oldIdx]) {
    retire(oldIdx); // 无条件：旧槽落在降级海报时 instances 为空，也要清掉，否则残留物盖住新槽
    slot.style.zIndex = ''; // 收回上次退役留下的 inline 1，回到 CSS 默认 2（高于退役槽的 1）
    slot.className = 'wp-slot';
    activeSlot = idx;
  } else {
    startLayerTransition(slot, oldSlot, tr, { onRetire: () => retire(oldIdx) });
    activeSlot = idx;
  }
  state.currentId = item.id;
  renderDrawer();
  renderHud();
  perfEvent('switch', {
    item: item.id, type: item.type, reason,
    transition: tr.id, dir: tr.dir, ms: tr.ms,
    mountMs: +firstFrameMs.toFixed(1),
    sinceCallMs: +(performance.now() - tCall).toFixed(1),
  });
}

// ── 轮播 ────────────────────────────────────────────────────────────────────
let rotationTimer = 0;
let rotationDue = false;
function rotateNext(reason) {
  if (!state.items.length) return;
  const i = state.items.findIndex((x) => x.id === state.currentId);
  const next = state.items[(i + 1) % state.items.length];
  show(next, { reason });
}
function syncRotation() {
  if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = 0; }
  if (!state.settings.rotation.enabled || state.items.length < 2) return;
  rotationTimer = window.setInterval(() => {
    if (paused || switching) { rotationDue = true; return; }
    rotateNext('timer');
  }, Math.max(1, state.settings.rotation.intervalMin) * 60 * 1000);
}

// ── 设置应用 ────────────────────────────────────────────────────────────────
function applySettings() {
  $('scrim').style.opacity = String(state.settings.dim / 100);
  const blur = state.settings.blur;
  for (const s of slots) s.style.filter = blur > 0 ? `blur(${blur}px)` : '';
  for (const inst of instances) { try { inst?.setFps(effectiveFps()); } catch { /* ignore */ } }
  parallax.sync();
  syncRotation();
  renderPanelValues();
  renderHud();
}

function setSetting(path, value) {
  const parts = path.split('.');
  let o = state.settings;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value;
  applySettings();
}

async function setAudioEnabled(on) {
  state.settings.audio.enabled = on;
  if (on) {
    const r = await audio.enable();
    perfEvent('audio', { on: true, ok: r.ok, status: r.status, msg: r.msg || null, settings: r.settings || null });
    if (!r.ok) {
      state.settings.audio.enabled = false;
      toast(`音频响应开启失败：${r.msg || r.status}`);
    }
  } else {
    audio.disable();
    perfEvent('audio', { on: false });
  }
  for (const inst of instances) {
    try {
      // 始终绑 snapshot 源（关掉时返回全 0）——绝不用 setAudio(null)：那是「回落内置模拟源」，
      // 会让壁纸在音频功能关闭时自嗨（api.md §4 的语义坑）。
      inst?.setAudio(audio.source);
    } catch { /* ignore */ }
  }
  renderPanelValues();
  renderHud();
}

// ── UI ─────────────────────────────────────────────────────────────────────
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 4000);
}

function renderDrawer() {
  const list = $('drawer-list');
  list.innerHTML = '';
  for (const it of state.items) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'drawer-item' + (it.id === state.currentId ? ' cur' : '');
    row.dataset.id = it.id;
    const thumb = document.createElement('span');
    thumb.className = 'drawer-thumb';
    if (it.previewAbs) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = assetUrl(it.previewAbs);
      img.alt = '';
      thumb.appendChild(img);
    }
    const label = document.createElement('span');
    label.className = 'drawer-label';
    label.textContent = it.title || it.id;
    const badge = document.createElement('span');
    badge.className = `drawer-badge badge-${it.type}`;
    badge.textContent = it.type;
    row.append(thumb, label, badge);
    row.addEventListener('click', () => show(it, { reason: 'drawer' }));
    list.appendChild(row);
  }
}

function renderPanelValues() {
  const s = state.settings;
  $('rng-dim').value = String(s.dim);
  $('rng-dim-v').textContent = String(s.dim);
  $('rng-blur').value = String(s.blur);
  $('rng-blur-v').textContent = `${s.blur}px`;
  $('sel-transition').value = s.transition;
  $('sel-speed').value = s.speed;
  $('sel-fps').value = String(s.fps);
  $('chk-parallax').checked = s.parallax.enabled;
  $('rng-amount').value = String(s.parallax.amount);
  $('rng-amount-v').textContent = String(s.parallax.amount);
  $('rng-smooth').value = String(s.parallax.smooth);
  $('rng-smooth-v').textContent = String(s.parallax.smooth);
  $('chk-audio').checked = s.audio.enabled;
  $('rng-gain').value = String(s.audio.gain);
  $('rng-gain-v').textContent = String(s.audio.gain);
  $('chk-rotation').checked = s.rotation.enabled;
  $('sel-rotation-interval').value = String(s.rotation.intervalMin);
  $('chk-pause-blur').checked = s.pauseOnBlur;
}

function renderHud() {
  const it = byId(state.currentId);
  const inst = currentInstance();
  let st = null;
  try { st = inst ? inst.stats : null; } catch { st = null; }
  $('hud-item').textContent = it ? `${it.title}（${it.type}）` : '—';
  $('hud-fps').textContent = st ? `${Math.round(st.fps)} fps${st.running ? '' : ' 停'}` : '—';
  $('hud-state').textContent = paused
    ? (winNow.minimized ? '最小化·暂停' : document.hidden ? '隐藏·暂停' : '失焦·暂停')
    : (winNow.focused ? '正常' : '失焦·降档');
  const ai = audio.info();
  $('hud-audio').textContent = `${state.settings.audio.enabled ? '音频开' : '音频关'}（${ai.status}）`;
}

setInterval(renderHud, 500);

// 面板接线
$('rng-dim').addEventListener('input', (e) => setSetting('dim', +e.target.value));
$('rng-blur').addEventListener('input', (e) => setSetting('blur', +e.target.value));
$('sel-transition').addEventListener('change', (e) => setSetting('transition', e.target.value));
$('sel-speed').addEventListener('change', (e) => setSetting('speed', e.target.value));
$('sel-fps').addEventListener('change', (e) => setSetting('fps', +e.target.value));
$('chk-parallax').addEventListener('change', (e) => setSetting('parallax.enabled', e.target.checked));
$('rng-amount').addEventListener('input', (e) => setSetting('parallax.amount', +e.target.value));
$('rng-smooth').addEventListener('input', (e) => setSetting('parallax.smooth', +e.target.value));
$('chk-audio').addEventListener('change', (e) => setAudioEnabled(e.target.checked));
$('rng-gain').addEventListener('input', (e) => setSetting('audio.gain', +e.target.value));
$('chk-rotation').addEventListener('change', (e) => setSetting('rotation.enabled', e.target.checked));
$('sel-rotation-interval').addEventListener('change', (e) => setSetting('rotation.intervalMin', +e.target.value));
$('chk-pause-blur').addEventListener('change', (e) => setSetting('pauseOnBlur', e.target.checked));
$('btn-next').addEventListener('click', () => rotateNext('button'));
$('btn-drawer').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
$('btn-panel').addEventListener('click', () => document.body.classList.toggle('panel-open'));
$('btn-ui').addEventListener('click', () => document.body.classList.toggle('ui-hidden'));

// 节奏测试按钮（P1 报告用）：连点 6 次下一张（验证连切队列不叠层）
$('btn-stress').addEventListener('click', async () => {
  for (let i = 0; i < 6; i++) {
    rotateNext('stress');
    await new Promise((r) => setTimeout(r, 450)); // 450ms < fade 1800ms：故意在过场途中再切
  }
});

// ── 启动 ────────────────────────────────────────────────────────────────────
(async function boot() {
  const info = await window.wpHost.list();
  state.items = info.items;
  state.machine = info.machine;
  state.currentId = info.current ? info.current.id : null;
  console.log('[boot]', JSON.stringify({ n: info.items.length, current: state.currentId, install: info.installDir, machine: info.machine }));
  renderDrawer();
  renderPanelValues();
  applySettings();
  try {
    const s = await window.wpHost.winState();
    winNow.focused = s.focused;
    winNow.minimized = s.minimized;
    winNow.visible = s.visible;
  } catch { /* ignore */ }

  const start = info.current ? byId(info.current.id) : state.items[0];
  if (start) await show(start, { transition: 'cut', reason: 'boot' });
  else toast('未扫描到壁纸（检查 Steam 库）');
  applyPauseState();
})();

// 1s 一次的台账（四档状态的 CPU/内存由主进程附上进程表）
setInterval(() => {
  const inst = currentInstance();
  let st = null;
  try { st = inst ? inst.stats : null; } catch { st = null; }
  window.wpHost.tick({
    kind: 'tick',
    phase: paused ? (winNow.minimized ? 'minimized' : document.hidden ? 'hidden' : 'blur') : 'normal',
    item: state.currentId,
    fps: st ? Math.round(st.fps) : -1,
    running: st ? !!st.running : false,
    audio: audio.info().status,
    transitions: switching ? 1 : 0,
  });
}, 1000);

// H 键收 UI（截图用）
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('ui-hidden');
});

// ── 调试/测试面（CDP 驱动用，见 P1 验证脚本） ────────────────────────────────
window.__proto = {
  state,
  items: () => state.items.map((it) => ({ id: it.id, title: it.title, type: it.type, source: it.source })),
  current: () => state.currentId,
  show: (id, opts) => show(byId(id), opts || {}),
  // 原始目录挂载（排障用）：dir 为绝对 posix 路径，需落在 miai-wall:// 的根白名单内
  //（如 prototype/app/cache/ 下的场景副本）。不走 items 清单。
  showRaw: (dir, opts) => show(
    { id: '__raw', title: String(dir).split('/').filter(Boolean).pop() || 'raw', type: 'scene', dir: String(dir), previewAbs: null },
    { transition: 'cut', reason: 'raw', ...(opts || {}) },
  ),
  next: (reason = 'debug') => rotateNext(reason),
  set: (path, value) => setSetting(path, value),
  audioOn: (on) => setAudioEnabled(on),
  pauseInfo: () => ({ paused, win: { ...winNow }, hidden: document.hidden, switching, resumePending: !!resumeTimer }),
  audioInfo: () => audio.info(),
  perf: () => perfLog.slice(),
  protoStats: () => window.wpHost.protoStats(),
  stats: () => {
    const inst = currentInstance();
    try { return inst ? { ...inst.stats } : null; } catch { return null; }
  },
};

// [E4-TEMP] 种坏夹具自检（判据④「console 无 CSP 违规」的能红证明，E4 验收后删）：
// 页面代码亲自 new Function。noeval 臂期望 ok:false + console.warn（浏览器 CSP 违规与否一并观察）；
// 无 CSP / 出货 CSP 臂期望 ok:true。注意：CDP Runtime.evaluate 自带 DevTools 豁免，不算页面判据。
window.__evalSelfTest = () => {
  try { const v = new Function('return 7')(); return { ok: true, v }; }
  catch (e) { console.warn('[E4evalselftest] BLOCKED', String((e && e.message) || e)); return { ok: false, msg: String((e && e.message) || e) }; }
};
console.log('[E4evalselftest] page-native:', JSON.stringify(window.__evalSelfTest()));
