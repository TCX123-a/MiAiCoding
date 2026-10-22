import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 路由元信息的类型声明（⑤ 十项升级加的第一个 meta 用法）。
 * 不声明的话 `route.meta.bare` 是 unknown，App.vue 里的布尔判断在 vue-tsc 下
 * 要靠强转才过 —— 声明一次，读到它的地方字体/类型都对得上。
 */
declare module 'vue-router' {
  interface RouteMeta {
    /** 裸壳路由：App.vue 跳过三栏壳，只留壁纸 + 顶条 + 视图本身 */
    bare?: boolean
  }
}

// hash 模式：打包后走 file:// 协议，必须用 hash（history 模式会失效）
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/learn' },
    { path: '/learn', name: 'learn', component: () => import('../views/LearnView.vue') },
    { path: '/lesson/:id', name: 'lesson', component: () => import('../views/LessonDetailView.vue') },
    { path: '/practice', name: 'practice', component: () => import('../views/PracticeView.vue') },
    { path: '/playground', name: 'playground', component: () => import('../views/PlaygroundView.vue') },
    { path: '/challenge', name: 'challenge', component: () => import('../views/ChallengeView.vue') },
    { path: '/favorites', name: 'favorites', component: () => import('../views/FavoritesView.vue') },
    // 大肥鱼备忘录（P3 ②）：跟着收藏排 —— 侧栏那两格也是挨着的（同一堆东西）
    { path: '/memo', name: 'memo', component: () => import('../views/MemoView.vue') },
    // 大肥鱼仓库（P3 ⑨）：排在备忘录后面 —— 侧栏那几格也是挨着的（同一堆攒下来的东西）
    { path: '/warehouse', name: 'warehouse', component: () => import('../views/WarehouseView.vue') },
    { path: '/review', name: 'review', component: () => import('../views/ReviewView.vue') },
    { path: '/overview', name: 'overview', component: () => import('../views/OverviewView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    /**
     * 登录（⑤）。meta.bare：不挂三栏壳 —— 登录是一件专注的事，
     * 旁边挂着课程列表和右栏只会分神；回程路由页面自己的返回块带。
     */
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { bare: true } },
    /** 排行榜（⑤）。照常挂三栏壳：用户会在榜单和课程之间来回切 */
    { path: '/leaderboard', name: 'leaderboard', component: () => import('../views/LeaderboardView.vue') }
  ]
})

export default router
