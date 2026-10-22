<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useChallengeStore } from '../stores/challenge'
import { useContentStore } from '../stores/content'
import { seedFromKey } from '../lib/mascot'
import { LANG_LABEL } from '../lib/labels'
import { CHALLENGE, TITLE } from '../lib/copy'
import MiButton from '../components/base/MiButton.vue'
import MiMascot from '../components/base/MiMascot.vue'
import MiCheckbox from '../components/base/MiCheckbox.vue'
import MiBubble from '../components/domain/MiBubble.vue'
import MiProgressBar from '../components/base/MiProgressBar.vue'
import QuizReview from '../components/domain/quiz/QuizReview.vue'

const challenge = useChallengeStore()
const content = useContentStore()
const router = useRouter()

/** 逐题回顾那张弹窗开着没有 */
const reviewOpen = ref(false)

/**
 * 空状态里那个「去学第一课」按钮指向哪一课。
 *
 * 找**第一门能学的课**（状态 open），不是写死 `common-01` ——
 * 写死的话，将来通用知识模块调整、或者用户已经把那门学完了，
 * 按钮就会指向一个「已学」或者根本不存在的课，点了什么都没发生。
 */
const firstLearnable = computed(() => {
  const l = content.bundle.lessons.find((x) => content.statusOf(x.id) === 'open')
  return l ? { id: l.id, title: l.title } : null
})

function goLearn() {
  if (firstLearnable.value) router.push(`/lesson/${firstLearnable.value.id}`)
}

/**
 * 锁定页「去继续学习」指向哪一课：**优先他正在学的那门语言里的下一课**。
 *
 * 【为什么不直接用 `firstLearnable`】那是「全库第一节可学的课」，按大纲顺序找 ——
 * 一个学到一半 Python 的人会被它丢回 C 语言的第一课（C 在大纲里靠前、
 * 前置也满足），而他根本没碰过 C。锁定页的按钮写着「去**继续**学习」，
 * 指错方向就不叫继续了。
 *
 * 找不到（他还没在任何一门语言里开动过）才退回全库第一节。
 */
const resumeLesson = computed(() => {
  const started = new Set<string>(
    challenge.langProgress.filter((p) => p.learned > 0 && !p.done).map((p) => p.lang)
  )
  if (started.size > 0) {
    const l = content.bundle.lessons.find(
      (x) => started.has(x.lang) && content.statusOf(x.id) === 'open'
    )
    if (l) return { id: l.id, title: l.title }
  }
  return firstLearnable.value
})

onMounted(() => {
  // P10.6 ⑤：走 refresh（=load + 补交未上行的收工单）。它不再被 progress
  // 闸吞掉 —— 深链冷启动也要读到今天那批，不然「可以开始」会把存档覆盖掉
  void challenge.refresh()
})

/** 今天做过之后，按钮区不再给「再做一遍」—— 重做没有意义，还会重复记账 */
const showStart = computed(
  () => challenge.ready && challenge.unlocked && challenge.hasPool && !challenge.finishedToday
)

/**
 * 今天结算的积分。旧批次 score 里没有 points → null（**不拿 0 顶替**：
 * 「0 分」和「当时还没有积分制」是两件事）。积分行与它下面那句去向
 * （V1-25）同门 —— 条件写两遍迟早漂移，收在一处。
 */
const pointsToday = computed(() => {
  const sc = challenge.scoreToday
  if (!sc || sc.points === undefined || sc.pointsMax === undefined) return null
  return { points: sc.points, max: sc.pointsMax }
})

/**
 * 奖励立绘抽签用的种子。
 *
 * 取「今天的日期键」而不是 `Math.random()`：这一格在同一次停留里会重渲染很多次
 * （错题回顾弹窗开合、得分变化…），用随机数的话用户看到的不是「每天换一张」
 * 而是**图在疯狂闪**。日期键同一天恒定，跨天才会换。
 */
