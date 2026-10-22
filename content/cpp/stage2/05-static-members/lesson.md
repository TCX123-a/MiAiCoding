---
id: cpp-stage2-05
lang: cpp
stage: 2
order: 5
title: 静态成员
tags: [面向对象, 静态成员, 共享数据]
required: ["cpp-stage2-04"]
crossRefs: []
compare: ["common-10"]
estMinutes: 23
keywords: [static, shared, counter]
---

## 钩子：「一共出生了几只」这件事，记在哪只猫头上？

上一课，本喵给每只猫的格子都盖上了盖子，每只猫守好自己那一份。可本喵很快撞上一件事 —— **这件事记在哪只猫头上都不对**：

> 本喵一共出生了几只猫？

记在 `c1` 那两格里？那 `c2` 出生的时候，谁去把 `c1` 的格子加一？再说 `c1` 自己先没了的时候，这个数又该寄在哪儿？

答案本喵其实已经猜到了：这个数**不属于任何一只猫**，它属于**整张图纸**。今天要学的就是这种「**整张图纸共用一份**」的格子 —— 写法上的标记是在前面加一个 `static`。

## 一、共用的一份：`static` 格子

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    static int count;
    string name;

    Cat(string n) : name(n) {
        count = count + 1;
    }
};

int Cat::count = 0;

int main() {
    Cat a("小橘");
    Cat b("狸花");
    Cat c("大胖");
    cout << "一共出生了 " << Cat::count << " 只" << endl;
    return 0;
}
```

```text
一共出生了 3 只
```

这段里有三处要拿小本本抄下来：

1. **图纸里**：`static int count;` —— 前面那个 `static` 是宣告「这一格**整张图纸共用**」，不属于任何一只猫。
2. **图纸外面**：`int Cat::count = 0;` —— 多出来的这一行，是给这份共用的格子**落地**、顺便给它一个起步的数。（为什么不能少，下一节专门说。）
3. **出生招式里**：`count = count + 1;` —— 每生一只猫都去**同一个**格子上加一。生三只，加三次，所以是 `3`。

念法上，`Cat::count` 念作「**`Cat` 这张图纸上的 `count`**」—— 和上一课写在图纸外面的招式名前面那个 `Cat::` 是同一个暗号。

::: tip 猫咪提示
**共用的那一份，一律用图纸名去念**（`Cat::count`）。写下 `Cat::` 这四个字符，读的人一眼就知道「这不是某只猫自己的东西」—— 这条规矩能帮你省下很多想不明白的工夫喵。
:::

## 二、它真的只有一份

「共用」这两个字得亲手验一次才踏实。下面这段是**故意使坏**：本喵拿一只猫去改那个数，然后看看另外两位怎么看。

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    static int count;
    string name;

    Cat(string n) : name(n) {
        count = count + 1;
    }
};

int Cat::count = 0;

int main() {
    Cat a("小橘");
    Cat b("狸花");
    a.count = 100;
    cout << Cat::count << " " << b.count << endl;
    return 0;
}
```

```text
100 100
```

本喵只写了 `a.count = 100;`，可印出来的是 `100 100` —— `b` 那一侧也变了。

**因为它压根不是 `a` 的东西**：`a.count`、`b.count`、`Cat::count` 三种写法指的是**同一份**，一共就这一格。本喵拿最啰嗦的那档念叨（`-Wall`）真跑过一遍：编得过、跑得动、**翻译官喵一个字都没说** —— 它不拦这种写法，也不会提醒你「你改的是共用的那一份」。

所以本喵给自己立一条规矩：**共用的那份只写 `Cat::count`**。`a.count` 这种念法翻译官喵认，但它会让读代码的人（包括三天后的你自己）以为这是 `a` 自己的一格。

这三只猫是怎么共用一个格子的，本喵拆成一步一步走给你看：

