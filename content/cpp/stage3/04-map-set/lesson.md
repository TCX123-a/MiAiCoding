---
id: cpp-stage3-04
lang: cpp
stage: 3
order: 5
title: map 与 set——有编号的收纳柜
tags: [STL, 容器]
required: ["cpp-stage3-03"]
crossRefs: []
estMinutes: 26
keywords: [map, set, count, erase, insert]
---

## 钩子：喊「第几格」太笨了，本喵想喊名字

前面几课的柜子都是**报编号取货**的：第 0 格、第 1 格、第 2 格……可本喵的日常根本不是这样的。本喵是喊一声「小橘」，就要把小橘那一份拿出来；喊一声「大肥鱼」，就要翻它的收货单。

**编号是本喵自己数的，名字才是本喵记得住的。**

今天请出两只新柜子，它们的取货方式正是「喊名字」：

- **`map`**（念「迈普」）—— **拿名字当编号**的收纳柜：一格一把钥匙、一格一份货。
- **`set`**（念「塞特」）—— 只记「**有谁**」的名单柜：它不装货，只认名字。

请柜子的规矩照旧：开头写一句 `#include`，把 `map` 或 `set` 借出来。这两只柜子和 `vector` 住在同一个仓库里（STL），所以搬家的手续一模一样喵。

## 一、map：一把钥匙配一份货

`map` 的开法比上一课的柜子多一样东西 —— 它的尖括号里有**两样**：

```cpp
map<string, int> fish;
```

念作：「**钥匙**是一串字、**货**是整数的一只柜子。」本喵管它叫 `fish`。放货、取货都用中括号，可**中括号里放的是一把钥匙**，不是编号：

```cpp
#include <iostream>
#include <map>
#include <string>
using namespace std;

int main() {
    map<string, int> fish;
    fish["小橘"] = 3;
    fish["大胖"] = 5;
    cout << fish["小橘"] << endl;
    cout << fish.size() << endl;
    cout << fish.count("大胖") << endl;
    cout << fish.count("狸花") << endl;

    map<string, int> tally;
    cout << tally["新猫"] << endl;
    cout << tally.size() << endl;
    return 0;
}
```

```text
3
2
1
0
0
1
```

逐句看：

1. **`fish["小橘"] = 3;`** —— 拿「小橘」这把钥匙，把 `3` 放进它那一格。
2. **`fish["小橘"]`** —— 同一把钥匙取货 → 印 `3`。
3. **`fish.size()`** —— 柜子里有**几格**。本喵只放了两格（小橘、大胖），所以印 `2`。
4. **`fish.count("大胖")`** → `1`：问「**这把钥匙在不在**」，在就给 1。
5. **`fish.count("狸花")`** → `0`：不在就给 0。**判断「有没有」就用 `count`。**

### 最该记牢的一条：空手取货会**开一格**

上面最后两句是本喵故意留的，请重新念一遍：

```cpp
map<string, int> tally;
cout << tally["新猫"] << endl;   // 印出 0
cout << tally.size() << endl;    // 印出 1 —— 柜子里凭空多了一格！
```

`tally` 明明是刚开的空柜子，可本喵念了一句 `tally["新猫"]`，它就**先把「新猫」那一格开出来**（那一格的货默认是 `0`），再把这个 0 交给本喵。所以最后两行印的是 `0` 和 `1`。

**中括号是「取货 / 放货」两用的一把钥匙 —— 钥匙不在柜子里，它就顺手造一格。** 只想问「在不在」、不想惊动柜子，永远用 `count`。这一条在「数数」那种活儿上会咬人，看下一节。

### 数数别写成赋值 —— 一个不吵不闹的坑

本喵想数一数「喵」出现几回，手一抖写成了这样：

```cpp
#include <iostream>
#include <map>
#include <string>
using namespace std;

int main() {
    map<string, int> tally;
    tally["喵"] = 1;
    tally["喵"] = 1;
    tally["鱼"] = 1;
    for (auto p : tally) {
        cout << p.first << " " << p.second << endl;
    }
    return 0;
}
```

```text
喵 1
鱼 1
```

