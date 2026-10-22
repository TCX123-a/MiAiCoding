---
id: cpp-stage2-09
lang: cpp
stage: 2
order: 9
title: 继承——图纸套图纸
tags: [面向对象, 继承]
required: ["cpp-stage2-08"]
crossRefs: []
compare: ["common-10"]
estMinutes: 26
keywords: [extends, protected, override, base]
---

## 钩子：小橘这张图纸，和猫这张图纸八分像

本喵手里已经有一张 `Cat` 图纸了：有名字那一格、有鱼干数那一格、会喵喵叫。

现在本喵想要一张 `Kitten`（小猫）图纸。可本喵把它摊开一画 —— 名字、鱼干数、喵喵叫，**全都一样**，只有一两处不一样（小猫还会摇尾巴）。本喵等于在**重画一遍已经画过的东西**。

更气人的是后果：哪天本喵觉得「喵喵叫」该改个调子，**两张图纸都得改一遍**。这就是本喵第一阶段最烦的那件事 —— 抄自己。

今天这一手能一次解决它：**让新图纸照着老图纸画下来。** 老图纸上有的，新图纸自动全有；新图纸只管往上添自己那点不一样。这一手在猫咪世界里叫**图纸套图纸（继承）**。

## 一、新图纸照着老图纸画

写法只多一小段：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    void meow() const {
        cout << name << "：喵～" << endl;
    }
};

class Kitten : public Cat {
public:
    void wag() const {
        cout << name << " 摇起了尾巴" << endl;
    }
};

int main() {
    Kitten k;
    k.name = "小橘";
    k.meow();
    k.wag();
    return 0;
}
```

```text
小橘：喵～
小橘 摇起了尾巴
```

看清楚这里发生了什么：**`Kitten` 图纸上根本没有写 `name`，也没有写 `meow`**，可照它生出来的小橘两样都会用。

- **`class Kitten : public Cat`** —— 这一行就是全部的秘密。念作「`Kitten` 这张图纸，**照着 `Cat` 画下来**」。
- **老图纸上的东西，新图纸自动全有**：格子（`name`）和招式（`meow`）都跟着来了。本喵只管往里添新东西（`wag` 这一手）。
- **改一处，处处跟着变。** 哪天本喵把 `Cat::meow` 改成「喵呜～」，`Kitten` 照出来的小猫**立刻**跟着改，一个字都不用动。这正是本喵要的效果喵。
- **小橘**是一只 `Kitten`，同时**也是一只 `Cat`。** 这句话往后很重要：凡是「能放一只猫」的地方，放一只小猫同样成立 —— 因为它本来就是猫。

本喵把「生一只小猫」这件事拆成一步一步，走给你看：

```demo
title: 小猫生出来的时候，妈妈那一份先摆好
code:
| class Cat { ... };                    // 妈妈那张图纸：一格 name、一手 meow
| class Kitten : public Cat { ... };    // 小猫图纸：照妈妈画下来，自己再添一手 wag
| Kitten k;                             // 照小猫图纸生一只
| k.name = "小橘";                      // 装料：装的是妈妈那一格
| k.meow();                             // 喊妈妈那一手
| k.wag();                              // 喊小猫自己添的那一手

step 妈妈那张图纸摊开
at: 1
say: `Cat` 图纸上只有两样：一格 `name`、一手 `meow`。**图纸本身不占地** —— 它摊在这儿，场上还没有一只猫。
meow: 妈妈图纸摊开，先认识一下喵～
pose: welcome
这只猫身上 = （还没有猫）
name 那一格 = （还没有猫）
这一步跑的是 = （还没喊）

step 小猫图纸照着妈妈画
at: 2
say: 这一行就是全部的秘密：`class Kitten : public Cat` 念作「小猫这张图纸，**照着 `Cat` 画下来**」。小猫图纸上**没写** `name`、**没写** `meow` —— 它写的是「妈妈那一份也跟着来」。
meow: 妈妈那份跟着来，一笔就到手喵！
pose: expect
这只猫身上 = （还没有猫）
name 那一格 = （还没有猫）
这一步跑的是 = 小猫图纸上写着：妈妈那份也跟着来

