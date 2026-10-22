#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
错误规则库实测台 —— 逐条验证 content/error-lib/*.json 里的规则能不能匹配上真实报错。

【为什么要它】
规则库是「用户代码跑挂了 → 给一句人话解释」的第一跳，也是绝大多数情况下的唯一一跳。
规则写错只有两种表现，而且**都不会报错**：
    · 永远匹配不上 → 用户看到一串英文天书，静默失效
    · 被前面更笼统的规则抢先 → 用户看到一句对不上号的解释（比天书更糟）
两种都只能靠「真的去报一次那个错」才能发现。

【两条铁律，违反了这个台子测出来的东西就不作数】
  1. 编译/运行参数必须和应用**逐字一致** —— 抄自 src/main/runner/runner.ts 的 planForLang()。
     曾经裸跑 `python emoji.py` 得出「Python 打印 emoji 会崩」的结论，而应用其实带了
     `-X utf8` + `PYTHONUTF8=1`，根本不崩。差一个参数，结论就完全反过来。
  2. 匹配算法必须和应用**逐字一致** —— 抄自 src/shared/error-match.ts 的 matchError()。
     顺序即优先级：[该语言规则] 全部走完 → [common 兜底]；第一条命中就返回。

【JS 正则 vs Python 正则的坑】
Python 的 \\d \\w \\s 默认是 **Unicode 感知**的（\\w 能匹配汉字、\\d 能匹配全角数字），
而 JS 只认 ASCII。所以这里必须加 re.ASCII，否则会测出「规则能匹配」的假阳性。

用法：
    python audit_errorlib.py                # 跑全部 133 条
    python audit_errorlib.py python         # 只跑某一门语言
    python audit_errorlib.py --dump         # 只把每条的真实报错打印出来，不判分
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# 中文 Windows 的控制台默认是 GBK，而本文件要打印 ✓ ⚠ ✗ ⬜ ——
# GBK 里没有 U+2717，于是在**跑到第一条有问题的规则时**才崩，
# 前面的成绩全丢了，看起来像「台子本身坏了」。实际上问题恰恰都在后面。
# 所以强制把 stdout 换成 UTF-8，和台子测的东西无关，只和能看见结果有关。
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except AttributeError:
    pass

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIB_DIR = ROOT / 'content' / 'error-lib'
WORK = ROOT / 'scripts' / '审计' / '_work'

# ── 抄自 runner.ts planForLang()，逐字不改 ────────────────────────────
LANGS = {
    'c': dict(
        src='main.c', artifact='prog.exe',
        compile=['gcc', '-finput-charset=UTF-8', '-fexec-charset=UTF-8',
                 '-Wall', '-o', 'prog.exe', 'main.c'],
        run=['./prog.exe'],
    ),
    'cpp': dict(
        src='main.cpp', artifact='prog.exe',
        compile=['g++', '-finput-charset=UTF-8', '-fexec-charset=UTF-8',
                 '-Wall', '-o', 'prog.exe', 'main.cpp'],
        run=['./prog.exe'],
    ),
    'java': dict(
        src='Main.java', artifact='Main.class',
        compile=['javac', '-J-Duser.language=en', '-J-Duser.country=US',
                 '-encoding', 'UTF-8', 'Main.java'],
        run=['java', '-Duser.language=en', '-Duser.country=US',
             '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', 'Main'],
    ),
    'python': dict(
        src='main.py',
        run=['python', '-X', 'utf8', 'main.py'],
        env={'PYTHONUTF8': '1'},
    ),
}


def decode_output(buf):
    """抄自 runner.ts decodeOutput()：UTF-8（严格）→ GBK（严格）→ latin1，去掉开头 BOM。

    【为什么这里必须一模一样】
    javac 的报错按**系统本地编码**（中文 Windows 上是 GBK）写出来，
    不会因为你在源码里写了 UTF-8 就变。我第一版拿 UTF-8 硬解，
    中文类名全变成 `������`，于是「类名匹配不上」的假结论就出来了 ——
    而这其实是应用的三级回退**本来就处理好了**的情况。
    """
    if not buf:
        return ''
    for enc in ('utf-8', 'gbk'):
        try:
            return buf.decode(enc).removeprefix('﻿')
        except UnicodeDecodeError:
            continue
    return buf.decode('latin1')


# ── 抄自 error-match.ts ──────────────────────────────────────────────
def strip_ansi(s):
    return re.sub(r'\x1b\[[0-9;]*[A-Za-z]', '', s)


def js_flags(spec):
    """JS 的 flags 字符串 → Python 的 flags。re.ASCII 是必须的，理由见文件头。"""
    f = re.ASCII
    if 'i' in (spec or ''):
        f |= re.IGNORECASE
    if 'm' in (spec or ''):
        f |= re.MULTILINE
    if 's' in (spec or ''):
        f |= re.DOTALL
    return f


def compile_rule(rule):
    try:
        return re.compile(rule['pattern'], js_flags(rule.get('flags')))
    except re.error:
        return None


def match_error(lib, lang, output):
    """完全复刻 matchError()：[lang] 全部 → [common] 兜底，第一条命中就返回。"""
    if not lib or not output:
        return None
    text = strip_ansi(output)
    for rules in (lib.get(lang, []), lib.get('common', [])):
        for rule in rules:
            rx = compile_rule(rule)
            if rx is None:
                continue
            m = rx.search(text)
            if m:
                return rule, m
    return None


# ── 跑一段代码 ───────────────────────────────────────────────────────
def run_trigger(lang, source):
    """按应用的真实参数编译运行，返回 (stderr, stdout)。"""
    cfg = LANGS[lang]
    d = Path(tempfile.mkdtemp(dir=str(WORK)))
    try:
        (d / cfg['src']).write_text(source, encoding='utf-8')
        # 只加应用自己加的那几个环境变量。**绝不额外设 PYTHONIOENCODING** ——
        # 应用没设它（只设了 PYTHONUTF8=1），我要是顺手加上，就等于把
        # 「应用到底有没有编码问题」这件事给掩盖掉了，测出来的东西不作数。
        env = dict(os.environ)
        env.pop('PYTHONIOENCODING', None)
        env.update(cfg.get('env') or {})

        compile_err = ''
        if cfg.get('compile'):
            c = subprocess.run(cfg['compile'], cwd=d, env=env, capture_output=True, timeout=90)
            # 编译产物按语言不同：C/C++ 是 prog.exe，Java 是 Main.class。
            # 这里曾经写死 prog.exe，结果 Java 编译成功后也被当成「编译失败」直接返回，
            # 七条 Java 运行时异常的规则全被误判成「谁都没命中」。
            if not (d / cfg['artifact']).exists():
                return (decode_output(c.stderr), decode_output(c.stdout))

        cmd = list(cfg['run'])
        if cmd[0] == './prog.exe':
            cmd[0] = str(d / 'prog.exe')   # Windows 下 './x' 传给 CreateProcess 会找不到文件
        p = subprocess.run(cmd, cwd=d, env=env, capture_output=True, timeout=60)
        return (decode_output(p.stderr), decode_output(p.stdout))
    except subprocess.TimeoutExpired:
        return ('', '')
    except FileNotFoundError as e:
        return (f'（跑不起来：{e}）', '')
    finally:
        shutil.rmtree(d, ignore_errors=True)


def explainable_text(stderr, stdout):
    """抄自 run-result-view.ts:127 —— stderr 有内容就用 stderr，否则用 stdout。"""
    return stderr if stderr.strip() else stdout


def load_lib():
    lib = {}
    for p in sorted(LIB_DIR.glob('*.json')):
        lib[p.stem] = json.loads(p.read_text('utf-8'))['rules']
    return lib


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dump = '--dump' in sys.argv
    only = args[0] if args else None

    lib = load_lib()
    from triggers import TRIGGERS
    from known_dormant import KNOWN_DORMANT

    WORK.mkdir(parents=True, exist_ok=True)

    tally = dict(ok=0, shadow=0, miss=0, dead=0, dormant=0, flaky=0)
    problems = []

    for lang in ('common', 'c', 'cpp', 'java', 'python'):
        if only and lang != only:
            continue
        rules = lib[lang]
        trigs = TRIGGERS.get(lang, {})
        print(f'\n═══ {lang} —— {len(rules)} 条 ═══')

        for i, rule in enumerate(rules, 1):            # 键是 pattern 字符串，不是序号 —— 序号会随优先级调整平移，
            # 平移之后按序号取触发器会「拿 A 的用例测 B」而且不报错。见 retrigger.py。
            # 已知够不着的规则（原因必须写在 known_dormant.py 里）单独计一栏，不算失败也不算命中。
            # 绝不静默跳过 —— 静默跳过等于把问题藏起来，比红着还糟。
            dormant = KNOWN_DORMANT.get((lang, rule['pattern']))
            if dormant:
                print(f'  {i:>2}. ⬜ 已知够不着（理由见 known_dormant.py）  {rule["title"][:28]}')
                tally['dormant'] += 1
                continue

            src = trigs.get(rule['pattern'])
            if src is None:
                print(f'  {i:>2}. ⬜ 没写触发器  {rule["pattern"][:50]}')
                tally['dead'] += 1
                problems.append((lang, i, 'no-trigger', rule, ''))
                continue

            # common 是兜底库 —— 它不专属任何语言，所以触发器用 C 跑，
            # 但要在**四个语言下各测一次**：只有某个语言赢了才算这条规则可用。
            host = 'c' if lang == 'common' else lang
            stderr, stdout = run_trigger(host, src)
            text = explainable_text(stderr, stdout)

            # 【空输出要重试，别忙着判「谁都没命中」】
            # 实测踩过：C 的 system("不存在的命令") 用例，在整套跑的时候偶尔一个字都没接到，
            # 于是这条规则被判成 never-wins —— 而单独重跑 12 次全都正常。
            # 那种「偶发的空」是台子自己的抖动（cmd.exe 这个孙子进程写管道的时机），
            # 不是规则的问题。**不重试就会把台子的抖动记成规则有病**，
            # 而「规则有病」是会让人去改一条本来正确的规则的。
            # 只对空输出重试：有输出就说明这次真的跑起来了。
            for _ in range(2):
                if text.strip():
                    break
                stderr, stdout = run_trigger(host, src)
                text = explainable_text(stderr, stdout)
            if not text.strip():
                print(f'  {i:>2}. ⚠ 触发器跑了 3 次都没输出，跳过判分  {rule["pattern"][:40]}')
                tally['flaky'] += 1
                continue

            if dump:
                print(f'\n--- {lang} #{i}  {rule["pattern"]}')
                print(text[:800] or '(没有任何输出)')
                continue

            if lang == 'common':
                won_by = {}
                for probe in ('c', 'cpp', 'java', 'python'):
                    h = match_error(lib, probe, text)
                    won_by[probe] = h[0]['pattern'] if h else None
                mine = [k for k, v in won_by.items() if v == rule['pattern']]
                if mine:
                    print(f'  {i:>2}. ✓ 在 {"、".join(mine)} 下胜出  {rule["title"][:30]}')
                    tally['ok'] += 1
                else:
                    who = {k: v for k, v in won_by.items() if v}
                    print(f'  {i:>2}. ✗ 四个语言下都没赢  {rule["pattern"][:40]}')
                    if who:
                        print(f'       实际被谁拦下：{who}')
                    tally['miss'] += 1
                    problems.append((lang, i, 'never-wins', rule, text))
                continue

            hit = match_error(lib, lang, text)
            if hit is None:
                print(f'  {i:>2}. ✗ 谁都没命中  {rule["pattern"][:50]}')
                tally['miss'] += 1
                problems.append((lang, i, 'no-match', rule, text))
            elif hit[0]['pattern'] == rule['pattern']:
                print(f'  {i:>2}. ✓ {hit[0]["title"][:44]}')
                tally['ok'] += 1
            else:
                print(f'  {i:>2}. ⚠ 被抢：本意「{rule["title"][:20]}」'
                      f' → 实际命中「{hit[0]["title"][:24]}」')
                tally['shadow'] += 1
                problems.append((lang, i, 'shadowed', rule, text, hit[0]))

    if dump:
        return 0

    print(f'\n{"═" * 60}')
    print(f'  ✓ 自己命中   {tally["ok"]:>3}')
    print(f'  ⚠ 被别的抢   {tally["shadow"]:>3}')
    print(f'  ✗ 谁都没命中 {tally["miss"]:>3}')
    print(f'  ⬜ 没触发器   {tally["dead"]:>3}')
    print(f'  ⬜ 已知够不着 {tally["dormant"]:>3}  ← 理由在 known_dormant.py，不算问题但也不静默跳过')
    if tally['flaky']:
        print(f'  ⚠ 台子抖动跳过的 {tally["flaky"]:>3}  ← 触发器重试 3 次仍无输出，不是规则的问题，单独列出来别混进成绩')

    out = ROOT / 'scripts' / '审计' / '_errorlib_problems.json'
    out.write_text(json.dumps([
        dict(lang=p[0], index=p[1], kind=p[2], pattern=p[3]['pattern'],
             title=p[3]['title'],
             shadowed_by=(p[5]['pattern'] if len(p) > 5 else None),
             sample=p[4][:1500])
        for p in problems
    ], ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'  有问题的 {len(problems)} 条明细 → {out.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
