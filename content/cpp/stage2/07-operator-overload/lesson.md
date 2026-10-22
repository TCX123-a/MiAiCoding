---
id: cpp-stage2-07
lang: cpp
stage: 2
order: 7
title: 运算符重载——给符号定制新招式
tags: [运算符重载, 流运算符]
required: ["cpp-stage2-06"]
crossRefs: []
estMinutes: 26
keywords: [operator, overload, ostream, const]
---

## 钩子：两只小鱼干袋子，为什么不能直接加

本喵画了一张图纸叫 `FishBag`（小鱼干袋子），每只袋子装着几条小鱼干。现在本喵想把两只袋子合起来：

```text
FishBag a(3);
FishBag b(5);
FishBag c = a + b;       // 本喵最想这么写
```

可翻译官喵不认 —— 它认识的 `+` 只管加法：两个数字相加、两个小数相加。**突然冒出来两只袋子，它就不知道该怎么办了。**

上一课本喵给「信得过的猫」开了后门；今天这一手更狠一点：**本喵要给符号本身换一套动作。** 让 `+` 遇到袋子的时候，按本喵定的规矩来。这一手叫**运算符重载**：同一个符号，遇上不同的东西，做不一样的事。

## 一、给 `+` 说清楚：两只袋子加起来是什么意思

写法是这样的 —— 在一个招式名字的位置上，写 `operator` 加上那个符号：

```cpp
#include <iostream>
using namespace std;

class FishBag {
    int count;
public:
    FishBag(int c) : count(c) {}

    FishBag operator+(const FishBag& other) const {
        return FishBag(count + other.count);
    }

    FishBag operator-(const FishBag& other) const {
        return FishBag(count - other.count);
    }

    bool operator==(const FishBag& other) const {
        return count == other.count;
    }

    int howMany() const { return count; }
};

int main() {
    FishBag a(3);
    FishBag b(5);
    FishBag c = a + b;
    cout << "a + b 一共 " << c.howMany() << " 条" << endl;
    cout << "b 比 a 多 " << (b - a).howMany() << " 条" << endl;
    cout << "a 和 b 一样多吗？" << ((a == b) ? "一样喵" : "不一样喵") << endl;
    cout << "a 和 a 一样多吗？" << ((a == a) ? "一样喵" : "不一样喵") << endl;
    return 0;
}
```

```text
a + b 一共 8 条
b 比 a 多 2 条
a 和 b 一样多吗？不一样喵
a 和 a 一样多吗？一样喵
```

本喵一段一段拆给你看：

- **`operator+` 就是这一手的关键**：`operator` 是「本喵要定制一个符号」的口令，后面紧跟那个符号。写在一起念作「加号这个符号」。
- **它的定义位置和普通招式一样** —— 写在图纸里面就是图纸上的招式。所以喊的时候写 `a + b`，翻译官喵就去图纸里找「加号」那一手，找到就把 `a` 当自己、`b` 塞进 `other`。
- **`a + b` 里的左右两边，各自对上了谁**：左边那只是「自己」，右边那只塞进了 `other`。这就是为什么里面有 `count`（自己的）和 `other.count`（对方的）两个数。
- **`return FishBag(count + other.count);`** —— 加出来的结果**还是一只袋子**（`FishBag`），不是数字。所以 `a + b` 能接着往下用，比如 `c.howMany()`。要是返回数字，`c = a + b` 那一句就写不成了。
- **`bool operator==(...)` 叼回来的是一句「是 / 不是」**：两张袋子里的数一样多就回 `true`，不一样就回 `false`。本喵在 `main` 里用 `(a == b) ? "一样喵" : "不一样喵"` 把这句话翻成人话印出来。

这一跳到底怎么走的，本喵把 `a + b` 那一句拆成一步一步给你看：

