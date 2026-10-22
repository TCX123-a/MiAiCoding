---
id: cpp-stage3-03
lang: cpp
stage: 3
order: 4
title: vector、list 与 deque
tags: [STL, 容器]
required: ["cpp-stage3-02"]
crossRefs: []
estMinutes: 26
keywords: [vector, list, deque, push_front, push_back]
---

## 钩子：往**最前面**塞一条，行不行喵？

前面几课本喵只请过一只柜子：`vector`。它有两个特别顺手的本事 —— 往**后面**塞货（`v.push_back(x)`）、**报编号取货**（`v[0]`、`v[1]`）。本喵一直用得挺舒服。

可今天出了件麻烦事：新捞上来的鱼干要**摆到最前面**，最鲜的先吃。本喵照着老习惯喊了一句 `v.push_front(...)` —— 翻译官喵当场把本喵拦下了。

拦得有道理。因为 `vector` 这只柜子里的货是**挨着坐**的：想让头一个位置腾出空来，身后每一格都得往后挪一次。C++ 干脆不给它这一招，等于在提醒本喵：**这活儿该换一只柜子干啦。**

所以今天本喵一口气请出三只柜子摆在一起看：`vector`、`list`、`deque`。看完你就知道什么活儿该交给谁喵～

## 一、`vector`：挨着坐的一排柜子

先回头看看老朋友。这只柜子里的货是**挨着坐**的：第 0 格、第 1 格、第 2 格手牵手排成一条。所以「给本喵第 3 格」这种话它最爱听 —— 位置一算就到，一步跨过去：

```cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(3);
    v.push_back(8);
    v.push_back(5);

    cout << v[1] << endl;
    cout << v[v.size() - 1] << endl;
    return 0;
}
```

```text
8
5
```

两句都是报编号取货：`v[1]` 是**第 1 格**（编号从 0 数起），`v[v.size() - 1]` 是**最后一格** —— 柜子有几格是 `v.size()` 说的，所以最后一格的编号就是「格数减一」。记住这一句，今天三只柜子里有两只都用得上它。

### 它的短板：往最前面塞

C++ 的 `vector` 压根没有「从前面塞」这一招。本喵真跑过一遍，翻译官喵当场拦下：

```cpp
#include <iostream>
#include <vector>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(3);
    v.push_front(1);
    cout << v[0] << endl;
    return 0;
}
```

```text
main.cpp:8:7: error: 'class std::vector<int>' has no member named 'push_front'
    8 |     v.push_front(1);
```

念作：**「`vector` 这只柜子身上，没有一位叫 `push_front` 的成员。」**（`has no member named` 就是「没有一位成员叫这个名字」。）

这不是它偷懒，是**挨着坐**的代价：要在最前面腾出一格，身后每一格都得往后挪一次 —— 货越多，挪得越累。所以 C++ 干脆不给这一招，逼本喵停下来想清楚：**这活儿是不是该换只柜子？**

## 二、`list`：用猫爪指向牌串起来的柜子

第二只柜子叫 `list`（念「李斯特」）。它里面的货**不挨着坐**，而是**一格一格串起来**的：每一格都叼着一张写着「下一格在哪儿」的小牌子 —— 就是前面学过的那种**猫爪指向牌**。本喵从头上那一格出发，顺着牌子一路走过去，就把整只柜子走完了。

请柜子的规矩照旧，开头一句 `#include <list>`：

```cpp
#include <iostream>
#include <list>
using namespace std;

int main() {
    list<int> l;
    l.push_back(3);
    l.push_back(8);
    l.push_front(1);
    for (int x : l) {
        cout << x << endl;
    }
    cout << l.size() << endl;
    return 0;
}
```

```text
1
3
8
3
```

一行一行念：

1. **`list<int> l;`** —— 开一只只放整数的链子柜，起名叫 `l`。
2. **`l.push_back(3);`** —— 往**后面**接一格。
3. **`l.push_front(1);`** —— 往**前面**接一格 —— 就是 `vector` 没有的那一招喵！
4. 走一圈印出来是 `1`、`3`、`8`：`1` 是从前面接上去的，所以它排在头一个。
5. **`l.size()`** → `3`：柜子里现在三格。

往前面接这一格，是「链子比挨着坐省事」的**现场**。下面把动作放慢，盯着「柜子」那一栏看 —— 它在第 4 步之前**一直没变过**喵。

