/**
 * 一次性结构改动（2026-09-14）：
 *   ① 删掉 cpp 里那条**抄了 clang 措辞**的规则 —— 本应用用的是 g++，永远不会说那句话
 *   ② 给 c 和 cpp 补一条**缺失**的规则：中文标点跟在数字后面
 *
 * 【为什么②必须存在】
 * 「中文输入法没切回来」是零基础用户的第一大坑，而 gcc 对它的报法分两种：
 *   · 标点落在「不该出现的位置」→ stray '...' in program（已有规则）
 *   · 标点紧跟在数字后面       → invalid suffix '...' on integer constant（**没有规则**）
 * 第二种更常见（`int a = 1；`），而且它会**连带**报出
 * `expected ',' or ';' before ...`，于是被那条笼统的规则抢走，
 * 用户看到的是「少了个分号」——他补一个英文分号，中文分号还在，还是错。
 *
 * 【为什么插在这个位置】
 * `invalid suffix` 是根因，`expected ',' or ';'` 是后果，两条会同时出现。
 * 顺序即优先级，所以必须排在后果那条**前面**。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DIR = 'content/error-lib/'

const NEW_RULE = (lang) => ({
  pattern: "invalid suffix '([^']+)' on integer constant",
  title: '数字后面跟了个中文标点喵',
  explain:
    `翻译官喵读到一串数字，本来以为读完了，结果后面紧跟着一个 \`{1}\` —— 它不认识这个字符，` +
    `只好把它当成数字的一部分接着往下读，越读越不对喵。\n\n` +
    `九成是**中文输入法没切回来**：\`；\` \`，\` \`：\` \`）\` 这些全角标点在电脑眼里，` +
    `和英文的半角符号是**两种完全不同的字符**——长得像，但电脑当成两个东西喵。\n\n` +
    `翻译官喵只认英文的那种喵。`,
  fixHint: `把这一行的 \`{1}\` 删掉，换成英文输入法重新打一个半角符号喵`,
  note:
    `${lang} 里「中文标点」有两种报法：落在奇怪位置是 stray，**紧跟在数字后面**就是这句 invalid suffix。` +
    `后者更常见，而且会连带报一句 expected ',' or ';'，被那句抢走的话用户会去补一个英文分号，补完还是错。` +
    `2026-09-14 用本机 gcc/g++ 16.1.0 实测。`
})

// ── c：新增规则插在 stray 之后、expected ',' or ';' 之前 ──
{
  const p = DIR + 'c.json'
  const j = JSON.parse(readFileSync(p, 'utf8'))
  const at = j.rules.findIndex((r) => r.pattern.includes("expected ',' or ';' before"))
  if (at < 0) throw new Error('c.json 里找不到 expected \',\' or \';\' 那条，顺序变了，先看清楚再插')
  j.rules.splice(at, 0, NEW_RULE('C'))
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8')
  console.log(`c.json：在第 ${at + 1} 位插入 invalid suffix，现有 ${j.rules.length} 条`)
}

// ── cpp：先删 clang 措辞那条，再新增 ──
{
  const p = DIR + 'cpp.json'
  const j = JSON.parse(readFileSync(p, 'utf8'))
  const clang = j.rules.findIndex((r) => r.pattern === "error: use of undeclared identifier '([^']+)'")
  if (clang < 0) throw new Error('cpp.json 里找不到 clang 措辞那条，可能已经删过了')
  const [gone] = j.rules.splice(clang, 1)
  console.log(`cpp.json：删掉第 ${clang + 1} 条「${gone.title}」—— g++ 只会说 was not declared in this scope，`

    + '这句是 clang 的措辞，本应用永远不会命中（第 2 条已经覆盖了同样的情况）')

  const at = j.rules.findIndex((r) => r.pattern.includes("expected ';' (?:before|after)"))
  if (at < 0) throw new Error("cpp.json 里找不到 expected ';' 那条，顺序变了")
  j.rules.splice(at, 0, NEW_RULE('C++'))
  writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8')
  console.log(`cpp.json：在第 ${at + 1} 位插入 invalid suffix，现有 ${j.rules.length} 条`)
}
