# ComfyUI 出图工作流（Anima 线）

这份文档说明 `docs/comfyui_workflow.json` 是怎么来的、每一项参数为什么这样定，以及哪些东西**没有**随仓库分发。`comfyui_workflow.json` 是 ComfyUI 的 **API 格式**（`/prompt` 接口吃的形状），不是 ComfyUI 前端保存的 UI 工作流；节点编号与 `run_anima.py` 逐字对应。

## 1. 这套工作流做什么

项目里的猫咪/大肥鱼 UI 素材和图鉴奖励图，大部分由同一条 Anima 线批量生成：

- **UI 素材（透明底）**：`UNETLoader → LoraLoader → KSampler → VAEDecode → RemoveBackground → InvertMask → JoinImageWithAlpha → SaveImage`
- **图鉴奖励图（白底）**：同一条采样链，但跳过抠图，直接把 `VAEDecode` 的结果存成白底图（`--no-bg`）。

`comfyui_workflow.json` 把两条出口都放进去了：节点 `14` 是透明底，节点 `16` 是白底。跑一次会同时得到两张；只想要其中一张时，删掉另一个 `SaveImage` 即可。

## 2. 模型与放置位置

这些文件**都不在仓库里**（体积大、许可证也各不相同）。按 ComfyUI 的模型目录放：

| 角色 | 文件 | ComfyUI 目录 | 说明 |
| --- | --- | --- | --- |
| 底模（UNET） | `anima-preview.safetensors` | `models/diffusion_models/` | Anima，Qwen-Image 架构。来源：<https://huggingface.co/circlestone-labs/Anima> |
| 文本编码器 / CLIP | `qwen_3_06b_base.safetensors` | `models/text_encoders/` | `CLIPLoader` 的 `type` 必须选 **`stable_diffusion`**；这是 Anima 线的关键，选错会静默出废图 |
| VAE | `qwen_image_vae.safetensors` | `models/vae/` | Qwen-Image VAE |
| LoRA | `ds_whalemaid.safetensors` | `models/loras/` | 第三方 Civitai LoRA，见 §6；**正面提示词必须带触发词 `ds_whalemaid`** |
| 抠图模型 | `birefnet.safetensors` | 按 `RemoveBackground` 节点的说明放置 | ComfyUI 核心的 `RemoveBackground` / `LoadBackgroundRemovalModel` 节点使用 |

> 底模、文本编码器、VAE、LoRA 的**权重不随本仓库分发**。公开仓库只包含工作流配置和说明；你需要自己按各模型的许可下载。

## 3. 固定参数

| 参数 | 值 | 备注 |
| --- | --- | --- |
| 分辨率 | `1024 × 1024` | 批量出图统一 1024；8G 显存实测不爆 |
| 采样器 / 调度器 | `euler` / `simple` | 批量脚本统一口径 |
| 步数 | `20` | |
| CFG | `4.0` | |
| 去噪 | `1.0` | 文生图 |
| LoRA 强度 | `0.9`（model 与 clip 同值） | |
| 触发词 | `ds_whalemaid` | 不写会静默失效：画面退化成普通 Qwen 味，而不是报错 |
| 负面提示词 | 见 JSON 节点 `6` | 包含压复尾、复耳的串；只改正面通常压不住 |

`seed` 在 JSON 里是示例值 `123456789`；批量脚本每次随机。复现某张图时，用台账里的 seed 替换它。

## 4. 两条出口与一个已知陷阱

### 4.1 透明底（UI 素材）

`RemoveBackground`（BiRefNet）输出的 mask 语义与 `JoinImageWithAlpha` 的期望**相反**：`JoinImageWithAlpha` 内部按 `alpha = 1 − mask` 使用。因此中间必须插一个 `InvertMask`（节点 `12`），否则主体和背景的透明度会正好反过来——看起来像“抠图抠反了”，但节点本身不会报错。

```
VAEDecode ──► RemoveBackground ──► InvertMask ──► JoinImageWithAlpha ──► SaveImage
    └───────────────────────────────────────────────▲
```

### 4.2 白底（图鉴奖励图）

