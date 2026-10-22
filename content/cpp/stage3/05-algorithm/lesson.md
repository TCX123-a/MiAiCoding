---
id: cpp-stage3-05
lang: cpp
stage: 3
order: 9
title: algorithm 算法库——现成招式大全
tags: [STL, 算法]
required: ["cpp-stage3-25"]
crossRefs: []
estMinutes: 27
keywords: [sort, find, count, transform, lambda]
---

## 钩子：人家的柜子会自己排排坐，本喵手里这只不会

前面「map 与 set」那两只柜子有个特别省事的地方：**走一圈的时候它们自己就是排好的**。可本喵手里最常用的那只柜子（会自己长大的储物柜）没有这个本事 —— 你塞进去是什么顺序，它就一直是什么顺序。

那想让它排排坐，难道要本喵自己写一段「两两比较、来回换位」的活儿？不用喵。

回头看看「STL 总览」那一课那张地图 —— STL 里除了**柜子**和**爪子**，还有第三样家当：**现成的招式**。C++ 把它们装在一个叫 `algorithm` 的工具格子里，今天本喵就把最常用的四招请出来：

| 招式 | 干什么 |
|---|---|
| `sort` | 给一堆货排排坐 |
| `find` | 在一堆货里翻一件出来 |
| `count` | 数一数某件货有几个 |
| `transform` | 整柜换货（一格一格地换成新的） |

请这个格子的规矩还是那句：开头写一句 `#include`，把 `algorithm` 借出来。

## 一、`sort`：给一堆货排排坐

```cpp
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(9);
    v.push_back(2);
    v.push_back(7);
    sort(v.begin(), v.end());
    for (int x : v) {
        cout << x << endl;
    }
    return 0;
}
```

```text
2
7
9
```

**`sort`** 念「索特」，就是「排排坐」。它吃**两个投喂口，两个都是爪子**：

- 第一个是**从哪儿起**（`v.begin()`）；
- 第二个是**到哪儿为止**（`v.end()`）。

第二个投喂口写成 `v.end()` 的时候，本喵想起第一课那句话：**`end()` 是「到此为止」那把爪子**，它指的位置不是最后一格、而是最后一格的后面 —— 可放到这里，它正好就是「**一直排到走完为止**」。所以这一句念作：**「从第一格起，到走完为止，整个柜子排一遍。」**

### 想从大到小：给它加一个「怎么比」的小招式

```cpp
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(9);
    v.push_back(2);
    v.push_back(7);
    sort(v.begin(), v.end(), [](int a, int b) {
        return a > b;
    });
    for (int x : v) {
        cout << x << endl;
    }
    return 0;
}
```

```text
9
7
2
```

多出来的那一坨 `[](int a, int b) { return a > b; }` 是**顺手写出来的一个小招式**（行话叫 lambda，念「兰布达」）。拆开看：

- **`[]`** —— 一对**空爪子**：意思是「这个小招式不抓外面的东西」（今天照着写一对空的就行，别的写法是后面的课的事）；
- **`(int a, int b)`** —— 它吃**两个**投喂口，就是摆在一起要比的那两件货；
- **`{ return a > b; }`** —— 它叼回一句「**`a` 该排在 `b` 前面吗**」的答复（真 / 假）。

本喵的记法：**写 `a > b` 就是「谁大谁先站」**（从大到小）；反过来写 `a < b` 就是小的先站（和不加它一个样）。**怎么比，是你说了算的。**

### 少写一格会怎样

本喵手滑，把第二个投喂口写成了 `v.end() - 1`，心里想的是「少排一格、省点事」：

```cpp
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(9);
    v.push_back(2);
    v.push_back(7);
    sort(v.begin(), v.end() - 1);
    for (int x : v) {
        cout << x << endl;
    }
    return 0;
}
```

```text
2
9
7
```

印出来是 `2 9 7`：前面两格排好了，**最后那一格原样待着** —— 因为 `v.end() - 1` 的意思是「排到最后一格**为止**（不含它）」，那一格被排除在外了。整个柜子看起来还是乱的，而且**翻译官喵一句话都没说**（本喵拿最啰嗦的那档 `-Wall` 真跑过）。

记住：`sort` 的第二个投喂口要的就是 `v.end()` —— 它是「排到走完为止」那句话本身，**不用你减一**。

## 二、翻东西：`find` 和 `count`

