# 咪爱编程（Miai Biancheng）

离线优先的 Windows 桌面编程学习伴侣：猫咪风格讲解的知识库（通用知识 + C/C++/Java/Python 四语言 × 三阶段）+ 轻量代码练习器（本地编译运行、练习题、错题本、间隔重复复习、搜索、进度总览）。

**技术栈**：Electron + Vue 3 + electron-vite（三进程全 TypeScript）+ electron-builder。全栈零原生依赖。

---

## 目录地图（改什么先看这里）

| 位置 | 内容 | 说明 |
|---|---|---|
| `docs/` | 14 份项目文档 | **01 开发计划 / 02 任务列表 / 03 测试计划 / 04 设计规范 / 05 执行步骤 / 06 使用说明 / 07 模型切换省钱指南 / 08 技术方案 / 09 内容生成规范 / 10 大肥鱼视觉宪法 / 11 图片资产生产规范 / 12 开源项目借鉴清单 / 13 图片资产需求清单 / 14 无限题库架构**（另有三份带日期的专项报告：依赖包安全审查、开源炫酷 UI 调研、课程内容质量审计）。开工或变更前先读对应文档；变更后同步更新 |
| `docs/12-开源项目借鉴清单.md` | **选型与技术债的唯一记录处** | 【可直接复用】/【仅可借鉴】/【不推荐】三张清单 + **M5-03 待办的真问题**（runner.ts 4 条缺陷，含会让主进程崩溃的 spawn 崩溃）。**动 M5-03 / 想换技术栈 / 想引入新依赖之前先读这份**。每条结论标注了【实测】还是【调研】 |
| `docs/10-大肥鱼视觉宪法.md` | 角色视觉唯一真源 | 头身比、色值、部件定义、UI 组件规范。应用内出口在 `src/renderer/src/components/base/MiMascot.vue`（按 `pose` 取图，无图则显示虚线占位框）+ `domain/MiBubble.vue`。**要改形象先读 docs/10（长什么样）+ docs/13（哪个位置要哪个姿态、多大）** |
| `docs/11-图片资产生产规范.md` | **LoRA 出图资产产线** | 大肥鱼 LoRA（`dafeiyu_c_v2` + `dswhale`）的模型路径与 SHA256、训练参数、出图配方、提示词模板、复现脚本索引。**批量出图/调整出图效果时先读这份**。注意：角色外观以 docs/10 为准，出图参数以 docs/11 为准 |
| `docs/27-AI辅助编程改造交接文档.md` | **AI 编程化改造的唯一交接真源** | 2026-10-25 讨论结论 + **P1 已交付并实测通过**：双模式定位、流式对话 + AI 侧栏（右栏「辅助信息 / 大肥鱼」两页签）、单 DeepSeek（`deepseek-chat` 别名 → V4.1-Flash）、工作区自动执行分期落地；含 §0.1 交付现状、§16 逐版记录、P2–P4 路线与「只加少减」硬约束。**动 AI 层 / 想加工作区或补全之前先读这份** |
| `content/` | **内容唯一真源** | `glossary.json` 术语映射、`syllabus.json` 194 课大纲、`common/ c/ cpp/ java/ python/` 每课一个目录（`lesson.md` + `questions.json`）、`error-lib/` 内置错误库。**改内容只改这里** |
| `scripts/` | 内容流水线脚本 | `content-validate.mjs`（质量闸门）、`content-build.mjs`（打包成 bundle）、`gen-batch.mjs`（生成批次提示词）、`check-lesson-code.mjs` / `check-question-code.mjs`（两条真跑台，共用 `lib/run-code.mjs`）、`gen-bank.mjs` + `check-bank.mjs`（无限题库的产与查，共用 `lib/bank-verify.mjs`） |
| `src/shared/` | 主/渲染进程共享纯逻辑 | `types.ts` 全部 DTO、`ipc-channels.ts` IPC 通道唯一真源、`review-engine.ts` 间隔重复、`quiz-grading.ts` 判分、`error-match.ts` 错误匹配、`unlock.ts` 解锁链。**此处只放纯函数，可被 Vitest 直接测** |
| `src/main/` | Electron 主进程 | `index.ts` 生命周期；`store/` JSON 原子写存储；`env/` 环境检测 + winget 安装；`runner/` 编译运行器；`ai/` DeepSeek 调用 |
| `src/preload/` | contextBridge 白名单 | `index.ts` 暴露 `window.miai`，**所有新系统能力在此追加，renderer 永远拿不到 ipcRenderer** |
| `src/renderer/` | Vue 3 界面 | `src/styles/tokens.css` 设计令牌；`components/base/` 自研基础组件；`components/domain/` 业务组件；`views/` 页面；`stores/` Pinia |
| `resources/` | 打包资源（icon.ico 等） | |
| `release/` | electron-builder 产物 | gitignore，不入库 |

