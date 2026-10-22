/** 路由层共享响应形状（docs/22 自由度 #10：account = {id, username, createdAt}；时间 ISO8601 UTC）
 *  2026-10-22 用户系统批次 +avatarHash：sha256 hex，null = 没设头像（客户端显示默认大肥鱼）。 */
import { z } from 'zod';

export const accountSchema = z.object({
  id: z.string(),
  username: z.string(),
  avatarHash: z.string().nullable(),
  createdAt: z.string(),
});

export const authResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  absoluteExpiresAt: z.string(),
  account: accountSchema,
});
