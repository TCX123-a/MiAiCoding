#!/usr/bin/env python3
"""
把主人给的猫爪大图做成能直接用的 `.cur` 鼠标指针。

    python scripts/图片工具/make_cursor.py --check  <松开图> <按下图>
    python scripts/图片工具/make_cursor.py <松开图> <按下图> <输出目录>

【为什么要写成脚本，而不是我手工转一次】
主人的原图是 2048×2048 的 AI 出图，**换一张就得整套重来**。而这一路上有五个
数字（背景黄度、前景黄度、共用裁框、成品尺寸、热点），手工做第二遍时一个都想不起来，
只会得到"这次的猫爪怎么比上次胖"这种谁也查不出的差异。

【这张图难在哪 —— 白猫爪画在白背景上】
实测背景是暖白 `(252,251,247)`，而爪子的毛色是 `(254,246,233)`：**肉眼几乎同色**。
红通道 252 vs 254、绿通道 251 vs 246 —— 都在噪声里。唯一稳定的差别在**蓝通道**
（247 vs 233）。所以判据不是"和背景色差多少"，而是**黄度** `(R+G)/2 - B`：
背景 ≈ 4~5，毛 ≈ 16~23，中间隔着一整个数量级的空档。

用色键（`接近背景色 → 透明`）在这里是**必错**的：阈值调小了抠不干净，
调大了把整个爪子一起吃掉 —— 而两种错法都不会报错，只会得到一张"边缘很脏"或
"爪子缺了一块"的图。

【水印怎么处理】
原图右下角有「豆包AI生成」的灰色水印（实测 bbox `x[1691,2015] y[1935,2010]`）。
它和爪子的 x 范围**有重叠**（爪子到 x=1776），但 y **完全不重叠**（爪子只到 y=1712）。
所以不需要任何涂抹或修补：**裁到爪子的包围盒，水印自然落在框外**。
这也是本脚本坚持"先量包围盒再裁"而不是"按经验裁中间那块"的原因。

【为什么两帧必须共用一个裁框】
按各自的包围盒分别裁 + 各自缩到 32×32，会让两帧的**缩放比不一样** ——
松开和按下之间整只爪子会突然胖一圈或跳一下，而人眼对这种位移极其敏感
（看起来像"指针歪了"）。共用裁框之后，两帧的几何关系原样保留，
"按下去爪子铺开"这个效果才是它本来的样子。
"""

import argparse
import os
import struct
import sys

try:
    from PIL import Image, ImageChops, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit('需要 Pillow：pip install Pillow')

# Windows 控制台默认是 GBK，打不出「⚠」这类符号会**当场 UnicodeEncodeError 崩掉** ——
# 而崩的位置在打印那行，看着像"转换失败"，实际转换早就算完了。
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ──────────────────────────────────────────────────────────── 可调参数

#: 成品尺寸。README 写给主人的是 32×32，**必须一致** ——
#: 大了在某些系统上会被缩放成模糊的，小了在 4K 屏上糊成一个小点。
CURSOR_SIZE = 32

#: 黄度判据的两个端点：`<= BG_YELLOW` 算背景（全透明），`>= FG_YELLOW` 算爪子（不透明）。
#: 中间是软过渡，正是抗锯齿边需要的。
#:
#: 【10 / 15 这两个数是怎么来的 —— 全图黄度直方图实测】
#:     0~5    背景本体（暖白）          约 25 万像素，最大的一片
#:     7~8    **爪子四周那圈暖光晕**     约 3 万像素，单独一簇
#:     9~14   光晕到毛的过渡            稀疏
#:     15~24  爪子的毛                  宽平台
#:     46~65  粉色肉垫
#: 空档在 **9~14**。判据要落在这里：卡 6 会把那圈光晕一起收进爪子，包围盒胀到整张图；
#: 卡太高（>15）会把毛的边缘削掉一圈，成品细看像被刀切过。
#: ⚠️ 改之前先跑 `--check`：它会打这条直方图算出来的背景带，越界了会当场报警。
BG_YELLOW = 10.0
FG_YELLOW = 15.0

