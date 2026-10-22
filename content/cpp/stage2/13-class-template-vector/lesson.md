---
id: cpp-stage2-13
lang: cpp
stage: 2
order: 13
title: 类模板与 vector 初步
tags: [模板, STL, vector]
required: ["cpp-stage2-12"]
crossRefs: []
estMinutes: 32
keywords: [class template, vector, push_back, size]
---

## 钩子：一只装不满的碗

上一课本喵学会了在图纸上留空位 —— 那张图纸裁的是**招式**：比大小、换位、挑最大的，塞什么料就裁成什么版。

本喵今天遇到的是两件新麻烦：

1. 本喵想要一只**碗**，可本喵不知道今天有几条小鱼干 —— 可能 3 条、可能 12 条，还可能一条都没有。格数写死的碗，多出来的就往地上掉。
2. 本喵想要一整只**窝**：里面有一只碗，还有「放一条进去」「数数有几条」这好几手。这一整套，本喵也想画成一张能量体裁衣的图纸 —— 装小鱼干裁一款、装名字牌裁一款。

第一件是本喵今天要端的碗（`vector`），第二件是把上一课的空位**从招式挪到整张图纸上**。两件一起办喵。

## 一、空位从招式挪到整张图纸上

上一课的空位立在**招式**那一行。今天本喵把它立到**整张图纸**上：

```cpp
#include <iostream>
#include <string>
using namespace std;

template <typename T>
class Box {
public:
    Box(T x) : v(x) {}
    T get() { return v; }
private:
    T v;
};

int main() {
    Box<int> a(3);
    Box<string> b(string("小鱼干"));
    cout << a.get() << endl;
    cout << b.get() << endl;
    return 0;
}
```

```text
3
小鱼干
```

要紧的有两件事：

- **立空位那一行，一个字都没变**：还是 `template <typename T>`。上一课那句话在这一课照样管用 —— **先立空位，再画图纸。**
- **空位落在了整张图纸上**：它落在盒子里那一格 `T v;`，也落在生图纸那一手和 `get` 那一手上。同一个 `T`，指的是同一个空位 —— 塞整数裁出来的是装整数的盒子，塞字符串裁出来的是装字符串的盒子。

它的正式名字是 类模板（整张图纸留个空位）。

::: tip 猫咪提示
**用整张图纸的时候，本喵得自己点名。**

`Box<int> a(3);` —— 本喵点名要整数款；`Box<string> b(...);` —— 本喵点名要项链款。

这跟上一条正好相反：上一课本喵**不点名**，让翻译官喵按料自己猜（裁的是招式）；这一课是**本喵自己点名**（裁的是整张图纸）。
:::

::: warn 小心喵
翻译官喵**这一课的图纸一概不猜**。本喵在本机真跑过 `Box a(3);` 这一句 —— 料都递到它手边了，它照样当场拦下：`error: missing template arguments before 'a'`（`a` 前面那个空位本喵没点名）。

上一课的**招式**它肯按料自己反推，这一课的**整张图纸**它一律不推（两个编译器上都量过）—— 所以本喵用整张图纸的时候，**老老实实点名**是唯一的路。
:::

## 二、一只会自己变长的碗

```cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(3);
    v.push_back(5);
    v.push_back(7);
    cout << v.size() << endl;
    cout << v[0] << endl;
    cout << v.back() << endl;
    for (int x : v) {
        cout << x << " ";
    }
    cout << endl;
    return 0;
}
```

```text
3
3
7
3 5 7
```

**本喵一个格数都没写死。** 放三只进去它就是三格，放十只它就是十格 —— 它自己会长。这只碗的正式名字是 `std::vector`，本喵平时写 `vector` 就够。

一句一句念：

| 本喵写下的 | 它的意思 |
|---|---|
| `#include <vector>` | 端碗上桌 —— 这一句不能漏（漏了看摔法一） |
| `vector<int> v;` | 端一只**空碗**，碗里装的是整数 |
| `v.push_back(3)` | 放一只进去，放在**最末尾** —— 碗自己长大一格 |
| `v.size()` | 碗里现在有几个 |
| `v[0]` | 第 0 格里的那一只（格子是从 0 数起的） |
| `v.back()` | **最后放进去**的那一只 |
| `for (int x : v) { }` | 一只一只挨着过一遍 |
| `v.pop_back()` | 把最后那一只**拿走** |
| `v.empty()` | 碗空不空（空是 `1`，不空是 `0`） |
| `v.clear()` | 一口气倒空 |

