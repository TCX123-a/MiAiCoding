/**
 * 大肥鱼备忘录（P3 ②）：memo.json 的渲染进程镜像 + 增删改。
 *
 * 【落盘纪律照抄 favorites.ts：防抖 300ms + 退出冲刷 + 走 toIpc()】
 * 主进程那侧只有两个口（`memo:get` / `memo:save`），整份读整份存 ——
 * 因为这个文件只有渲染层一个写方（`main/app.ts` 那两条 handler 的注释）。
 *
 * 【为什么动作都在 store 里，而不是 MemoView 自己拼】
 * `views/` 不在 vitest 的 include 范围内：写在视图里的判断**永远不会有测试**。
 * 「上限拦截」「id 怎么铸」「删了怎么 splice」这三件事各自对应一个用户会撞上的
 * 坏结局（存不上、id 撞车丢条、代理泄漏导致整份存不进去），所以它们住在这里、
 * 由 `stores/__tests__/memo.test.ts` 钉住；MemoView 只负责画与转发。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  CURRENT_MEMO_VERSION,
  MEMO_BODY_MAX,
  utf8Bytes,
  type MemoFile,
  type MemoItem,
  type MemoKind
} from '../../../shared/types'
import { toIpc } from '../lib/ipc-safe'
import { toast } from '../components/base/toast'
import { MEMO, TOAST } from '../lib/copy'
import { createDocWriter } from '../lib/doc-writer'
import { isQuizActive, onQuizIdle } from '../lib/quiz-gate'

/**
 * 初始备忘录 = **空的一份**，版本号取自共享常量。
 * 不就地写 `version: 1`：版本升了之后，这个字面量不会跟着变，
 * 而防抖保存是整份写回（换版本号 → 磁盘上那份被顶回去，迁移又跑一遍）。
 * 同一条教训写在 `progress.ts` 的 INITIAL 上面。
 */
function emptyFile(): MemoFile {
  return { version: CURRENT_MEMO_VERSION, items: [] }
}

/** 变更后多久落盘。**导出是给测试用的**（同 favorites.ts：写死数字的测试会变成假绿） */
export const SAVE_DEBOUNCE_MS = 300

/**
 * 本地写协议的一条变更（P10.6，docs/21 §8.2）—— 照 progress/favorites 的
 * 同款账本：记**具体变更**（哪条被改成什么），冲突时在云端来的最新一份上
 * 重放，全部 applyOp 幂等 ensure。`at` = 那次动作的 updatedAt（重放带上它，
 * 而不是重放那一刻的时间 —— 否则冲突重载后条目的"上次编辑时间"会自己跳）。
 */
type MemoOp =
  | { k: 'add'; item: MemoItem }
  | { k: 'title'; id: string; title: string; at: number }
  | { k: 'kind'; id: string; kind: MemoKind; at: number }
  | { k: 'body'; id: string; body: string; at: number }
  | { k: 'remove'; id: string }

/**
 * 正文超上限了没有。**判据只有这一处**（MemoView 的字节计数不算判据，只是显示）。
 *
 * 量的是 UTF-8 字节（`utf8Bytes`），不是 `body.length` —— 一个汉字在磁盘上
 * 占 3 字节，用码元数当判据会让「界面说没超、写口（sanitizeMemo）把它拒了」。
 * 主进程写口那道拦截是最后一道防线，两道量的是同一个数。
 */
export function bodyTooLong(body: string): boolean {
  return utf8Bytes(body) > MEMO_BODY_MAX
}

