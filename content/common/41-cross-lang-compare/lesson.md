---
id: common-41
lang: common
stage: 0
order: 41
title: 四种方言四种规矩——跨语言规范对照
tags: [代码规范, 工程素养]
required: ["common-40"]
crossRefs: ["common-40","java-stage3-26","python-stage3-23","cpp-stage3-28"]
estMinutes: 18
keywords: [naming-styles, pep8, google-style]
---

## 钩子：一桌麻将，四个名字

上一课的规矩练到落笔：名字要说人话。可说人话的**口音**，四门语言各有各的偏爱。本喵今天帮朋友查一个项目：同一个「用户的名字」，翻过一份文件是 `user_name`，隔壁文件是 `userName`，再隔壁站着 `UserName`，常量区里还杵着一个 `USER_NAME` —— 好家伙，**一桌麻将四种写法**。

读代码的人每翻一页都要停下来问一遍：这四个是同一个东西吗？是谁写错的，还是故意的？

其实四个都没错 —— 错的是它们**躺在同一个项目里**。今天本喵把四门语言的「方言」摆成一排给你看：谁用下划线、谁爱抬头、谁这么写才体面。看懂了这套对照，读到任何一门语言的代码，你都能一眼看出「这是不是照着它家规矩写的」喵。

## 三种起名长相

先把「长相」认全，一共三种，外加一个全家福。

- **小驼峰** `userName`：头一个字低着，后面每个词的首字母抬头。抬头的地方像骆驼的驼峰，名字就这么来的；
- **大驼峰** `UserName`：每个词的头都抬着，连第一个词也不低头；
- **下划线串** `user_name`：词和词用小短线（下划线）缝合，全小写；
- 再加一张「全家福」：**全大写加下划线** `USER_NAME` —— 一般留给「定了就不动的值」当座位。

同一条信息，三种长相。认得出长相，才读得懂下一条：**哪门语言喜欢哪张脸。**

## 四语言命名对照表

本课最值钱的一张表 —— 建议抄进笔记本喵：

| 要起名的东西 | Java | Python | C++ | C |
|---|---|---|---|---|
| 大结构 / 角色的名 | `UserName` 大驼峰 | `UserName` 大驼峰 | `UserName` 大驼峰 | 全小写下划线（多数派） |
| 招式的名 | `sumTo` 小驼峰 | `sum_to` 下划线 | `SumTo` 大驼峰 | `sum_to` 下划线 |
| 仓库的名 | `totalFish` 小驼峰 | `total_fish` 下划线 | `total_fish` 下划线 | `total_fish` 下划线 |
| 常量 | `MAX_FISH_PER_DAY` 全大写 | `MAX_FISH_PER_DAY` 全大写 | `kMaxFishPerDay` k 打头 | 宏用全大写 `MAX_FISH_PER_DAY` |
| 包 / 模块 / 命名空间 | 包名全小写 `com.example.fish` | 模块名全小写 `fish_basket` | 命名空间全小写 `fish_land` | 头文件名全小写 `fish_basket.h` |
| 自家不公开的格子 | 一视同仁，不加记号 | 前面加一个下划线 `_count` | 尾上挂一个下划线 `count_` | 靠文件里的摆放来分内外 |

一句话看穿这张表：

- **Java**：能抬头的都抬头 —— 大结构抬头、招式的小驼峰、常量全大写；**名字里不碰下划线串 —— 只有常量的全大写拿它隔词**；
- **Python**：一切用下划线 —— 招式、仓库、模块全下划线，只有大结构破例抬头；
- **C++**：招式名抬头（大驼峰）、仓库低头（下划线），**常量用 `k` 打头**（Google 家的招牌），成员尾巴挂下划线；
- **C**：没有一本全体认领的公约，多数派是「全小写下划线」，其余随**项目家规** —— C 那一列的细则，语言线《C 代码的体面——工程规范精讲》会拆开讲。

表里还有一条**共同线**：四家都不许拼音、不许中文。口音能吵，这条底线谁都翻不了。

## 各家的「尺子」从哪来

规矩不是天上掉的，每一门语言背后都搁着一本「尺子」。本喵把出处报给你喵：

