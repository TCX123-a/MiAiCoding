---
id: c-stage3-19
lang: c
stage: 3
order: 19
title: 一张纸写不下——多文件编译与头源分工
tags: ["工具链", "工程组织"]
required: ["c-stage3-18"]
compare: ["common-35"]
estMinutes: 25
keywords: [多文件, 头文件, 声明, 目标文件, 链接, 工程组织]
---

## 钩子：一张纸写不下

上回说到，大肥鱼把「一排指向牌」的本事收进了兜里。它的鱼干账本也一路长大 —— **主流程、算总数的招式、打印结果的话，全挤在一个 `main.c` 里**。想改「算总数」那几步，得先在一百多行里翻到它；两只手同时往上添东西，更容易撞在一起。

大肥鱼盯着屏幕直摇头：「这代码写得太丑啦喵！」

本喵的办法朴素得很：**一张纸写不下，就拆成三本** —— 这正是所有正经 C 工程的样子。这活上一阶段「多文件编译与头文件」那一课已经打过底，今天把它捡起来真刀真枪干一遍：把一个大文件拆成一组小文件，再让翻译官喵把它们拼回一个能跑的程序。

## 一、先看看现在的全貌

拆之前是这样 —— 一个文件、一个完整程序：

```c
#include <stdio.h>

int total_fish(int bowls[], int count) {
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += bowls[i];
    }
    return sum;
}

int main(void) {
    int bowls[3] = {2, 5, 3};
    printf("一共 %d 条小鱼干\n", total_fish(bowls, 3));
    return 0;
}
```

```text
一共 10 条小鱼干
```

（本喵在这台机器上真跑出来的，命令就是本项目的标准那一条：`gcc -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu11 -o prog.exe main.c && ./prog.exe`。）

它能跑，可有三个别扭：

- **找东西翻页**：想看一眼「算总数」是怎么写的，得从一百多行里捞；
- **改动要小心**：「算总数」那几步和主流程挨着住，手一滑就改到隔壁；
- **复用难**：想在另一个本子里也用「算总数」，只能整段复制 —— 复制出去的那份，将来改哪边都说不清。

三个别扭指向同一件事：**这个文件担的活儿太多了**。动手拆之前，先把上一阶段那一课的口令捡回来 —— 它是拆家的地基。

## 二、把老口令捡回来：先挂招牌（声明）

先看一个实验。这一版里，「算总数」的做法**挪到了 `main` 后面**，前面只留一句话：

```c
#include <stdio.h>

int total_fish(int bowls[], int count);

int main(void) {
    int bowls[3] = {2, 5, 3};
    printf("一共 %d 条小鱼干\n", total_fish(bowls, 3));
    return 0;
}

int total_fish(int bowls[], int count) {
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += bowls[i];
    }
    return sum;
}
```

```text
一共 10 条小鱼干
```

能跑！关键在第 3 行：

```text
int total_fish(int bowls[], int count);
```

这一行后面**没有大括号** —— 它不是在干活，是在**挂招牌**：本喵跟翻译官喵交代「有这么一招，叫 `total_fish`，收一排碗和条数，会吐一个整数出来；做法不在这，等会儿你就见着」。

它的正名叫 **声明（declaration）**，长相就是「把做法里第一行原样抄一遍，尾巴上加个分号」。有了它，翻译官喵从上往下读稿子的时候，碰见喊 `total_fish` 的地方就有底了 —— 至于做法，可以晚点再出现。

口令还是上一阶段那一句，今天才算真用上：**声明可以早就位，做法可以晚登场。**

## 三、一张纸拆成三本

现在动手拆。这两类本子的名字，上一阶段那一课就起好了：专报「有这么一招」的叫**招牌本**（`.h`），放做法本体的叫**干活本**（`.c`）—— 拆法按**职责**来：

```text
// fish.h —— 招牌本：只放声明
#ifndef FISH_H
#define FISH_H

int total_fish(int bowls[], int count);

#endif
```

```text
// fish.c —— 干活本：放做法
#include "fish.h"

int total_fish(int bowls[], int count) {
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += bowls[i];
    }
    return sum;
}
```

