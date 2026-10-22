# -*- coding: utf-8 -*-
r"""
gen_mascot.py —— 一条龙：批量出图 → 抠透明底 → 拼对比图

工单从 `docs/13-图片资产需求清单.md` 的 §7.2 / §7.3 读；出图配方从
`docs/11-图片资产生产规范.md` 抄（底模 / LoRA / 采样参数 / 正负提示词全部照抄，没改一个数）。

跑一张图的完整链路（**一个 ComfyUI 任务里全干完**，不用跑两遍）：

    Checkpoint → LoRA(主 0.8) → LoRA(鲸鱼 0.7) → CLIPTextEncode ×2
      → EmptyLatent(512) → KSampler → VAEDecode ─┬→ SaveImage  白底原图
                                                 └→ BiRefNet → SaveImage  透明底

产出：

    assets/mascot/raw/<姿态>/<姿态>_01.png …      ← 透明底，挑的就是这些
    assets/mascot/raw/<姿态>/_白底原图/…          ← 白底原图，留个后路
    assets/mascot/raw/_manifest.json             ← 每张的种子 + 提示词，可复现

用法：

    python gen_mascot.py --dry-run        先看看工单对不对，不出图
    python gen_mascot.py --limit 4        只出 4 张（冒烟测试）
    python gen_mascot.py --pose busy      只出 busy 这一路
    python gen_mascot.py                  出全部（断点续传，已出好的自动跳过）
    python gen_mascot.py --sheets         不出图，只重新拼对比图
    python gen_mascot.py --apply busy=1,4,7,10,13,16,19,22,25,28
                                          定稿：把挑中的搬到 assets/mascot/ 并正式命名
                                          ⚠️ 整组替换，编号从 01 重排
    python gen_mascot.py --add milestone=13,16,21,24
                                          补图：接着已有编号往后排，已定稿的一张不动
                                          （给同一个姿态补图一律用 --add）

⚠️ 别关 ComfyUI。这脚本只是往它那儿发任务。
"""

import argparse
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# ── 路径 ────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
DOC13 = PROJECT / 'docs' / '13-图片资产需求清单.md'
MASCOT_DIR = PROJECT / 'src' / 'renderer' / 'src' / 'assets' / 'mascot'
RAW_DIR = MASCOT_DIR / 'raw'
MANIFEST = RAW_DIR / '_manifest.json'

COMFY = 'http://127.0.0.1:8188'
COMFY_OUTPUT = Path(r'<ComfyUI>\output')

# ── 出图参数（照抄 docs/11 §1 / §5.1，一个都没改）──────────
CKPT = 'Counterfeit-V3.0_fix_fp16.safetensors'
LORA = 'dafeiyu_c_v2.safetensors'
LORA_LOGO = 'dswhale.safetensors'
STRENGTH = 0.8          # 主 LoRA
LOGO_STRENGTH = 0.7     # 鲸鱼图案 LoRA
RES = 512               # 必须 512，见 docs/11 §7.1
STEPS = 25
CFG = 7.0
SAMPLER = 'dpmpp_2m'
SCHEDULER = 'karras'

REMBG_MODEL = 'General-reso_512.safetensors'   # BiRefNet，训练分辨率正好 512
REMBG_DEVICE = 'AUTO'   # ⚠️ 必须大写。这个节点的设备名大小写敏感，'auto' 会被拒
# ⚠️ dtype 必须显式传，不能省。这个节点有个 bug：
#     execute(..., dtype="auto")  ← 默认值是小写
#     target_dtype = ... if dtype == "AUTO" else TORCH_DTYPE[dtype]   ← 却拿大写比
#   于是「不传 dtype」反而必然 KeyError: 'auto'。合法值只有 float16 / float32 / bfloat16。
REMBG_DTYPE = 'float32'

OVERSAMPLE = 3          # 多抽几倍：合格率约 1/3~1/2（docs/11 §7.1）
TIMEOUT = 900           # 单张超时（秒）；抠图第一张要加载 424MB 模型，给宽松点
PREFIX = 'MASCOT'

# ── 提示词骨架（照抄 docs/11 §6.1，只是把「表情」那一段换成按姿态的）──
LOGO = 'dswhale, whale logo'
IDENT = 'dafeiyu, blue_hair, long_hair, blue_eyes, maid, maid_headdress, apron, bow'
NAVY = 'navy blue dress, white apron'
TAIL = 'tail fin'
BG = 'white background, simple background'
EARS = 'animal_ears'
TAILC = 'light blue tail fin, white belly'

