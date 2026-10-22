<script setup lang="ts">
/**
 * 大肥鱼仓库（P3 ⑨）：图鉴格子 + 白饭碗余额 + 逐张另存。
 *
 * 【这一屏的判断一句都不在这儿】owned/locked 映射、0 与集齐的边界、
 * 老档案里那些已被主人删掉的图 id 怎么忽略、下载三态该弹哪句 ——
 * 全在 `lib/warehouse.ts`（纯函数、有单测）。`views/` 不在 vitest 的
 * include 范围内（见 vitest.config.ts），写在这儿的判断**永远不会有测试**，
 * 收藏页与备忘录都在抬头记过同一条教训。
 *
 * 【空图位为什么画占位符而不是照塞 `<img>`】`rewardImageUrl` 认不出 id 时给
 * null（`lib/gallery.ts` 抬头那段）—— 直接塞进 src 会渲染成**裂图**，
 * 界面上像"图还没加载完"，比明说一句占位难查十倍。所以只有 url 非空才画 `<img>`。
 *
 * 【下载为什么走 window.miai.saveRewardImage】那是既有的 gallery:save-image
 * IPC（主进程弹系统另存框、处理取消/缺图/失败三态）—— 这里**不自定义另存逻辑**，
 * 三态到 toast 的映射在 `lib/warehouse.ts` 的 `saveToastOf`（有单测）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePetStore } from '../stores/pet'
import { useProgressStore } from '../stores/progress'
import { rewardImageUrl } from '../lib/gallery'
import { refreshRewardOverrides } from '../lib/reward-overrides'
import { buildWarehouseGrid, saveToastOf } from '../lib/warehouse'
import { GALLERY, TITLE, WAREHOUSE } from '../lib/copy'
import { PET_RICE_MAX } from '../../../shared/pet'
import { toast } from '../components/base/toast'
import MiButton from '../components/base/MiButton.vue'
import MiCard from '../components/base/MiCard.vue'
import MiProgressBar from '../components/base/MiProgressBar.vue'

const progress = useProgressStore()
const pet = usePetStore()

/** 空仓库那颗按钮的去处（V1-52 ④：奖励图从每日复习来） */
const router = useRouter()

/**
 * 图鉴格子视图模型。取图器传真的 `rewardImageUrl`（纯函数不 import 它 ——
 * 那边有 `import.meta.glob`、进不了单测，理由见 lib/warehouse.ts 抬头）。
 */
const grid = computed(() => buildWarehouseGrid(progress.profile.rewards.gallery, rewardImageUrl))

/** 收集度（进度条用）。total 为 0 只可能是图库被清空，那种坏法留给 gallery 单测去红 */
const collectPercent = computed(() =>
  grid.value.total === 0 ? 0 : (grid.value.ownedCount / grid.value.total) * 100
)

/**
 * 白饭碗：快照还没到画 '--'，**不画 0** —— 0 碗是"饭盒真空了"，还没读到就是
 * 还没读到（同侧栏好感 '--%' 的口径：不许替鱼说话）。
 */
const riceText = computed(() =>
  pet.snap === null ? '--' : WAREHOUSE.RICE_N(pet.snap.rice, PET_RICE_MAX)
)

/** 图名只从 copy.ts 的 GALLERY.TITLES 取，认不出退 id（同 RewardDialog 的口径） */
function nameOf(id: string): string {
  return (GALLERY.TITLES as Record<string, string | undefined>)[id] ?? id
}

/**
 * 正在保存的格子。防连点：真起两个系统另存框，用户会以为第一次没反应
 * （同 RewardDialog 的 `saving`）。
 */
const savingId = ref<string | null>(null)

async function download(id: string): Promise<void> {
  if (savingId.value !== null) return
  savingId.value = id
  try {
    const res = await window.miai.saveRewardImage(id)
    const t = saveToastOf(res)
    toast(t.text, t.type)
  } catch {
    // IPC 本身抛（主进程没注册 / 参数被拒）—— 对用户是同一句"没存下来"
    toast(GALLERY.SAVE_FAILED, 'error')
  } finally {
    savingId.value = null
  }
}

