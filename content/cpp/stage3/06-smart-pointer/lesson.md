---
id: cpp-stage3-06
lang: cpp
stage: 3
order: 10
title: 智能指针——会自己叼回仓库的猫爪指向牌
tags: [内存, 智能指针]
required: ["cpp-stage3-05"]
crossRefs: []
estMinutes: 27
keywords: [unique_ptr, shared_ptr, make_unique, make_shared, move, use_count]
---

## 钩子：本喵欠大肥鱼一间仓库

上一阶段本喵学会了一件很威风的事：**现要现租的仓库** —— 要用的时候喊一声 `new` 把它租下来，用完了自己喊一声 `delete` 还回去。当时本喵还觉得：这不挺简单嘛。

结果上周就出了事。本喵写了个小活儿去仓库取货，中途看见鱼干，就「提前出门」了一趟（写着写着 `return` 掉了）。回来大肥鱼问：仓库还了吗？本喵一看 —— **那间仓库还挂在本喵名下**。大肥鱼只说了一句：`delete` 是**你的**活，翻译官喵可不会替你记着。

今天要请的这位新帮手，学名是**智能指针（会自己还仓库的牌子）**。本喵管它叫**会自己叼回仓库的猫爪指向牌** —— 牌子一走出它出生的那片范围，它自己就把仓库叼回去了，你一个字都不用写。

## 一、先把那间没还的仓库摆出来

```cpp
#include <iostream>
#include <string>
using namespace std;

struct Fish {
    string name;
    Fish(string n) : name(n) { cout << "租下 " << name << endl; }
    ~Fish() { cout << "还回 " << name << endl; }
};

void work(bool early) {
    Fish* p = new Fish("大肥鱼");
    if (early) {
        return;
    }
    cout << "用完 " << p->name << endl;
    delete p;
}

int main() {
    work(false);
    cout << "--- 提前出门那一趟 ---" << endl;
    work(true);
    cout << "收工" << endl;
    return 0;
}
```

```text
租下 大肥鱼
用完 大肥鱼
还回 大肥鱼
--- 提前出门那一趟 ---
租下 大肥鱼
收工
```

盯住第二趟喵：`租下 大肥鱼` 印出来了，`还回 大肥鱼` **一次都没印**。原因就是那三行 `if (early) { return; }` —— 它把 `delete p;` 那一句整个跳过去了，仓库谁也没还。

本喵把这段拿最啰嗦的那档 `-Wall` 真跑过一遍：**翻译官喵一个字都没说**，程序照样正常收工（上面那几行就是它真跑出来的样子）。「忘了还」这种事，它不管。

## 二、请一位会自己还仓库的帮手

`unique_ptr` 就是这样的牌子：**一块牌子只有一个主人**。它最讨喜的地方是——牌子走出它出生的花括号，仓库自己就被叼回去了。

```cpp
#include <iostream>
#include <memory>
#include <string>
using namespace std;

struct Fish {
    string name;
    Fish(string n) : name(n) { cout << "领到 " << name << endl; }
    ~Fish() { cout << "还回 " << name << endl; }
};

int main() {
    cout << "开门" << endl;
    {
        unique_ptr<Fish> p = make_unique<Fish>("大肥鱼");
        cout << "屋里用 " << p->name << endl;
    }
    cout << "关门" << endl;
    return 0;
}
```

```text
开门
领到 大肥鱼
屋里用 大肥鱼
还回 大肥鱼
关门
```

三件事记住：

- `make_unique<Fish>("大肥鱼")` **一趟把两件事都做了**：仓库租下来、货也放进去。自己写 `new` 的那一套不用了（请它也别忘了开头的 `#include <memory>`）。
- 用起来的姿势和裸牌子一模一样：`*p` 是仓库里那件货，`p->name` 是里头那只猫的名字。
- 最要紧的是最后那块：**花括号一结束，`还回 大肥鱼` 自己就冒出来了** —— 本喵一个字都没写。这不是运气，是牌子的规矩：它一来就把仓库认下了，走的时候自然要还。

