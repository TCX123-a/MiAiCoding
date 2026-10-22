# -*- coding: utf-8 -*-
"""收口脚本（2026-09-14）：把第四轮实测出来的结论写回文件。

做三件事：
  ① triggers.py —— 13 条「触发器写得不对」的换成实测命中的写法；
     补上两条新规则（invalid suffix）的触发用例；丢掉已删规则的孤儿项。
  ② c.json 的 stray 规则文案 —— 实测发现它的解释和真实报错**对不上**：
     gcc 报的是 `stray '\342' in program`，而原文案把它当成「你打的那个字符」来讲。
  ③ 逐条断言，任何一条没命中就整体不写盘。

跑完再用 audit_errorlib.py 复验。
"""
import json
import sys
from pathlib import Path

# 中文 Windows 的控制台默认 GBK，本文件要打印 ✓ ✗ —— 不换编码的话
# 报错信息本身会先崩成 UnicodeEncodeError，把真正的问题盖掉。
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))

from triggers import TRIGGERS  # noqa: E402

LIB_DIR = ROOT / 'content' / 'error-lib'

# ── ① 换触发器 ────────────────────────────────────────────────────────
# 每条都注明「为什么换」和「换成了什么真实报错」，见下面的 WHY。
REPLACE = {
    'c': {
        # 原来写 `int a = 1；`——那报的是 invalid suffix，不是 stray（已单独成规则）
        # 换成全角引号：gcc 报 stray '\342' in program
        "stray '([^']+)' in program":
            'int main(void) { char *s = “abc”; return 0; }\n',
        # 原来写 `int a = 1\nreturn 0;`——gcc 报的是 expected ',' or ';'，被前一条抢走。
        # 换成 `return 0 }`：gcc 只报 expected ';' before '}' token，没有竞争者
        "expected ';' (?:before|after) '?[^']*'?":
            'int main(void) { return 0 }\n',
        # 原来写 `1 + 1.0` + 一个空结构体——实际报的是「结构体大小未知」，跟运算符无关。
        # 换成真的把两个结构体相加：invalid operands to binary + (have 'struct S' and 'struct S')
        'invalid operands to binary':
            'struct S { int x; };\nint main(void) { struct S a, b; return a + b; }\n',
        # 原来写 `struct S { int; }`——gcc 报的是 expected ';', identifier or '(' before 'int'，
        # 落在这条规则的射程之外。换成成员位置写数字：expected specifier-qualifier-list before numeric constant
        'expected specifier-qualifier-list|expected expression':
            'struct S { 1 x; };\nint main(void) { return 0; }\n',
    },
    'cpp': {
        # 原写 `int a = 1\nreturn 0;`——g++ 报 expected ',' or ';'，被前一条抢走。
        # 换成结构体成员少分号：expected ';' at end of member declaration
        "error: expected ';' (?:before|after) '?[^']*'?":
            'struct S { int x }\nint main() { return 0; }\n',
        # 原来往尖括号里塞中文名字——那会先被「was not declared in this scope」抢走。
        # 换成 std::vector<1>：type/value mismatch + template argument 2 is invalid
        'error: template argument 1 is invalid|template argument .* is invalid':
            '#include <vector>\nint main() { std::vector<1> v; return 0; }\n',
    },
    'java': {
        # 原来写「一个方法没关」——javac 会一路报到 EOF，被 reached end of file while parsing 抢走。
        # 换成数组初始化少右花括号：javac 报 '}' expected，且不是 EOF
        "error: '}' expected":
            'public class Main {\n  public static void main(String[] a) {\n'
            '    int[] x = {1, 2;\n    System.out.println(x[0]);\n  }\n}\n',
        # 原写 `f("喵")` 打给 `f(int)`——javac 默认会把这种简化成
        # incompatible types: String cannot be converted to int，被那条抢走。
        # 换成**参数个数**对不上：javac 不简化，报 method f in class Main cannot be applied to given types
        'method ([A-Za-z_$][A-Za-z0-9_$]*) in class ([A-Za-z_$][A-Za-z0-9_$]*) cannot be applied to given types':
            'public class Main {\n  static void f(int a, int b) { }\n'
            '  public static void main(String[] a) { f(1); }\n}\n',
        # 原来写 `"喵".substring("鱼")`——同样被 incompatible types 抢走。
        # 换成 Math.max("a", "b")：no suitable method found for max(String,String)
        'error: no suitable method found for':
            'public class Main { public static void main(String[] a) { Math.max("a", "b"); } }\n',
        # 原来写 `int = 1;`——javac 先报 not a statement，再报 ';' expected，都排在前面。
        # 换成参数漏写名字（从 C 过来最常犯的）：<identifier> expected
        'error: <identifier> expected':
            'public class Main {\n  void f(int) { }\n'
            '  public static void main(String[] a) { }\n}\n',
    },
}