`tally["喵"] = 1;` 明明写了**两遍**，印出来的还是 `1` —— 因为那个等号是「**把这一格改成 1**」，写一百遍也还是 1。**这一次翻译官喵编得过、跑得完、一个字都没说**（本喵拿最啰嗦的那档 `-Wall` 真跑过）。

正确的写法是把等号换成 `+=`：

```cpp
#include <iostream>
#include <map>
#include <string>
using namespace std;

int main() {
    map<string, int> tally;
    tally["喵"] += 1;
    tally["喵"] += 1;
    tally["鱼"] += 1;
    for (auto p : tally) {
        cout << p.first << " " << p.second << endl;
    }
    return 0;
}
```

```text
喵 2
鱼 1
```

`tally["喵"] += 1;` 是「**在这一格原来的数上再加 1**」。而且第一回念它的时候，那一格还没开出来 —— 中括号会先把它开成 `0`，加号再往上加 1，所以它自动从 1 起步，本喵**不用先铺一层 0**。

**数数用 `+=`，不是 `=`。** 这一条记在心上：少写一个加号，编译器不会拦你，只有印出来的数字会出卖你。

### 走一圈：一格是一对「钥匙 + 货」

```cpp
#include <iostream>
#include <map>
#include <string>
using namespace std;

int main() {
    map<string, int> fish;
    fish["小橘"] = 3;
    fish["大胖"] = 5;
    fish["狸花"] = 1;
    for (auto p : fish) {
        cout << p.first << " " << p.second << endl;
    }
    return 0;
}
```

```text
大胖 5
小橘 3
狸花 1
```

**先看那个 `p`**：它是**一对**东西 —— `p.first` 是钥匙、`p.second` 是货。本喵的记法：**first 是「名字」，second 是「货」**。（这一对有个行话名字叫 pair，念「配尔」；今天先认脸，`first` / `second` 这两个词要先背下来。）

**再看顺序**：本喵放货的顺序是小橘、大胖、狸花，印出来却是「大胖、小橘、狸花」—— 因为 `map` 会**按钥匙自动排排坐**。拿**整数**当钥匙时也一样：

```cpp
#include <iostream>
#include <map>
#include <string>
using namespace std;

int main() {
    map<int, string> bowl;
    bowl[2] = "小橘";
    bowl[1] = "大胖";
    for (auto p : bowl) {
        cout << p.first << " " << p.second << endl;
    }
    return 0;
}
```

```text
1 大胖
2 小橘
```

放货的顺序是 2 号、1 号，印出来却是 1 号、2 号 —— 整数钥匙就按**数字大小**排。

所以 `map` 的走一圈口诀是：**谁小谁先来。** 一串字当钥匙的时候，比的是它们的编号码（行话叫按码点比），**别指望它按本喵心里的顺序来** —— 想按「谁先来谁先排」，那不归 `map` 管。

本喵把这三格拆开，一步一步走给你看：

