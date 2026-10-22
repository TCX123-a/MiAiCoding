<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useContentStore } from '../stores/content'
import { useChallengeStore } from '../stores/challenge'
import { LANG_LABEL, STAGE_LABEL } from '../lib/labels'
import { CHALLENGE, FALLBACK, HOME } from '../lib/copy'
import MiMascot from '../components/base/MiMascot.vue'
import MiBubble from '../components/domain/MiBubble.vue'
import MiButton from '../components/base/MiButton.vue'

const content = useContentStore()
const challenge = useChallengeStore()
const router = useRouter()
const version = ref('')

onMounted(async () => {
  version.value = await window.miai.getVersion()
  // 首页那张卡要显示「今天做完没有」，所以首页也得读一次挑战记录。
  // 只是一次本地文件读取，比让用户点进去才发现「哦今天做过了」划算
  void challenge.load()
})

// 模块名/阶段名统一取自 labels.ts（此前这里各抄了一份，与侧栏、总览页三份并存）
const moduleName = computed(() => LANG_LABEL[content.activeLang] ?? FALLBACK.UNKNOWN_MODULE)

const stageName = computed(() => {
  // 通用知识不划分阶段，后缀留空
  if (content.activeLang === 'common') return ''
  return HOME.stageSuffix(STAGE_LABEL[content.activeStage] ?? FALLBACK.UNKNOWN_STAGE)
})

const readyCount = computed(() => content.activeLessons.filter((l) => l.hasContent).length)

function goChallenge() {
  router.push('/challenge')
}

/**
 * 欢迎卡上的「大肥鱼怎么玩」（V1-51）：跳设置页的互动说明卡。
 * 与侧栏状态块用的是**同一条深链**（?card=pet；at 只是让已在设置页时
 * 也能重新触发滚动 + 闪烁，见 SettingsView 的 applyCardQuery）。
 */
function openPetGuide(): void {
  void router.push({ path: '/settings', query: { card: 'pet', at: String(Date.now()) } })
}

/**
 * 「现在没有题可出」（还没学过任何课）。
 *
 * **必须连 `ready` 一起判**：档案读完之前 `learned` 是空数组，和「真的什么都没学」
 * 长得一模一样，只判 `hasPool` 的话，学过课的用户每次进首页都会先看到
 * 「先去学一课喵～」再自己改口 —— 一个明确说错话又自认错的界面。
 * 同一个坑在挑战页踩过，见 stores/progress.ts 的 loaded。
 */
const noPool = computed(() => challenge.ready && !challenge.hasPool)

/**
 * 「挑战还没解锁」（一门语言都没学完，2026-10-10 主人令）。
 *
 * 同样连 `ready` 判 —— 理由与 `noPool` 一模一样。排在 `noPool` 的分支**前面**：
 * 没解锁时池子必然是空的，先说「去学第一课」对学到一半的人是错的，
 * 也不解释解锁规则（挑战页那边有完整版讲解和语言进度）。
 */
const locked = computed(() => challenge.ready && !challenge.unlocked)
</script>

