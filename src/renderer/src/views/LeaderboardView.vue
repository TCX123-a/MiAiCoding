<script setup lang="ts">
/**
 * 排行榜（⑤ 十项升级，2026-10-08；UI 大修轮 2026-10-09 扩为五页签；
 * 2026-10-10 主人令：标题旁「?」规则面板 + 语言列；当晚改口径：
 * 该列 = 开赛前勾选过的语言在榜期内的并集（不是「学了哪些」），列头随之
 * 改叫「所选语言」——服务端同批改用 challenge_days.picked_langs 供数；
 * P10.6 2026-10-11 接真数据）。
 *
 * 【这一页的两副面孔】登录后 = 真榜：数据来自 `cloud:leaderboard` 的回话
 * （快照账在 stores/leaderboard.ts，含「拉不到就显示上次快照 + 截至时间」，
 * docs/26 §8.2）。未登录 = 演示行 + DEMO_BANNER —— 摆的是**格式演示**，
 * 不是说这是真榜（名字全叫「示例用户」）。真榜的空态与演示的满态是两件事，
 * 混在一起就是撒谎。
 *
 * 【真榜三态各有各的话】拉取中（LOADING）/ 拉不到（有快照 → FAIL_KEEP 带
 * 截至时间；没快照 → FAIL_NONE 一行说明）/ 拉到了但是空的（computedAt
 * 为 null = 服务端还没生成快照；生成了但没人上榜 = 空态组件 + 去打一局入口）。
 * 四种情况四种说法 —— 「默认回退为成功」在这页的反面就是「默认回退为有数据」。
 *
 * 【V2-10（2026-10-16 主人裁定）】原「空态的重试」按钮删了 ——「再试一次
 * 完全应该删了」：点下去按钮不转、那行字也不变（failed 仍是 true），看不出
 * 重试有没有发生，比没有按钮更伤信任。恢复路径改由文案交代 + 既有行为兜底：
 * 切页签（watch period）与重进页面（onMounted）本来就会重拉；store 的 load()
 * 起点补了 failed 复位 —— 重拉在飞时这页如实显示「正在拉榜…」。
 *
 * 【V1-54】空表不再一律是 12px 灰字一行：有快照的空（没人上榜 / 还没生成
 * 快照）走 MiEmpty（图 + 主副文案，与全站空态同规矩）；「没人上榜」那支配
 * 行动入口「去做今日挑战」（空榜的下一步就是去打一局）。没有快照的
 * （拉取中 / 拉不到）仍是**状态行**不是空态 —— 那时用户在等的不是自己做什么。
 *
 * 【为什么不做「加载中」骨架屏】没有请求就没有加载 —— 摆一个假的骨架行
 * 会让人以为「榜上就这些人」。红线：判定为真的路上不许有不需要证据的分支。
 *
 * 【页签键为什么是本地数组】UI 顺序是「周期递进」：日 → 周 → 月 → 年 → 总。
 * 服务端冻结的 LEADERBOARD_PERIODS 2026-10-10 起**同为这五键**（协议两侧
 * 字节同步）—— 三键时代的「monthly/yearly 是纯前端演示页签」已成历史；
 * 五个键全部有协议支撑。标签不另写第二份真源：一律从 copy.ts 的
 * LEADERBOARD.TABS 取。这份「UI 键 = 五键 且 ⊇ 协议键」的包含关系由
 * lib/__tests__/leaderboard-demo.test.ts 钉死（它从下面这行字面量抠键）。
 *
 * 【规则面板的口径】三节讲三件事：单题得分 = 难度分（v3 起语言权重全 100）、
 * 答对继续答错就停（无题数上限）、多学语言的作用。**只写公式里真有的规则**
 * ——主人 2026-10-10 拍板的规矩：多语言不代表高分，专精一门也能霸榜，
 * 核心在于你能连对多少道高难度题目（RULES_LANGS 就是这句的展开）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import MiCard from '../components/base/MiCard.vue'
import MiMascot from '../components/base/MiMascot.vue'
import MiTabs from '../components/base/MiTabs.vue'
import UserAvatar from '../components/domain/UserAvatar.vue'
import MiModal from '../components/base/MiModal.vue'
import MiButton from '../components/base/MiButton.vue'
import MiSwitch from '../components/base/MiSwitch.vue'
import MiEmpty from '../components/base/MiEmpty.vue'
import { toast } from '../components/base/toast'
import { LANG_LABEL, formatSyncClock } from '../lib/labels'
import { EMPTY, LEADERBOARD } from '../lib/copy'
import { useAccountStore } from '../stores/account'
import { useLeaderboardStore } from '../stores/leaderboard'

/** 页签键：本地 UI 数组（顺序即呈现顺序）。`as const` 不变式，测试按此抠键比对 */
const UI_TAB_KEYS = ['daily', 'weekly', 'monthly', 'yearly', 'alltime'] as const
type UiTabKey = (typeof UI_TAB_KEYS)[number]

