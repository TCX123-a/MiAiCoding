---
id: cpp-stage3-28
lang: cpp
stage: 3
order: 28
title: 谷歌的尺子——Google C++ Style 精讲
tags: [代码规范, 工程素养]
required: ["cpp-stage3-27"]
compare: ["common-41"]
estMinutes: 25
keywords: [google-cpp-style, naming, comments, namespace]
---

## 钩子：一条鱼三个名字

大肥鱼把上一课的鱼缸项目发给同学看。同学翻了两分钟，抬头问：「同一个东西，你这里叫 `fish_tank`、那里叫 `fishCount`，注释里还写着『把 i 加一』—— 我该信哪个喵？」

大肥鱼凑过去一看，自己也愣了一秒：三种写法都是它自己写的，可连它自己都得想一下哪个是哪个。它把稿子一推：「这代码写得太丑啦喵！」

本喵从书架上抽出一把小尺子：「能跑，只过了『自己这关』；要让人一眼读懂，还得过『别人的眼睛』这关。今天这把尺子来头不小 —— 谷歌内部的 C++ 稿子大多照它写。」

## 一、这把尺子从哪来

每个项目都可以有自己的写法习惯。但谷歌把自家的习惯一条条写下来，公开成《谷歌 C++ 风格指南》（Google C++ Style Guide）。它开源的项目多、读的人多，这份指南慢慢成了 C++ 圈子里最有名的一把尺子。

它管的事说穿了很朴素：**让整个项目的代码，看起来像同一只猫教出来的。** 名字怎么起、注释怎么写 —— 都有明文规矩。今天本喵挑最常用的几组讲透；记住它们，以后去读任何大项目的稿子，你都会觉得眼熟。

## 二、名字的尺子

先量最容易认的：**文件名** —— 全小写，词与词用下划线接起来。

```text
fish_tank.cpp      ✓ 全小写加下划线
FishTank.cpp       ✗ 大写混进来了
fishTank.cpp       ✗ 驼峰在这儿不合身
```

**图纸名** —— 每个词的首字母大写、连着写，这叫大驼峰。

```text
FishTank           ✓
UrlTable           ✓ 缩写也照常写
fish_tank          ✗ 这是文件名的穿法
FISH_TANK          ✗ 全大写的行头留给别家
```

**招式名** —— 也是大驼峰，动词打头；缩写只大写头一个字母。

```text
AddFish            ✓ 一眼看出「把一个东西加进去」
StartRpc           ✓ 不是 StartRPC
add_fish           ✗
ADD_FISH           ✗
```

有一个例外要记住：和格子同名的那种「读一眼」「改一下」的小招式，写法跟着格子走、全小写也行 —— 比如 `count()`、`set_count()`。尾巴那对小括号是招式在打招呼，名字本身还是小写。

**格子名** —— 全小写加下划线；图纸里的成员，尾巴上再补一横。

```text
table_name         ✓ 临时格子
table_name_        ✓ 成员 —— 尾巴那一横是「家里的标记」
fishCount          ✗
```

那一横不是装饰：读稿子的猫扫一眼就知道「这名字是图纸自家肚子里的」，和外头来的名字各归各。上一课的 `name_`、`size_` 就是照这个穿法。

**常量和枚举** —— `k` 打头，后面照大驼峰。

```text
kMaxFish           ✓
kDaysInAWeek       ✓ 读作「一个星期有几天」
MAX_FISH           ✗ 全大写的行头是专门留给宏的
```

小写 `k` 打头是谷歌尺子的明文口径（不是 C++ 语言强制的）—— 一个字母，认出「这不是普通格子，是定下来的数」。枚举里的一位也照常量办：`kFishGold`，不是 `fish_gold`。

**命名空间** —— 全小写；用的时候把楼层带全。

```text
fish_tank              ✓
fish_tank::CeilDiv     ✓ 名字住哪层，就喊到哪层
```

**宏** —— 全大写加下划线，项目名打头。

```text
MYPROJECT_ROUND    ✓
```

指南里还给宏配了句吐槽：「你又不是真的要写宏，对吧。」—— 宏能少写就少写；真要写，就穿这身。

## 三、注释的尺子

尺子对注释也管得细，挑四条最常用的。

第一，**行尾注释前面空两格**再写 `//`：

```text
size_ += delta;  // 加一节
```

贴着代码写，注释和分号挤成一团；留两格，是给读的人一个歇脚处。

第二，语气是**说明**，不是命令：

```text
// Opens the file.     ✓ 在说「它会做什么」
// Open the file!      ✗ 冲读的人发号施令
```

第三，实现处的注释回答「**为什么**」，别把代码在做什么再翻译一遍：

```text
// 把两个数乘起来            ✗ 代码自己已经说了，写了占地方
// 先乘后除，防止中间被截断   ✓ 为什么要这么排，代码自己说不出来
```

第四，**摆放有分工**：说明书里的注释讲「怎么用」，身子里的注释讲「怎么实现」—— 读者看说明书决定用不用，看身子才关心细节。

最后一句总的口诀：**一个项目里，注释的样子要统一。** 这册讲用途、那册讲原因，风格随猫变，读的人就得准备两套脑子。

## 四、修一遍：从丑稿到合规矩

说得再多，不如动手量一回。下面这份稿子能跑 —— 先看它输出什么：

