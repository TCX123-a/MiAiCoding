---
id: python-stage3-12
lang: python
stage: 3
order: 13
title: 工程结构与打包分发
tags: [工程素养, 项目组织, 分发]
required: ["python-stage3-11"]
crossRefs: []
estMinutes: 25
keywords: [venv, pip, requirements, pyproject, package]
---

## 钩子：三十个本子摊在一张桌上

本喵的窝里现在住了三十多个小本子——分鱼干的、记账的、算天气的、跟远处猫聊天的，全摊在一张桌上。

上礼拜本喵想改一下分鱼干的规矩，翻箱倒柜找了半天。分鱼干那份夹在「算天气」和「记账」中间，旁边还压着三张本喵已经忘了是干什么用的纸。

招式一个都没坏，坏的是**窝**。三十个本子摊在一张桌上，那不叫窝，那叫杂物堆喵。

今天本喵带你干件很舒服的事：把这个杂物堆收拾成一间像样的猫窝。顺手还要解决两个老问题——**这窝请了哪些帮手**，以及**帮手之间打架怎么办**。

## 分屋子：一间屋、一页迎宾、一道正门

收拾完的窝大概长这样：

```text
猫窝工程/
├── miaow/              ← 本喵自己的招式，都住这间屋
│   ├── __init__.py     ← 迎宾页：这屋被整间请进来时先跑它
│   └── 分鱼干.py
├── tests/              ← 体检间：体检单单独收着
│   └── test_分鱼干.py
├── main.py             ← 正门：从这儿进窝
├── requirements.txt    ← 记账单：请了哪些帮手
└── pyproject.toml      ← 户口本：这窝叫什么、什么版本
```

四件事拆开说：

- **`miaow/` 是一间屋。** 屋门口那块 `__init__.py`，本喵原先以为它是**入场券**——少了它翻译官喵就不认这间屋。真跑一遍才知道想错了喵：**没有这一页，屋照样是屋**，下面那句从屋外喊名字的话照样喊得应（翻译官喵管这种「只有文件夹、没有那一页」的屋叫**命名空间包**；老教程里「必须要有 `__init__.py`」那句，说的是很久以前的翻译官喵，早改规矩了）。那这一页到底管什么？**它是这间屋被整间请进来的时候，最先跑起来的那一页**——不是入场券，是**迎宾的那一页**。屋里没什么要迎的客，空着它一点问题没有；可要在这屋刚被拆开的那一刻做点事——迎一句、给屋准备点自己的东西、把屋里某几本的名字直接摆到大门口——就得写上它喵。
- **`main.py` 是正门。** 敲 `python main.py`，从这道门进窝。
- **`tests/` 是体检间。** 上一课那些体检单别跟招式挤一张桌，单独一间屋收着。收好了照样一句话扫遍整间：`python -m unittest discover -s tests -v`（那个 `-v` 是「说详细点」的意思，本喵试过：不加它，屏幕上只有 `..` 两个点和一句 `OK` —— 看得见「过了」，看不见**哪几条**过了；加上它，每条体检单的名字才挨个报出来。那条念「跑了几秒」的每次都变，本喵就不抄了）：

```text
test_两只猫平分六条 (test_分鱼干.平分体检.test_两只猫平分六条) ... ok
test_该拒绝就拒绝 (test_分鱼干.平分体检.test_该拒绝就拒绝) ... ok

----------------------------------------------------------------------
OK
```

- **`requirements.txt` 和 `pyproject.toml`** 是给「这窝要请谁、这窝叫什么」记账用的，后面两节细说。

上面「迎宾的那一页」是本喵真跑出来的，跑了两遍给你看。

**第一遍：屋里只放本子，门口什么都不挂。**

```python
import os, sys, tempfile

仓库 = tempfile.mkdtemp()
屋 = os.path.join(仓库, "miaow")
os.makedirs(屋)
with open(os.path.join(屋, "分鱼干.py"), "w", encoding="utf-8") as f:
    f.write("def 平分(总数, 猫数):\n    return 总数 // 猫数\n")

sys.path.insert(0, 仓库)
from miaow.分鱼干 import 平分
print("没挂门牌，照样喊得应：每只", 平分(6, 2), "条")
```

```text
没挂门牌，照样喊得应：每只 3 条
```

喊得应喵。**所以老教程里那句「没了 `__init__.py` 就不认这间屋」，在本机的翻译官喵这里是不成立的**——只有文件夹、没有那一页，它照样当屋认（本机这位是 3.12 版喵）。

**第二遍：门口挂上那一页，里面写一句「迎宾的话」；屋里的本子也写一句报到的。**

