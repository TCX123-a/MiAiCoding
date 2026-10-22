# -*- coding: utf-8 -*-
"""实测 cpp.json 里那条「故意靠前」的规则在**真实场景**里有没有被抢。

【为什么审计台证明不了这件事】
实测台一条规则只喂**一个最小用例**。而 cv-qualifier 这条规则所在的真实报错，
后面**必定**跟着两句「name/fish 没见过」（因为招式肚子里真的用了那些名字）——
最小用例（空肚子）不会产生那两句，于是实测台全绿也说明不了问题。

这个脚本补的就是这一段：喂 **stage2 第 03 课的原文原型**（招式肚子里用了 name/fish），
看 matchError() 第一条命中的到底是哪条规则。若命中的是「was not declared」那条，
说明这条规则白写了 —— 用户会看到「头文件没 include」这种指错方向的解释。

用法（走 verilock，别裸跑）：
    node scripts/verilock.mjs shell <标签> "python \"scripts/审计/_check_cpp_priority.py\""
"""

import json
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

from audit_errorlib import LIB_DIR, explainable_text, match_error, run_trigger

# stage2 第 03 课「漏了 Cat::」那段演示的**原文**（一字未改）
LESSON03 = (
    '#include <iostream>\n'
    '#include <string>\n'
    'using namespace std;\n'
    '\n'
    'class Cat {\n'
    'public:\n'
    '    string name;\n'
    '    int fish;\n'
    '\n'
    '    Cat(string n, int f) : name(n), fish(f) {}\n'
    '    void show() const;\n'
    '};\n'
    '\n'
    'void show() const {\n'
    '    cout << name << " 有 " << fish << " 条" << endl;\n'
    '}\n'
    '\n'
    'int main() {\n'
    '    Cat c1("小橘", 3);\n'
    '    c1.show();\n'
    '    return 0;\n'
    '}\n'
)

WANT = 'cannot have cv-qualifier'


def main():
    lib = {p.stem: json.loads(p.read_text('utf-8'))['rules'] for p in sorted(LIB_DIR.glob('*.json'))}
    stderr, stdout = run_trigger('cpp', LESSON03)
    text = explainable_text(stderr, stdout)
    print('--- 真编译器原话（stderr 优先）---')
    print(text or '（没有任何输出）')
    # 先在库里把「本意那条」找出来 —— 找不到就直接说找不到。
    # ⚠️ 这里踩过一次：早先的版本是拿 hit[0] 的 pattern 去判断身份，
    # 结果我把 pattern 故意改坏一个字符（cv-qualifier → cv-qualifie）做反向验证时，
    # 那条规则**作为子串仍然匹配得上**、照样胜出，而身份判定认不出来，
    # 于是脚本喊「被抢了」—— **假红**。假红比不报还坏：它会让人去改一条本来正确的规则。
    intended = [r for r in lib.get('cpp', []) if WANT in r['pattern']]
    if not intended:
        print(f'⚠ 库里找不到 pattern 含「{WANT}」的规则 —— 它被改坏了或删了，本脚本无从判起')
        return 1

    hit = match_error(lib, 'cpp', text)
    if hit is None:
        print('✗ 谁都没命中 —— 学生看到的会是通用兜底话术')
        return 1
    rule = hit[0]
    if rule is intended[0]:
        print(f'✓ 胜出的是本意那条：{rule["title"]}')
        return 0
    print(f'✗ 被抢了！本意「不能自称只读」，实际命中「{rule["title"]}」')
    print(f'   抢走它的 pattern：{rule["pattern"]}')
    return 1


if __name__ == '__main__':
    sys.exit(main())