NEGATIVE = ('worst quality, low quality, blurry, jpeg artifacts, watermark, text, logo, signature, '
            'speech bubble, dialogue bubble, letters, words, caption, comic panel, border, frame, '
            'messy background, gradient background, blue background, colored background, sky, '
            'photo, realistic, 3d, scenery, '
            'bad hands, extra fingers, fewer fingers, fused fingers, missing fingers, '
            'extra hands, extra arms, extra limbs, malformed hands, mutated hands, '
            'angry, annoyed, angry eyes, v-shaped eyebrows, frown, glare, pouting, '
            'serious, mature, cool, sharp eyes, elegant, '
            # ↓ 压复尾，实测把复尾率从 39% 降到 6~12%，不要删（docs/11 §6.2）
            'extra tail, two tails, multiple tails, extra flukes, twin tails, '
            'two tail fins, double tail')

# 每个姿态一份配方。
#   face   = 表情（替换 docs/11 §6.1 里 `smug, :d, fang, …` 那一段）
#   acts   = 动作清单，一个动作出 OVERSAMPLE 张
# 取材自 docs/13 §7.2 / §7.3 的「情绪要求」列。
RECIPES = {
    'busy': dict(
        # ⚠️ 实测教训：写 `swimming` / `underwater` 会让 SD1.5 放弃全身构图、放大怼脸
        #    （第一版 busy 三张 **3/3 全部严重裁切**）。改成「原地漂浮 + 小动作」就好 ——
        #    这也正是 docs/13 §7.2 A1 说的「动作幅度要小（80px 里大动作全糊）」。
        face='focused, concentrating, closed mouth, blush, looking at viewer',
        # 站姿 / 漂浮 交替：这个 LoRA 是在「站姿全身立绘」上训的，站姿出全身最稳；
        # 漂浮那几张负责「在动」的感觉。两条路都留，让你挑的时候有得选。
        acts=['standing, holding a small wrench, focused',
              'floating in place, hands together, focused',
              'standing, arms crossed, focused',
              'floating gently, hair swaying, focused',
              'standing, holding a small fish, focused',
              'floating, tail swaying, focused',
              'standing, reading a small manual, focused',
              'floating in place, tail curled, focused',
              'standing, hands behind back, focused',
              'leaning forward, floating, small motion, focused']),
    'yay': dict(
        face='happy, :d, fang, sparkling eyes, open mouth, blush, looking at viewer',
        acts=['heart hands, smile',
              # ⚠️ 原本是 `jumping, arms up` 和 `spinning, skirt flaring`，实测**两组全崩**
              #    （2026-09-14 用户筛图时反馈「动作幅度太大画面崩坏了」）。
              #    `jumping` / `spinning` 和 busy 那次的 `swimming` 是同一种病：
              #    大动作词会让 SD1.5 放弃全身构图。这一路的动作一律「原地小幅度」。
              'both arms raised, small motion, smile',
              'hands on chest, happy, smile',
              'clapping hands, smile',
              'raised tail, hands up, smile',
              'peace sign, wink, smile',
              'holding a small fish, smile',
              'arm up, cheering, open mouth',
              'hands on cheeks, happy',
              'waving both hands, happy']),
    'soothe': dict(
        # ⚠️ 报错时用户在焦虑，这一路要克制：不用 smug/:d/fang（docs/13 §7.2 A3）
        face='gentle smile, soft eyes, closed mouth, worried, blush, looking at viewer',
        acts=['reaching out one hand, gentle smile',
              'head tilt, gentle smile',
              'patting, gentle smile',
              'holding a tissue, gentle smile',
              'hands together, soft smile',
              'leaning forward, worried, gentle',
              'small wave, gentle smile',
              'holding a small towel, gentle',
              'hands clasped, comforting smile',
              'tilted head, soft eyes, gentle']),
    'milestone': dict(
        face='very happy, :d, sparkling eyes, open mouth, blush, excited',
        # ⚠️ 这一路的命中率天生就低（约 13%，busy/yay/soothe 是 35%），因为它要求打架：
        #    表情得「炸」，构图又不能散，SD1.5 一激动就把人画跑偏。
        #
        # 2026-09-14 第二批 30 张的实测结论（10 组 × 3 张）：
        #   中的 4 张全部落在**新写的**第 5/6/7/8 组，每组恰好中 1 张（= 每 3 张中 1 张的常态手气）
        #   大幅度的第 1、3 组 0 中 —— 但小幅度的第 2、9、10 组也 0 中
        #   ⇒ **这批的成败跟「动作幅度」看不出关系**，别再把锅甩给幅度
        #
        # 所以这一批：保留 2 个已证明画得出来的动作（换个种子再来一次），
        # 其余 8 个走「手在身体附近做动作 + 鲸鱼道具」——中奖的那 4 组都是这个形状。
        # 第 9 个是故意留的反例：它和第 4 组（0 中）几乎一样，只多了 `small motion`，
        # 用来验一下「明写小幅度」到底有没有用。
        acts=['hugging a small whale, very happy',           # 1  ← 中过奖（第 5 组），换种子再搏
              'tail raised high, sparkling eyes, happy',     # 2  ← 中过奖（第 6 组），换种子再搏
              'holding a small whale above head, happy',     # 3  新（举起来，但手上有个锚点）
              'hugging own tail, very happy, sparkling',     # 4  新
              'both hands making a heart, very happy',       # 5  新
              'holding a tiny fish, sparkling eyes, happy',  # 6  新
              'thumbs up, winking, very happy',              # 7  新
              'hands on hips, proud smile, sparkling',       # 8  新
              'both arms raised, small motion, very happy',  # 9  新（明写 small motion）
              'finger hearts, very happy, blush']),          # 10 新
    'welcome-head': dict(
        # 半身版：只有侧栏 48px 的那个位置用（docs/13 §7.3 B1）
        face='curious, gentle smile, :d, sparkling eyes, blush, looking at viewer',
        acts=['waving hand, simple pose',
              'waving hand, curious smile',
              'hand raised, greeting, smiling']),
    'welcome': dict(
        face='curious, smug, :d, fang, sparkling eyes, blush, looking at viewer',
        # ⚠️ 原来只有 3 个动作、而且全是「挥手」的变体，等于同一张图抽了 3 次种子
        #    （2026-09-14 用户反馈「这三张都不行」）。现在摊开成 5 种差别明显的姿态。
        acts=['waving hand, curious smile',
              'both hands waving, happy greeting',
              'hand on chest, gentle smile',
              'hands behind back, head tilt, curious',
              'holding a small fish, curious, smile']),
    'expect': dict(
        face='expectant, sparkling eyes, open mouth, smile, looking at viewer',
        acts=['pointing forward',
              'pointing at viewer, smile',
              'reaching out one hand, expectant']),
    'proud': dict(
        face='proud, smug, closed eyes, smile, blush',
        acts=['patting own belly, proud',
              'hands on hips, proud, tail raised',
              'chest out, proud, tail up']),
    'think': dict(
        # ⚠️ 同样是「3 个动作全是同一件事的变体」（2026-09-14 用户反馈「三张都不行」）。
        #    另外把 `looking up` 从表情里拿掉 —— 原来 3 张全都在往上看、不看镜头，
        #    放在「搜索无结果」这种场景里显得像在敷衍用户。
        face='thinking, closed mouth, tilted head, blush, looking at viewer',
        acts=['hand on chin, thinking',
              'head tilt, confused, thinking',
              'holding a small book, thinking',
              'one finger on cheek, pondering',
              'arms crossed, thinking']),
    'remind': dict(
        face='gentle, closed mouth, looking at viewer, blush',
        acts=['holding a notebook in mouth',
              'holding a book, reminding',
              'holding a paper, gentle smile']),
    'guide': dict(
        face='confident smile, :d, sparkling eyes, looking at viewer',
        acts=['holding a toolbox',
              'holding an instruction manual',
              'thumbs up, confident smile']),
}


