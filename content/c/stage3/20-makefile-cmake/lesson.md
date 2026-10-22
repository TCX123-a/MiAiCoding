---
id: c-stage3-20
lang: c
stage: 3
order: 20
title: 流水线的图纸——Makefile 与 CMake 入门
tags: ["工具链", "编译"]
required: ["c-stage3-19"]
compare: ["common-38"]
estMinutes: 25
keywords: [Makefile, CMake, 自动化, 增量编译, mingw32-make, 工程组织]
---

## 钩子：三条命令，手都敲出茧了

上一课拆完家，大肥鱼过上了好日子 —— 直到它又改了一行 `fish.c`：手敲三条命令（两次 `gcc -c`、一次拼），少带一条就撞 `undefined reference`；四张纸的工程就是五条命令，八张纸就是九条……手指头先罢工了。

「这代码写得太丑啦喵！」—— 这回丑的不是代码，是**流程**。

本喵扔给它一张**图纸**：把「先干什么、后干什么、谁靠谁」写清楚，以后只敲一个词，机器自己照着干。这张图纸的名字叫 **Makefile**。

## 一、先把流水线写成三条

图纸里要写的，就是上一课那三条命令。为了有一份能指来指去的「三步清单」，先看这个把三步挨个念出来的小本子：

```c
#include <stdio.h>

int main(void) {
    const char *steps[3] = {"编译 main.c", "编译 fish.c", "链接"};

    for (int i = 0; i < 3; i++) {
        printf("第 %d 步：%s\n", i + 1, steps[i]);
    }

    return 0;
}
```

```text
第 1 步：编译 main.c
第 2 步：编译 fish.c
第 3 步：链接
```

（本喵真跑出来的，命令还是标准那一条：`gcc -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu11 -o prog.exe main.c && ./prog.exe`。）

造真程序的三步，和它念的一模一样：**先译 `main.c`，再译 `fish.c`，最后拼。** 现在把这三步抄进图纸。

## 二、图纸的形状：目标、原料、菜单

先看成品。这是一个能干活的最小 Makefile（`Makefile` 是文件正名，M 大写）：

```text
prog.exe: main.o fish.o
	gcc main.o fish.o -o prog.exe

main.o: main.c fish.h
	gcc -c main.c -o main.o

fish.o: fish.c fish.h
	gcc -c fish.c -o fish.o

clean:
	rm -f *.o prog.exe
```

看三条铁律。

**第一条：一条规矩，两栏一菜单。** 每条形如：

```text
目标: 原料一 原料二
	施工命令
```

- **冒号左边**：要造出来的东西（`prog.exe`、`main.o`）；
- **冒号右边**：它靠哪些原料造出来；
- **缩进的那行**：造它的命令 —— 注意开头是**一个真正的 Tab**，不是空格。这个坑第四节细讲。

**第二条：从「成品谁靠谁」一路倒推。** 图纸从上往下读，活从下往上干：想造 `prog.exe` → 先备齐 `main.o` 和 `fish.o` → 它俩各自又是一条规矩（靠 `main.c`、`fish.c`）……一路倒推到有现成原料（`.c` 文件）为止。**「谁靠谁」这张网，就是图纸的全部信息。**

**第三条：原料栏别偷懒。** 看 `main.o` 那行 —— 原料里除了 `main.c`，还列了 `fish.h`。因为 `main.c` 里抄过招牌（`#include "fish.h"`），**招牌一改，译过它的半成品就全算过时**。把 `fish.h` 写进原料栏，改招牌才会触发重译。

最后那条 `clean:` 是约定俗成的「打扫卫生」入口：它不造东西，负责把半成品和成品一次扫干净。注意它的原料栏是空的 —— **它永远「没活可干」，所以敲它永远执行**。

## 三、照图施工：mingw32-make

图纸画好了，谁来看图施工？它的本名叫 **GNU Make**。Linux 上你敲 `make`；本机这套 Windows 工具链里，它穿的外套叫 `mingw32-make`（版本 4.4.1）—— 敲短名字 `make`，本机会回你一句「找不到这条命令」。

第一次施工，它把每条命令**先念一遍再干**（念出来，正是为了让你看清它做了什么、有没有按你的意图来）：

```text
mingw32-make
gcc -c main.c -o main.o
gcc -c fish.c -o fish.o
gcc main.o fish.o -o prog.exe
```

（本机实录；它只念自己真正执行的那几条。）

跑一下成品：

```text
./prog.exe
一共 10 条小鱼干
```

什么都不改，再敲一次：

```text
mingw32-make
mingw32-make: 'prog.exe' is up to date.
```

「up to date」（最新的）—— 它**凭什么**断定不用重造？凭**修改时间**：成品比所有原料新，说明原料没人碰过，没活可干。这就是这张图纸真正的生意经。

验证一下。改一行 `fish.c`（本喵用 `touch` 假装碰了一下它），再敲：

```text
touch fish.c
mingw32-make
gcc -c fish.c -o fish.o
gcc main.o fish.o -o prog.exe
```

**只重跑了 `fish.c` 这一路**：`main.o` 一动没动，最后拼一次就完事。手工拆家时人肉追求的「只重译变了的那张」，现在它自己算出来了 —— 地图越大，图纸省得越多。

