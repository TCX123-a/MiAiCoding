---
id: cpp-stage2-03
lang: cpp
stage: 2
order: 3
title: 成员函数与 this 指针
tags: [面向对象, this, const]
required: ["cpp-stage2-02"]
crossRefs: []
compare: ["common-10"]
estMinutes: 24
keywords: [this, const, member-function]
---

## 钩子：招式里那句 `name`，说的是谁的名字？

上一课，本喵的图纸上已经有了出生招式、出生清单、收尾招式。可招式**自己肚子里**那几句话，本喵一直没敢细看 —— 比如这一句：

```text
cout << name << " 有 " << fish << " 条" << endl;
```

这里的 `name` 说的是谁的名字？图纸只有一张，招式只有一份，可猫有好几只喵……

答案上一课其实已经埋好了：招式**画在图纸上**，它自己不知道在替哪只猫干活 —— 它是**被哪只猫喊，就替哪只猫干活**。这一课本喵要把这件事彻底弄清楚，还要顺路学两样配套的手艺：

- 招式可以**写在图纸外面**（图纸里只留一行「有这么一招」）；
- 招式里那个「施展它的自己」，有一个专门的名字叫 `this`。

## 一、招式也能写在图纸外面：名字前面挂上图纸名

图纸里画得下招式，可招式一多，图纸就长得没边。所以本喵可以把招式**挪到图纸外面**写 —— 只要在招式名前面挂上「这张图纸上的」这几个字。在 C++ 里，它们写成 `Cat::`：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    int fish;

    Cat(string n, int f) : name(n), fish(f) {}
    void show() const;
};

void Cat::show() const {
    cout << name << " 有 " << fish << " 条" << endl;
}

int main() {
    Cat c1("小橘", 3);
    c1.show();
    return 0;
}
```

```text
小橘 有 3 条
```

看图纸里那一行：`void show() const;` —— **只报名字、不带肚子**，末尾那个分号千万别丢。真正的肚子写在图纸外面：

```text
void Cat::show() const {
    cout << name << " 有 " << fish << " 条" << endl;
}
```

- `Cat::` 念作「**`Cat` 这张图纸上的**」—— 翻译官喵靠这一小段把外面的这一招认回图纸里去。
- 肚子里写的 `name`、`fish` 依旧是**格子**，不用加任何前缀。为什么？这正是下一节要讲的 `this` 在悄悄干活喵。
- 图纸里那行只报名字的写法，是**先打个招呼**：告诉翻译官喵「有这么一招，肚子回头再写」。少了它，外面那一招就成了没人认领的孤儿。

::: warn 小心喵
**漏掉 `Cat::` 是这一课最常摔的一跤。** 本喵试过在图纸外面直接写 `void show() const`（名字前面空着）—— 翻译官喵当场拦下：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    int fish;

    Cat(string n, int f) : name(n), fish(f) {}
    void show() const;
};

void show() const {
    cout << name << " 有 " << fish << " 条" << endl;
}

int main() {
    Cat c1("小橘", 3);
    c1.show();
    return 0;
}
```

```text
main.cpp:14:13: error: non-member function 'void show()' cannot have cv-qualifier
```

念作：**「这不是图纸上的招式，它凭什么叫自己只读？」** 底下还会跟着两句，说 `name`、`fish` 这两个名字「没见过」—— 因为离开了 `Cat::` 这个前缀，翻译官喵根本不知道要进哪张图纸里去找格子。

改法就是补上那一小段：`void Cat::show() const`。看到报错里有 `non-member function`，先检查招式名前面是不是漏了它喵。
:::

## 二、`this`：招式里那个「本喵自己」

上一节的招式里为什么可以直接写 `name`？因为招式里藏着一个**隐形的投喂口** —— 每喊一次招式，翻译官喵都会悄悄把**喊它的那只猫**一起递进来。这个隐形投喂口就叫 `this`：一张写着「本喵自己」的猫爪指向牌（指针）。

平时你写 `name`，翻译官喵会替你补全成 `this->name`（念作「**本喵自己那一格 `name`**」）。可**一旦投喂口和格子同名**，这次自动补全就靠不住了：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    int fish;

    Cat(string n, int f) : name(n), fish(f) {}
    void rename(string name) {
        this->name = name;
    }
    void show() const {
        cout << name << " 有 " << fish << " 条" << endl;
    }
};

int main() {
    Cat c1("小橘", 3);
    c1.rename("大胖");
    c1.show();
    return 0;
}
```

```text
大胖 有 3 条
```

本喵图省事，把投喂口也起名叫 `name`，于是招式肚子里站着**两个 `name`**：一个是投喂口，一个是格子。C++ 的规矩很干脆：**近的那个赢** —— 光写 `name`，指的是投喂口。想碰格子，就得**指名道姓**。

`this->name = name;` 念作「**把投喂口那个 `name`，装进本喵自己那一格 `name` 里去**」。

那要是不写 `this->` 呢？本喵真跑过 ——

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    int fish;

    Cat(string n, int f) : name(n), fish(f) {}
    void rename(string name) {
        name = name;
    }
    void show() const {
        cout << name << " 有 " << fish << " 条" << endl;
    }
};

int main() {
    Cat c1("小橘", 3);
    c1.rename("大胖");
    c1.show();
    return 0;
}
```