```text
// main.c —— 主流程本
#include <stdio.h>
#include "fish.h"

int main(void) {
    int bowls[3] = {2, 5, 3};
    printf("一共 %d 条小鱼干\n", total_fish(bowls, 3));
    return 0;
}
```

三本，三种职责：**招牌本只报「有这个」，干活本放「怎么做」，主流程本管「按什么顺序来」**。

两个细节：

- 主流程本现在要**先抄一份招牌**（`#include "fish.h"`）才知道「有这么一招」—— 老规矩：`#include` 就是把招牌本原样抄一遍，抄完接着往下读。
- 招牌本头上那三行 `#ifndef`/`#define`/`#endif` 是站岗的守卫：招牌被抄第二遍的时候，它会把重复的那截拦掉。细节在第 21 课展开，今天先让它们站上。

```demo
title: 一张纸拆成三本
code:
| // fish.h —— 只放声明
| int total_fish(int bowls[], int count);
| // fish.c —— 放做法
| int total_fish(int bowls[], int count) {
|     int sum = 0;
|     return sum;
| }
| // main.c —— 只管流程
| printf("一共 %d 条小鱼干\n", total_fish(bowls, 3));

step 先立一本招牌
at: 1
say: 第一本上只写「有这招、怎么喊」—— 名字、收什么、吐什么，做法留在别处。
meow: 先立一本招牌喵
pose: welcome
招牌本 = 只有声明

step 再立一本干活的
at: 4
say: 第二本放做法本体 —— 谁要用，就照着招牌来喊。
meow: 做法住这一本！
pose: busy
干活本 = 放做法

step 主流程那本瘦下来了
at: 8
say: 原来一百多行只剩十几行：摆碗、喊招式、报结果 —— 一眼看到底。
meow: 主流程瘦下来啦
pose: proud
主流程本 = 只管流程
```

拆完怎么造？翻译官喵改成**两班倒**：

```text
gcc -c main.c -o main.o
gcc -c fish.c -o fish.o
gcc main.o fish.o -o prog.exe
```

`-c` 这个开关的意思是「**只管译、先别拼**」：一本 `.c` 进去，一个半成品 `.o` 出来（正名叫 **目标文件** —— object file）。三本先各译各的，最后一步才把半成品们**拼**成一个能跑的成品。

拆开的好处，现在说得清了：**改「算总数」只需要重译 `fish.o` 一张半成品，再拼一次** —— 主流程本一个字不用动。工程一大，这一下省出来的时间就是成百上千倍。

```demo
title: 两班倒：先各译各的，最后再拼
code:
| gcc -c main.c -o main.o
| gcc -c fish.c -o fish.o
| gcc main.o fish.o -o prog.exe
| ./prog.exe

step 先各译各的
at: 1
say: 每张 .c 纸单独译成半成品 .o，先不拼，谁都不碰谁。
meow: 一张一张译喵
pose: busy
main.o = 半成品

step 最后拼一次
at: 3
say: 所有半成品交给翻译官喵拼到一起，落成一个 prog.exe。
meow: 拼成一个啦！
pose: yay
prog.exe = 拼好的成品

step 跑起来
at: 4
say: 结果和单片的时候一模一样 —— 拆开只是为了以后更好改。
meow: 结果照旧喵
pose: proud
```

## 四、坑一号：undefined reference

拆完第一刀，大肥鱼就撞坑了：它把主流程本单独交出去，**忘了带干活本**。这一版和第二节那个实验只差一件事 —— 做法没了：

```c
#include <stdio.h>

int total_fish(int bowls[], int count);

int main(void) {
    int bowls[3] = {2, 5, 3};
    printf("一共 %d 条小鱼干\n", total_fish(bowls, 3));
    return 0;
}
```

```text
collect2.exe: error: ld returned 1 exit status
```

（它上头还有一行，开头是一串长长的链接器安装路径和一个每次都不一样的小名，要紧的是中间那句：`undefined reference to` 后面跟着它找不到的那个名字。这里只抄稳的一句。）

换成手工分步，现场长这样：