<template>
  <div class="learn-view">
    <div class="welcome-card">
      <div class="welcome-mascots">
        <!--
          V1-40（主人裁定「猫头交互也是bug应该有猫咪音效的」，2026-10-15 夜）：
          这只猫原来**点了毫无反应** —— 三支 cat-click 素材近 1MB 每次启动
          照付解码费，却一个触发点都没有（全工程 0 处 data-sfx="meow"）。
          现在它点一下会喵。
          【为什么声音写在这行注释外的一行属性里】与 MiMascot 同一套：
          声音不在这里播，`data-sfx="meow"` 交给 lib/sfx-wire.ts 的全局委托
          （素材 cat-click-1/2/3 每次随机抽一段）。没做成真按钮的理由也同
          MiMascot：这一下不导航、不改数据，给它 role/tabindex 等于在首页
          插一个只为听响的 Tab 停留点。
          hover 提示沿用侧栏那只猫留下的『喵？』（SIDEBAR.LOGO_CAT_HINT
          迁居到此，见 copy.ts 的 HOME.CAT_HINT）—— 它是让人产生
          "点一下试试"念头的反问，不是功能说明。
        -->
        <span class="welcome-cat" data-sfx="meow" :title="HOME.CAT_HINT">🐱</span>
        <MiMascot pose="welcome" size="l" />
        <MiBubble class="welcome-bubble">
          {{ HOME.GREETING }}<br />
          {{ HOME.GREETING_SUB }}
        </MiBubble>
      </div>
      <h1>{{ HOME.TITLE }}</h1>
      <p>{{ HOME.INTRO }}</p>
      <MiButton size="sm" variant="secondary" class="pet-guide-btn" @click="openPetGuide">
        {{ HOME.PET_GUIDE_ENTRY }}
      </MiButton>
      <div class="version">{{ HOME.version(version) }}</div>
    </div>

    <!-- 今日挑战：**排在当前模块卡之前**。
         排在后面时它是「第三张卡」，一屏里最先看到的是欢迎语和模块统计 ——
         而这是首页唯一一件「今天该做的事」，它应该抢在信息前面。
         整张卡都能点（人和卡片的距离比和按钮的距离近），按钮上加 .stop
         是为了别让一次点击同时走两条路 —— 两条路都 push 同一个路由，
         结果虽然一样，但将来只要有一边加了别的动作，就会变成「点一下做两件事」。
         【V2-40】整卡是 <button> 不是 div：做完了/没题/锁定时内层按钮不渲染，
         div 版这时整卡对键盘是死区（鼠标点得进挑战页，键盘一个停点都没有）。
         转按钮后四种状态都有 Tab 停点，回车语义与鼠标点击一致。
         默认外观重置见下面 button.challenge-card。 -->
    <button
      type="button"
      class="challenge-card"
      :class="{ done: challenge.finishedToday, locked }"
      @click="goChallenge"
    >
      <div class="challenge-text">
        <div class="challenge-title">{{ CHALLENGE.HOME_CARD_TITLE }}</div>
        <!-- 没题可出时说真话：写「答对继续、答错收工…」再给个「开始挑战」，
             是**一句办不到的承诺** —— 点进去只会看到空状态/锁定页。
             这里复用挑战页那几句（同一个状态，不是借别人的文案），
             并且**不给按钮**：卡片点进去就是那个带引导按钮的页面，
             在这儿再放一个同名按钮，点哪儿去哪就说不清了 -->
        <div class="challenge-body">
          {{
            locked
              ? CHALLENGE.HOME_CARD_LOCKED
              : noPool
                ? CHALLENGE.EMPTY_TITLE
                : challenge.finishedToday
                  ? CHALLENGE.HOME_CARD_DONE
                  : CHALLENGE.HOME_CARD_BODY
          }}
        </div>
      </div>
      <MiButton
        v-if="!challenge.finishedToday && !noPool && !locked"
        variant="primary"
        @click.stop="goChallenge"
      >
        {{ CHALLENGE.HOME_CARD_ACTION }}
      </MiButton>
    </button>

    <div class="module-card">
      <div class="module-card-title">{{ HOME.currentModule(moduleName, stageName) }}</div>
      <p class="module-card-desc">
        {{ HOME.moduleSummary(content.activeLessons.length, readyCount) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.learn-view {
  max-width: 720px;
  margin: 0 auto;
}
.welcome-card {
  margin-top: 8vh;
  padding: 40px;
  text-align: center;
  /* glass 令牌：壁纸关时逐字节同 --mi-card；开时按 --mi-panel-alpha 稀释 */
  background: var(--mi-card-glass);
  border-radius: var(--mi-radius-lg);
  box-shadow: var(--mi-shadow);
}
.welcome-mascots {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 6px;
}
.welcome-cat {
  font-size: 44px;
  margin-bottom: 10px;
  /*
   * 它现在是可点的（V1-40）：手型 + 按下去缩一下。
   * 幅度与 MiMascot 的按压反馈一致（0.94）——「点它有反应」这件事
   * 在喵那一声之外，也要有个视觉落点。user-select 防连点选中 emoji。
   */
  cursor: var(--mi-cursor, pointer);
  user-select: none;
  transition: transform var(--mi-dur-fast) var(--mi-ease);
}
.welcome-cat:active {
  transform: scale(0.94);
}
.welcome-bubble {
  margin-bottom: 26px;
  margin-left: 6px;
  text-align: left;
}
.welcome-card h1 {
  font-family: var(--mi-font-title);
  font-size: 22px;
  margin: 14px 0 10px;
}
.welcome-card p {
  color: var(--mi-text-2);
  line-height: 1.9;
}
/* V1-51：「大肥鱼怎么玩」入口。欢迎卡整块是 text-align:center 的居中版式
   （吉祥物/标题/正文都居中），按钮跟着居中即可；只留上下的呼吸距离。 */
.pet-guide-btn {
  margin-top: 10px;
}
.version {
  margin-top: 18px;
  font-size: 12px;
  color: var(--mi-text-3);
}
.module-card {
  margin-top: 16px;
  padding: 18px 20px;
  /* glass 令牌（同上） */
  background: var(--mi-card-glass);
  border-radius: var(--mi-radius);
  box-shadow: var(--mi-shadow);
}
.module-card-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.module-card-desc {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
}
.challenge-card {
  display: flex;
  align-items: center;
  gap: 16px;
  /* V2-40：整卡是 <button>。宽度要显式给满（button 默认按内容收窄），
     文字对齐/字体/行高按上面 button 重置那段恢复继承值；text-align: left
     让 body 文案左对齐（button 默认居中，不改的话文字会跳位）。 */
  width: 100%;
  text-align: left;
  margin-top: 16px;
  padding: 20px;
  /* 蓝底 + 蓝边：这是首页唯一一件「今天该做的事」，得从两张白卡里跳出来。
     只用边框的话远看还是一张白卡，「醒目」就成了写在注释里的一句空话。
     （用 blue-light 的 glass 版：壁纸开时它也跟着面板一起透，不然这一块会
     在满屏玻璃里变成唯一一块实心色板） */
  background: var(--mi-blue-light-glass);
  border: 1px solid var(--mi-blue);
  border-radius: var(--mi-radius);
  cursor: var(--mi-cursor, pointer);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
/*
 * button.challenge-card 默认外观重置（V2-40）：拆掉 UA 边框/字体/行高，
 * 只留上面那套视觉。font-size 不用给 —— 卡内每行文字都有自己的字号类。
 */
button.challenge-card {
  font-family: inherit;
  line-height: inherit;
  color: inherit;
}
button.challenge-card:focus-visible {
  outline: 2px solid var(--mi-blue-deep);
  outline-offset: 2px;
}
.challenge-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--mi-overlay) 14%, transparent);
}
/* 做完了就退成普通卡片：今天已经没事可做了，还拿蓝底强调它，等于在催 */
.challenge-card.done {
  background: var(--mi-card-glass);
  border-color: var(--mi-border);
}
/* 锁着的时候同一条道理：它现在不是「今天该做的事」，不该继续抢眼。
   同选择器写法（两条规则不合并）是因为语义各自独立 —— 哪天 done 的
   视觉要改，不该顺手把 locked 一起改掉 */
.challenge-card.locked {
  background: var(--mi-card-glass);
  border-color: var(--mi-border);
}
.challenge-text {
  flex: 1;
  min-width: 0;
}
.challenge-title {
  font-family: var(--mi-font-title);
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 6px;
}
.challenge-body {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
}
</style>