## 常用命令

```bash
npm run dev             # 开发模式（热更新窗口）
npm run build           # electron-vite 构建到 out/
npm run typecheck       # 双 tsconfig 类型检查
npm test                # Vitest 单测（M2 后启用）
npm run validate:content  # 内容校验闸门：结构 / frontmatter / 题库 schema / 解锁链 / 术语 / 错误库
npm run check:samples     # 课文代码块**真编译真运行**，和课文写的输出逐行对照
npm run check:questions   # 参考解真跑台：codefix / codewrite 的参考解跑一遍，断言输出 == expectedOutput
npm run check:answers     # 代码阅读题真跑台：code 题的 answer 跑一遍真代码，断言 == stdout
npm run check:bank        # 无限题库闸门：题库每一条都独立真跑复核（增量；--all 全量；--list 只列）
npm run build:content     # content/ → src/renderer/src/generated/content-bundle.json（M1 后启用）
```

## 工作流程

### 开发新功能（标准流程）
1. 查 `docs/01-开发计划.md` 确认属于哪个里程碑、查 `docs/02-任务列表.md` 找到对应任务编号
2. 读 `docs/08-技术方案.md` 对应章节 + 相关源码
3. 改代码：类型定义进 `src/shared/types.ts`；IPC 通道进 `src/shared/ipc-channels.ts`（禁止裸字符串）；主进程逻辑进 `src/main/`；纯函数进 `src/shared/`
4. `npm run typecheck` 过；功能相关纯函数补 Vitest 单测
5. 按 `docs/03-测试计划.md` 对应分组手工验收，勾掉 `docs/02-任务列表.md` 的任务

### 内容生成（批量流水线）
1. 大纲（`content/syllabus.json`）任何改动必须先人工评审
2. `node scripts/gen-batch.mjs <batchId>` 产出该批完整提示词 → 交给子代理生成（用 flash 模型，见 docs/07）
3. `npm run validate:content` 必须 0 错误 + 术语扫描 ≤2 告警/课，超标整批打回
4. `npm run check:samples` 必须 0 问题：课文里**每一门语言**的代码块都真编译真运行（gcc / g++ / javac / python 均已就位），和课文写的输出逐行对照
5. 有 `codefix` / `codewrite` 时必须再跑 `npm run check:questions`：参考解真跑一遍，输出要和内容里写死的 `expectedOutput` **逐字相等**。这两类的答案在程序里、不在题目里，光看题目看不出对错
5′. 有 `code`（代码阅读）题时必须再跑 `npm run check:answers`：那段代码真跑一遍，断言 **stdout == 题目写的 `answer`**。`code` 题的答案也是**手写**的，校验器只看形状不看语义 —— 少打一个空格学员就永远做不对。答案**本来就不是 stdout** 的题（问行数 / 问假想输入）要**显式登记**在该脚本顶部的 `豁免` 表里并写明理由，**不许静默跳过**
6. **语言课的 `codefix` / `codewrite` 不由子代理写**（交给 flash 手写一个没人跑过的 `expectedOutput` = 制造「学员永远做不对」的题）。做法是写模板 → `node scripts/gen-bank.mjs` → `npm run check:bank`，题目在本地真跑算出标准答案，落在 `content/challenge-bank/<lang>/<课号>.json`，打包时自动并进那一课。模板在 `scripts/bank/templates/`，规范见 `docs/14-无限题库架构.md`
7. 入库后更新 `docs/02-任务列表.md` 对应批次状态

