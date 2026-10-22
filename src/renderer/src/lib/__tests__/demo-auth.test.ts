/**
 * 本地演示账号（lib/demo-auth.ts）。
 *
 * 【这个文件在守什么】
 * 账号闭环是「用户输入 → 判定 → 落盘 → 下次打开还在」的一条链，错误症状
 * 全是**悄悄坏**的那一类：
 *
 *   1. **明文落盘**。密码/答案以明文写进 localStorage —— 界面一切正常，
 *      只有翻开存档才看得见。所以有一条断言直接读存档原文，找那两个字符串。
 *   2. **归一化漏一处**。注册归一了、登录没归一 → 「小鱼干」能注册、
 *      原样打「小鱼干」却说没有这个人。前后空格、答案大小写，两处都要钉。
 *   3. **重置后旧摘要残留**。重设密码换盐时忘了用新盐重算答案摘要 →
 *      这条账号**第二次**找回永远答「错」，而第一次一切正常（最难发现的那种）。
 *   4. **坏存档炸启动**。手改过/半截写入的 JSON 让 currentUser() 直接抛。
 *      读口必须洗数不炸 —— 演示账号丢了事小，应用起不来事大。
 *
 * node 环境没有 localStorage（vitest 的 environment: 'node'）——demo-auth 自带
 * 内存兜底存储，本文件通过 __authTestHooks 碰它（见那个钩子的注释）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __authTestHooks as H,
  currentUser,
  getQuestion,
  login,
  logout,
  register,
  resetPassword,
  saltHash,
  useAuth,
  verifyAnswer,
  type RegisterInput
} from '../demo-auth'
import { DEFAULT_AVATAR } from '../avatar'

/** 一份合法的注册参数（各用例按需覆盖单字段） */
function goodInput(over: Partial<RegisterInput> = {}): RegisterInput {
  return {
    name: '小鱼干',
    password: 'hunter22',
    confirm: 'hunter22',
    question: '最喜欢的颜色是什么？',
    answer: '蓝色',
    ...over
  }
}

beforeEach(() => H.wipe())

describe('注册', () => {
  it('顺利注册：直接进入登录态，currentUser 与 useAuth 同步亮起', () => {
    const res = register(goodInput())
    expect(res).toMatchObject({ ok: true, user: { name: '小鱼干' } })
    expect(currentUser()?.name).toBe('小鱼干')
    expect(useAuth().user.value?.name).toBe('小鱼干')
  })

  it('昵称按码点算长度：2 与 12 刚好过，1 与 13 挡下', () => {
    expect(register(goodInput({ name: '甲乙' })).ok).toBe(true)
    expect(register(goodInput({ name: '甲'.repeat(12) })).ok).toBe(true)
    expect(register(goodInput({ name: '甲' }))).toEqual({ ok: false, code: 'BAD_NAME' })
    expect(register(goodInput({ name: '甲'.repeat(13) }))).toEqual({ ok: false, code: 'BAD_NAME' })
    // emoji 按码点记 1 个：'🐟'.length 是 2（UTF-16 码元），不该骗过下限
    expect(register(goodInput({ name: '🐟' }))).toEqual({ ok: false, code: 'BAD_NAME' })
    expect(register(goodInput({ name: '🐟🐟' })).ok).toBe(true)
  })

  it('昵称首尾空格归一：注册「小鱼干」后，「 小鱼干 」再注册算重名', () => {
    expect(register(goodInput()).ok).toBe(true)
    expect(register(goodInput({ name: ' 小鱼干 ' }))).toEqual({ ok: false, code: 'NAME_TAKEN' })
  })

  it('密码：短于下限 BAD_PASS；两次不一致 PASS_MISMATCH（下限本身放行）', () => {
    // 三条各用不同昵称：重名检查先于密码检查（先到先报），共用昵称会把
    // 后两条的期望错报成 NAME_TAKEN —— 第一版就这么写错过一次
    expect(register(goodInput({ name: '甲鱼', password: 'abc', confirm: 'abc' }))).toEqual({
      ok: false,
      code: 'BAD_PASS'
    })
    expect(register(goodInput({ name: '乙鱼', password: 'abcd', confirm: 'abcd' })).ok).toBe(true)
    expect(register(goodInput({ name: '丙鱼', password: 'hunter22', confirm: 'hunter23' }))).toEqual({
      ok: false,
      code: 'PASS_MISMATCH'
    })
  })

  it('安全词：问题或答案为空（或纯空白）→ BAD_SECURITY', () => {
    expect(register(goodInput({ question: '   ' }))).toEqual({ ok: false, code: 'BAD_SECURITY' })
    expect(register(goodInput({ answer: '  ' }))).toEqual({ ok: false, code: 'BAD_SECURITY' })
  })

  it('★ 存档里没有明文密码与答案（只留盐 + 摘要）', () => {
    expect(register(goodInput()).ok).toBe(true)
    const raw = H.raw()
    expect(raw, '注册成功却没写盘').toBeTruthy()
    // 正对照：我们看的确实是这份存档（昵称是明文存储，应能找到）
    expect(raw).toContain('小鱼干')
    // 两条机密不得以明文出现
    expect(raw).not.toContain('hunter22')
    expect(raw).not.toContain('蓝色')
    const rec = JSON.parse(raw as string).users[0]
    expect(rec.pass).toMatch(/^[0-9a-f]{8}$/)
    expect(rec.pass).not.toBe('hunter22')
    expect(rec.answer).toMatch(/^[0-9a-f]{8}$/)
    expect(typeof rec.salt).toBe('string')
    expect(rec.salt.length).toBeGreaterThan(0)
  })

  it('头像：合法预设与合规 dataURL 原样保留，垃圾值落到默认', () => {
    const a = register(goodInput({ name: '甲鱼', avatar: 'yay' }))
    expect(a.ok && a.user.avatar).toBe('yay')
    const b = register(goodInput({ name: '乙鱼' }))
    expect(b.ok && b.user.avatar).toBe(DEFAULT_AVATAR)
    const c = register(goodInput({ name: '丙鱼', avatar: 'not-a-thing' }))
    expect(c.ok && c.user.avatar).toBe(DEFAULT_AVATAR)
    const url = 'data:image/png;base64,iVBORw0KGgo='
    const d = register(goodInput({ name: '丁鱼', avatar: url }))
    expect(d.ok && d.user.avatar).toBe(url)
  })
})