const tabs = UI_TAB_KEYS.map((key) => ({ key, label: LEADERBOARD.TABS[key] }))

const acct = useAccountStore()
const board = useLeaderboardStore()
const router = useRouter()

const period = ref<UiTabKey>('daily')

/** 当前榜期的快照（真榜；未登录/未拉到时为 null） */
const snap = computed(() => board.boards[period.value] ?? null)
const isFailed = computed(() => board.failed[period.value] === true)

/**
 * 表格行：登录后 = 真榜快照的行；未登录 = 演示行（横幅已说破）。
 * 演示行补齐 avatarHash:null —— 它们的头像是默认大肥鱼（与「没设头像」同一条
 * 渲染路径，模板不必为「演示」再开一个分支）。
 */
const rows = computed(() =>
  acct.signedIn
    ? (snap.value?.entries ?? [])
    : LEADERBOARD.DEMO_ROWS[period.value].map((r) => ({ ...r, langs: [...r.langs], avatarHash: null }))
)
/** 表格卡头右侧的小字幕：这个榜多久刷新一次，随页签变（五条文案在 copy.ts） */
const refreshTip = computed(() => LEADERBOARD.REFRESH_TIP[period.value])
/** 卡头左侧：榜期键（daily='2026-10-10' 这样，服务端原样给，不翻译） */
const keyLine = computed(() =>
  snap.value?.periodKey ? LEADERBOARD.PERIOD_KEY(snap.value.periodKey) : ''
)
/** §8.2 的「上次快照」标注：拉失败但有旧数据时才有 —— 截至时刻用**拉取**时刻 */
const staleLine = computed(() =>
  isFailed.value && snap.value ? LEADERBOARD.FAIL_KEEP(formatSyncClock(snap.value.fetchedAt)) : ''
)
/**
 * 表下那行说明（**没有快照**且 rows 为空时才渲染，V1-54 后只剩这两态）：
 * 拉不到（FAIL_NONE，话里自带恢复路径）与拉取中（LOADING）。有快照的空表
 * 不走这里 —— 走下面的 emptyState（MiEmpty 空态）。
 * 为什么不再看 isLoading 反推：认准 isFailed 就够了 —— load() 起点会复位
 * failed，「在飞 = 不是失败态」由 store 保证，这里说「正在拉榜」不说谎
 *（V2-10 之前的毛病正是 failed 不复位，这句永远轮不到）。
 */
const noteLine = computed(() => (isFailed.value ? LEADERBOARD.FAIL_NONE : LEADERBOARD.LOADING))

/** 空表时 MiEmpty 的两套文案（V1-54）：还没生成快照 / 生成了但没人上榜 —— 两种「空」分开讲 */
const emptyState = computed(() =>
  snap.value && snap.value.computedAt === null ? EMPTY.LEADERBOARD_NO_SNAPSHOT : EMPTY.LEADERBOARD_NOBODY
)
/** 空表给不给行动入口：没人上榜 → 去打一局；没生成快照 → 那个空没有用户能做的事 */
const emptyActionable = computed(() => snap.value !== null && snap.value.computedAt !== null)

