#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 triggers.py 的键从「规则序号」换成「pattern 字符串」。

【为什么要换】序号是**会变的**：2026-09-14 修 Java 的「少引号报成少括号」时把
unclosed string/character literal 往前挪了两格，后面 9 条的序号全平移了。
实测台按序号取触发器，于是「测第 10 条」其实喂了第 12 条的用例 ——
而它**不会报错**，只会安静地测出错误结论。这正是这个台子本身要防的那类 bug。

pattern 字符串是规则的**身份**，不会因为调整优先级而变，所以拿它当键。
"""

import io
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIB_DIR = ROOT / 'content' / 'error-lib'
TRIGGERS = HERE / 'triggers.py'

# Java 那次重排：旧序号 → 新序号（其余原样）。旧 7=eof 挪到 9，旧 14/15 挪到 7/8。
JAVA_OLD2NEW = {7: 9, 8: 10, 9: 11, 10: 12, 11: 13, 12: 14, 13: 15, 14: 7, 15: 8}


def load_rules(lang):
    return json.loads((LIB_DIR / f'{lang}.json').read_text('utf-8'))['rules']


def main():
    src = TRIGGERS.read_text('utf-8')
    ns = {}
    exec(compile(src, str(TRIGGERS), 'exec'), ns)
    old = ns['TRIGGERS']

    lines = [
        '# -*- coding: utf-8 -*-',
        '"""每条报错规则的触发用例。',
        '',
        '键是规则的 **pattern 字符串**（不是序号）—— 序号会随优先级调整而平移，',
        '一旦平移，实测台就会拿 A 的用例去测 B，而且不报错。详见 retrigger.py 的说明。',
        '',
        '本文件由 scripts/审计/retrigger.py 从「按序号」的老版本一次性转换而来。',
        '"""',
        '',
        'TRIGGERS = {',
    ]
    total = 0
    for lang in ('common', 'c', 'cpp', 'java', 'python'):
        rules = load_rules(lang)
        by_index = old.get(lang, {})
        lines.append(f'    # ── {lang}（{len(rules)} 条）──')
        lines.append(f'    {lang!r}: {{'.replace("'", "'"))
        for idx in sorted(by_index):
            new_idx = JAVA_OLD2NEW.get(idx, idx) if lang == 'java' else idx
            pattern = rules[new_idx - 1]['pattern']
            lines.append(f'        {pattern!r}:')
            lines.append(f'            {by_index[idx]!r},')
            total += 1
        lines.append('    },')
    lines.append('}')
    lines.append('')

    TRIGGERS.write_text('\n'.join(lines), encoding='utf-8')
    print(f'已转换 {total} 条触发器，键改为 pattern 字符串')


if __name__ == '__main__':
    main()