describe('登录', () => {
  it('登录成功并落盘 current：冷启动（丢 cache 留存储）后仍是登录态', () => {
    register(goodInput())
    logout()
    expect(currentUser()).toBeNull()
    expect(login('小鱼干', 'hunter22').ok).toBe(true)
    H.coldStart() // 模拟重启：只有 cache 被丢掉，存储还在
    expect(currentUser()?.name).toBe('小鱼干')
  })

  it('密码错 BAD_PASS_LOGIN；账号不存在 NO_USER（分开报）', () => {
    register(goodInput())
    logout()
    expect(login('小鱼干', 'wrong-pass')).toEqual({ ok: false, code: 'BAD_PASS_LOGIN' })
    expect(login('不存在的人', 'hunter22')).toEqual({ ok: false, code: 'NO_USER' })
    // 失败不改变登录态
    expect(currentUser()).toBeNull()
  })

  it('登录名首尾空格同样归一', () => {
    register(goodInput())
    logout()
    expect(login('  小鱼干  ', 'hunter22').ok).toBe(true)
  })
})

describe('安全词找回', () => {
  it('账号不存在 NO_USER；存在则给回原问题', () => {
    register(goodInput())
    expect(getQuestion('查无此人')).toEqual({ ok: false, code: 'NO_USER' })
    expect(getQuestion('小鱼干')).toEqual({ ok: true, question: '最喜欢的颜色是什么？' })
  })

  it('verifyAnswer 当场判定：答对为 true（大小写/首尾空白归一）；答错与查无此人都为 false', () => {
    register(goodInput({ answer: 'Blue Fish' }))
    expect(verifyAnswer('小鱼干', ' blue fish ')).toBe(true)
    expect(verifyAnswer(' 小鱼干 ', 'BLUE FISH')).toBe(true) // 昵称同样先 trim
    expect(verifyAnswer('小鱼干', '红色')).toBe(false)
    expect(verifyAnswer('查无此人', 'blue fish')).toBe(false)
  })

  it('★ verifyAnswer 是只读口：不落盘、不动登录态（验证过 ≠ 登录了）', () => {
    register(goodInput())
    logout()
    const before = H.raw()
    expect(verifyAnswer('小鱼干', '蓝色')).toBe(true)
    expect(currentUser()).toBeNull()
    expect(H.raw()).toBe(before) // 存档一个字节都不动
  })

  it('★ 重置换盐之后 verifyAnswer 照样答得对（它读的是记录当下的盐）', () => {
    // 若 verifyAnswer 用了别的盐（或缓存了旧摘要），第一次找回后答案判定就会永远错
    register(goodInput())
    logout()
    expect(resetPassword('小鱼干', '蓝色', 'pass-one')).toEqual({ ok: true })
    expect(verifyAnswer('小鱼干', '蓝色')).toBe(true)
    expect(verifyAnswer('小鱼干', '红色')).toBe(false)
  })

  it('★ 答对才重置（空格/大小写归一）：旧密码作废、新密码可登', () => {
    register(goodInput({ answer: 'Blue Fish' }))
    logout()
    const res = resetPassword('小鱼干', '  blue fish ', 'newpass9')
    expect(res).toEqual({ ok: true })
    expect(login('小鱼干', 'hunter22')).toEqual({ ok: false, code: 'BAD_PASS_LOGIN' })
    expect(login('小鱼干', 'newpass9').ok).toBe(true)
  })

  it('答错 BAD_ANSWER，且密码原样未动', () => {
    register(goodInput())
    logout()
    expect(resetPassword('小鱼干', '红色', 'newpass9')).toEqual({ ok: false, code: 'BAD_ANSWER' })
    expect(login('小鱼干', 'hunter22').ok).toBe(true)
  })

  it('新密码太短 BAD_PASS，且未生效', () => {
    register(goodInput())
    logout()
    expect(resetPassword('小鱼干', '蓝色', 'abc')).toEqual({ ok: false, code: 'BAD_PASS' })
    expect(login('小鱼干', 'hunter22').ok).toBe(true)
  })

  it('★ 重置会换盐、答案摘要跟着重算：连续两次找回都能成', () => {
    // 换盐后若忘了用新盐重算答案摘要，第二次找回会永远答「错」——
    // 而第一次的结果完全正常，这是最难在手工测试里发现的一种坏
    register(goodInput())
    logout()
    expect(resetPassword('小鱼干', '蓝色', 'pass-one')).toEqual({ ok: true })
    expect(resetPassword('小鱼干', '蓝色', 'pass-two')).toEqual({ ok: true })
    expect(login('小鱼干', 'pass-two').ok).toBe(true)
  })
})

