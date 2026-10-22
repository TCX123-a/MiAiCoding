---
id: cpp-stage2-12
lang: cpp
stage: 2
order: 12
title: 模板初步——会量体裁衣的图纸
tags: [模板, 泛型, 类型推导]
required: ["cpp-stage2-11"]
crossRefs: []
estMinutes: 28
keywords: [template, typename, deduction, generic]
---

## 钩子：本喵不想画三张一模一样的图纸

上一课本喵手上有一排写着「会叫的」的牌子，喊一句、各猫各样。可那是**好几只猫各写各的一手**。

今天本喵遇到的是另一件麻烦事：本喵想要一个**比大小的招式** —— 给两只整数比、给两个小数比、给两条项链比。三件事**做起来一模一样**，只是料的款式不同。

照老办法，本喵得画三张几乎一字不差的图纸：`biggerInt`、`biggerDouble`、`biggerString`…… 抄三遍，改一处就得记得改三处。**这不是本喵想过的日子。**

本喵要的是：**一张图纸，塞进去什么料，就裁成什么版。**

## 一、图纸上留一个空位

```cpp
template <typename T>
T bigger(T a, T b) {
    return a > b ? a : b;
}
```

要紧的全在**上面那一行**：

```text
template <typename T>
```

它的意思是：**这张图纸上有一个空位，空位的代号叫 `T`**。至于 `T` 到底是整数、小数还是字符串 —— 本喵**不写死**，留给塞料的人决定。

看清楚 `T` 出现在哪儿：它出现在**动作回来的那一款**上，也出现在**两个塞料**上。这三处是**同一个 `T`** —— 一张图纸上同一个代号，指的是同一个空位，这才是这张图纸能「量体裁衣」的根子。

它的正式名字是 模板（会量体裁衣的图纸）。本喵在本机真跑过这一张图纸：

```cpp
#include <iostream>
#include <string>
using namespace std;

template <typename T>
T bigger(T a, T b) {
    return a > b ? a : b;
}

int main() {
    cout << bigger(3, 5) << endl;
    cout << bigger(1.5, 2.5) << endl;
    cout << bigger(string("小鱼干"), string("大肥鱼")) << endl;
    return 0;
}
```

```text
5
2.5
小鱼干
```

**一段代码、一张图纸、三款料、三个答案。** 本喵一个字都没为「整数版」和「小数版」分别写过。

这三份东西是**什么时候**出来的？本喵拆成一步一步走给你看 —— 一路分清楚两件事：**图纸**，和**照料裁出来的那一份**：

```demo
title: 图纸先立空位，用到哪一款才裁哪一款
code:
| template <typename T>                                        // 立一个空位，代号 T
| T bigger(T a, T b) {
|     return a > b ? a : b;
| }
| cout << bigger(3, 5) << endl;                                // 第一次用：递两个整数
| cout << bigger(1.5, 2.5) << endl;                            // 第二次用：递两个小数
| cout << bigger(string("小鱼干"), string("大肥鱼")) << endl;   // 第三次用：递两条字符串

step 先立一个空位
at: 1
say: `template <typename T>` 立起一个空位，代号 `T`。**光有这一行，一份东西都不会生成** —— 空位是立给图纸的，不是立给某一款料的。
meow: 空位立好了，先空着喵～
pose: expect
翻译官喵裁出来的 = （一份都还没有）
这一次递的料 = （还没递）
屏幕上 = 还没印

step 图纸上三处是同一个空位
at: 2
say: 看清 `T` 出现在哪儿：**回来的那一款**上、**两处塞料**上。三处是**同一个 `T`** —— 一张图纸上同一个代号，指的是同一个空位，这才是它能量体裁衣的根子。这会儿还是一份都没生成。
meow: 三处同一个空位，裁出来才配套喵～
pose: think
翻译官喵裁出来的 = （还是一份都没有：光有图纸不算）
这一次递的料 = （还没递）
屏幕上 = 还没印

step 第一次用它：照整数裁一份
at: 5
say: `bigger(3, 5)` 是本喵第一次用它。翻译官喵**这才**照着递进去的两个整数，裁出第一份：整数版。跑这一份，`a > b ? a : b` 印出 5。这一份是**照整数裁的**，跟别的料没关系。
meow: 第一份出来了，是整数版喵！
pose: busy
翻译官喵裁出来的 = 整数版（一份）
这一次递的料 = 两个整数 3、5
屏幕上 = 5

step 第二次用它：另裁一份小数版
at: 6
say: 这一回递进去的是两个小数。已经裁出来的那一份是**照整数裁的**，它只认自己那一款 —— 所以翻译官喵照着这两串小数**另裁一份**小数版，跑它，印出 2.5。**两份各管各的，谁也不串谁。**
meow: 又来一份，小数版是另一份喵！
pose: busy
翻译官喵裁出来的 = 整数版 + 小数版（两份）
这一次递的料 = 两个小数 1.5、2.5
屏幕上 = 2.5

step 第三次用它：再裁一份字符串版
at: 7
say: 递进去的是两条字符串（`string(...)` 是把它裹成一条字符串）。前两份都用不上，翻译官喵再裁**第三份**，跑它，印出 小鱼干 —— **三款料，三份生成物。**
meow: 第三份也出来了，一共三份喵！
pose: yay
翻译官喵裁出来的 = 整数版 + 小数版 + 字符串版（三份）
这一次递的料 = 两条字符串
屏幕上 = 小鱼干

step 回头看：一张图纸，三份
at: 7
say: 本喵写下的只有那四行图纸 —— **图纸本身是一段跑不起来的东西**。是每一次「用它」的时候，翻译官喵才照着递进去的料现裁一份；裁好的那一份会留着，下次递一样的料就不用再裁。
meow: 图纸一张，生成物三份喵！
pose: proud
翻译官喵裁出来的 = 三份（各管各的，互不串门）
这一次递的料 = （三款都递完了）
屏幕上 = 5、2.5、小鱼干（三行）
```

