/**
 * Java 单文件多类拆分（v7 模块六，2026-10-31）。
 *
 * 这个文件盯四件事：
 *   1. **该拆的拆对**：每个 public 顶层类一个文件，main 所在类当入口，
 *      包内类并进入口文件，注释/字符串/文本块里的假类名不算数；
 *   2. **不该拆的不拆**：只有一个 public 类、带 package、重名、语法残缺 ——
 *      全部返回 `plan:null`，调用方走**逐字节不变**的旧路径（不制造回归）；
 *   3. **两份实现行为一致**：`src/shared/java-split.ts`（应用）和
 *      `scripts/lib/run-code.mjs`（内容闸门）必须对同一批输入给出同一个结果；
 *   4. **运行计划也对齐**：拆分后的写盘文件、javac 参数、java 入口类名，
 *      应用与内容脚本逐项相同。
 *
 * 【为什么 3、4 不是"读源码文本比对"】
 * 文本比对拦不住「逻辑抄错了」——它只拦得住「改了其中一处」。这里能拿到
 * 两份函数的真身，就喂同一批输入逐条对拍（照 run-grading-script-parity.test.ts 的先例）。
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { maskJavaLiterals, splitJavaSource } from '../java-split'
import { planForLang } from '../../main/runner/runner'

interface ScriptModule {
  splitJavaSource(code: string): unknown
  maskJavaLiterals(code: string): string
  planForLang(lang: string, code: string): {
    srcFile: string
    sources?: { file: string; content: string }[]
    artifact?: string
    compile?: string[]
    run: string[]
    error?: string
  }
}

const root = process.cwd()
const SCRIPT = join(root, 'scripts', 'lib', 'run-code.mjs')

let script: ScriptModule | null = null
let loadError: string | null = null

beforeAll(async () => {
  try {
    script = (await import(/* @vite-ignore */ pathToFileURL(SCRIPT).href)) as ScriptModule
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e)
  }
})

// ------------------------------------------------------------------ 样本

/** 两个 public 类，main 在第二个：最典型的 Person.java + Test.java */
const TWO_PUBLIC_MAIN_SECOND = `public class Person {
  String name = "大肥鱼";
}

public class Test {
  public static void main(String[] args) {
    System.out.println(new Person().name);
  }
}
`

/** main 在第一个 */
const TWO_PUBLIC_MAIN_FIRST = `public class Test {
  public static void main(String[] args) { }
}

public class Person { }
`

/** 两个 public 类都没有 main：入口取第一个 public */
const TWO_PUBLIC_NO_MAIN = `public class A { }
public class B { }
`

/** 包内类（没有 public）要并进入口文件，而不是自己一个文件 */
const WITH_PACKAGE_PRIVATE_HELPER = `public class Main {
  public static void main(String[] args) { new Helper().go(); }
}
class Helper {
  void go() { System.out.println("go"); }
}
public class Other { }
`

/** 注释 / 字符串 / 字符字面量 / 文本块里的假类名一个都不能算 */
const FAKE_TYPES_EVERYWHERE = `// public class Ghost1 {}
/* public class Ghost2 {} */
public class A {
  String s = "public class Ghost3 {}";
  char c = '{';
}
public class Main {
  public static void main(String[] args) { }
}
`

/** 文本块里可以随便出现花括号和类名 */
const TEXT_BLOCK = `public class A {
  String t = """
      public class Ghost {}
      """;
}
public class Main {
  public static void main(String[] args) { }
}
`

/** 嵌套类不是顶层类型，不能被拆出去 */
const NESTED_TYPES = `public class Outer {
  public class Inner { }
  static class Deep { }
}
public class Main {
  public static void main(String[] args) { }
}
`

/** 顶层注解带数组参数：参数里的 `{` 不能被当成"不认识的顶层花括号" */
const ANNOTATION_WITH_ARRAY = `@SuppressWarnings({"unchecked", "rawtypes"})
public class Old { }

@Deprecated(since = "9")
public class Main {
  public static void main(String[] args) { }
}
`