/** 名次卡主行：没快照时与表格同一套「拉取中/拉不到」口径 */
const meLine = computed(() => {
  const s = snap.value
  if (!s) return isFailed.value ? LEADERBOARD.FAIL_NONE : LEADERBOARD.LOADING
  return s.me.rank === null ? LEADERBOARD.ME_UNRANKED : LEADERBOARD.ME_RANK(s.me.rank, s.me.score)
})
const meToday = computed(() => (snap.value ? LEADERBOARD.ME_TODAY(snap.value.me.scoreToday) : ''))
/** 开关位置 = 快照里的真值（失败时开关自己弹回 —— 不拿界面状态当已保存） */
const optIn = computed(() => snap.value?.me.optedIn ?? false)
const optInDisabled = computed(() => snap.value === null || board.optInBusy)

function loadCurrent(): void {
  if (acct.signedIn) void board.load(period.value)
}
onMounted(() => {
  // 账号状态还没读过（本次启动第一次进这页）先补一发；读到了 signedIn 变 true
  // 会触发下面的 watch 拉榜 —— 这里 loadCurrent 只是"状态已在手"时的直通车
  if (acct.state === null) void acct.refresh().then(loadCurrent).catch(() => {})
  loadCurrent()
  /*
   * 卡死兜底（2026-10-22 夜间自查）：本页没有「再试一次」按钮（V2-10 删了），
   * 所以「没有快照、也没在拉」这个状态一旦出现，界面就永远停在「正在拉榜…」。
   * 实机见过一次（刷新后落在这页，store 是全新的空态），两轮重试都没复现；
   * 说不清是哪个 watcher 时序没接上。这里不赌时序：8 秒后还是空的就自己再拉一次。
   * 正在拉（loading）或已有失败态（failed，界面有说明行）都不插手。
   */
  setTimeout(() => {
    if (!board.boards[period.value] && board.loading[period.value] !== true && board.failed[period.value] !== true) {
      loadCurrent()
    }
  }, 8000)
})
watch(period, () => loadCurrent())
watch(
  () => acct.signedIn,
  (on) => {
    if (on) loadCurrent()
  }
)
// 账号状态晚到 / 换账号：signedIn 由 false 变 true 时上面那条会拉；这里再盯一眼
// accountId，任何一次状态落定都补一次（load 有在飞守卫，重复调用不叠请求）。
watch(
  () => acct.state?.accountId ?? null,
  () => loadCurrent()
)
// 改名/换头像（2026-10-22）：store 已把旧快照清空，这里立刻重拉 ——
// 服务端下一次 JOIN 就是新的 username/avatarHash，不必等用户切页签。
watch(
  () => acct.profileVersion,
  () => loadCurrent()
)

async function onOptIn(next: boolean): Promise<void> {
  const ok = await board.setOptIn(next)
  if (!ok) toast(LEADERBOARD.ME_OPTIN_FAIL, 'error')
}
function more(): void {
  void board.loadMore(period.value)
}

/** 「?」规则面板开关（主人点名：讲积分怎么算，猫咪大肥鱼语气，文案全在 copy.ts） */
const rulesOpen = ref(false)
</script>