```demo
title: 三把钥匙放进去，走一圈却换了顺序
code:
| map<string, int> fish;
| fish["小橘"] = 3;
| fish["大胖"] = 5;
| fish["狸花"] = 1;
| for (auto p : fish) {
|     cout << p.first << " " << p.second << endl;
| }

step 开一只「钥匙配货」的柜子
at: 1
say: `map<string, int> fish;` —— 尖括号里写了**两样**：钥匙是一串字（`string`）、货是整数（`int`）。这一句念完，柜子还是**空的**。
meow: 一把钥匙配一份货的柜子开好啦～
pose: expect
柜子里 = （空）
p 手里这一对 = （还没走一圈）
屏幕上 = （还没印）

step 拿「小橘」这把钥匙放货
at: 2
say: `fish["小橘"] = 3;` —— **中括号里放的是钥匙，不是编号**。本喵没数「第几格」，钥匙本身就是那一格的名字，这就是它比上一课的柜子省事的地方。
meow: 小橘这把钥匙，配 3 条鱼～
pose: busy
柜子里 = 小橘 → 3
p 手里这一对 = （还没走一圈）
屏幕上 = （还没印）

step 再放一把：「大胖」
at: 3
say: `fish["大胖"] = 5;` —— 又一把钥匙配好了货。**顺带瞄一眼面板**：柜子里「大胖」**跑到了「小橘」前面** —— 本喵先放的明明是小橘。
meow: 咦？大胖怎么跑到小橘前头去了！
pose: think
柜子里 = 大胖 → 5、小橘 → 3
p 手里这一对 = （还没走一圈）
屏幕上 = （还没印）

step 第三把：「狸花」
at: 4
say: `fish["狸花"] = 1;` 三把钥匙、三格。面板里是「大胖、小橘、狸花」—— **这个顺序不是本喵放货的顺序**，先记住这个现象，下面走一圈会当场看见它。
meow: 三格齐了，可顺序怪怪的喵……
pose: expect
柜子里 = 大胖 → 5、小橘 → 3、狸花 → 1
p 手里这一对 = （还没走一圈）
屏幕上 = （还没印）

step 走一圈 · 第 1 对
at: 5
say: `for (auto p : fish)` 让 `p` 一格格地接货，**一次接一整个「一对」**：`p.first` 是钥匙、`p.second` 是货。**第一次接到的不是小橘，是大胖。**
meow: 第一对：大胖和它的 5 条！
pose: expect
柜子里 = 大胖 → 5、小橘 → 3、狸花 → 1
p 手里这一对 = 第 1 对：大胖 → 5
屏幕上 = （还没印）

step 第 1 对 · 印出来
at: 6
say: `p.first`（名字）和 `p.second`（货）中间隔一个空格印成一行 —— 屏幕上出现「大胖 5」。
meow: 印出「大胖 5」喵！
pose: yay
柜子里 = 大胖 → 5、小橘 → 3、狸花 → 1
p 手里这一对 = 第 1 对：大胖 → 5
屏幕上 = 大胖 5

step 走一圈 · 第 2 对
at: 5
say: 回到第 5 行接下一对：这回是**小橘 → 3**。小橘是本喵**第一个**放的，却排到了第二 —— 因为 `map` 按钥匙**排排坐**，一串字就按它们的编号码比大小。
meow: 第二个是小橘，它排到后头了～
pose: busy
柜子里 = 大胖 → 5、小橘 → 3、狸花 → 1
p 手里这一对 = 第 2 对：小橘 → 3
屏幕上 = 大胖 5

step 第 2 对 · 印出来
at: 6
say: 第二行印出来是「小橘 3」。屏幕上现在两行了。
meow: 第二行「小橘 3」～
pose: yay
柜子里 = 大胖 → 5、小橘 → 3、狸花 → 1
p 手里这一对 = 第 2 对：小橘 → 3
屏幕上 = 大胖 5、小橘 3

step 走一圈 · 第 3 对
at: 5
say: 接第三对：**狸花 → 1**。这是最后一对了 —— 接完这一对，柜子就走完了。
meow: 最后一对，狸花来啦！
pose: busy
柜子里 = 大胖 → 5、小橘 → 3、狸花 → 1
p 手里这一对 = 第 3 对：狸花 → 1
屏幕上 = 大胖 5、小橘 3

step 第 3 对 · 印出来
at: 6
say: 印出「狸花 1」，屏幕上三行凑齐 —— 和课文里那段一字不差。
meow: 三行齐啦，和课文里一模一样！
pose: yay
柜子里 = 大胖 → 5、小橘 → 3、狸花 → 1
p 手里这一对 = 第 3 对：狸花 → 1
屏幕上 = 大胖 5、小橘 3、狸花 1

step 回头一看：没有第四对了
at: 5
say: 再一次回到第 5 行，可柜子已经走完，后面一对都没有了 —— 圈停了。**印出来的顺序是「大胖、小橘、狸花」，本喵放货的顺序是「小橘、大胖、狸花」，两个不一样 —— 这就是口诀「谁小谁先来」。**
meow: 走完啦！记住：谁小谁先来～
pose: proud
柜子里 = 大胖 → 5、小橘 → 3、狸花 → 1
p 手里这一对 = （走完了）
屏幕上 = 大胖 5、小橘 3、狸花 1
```

