---
id: cpp-stage1-12
lang: cpp
stage: 1
order: 13
title: 命名空间与作用域
tags: [命名空间, 作用域, using]
required: ["cpp-stage1-11"]
crossRefs: []
estMinutes: 27
keywords: [namespace, using, scope, std]
---

## 钩子：为什么前十课都在照抄那一句

本喵先问你一件你其实早就见过、却一直没敢问的事：

**前十课每一段的开头，本喵都让你照抄一句 `using namespace std;`。那句到底在干什么？**

今天把它一次讲透。顺便再解掉你肯定撞上过的另一件事：本喵在第 12 段里新开一只叫 `fish` 的碗，为什么它跟外面那只同名的碗**一点不打架**？

这两件事其实是同一件事：**名字住在哪儿。**

## 一、不给全名，翻译官喵不认

先看下面这一段 —— 它**没有**那句 `using namespace std;`，所以 `cout` 和 `endl` 都得写全名：

```cpp
#include <iostream>

int main() {
    std::cout << "本喵自己写全名喵" << std::endl;
    return 0;
}
```

```text
本喵自己写全名喵
```

`cout` 的**真名**其实叫 `std::cout`。前面那一截 `std::` 是它住的**分区**（分区名）—— `std` 是「标准工具箱」那一间，里面住着 `cout`、`endl`、`string` 这些随借随用的家伙。

那为什么平时只写 `cout` 也行？因为 `using namespace std;` 那一句的意思是：

> **「`std` 这一间的门打开，里面的名字报出来就行，不用带分区名。」**

前十课你一直在开门，今天才第一次知道门开在哪儿喵。

## 二、只搬一件出来

门全打开很方便，可有时候会惹麻烦（第五节就有一次翻车）。更稳的写法是**只搬你要用的那一件**：

```cpp
#include <iostream>

using std::cout;
using std::endl;

int main() {
    cout << "只搬了两件出来" << endl;
    return 0;
}
```

```text
只搬了两件出来
```

`using std::cout;` 念作「**把 `std` 那间里的 `cout` 搬到本喵手边**」。搬出来的名字，**只管它所在的那一层**，不往别处扩散 —— 所以它比「整间门打开」稳妥。

## 三、自己开一间

工具箱是别人开的，本喵自己也能开一间。写法是 `namespace 分区名 { ... }`：

```cpp
#include <iostream>
using namespace std;

namespace kitchen {
    int fish = 3;

    int add(int a, int b) {
        return a + b;
    }
}

int main() {
    cout << kitchen::fish << endl;
    cout << kitchen::add(3, 5) << endl;

    kitchen::fish = 10;
    cout << kitchen::fish << endl;
    return 0;
}
```

```text
3
8
10
```

- **`namespace kitchen { ... }`** —— 开一间叫 `kitchen` 的分区，一对大括号圈住的就是这一间里的东西。
- 里头那只碗的真名叫 **`kitchen::fish`**；里头那招的真名叫 **`kitchen::add`**。
- 用的时候带上分区名（`kitchen::`），说得清清楚楚：哪一间里的哪一只。
- 分区里的东西照常能改：`kitchen::fish = 10;` 印出来就是 10 —— **分区不是玻璃柜，它只是给名字分了房间。**

也可以只把其中一件搬出来：

```cpp
#include <iostream>
using namespace std;

namespace kitchen {
    int fish = 3;
}

int main() {
    using kitchen::fish;
    cout << fish << endl;
    return 0;
}
```

```text
3
```

`using kitchen::fish;` 之后，在它管得着的那一层里，写 `fish` 就等于写 `kitchen::fish` —— 和第二节搬 `cout` 是同一招。

## 四、两间各有一只同名的碗

现在来解钩子里的第二个问题：

```cpp
#include <iostream>
using namespace std;

namespace kitchen {
    int fish = 3;
}

namespace pond {
    int fish = 5;
}

int main() {
    cout << kitchen::fish << endl;
    cout << pond::fish << endl;
    return 0;
}
```

