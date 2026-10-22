/**
 * 收藏（**题目级**）store：favorites.json 的渲染进程镜像。
 *
 * ⚠️ 和 `profile.favorites`（**课级**收藏，存在学习档案里、总览页在用）同名不同义。
 * 那个是「收藏的课程」（`stores/progress.ts` 的 `toggleFavorite`），
 * 这个是「收藏的题目」。别合并、也别互相翻译 —— 理由写在 types.ts 的
 * FavoriteItem 抬头（合并的代价是两种收藏被绑死，想清空一种会连另一种一起没）。
 *
 * 【落盘纪律照抄 progress.ts：防抖保存 + 退出冲刷 + 走 toIpc()】
 * 主进程那侧只有两个口（`favorites:get` / `favorites:save`），整份读整份存 ——
 * 因为这个文件只有渲染层一个写方（`main/index.ts` 那两个 handler 的注释）。
 *
 * 【为什么动作都在 store 里，而不是各调用点自己拼】
 * 收藏入口有四个（练习遮罩的题干行、每日挑战回顾的每一行、练习题错题本的行、
 * 收藏页自身）。各处自己 `push` 一次、自己拼一次 item 的话，
 * 「AI 题必须带本体」这条规矩就会漏在某一条路上 —— 漏了的那条**当次能用**，
 * 重启之后那一条收藏在主进程读口被丢掉（`cleanItem` 判它是死条目），
 * 用户看到的是"我收藏的那道 AI 题自己没了"。判定与拼装只有一处，就没有这种漏法。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  CURRENT_FAVORITES_VERSION,
  type FavoriteFolder,
  type FavoriteItem,
  type FavoritesFile,
  type Question
} from '../../../shared/types'
import { isAiKey, parseQuestionKey } from '../../../shared/question-key'
import { toIpc } from '../lib/ipc-safe'
import { playSfx } from '../lib/sfx'
import { toast } from '../components/base/toast'
import { TOAST } from '../lib/copy'
import { createDocWriter } from '../lib/doc-writer'
import { isQuizActive, onQuizIdle } from '../lib/quiz-gate'
import { notifyLocalWrite } from '../lib/local-write-bus'

/**
 * 初始收藏夹 = **空的一份**，版本号取自共享常量。
 * 不就地写 `version: 1`：版本升了之后，这个字面量不会跟着变，
 * 而防抖保存是整份写回（换版本号 → 磁盘上那份被顶回去，迁移又跑一遍）。
 * 同一条教训写在 `progress.ts` 的 INITIAL 上面。
 */
function emptyFile(): FavoritesFile {
  return { version: CURRENT_FAVORITES_VERSION, folders: [], items: [] }
}

/** 变更后多久落盘。**导出是给测试用的**（同 progress.ts：写死数字的测试会变成假绿） */
export const SAVE_DEBOUNCE_MS = 300

/**
 * 本地写协议的一条变更（P10.6，docs/21 §8.2）—— 照 progress.ts 的 ProgressOp：
 * 记**具体变更**（哪条被加/删/改成什么），不是整份快照；冲突时在云端来的
 * 最新一份上重放，全部 applyOp 幂等 ensure。`item`/`folder` 记**当时造好的
 * 对象本体**（含 addedAt/id 等一次性生成的值）—— 重放时重新生成的话，
 * 同一个收藏会在两次重放里长出两个不同的 addedAt，而它还要进磁盘。
 */
type FavOp =
  | { k: 'itemAdd'; item: FavoriteItem }
  | { k: 'itemRemove'; key: string }
  | { k: 'note'; key: string; note: string | null }
  | { k: 'move'; keys: string[]; folderId: string | null }
  | { k: 'folderAdd'; folder: FavoriteFolder }
  | { k: 'folderRename'; id: string; name: string }
  | { k: 'folderRemove'; id: string }

