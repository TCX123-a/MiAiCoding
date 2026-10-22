# -*- coding: utf-8 -*-
"""第二轮补测：第一轮里 ✗/⚠ 的规则，到底是「我的触发器写得不好」还是「规则真的够不着」。

判定口径（很重要，别搞反）：
  ✓ 换一个真实写法就命中  → 规则没毛病，是我第一轮触发器选得差
  ✗ 真实写法也够不着      → 规则本身就是死的（或被别人永久挡在前面）
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_errorlib import load_lib, match_error, run_trigger  # noqa: E402

LIB = load_lib()

PROBES = [
    ('c', 1, 'stray —— 中文标点到底要写成什么样才会报 stray', [
        'int main(void) { int a = 1； return 0; }\n',
        '#include <stdio.h>\nint main(void) { printf（"hi"）; return 0; }\n',
        'int main(void) { int ａ = 1; return 0; }\n',
        'int main(void) { char *s = “abc”; return 0; }\n',
        'int main(void) { int a = 1， b = 2; return 0; }\n',
        '#include <stdio.h>\nint main(void) { printf("你好")； return 0; }\n',
    ]),
    ('c', 3, "expected ';' —— 少分号的其它写法", [
        'int main(void) { int a = 1 }\n',
        'struct S { int x }\nint main(void) { return 0; }\n',
        'int main(void) { int a = 1 a = 2; return 0; }\n',
    ]),
    ('cpp', 22, 'template argument is invalid —— 尖括号里塞个非法的东西', [
        '#include <vector>\nint main() { std::vector<int, int> v; return 0; }\n',
        '#include <vector>\nint main() { std::vector<1> v; return 0; }\n',
        'template <int N> struct S {};\nS<"x"> s;\n',
    ]),
    ('java', 10, "'}' expected —— 什么写法才报这一句", [
        'public class Main { public static void main(String[] a) { int x = 1; }\n',
        'public class Main { int x = 1;\n',
        'public class Main { public static void main(String[] a) { { } }\n',
        'public class Main { void f() { if (true) { } }\n',
    ]),
    ('java', 14, 'unclosed string literal —— 看看 javac 是不是两句一起报', [
        'public class Main { public static void main(String[] a) { String s = "abc; } }\n',
    ]),
    ('java', 22, 'cannot be applied to given types —— 参数个数不对', [
        'public class Main {\n'
        '    static void f(int a) {}\n'
        '    public static void main(String[] a) { f(1, 2); }\n}\n',
    ]),
    ('java', 23, 'no suitable method found for —— 标准库方法参数个数不对', [
        'public class Main { public static void main(String[] a) {\n'
        '    "abc".substring(1, 2, 3);\n} }\n',
    ]),
    ('java', 36, '<identifier> expected —— 什么写法才报这一句', [
        'public class Main { public static void main(String[] a) { int 123 = 5; } }\n',
        'public class Main { public static void main(String[] a) { int = 5; } }\n',
        'public class Main { int 9x = 1; }\n',
    ]),
]

for lang, idx, desc, cands in PROBES:
    rule = LIB[lang][idx - 1]
    print('=' * 72)
    print(f'  {lang} #{idx}  {desc}')
    print(f'  规则: {rule["pattern"]}')
    for j, src in enumerate(cands, 1):
        se, so = run_trigger(lang, src)
        text = se if se.strip() else so
        h = match_error(LIB, lang, text)
        ok = h and h[0]['pattern'] == rule['pattern']
        if ok:
            verdict = '✓ 命中本规则'
        elif h:
            verdict = f'✗ 被抢：{h[0]["title"][:22]}'
        else:
            verdict = '✗ 谁都没命中'
        print(f'\n  [{j}] {verdict}')
        keys = [l for l in text.splitlines()
                if any(w in l for w in ('error', 'stray', 'symbol', 'location'))][:4]
        for l in (keys or [l for l in text.splitlines() if l.strip()][:3]):
            print(f'        | {l[:100]}')
