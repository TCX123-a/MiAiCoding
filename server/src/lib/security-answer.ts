/**
 * 安全答案归一化（找回密码链；2026-10-13）。
 * 【为什么只归一化不加密前置】答案是要被「人再输一遍」的弱秘密：全角/半角、首尾空白、
 * 大小写都是无意义的输入差异，归一后比对才符合直觉。NFKC 把全角字母数字折叠到半角
 * （「ＡＢＣ」=「abc」），trim 去首尾空白，toLowerCase 折叠大小写。
 * 【纪律】归一化只在服务端做（注册时哈希前 / 找回比对时各一次）；客户端原样上行，
 * 明文答案既不落库也不进日志（入参只经本函数与 argon2id）。
 */
export function normalizeSecurityAnswer(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase();
}
