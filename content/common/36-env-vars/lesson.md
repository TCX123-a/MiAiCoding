---
id: common-36
lang: common
stage: 0
order: 36
title: 门牌号与路标——环境变量与 PATH
tags: [工具链, 命令行]
required: ["common-35"]
crossRefs: ["common-35","java-stage1-18","python-stage3-21"]
estMinutes: 18
keywords: [environment-variable, path, command-line]
---

## 钩子：你敲的字，电脑凭什么认得

上一课临走时，本喵把「环境」拆成两问一半：住哪、怎么找到、谁上场——「怎么找到」这个尾巴，今天拎出来看。

先看一件天天发生、细想却有点神奇的事。你敲下一行：

```text
python --version
```

本喵这台电脑的回话是：

```text
Python 3.12.10
```

它认得。可要是本喵敲隔壁老王的名字，它就两手一摊。同样是几个字，它凭什么有的认、有的不认喵？

秘密就藏在一摞**给程序看的小纸条**、和一张**路牌清单**里。

## 给程序看的小纸条

电脑里常贴着一摞**纸条**——给程序看的，不是给人看的。每张一个样：

**名字 = 内容**

比如「系统是谁家的」那张：`OS` = `Windows_NT`；「临时文件放哪」那张：`TEMP` = 一长串文件夹。程序一出生，系统就把当时贴着的一摞纸条递给它看。这类纸条，术语叫**环境变量（给程序看的小纸条）**——你在 PowerShell 里读它们的统一写法是 `$env:名字`。

谁在读？几乎每个程序都随手看两眼：终端窗口看、编辑器看、翻译官喵也看（下一节就有四位翻译官喵的演出）。纸条上写着什么，程序的做法就跟着变——「环境」这个词，一半的来源就在这儿；另一半，是上一课那句「谁上场」。

## 路牌清单：PATH

纸条里最出名的一张叫 **PATH**——本喵管它叫**路牌清单**。它的内容是一串文件夹的地址，用分号隔开，一家一家排着队。

你敲一个名字，系统就拿着这张清单从第一家问起：这家住着叫这个名字的吗？有，就请它出来干活；一家家问完全都没有——屏幕上就回你一句「找不到」。上一课说「电脑怎么找到它」，答案就是这张清单喵。下一节三件套的第一件，就把它整张请出来看。

## 命令为什么会「找不到」——三种真凶

「找不到」几乎是所有工程新人的第一道坎。别慌——本喵教你按一句话的顺序盘问：**先想名字 → 再查装没装 → 最后翻路牌。** 三句话对上三种真凶：

- **真凶一：没装。** 本机敲 `conda`、敲 `mvn`，都不认：真的没装。conda 没有；Maven 也没有独立安装（但 IDEA 大宅子里住着它自家的一份，第 38 课点名）。这一位解法最省心：装了就解决一半。
- **真凶二：装了，没挂路牌。** 东西在家，可路牌上没挂它家的地址，系统就当你没装。本机有一对活标本：Dev-C++ 里住着一位老翻译官喵（TDM-GCC 4.9.2），可路牌上挂的却是练习场自带那套新 `gcc`（16.1.0）——所以在窗口里敲 `gcc`，出来的永远是新的那位；想喊老的，得写全它家的门牌（第 37 课讲它的故事）。
- **真凶三：名字对不上。** 工具在家、路牌也挂着，差的就是一个名字。本机现成的一对：C 系管家不叫 `make`，叫 `mingw32-make`；还有更妙的——在 PowerShell 里单敲 `where`，会被认成另一位同名家伙（一个筛子），它既不找东西、也不报错，**静默交白卷**。想看「这个名字到底在哪几家」，得敲全名 `where.exe`——三件套里就演示。

为什么把「名字」放最前面问？因为它最便宜：拼写、小尾巴，扫一眼就知道。三件套，就是拿来查后两样的。

## 查看三件套（PowerShell 窗口）

「看」是今天全部的家当；「改」要留到以后有明确目标再动。三件套，都只看不改：

**第一件：看整张路牌清单。**

```text
echo $env:PATH
```

本喵从回话里掐头去尾抽一段给你看（省略的地方本喵点了小点；原文是一行，三十来家排在一起）：

```text
……C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot\bin;……（中间还有二十来家）……;C:\Users\你的用户名\AppData\Local\MiAiBianCheng\toolchain\winlibs\mingw64\bin;……
```

上一课本机地图里的两张门牌，都在队里站着：Java 的家伙什、练习场自带的那套——清单上挂着名字的，敲了才有人应。

**第二件：问「叫这个名字的家伙都在哪几家」。**

```text
where.exe python
```

回话（本喵只把用户名换成了占位符；两行都在）：

```text
C:\Users\你的用户名\AppData\Local\Programs\Python\Python312\python.exe
C:\Users\你的用户名\AppData\Local\Microsoft\WindowsApps\python.exe
```