/** @interface 是类型声明，不是注解 */
const ANNOTATION_TYPE = `public @interface Tag { }
public class Main {
  public static void main(String[] args) { }
}
`

/** record / enum 都是合法的顶层类型 */
const RECORD_AND_ENUM = `public record Point(int x, int y) { }
public enum Color { RED, GREEN }
public class Main {
  public static void main(String[] args) { }
}
`

/** public non-sealed class 的 public 必须能被认出来（连字符曾把它吃掉） */
const NON_SEALED = `public sealed interface Shape permits Circle { }
public non-sealed class Circle implements Shape { }
public final class Square implements Shape { }
`

/** 修饰符顺序不固定，main 仍然要认出来 */
const MAIN_MODIFIER_ORDERS = `public class A {
  static public void main(String[] args) { }
}
public final class B { }
`

/** 嵌套类里的 main 不算入口 */
const MAIN_ONLY_IN_NESTED = `public class Outer {
  static class Inner {
    public static void main(String[] args) { }
  }
}
public class Second { }
`

/**
 * 2026-10-31 自检 P2：包内类也可以是启动入口。
 * `java M` 对默认包里的非 public 类完全合法 —— 旧实现只在 public 类里找
 * main，会把入口错挑成 A，运行期报 Main method not found。
 */
const NON_PUBLIC_ENTRY = `public class A { }
public class B { }
class M {
  public static void main(String[] args) { System.out.println("hi"); }
}
`

/**
 * 2026-10-31 自检 P2：`main()` / `main(String)` 是普通重载，
 * Java 启动器只认 `main(String[])` / `main(String...)`，不能拿它们当入口。
 */
const MAIN_WRONG_SIGNATURE = `public class Fake {
  public static void main() { }
  public static void main(String arg) { }
}
public class Real {
  public static void main(String[] args) { }
}
`

/**
 * 2026-10-31 自检 P2：限定名注解（@a.b.C）必须整段跟着它标注的类型走。
 * 旧实现只往回找紧贴名字的 `@`，限定名会被截断进 preamble —— 于是
 * `@FunctionalInterface` 被复制到另一个 class 文件上，javac 直接报错。
 */
const QUALIFIED_ANNOTATION = `@java.lang.FunctionalInterface
public interface Fn {
  void run();
}

@java.lang.SuppressWarnings("all")
public class Main {
  public static void main(String[] args) { }
}
`

/** 只有一个 public 类：旧路径，不拆 */
const ONE_PUBLIC = `public class Main {
  public static void main(String[] args) { }
}
class Helper { }
`

/** 没有 public 类：旧路径，不拆 */
const NO_PUBLIC = `class A { }
class B { }
`

/** package 声明：旧运行器不建包目录，拆了也跑不通，所以不拆 */
const WITH_PACKAGE = `package demo;
public class A { }
public class B { }
`

/** 两个同名 public 类：不能各写一个同名文件，报结构错误 */
const DUPLICATE_PUBLIC = `public class A { }
public class A { }
`

/** 花括号不配对：解析不了就退回旧路径，不猜 */
const MALFORMED = `public class A { }
public class B {
`

const SPLIT_CASES = [
  TWO_PUBLIC_MAIN_SECOND,
  TWO_PUBLIC_MAIN_FIRST,
  TWO_PUBLIC_NO_MAIN,
  WITH_PACKAGE_PRIVATE_HELPER,
  FAKE_TYPES_EVERYWHERE,
  TEXT_BLOCK,
  NESTED_TYPES,
  ANNOTATION_WITH_ARRAY,
  ANNOTATION_TYPE,
  RECORD_AND_ENUM,
  NON_SEALED,
  MAIN_MODIFIER_ORDERS,
  MAIN_ONLY_IN_NESTED,
  NON_PUBLIC_ENTRY,
  MAIN_WRONG_SIGNATURE,
  QUALIFIED_ANNOTATION
]