### 图片资产生产（表情包 / 头像 / 立绘）

1. 读 `docs/11-图片资产生产规范.md`，用其中的「§10 标准生产流程 SOP」
2. 出图一律：**512×512** ｜ LoRA `dafeiyu_c_v2` @0.8 ｜ `dswhale` @0.7 ｜ **禁用高清修复**
3. **多抽再筛**：目标量的约 3 倍，人工筛选（合格率 1/3 ~ 1/2），成品必须保留来源清单
4. 需要新表情/新姿势时只改提示词，**不要动 LoRA 本身**

### 收尾提交
每个里程碑完成并验收后提交一次 git，commit message 带里程碑号（如 `M2: 应用框架与主界面`）。

## 铁律

1. **所有面向用户的文字（除代码本身）必须是猫咪口吻**——"喵"、"大肥鱼"、"小鱼干"等（2026-10-16 起全库统一：讲述者自称是猫咪，不是猫娘）。代码注释可正常写。
2. **术语映射唯一真源是 `content/glossary.json`**：变量=小鱼干仓库、函数=技能/招式、参数=投喂的小鱼干、返回值=叼回来的战利品、指针/引用=猫爪指向牌、循环=绕鱼干跑圈、条件判断=看鱼干眼色行事、类=猫猫图纸、对象=根据图纸生出来的真猫、内存回收=自动铲屎官、编译器/解释器=翻译官喵。任何 UI/文档/内容使用术语前先查它；新增术语必须同时更新该文件。
3. **离线优先 + 零服务器**：
   - **核心功能断网必须完整可用**（学习、练习、错题本、复习、跑代码、搜索）。断网时一律回退本地缓存，**不报错、不阻塞、不弹失败弹窗**。
   - **联网时**自动同步更新题库 / 每日挑战等内容，并可使用设置页配置的 DeepSeek API（可选）。**同步失败必须静默降级**——绝不让「联网」成为使用前提。
   - **绝不搭建自建服务器**。一切网络能力 = 客户端直连第三方 API（DeepSeek）+ 用户自带 Key。服务器意味着持续成本与维护，本项目不承担。
   - ⚠️ **「离线优先」是软件属性，不是内容禁令**（2026-09-16 主人澄清，此前被我误读过一次）：
     它管的是**软件断网时还能不能打开、能不能看课、能不能用本地编译器跑代码**，
     **不是**「课程内容里不许出现联网」。网络编程（socket / `requests`）、多线程、多进程、asyncio 这些课
     **该讲真联网就讲真联网**，**不许**为了迁就「离线」改成模拟沙盒、假数据或纯理论 —— 那会严重损害课程质量。
     需要联网才能跑的样例，**在开发机的联网环境里真跑**（本机一直联网），**不许因此降低验证标准**。
4. **稳定优先**：不引入原生依赖；宁可简单可靠，不为炫技加复杂度。
5. **内容与代码解耦**：内容只存在于 `content/`，代码是通用播放器；构建产物（out/、generated/、release/）一律不手改、不入库。
6. **改数据结构必须写迁移函数**：`config.json` / `profile.json` / `wrongbook.json` 的三个 schema（`AppConfig` / `UserProfile` / 错题本）**只要改字段，就必须同时 bump `version` + 写一个把旧数据搬到新结构的迁移函数**。
   - **Why**：`types.ts` 里已有 `version: number` 字段，但 `json-store.ts` **没有任何代码读它**——旧数据会带着老结构被新代码直接加载，新字段是 `undefined`，轻则功能异常、重则崩溃；崩溃后走「重建空结构」**会静默清零用户的学习进度**。
   - **禁止**：改结构却不写迁移（哪怕「这个字段没人用」）；解析失败时静默重建而不留日志。
   - **参考**：Oppia 的纪律（每次改结构都 bump `schema_version` + 强制迁移函数），见 `docs/12-开源项目借鉴清单.md` §2.3。