```demo
title: 往最前面接一格，别的格子一只都没挪
code:
| list<int> l;
| l.push_back(3);
| l.push_back(8);
| l.push_front(1);
| for (int x : l) {
|     cout << x << endl;
| }
| cout << l.size() << endl;

step 先开一只空柜子
at: 1
say: list<int> l; 开一只只放整数的链子柜。柜子里一格都没有，还没有「头一格」这回事。
meow: 空柜子开好啦，就等接货喵～
pose: expect
柜子 = (空的)
柜子头 = 还没有
x = 还没轮到
印出来 = 还没印

step 后面接一格 3
at: 2
say: push_back(3) 往后面接一格。柜子现在只有这一格，它既是头一格，也是尾巴。
meow: 后面接上 3，先来一条喵～
pose: busy
柜子 = 3
柜子头 = 3 那格
x = 还没轮到
印出来 = 还没印

step 后面再接一格 8
at: 3
say: push_back(8) 再往后面接一格。3 那格的牌子上写了「下一格是 8」—— 货不挨着坐，全靠这张牌子牵着。
meow: 后面再接 8，串成一条喵！
pose: busy
柜子 = 3 → 8
柜子头 = 3 那格
x = 还没轮到
印出来 = 还没印

step 前面接一格 1
at: 4
say: push_front(1) 是 vector 没有的那一招：新格子先牵住原来的头一格（3），再把柜子的头换成它。改的只有这张牌子。
meow: 新格子牵住 3，本喵站到最前面啦！
pose: yay
柜子 = 1 → 3 → 8
柜子头 = 1 那格
x = 还没轮到
印出来 = 还没印

step 回头看一眼：3 和 8 一格都没挪
at: 4
say: 到这一步，3 那格和 8 那格一个字都没改。vector 想在前面腾个位子，身后每一格都得往后搬一次 —— 所以它压根没有这一招。
meow: 老格子一根毛都没碰，喵！
pose: milestone
柜子 = 1 → 3 → 8
柜子头 = 1 那格
x = 还没轮到
印出来 = 还没印

step 走一圈，x 依次装上每格的货
at: 5
say: for (int x : l) 从头一格出发，顺着牌子一格一格摸过去，把每格的货端给 x 看一眼。
meow: 从头上出发，顺着牌子摸喵～
pose: think
柜子 = 1 → 3 → 8
柜子头 = 1 那格
x = 1
印出来 = 还没印

step 印出头一格
at: 6
say: 第一格是刚接上去的 1，所以印出来头一行就是 1 —— 从前面接的货，排在头一个。
meow: 头一行是 1，接对了喵！
pose: yay
柜子 = 1 → 3 → 8
柜子头 = 1 那格
x = 1
印出来 = 1

step 接着一路摸到底
at: 5
say: 顺着牌子接着走，x 变成 3、再变成 8。list 不认 l[0] 这种报编号 —— 想要「第几格」只能像这样自己数着走。
meow: 3、8 挨个摸完，格子走光了～
pose: think
柜子 = 1 → 3 → 8
柜子头 = 1 那格
x = 8
印出来 = 1 3 8

step 印出来是 1、3、8
at: 8
say: 三行印完，头一个是接在最前面的 1；l.size() 报 3，柜子里一共三格。
meow: 1、3、8 三行，一格不落喵！
pose: milestone
柜子 = 1 → 3 → 8
柜子头 = 1 那格
x = 8
印出来 = 1 3 8 / size() = 3
```

### `list` 不会报编号取货

`list` 也有让人挠头的地方。本喵照 `vector` 的习惯写了一句 `l[0]`：

```cpp
#include <iostream>
#include <list>
using namespace std;

int main() {
    list<int> l;
    l.push_back(3);
    l.push_back(8);
    cout << l[0] << endl;
    return 0;
}
```

```text
main.cpp:9:14: error: no match for 'operator[]' (operand types are 'std::__cxx11::list<int>' and 'int')
    9 |     cout << l[0] << endl;
```

念作：**「`[]` 这一招在这只柜子身上，没有一种用法能对得上 —— 你递进来一个整数编号，可它不认这种取货方式。」** 根子还是那句「货不挨着坐」：每格身上只有一张写着「下一格在哪儿」的牌子，所以「第 3 格在哪儿」这个问题**没有一步到位的答案** —— 只能从头上**一格一格数过去**。

那 `list` 想要「第几格」怎么办？**自己数**：

