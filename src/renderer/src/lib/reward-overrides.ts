/**
 * 奖励图覆盖映射（渲染侧缓存）——「屏幕显示」这一半的接线。
 *
 * 【两处消费点必须同吃一份覆盖】屏幕显示（lib/gallery.ts 的 rewardImageUrl
 * → 本文件）与「保存图片」（主进程 app.ts 的 findGalleryImage 自己现扫）——
 * 只改一处会得到「屏幕是我换的图、保存出去是官方图」的静默不一致。
 * 主进程那半各扫各的目录、同一份 scanRewardOverrides；这里缓存的是同一次
 * 扫描经 IPC 回来的结果。
 *
 * 【为什么缓存 + 手动刷新，不做每次现查】rewardImageUrl 是**同步**纯函数
 * （弹窗/仓库格渲染时直接调），现查要变 async 会传染一串组件。目录小、
 * 变化只可能由「用户往文件夹丢图」引起 —— 刷新点四个就够：
 *   ① 启动（main.ts）② 进仓库页（WarehouseView onMounted）
 *   ③ 弹奖励窗前（stores/reward.ts grant）④ 设置页「打开文件夹」回来。
 * 不做 fs.watch（同壁纸线先例：TTL/强制重扫，见 wallpaper/catalog.ts）。
 *
 * 【失败为什么退回空映射而不是报错】本模块只管「显示替换」：替换没生效时
 * 显示官方图 = 功能未启用的原状（不是数据丢失、不是错误结论）。设置页张数
 * 会如实显示 0，用户能看出「它没认到」；抛错反而会把奖励弹窗/仓库页炸掉，
 * 代价远大于收益。**这不是「默认回退为成功」** —— 没有任何成功结论建立
 * 在这个 catch 上，只是显示层退回出厂图。
 */
import { shallowRef } from 'vue'
import { miaiWallUrl } from '../../../shared/miai-wall-url'

/*
 * 【为什么是 shallowRef 而不是裸 let（2026-10-16，活窗前自查抓到的真坑）】
 * 仓库页的网格是 `computed(... rewardImageUrl ...)`：挂载那一刻先按**旧**映射
 * 渲染（refresh 还在飞的几十毫秒里），刷新回来时如果 map 不是响应式的，
 * computed **不会**重算 —— 表现是「丢进文件夹的新图要再进出一次页面才看得见」，
 * 第一次看见还是官方图。整份替换即触发重算（映射是只读快照，不用深层响应）。
 */
const map = shallowRef<Record<string, string>>({})

/** 取某 id 的覆盖图地址（经 miai-wall 协议，no-store 不吃脏缓存）；无覆盖给 null */
export function rewardOverrideUrl(id: string): string | null {
  const abs = map.value[id]
  return abs ? miaiWallUrl(abs) : null
}

/** 重新拉一次覆盖映射（IPC 现扫）。返回值供设置页显示「文件夹在哪、认到几张」。 */
export async function refreshRewardOverrides(): Promise<{ dir: string; count: number }> {
  try {
    const info = await window.miai.rewardOverrides()
    map.value = info?.map ?? {}
    return { dir: info?.dir ?? '', count: Object.keys(map.value).length }
  } catch {
    map.value = {}
    return { dir: '', count: 0 }
  }
}