```demo
title: a + b 把本喵领到哪一手招式里去了
code:
| class FishBag {
|     int count;
| public:
|     FishBag(int c) : count(c) {}
|     int howMany() const { return count; }
|     FishBag operator+(const FishBag& other) const {
|         return FishBag(count + other.count);
|     }
| };
| FishBag a(3);
| FishBag b(5);
| FishBag c = a + b;
| cout << "a + b 一共 " << c.howMany() << " 条" << endl;

step 先摆出左边那只袋子
at: 10
say: 第 10 行先生出一只袋子 `a`，`count` 那一格装 3。它走的是出生招式，跟 `+` 一点关系都还没有。
meow: 左边这只装 3 条喵～
pose: expect
a 袋子里的 count = 3
b 袋子里的 count = （还没生）
c 这只新袋子 = （还没生）

step 右边那只也生出来
at: 11
say: 第 11 行再生一只 `b`，装 5。到这一步为止，两只袋子各过各的，谁也没搭理谁。
meow: 右边这只装 5 条～
pose: expect
a 袋子里的 count = 3
b 袋子里的 count = 5
c 这只新袋子 = （还没生）

step 走到 a + b：先看 + 左边坐的是谁
at: 12
say: 第 12 行要算 `a + b`。翻译官喵**并不会自己就会加法**：它先瞄一眼 `+` **左边**坐的是谁 —— 是 `a`，一只本喵图纸生出来的袋子。于是它去**袋子图纸里**找一手叫「加号」的招式（第 6 行那一手）。这一刻只是**找到**，还没进去；`c` 也还**没生**。
meow: 左边是袋子，去图纸里找加号喵
pose: think
a 袋子里的 count = 3
b 袋子里的 count = 5
c 这只新袋子 = （还没生）

step 跳进去：自己是 a，对方塞进 other
at: 6
say: 高亮从第 12 行**跳开了** —— 本喵没停在 `+` 上，而是钻进了第 6 行这一手。进去以后，`a` 成了肚子里的「自己」，`b` 被塞进了 `other`。所以里面有 `count`（自己的 3）和 `other.count`（对方的 5）两个数。
meow: 钻进加号那一手，a 是自己喵
pose: busy
a 袋子里的 count = 3
b 袋子里的 count = 5（塞进 other 了）
c 这只新袋子 = （还没生）

step 跑身子：3 + 5 得 8，拿 8 生一只新袋子
at: 7
say: 第 7 行先把 `count + other.count` 算出来 —— 3 加 5 得 8。然后**拿这个 8 去生一只新袋子**：交回去的是**一只袋子，不是数字**，所以 `a + b` 还能接着往下用。注意这一刻 `c` **还是没生** —— 那一手还没把袋子交出来。
meow: 3 加 5 得 8，装进一只新袋子
pose: yay
a 袋子里的 count = 3
b 袋子里的 count = 5（塞进 other 了）
c 这只新袋子 = （还没生，8 还捏在那一手手上）

step 回到第 12 行，那手把新袋子交给 c
at: 12
say: 那一手跑完，装着 8 的新袋子被交回**刚才那一行**，`c` 一把接住。到这一刻 `c` 才真的有东西 —— 装着 8 条。
meow: 交回来啦，c 接住这只新袋子
pose: yay
a 袋子里的 count = 3
b 袋子里的 count = 5（塞进 other 了）
c 这只新袋子 = 装 8 条

step 印出来：8
at: 13
say: 最后一行印 `c.howMany()`，出来 `a + b 一共 8 条`。整段里本喵**一个字母都没写「怎么加」** —— 只写了 `a + b`，翻译官喵自己找到第 6 行那一手去跑了。**符号只是招式的外衣**，第一回被看见喵。
meow: 符号只是招式的外衣喵
pose: proud
a 袋子里的 count = 3
b 袋子里的 count = 5（塞进 other 了）
c 这只新袋子 = 装 8 条
```

**记住这一条**：`a + b` 里那个 `+` **不是语言自带的加法** —— 翻译官喵先看 `+` 左边坐的是谁，再到**那张图纸里**找一手叫「加号」的招式（`operator+`），找到就跳进去跑，跑完把结果交回来。左边那只不一样，跳进去的那一手就跟着不一样喵。

### 那两个尾巴上的 `const` 是干嘛的

`FishBag operator+(const FishBag& other) const` 这一行里有**三个 `const`**，它们的分工是：

| 写在哪 | 管什么 |
|---|---|
| `const FishBag& other` 里的 `const` | 本喵只说「看一眼对方的袋子」，**不许改它** |
| 行尾那个 `const` | 本喵自己这只袋子**也不许被改** —— 加法不该把原来那只袋子改掉 |
| 返回类型前面**没有** `const` | 叼回来的是一只**新袋子**，随便用 |

行尾那个 `const` 是**好习惯里的头一条**：`a + b` 读起来是「算一个新的出来」，谁都不该被改动。写上它，翻译官喵会在本喵手滑改了自己格子的时候当场拦下来。

## 二、让 `cout` 也认得本喵的袋子

上面印袋子还得写 `c.howMany()`，挺啰嗦。本喵想直接写 `cout << a`。

那就要给 `<<` 也来一手。可这一次有个麻烦：**`<<` 左边坐着的是 `cout`，它不是本喵图纸生的**。把定制招式写在图纸里面，翻译官喵会去「袋子」里面找规矩，可左边根本不是袋子 —— 找错了地方。

