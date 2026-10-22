# -*- coding: utf-8 -*-
"""收口脚本 3（2026-09-14）：修第五轮实测暴露出来的三处。

① **我上一步加的新规则抢错了人**（自查出来的回归）：
   `int 1a = 1;` 会同时报 invalid suffix 'a' 和 expected identifier or '('，
   而 invalid suffix 排在前面 —— 用户看到「数字后面跟了个中文标点喵」，
   他的 a 是英文的，照着改永远改不对。
   修法：把捕获组限制成**非 ASCII**（[^\\x00-\\x7F]+）。
   这条规则本来就是给中文标点用的，只认非 ASCII 才和它的本意一致。

② **C++ 对同一个错误根本不那么说**：C 报 `invalid suffix '；'`（直接把中文标点打出来），
   C++ 报 `unable to find numeric literal operator 'operator""\\U0000ff1b'`（写成编号）。
   原来那条 cpp 规则是从 C 抄的，在 g++ 上永不命中 —— 得单独写。

③ cpp 的 `expected unqualified-id before X` 只在「后面直接跟行尾」时才命中，
   gcc 更常见的写法是 `before '=' token`（带引号 + 一个 token 后缀），被漏掉了。
"""
import json
import sys
from pathlib import Path

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

C_NEW_PAT = "invalid suffix '([^\\x00-\\x7F]+)' on integer constant"
CPP_NEW_PAT = "unable to find numeric literal operator 'operator\"\"([^']+)'"
CPP_UQ_NEW_PAT = "error: expected unqualified-id before '?([^'\\r\\n]+?)'?(?: token)?(?=[\\r\\n]|$)"

CPP_SUFFIX = {
    'pattern': CPP_NEW_PAT,
    'title': '数字后面跟了个中文标点喵',
    'explain': (
        '翻译官喵读到一串数字，本来以为读完了，结果后面紧跟着一个它不认识的东西，'
        '只好把它当成数字的一部分接着往下读，越读越不对喵。\n\n'
        '报错里那串 `{1}` 看着像天书，其实**就是那个中文标点本身**——'
        'C++ 不认得它，就把它写成了 `\\U0000ff1b` 这样的编号喵。\n\n'
        '**看到 `\\U0000` 后面跟着一串数字和字母，基本可以直接断定：这是中文标点。**\n\n'
        '九成是**中文输入法没切回来**：`；` `，` `：` `）` 这些全角标点在电脑眼里和英文的半角符号是'
        '**两种完全不同的字符**，长得像，但翻译官喵只认英文的那种喵。'
    ),
    'fixHint': '把这一行的 `{1}` 删掉，换成英文输入法重新打一个半角符号喵',
    'note': 'C++ 和 C 对同一个错误**说法不同**：C 报 invalid suffix \'\uff1b\'（把中文标点原样打出来），'
            'C++ 报 unable to find numeric literal operator \'operator""\\U0000ff1b\'（写成编号）。'
            '这条规则原来是从 c.json 抄过来的，在 g++ 上永远不会命中。'
            '2026-09-14 用本机 g++ 16.1.0 实测改写。'
}