<template>
  <div class="lb-page">
    <header class="lb-hero">
      <MiMascot pose="proud" size="l" />
      <div>
        <h1 class="lb-title">
          {{ LEADERBOARD.TITLE }}
          <!-- 「?」紧跟在标题后面：「规则在哪」的答案是「就在讲积分的那行字旁边」。
               title 与 aria-label 共用 RULES_OPEN 一句人话（图标太短，必须有名） -->
          <button
            class="lb-rules-btn"
            type="button"
            :title="LEADERBOARD.RULES_OPEN"
            :aria-label="LEADERBOARD.RULES_OPEN"
            @click="rulesOpen = true"
          >
            ?
          </button>
        </h1>
        <p class="lb-sub">{{ LEADERBOARD.SUB }}</p>
      </div>
    </header>

    <!-- 页签（MiTabs ←/→ 可巡回，见 lib/tab-nav.ts）在左、演示横幅在下，先选期别再看榜 -->
    <MiTabs v-model="period" :tabs="tabs" />

    <!-- 演示横幅只在未登录时出现：说破「现在看的是演示行」 -->
    <p v-if="!acct.signedIn" class="demo-banner" role="note">{{ LEADERBOARD.DEMO_BANNER }}</p>

    <!-- padding 归零：表格自己贴着卡片边排版（表头/行分隔线要通到卡片边） -->
    <MiCard padding="0">
      <!-- 卡头：左侧榜期键（真榜才有）、右侧随页签变化的刷新小字幕 -->
      <div class="lb-card-head">
        <span v-if="keyLine" class="lb-period-key">{{ keyLine }}</span>
        <span class="lb-refresh-tip">{{ refreshTip }}</span>
      </div>

      <!-- §8.2：拉失败但有旧快照 → 旧快照照显示，顶上这行说清"这不是刚拉的" -->
      <p v-if="staleLine" class="lb-stale">{{ staleLine }}</p>

      <table v-if="rows.length > 0" class="lb-table">
        <thead>
          <tr>
            <th class="col-rank">{{ LEADERBOARD.COL_RANK }}</th>
            <th>{{ LEADERBOARD.COL_NAME }}</th>
            <th class="col-langs">{{ LEADERBOARD.COL_LANGS }}</th>
            <th class="col-num">{{ LEADERBOARD.COL_SCORE }}</th>
            <th class="col-num">{{ LEADERBOARD.COL_DAYS }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i" :class="{ 'demo-row': !acct.signedIn }">
            <td class="col-rank">{{ r.rank }}</td>
            <td class="col-name">
              <span class="name-cell">
                <UserAvatar :hash="r.avatarHash" :px="24" />
                <span class="name-text">{{ r.username }}</span>
              </span>
            </td>
            <td class="col-langs">
              <!-- 空 langs = 榜期内每场都只考了通用题、没勾选任何一门（服务端允许），
                   放「—」不替人下结论（口径见 RULES_FOOT） -->
              <span v-if="r.langs.length === 0" class="lang-none">{{ LEADERBOARD.LANGS_NONE }}</span>
              <template v-else>
                <span v-for="lang in r.langs" :key="lang" class="lang-chip">
                  {{ LANG_LABEL[lang] }}
                </span>
              </template>
            </td>
            <td class="col-num">{{ r.score }}</td>
            <td class="col-num">{{ r.days }}</td>
          </tr>
        </tbody>
      </table>
      <!-- 空表三态（V1-54，2026-10-16）：
           ①没有快照（拉取中 / 拉不到）→ 一行状态说明。这不是空态 —— 用户在等的
             不是自己做什么，所以不摆图、不给按钮（恢复路径写在 FAIL_NONE 话里）；
           ②有快照、服务端还没生成这期榜单 → 空态（等，无入口）；
           ③有快照、生成好了、但没人上榜 → 空态 + 行动入口（去打一局）。 -->
      <p v-else-if="!snap" class="empty-note">{{ noteLine }}</p>
      <MiEmpty v-else v-bind="emptyState">
        <MiButton
          v-if="emptyActionable"
          size="sm"
          variant="primary"
          @click="router.push('/challenge')"
        >
          {{ LEADERBOARD.BTN_GO_CHALLENGE }}
        </MiButton>
      </MiEmpty>

      <!-- 下一页（服务端给了 nextCursor 才有这枚按钮）。
           V2-10：原「空态的重试」按钮删了（点下去毫无变化，主人裁定「完全应该删了」）
           —— 重拉走切页签 / 重进页面，在飞时上面的说明行会显示「正在拉榜…」 -->
      <div v-if="acct.signedIn && snap && snap.nextCursor" class="lb-foot-btn">
        <MiButton size="sm" variant="secondary" :loading="board.moreLoading" @click="more">
          {{ LEADERBOARD.BTN_MORE }}
        </MiButton>
      </div>
    </MiCard>

    <div class="lb-cards">
      <MiCard :title="LEADERBOARD.ME_TITLE">
        <template v-if="acct.signedIn">
          <p class="card-body">{{ meLine }}</p>
          <p v-if="meToday" class="card-sub">{{ meToday }}</p>
          <div class="me-optin">
            <MiSwitch
              :model-value="optIn"
              :disabled="optInDisabled"
              :label="LEADERBOARD.ME_OPTIN"
              @update:model-value="onOptIn"
            />
            <p class="me-optin-note">{{ LEADERBOARD.ME_OPTIN_NOTE }}</p>
          </div>
        </template>
        <p v-else class="card-body">{{ LEADERBOARD.ME_LOGGED_OUT }}</p>
      </MiCard>
      <!-- 奖励卡描边加粗一档：大白饭奖励是这一页的「奔头」，得比旁边那张显眼 -->
      <MiCard class="reward-card" :title="LEADERBOARD.REWARD_TITLE">
        <p class="card-body">{{ LEADERBOARD.REWARD_BODY }}</p>
      </MiCard>
    </div>

    <!-- 规则面板（主人 2026-10-10 点名）。三节：单题公式 / 答对继续答错停 / 多学语言。
         全部文案从 copy.ts 取（RULES_*），本节不内联任何一句 —— 口径只有一处真源 -->
    <MiModal v-model:visible="rulesOpen" :title="LEADERBOARD.RULES_TITLE" :width="520">
      <p class="rules-intro">{{ LEADERBOARD.RULES_INTRO }}</p>
      <h3 class="rules-head">{{ LEADERBOARD.RULES_POINTS_HEAD }}</h3>
      <p class="rules-p">{{ LEADERBOARD.RULES_DIFFICULTY }}</p>
      <p class="rules-p">{{ LEADERBOARD.RULES_LANG }}</p>
      <p class="rules-p">{{ LEADERBOARD.RULES_EXAMPLE }}</p>
      <h3 class="rules-head">{{ LEADERBOARD.RULES_CHAIN_HEAD }}</h3>
      <p class="rules-p">{{ LEADERBOARD.RULES_CHAIN }}</p>
      <h3 class="rules-head">{{ LEADERBOARD.RULES_LANGS_HEAD }}</h3>
      <p class="rules-p">{{ LEADERBOARD.RULES_LANGS }}</p>
      <p class="rules-foot">{{ LEADERBOARD.RULES_FOOT }}</p>
      <template #footer>
        <MiButton variant="primary" @click="rulesOpen = false">
          {{ LEADERBOARD.RULES_CLOSE }}
        </MiButton>
      </template>
    </MiModal>
  </div>
</template>

<style scoped>
.lb-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
  margin: 0 auto;
}