```python
import os, sys, tempfile

仓库 = tempfile.mkdtemp()
屋 = os.path.join(仓库, "miaow")
os.makedirs(屋)
with open(os.path.join(屋, "__init__.py"), "w", encoding="utf-8") as f:
    f.write('print("迎宾那一页先开了口：喵～")\n')
with open(os.path.join(屋, "分鱼干.py"), "w", encoding="utf-8") as f:
    f.write('print("本子也被请醒了：分鱼干")\ndef 平分(总数, 猫数):\n    return 总数 // 猫数\n')

sys.path.insert(0, 仓库)
from miaow.分鱼干 import 平分
print("拿到招式：每只", 平分(6, 2), "条")
```

```text
迎宾那一页先开了口：喵～
本子也被请醒了：分鱼干
拿到招式：每只 3 条
```

看头两行的次序就懂了：屋外喊的是 `miaow.分鱼干`，可要拆到这间屋里的本子，翻译官喵得**先把这间屋拆开**——而拆开这间屋，就是**先跑门口那一页**。所以它才叫迎宾的那一页：它喊在屋里每一本的前头，正好用来在「这屋刚被拆开」的那一刻做点事。这也是为什么它一边是**空的也行**、一边又**值得写上**喵。

屋外怎么喊屋里的招式？**连着屋名一起喊**。下面这段是本喵真跑过的——它先在临时仓库里搭出这么一间屋，再站到屋外喊一声：

```python
import os, sys, tempfile

仓库 = tempfile.mkdtemp()
屋 = os.path.join(仓库, "miaow")
os.makedirs(屋)
open(os.path.join(屋, "__init__.py"), "w").close()
with open(os.path.join(屋, "分鱼干.py"), "w", encoding="utf-8") as f:
    f.write("def 平分(总数, 猫数):\n    return 总数 // 猫数\n")

sys.path.insert(0, 仓库)
from miaow.分鱼干 import 平分
print("六条鱼干分给两只猫，每只", 平分(6, 2), "条")
```

```text
六条鱼干分给两只猫，每只 3 条
```

三行代码各自管一块：`os.makedirs(屋)` 造文件夹，`open(...__init__.py...).close()` 在门口摆上迎宾那一页（里面什么都不写，摆完就撒手），最后那句 `sys.path.insert(0, 仓库)` 等于告诉翻译官喵「去这个仓库里找屋」。

喊名字那句要**连着屋名念**：`miaow.分鱼干`——屋名在前、本子名在后，中间点一个点。屋里的本子互相喊，写不写屋名都行；**本喵建议一律写全**，将来屋改了名字、或者某个本子挪进了另一间屋，写全的那种只要改一处喵。

## 「自己当班」和「被请来当帮手」

上面那句 `import` 里藏着一件很容易被忽略的事：**被请进来的本子，会当场从头到尾走一遍**。要是它里面写了一句「开饭啦」，你一请它，它就在你耳边喊一嗓子。

本喵跑给你看。这段会临时造一个叫 `开饭铃.py` 的本子，本子最后几行是道**门卫**：

```python
import os, sys, tempfile

仓库 = tempfile.mkdtemp()
内容 = '''print("被请来当帮手时，我的名字是：", __name__)

def 摇铃():
    print("开饭啦喵")

if __name__ == "__main__":
    摇铃()
'''
with open(os.path.join(仓库, "开饭铃.py"), "w", encoding="utf-8") as f:
    f.write(内容)

sys.path.insert(0, 仓库)
import 开饭铃

print("自己当班时，我的名字是：", __name__)
开饭铃.摇铃()
```

```text
被请来当帮手时，我的名字是： 开饭铃
自己当班时，我的名字是： __main__
开饭啦喵
```

三行对着一件事看：**每份代码心里都揣着一块小牌子**，写着它「现在是什么身份」。这块牌子叫 `__name__`。

- 被别的本子**请去当帮手**的时候，牌子写的是它自己的名字（`开饭铃`）。
- **自己当班**——也就是你直接敲 `python 某某.py`、把它当正门推开的时候——牌子写的是 `__main__`（念作「主事的」）。

所以门卫那一行 `if __name__ == "__main__":` 念出来就是：**「只有当本喵是走正门的那位，才做下面这件事」**。回头看那三行输出——请它当帮手的时候，门卫把「摇铃」拦住了，一声没响；后面本喵自己伸手喊 `开饭铃.摇铃()`，铃才响的。

这也是为什么正门那个 `main.py` 通常写得很薄：**它只负责喊人**，真本事都住在屋里。一个本子既能走正门自己当班，也能被别人请去当帮手——靠的就是这道门卫喵。

