/**
 * per-doc 串行队列（src/main/store/doc-queue.ts）—— 本地写协议三件套之③
 * （docs/21 §8.2）：同一份文档的一切「读→改→写」都从它过。
 *
 * 【这个文件在守什么】
 *   1. **同 key 串行**：前一个任务 await 期间排进来的任务必须等它跑完 ——
 *      这是「重读磁盘→合并→写盘」不被交错的机制（引擎侧原子性的地基）。
 *   2. **异 key 互不阻塞**：四份文档各排各的，一份卡住不带停另外三份。
 *   3. **失败不断链**：任务抛异常只回给提交者，队列下一个照常跑 ——
 *      断链会让一次偶发失败把这份文档的队列**永久卡死**，且无声无息。
 *   4. **返回值各归各的**：不串台（并发提交时最容易出的错）。
 *
 * ⚠️ 本文件在 `src/` 下、被文案闸门扫，字符串一律英文。
 */
import { describe, expect, it } from 'vitest'
import { createKeyedQueue } from '../doc-queue'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createKeyedQueue：同 key 串行、异 key 并行', () => {
  it('★ 同 key：前一个 await 期间排进来的任务必须等它跑完', async () => {
    const q = createKeyedQueue<'a' | 'b'>()
    const log: string[] = []
    const p1 = q.run('a', async () => {
      log.push('a1-start')
      await tick()
      log.push('a1-end')
    })
    const p2 = q.run('a', () => {
      log.push('a2')
    })
    await Promise.all([p1, p2])
    expect(log).toEqual(['a1-start', 'a1-end', 'a2'])
  })

  it('异 key 互不阻塞：b 的任务不等 a 的 await', async () => {
    const q = createKeyedQueue<'a' | 'b'>()
    let releaseA: () => void = () => {}
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const log: string[] = []
    const pa = q.run('a', async () => {
      log.push('a-start')
      await gateA
      log.push('a-end')
    })
    const pb = q.run('b', () => {
      log.push('b-done')
    })
    await pb
    expect(log).toEqual(['a-start', 'b-done']) // b 在 a 挂起期间就跑完了
    releaseA()
    await pa
    expect(log).toEqual(['a-start', 'b-done', 'a-end'])
  })

  it('★ 失败不断链：任务抛了，下一个照常跑；失败回给提交者', async () => {
    const q = createKeyedQueue<'a'>()
    const log: string[] = []
    const p1 = q.run('a', () => {
      throw new Error('boom')
    })
    await expect(p1).rejects.toThrow('boom')
    const p2 = q.run('a', () => {
      log.push('after-failure')
      return 42
    })
    await expect(p2).resolves.toBe(42)
    expect(log).toEqual(['after-failure'])
  })

  it('异步任务 reject 同样不断链', async () => {
    const q = createKeyedQueue<'a'>()
    const p1 = q.run('a', async () => {
      await tick()
      throw new Error('late-boom')
    })
    const p2 = q.run('a', () => 'ok')
    await expect(p1).rejects.toThrow('late-boom')
    await expect(p2).resolves.toBe('ok')
  })

  it('返回值各归各的（并发提交不串台）', async () => {
    const q = createKeyedQueue<'a'>()
    const p1 = q.run('a', async () => {
      await tick()
      return 'first'
    })
    const p2 = q.run('a', () => 'second')
    expect(await p1).toBe('first')
    expect(await p2).toBe('second')
  })
})