```cpp
#include <iostream>
#include <list>
using namespace std;

int main() {
    list<int> l;
    l.push_back(3);
    l.push_back(8);
    l.push_back(5);

    int i = 0;
    for (auto it = l.begin(); it != l.end(); ++it) {
        cout << "第 " << i << " 格有 " << *it << " 条喵" << endl;
        i++;
    }
    return 0;
}
```

```text
第 0 格有 3 条喵
第 1 格有 8 条喵
第 2 格有 5 条喵
```

编号不是柜子给的，是本喵**自己另备的一个数** `i`（从 0 起，每走完一格加一）；爪子上那格的货还是老伙计 `*it`。**「货」和「编号」是两件事，得分开拿** —— 这一条在链子柜上是躲不掉的。

::: tip 猫咪提示
`list` 两只手都能塞：`push_back` 接后面、`push_front` 接前面。但它**只会走、不会报编号** —— 想要「第几格」，自己备一个数从 0 数起。
:::

## 三、`deque`：两头都能开的柜子

第三只柜子叫 `deque`（念「戴克」），脾气最好：**两头都能开门，而且还能报编号取货。**

```cpp
#include <iostream>
#include <deque>
using namespace std;

int main() {
    deque<int> d;
    d.push_back(3);
    d.push_front(1);
    d.push_back(8);
    cout << d[0] << endl;
    cout << d[d.size() - 1] << endl;
    for (int x : d) {
        cout << x << endl;
    }
    return 0;
}
```

```text
1
8
1
3
8
```

拆开看：

- **`d.push_back(3);`** 往后面塞、**`d.push_front(1);`** 往前面塞、再 **`d.push_back(8);`** 往后面塞 —— 柜子里从前往后是 `1`、`3`、`8`。
- **`d[0]`** 报编号拿头一格 → `1`；**`d[d.size() - 1]`** 报编号拿最后一格 → `8`。老朋友那一招，它也认。
- 走一圈还是那套新写法，一格一行。

### 一个要留心的细节：`push_front` 是把货「顶」到最前面

`push_back` 是一格一格往后排，所以**越晚塞的越靠后**；`push_front` 正相反 —— 每塞一条都顶到最前面，所以**越晚塞的越靠前**。同一批货，换一个塞法，印出来正好倒个个儿：

```cpp
#include <iostream>
#include <deque>
using namespace std;

int main() {
    deque<int> d;
    d.push_back(3);
    d.push_back(8);
    d.push_back(5);

    for (int x : d) {
        cout << x << endl;
    }
    return 0;
}
```

```text
3
8
5
```

```cpp
#include <iostream>
#include <deque>
using namespace std;

int main() {
    deque<int> d;
    d.push_front(3);
    d.push_front(8);
    d.push_front(5);

    for (int x : d) {
        cout << x << endl;
    }
    return 0;
}
```

```text
5
8
3
```

**塞进去的货一模一样，印出来的顺序正好反过来。** 想让新来的排最前面，就用 `push_front`；想按「先来后到」排队，就用 `push_back`。

⚠️ 这一条**翻译官喵一个字都不会说**：两段代码都编得过、都跑得完，差别只在印出来的顺序上。（本喵拿最啰嗦的那档 `-Wall` 真跑过一遍，两回都一声没吭 —— 这种坑只能靠脑子记住喵。）

## 四、三只柜子摆一起比一比

同一件事 —— 往柜子里放 `7` 和 `9`、让 `7` 排在前面 —— 三只柜子写出来的样子是不一样的：

```cpp
#include <iostream>
#include <vector>
#include <list>
#include <deque>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(7);
    v.push_back(9);

    list<int> l;
    l.push_front(7);
    l.push_back(9);

    deque<int> d;
    d.push_front(7);
    d.push_back(9);

    cout << "vector 报编号取货：" << v[0] << " " << v[1] << endl;

    cout << "list 一格一格走：" << endl;
    for (int x : l) {
        cout << x << endl;
    }

    cout << "deque 报编号取货：" << d[0] << " " << d[1] << endl;
    return 0;
}
```

```text
vector 报编号取货：7 9
list 一格一格走：
7
9
deque 报编号取货：7 9
```

`vector` 只能老老实实从后面一条条塞（所以 `7` 先塞）；`list` 和 `deque` 可以「`7` 从前面接、`9` 从后面接」。取货那一步的差别更大：`vector` 和 `deque` 报个编号就拿到，`list` 只能一格一格走完。