碗里那些格子是**怎么来的**？本喵拆成一步一步走给你看：

```demo
title: 碗里的格子，是放一只长一格的
code:
| vector<int> v;                     // 端一只空碗
| v.push_back(3);                    // 放一只进去，放在最末尾
| v.push_back(5);
| v.push_back(7);
| cout << v.size() << endl;          // 碗里现在有几个
| cout << v[0] << endl;              // 第 0 格里的那一只
| cout << v.back() << endl;          // 最后放进去的那一只

step 端一只空碗
at: 1
say: `vector<int> v;` 是「端一只**空碗**，碗里装的是整数」。这会儿碗里**一个格子都没有** —— 本喵也没跟它说过「先摆三个空位」。
meow: 端来一只空碗，一格都没有喵～
pose: expect
碗里有几格 = 0
碗里的小鱼干 = （空碗）
碗自己管的地方 = （还没要地方）
屏幕上 = 还没印

step 放第一只：先得要到一块地方
at: 2
say: `v.push_back(3)` 是「放一只进去，放在**最末尾**」。碗里一格都没有，它得**先要一块摆得下鱼干的地方**，才把 3 摆进第 0 格 —— **格子是放一只、长一格的**，不是一开始就摆好三个。
meow: 第一格是放的时候才长出来的喵！
pose: busy
碗里有几格 = 1
碗里的小鱼干 = 3
碗自己管的地方 = 刚要到一块（摆得下这一格）
屏幕上 = 还没印

step 说句悄悄话：地方不够的时候
at: 2
say: 那块地方**不是要多大就永远多大**。等哪一次放进去、地方**一格空位都不剩**了，碗会**先另要一块更大的**，把已经放好的小鱼干**原样搬过去**，再把原来那块**还掉**（用的就是前面学的「现要现租的仓库」那一手）—— 这一整套本喵一行都没写。
meow: 满了就自己搬家，本喵不用管喵～
pose: remind
碗里有几格 = 1
碗里的小鱼干 = 3
碗自己管的地方 = 不够的时候：自己再要一块更大的
屏幕上 = 还没印

step 再放一只
at: 3
say: 又放一只：**碗自己长大一格**。上一只摆在第 0 格，这一只就排在它后面，是第 1 格。碗里的鱼干排成了 3、5。
meow: 第二格长出来，3 后面排 5 喵！
pose: busy
碗里有几格 = 2
碗里的小鱼干 = 3 5
碗自己管的地方 = 本喵没写，碗自己管
屏幕上 = 还没印

step 第三只
at: 4
say: 再放一只，碗里 3 格。三只**都没指定过摆哪儿** —— `push_back` 一律摆在最末尾，格号就是它们进来的先后顺序。
meow: 三格啦，本喵一个数字都没写死喵！
pose: busy
碗里有几格 = 3
碗里的小鱼干 = 3 5 7
碗自己管的地方 = 本喵没写，碗自己管
屏幕上 = 还没印

step 数一数：碗里现在有几个
at: 5
say: `v.size()` 问的是「碗里现在**有几个**」—— 3。它数的是**格数**，不是格号：格号从 0 数到 2，一共 3 格。
meow: 数一数，碗里三位喵～
pose: yay
碗里有几格 = 3
碗里的小鱼干 = 3 5 7
碗自己管的地方 = 本喵没写，碗自己管
屏幕上 = 3

step 第 0 格里的那一只
at: 6
say: `v[0]` 叼的是**第 0 格**里那一只 —— 印出来也是 3，可它跟上一步那个 3 **不是一回事**：上一步说的是「有几个」，这一步说的是「第 0 格里的那一个」。格子是从 **0** 数起的。
meow: 第 0 格是 3，可不是「3 个」喵～
pose: think
碗里有几格 = 3
碗里的小鱼干 = 3 5 7
碗自己管的地方 = 本喵没写，碗自己管
屏幕上 = 3

step 最后放进去的那一只
at: 7
say: `v.back()` 是「**最后放进去**的那一只」—— 7。它不看格号、只看谁排在最后；这件事也是碗自己记着的，本喵一个格号都没写过。
meow: 最后那只 7，一叼就中喵！
pose: proud
碗里有几格 = 3
碗里的小鱼干 = 3 5 7
碗自己管的地方 = 本喵没写，碗自己管
屏幕上 = 7
```