step 生一只：先摆妈妈那一整份
at: 3
say: `Kitten k;` 要把这只猫摆出来。摆的顺序是钉死的：**先摆下妈妈那一整份** —— `name` 那一格就在这一份里，这一手 `meow` 也在里头。
meow: 先摆妈妈那一半，地基先浇喵～
pose: busy
这只猫身上 = 妈妈那一半（先摆好）
name 那一格 = （空着）
这一步跑的是 = （还没喊）

step 再摆小猫自己添的那一份
at: 3
say: 妈妈那份摆完，才摆小猫自己添的那一份。它**不是另起一间**，是紧挨着妈妈那一份、摆在同一只猫身上 —— 所以小猫图纸上那句 `name`，一伸手就够得着。注意 `name` 那一格**还是空的**，摆完也不会自己装上东西。
meow: 小猫那一半紧挨着摆，不分家喵～
pose: busy
这只猫身上 = 妈妈那一半 + 小猫那一半（wag）
name 那一格 = （空着）
这一步跑的是 = （还没喊）

step 给妈妈那一格装料
at: 4
say: `k.name = "小橘";` 装进的是**妈妈那一份里的那一格** —— 小猫图纸上根本没写这一格，可它够得着，因为那一格就在它身上。
meow: 这一格是妈妈那份里的，够得着喵～
pose: yay
这只猫身上 = 妈妈那一半 + 小猫那一半（wag）
name 那一格 = 小橘
这一步跑的是 = （还没喊）

step 喊一声妈妈那一手
at: 5
say: `k.meow()` —— 小猫图纸上**根本没有写这一手**，跑起来的是妈妈那一手。它印出来的 `name`，就是刚装进妈妈那一格的那个字。
meow: 小猫图纸没写这一手，照样会喵！
pose: proud
这只猫身上 = 妈妈那一半 + 小猫那一半（wag）
name 那一格 = 小橘
这一步跑的是 = 妈妈那一手 meow（印「小橘：喵～」）

step 喊一声自己添的那一手
at: 6
say: `k.wag()` 是小猫自己添的那一手，妈妈图纸上没有它。它里面印的 `name` 同样是妈妈那一格 —— 两只手伸向的，是同一只猫身上的同一格。
meow: 这一手是小猫自己添的，也会啦喵！
pose: yay
这只猫身上 = 妈妈那一半 + 小猫那一半（wag）
name 那一格 = 小橘
这一步跑的是 = 小猫自己添的 wag（印「小橘 摇起了尾巴」）
```

看出来了吗：小猫身上那一格 `name`、那一手 `meow`，**不是抄过去的，是它身上本来就有妈妈那一整份** —— 生的时候先摆妈妈那一份，再摆小猫自己添的那一份。这就是那句「小猫本来就是猫」的底子喵。

## 二、那一小段 `public` 管的是「盖子透不透」

`class Kitten : public Cat` 里的 `public` 不是随便写写的。本喵先把三种盖子的老规矩摆出来（这是本喵在讲盖子那一课教过的）：

| 标签 | 谁够得着 |
|---|---|
| `private:` | **只有图纸自己的招式**够得着 |
| `protected:` | 图纸自己的招式 + **照着它画下来的新图纸**够得着 |
| `public:` | 谁都够得着 |

老图纸上挂 `protected:` 的格子，**小猫图纸够得着，但外面的 `main` 够不着** —— 这正是它的用处。看一段：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
    string name;
protected:
    int fish;
public:
    Cat(string n, int f) : name(n), fish(f) {}
    void showName() const {
        cout << "本喵是" << name << "喵" << endl;
    }
};

class Kitten : public Cat {
public:
    Kitten(string n, int f) : Cat(n, f) {}
    void eat() {
        fish = fish + 1;
        cout << "吃了一条，现在 " << fish << " 条" << endl;
    }
};

int main() {
    Kitten k("小橘", 3);
    k.showName();
    k.eat();
    return 0;
}
```

```text
本喵是小橘喵
吃了一条，现在 4 条
```