奖励图是白底成品图，不走抠图：直接把 `VAEDecode` 接到 `SaveImage`（节点 `16`）。批量脚本里对应 `--no-bg`。`--both` 会同时保存透明底和白底两份。

## 5. 提示词模板

批量脚本把正面提示词拼成三段：

```text
<角色串>, <表情/姿态串>, <质量串>
```

角色串（`gen_reward_gallery_anima.py` / `run_batch_20260920.py` 同款）：

```text
ds_whalemaid, chibi, super deformed, cute, 1girl, solo, blue hair, long hair, gradient hair, blue eyes, fin ears, whale tail, dark blue maid outfit, white apron, frills, white headdress, blue bowtie
```

质量串：

```text
masterpiece, best quality, highres, official art, extremely detailed, simple background, white background
```

表情串按 A/B/C/D 四味轮转，完整配比和每个姿态的额外负面在作者的批量脚本里（不随仓库分发）。`comfyui_workflow.json` 节点 `5` 用的是 A 味示例；换表情时只改这一串，负面里的压复尾/复耳串不要删。

## 6. 许可证与署名（重要）

这条工作流依赖的模型和节点包**不是同一套许可证**，不能笼统写成“开源”：

- **Anima 底模**：CircleStone Labs Non-Commercial License v1.2（Hugging Face 上标记为 `license: other`），**不是 OSI 开源许可证**。模型权重和基于它的衍生物（包括 LoRA）仅限非商业使用；**模型输出图可以用于商业用途**（许可证 §2(e)），但本仓库不附带权重。使用前请读原许可证：<https://huggingface.co/circlestone-labs/Anima>
- **ds_whalemaid LoRA**：Civitai 模型 [2845839](https://civitai.com/models/2845839)，作者 `ogura_shigeru`，版本 3213109（v1.0），底模 Anima。它是**第三方 LoRA**，不是本项目自炼的 `dafeiyu` LoRA；许可信息以 Civitai 模型页为准（该页标注允许图像商用、允许衍生物）。使用时保留作者署名。
- **ComfyUI**：GPL-3.0（<https://github.com/comfyanonymous/ComfyUI>）。本仓库不打包 ComfyUI；如果你分发修改版 ComfyUI，按 GPL-3.0 处理。
- **ComfyUI-Manager**：GPL-3.0（<https://github.com/Comfy-Org/ComfyUI-Manager>）。
- **ComfyUI-RemoveBackground_SET**：GPL-3.0（<https://github.com/set-soft/ComfyUI-RemoveBackground_SET>）。本工作流用的是 ComfyUI 核心的 `RemoveBackground`/`LoadBackgroundRemovalModel` 节点；如果你改用这个节点包，遵守其 GPL-3.0。
- **BiRefNet**：抠图模型，许可与下载方式见其发布页；权重不在本仓库。
- **Qwen-Image 文本编码器 / VAE**：随 Anima 发布，许可同上；权重不在本仓库。

## 7. 早期 SD1.5 线（已退役，仅作历史说明）

项目初期还跑过一条 SD1.5 线：

- 底模 `Counterfeit-V3.0_fix_fp16.safetensors`
- 自炼 LoRA `dafeiyu_c_v2.safetensors` @0.8（本项目自己训练，训练配方见 `docs/11-图片资产生产规范.md`）
- 鲸鱼图案 LoRA `dswhale.safetensors` @0.6~0.7（本项目自己训练）
- 512×512 / 25 步 / CFG 7.0 / `dpmpp_2m` + `karras` / 不做高清修复

这条线只用于早期素材；现在 UI 与图鉴统一走 Anima 线。两条线的输出图都**不包含**在本仓库的第三方图包中。

## 8. 不在仓库里的东西

- 模型权重（`.safetensors`）、LoRA 权重、BiRefNet 权重。
- 生成脚本里的本机绝对路径、批量台账、原始候选图。
- 社区图包 g201–g496 的原图（授权不允许再分发；公开仓库用占位卡替代）。
- 任何 API Key、服务器凭据、用户数据。

如果你要复现某张图，需要自己准备上述模型，并按 §3 的参数、§5 的提示词模板和 §6 的许可证使用。
