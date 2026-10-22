# -*- coding: utf-8 -*-
"""针对性补测：给几条「可能是触发器没写好」的规则换几段代码，看是不是真匹配不上。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audit_errorlib import load_lib, match_error, run_trigger, decode_output  # noqa: E402

LIB = load_lib()

# (语言, 规则编号, 说明, 候选代码)
PROBES = [
    ('c', 22, 'invalid operands to binary —— 换成真的把两个不能算的东西相加', [
        'struct S { int x; };\nint main(void) { struct S a, b; a + b; return 0; }\n',
        'int main(void) { int* p; double d; p + d; return 0; }\n',
    ]),
    ('c', 24, 'expected specifier-qualifier-list —— 结构体里写个没有名字没有类型的成员', [
        'struct S { int; };\nint main(void) { return 0; }\n',
        'struct S { *; };\nint main(void) { return 0; }\n',
    ]),
    ('cpp', 3, 'expected \';\' —— C++ 少分号的几种写法', [
        'int main() { int a = 1\nreturn 0; }\n',
        'int main() { int a = 1 int b = 2; return 0; }\n',
        'struct S { int x }\nint main() { return 0; }\n',
        'class C { int x }\nint main() { return 0; }\n',
    ]),
    ('cpp', 17, 'expected unqualified-id —— 全局作用域写了个非法的东西', [
        'int main() { return 0; }\nclass { int x; };\n',
        'int main() { return 0; }\nint = 1;\n',
        'int main() { return 0; }\n;\n',
    ]),
    ('c', 13, 'printf 格式对不上 —— 看 gcc 到底给 error 还是 warning', [
        '#include <stdio.h>\nint main(void) { printf("%d", "x"); return 0; }\n',
        '#include <stdio.h>\nint main(void) { printf("%d %d", 1.0); return 0; }\n',
    ]),
    ('common', 1, 'undefined reference —— 看 MinGW 的引号到底是哪种', [
        'int f(void);\nint main(void) { f(); return 0; }\n',
    ]),
]

for lang, idx, desc, cands in PROBES:
    rule = LIB[lang][idx - 1]
    print('=' * 70)
    print(f'  {lang} #{idx}  {desc}')
    print(f'  规则: {rule["pattern"]}')
    for j, src in enumerate(cands, 1):
        host = 'c' if lang == 'common' else lang
        se, so = run_trigger(host, src)
        text = se if se.strip() else so
        if lang == 'common':
            probes = ['c', 'cpp', 'java', 'python']
            hits = [f'{p}→{match_error(LIB, p, text)[0]["title"][:12]}'
                    for p in probes if match_error(LIB, p, text)]
            verdict = '✓ 命中' if any(
                match_error(LIB, p, text) and
                match_error(LIB, p, text)[0]['pattern'] == rule['pattern'] for p in probes) else '✗'
            print(f'\n  [{j}] {verdict}  {hits}')
        else:
            h = match_error(LIB, lang, text)
            ok = h and h[0]['pattern'] == rule['pattern']
            print(f'\n  [{j}] {"✓ 命中" if ok else "✗"} '
                  f'{("被抢：" + h[0]["title"][:14]) if (h and not ok) else ""}')
        # 只打印带 error/fatal/undefined 的行，省地方
        key = [l for l in text.splitlines()
               if any(w in l for w in ('error', 'undefined', 'fatal', 'collect2'))][:4]
        for l in (key or [l for l in text.splitlines() if l.strip()][:3]):
            print(f'        | {l[:96]}')
