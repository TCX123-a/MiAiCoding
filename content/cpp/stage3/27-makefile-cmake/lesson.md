---
id: cpp-stage3-27
lang: cpp
stage: 3
order: 27
title: C++ 的流水线——Makefile 与 CMake 实战
tags: [工具链, 编译]
required: ["cpp-stage3-26"]
compare: ["common-38"]
estMinutes: 30
keywords: [makefile, cmake, mingw32-make, incremental-build]
---

## 钩子：抄在纸条上的命令

上一课学完分居，大肥鱼项目里的稿子从两份涨到了五份。每改一行，它都要对着小纸条把整条流水线重新敲一遍；这天它连着敲错三次文件名，把纸条一揉：「这代码写得太丑啦喵！」

本喵把纸条展开：「丑的不是代码，是你还在**手动搬流水线**。今天把这张纸条写成一张**配方纸** —— 以后改哪份稿子，它自己知道该重翻哪份，你只敲一个词。」

## 一、先把五份稿子摆成一桌

上一课的两册（`fish.h`、`fish.cpp`）原样不动；今天给鱼缸再添两册新的：缸。缸长什么样 —— 一册说明书：

```cpp
#ifndef TANK_H
#define TANK_H

#include "fish.h"

class Tank {
public:
    void add(Fish& fish);
    int count() const;
    int totalSize() const;

private:
    int count_ = 0;
    int totalSize_ = 0;
};

#endif
```

缸怎么记账 —— 一册身子（每条身子照读书的规矩，前面挂上「图纸名加两个冒号」的前缀）：

```cpp
#include "tank.h"

void Tank::add(Fish& fish) {
    count_ += 1;
    totalSize_ += fish.size();
}

int Tank::count() const {
    return count_;
}

int Tank::totalSize() const {
    return totalSize_;
}

/* tank.cpp 到此为止——缸里装了什么、怎么记账，都在这里 */
```

主稿也换成喊缸干活的那份：

```text
#include <cstdio>
#include "tank.h"

int main() {
    Fish big("大肥鱼", 24);
    big.grow(12);
    Fish small("小橘", 12);

    Tank tank;
    tank.add(big);
    tank.add(small);

    printf("缸里 %d 条，鱼身一共 %d 厘米\n", tank.count(), tank.totalSize());
    return 0;
}
```

摆好之后，文件夹里就是这五份：

```text
fish_tank/
├── fish.h      ← 上一课：鱼长什么样
├── fish.cpp    ← 上一课：鱼怎么动
├── tank.h      ← 今天：缸长什么样
├── tank.cpp    ← 今天：缸怎么记账
└── main.cpp    ← 主稿：喊话
```

## 二、先把它们摊开跑一遍

纸是分着的，机器还认得吗？本喵把三册摊开拼成一份完整程序 —— 这就是「机器眼里的项目」：

```cpp
#include <cstdio>

class Fish {
public:
    Fish(const char* name, int size) : name_(name), size_(size) {}
    int size() const { return size_; }
    void grow(int delta) { size_ += delta; }

private:
    const char* name_;
    int size_;
};

class Tank {
public:
    void add(Fish& fish) {
        count_ += 1;
        totalSize_ += fish.size();
    }
    int count() const { return count_; }
    int totalSize() const { return totalSize_; }

private:
    int count_ = 0;
    int totalSize_ = 0;
};

int main() {
    Fish big("大肥鱼", 24);
    big.grow(12);
    Fish small("小橘", 12);

    Tank tank;
    tank.add(big);
    tank.add(small);

    printf("缸里 %d 条，鱼身一共 %d 厘米\n", tank.count(), tank.totalSize());
    return 0;
}
```

```text
缸里 2 条，鱼身一共 48 厘米
```

大肥鱼先长 12 厘米（24 加 12 等于 36），再加上小橘的 12 —— 缸里两条、鱼身一共 48 厘米。**分着摆和摊开摆，结果一字不差。**

## 三、配方纸：Makefile

现在把「怎么拼」写进一张配方纸，叫 Makefile。它的规矩很朴素，就两条：

- 一行「**目标: 材料**」——「要做出谁，需要先有什么」；
- 紧跟一行「**怎么做**」——这一行**必须以 Tab 键开头**（不是空格！本喵第一次写就栽在这上面）。

```text
CXX := g++
CXXFLAGS := -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu++14

fish_tank.exe: fish.o tank.o main.o
	$(CXX) -o $@ $^

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $<
```

几个记号念一遍：跟「怎么翻」有关的开关全部收进 `CXXFLAGS`，只写一遍；`$@` 念作「**那个目标的名字**」，`$^` 念作「**全部材料**」；`%.o: %.cpp` 是一条通用规矩 —— 任何一份半成品，都从同名的那份稿子翻来，一条顶三条。

