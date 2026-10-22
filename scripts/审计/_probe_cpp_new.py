# -*- coding: utf-8 -*-
"""给 cpp.json 补规则用的候选探针 —— 拿真 g++ 的真实 stderr 说话。

【为什么它 import audit_errorlib 而不是自己写一份编译参数】
实测台的两条铁律第一条就是「参数必须和应用逐字一致」。
只要我把 g++ 参数在这里重抄一遍，两边就**迟早会漂**（改了一处忘了另一处）。
直接调 run_trigger()，参数就只有一个真源：audit_errorlib.LANGS。

用法（一律走 verilock，别裸跑）：
    node scripts/verilock.mjs shell <标签> "python \"scripts/审计/_probe_cpp_new.py\""
"""

import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

from audit_errorlib import run_trigger

# (候选名, 这个坑在课本里对应什么, 出错代码)
CANDIDATES = [
    ('A-missing-close-paren',
     'if 的条件括号忘了收尾',
     '#include <iostream>\n'
     'int main() {\n'
     '    int x = 1;\n'
     '    if (x > 0 {\n'
     '        std::cout << "喵" << std::endl;\n'
     '    }\n'
     '    return 0;\n'
     '}\n'),

    ('B-extra-close-brace',
     '多打了一个右花括号',
     '#include <iostream>\n'
     'int main() {\n'
     '    std::cout << "喵" << std::endl;\n'
     '    return 0;\n'
     '}\n'
     '}\n'),

    ('C-ref-bind-rvalue',
     '给普通引用绑了个临时的数字',
     'int main() {\n'
     '    int& r = 5;\n'
     '    return 0;\n'
     '}\n'),

    ('D-increment-rvalue',
     '对一个算式做 ++',
     'int main() {\n'
     '    int a = 1;\n'
     '    (a + 1)++;\n'
     '    return 0;\n'
     '}\n'),

    ('E-redefinition',
     '同一个名字定义了两遍',
     'int x = 1;\n'
     'int x = 2;\n'
     'int main() {\n'
     '    return 0;\n'
     '}\n'),

    ('F-private-member',
     '从外面碰了私有的成员',
     'class Cat {\n'
     '    int secret;\n'
     '};\n'
     'int main() {\n'
     '    Cat c;\n'
     '    c.secret = 1;\n'
     '    return 0;\n'
     '}\n'),

    ('G-const-this',
     'const 对象调用了会改自己的招式',
     'class Cat {\n'
     'public:\n'
     '    void meow() { }\n'
     '};\n'
     'int main() {\n'
     '    const Cat c;\n'
     '    c.meow();\n'
     '    return 0;\n'
     '}\n'),

    ('H-too-many-args',
     '招式只收一个，给了两个',
     'void feed(int a) { }\n'
     'int main() {\n'
     '    feed(1, 2);\n'
     '    return 0;\n'
     '}\n'),

    ('I-abstract-type',
     '拿抽象图纸直接造猫',
     'class Animal {\n'
     'public:\n'
     '    virtual void speak() = 0;\n'
     '};\n'
     'int main() {\n'
     '    Animal a;\n'
     '    return 0;\n'
     '}\n'),

    ('J-array-init',
     '一排猫粮碗想用一个数字初始化',
     'int main() {\n'
     '    int a[3] = 0;\n'
     '    return 0;\n'
     '}\n'),

    ('K-member-of-nonclass',
     '对普通整数用了点号取成员',
     'int main() {\n'
     '    int a = 1;\n'
     '    a.x = 2;\n'
     '    return 0;\n'
     '}\n'),

    ('L-expected-comma-or-semi',
     '上一行末尾少了分号',
     '#include <iostream>\n'
     'int main() {\n'
     '    int a = 1\n'
     '    std::cout << a << std::endl;\n'
     '    return 0;\n'
     '}\n'),

    ('M-invalid-operands-plus',
     '两个字符串字面量想用加号拼起来',
     '#include <iostream>\n'
     'int main() {\n'
     '    std::cout << "你好" + "喵" << std::endl;\n'
     '    return 0;\n'
     '}\n'),

    ('N-semi-after-class',
     '类定义收尾忘了分号（对照：看看会不会被「少分号」抢走）',
     'class Cat {\n'
     'public:\n'
     '    int a;\n'
     '}\n'
     'int main() {\n'
     '    return 0;\n'
     '}\n'),

    ('O-ctor-return-type',
     '出生招式头上写了 void（stage2 第 02 课的演示）',
     '#include <string>\n'
     'class Cat {\n'
     'public:\n'
     '    std::string name;\n'
     '    void Cat(std::string n) { name = n; }\n'
     '};\n'
     'int main() {\n'
     '    Cat c1("小橘");\n'
     '    return 0;\n'
     '}\n'),

    ('Q-lesson03-exact',
     'stage2 第 03 课那段演示的**原文**（招式肚子里真的用了 name/fish）',
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
     '}\n'),

    ('P-cv-qualifier-nonmember',
     '招式肚子写在图纸外面，忘了 Cat:: 却留着 const（stage2 第 03 课的演示）',
     'class Cat {\n'
     'public:\n'
     '    void show() const;\n'
     '};\n'
     'void show() const { }\n'
     'int main() {\n'
     '    return 0;\n'
     '}\n'),
]

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for name, why, src in CANDIDATES:
        if only and only not in name:
            continue
        stderr, stdout = run_trigger('cpp', src)
        print('=' * 72)
        print(f'### {name}  —— {why}')
        print(f'--- 源码 ---\n{src}')
        print(f'--- stderr ---\n{stderr}')
        if stdout.strip():
            print(f'--- stdout ---\n{stdout}')