const rewardSeed = computed(() => seedFromKey(challenge.dateKey))
</script>

<template>
  <div class="page">
    <h1 class="page-title">{{ TITLE.CHALLENGE }}</h1>
    <p class="page-intro">{{ CHALLENGE.INTRO }}</p>

    <!-- ① 档案还没读完：不能下任何结论（包括「你没学过课」），先等 -->
    <div v-if="!challenge.ready" class="card center">
      <MiMascot pose="busy" size="m" />
      <p class="muted">{{ CHALLENGE.LOADING }}</p>
    </div>

    <!-- ①.5 锁定态（2026-10-10 主人令）：一门语言都没学完 → 挑战不开放。
         排在空态**前面**：没学完一门语言时池子必然是空的（hasPool 为假），
         不先拦这一道，锁定的学员会看到「去学第一课」——那句话对学到一半的
         人是错的（他早学过第一课了），而且压根没解释解锁规则。
         大肥鱼在这里用气泡亲口把规则讲清楚（主人指定），下面每门语言一条
         进度行，让他看到"还差多少"而不是只看到一把锁。 -->
    <div v-else-if="!challenge.unlocked" class="card center">
      <div class="locked-head">
        <MiMascot pose="think" size="l" />
        <MiBubble class="locked-bubble">{{ CHALLENGE.LOCKED_BODY }}</MiBubble>
      </div>
      <div class="empty-title">{{ CHALLENGE.LOCKED_TITLE }}</div>
      <div class="locked-progress">
        <div class="locked-progress-title">{{ CHALLENGE.LOCKED_PROGRESS_TITLE }}</div>
        <div v-for="p in challenge.langProgress" :key="p.lang" class="locked-row">
          <span class="locked-lang">{{ LANG_LABEL[p.lang] }}</span>
          <MiProgressBar class="locked-bar" :percent="p.percent" :height="6" />
          <span class="locked-count">{{ p.learned }}/{{ p.total }}</span>
          <span v-if="p.done" class="locked-done">{{ CHALLENGE.LOCKED_ROW_DONE }}</span>
        </div>
      </div>
      <MiButton v-if="resumeLesson" variant="primary" @click="router.push(`/lesson/${resumeLesson.id}`)">
        {{ CHALLENGE.LOCKED_ACTION }}
      </MiButton>
    </div>

    <!-- ② 一道题都抽不出来：**不是故障**，是「还没学过任何课」。
         所以这里不报错、不说「暂无数据」，而是告诉他下一步做什么 -->
    <div v-else-if="!challenge.hasPool" class="card center">
      <MiMascot pose="think" size="l" />
      <div class="empty-title">{{ CHALLENGE.EMPTY_TITLE }}</div>
      <p class="empty-body">{{ CHALLENGE.EMPTY_BODY }}</p>
      <MiButton v-if="firstLearnable" variant="primary" @click="goLearn">
        {{ CHALLENGE.EMPTY_ACTION }}
      </MiButton>
    </div>

    <!-- ③ 今天做完了：得分 + 大肥鱼奖励 -->
    <div v-else-if="challenge.finishedToday" class="card center">
      <div class="done-title">{{ CHALLENGE.DONE_TODAY }}</div>
      <div v-if="challenge.scoreToday" class="score">
        {{ CHALLENGE.score(challenge.scoreToday.correct, challenge.scoreToday.total) }}
      </div>
      <!-- 积分行（2026-10-10 加权计分改版）。旧批次 score 里没有 points，
           按「没有就不显示」处理 —— 不拿 0 顶替（判据见 script 的 pointsToday） -->
      <div v-if="pointsToday" class="score-points">
        {{ CHALLENGE.points(pointsToday.points, pointsToday.max) }}
      </div>
      <!-- 积分行下面接一句去向（V1-25「攒分的地方和看分的地方互不指路」）：
           说清分数落到了哪，去排行榜那颗按钮在下面 done-actions 里 -->
      <p v-if="pointsToday" class="muted small">{{ CHALLENGE.POINTS_TO_BOARD }}</p>
      <!-- 答错即停提前收工的那一局：说清为什么只做了这几道。
           判据在 store（`stoppedEarly` = 答对数 < 总题数）—— v3 收工重写后
           「批长 > 结算数」不再成立，别再在这儿自己算一遍。 -->
      <p v-if="challenge.stoppedEarly" class="muted small">
        {{ CHALLENGE.STOPPED_RESULT }}
      </p>

      <!-- 大肥鱼奖励。这一格在 docs/13 §5 里是 **XL 160 的随机立绘**：
           挑战一天只做一次，没有「第几次」这种计数，所以抽签种子取**今天的日期键** ——
           每天换一张脸，同一天反复进出纹丝不动（用 Math.random() 会变成图在抖，
           理由见 lib/mascot.ts 的 pickVariantIndex）。
           图还没出时这里自动显示虚线占位框，**它自己就带着一行说明**，
           所以这个位置不再另写「图还在画」的提示 —— 写了就是同一件事说两遍，
           而且图到位之后那行提示会变成一句错话。

           ── 2026-09-19 新增：卡外左右各加一条 L 立绘 ──
        【为什么放得下】这张卡（`.card`）内宽 672px，而中间的 `.reward`
        最宽只吃 380px —— 也就是说左右各空着约 146px，正好够一格 L（112）。
        【为什么左右两条的种子是 +1 / +2，不是同一个 seed】
        `milestone` 图池里有 6 张。三条鱼用同一个种子就会是**同一张画**并排三份，
        看着像复制粘贴出了 bug；错开三个种子则是「三只一起上来道贺」。
        错开对图池张数没有假设：`pickVariantIndex` 是取模的，
        池子只剩 2 张时 +1 与 +2 会落在不同张上，池子只剩 1 张时三条一样 ——
        两种都不会越界、也不会报错。
      -->
      <div class="reward-row">
        <MiMascot class="reward-side" pose="milestone" size="l" :seed="rewardSeed + 1" />
        <div class="reward">
          <div class="reward-title">{{ CHALLENGE.REWARD_TITLE }}</div>
          <div class="reward-box">
            <MiMascot pose="milestone" size="xl" :seed="rewardSeed" />
          </div>
          <div class="reward-body">{{ CHALLENGE.REWARD_BODY }}</div>
        </div>
        <MiMascot class="reward-side" pose="milestone" size="l" :seed="rewardSeed + 2" />
      </div>

      <!-- 「看看错在哪」放在「回首页」**前面**：做完挑战的人第一件想干的事是
           看自己错哪儿了，不是回家。没有可回顾的行就不显示这个按钮 —— 一个点
           进去空白的入口比没有入口更糟。
           上面那行说明只给**旧版存档**（v2：题/答错位不可回溯，按钮因此消失）——
           此时沉默会让人以为按钮坏了，必须说清为什么、以及什么不受影响。
           「当时没留作答记录」的另一种降级不配这句（理由不同，见 store 注释） -->
      <p v-if="challenge.oldArchive" class="muted small">{{ CHALLENGE.OLD_ARCHIVE }}</p>
      <div class="done-actions">
        <MiButton v-if="challenge.hasReview" variant="primary" @click="reviewOpen = true">
          {{ CHALLENGE.REVIEW_ACTION }}
        </MiButton>
        <MiButton variant="secondary" @click="router.push('/learn')">{{ CHALLENGE.BACK }}</MiButton>
        <!-- 去排行榜（V1-25，主人裁定「必须改一键跳转之类的指示」）：上面那句
             去向说明把路指出来，这颗按钮把它做成一步。只在今天真有积分时给 ——
             老批次没上榜，给颗点了看不到自己分数的按钮是空头支票 -->
        <MiButton v-if="pointsToday" variant="ghost" @click="router.push('/leaderboard')">
          {{ CHALLENGE.GO_LEADERBOARD }}
        </MiButton>
      </div>
    </div>

    <!-- ④ 可以开始（或接着做今天那批） -->
    <div v-else-if="showStart" class="card center">
      <MiMascot pose="welcome" size="l" />
      <p v-if="challenge.day" class="muted">{{ CHALLENGE.DRAWN }}</p>
      <div v-if="challenge.day" class="source">
        {{ challenge.day.source === 'ai' ? CHALLENGE.SOURCE_AI : CHALLENGE.SOURCE_LOCAL }}
      </div>
      <p v-if="challenge.fellBack" class="muted small">{{ CHALLENGE.FELL_BACK }}</p>
      <!-- 语言勾选器（v3 主人令）：开始前自由勾选今天想考哪门。
           只在「还没抽题」（新开一局）时出现 —— 续做今天那批时题目已经定了，
           给一组勾选框只会让人误以为还能改。通用基础题（common）不属于任何
           一门语言、恒在池里，所以不摆出来（口径见 store 的 selectedPool）。 -->
      <div v-if="!challenge.day && challenge.poolLangs.length > 0" class="lang-select">
        <div class="lang-select-title">{{ CHALLENGE.LANG_SELECT_TITLE }}</div>
        <div class="lang-select-row">
          <MiCheckbox
            v-for="l in challenge.poolLangs"
            :key="l"
            :model-value="challenge.isLangOn(l)"
            :label="LANG_LABEL[l]"
            @update:model-value="challenge.toggleLang(l)"
          />
        </div>
        <p v-if="challenge.selectedEmpty" class="muted small">{{ CHALLENGE.LANG_SELECT_EMPTY }}</p>
      </div>
      <!-- 用户按了「不出了」之后的那句话。没有它，转圈停下、页面纹丝不动，
           他分不清是真停了还是没听见 -->
      <p v-if="challenge.canceled" class="muted small">{{ CHALLENGE.CANCELED }}</p>

      <div class="actions">
        <MiButton
          variant="primary"
          :loading="challenge.generating"
          :disabled="!challenge.day && challenge.selectedEmpty"
          @click="challenge.start()"
        >
          {{ challenge.day ? CHALLENGE.RESUME : CHALLENGE.START }}
        </MiButton>
        <!-- 抽题中：**必须同时给出「在动」和「能停」两件事**。
             AI 出题要等十几秒，只有转圈没有取消，用户会以为卡死（docs/04 硬规定） -->
        <template v-if="challenge.generating">
          <span class="generating">{{ CHALLENGE.GENERATING }}</span>
          <MiButton variant="ghost" @click="challenge.cancel()">{{ CHALLENGE.CANCEL }}</MiButton>
        </template>
      </div>
    </div>

    <!-- ⑤ 兜底：以上都不是（理论上到不了，但页面空白比一句实话更糟） -->
    <div v-else class="card center">
      <p class="muted">{{ CHALLENGE.LOADING }}</p>
    </div>

    <!-- 逐题回顾。挂在页面这一层而不是某张卡里 —— 它是个 Teleport 到 body 的
         弹窗，放在哪张卡里都只是「碰巧在这个状态才渲染得出来」的巧合 -->
    <QuizReview v-model:visible="reviewOpen" :rows="challenge.reviewRows" />
  </div>