一句话记住：**格子是放一只、长一格的** —— 本喵一个格数都没写死；碗自己那块地方够不够、不够了去哪儿另要一块更大的、鱼干怎么搬过去，**全是它自己办**。

再看一遍「拿走」和「倒空」：

```cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    for (int i = 1; i <= 5; i++) {
        v.push_back(i * i);
    }
    cout << v.size() << endl;
    v.pop_back();
    cout << v.size() << endl;
    cout << v.empty() << endl;
    v.clear();
    cout << v.empty() << endl;
    return 0;
}
```

```text
5
4
0
1
```

**「空不空」这件事，翻译官喵是用 `0` 和 `1` 回答本喵的**：`0` 是「不空」，`1` 是「空」。

::: warn 小心喵
碗有两种端法，装进去的东西**不一样**：

- `vector<int> a(3);` —— **圆括号**：先摆好 3 个空位（格子里是 3 个 `0`）。
- `vector<int> b{3};` —— **花括号**：放进去**一只 `3`**。

本喵真跑过这一对：`a.size()` 印 `3`，`b.size()` 印 `1`。**一声不吭**，两种都编得过、跑得完 —— 端错了不会有人提醒本喵，全靠自己盯着屏幕。
:::

**自己数着格号一格格走的时候，翻译官喵会嘀咕一句。** 本喵在本机真跑过这一段：

```cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(3);
    for (int i = 0; i < v.size(); i++) {
        cout << v[i] << endl;
    }
    return 0;
}
```

```text
3
```

屏幕上印的 `3` 一点没错，可翻译官喵在旁边嘀咕了这么一句：

```text
main.cpp:8:23: warning: comparison of integer expressions of different signedness: 'int' and 'std::vector<int>::size_type' {aka 'long long unsigned int'} [-Wsign-compare]
```

念作：「**你拿来当格号的那个 `int`、和碗里数的个数，不是同一款 —— 一个带正负、一个只会往正数长。**」

这只是一句嘀咕：程序照样跑完，屏幕上的答案照样对。想让它闭嘴，最省事的办法是**别自己数格号**，用 `for (int x : v)` 一只一只过 —— 那样本喵根本不写格号。

## 三、把碗画进图纸里

```cpp
#include <iostream>
#include <vector>
using namespace std;

template <typename T>
class Pouch {
public:
    void put(T x) { goods.push_back(x); }
    int count() { return goods.size(); }
    T at(int i) { return goods[i]; }
private:
    vector<T> goods;
};

int main() {
    Pouch<int> p;
    p.put(3);
    p.put(5);
    cout << p.count() << endl;
    cout << p.at(0) << endl;
    Pouch<double> q;
    q.put(1.5);
    cout << q.at(0) << endl;
    return 0;
}
```

```text
2
3
1.5
```

**这一整只窝，是一张图纸裁出来的。** 碗里装什么（`vector<T>`）、`put` 收什么料、`at` 叼回来什么 —— 全是**同一个空位** `T`。本喵点名整数，它就是一只整数窝；点名小数，它就换成一只小数窝。

同一张图纸，还能裁出两只**不一样的窝**放在一块儿：

```cpp
#include <iostream>
#include <string>
#include <vector>
using namespace std;

template <typename T>
class Pouch {
public:
    void put(T x) { goods.push_back(x); }
    int count() { return goods.size(); }
    T at(int i) { return goods[i]; }
private:
    vector<T> goods;
};

int main() {
    Pouch<int> nums;
    nums.put(3);
    nums.put(5);
    nums.put(7);
    Pouch<string> names;
    names.put(string("小橘"));
    names.put(string("大肥鱼"));
    cout << nums.count() << endl;
    cout << names.count() << endl;
    cout << names.at(0) << endl;
    return 0;
}
```