```text
3
5
```

两间都有一只叫 `fish` 的碗，**一点都不打架** —— 因为 `kitchen::fish` 和 `pond::fish` 写得清清楚楚，翻译官喵不会认错。

这就是分区的全部意义：**给名字分房间，重名的住不同间。**

（顺带回答一个你迟早会撞上来的问题：为什么本喵给招式起名可以放心大胆地用 `add`、`check` 这种到处都有人用的大路货？因为它住在你这间里，和工具箱里那位同名的不相干喵。）

两间同名为什么不打架、开门又到底开了什么，本喵走一遍给你看：

```demo
title: 两间各有一只同名的碗：靠分区名分清楚
code:
| namespace kitchen {
|     int fish = 3;
| }
|
| namespace pond {
|     int fish = 5;
| }
|
| std::cout << kitchen::fish << std::endl;
| std::cout << pond::fish << std::endl;
| using namespace kitchen;
| std::cout << fish << std::endl;

step 开一间厨房，里头摆一只 fish
at: 1
say: `namespace kitchen { ... }` 开一间叫 `kitchen` 的分区，一对大括号圈住的就是这一间。里头这只碗的真名不叫 `fish`，叫 **`kitchen::fish`**，里面装 3。
meow: 厨房这间开张，摆上一只 3 喵～
pose: expect
厨房那间的 fish = kitchen::fish，装 3
池塘那间的 fish = （还没开这间）
哪几间的门开着 = 一间都没开
印出来 = 还没印

step 再开一间池塘，里头也有一只 fish
at: 5
say: 又开一间 `pond`，里头也摆一只叫 `fish` 的碗，装 5。两间的碗**重名**，可真名一个 `kitchen::fish`、一个 `pond::fish` —— 写得清楚，翻译官喵就不会认错。
meow: 池塘也开张，两只同名碗不打架喵～
pose: busy
厨房那间的 fish = kitchen::fish，装 3
池塘那间的 fish = pond::fish，装 5
哪几间的门开着 = 一间都没开
印出来 = 还没印

step 带上分区名喊它：kitchen::fish
at: 9
say: `kitchen::fish` 是**全名**：`::` 前面那一截说的是「哪一间里的」。写全名不用开任何门，印出来是厨房那间的 3。
meow: 点名 kitchen，拿到 3 喵！
pose: yay
厨房那间的 fish = kitchen::fish，装 3
池塘那间的 fish = pond::fish，装 5
哪几间的门开着 = 一间都没开
印出来 = 3（写的全名）

step 换一间喊：pond::fish
at: 10
say: 同一个名字，前面换成 `pond::`，拿到的就是池塘那间那只 —— 5。**重名不可怕，写清分区名就不打架。**
meow: 换一间喊，拿到 5 喵！
pose: yay
厨房那间的 fish = kitchen::fish，装 3
池塘那间的 fish = pond::fish，装 5
哪几间的门开着 = 一间都没开
印出来 = 5（写的全名）

step 把 kitchen 的门打开
at: 11
say: `using namespace kitchen;` 念作「`kitchen` 这间的门打开」—— 之后在这一层里，里面的名字**报出来就行、不用带分区名**，跟前十课那句 `using namespace std;` 是同一招。
meow: 厨房的门敞开啦，里面随便喊喵～
pose: proud
厨房那间的 fish = kitchen::fish，装 3
池塘那间的 fish = pond::fish，装 5
哪几间的门开着 = 只开了 kitchen 这一间
印出来 = 5（写的全名）

step 门开着，裸喊 fish 就是 kitchen::fish
at: 12
say: 现在直接写 `fish`，就等于写 `kitchen::fish` —— 印出来是 3。**只开一扇门**才这么稳；要是把 `pond` 的门也打开、里头又重名，翻译官喵只会回你一句 `ambiguous`（第六节摔法三）。
meow: 门开一间就够，两间全开要打架喵
pose: proud
厨房那间的 fish = kitchen::fish，装 3
池塘那间的 fish = pond::fish，装 5
哪几间的门开着 = 只开了 kitchen 这一间
印出来 = 3（门开着，喊到了厨房那间）
```