</template>

<style scoped>
.page {
  max-width: 720px;
  margin: 0 auto;
}
.page-title {
  font-family: var(--mi-font-title);
  font-size: 20px;
  margin-bottom: 8px;
}
.page-intro {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.8;
  margin-bottom: 16px;
}
.card {
  padding: 32px 24px;
  /* glass 令牌：壁纸关时逐字节同 --mi-card；开时按 --mi-panel-alpha 稀释 */
  background: var(--mi-card-glass);
  border-radius: var(--mi-radius);
  box-shadow: var(--mi-shadow);
}
.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}
.empty-title,
.done-title {
  font-family: var(--mi-font-title);
  font-size: 17px;
  margin-top: 6px;
}
.empty-body {
  font-size: 13px;
  color: var(--mi-text-2);
  line-height: 1.9;
  max-width: 460px;
}
.score {
  font-size: 15px;
  font-weight: 600;
  color: var(--mi-text);
}
/* 积分行：蓝墨 token（对比度审计过），和「答对 x / y 题」拉开层次 */
.score-points {
  font-size: 14px;
  font-weight: 700;
  color: var(--mi-blue-ink);
}
/* 锁定页：大肥鱼 + 气泡的头部（气泡最大宽度收着，别把鱼挤到边上） */
.locked-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
.locked-bubble {
  text-align: left;
  max-width: 420px;
}
/* 每门语言一行：名字 / 进度条 / 计数（+学完标） */
.locked-progress {
  width: 100%;
  max-width: 460px;
  margin: 8px 0 4px;
}
.locked-progress-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-2);
  margin-bottom: 8px;
}
.locked-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.locked-lang {
  flex-shrink: 0;
  width: 96px;
  text-align: left;
  font-size: 13px;
  color: var(--mi-text);
}
.locked-bar {
  flex: 1;
  min-width: 0;
}
.locked-count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--mi-text-3);
  font-variant-numeric: tabular-nums;
}
.locked-done {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-success-deep);
}
/*
 * 奖励卡 + 它左右那两条鱼。
 *
 * 【为什么是 flex 行，不是把两条鱼绝对定位到空当里】
 * 绝对定位看着更省事（不占布局、不影响中间那张卡），但主区一窄就会失灵：
 * 空当会从 146px 缩到几十像素，而 112px 的鱼钉在那儿是不会缩的，
 * 于是从卡片的边上探出去 —— 绝对定位没有任何机制能阻止这件事。
 *
 * 【为什么必须 `flex-wrap: wrap`】
 * 主区宽度是 `MAIN_MIN_SIZE = 32%`，窗口最窄 1000px 时**只有 320px**，
 * 卡片内宽剩下两百出头。鱼是 `flex-shrink: 0`（缩不了），不换行就是**横向溢出**。
 *
 * 【⚠️ 为什么基准是 300 而不是照搬 `.reward` 自己的 380】
 * `flex-wrap` 是按**基准宽度（flex-basis）**决定换不换行的，**不是**按收缩后的宽度。
 * 照搬 380 当基准，默认窗口下这笔账就算不过去：
 *   卡片内宽 624 = 1200 窗口 × 主区 60% − `.content` 两侧 24×2 − 卡片两侧 24×2
 *   112 + 16 + 380 + 16 + 112 = 636 > 624   →  右边那条鱼被挤到第二行
 * 而它**不报错、不警告**，只是默认窗口一打开鱼就是歪的。
 * 基准改成 300 并允许它长（`flex: 1 1 300px`）之后：
 *   112 + 16 + 300 + 16 + 112 = 556 ≤ 624   →  一行放得下
 *   余下 68px 全给卡片，卡片补到 368（`max-width: 380` 仍然收着，不会更宽）
 * 宽屏上卡片涨到 380 就封顶，多出来的空间由 `justify-content: center` 居中 ——
 * 于是两条鱼自然停在左右两边的空当里，这正是这一格想要的样子。
 *
 * 各宽度下的实际排布（「卡片内宽」= 这一行的容器宽度）：
 *   ≥ 556px   [🐟][奖励卡][🐟] 一行；卡片 368~380，两侧留白
 *   428~555   [🐟][奖励卡] / [🐟]  —— 不好看的那一档
 *   < 428     [🐟] / [奖励卡] / [🐟] 三行
 * 中间那档确实不齐，但鱼和卡片都在、都点得到、也压不住对方。
 * 要让它也齐，得给这张卡上容器查询 —— 为一个「用户把主区拖到很窄」的场景
 * 引一个特性，不划算。
 *
 * 【为什么卡片的 `margin: 10px 0 4px` 不用动】
 * 在 flex 行里它照样生效，只是 `align-items: center` 居中的是**外边距盒**，
 * 上 10 下 4 会让卡片的正文比两条鱼高出 3px。这个差值小于鱼的入场位移，
 * 肉眼看不出来，为此去改一条现有规则不划算。
 */