::: warn 小心喵
`__name__` 前后各是**两条**下划线，一共四条。少写一条，**名字就变成另一个了** —— 可「变成另一个」之后是**响**还是**哑**，得看少在哪一边，本喵两边都跑过：

- **少在名字那一边**（写成 `if __name_ == "__main__":`）—— **当场就响**：`NameError: name '__name_' is not defined. Did you mean: '__name__'?`，退出码 1。本喵倒挺喜欢这一句，翻译官喵**把正确的名字直接递到你眼前**了，照抄就改完。
- **少在引号里那一串那一边**（写成 `if __name__ == "_main_":`）—— **一声不响**：不报错、退出码 0、屏幕上一个字都没有，摇铃那一句就是**没跑**。这种错最费时间——它不是坏了，它只是**没在做事**，你还以为它在做喵。

记法就一句：**四条下划线，两边都得数。** 哪边数错了都别急着猜，先把稿子跑起来看屏幕 —— 响了是好事，哑了才要命喵。
:::

## 记账单：请了哪些帮手，写在 requirements.txt

本喵有个招式要隔着鱼塘跟远处的猫说话，这活儿 Python 自己不带工具，得请外援。请来的外援都记在一张小单子上，叫 `requirements.txt`：

```text
requests
```

一行一个名字，装什么写什么。为什么要单独记一张单子？因为**记性不可靠**：你换了台电脑、或者请别的猫来一起跑这窝，照单子一行装齐就行，不用靠脑袋回忆「当初好像还装过个什么来着」。

照单子把所有帮手一次请回来，一条命令：

```text
pip install -r requirements.txt
```

`pip` 是只专门跑腿请帮手的猫；`-r` 的意思是「照这张单子请」，后面跟单子文件名。真跑出来是这样（挑要紧的几行抄）：

```text
Collecting requests (from -r requirements.txt (line 1))
Collecting charset_normalizer<4,>=2 (from requests->-r requirements.txt (line 1))
Installing collected packages: urllib3, idna, charset_normalizer, certifi, requests
Successfully installed certifi-2026.7.22 charset_normalizer-3.5.1 idna-3.19 requests-2.34.2 urllib3-2.8.0
```

最后一行要认：`Successfully installed` 就是「全请回来了」。前面那串名字是 `requests` **自己出门也要带的五个小伙伴**，pip 会自动把它们一起请来——所以你单子上只写了一行，请回来的却是一串喵。

（那些印着「有新版本 pip 可用」的提示不用管，跟你的窝没关系。）

## 每间窝配一个自己的柜子

现在到了那个老问题：**帮手打架**。

假设本喵的窝要用外援 1.0 版，隔壁猫的窝要用同一个外援的 2.0 版。要是全窝共用一个柜子，柜子里只能摆一本——摆 1.0，隔壁猫就坏；摆 2.0，本喵就坏。

Python 的解法很直白：**每间窝配一个自己的柜子**。这个柜子叫**虚拟环境（每窝自己的一只柜子）**——听着高级，其实就是窝里多出来的一个文件夹，专门搁这窝请的帮手。本喵这只柜子的文件夹名叫 `.venv`。

造柜子一条命令：

```text
python -m venv .venv
```

钻进柜子里用：

```text
.venv\Scripts\activate
```

（这是 Windows 上的敲法。钻进柜子以后，那行的提示符前面会多出一个括号，等于告诉你「你现在站在柜子里」；想出来就敲 `deactivate`。）

**柜子里刚造出来是空的。** 本喵钻进一只空柜子，直接喊了一声外援的名字：

```text
python -c "import requests"
```

```text
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ModuleNotFoundError: No module named 'requests'
```

`ModuleNotFoundError: No module named 'requests'` 念作「**没有叫 requests 的盒子**」。这可不是坏消息，恰恰是好消息：说明这只柜子**真的是自己的**——全局大柜子里装了什么，它一概看不见。这就是隔离要的效果喵。

那你可能想问：本喵明明记得全局柜子里装过这个外援，为什么柜子里就没有？因为**虚拟环境不复制全局柜子里的东西**，它只带一个干净的底子。想让它的柜子里有什么，得你自己照着单子请。

在柜子里照单子请一次：

```text
pip install -r requirements.txt
```

```text
Successfully installed certifi-2026.7.22 charset_normalizer-3.5.1 idna-3.19 requests-2.34.2 urllib3-2.8.0
```

请完再敲正门那道 `python main.py`，本喵这窝的真跑结果是：

```text
六条鱼干分给两只猫，每只 3 条
```

你看：一只刚造好的柜子里，`import requests` 当场躺下；照单子把帮手请齐，正门 `python main.py` 就一路跑通了。**请没请过，差别就在这儿**喵。

