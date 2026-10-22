/**
 * 自定义素材导入 —— 两端共用的契约（扩展名白名单 + 结果形状）。
 *
 * 【为什么放 shared】主进程要用白名单校验 + 分类（图片/视频），渲染层的
 * 上传按钮提示（「支持 jpg / png / webp / mp4 / gif」）和失败 toast 的
 * 措辞都要引用同一份，避免「界面说支持 gif、主进程拒收 gif」的漂移。
 *
 * 【结果形状】没有异常通道：取消 = 正常返回值（reason 'cancelled'），
 * 与 dialogPickExe 的既有口径一致（取消不是错误，是用户的选择）。
 * 失败原因用机器可读的 reason 码，文案由界面层拼（main 层不产 UI 文案的
 * 既有纪律，见 copy.ts 头注释）。
 */

/** 上传壁纸允许的图片扩展名（小写、不带点）。gif 归图片类：<img> 天然会动 */
export const WALLPAPER_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const

/** 上传壁纸允许的视频扩展名。只收 mp4 —— 播放管线对它零转码 */
export const WALLPAPER_VIDEO_EXTS = ['mp4'] as const

/** 上传壁纸的对话框筛选器全列表（图片 + 视频） */
export const WALLPAPER_UPLOAD_EXTS: readonly string[] = [...WALLPAPER_IMAGE_EXTS, ...WALLPAPER_VIDEO_EXTS]

/** 上传开屏允许的扩展名。开屏管线按视频硬解（scanSplashMaterials 白名单另有一份，
 *  这里这份只管「导入的一刻」；两处不一致时以扫描器为准 = 导入成功但列表不出现，
 *  所以经单测钉死两边集合相同） */
export const SPLASH_UPLOAD_EXTS: readonly string[] = ['mp4']

/** 上传（拷贝）结果。ok=false 时 reason 必有；ok=true 时 name 必有（落进素材清单的文件名） */
export interface MediaImportResult {
  ok: boolean
  /**
   * 失败原因码：
   *  · cancelled  = 用户取消（非错误）
   *  · bad-ext    = 扩展名不在白名单
   *  · too-small  = 体积 < 1KB（扫描器也不认，导入必然「提示成功、列表没有」）
   *  · too-large  = 体积 > 2GiB（防错选巨型文件把磁盘搬满；见 MAX_IMPORT_BYTES）
   *  · copy-failed = 拷贝失败（message 带底层摘要）
   */
  reason?: 'cancelled' | 'bad-ext' | 'too-small' | 'too-large' | 'copy-failed'
  /** 成功时：实际落盘的文件名（可能因重名而带序号后缀，别拿原文件名当判据） */
  name?: string
  /** copy-failed 时：底层错误摘要（界面原样透出，便于主人报障） */
  message?: string
}
