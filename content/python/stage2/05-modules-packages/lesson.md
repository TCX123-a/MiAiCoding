---
id: python-stage2-05
lang: python
stage: 2
order: 5
title: 模块与包
tags: [模块, 包, 导入]
required: ["python-stage2-04"]
crossRefs: []
estMinutes: 25
keywords: [import, as, __name__, math]
---

## 钩子：本喵的招式手册快撑破了

本喵的鱼塘小工具越写越多：数鱼干的、算鱼塘面积的、给小鱼干排排坐的……全挤在同一个 `.py` 文件里。写到第三十招的时候，本喵自己都翻不动了——想找「算面积」那一招，得从上往下滚半天喵。

更让本喵眼馋的是：隔壁橘猫也写了一招「算面积」，比本喵写的稳当。本喵不想把它重抄一遍，只想**把它的本子借过来翻**。

Python 早就替本喵想好了：**一个 `.py` 文件就是一本招式手册**，写好的手册可以**被别人请进自己的程序里用**。这个「请进来」的口令，就是 `import`。

## 一本手册，就是一个模块

先把名字认下来：**一个 `.py` 文件，在 Python 里叫一个模块**。你可以把模块理解成**一本招式手册**——里面写着若干招（`def` 开头的那些），写好了就搁在那儿，谁想用谁请。

Python 自己就带着一大柜子现成的手册：算数的 `math`、摇随机数的 `random`、管文件路径的 `os.path`……这些**出厂自带的手册**合起来，叫做**标准库**——猫猫协会发的、不用自己写的大手册喵。

## 请手册进门：`import`

本喵想把 `math` 这本手册请进自己的程序，看看它里面有什么好用的招式：

```python
import math
print(math.sqrt(16))
print(math.floor(3.7))
```

```text
4.0
3
```

三行一行一行看喵：

- **`import math`** —— 口令 `import` 的意思是「把 `math` 这本手册请进来」。这一行习惯写在文件最上面，程序一开跑就先把手册搬进来放好；写一次，整本手册里的招式就都能用了。
- **`math.sqrt(16)`** —— 手册请进来之后，招式**不能光喊名字**：要先报**手册名**，再喊**招式名**，中间用一个小圆点 `.` 连起来。`math.sqrt` 读作「`math` 这本手册里的 `sqrt` 那一招」。`sqrt` 干的是「开平方」：投喂 16，叼回来 `4.0`。
- **`math.floor(3.7)`** —— `floor` 干的是「往下取整」：3.7 往下落到最近的一格，是 `3`。

那本喵要是偷懒，直接写 `sqrt(16)` 呢？翻译官喵会当场犯难，报错最后一行写着 `NameError: name 'sqrt' is not defined`——「本喵不认识 `sqrt` 这个名字」。为什么不认识？因为柜子里手册多得很，好几本手册里都可能有叫 `sqrt` 的招式，**只喊招式名，它不知道你喊的是哪一本**。所以这条规矩要记牢：**小圆点前面是手册名，后面是招式名，一个都不能少**喵。

::: tip 猫咪提示
`import math` 只是把手册**搬进来放好**，它**不会自动替你喊招式**。请进来之后，每用一招都得写全 `math.招式名`。记住这个读法：**小圆点前面是手册名，后面是招式名**。
:::

## 三种请法：整本请、改名请、只挑一招

请手册进门有**三种写法**，干的活都是「把别处的招式变成自己能用的」，只是请法和用法不一样喵。

**第一种：整本请进来**——就是刚才的 `import math`，用的时候写 `math.sqrt(...)`。

**第二种：整本请进来，顺手起个短名**：

```python
import math as m
print(m.sqrt(25))
print(m.floor(3.9))
```

```text
5.0
3
```

多出来的那个 `as` 读作「就叫它」：`import math as m` 的意思是「把 `math` 请进来，本喵平时就叫它 `m`」。往后 `m.sqrt` 就是刚才那个 `math.sqrt`，只是手册名短了一截。⚠️ 但**起了别名，原来那个名字就没了**：这一段里你要是再写 `math.sqrt`，Python 会当场说找不到 `math`（本喵真跑过：`NameError: name 'math' is not defined`）。**短名和原名只能留一个**。手册名太长的时候（比如以后会遇到的 `os.path`），这一招特别省事喵。