认出这一条就不会再绕：**图纸不是一段能跑的东西，它是一张留着空位的底稿**；翻译官喵在看到你用它的时候，才照着递进去的料现裁一份 —— 三款料，三份各管各的。

## 二、本喵不点名，翻译官喵自己猜

上面三次喊话，本喵**一次都没说 `T` 是谁**：

| 本喵塞进去的 | 翻译官喵猜出来的 `T` | 印出来的 |
|---|---|---|
| `bigger(3, 5)` | 整数 | `5` |
| `bigger(1.5, 2.5)` | 小数 | `2.5` |
| `bigger(string("小鱼干"), string("大肥鱼"))` | 字符串 | `小鱼干` |

翻译官喵干的这件事，叫**按料猜款式**：它盯着本喵塞进去的东西，自己推出 `T` 该是什么。所以本喵**平时根本不用写 `T`**，它猜得比本喵快。

::: tip 猫咪提示
猜的规矩只有一条：**同一张图纸上同一个代号，几处必须凑得成同一款。**

`bigger(3, 5)` 里两处都是整数 —— 凑得成，猜 `T` = 整数。
`bigger(1.5, 2.5)` 里两处都是小数 —— 凑得成，猜 `T` = 小数。
可要是两处**不是同一款**，它就猜不出来了 —— 下一节第一个摔法就是这个。
:::

## 三、四种摔法

### 摔法一：两种料凑不到一起

本喵写了一张加法图纸，然后喂进去两种料：

```cpp
#include <iostream>
using namespace std;

template <typename T>
T add(T a, T b) {
    return a + b;
}

int main() {
    cout << add(1, 2.5) << endl;
    return 0;
}
```

```text
main.cpp: In function 'int main()':
main.cpp:10:16: error: no matching function for call to 'add(int, double)'
```

翻译官喵的原话是 `error: no matching function for call to 'add(int, double)'` —— 念作：「**你喊的这声 `add` 要的是同一种料，可你一手递的是整数、一手递的是小数，本喵不知道 `T` 该算哪一款喵。**」

后面那一大串 `candidate` 和 `template argument deduction/substitution failed` 说的也是同一件事：**照这张图纸裁不出这么一个版本**。

修法有两条，本喵都真跑过：

1. **把料凑成同一款**：`add(1.0, 2.5)` —— 两处都是小数。
2. **本喵自己点名**：`add<double>(1, 2.5)` —— 尖括号里明写 `T` 是谁。

### 摔法二：漏了那一行

```cpp
#include <iostream>
using namespace std;

T add(T a, T b) {
    return a + b;
}

int main() {
    cout << add(2, 3) << endl;
    return 0;
}
```

```text
main.cpp:4:1: error: 'T' does not name a type
main.cpp:9:13: error: 'add' was not declared in this scope
```

翻译官喵的原话是 `error: 'T' does not name a type` —— 念作：「**`T` 是什么东西？本喵没见过这个名号喵。**」

因为**空位是 `template <typename T>` 那一行立出来的**：没有那一行，`T` 在本喵眼里就只是一个凭空冒出来的字母。它后面还会跟一句 `error: 'add' was not declared in this scope` —— 图纸都没立起来，喊它当然喊不着。

**记牢这一对：先立空位，再画图纸。**

### 摔法三：点名之后，料被悄悄改小

本喵真跑过这一段，屏幕上印出来的是两行：

```cpp
#include <iostream>
using namespace std;

template <typename T>
T add(T a, T b) {
    return a + b;
}

int main() {
    cout << add<int>(1, 2.5) << endl;
    cout << add<double>(1, 2.5) << endl;
    return 0;
}
```

```text
3
3.5
```

**两行的料一模一样，答案不一样。** 第一行本喵点名 `T` = 整数，于是 `2.5` 被**悄悄改成 `2`** 才喂进去，算出来是 `3`；第二行点的是小数，才是本喵心里那个 `3.5`。

这里**一声都不吭**：翻译官喵不报错、不警告。因为「把小数塞进整数那一格」这件事它本来就允许 —— 只是本喵点了名，它就不再替本喵核实料对不对了。

::: warn 小心喵
**点名是件很硬气的事：本喵说 `T` 是谁，它就把料硬塞进那一款里。** 平时能不点名就别点名 —— 让翻译官喵按料自己猜，猜不出来它会拦下本喵；本喵一点名，它就不拦了。
:::