```cpp
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(4);
    v.push_back(7);
    v.push_back(7);
    cout << count(v.begin(), v.end(), 7) << endl;
    if (find(v.begin(), v.end(), 4) != v.end()) {
        cout << "有 4" << endl;
    }
    if (find(v.begin(), v.end(), 9) == v.end()) {
        cout << "没有 9" << endl;
    }
    auto it = find(v.begin(), v.end(), 7);
    cout << *it << endl;
    return 0;
}
```

```text
2
有 4
没有 9
7
```

- **`count(v.begin(), v.end(), 7)`** —— 数一数柜子里有几个 `7` → 印 `2`。（和上一课名单柜的 `count` 是**同一个词**，可那只只回答 0 或 1，这只真的会数。）
- **`find(v.begin(), v.end(), 4)`** —— 在一堆货里翻 `4`。**它交出来的不是「有没有」，是一把爪子**（指着翻到的那一格）喵！
- 所以「有没有」得拿它跟 `v.end()` 比：`!= v.end()` 是**翻到了**；`== v.end()` 是**翻遍了也没见着** —— 因为 `end()` 是那个「到此为止」的路标，爪子停在那儿就说明它把整个柜子都走完了。
- 翻到的爪子照样能用星星取货：`auto it = find(...)` 之后再 `*it`，印出 `7`。

光看这几行，看不出那只爪子是怎么走的 —— 本喵把它放慢，一格一格翻给你看：

```demo
title: find 交出来的是一只爪子，不是「有没有」
code:
| vector<int> v;
| v.push_back(4);
| v.push_back(7);
| v.push_back(7);
| cout << count(v.begin(), v.end(), 7) << endl;
| if (find(v.begin(), v.end(), 4) != v.end()) {
|     cout << "有 4" << endl;
| }
| if (find(v.begin(), v.end(), 9) == v.end()) {
|     cout << "没有 9" << endl;
| }

step 起点：先开一只空柜子
at: 1
say: `vector<int> v;` 先开一只**空**柜子。今天本喵不盯格号，只盯那只**爪子** —— 它从哪儿起、在哪儿停，才是这一节要讲的事。
meow: 空柜子开好啦，爪子待命喵～
pose: expect
柜子里的货 = （空柜子）
爪子停在 = （还没伸爪子）
数到几个 7 = （还没数）
印出来 = （还没印）

step 塞第 0 格：4
at: 2
say: `push_back(4)` 往后塞一格，`4` 住进**第 0 格**。格号还是从 0 数起 —— 这是前面那排猫粮碗的老规矩。
meow: 4 号住进第 0 格！
pose: busy
柜子里的货 = 4
爪子停在 = （还没伸爪子）
数到几个 7 = （还没数）
印出来 = （还没印）

step 塞第 1 格：7
at: 3
say: 再塞一格 `7`，住进**第 1 格**。柜子自己长了一格，本喵没提前说过要几格。
meow: 7 号也住进来了～
pose: busy
柜子里的货 = 4 7
爪子停在 = （还没伸爪子）
数到几个 7 = （还没数）
印出来 = （还没印）

step 塞第 2 格：又是一个 7
at: 4
say: 第 2 格又是一个 `7`。三条货到齐：`4 7 7` —— 记牢这个「两个 7」，下一步立刻要用上。
meow: 柜子里现在是 4、7、7 喵！
pose: yay
柜子里的货 = 4 7 7
爪子停在 = （还没伸爪子）
数到几个 7 = （还没数）
印出来 = （还没印）

step count：它真的会数
at: 5
say: `count(v.begin(), v.end(), 7)` 数一数这个范围里有几个 `7`。范围和排排坐用的是同一对爪子：「从第 0 格起、到走完为止」。它**真的会数**，交出来的是个数：`2`。
meow: 数出来两个 7，交回一个 2！
pose: busy
柜子里的货 = 4 7 7
爪子停在 = （还没伸爪子）
数到几个 7 = 2
印出来 = （还没印）

step find 4：爪子一格一格翻
at: 6
say: `find(v.begin(), v.end(), 4)` —— 爪子从**第 0 格**起，一格一格往后翻。第 0 格正好就是 `4`，它当场**停住**。看清楚：它交出来的**不是「有没有」，就是这只停下来的爪子**。
meow: 爪子在第 0 格停住了，那儿是 4！
pose: expect
柜子里的货 = 4 7 7
爪子停在 = 第 0 格（那儿是 4）
数到几个 7 = 2
印出来 = （还没印）

step 拿这只爪子去比路标
at: 6
say: 「有没有」得**拿这只爪子去比**：`!= v.end()` 问的是「你停在的地方，是不是那块『到此为止』的路标？」—— 它停在**第 0 格**，不是路标，答真。
meow: 没停在路标上，翻到了喵！
pose: expect
柜子里的货 = 4 7 7
爪子停在 = 第 0 格（那儿是 4）
数到几个 7 = 2
印出来 = （还没印）

step 答真才进花括号
at: 7
say: 答真才轮到花括号里那一行，屏幕上印出 `有 4`。**这里和排排坐不一样**：排排坐从来看你的眼色，它埋头把整个柜子排完就走。
meow: 有 4，印出来啦～
pose: yay
柜子里的货 = 4 7 7
爪子停在 = 第 0 格（那儿是 4）
数到几个 7 = 2
印出来 = 有 4

step 换个 9 再翻：一路走到走完为止
at: 9
say: 换 `9` 再翻一遍：第 0 格是 `4`、第 1 格是 `7`、第 2 格还是 `7` —— 都不是。爪子只能一格一格往下走，一直走到**走完为止**，停在 `v.end()` 那块路标上。
meow: 翻遍了也没见着 9，爪子走到头了！
pose: busy
柜子里的货 = 4 7 7
爪子停在 = 停在 v.end() 那块路标上
数到几个 7 = 2
印出来 = 有 4

step 停在路标上 = 翻遍了也没有
at: 10
say: `== v.end()` 答真 —— **爪子停在路标上，就是「翻遍了也没有」**，于是印出 `没有 9`。一句话记牢：`find` 交出来的是爪子，**爪子停哪儿，就是它想跟你说的话**。
meow: 没有 9，收工喵！
pose: proud
柜子里的货 = 4 7 7
爪子停在 = 停在 v.end() 那块路标上
数到几个 7 = 2
印出来 = 没有 9
```

