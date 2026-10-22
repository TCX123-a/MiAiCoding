---
id: python-stage2-14
lang: python
stage: 2
order: 14
title: 综合项目：文件整理小助手
tags: [综合项目, 文件整理]
required: ["python-stage2-13"]
crossRefs: []
estMinutes: 25
keywords: [os, listdir, splitext, rename, walk]
---

## 钩子：下载那一格，已经乱成一锅粥

本喵的鱼塘边有个抽屉叫「下载」，里面躺着三百样东西：猫粮的收据、鱼干的照片、本喵随手存的小纸条……想找一样东西得翻半天。

本喵想要一个小助手，喊一声它就去干三件事：**看一眼抽屉里都有什么、把名字改成整整齐齐的一串、再按种类分进小抽屉**。这三件事都归一个工具箱管 —— 前面搬过一次的 `os`。

## 先认出抽屉里有什么：`os.listdir`

```python
import os, shutil

工作台 = "小工作台"
if os.path.exists(工作台):
    shutil.rmtree(工作台)
os.makedirs(工作台)
for 名字 in ["猫1.txt", "猫2.txt", "鱼.jpg"]:
    with open(os.path.join(工作台, 名字), "w", encoding="utf-8") as 档案:
        档案.write("x")

print(sorted(os.listdir(工作台)))
```

```text
['猫1.txt', '猫2.txt', '鱼.jpg']
```

- **`os.listdir(抽屉)`** 读作「**把这个抽屉里的名字都报一遍**」，交出来的是一排名字（只是名字，不是完整路径）。
- 开头那三句是本喵的**清场**：如果上次演示的小抽屉还在，就整个扔掉（`shutil.rmtree` 是「连里面的东西一起扔」），再重新搭一个干净的。这样你每次跑出来的结果都一样喵。
- 后面的绕圈只是**替本喵铺三样东西进去**，好让下面的例子有活干。
- `sorted(...)` 不是必须的，但**加上它更稳**：抽屉里的东西本来是按系统的心情排的，本喵自己排一下就**每次都一样**了。

## 拼路径：`os.path.join`

```python
import os

路径 = os.path.join("档案室", "鱼干清单.txt")
print(os.path.basename(路径))
```

```text
鱼干清单.txt
```

想拿到抽屉里某个东西的**完整位置**，要把抽屉名和名字拼起来。本喵**不要自己拿加号拼** —— 不同系统用的分隔号不一样，自己拼容易拼错。交给 `os.path.join(抽屉, 名字)`：它按当前系统**自动用对的分隔号**。

- `os.path.join("档案室", "鱼干清单.txt")` 给出的是「档案室 + 分隔号 + 鱼干清单.txt」。
- 反过来，**`os.path.basename(完整位置)`** 是把**最后那一段**单独取出来，也就是东西的名字本身。

## 拆名字：`os.path.splitext`

想把「猫1.txt」改成别的时候，常常要**把名字和后缀分开**：

```python
import os

print(os.path.splitext("猫1.txt"))
print(os.path.splitext("鱼干"))
```

```text
('猫1', '.txt')
('鱼干', '')
```

`os.path.splitext(名字)` 交出**一对**东西：前面是**主体**（名字里去掉后缀的那一段），后面是**后缀**（带着那个小数点）。写 `主体, 后缀 = os.path.splitext(名字)`，两样就分别接到手里了。

第二个例子里「鱼干」没有后缀，所以后半截是个**空的一段**（印出来什么都没有）。本喵留个心：空的一截说明这东西压根没后缀喵。

## 问一句「在不在」：`exists` 和 `isfile`

动手之前先问一声，能少踩很多坑：

```python
import os

os.makedirs("小仓库", exist_ok=True)
print(os.path.exists("小仓库"))
print(os.path.exists("没有这个.txt"))
```

```text
True
False
```

- **`os.path.exists(完整位置)`** —— 「这东西在不在？」在就 `True`，不在就 `False`。**问一句，总比动手了才发现扑空好。**
- **`os.path.isfile(完整位置)`** —— 「它是**一样东西**，还是一个**抽屉**？」目录也算「在」，可它不是文件；整理的时候常常要把目录挑出来放一边。
- 顺便认一个老朋友：`os.makedirs(抽屉, exist_ok=True)` 是「把这个抽屉搭起来」；`exist_ok=True` 的意思是「**已经有了就拉倒，别报错**」。

## 批量改名字：`os.rename`

```python
import os, shutil

工作台 = "小工作台"
if os.path.exists(工作台):
    shutil.rmtree(工作台)
os.makedirs(工作台)
for 名字 in ["a.txt", "b.txt", "c.txt"]:
    with open(os.path.join(工作台, 名字), "w", encoding="utf-8") as 档案:
        档案.write("x")

序号 = 0
for 名字 in sorted(os.listdir(工作台)):
    序号 = 序号 + 1
    主体, 后缀 = os.path.splitext(名字)
    os.rename(os.path.join(工作台, 名字), os.path.join(工作台, f"鱼干{序号:02d}{后缀}"))

print(sorted(os.listdir(工作台)))
```