记住面板里那个顺序：**柜子一直按「谁小谁先来」摆着**，`p` 只是照着摆好的顺序一对一对地接 —— 放货的先后改不了它。

::: tip 猫咪提示
`map` 三件事挂在心上：**`m[k] = x`** 放货（钥匙不在就先开一格）、**`m.count(k)`** 问在不在（不惊动柜子）、**`for (auto p : m)`** 走一圈（`p.first` 钥匙、`p.second` 货，按钥匙排排坐）。
:::

## 二、set：只记「有谁」的名单柜

有些事本喵只想知道**有没有**：这只猫今天来领过饭没有、这个名字记过没有。这时候「货」就是多余的 —— 本喵要的只是一份**名单**。

```cpp
#include <iostream>
#include <set>
using namespace std;

int main() {
    set<int> s;
    s.insert(7);
    s.insert(2);
    s.insert(7);
    for (int x : s) {
        cout << x << endl;
    }
    cout << s.size() << endl;
    cout << s.count(7) << endl;
    cout << s.count(9) << endl;
    s.erase(7);
    cout << s.size() << endl;
    return 0;
}
```

```text
2
7
2
1
0
1
```

一行一行念：

1. **`s.insert(7);`** —— 往名单上写一个「7」。`insert` 念「因塞特」，字面意思就是「**写进去**」。（上一课的柜子是往后塞一格叫 `push_back`，这一只是「写进名单」，用的词不一样。）
2. 本喵写了 `7`、`2`、`7` —— 可走一圈只有 `2`、`7` 两行：**同一份货写第二遍，它只当没看见**（去重）。
3. 顺序是 `2` 在前、`7` 在后 —— **它也排排坐**（和 `map` 一样，按货的大小）。
4. **`s.size()`** → `2`：名单上只有两条。
5. **`s.count(7)`** → `1`、**`s.count(9)`** → `0`：`count` 在名单柜里也只会给 0 或 1（有就是 1，没有就是 0）。
6. **`s.erase(7);`** —— 把 `7` 从名单上划掉。再问一次 `size()`，就变成 `1` 了。

一句话记住这两只柜子的分别：**`map` 是「钥匙 → 货」，`set` 是只有钥匙、没有货的名单柜。**

::: warn 小心喵
`set` 和 `map` 都**不许重复**：
- `set` 里同一个货写两遍只算一遍；
- `map` 里同一把钥匙放两次货，**后放的那次把前面的盖掉**（不是加起来！要加起来得写 `+=`，就是上一节那个坑）。

想「同一个名字记好几条账」的话，这两只柜子都不合适 —— 那是后面才会遇到的事。
:::

## 三、两只最容易摔的跤

### 跤一号：拿「第几格」去喊 map

本喵犯迷糊的时候，会把 `map` 当成报编号的柜子，写成 `fish[i]`：

```cpp
#include <iostream>
#include <map>
#include <string>
using namespace std;

int main() {
    map<string, int> fish;
    fish["小橘"] = 3;
    fish["大胖"] = 5;
    for (int i = 0; i < fish.size(); i++) {
        cout << fish[i] << endl;
    }
    return 0;
}
```

```text
main.cpp:11:21: error: no match for 'operator[]' (operand types are 'std::map<std::__cxx11::basic_string<char>, int>' and 'int')
    11 |         cout << fish[i] << endl;
```

念作：**「这只柜子的钥匙是『一串字』，你递过来一个整数 —— 这把钥匙它不认。」** 看到 `no match for 'operator[]'`，先低头看中括号里塞的是不是**钥匙该有的样子**。

顺带说一件本喵真跑出来的小事：这一回除了上面那条报错，翻译官喵还**顺嘴嘀咕了一句** `-Wsign-compare`（大意是「你拿 `int` 去跟柜子的格数比大小」）—— 不过这已经不重要了，因为报错在前，程序连编都编不过。

### 跤二号：忘了把 `map` 借出来

```cpp
#include <iostream>
#include <string>
using namespace std;

int main() {
    map<string, int> fish;
    fish["小橘"] = 3;
    cout << fish["小橘"] << endl;
    return 0;
}
```