### 摔法四：换位换了个寂寞

本喵想画一张「把两个东西换个个儿」的图纸：

```cpp
#include <iostream>
using namespace std;

template <typename T>
void swap2(T a, T b) {
    T t = a;
    a = b;
    b = t;
}

int main() {
    int x = 3;
    int y = 5;
    swap2(x, y);
    cout << x << " " << y << endl;
    return 0;
}
```

```text
3 5
```

**换了个寂寞。** 屏幕上还是 `3 5`，而且**一个错都不报**。

根子在塞料上：`T a, T b` 收的是**照料的样子又抄的一份**。图纸里那三行确实换得热火朝天，可换的是**两份抄件**，`x` 和 `y` 这两个真身从头到尾没被人碰过。

补法就是上一课那个记号 —— **加一个 `&`**：

```cpp
#include <iostream>
using namespace std;

template <typename T>
void swap2(T& a, T& b) {
    T t = a;
    a = b;
    b = t;
}

int main() {
    int x = 3;
    int y = 5;
    swap2(x, y);
    cout << x << " " << y << endl;
    return 0;
}
```

```text
5 3
```

一模一样的一段动作，只多了一个字符，屏幕上就真的换了。**图纸上留空的只是「料的款式」，`&` 这件事跟图纸没关系** —— 上一课的规矩，在这一课照样管用。

## 四、起名字要避开现成的

本喵起初把那张比大小的图纸叫 `max`，结果：

```cpp
#include <iostream>
using namespace std;

template <typename T>
T max(T a, T b) {
    return a > b ? a : b;
}

int main() {
    int x = 3;
    int y = 5;
    cout << max(x, y) << endl;
    return 0;
}
```

```text
main.cpp: In function 'int main()':
main.cpp:12:16: error: call of overloaded 'max(int&, int&)' is ambiguous
```

翻译官喵的原话是 `error: call of overloaded 'max(int&, int&)' is ambiguous` —— 念作：「**叫 `max` 的有两位，本喵不知道该听谁的喵。**」

原因是本喵头上一直写着 `using namespace std;` —— 它把现成那一位也叫 `max` 的招式**摊到了桌面上**。本喵自己再画一张同名图纸，两位就撞上了。

修法最简单：**换个名字**。本喵把图纸叫 `bigger`，谁也不撞。（这也是本喵这一课一开始就用 `bigger` 的原因喵。）

## 五、什么时候该画这种图纸

本喵把话收成三条：

1. **同一套动作、好几款料 → 画图纸。** 比大小、换位、挑最大的 —— 动作一个字都不变，只是料的款式不同，这就是它的主场。
2. **只有一款料 → 别硬画。** 本喵这辈子只给整数比大小，那就直接写死整数版 —— 多一层空位、多一层猜，读的人反而更累。
3. **图纸是「照料的款式收」的**：塞进去的第一款料，就定下了整张图纸这一版长什么样。想换一款，就再喊一次、让它照新料再裁一版。

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `template <typename T>` | 立一个空位，代号 `T` —— 图纸上留的位子 |
| `T bigger(T a, T b)` | 空位出现在回来的那一款和两处塞料上，共用一个 `T` |
| `bigger(3, 5)` | 本喵不点名，翻译官喵按料猜 → `T` = 整数 |
| `bigger(1.5, 2.5)` | 同一张图纸，猜出来 `T` = 小数 |
| `bigger<int>(1, 2.5)` | 本喵点名 `T` = 整数 —— `2.5` 被悄悄改成 `2` |
| `error: no matching function for call to 'add(int, double)'` | 两种料凑不到同一个空位上 |
| `error: 'T' does not name a type` | 漏了立空位的那一行 |
| `error: call of overloaded 'max(int&, int&)' is ambiguous` | 图纸名跟现成的招式撞了 |
| `swap2(T& a, T& b)` | 料要真改得动，`&` 不能漏（漏了它换的是抄件） |

## 小任务

1. 把第一节那段抄进练习场跑一次，确认屏幕上真是 `5`、`2.5`、`小鱼干` 三行。
2. 把 `bigger(1.5, 2.5)` 改成 `bigger(1.5, 2)` 再跑一次，看看翻译官喵说什么喵。
3. 把摔法四那段抄进去、**先漏掉那个 `&`** 跑一次，确认屏幕上真是 `3 5`；再把 `&` 补上，看它变成 `5 3`。
4. 给第一节那张图纸**再塞一款新料**（比如一个字母 `'a'` 和一个字母 `'b'`），看看同一张图纸还能不能裁出来。本喵不告诉你结果 —— 自己跑一次才知道喵。
5. 想一想：本喵这张图纸，能不能裁**一整套「数据 + 招式」**，而不只是裁一款料？先记在心里喵。

下一课本喵要把这张图纸用在**一整个盒子**上：一张图纸，裁出一整排**想装几个装几个、会自己变长**的格子。本喵还会顺手教你怎么往里放、怎么往外拿。去下一课探险喵～ 🐾