```text
['鱼干01.txt', '鱼干02.txt', '鱼干03.txt']
```

- **`os.rename(老位置, 新位置)`** —— 「从老位置搬到新位置」，名字也就跟着变了。这是本喵批量改名的主力。
- 绕圈里三件事按顺序：**先报数**（`序号 = 序号 + 1`）→ **拆出后缀**（`splitext`，这样改名之后后缀还在，东西还是能被别的程序认得）→ **造新名字 + 搬**。
- `f"鱼干{序号:02d}{后缀}"` 里的 `{序号:02d}` 读作「**至少两位，不够的左边补 0**」。所以第一位是 `鱼干01`。这么写是为了排排坐时不乱：写成 `鱼干1`、`鱼干10`、`鱼干2` 的话，按名字排出来顺序就乱了喵。

## 只挑某一种：`名字.endswith(...)`

抽屉里不是每样都要动。想只挑照片，就问名字「**你以 `.jpg` 收尾吗**」：

```python
import os, shutil

工作台 = "小工作台"
if os.path.exists(工作台):
    shutil.rmtree(工作台)
os.makedirs(工作台)
for 名字 in ["猫1.txt", "鱼.jpg", "猫2.txt"]:
    with open(os.path.join(工作台, 名字), "w", encoding="utf-8") as 档案:
        档案.write("x")

for 名字 in sorted(os.listdir(工作台)):
    if 名字.endswith(".jpg"):
        print("照片：", 名字)
```

```text
照片： 鱼.jpg
```

- **`名字.endswith(".jpg")`** 读作「**这段字是不是以 `.jpg` 收尾**」，是就给 `True`。配上 `if`，就能只对某一种后缀动手。
- 它的反面是 `startswith`（「是不是以它打头」）。两个都常用来给名字把关。
- 反过来写「不是就跳过」也很顺：`if not 名字.endswith(".jpg"): continue` —— `continue` 是「这一圈到此为止，下一圈」，比整段塞进 `if` 里少一层缩进喵。

## 分抽屉：按后缀归类

现在把三件事串起来 —— **看名字、拆后缀、搬进对应的小抽屉**：

```python
import os, shutil

工作台 = "小工作台"
if os.path.exists(工作台):
    shutil.rmtree(工作台)
os.makedirs(工作台)
for 名字 in ["猫1.txt", "鱼.jpg"]:
    with open(os.path.join(工作台, 名字), "w", encoding="utf-8") as 档案:
        档案.write("x")

for 名字 in sorted(os.listdir(工作台)):
    完整路径 = os.path.join(工作台, 名字)
    if not os.path.isfile(完整路径):
        continue
    主体, 后缀 = os.path.splitext(名字)
    if not 后缀:
        continue
    抽屉 = os.path.join(工作台, 后缀.lstrip("."))
    os.makedirs(抽屉, exist_ok=True)
    os.rename(完整路径, os.path.join(抽屉, 名字))

print(sorted(os.listdir(工作台)))
print(sorted(os.listdir(os.path.join(工作台, "jpg"))))
print(sorted(os.listdir(os.path.join(工作台, "txt"))))
```

```text
['jpg', 'txt']
['鱼.jpg']
['猫1.txt']
```

一句句看：

1. `完整路径 = os.path.join(工作台, 名字)` —— 先把完整位置拼好，下面反复要用。
2. `if not os.path.isfile(完整路径): continue` —— **不是东西（是个抽屉）就跳过**。少了这一关，本喵会把刚分好的小抽屉当成文件再搬一次，越搬越乱。
3. `主体, 后缀 = os.path.splitext(名字)` —— 拆出后缀。
4. `if not 后缀: continue` —— **没有后缀的也跳过**（`splitext` 给了个空的一段）。
5. `抽屉 = os.path.join(工作台, 后缀.lstrip("."))` —— `.txt` 前面的那个点是**后缀的记号**，做抽屉名的时候要去掉：`.lstrip(".")` 就是「把左边的点削掉」。
6. `os.makedirs(抽屉, exist_ok=True)` —— 抽屉没有就先搭一个；已经有了就拉倒。
7. `os.rename(...)` —— 搬进去。

## 一层层逛：`os.walk`

小抽屉里还能再套小抽屉。想把**里里外外**全逛一遍，用 `os.walk`：

