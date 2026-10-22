/**
 * 自检：dshpet-patch.mjs（咪爱编程 × dsh-pet 桌面 helper 构建期补丁）
 *
 * 跑法（仓库根目录）：node build/dshpet-patch.test.mjs
 *   全绿 → exit 0；只要有一项红 → exit 1（无静默跳过路径）。
 *
 * 覆盖：
 *   A. 内嵌迷你样本（仿真实 sprite.js / index.html 的锚点形状）：
 *      正常替换 / 缺锚点必 throw / 锚点重复必 throw / 幂等（applied=[] 且字节原样）/ isPatched 真值表。
 *   B. 真实供体（node_modules/dsh-pet/runtime/electron-helper/，存在性本身也是断言）：
 *      对真实 sprite.js + index.html + shared-core.js 跑一遍补丁，断言：
 *        · 补丁后的菜单块里 '打开网站' / '对话' / open-site 全消失（'打开网站' 与 open-site 的
 *          action 字面量在**全文件**范围内也断言消失）；
 *        · 「跟本鱼聊天」(action:'chat') 与「查看余额」(action:'show-balance'，V1-30 条件项) 是
 *          **有意恢复**的正条目：菜单块正向断言在场且各恰 1 处，且对应既有路由分支必须在场
 *          （余额菜单自 2026-10-16 起不再是死分支——宿主真的会生产余额数据）；
 *        · 菜单树拼接行换 S.buildMenuTree(this.animations, this.pet.menuEvents)（旧单参形态
 *          全文件 0 次；V1-30），余额条件项整行形状（展开式）恰 1 处、排在聊天与回到初始位置之间；
 *        · 'miai-follow-toggle'（菜单首项跟随开关三元）/ 'miai-wallpaper' / 'miai-ai' /
 *          'miai-feed' / 'miai-pat' / 'miai-pet-off' /
 *          './miai-extras.js' 在场，条目顺序固定；设置类与关闭类 POST 与 reloadDesktop 同款
 *          （裸 fetch + .catch），互动类与跟随开关与 showBalanceFromMenu 同款（S.postAction 后
 *          pollStateNow；跟随开关还要先补一拍 __miaiExtras.refreshState —— 见下 4c）；
 *        · 除补丁点外整段字节不变（前缀 / 新拼接线之后→guard / 尾段三处 byte 级比对 +
 *          index.html 全文重建比对）；
 *        · shared-core.js 右键菜单补丁（2026-10-10 图三/图四；2026-10-13 主人批·三级点不到；
 *          2026-10-16 V1-49 · 夜 V1-30/V1-37）：「菜单根落 __dshPetClampRect 可见带读数 +
 *          showPanel 行锚定双翼 + mouseleave 兜底 200→300ms + 置灰项分支 + buildMenuTree 白名单
 *          （事件组只列 menuEvents 名单内、非数组全列）+ 树根标签「动作」→「让大肥鱼做点什么」
 *          + 对话弹窗失败/异常兜底换卖萌文案（裸枚举与英文异常原文转 console.warn）」；旧形态
 *          （10-10 阶梯全套 / 200ms / 单参签名 / 全列循环头 / 「动作」标签 / 两句旧红字）全消失；
 *          原始供体先验 0 次出现，且判据对原始供体必须先红（非空自证）；除补丁点外整段字节不变
 *          （以补丁点为界分段对拍：JSDoc 前 / 签名后 / 循环体 / 根标签后 / clamp 段 / showPanel 段 /
 *          叶子锚点段 / mouseleave 段 / 对话两行段 → EOF）。
 *      ※ 作用域说明：'查看余额' / '对话' / 'show-balance' 等字样在 showBalanceFromMenu /
 *        showChatFromMenu 等方法级代码里还有残留——任务约定「其余逻辑不动」，方法与其注释一律保留；
 *        本自检只要求"菜单块 + 菜单 action 字面量"里按上表消失/恢复，并在末尾打印残留计数（数据，
 *        不是豁免）。
 *   C. 种坏见红（内置负变异自检，证明判据能红）：
 *      · 删掉 AI 设置的 POST URL → 缺失标记判据必须红；
 *      · 往新菜单块塞回 '打开网站' 条目 → 残留判据必须红；
 *      · 删掉喂饭分支的 pollStateNow → 互动写法判据必须红；
 *      · 把跟随开关条目从菜单里删掉 → 菜单首项/标记判据必须红；
 *      · 删掉跟随分支的 refreshState 补拍 → 跟随写法判据必须红；
 *      · 抹掉「关闭大肥鱼」的 POST URL → 缺失标记判据必须红；
 *      · 删一个右花括号 → 语法门必须红；
 *      · 删掉菜单里的「跟本鱼聊天」条目 → 恢复条目判据必须红；
 *      · 把 showPanel 行锚定双翼整段改回旧「贴右缘+一行夹取」→ shared-core 判据必须红；
 *      · 删掉菜单根的 __dshPetClampRect 读数 → shared-core 判据必须红；
 *      · 把 mouseleave 兜底回退成 200ms → shared-core 判据必须红；
 *      · 抹掉置灰分支的 classList.add → shared-core 判据必须红；
 *      · 置灰判据反转（node.disabled === false）→ shared-core 判据必须红；
 *      · 把菜单树白名单拆掉（eventKeys 退回全列）→ shared-core 判据必须红；
 *      · 树根标签改回「动作」→ shared-core 判据必须红；
 *      · 对话失败红字改回拼裸枚举 → shared-core 判据必须红；
 *      · 删掉菜单里的余额条件项 → sprite 判据必须红；
 *      · 拼接线改回单参（menuEvents 实参被拿掉）→ sprite 判据必须红。
 *      十八个变体若全绿，本自检自己记红（"没有种坏自检的比较器绿了不算证据"）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchSpriteJs, patchIndexHtml, isPatched, patchSharedCoreJs, isSharedCorePatched } from './dshpet-patch.mjs';

// ---------- 迷你夹具（形状仿真实文件锚点；内容为测试自造，不是真实文件） ----------

const MINI_SPRITE = [
  '/* 迷你 sprite 样本 */',
  "'use strict';",
  'class PetSprite {',
  '  onContextMenu(e) {',
  '    this.stopThrow();',
  '    this.stopMove(); // 菜单悬停期间宠物不漫游',
  '    // 桌面专属工具根项（打开网站 / 查看余额 / 碎碎念 / 对话 / 回到初始位置 / 重载配置）+ 共享菜单树',
  '    // 碎碎念/对话项无条件显示：手动触发不受 whisperEnabled 限制',
  "    const tools = [{ label: '打开网站', action: 'open-site' }];",
  "    if (this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });",
  '    tools.push(',
  "      { label: '碎碎念', action: 'whisper' },",
  "      { label: '对话', action: 'chat' },",
  "      { label: '回到初始位置', action: 'home' },",
  "      { label: '重载配置', action: 'reload' },",
  '    );',
  '    const tree = tools.concat(S.buildMenuTree(this.animations));',
  '  }',
  '',
  '  onMenuAction(leaf) {',
  '    this.closeMenu();',
  "    if (!leaf || typeof leaf !== 'object') return;",
  "    if (leaf.action === 'open-site') {",
  '      return;',
  '    }',
  '  }',
  '}',
].join('\n');

const MINI_HTML = [
  '<!doctype html>',
  '<html>',
  '  <body>',
  '    <script src="./shared-core.js"></script>',
  '    <script src="./sprite.js"></script>',
  '    <script src="./renderer.js"></script>',
  '  </body>',
  '</html>',
].join('\n');

// ---------- 迷你判据小工具 ----------

function countOccurrences(src, needle) {
  let n = 0;
  let i = src.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = src.indexOf(needle, i + needle.length);
  }
  return n;
}

/** 提取补丁后 sprite 源码里的"新菜单块"（const tools = [ … 到 menuEvents 版拼接行之前）；索引失配直接抛 */
function extractMenuRegion(code, where) {
  const start = code.indexOf('    const tools = [');
  const tree = code.indexOf('    const tree = tools.concat(S.buildMenuTree(this.animations, this.pet.menuEvents));');
  if (start === -1) throw new Error(where + '：找不到 `const tools = [`');
  if (tree === -1) throw new Error(where + '：找不到 menuEvents 版 tools.concat 拼接行');
  if (tree <= start) throw new Error(where + '：tools.concat 行不在菜单块之后');
  return code.slice(start, tree);
}

/**
 * 切出 onMenuAction 里某个 action 分支的**分支体**（从 if 行到下一个 `    if (leaf.action === ` 行之前；
 * 找不到下一个分支时截到 +800 字符）。互动分支的写法判据必须在分支体内做 —— 跨分支取
 * 第一个 pollStateNow() 会让「删掉 feed 的 pollStateNow」被 pat 的蒙混过去（种坏③实测踩过）。
 * 返回 null = 该分支不存在。
 */
