import type { MiaiApi } from './index'

declare global {
  interface Window {
    miai: MiaiApi
  }
}

export {}