::: tip 猫咪提示
今天记住四件事：① 招式分屋住，`main.py` 走正门；屋门口那块 `__init__.py` **不是入场券**（没有它照样喊得应），它是这屋被整间请进来时**先跑的那一页**——要迎客就写上，不迎客空着也行；② `if __name__ == "__main__":` 是门卫，管「只有当本喵是走正门的那位才做事」；③ 请了哪些帮手记在 `requirements.txt`，`pip install -r` 照单请齐；④ 每间窝配自己的 `.venv` 柜子，请进来的帮手别的窝看不见。
:::

## 打包分发：把这窝寄给别的猫

现在这窝在本喵自己机器上跑得很舒服。可要是隔壁猫也想要这个分鱼干的招式呢？总不能让她自己照着抄一遍吧——她也不知道该抄哪几个本子、该摆在哪一层。

办法是让这窝自己带一张**户口本**，叫 `pyproject.toml`，写清楚这窝叫什么、什么版本：

```text
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "miaow"
version = "0.1.0"
description = "A tiny dried-fish toolbox for cats."
requires-python = ">=3.10"
```

念几行就够：

- `[project]` 底下的 `name` —— 这窝对外的名字，别的猫就用这个名字请它。
- `version` —— 版本号。改了招式就把尾巴上那个数往上抬一格，别人一眼知道是新是旧。
- `requires-python` —— 这窝至少要多新的翻译官喵才跑得动（`>=3.10` 念「3.10 以上都行」）。
- 顶上那块 `[build-system]` 是告诉 pip「打包这窝用哪套家伙事」。照抄就行，暂时不用改。

还有一件事得**在打包之前**办好。户口本上那个 `version` 是给**外面的账本**看的，程序自己并不知道；想让**程序里**也问得出这个版本号，得在**迎宾页**上手写一行 —— 正是前面说的「给屋准备点自己的东西」：在 `miaow/__init__.py` 里写上 `__version__ = "0.1.0"`。

⚠️ 两个数得**对上**（户口本上写 `0.1.0`，迎宾页上也写 `0.1.0`），不然就成了「账本说一套、程序说一套」。本喵试过：这一行**不写**，后面那句 `print(miaow.__version__)` 会当场翻脸（`AttributeError: module 'miaow' has no attribute '__version__'`）；写上再问，稳稳答 `0.1.0` 喵。

有了户口本，别处一条命令就能把这窝请进她的柜子：

```text
pip install .
```

那个孤零零的点念作「**就这间**」——站在你窝的文件夹里敲，它就把当前这间窝打成一个小包裹请进来。真跑出来是这样（挑要紧的几行抄）：

```text
  Building wheel for miaow (pyproject.toml): started
  Building wheel for miaow (pyproject.toml): finished with status 'done'
Successfully built miaow
Installing collected packages: miaow
Successfully installed miaow-0.1.0
```

`Successfully built miaow` 是「照着户口本打好了」，`Successfully installed miaow-0.1.0` 是「请进柜子了」。

请进来以后，本喵**站到窝外面**（换一个完全不相干的文件夹）再喊一声：

```text
python -c "import miaow; print(miaow.__version__)"
```

```text
0.1.0
```

看得见吗喵——**站到窝外头也找得到 `miaow` 了**。它已经被安顿进柜子的正册里，不再是「碰巧摆在旁边的一个文件夹」。这就是分发：你把窝打成一个包裹寄出去，别人敲一句话，招式就住进她家，谁也不用关心你家文件夹原来摆在哪一层。

## 小任务

本喵给你留两个：

1. 把自己现有的本子们分个屋：造一个文件夹当屋，把招式挪进去，再在门口摆上一页 `__init__.py`（空着就行）。摆好以后站到屋外喊一次（`from 屋名.本子名 import 某个招式`），喊得应才算分对了喵。要是喊不应，先对名字拼得对不对（屋名在前、本子名在后）；顺手还能做个对照实验：**先把门口那一页拿掉再喊一次**——本喵真跑过，照样喊得应，所以你该记住的是「名字拼对、站对仓库」，不是「幸好我摆了那一页」喵。
2. 给自己的窝造一只柜子（`python -m venv .venv`），钻进去，把单子上的帮手请齐，然后在柜子里把正门跑一遍。跑通以后敲 `deactivate` 出来，再跑一次同一个正门——**猜猜这次会怎样？** 先猜，再敲，错了正好知道柜子到底隔开了什么喵。

下一课本喵带你去逛一张地图：外面那些现成的、别人已经打好的工具窝，都有哪些值得请进来用；顺便把请外援的几句常用口令认全喵～ 🐾