**第三种：只挑一招出来**：

```python
from math import sqrt, floor
print(sqrt(9))
print(floor(3.7))
```

```text
3.0
3
```

`from math import sqrt` 读作「从 `math` 这本手册里，把 `sqrt` 这一招挑出来」。挑出来之后，喊招式**不用再报手册名**了，直接写 `sqrt(9)` 就行。想一次挑好几招，中间用逗号隔开：`from math import sqrt, floor`。

写的时候留个心：**「整本请进来」和「挑一招出来」是两套名字**。请了整本，就得写 `math.sqrt`（起了短名的话，就用短名——原名可不能再用）；只挑了一招，就直接写 `sqrt`。混着写会翻车，本喵在下面的小框里专门说这个坑喵。

## 自己写的手册，也能被别人请

到现在请的都是 Python 出厂自带的手册。可等你写完一个 `.py` 文件，它**也是一本手册**，照样能被请。

本喵的鱼塘里有这么两个文件，**住在同一个文件夹里**：

先看 `fish_tools.py`，里面写着本喵自己的一招：

```text
def double(n):
    return n * 2
```

再看 `main.py`——这是今天要干的活，它想把 `fish_tools` 请进来用：

```text
import fish_tools

print(fish_tools.double(3))
```

跑 `main.py`，屏幕上印出 `6`。

看出门道了吗？**请自己写的手册，和请标准库的手册，写法一模一样**：一样是 `import 手册名`，一样是 `手册名.招式名`。区别只有一个——`math` 是 Python 出厂就带的，而 `fish_tools` 是**你自己那个文件夹里的 `fish_tools.py`**。注意 `import` 后面写的是**文件名去掉 `.py` 后缀**的那一截。

两个细节要盯住：

- **两个文件要住在同一个文件夹里。** 本喵要是把 `main.py` 拎到别的文件夹去跑，它当场翻脸，报错最后一行是 `ModuleNotFoundError: No module named 'fish_tools'`——「本喵翻遍了都没找着 `fish_tools` 这本手册」。手册得搁在手边，它才找得着。
- **自己写的文件名，别跟标准库的名字撞。** 你要是写了个 `random.py`，再去 `import random`，请进来的会是**你自己那本**，标准库那本反被挡在后面了。

## 好几本手册摆一格：包

招式再攒多一点，一本手册又装不下了。这时候可以把**好几本手册装进一个文件夹**——这个文件夹在 Python 里叫做**包**。

包和随便一个文件夹，看起来只差门口多放的一张纸：`__init__.py`（通常是空文件）。

本喵原先以为这张纸是**入场券**——少了它 Python 就不认这格手册柜。真跑一遍才知道想错了喵：**没有这张纸，柜子照样是柜子**，`from kit import fish_tools` 照样请得动（Python 管这种「只有文件夹、没有那张纸」的柜子叫**命名空间包**；老教程里「必须要有 `__init__.py`」那句，说的是很久以前的 Python，早改规矩了）。

那这张纸到底管什么？**它是这格柜子被打开的时候，最先跑起来的那一页**——不是入场券，是**迎宾的那一页**。柜子里没什么要迎的客，空着它一点问题没有；想在这格柜子刚被请进来的那一刻做点事（迎一句、给柜子准备点自己的东西），才非得写上它喵。

本喵的工具柜长这样：

```text
kit/
    __init__.py
    fish_tools.py
    bowl_tools.py
```

`kit` 是包（手册柜），里面的 `fish_tools.py`、`bowl_tools.py` 是模块（手册）。请柜子里的手册，**在名字中间用圆点把柜子和手册串起来**：

```text
from kit import fish_tools

print(fish_tools.double(4))
```

这一行读作「从 `kit` 这格柜子里，把 `fish_tools` 这本手册拿出来」，跑起来印出 `8`。也可以把整条路一直报到手册那一层：`import kit.fish_tools as ft`，往后写 `ft.double(4)`。