.reward-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  width: 100%;
}
.reward {
  width: 100%;
  max-width: 380px;
  margin: 10px 0 4px;
  padding: 16px;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius);
  background: var(--mi-bg);
}
/*
 * 套进 flex 行之后，`.reward` 身上那条 `width: 100%` 必须撤掉。
 *
 * 同一个 100%，在**块级**上下文里是「占满卡片宽度」（被 max-width: 380 收住）；
 * 到了 flex 行里变成「占满整行」，两条鱼会被直接挤到下一行去 ——
 * 而这件事**不报错、不警告**，只是鱼莫名其妙跑到卡片底下了。
 * 所以这里按 flex 的写法重新给一遍：基准 380px，地方不够时可以缩。
 *
 * 收窄的**下限**交给默认的 `min-width: auto`（= 内容的最小宽度），
 * 里面那张 XL 立绘是固定 160px 的，所以卡片最多缩到 192px 就不再缩了 ——
 * 写 `min-width: 0` 反而会让文案在极窄窗口里挤成一列单字。
 *
 * `flex-grow: 1` 是**必须的**，不是顺手加的：没有它，卡片在宽屏上就停在
 * 基准的 300px，比它自己原来的 380 还窄 —— 加两条鱼的结果是把原来那张卡
 * 弄瘦了，属于「新增把旧东西改坏了」。
 */