```demo
title: 三只猫加的是同一格 —— 改一只，另外两只一起变
code:
| class Cat {
| public:
|     static int count;
|     string name;
|     Cat(string n) : name(n) { count = count + 1; }
| };
| int Cat::count = 0;
| Cat a("小橘");
| Cat b("狸花");
| Cat c("大胖");
| a.count = 100;
| cout << Cat::count << " " << b.count << endl;

step 图纸里先报一格共用的
at: 3
say: `static int count;` 是**报名字**：图纸上有这么一格，它是**整张图纸共用**的 —— 不属于任何一只猫。这一刻它还没落地，就像图纸上画了一个空格子，实物还没有。
meow: 先画一格共用的，实物还没有喵
pose: expect
图纸上那格 count = 还没落地
小橘那格的 name = （还没生）
狸花那格的 name = （还没生）

step 名字前面没有 static：每只猫各一格
at: 4
say: `string name;` 前面**没有** `static` —— 那它就是**每只猫各有一格**：这只那格装「小橘」，那只那格装「狸花」，互不相干。这种格子跟着真猫一起被造出来，不用在图纸外面再写一行。
meow: 名字没加 static，每只各一格喵
pose: expect
图纸上那格 count = 还没落地
小橘那格的 name = （还没生）
狸花那格的 name = （还没生）

step 出生招式里加的是那唯一的一格
at: 5
say: 第 5 行那句 `count = count + 1;` 是**出生招式**里的活儿，只有生猫的时候才跑。它加的是 `count` —— 图纸上**那唯一的一格**，不是「自己那一格」。此刻一只猫都还没生，它一次都还没跑过。
meow: 每生一只都往这同一格里加一
pose: busy
图纸上那格 count = 还没落地
小橘那格的 name = （还没生）
狸花那格的 name = （还没生）

step 图纸外面给它落地，起步是 0
at: 7
say: `int Cat::count = 0;` 写在图纸**外面**，是亲手给这格落地、顺便给个起步的数。**注意：写完它 count 还是 0** —— 出生招式一次都还没跑，一只猫都还没生呢。
meow: 落地啦，从 0 起数喵
pose: busy
图纸上那格 count = 0
小橘那格的 name = （还没生）
狸花那格的 name = （还没生）

step 生小橘：共用的那格变成 1
at: 8
say: 第 8 行生出第一只猫。出生招式跑到那句加一 —— 加的是**那唯一的一格**：0 变 1。同时 `name` 那格装进「小橘」，**那一格是小橘自己的**。
meow: 小橘出生，共用的那格变 1
pose: yay
图纸上那格 count = 1
小橘那格的 name = 小橘
狸花那格的 name = （还没生）

step 生狸花：还是那同一格，变成 2
at: 9
say: 第 9 行生第二只。出生招式加的**还是那一格**：1 变 2。所以小橘那边看到的也已经是 **2** 了 —— 它俩看的是同一格，不是各看各的。
meow: 狸花也生啦，那格变 2 喵
pose: yay
图纸上那格 count = 2
小橘那格的 name = 小橘
狸花那格的 name = 狸花

step 生大胖：那格变成 3
at: 10
say: 第 10 行生第三只，加的还是那一格：2 变 3。三只猫各有一格 `name`（三个名字互不相干，大胖那格装的是「大胖」），可 `count` 从头到尾就这**一格**。
meow: 大胖出生，那格变 3 喵
pose: yay
图纸上那格 count = 3
小橘那格的 name = 小橘
狸花那格的 name = 狸花

step 只写了 a. ，改的却是共用那一格
at: 11
say: `a.count = 100;` —— 写的是 `a.`，可 `a.count` 指的**根本不是 `a` 自己的一格**：它指的就是那唯一的一格。3 一下子变成 100。这一刻 `b`、`c` 那边**还没开口问**，可它们看到的值已经是 100 了。
meow: 明明写的是 a.，它却指向共用那格
pose: think
图纸上那格 count = 100
小橘那格的 name = 小橘
狸花那格的 name = 狸花

step 两种念法，印出来是同一个数
at: 12
say: `cout` 里一个是 `Cat::count`、一个是 `b.count` —— 两种不同的念法，走的是**同一格**。所以印出来是 `100 100`，不是 `100 3`。名字那种每只各一格的东西正好相反：改小橘那格，狸花那边一个字都不会动。
meow: 两种念法，看的是同一格喵
pose: proud
图纸上那格 count = 100
小橘那格的 name = 小橘
狸花那格的 name = 狸花
```