# ══ 一、读工单 ═══════════════════════════════════════════════

def parse_work_order(text=None):
    """从 docs/13 §7.2 / §7.3 的表格里读出「要出哪些姿态、各几张」。

    只看反引号里的文件名（`busy_01.png` … `busy_10.png`），不看列的位置 ——
    这样以后在表里加一列、调一下顺序，解析也不会坏。
    """
    if text is None:
        text = DOC13.read_text(encoding='utf-8')

    sec = re.search(r'^### 7\.2(.*?)^### 7\.4', text, re.S | re.M)
    if not sec:
        raise SystemExit('读不到 docs/13 的 §7.2~§7.3，文档结构变了？')
    body = sec.group(1)

    found = {}
    for m in re.finditer(r'`([a-z][a-z0-9-]*?)(?:_(\d+))?\.png`', body):
        key, num = m.group(1), m.group(2)
        n = int(num) if num else 1
        found[key] = max(found.get(key, 0), n)

    if not found:
        raise SystemExit('docs/13 §7.2/§7.3 里一张图都没解析出来，文档结构变了？')
    return found


# ══ 二、拼提示词 ═════════════════════════════════════════════

def build_prompt(pose, act):
    """半身版（姿态名带 -head）要把 full_body 换成 upper body，其余一模一样。

    这条和 MiMascot.vue 的档位规则是同一条 —— 48px 的全身图只剩一个蓝点。
    """
    if pose not in RECIPES:
        raise SystemExit(f'姿态 `{pose}` 在 docs/13 里有，但脚本里没有配方。\n'
                         f'请到 gen_mascot.py 的 RECIPES 里补一条（别让它悄悄跳过）。')
    r = RECIPES[pose]
    body = 'upper body' if pose.endswith('-head') else 'full_body'
    return ', '.join([LOGO, IDENT, '1girl, solo', r['face'], act,
                      NAVY, body, TAIL, BG, EARS, TAILC])