两行都是真的：第二行是微软商店留的转交点，平时真上场的还是排在前面的那一位——**排在前面的赢**。哦对，这里还藏着一个坑：要是把命令写成 `where python`（少个 .exe），它会不出声也不报错——因为 `where` 在这个窗口里是另一个家伙的小名（一个筛子）。别怀疑电脑坏了，是名字认错了人。

**第三件：问「现在真正会被叫到的，是哪一只」。**

```text
Get-Command python
```

回话（用户名换成占位符，表格排紧凑了一点）：

```text
Application  python.exe  3.12.10  C:\Users\你的用户名\AppData\Local\Programs\Python\Python312\python.exe
```

Source 那一列就是它的门牌。想查一个名字的案底，看这一张最快。

**附赠一件：把一摞纸条全摆出来看。**

```text
Get-ChildItem Env:
```

回话（用户名同样换成占位符；本喵从中间挑两行，纸条们按名字排着长队）：

```text
Name         Value
----         -----
OS           Windows_NT
……
TEMP         C:\Users\你的用户名\AppData\Local\Temp
```

现在你已经会读它了：左边是纸条的名字，右边是内容。

## 收尾的安全线

三件套学会了，手别急着伸去改系统路牌——那玩意儿是很多软件共用的：手一抖删错一段，一堆命令集体失踪，捞回来够你出一身汗。真到要改的那天：**先备份、写清楚为什么改、拿不准就先别动。**

想过一把「递纸条」的瘾，有一条安全的道儿：给**当前窗口**贴一张临时纸条——

```text
$env:FISH_HOME = "D:\fish"
```

它只在当下这个窗口里贴得住，窗口一关，纸条就没了，系统毫发无伤。贴完想知道成没成，顺手 `Get-ChildItem Env:` 找找它——小任务里有。

练习场这边你更不用怕：它固定用自带那套家伙什、不看你在系统里怎么折腾（上一课的地图说过）喵。

## 验收一下：四位翻译官喵，读同一张纸条

纸条不只是窗口在看——四位翻译官喵也都会读。本喵出一道演习：问它们一张电脑上**根本没有**的纸条 `FISH_HOME` 在不在。写法各叫各的名，回话应该一字不差：

```compare
c::
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    if (getenv("FISH_HOME") != NULL) {
        printf("FISH_HOME 在喵\n");
    } else {
        printf("FISH_HOME 不在喵\n");
    }
    return 0;
}

cpp::
#include <iostream>
#include <cstdlib>
using namespace std;

int main() {
    if (getenv("FISH_HOME") != NULL) {
        cout << "FISH_HOME 在喵" << endl;
    } else {
        cout << "FISH_HOME 不在喵" << endl;
    }
    return 0;
}

java::
class Main {
    public static void main(String[] args) {
        if (System.getenv("FISH_HOME") != null) {
            System.out.println("FISH_HOME 在喵");
        } else {
            System.out.println("FISH_HOME 不在喵");
        }
    }
}

python::
import os

if os.environ.get("FISH_HOME") is not None:
    print("FISH_HOME 在喵")
else:
    print("FISH_HOME 不在喵")
```

```text
FISH_HOME 不在喵
```

读纸条的姿势各叫各名：C 和 C++ 都喊 `getenv`、Java 喊 `System.getenv`、Python 喊 `os.environ.get`——名字不同，读的都是同一张纸条。Python 那句还带个小本事：`os.environ.get("名字", "默认句")`——纸条不在，就回你写好的默认句，题目里用得到。

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| 小纸条（`名字 = 内容`） | 给程序看的一条信息；系统递给每个新出生的程序 |
| `PATH` | 路牌清单：敲名字时，系统拿着它一家一家找 |
| 「找不到」的真凶 | 没装 / 装了没挂路牌 / 名字对不上（外加小名顶替的坑） |
| `echo $env:PATH` | 看整张路牌清单 |
| `where.exe python` | 叫这个名字的家伙都在哪几家（排在前面的赢） |
| `Get-Command python` | 现在真正会被叫到的，是哪一只（Source 列是门牌） |
| `Get-ChildItem Env:` | 把一摞小纸条全摆出来看 |
| `$env:FISH_HOME = "D:\fish"` | 只给当前窗口贴一张临时纸条，关窗即失 |

## 小任务

1. **动脑**：本机敲 `make` 不认，敲 `mingw32-make` 就动。按三真凶盘问：这属于哪一种？为什么不是「没装」？
2. **动手（只玩安全的那半）**：在 PowerShell 里贴上临时纸条 `$env:FISH_HOME = "D:\fish"`，再敲 `Get-ChildItem Env:` 找找 `FISH_HOME` 在不在；关掉窗口重开一个，再找一次——它去哪了喵？
3. **再动手**：把上面 Python 那段抄进练习场，把纸条名字换一个（比如 `FISH_HOME2`），先猜它会回哪句，再跑对照。

纸条要会读，路牌要会看——这两样练熟，下一课本喵带你去拆那只天天按的「运行」按钮：《写代码的软件——编辑器、IDE 与配置思维》，见喵～ 🐾