所以流运算符的定制招式**必须写在图纸外面**，而且要把**两边都当成塞进来的料**：

```cpp
#include <iostream>
using namespace std;

class FishBag {
    int count;
public:
    FishBag(int c) : count(c) {}
    friend ostream& operator<<(ostream& os, const FishBag& bag);
};

ostream& operator<<(ostream& os, const FishBag& bag) {
    os << "一袋 " << bag.count << " 条小鱼干";
    return os;
}

int main() {
    FishBag a(8);
    cout << "本喵手里有：" << a << "喵" << endl;
    return 0;
}
```

```text
本喵手里有：一袋 8 条小鱼干喵
```

这一段的每一处都值得单独说：

- **`operator<<` 写在图纸外面** —— 它是个**外面的招式**，左边右边都是塞进来的料：第一份是坐左边的那只 `cout`，第二份是坐右边的袋子。
- **它就是上一课的开门招式！** 图纸里那行 `friend ostream& operator<<(ostream& os, const FishBag& bag);` 正是那张通行证 —— 因为外面的招式够不到袋子里带盖的 `count`，得先给它开门。**本课和上一课就这样接上了喵。**
- **`ostream& os` 和返回的 `ostream&`**：左边那只 `cout` 得**原样传下去**，不能抄一份。所以两头都写着那个 `&`（猫爪指向牌的温柔版）。传下去的用意是让 `<<` 能一个接一个连着写 —— `cout << "本喵手里有：" << a << "喵"` 这一长串，就是把同一只 `cout` 一路接力传下去。
- **`return os;` 这一句不能省。** 少了它，`<< a` 之后接力棒就掉了，后面那个 `"喵"` 没人接。
- **一条只属于流运算符的讲究**：本喵**不写** `friend` 也能让它跑起来吗？能 —— 那就得给袋子配一个能读 `count` 的公开招式。但让外面的招式**直接读**袋子里那一格，正是开门那一手的用途，所以本喵选它。两种写法都对，本喵只是挑了眼熟的那种喵。

## 三、规则与边界：哪些能做，哪些做不了

定制符号很有力，但它有几条死规矩。

**第一条：本喵不能发明新符号，也不能动内建类型之间的老规矩。**

```cpp
#include <iostream>
using namespace std;

int operator+(int a, int b) {
    return a + b;
}

int main() {
    cout << 1 + 2 << endl;
    return 0;
}
```

```text
main.cpp:4:5: error: 'int operator+(int, int)' must have an argument of class or enumerated type
```

念作：「**这个加号的两边全是内建类型，本喵插不上手喵。**」翻译官喵这句话里的意思是：定制一个符号，**至少要有一个操作数是本喵图纸生出来的真猫**。两个数字相加这种老规矩，轮不到本喵来改 —— 真改了，全世界的程序都会跟着变样。

（顺带说一句：连**一个全新的符号**都造不出来。你不能写 `operator**` 这种没见过的符号 —— 能定制的，只有这门语言本来就有的那一批。）

**第二条：有一批符号，只能写成图纸上的招式。**

本喵刚刚把 `+` 写成了图纸上的招式，其实 `+` **也可以**写成外面的招式 —— 和 `<<` 完全一样的路子：

- 招式名照旧是 `operator+`，只是在它前面要写清楚「算出来的结果是什么东西」。
- **左右两边都当塞进来的料**：`FishBag operator+(const FishBag& a, const FishBag& b)` 这样写，第一份料就是坐左边的那只（`a`）、第二份是坐右边的（`b`），**不再分「自己」和「对方」** —— 图纸里那一手靠「自己」才分得清左右，外面这一手两只是平起平坐的。
- 里面照样能写 `a.howMany() + b.howMany()`，只要 `howMany` 是个公开招式就够，**连开门都不用**。

同一件事两种写法都对：**左边是本喵图纸生出来的真猫，两种位置随你挑；左边坐着别人家的东西（比如 `cout`），就非得写到外面去。**

但有一批符号**反而不能**写到外面去，它们必须写在图纸里面：

| 符号 | 意思 |
|---|---|
| `=` | 赋值那一手（下一课的主角） |
| `[]` | 用中括号取东西 |
| `()` | 把真猫当招式喊 |
| `->` | 顺着牌子够格子 |

记住这一条**不用背整张表**，只要记住：**能不能写在图纸外面，取决于左边那只到底是谁**。左边是本喵自己的真猫，两种写法随你；左边站着别人家的东西（比如 `cout`），就非得写到外面去。

**第三条：`<<` 写在图纸里会怎样？** 本喵真的跑过：