function extractActionBranch(code, name) {
  const head = "    if (leaf.action === '" + name + "') {";
  const at = code.indexOf(head);
  if (at === -1) return null;
  const next = code.indexOf('\n    if (leaf.action === ', at + head.length);
  return code.slice(at, next === -1 ? at + 800 : next);
}

// ---------- 小测试框架 ----------

let passed = 0;
const failures = [];

function ok(name) {
  passed += 1;
  console.log('  ok - ' + name);
}
function bad(name, msg) {
  failures.push(name + ' :: ' + msg);
  console.error('  RED - ' + name + '\n        ' + msg);
}
function check(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    bad(name, e && e.message ? e.message : String(e));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    const show = (v) => (typeof v === 'string' && v.length > 240 ? v.slice(0, 240) + '…(len=' + v.length + ')' : v);
    throw new Error(msg + '\n        实际: ' + JSON.stringify(show(actual)) + '\n        期望: ' + JSON.stringify(show(expected)));
  }
}
/** 预期 fn 必 throw；needle 非空时还要求错误信息含它 */
function expectThrow(name, fn, needle) {
  check(name, () => {
    let err = null;
    try {
      fn();
    } catch (e) {
      err = e;
    }
    assert(err !== null, '预期 throw 但静默通过（不许静默跳过）');
    if (needle) assert(String(err.message).includes(needle), '抛错信息应含 ' + JSON.stringify(needle) + '，实际：' + err.message);
  });
}
/** 造一个"必须红"的变体：先断言变异真的发生（防自己拆台），再把变体喂给判据并要求判据报问题 */
function mutate(src, find, replaceWith) {
  assert(src.includes(find), '种坏变体找不到变异点：' + JSON.stringify(find));
  const out = src.replace(find, replaceWith);
  assert(out !== src, '种坏变体没有真的改变内容：' + JSON.stringify(find));
  return out;
}

// ---------- A. 迷你样本 ----------

console.log('\n[A] 迷你样本（锚点形状仿真实文件）');

check('夹具自检：mini sprite 含两个锚点各 1 次', () => {
  assertEq(countOccurrences(MINI_SPRITE, '    // 桌面专属工具根项'), 1, 'mini 起点锚点次数');
  assertEq(countOccurrences(MINI_SPRITE, "      { label: '重载配置', action: 'reload' },\n    );"), 1, 'mini 终点锚点次数');
  assertEq(
    countOccurrences(MINI_SPRITE, "    if (!leaf || typeof leaf !== 'object') return;\n    if (leaf.action === 'open-site') {"),
    1,
    'mini 路由锚点次数',
  );
});
check('夹具自检：mini html 含注入锚点各 1 次', () => {
  assertEq(countOccurrences(MINI_HTML, './renderer.js'), 1, 'mini renderer.js 次数');
  assertEq(countOccurrences(MINI_HTML, '</body>'), 1, 'mini </body> 次数');
});

const mini = patchSpriteJs(MINI_SPRITE);

check('mini：正常替换，applied 记录三步且都是人话', () => {
  assertEq(mini.applied.length, 3, 'applied 步数（菜单块 / 拼接行 / onMenuAction 分支）');
  assert(mini.applied.every((s) => typeof s === 'string' && s.length > 0), 'applied 条目应为非空字符串');
});
check('mini：补丁后的新菜单条目顺序固定（首项跟随开关三元）、余额条件项就位、拼接线换 menuEvents 版', () => {
  const region = extractMenuRegion(mini.code, 'mini 补丁产物');
  const order = ['打开壁纸设置', '打开 AI 设置', '喂一碗大白饭', '摸摸鱼头', '听大肥鱼碎碎念', '跟本鱼聊天', '回到初始位置', '重载宠物', '关闭大肥鱼'];
  let cursor = -1;
  for (const label of order) {
    const at = region.indexOf("label: '" + label + "'");
    assert(at !== -1, '缺条目 ' + label);
    assert(at > cursor, '条目顺序不对：' + label);
    cursor = at;
  }
  // 跟随开关是三元标签（label 不是字符串字面量，上面的 indexOf("label: '…'") 扫不到它）：
  // 正向断言整行形状 + 它排在首位（在原来的首项「打开壁纸设置」之前）。
  const followLine = "      tools.push({ label: window.__miaiExtras.followOn ? '别跟着啦' : '跟着我走', action: 'miai-follow-toggle' });";
  assertEq(countOccurrences(region, followLine), 1, '菜单里跟随开关三元行（应恰好 1 处）');
  assert(region.indexOf(followLine) < region.indexOf("label: '打开壁纸设置'"), '跟随开关应排在菜单首项');
  // V1-49：没资格时的置灰解释行（else 分支；形状与三元的 else 链固定）
  const offLine = "      tools.push({ label: '跟着我走（' + window.__miaiExtras.followBlock + '）', disabled: true });";
  assertEq(countOccurrences(region, offLine), 1, '菜单里跟随置灰解释行（应恰好 1 处）');
  assert(region.indexOf(offLine) > region.indexOf(followLine), '置灰解释行应在三元开关之后（else 分支）');
  assert(region.indexOf(offLine) < region.indexOf("label: '打开壁纸设置'"), '置灰解释行应排在壁纸项之前');
  // V1-30：余额条件项（展开式）恰 1 处，排在聊天与回到初始位置之间
  const balanceLine = "      ...(this.pet.balanceEnabled ? [{ label: '查看余额', action: 'show-balance' }] : []),";
  assertEq(countOccurrences(region, balanceLine), 1, '菜单里余额条件项（应恰好 1 处）');
  assert(region.indexOf(balanceLine) > region.indexOf("label: '跟本鱼聊天'"), '余额条件项应在聊天之后');
  assert(region.indexOf(balanceLine) < region.indexOf("label: '回到初始位置'"), '余额条件项应在回到初始位置之前');
  // V1-30：拼接线换成 menuEvents 版（恰好 1 处），旧单参形态 0 处
  assertEq(countOccurrences(mini.code, '    const tree = tools.concat(S.buildMenuTree(this.animations, this.pet.menuEvents));'), 1, 'menuEvents 版拼接线次数');
  assertEq(countOccurrences(mini.code, '    const tree = tools.concat(S.buildMenuTree(this.animations));'), 0, '旧单参拼接线应消失');
});
check('mini：菜单块里旧字样全消失（chat 与余额为有意恢复——见相邻正向断言）', () => {
  const region = extractMenuRegion(mini.code, 'mini 补丁产物');
  for (const gone of ['打开网站', 'open-site', '对话']) {
    assert(!region.includes(gone), '菜单块残留 ' + JSON.stringify(gone));
  }
});
check('mini：跟本鱼聊天与查看余额条目在场（旧对话/余额条目的有意替代，V1-30）', () => {
  const region = extractMenuRegion(mini.code, 'mini 补丁产物');
  assert(region.includes("{ label: '跟本鱼聊天', action: 'chat' }"), '菜单块缺跟本鱼聊天条目');
  assert(region.includes("[{ label: '查看余额', action: 'show-balance' }]"), '菜单块缺查看余额条件项');
});
check('mini：六个新分支在场且先于 open-site 分支', () => {
  assert(mini.code.includes("if (leaf.action === 'miai-follow-toggle') {"), '缺 miai-follow-toggle 分支');
  assert(mini.code.includes("if (leaf.action === 'miai-wallpaper') {"), '缺 miai-wallpaper 分支');
  assert(mini.code.includes("if (leaf.action === 'miai-ai') {"), '缺 miai-ai 分支');
  assert(mini.code.includes("if (leaf.action === 'miai-feed') {"), '缺 miai-feed 分支');
  assert(mini.code.includes("if (leaf.action === 'miai-pat') {"), '缺 miai-pat 分支');
  assert(mini.code.includes("if (leaf.action === 'miai-pet-off') {"), '缺 miai-pet-off 分支');
  assert(
    mini.code.indexOf("leaf.action === 'miai-wallpaper'") < mini.code.indexOf("leaf.action === 'open-site'"),
    '新分支应插在 open-site 分支之前',
  );
  assert(mini.code.includes("fetch(BASE + '/miai/open-settings?tab=wallpaper', { method: 'POST' }).catch"), 'wallpaper 分支 POST 写法');
  assert(mini.code.includes("fetch(BASE + '/miai/open-settings?tab=ai', { method: 'POST' }).catch"), 'ai 分支 POST 写法');
  assert(mini.code.includes("S.postAction(BASE + '/miai/feed')"), 'feed 分支 postAction 写法');
  assert(mini.code.includes("S.postAction(BASE + '/miai/pat')"), 'pat 分支 postAction 写法');
  const offBody = extractActionBranch(mini.code, 'miai-pet-off');
  assert(offBody !== null, '缺分支 miai-pet-off');
  const offPost = offBody.indexOf("fetch(BASE + '/miai/pet-off', { method: 'POST' })");
  assert(offPost !== -1, 'pet-off 分支缺 POST 通知');
  assert(offBody.slice(offPost).includes('.catch('), 'pet-off 分支应照 reloadDesktop 带 .catch（火后不管）');
  for (const name of ['feed', 'pat']) {
    const body = extractActionBranch(mini.code, 'miai-' + name);
    assert(body !== null, '缺分支 miai-' + name);
    const post = body.indexOf("S.postAction(BASE + '/miai/" + name + "')");
    assert(post !== -1, name + ' 分支缺 postAction');
    assert(body.indexOf('pollStateNow();', post) !== -1, name + ' 分支应在 postAction 之后拉一拍 /state');
  }
  const foBody = extractActionBranch(mini.code, 'miai-follow-toggle');
  assert(foBody !== null, '缺分支 miai-follow-toggle');
  const foPost = foBody.indexOf("S.postAction(BASE + '/miai/follow')");
  assert(foPost !== -1, 'follow 分支缺 postAction');
  assert(
    foBody.indexOf("typeof window.__miaiExtras.refreshState === 'function'", foPost) !== -1,
    'follow 分支应在 postAction 之后**带守卫**补一拍 __miaiExtras.refreshState',
  );
  assert(foBody.indexOf('window.__miaiExtras.refreshState();', foPost) !== -1, 'follow 分支应真的调用 refreshState()');
  assert(foBody.indexOf('pollStateNow();', foPost) !== -1, 'follow 分支应在 postAction 之后拉一拍 /state');
});

