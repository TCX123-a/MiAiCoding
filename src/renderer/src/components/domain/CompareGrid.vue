<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useRunnerStore } from '../../stores/runner'
import { toast } from '../base/toast'
import { LANG_LABEL } from '../../lib/labels'
import { CODE_BLOCK, COMPARE, TOAST } from '../../lib/copy'
import type { CompareBlock } from '../../lib/md'
import type { LangOfCode } from '../../../../shared/types'

// M3-02：四语言对比网格（compare 块渲染组件，列头带 复制/运行试试）
const props = defineProps<{ blocks: CompareBlock[] }>()

const runner = useRunnerStore()
const router = useRouter()

async function copyCode(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 旧式回退：file:// 等环境 clipboard API 不可用时用 execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  toast(TOAST.CODE_COPIED, 'success')
}

/**
 * 「运行试试」：把这一列的代码装进练习场，然后跳过去。
 *
 * 【为什么要跳页，而不是就地弹个窗口跑】
 * 就地方便，但结果只活在那一个小浮层里——用户看完就没了，也没法改一行再跑，
 * 而「改一行再跑」正是学编程最重要的那个动作。跳到练习场，代码就在编辑器里，
 * 想怎么折腾都行。
 *
 * 【为什么先 toast 再跳】
 * 跳页之后画面整个变了，用户容易以为自己点错了。这句提示立刻告诉他
 * 「是我把你带过来的，代码已经放好了」，并且说清了下一步该点「运行」。
 * toast 挂在全局（App.vue 的 MiToast），不会因为换页被切掉。
 */
function runTry(lang: string, code: string) {
  if (lang !== 'c' && lang !== 'cpp' && lang !== 'java' && lang !== 'python') return
  runner.setCode(lang as LangOfCode, code)
  toast(TOAST.CODE_SENT_TO_PLAYGROUND, 'success')
  router.push('/playground')
}
</script>

<template>
  <div class="compare-section">
    <div class="compare-title">{{ COMPARE.TITLE }}</div>
    <div v-for="(b, bi) in props.blocks" :key="bi" class="compare-grid">
      <div v-for="lang in b.langs" :key="lang" class="compare-col">
        <div class="compare-col-head">
          <span class="compare-col-lang">{{ lang }}</span>
          <div class="compare-col-actions">
            <button type="button" @click="copyCode(b.code[lang])">{{ CODE_BLOCK.COPY }}</button>
            <button type="button" @click="runTry(lang, b.code[lang])">{{ CODE_BLOCK.RUN }}</button>
          </div>
        </div>
        <pre>{{ b.code[lang] }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.compare-section {
  margin: 20px 0;
}
.compare-title {
  font-family: var(--mi-font-title);
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 10px;
}
.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.compare-col {
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius-sm);
  overflow: hidden;
  /* 原先是写死的 #fafbfd（和课文代码块当年那个值一样）。并进 --mi-code-bg：
     浅色下比 #fafbfd 深一档（和课文/答题页的代码块终于一致了），深色下自动变暗。 */
  background: var(--mi-code-bg);
}
.compare-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  background: var(--mi-card);
  border-bottom: 1px solid var(--mi-border);
}
.compare-col-lang {
  font-family: var(--mi-code);
  font-size: 11px;
  font-weight: 700;
  /* 用文字档（--mi-blue-deep 当字只有 2.24，等于看不出写了什么） */
  color: var(--mi-blue-ink);
  text-transform: uppercase;
}
.compare-col-actions {
  display: flex;
  gap: 4px;
}
.compare-col-actions button {
  font-family: var(--mi-font);
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--mi-border);
  border-radius: 999px;
  background: var(--mi-bg);
  color: var(--mi-text-2);
  cursor: var(--mi-cursor, pointer);
  /* 批⑥（2026-10-16）：原先 `transition: all .15s ease`；会变的只有 hover 的底与字色 */
  transition:
    background var(--mi-dur-fast) var(--mi-ease),
    color var(--mi-dur-fast) var(--mi-ease);
}
.compare-col-actions button:hover {
  background: var(--mi-blue);
  color: var(--mi-text);
}
.compare-col pre {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--mi-code);
  font-size: 12px;
  line-height: 1.7;
  overflow-x: auto;
  white-space: pre;
  color: var(--mi-text);
}
</style>