```text
小橘 有 3 条
```

**这不是报错，这是「跑得成功、结果全错」。** `main` 里明明喊的是「改名叫大胖」，印出来还是「小橘」。

本喵特意拿最啰嗦的那档念叨（`-Wall`）真跑了一遍：**翻译官喵一个字都没说** —— 没有警告、没有提示，屏幕安安静静。这就是这一类错最要命的地方：**它不吵不闹，只是悄悄把你的活干歪。**

所以记牢这条手感：**投喂口和格子同名时，格子那一侧必须写 `this->`。**

## 三、只读招式：尾巴上那个 `const`

再看一眼那个熟练的招式脑袋：`void show() const` —— 末尾多了一颗 `const`。它是**招式自己的封印**，意思是「**本喵保证只看看，一格都不动**」。

这一颗 `const` 有两个好处。先说能看见的那个：**带封印的猫也能喊它**。

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    int fish;

    Cat(string n, int f) : name(n), fish(f) {}

    void show() const {
        cout << name << " 有 " << fish << " 条" << endl;
    }

    void eat() {
        fish = fish + 1;
        cout << name << " 吃掉了一条" << endl;
    }
};

int main() {
    Cat c1("小橘", 3);
    c1.show();
    c1.eat();
    c1.show();

    const Cat c2("狸花", 1);
    c2.show();
    return 0;
}
```

```text
小橘 有 3 条
小橘 吃掉了一条
小橘 有 4 条
狸花 有 1 条
```

`const Cat c2("狸花", 1);` 生出来的是一只**带封印的猫**：它身上每一格都不许改。这样的猫只能喊**只读招式**（尾巴上有 `const` 的那些）—— `show` 喊得动，`eat` 喊不动，因为 `eat` 要往格子里写东西。

第二个好处是：这颗 `const` 是**给自己上的一道保险**。写招式的时候顺手加上它，等于跟翻译官喵立下「这一招不碰格子」的字据；哪天真手滑在只读招式里改了格子，它当场就把你拦下。

上面那段里，`show` 被两只猫各喊了一次，招式体却只有一份 —— 它凭什么知道该读谁的格子？靠的就是上一节那块 `this` 牌子。本喵把它拆成一步一步，走给你看：

```demo
title: 招式只有一份，它怎么知道在替哪只猫干活
code:
| Cat c1("小橘", 3);
| c1.show();
| c1.eat();
| c1.show();
| const Cat c2("狸花", 1);
| c2.show();

step 生小橘：招式一跑，牌子就指着它
at: 1
say: `Cat c1("小橘", 3);` 落地，出生招式跑起来。**每喊一次招式，翻译官喵都会悄悄把喊它的那只猫一起递进来** —— 这回递进来的是小橘自己，招式里读写的 `name`、`fish` 全是小橘那两格。
meow: 招式还没喊，先递进来一只猫～
pose: expect
走到哪一行了 = 第 1 行 · 生小橘
this 指着谁 = 小橘（c1）
屏幕上 = 还没印

step 喊 show：牌子指着小橘，读的是小橘的格子
at: 2
say: `c1.show();` —— 招式体只有一份，画在图纸上。可它肚子里那句 `name` 会被翻译官喵补全成 `this->name`（**本喵自己那一格**）；牌子这会儿指着小橘，读出来的就是小橘的 `name` 和 `fish`。
meow: 同一段招式，读的是小橘那两格喵
pose: expect
走到哪一行了 = 第 2 行 · c1.show()
this 指着谁 = 小橘（c1）
屏幕上 = 小橘 有 3 条

step 喊 eat：牌子还指着小橘，加的是小橘那一格
at: 3
say: `c1.eat();` 递进去的还是小橘，所以那句 `fish = fish + 1` 加的是**小橘自己那一格**：3 变 4。可见牌子指着的格子是**每只猫各有一份**的，不是大家共用一份。
meow: 加的是小橘自己的鱼干喵！
pose: busy
走到哪一行了 = 第 3 行 · c1.eat()
this 指着谁 = 小橘（c1）
屏幕上 = 小橘 有 3 条 / 小橘 吃掉了一条

step 再喊一次 show：招式一字没改，读出来变了
at: 4
say: 还是那一行 `c1.show()`，招式体一个字都没改，可这回印出来是「小橘 有 **4** 条」—— 变的是**牌子指着的那些格子**，上一行刚被加过 1。同一段代码读到什么，全看牌子指着谁。
meow: 招式没变，是格子变了喵！
pose: yay
走到哪一行了 = 第 4 行 · 又一次 c1.show()
this 指着谁 = 小橘（c1）
屏幕上 = 小橘 有 3 条 / 小橘 吃掉了一条 / 小橘 有 4 条