const NO_SPLIT_CASES = [ONE_PUBLIC, NO_PUBLIC, WITH_PACKAGE, MALFORMED]

// ------------------------------------------------------------------ 应用侧行为

describe('splitJavaSource：该拆的拆对', () => {
  it('Person + Test：两个文件、入口是带 main 的 Test、内容不串味', () => {
    const r = splitJavaSource(TWO_PUBLIC_MAIN_SECOND)
    expect(r.duplicatePublic).toBeUndefined()
    expect(r.plan).not.toBeNull()
    const plan = r.plan!
    expect(plan.entry).toBe('Test')
    expect(plan.files.map((f) => f.file)).toEqual(['Test.java', 'Person.java'])
    const [test, person] = plan.files
    expect(test.content).toContain('public class Test')
    expect(test.content).toContain('public static void main')
    expect(test.content).not.toContain('class Person')
    expect(person.content).toContain('public class Person')
    expect(person.content).not.toContain('main')
  })

  it('main 在第一个时入口就是第一个', () => {
    const plan = splitJavaSource(TWO_PUBLIC_MAIN_FIRST).plan!
    expect(plan.entry).toBe('Test')
    expect(plan.files.map((f) => f.file)).toEqual(['Test.java', 'Person.java'])
  })

  it('都没有 main 时入口取第一个 public', () => {
    const plan = splitJavaSource(TWO_PUBLIC_NO_MAIN).plan!
    expect(plan.entry).toBe('A')
    expect(plan.files.map((f) => f.file)).toEqual(['A.java', 'B.java'])
  })

  it('包内类并进入口文件（一个文件只能有一个 public 类，但可以带包内类）', () => {
    const plan = splitJavaSource(WITH_PACKAGE_PRIVATE_HELPER).plan!
    expect(plan.entry).toBe('Main')
    expect(plan.files.map((f) => f.file)).toEqual(['Main.java', 'Other.java'])
    const main = plan.files[0].content
    expect(main).toContain('public class Main')
    expect(main).toContain('class Helper')
    expect(main).not.toContain('class Other')
    expect(plan.files[1].content).toContain('public class Other')
    expect(plan.files[1].content).not.toContain('class Helper')
  })

  it('注释 / 字符串 / 字符里的假类名不算数（否则会多拆出 Ghost.java）', () => {
    const plan = splitJavaSource(FAKE_TYPES_EVERYWHERE).plan!
    expect(plan.files.map((f) => f.file)).toEqual(['Main.java', 'A.java'])
    expect(plan.files.every((f) => !f.file.startsWith('Ghost'))).toBe(true)
  })

  it('文本块里的花括号与假类名同样不算数', () => {
    const plan = splitJavaSource(TEXT_BLOCK).plan!
    expect(plan.files.map((f) => f.file)).toEqual(['Main.java', 'A.java'])
    expect(plan.files[1].content).toContain('"""')
  })

  it('嵌套类留在外层文件里，不会被拆成 Inner.java', () => {
    const plan = splitJavaSource(NESTED_TYPES).plan!
    expect(plan.files.map((f) => f.file)).toEqual(['Main.java', 'Outer.java'])
    expect(plan.files[1].content).toContain('public class Inner')
  })

  it('顶层注解带数组参数时仍然能拆，注解跟着类走', () => {
    const plan = splitJavaSource(ANNOTATION_WITH_ARRAY).plan!
    expect(plan.entry).toBe('Main')
    expect(plan.files.map((f) => f.file)).toEqual(['Main.java', 'Old.java'])
    expect(plan.files[0].content).toContain('@Deprecated(since = "9")')
    expect(plan.files[1].content).toContain('@SuppressWarnings({"unchecked", "rawtypes"})')
  })

  it('@interface 是类型声明（public 要认出来）', () => {
    const plan = splitJavaSource(ANNOTATION_TYPE).plan!
    expect(plan.files.map((f) => f.file)).toEqual(['Main.java', 'Tag.java'])
  })

  it('record / enum 都能拆，入口是带 main 的 class', () => {
    const plan = splitJavaSource(RECORD_AND_ENUM).plan!
    expect(plan.entry).toBe('Main')
    expect(plan.files.map((f) => f.file)).toEqual(['Main.java', 'Point.java', 'Color.java'])
  })

  it('public non-sealed class 的 public 认得出（连字符曾经把它吃掉）', () => {
    const plan = splitJavaSource(NON_SEALED).plan!
    expect(plan.files.map((f) => f.file)).toEqual(['Shape.java', 'Circle.java', 'Square.java'])
    expect(plan.files[1].content).toContain('public non-sealed class Circle')
  })

  it('main 的修饰符顺序不固定（static public 也认）', () => {
    const plan = splitJavaSource(MAIN_MODIFIER_ORDERS).plan!
    expect(plan.entry).toBe('A')
  })

  it('嵌套类里的 main 不算入口（Java 启动器也不会去找 Outer$Inner.main）', () => {
    const plan = splitJavaSource(MAIN_ONLY_IN_NESTED).plan!
    expect(plan.entry).toBe('Outer')
    expect(plan.files.map((f) => f.file)).toEqual(['Outer.java', 'Second.java'])
  })

  it('包内类带 main 也能当入口（java M 对默认包的非 public 类合法）', () => {
    const plan = splitJavaSource(NON_PUBLIC_ENTRY).plan!
    expect(plan.entry).toBe('M')
    expect(plan.files.map((f) => f.file)).toEqual(['M.java', 'A.java', 'B.java'])
    const m = plan.files[0].content
    expect(m).toContain('class M')
    expect(m).toContain('public static void main')
    expect(m).not.toContain('public class A')
    expect(m).not.toContain('public class B')
  })

  it('main() / main(String) 不是入口签名，不能压过真正的 main(String[])', () => {
    const plan = splitJavaSource(MAIN_WRONG_SIGNATURE).plan!
    expect(plan.entry).toBe('Real')
    expect(plan.files.map((f) => f.file)).toEqual(['Real.java', 'Fake.java'])
  })

  it('限定名注解（@java.lang.Xxx）跟着它标注的类型走，不混进别的文件', () => {
    const plan = splitJavaSource(QUALIFIED_ANNOTATION).plan!
    expect(plan.entry).toBe('Main')
    expect(plan.files.map((f) => f.file)).toEqual(['Main.java', 'Fn.java'])
    const [main, fn] = plan.files
    expect(main.content).toContain('@java.lang.SuppressWarnings("all")')
    // 旧实现会把这段标在接口上的注解复制到 Main.java —— javac 会拒绝
    expect(main.content).not.toContain('FunctionalInterface')
    expect(fn.content).toContain('@java.lang.FunctionalInterface')
    expect(fn.content).not.toContain('SuppressWarnings')
  })
})