| 想干的事 | `vector` | `list` | `deque` |
|---|---|---|---|
| 从后面塞 `push_back` | ✅ 有 | ✅ 有 | ✅ 有 |
| 从前面塞 `push_front` | ❌ 没这招（编不过） | ✅ 有 | ✅ 有 |
| 报编号取货 `v[i]` | ✅ 有 | ❌ 没这招（编不过） | ✅ 有 |
| 一格一格走（爪子 / 新写法） | ✅ 有 | ✅ 有 | ✅ 有 |
| 它最擅长 | 从后面塞、报编号 | 两头塞、中段插删 | 两头塞、还报得了编号 |

## 五、怎么挑：三句口诀

1. **攒货、按编号取货、从头走到尾** → `vector`。日常活儿九成都归它，它也是本喵最常请的那一只。
2. **老要往两头塞、还要报编号** → `deque`。
3. **老要在中间插一格、抽一格，不用报编号** → `list`。

### 为什么是这样：拿鱼塘的话讲性能

- **`vector` 的货挨着坐。** 「第 5 格」一步跨到位，快得像伸爪；可往最前面塞一条，身后每一格都得往后挪一次 —— 货越多挪得越累。所以它**从后面塞最快、报编号也最快**。
- **`list` 的货串成一串。** 想在中间插一格，只要把两张牌子重新接一下，别的格子纹丝不动 —— 中段插删最省事。可要拿「第 5 格」，只能从头上顺着牌子一路数过去，串得越长越费劲。所以它**中段插删最快、报编号根本做不到**。
- **`deque` 两头都能开关门。** 两头加货都快，编号也报得了，很像「两头都留了余地的 `vector`」；可要在**中间**挤一格，照样得挪货。

::: warn 小心喵
报编号取货不是每只柜子都有。看到 `no match for 'operator[]'`，先问自己一句：**这只柜子是不是挨着坐的？** 不是（比如 `list` 这种串起来的），就乖乖改用爪子一格一格走。
反过来，看到 `has no member named 'push_front'` 也一样 —— 那不是本喵打错字，是这只柜子**根本没有这一招**：要么换只柜子，要么换个塞法喵。
:::

## 六、一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `vector<int> v;` | 开一只货挨着坐的柜子（报编号取货最快） |
| `v.push_back(3);` | 往**后面**塞一格 |
| `v.push_front(1);` | **坑**：`vector` 没这一招 → `has no member named 'push_front'` |
| `v[v.size() - 1]` | 报编号拿**最后一格**（最后一格的编号 = 格数减一） |
| `list<int> l;` | 开一只用猫爪指向牌串起来的链子柜 |
| `l.push_front(1);` | 往**前面**接一格 |
| `l[0]` | **坑**：链子柜不认编号 → `no match for 'operator[]'` |
| `deque<int> d;` | 开一只两头都能开的柜子 |
| `d.push_front(1);` | 往**前面**塞一格（越晚塞的越靠前） |
| `d[0]` / `d[d.size() - 1]` | 报编号拿头一格 / 最后一格 |
| `for (int x : l)` | 一格一格走（三只柜子都能这么走） |
| `for (auto it = l.begin(); it != l.end(); ++it)` | 拿爪子走（`*it` 是那一格的货） |

## 小任务

1. 把第一节那段代码改成**四格**（多塞一条），再把最后两句 `cout` 换成「印出头一格」和「印出最后一格」—— 真跑一次，看看编号该怎么算。
2. 把第二节链子柜那段代码里的 `l.push_back(3);` 改成 `l.push_front(3);`，真跑一次 —— 它跑到哪儿去了？
3. 开一只 `deque`，从前面塞 `1`、从后面塞 `9`，再用报编号把 `d[0]` 和 `d[d.size() - 1]` 印出来，看看是不是「头格 `1`、末格 `9`」。
4. 用爪子那套写法走一遍链子柜，把每格的编号和货印成一行（提示：编号得自己拿一个 `i` 从 0 数起）。
5. 想一想：本喵有一队猫在领鱼干，新来的站到**队尾**、领到的从**队头**走掉 —— 两头都在动。三只柜子里该请哪一只？再举一个反过来的例子：什么样的活儿非 `vector` 不可？
6. 想一想：本喵要记一份「每天新到的货，最新的排最前面」，塞的时候该用 `push_back` 还是 `push_front`？

下一课，本喵要请出两只**用名字当编号**的柜子 —— 喊一声「小橘」就能把它那一格拿出来，还会自动按名字排排坐。学完今天这三只，下次那两只你会觉得格外亲切喵～ 🐾