**记住这一条就不会再绕晕**：`static` 那一格**从头到尾只有一份** —— 三只猫加的是它、看的也是它，所以改一只，另外两只一起变；`name` 那种「每只各有一格」的东西正好相反，改小橘的，狸花那边一个字都不会动。

## 三、图纸外面还得再写一行

图纸里那句 `static int count;` **只是报个名字**：有这么一格、它是整张图纸共用的。可它**没有落地** —— 它不像每只猫自己那两格，跟着真猫一起被造出来。

共用的格子必须**在图纸外面单独写一行**，亲手给它一个起步的数 —— 就是那个 `int Cat::count = 0;`：格子名前面挂上图纸名，后面写 `= 0` 给它一个起步的数。少了这一行会怎样？本喵把上面第一节那段里的这一行抽掉，真跑了一次：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    static int count;
    string name;

    Cat(string n) : name(n) {
        count = count + 1;
    }
};

int main() {
    Cat a("小橘");
    Cat b("狸花");
    cout << "一共出生了 " << Cat::count << " 只" << endl;
    return 0;
}
```

翻译官喵的原话，最末一行是：

```text
collect2.exe: error: ld returned 1 exit status
```

这一行上面还有一行，里面写着 `undefined reference` 和 `Cat::count`（那一行开头是一长串临时小路，每次跑都不一样，本喵就不整行抄给你了）。意思很直白：**「`count` 这个名字本喵认得，可它落地的地方没找着。」**

注意这个错**来得特别晚**：前面每一句都被逐句看过了、都说没问题，直到**把所有零件拼起来那一刻**才炸。原话里那个 `ld` 就是干拼装这活的工具。

所以往后看到 `collect2.exe: error: ld returned 1 exit status`，先回头数一数：是不是有个 `static` 格子忘了在图纸外面写那一行喵。

## 四、`static` 招式：没有「本喵自己」的招式

有些活**不需要哪只猫也能干** —— 比如「报一报一共出生了几只」。这种活就该写成 `static` 招式：前面加 `static`，喊它的时候不需要先有一只猫。

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    static int count;
    string name;

    Cat(string n) : name(n) {
        count = count + 1;
    }

    static int howMany() {
        return count;
    }
};

int Cat::count = 0;

int main() {
    Cat a("小橘");
    Cat b("狸花");
    cout << "一共有 " << Cat::howMany() << " 只" << endl;
    return 0;
}
```

```text
一共有 2 只
```

注意两件事：

- 喊它的时候，名字前面挂的是**图纸名**：`Cat::howMany()`。这件事不属于任何一只猫，所以从图纸上喊最自然。
- 它肚子里碰的是 `count`（共用的那一份）—— 完全没问题。

可要是它去碰**某只猫自己那一格**呢？翻译官喵当场拦下：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    static int count;
    string name;

    Cat(string n) : name(n) {
        count = count + 1;
    }

    static int howMany() {
        return name.size();
    }
};

int Cat::count = 0;

int main() {
    Cat a("小橘");
    cout << Cat::howMany() << endl;
    return 0;
}
```

```text
main.cpp:15:16: error: invalid use of member 'Cat::name' in static member function
main.cpp:8:12: note: declared here
```

念作：**「`name` 是每只猫自己的一份，可你现在站的是 `static` 招式 —— 喊它的时候没有猫站在旁边，你要用的是哪只猫的 `name`？」**

`this` 也是同一个道理。上一课说过，`this` 就是「喊这一招的那只猫」；可 `static` 招式是挂在图纸上的，喊它的时候手里**根本没有猫**：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    static int count;

    Cat() {
        count = count + 1;
    }

    static int howMany() {
        return this->count;
    }
};

int Cat::count = 0;

int main() {
    Cat a;
    Cat b;
    cout << "一共出生了 " << Cat::howMany() << " 只" << endl;
    return 0;
}
```