describe('splitJavaSource：不该拆的不拆（旧行为逐字节保留）', () => {
  for (const [name, code] of [
    ['只有一个 public 类', ONE_PUBLIC],
    ['没有 public 类', NO_PUBLIC],
    ['带 package 声明', WITH_PACKAGE],
    ['花括号不配对', MALFORMED]
  ] as const) {
    it(`${name} → plan:null`, () => {
      const r = splitJavaSource(code)
      expect(r.plan).toBeNull()
      expect(r.duplicatePublic).toBeUndefined()
    })
  }

  it('两个同名 public 类 → duplicatePublic，且绝不产出 plan', () => {
    const r = splitJavaSource(DUPLICATE_PUBLIC)
    expect(r.plan).toBeNull()
    expect(r.duplicatePublic).toBe('A')
  })
})

describe('maskJavaLiterals：遮罩只改字面量，不动长度与换行', () => {
  it('长度不变、换行位置不变', () => {
    const code = '// x\n/* y\nz */\nString s = "public class X";\nchar c = \'{\';\n'
    const masked = maskJavaLiterals(code)
    expect(masked.length).toBe(code.length)
    for (let i = 0; i < code.length; i += 1) {
      if (code[i] === '\n') expect(masked[i]).toBe('\n')
    }
    expect(masked).not.toContain('public class X')
    expect(masked).not.toContain('//')
    expect(masked).not.toContain('/*')
  })

  it('转义引号不会提前结束字符串', () => {
    const code = 'String s = "a \\" public class Fake {} b"; public class Real {}'
    const masked = maskJavaLiterals(code)
    expect(masked).not.toContain('public class Fake')
    expect(masked).toContain('public class Real')
  })
})