/**
 * 饭碗数来自宠物镜像（stores/pet.ts）。侧栏那条轮询表是全应用共享的
 * （refcount 单例），这里挂一份引用是**让本页自己站得住**：不依赖
 * "侧栏恰好也在场上"（同 OverviewView 的处境）。
 */
let releasePetPoll: (() => void) | null = null

onMounted(() => {
  // 奖励图覆盖先刷（2026-10-16）：往覆盖文件夹丢的图，进仓库页立刻可见
  void refreshRewardOverrides()
  void pet.init()
  releasePetPoll = pet.ensurePetPoller()
})

onBeforeUnmount(() => {
  releasePetPoll?.()
  releasePetPoll = null
})
</script>

<template>
  <div class="warehouse-page">
    <h1 class="page-title">{{ TITLE.WAREHOUSE }}</h1>

    <!--
      loaded gate（同备忘录）：档案没读完之前**不画格** —— 那会儿 rewards 还是
      空数组，先画出来就是一屏"一张都没收集到"，几十毫秒后自己改口，比等一等难看。
    -->
    <template v-if="progress.loaded">
      <p class="page-sub">{{ WAREHOUSE.SUB }}</p>

      <!--
        一张图都没收集到时的洞口（V1-52 ④）：上面那句说的是"图从复习来"，
        这句则把去路做成一步 —— 0 收集的新用户此前在这页只有一句话，
        复习入口又藏在默认折叠的侧栏组里。
      -->
      <div v-if="grid.ownedCount === 0" class="wh-cta">
        <MiButton size="sm" variant="primary" @click="router.push('/review')">
          {{ WAREHOUSE.GO_REVIEW }}
        </MiButton>
      </div>

      <MiCard class="wh-stats">
        <div class="wh-stat">
          <span class="wh-stat-num">{{ riceText }}</span>
          <span class="wh-stat-label">{{ WAREHOUSE.RICE }}</span>
        </div>
        <!--
          全对次数（V1-38）：perfectPasses 一直在记，但此前**没有任何地方显示它**
          —— 用户看不到的账等于没记（每日一次后尤其：多做的全对只进这个数）。
          放仓库页是因为它就是这份台账的"家"（图鉴 + 战绩），样式复用 .wh-stat。
        -->
        <div class="wh-stat">
          <span class="wh-stat-num">{{ progress.profile.rewards.perfectPasses }}</span>
          <span class="wh-stat-label">{{ WAREHOUSE.PASSES }}</span>
        </div>
        <div class="wh-collect">
          <span class="wh-collect-text">{{ WAREHOUSE.COLLECT(grid.ownedCount, grid.total) }}</span>
          <MiProgressBar :percent="collectPercent" :height="8" />
        </div>
      </MiCard>

      <!-- 图鉴格子（列数自适应，见 .wh-grid）：owned → 图 + 下载按钮；locked / 图缺位 → 占位符（绝不摆裂图） -->
      <div class="wh-grid">
        <div v-for="cell in grid.cells" :key="cell.id" class="wh-cell">
          <div class="wh-thumb">
            <!--
              只有拿得到地址才画 <img>。alt/title = 图名（真源在 copy.ts 的 GALLERY.TITLES），
              认不出退 id —— 名字在这儿不另存一份。
            -->
            <!--
              2026-10-17 扩池到 496：加 loading="lazy" —— 全部收齐时这一页会
              同时解码近 500 张图（约 1.3GB 位图），懒加载只解码视口附近的
              几十张；占位符与滚动位置都不受影响。
            -->
            <img
              v-if="cell.url"
              class="wh-img"
              :src="cell.url"
              :alt="nameOf(cell.id)"
              :title="nameOf(cell.id)"
              loading="lazy"
              decoding="async"
            />
            <!--
              空图位两种情形分开画：没收集到 = 「还没解锁」；
              已收集但图缺位（打包版路径差异）= 画名字占位 —— 后者再喊"没解锁"就是假话。
            -->
            <div v-else class="wh-ph">
              <span v-if="!cell.owned" class="wh-lock">{{ WAREHOUSE.LOCKED }}</span>
              <span v-else class="wh-ph-name">{{ nameOf(cell.id) }}</span>
            </div>
          </div>
          <MiButton
            v-if="cell.owned"
            size="sm"
            variant="secondary"
            :loading="savingId === cell.id"
            :disabled="savingId !== null"
            @click="download(cell.id)"
          >
            {{ GALLERY.SAVE_IMAGE }}
          </MiButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.warehouse-page {
  max-width: 1000px;
  margin: 0 auto;
}
.page-title {
  font-family: var(--mi-font-title);
  font-size: 20px;
  margin-bottom: 8px;
}
.page-sub {
  font-size: 13px;
  color: var(--mi-text-2);
  margin: 0 0 12px;
}
/* 空仓库的「去复习」（V1-52 ④）：贴在副标题下、不抢卡片的位置 */
.wh-cta {
  margin: -4px 0 12px;
}
.wh-stats {
  display: flex;
  align-items: center;
  gap: 28px;
  /* 覆盖 MiCard 的 16px 上下留白：这一条是"账目行"，不是内容块，矮一点更贴上面 */
  padding: 12px 16px;
  margin-bottom: 16px;
}
.wh-stat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-shrink: 0;
}
.wh-stat-num {
  font-size: 18px;
  font-weight: 600;
  /* 数字等宽：饭碗数 5s 一刷（轮询），不等宽会让整行随数字抖动 */
  font-variant-numeric: tabular-nums;
}
.wh-stat-label {
  font-size: 12px;
  color: var(--mi-text-3);
}
.wh-collect {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.wh-collect-text {
  font-size: 12px;
  color: var(--mi-text-2);
}

/*
 * 图鉴格子。列数**自适应**（2026-10-09 UI 大修轮：图池 12 → 50，4×3 硬编码退役）：
 * `auto-fill` 按容器宽度自己排，150px 下限保证缩到窄窗口时格子还看得清；
 * 宽屏约 6 列、512 的图缩到 ~155px 一格。间距 10px（比原 4×3 的 12px 收紧一档，
 * 50 格铺开时不显空洞）。
 * 【为什么 .wh-cell 要 min-width: 0】栅格子项默认 min-width:auto（= 内容宽），
 * 窄窗口下按钮/文字会把格子撑出去、把 MAIN 顶出横向滚动 —— 格子声明
 * min-width:0 之后可以缩到比内容还窄，缩的是图（width:100%），不是布局。
 */
.wh-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.wh-cell {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.wh-thumb {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--mi-border);
  border-radius: var(--mi-radius);
  background: var(--mi-bg);
  overflow: hidden;
}
.wh-img {
  width: 100%;
  height: 100%;
  /* 图是 512×512 正方，格子也是正方 —— contain 与 cover 等价，选 contain 保不裁 */
  object-fit: contain;
  display: block;
}
/*
 * 空图位的占位框：虚线 + 灰字（同 MiMascot 占位框的观感 —— 它是"还没东西"，
 * 不是"东西坏了"）。
 * 描边走 --mi-text-3 而不是 --mi-border：后者（#dae5f0）压在 --mi-zebra 上
 * 几乎看不见（同 MiMascot 那条注释的理由）—— 一个看不见的占位框等于没有。
 * 文字用 --mi-text-2：色块底上留出余量（浅色 6.4:1 / 深色 7.4:1）。
 */
.wh-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  box-sizing: border-box;
  border: 1px dashed var(--mi-text-3);
  border-radius: var(--mi-radius);
  background: var(--mi-zebra);
  font-size: 12px;
  color: var(--mi-text-2);
  text-align: center;
  /* 老档案里 id 长一点也只在格内折行，不顶出去 */
  overflow: hidden;
  overflow-wrap: anywhere;
}
.wh-lock,
.wh-ph-name {
  line-height: 1.4;
}
.wh-cell :deep(.mi-btn) {
  width: 100%;
}
</style>
