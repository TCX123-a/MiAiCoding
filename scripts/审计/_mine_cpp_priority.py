# -*- coding: utf-8 -*-
"""
独立复核：cpp 错误库新插的第 2 条（cv-qualifier）到底是不是**真的需要插在最前面**。

【为什么另写一个】
写手（aa3d493effe196991）自己承认「审计台证明不了这条插入」，并附了它自己的
`_check_cpp_priority.py`。**拿作者的脚本验作者的结论不算独立**，所以这里换一条路：
  · stderr 不是我抄的，是我自己用**应用的真实参数**在 `<workspace>\\_cpp-pri-probe` 编出来的；
  · 匹配器不自己写，直接用审计台的 `match_error()`（它是 `src/shared/error-match.ts` 的抄本）；
  · 除了「谁胜出」，还跑一个**反事实**：把新规则从库里摘掉，看会不会换成别人赢
    —— 这才证明「插在最前面」是必要的，而不是写手的猜测。
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import audit_errorlib as A  # noqa: E402

STDERR = Path(r'<workspace>\_cpp-pri-probe\stderr.txt').read_text('utf-8')

print('=== 被测 stderr（我自己编出来的原话）===')
for line in STDERR.splitlines():
    if 'error:' in line:
        print('   ' + line)
print()

lib = A.load_lib()
print('cpp 规则条数：', len(lib['cpp']))

hit = A.match_error(lib, 'cpp', STDERR)
print()
print('=== 现状：谁胜出 ===')
if hit:
    rule, m = hit
    print('  标题：', rule['title'])
    print('  命中位置：', m.start(), '→', repr(m.group(0)[:80]))
else:
    print('  谁都没命中')

# ── 反事实：把新规则摘掉 ───────────────────────────────────────────
NEW = "non-member function '([^']+)' cannot have cv-qualifier"
idx = [i for i, r in enumerate(lib['cpp']) if r['pattern'] == NEW]
print()
print('=== 反事实：把 cv-qualifier 那条摘掉再看谁胜出 ===')
if not idx:
    print('  库里找不到这条 pattern —— 无从判起')
else:
    print('  它在库里的位置：第', idx[0] + 1, '条')
    trimmed = dict(lib)
    trimmed['cpp'] = [r for r in lib['cpp'] if r['pattern'] != NEW]
    hit2 = A.match_error(trimmed, 'cpp', STDERR)
    if hit2:
        print('  摘掉之后胜出的是：', hit2[0]['title'])
        print('  （这就是写手说的「会被抢」—— 如果它和本意那条不同，插入就是必要的）')
    else:
        print('  摘掉之后谁都没命中')