- **`name` 挂 `private:`，小猫图纸够不着**（只有 `Cat` 自己的招式能碰）—— 所以 `Kitten` 里那句印名字，走的是老图纸给它的公开招式 `showName()`。
- **`fish` 挂 `protected:`，小猫图纸够得着** —— 所以 `Kitten::eat` 里能直接写 `fish = fish + 1;`。改成 `private:` 会怎样？本喵真跑过：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
    string name;
    int fish;
public:
    Cat(string n, int f) : name(n), fish(f) {}
};

class Kitten : public Cat {
public:
    Kitten(string n, int f) : Cat(n, f) {}
    void eat() {
        fish = fish + 1;
        cout << "吃了一条，现在 " << fish << " 条" << endl;
    }
};

int main() {
    Kitten k("小橘", 3);
    k.eat();
    return 0;
}
```

```text
main.cpp:16:9: error: 'int Cat::fish' is private within this context
```

「**私有，你现在站的这个地方够不着**喵。」小猫图纸**不是**老图纸自己 —— 老图纸扣上盖子的格子，连亲生孩子都碰不得。**想让小猫用，就得把那一格改成 `protected:`，或者由老图纸提供一个公开招式替它动手。**

### 少写了 `public` 会怎样

`class Kitten : public Cat` 里的 `public` 少写掉，写成 `class Kitten : Cat`，是最常见的一跤：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    void meow() const {
        cout << name << "：喵～" << endl;
    }
};

class Kitten : Cat {
public:
    void wag() const {
        cout << name << " 摇起了尾巴" << endl;
    }
};

int main() {
    Kitten k;
    k.name = "小橘";
    k.meow();
    return 0;
}
```

```text
main.cpp:22:7: error: 'std::string Cat::name' is inaccessible within this context
```

念作：「**够不着喵。**」注意这里的用词是「够不着」而不是「私有」—— 因为这一格在老图纸上本来就是公开的，只是**少写了那个 `public`，等于把老图纸给的东西全变成了小猫图纸自己的私事**，外面的 `main` 就再也够不着了。

**这是本课最容易摔的一跤**，而且它很安静：图纸里怎么写都没问题，是**外面那句 `k.meow()` 突然不认了**。看到「够不着」，第一件事就是回去看那一行有没有 `public` 喵。

## 三、出生顺序：先妈妈，后小猫

小猫图纸照出来的真猫，是**妈妈那一半 + 小猫那一半**拼起来的。那出生的时候按什么顺序搭？收尾的时候按什么顺序拆？本喵跑一遍给你看：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(string n) : name(n) {
        cout << "猫妈妈那一半先搭好：" << name << endl;
    }
    ~Cat() {
        cout << "猫妈妈那一半后拆：" << name << endl;
    }
};

class Kitten : public Cat {
public:
    Kitten(string n) : Cat(n) {
        cout << "小猫那一半再搭好：" << name << endl;
    }
    ~Kitten() {
        cout << "小猫那一半先拆：" << name << endl;
    }
};