#: 判"是不是爪子"时，粉色（肉垫）单独给一条通路：`R - G`。
#: 肉垫的黄度并不高（`(254,161,146)` → 黄度 61.5，其实很高），
#: 这条主要是兜住**边缘上的粉色**，免得肉垫外沿被当成背景削掉一圈。
PINK_MIN = 25.0

#: 热点坐标 —— 压在整只爪最靠左上的实处。
#: ⚠️ **必须和 `cursor-assets.ts` 的 `PAW_HOTSPOT` 一致**：那边是给 `.png` 用的，
#: 这边是烘进 `.cur` 里的。两处不一样的话，"用 png"和"用 cur"会得到两种手感。
HOTSPOT = (11, 7)

#: 裁框四周留几个像素的余量。0 会让爪子贴着边、看着像被切了；
#: 留太多则爪子缩得比别的指针小。2 是"看得出有边距但不显小"。
PAD = 2

#: 去斑点（形态学开运算）的核大小，必须是奇数。见 `despeckle()`。
DESPECKLE_K = 3


# ──────────────────────────────────────────────────────────── 度量

def yellowness(r, g, b):
    """背景 ≈ 4~5，爪子毛色 ≈ 16~23。见文件头那段。"""
    return (r + g) / 2.0 - b


def load_rgb(path):
    im = Image.open(path)
    if im.mode != 'RGB':
        im = im.convert('RGB')
    return im


def border_band(im, inset=40, width=40):
    """
    取**画面最外一圈**里的一条带子上的像素。这片区域一定是背景
    （爪子的包围盒离边缘还有两三百像素），用来**复核**背景黄度是不是我们以为的那个数。

    ⚠️ 别改成"取四个角"：这张图有暗角，**四个角是纯白 `(255,255,255)`，
    黄度 0**；而爪子附近的背景是暖白 `(252,251,247)`，黄度 4.5。
    用角落去估背景会得到一个偏低的数，于是整片背景被判成"爪子"——
    实测的症状是包围盒变成整张图（`(8,3,2024,2028)`），而脚本一声不吭。
    """
    w, h = im.size
    xs = list(range(inset, w - inset, 16))
    ys = list(range(inset, h - inset, 16))
    pts = [(x, inset) for x in xs] + [(x, h - inset - 1) for x in xs]
    pts += [(inset, y) for y in ys] + [(w - inset - 1, y) for y in ys]
    return pts