```python
import os, shutil

工作台 = "小工作台"
if os.path.exists(工作台):
    shutil.rmtree(工作台)
os.makedirs(os.path.join(工作台, "里屋"))
for 名字 in ["猫1.txt", os.path.join("里屋", "鱼.jpg")]:
    with open(os.path.join(工作台, 名字), "w", encoding="utf-8") as 档案:
        档案.write("x")

全部文件 = 0
for 当前层, 子文件夹们, 文件们 in os.walk(工作台):
    print("本层有子抽屉", len(子文件夹们), "个，文件", sorted(文件们))
    全部文件 = 全部文件 + len(文件们)

print("一共", 全部文件, "个文件")
```

```text
本层有子抽屉 1 个，文件 ['猫1.txt']
本层有子抽屉 0 个，文件 ['鱼.jpg']
一共 2 个文件
```

- **`os.walk(抽屉)`** 会**一层一层往里逛**，每逛到一层就交出**三样东西**：这一层的完整位置、这一层里的子抽屉们、这一层里的文件们。三个名字用逗号接住就成。
- 它自己会越走越深，本喵**不用写两层绕圈** —— 这就是它值钱的地方。
- 想让「逛」的顺序每次都看得一样，把接住的那一排**自己排一下**（`sorted(文件们)`）最省心喵。

::: tip 猫咪提示
- **`os.listdir(抽屉)`** —— 报出这一层所有的名字（只有名字，没有完整位置）。
- **`os.path.join(抽屉, 名字)`** —— 拼完整位置，分隔号交给它自己挑，别手拼。
- **`os.path.splitext(名字)`** —— 拆成「主体」和「后缀」两样。
- **`os.path.exists` / `os.path.isfile`** —— 「在不在」和「是不是一样东西」，动手前先问。
- **`os.rename(老位置, 新位置)`** —— 搬家兼改名。
- **`名字.endswith(".jpg")`** —— 只挑某一种后缀。
- **`os.walk(抽屉)`** —— 一层层全逛遍，每层给「位置、子抽屉、文件」三样。
:::

::: warn 小心喵
- **自己拿加号拼位置** —— 换个系统分隔号就不一样了，坑的是自己。一律 `os.path.join`。
- **忘了 `exist_ok=True`** —— 抽屉已经在了还硬搭，会当场翻脸。想省心就把它带上。
- **搬家前不先看一眼** —— 目标名字已经有人占了的时候，有的系统会盖掉、有的会翻脸报错。动手前先 `os.path.exists` 问一声，稳当。
- **忘了把后缀带上** —— 新名字只写 `f"鱼干{序号}"`，后缀就丢了，东西打不开了。`splitext` 拆出来的那半截记得接回去。
- **把演示当真去理自己的抽屉** —— 这些例子里本喵会**先清场再铺东西**，为的是让你每次都看到一样的结果。真拿去理自己的东西之前，**先在副本上试一遍**喵：改名字是不可逆的，手一滑就找不回来了。
:::

## 一句话对照表

| 写下的这一句 | 它干了什么 |
|---|---|
| `os.listdir(工作台)` | 报出这一层所有的名字 |
| `os.path.join(工作台, 名字)` | 拼完整位置，分隔号它自己挑 |
| `os.path.basename(完整位置)` | 只取最后那一段名字 |
| `os.path.splitext(名字)` | 拆成主体和后缀两样 |
| `os.path.exists` / `os.path.isfile` | 在不在 / 是不是一样东西 |
| `os.rename(老, 新)` | 搬家兼改名 |
| `名字.endswith(".jpg")` | 是不是以它收尾 |
| `os.walk(工作台)` | 一层层逛，每层交三样 |

## 小任务

本喵要给一堆照片重新编号，别的文件一根手指都不碰：

```python
import os, shutil

工作台 = "小工作台"
if os.path.exists(工作台):
    shutil.rmtree(工作台)
os.makedirs(工作台)
for 名字 in ["IMG_01.jpg", "IMG_02.jpg", "note.txt"]:
    with open(os.path.join(工作台, 名字), "w", encoding="utf-8") as 档案:
        档案.write("x")

序号 = 0
for 名字 in sorted(os.listdir(工作台)):
    if not 名字.endswith(".jpg"):
        continue
    序号 = 序号 + 1
    os.rename(os.path.join(工作台, 名字), os.path.join(工作台, f"照片{序号:02d}.jpg"))

print(sorted(os.listdir(工作台)))
```

```text
['note.txt', '照片01.jpg', '照片02.jpg']
```

**试着改一改**：

1. 把编号改成三位（`{序号:03d}`），看看名字变成什么样。
2. 把那一句 `if not 名字.endswith(".jpg"): continue` 删掉，再跑一遍 —— 本喵的 `note.txt` 会怎么样？为什么？
3. 把 `os.rename(...)` 换成「分抽屉」那种写法，让 `.jpg` 全进「照片」抽屉、`.txt` 全进「纸条」抽屉。

往后本喵要做这一阶段的**收官作品**：一本能存下来、下次打开还在的通讯录。里头会把今天这套「认抽屉、动档案」的本事，和分派命令、接住毛病揉成一个小工具喵～ 🐾
