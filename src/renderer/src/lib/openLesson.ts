/**
 * 打开课程的统一入口：draft/locked 拦截 + 猫咪提示，通过后路由跳转。
 * 侧栏、搜索面板、详情页正文内链接共用，保证行为一致。
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
    if (status === 'locked') {
      toast(TOAST.LOCKED_BY_PREREQ, 'warn')
      return
    }
    router.push(`/lesson/${id}`)
  }

  return { openLesson }
}