def probe_background(im):
    """量一遍背景黄度的 min/中位/max。返回 (min, median, max)。"""
    px = im.load()
    vals = sorted(yellowness(*px[x, y]) for x, y in border_band(im))
    return vals[0], vals[len(vals) // 2], vals[-1]


def alpha_of(im, bg=BG_YELLOW, fg=FG_YELLOW):
    """
    算出每像素的透明度（0~255 的 `L` 图）。

    用 `max(黄度通路, 粉色通路)`：肉垫是粉色的，黄度也够高；但**肉垫和毛的交界处**
    是两者的混合，单看黄度会偏低、单看粉色也会偏低，取大值才稳。

    全程走 PIL 的 C 实现，不逐像素跑 Python：2048² 是 420 万像素，
    逐像素的写法要跑十几秒，而这段会被调用两次。
    """
    r, g, b = im.split()
    # 黄度 = (R+G)/2 - B。`add`/`subtract` 的 scale 参数就是除法，
    # 而且**负值会被夹到 0** —— 背景那一大片正好落在这里，直接变全透明，不用另判。
    half_rg = ImageChops.add(r, g, 2.0, 0)
    yellow = ImageChops.subtract(half_rg, b, 1.0, 0)
    # 粉色 = R - G。阈值取 PINK_MIN 的 1/4 起步、PINK_MIN 处到满 ——
    # 只有真正的肉垫（R-G ≈ 90）才越得过，背景和毛（R-G ≈ 1~3）都趴在零线上
    pink = ImageChops.subtract(r, g, 1.0, 0)

    return ImageChops.lighter(yellow.point(ramp(bg, fg)), pink.point(ramp(PINK_MIN * 0.25, PINK_MIN)))


def ramp(lo, hi):
    """0~255 的查表：`lo` 以下全透明、`hi` 以上全不透明，中间线性 —— 就是抗锯齿边。"""
    span = max(1.0, hi - lo)
    return [clamp255((v - lo) / span) for v in range(256)]


def clamp255(v):
    return 0 if v <= 0 else (255 if v >= 1 else int(v * 255))


def despeckle(alpha, k=DESPECKLE_K):
    """
    形态学**开运算**（先腐蚀、后膨胀）：抹掉背景上的孤立小斑点，大体形状不动。

    【为什么非有这一步不可】
    AI 出的图里，平坦的背景上散着若干 1~3 像素的暖色噪点。它们不是爪子的一部分，
    但只要有一个越过阈值，**包围盒就会被撑到整张图** —— 实测「按下」那张：
    `(248,323,1805,1718)` → `(46,56,1993,1984)`。而 k=3 / 5 / 7 结果一致
    （`(248,323,1805,1718)` 附近），证明那确实是散点而不是什么被削掉的结构。
    包围盒胀大的后果不是报错，是**爪子缩得很小还偏在一边** ——
    看着像"这张图没裁好"，而真正的原因在几百像素外的三个噪点上。

    【为什么用开运算，而不是"按面积筛掉小块"】
    那要数连通块，就得自己写 flood fill（2048² 的逐像素 Python 循环，几十秒）
    或者引 numpy（本机没有）。PIL 这两步是 C 实现的，几毫秒。
    代价是它**同时**会磨掉爪子上任何不到 3 像素的细尖 ——
    在这个尺度上看不出来：2048 缩到 32，1 像素 = 1/64 格。
    """
    return alpha.filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k))


def bbox_of_alpha(alpha, threshold=4):
    """不透明部分的包围盒。threshold 取小值—— 边缘那一圈半透明也算数，
    不然抗锯齿会被切掉，成品边缘会有一圈硬边。"""
    return alpha.point(lambda v: 255 if v > threshold else 0).getbbox()


def report(im, alpha, box, tag):
    lo, mid, hi = probe_background(im)
    n = im.size[0] * im.size[1]
    hist = alpha.histogram()
    opaque = sum(hist[200:])
    clear = sum(hist[:56])
    print(f'  {tag}: 背景黄度 min/中位/max = {lo:.1f} / {mid:.1f} / {hi:.1f}  (判据 {BG_YELLOW}~{FG_YELLOW})')
    # 这一行是**复核**，不是校准：判据是写死的，背景跑到判据上面去了就得有人管
    if hi >= BG_YELLOW:
        print(f'    ⚠️ 背景带里出现了 {hi:.1f}，越过了判据 {BG_YELLOW} —— '
              f'要么是几个孤立噪点（下面那步去斑点会抹掉），要么是背景整体偏暖（那得把 BG_YELLOW 调高）。看下一步的结果。')
    if hi < 1.0:
        print('    ⚠️ 整圈边框都是黄的零 —— 这个数不正常，多半是取样位置选错了')
    print(f'    不透明 {opaque / n * 100:.1f}%  半透明 {100 - opaque / n * 100 - clear / n * 100:.2f}%  透明 {clear / n * 100:.1f}%')
    print(f'    包围盒 {box}')


# ──────────────────────────────────────────────────────────── .cur 写入

