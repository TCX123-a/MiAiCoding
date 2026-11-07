/**
 * Java 单文件多 public 类拆分 —— 端到端（v7 模块六，2026-10-31）。
 *
 * 【为什么不满足于单测】
 * `java-split.test.ts` 验的是「切出来的文件内容对不对」，`planForLang` 验的是
 * 「参数拼得对不对」。但真正会坏的那一格在两者之间：**写盘的文件名和
 * javac 看到的文件名是不是同一套**、入口类名和 `java` 启动参数是不是同一个。
 * 这只有真编译一次才能证明。
 *
 * 【没有 JDK 的机器】
 * 跳过，并像 samples-e2e 一样明确警告「跳过 = 没验过」。这是环境依赖的校验，
 * 不是纯逻辑；让没装 JDK 的机器整个测试套件变红，会让人开始习惯性忽略失败。
 *
 * 【第二条用例为什么看 stderr 里的 Person.java】
 * 如果运行器没拆文件，整段代码会写进 `Test.java`（入口类的名字），javac 报的
 * 文件名也是 `Test.java` —— 于是「拆没拆」在报错里一眼可辨。这比断言内部
 * 临时目录里有哪些文件更接近用户真实看到的东西。
 */
import { describe, expect, it } from 'vitest'
import { detectAll } from '../../env/detect'
import { runCode } from '../runner'
import type { EnvReport } from '../../../shared/types'

const report: EnvReport = await detectAll()
const javaReady = report.java.found && !!report.java.path
if (!javaReady) {
  console.warn('[java-split-e2e] 没找到 JDK，多文件拆分不会被真跑。⚠️ 跳过 = 没验过。')
}

describe('Java 多文件拆分：真编译真运行', () => {
  it.skipIf(!javaReady)('Person + Test：拆成两个文件后编得过、跑得出，并带回拆分信息', async () => {
    const code = `public class Person {
  String name;
  Person(String n) { this.name = n; }
}

public class Test {
  public static void main(String[] args) {
    System.out.println(new Person("大肥鱼").name);
  }
}
`
    const r = await runCode({ lang: 'java', code, timeoutSec: 30 }, report)
    expect(r.ok, r.stderr || r.message).toBe(true)
    expect(r.stdout.replace(/\r\n/g, '\n').trim()).toBe('大肥鱼')
    expect(r.javaSplit?.files).toEqual(['Test.java', 'Person.java'])
    expect(r.javaSplit?.entry).toBe('Test')
  })

  it.skipIf(!javaReady)('第二个类里写错：报错文件名必须是 Person.java（证明确实拆了）', async () => {
    const code = `public class Person {
  void go() { int x = ; }
}

public class Test {
  public static void main(String[] args) { new Person().go(); }
}
`
    const r = await runCode({ lang: 'java', code, timeoutSec: 30 }, report)
    expect(r.ok).toBe(false)
    expect(r.phase).toBe('compile')
    expect(r.stderr).toContain('Person.java')
    expect(r.javaSplit?.files).toEqual(['Test.java', 'Person.java'])
  })

  it.skipIf(!javaReady)('两个同名 public 类：结构错误在应用里说清楚，不交给编译器猜', async () => {
    const r = await runCode(
      { lang: 'java', code: 'public class A { }\npublic class A { }\n', timeoutSec: 30 },
      report
    )
    expect(r.ok).toBe(false)
    expect(r.phase).toBe('compile')
    expect(r.message).toContain('A')
    expect(r.message).toContain('喵')
  })
})
