import { toRaw } from 'vue'

/**
 * 把从 store 上读到的值剥成**能过 IPC 的纯数据**。
 *
 * 【为什么需要它 —— 这是本项目踩过三次的坑】
 * Pinia 的 store 是 `reactive()` 的，**从 store 上读到的任何嵌套对象都是代理**：
 * `content.bundle.glossary.terms` 看上去是个普通数组，拿到的其实是 Proxy。
 * 而 `ipcRenderer.invoke` 走结构化克隆算法，**克隆不了代理**，当场抛
 * `An object could not be cloned.`。
 *
 * 三次是这样：设置页保存配置（见 stores/settings.ts 的 save）、
 * 每日挑战抽题（terms 只读了一层，就炸在 invoke 上）、
 * 以及挑战答题记账（那个用 markRaw 提前防住了，见 stores/challenge.ts 的 setDay）。
 *
 * 【为什么是 `structuredClone(toRaw(v))` 而不是只 `toRaw`】
 * `toRaw` 只剥**最外一层**。外层剥掉之后里层拿到的通常已经是原对象，
 * 所以多数情况一层就够 —— 但「多数情况够」不是能靠的保证。
 * 再克隆一次，得到的是**确定没有代理**的纯数据；万一哪层还藏着代理，
 * 这里会当场抛错，而不是把代理送进 IPC 等它自己炸在一个说不清的地方。
 * 代价是多拷贝一次，这些载荷都是几百字节的配置和题干，可以忽略。
 *
 * ⚠️ **它抛在哪儿，比它抛不抛更重要**（2026-09-29 在收藏 store 上量到）：
 * 这个抛是**同步**的，而落盘的两条路——防抖的定时器、`beforeunload` 里的冲刷
 * ——都在同步上下文里。写成 `save(toIpc(v)).catch(...)` 的话，`toIpc` 一抛，
 * 后面的 `.catch` **还没被建出来**，于是既不保存、也不提示，只剩一条没人看的
 * 未捕获异常。要在**组数据这一层**就 try 住（收藏 store 的 `writeNow` 就是样板：
 * 组数据和写文件都兜住，失败弹一句"没存上"）。
 */
export function toIpc<T>(value: T): T {
  return structuredClone(toRaw(value))
}
