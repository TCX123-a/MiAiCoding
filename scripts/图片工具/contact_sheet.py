#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拼对比图 —— 把一个文件夹里的图拼成一张大图，方便一次看完再挑选。

用法（推荐）：把文件夹拖到「拼对比图.bat」上
或者命令行：python contact_sheet.py "D:\\某个文件夹" [再来一个文件夹...]

拼出来的图叫「<文件夹名>_对比图_01.jpg」，就放在那个文件夹里，拼完自动弹出来。
每张图左上角有个编号，你挑的时候报编号就行。
"""

import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print()
    print("  缺 Pillow 这个库，装一下就行：")
    print("      python -m pip install pillow")
    print()
    sys.exit(1)

# ── 认哪些格式 ──────────────────────────────────────────────
EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}

# ── 版面尺寸（想调大小改这几个数就行）──────────────────────
CARD = 300        # 每张缩略图的方框边长
PAD = 16          # 格子之间的间距
LABEL_H = 32      # 文件名那一行的高度
TITLE_H = 56      # 顶部标题栏高度
MAX_PER_SHEET = 48  # 一张对比图最多放几张，超了就自动分页

# ── 颜色 ────────────────────────────────────────────────────
PAGE_BG = (250, 250, 250)
CARD_LINE = (200, 200, 200)
CHECK_A = (255, 255, 255)   # 透明底的棋盘格 · 浅
CHECK_B = (228, 228, 228)   # 透明底的棋盘格 · 深
TXT = (30, 30, 30)
TXT_TITLE = (60, 60, 60)
BADGE_BG = (18, 18, 18)
BADGE_FG = (255, 255, 255)
BROKEN_BG = (255, 232, 232)
BROKEN_FG = (200, 60, 60)

FONT_FILES = [
    r'C:\Windows\Fonts\msyh.ttc',     # 微软雅黑
    r'C:\Windows\Fonts\msyhbd.ttc',   # 微软雅黑粗体
    r'C:\Windows\Fonts\simhei.ttf',   # 黑体
    r'C:\Windows\Fonts\simsun.ttc',   # 宋体
]

try:
    Image.Resampling.LANCZOS
    RESAMPLE = Image.Resampling.LANCZOS
except AttributeError:          # 老版本 Pillow
    RESAMPLE = Image.LANCZOS


def load_font(size):
    for path in FONT_FILES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


FONT_NUM = load_font(26)
FONT_LABEL = load_font(18)
FONT_TITLE = load_font(24)
FONT_MARK = load_font(20)


# ── 小工具 ──────────────────────────────────────────────────

def natural_key(name):
    """让 busy_2 排在 busy_10 前面（纯字符串排序会反过来）。"""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', name)]


def checker_card():
    """透明底的棋盘格垫底 —— 一眼就能看出这张图到底是不是透明底。"""
    step = 16
    tile = Image.new('RGB', (step * 2, step * 2), CHECK_A)
    d = ImageDraw.Draw(tile)
    d.rectangle([step, 0, step * 2, step], fill=CHECK_B)
    d.rectangle([0, step, step, step * 2], fill=CHECK_B)
    card = Image.new('RGB', (CARD, CARD))
    for y in range(0, CARD, step * 2):
        for x in range(0, CARD, step * 2):
            card.paste(tile, (x, y))
    return card


def is_ours(p: Path) -> bool:
    """跳过我自己拼出来的对比图，以及 `_` 开头的（比如 `_rejected` 里的）。"""
    n = p.name
    return n.startswith('_') or n.startswith('.') or '_对比图_' in n


def collect(folder: Path):
    files = [p for p in folder.iterdir()
             if p.is_file() and p.suffix.lower() in EXTS and not is_ours(p)]
    return sorted(files, key=lambda p: natural_key(p.name))


def cols_for(n):
    if n <= 1:
        return 1
    if n <= 4:
        return 2
    if n <= 9:
        return 3
    if n <= 16:
        return 4
    if n <= 25:
        return 5
    return 6


def shrink_to_fit(text, font, max_w, draw):
    if draw.textlength(text, font=font) <= max_w:
        return text
    while len(text) > 4 and draw.textlength(text + '…', font=font) > max_w:
        text = text[:-1]
    return text + '…'


# ── 拼一张 ──────────────────────────────────────────────────

def build_sheet(files, folder, page, pages, cols, rows, start_no):
    w = PAD + cols * (CARD + PAD)
    h = TITLE_H + PAD + rows * (CARD + LABEL_H + PAD)
    sheet = Image.new('RGB', (w, h), PAGE_BG)
    draw = ImageDraw.Draw(sheet)

    # 标题
    title = f'{folder.name}   共 {len(files)} 张'
    if pages > 1:
        title += f'   ·   第 {page}/{pages} 页'
    draw.text((PAD + 4, 16), title, font=FONT_TITLE, fill=TXT_TITLE)

    board = checker_card()

    for i, src in enumerate(files):
        r, c = divmod(i, cols)
        cx = PAD + c * (CARD + PAD)
        cy = TITLE_H + PAD + r * (CARD + LABEL_H + PAD)

        cell = board.copy()
        ok = True
        try:
            im = Image.open(src)
            im.load()
            if im.mode in ('RGBA', 'LA', 'P'):
                im = im.convert('RGBA')
            else:
                im = im.convert('RGB')
            im.thumbnail((CARD, CARD), RESAMPLE)
            ox = (CARD - im.width) // 2
            oy = (CARD - im.height) // 2
            if im.mode == 'RGBA':
                cell.paste(im, (ox, oy), im)
            else:
                cell.paste(im, (ox, oy))
        except Exception:
            ok = False
            cell = Image.new('RGB', (CARD, CARD), BROKEN_BG)
            cd = ImageDraw.Draw(cell)
            cd.text((CARD // 2, CARD // 2), '打不开', font=FONT_MARK,
                    fill=BROKEN_FG, anchor='mm')

        sheet.paste(cell, (cx, cy))
        draw.rectangle([cx, cy, cx + CARD - 1, cy + CARD - 1], outline=CARD_LINE)

        # 左上角编号
        num = str(start_no + i)
        nw = draw.textlength(num, font=FONT_NUM)
        bw, bh = nw + 20, 36
        draw.rounded_rectangle([cx + 8, cy + 8, cx + 8 + bw, cy + 8 + bh],
                               radius=8, fill=BADGE_BG)
        draw.text((cx + 8 + bw / 2, cy + 8 + bh / 2), num,
                  font=FONT_NUM, fill=BADGE_FG, anchor='mm')

        # 下面写文件名
        label = shrink_to_fit(src.name, FONT_LABEL, CARD - 8, draw)
        draw.text((cx + CARD // 2, cy + CARD + 6), label,
                  font=FONT_LABEL, fill=TXT, anchor='ma')

    return sheet


def process(folder: Path):
    if not folder.is_dir():
        print(f'    [跳过] 这不是文件夹：{folder}')
        return

    files = collect(folder)
    if not files:
        print(f'    [{folder.name}] 里没找到图。')
        # 往下找两层：ComfyUI 的输出目录常常是 output/日期/xxx.png 这种结构，
        # 只看直接子文件夹会漏掉。
        hits = []
        for d in sorted(folder.iterdir()):
            if not d.is_dir() or d.name.startswith('_') or d.name.startswith('.'):
                continue
            try:
                n = sum(1 for f in d.rglob('*')
                        if f.is_file() and f.suffix.lower() in EXTS and not is_ours(f))
            except Exception:
                n = 0
            if n:
                hits.append((d, n))
        if hits:
            print(f'       不过里面这些子文件夹装着图：')
            for d, n in hits[:10]:
                print(f'         - {d.name}   ({n} 张)')
            print('       → 把那个子文件夹单独拖进来就行。')
        return

    cols = cols_for(min(len(files), MAX_PER_SHEET))
    per = cols * ((MAX_PER_SHEET + cols - 1) // cols)
    chunks = [files[i:i + per] for i in range(0, len(files), per)]
    pages = len(chunks)

    print(f'    [{folder.name}] 找到 {len(files)} 张，拼成 {pages} 张对比图…')

    made = []
    no = 1
    for page, chunk in enumerate(chunks, 1):
        rows = (len(chunk) + cols - 1) // cols
        sheet = build_sheet(chunk, folder, page, pages, cols, rows, no)
        no += len(chunk)
        out = folder / f'{folder.name or "图片"}_对比图_{page:02d}.jpg'
        sheet.save(out, 'JPEG', quality=95, subsampling=0)
        made.append(out)
        print(f'      → {out.name}')

    return made


def split_paths(line):
    """把一行里的一串路径拆开。带引号的（路径有空格）算一个，其余按空白拆。"""
    out = []
    for quoted, bare in re.findall(r'"([^"]*)"|(\S+)', line):
        p = (quoted or bare).strip()
        if p:
            out.append(p)
    return out


def paths_from_line(line):
    """先当成「一整个路径」试一下，不行再按空格拆。

    为什么要先试整体：拖进来的路径 Windows 会自动加引号（有空格也安全），
    但**手动打字**的时候人多半不会打引号 —— 这时 `D:\\我的 图 文件夹`
    按空格拆就会散成三段。整体能识别成文件夹，就说明用户是想指那一个。
    """
    whole = line.strip().strip('"').strip("'")
    if whole and Path(whole).is_dir():
        return [whole]
    return split_paths(line)


def ask_for_folder():
    print()
    print('  ============================================================')
    print('     拼对比图 —— 一次看完一个文件夹里的所有图')
    print()
    print('     把【装着图的文件夹】拖到本窗口里，然后按回车。')
    print('     （拖好几个也行，会各拼各的）')
    print('  ============================================================')
    print()
    try:
        line = input('  文件夹 > ')
    except (EOFError, KeyboardInterrupt):
        return []
    return paths_from_line(line)


def main():
    args = sys.argv[1:]
    if not args:
        args = ask_for_folder()
    if not args:
        print()
        print('  没给文件夹，退出了。')
        return 1

    made = []
    for a in args:
        p = Path(a.strip().strip('"').strip("'"))
        if p.is_file():
            p = p.parent
        made.extend(process(p) or [])

    if made:
        print()
        print('  拼好了，正在打开…')
        try:
            import os
            for m in made:
                os.startfile(str(m))
        except Exception:
            print('  （自动打开失败，自己去文件夹里双击吧）')
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    sys.exit(main())