::: tip 猫咪提示
「还仓库」这件事是牌子的**出生证上写好的**，跟你怎么出门没关系：正常走到底会还，中途 `return` 也会还。后面第七课讲的那条黄金法则，说的就是这件事喵。
:::

## 三、把那趟「提前出门」重写一遍

同一件事，换成牌子来拿仓库：

```cpp
#include <iostream>
#include <memory>
#include <string>
using namespace std;

struct Fish {
    string name;
    Fish(string n) : name(n) { cout << "租下 " << name << endl; }
    ~Fish() { cout << "还回 " << name << endl; }
};

void work(bool early) {
    unique_ptr<Fish> p = make_unique<Fish>("大肥鱼");
    if (early) {
        return;
    }
    cout << "用完 " << p->name << endl;
}

int main() {
    work(false);
    cout << "--- 提前出门那一趟 ---" << endl;
    work(true);
    cout << "收工" << endl;
    return 0;
}
```

```text
租下 大肥鱼
用完 大肥鱼
还回 大肥鱼
--- 提前出门那一趟 ---
租下 大肥鱼
还回 大肥鱼
收工
```

第二趟里 `租下` 和 `还回` 一对整整齐齐 —— 一字没改的 `if (early) { return; }` 这次没漏掉任何东西。

把第一段和这一段并排看：**都是提前出门，一个漏、一个不漏**，差别只在「谁来记这件事」。手写的 `delete` 要你自己在每一条出门的路上都记着；牌子记着。

## 四、一块牌子只能有一个主人

既然牌子自己会还，那「两块牌子指着同一间仓库」就很危险了：还两次要出事。所以 C++ 干脆**不许你复制**它。本喵试着复制了一下：

```cpp
#include <iostream>
#include <memory>
using namespace std;

int main() {
    unique_ptr<int> a = make_unique<int>(1);
    unique_ptr<int> b = a;
    cout << *b << endl;
    return 0;
}
```

翻译官喵当场犯难：

```text
main.cpp: In function 'int main()':
main.cpp:7:25: error: use of deleted function 'std::unique_ptr<_Tp, _Dp>::unique_ptr(const std::unique_ptr<_Tp, _Dp>&) [with _Tp = int; _Dp = std::default_delete<int>]'
```

它说的是「这个本事已经被划掉了」——`use of deleted function` 是本喵每次看到都要点头的一句：**不是本喵写错了名字，是这条路压根不给你走**。（后面还跟着一串柜子内部的话和箭头，本喵掐掉了，只留这一行。）

## 五、换个主人要打招呼：`move`

不许复制，那想换主人怎么办？打招呼。`move(a)` 念作「`a` 这一份本喵不要了，你搬过去」：

```cpp
#include <iostream>
#include <memory>
using namespace std;

int main() {
    unique_ptr<int> a = make_unique<int>(1);
    unique_ptr<int> b = move(a);
    cout << *b << endl;
    cout << (a == nullptr ? "a 已经空手了" : "a 还拿着") << endl;
    return 0;
}
```

```text
1
a 已经空手了
```

上面第二行是**真跑出来的**：搬完家，原来那块牌子手里**空的**（`a == nullptr` 为真）。这一点很重要 —— 换过主人之后，原来那块牌子就只剩一个空壳了，别再拿它去取货。

::: warn 小心喵
`move` 只是「本喵不要了」的**宣告**，它自己一个字节都不搬。真正把货挪过去的是牌子的搬家本事。本喵第八课会专门讲这件事，现在你只要记住：**宣告之后，旧的那块牌子就不能再用了。**
:::

## 六、好几只猫共用一份：`shared_ptr`

有些仓库确实得几处一起用（比如大肥鱼的账本，前厅和后厨都要看）。这时候请 `shared_ptr`：**它数人头**。

```cpp
#include <iostream>
#include <memory>
#include <string>
using namespace std;

struct Fish {
    string name;
    Fish(string n) : name(n) { cout << "领到 " << name << endl; }
    ~Fish() { cout << "还回 " << name << endl; }
};

int main() {
    shared_ptr<Fish> a = make_shared<Fish>("大肥鱼");
    {
        shared_ptr<Fish> b = a;
        cout << "两只手都拿着，数=" << a.use_count() << endl;
    }
    cout << "一只手放下了，数=" << a.use_count() << endl;
    return 0;
}
```