**分区这件事就一句话**：名字住在哪一间，真名就得带上哪一间的名（`kitchen::fish`）。带全名最稳；想省那截，就得开对门 —— 而且**只开一间**，两间全开又要重名，翻译官喵就不知道该拿哪一只了喵。

## 五、大括号也是一道围墙

分区讲完了，现在讲另一半：**作用域（大括号围墙）**。

其实它你早就在用了 —— 每一招的招体外面都有一对大括号，招式里开的碗出了那对括号就没了。今天把它说成一条规矩：

> **一对大括号圈出来的地盘，就是一层。名字从哪儿开始能用、到哪儿就没了，全看它开在哪一对大括号里。**

先看一个最容易看走眼的：

```cpp
#include <iostream>
using namespace std;

int fish = 3;

int main() {
    cout << fish << endl;

    int fish = 10;
    cout << fish << endl;

    {
        int fish = 20;
        cout << fish << endl;
    }

    cout << fish << endl;
    return 0;
}
```

```text
3
10
20
10
```

盯住这四行喵：

- 最外面那只 `fish = 3` 开在**所有招式外面**，站在哪儿都喊得到 → 印 `3`
- 招式里新开一只 `fish = 10`，**内层把外层遮住了** → 印 `10`
- 再往里一对大括号，又开一只 `fish = 20` → 印 `20`
- 出了那对括号，里头那只就跟没开过一样 → 又印 `10`

一句话记住：**内层可以遮住外层，外层看不见内层。**

所以里面开的碗，外面压根喊不到 —— 但里面的东西**能往外借**：

```cpp
#include <iostream>
using namespace std;

int main() {
    int total = 0;
    {
        int fish = 3;
        total = total + fish;
    }
    cout << total << endl;
    return 0;
}
```

```text
3
```

`total` 开在招式那一层，大括号里的 `fish` 只活在那对括号里 —— 可括号里那句 `total = total + fish;` 改的是**外面**那只 `total`，所以能带出来。反过来就不行：本喵要是站在括号外面喊 `fish`，翻译官喵当场不认（第六节的摔法二就是它）。

::: warn 小心喵
三条最容易摔的，一条一条记：

1. **前十课那句 `using namespace std;` 写在招式外面那一层。** 你可以把它写进招式里，那样它也管用 —— 只不过出了那一招，名字又得写全名了。
2. **大括号里的名字出了括号就没了。** 想把结果带出来，得**提前在外面开一只碗**装着（上面 `total` 就是这么干的）。
3. **内层遮住外层，是本课最容易看走眼的。** 那四行同样的 `fish` 印出 `3 10 20 10` 四个数，原因就是它站在不同的括号里，谁也管不着谁。
:::

## 六、三个最容易摔的地方

**摔法一：忘了开门。**

```cpp
#include <iostream>

int main() {
    cout << "喵" << endl;
    return 0;
}
```

```text
main.cpp:4:5: error: 'cout' was not declared in this scope; did you mean 'std::cout'?
main.cpp:4:21: error: 'endl' was not declared in this scope; did you mean 'std::endl'?
```

`not declared in this scope` 念作「**这个名字在本层没听说过**」（scope 就是「这一层」的意思）。翻译官喵还顺手告诉你它住哪儿：`did you mean 'std::cout'?` —— 补上 `std::`，或者老老实实开门（写 `using namespace std;`），两条路都行。

**摔法二：跑到围墙外面喊名字。**

```cpp
#include <iostream>
using namespace std;

int main() {
    int total = 0;
    {
        int fish = 3;
        total = total + fish;
    }
    total = total + fish;
    cout << total << endl;
    return 0;
}
```

```text
main.cpp:10:21: error: 'fish' was not declared in this scope
```

`fish` 是在大括号里开的，那一层一结束它就没了。`main.cpp:10:21` 指的是**第 10 行第 21 列** —— 翻译官喵连位置都给你标好了，照着位置看一眼就知道是哪一个名字出了墙。