export const useMemoStore = defineStore('memo', () => {
  const file = ref<MemoFile>(emptyFile())

  /**
   * 读完了没有。页面拿它区分「还没读到」和「读到了，是空的」——
   * 不加这个标记的话，备忘录页一进去会先**当真地**显示「还没有备忘喵」，
   * 几十毫秒后列表又自己冒出来（收藏页被同一个坑坑过，见 favorites.ts 的 loaded）。
   */
  const loaded = ref(false)

  let ready = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 把主进程权威的一份装进 store（读口 / 冲突回话 / 同步重载共同走这里） */
  function adoptFile(data: MemoFile): void {
    file.value = data
  }

  /**
   * 本地写协议执行器（P10.6，docs/21 §8.2）—— 与 favorites.ts 的同款机器。
   *
   * 【onError 那条 toast 是从旧 writeNow 的 catch 搬来的】两条失败路一个都不能
   * 静默：① 组数据时 `toIpc` 同步抛（代理混进数组），它在 snapshot() 里抛、
   * 被执行器接住转过来；② 主进程写口（`sanitizeMemo`）校形抛错 / 盘写不进。
   * 备忘是用户自己敲的字，他复述不出来 —— 没存上必须出声。
   */
  const writer = createDocWriter<MemoFile, MemoOp>({
    save: (payload, stamp) => window.miai.memo.save(payload, stamp),
    reload: () => window.miai.memo.get(),
    snapshot: () => toIpc(file.value),
    adopt: adoptFile,
    applyOp: (op) => {
      const list = file.value.items
      if (op.k === 'add') {
        if (!list.some((x) => x.id === op.item.id)) list.unshift(op.item)
        return
      }
      if (op.k === 'remove') {
        const i = list.findIndex((x) => x.id === op.id)
        if (i !== -1) list.splice(i, 1)
        return
      }
      const it = list.find((x) => x.id === op.id)
      if (!it) return
      if (op.k === 'title') {
        it.title = op.title
        it.updatedAt = op.at
        return
      }
      if (op.k === 'kind') {
        // 与 setKind 同一条规矩：同值不白改 updatedAt
        if (it.kind !== op.kind) {
          it.kind = op.kind
          it.updatedAt = op.at
        }
        return
      }
      // body
      it.body = op.body
      it.updatedAt = op.at
    },
    canResolve: () => !isQuizActive(),
    onError: () => {
      toast(TOAST.MEMO_SAVE_FAILED, 'error')
    }
  })

  // 答题会话结束 = 安全点：会话中挂起过的冲突在这里统一「重载 → 重放 → 保存」
  onQuizIdle(() => writer.resolveNow())

  async function load() {
    try {
      const env = await window.miai.memo.get()
      adoptFile(env.data)
      writer.noteStamp(env.stamp)
      // 读档返回前记下的操作：装入可能把它顶掉，交给写协议收账（空账本 = no-op）
      if (writer.pendingCount() > 0) writer.resolveNow()
    } catch {
      /*
       * 读口真的失败了（主进程 IPC 抛了）：保持空档，但不再装没事（V1-53）。
       * 首次运行不走这条：主进程读口对缺失文件回清洗过的空档，不抛。
       */
      toast(TOAST.STORE_READ_FAILED, 'error')
    }
    ready = true
    loaded.value = true
  }
  void load()

  function persist() {
    if (!ready) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      writer.writeNow()
    }, SAVE_DEBOUNCE_MS)
  }

  /** 立刻落盘（关窗口时用；导出主要是给测试——真跑挂了的话前面已经弹过提示了） */
  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (ready) writer.writeNow()
  }

  watch(file, persist, { deep: true })
  window.addEventListener('beforeunload', flush)

  const items = computed(() => file.value.items)

  function itemOf(id: string): MemoItem | undefined {
    return file.value.items.find((i) => i.id === id)
  }

  /**
   * 新建一条空备忘，插在**列表最前**（最近写的排最上面 —— 备忘是「我刚记的
   * 东西」，让它出现在翻半天才够得着的地方是反的）。返回新条目，调用方拿它选中。
   *
   * id 的形状 `memo-<毫秒时间戳>-<序号>`（照 favorites 的 `folder-…` 先例）：
   * 时间戳让磁盘上那份文件一眼看出是什么时候写的；序号挡住「同一毫秒连建两条」
   * —— 撞车的话主进程 `cleanList` 会把后一条当重复项**丢掉**，
   * 而用户看到的是「我建了两条，只出现一条」。
   */
  let seq = 0
  function add(kind: MemoKind): MemoItem {
    const now = Date.now()
    const item: MemoItem = {
      id: `memo-${now}-${seq++}`,
      kind,
      title: '',
      body: '',
      createdAt: now,
      updatedAt: now
    }
    file.value.items.unshift(item)
    // 记**造好的条目本体**（id/createdAt 等一次性生成的值随之进账本）
    writer.record({ k: 'add', item })
    return item
  }

  /** 改标题。空串是合法值（列表退回显示正文摘要），只判条目在不在 */
  function setTitle(id: string, title: string): boolean {
    const it = itemOf(id)
    if (!it) return false
    it.title = title
    it.updatedAt = Date.now()
    writer.record({ k: 'title', id, title, at: it.updatedAt })
    return true
  }

  /** 改分类。同值也算成功（不白改 updatedAt） */
  function setKind(id: string, kind: MemoKind): boolean {
    const it = itemOf(id)
    if (!it) return false
    if (it.kind !== kind) {
      it.kind = kind
      it.updatedAt = Date.now()
      writer.record({ k: 'kind', id, kind, at: it.updatedAt })
    }
    return true
  }

  /**
   * 改正文 —— **超上限当场拒绝并出声**（返回 false，内容一个字都不动）。
   *
   * 【为什么在输入时拦，而不是等落盘被主进程拒】
   * 主进程写口对超长条目是抛错的，而那是**整份文件**的保存：用户在 A 条粘贴了
   * 一段 100KB 的日志，赔进去的是「这次保存整个失败」—— B、C 两条的改动也一起
   * 没存上，而提示只说了一句"没存进硬盘"。在输入这一刻拦，损失的只有那次输入。
   *
   * 【为什么返回 false 而不是截断】截断是**无声地改用户写的字**：他看到的框里
   * 少了一截，再过一会儿连自己原本粘了什么都想不起来。拒绝 + 一句"拆成两条吧"
   * 才是如实的 —— 内容还在他自己的剪贴板上。
   */
  function setBody(id: string, body: string): boolean {
    const it = itemOf(id)
    if (!it) return false
    if (bodyTooLong(body)) {
      toast(MEMO.TOO_LONG, 'warn')
      return false
    }
    it.body = body
    it.updatedAt = Date.now()
    writer.record({ k: 'body', id, body, at: it.updatedAt })
    return true
  }

  /**
   * 删一条（界面先确认过再调）。返回有没有真删掉 —— 没删到时调用方不必当成功。
   *
   * 【倒着 splice，不许写 `items = items.filter(...)`】照 favorites.removeMany
   * 的先例：`filter` 是**透过响应式代理**读元素的，它把代理装进新数组、
   * 再赋值回 `file.value.items` —— 原始数组里从此躺着代理，紧接着那次落盘
   * `toIpc` 当场抛 DataCloneError，而它抛在定时器里没人接：
   * 界面看着删掉了，硬盘上那份一个字没改，重启之后备忘全回来了。
   */
  function remove(id: string): boolean {
    const list = file.value.items
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].id === id) {
        list.splice(i, 1)
        writer.record({ k: 'remove', id })
        return true
      }
    }
    return false
  }

  return {
    file,
    loaded,
    items,
    flush,
    itemOf,
    add,
    setTitle,
    setKind,
    setBody,
    remove,
    /** 外部盘面变了（同步引擎并进了云端数据）：重载一次并按账本重放 */
    resolveExternal() {
      writer.resolveNow(true)
    },
    /** 等在飞的写全部落定（激活/登出前的干涸协议） */
    whenIdle() {
      return writer.whenIdle()
    }
  }
})