```cpp
#include <cstdio>

const int MaxFish = 12;

enum FishKind { fish_gold };

class fish_tank {
public:
    void AddFish() {
        fish_count = fish_count + 1;
    }

    void Show() {
        printf("缸里 %d 条，上限 %d 条\n", fish_count, MaxFish);
    }

private:
    int fish_count = 0;
};

int main() {
    FishKind kind = fish_gold;
    printf("最金贵的那条是 %s\n", kind == fish_gold ? "小金鱼" : "别的鱼");

    fish_tank tank;
    tank.AddFish();
    tank.AddFish();
    tank.Show();
    return 0;
}
```

```text
最金贵的那条是 小金鱼
缸里 2 条，上限 12 条
```

拿尺子量：**名字上有四处不合身。** 挨个点名 —— 图纸 `fish_tank` 该是大驼峰；常量 `MaxFish` 该穿 `k` 打头的衣服；成员 `fish_count` 的尾巴少了一横；枚举里的 `fish_gold` 也该照常量办。其余的都合身：`AddFish`、`Show` 是大驼峰的招式 ✓，`kind`、`tank` 是临时格子 ✓，`FishKind` 是图纸名 ✓。

现在逐处换上新衣服，别的字一个不动：

```cpp
#include <cstdio>

const int kMaxFish = 12;

enum FishKind { kFishGold };

class FishTank {
public:
    void AddFish() {
        fish_count_ = fish_count_ + 1;
    }

    void Show() {
        printf("缸里 %d 条，上限 %d 条\n", fish_count_, kMaxFish);
    }

private:
    int fish_count_ = 0;
};

int main() {
    FishKind kind = kFishGold;
    printf("最金贵的那条是 %s\n", kind == kFishGold ? "小金鱼" : "别的鱼");

    FishTank tank;
    tank.AddFish();
    tank.AddFish();
    tank.Show();
    return 0;
}
```

```text
最金贵的那条是 小金鱼
缸里 2 条，上限 12 条
```

输出一字不差 —— **改名只动读感，不动结果**。机器眼里 `MaxFish` 和 `kMaxFish` 只是两个写法不同的标签；尺子管的从来不是机器，是**读稿子的猫**。

## 五、命名空间：给名字加一层楼

名字套进命名空间，等于搬上几层楼，喊的时候把楼层带全 —— 这也是尺子的明文：命名空间全小写。

```cpp
#include <cstdio>

namespace fish_tank {

// 缸里最多摆几排——按每排 per_row 条算，向上取整
int CeilDiv(int total, int per_row) {
    return (total + per_row - 1) / per_row;
}

}  // namespace fish_tank

int main() {
    printf("%d %d\n", fish_tank::CeilDiv(10, 3), fish_tank::CeilDiv(9, 3));
    return 0;
}
```

```text
4 3
```

`CeilDiv` 干的是「向上取整」的活：10 条鱼每排 3 条，要摆 4 排；9 条鱼摆 3 排。名字前面挂上 `fish_tank::` 之后，就算别家项目里也有一个同名的 `CeilDiv`，两位各带各的楼层，谁也不挡谁 —— `std::`、`Fish::` 用的都是这一手。

## 六、和别家的尺子对一对

别的语言也有自己的尺子，摆在一起看更好记：

```text
图纸名：  C++ FishTank        ／ Java FishTank        ／ Python FishTank
招式名：  C++ AddFish         ／ Java addFish         ／ Python add_fish
格子名：  C++ table_name      ／ Java tableName       ／ Python table_name
常量：    C++ kDaysInAWeek    ／ Java DAYS_IN_A_WEEK  ／ Python DAYS_IN_A_WEEK
```

一眼看得出：图纸名三家都穿大驼峰；从招式名和格子名开始分家 —— C++ 招式大驼峰，Java 小驼峰，Python 全小写；常量 C++ 走 `k` 打头，另两家全大写。还有个容易记岔的小知识：**文件名这一栏不止 C++ 有规矩** —— C++ 的明文写进了尺子（全小写加下划线）；Python 的模块名，PEP 8 也写明要短、全小写（模块就是文件）；Java 那边则更硬：公共的图纸，文件名必须跟图纸名一字不差 —— 这一条不用尺子出面，翻译官喵自己就把着关。

好奇别家细节的话，通用线里「跨语言规范对照」那一课讲的就是这张小表的放大版 —— 本课先把 C++ 的穿法记牢。

## 小任务

1. 把上一课的鱼缸项目过一遍尺子：五份稿子的文件名、里面的图纸名、招式名、格子名，列一张「不合身清单」，改完再跑一遍 —— 输出应当一字不差。
2. 照尺子给三样东西起名：一个「每周最多喂几次」的常量、一个「把鱼放上秤」的招式、一份「鱼食库存」的稿子。起完连起来念一遍，看认不认得出哪件是哪件喵。
3. 随便打开一个大一点的 C++ 项目，挑五个名字对着本课的尺子量一量 —— 你会发现它们几乎全合身。这就是尺子的力量。

## 收官

工具链这条线到这儿就成套了：**分居**（多文件怎么组织）、**流水线**（Makefile 与 CMake）、**尺子**（Google C++ Style）。从今天起，你的项目不光跑得通，还经得起别人打开来看。

大肥鱼把三种写法的旧稿重抄了一遍，读完自己直点头：「原来整齐是这个感觉喵。」—— 那把尺子，本喵就留在你桌上了：往后每起一个新名字，落笔前先量一量。