.reward-row .reward {
  width: auto;
  flex: 1 1 300px;
}
/*
 * 两条鱼不参与收缩。
 * MiMascot 自己的 .mi-mascot 里已经有 `flex-shrink: 0`，所以这一条**目前是冗余的**。
 * 留着是因为「这两条鱼不许被压扁」是**这一行布局的**要求，不是组件的性质：
 * 哪天有人为了别的场景把组件那条去掉，这里应该自己站得住，
 * 而不是让鱼在窄窗口里被悄悄压成竖条。
 */
.reward-side {
  flex-shrink: 0;
}
.reward-title {
  font-weight: 600;
  margin-bottom: 10px;
}
/*
 * 立绘的容器。**自己不加虚线框**：图还没出的时候，里面的 MiMascot 已经画了一个
 * 带尺寸标注的虚线占位框；这里再加一层就是「虚线框套虚线框」，看着像坏了。
 * 高度也不写死：XL 档是 160px，写死 120 会把图裁掉。
 */
.reward-box {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 0;
}
.reward-body {
  margin-top: 10px;
  font-size: 13px;
  color: var(--mi-text);
  line-height: 1.7;
}
.source {
  font-size: 13px;
  color: var(--mi-text-2);
}
/* 语言勾选器（v3）：把「今天想考哪门」摆成一排勾选框。
   宽度收着（max-width 同空态正文），勾选框之间交给 MiCheckbox 自己的间距 */
.lang-select {
  width: 100%;
  max-width: 460px;
  margin-top: 4px;
}
.lang-select-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--mi-text-2);
  margin-bottom: 8px;
}
.lang-select-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px 14px;
}
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 8px;
}
.generating {
  font-size: 13px;
  color: var(--mi-text-3);
}
/* 结算卡底部那排按钮。单独一条而不是复用 .actions：
   .actions 会换行（抽题中要挤下按钮 + 文字 + 取消），这排只有两个按钮，
   换行只会在窄窗口里把「回首页」甩到下一行孤零零待着 */
.done-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.muted {
  font-size: 13px;
  color: var(--mi-text-3);
}
.small {
  font-size: 12px;
}
</style>