- **Java**：**阿里巴巴**发布的《Java 开发手册（黄山版）》—— 命名风格一节立了 19 条，条文还分了【强制】【推荐】【参考】三档，刷题圈、面试圈人手一份的那种；
- **Python**：**PEP 8** —— Python 的「社区公约」，是官方提案库里编号 8 的那一份（PEP = Python 增强提案），讲缩进、讲命名、讲注释、讲空格，Python 人吵风格题的最终裁判；
- **C++**：**Google C++ Style Guide** —— 谷歌开源在网站上的那份，招式抬头、常量 `k` 打头、成员尾下划线，都是它家的条文；
- **C**：**没有一本全体认领的公约** —— 大到每个项目可以有自己的家规。所以这张表上，C 那一列写的都是「多数派」，细活得看你进的这个项目贴的是哪张告示。

发现没有：**尺子不止一把，且互相不服。** 但这些只是参考坐标 —— 具体听谁的，收尾那一节有定论喵。

## 让工具替你守规矩

规矩写在纸上容易，压在手上难 —— 好在有工具替你守一半：

- **IDEA**（Java 的主场）：把乱排的文件选中，`Ctrl+Alt+L`（Reformat Code）一键整理 —— 缩进、空格、空行，当场归位；
- **Python 圈**：最出名的是 **black** —— 江湖人称「不谈判的格式化器」，它排出来的样子说一不二（默认按 88 列收行）；**flake8**、**pylint** 则是检查器，专门挑「藏着坏味道的写法」；
- **C / C++ 圈**：**clang-format** 管排版（缩进、空格、换行一条条对齐），**clang-tidy** 挑毛病。

装好之后，用法都是同一副样子：

```text
python -m black main.py
python -m flake8 main.py
clang-format -i main.cpp
```

`black` 和 `flake8` 本机已经就位、拎起来就能跑；`clang-format` 本机还没装 —— 它和 `clang-tidy` 一样，跟着 LLVM/clang 工具链一起来，想试第三条，先把那套装上喵。

但工具只能守到一条线，说透它喵：**格式化器守得住「形状」，守不住「含义」** —— 缩进乱、空格歪、行长超标，它一秒扶正；可名字起得好不好、注释有没有说人话，它管不了。**工具是底线，人是天花板。**

## 反例席：丑名字照样跑

有人会问：规矩这么严，不照规矩起名，程序是不是就废了？本喵上实例 —— 这段名字横跨拼音、英文、缩写三界喵：

```java
public class Main {
    static int Yu_count = 3;

    static int js(int a) {
        return Yu_count * a;
    }

    public static void main(String[] args) {
        System.out.println(js(2) + js(1));
    }
}
```

```text
9
```

翻译官喵看都不看名字，印出来 `9`（本喵真跑过）。**名字丑，程序照跑** —— 这是「丑名字」最迷惑人的地方：当场没有任何报错。可 `js` 是「计算」还是「结束」？`Yu_count` 数的是鱼还是余额？下一位读代码的人，只能在心里骂一句，然后一行行猜喵。

同一张桌子的另一角坐着三位亲戚：`class fishBank` 里并排摆着 `static final int maxFishPerDay = 3;` 和 `int Fish_Count = 0;` —— 能编译、无报错，可三个名字像三家人挤在同一张桌上，谁都不认识谁。

## 同一件小事，四种方言各写各的名字

看活的。同一件小事 —— **今天还能不能再吃一条鱼** —— 四门语言带着各自的口音上桌：

```compare
c::
#include <stdio.h>

#define MAX_FISH_PER_DAY 3

int can_add_more(int eaten) {
    return eaten < MAX_FISH_PER_DAY;
}

int main(void) {
    if (can_add_more(2)) {
        printf("四种方言，一个意思喵\n");
    }
    return 0;
}

cpp::
#include <iostream>

const int kMaxFishPerDay = 3;

bool CanAddMore(int eaten) {
    return eaten < kMaxFishPerDay;
}

int main() {
    if (CanAddMore(2)) {
        std::cout << "四种方言，一个意思喵" << std::endl;
    }
    return 0;
}

java::
public class Main {
    static final int MAX_FISH_PER_DAY = 3;

    static boolean canAddMore(int eaten) {
        return eaten < MAX_FISH_PER_DAY;
    }

    public static void main(String[] args) {
        if (canAddMore(2)) {
            System.out.println("四种方言，一个意思喵");
        }
    }
}

python::
MAX_FISH_PER_DAY = 3


def can_add_more(eaten):
    return eaten < MAX_FISH_PER_DAY


if can_add_more(2):
    print("四种方言，一个意思喵")
```

```text
四种方言，一个意思喵
```

四段本喵全真跑过，输出逐字相同。对着刚才那张表验收一遍喵：