```text
gcc -c main.c -o main.o
gcc main.o -o prog.exe
ld.exe: main.o:main.c:(.text+0x2f): undefined reference to `total_fish'
collect2.exe: error: ld returned 1 exit status
```

（第一行开头的完整路径本喵省成了 `ld.exe`；`0x2f` 是那笔账在半成品里的位置，换台机器可能不一样。要记住的是一头一尾：`undefined reference to` 后面那个名字，就是翻译官喵翻遍所有半成品都没找着的。）

::: warn 这种报错挂在最后一步
注意它**不是**翻译的时候炸的 —— 每本自己单看都没毛病。是**拼**的时候，翻译官喵拿着 `main.o` 里那句「有 `total_fish` 这么一招」去别的半成品里对账，一份都对不上，才当场发作。

所以修法就两个方向：把带做法的那份半成品**补进命令**（`gcc main.o fish.o -o prog.exe`），或者回头翻翻 —— 那招的做法是不是压根还没写。
:::

## 五、坑二号：multiple definition

反过来的坑更逗：两本上都写着**同名的完整做法**。

```text
// add1.c
int add(int a, int b) {
    return a + b;
}
```

```text
// add2.c
int add(int a, int b) {
    return a - b;
}
```

```text
gcc -c main.c -o main.o
gcc -c add1.c -o add1.o
gcc -c add2.c -o add2.o
gcc main.o add1.o add2.o -o prog.exe
ld.exe: add2.o:add2.c:(.text+0x0): multiple definition of `add'; add1.o:add1.c:(.text+0x0): first defined here
collect2.exe: error: ld returned 1 exit status
```

（头一行同样省了安装路径。）翻译官喵的话翻过来是：「这位客人，`add` 这个名字有**两位**来报同一份工，本喵不敢做主」—— 它甚至还告诉你第一位是谁（`first defined here`）。

这正是**声明与做法分家**的另一个理由：**招牌本只放声明**（不带大括号、不带做法），被抄几遍也不过是「有这么一招」一句话；**做法全工程只有一份**，住在唯一的干活本里。谁分家分得清楚，谁就撞不上这第二个坑。

::: tip 猫咪提示
今天收五句话：

1. **一张纸写不下就拆**：招牌本放声明、干活本放做法、主流程本管顺序 —— 三本三种职责。
2. **声明是挂招牌**：把做法里第一行原样抄一遍、尾巴加个分号；声明可以早就位，做法可以晚登场。
3. **`#include` 是抄**：招牌被抄进哪一本，招牌上写了什么，那一本就整段跟着走 —— 所以招牌里绝不放做法。
4. **`-c` 只管译、先别拼**：`.c` 进、`.o` 出（目标文件）；最后一步才拼成成品。
5. **两个坑一正一反**：`undefined reference` 是「名字找不到做法」；`multiple definition` 是「同一份工报了两次」。
:::

## 小任务

1. **亲手拆一次。** 把第一节那个单片本子拆成三个文件（招牌本、干活本、主流程本），然后全程手工分步：两次 `gcc -c`、一次拼、跑一遍。跑出 `一共 10 条小鱼干` 就算成。
2. **故意忘一次。** 把最后那条拼接命令里的 `fish.o` 删掉再敲，亲眼看一遍 `undefined reference`；然后只把 `fish.o` 加回去，别的都不动，看它又好了 —— 体会一下「报错说的是『找不到』，不是『写错了』」。
3. **碰碰招牌。** 在 `fish.h` 里加一句注释、随便改个字，然后重新造一遍：想想哪些半成品要重造？为什么？（下一课的图纸会替你回答。）
4. **想一步远的。** 如果「算总数」这招要被五个本子共用，做法该住在哪张纸上？想好之后，把答案对着第五节的坑二号检查一遍。

拆家拆到这儿，大肥鱼回头看了看三张清爽的小纸，尾巴都翘起来了。可它马上又发现新麻烦：**每改一次都要手敲三条命令**，少带一条就撞坑一号 —— 手指头都敲出茧了。下一条支流，本喵教它把这三条命令写进一张**图纸**里，让机器自己照着干。见喵～ 🐾