```text
main.cpp:14:16: error: 'this' is unavailable for static member functions
```

念作：**「`static` 招式里没有『本喵自己』这个东西 —— `this` 在这儿是空的。」**

一句话记住：**`static` 招式里，共用的格子随便碰，每只猫自己的格子一个都不能碰**（`this` 就更不能写）。

## 五、什么时候该请出 `static`

本喵把判断法子缩成两句话：

- **只跟「图纸」有关、跟具体哪只猫无关的事** → 请 `static` 出来。比如：一共出生了几只、一共收了多少条、这张图纸的共用上限；
- **所有猫都该看同一份、改一处立刻全体可见的值** → 也请 `static`。比如全体共用的上限、总开关。

反过来，**每只猫各有一份**的东西（名字、这只猫自己的条数）就绝对不该加 `static` —— 加了它，三只猫的名字会互相覆盖，只剩下最后生的那一个。

## 六、本喵今天记住的三句话

::: tip 猫咪提示
1. **`static` 格子属于图纸，不属于猫**：一共只有一份，所以一律念 `Cat::count` 这种写法，别写 `b.count`。
2. **它必须在图纸外面再写一行**：`int Cat::count = 0;` —— 少了这一行，**拼装的时候**才报错，原话末尾是 `collect2.exe: error: ld returned 1 exit status`（那是拼装阶段，不是逐句看的那一关）。
3. **`static` 招式里没有「本喵自己」**：共用的格子随便碰，每只猫自己的格子一个都不能碰，`this` 也用不了；喊它写成 `Cat::howMany()`。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `static int count;`（图纸里） | 报个名字：有这么一格**整张图纸共用**的东西 |
| `int Cat::count = 0;`（图纸外面） | 给它落地、给个起步的数 —— **这一行不能少** |
| `Cat::count` | 「`Cat` 这张图纸上的 `count`」，一共只有一份 |
| `a.count = 100;` | 翻译官喵认这种写法，可改的还是**那同一份** —— 不是 `a` 自己的一格 |
| `static int howMany() { return count; }` | 挂在图纸上的招式：碰共用的格子没问题 |
| `Cat::howMany()` | 喊它的写法（喊它不需要猫） |
| `return name.size();`（在 `static` 招式里） | 挨拦：`invalid use of member 'Cat::name' in static member function` |
| `this->count`（在 `static` 招式里） | 挨拦：`'this' is unavailable for static member functions` |

## 小任务

1. 把第一节那段里的 `Cat::count` 换成 `a.count`，真跑一次看看结果变不变；再把 `a.count = 100;` 那一手自己试一遍，看看另外一只猫是不是也「看见」了。
2. 给图纸加一格共用的 `static int total;`，在出生招式里把这只猫的条数加进去；再写一个 `static int getTotal()` 把它叼回来。**别忘了图纸外面那一行。**
3. 把第三节那段里图纸外面那行 `int Cat::count = 0;` 删掉，真跑一次，把翻译官喵的原话抄进小本本 —— 重点是记下**它是什么时候**报的错（是逐句看的那一关，还是拼装那一刻）。
4. 试着在 `static` 招式里加一句 `name = "小猫";`，真跑一次，看看翻译官喵说什么。这一条就是为了让你记住：`static` 招式里碰「每只猫自己的格子」是**编不过**的。
5. 把 `howMany()` 前面那个 `static` 去掉，别的都别动，真跑一次 —— 它应该照样跑得通（出生招式早就在碰 `count` 了）。想一想为什么：共用的那一份，本来就是谁都能碰的。

下一课，本喵要让**写在图纸外面的招式**也能看图纸里盖上盖子的格子 —— 不过这不是随便谁都行的：得图纸自己亲口答应一声，说「它是我朋友」。去下一课探险喵～ 🐾