def plan(poses, oversample, limit=None):
    """排出一串要出的图。

    同一个动作的 OVERSAMPLE 张**编号连着**（busy_01/02/03 是同一个动作的三种抽法），
    这样你挑的时候是「每个动作三选一」，不是在一堆混着的里瞎找。

    limit 是**每个姿态**的上限，不是总数 —— 冒烟测试时要的是「每一路都看一眼」，
    不是「把第一路出满」。
    """
    out = []
    for pose, count in poses.items():
        acts = RECIPES[pose]['acts'] if pose in RECIPES else []
        if not acts:
            continue
        total = count * oversample
        # 每个动作分几张。用 total // len(acts) 而不是写死 oversample ——
        # 只出 1 张的姿态（welcome / think / expect…）total=3、acts 有 3~5 个，
        # 写死 oversample 的话 i//3 恒等于 0，**3 张候选全是同一个动作、只换了种子**，
        # 等于把同一个动作抽了 3 遍（2026-09-14 用户筛图时就是这么发现 welcome「三张都不行」的）。
        # 改成 total // len(acts) 后：动作多的姿态仍是「每个动作三选一」，
        # 只出 1 张的姿态则自动变成「3 张各是一个不同动作」，挑起来有得比。
        group = max(1, total // len(acts))
        for i in range(total):
            out.append(dict(pose=pose, idx=i + 1,
                            act=acts[(i // group) % len(acts)],
                            slot=i % group))
            if limit and len([j for j in out if j['pose'] == pose]) >= limit:
                break
    return out


# ══ 三、发给 ComfyUI ═════════════════════════════════════════

def build_workflow(positive, seed, name, do_bg, batch=1):
    wf = {
        '1': {'class_type': 'CheckpointLoaderSimple',
              'inputs': {'ckpt_name': CKPT}},
        '2': {'class_type': 'LoraLoader',
              'inputs': {'model': ['1', 0], 'clip': ['1', 1], 'lora_name': LORA,
                         'strength_model': STRENGTH, 'strength_clip': STRENGTH}},
        '3': {'class_type': 'LoraLoader',
              'inputs': {'model': ['2', 0], 'clip': ['2', 1], 'lora_name': LORA_LOGO,
                         'strength_model': LOGO_STRENGTH, 'strength_clip': LOGO_STRENGTH}},
        '4': {'class_type': 'CLIPTextEncode', 'inputs': {'text': positive, 'clip': ['3', 1]}},
        '5': {'class_type': 'CLIPTextEncode', 'inputs': {'text': NEGATIVE, 'clip': ['3', 1]}},
        '6': {'class_type': 'EmptyLatentImage',
              'inputs': {'width': RES, 'height': RES, 'batch_size': batch}},
        '7': {'class_type': 'KSampler',
              'inputs': {'model': ['3', 0], 'positive': ['4', 0], 'negative': ['5', 0],
                         'latent_image': ['6', 0], 'seed': seed, 'steps': STEPS, 'cfg': CFG,
                         'sampler_name': SAMPLER, 'scheduler': SCHEDULER, 'denoise': 1.0}},
        '8': {'class_type': 'VAEDecode', 'inputs': {'samples': ['7', 0], 'vae': ['1', 2]}},
        # 白底原图留一份：万一抠图翻车，原图还在（占地方不大）
        '9': {'class_type': 'SaveImage',
              'inputs': {'images': ['8', 0], 'filename_prefix': f'{PREFIX}_RAW/{name}'}},
    }
    if do_bg:
        wf['10'] = {'class_type': 'LoadRembgByBiRefNetModel_SET',
                    'inputs': {'model': REMBG_MODEL, 'device': REMBG_DEVICE,
                               'dtype': REMBG_DTYPE}}
        wf['11'] = {'class_type': 'RembgByBiRefNet_SET',
                    'inputs': {'model': ['10', 0], 'images': ['8', 0], 'batch_size': batch}}
        wf['12'] = {'class_type': 'SaveImage',
                    'inputs': {'images': ['11', 0], 'filename_prefix': f'{PREFIX}/{name}'}}
    return wf


def _get(url, timeout=15):
    """只用标准库 —— 少一个要装的包，你就少一个会卡住的地方。"""
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def submit(wf):
    body = json.dumps({'prompt': wf}).encode('utf-8')
    req = urllib.request.Request(COMFY + '/prompt', data=body,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode('utf-8'))['prompt_id']
    except urllib.error.HTTPError as e:
        # 把 ComfyUI 的原话打出来 —— 它报的「哪个节点哪个参数不对」是最有用的信息
        raw = e.read().decode('utf-8', 'replace')
        try:
            err = json.loads(raw)
        except Exception:
            err = raw
        raise RuntimeError(f'HTTP {e.code}: {json.dumps(err, ensure_ascii=False)[:900]}')


def wait(pid):
    start = time.time()
    while time.time() - start < TIMEOUT:
        h = _get(f'{COMFY}/history/{pid}')
        if pid in h:
            st = h[pid].get('status', {})
            if st.get('status_str') == 'error':
                msgs = json.dumps(st.get('messages', []), ensure_ascii=False)
                raise RuntimeError('ComfyUI 报错：' + msgs[:800])
            imgs = [img for out in h[pid].get('outputs', {}).values()
                    for img in out.get('images', [])]
            return imgs
        time.sleep(1.5)
    raise RuntimeError(f'超时（{TIMEOUT}s）')


def fetch(imgs, want_sub, dest):
    """把 ComfyUI 存下的文件搬到项目里。want_sub 用来区分白底/透明底两张。"""
    for img in imgs:
        if img.get('subfolder') != want_sub:
            continue
        src = COMFY_OUTPUT / img.get('subfolder', '') / img['filename']
        if not src.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
        try:
            src.unlink()
        except OSError:
            pass
        return True
    return False


# ══ 四、主流程 ═══════════════════════════════════════════════

def load_manifest():
    if MANIFEST.exists():
        try:
            return json.loads(MANIFEST.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {}


def save_manifest(m):
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding='utf-8')


def do_generate(jobs, do_bg, rng):
    man = load_manifest()
    done = skipped = failed = 0
    total = len(jobs)
    t0 = time.time()

    for n, job in enumerate(jobs, 1):
        pose, idx = job['pose'], job['idx']
        outdir = RAW_DIR / pose
        final = outdir / f'{pose}_{idx:02d}.png'
        white = outdir / '_白底原图' / f'{pose}_{idx:02d}.png'

        # ── 断点续传：透明底那张在，就算这张出过了 ──
        if final.exists() and final.stat().st_size > 0:
            skipped += 1
            continue

        seed = man.get(f'{pose}_{idx:02d}', {}).get('seed') or rng.randint(1, 2**31 - 1)
        pos = build_prompt(pose, job['act'])
        name = f'{pose}_{idx:02d}'
        eta = ''
        if n > 1 and (done + failed):
            per = (time.time() - t0) / (done + failed)
            eta = f'  约剩 {(total - n + 1) * per / 60:.1f} 分钟'

        print(f'  [{n}/{total}] {name}  {job["act"][:44]:<44}{eta}', flush=True)

        try:
            imgs = wait(submit(build_workflow(pos, seed, name, do_bg)))
            got = fetch(imgs, PREFIX, final)
            if do_bg:
                fetch(imgs, f'{PREFIX}_RAW', white)
            if not got:
                raise RuntimeError('没拿到输出文件')
            man[name] = dict(pose=pose, act=job['act'], seed=seed, prompt=pos)
            save_manifest(man)
            done += 1
        except Exception as e:
            failed += 1
            print(f'      ✗ {e}')

    print()
    print(f'  出图 {done} 张，跳过 {skipped} 张（出过了），失败 {failed} 张')
    return done


def do_sheets(poses):
    """出完自动拼对比图 —— 每类一张，编号接着排。"""
    import importlib.util
    spec = importlib.util.spec_from_file_location('cs', HERE / 'contact_sheet.py')
    cs = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cs)

    made = []
    for pose in poses:
        d = RAW_DIR / pose
        if d.is_dir() and cs.collect(d):
            made += cs.process(d) or []
    if made:
        print()
        print('  对比图拼好了，正在打开…')
        import os
        for m in made:
            try:
                os.startfile(str(m))
            except Exception:
                pass
    return made


def parse_apply(specs):
    """把 `--apply` 的写法解析成 {姿态: [编号, …]}。编号为空 → 该姿态全部候选都要。

    容忍这几种写法（人手动敲，别让人猜语法）：
        --apply busy=1,4,7          挑 busy 的第 1/4/7 张
        --apply expect              整个姿态都要（单张的姿态这么写）
        --apply busy=1,4 expect     一行里写多个姿态（空格或逗号分隔都行）
        --apply busy=1,4 --apply expect    重复给 --apply 也一样
    """
    groups = {}
    cur = None          # 正在往哪个姿态上追加编号
    for spec in specs:
        for tok in re.split(r'[\s,]+', spec.strip()):
            if not tok:
                continue
            if tok.isdigit():
                # 光秃秃一个数字：接着上一个姿态写，比如 `busy=1,4,7,yay=2,5`
                if cur is None:
                    raise SystemExit(f'--apply 里的 `{tok}` 是数字，但前面没写姿态名。\n'
                                     f'正确写法形如 busy=1,4,7')
                groups[cur].append(int(tok))
                continue
            pose, _, nums = tok.partition('=')
            pose = pose.strip()
            if pose not in RECIPES:
                raise SystemExit(f'--apply 里的 `{pose}` 不是已知姿态。\n'
                                 f'可选：{"、".join(RECIPES)}')
            if pose in groups and nums:
                raise SystemExit(f'--apply 里 `{pose}` 写了两次，我没法猜你想合并还是覆盖。\n'
                                 f'请把编号并成一条再写。')
            groups.setdefault(pose, [])
            cur = pose
            for s in nums.split(','):
                if s.strip():
                    if not s.strip().isdigit():
                        raise SystemExit(f'--apply 里 `{pose}` 的编号 `{s.strip()}` 不是数字。')
                    groups[pose].append(int(s.strip()))
    return groups


def settled(pose):
    """这个姿态在 assets/mascot/ 里已经定稿了几张（用来算追加的起始编号）。"""
    return sorted(int(p.stem.rsplit('_', 1)[1])
                  for p in MASCOT_DIR.glob(f'{pose}_[0-9][0-9].png'))


def do_apply(specs, append=False):
    """定稿：把挑中的候选图复制到 assets/mascot/ 并按 <姿态>_NN.png 正式命名。

    append=False（--apply）：**整组替换**，编号从 01 重排。
    append=True （--add  ）：**接着已有编号往后排**，已定稿的一张都不动。

    ⚠️ 为什么必须有 append：--apply 的编号是从 1 重排的，所以第二次给同一个姿态
    补图时，如果只报新挑的那几张，就会**把之前定稿的覆盖掉**（2026-09-14 差点踩：
    用户已经定稿了 4 张 milestone，补图时报 `milestone=13,16,21,24` 会正好顶掉
    前 4 张）。补图一律用 --add。
    """
    groups = parse_apply(specs)

    total = 0
    for pose, picks in groups.items():
        src_dir = RAW_DIR / pose
        # 不写编号 = 这个姿态的候选全要，按现有编号顺序
        if not picks:
            picks = sorted(int(p.stem.rsplit('_', 1)[1])
                           for p in src_dir.glob(f'{pose}_*.png')) if src_dir.is_dir() else []
            if not picks:
                print(f'  ✗ {pose}：{src_dir} 里一张候选都没有，先把图出了再来定稿')
                continue

        if append:
            have = settled(pose)
            start = (have[-1] if have else 0) + 1
            if have:
                print(f'  （{pose} 已有 {len(have)} 张定稿，新图从 {start:02d} 接着排）')
        else:
            start = 1

        for i, n in enumerate(picks, start):
            src = src_dir / f'{pose}_{n:02d}.png'
            if not src.exists():
                print(f'  ✗ 找不到 {src.name}（{pose} 一共出了 '
                      f'{len(list(src_dir.glob(f"{pose}_*.png")))} 张候选）')
                continue
            dst = MASCOT_DIR / f'{pose}_{i:02d}.png'
            dst.write_bytes(src.read_bytes())
            total += 1
            print(f'  ✓ {src.name}  →  {dst.name}')

    print()
    verb = '追加' if append else '定稿'
    print(f'  {verb} {total} 张，已放进 {MASCOT_DIR}')
    if total:
        print('  开发模式（npm run dev）下界面会自己换图，不用重启。')


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('--dry-run', action='store_true', help='只打印工单，不出图')
    ap.add_argument('--limit', type=int, help='每个姿态最多出 N 张（冒烟测试用）')
    ap.add_argument('--pose', help='只出这一路，逗号分隔')
    ap.add_argument('--oversample', type=int, default=OVERSAMPLE, help=f'多抽几倍（默认 {OVERSAMPLE}）')
    ap.add_argument('--no-bg', action='store_true', help='不抠透明底，只出白底')
    ap.add_argument('--sheets', action='store_true', help='不出图，只重新拼对比图')
    ap.add_argument('--no-sheets', action='store_true', help='出图但先不拼对比图（分批测试用）')
    ap.add_argument('--apply', action='append',
                    help='定稿（整组替换，编号从 01 重排），形如 busy=1,4,7 或 expect'
                         '（不写编号=整个姿态都要）。可重复给')
    ap.add_argument('--add', action='append', dest='add',
                    help='追加（已定稿的一张不动，新图接着往后编号），写法同 --apply。'
                         '给同一个姿态补图必须用这个，别用 --apply')
    ap.add_argument('--seed', type=int, default=20260913, help='随机种子基数')
    a = ap.parse_args()

    if a.apply and a.add:
        raise SystemExit('--apply 和 --add 不能一起用：一个是整组替换、一个是往后追加，\n'
                         '混在一起我没法猜你想怎么样。分开跑两次就行。')
    if a.apply:
        do_apply(a.apply, append=False)
        return 0
    if a.add:
        do_apply(a.add, append=True)
        return 0

    poses = parse_work_order()
    if a.pose:
        want = [p.strip() for p in a.pose.split(',')]
        missing = [p for p in want if p not in poses]
        if missing:
            raise SystemExit(f'docs/13 里没有这些姿态：{missing}\n有的：{list(poses)}')
        poses = {p: poses[p] for p in want}

    if a.sheets:
        do_sheets(poses)
        return 0

    jobs = plan(poses, a.oversample, a.limit)
    total_final = sum(poses.values())

    print()
    print('  ══ 出图工单（读自 docs/13 §7.2 / §7.3）══')
    for p, c in poses.items():
        print(f'    {p:<16} 要 {c:>2} 张  →  抽 {c * a.oversample:>2} 张')
    print(f'    {"合计":<15} 要 {total_final:>2} 张  →  抽 {len(jobs):>2} 张')
    if a.limit:
        print(f'    ⚠️ --limit {a.limit}：这次只出前 {len(jobs)} 张')
    print()

    if a.dry_run:
        print('  ── 前几张的提示词预览 ──')
        for j in jobs[:3]:
            print(f'    {j["pose"]}_{j["idx"]:02d}  {build_prompt(j["pose"], j["act"])}')
            print()
        return 0

    try:
        _get(COMFY + '/system_stats', timeout=8)
    except Exception as e:
        raise SystemExit(f'连不上 ComfyUI（{COMFY}）—— 它开着吗？\n  {e}')

    rng = random.Random(a.seed)
    do_generate(jobs, not a.no_bg, rng)
    if not a.no_sheets:
        do_sheets(poses)
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    sys.exit(main())
