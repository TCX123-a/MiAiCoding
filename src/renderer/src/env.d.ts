/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>
  export default component
}

// markdown-it-container 无官方类型，按实际 API 声明（::: 容器插件）
declare module 'markdown-it-container' {
  import type MarkdownIt from 'markdown-it'
  interface ContainerOpts {
    validate?: (params: string) => boolean
    render?: (tokens: any[], idx: number) => string
    marker?: string
    end?: string
  }
  export default function container(md: MarkdownIt, name: string, opts: ContainerOpts): void
}