def main():
    # ── ① c.json：捕获组限制成非 ASCII ──
    p = LIB_DIR / 'c.json'
    j = json.loads(p.read_text('utf-8'))
    hit = 0
    for r in j['rules']:
        if r['pattern'] == "invalid suffix '([^']+)' on integer constant":
            r['pattern'] = C_NEW_PAT
            r['note'] = (r['note'].replace(
                '2026-09-14 用本机 gcc/g++ 16.1.0 实测。',
                '2026-09-14 用本机 gcc/g++ 16.1.0 实测。'
                '捕获组限定为非 ASCII（[^\\x00-\\x7F]+）：`int 1a = 1;` 也会报 invalid suffix \'a\'，'
                '那不是中文标点，得让它落回 expected identifier 那条（否则用户会照着改一个英文的 a）。'))
            hit += 1
    assert hit == 1, f'c.json 里 invalid suffix 找到 {hit} 条'
    p.write_text(json.dumps(j, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    # ── ② cpp.json：整条换成 C++ 的说法 + ③ 放宽 unqualified-id ──
    p = LIB_DIR / 'cpp.json'
    j = json.loads(p.read_text('utf-8'))
    idx = [n for n, r in enumerate(j['rules']) if r['pattern'].startswith("invalid suffix '")]
    assert len(idx) == 1, f'cpp.json 里 invalid suffix 找到 {len(idx)} 条'
    j['rules'][idx[0]] = CPP_SUFFIX
    uq = [n for n, r in enumerate(j['rules'])
          if r['pattern'].startswith('error: expected unqualified-id before')]
    assert len(uq) == 1, f'cpp.json 里 unqualified-id 找到 {len(uq)} 条'
    j['rules'][uq[0]]['pattern'] = CPP_UQ_NEW_PAT
    p.write_text(json.dumps(j, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    # ── 触发器跟着改 key（改 pattern 就必须改 key，否则等于没写触发器）──
    def move(lang, old, new, val=None):
        if old not in TRIGGERS[lang]:
            raise SystemExit(f'✗ {lang} 里没有触发器键 {old}')
        TRIGGERS[lang][new] = val if val is not None else TRIGGERS[lang].pop(old)
        if val is not None:
            del TRIGGERS[lang][old]

    move('c', "invalid suffix '([^']+)' on integer constant", C_NEW_PAT,
         '#include <stdio.h>\nint main(void) { int a = 1； return 0; }\n')
    move('cpp', "invalid suffix '([^']+)' on integer constant", CPP_NEW_PAT,
         'int main() { int a = 1； return 0; }\n')
    move('cpp',
         "error: expected unqualified-id before '?([^'\\r\\n]+?)'?(?=[\\r\\n]|$)",
         CPP_UQ_NEW_PAT,
         'int = 1;\nint main() { return 0; }\n')   # g++ 报 expected unqualified-id before '=' token

    # ── 每条规则都要有触发器 ──
    lib = {q.stem: json.loads(q.read_text('utf-8'))['rules'] for q in sorted(LIB_DIR.glob('*.json'))}
    missing = [(lg, r['pattern']) for lg, rules in lib.items() for r in rules
               if r['pattern'] not in TRIGGERS.get(lg, {})]
    if missing:
        raise SystemExit('✗ 缺触发器：\n  ' + '\n  '.join(f'{lg}: {x}' for lg, x in missing))
    orphans = [(lg, k) for lg, t in TRIGGERS.items() for k in t if k not in {r['pattern'] for r in lib.get(lg, [])}]
    if orphans:
        raise SystemExit(f'✗ 有孤儿触发器（规则已经不在了）：{orphans}')

    # ── 写回 triggers.py ──
    lines = ['# -*- coding: utf-8 -*-',
             '"""每条报错规则的触发用例。',
             '',
             '键是规则的 **pattern 字符串**（不是序号）—— 序号会随优先级调整而平移，',
             '一旦平移，实测台就会拿 A 的用例去测 B，而且不报错。详见 retrigger.py 的说明。',
             '',
             '【2026-09-14 大修】13 条「触发器写得不对」的换成实测命中的写法。',
             '每条的旧写法为什么不行，都写在 _fix_round2.py 的 REPLACE 里 —— 那份注释是证据，别删。',
             '"""',
             '',
             'TRIGGERS = {']
    for lang, table in TRIGGERS.items():
        lines.append(f'    # ── {lang}（{len(table)} 条）──')
        lines.append(f'    {json.dumps(lang)}: {{')
        for key, val in table.items():
            lines.append(f'        {json.dumps(key, ensure_ascii=False)}:')
            lines.append(f'            {json.dumps(val, ensure_ascii=False)},')
        lines.append('    },')
    lines.append('}')
    lines.append('')
    (HERE / 'triggers.py').write_text('\n'.join(lines), encoding='utf-8')

    print(f'✓ c.json：invalid suffix 限定为非 ASCII（{C_NEW_PAT}）')
    print(f'✓ cpp.json：invalid suffix → C++ 专属说法（{CPP_NEW_PAT}）')
    print(f'✓ cpp.json：expected unqualified-id 放宽到能收 `before \'=\' token`')
    print('✓ triggers.py 已同步（3 个 key 改名 + 用例更新）')


if __name__ == '__main__':
    main()