::: warn 一个容易翻车的边角
「谁比谁新」靠的是**修改时间戳**，而时间戳的分辨率有限。要是你在上一次翻译的**同一秒里**改动原料，有些文件系统上会被看成「一样新」，它就可能不动手 —— 这种「装死」现象，隔一秒再敲就正常了。真遇到「明明改了却不重造」，先怀疑时间戳，别怀疑图纸。
:::

收工前打扫卫生：

```text
mingw32-make clean
rm -f *.o prog.exe
```

半成品和成品一次扫光，`.c` 和 `fish.h` 一张不动。

```demo
title: 照图施工
code:
| mingw32-make
| ./prog.exe
| mingw32-make
| gcc -c fish.c -o fish.o
| gcc main.o fish.o -o prog.exe

step 第一次照图全造
at: 1
say: 原料都还没出炉，它把三条命令挨个念一遍、挨个干完。
meow: 全造一遍喵
pose: busy
成品 = prog.exe 造好了

step 跑一跑
at: 2
say: 成品跑起来，和手敲三条命令的结果一模一样。
meow: 结果照旧！
pose: yay

step 什么都没改再敲
at: 3
say: 原料都没比成品新 —— 它一句话收工：'prog.exe' is up to date.
meow: 没活干喵
pose: proud
状态 = up to date

step 改一行 fish.c
at: 4
say: 这回只有 fish.c 比它的半成品新：它只重译 fish.o、再拼一次 —— main.o 一动没动。
meow: 只补过时的那两步
pose: guide
```

## 四、踩坑角：那是 Tab，不是空格

图纸里最容易翻车的一行，是施工命令的缩进：**把它敲成空格**。看着都是空白，它只认 Tab。

本喵故意犯一次：把最后一条命令的缩进换成四个空格（其余不动）：

```text
prog.exe: main.o
    gcc main.o -o prog.exe
```

敲下去：

```text
mingw32-make
makefile:2: *** missing separator.  Stop.
```

（本机实录：它报的是小写 `makefile`，`Stop.` 前头是两个空格 —— 本喵逐字节数过，一个字符都没抄错。）

「missing separator」（缺分隔符）—— 它不告诉你「你用了空格」，它只是看不懂那行的开头。判据记住一条就够：**施工命令那几行，开头必须是一个真正的 Tab**。眼睛分不出的，让编辑器帮你：把「显示不可见字符」打开，Tab 和空格会显现出不同的记号。

```demo
title: 空格闯祸
code:
| prog.exe: main.o fish.o
|     gcc main.o fish.o -o prog.exe
| main.o: main.c fish.h
|     gcc -c main.c -o main.o

step 一条规矩挂好了
at: 1
say: 目标、原料各就各位 —— 冒号左边要造的东西，右边靠的原料。
meow: 一条规矩挂好了喵
pose: welcome
目标 = prog.exe

step 施工命令敲成空格
at: 2
say: 底下这行本该 Tab 开头，大肥鱼敲成了四个空格 —— 看着齐，它不认。
meow: 空格骗不过它喵
pose: think
缩进 = 四个空格

step 一敲就露馅
at: 2
say: 敲 mingw32-make，它就指着这一行报 missing separator —— 缺的是 Tab，不是内容。
meow: 缺的是 Tab 不是内容！
pose: remind
报错 = missing separator
```

## 五、图纸的省法：仓库、占位符、自动搬运

真工程里，图纸还能再省。本喵把第二节那张图升级了一版：

```text
CC = gcc
CFLAGS = -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu11

prog.exe: main.o fish.o
	$(CC) $^ -o $@

%.o: %.c fish.h
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f *.o prog.exe
```

三个新写法：

- **两个变量（小鱼干仓库）**：`CC` 里存翻译官喵的名字，`CFLAGS` 里存那串标准开关。`$(名字)` 是取货的写法。要换工具链？只改仓库里那一行，全图纸跟着走 —— 本课的标准命令（`-finput-charset=UTF-8 ...`）以前每条都要手抄，现在从头到尾只写一遍。
- **一条规矩顶两条**：`%.o: %.c fish.h` —— `%` 是**名字占位符**，这条读作「任何一个 `.o`，靠同名的 `.c`（外加招牌本 `fish.h`）来造」。`main.o` 和 `fish.o` 两条规矩，一句话包圆；招牌本照样躺在原料栏里（第二节说过的理由）。
- **自动搬运**：`$^` 是「原料栏全部」，`$@` 是「目标」，`$<` 是「原料栏第一个」。于是 `$(CC) $^ -o $@` 展开成 `gcc main.o fish.o -o prog.exe`；`$(CC) $(CFLAGS) -c $< -o $@` 展开成 `gcc <那串开关> -c main.c -o main.o`。名字从哪来、往哪去，全凭这三张搬运票 —— 以后原料栏里加一张纸，命令一个字都不用动。

照新图施工，本喵真跑了一遍：

```text
mingw32-make
gcc -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu11 -c main.c -o main.o
gcc -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu11 -c fish.c -o fish.o
gcc main.o fish.o -o prog.exe
```