export const useFavoritesStore = defineStore('favorites', () => {
  const file = ref<FavoritesFile>(emptyFile())

  /**
   * 读完了没有。页面拿它区分「还没读到」和「读到了，是空的」——
   * 不加这个标记的话，收藏页一进去会先**当真地**显示「还没收藏过喵」，
   * 几十毫秒后列表又自己冒出来（每日挑战被同一个坑坑过，见 progress.ts 的 loaded）。
   */
  const loaded = ref(false)

  let ready = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** 把主进程权威的一份装进 store（读口 / 冲突回话 / 同步重载共同走这里） */
  function adoptFile(data: FavoritesFile): void {
    file.value = data
  }

  /**
   * 本地写协议执行器（P10.6，docs/21 §8.2）—— 与 progress.ts 的同款机器，
   * 分工：它管戳、账本、冲突「重载 + 重放」；store 管业务动作与副作用。
   *
   * 【onError 那条 toast 是从旧 writeNow 的 catch 搬来的】两条失败路一个都不能
   * 静默：① 组数据时 `toIpc` 同步抛（代理混进数组的老坑，见下面 removeMany 的
   * 注释）—— 它在 snapshot() 里抛，被执行器接住转给这里；② 主进程写口拒了
   * （校形抛错 / 盘写不进）。收藏是"我刚做过的一个动作"，没存上必须出声 ——
   * 用户下次启动发现收藏自己少了，却没有任何地方能解释。
   */
  const writer = createDocWriter<FavoritesFile, FavOp>({
    save: (payload, stamp) => window.miai.saveFavorites(payload, stamp),
    reload: () => window.miai.getFavorites(),
    snapshot: () => toIpc(file.value),
    adopt: adoptFile,
    applyOp: (op) => {
      const f = file.value
      if (op.k === 'itemAdd') {
        if (!f.items.some((x) => x.key === op.item.key)) f.items.push(op.item)
        return
      }
      if (op.k === 'itemRemove') {
        const i = f.items.findIndex((x) => x.key === op.key)
        if (i !== -1) f.items.splice(i, 1)
        return
      }
      if (op.k === 'note') {
        const it = f.items.find((x) => x.key === op.key)
        if (!it) return
        if (op.note === null) delete it.note
        else it.note = op.note
        return
      }
      if (op.k === 'move') {
        for (const it of f.items) {
          if (!op.keys.includes(it.key)) continue
          if (op.folderId === null) delete it.folderId
          else it.folderId = op.folderId
        }
        return
      }
      if (op.k === 'folderAdd') {
        if (!f.folders.some((x) => x.id === op.folder.id)) f.folders.push(op.folder)
        return
      }
      if (op.k === 'folderRename') {
        const fo = f.folders.find((x) => x.id === op.id)
        if (fo) fo.name = op.name
        return
      }
      // folderRemove：连同条目回到未分组（与 deleteFolder 同一语义）
      const i = f.folders.findIndex((x) => x.id === op.id)
      if (i !== -1) f.folders.splice(i, 1)
      for (const it of f.items) {
        if (it.folderId === op.id) delete it.folderId
      }
    },
    canResolve: () => !isQuizActive(),
    onError: () => {
      toast(TOAST.FAVORITES_SAVE_FAILED, 'error')
    },
    // 写成功了 → 通知同步节拍器（防抖后触发一轮云同步，P10.6）
    onSaved: () => notifyLocalWrite('favorites')
  })

  // 答题会话结束 = 安全点：会话中挂起过的冲突在这里统一「重载 → 重放 → 保存」
  onQuizIdle(() => writer.resolveNow())

  async function load() {
    try {
      const env = await window.miai.getFavorites()
      adoptFile(env.data)
      writer.noteStamp(env.stamp)
      // 读档返回前记下的操作：装入可能把它顶掉，交给写协议收账（空账本 = no-op）
      if (writer.pendingCount() > 0) writer.resolveNow()
    } catch {
      /*
       * 读口真的失败了（主进程 IPC 抛了）：保持空夹，但不再装没事（V1-53）
       * —— 界面上「收藏全没了」和「读不出来」长得一模一样，必须出声。
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
  const folders = computed(() => file.value.folders)
  const keys = computed(() => new Set(file.value.items.map((i) => i.key)))

  function isFav(key: string): boolean {
    return keys.value.has(key)
  }

  function itemOf(key: string): FavoriteItem | undefined {
    return file.value.items.find((i) => i.key === key)
  }

  function folderOf(id: string): FavoriteFolder | undefined {
    return file.value.folders.find((f) => f.id === id)
  }

  /**
   * 收藏 / 取消收藏一道题。返回**动作之后**的状态（true = 现在在收藏里）。
   *
   * @param key    全局键（收藏的身份，和错题本同一套）
   * @param q      题目本体。**AI 题必传**（见下）；内置题传了也只是给判定用一下
   * @param source 从哪儿收的（模式名）—— 收藏页的「来源」筛选靠它
   *
   * 【AI 题必须带本体】和错题本一条规矩：AI 题不在任何一课里，光有 key
   * 找不回题干和选项，显示是空白、重做是静默跳过。判定用 key 前缀
   * （`isAiKey`），**不用「有没有 ai 字段」**——理由是 wrongbook.ts 那段
   * （key 永远在，ai 是选填的，拿可能缺的字段当判据就会误判）。
   *
   * 【拿不到本体时**拒绝**，不写一条半成品】主进程写口校形对"AI 题缺本体"
   * 是**抛错**的（`cleanFavoritesPayload`，`applyFavoritesSave` 落盘前的第一道闸），
   * 抛出去整个文件都写不成 ——
   * 也就是说放过这一条，赔进去的是**全部收藏**。所以这里当场拦下并出声。
   */
  function toggle(key: string, q: Question | null, source?: string): boolean {
    const i = file.value.items.findIndex((x) => x.key === key)
    if (i !== -1) {
      file.value.items.splice(i, 1)
      writer.record({ k: 'itemRemove', key })
      // 取消收藏：短促一声（收是"嘎"，撤是"咔"——两种动作两种声音）
      playSfx('click')
      toast(TOAST.QUESTION_FAV_OFF, 'success')
      return false
    }

    const ai = isAiKey(key)
    if (ai && !q) {
      toast(TOAST.QUESTION_FAV_NO_BODY, 'error')
      return false
    }

    const item: FavoriteItem = {
      key,
      // lessonId / qid 一律从 key 拆（拆键规则只有 question-key.ts 一份实现）
      ...parseQuestionKey(key),
      addedAt: new Date().toISOString()
    }
    if (source) item.source = source
    // **只有 AI 题存本体**：内置题在内容包里就有，存一份就是第二份真源
    // （主进程写口也会把内置题误传的本体剥掉，不让上游的 bug 写进磁盘）
    if (ai) item.ai = toIpc(q as Question)

    file.value.items.push(item)
    // 记的是**造好的对象本体**：addedAt 等一次性生成的值随之进账本，
    // 重放时不会重新生成（重放两次也是同一个 addedAt）
    writer.record({ k: 'itemAdd', item })
    /*
     * 2026-10-01 主人拍板：收藏音从猫咪「喵」换成大肥鱼（小黄鸭）的「嘎」——
     * 点收藏在题目卡片区域，一声猫叫很突兀（这声音属于猫咪/logo 那套语境）。
     * 取消收藏的「咔」不动（见上面那条，两动作两种声音的规矩不变）。
     */
    playSfx('quack')
    toast(TOAST.QUESTION_FAV_ON, 'success')
    return true
  }

  /**
   * 批量取消收藏（多选工具条用）。返回真的拿掉了几条 —— 一条都没拿掉时
   * 调用方不必弹"已取消"（比如列表在别处已经被改过）。
   *
   * 这里**只响一声、只弹一句**：批量动作本来就是一下，逐条弹会刷屏。
   */
  function removeMany(keysIn: readonly string[]): number {
    const set = new Set(keysIn)
    const items = file.value.items
    let n = 0
    /*
     * ⚠️ **倒着 splice，不许写 `items = items.filter(...)`**。
     *
     * `filter` 是**透过响应式代理**读元素的：它返回的新数组里装的是代理，
     * 赋值回 `file.value.items` 就把代理塞进了原始数组 —— 于是下一次落盘
     * `toIpc` 当场抛 `DataCloneError`，而且抛在定时器里没人接：
     * 批量取消看着成功了，硬盘上那份没变，重启之后收藏又回来了。
     *
     * （这个写法不是猜的：先用 `structuredClone` 量过代理会抛，
     * 再让测试撞出过这条未捕获异常。progress.ts 的删除也一律走 splice。）
     */
    for (let i = items.length - 1; i >= 0; i--) {
      if (set.has(items[i].key)) {
        // 记**实际拿掉的那几条**（不是入参那份 set）：入参里可能混着
        // 早就不在列表里的键，照抄入参的话账本会对不存在的条目重放删除
        writer.record({ k: 'itemRemove', key: items[i].key })
        items.splice(i, 1)
        n++
      }
    }
    if (n > 0) {
      playSfx('click')
      toast(TOAST.favoriteRemoved(n), 'success')
    }
    return n
  }

  /**
   * 写/改/清一条笔记。
   *
   * 整条笔记**全是空白**按"没有笔记"算（`delete item.note`）——
   * 和主进程读口同一条判据（`favorites-merge.ts` 的 cleanItem）。
   * 不这么做的话，用户清空输入框会存下一个 `''`，界面上显示成
   * 「加一条笔记喵」的框、点开却有个空盒子，而磁盘上那条笔记还在。
   *
   * 注意**不 trim**：笔记是写给人看的话，首尾换行是内容的一部分。
   */
  function setNote(key: string, note: string): boolean {
    const it = itemOf(key)
    if (!it) return false
    if (note.trim() === '') {
      delete it.note
      writer.record({ k: 'note', key, note: null })
    } else {
      it.note = note
      // 账本里记的是**原始输入**（不 trim）：setNote 的语义就是"原样存"，
      // 记 trim 过的版本会让重放后的内容和当场看到的差一个首尾空白
      writer.record({ k: 'note', key, note })
    }
    return true
  }

  /**
   * 把若干条收藏挪进一个文件夹（`folderId = null` = 挪回「未分组」）。
   *
   * 文件夹不存在就直接不动、返回 0：主进程写口有 `dropOrphanFolders`，
   * 指向空气的 folderId 会被它**静默摘掉** —— 也就是说这里放过去，
   * 用户看到的是"我点了一下移动到 X，它弹回未分组了"，而没有任何解释。
   */
  function moveTo(keysIn: readonly string[], folderId: string | null): number {
    if (folderId !== null && !folderOf(folderId)) return 0
    const set = new Set(keysIn)
    let n = 0
    for (const it of file.value.items) {
      if (!set.has(it.key)) continue
      if (folderId === null) delete it.folderId
      else it.folderId = folderId
      n++
    }
    if (n > 0) writer.record({ k: 'move', keys: [...set], folderId })
    return n
  }

  /**
   * 新建文件夹。名字全是空白 → 返回 null（调用方据此弹一句"得起个名字"）。
   *
   * id 的形状 `folder-<毫秒时间戳>-<序号>`：时间戳让磁盘上那份文件一眼能看出
   * 是什么时候建的；序号挡住"同一毫秒里连建两个"（测试里很常见）——
   * id 撞车的话主进程 `cleanList` 会把后一个当重复项**丢掉**，
   * 而用户那边看到的是"我建了两个文件夹，只出现了一个"。
   */
  let folderSeq = 0
  function createFolder(name: string): FavoriteFolder | null {
    const trimmed = name.trim()
    if (trimmed === '') return null
    const folder: FavoriteFolder = {
      id: `folder-${Date.now()}-${folderSeq++}`,
      name: trimmed,
      createdAt: new Date().toISOString()
    }
    file.value.folders.push(folder)
    writer.record({ k: 'folderAdd', folder })
    return folder
  }

  /** 改名。空名不受理（返回 false）——「不许空名」这条规矩只有一处实现 */
  function renameFolder(id: string, name: string): boolean {
    const f = folderOf(id)
    const trimmed = name.trim()
    if (!f || trimmed === '') return false
    f.name = trimmed
    // 账本记 **trim 后的**（那是落盘的最终值）—— 两个函数共用同一条
    // "空名不受理、首尾空白不算名字" 的规矩，重放得到同一个结局
    writer.record({ k: 'folderRename', id, name: trimmed })
    return true
  }

  /**
   * 删文件夹。**条目一条都不删**，里面的收藏摘掉 folderId 回到「未分组」，
   * 返回被挪出来的条数（界面拿它说一句"里面的 N 条已回到未分组"）。
   *
   * 【为什么不是"删文件夹就删里面的东西"】文件夹是**分类**，不是容器。
   * 用户点"删除文件夹"想删的是那个分类；顺手把里面的题也删掉，
   * 等于用一次误点干掉他攒了很久的收藏 —— 而收藏没有回收站。
   */
  function deleteFolder(id: string): number {
    const i = file.value.folders.findIndex((f) => f.id === id)
    if (i === -1) return 0
    file.value.folders.splice(i, 1)
    let n = 0
    for (const it of file.value.items) {
      if (it.folderId === id) {
        delete it.folderId
        n++
      }
    }
    writer.record({ k: 'folderRemove', id })
    return n
  }

  return {
    file,
    loaded,
    items,
    folders,
    flush,
    isFav,
    itemOf,
    folderOf,
    toggle,
    removeMany,
    setNote,
    moveTo,
    createFolder,
    renameFolder,
    deleteFolder,
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