int main() {
    Kitten k("小橘");
    cout << "---- 中间过日子 ----" << endl;
    return 0;
}
```

```text
猫妈妈那一半先搭好：小橘
小猫那一半再搭好：小橘
---- 中间过日子 ----
小猫那一半先拆：小橘
猫妈妈那一半后拆：小橘
```

顺序是钉死的，**记成一句话就够**：

> **搭的时候从妈妈往上搭，拆的时候从小猫往下拆。** —— 就像盖房子：地基（妈妈那一半）先浇，才有楼上的小猫那一半；拆的时候反过来，楼上的先拆掉，地基最后挖。

- **`Kitten(string n) : Cat(n)`** —— 这一小段 `: Cat(n)` 是给小猫图纸的出生招式挂的「先搭妈妈那一半」的交代：把 `n` 交给妈妈的出生招式。**妈妈那一半搭好了，本喵这一半才开始。**
- **`~Kitten` 先跑、`~Cat` 后跑** —— 所以中间那句「---- 中间过日子 ----」是夹在两头的：本喵在 `main` 里说的那句话，说在两只猫**都活着**的时候。
- ⚠️ **顺序不能靠猜**，尤其是后面的课：要是妈妈那一半的收尾动作（比如上一课的「归还仓库」）没跑到，本喵就漏了一间屋。顺序错了，代码看着全对，东西悄悄漏掉。

::: tip 猫咪提示
今天记住六句话：

1. **`class Kitten : public Cat`** —— 让新图纸照着老图纸画下来，老图纸的格子和招式自动全有。
2. **那一小段 `public` 不能省。** 少了它，老图纸给的公开东西全变成新图纸自己的私事，外面会说「够不着」。
3. **老图纸上挂 `private:` 的格子，新图纸也够不着** —— 只有 `protected:` 才是「妈妈自己 + 照着画的图纸」都够得着。
4. **老图纸的公开招式，新图纸照出来的真猫照样能喊**，因为「小猫本来就是猫」。
5. **搭的时候先妈妈后小猫，拆的时候先小猫后妈妈。** 在出生招式后面挂 `: Cat(n)` 就是把料交给妈妈那一半。
6. **一张图纸改一处，所有照着它画的图纸全跟着变** —— 这是这一手最大的好处，也是本喵前面为什么嫌重画一遍烦。
:::

::: warn 小心喵
- **漏写 `public` 的报错原话是「inaccessible」（够不着）**，而不是「private（私有）」。这两个词长得像、意思差很远：说「私有」是那一格本来就没开；说「够不着」往往是**新图纸把妈妈给的东西收进了自己兜里**。
- **别把老图纸的格子一股脑全改成 `protected:`。** 老图纸扣盖子的用意还在 —— 只用能改成 `protected:` 的那几格。
- **最要紧的一条：老图纸的收尾动作一定要跑到。** 妈妈那一半要是没拆干净，它管着的东西就漏了 —— 这是下一课「虚招式」要正面解决的问题，先记在心里喵。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `class Kitten : public Cat { ... };` | 新图纸照着老图纸画下来，老图纸的东西自动全有 |
| `class Kitten : Cat { ... };` | **漏了 `public`** —— 老图纸给的公开东西全变私事，外面说「够不着」 |
| `private:` 的格子 | 老图纸自己够得着；**照着画的新图纸也够不着** |
| `protected:` 的格子 | 老图纸自己 + 照着画的新图纸都够得着，外面够不着 |
| `void wag() const { ... }` | 新图纸上添的新招式 —— 老图纸没有 |
| `Kitten(string n) : Cat(n) { ... }` | 出生招式后面的交代：先把料交给妈妈那一半，再搭自己这一半 |
| 出生顺序 | **猫妈妈那一半先搭好，小猫那一半再搭好** |
| 收尾顺序 | **小猫那一半先拆，猫妈妈那一半后拆** |
| 「够不着」（inaccessible） | 妈妈给的东西被新图纸收进了自己兜里 —— 十有八九是漏了 `public` |

## 小任务

1. 把第一节整段抄进练习场跑一次；再给 `Cat` 添一格 `int weight;` 和一手 `void weigh()`，**一个字都不动 `Kitten`**，看看照它生出来的小橘会不会这两样。跑通了，你就亲身体会到「改一处、处处跟着变」了。
2. 给 `Kitten` 再添一手 `void meowLouder()`，里面印两遍 `name`。想一想：它为什么不用再写一次格子？
3. 把第二节第一段里 `fish` 前面的 `protected:` **改成 `private:`** 再跑一次，把翻译官喵的原话抄进小本本；再改回去，确认好了。
4. 把第三节那段抄进去跑一次，对着四行输出默一遍「搭：妈妈先、小猫后；拆：小猫先、妈妈后」。然后把 `: Cat(n)` **删掉**再跑一次（`Cat` 这时有默认出生招式吗？没有）—— 把翻译官喵的原话抄下来，你会知道一小段 `: Cat(n)` 有多重要。
5. 想一想：本喵说「小猫本来就是猫，所以能放猫的地方就能放小猫」。那么反过来呢 —— 能放小猫的地方，能不能放一只大猫？想清楚再说，这个问题的答案就是下一课的钥匙喵。

下一课本喵要教真正神奇的一手：**同一句「开饭啦」，橘猫冲过来、狸花猫翻个身** —— 本喵手里只拿着一张「猫」的名单，喊下去，各猫做出各猫的动作。去下一课探险喵～ 🐾