它干出来的活，和第二节那张旧图一模一样 —— 只是念出来的命令里，编译那两步各多了一串开关（从 `CFLAGS` 仓库取的）；**图纸换了写法，活没变**。成品照跑（还是 `一共 10 条小鱼干`），什么都不改再敲，照旧一句 `up to date`。

## 六、CMake：不画死图纸，说需求

大肥鱼又举手了：「那要是把这份工程拷去 Linux、换台机器、换个翻译官喵呢？图纸里写死的名字（`gcc`、`prog.exe`）不都得重画？」

问到点子上了。上一节那种图纸是**给一台具体机器画的死图**；于是江湖上有了更高一层的话术：**CMake** —— 你不画图纸，只把**需求**写进一份清单，它到谁的机器上、照着谁的工具链，**现造一张图纸**。

这份清单叫 `CMakeLists.txt`，本课这份就三个要点：

```text
cmake_minimum_required(VERSION 3.20)
project(fish_tank C)

add_executable(prog main.c fish.c)
```

- 第一行：话术版本要求（照抄即可）；
- 第二行：工程叫 `fish_tank`，是门 **C** 语言的活；
- 第三行：**一句话说清需求** —— 本喵要一个叫 `prog` 的成品，原料是 `main.c` 和 `fish.c`。注意：**半成品一个都不用列**，它们那张「谁靠谁」的网，CMake 自己会补全。

用它造程序，两步走。第一步，让它读清单、**画图**：

```text
cmake -S . -B build
-- Building for: Ninja
-- The C compiler identification is GNU 16.1.0
……（中间是它逐项体检工具链的那几行）
-- Configuring done (1.5s)
-- Generating done (0.0s)
-- Build files have been written to: build
```

（本机实录；行尾它实际写的是完整路径，本喵省成了 `build`。`-S .` 说「需求清单在当前目录」，`-B build` 说「图纸和半成品都放进 `build/` 目录」—— **别让生成的垃圾撒在工作目录里**。）

第一行 `-- Building for: Ninja` 就是它在报：**本机它挑的施工队叫 Ninja**，图纸已经生成进 `build/` 了。第二步，照图施工：

```text
cmake --build build
[1/3] Building C object CMakeFiles/prog.dir/fish.c.obj
[2/3] Building C object CMakeFiles/prog.dir/main.c.obj
[3/3] Linking C executable prog.exe
```

（本机实录 —— 两张半成品的先后，本喵跑两次见过两种次序：施工队自己排班，谁先谁后都不影响结果。）

成品躺在 `build/` 里：

```text
./build/prog.exe
一共 10 条小鱼干
```

以后只改了 `.c`，重敲 `cmake --build build` 就够；要是动了 `CMakeLists.txt`，先重跑一次 `cmake -S . -B build` 重新画图。**同一份清单，在这台机器上画成 Ninja 的图，换台机器可能画成 Makefile 的图** —— 你那份清单一个字不动。这就是它比手画图纸高一层的地方。

顺带记一笔：这台机器上没有叫 `make` 的施工队，只有 `mingw32-make`（第三节打过照面）。哪天你想让 cmake 直接画成 Makefile 那种图纸（生成器写 `MinGW Makefiles`），它也得先找施工队 —— 本喵真试过：它自己就找到了 `mingw32-make.exe`，不用额外指路。

::: tip 猫咪提示
今天收五句话：

1. **图纸三件套**：目标、原料、施工命令（开头一个真 Tab）。
2. **图纸是一张「谁靠谁」的网**：从上往下读、从下往上干；原料栏里别漏招牌本（`fish.h`）。
3. **只重造过时的**：比修改时间戳 —— `up to date` 就是「没活可干」。
4. **本机施工命令 `mingw32-make`**（GNU Make 4.4.1 的外套）；`clean` 是约定俗成的打扫入口，`$(CC)`、`$@`、`$<` 是三种省法。
5. **CMake 高一层**：把需求写进 `CMakeLists.txt`，它照机器现造图纸、现找施工队。
:::

## 小任务

1. **抄一遍图纸。** 把第二节那张最小图纸一条不漏地抄下来（Tab 一个不少），`mingw32-make` 全造一次，再空敲一次看 `up to date`。
2. **故意踩一次 Tab 坑。** 把某条施工命令的缩进换成空格，看 `missing separator` 长什么样，再改回 Tab、看它康复。
3. **给图纸添人。** 新加一个干活本 `helper.c`（随便一个招式），把图纸补全：原料栏、新规矩、`clean` 要不要动？一条条标出来。
4. **用清单造一遍。** 照第六节，把这份工程用 CMake 造一遍（先 `cmake -S . -B build`、再 `cmake --build build`），成品去 `build/` 里找 —— 然后问自己：清单和图纸，哪个你更愿意手写？

图纸接到手里，大肥鱼只敲一个词的日子开始了。可它马上发现种新麻烦：**工程里不止它一个猫** —— 三只猫合写，名字起得五花八门，注释你写你的我写我的，评审的时候谁看谁头疼。最后一课，本喵把**规矩**立起来。见喵～ 🐾