# 新规则的触发用例（_fix_rules.mjs 刚加的两条）
ADD = {
    'c': {
        "invalid suffix '([^']+)' on integer constant":
            '#include <stdio.h>\nint main(void) { int a = 1； return 0; }\n',
        # 这条的 pattern 上一轮补过可选引号（真实输出是 'return'，带引号），
        # 而 triggers.py 的键还是补引号之前的老字符串 —— 键失配就等于没有触发器。
        "'?return'? with a value, in function returning void":
            'void f(void) { return 1; }\nint main(void) { return 0; }\n',
    },
    'cpp': {
        "invalid suffix '([^']+)' on integer constant":
            'int main() { int a = 1； return 0; }\n',
    },
}

# ── ② c.json 的 stray 文案 ───────────────────────────────────────────
STRAY_OLD = ('翻译官喵在一个它完全没想到的地方发现了 `{1}` 这个字符喵。\n\n'
             '九成是**中文输入法没切回来**：`；` `（` `）` `，` `“”` 这些全角标点在电脑眼里和英文的半角符号是'
             '**两种完全不同的字符**，翻译官喵只认英文的那种喵。\n\n'
             '注意报错里给的行号可能指在奇怪的位置，因为翻译官喵是一路读下来才卡住的喵。')

STRAY_NEW = ('翻译官喵读到一个它完全不认识的字符，就在这里卡住了喵。\n\n'
             '`{1}` 看着像天书，其实是**一个中文标点被拆开之后的其中一小块**——中文标点要占好几个字节，'
             '翻译官喵只会一个字节一个字节地报，所以它把 `“` 报成了 `\\342` 这样的数字喵。\n\n'
             '**看到反斜杠后面跟着一串数字，基本可以直接断定：这里有中文标点。**\n\n'
             '九成是**中文输入法没切回来**：`；` `（` `）` `，` `“”` 这些全角标点在电脑眼里和英文的半角符号是'
             '**两种完全不同的字符**，长得像，但翻译官喵只认英文的那种喵。\n\n'
             '行号可能指在奇怪的位置，因为翻译官喵是一路读下来才卡住的，别只盯着它指的那一列喵。')