```text
main.cpp:6:5: error: 'map' was not declared in this scope
    6 |     map<string, int> fish;
main.cpp:2:1: note: 'std::map' is defined in header '<map>'; this is probably fixable by adding '#include <map>'
```

第一句是「**`map` 到底是个啥，本喵没见过**」，第二句是翻译官喵**替你指路**：它住在 `map` 那个工具格子里。看到 `note` 里那句 `probably fixable by adding`，翻译官喵就是在说「**开头少借了一个工具格子**」。

## 四、本喵今天记住的三句话

::: tip 猫咪提示
1. **`map` 是「钥匙 → 货」的柜子**：`m[k] = x` 放货、`m[k]` 取货、`m.count(k)` 问在不在（只回答不惊动柜子）、走一圈是 `for (auto p : m)`（`p.first` 钥匙、`p.second` 货）。
2. **中括号会「顺手开一格」**：钥匙不在柜子里也照样给你开出来（货默认 `0`）。**数数要用 `+=` 不能用 `=`** —— 后者不报错，只让你数出个错的数。
3. **两只柜子都自动排排坐、都不许重复**：`map` 按**钥匙**排、`set` 按货排；`set` 用 `insert` 写名字、`erase` 划名字、`count` 问在不在。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `map` 后面尖括号里写两样（钥匙 `string`、货 `int`），起名 `fish` | 开一只柜子：钥匙是一串字、货是整数 |
| `fish["小橘"] = 3;` | 拿「小橘」这把钥匙放货（钥匙不在就先开一格） |
| `fish["小橘"]` | 拿钥匙取货 |
| `fish.count("大胖")` | 这把钥匙在不在：在给 1、不在给 0（**不惊动柜子**） |
| `for (auto p : fish)` | 走一圈，一格是一对：`p.first` 钥匙、`p.second` 货 |
| `fish.size()` | 柜子里有几格 |
| `set` 后面尖括号里写 `int`、起名 `s` | 开一只只有名字、没有货的名单柜 |
| `s.insert(7);` | 往名单上写一个 7（重复写也只算一遍） |
| `s.count(9)` | 名单上有没有 9 |
| `s.erase(7);` | 把 7 从名单上划掉 |
| `tally["喵"] = 1;`（写两遍） | **坑**：等号是「改成 1」，写几遍都是 1 |
| `tally["喵"] += 1;` | 对：在这一格原来的数上加 1（第一回从 0 起步） |
| `fish[i]` | **坑**：这把钥匙不认整数 —— `no match for 'operator[]'` |

## 小任务

1. 把第一节那段代码里的 `fish.count("狸花")` 改成 `fish["狸花"]`，真跑一次 —— 注意最后那句 `size()` 印出来的数变了没有。**这一跑就明白了「中括号会顺手开一格」。**
2. 按第一节那个「数数坑」的写法，把 `tally["鱼"] = 1;` 写**三遍**，真跑一次；再把三行全改成 `+= 1`，再跑一次。两个结果都记下来。
3. 开一只 `map`（尖括号里钥匙写 `string`、货写 `int`），往里放三条账，然后用 `for (auto p : ...)` 走一圈，把每一格的钥匙和货印成一行 —— 印出来看看顺序和你放货的顺序一样不一样。
4. 开一只 `set`（尖括号里写 `string`），先写「小橘」「大胖」「小橘」三个名字进去，再走一圈印出来、最后问一次 `size()`。**去重是不是真的生效了？**
5. 想一想：本喵有一份「今天来领过饭的名字」要记下来，用 `map` 好还是用 `set` 好？再说一个反过来的例子 —— 哪一种活儿非 `map` 不可？（提示：只需要知道「有谁」的时候，多带一份货是白搭；可要是每个名字后面还跟着「领了几条」，那名单就不够用了。）

下一课本喵带你给一堆货**排排坐** —— 三种最老实的排法：冒泡、选择、插入，一个一个拆开摆给你看。顺便咱们数一数：货一多起来，这几种排法各要走多少趟喵～ 🐾