// ------------------------------------------------------------------ 两份实现对拍

describe('应用与内容脚本：拆分结果逐例相同', () => {
  it('脚本能加载进来（加载不到就是闸门失效，不是"跳过"）', () => {
    expect(loadError, `加载 ${SCRIPT} 失败：${loadError}`).toBeNull()
    expect(script).not.toBeNull()
  })

  it(`同一批输入（${SPLIT_CASES.length + NO_SPLIT_CASES.length} 份）逐条结果相同`, () => {
    if (!script) throw new Error('脚本没加载成功')
    for (const code of [...SPLIT_CASES, ...NO_SPLIT_CASES, DUPLICATE_PUBLIC]) {
      const mine = splitJavaSource(code)
      const theirs = script.splitJavaSource(code)
      expect(theirs, `拆分结果漂了：\n${code}`).toEqual(mine)
    }
  })

  it('CRLF 源码两边也一致', () => {
    if (!script) throw new Error('脚本没加载成功')
    const crlf = TWO_PUBLIC_MAIN_SECOND.replace(/\n/g, '\r\n')
    expect(script.splitJavaSource(crlf)).toEqual(splitJavaSource(crlf))
  })
})

describe('应用与内容脚本：运行计划逐项对齐', () => {
  const tool = 'C:\\Program Files\\Java\\jdk-21\\bin\\javac.exe'

  it('拆分后的写盘文件 / javac 参数 / java 入口两边相同', () => {
    if (!script) throw new Error('脚本没加载成功')
    for (const code of SPLIT_CASES) {
      const app = planForLang('java', tool, code)
      const sc = script.planForLang('java', code)
      expect(sc.error).toBeUndefined()
      expect(app.error).toBeUndefined()
      expect(sc.srcFile).toBe(app.srcFile)
      expect(sc.sources).toEqual(app.sources)
      // 应用侧 exe 是探测出来的绝对路径，脚本侧是裸命令名；只比参数
      expect(sc.compile?.slice(1)).toEqual(app.compile?.args)
      expect(sc.run.slice(1)).toEqual(app.run.args)
      expect(sc.artifact).toBe(`${app.javaSplit?.entry}.class`)
      expect(app.javaSplit?.files.map((f) => f)).toEqual(app.sources?.map((s) => s.file))
    }
  })

  it('不拆的样本两边仍然走同一条旧路径', () => {
    if (!script) throw new Error('脚本没加载成功')
    for (const code of NO_SPLIT_CASES) {
      const app = planForLang('java', tool, code)
      const sc = script.planForLang('java', code)
      expect(sc.srcFile).toBe(app.srcFile)
      expect(sc.compile?.slice(1)).toEqual(app.compile?.args)
      expect(sc.run.slice(1)).toEqual(app.run.args)
      expect(app.sources).toBeUndefined()
    }
  })

  it('重名 public 类两边给同一句结构错误', () => {
    if (!script) throw new Error('脚本没加载成功')
    const app = planForLang('java', tool, DUPLICATE_PUBLIC)
    const sc = script.planForLang('java', DUPLICATE_PUBLIC)
    expect(app.error).toContain('A')
    expect(sc.error).toBe(app.error)
  })
})