```cpp
#include <iostream>
using namespace std;

class FishBag {
    int count;
public:
    FishBag(int c) : count(c) {}
    void operator<<(ostream& os) const {
        os << count;
    }
};

int main() {
    FishBag a(8);
    cout << a << endl;
    return 0;
}
```

```text
main.cpp:15:10: error: no match for 'operator<<' (operand types are 'std::ostream' {aka 'std::basic_ostream<char>'} and 'FishBag')
```

「**找不到能用的 `<<` 喵**」—— 左边是 `cout`，右边是袋子，这个组合谁也接不住。**本喵定制的那个 `<<` 是「袋子坐左边」的规矩，而这里坐左边的是 `cout`，两个正好反了。** 这一条是新手最容易摔的地方：把流运算符写进图纸里，它不会报「你写错了」，只会说「找不到」喵。

::: tip 猫咪提示
今天记住五句话：

1. **`operator+` 这种写法就是「定制符号」的口令** —— `operator` 后面紧跟要定制的那个符号。
2. **定制招式至少得有一边的操作数是本喵图纸生的真猫**，两个内建类型之间插不上手；全新的符号也造不出来。
3. **定制招式返回的还是本喵图纸生的真猫**（`a + b` 给一只新袋子），所以能接着往下用。
4. **`<<` 要让 `cout` 认得本喵的袋子，就必须写在图纸外面**，左右两边都当塞进来的料，`cout` 那头要用那个 `&` 原样传下去、并且 `return os;`。
5. **行尾那个 `const` 是「本喵自己也不改」** —— 加法、比大小这种只读数的事，两边都该挂上它。
:::

::: warn 小心喵
- **别想给两个数字定制 `+`。** 报错原话是「must have an argument of class or enumerated type」—— 记得它，一眼就认出来是「两边都不是本喵的真猫」。
- **别把 `<<` 写进图纸里。** 报错是「no match for 'operator<<'」，看着像符号没定义，其实是**位置站反了**。
- **优先级和结合性改不了。** `a + b * c` 永远先算乘法，本喵定制了 `+` 和 `*` 也一样 —— **定制的是「这个符号做什么」，不是「它先算还是后算」。**
- **别为了炫技乱用。** 符号该像它本来的意思：袋子 `+` 袋子是合起来，袋子 `-` 袋子是拿走一些。要是你把 `+` 定义成「相减」，读代码的猫会被绕晕 —— 定制符号是为了**顺嘴**，不是为了变魔术。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `FishBag operator+(const FishBag& other) const` | 图纸上的「加号」这一手：本喵 + 另一只袋子，算出一只新袋子 |
| `bool operator==(const FishBag& other) const` | 「等号」这一手：两边数目一样多就给一句「是」 |
| `a + b` / `a == b` | 喊这两手的写法 —— 和用数字一样顺嘴 |
| `ostream& operator<<(ostream& os, const FishBag& bag)` | 写在图纸**外面**的流运算符：左边 `cout`、右边袋子 |
| `return os;` | 把 `cout` 原样传下去，好让 `<<` 一路接力 |
| `friend ostream& operator<<(...)` | 写在图纸**里面**的那行通行证（上一课那一手） |
| `must have an argument of class or enumerated type` | 两边都不是本喵的真猫 —— 这符号轮不到你定制 |
| `no match for 'operator<<'` | 大概率是把流运算符写进图纸里，位置站反了 |

## 小任务

1. 把第一节整段抄进练习场跑一次，确认四行输出对得上；再把 `operator+` 里的 `+` 改成 `*`，把 `a + b` 也跟着改成 `a * b`，看看结果变成多少。
2. 给 `FishBag` 再加一手 `bool operator!=(const FishBag& other) const`（「不相等」）。**照着 `operator==` 写，只把叼回去的那句反过来** —— 写对了，`a != b` 就能用了。
3. 把第二节的 `<<` **挪进图纸里**（改成 `void operator<<(ostream& os) const`），跑一次，把翻译官喵的原话抄进小本本。再挪回去，确认又能跑。
4. 试一试：在 `operator+` 的行尾**删掉**那个 `const`，别的地方一个字不改。能编过吗？能的话再想想 —— 本喵课上为什么说写上它更保险？
5. 想一想：本喵在第一节里写 `FishBag c = a + b;`。这里的 `c` 是**新造出来的一只袋子**，还是 `a` 或者 `b` 被改掉了？跑一遍改改看，答案自己就出来了。

下一课是本喵觉得最凶险的一课：照图纸生猫的时候，**如果袋子里装的是「现要现租的仓库」，两只猫会指向同一间屋**。一个改，另一个跟着变；收尾的时候还会撞车。去下一课探险喵～ 🐾