::: warn 小心喵
**这里的 `find` 和上一课一串字的 `find` 不是一回事**：

- 一串字身上的 `find`，交出来的是一颗**编号**（第几颗开始），找不到给 `string::npos`；
- 这个招式格子里的 `find`，交出来的是一把**爪子**，找不到给 `v.end()`。

两边的「有没有」写法也不一样：那边写 `!= string::npos`，这边写 `!= v.end()`。**别串门。**
:::

### 拿爪子当「有没有」用，翻译官喵当场拦下

本喵偷懒的时候会这么写：

```cpp
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(1);
    v.push_back(2);
    v.push_back(3);
    if (find(v.begin(), v.end(), 9)) {
        cout << "找到了喵" << endl;
    } else {
        cout << "没有喵" << endl;
    }
    return 0;
}
```

```text
main.cpp:11:13: error: could not convert 'std::find<__gnu_cxx::__normal_iterator<int*, vector<int> >, int>(v.std::vector<int>::begin(), v.std::vector<int>::end(), 9)' from '__gnu_cxx::__normal_iterator<int*, std::vector<int> >' to 'bool'
    11 |     if (find(v.begin(), v.end(), 9)) {
```

念作：**「你要本喵拿这句话看鱼干眼色行事，可它交出来的是一把爪子 —— 爪子没法当『真 / 假』使。」** 那串拗口的 `__gnu_cxx::__normal_iterator` 就是本喵一直说的**爪子**的本名。看到 `could not convert` 后面跟着它，就是把「翻到的位置」当成「有没有」用了。

## 三、整柜换货：`transform`

```cpp
#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;

int main() {
    vector<int> v;
    v.push_back(1);
    v.push_back(2);
    v.push_back(3);
    transform(v.begin(), v.end(), v.begin(), [](int x) {
        return x * 2;
    });
    for (int x : v) {
        cout << x << endl;
    }
    return 0;
}
```

```text
2
4
6
```

**`transform`** 念「传斯佛姆」，它吃**四个**投喂口，按顺序念一遍就懂了：

1. **从哪儿起**（`v.begin()`）；
2. **到哪儿为止**（`v.end()`）；
3. **换好的货放到哪儿** —— 这里写的是 `v.begin()`，意思是**换回原地**（自己覆盖自己）；写别的柜子的爪子，就是整柜换到那边去；
4. **怎么换** —— 就是那个顺手写的小招式：吃一格、叼回一格新的。

上面那个小招式是 `[](int x) { return x * 2; }`：吃**一个**投喂口（不像排排坐那个吃两个），叼回翻了一倍的数。

### 小招式里那句 `return` 少不得

本喵干过一件蠢事：把 `return` 漏掉，只写了一句 `x * 2;`。真跑一遍（最啰嗦的那档 `-Wall`），翻译官喵先在那句话那一行**嘀咕了一句** `statement has no effect`（大意：「这句话写了跟没写一样」），然后**当场编不过** —— 最后那条报错还滚进了算法库自己的肚子里，说 `void value not ignored as it ought to be`，大意是：**「你递进来的这个小招式啥都没叼回来，可这儿要的是有东西叼回来的那种。」**