- **C**：常量是宏，全大写 `MAX_FISH_PER_DAY`；招式全小写下划线 `can_add_more` —— 多数派站稳；
- **C++**：同一个常量换了招牌 —— `kMaxFishPerDay` 的 `k` 是 Google 家的记号；招式 `CanAddMore` 抬了头；
- **Java**：常量全大写、单词间用下划线隔开（`MAX_FISH_PER_DAY`），招式小驼峰 `canAddMore` —— 除了常量，名字里一个下划线都没有；
- **Python**：全下划线 —— `can_add_more`，常量全大写。

同一个意思，四种口音，**跑出来的话一模一样**。方言不是对错题，是**入乡随俗题**喵。

## 规范会吵架，但「一致」赢过「个人偏好」

Python 人看 `totalFish` 别扭，Java 人看 `total_fish` 手痒 —— 两边吵了二十年，谁也没说服谁。所以本喵给你一条**终审级**的规矩，比任何一把尺子都高：

**同一个项目里里外外保持一致 —— 一致比「谁对」更重要。**

- 新文件跟同目录的老文件**一个口音**：邻居用下划线，你就别夹着驼峰串门；
- 老项目里**别顺手掀桌**：风格统一的好处，胜过你个人审美的说服力；
- 真的两派僵住了？定一个，写下来，**然后全队照办**。混着写才是真正的灾难 —— 那才是一桌麻将的由来。

Google 的 C++ 指南里有一句常被摆出来的话，大意是「**为读代码的人优化**，别为炫技选写法」；PEP 8 也把「一致」拎出来单独强调过。毕竟规范这门手艺的全部意义，在上一课就立住了：**代码是写给人看的。**

::: tip 猫咪提示
四种方言，一句话收好喵：

1. **三种长相** —— 小驼峰 `userName`、大驼峰 `UserName`、下划线 `user_name`，外加全大写 `USER_NAME`；
2. **四家口音看表** —— Java 不碰下划线串（常量里隔词的下划线除外）、Python 全下划线、C++ 常量 `k` 打头、C 随项目家规；
3. **三把尺子** —— 阿里手册（Java）、PEP 8（Python）、Google C++ Style（C++）；
4. **工具管形状，人管含义** —— 格式化器扶得正排版，扶不起名字；
5. **一致 > 个人偏好** —— 进谁的地盘，说谁的话。
:::

::: warn 小心喵
两个坑别踩：**混着写**（一个文件里四种长相并存，读者的眼睛当场散架）、**拿大厂当令箭**（「某某厂就这么写」不是理由 —— 先看这个项目自家贴的哪张告示）喵。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `userName` / `UserName` / `user_name` / `USER_NAME` | 四种长相：小驼峰、大驼峰、下划线、全大写 |
| `kMaxFishPerDay` | C++ 家的常量招牌（`k` 打头） |
| `MAX_FISH_PER_DAY` | Java / Python 家的常量写法（全大写） |
| 阿里手册 / PEP 8 / Google C++ Style | 三把尺子的门牌：Java、Python、C++ |
| 「工具管形状，人管含义」 | black、clang-format 扶正排版，扶不起起名 |
| 「一致 > 个人偏好」 | 吵架可以，混着写不行 |

## 小任务

1. **动脑**：把课文里的 `sum_to` 分别「翻译」成 Java、C++、Python 各自的口音，再对照表验收（答案就藏在表里喵）。
2. **动手**：打开 `Main.java` 随手把缩进、空格糟蹋一通，然后在 IDEA 里按 `Ctrl+Alt+L`（Reformat Code），看它怎么替你把形状扶正 —— 顺便体会「工具能管的」和「工具管不了的」那条分界。
3. **再动手**：翻你自己的一个项目文件夹，数一数里面混了几种方言；挑出现最多的一种当「全项目口音」，把不一样的写法改齐，改完把项目跑一遍确认安然无恙。

到这里，「规范」这条线就走完收工了喵 —— 从「代码是写给人看的」立规矩，到「起名与注释」练手艺，再到今天把四门语言的方言摆成一排。往后往深里走，每门语言线都有一课接着讲：Java 线《阿里巴巴的尺子——Java 命名规范精讲》、Python 线《PEP 8——Python 社区的公约》、C++ 线《谷歌的尺子——Google C++ Style 精讲》、C 线《C 代码的体面——工程规范精讲》。四把尺子，逐个升级喵～ 🐾