```text
3
2
小橘
```

一只窝装整数、一只窝装名字牌，两张都出自同一张图纸。上一课的手感是「一张图纸裁好几款料」，这一课是「**一张图纸裁好几只窝**」。

::: tip 猫咪提示
**图纸里的招式，没人喊就不查。**

本喵在本机真跑过这么一张图纸：里面有一手写错了（把一句话塞进「只有整数才装得下」的那一格），可 `main` 里**一次都没喊它** —— 翻译官喵**一个字都没说**，程序跑完，屏幕上印 `跑完了`。

等本喵真的喊它一声，它才报 `error: invalid conversion from 'const char*' to 'int'`，还带一句「就是这个空位、就是这一手」。

意思就是：**图纸是照料的款式裁的，本喵不裁它、它就不查。** 一张很少被用到的图纸里藏着错，可能很久都不会露头 —— 这也是为什么本喵平时总要把每张图纸都喊一遍。
:::

## 四、四种摔法

### 摔法一：碗没端上桌

```cpp
#include <iostream>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(3);
    cout << v.size() << endl;
    return 0;
}
```

```text
main.cpp: In function 'int main()':
main.cpp:5:5: error: 'vector' was not declared in this scope
main.cpp:2:1: note: 'std::vector' is defined in header '<vector>'; this is probably fixable by adding '#include <vector>'
```

翻译官喵的原话是 `error: 'vector' was not declared in this scope` —— 念作：「**`vector` 是什么东西？本喵没见过这个名字喵。**」它后面还贴心地跟了一句 `note`，把该添的那一行原样念出来：`'std::vector' is defined in header '<vector>'; this is probably fixable by adding '#include <vector>'`。

修法就是**把碗端上桌**：在文件最上面补一行 `#include <vector>`。

### 摔法二：招式画在图纸外，漏了立空位那一行

```cpp
#include <iostream>
using namespace std;

template <typename T>
class Box {
public:
    Box(T x) : v(x) {}
    T get();
private:
    T v;
};

T Box<T>::get() {
    return v;
}

int main() {
    Box<int> a(7);
    cout << a.get() << endl;
    return 0;
}
```

```text
main.cpp:13:1: error: 'T' does not name a type
```

翻译官喵的原话是 `error: 'T' does not name a type` —— 念作：「**`T` 是什么东西？本喵没见过这个名号喵。**」

为啥？因为**空位是 `template <typename T>` 那一行立出来的**。图纸里面写的时候，本喵站在图纸上，`T` 看得见；可本喵跑到图纸外面来画这一手，**空位就不在手边了** —— 得在它上面**重新立一次**：

```cpp
#include <iostream>
using namespace std;

template <typename T>
class Box {
public:
    Box(T x) : v(x) {}
    T get();
private:
    T v;
};

template <typename T>
T Box<T>::get() {
    return v;
}

int main() {
    Box<int> a(7);
    cout << a.get() << endl;
    return 0;
}
```

```text
7
```

**记牢这一对：图纸里面画招式，本喵站在图纸上；跑到图纸外面画，立空位那一行要再写一遍。**

### 摔法三：不点名

```cpp
#include <iostream>
using namespace std;

template <typename T>
class Box {
public:
    Box(T x) : v(x) {}
    T get() { return v; }
private:
    T v;
};

int main() {
    Box b;
    return 0;
}
```

```text
main.cpp: In function 'int main()':
main.cpp:14:9: error: missing template arguments before 'b'
```

翻译官喵的原话是 `error: missing template arguments before 'b'` —— 念作：「**`b` 前面那个空位没点名 —— 你还没告诉本喵它该是哪一款料做的喵。**」

上一课的**招式**它能按料反推空位；这一课的**图纸**它不推 —— 本喵不点名，当场拦下。补一句：就算把料递进去它也不推（上面「小心喵」那段真跑过）。

修法就是**点名**，同时把这一手要的那个料递进去：`Box<int> b(3);`。

### 摔法四：空碗里减一

```cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    cout << v.size() << endl;
    cout << v.size() - 1 << endl;
    return 0;
}
```

```text
0
18446744073709551615
```