.lb-hero {
  display: flex;
  align-items: center;
  gap: 16px;
}
.lb-title {
  font-size: 20px;
  margin: 0;
}
.lb-sub {
  color: var(--mi-text-2);
  font-size: 13px;
  margin: 4px 0 0;
}

/*
 * 「?」规则按钮：跟标题同行的圆形小钮。
 * 文字色用 --mi-text-2（压在两种底色上都过 4.5:1），悬停才点亮成蓝 ——
 * 它是个入口不是装饰，但也不该跟标题抢视线。
 */
.lb-rules-btn {
  position: relative;
  width: 22px;
  height: 22px;
  margin-left: 6px;
  padding: 0;
  border: 1px solid var(--mi-border);
  border-radius: 50%;
  background: none;
  color: var(--mi-text-2);
  font-size: 13px;
  line-height: 1;
  vertical-align: 2px;
  cursor: var(--mi-cursor, pointer);
}
.lb-rules-btn:hover {
  background: var(--mi-blue-light);
  border-color: var(--mi-blue);
}
/*
 * 批⑥（2026-10-16）：视觉 22px 不动，命中区补到 40×40 —— 圆钮四周一圈透明 ::after
 * 只负责接指针。左缘探进标题尾巴是认了的：标题既不可点也不可选（body 全局禁选），
 * 抢不到任何东西。
 */
.lb-rules-btn::after {
  content: '';
  position: absolute;
  inset: -9px;
}

/*
 * 演示横幅：浅蓝底 + 正文色（不是 text-3）——
 * 它承载的是「这张表是假的」这条**必须看清**的信息，不是装饰性小字。
 */
.demo-banner {
  margin: 0;
  padding: 8px 14px;
  border-radius: var(--mi-radius-sm);
  background: var(--mi-blue-light);
  color: var(--mi-text-2);
  font-size: 12.5px;
}

