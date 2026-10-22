/**
 * 四份云同步文档的合并函数装配（唯一一份）。
 *
 * 【为什么单独一个文件】sync-engine 的每轮合并与 account-flow 的首激活收编
 * **必须用同一组函数**：两处各装一份的话，改一处忘一处的表现是「同步按新
 * 口径、收编按旧口径」这种不报错的分叉 —— 收编只在首激活发生一次，分叉了
 * 连复现都要靠用户换账号。类型 DocMerger 的声明在 sync-engine（type-only
 * import，无运行时环）。
 *
 * ⚠️ 本文件在 `src/main/cloud/**`（零网络闸门扫描面）：纯装配，无 IO 无网络。
 */
import type { DocType } from '../../shared/cloud/protocol'
import {
  mergeFavoritesDoc,
  mergePracticeDoc,
  mergeProfileDoc,
  mergeWrongbookDoc
} from '../../shared/cloud/merge'
import type { DocMerger } from './sync-engine'

export const CLOUD_DOC_MERGERS: Record<DocType, DocMerger> = {
  profile: mergeProfileDoc,
  wrongbook: mergeWrongbookDoc,
  favorites: mergeFavoritesDoc,
  practice: mergePracticeDoc
}
