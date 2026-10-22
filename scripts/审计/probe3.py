# -*- coding: utf-8 -*-
"""第三轮：把「疑似写错了的规则」和「真实写法下没人管的报错」一次钉死。

每条规则都要过两关：
  ① 换 2~3 种真实写法，能不能命中这条规则本身
  ② 命不中时，**有没有别的规则接住**（接住了 = 用户还是能看懂；没接住 = 纯英文天书）
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_errorlib import load_lib, match_error, run_trigger  # noqa: E402

LIB = load_lib()

PROBES = [
    ('c', 3, 'expected \';\' before/after —— 到底还有没有够得着的写法', [
        '#include <stdio.h>\nint main(void) { for (int i = 0 i < 3; i++) printf("%d", i); return 0; }\n',
        'struct S { int x };\nint main(void) { return 0; }\n',
    ]),
    ('c', 13, "printf 格式对不上 —— 少给参数会不会变成 error", [
        '#include <stdio.h>\nint main(void) { printf("%d\\n"); return 0; }\n',
        '#include <stdio.h>\nint main(void) { printf("%d %d\\n", 1); return 0; }\n',
        '#include <stdio.h>\nint main(void) { printf("%d", "x"); return 0; }\n',
    ]),
    ('c', 19, "return with a value —— 真实报错里 return 带引号", [
        'void f(void) { return 1; }\nint main(void) { f(); return 0; }\n',
    ]),
    ('cpp', 3, 'C++ 少分号 —— 函数体里少分号到底谁接住', [
        'int main() { int a = 1\nreturn 0; }\n',
        'int main() { int a = 1\nint b = 2;\nreturn 0; }\n',
        'struct S { int x }\nint main() { return 0; }\n',
    ]),
    ('cpp', 7, 'expected initializer before —— GCC 的真实措辞', [
        'int main() { int a b; return 0; }\n',
        'int a b;\nint main() { return 0; }\n',
        'struct S { int x; };\nS s s2;\n',
    ]),
    ('cpp', 8, 'no member named / has no member named —— Clang 还是 GCC 的措辞', [
        'struct S { int a; };\nint main() { S s; s.b = 1; return 0; }\n',
        '#include <string>\nint main() { std::string s; s.喵(); return 0; }\n',
    ]),
    ('cpp', 22, 'vector<int,int> —— 看一眼真实输出到底长什么样', [
        '#include <vector>\nint main() { std::vector<int, int> v; return 0; }\n',
    ]),
    ('java', 24, 'is already defined —— javac 的真实措辞', [
        'public class Main { public static void main(String[] a) {\n'
        '    int x = 1; int x = 2;\n} }\n',
    ]),
    ('java', 27, 'new 参数对不上 —— javac 的真实措辞', [
        'public class Main { public static void main(String[] a) {\n'
        '    String s = new String(1, 2, 3);\n} }\n',
    ]),
    ('java', 10, "'}' expected —— 换成多打一个右括号试试", [
        'public class Main { public static void main(String[] a) { int x = 1; } } }\n',
    ]),
    ('python', 10, 'unclosed paren —— Python 3.12 的真实措辞', [
        'print((1 + 2\n',
        'a = [1, 2, 3\nprint(a)\n',
        'print("喵"\n',
    ]),
    ('python', 39, 'NameError 兜底 —— 还有没有别的 NameError 变体', [
        'def f():\n    print(x)\n    x = 1\nf()\n',
        'print(undefined_name)\n',
    ]),
]

for lang, idx, desc, cands in PROBES:
    rule = LIB[lang][idx - 1]
    print('=' * 74)
    print(f'  {lang} #{idx}  {desc}')
    print(f'  规则: {rule["pattern"]}')
    for j, src in enumerate(cands, 1):
        se, so = run_trigger(lang, src)
        text = se if se.strip() else so
        h = match_error(LIB, lang, text)
        if h and h[0]['pattern'] == rule['pattern']:
            verdict = '✓ 命中本规则'
        elif h:
            verdict = f'✗ 本规则够不着 → 被「{h[0]["title"][:22]}」接住'
        else:
            verdict = '✗ 本规则够不着 → 没有任何规则接住'
        print(f'\n  [{j}] {verdict}')
        keys = [l for l in text.splitlines()
                if any(w in l for w in ('rror', 'arning', 'SyntaxError', 'NameError'))][:3]
        for l in (keys or [l for l in text.splitlines() if l.strip()][:3]):
            print(f'        | {l[:104]}')