**摔法三：两间门一起打开，里头还重名。**

```cpp
#include <iostream>
using namespace std;

namespace kitchen {
    int fish = 3;
}

namespace pond {
    int fish = 5;
}

int main() {
    using namespace kitchen;
    using namespace pond;
    cout << fish << endl;
    return 0;
}
```

```text
main.cpp:15:13: error: reference to 'fish' is ambiguous
```

**两间的门都打开了，里头又各有一只同名的碗 —— 这时候喊 `fish`，翻译官喵真的不知道该拿哪一只**，只能说「ambiguous」（含糊、说不清）。改法很干脆：**要么只打开一间，要么写全名 `kitchen::fish`。**

（这也是为什么第二节那种「只搬一件出来」的写法更稳妥：搬出来的那件不重名，就不会撞上这一条。）

## 小抄表

| 写法 | 念作 | 干什么 |
|---|---|---|
| `std::cout` | 带分区名的全名 | 写全名，不用开门也能用 |
| `using namespace std;` | 把 `std` 这间门打开 | 里面的名字报出来就行（只管它所在那一层） |
| `using std::cout;` | 只搬一件出来 | 只把 `cout` 搬到手边 |
| `namespace kitchen { ... }` | 自己开一间 | 里面的东西真名叫 `kitchen::某某` |
| `kitchen::fish` | 带分区名喊它 | 明确指出是哪一间里的哪一只 |
| `using kitchen::fish;` | 把那一件搬出来 | 之后写 `fish` 就等于写 `kitchen::fish` |
| `{ ... }` | 一对大括号一层楼 | 名字只活在这一对括号里 |

::: tip 猫咪提示
本课六次总结，一句话一个：

1. **`std` 是个分区，`cout` 的真名是 `std::cout`** —— 平时省掉的那截就是分区名。
2. **`using namespace` 是「把整间门打开」，`using 某某::某件` 是「只搬一件出来」** —— 后者更稳。
3. **自己开间用 `namespace`，里面的名字真名叫 `分区::名字`。**
4. **重名不可怕，写清分区名就不打架。**
5. **大括号就是一层，名字只活在自己那一层里。**
6. **内层遮外层，外层看不见内层。**
:::

::: warn 小心喵
三条最容易摔的（再来一遍，这回是报错版）：

1. **`'cout' was not declared in this scope`** —— 忘了开工具箱，或者忘了写 `std::`。
2. **`'fish' was not declared in this scope`** —— 你在围墙外面喊了里头开的名字。
3. **`reference to 'fish' is ambiguous`** —— 两间门都开着，里头还重名，翻译官喵不知道该拿哪一只。
:::

## 小任务

1. 把第一节那段里的 `std::cout` 改成 `cout`（`std::` 和 `std::endl` 都删掉），看看翻译官喵怎么说，再改回来。
2. 把第二节里 `using std::cout;` 那一行删掉，跑一次 —— 现在你能说出它为什么必要了吗喵？
3. 自己开一间 `namespace pond`，里头放一只 `fish = 8`；在招式里把它印出来，再改成 88 印第二次。
4. 把第四节那段里 `using namespace kitchen;` 留着、`using namespace pond;` 删掉，再跑一次 —— 这次 `fish` 印几？
5. 在第五节的第四段（`total` 那一段）里，把 `int total = 0;` 挪到**大括号里面**去。跑一次，看看翻译官喵怎么说，想想为什么。
6. 留一问给你：本喵在招式里写 `using namespace std;`，出了这一招，下一招里还能直接写 `cout` 吗喵？

下一课，本喵要讲一件你迟早躲不开的事：**开演之后才翻的车**。前面十一课翻车，翻的都是「翻译官喵看不懂」—— 那是**开演前**就拦下来的。可有些车是在程序**已经跑起来之后**才翻的：鱼塘里没有那条鱼、除数是 0……这种车怎么接住？去「异常」那一课喵～ 🐾