```text
领到 大肥鱼
两只手都拿着，数=2
一只手放下了，数=1
还回 大肥鱼
```

`use_count()` 就是「现在有几只手指着这间仓库」：刚请来是 1，`b = a` 之后变 2，花括号里那只手一放下就回到 1 —— 这时候仓库**还没还**。等最后一根手指也松开（`main` 走完），`还回 大肥鱼` 才出现。

::: warn 小心喵
`shared_ptr` 能复制、会数人头，代价是每复制一次都要动那个数。本喵自己的习惯是：**能 `unique_ptr` 就 `unique_ptr`**，真需要「好几处一起用」时才请 `shared_ptr`。牌子请得越少，你要记的事就越少喵。
:::

这只手是怎么自己加减的，本喵拆成一步一步走给你看：

```demo
title: 数人头的那只手：1 涨到 2，掉回 1，减到 0 才还仓库
code:
| struct Fish {
|     string name;
|     Fish(string n) : name(n) { cout << "领到 " << name << endl; }
|     ~Fish() { cout << "还回 " << name << endl; }
| };
|
| int main() {
|     shared_ptr<Fish> a = make_shared<Fish>("大肥鱼");
|     {
|         shared_ptr<Fish> b = a;
|         cout << "两只手都拿着，数=" << a.use_count() << endl;
|     }
|     cout << "一只手放下了，数=" << a.use_count() << endl;
| }

step 请牌子：租仓库 + a 接住，数就是 1
at: 8
say: 第 8 行一次做了两件事：`make_shared<Fish>("大肥鱼")` 先把仓库租下来（第 3 行的出生招式印出「领到 大肥鱼」），紧接着 `a` 把牌子接住。到这一行末尾，**数已经是 1** —— 有名字指着它了。
meow: 仓库租好，牌子揣进 a 手里喵！
pose: expect
a 这颗牌子 = 指着大肥鱼那间仓库
b 这颗牌子 = （还没有 b）
几只手拿着这间仓库 = 1
屏幕上 = 领到 大肥鱼

step 里屋的门开了：这一行自己不开工
at: 9
say: 第 9 行只是一对大括号的开头 —— 里屋的门开了。**门自己不开工**：数还是 1，仓库没动，屏幕上也没多一个字。会干活的是它里面那一行。
meow: 门开了，可还是只有 a 一只手喵～
pose: expect
a 这颗牌子 = 指着大肥鱼那间仓库
b 这颗牌子 = （还没有 b）
几只手拿着这间仓库 = 1
屏幕上 = 领到 大肥鱼

step b = a：数悄悄涨到 2
at: 10
say: 第 10 行 `b = a`。这是 `shared_ptr` 和上一课那块牌子最大的不同：**它许你复制**。可复制出来的不是第二间仓库，是**第二只手抓住同一间** —— 数在这一步从 1 涨到 2，本喵一个字都没写，是牌子自己记的账。
meow: 多一只手抓同一间，数自己涨喵！
pose: busy
a 这颗牌子 = 指着大肥鱼那间仓库
b 这颗牌子 = 也指着同一间仓库
几只手拿着这间仓库 = 2
屏幕上 = 领到 大肥鱼

step 印出来对账：数 = 2
at: 11
say: 第 11 行把数印出来，得到 `2` —— 这就是课文那句「刚请来是 1，`b = a` 之后变 2」的现场。这个数不用谁去加，牌子替你记着。
meow: 数=2，本喵一次都没数过喵！
pose: yay
a 这颗牌子 = 指着大肥鱼那间仓库
b 这颗牌子 = 也指着同一间仓库
几只手拿着这间仓库 = 2
屏幕上 = 领到 大肥鱼 / 两只手都拿着，数=2

step 里屋关门：b 走了，数掉回 1
at: 12
say: 第 12 行那个 `}` 是里屋的门关上 —— `b` 住里屋，它到这一刻就走了，手里那颗牌子松开。数从 2 **掉回 1**。要紧的是：**仓库这时候还没还**，因为 `a` 那只手还抓着。
meow: b 松手了，数掉回 1，还没还喵
pose: expect
a 这颗牌子 = 指着大肥鱼那间仓库
b 这颗牌子 = （已经走了）
几只手拿着这间仓库 = 1
屏幕上 = 领到 大肥鱼 / 两只手都拿着，数=2

step 再印一次：数 = 1，仓库还在
at: 13
say: 第 13 行印出 `1`。屏幕上到这儿一共两行数，一「2」一「1」—— 仓库**一次都没还**，因为数还没走到 0。这就是课文说的「这时候仓库还没还」。
meow: 数=1，仓库还稳稳站着喵～
pose: yay
a 这颗牌子 = 指着大肥鱼那间仓库
b 这颗牌子 = （已经走了）
几只手拿着这间仓库 = 1
屏幕上 = 领到 大肥鱼 / 两只手都拿着，数=2 / 一只手放下了，数=1

step 最后一根手松开：数落到 0
at: 14
say: 第 14 行是 `main` 的收尾大括号，`a` 也住到头了 —— 最后一根手松开，数从 1 落到 **0**。到这一刻为止，屏幕上还是那三行，什么都还没发生。
meow: 最后一根手松开，数到 0 了喵！
pose: think
a 这颗牌子 = （也走了，手里空了）
b 这颗牌子 = （已经走了）
几只手拿着这间仓库 = 0
屏幕上 = 领到 大肥鱼 / 两只手都拿着，数=2 / 一只手放下了，数=1

step 数一到 0：收尾招式当场自己跑
at: 14
say: **数一到 0，收尾招式当场自己跑**：第 4 行的 `~Fish()` 印出「还回 大肥鱼」，仓库这才被叼回去。本喵从开头到结尾**没写过一句「该还了」** —— 减到 0 自动收，这就是它。
meow: 减到 0，仓库自己回去啦！
pose: proud
a 这颗牌子 = （也走了，手里空了）
b 这颗牌子 = （已经走了）
几只手拿着这间仓库 = 0（仓库已还）
屏幕上 = 领到 大肥鱼 / 两只手都拿着，数=2 / 一只手放下了，数=1 / 还回 大肥鱼
```