def main():
    # ── ①' 先把「pattern 改了、键没跟着改」的陈旧键改名 ──
    # 上一轮改了 8 条规则的 pattern（补可选引号、补中文措辞、修引号方向……），
    # triggers.py 里还是改之前的老字符串。键失配 = 等于没写触发器，
    # 而实测台只会报「谁都没命中」，看起来像规则坏了 —— 其实规则是好的。
    # 这里只改名、**不动用例内容**，用例还准不准由随后的实测台复验。
    rename = 0
    for lang, table in {
        'common': {
            "undefined reference to '([^']+)'":
                "undefined reference to [`']([^']+)'",
            'is not recognized as an internal or external command':
                'is not recognized as an internal or external command|不是内部或外部命令',
        },
        'cpp': {
            "error: expected initializer before '([^']+)'":
                "error: expected initializer before '?([^'\\r\\n]+?)'?(?=[\\r\\n]|$)",
            "no member named '([^']+)' in '([^']+)'":
                "'([^']+)'(?: {aka '[^']+'})? has no member named '([^']+)'",
            "error: expected unqualified-id before '([^']+)'":
                "error: expected unqualified-id before '?([^'\\r\\n]+?)'?(?=[\\r\\n]|$)",
        },
        'java': {
            'error: ([A-Za-z_$][A-Za-z0-9_$]*) is already defined':
                'error: (?:[A-Za-z_$][A-Za-z0-9_$]* )?([A-Za-z_$][A-Za-z0-9_$]*) is already defined',
            'error: constructor .* cannot be applied to given types':
                'error: no suitable constructor found for|error: constructor .* cannot be applied to given types',
        },
        'python': {
            "SyntaxError: [(]' was never closed":
                "SyntaxError: '([([{])' was never closed",
        },
    }.items():
        for old_key, new_key in table.items():
            if old_key not in TRIGGERS[lang]:
                raise SystemExit(f'✗ 陈旧键改名：{lang} 里没有 {old_key}')
            if new_key in TRIGGERS[lang]:
                raise SystemExit(f'✗ 陈旧键改名：{lang} 里 {new_key} 已存在')
            TRIGGERS[lang][new_key] = TRIGGERS[lang].pop(old_key)
            rename += 1
    print(f'✓ 陈旧键改名 {rename} 条')

    # ── 换 / 补触发器 ──
    changed = []
    for lang, table in REPLACE.items():
        for key, val in table.items():
            old = TRIGGERS[lang].get(key)
            if old is None:
                raise SystemExit(f'✗ {lang} 里找不到触发器键：{key}')
            if old == val:
                raise SystemExit(f'✗ {lang} 的 {key[:30]} 没变化，白改')
            TRIGGERS[lang][key] = val
            changed.append((lang, key))

    added = []
    for lang, table in ADD.items():
        for key, val in table.items():
            if key in TRIGGERS[lang]:
                raise SystemExit(f'✗ {lang} 的 {key} 已存在')
            TRIGGERS[lang][key] = val
            added.append((lang, key))

    # ── 孤儿键：规则库里已经没有这条 pattern 了 ──
    lib = {p.stem: json.loads(p.read_text('utf-8'))['rules'] for p in sorted(LIB_DIR.glob('*.json'))}
    orphans = []
    for lang, table in TRIGGERS.items():
        live = {r['pattern'] for r in lib.get(lang, [])}
        for key in list(table):
            if key not in live:
                del table[key]
                orphans.append((lang, key))

    # ── 每条规则都要有触发器，否则实测台只能报「没写」 ──
    missing = [(lg, r['pattern']) for lg, rules in lib.items() for r in rules
               if r['pattern'] not in TRIGGERS.get(lg, {})]
    if missing:
        raise SystemExit('✗ 这些规则没有触发器（一次列全，别一条条试）：\n  '
                         + '\n  '.join(f'{lg}: {pat}' for lg, pat in missing))

    # ── 写回 triggers.py ──
    lines = [
        '# -*- coding: utf-8 -*-',
        '"""每条报错规则的触发用例。',
        '',
        '键是规则的 **pattern 字符串**（不是序号）—— 序号会随优先级调整而平移，',
        '一旦平移，实测台就会拿 A 的用例去测 B，而且不报错。详见 retrigger.py 的说明。',
        '',
        '【2026-09-14 大修】13 条「触发器写得不对」的换成实测命中的写法。',
        '每条的旧写法为什么不行，都写在 _fix_round2.py 的 REPLACE 里 —— 那份注释是证据，别删。',
        '"""',
        '',
        'TRIGGERS = {',
    ]
    note = {}
    for lg, key in changed:
        note[(lg, key)] = '  # 2026-09-14 换过'
    for lg, key in added:
        note[(lg, key)] = '  # 2026-09-14 新增'
    for lang, table in TRIGGERS.items():
        lines.append(f'    # ── {lang}（{len(table)} 条）──')
        lines.append(f'    {json.dumps(lang)}: {{')
        for key, val in table.items():
            lines.append(f'        {json.dumps(key, ensure_ascii=False)}:')
            lines.append(f'            {json.dumps(val, ensure_ascii=False)},{note.get((lang, key), "")}')
        lines.append('    },')
    lines.append('}')
    lines.append('')
    (HERE / 'triggers.py').write_text('\n'.join(lines), encoding='utf-8')

    # ── c.json 的 stray 文案 ──
    p = LIB_DIR / 'c.json'
    j = json.loads(p.read_text('utf-8'))
    hit = 0
    for r in j['rules']:
        if r['pattern'] == "stray '([^']+)' in program":
            if r['explain'] != STRAY_OLD:
                raise SystemExit('✗ c.json 的 stray explain 不是预期的原文，先看清楚再改')
            r['explain'] = STRAY_NEW
            hit += 1
    if hit != 1:
        raise SystemExit(f'✗ stray 规则找到 {hit} 条')
    p.write_text(json.dumps(j, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    print(f'✓ 换触发器 {len(changed)} 条，新增 {len(added)} 条，丢掉孤儿 {len(orphans)} 条')
    for lg, k in orphans:
        print(f'    - 孤儿 {lg}: {k}')
    print('✓ c.json 的 stray 解释已按真实报错改写')


if __name__ == '__main__':
    main()