check('mini：幂等——再跑返回原样且 applied=[]', () => {
  const again = patchSpriteJs(mini.code);
  assertEq(again.code, mini.code, '二次补丁应字节原样');
  assertEq(again.applied.length, 0, '二次补丁 applied 应为空');
});

expectThrow('mini：缺起点锚点必 throw', () => patchSpriteJs(mutate(MINI_SPRITE, '    // 桌面专属工具根项', '    // 被挪走的注释')), '锚点命中 0 次');
expectThrow('mini：缺路由锚点必 throw', () => patchSpriteJs(mutate(MINI_SPRITE, "    if (!leaf || typeof leaf !== 'object') return;\n", '')), '锚点命中 0 次');
expectThrow(
  'mini：锚点重复命中必 throw（多次命中也不许静默挑一个）',
  () => patchSpriteJs(mutate(MINI_SPRITE, '    const tree = tools.concat(', '    // 桌面专属工具根项（重复锚点）\n    const tree = tools.concat(')),
  '锚点命中 2 次',
);

check('mini：isPatched 真值表（原始 false / 已打 true / 半打 false）', () => {
  assertEq(isPatched(MINI_SPRITE), false, '原始源码');
  assertEq(isPatched(mini.code), true, '已打满补丁');
  const half = mutate(mini.code, "BASE + '/miai/open-settings?tab=ai'", "BASE + '（路由没打上）'");
  assertEq(isPatched(half), false, '半打补丁（只剩菜单标记、路由标记被拿掉）');
});

const miniHtml = patchIndexHtml(MINI_HTML);
check('mini html：注入行在 renderer.js 之后、</body> 之前，其余字节原样', () => {
  assertEq(miniHtml.applied.length, 1, 'applied 步数');
  const rendererLine = '    <script src="./renderer.js"></script>';
  const at = MINI_HTML.indexOf(rendererLine) + rendererLine.length;
  assertEq(
    miniHtml.code,
    MINI_HTML.slice(0, at) + '\n    <script src="./miai-extras.js"></script>' + MINI_HTML.slice(at),
    '全文重建比对',
  );
  assert(miniHtml.code.indexOf('./miai-extras.js') > miniHtml.code.indexOf('./renderer.js'), 'extras 应在 renderer.js 更后处');
  assert(miniHtml.code.indexOf('./miai-extras.js') < miniHtml.code.indexOf('</body>'), 'extras 应在 </body> 前');
});
check('mini html：幂等', () => {
  const again = patchIndexHtml(miniHtml.code);
  assertEq(again.code, miniHtml.code, '二次补丁应字节原样');
  assertEq(again.applied.length, 0, '二次补丁 applied 应为空');
});
check('mini html：只是"提到过" ./miai-extras.js 的源码不算已打（不许松散子串判定）', () => {
  const mentionOnly = mutate(MINI_HTML, '  <body>', '  <!-- 预留：./miai-extras.js 将由构建期注入 -->\n  <body>');
  const out = patchIndexHtml(mentionOnly);
  assertEq(out.applied.length, 1, '仅提到文件名时补丁仍应真正执行');
  assert(out.code.includes('    <script src="./miai-extras.js"></script>\n  </body>'), '应实际注入到 </body> 前');
});
expectThrow('mini html：缺锚点必 throw', () => patchIndexHtml(mutate(MINI_HTML, './renderer.js', './renderer-2.js')), '锚点命中 0 次');

// ---------- B. 真实供体 ----------

console.log('\n[B] 真实供体 node_modules/dsh-pet/runtime/electron-helper/');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const HELPER_DIR = path.join(REPO_ROOT, 'node_modules', 'dsh-pet', 'runtime', 'electron-helper');
const SPRITE_PATH = path.join(HELPER_DIR, 'sprite.js');
const HTML_PATH = path.join(HELPER_DIR, 'index.html');
const SHARED_PATH = path.join(HELPER_DIR, 'shared-core.js');

check('真实供体文件存在', () => {
  assert(fs.existsSync(SPRITE_PATH), '缺：' + SPRITE_PATH);
  assert(fs.existsSync(HTML_PATH), '缺：' + HTML_PATH);
  assert(fs.existsSync(SHARED_PATH), '缺：' + SHARED_PATH);
});

const haveReal = fs.existsSync(SPRITE_PATH) && fs.existsSync(HTML_PATH) && fs.existsSync(SHARED_PATH);