step 生狸花：第二只猫，带封印
at: 5
say: `const Cat c2("狸花", 1);` —— 第二只猫落地。出生招式**还是同一份**，这回递进去的是狸花：它的 `name` 装「狸花」、`fish` 装 1。两只猫各有各的两格，招式始终只有一份。（开头那个 `const` 让它是只**带封印的猫**，只认只读招式 —— `show` 尾巴上有 `const`，喊得动。）
meow: 第二只猫住进同一份招式里啦～
pose: expect
走到哪一行了 = 第 5 行 · 生狸花
this 指着谁 = 狸花（c2）
屏幕上 = 小橘 有 3 条 / 小橘 吃掉了一条 / 小橘 有 4 条

step 喊 show：牌子换成狸花，同一份招式体印出另一只猫
at: 6
say: `c2.show();` —— 招式体一个字都没动（还是图纸里那一份），可牌子这回指着狸花，读出来的是**狸花那两格**，于是印出「狸花 有 1 条」。同一段代码替两只猫各跑一遍、各说各的话，这就是通往**多态**的那一步。
meow: 同一段代码，两只猫各印各的！
pose: proud
走到哪一行了 = 第 6 行 · c2.show()
this 指着谁 = 狸花（c2）
屏幕上 = 小橘 有 3 条 / 小橘 吃掉了一条 / 小橘 有 4 条 / 狸花 有 1 条
```

**这块牌子只有一块，它随喊随换**：`c1.show()` 时指着小橘、`c2.show()` 时指着狸花，招式体从头到尾只有一份。以后本喵要让同一份招式对不同的猫做出不同的事，靠的就是它喵。

::: warn 小心喵
带封印的猫去喊**没有封印**的招式，翻译官喵会拦：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;

    Cat(string n) : name(n) {}

    void show() {
        cout << name << " 蹲在这儿喵" << endl;
    }
};

int main() {
    const Cat c1("小橘");
    c1.show();
    return 0;
}
```

```text
main.cpp:18:12: error: passing 'const Cat' as 'this' argument discards qualifiers [-fpermissive]
```

念作：**「你递进来的是一只带封印的猫，可这一招说了自己要动格子 —— 封印不能丢，所以这活它接不了。」**（`qualifiers` 说的就是「封印这类挂在类型上的小尾巴」。）

注意报错里那个 `this` —— 它正好是本节的另一位主角：翻译官喵每喊一次招式都要悄悄递进来的那只猫。带封印的猫递不进去一个「随便你改」的自己，于是这一招就接不了这活。

看到 `discards qualifiers`，只有两条路：这一招**本来就只是看看**，就给它尾巴上补一颗 `const`；它**确实要动格子**，那这只猫就不该带封印 —— 把 `const` 从猫身上拿掉。**先想清楚这一招该不该动格子，再动手**，别急着乱补喵。
:::

## 四、本喵今天记住的三句话

::: tip 猫咪提示
1. **招式可以写在图纸外面**：名字前面挂 `Cat::`；图纸里留一行只报名字的「先打个招呼」（末尾的分号别丢）。
2. **`this` 是招式里那个「本喵自己」**：平时可以不写，**投喂口和格子同名时必须写** `this->格子名` —— 不写**不报错**，只是活干歪。
3. **只读招式**：尾巴上那颗 `const` 表示「只看看、不动格子」；**带封印的猫只认只读招式**。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `void show() const;`（图纸里） | 先打个招呼：有这么一招，肚子回头写在图纸外面 |
| `void Cat::show() const { ... }` | 肚子写在图纸外面；`Cat::` 念作「这是 `Cat` 图纸上的」 |
| `this->name = name;` | 把投喂口那份 `name`，装进本喵自己那一格 `name` |
| `name = name;` | 只改了投喂口自己 —— 格子纹丝不动，而且**不报错** |
| `void show() const` | 只读招式：保证只看看、一动也不动格子 |
| `const Cat c2("狸花", 1);` | 一只带封印的猫，只喊得动只读招式 |

## 小任务

1. 把第一节那段抄下来，**把 `show` 的肚子挪回图纸里面**（图纸外面那一行顺手删掉），看看印出来是不是一模一样。同一件事两种写法，你要两种都认得喵。
2. 给图纸添一招 `listen()`：它只印一行「本喵在听」，一个字都不改。给它尾巴加上 `const`，再生一只**带封印的猫**喊它 —— 看看顺不顺。
3. 把第二节那段里的 `this->` 删掉，真跑一次，看看翻译官喵有没有吭声、印出来的名字又是什么。**这两个结果都抄进小本本**：这是本课最值钱的一次实验。
4. 把 `rename` 换一种写法：投喂口改名叫 `newName`，肚子里写 `name = newName;` —— 不用 `this->` 也能跑对。想想为什么这一版就没有同名的问题。
5. 想一想：`eat` 为什么不能写 `const`？（提示：它要往格子里写东西。）要是硬给它加上 `const`，翻译官喵会在**哪一句**上拦你？

下一课，本喵要给格子**盖上盖子**：哪些格子能让人随便碰、哪些只能隔着招式碰，以及为什么「盖上盖子」才是图纸真正的本事。去下一课探险喵～ 🐾