describe('登出与读档清洗', () => {
  it('logout 清登录态；冷启动后依然未登录；账号还在（能再登）', () => {
    register(goodInput())
    logout()
    expect(currentUser()).toBeNull()
    expect(useAuth().user.value).toBeNull()
    H.coldStart()
    expect(currentUser()).toBeNull()
    expect(login('小鱼干', 'hunter22').ok).toBe(true)
  })

  it('坏 JSON 当空档，不炸；之后注册照常可用', () => {
    H.seed('{oops')
    expect(currentUser()).toBeNull()
    expect(login('小鱼干', 'hunter22')).toEqual({ ok: false, code: 'NO_USER' })
    expect(register(goodInput()).ok).toBe(true)
  })

  it('版本不对 / users 不是数组 → 当空档', () => {
    H.seed(JSON.stringify({ v: 2, users: [], current: null }))
    expect(currentUser()).toBeNull()
    H.seed(JSON.stringify({ v: 1, users: 'x', current: null }))
    expect(currentUser()).toBeNull()
  })

  it('坏记录被剔除、好记录保留；current 指向不存在的人 → 未登录（不炸）', () => {
    const salt = 's1'
    const good = {
      name: '鱼',
      pass: saltHash('pw1234', salt),
      salt,
      question: 'q？',
      answer: saltHash('a', salt),
      avatar: 'welcome'
    }
    H.seed(
      JSON.stringify({
        v: 1,
        users: [good, { name: '半条' }, null, { name: '半条2', pass: '', salt: 'x' }],
        current: '半条'
      })
    )
    expect(currentUser()).toBeNull() // current 指向的记录不合法
    expect(login('半条', 'whatever')).toEqual({ ok: false, code: 'NO_USER' })
    expect(login('鱼', 'pw1234').ok).toBe(true)
  })

  it('存档里陌生的头像引用在读取时洗成默认（坏数据坏不进界面）', () => {
    const salt = 's1'
    H.seed(
      JSON.stringify({
        v: 1,
        users: [
          {
            name: '鱼',
            pass: saltHash('pw1234', salt),
            salt,
            question: 'q？',
            answer: saltHash('a', salt),
            avatar: 'junk-avatar'
          }
        ],
        current: '鱼'
      })
    )
    expect(currentUser()?.avatar).toBe(DEFAULT_AVATAR)
  })

  it('重名记录只留第一条：下一次落盘时重复项被清掉（存档不长大）', () => {
    const salt = 's1'
    const mk = (name: string): Record<string, string> => ({
      name,
      pass: saltHash('pw1234', salt),
      salt,
      question: 'q？',
      answer: saltHash('a', salt),
      avatar: 'welcome'
    })
    H.seed(JSON.stringify({ v: 1, users: [mk('鱼'), mk('鱼')], current: '鱼' }))
    expect(currentUser()?.name).toBe('鱼')
    logout() // 触发一次落盘
    expect(JSON.parse(H.raw() as string).users).toHaveLength(1)
  })
})

describe('saltHash：占位摘要的基本性质', () => {
  it('同盐同料同果；换盐变果；恒为 8 位十六进制', () => {
    const a = saltHash('hunter22', 'saltA')
    expect(a).toBe(saltHash('hunter22', 'saltA'))
    expect(a).not.toBe(saltHash('hunter22', 'saltB'))
    expect(a).not.toBe(saltHash('hunter23', 'saltA'))
    expect(a).toMatch(/^[0-9a-f]{8}$/)
  })
})