包还是**可以一层套一层**的：柜子里再放柜子，写起来就是 `小组.柜子.手册` 这样一级一级点下去。往后你做的项目大了，代码就是这么一层层分开放的喵。

本喵把门口那张纸到底管什么，真跑了两遍给你看。

**第一遍：柜子里只放手册，门口什么都不放。**

```python
import os

os.makedirs("kit", exist_ok=True)
with open(os.path.join("kit", "fish_tools.py"), "w", encoding="utf-8") as f:
    f.write("def double(n):\n    return n * 2\n")

from kit import fish_tools
print("门口没放那张纸，照样请得动：", fish_tools.double(4))
```

```text
门口没放那张纸，照样请得动： 8
```

请得动喵。所以老教程里那句「少了它 Python 就不认这个包」，在现在这版 Python 这里是**不成立**的——门口那张纸**不是入场券**。

**第二遍：门口放上那张纸，里面写一句「迎宾的话」；柜子里的手册也写一句报到的。**

```python
import os

os.makedirs("kit", exist_ok=True)
with open(os.path.join("kit", "__init__.py"), "w", encoding="utf-8") as f:
    f.write('print("门口那张纸先开了口：喵～")\n')
with open(os.path.join("kit", "bowl_tools.py"), "w", encoding="utf-8") as f:
    f.write('print("bowl_tools 这本也被请醒了")\ndef double(n):\n    return n * 2\n')

from kit import bowl_tools
print("拿到招式：", bowl_tools.double(4))
```

```text
门口那张纸先开了口：喵～
bowl_tools 这本也被请醒了
拿到招式： 8
```

看头两行的次序就懂了：`from kit import bowl_tools` 请的是柜子里的手册，可 Python 得**先把这格柜子打开**——而打开这格柜子，就是**先跑门口那张纸**。所以它喊在柜子里每一本的前头，正好用来在「这柜子刚被打开」的那一刻做点事。这也是它一边**空着也行**、一边又**值得写上**的道理喵。

这中间到底跑了几趟、谁先谁后，本喵把它拆成一步一步，走给你看：