本机这套工具链里，照着配方纸干活的工具叫 `mingw32-make`（有的机子上它就叫 `make`）。敲下去：

```text
mingw32-make
g++ -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu++14 -c fish.cpp
g++ -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu++14 -c tank.cpp
g++ -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu++14 -c main.cpp
g++ -o fish_tank.exe fish.o tank.o main.o
./fish_tank.exe
缸里 2 条，鱼身一共 48 厘米
```

它替你把手工的五条命令一字不差地敲完了。接着见识真正的魔法 —— 改一下 `fish.cpp`（随便动一个空格），再敲一次：

```text
mingw32-make
g++ -finput-charset=UTF-8 -fexec-charset=UTF-8 -Wall -std=gnu++14 -c fish.cpp
g++ -o fish_tank.exe fish.o tank.o main.o
```

只剩两行：它**只重翻动过的 `fish.cpp`**，然后重新拼接一次；`tank.o` 和 `main.o` 原样没动。「改哪份、重翻哪份」—— 这张配方纸替你记住了。

## 四、CMake：先勘察、再生成

Makefile 管「怎么拼」；项目再大一点，还会遇到另一类麻烦：不同机子上的工具不一样、开关写法不一样。CMake 的活是**先照着现场勘察一遍，再替你生成一份配方**。配方同样写在一张纸上，文件名叫 `CMakeLists.txt`：

```text
cmake_minimum_required(VERSION 3.15)
project(fish_tank CXX)

set(CMAKE_CXX_STANDARD 14)
add_compile_options(-finput-charset=UTF-8 -fexec-charset=UTF-8)

add_executable(fish_tank fish.cpp tank.cpp main.cpp)
```

读一遍要点：要 C++14 这版语言；翻译时带上 UTF-8 两件套；把三份 `.cpp` 拼成 `fish_tank.exe`。然后敲第一条 —— 勘察并生成：

- `-S .` 说「案子在哪」；
- `-B build` 说「勘察结果放进 `build` 文件夹」；
- `-G "MinGW Makefiles"` 指名用哪班人马干活。

```text
cmake -S . -B build -G "MinGW Makefiles"
```

它收尾时会念两句 `-- Configuring done` 和 `-- Generating done`，然后 `build` 文件夹里就躺着一份**给你用的新配方**。之后第二条命令出场：

```text
cmake --build build
[ 25%] Building CXX object CMakeFiles/fish_tank.dir/fish.cpp.obj
[ 50%] Building CXX object CMakeFiles/fish_tank.dir/tank.cpp.obj
[ 75%] Building CXX object CMakeFiles/fish_tank.dir/main.cpp.obj
[100%] Linking CXX executable fish_tank.exe
[100%] Built target fish_tank
```

那几行 `[...%]` 是它在跟你汇报进度 —— 本质上和刚才 `mingw32-make` 干的是同一件事。成品在 `build/` 里躺着：

```text
./build/fish_tank.exe
缸里 2 条，鱼身一共 48 厘米
```

两条补充，都是本喵踩过的：第一，要是某台机子说找不到干活的人马，可以在第一条命令后面补一段 `-DCMAKE_MAKE_PROGRAM=` 直接把它的完整位置指出来（每台机子位置不同，课本里就不写死了）；第二，不写 `-G` 的时候，CMake 会自己挑一个默认班底 —— 为了让结果和你在本机验证过的那套对齐，养成带上 `-G "MinGW Makefiles"` 的习惯。

## 五、为什么大工具都抱着 CMake 不撒手

打开 CLion，或者给 VS Code 装上 C++ 相关的工具包，你会发现它们看见 `CMakeLists.txt` 就爱不释手：哪些稿子组成项目、用哪套开关、怎么抓虫，全都能从它上面读出来。所以你在网上下载一个大一点的 C++ 项目，开场白几乎都是这两句：`cmake -S . -B build`、`cmake --build build` —— 今天你已经全部认识了。

## 小任务

1. 照这五份稿子 + 这一张配方纸，在你的文件夹里跑通。跑通后把半成品和成品全删掉，再敲一次 `mingw32-make`，看它从零重来一遍。
2. 把 `main.cpp` 里小橘的 12 改掉，重跑 `mingw32-make`，数一数这次它重翻了几份。
3. 故意把配方纸里那两行开头的 Tab 换成四个空格，再敲 `mingw32-make` —— 看它怎么打发你（本课最好笑的一条报错，跑过就忘不掉）。

## 预告

下一课换一把尺子：谷歌的 C++ 代码规范 —— 名字怎么起、注释怎么写、为什么一整个公司的 C++ 看起来像同一只猫教出来的。