/* 卡头：榜期键在左（margin-right:auto 顶着）、刷新小字幕在右；左右缩进与单元格（14px）对齐 */
.lb-card-head {
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px 0;
}
/* 三级文字色（压卡片底 4.5:1 过线）—— 都是装饰性小字，不与表格抢读数 */
.lb-refresh-tip {
  font-size: 12px;
  color: var(--mi-text-3);
}
.lb-period-key {
  margin-right: auto;
  font-size: 12px;
  color: var(--mi-text-3);
}

/*
 * 「上次快照」标注：它是一条**要让用户看见**的状态说明（你现在看的不是刚拉的），
 * 用深琥珀（--mi-warn-deep，浅色底上过 4.5:1）而不是装饰性的 text-3。
 */
.lb-stale {
  margin: 0;
  padding: 8px 14px 0;
  font-size: 12.5px;
  color: var(--mi-warn-deep);
}

.lb-table {
  width: 100%;
  border-collapse: collapse;
}
.lb-table th {
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--mi-text-2);
  text-align: left;
  border-bottom: 1px solid var(--mi-border);
}
.lb-table td {
  padding: 9px 14px;
  font-size: 13px;
  color: var(--mi-text-2);
  border-bottom: 1px solid var(--mi-border);
}
/* 名次与数字列居右/居中，昵称列左对齐 —— 数字列右对齐才好上下对数 */
.lb-table .col-rank {
  width: 64px;
  text-align: center;
  /* 批⑥（2026-10-16）：名次/积分是等宽数字 —— 刷新时位数或数值变化不牵动左右抖动 */
  font-variant-numeric: tabular-nums;
}
.lb-table .col-num {
  width: 110px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/*
 * 语言列：语言名做成小圆片（chip），一格里允许换行 ——
 * 四门语言的人（演示数据里的阿圆）在窄栏里也不撑破表格。
 * 圆片文字 --mi-text-2 压在 --mi-blue-light 上（比压白底只会更清楚）。
 */
.lb-table .col-langs {
  width: 150px;
}
.lang-chip {
  display: inline-block;
  margin: 1px 4px 1px 0;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--mi-blue-light);
  color: var(--mi-text-2);
  font-size: 11.5px;
  line-height: 18px;
}
.lang-none {
  color: var(--mi-text-3);
}
/* 昵称格：24px 圆头像 + 名字。头像与文字垂直居中对齐，名字过长省略 */
.name-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
}
.name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 演示行整体降一档明度，配合横幅再强调一次「这是格式演示」 */
.demo-row .col-name {
  font-style: italic;
}
.lb-table tr:last-child td {
  border-bottom: none;
}

.empty-note {
  margin: 0;
  padding: 12px 14px;
  font-size: 12px;
  color: var(--mi-text-2);
  border-top: 1px solid var(--mi-border);
}

/* 表下的动作区（加载更多；原「重试」按钮 V2-10 已删）：居中一条，上缘与表格分隔线同款 */
.lb-foot-btn {
  display: flex;
  justify-content: center;
  padding: 10px 14px;
  border-top: 1px solid var(--mi-border);
}

.lb-cards {
  display: grid;
  /* auto-fit + minmax：按**容器**宽度决定一列还是两列 —— 媒体查询只能看视口，
     而右栏开着时内容区比视口窄得多，两卡会互挤。240px 是卡内文字的下限。 */
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 14px;
}
.reward-card {
  border: 1px solid var(--mi-blue-deep);
  box-shadow: none;
}
.card-body {
  margin: 0;
  font-size: 13px;
  color: var(--mi-text-2);
}
/* 名次卡的第二行（今日得分）：比主行低一档，是补充不是结论 */
.card-sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--mi-text-3);
}
/* opt-in 开关区：与名次行之间一条分隔线 —— 开关改的是曝光，不是名次本身 */
.me-optin {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--mi-border);
}
.me-optin-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--mi-text-3);
}

/* ---- 规则面板（MiModal 内）文字排布。正文一律 --mi-text-2，压弹窗底色过 4.5:1 ---- */
.rules-intro {
  margin: 0 0 12px;
  color: var(--mi-text-2);
}
.rules-head {
  margin: 14px 0 6px;
  font-size: 14px;
}
.rules-p {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--mi-text-2);
}
.rules-foot {
  margin: 14px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--mi-border);
  font-size: 12px;
  color: var(--mi-text-3);
}
</style>