def write_cur(path, rgba, hotspot):
    """
    写一个单帧的 32bpp `.cur`。

    ⚠️ **`.cur` 的目录项里那两个字段是热点坐标，不是平面的位深**。
    ICO 里 offset 4 / 6 是 `wPlanes` / `wBitCount`，而 CUR 里**同一对字节**
    被借用成 `热点X` / `热点Y`（位深改由下面的 BITMAPINFOHEADER 说）。
    搞反了的表现是：指针显示正常，但**点击落点偏到别处** —— 不报错、不崩溃，
    只是"总差一点没点到"，最容易归罪于手抖。

    ICO/CUR 的像素一律**自下而上**存，而且 32bpp 之外还要跟一份 1bpp 的
    AND 掩码（老系统用它做透明）。现代 Windows 只看 alpha 通道，
    但掩码不写全的话，某些老程序（以及部分第三方壳）会把整块画成黑的。
    """
    w, h = rgba.size
    if w != CURSOR_SIZE or h != CURSOR_SIZE:
        raise ValueError(f'成品必须是 {CURSOR_SIZE}×{CURSOR_SIZE}，拿到 {w}×{h}')

    px = rgba.load()
    xor = bytearray()
    for y in range(h - 1, -1, -1):           # 自下而上
        for x in range(w):
            r, g, b, a = px[x, y]
            xor += bytes((b, g, r, a))       # BGRA

    row_bytes = ((w + 31) // 32) * 4         # 1bpp 每行补到 4 字节
    and_mask = bytearray()
    for y in range(h - 1, -1, -1):
        row = bytearray(row_bytes)
        for x in range(w):
            if px[x, y][3] < 128:            # 透明 → 掩码置 1
                row[x // 8] |= 0x80 >> (x % 8)
        and_mask += row

    header = struct.pack(
        '<IiiHHIIiiII',
        40,          # biSize
        w,           # biWidth
        h * 2,       # biHeight —— XOR 和 AND 两张叠着，所以是两倍
        1,           # biPlanes
        32,          # biBitCount
        0,           # biCompression = BI_RGB
        len(xor) + len(and_mask),
        0, 0, 0, 0
    )
    image = bytes(header) + bytes(xor) + bytes(and_mask)

    icondir = struct.pack('<HHH', 0, 2, 1)   # reserved / type=2(CUR) / count=1
    entry = struct.pack(
        '<BBBBHHII',
        w if w < 256 else 0,
        h if h < 256 else 0,
        0, 0,
        hotspot[0],                      # ⚠️ CUR：这里是热点 X
        hotspot[1],                      # ⚠️ CUR：这里是热点 Y
        len(image),
        6 + 16
    )
    with open(path, 'wb') as f:
        f.write(icondir + entry + image)


# ──────────────────────────────────────────────────────────── 主流程

def build(up_path, down_path, out_dir, check_only=False, preview_dir=None):
    up = load_rgb(up_path)
    down = load_rgb(down_path)
    if up.size != down.size:
        print(f'⚠️ 两张图尺寸不同：{up.size} vs {down.size} —— 共用裁框会按小的那个算')

    print('量尺寸：')
    up_raw = alpha_of(up)
    down_raw = alpha_of(down)
    up_a = despeckle(up_raw)
    down_a = despeckle(down_raw)
    up_box = bbox_of_alpha(up_a)
    down_box = bbox_of_alpha(down_a)
    report(up, up_raw, bbox_of_alpha(up_raw), '松开')
    report(down, down_raw, bbox_of_alpha(down_raw), '按下')
    if up_box is None or down_box is None:
        sys.exit('❌ 一张都没抠出来（包围盒为空）—— 上面的背景黄度是不是跑偏了？')
    if (up_box, down_box) != (bbox_of_alpha(up_raw), bbox_of_alpha(down_raw)):
        # 这一步**会改结果**，所以要留痕：不打印的话，将来有人对着一个
        # 大得离谱的包围盒查半天，而真正的原因已经被这行悄悄修掉了
        print(f'  去斑点 k={DESPECKLE_K}：'
              f'松开 {bbox_of_alpha(up_raw)} → {up_box}，'
              f'按下 {bbox_of_alpha(down_raw)} → {down_box}')

    # 共用裁框 = 两个包围盒的并集（见文件头"为什么两帧必须共用一个裁框"）
    box = (
        min(up_box[0], down_box[0]) - PAD,
        min(up_box[1], down_box[1]) - PAD,
        max(up_box[2], down_box[2]) + PAD,
        max(up_box[3], down_box[3]) + PAD,
    )
    # 裁成正方形：不然缩到 32×32 时宽高比会被拉歪，爪子变形
    side = max(box[2] - box[0], box[3] - box[1])
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    w, h = up.size
    left = int(round(cx - side / 2))
    top = int(round(cy - side / 2))
    # 贴到图外就平移回来（爪子偏在角落时会发生），别让 PIL 去补黑边
    left = max(0, min(left, w - side))
    top = max(0, min(top, h - side))
    box = (left, top, left + side, top + side)
    print(f'共用裁框 {box}（{side}×{side}）→ 缩到 {CURSOR_SIZE}×{CURSOR_SIZE}')
    print(f'热点 {HOTSPOT}')

    # 水印在框外吗？—— 这是"不涂抹水印"这个做法成立的前提，每次都要复核
    for tag, im in (('松开', up), ('按下', down)):
        wm = watermark_bbox(im)
        if wm and overlaps(box, wm):
            print(f'⚠️ {tag}图的水印 {wm} 和裁框有重叠 —— 会出现在成品里，需要换裁框或涂抹')
        elif wm:
            print(f'  {tag}图的水印 {wm} 在裁框外，安全')

    if check_only:
        return None

    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    for name, im, a in (('cat-claw.cur', up, up_a), ('cat-claw-click.cur', down, down_a)):
        rgba = im.convert('RGBA')
        rgba.putalpha(a)
        out = rgba.crop(box).resize((CURSOR_SIZE, CURSOR_SIZE), Image.LANCZOS)
        path = os.path.join(out_dir, name)
        write_cur(path, out, HOTSPOT)
        print(f'  ✓ {path}  ({os.path.getsize(path)} 字节)')
        if preview_dir:
            # 放大预览**不写进 assets/**：那个目录被 glob 扫，多一张 384×384 的
            # PNG 就是白扛进安装包的几十 KB，而且它永远用不上。
            # 放大倍数 12 → 32 变成 384，还能数清像素；用 NEAREST 是为了
            # **看出真实像素**，用 LANCZOS 会把问题糊掉，预览就失去意义了。
            pv = os.path.join(preview_dir, name.replace('.cur', '-preview.png'))
            out.resize((CURSOR_SIZE * 12, CURSOR_SIZE * 12), Image.NEAREST).save(pv)
            print(f'    预览 {pv}')
    return box


def watermark_bbox(im):
    """
    找右下角那行灰色水印的包围盒。找不到返回 None。

    水印是**灰**的：三通道接近、且比背景暗。而爪子的毛是**暖**的（蓝通道明显更低），
    肉垫是粉的。所以"灰且暗"这一条能把水印单独摘出来，不会误伤爪子。
    """
    w, h = im.size
    px = im.load()
    x0 = max(0, w - 420)
    y0 = max(0, h - 420)
    xs, ys = [], []
    for y in range(y0, h):
        for x in range(x0, w):
            r, g, b = px[x, y]
            if r < 245 and abs(r - g) < 12 and abs(g - b) < 12:
                xs.append(x)
                ys.append(y)
    if len(xs) < 200:            # 太少了，多半是噪点不是水印
        return None
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def overlaps(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def main():
    ap = argparse.ArgumentParser(description='猫爪 PNG → .cur 鼠标指针')
    ap.add_argument('up', help='松开状态的大图（PNG）')
    ap.add_argument('down', help='按下状态的大图（PNG）')
    ap.add_argument('out_dir', nargs='?', default='src/renderer/src/assets/cursors',
                    help='输出目录，默认 src/renderer/src/assets/cursors')
    ap.add_argument('--check', action='store_true', help='只量尺寸、不写文件')
    ap.add_argument('--preview-dir', default=None,
                    help='额外写一份 12 倍放大的预览 PNG 到这个目录（**别指向 assets/**）')
    args = ap.parse_args()
    build(args.up, args.down, args.out_dir, args.check, args.preview_dir)


if __name__ == '__main__':
    main()
