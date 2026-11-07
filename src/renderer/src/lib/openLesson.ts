/**
 * 打开课程的统一入口：draft 拦截 + 路由跳转。
 *
 * 【2026-10-31 硬锁拆除】`locked` 不再拦路：前置课没学完也允许进去，
 * 课文页顶部会挂一条大肥鱼软锁提示（「这门课可能有点难哦喵」），
 * 学完点【学到这里啦喵】就能把前面的一起点亮。拦在这里的话，
 * 那条提示永远没人看得见 —— 入口本身就把人挡回去了。
 *
 * `draft`（还没写正文）仍然拦：点进去只有「备课中」，
 * 对用户没有任何可用内容，那不是「难」，是「没有」。
 */
import { useRouter } from 'vue-router'
import { useContentStore } from '../stores/content'
import { toast } from '../components/base/toast'
import { TOAST } from './copy'

export function useLessonOpener() {
  const content = useContentStore()
  const router = useRouter()

  function openLesson(id: string) {
    const status = content.statusOf(id)
    if (status === 'draft') {
      // 带上「已经写好几节」——只说「还没写好」，用户没法判断是不是软件坏了
      toast(TOAST.lessonNotReady(content.readyCount), 'warn')
      return
    }
    router.push(`/lesson/${id}`)
  }

  return { openLesson }
}