所以小招式的套路是固定的：**吃一口 → `return` 一口**。少了 `return`，它就成了个空手的小招式，哪个招式都不敢收。

## 四、一串字的货也能排排坐

```cpp
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
using namespace std;

int main() {
    vector<string> names;
    names.push_back("小橘");
    names.push_back("大胖");
    names.push_back("狸花");
    sort(names.begin(), names.end());
    for (auto s : names) {
        cout << s << endl;
    }
    return 0;
}
```

```text
大胖
小橘
狸花
```

一排货是**一串字**的时候，`sort` 照样能排 —— 比法和上一课说的一样：**按编号码一位一位地比**。整数按数字大小、一串字按编号码，`sort` 两种都认。

::: tip 猫咪提示
「现成招式」还有一个很好用的地方：**它们只认爪子，不认柜子**。也就是说，同一句 `sort(v.begin(), v.end())`，放在会自己长大的储物柜上用、放在一串字上用、放在别的柜子上用，都成立喵 —— 因为招式只跟**从哪儿起、到哪儿为止**打交道。这正是第一课说的那句：**爪子是把柜子和招式缝在一起的那根线。**
:::

## 五、本喵今天记住的三句话

::: tip 猫咪提示
1. **现成招式装在 `algorithm` 里**，用之前先写一句 `#include` 把它借出来。
2. **`sort` 吃两个爪子**（从哪起、到哪止，第二个就写 `v.end()`，**别减一**）；想从大到小，就再递一个「怎么比」的小招式（`a > b` 谁大谁先站）。
3. **`find` 交出来的是爪子、不是「有没有」**（判断要写 `!= v.end()`）；`count` 数个数；`transform` 四个投喂口，第三个写回 `v.begin()` 就是原地换货。小招式**别忘了 `return`**。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `#include` + `algorithm` | 把「现成招式」那个工具格子借出来 |
| `sort(v.begin(), v.end());` | 整个柜子从小到大排排坐 |
| `sort(v.begin(), v.end(), 比法);` | 按你给的比法排 |
| `[](int a, int b) { return a > b; }` | 小招式：谁大谁先站（从大到小） |
| `sort(v.begin(), v.end() - 1);` | **坑**：最后一格被排除在外，它不参与排排坐 |
| `find(v.begin(), v.end(), x)` | 翻 `x`，交出来的是一把爪子 |
| `find(...) != v.end()` | 翻到了 / 没翻到 —— 那个爪子有没有停在「到此为止」的路标上 |
| `if (find(...))` | **坑**：爪子当不了真 / 假 —— `could not convert` |
| `count(v.begin(), v.end(), 7)` | 数一数有几个 7 |
| `transform(v.begin(), v.end(), v.begin(), 怎么换)` | 从哪起、到哪止、换到哪儿去、怎么换 |
| `[](int x) { return x * 2; }` | 小招式：吃一口、翻一倍、叼回来 |

## 小任务

1. 把第一节那段排排坐的代码里的 `sort` 那一句**删掉**，真跑一次 —— 印出来的顺序是不是又变回本喵塞进去的顺序了？
2. 把第二段那个小招式里的 `a > b` 改成 `a < b`，真跑一次 —— 从大到小又变回从小到大了吗？（提示：**怎么比是你说了算的**，这一句就是开关。）
3. 本喵说「第二个投喂口别减一」，你亲手验一遍：把 `sort(v.begin(), v.end())` 改成 `sort(v.begin(), v.end() - 1)`，真跑一次，看看最后那一格有没有参与排排坐。
4. 写一段代码：开一只装整数的柜子，塞进 `5`、`1`、`9`、`5` 四个数，然后**先数一数有几个 5**、**再排一次**、最后走一圈印出来。
5. 想一想：本喵说 `find` 交出来的是一把**爪子** —— 那本喵为什么能拿它去 `*it` 取货？（提示：上一课走柜子那套里的星星，就是干这个用的。）再想一想：要是柜子里有**两个** `7`，`find` 交出来的爪子会指着哪一格？

到这里，STL 三样家当本喵都带你摸过一遍了：**柜子**装货、**爪子**指路、**现成招式**干活。后面的课会有别的猫猫接着讲 —— 下一课讲的是「**会自己叼回仓库的猫爪指向牌**」，专门解决「借出来的东西忘了还」这种麻烦事喵～ 🐾