```demo
title: 请一本手册进门，中间到底跑了几趟
code:
| import os
| 
| os.makedirs("kit", exist_ok=True)
| with open(os.path.join("kit", "__init__.py"), "w", encoding="utf-8") as f:
|     f.write('print("门口那张纸先开了口：喵～")\n')
| with open(os.path.join("kit", "bowl_tools.py"), "w", encoding="utf-8") as f:
|     f.write('print("bowl_tools 这本也被请醒了")\ndef double(n):\n    return n * 2\n')
| 
| from kit import bowl_tools
| print("拿到招式：", bowl_tools.double(4))

step 先把手边那本手册搬进来
at: 1
say: `import os` 是把 `os` 这本手册**搬进来放好** —— 后面搭柜子、往纸上写字，全靠它。⚠️ 搬进来只是搬进来，它可不会自己动手。
meow: 先把 os 这本搬进来放好喵～
pose: expect
手册柜 kit = 还没建
门口那张纸 = 还没写
柜里那本手册 = 还没写
屏幕上 = 还没印

step 把柜子搭出来
at: 3
say: `os.makedirs("kit", exist_ok=True)` 把 `kit` 这格柜子搭出来。⚠️ 搭出来的是一格**空柜子**：门口没放纸，柜里也没摆手册。
meow: 柜子搭好咯，里头空空的喵
pose: busy
手册柜 kit = 搭好了（空着）
门口那张纸 = 还没写
柜里那本手册 = 还没写
屏幕上 = 还没印

step 门口那张纸：先把纸开好
at: 4
say: `with open(...)` 这一行是把门口那张纸**开好**，顺手递给本喵一支笔（`f`）。纸是有了，可上面一个字都还没有。
meow: 纸铺开了，笔捏在爪上喵
pose: busy
手册柜 kit = 搭好了（空着）
门口那张纸 = 开好了，还是空白
柜里那本手册 = 还没写
屏幕上 = 还没印

step 往纸上抄一句 print
at: 5
say: `f.write(...)` 把「门口那张纸先开了口：喵～」这句**抄进纸里**。⚠️ **抄下来 ≠ 跑起来** —— 纸上写着要印话，可它现在只是一张纸，屏幕上什么都不会有。
meow: 抄进纸里啦，可它还没出声喵
pose: expect
手册柜 kit = 搭好了（空着）
门口那张纸 = 抄着一句 print（还没跑）
柜里那本手册 = 还没写
屏幕上 = 还没印

step 柜里那本手册也开一张纸
at: 6
say: 轮到柜子里那本 `bowl_tools.py` 了，一样先把它**开好**。柜子里的手册，就是这么一本一张纸摆进去的。
meow: 柜子里也铺一张，接着写喵
pose: busy
手册柜 kit = 搭好了（正在摆手册）
门口那张纸 = 抄着一句 print（还没跑）
柜里那本手册 = 开好了，还是空白
屏幕上 = 还没印

step 手册的肚子：一句话、一招 double
at: 7
say: 往这本里抄两样：一句要印的话，外加一招 `double`。⚠️ 还是那句话 —— 抄下来只是写在纸上，这一招**还没有谁喊过**。
meow: 招式也写进纸里，等着谁来喊喵
pose: expect
手册柜 kit = 搭好了（正在摆手册）
门口那张纸 = 抄着一句 print（还没跑）
柜里那本手册 = 抄着两样（还没跑）
屏幕上 = 还没印

step 请手册进门：柜门先开
at: 9
say: `from kit import bowl_tools` 一声令下，Python **先把这格柜子打开** —— 而打开柜子就是跑门口那张纸。所以屏幕上先响的是门口那句。⚠️ 到这一刻，柜里那本**还没醒**。
meow: 柜门一开，门口那张纸先开口喵！
pose: yay
手册柜 kit = 搭好了（门口有纸，柜里一本）
门口那张纸 = 已经跑过了，响了一句
柜里那本手册 = 写好了，还没醒
屏幕上 = 门口那张纸先开了口：喵～

step 柜里那本也醒过来
at: 9
say: 接着跑柜里那本手册的肚子：先印出「bowl_tools 这本也被请醒了」，再把 `double` 这一招挂上去。到这儿，`from ... import ...` 这一行才算干完。
meow: 手册也醒了，double 挂上啦～
pose: busy
手册柜 kit = 搭好了（门口有纸，柜里一本）
门口那张纸 = 已经跑过了，响了一句
柜里那本手册 = 醒了，double 挂好了
屏幕上 = 门口那句 + 手册那句

step 回到本喵自己这一行
at: 10
say: 请进来之后，才轮到 `print("拿到招式：", bowl_tools.double(4))`。把 4 投喂给 `double`，它叼回来 8 —— 屏幕上三句凑齐，和上面 TEXT 里那三行一模一样。
meow: 三句齐了，收工喵！
pose: proud
手册柜 kit = 搭好了（门口有纸，柜里一本）
门口那张纸 = 已经跑过了，响了一句
柜里那本手册 = 醒了，double 挂好了
屏幕上 = 三句齐了
```

**把次序记牢**：一声 `from kit import ...` 下来，**先开柜门（门口那张纸当场跑）→ 再跑柜里那本手册的肚子 → 最后才回到本喵自己这一行**。还有一句别搞混：**把话抄进文件里，不等于那句话跑过了** —— 上面九步里有六步只是在动手准备喵。

## 手册自己揣着的牌子：`__name__`

每个 `.py` 文件里，都**悄悄揣着一块写着名字的牌子**，叫做 `__name__`。这块牌子最神奇的地方在于：**同一个文件，被直接运行和被请进来的时候，牌子上写的名字不一样。**

本喵把这句话跑给你看：

```python
import math
print(__name__)
print(math.__name__)
```

```text
__main__
math
```

看仔细喵，两行完全不同：

- `print(__name__)` 念的是**正在跑的这个文件自己**的牌子。它是被**直接运行**的，所以牌子上写着 `__main__`。
- `print(math.__name__)` 念的是**请进来的那本手册**的牌子，写的是它自己的名字 `math`（还是文件名去掉 `.py` 的那一截）。