**盯住最后那两格**：数从 1 落到 0 的那一刻，收尾招式才跑。1 涨到 2 也好、2 掉回 1 也好，仓库都还稳稳在那儿 —— 只有**减到 0** 才收。这就是 `shared_ptr` 全部的规矩。

## 一句话对照表

| 想干什么 | 写什么 |
|---|---|
| 请一块自己会还的牌子 | `unique_ptr<...> p = make_unique<...>(...)` |
| 取货 / 喊里头的名字 | `*p` / `p->name` |
| 换主人（旧的那块变空手） | `unique_ptr<...> b = move(a);` |
| 好几处共用一份 | `shared_ptr<...> p = make_shared<...>(...)` |
| 看还有几只手拿着 | `p.use_count()` |

## 小任务

1. 把第一节那段手写 `new` / `delete` 的代码改成牌子的版本（照第三节抄就行），真跑一次 —— 提前出门那一趟是不是也印出 `还回 大肥鱼` 了？
2. 把第四节那段里的 `b = a` 改成 `b = move(a)`，真跑一次 —— 报错不见了，但 `a` 还拿着货吗？把 `cout << (a == nullptr ? "空手" : "还拿着") << endl;` 加进去看一眼。
3. 第六节那段代码里，本喵只印了两次数。你自己加一层花括号、多请一块牌子指着同一间仓库，先猜三个数会是多少，再真跑对答案。
4. 想一想：手写的 `delete` 和牌子自己还，差在哪一步上？为什么「中途提前出门」这件事，对前者是坑、对后者不是？

下一课讲**RAII** —— 「进门就领、出门就还」这条黄金法则。今天这位帮手只是这条法则最常用的一张脸，回头你会看见它出现在文件、锁、连接……所有「用完必须还」的地方喵～ 🐾