if (!haveReal) {
  bad('真实供体缺失', '存在性已红（上面），真实文件断言未执行——不静默跳过');
} else {
  const realSprite = fs.readFileSync(SPRITE_PATH, 'utf8');
  const realHtml = fs.readFileSync(HTML_PATH, 'utf8');

  check('真实 sprite.js：原始文件不含任何 miai 标记（先用旧产物验 0 次出现）', () => {
    assertEq(isPatched(realSprite), false, '原始文件 isPatched');
    assert(!realSprite.includes('miai-wallpaper'), '原始文件不应含 miai-wallpaper');
    assert(!realSprite.includes('miai-extras'), '原始文件不应含 miai-extras');
  });

  const realOut = patchSpriteJs(realSprite);

  /** 判据集合（独立函数——种坏自检要把它喂给坏变体，验证它会红） */
  function spriteProblems(code) {
    const problems = [];
    // 1) 新菜单块里旧条目字样必须消失
    let region = null;
    try {
      region = extractMenuRegion(code, '真实补丁产物');
    } catch (e) {
      problems.push(e.message);
    }
    if (region !== null) {
      for (const gone of ['打开网站', 'open-site', '对话']) {
        if (region.includes(gone)) problems.push('菜单块残留 ' + JSON.stringify(gone));
      }
      const order = ['打开壁纸设置', '打开 AI 设置', '喂一碗大白饭', '摸摸鱼头', '听大肥鱼碎碎念', '跟本鱼聊天', '回到初始位置', '重载宠物', '关闭大肥鱼'];
      let cursor = -1;
      for (const label of order) {
        const at = region.indexOf("label: '" + label + "'");
        if (at === -1) problems.push('菜单块缺条目 ' + label);
        else if (at < cursor) problems.push('菜单块条目顺序不对：' + label);
        else cursor = at;
      }
      // 跟随开关（三元标签扫不进上面的字符串断言）：整行形状在场 + 排在首位
      const followLine = "      tools.push({ label: window.__miaiExtras.followOn ? '别跟着啦' : '跟着我走', action: 'miai-follow-toggle' });";
      const followAt = region.indexOf(followLine);
      if (followAt === -1) problems.push('菜单块缺跟随开关三元条目（或形状漂移）');
      else if (region.indexOf("label: '打开壁纸设置'") !== -1 && followAt > region.indexOf("label: '打开壁纸设置'")) {
        problems.push('跟随开关应排在菜单首项');
      }
      // V1-49 置灰解释行（没资格时画的那条）：形状在场 + 在三元开关的 else 分支 + 排在壁纸项前
      const offLine = "      tools.push({ label: '跟着我走（' + window.__miaiExtras.followBlock + '）', disabled: true });";
      const offAt = region.indexOf(offLine);
      if (offAt === -1) problems.push('菜单块缺跟随置灰解释行（或形状漂移，V1-49）');
      else {
        if (followAt !== -1 && offAt < followAt) problems.push('置灰解释行应在三元开关的 else 分支（三元之后）');
        if (region.indexOf("label: '打开壁纸设置'") !== -1 && offAt > region.indexOf("label: '打开壁纸设置'")) {
          problems.push('置灰解释行应排在菜单首项区（壁纸项之前）');
        }
      }
      // V1-30 余额条件项（展开式整行）：形状恰 1 处 + 排在聊天与回到初始位置之间
      const balanceLine = "      ...(this.pet.balanceEnabled ? [{ label: '查看余额', action: 'show-balance' }] : []),";
      const balHits = countOccurrences(region, balanceLine);
      if (balHits !== 1) problems.push('菜单块余额条件项应恰好 1 处，实际 ' + balHits);
      else {
        if (region.indexOf("label: '跟本鱼聊天'") !== -1 && region.indexOf(balanceLine) < region.indexOf("label: '跟本鱼聊天'")) {
          problems.push('余额条件项应排在聊天之后');
        }
        if (region.indexOf("label: '回到初始位置'") !== -1 && region.indexOf(balanceLine) > region.indexOf("label: '回到初始位置'")) {
          problems.push('余额条件项应排在回到初始位置之前');
        }
      }
    }
    // 2) 全文件：这些菜单 action 字面量（与旧拼接线形态）必须都造不出来了（chat/余额是例外——有意恢复）
    for (const gone of ['打开网站', "action: 'open-site'", 'S.buildMenuTree(this.animations));']) {
      if (code.includes(gone)) problems.push('全文件残留 ' + JSON.stringify(gone));
    }
    // 3) 咪爱标记必须在场
    for (const good of [
      "action: 'miai-follow-toggle'",
      "leaf.action === 'miai-follow-toggle'",
      "S.postAction(BASE + '/miai/follow')",
      "action: 'miai-wallpaper'",
      "action: 'miai-ai'",
      "action: 'miai-feed'",
      "action: 'miai-pat'",
      "action: 'miai-pet-off'",
      "leaf.action === 'miai-wallpaper'",
      "leaf.action === 'miai-ai'",
      "leaf.action === 'miai-feed'",
      "leaf.action === 'miai-pat'",
      "leaf.action === 'miai-pet-off'",
      "BASE + '/miai/open-settings?tab=wallpaper'",
      "BASE + '/miai/open-settings?tab=ai'",
      "BASE + '/miai/feed'",
      "BASE + '/miai/pat'",
      "BASE + '/miai/pet-off'",
      "'听大肥鱼碎碎念'",
      // 有意恢复：菜单条目 + 它依赖的既有路由分支（不再死代码——菜单现在真会产出 action:'chat'/'show-balance'）
      "{ label: '跟本鱼聊天', action: 'chat' }",
      "if (leaf.action === 'chat') {",
      "baseUrl: BASE + '/chat',",
      "[{ label: '查看余额', action: 'show-balance' }]",
      "if (leaf.action === 'show-balance') {",
      // V1-30：拼接行传 menuEvents（树只列有数据源的组）
      'S.buildMenuTree(this.animations, this.pet.menuEvents)',
    ]) {
      if (!code.includes(good)) problems.push('缺标记 ' + JSON.stringify(good));
    }
    // 4) POST 写法必须与 reloadDesktop 同款：裸 fetch + .catch（不 await、不重试）
    for (const tab of ['wallpaper', 'ai']) {
      const re = new RegExp("fetch\\(BASE \\+ '/miai/open-settings\\?tab=" + tab + "', \\{ method: 'POST' \\}\\)\\.catch\\(\\(e\\) => \\{");
      if (!re.test(code)) problems.push('POST 写法不符（tab=' + tab + '）：应照 reloadDesktop 裸 fetch + .catch');
    }
    {
      // 4a) 关闭大肥鱼：同款裸 fetch + .catch（通知型，不 await / 不 pollStateNow）
      const re = /fetch\(BASE \+ '\/miai\/pet-off', \{ method: 'POST' \}\)\.catch\(\(e\) => \{/;
      if (!re.test(code)) problems.push('POST 写法不符（pet-off）：应照 reloadDesktop 裸 fetch + .catch');
      const body = extractActionBranch(code, 'miai-pet-off');
      if (body === null) problems.push('缺关闭分支 miai-pet-off');
      else if (body.includes('pollStateNow();')) {
        problems.push('pet-off 分支不该拉 /state（窗口马上要没了，通知型分支不需要）');
      }
    }
    // 4b) 互动分支写法必须与 showBalanceFromMenu 同款：S.postAction(...) 后 pollStateNow()
    //     判据在**分支体内**做（见 extractActionBranch：跨分支取会蒙混过关，种坏③踩过）
    for (const name of ['feed', 'pat']) {
      const body = extractActionBranch(code, 'miai-' + name);
      if (body === null) {
        problems.push('缺互动分支 miai-' + name);
        continue;
      }
      const post = body.indexOf("S.postAction(BASE + '/miai/" + name + "')");
      if (post === -1) problems.push('互动分支（' + name + '）缺 S.postAction');
      else if (body.indexOf('pollStateNow();', post) === -1) {
        problems.push('互动分支（' + name + '）postAction 之后没有 pollStateNow');
      }
    }
    // 4c) 跟随开关分支：同款 postAction 发法 + 先补一拍 refreshState（带守卫）再 pollStateNow。
    //     refreshState 是**负载那一拍**（跟随叶子与 120ms 轮询档位归 goto 轮询管，少了它
    //     开跟随最多迟 1s 才动）；pollStateNow 是 /state 惯例（防以后配台词）。
    {
      const body = extractActionBranch(code, 'miai-follow-toggle');
      if (body === null) problems.push('缺跟随开关分支 miai-follow-toggle');
      else {
        const post = body.indexOf("S.postAction(BASE + '/miai/follow')");
        if (post === -1) problems.push('跟随开关分支缺 S.postAction(BASE + \'/miai/follow\')');
        else {
          if (body.indexOf("if (window.__miaiExtras && typeof window.__miaiExtras.refreshState === 'function') {", post) === -1) {
            problems.push('跟随开关分支缺**带守卫**的 refreshState 补拍');
          }
          if (body.indexOf('window.__miaiExtras.refreshState();', post) === -1) {
            problems.push('跟随开关分支没有真的调用 __miaiExtras.refreshState()');
          }
          if (body.indexOf('pollStateNow();', post) === -1) {
            problems.push('跟随开关分支 postAction 之后没有 pollStateNow');
          }
        }
      }
    }
    // 5) 既有 reloadDesktop 写法仍在（它是新分支的照抄样板，不能被误伤）
    if (!code.includes("fetch(BASE + '/reload', { method: 'POST' }).catch((e) => {")) {
      problems.push('reloadDesktop 的 POST 样板被误伤');
    }
    return problems;
  }

  check('真实 sprite.js：补丁后（菜单字样消失 / 咪爱标记在场 / 顺序固定 / POST 同款）', () => {
    const problems = spriteProblems(realOut.code);
    assertEq(problems.length, 0, 'problems: ' + problems.join('；'));
  });

  check('真实 sprite.js：applied 三步、产物确实变了且变长', () => {
    assertEq(realOut.applied.length, 3, 'applied 步数（菜单块 / 拼接行 / onMenuAction 分支）');
    assert(realOut.code !== realSprite, '补丁后应与原文不同');
    assert(realOut.code.length > realSprite.length, '补丁后应更长（删的菜单段 < 新增段）');
  });

  check('真实 sprite.js：除补丁点外整段字节不变（前缀 / 新拼接线之后→guard / 尾段三处比对）', () => {
    const TOOLS_START = '    // 桌面专属工具根项';
    const NEW_START = '    // 咪爱版桌面工具根项';
    const TREE_OLD = '    const tree = tools.concat(S.buildMenuTree(this.animations));';
    const TREE_NEW = '    const tree = tools.concat(S.buildMenuTree(this.animations, this.pet.menuEvents));';
    const GUARD = "    if (!leaf || typeof leaf !== 'object') return;";
    const OPEN = "    if (leaf.action === 'open-site') {";

    const oFirst = realSprite.indexOf(TOOLS_START);
    const pNew = realOut.code.indexOf(NEW_START);
    assert(oFirst !== -1 && pNew !== -1, '定位补丁点 1 失败');
    assertEq(realOut.code.slice(0, pNew), realSprite.slice(0, oFirst), '前缀字节应原样');

    const pT = realOut.code.indexOf(TREE_NEW);
    const oT = realSprite.indexOf(TREE_OLD);
    assert(pT !== -1 && oT !== -1, '定位拼接线失败');
    assertEq(realOut.code.indexOf(TREE_OLD), -1, '旧单参拼接线应消失');
    const pG = realOut.code.indexOf(GUARD);
    const oG = realSprite.indexOf(GUARD);
    assert(pG !== -1 && oG !== -1, '定位中段标记失败');
    assert(pG > pT, 'guard 应在 tree 之后');
    assertEq(
      realOut.code.slice(pT + TREE_NEW.length, pG),
      realSprite.slice(oT + TREE_OLD.length, oG),
      '中段（新拼接线之后→guard）字节应原样',
    );

    const pO = realOut.code.indexOf(OPEN);
    const oO = realSprite.indexOf(OPEN);
    assert(pO !== -1 && oO !== -1, '定位 open-site 行失败');
    assertEq(realOut.code.slice(pO), realSprite.slice(oO), '尾段（open-site→EOF）字节应原样');
  });

  check('真实 sprite.js：补丁产物语法可编译（new Function 只编译不执行）', () => {
    // 说明：new Function 构造时只做语法解析、不运行函数体，纯语法门；真正的运行由主循环的
    // 闸门/应用把关，这里不会触发任何 fetch / window 访问。
    new Function(realOut.code);
  });

  check('真实 sprite.js：幂等——再跑返回原样且 applied=[]', () => {
    const again = patchSpriteJs(realOut.code);
    assertEq(again.code, realOut.code, '二次补丁应字节原样');
    assertEq(again.applied.length, 0, '二次补丁 applied 应为空');
    assertEq(isPatched(realOut.code), true, '补丁产物 isPatched');
  });

  check('真实 sprite.js：残留字样全部落在保留的方法级代码里（数据，非豁免）', () => {
    // 'show-balance' 的残留 = 既有路由分支 + 菜单条件项 1 处（V1-30 有意恢复）；数量用现场计数比对，不手打。
    assertEq(
      countOccurrences(realOut.code, 'show-balance'),
      countOccurrences(realOut.code, "leaf.action === 'show-balance'") + 1,
      'show-balance 残留应全部是既有路由分支 + 菜单条件项 1 处',
    );
    // 'balanceEnabled' 的残留 = 菜单条件项 + showBalanceFromMenu 的方法级守卫，共 2 处
    assertEq(countOccurrences(realOut.code, 'this.pet.balanceEnabled'), 2, 'balanceEnabled 引用应恰好 2 处（菜单条件项 + 方法守卫）');
    // 有意恢复的 chat 链路：菜单条目恰 1 处（防重复插入）、路由分支恰 1 处（防误删）、桥地址恰 1 处。
    assertEq(countOccurrences(realOut.code, "{ label: '跟本鱼聊天', action: 'chat' }"), 1, '跟本鱼聊天菜单条目应恰好 1 处');
    assertEq(countOccurrences(realOut.code, "if (leaf.action === 'chat') {"), 1, 'chat 路由分支应恰好 1 处');
    assertEq(countOccurrences(realOut.code, "baseUrl: BASE + '/chat',"), 1, 'chat 弹窗的桥地址应恰好 1 处');
    const leftovers = ['查看余额', '对话'];
    const parts = leftovers.map((w) => w + '×' + countOccurrences(realOut.code, w));
    console.log('    （信息）方法级保留代码里的残留：' + parts.join(' / ') + '；菜单块内为 0；跟本鱼聊天（有意恢复）×1 → 桥 /chat；查看余额条件项 ×1 → 既有 show-balance 路由');
  });

  check('真实 index.html：补丁后可整文重建（原文 + 一行注入）', () => {
    const outHtml = patchIndexHtml(realHtml);
    assertEq(outHtml.applied.length, 1, 'applied 步数');
    const rendererLine = '    <script src="./renderer.js"></script>';
    const at = realHtml.indexOf(rendererLine) + rendererLine.length;
    assert(realHtml.indexOf(rendererLine) !== -1, '原文找不到 renderer.js 行');
    assertEq(
      outHtml.code,
      realHtml.slice(0, at) + '\n    <script src="./miai-extras.js"></script>' + realHtml.slice(at),
      'index.html 全文重建比对',
    );
    assert(outHtml.code.indexOf('./miai-extras.js') > outHtml.code.indexOf('./renderer.js'), 'extras 应在 renderer.js 更后处');
    assert(outHtml.code.indexOf('./miai-extras.js') < outHtml.code.indexOf('</body>'), 'extras 应在 </body> 前');
    const again = patchIndexHtml(outHtml.code);
    assertEq(again.code, outHtml.code, '二次补丁应字节原样');
    assertEq(again.applied.length, 0, '二次补丁 applied 应为空');
  });

  // ----- shared-core.js：右键菜单定位补丁（2026-10-10 图三/图四；2026-10-13 主人批·三级点不到） -----
  // 判据独立成函数——种坏⑨⑩⑪要把它喂给坏变体、还要先对原始供体验一次红（非空自证）。

  const rawShared = fs.readFileSync(SHARED_PATH, 'utf8');

  check('真实 shared-core.js：原始文件不含任何菜单补丁痕迹（先用旧产物验 0 次出现）', () => {
    assertEq(isSharedCorePatched(rawShared), false, '原始文件 isSharedCorePatched');
    assert(!rawShared.includes('__dshPetClampRect'), '原始文件不应含 __dshPetClampRect');
    assert(!rawShared.includes('行锚定双翼'), '原始文件不应含「行锚定双翼」');
    assert(!rawShared.includes('const fits = (l) =>'), '原始文件不应含 fits 判定');
    assert(!rawShared.includes('离开兜底 200→300ms'), '原始文件不应含 300ms 兜底注释');
    assert(!rawShared.includes('parentPanel'), '原始文件不应含 parentPanel（10-10 阶梯残迹）');
    assert(!rawShared.includes('hitsParent'), '原始文件不应含 hitsParent（10-10 阶梯残迹）');
    assert(!rawShared.includes('node.disabled'), '原始文件不应含 node.disabled（V1-49 置灰分支是自己加的）');
    assert(!rawShared.includes('dsh-pet-menu-item--off'), '原始文件不应含置灰标记类名');
    assert(!rawShared.includes('menuEvents'), '原始文件不应含 menuEvents（V1-30 白名单是自己加的）');
    assert(!rawShared.includes('eventKeys'), '原始文件不应含 eventKeys（V1-30 白名单是自己加的）');
    assert(!rawShared.includes('让大肥鱼做点什么'), '原始文件不应含新树根标签（V1-30）');
    assert(!rawShared.includes('这句本鱼没接住'), '原始文件不应含新对话失败文案（V1-37）');
    assert(!rawShared.includes('这句没传过去'), '原始文件不应含新对话异常文案（V1-37）');
    assert(!rawShared.includes('咪爱补丁（2026-10-16·V1-30）'), '原始文件不应含 V1-30 补丁标记');
    assert(!rawShared.includes('咪爱补丁（2026-10-16·V1-37）'), '原始文件不应含 V1-37 补丁标记');
  });

  /** 判据集合（独立函数——种坏⑨⑩⑪⑫⑬与「对原始供体必须红」共用） */
  function sharedCoreProblems(code) {
    const problems = [];
    // 1) 旧形态必须全消失（旧翻转行 / 10-10 阶梯全套残迹 / 200ms 兜底 / 旧树行为 / 旧红字）
    for (const gone of [
      'if (left + panel.offsetWidth > c.x + c.w - 4) left = rect.left - panel.offsetWidth - 4;',
      'let left = rect.right + 4;',
      'const showPanel = (panel, item, parentPanel) => {',
      'const hitsParent = (l, t) => {',
      'const inBand = (l, t) =>',
      'pr.top - 4 - h',
      'pr.bottom + 4',
      'showPanel(childPanel, item, panel);',
      '\t\t}, 200);',
      'function buildMenuTree(animations) {',
      '\tfor (const key of Object.keys(events)) {',
      '\t\tlabel: "动作",',
      '"对话失败："',
      '"对话异常："',
    ]) {
      if (code.includes(gone)) problems.push('残留旧形态 ' + JSON.stringify(gone));
    }
    // 2) 行锚定双翼形态在场
    for (const good of [
      '行锚定双翼',
      'const showPanel = (panel, item) => {',
      'const fits = (l) => l >= c.x + 4 && l + w <= c.x + c.w - 4;',
      'if (fits(rect.right + 4)) left = rect.right + 4;',
      'else if (fits(rect.left - w - 4)) left = rect.left - w - 4;',
      '\t\tlet top = rect.top;',
      'if (top + h > c.y + c.h - 4) top = Math.max(c.y + 4, c.y + c.h - 4 - h);',
      '\t\t}, 300);',
      '离开兜底 200→300ms',
    ]) {
      if (!code.includes(good)) problems.push('缺双翼形态 ' + JSON.stringify(good));
    }
    // 2b) 置灰项分支在场（V1-49；三个形态一个不少——半打的灰行要么能点要么不灰）
    for (const good of [
      '} else if (node.disabled === true) {',
      'item.style.opacity = "0.45";',
      'item.style.pointerEvents = "none";',
      'item.classList.add("dsh-pet-menu-item--off");',
    ]) {
      if (!code.includes(good)) problems.push('缺置灰分支形态 ' + JSON.stringify(good));
    }
    // 2c) 置灰分支不许绑点击（否则"点了没反应"变"点了有反应"——静默翻开关的僵尸项）
    {
      const at = code.indexOf('} else if (node.disabled === true) {');
      if (at !== -1) {
        const nextElse = code.indexOf('\t\t\t} else {', at);
        const branch = nextElse === -1 ? '' : code.slice(at, nextElse);
        if (branch.includes('addEventListener')) problems.push('置灰分支里出现了 addEventListener（置灰项必须无点击行为）');
      }
    }
    // 3) showPanel 区域内：两翼选择/纵向夹取/回落夹取形态各恰 1 处（防双插/误删；按区域计数，防方法级残留误报）
    const spStart = code.indexOf('\t/** 把面板显示在触发项旁边（咪爱补丁 2026-10-13·行锚定双翼）');
    const spEnd = spStart === -1 ? -1 : code.indexOf('\t/** 构建一层面板', spStart);
    if (spStart === -1 || spEnd === -1) problems.push('定位 showPanel 区域失败（doc 头或尾锚点缺席）');
    else {
      const region = code.slice(spStart, spEnd);
      for (const m of [
        'const fits = (l) =>',
        'if (fits(rect.right + 4)) left = rect.right + 4;',
        'left = Math.max(c.x + 4, left);',
        'top = Math.max(c.y + 4, c.y + c.h - 4 - h);',
      ]) {
        if (countOccurrences(region, m) !== 1) problems.push('showPanel 区域内 ' + JSON.stringify(m) + ' 应恰好 1 处，实际 ' + countOccurrences(region, m));
      }
    }
    // 4) 300ms 兜底：定时器字面量恰 1 处（注释标记在场已在第 2 组）
    if (countOccurrences(code, '}, 300);') !== 1) problems.push('300ms 定时器应恰好 1 处，实际 ' + countOccurrences(code, '}, 300);'));
    // 5) clamp 读数：恰一处 + 完整对象形状
    if (countOccurrences(code, 'root.__dshPetClampRect = ') !== 1) problems.push('clamp 读数应恰好 1 处，实际 ' + countOccurrences(code, 'root.__dshPetClampRect = '));
    if (!code.includes('\troot.__dshPetClampRect = { x: c.x, y: c.y, w: c.w, h: c.h };')) problems.push('clamp 读数形状不完整');
    // 6) 置灰标记：恰一处（只在渲染分支 classList.add；样式是内联的，没有第二处可放）
    if (countOccurrences(code, 'dsh-pet-menu-item--off') !== 1) problems.push('置灰标记应恰好 1 处，实际 ' + countOccurrences(code, 'dsh-pet-menu-item--off'));
    // 7) 菜单树白名单（V1-30）：签名/白名单行/根标签各恰 1 处
    for (const [needle, label] of [
      ['function buildMenuTree(animations, menuEvents) {', '双参签名'],
      ['const eventKeys = Array.isArray(menuEvents)', '白名单判定行'],
      ['\t\t? Object.keys(events).filter((k) => menuEvents.includes(k))', '白名单过滤行'],
      ['\tfor (const key of eventKeys) {', '白名单循环头'],
      ['\t\tlabel: "让大肥鱼做点什么",', '新树根标签'],
    ]) {
      const hits = countOccurrences(code, needle);
      if (hits !== 1) problems.push('菜单树' + label + '（' + JSON.stringify(needle) + '）应恰好 1 处，实际 ' + hits);
    }
    // 8) 对话兜底（V1-37）：两句卖萌文案各恰 1 处，且技术原因都进了 console.warn
    for (const [needle, label] of [
      ['err.textContent = "呜……这句本鱼没接住，再试一次吧喵。";', '对话失败文案'],
      ['err.textContent = "呜……大肥鱼走神了，这句没传过去，再试一次吧喵。";', '对话异常文案'],
      ['console.warn("[dsh-pet] 对话失败（技术原因，不进气泡）：", state.message ?? state.reason);', '对话失败 warn'],
      ['console.warn("[dsh-pet] 对话异常（技术原因，不进气泡）：", e);', '对话异常 warn'],
    ]) {
      const hits = countOccurrences(code, needle);
      if (hits !== 1) problems.push('对话兜底' + label + '应恰好 1 处，实际 ' + hits);
    }
    return problems;
  }

  check('真实 shared-core.js：判据对原始供体必须红（非空自证——判据在未打补丁文件上都不红，就是空转）', () => {
    const problems = sharedCoreProblems(rawShared);
    assert(problems.length > 0, '判据对未打补丁的原始供体竟然全绿——判据空转');
  });

  const sharedOut = patchSharedCoreJs(rawShared);

  check('真实 shared-core.js：补丁后（旧形态消失 / 双翼与读数在场且区内唯一 / 300ms 兜底）', () => {
    const problems = sharedCoreProblems(sharedOut.code);
    assertEq(problems.length, 0, 'problems: ' + problems.join('；'));
  });

  check('真实 shared-core.js：applied 三步、产物确实变了且变长', () => {
    assertEq(sharedOut.applied.length, 3, 'applied 步数（菜单定位+置灰 / 菜单树白名单+根标签 / 对话兜底文案）');
    assert(sharedOut.code !== rawShared, '补丁后应与原文不同');
    assert(sharedOut.code.length > rawShared.length, '补丁后应更长（插入 clamp 读数段 + 双翼 doc + 白名单/文案，且 mouseleave 段加注释）');
  });

  check('真实 shared-core.js：除补丁点外整段字节不变（以九个补丁点为界分段对拍）', () => {
    const SIG_OLD = 'function buildMenuTree(animations) {';
    const SIG_NEW = 'function buildMenuTree(animations, menuEvents) {';
    const EV_CONST = '\tconst events = animations.events ?? {};';
    const FOR_OLD = '\tfor (const key of Object.keys(events)) {';
    const FOR_NEW = '\tfor (const key of eventKeys) {';
    const RL_OLD = '\t\tlabel: "动作",';
    const RL_NEW = '\t\tlabel: "让大肥鱼做点什么",';
    const ROOT_ANCHOR = [
      '\tconst root = document.createElement("div");',
      '\troot.className = "dsh-pet-menu";',
      '\troot.style.left = "0px";',
      '\troot.style.top = "0px";',
    ].join('\n');
    const CLAMP_LINE = 'root.__dshPetClampRect = { x: c.x, y: c.y, w: c.w, h: c.h };';
    const SP_PREFIX = '\t/** 把面板显示在触发项旁边';
    const SP_TAIL = '\t\tpanel.style.left = left + "px";\n\t\tpanel.style.top = top + "px";\n\t};';
    const AFTER_SP = '\t/** 构建一层面板';
    // —— 补丁点 P1~P3（菜单树：签名 / 事件头 / 根标签，V1-30）——
    // P1 之前（含插入的 JSDoc 起点的判定）：逐字节原样
    const sSig = rawShared.indexOf(SIG_OLD);
    const pSig = sharedOut.code.indexOf(SIG_NEW);
    assert(sSig !== -1 && pSig !== -1, '定位 buildMenuTree 签名失败');
    const pDoc = sharedOut.code.indexOf('/**\n * 咪爱补丁（2026-10-16·V1-30）');
    assert(pDoc !== -1, '定位 V1-30 JSDoc 失败');
    assertEq(sharedOut.code.slice(0, pDoc), rawShared.slice(0, sSig), '第一补丁点（JSDoc）之前字节应原样');
    // 签名行之后 → events 常量行：逐字节原样（两者之间是 buildMenuTree 的既有函数体）
    const sEv = rawShared.indexOf(EV_CONST, sSig);
    const pEv = sharedOut.code.indexOf(EV_CONST);
    assert(sEv !== -1 && pEv !== -1, '定位 events 常量行失败');
    assertEq(
      sharedOut.code.slice(pSig + SIG_NEW.length, pEv),
      rawShared.slice(sSig + SIG_OLD.length, sEv),
      '签名行之后 → events 常量行字节应原样',
    );
    // 循环头之后 → 根标签**补丁注释**之前（循环体）：逐字节原样（补丁注释属于 P3 的替换段）
    const sFor = rawShared.indexOf(FOR_OLD);
    const pFor = sharedOut.code.indexOf(FOR_NEW);
    const sRl = rawShared.indexOf(RL_OLD);
    const pRlDoc = sharedOut.code.indexOf('\t\t// 咪爱补丁（V1-30）：原「动作」是工程词');
    const pRl = sharedOut.code.indexOf(RL_NEW);
    assert(sFor !== -1 && pFor !== -1 && sRl !== -1 && pRlDoc !== -1 && pRl !== -1, '定位事件循环头/根标签失败');
    assertEq(
      sharedOut.code.slice(pFor + FOR_NEW.length, pRlDoc),
      rawShared.slice(sFor + FOR_OLD.length, sRl),
      '循环头之后 → 根标签补丁注释之前（循环体）字节应原样',
    );
    // 根标签行之后 → root 块：逐字节原样
    const sRootAt = rawShared.indexOf(ROOT_ANCHOR);
    const oRootAt = sharedOut.code.indexOf(ROOT_ANCHOR);
    assert(sRootAt !== -1 && oRootAt !== -1, '定位 root 块失败');
    assertEq(
      sharedOut.code.slice(pRl + RL_NEW.length, oRootAt),
      rawShared.slice(sRl + RL_OLD.length, sRootAt),
      '根标签之后 → root 块字节应原样',
    );
    const sRootEnd = sRootAt + ROOT_ANCHOR.length;
    const oRootEnd = oRootAt + ROOT_ANCHOR.length;

    // 插入段：以补丁注释首行开头、以 clamp 读数行收尾；其后到 showPanel 起点逐字节原样
    assertEq(rawShared.indexOf(CLAMP_LINE), -1, '原始供体不该出现 clamp 读数（先验 0 次）');
    const oClampAt = sharedOut.code.indexOf(CLAMP_LINE);
    assert(oClampAt !== -1, '补丁产物找不到 clamp 读数行');
    const oClampEnd = oClampAt + CLAMP_LINE.length;
    const inserted = sharedOut.code.slice(oRootEnd, oClampEnd);
    assert(inserted.startsWith('\n\t// 咪爱补丁（2026-10-10·图三）'), '插入段应以补丁注释首行开头');
    assert(inserted.endsWith(CLAMP_LINE), '插入段应以 clamp 读数行收尾');
    const sSpStart = rawShared.indexOf(SP_PREFIX);
    const oSpStart = sharedOut.code.indexOf(SP_PREFIX);
    assert(sSpStart !== -1 && oSpStart !== -1, '定位 showPanel doc 起点失败');
    assertEq(countOccurrences(rawShared, SP_PREFIX), 1, '原始 SP_PREFIX 应恰好 1 处');
    assertEq(countOccurrences(sharedOut.code, SP_PREFIX), 1, '产物 SP_PREFIX 应恰好 1 处');
    assertEq(sharedOut.code.slice(oClampEnd, oSpStart), rawShared.slice(sRootEnd, sSpStart), 'clamp 插入段之后 → showPanel 起点，字节应原样');

    // showPanel 段：尾三行仍在；其后到「构建一层面板」注释逐字节原样
    const sTail = rawShared.indexOf(SP_TAIL, sSpStart);
    const oTail = sharedOut.code.indexOf(SP_TAIL, oSpStart);
    assert(sTail !== -1 && oTail !== -1, '定位 showPanel 尾三行失败');
    const sAfter = rawShared.indexOf(AFTER_SP, sTail);
    const oAfter = sharedOut.code.indexOf(AFTER_SP, oTail);
    assert(sAfter !== -1 && oAfter !== -1, '定位「构建一层面板」注释失败');
    assertEq(sharedOut.code.slice(oTail + SP_TAIL.length, oAfter), rawShared.slice(sTail + SP_TAIL.length, sAfter), 'showPanel 之后（尾三行→构建注释）字节应原样');

    // 「构建一层面板」注释 → mouseleave 替换段起点：字节原样（子面板调用点未动 —— 新 showPanel 仍是 2 参）
    // ⚠️ 补丁把注释垫在监听器行**前面**（原版该处紧跟 rootPanel 定位），所以替换段起点在
    // 产物里是注释首行、在原版里才是监听器行 —— 用各自的真起点对拍，别拿监听器行当两边共用锚。
    const LEAVE_START = '\troot.addEventListener("mouseleave", () => {';
    const PATCH_LEAVE = '\t// 咪爱补丁（2026-10-13）：离开兜底 200→300ms';
    const MOUSEOVER_LINE = '\troot.addEventListener("mouseover", () => {';
    const sLeave = rawShared.indexOf(LEAVE_START, sAfter);
    const oLeave = sharedOut.code.indexOf(PATCH_LEAVE, oAfter);
    assert(sLeave !== -1 && oLeave !== -1, '定位 mouseleave 替换段起点失败');
    assertEq(countOccurrences(rawShared, LEAVE_START), 1, '原始 mouseleave 行应恰好 1 处');
    assertEq(countOccurrences(rawShared, 'showPanel(childPanel, item);'), 1, '原始子面板调用应恰好 1 处（本补丁不再改调用点）');
    // 「构建一层面板」注释 → 菜单叶子分支锚点（V1-49 置灰分支的插入点）：锚点之前的字节原样
    const LEAF_ANCHOR = [
      '\t\t\t} else {',
      '\t\t\t\tconst label = document.createElement("span");',
      '\t\t\t\tlabel.textContent = node.label;',
      '\t\t\t\titem.appendChild(label);',
      '\t\t\t\titem.addEventListener("click", (e) => {',
    ].join('\n');
    const sDis = rawShared.indexOf(LEAF_ANCHOR, sAfter);
    const oDis = sharedOut.code.indexOf(LEAF_ANCHOR, oAfter);
    assert(sDis !== -1 && oDis !== -1, '定位菜单叶子分支锚点失败');
    assertEq(countOccurrences(rawShared, LEAF_ANCHOR), 1, '原始叶子锚点应恰好 1 处');
    assertEq(countOccurrences(sharedOut.code, LEAF_ANCHOR), 1, '产物叶子锚点应恰好 1 处（补丁保留原文、只在其前插入）');
    const preLen = sDis - sAfter;
    assertEq(sharedOut.code.slice(oAfter, oAfter + preLen), rawShared.slice(sAfter, sDis), '构建注释 → 叶子锚点之前字节应原样');
    const insertedOff = sharedOut.code.slice(oAfter + preLen, oDis);
    assert(insertedOff.startsWith('\t\t\t} else if (node.disabled === true) {'), '置灰插入段应以 disabled 分支开头');
    assert(insertedOff.endsWith('item.classList.add("dsh-pet-menu-item--off");\n'), '置灰插入段应以 classList.add 行收尾');
    assert(insertedOff.includes('item.style.pointerEvents = "none";'), '置灰插入段应含 pointer-events 熄灭行');
    assertEq(
      sharedOut.code.slice(oDis + LEAF_ANCHOR.length, oLeave),
      rawShared.slice(sDis + LEAF_ANCHOR.length, sLeave),
      '叶子锚点之后 → mouseleave 替换段起点之间（含子面板调用点）字节应原样',
    );

    // mouseleave 段：整段被替换（注释开头、300ms 收尾、内部不含 mouseover）；mouseover 行 → EOF 字节原样
    const sMo = rawShared.indexOf(MOUSEOVER_LINE, sLeave);
    const oMo = sharedOut.code.indexOf(MOUSEOVER_LINE, oLeave);
    assert(sMo !== -1 && oMo !== -1, '定位 mouseover 行失败');
    assertEq(countOccurrences(rawShared, MOUSEOVER_LINE), 1, '原始 mouseover 行应恰好 1 处');
    const oLeaveBlock = sharedOut.code.slice(oLeave, oMo);
    assert(oLeaveBlock.startsWith(PATCH_LEAVE), 'mouseleave 替换段应以补丁注释开头');
    assert(oLeaveBlock.endsWith('\t\t}, 300);\n\t});\n'), 'mouseleave 替换段应以 }, 300); + }); 收尾（其后仅换行）');
    assertEq(countOccurrences(oLeaveBlock, 'root.addEventListener("mouseleave", () => {'), 1, 'mouseleave 替换段内监听器应恰 1 处');
    assert(!oLeaveBlock.includes('root.addEventListener("mouseover"'), 'mouseleave 替换段不应吞掉 mouseover 监听器');
    assert(!oLeaveBlock.includes('}, 200);'), 'mouseleave 替换段不应残留 200ms');
    // —— 补丁点 P8/P9（对话弹窗失败/异常兜底，V1-37）——
    const FAIL_OLD = '\t\t\t\terr.textContent = "对话失败：" + (state.message ?? state.reason);';
    const FAIL_TAIL = '\t\t\t\tconsole.warn("[dsh-pet] 对话失败（技术原因，不进气泡）：", state.message ?? state.reason);';
    const CATCH_OLD = '\t\t\terr.textContent = "对话异常：" + String(e && e.message ? e.message : e);';
    const CATCH_TAIL = '\t\t\tconsole.warn("[dsh-pet] 对话异常（技术原因，不进气泡）：", e);';
    const sFail = rawShared.indexOf(FAIL_OLD, sMo);
    const pFailDoc = sharedOut.code.indexOf('\t\t\t\t// 咪爱补丁（2026-10-16·V1-37）：红字不再拼裸枚举');
    const pFailTail = sharedOut.code.indexOf(FAIL_TAIL, oMo);
    assert(sFail !== -1 && pFailDoc !== -1 && pFailTail !== -1, '定位对话失败补丁点失败');
    assertEq(sharedOut.code.slice(oMo, pFailDoc), rawShared.slice(sMo, sFail), 'mouseover 行 → 对话失败补丁点之前字节应原样');
    const sCatch = rawShared.indexOf(CATCH_OLD, sFail);
    const pCatchDoc = sharedOut.code.indexOf('\t\t\t// 咪爱补丁（2026-10-16·V1-37）：同上一处');
    const pCatchTail = sharedOut.code.indexOf(CATCH_TAIL, pFailTail);
    assert(sCatch !== -1 && pCatchDoc !== -1 && pCatchTail !== -1, '定位对话异常补丁点失败');
    assertEq(
      sharedOut.code.slice(pFailTail + FAIL_TAIL.length, pCatchDoc),
      rawShared.slice(sFail + FAIL_OLD.length, sCatch),
      '对话失败行之后 → 异常补丁点之前字节应原样',
    );
    assertEq(
      sharedOut.code.slice(pCatchTail + CATCH_TAIL.length),
      rawShared.slice(sCatch + CATCH_OLD.length),
      '对话异常行之后 → EOF 字节应原样',
    );
  });

  check('真实 shared-core.js：补丁产物语法可编译（new Function 只编译不执行）', () => {
    // 同 sprite 语法门：构造时只做语法解析、不运行函数体。
    new Function(sharedOut.code);
  });

  check('真实 shared-core.js：幂等——再跑返回原样且 applied=[]', () => {
    const again = patchSharedCoreJs(sharedOut.code);
    assertEq(again.code, sharedOut.code, '二次补丁应字节原样');
    assertEq(again.applied.length, 0, '二次补丁 applied 应为空');
    assertEq(isSharedCorePatched(sharedOut.code), true, '补丁产物 isSharedCorePatched');
  });

  // ----- C. 种坏见红：判据必须能被坏变体打红，全绿才算数 -----

  console.log('\n[C] 种坏见红（负变异自检）');

  check('种坏①：抹掉 AI 设置的 POST URL → 缺失标记判据必须红', () => {
    const broken = mutate(realOut.code, "BASE + '/miai/open-settings?tab=ai'", "BASE + '（URL 被抹掉）'");
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check("种坏②：往菜单块塞回 '打开网站' 条目 → 残留判据必须红", () => {
    const broken = mutate(
      realOut.code,
      "      { label: '听大肥鱼碎碎念', action: 'whisper' },",
      "      { label: '打开网站', action: 'open-site' },\n      { label: '听大肥鱼碎碎念', action: 'whisper' },",
    );
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏③：删掉喂饭分支的 pollStateNow → 互动写法判据必须红', () => {
    // 只删 feed 分支里的那一句（它在 postAction 与 .catch 之间，形状唯一）
    const broken = mutate(
      realOut.code,
      "          if (!ok) console.warn('[dsh-pet] 菜单喂饭：动作未成功');\n          pollStateNow();\n",
      "          if (!ok) console.warn('[dsh-pet] 菜单喂饭：动作未成功');\n",
    );
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏④：删一个右花括号 → 语法门必须红', () => {
    const broken = mutate(realOut.code, "    }\n    if (leaf.action === 'miai-ai') {", "\n    if (leaf.action === 'miai-ai') {");
    let threw = false;
    try {
      new Function(broken);
    } catch {
      threw = true;
    }
    assert(threw, '带残缺花括号的坏变体竟通过语法门——语法门失灵');
  });
  check('种坏⑤：删掉菜单里的「跟本鱼聊天」条目 → 恢复条目判据必须红', () => {
    const broken = mutate(realOut.code, "{ label: '跟本鱼聊天', action: 'chat' },\n", '');
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑥：抹掉「关闭大肥鱼」的 POST URL → 缺失标记判据必须红', () => {
    const broken = mutate(realOut.code, "BASE + '/miai/pet-off'", "BASE + '（URL 被抹掉）'");
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑦：把跟随开关条目从菜单里删掉 → 菜单首项/标记判据必须红', () => {
    const broken = mutate(
      realOut.code,
      "      tools.push({ label: window.__miaiExtras.followOn ? '别跟着啦' : '跟着我走', action: 'miai-follow-toggle' });\n",
      '',
    );
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑧：删掉跟随分支的 refreshState 补拍 → 跟随写法判据必须红', () => {
    // 只删那一句调用（连同它的守卫行），分支里 pollStateNow 仍在——正是"看起来还在补拍"的假绿形态
    const broken = mutate(
      realOut.code,
      "          if (window.__miaiExtras && typeof window.__miaiExtras.refreshState === 'function') {\n            window.__miaiExtras.refreshState();\n          }\n",
      '',
    );
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑨：把行锚定双翼整段改回旧「贴右缘+一行夹取」（两翼/纵向形态全失）→ shared-core 判据必须红', () => {
    const broken = mutate(
      sharedOut.code,
      '\t\tif (fits(rect.right + 4)) left = rect.right + 4;\n\t\telse if (fits(rect.left - w - 4)) left = rect.left - w - 4;\n\t\telse {\n\t\t\tleft = rect.right + 4;\n\t\t\tif (left + w > c.x + c.w - 4) left = rect.left - w - 4;\n\t\t\tleft = Math.max(c.x + 4, left);\n\t\t}',
      '\t\tlet left = rect.right + 4;\n\t\tif (left + panel.offsetWidth > c.x + c.w - 4) left = rect.left - panel.offsetWidth - 4;',
    );
    const problems = sharedCoreProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑩：删掉菜单根的 __dshPetClampRect 读数（去 clamp 存储）→ shared-core 判据必须红', () => {
    const broken = mutate(
      sharedOut.code,
      '\troot.__dshPetClampRect = { x: c.x, y: c.y, w: c.w, h: c.h };\n',
      '',
    );
    const problems = sharedCoreProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑪：把 mouseleave 兜底回退成 200ms（定时器+注释一起改，模拟真回退）→ shared-core 判据必须红', () => {
    let broken = mutate(sharedOut.code, '\t\t}, 300);', '\t\t}, 200);');
    broken = mutate(broken, '离开兜底 200→300ms', '离开兜底 200ms');
    const problems = sharedCoreProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑫：抹掉置灰分支的 classList.add（灰行没了标记、也没了灰）→ shared-core 判据必须红', () => {
    const broken = mutate(
      sharedOut.code,
      '\t\t\t\titem.classList.add("dsh-pet-menu-item--off");\n',
      '',
    );
    const problems = sharedCoreProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑬：置灰判据反转（node.disabled === false，置灰项反变成唯一能点的那类）→ shared-core 判据必须红', () => {
    const broken = mutate(sharedOut.code, '} else if (node.disabled === true) {', '} else if (node.disabled === false) {');
    const problems = sharedCoreProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑭：把菜单树白名单拆掉（eventKeys 退回全列遍历，死组又上菜单）→ shared-core 判据必须红', () => {
    const broken = mutate(
      sharedOut.code,
      '\tconst eventKeys = Array.isArray(menuEvents)\n\t\t? Object.keys(events).filter((k) => menuEvents.includes(k))\n\t\t: Object.keys(events);\n\tfor (const key of eventKeys) {',
      '\tfor (const key of Object.keys(events)) {',
    );
    const problems = sharedCoreProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑮：树根标签改回「动作」（工程词回潮）→ shared-core 判据必须红', () => {
    const broken = mutate(sharedOut.code, '\t\tlabel: "让大肥鱼做点什么",', '\t\tlabel: "动作",');
    const problems = sharedCoreProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑯：对话失败红字改回拼裸枚举（用户又看见 state.message ?? state.reason）→ shared-core 判据必须红', () => {
    const broken = mutate(
      sharedOut.code,
      '\t\t\t\terr.textContent = "呜……这句本鱼没接住，再试一次吧喵。";',
      '\t\t\t\terr.textContent = "对话失败：" + (state.message ?? state.reason);',
    );
    const problems = sharedCoreProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑰：删掉菜单里的余额条件项（余额入口又消失）→ sprite 判据必须红', () => {
    const broken = mutate(
      realOut.code,
      "      ...(this.pet.balanceEnabled ? [{ label: '查看余额', action: 'show-balance' }] : []),\n",
      '',
    );
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
  check('种坏⑱：拼接线改回单参（menuEvents 实参被拿掉，树又列全组）→ sprite 判据必须红', () => {
    const broken = mutate(
      realOut.code,
      'S.buildMenuTree(this.animations, this.pet.menuEvents)',
      'S.buildMenuTree(this.animations)',
    );
    const problems = spriteProblems(broken);
    assert(problems.length > 0, '坏变体竟全绿——判据失灵');
  });
}

// ---------- 汇总 ----------

console.log('\n===== 通过 ' + passed + ' 项，失败 ' + failures.length + ' 项 =====');
if (failures.length > 0) {
  for (const f of failures) console.error('RED: ' + f);
  process.exit(1);
}
console.log('全绿。');
process.exit(0);