所以规矩是：**直接被运行的那个文件，`__name__` 是 `__main__`；被 `import` 进来的手册，`__name__` 是它自己的手册名。**

这句话有什么用？它能让一本手册**「自己跑是一个样，被借走用是另一个样」**——这正好是写手册的人最想要的分寸感：

```python
import math

def report():
    print(math.floor(math.pi))

if __name__ == '__main__':
    report()
```

```text
3
```

- 本喵**直接跑这个文件**的时候，牌子是 `__main__`，`if` 后面的条件成立，`report()` 被喊起来，屏幕上印出 `3`。
- 哪天这个文件被**别人 `import` 走**，牌子就换成它自己的手册名了，条件不成立，`report()` **不会自动开演**——别人只是安安静静地把招式借走，不会被本喵自己试跑的那几行吵到。

一句老话总结：**`if __name__ == '__main__':` 的意思是「只有本文件被直接运行时，才跑下面这一段」**。以后你看到别人的 `.py` 文件最后几行有这么一句，就知道下面装的是「作者自己试跑用」的内容喵。

::: warn 小心喵
三个最容易踩的坑：

- **`import` 那一行要写在文件最上面。** 写在中间不算错，但读的人得翻半天才知道这本手册是哪儿来的；写在最上面，一眼就看明白这个文件用了谁。
- **请法别混。** 写了 `from math import sqrt`，往后就**只能**直接喊 `sqrt(...)`；这时候再写 `math.sqrt(9)`，翻译官喵会甩你一句 `NameError: name 'math' is not defined`——因为 `math` 这本手册压根没请进来，你只是从它里面挑了一招走。
- **手册名别和自己写的文件名撞。** 本喵要是建一个 `random.py`，再 `import random`，请进来的是本喵自己那个文件，标准库那本反被挡在后面了。这种错最难查：程序跑得下去，只是招式全都不对喵。
:::

## 一句话对照表

| 写下的这一句 | 它干了什么 |
|---|---|
| `import math` | 把 `math` 整本手册请进来，用的时候写 `math.招式名` |
| `import math as m` | 整本请进来，顺手起个短名 `m`，往后写 `m.招式名` |
| `from math import sqrt` | 只把 `sqrt` 这一招挑出来，往后直接写 `sqrt(...)` |
| `math.sqrt(16)` | 小圆点：前面是手册名，后面是招式名 |
| `import fish_tools` | 请自己写的 `fish_tools.py`（要住在同一个文件夹里） |
| `from kit import fish_tools` | 从 `kit` 这格柜子里，把 `fish_tools` 这本手册拿出来 |
| `__name__` | 每个文件自己揣的牌子：直接运行时是 `__main__`，被请进来时是手册名 |
| `if __name__ == '__main__':` | 只有本文件被直接运行时，才跑下面这一段 |

## 小任务

本喵把今天学的东西揉进一小段，你能一眼认出每一行在干什么吗：

```python
import math as m
from math import pi

def area(r):
    return pi * r * r

if __name__ == '__main__':
    print(round(area(1), 2))
```

```text
3.14
```

`pi` 是 `math` 手册里那个圆周率，`round(数, 2)` 是「四舍五入到两位小数」。

**试着改一改**：

1. 把 `from math import pi` 删掉，改成整本手册的写法（提示：`m.pi`），看看跑出来还是不是 `3.14`。
2. 把 `if __name__ == '__main__':` 这一句删掉，只留下 `print(round(area(1), 2))`，跑一跑——再想想看：这样改完，万一别人把这个文件请走，会发生什么？
3. 自己动手建两个文件：`fish_tools.py` 里写一招 `def double(n): return n * 2`，`main.py` 里把它请进来印出 `6`。两个文件记得住在同一个文件夹里喵。

下一课，本喵要打开 Python 那格最大的柜子——**标准库**，把 `os`、`sys`、`time`、`random` 几本常用手册挨个翻一遍喵～ 🐾