本喵想算「最后一个格子是第几号」—— 碗里几个数、减 1 就是它。空碗的时候本喵心里想的是「一个格子都没有，那就印 `0` 吧」，可屏幕上印出来的是 **`18446744073709551615`**。

根子在碗里那个「个数」的脾气上：它**只会往正数长，不会变负**。`0` 再减 `1`，它不往回绕成 `-1`，而是绕到了这一款能表示的**最大值**去。

**这一路一个错都不报**：翻译官喵安安静静让程序跑完了。要防它，动手减之前先问一句碗空不空：

```cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    int n = 0;
    if (!v.empty()) {
        n = v.size() - 1;
    }
    cout << n << endl;
    v.push_back(3);
    v.push_back(5);
    if (!v.empty()) {
        n = v.size() - 1;
    }
    cout << n << endl;
    return 0;
}
```

```text
0
1
```

**先问一句 `v.empty()`，再动手减** —— 空碗就老老实实待在 `0`，不往最大值那边绕。

## 五、什么时候该给整张图纸留空位

本喵把话收成三条：

1. **一整套（碗 + 好几手）、好几款料 → 留空位。** 本喵这一课的窝就是：碗里装什么、放进去什么、叼回来什么，全是同一个空位。
2. **只是几款料换来换去、身上没有碗 → 上一课那种招式图纸就够了。** 别为了比个大小去画一整张图纸。
3. **只有一款料 → 别留空位。** 本喵这辈子只装整数，那直接用现成的 `vector<int>` 就好，最省事也最好读。

还有一句要紧的：**先看看现成的够不够用。** `vector` 本身就是别人画好的一张图纸 —— 装什么料都能裁（`vector<int>`、`vector<string>`、`vector<double>`）。本喵真要自己画一整张的时候，是「**碗 + 本喵自己那几手**」要打包成一个整体的时候。

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `template <typename T> class Pouch { ... };` | 整张图纸留一个空位，代号 `T` |
| `Pouch<int> p;` | 用整张图纸时**自己点名**：整数款 |
| `Pouch<int>` / `Pouch<string>` | 同一张图纸裁两款（整数窝 / 名字窝） |
| `p.put(3)` / `p.count()` / `p.at(0)` | 图纸自己的几手 —— 放料 / 数数 / 取第几个 |
| `#include <vector>` | 端碗上桌，不能漏 |
| `vector<int> v;` | 端一只装整数的空碗 |
| `v.push_back(3)` | 放到最末尾，碗自己长大一格 |
| `v.size()` / `v[0]` / `v.back()` | 有几个 / 第 0 格 / 最后放进去的那只 |
| `for (int x : v) { }` | 一只一只挨着过 |
| `v.pop_back()` / `v.empty()` / `v.clear()` | 拿走最后一只 / 空不空 / 一口气倒空 |
| `error: 'vector' was not declared in this scope` | 漏了 `#include <vector>` |
| `error: 'T' does not name a type` | 招式画在图纸外，漏了立空位那一行 |
| `error: class template argument deduction failed:` | 用整张图纸时一个料都不给 |
| `18446744073709551615` | 空碗里减一 —— 绕到最大值去了 |

## 小任务

1. 把第一节那段抄进练习场跑一遍，确认屏幕上真是 `3`、`小鱼干` 两行。
2. 把 `Box<int> a(3);` 那一句改成 `Box a(3);` 再跑一次 —— 翻译官喵照样认。再把圆括号里的料去掉（写成 `Box b;`）跑一次，看看它说什么喵。
3. 把 `vector<int> b{3};` 换成 `vector<int> b(3);` 再跑一次，看 `b.size()` 印出来是几。
4. 往碗里放五只，再用 `v.clear()` 倒空，确认 `v.empty()` 印的是 `1`。
5. 想一想：本喵这张 `Pouch` 图纸上，`at` 那一手能不能改成「把第 i 个**换掉**」？改起来会多出什么麻烦？先记在心里喵。

下一课本喵要办一场大工程：把今天这只碗、上一课那张图纸，再加上前面学过的**牌子**、**约定**，全用在一块儿 —— 给一屋子猫做一套**宠物管理系统**。图纸、碗、菜单怎么摆到一块儿，去下一课探险喵～ 🐾
