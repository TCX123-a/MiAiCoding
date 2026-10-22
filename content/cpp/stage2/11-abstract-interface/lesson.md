---
id: cpp-stage2-11
lang: cpp
stage: 2
order: 11
title: 抽象类与接口
tags: [面向对象, 抽象类, 纯虚函数]
required: ["cpp-stage2-10"]
crossRefs: []
estMinutes: 26
keywords: [pure virtual, abstract class, interface, override]
---

## 钩子：有一手，本喵写不出动作

上一课本喵用一份「猫」的名单，让各猫喊出各猫的声音。可那份名单上写的名字，是**猫**。

这一课本喵想把名单的名字改大一点，写成**动物**。名单上要站橘猫、狸花猫，还要站本喵的好朋友大肥鱼 —— 那条圆滚滚的蓝色大鱼。

本喵提起笔，在老图纸上写 `speak` 这一手 —— 然后笔停住了。

**「动物怎么叫？」这一问，本喵答不出来。** 橘猫是「喵～」，大肥鱼是吐泡泡，狸花猫翻个身。老图纸上这一手，**根本不存在一个对大家都对的动作**。

可这三张图纸有一件事是**说死了的**：它们都**会叫**。至于怎么叫，各自说了算。

于是本喵在老的图纸上，把这一手写成了这样：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Animal {
protected:
    string name;
public:
    Animal(string n) : name(n) {}
    virtual void speak() const = 0;
    void showName() const {
        cout << "本喵叫 " << name << endl;
    }
};

class Cat : public Animal {
public:
    Cat(string n) : Animal(n) {}
    void speak() const override {
        cout << name << "：喵～" << endl;
    }
};

int main() {
    Cat c("小橘");
    c.showName();
    c.speak();
    return 0;
}
```

```text
本喵叫 小橘
小橘：喵～
```

关键就在那一行多出来的 `= 0`：

```cpp
virtual void speak() const = 0;
```

本喵管它叫**只挂招牌、不写动作的那一手**。它的正式名字是 纯虚函数（不写动作的那一手）：`= 0` 的意思是「**这一手本喵只立个招牌，动作留给照它画下来的每一张图纸自己去写**」。

- 招牌上写着「会叫」—— 这就是**约定**。
- 至于叫成什么样，老图纸**一个字都不管**。
- 用本喵的话说：这一手是**一张空着动作的招牌**，谁照这张图纸画下来，谁就得把这块空补上。

## 一、有这种招牌的图纸，生不出真身

本喵试过一个最自然的问题：既然 `Animal` 是张图纸，那本喵**直接照它生一只动物**行不行？

```cpp
#include <iostream>
#include <string>
using namespace std;

class Animal {
protected:
    string name;
public:
    Animal(string n) : name(n) {}
    virtual void speak() const = 0;
};

int main() {
    Animal a("谁");
    a.speak();
    return 0;
}
```

```text
main.cpp: In function 'int main()':
main.cpp:14:12: error: cannot declare variable 'a' to be of abstract type 'Animal'
```

翻译官喵的原话是 `error: cannot declare variable 'a' to be of abstract type 'Animal'` —— 念作：「**`a` 这一格要的是一只真动物，可 `Animal` 是张抽象图纸，照不出真身喵。**」

翻译官喵说得对：**`Animal` 上那一手只有招牌、没有动作**。要是真让它生出一只来，本喵喊 `a.speak()` 的时候，它该叫成什么样？**没有答案。** 所以这种图纸**干脆不许被直接照出来**。

本喵把这种**身上挂着「只挂招牌」那一手的图纸**叫做 抽象类（抽象图纸）。

::: warn 小心喵
`abstract` 这个词本喵不翻译成「难」，它说的是「**抽出来的**」—— 从橘猫、狸花猫、大肥鱼身上**抽出来**的那个共同点，只有「会叫」两个字。

所以抽象图纸不是「画坏了的图纸」，恰恰相反：它是**把共同点立成招牌**的那张图纸。它不许被直接照出来，不是缺陷，是**它的全部意义**。
:::

## 二、小猫必须把招牌上的活干完，才能出生

那照抽象图纸画下来的小猫呢？本喵试过**漏掉一手**：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Animal {
protected:
    string name;
public:
    Animal(string n) : name(n) {}
    virtual void speak() const = 0;
};

class Cat : public Animal {
public:
    Cat(string n) : Animal(n) {}
};

int main() {
    Cat c("小橘");
    c.speak();
    return 0;
}
```

```text
main.cpp: In function 'int main()':
main.cpp:19:9: error: cannot declare variable 'c' to be of abstract type 'Cat'
main.cpp:13:7: note: because the following virtual functions are pure within 'Cat':
```

注意看第二行那个 `note` —— 它说「**因为 `Cat` 里下面这些招牌还是空的**」，然后就把本喵漏的那一手名字念了出来。

**这就是约定最值钱的地方。** 本喵不用记得「我还欠着一手没写」—— **翻译官喵替本喵记着**。只要漏了，它当场拦下，绝不放过。

反过来看：要是老图纸上那一手**当时忘了写 `= 0`**（写成 `virtual void speak() const { ... }`，给了一个动作），那么小猫漏写就**谁也不会提醒**，程序照样跑起来，只是叫出来的不是小猫自己的声音。这条本喵在后面「常见摔法」里写清楚了。

本喵把两种捏法摆在一起走一遍 —— 一种会被当场拦下，另一种能捏出来：

```demo
title: 空招牌没补全，谁也别想捏出真身
code:
| class Animal { virtual void speak() const = 0; };                  // 抽象图纸：这一手只有招牌
| class Cat : public Animal { void speak() const override { ... } }; // 小猫图纸：把那一手补全了
| Animal a("谁");                                                     // 先试这一句：直接照抽象图纸捏
| Cat c("小橘");                                                      // 再试这一句：照补齐了的小猫图纸捏

step 老图纸上那一手：只有招牌
at: 1
say: `virtual void speak() const = 0;` 那个 `= 0` 的意思是「**这一手本喵只立个招牌，动作留给照它画下来的每一张图纸自己去写**」。身上挂着这样一手的图纸，就是抽象图纸。
meow: 只立招牌不写动作，空着喵～
pose: expect
这一步捏的是 = （还没捏）
图纸上 speak 那一手 = 老图纸上只有招牌（`= 0`）
翻译官喵 = （还没轮到）

step 小猫图纸把那一手补全了
at: 2
say: 小猫图纸照着 `Animal` 画下来，并且**把那一手补全**：`speak` 写上了自己的动作。补全了，它身上就没有空招牌了 —— 这一点下一步就要用到。
meow: 空招牌补齐，小猫才成形喵～
pose: busy
这一步捏的是 = （还没捏）
图纸上 speak 那一手 = 小猫补全了，老图纸上仍是招牌
翻译官喵 = （还没轮到）

step 先试最自然的那一问：直接照抽象图纸捏
at: 3
say: `Animal a("谁");` 本喵想直接照抽象图纸生一只。这一步**跑不到** —— 翻译官喵在捏之前就把它拦下了，屏幕上只有一句原话：`error: cannot declare variable 'a' to be of abstract type 'Animal'`。
meow: 想直接照它捏？被拦住了喵！
pose: think
这一步捏的是 = 直接照抽象图纸捏
图纸上 speak 那一手 = 老图纸上只有招牌
翻译官喵 = 拦下了

step 为什么拦：那一手没有动作
at: 3
say: 它的理由本喵替它说一遍：**那一手只有招牌**。真让它生出东西来，本喵喊 `a.speak()` 的时候，它该叫成什么样？**没有答案** —— 所以这种图纸干脆不许被直接照出来。它照样能被指着、被排成一排、当塞料收，**就是不能被直接照出来**。
meow: 没动作可跑，干脆不许照它捏喵～
pose: remind
这一步捏的是 = 直接照抽象图纸捏（没捏成）
图纸上 speak 那一手 = 招牌底下还是一点动作都没有
翻译官喵 = 拦下：'a' to be of abstract type 'Animal'

step 换成照补齐了的小猫图纸捏
at: 4
say: `Cat c("小橘");` 小猫图纸**不是**抽象图纸（那一手补全了），所以这一句放行 —— 小橘这只猫就站在这里了，喊它的 `speak` 有答案可跑。
meow: 补全的图纸一捏就成，小橘到喵！
pose: yay
这一步捏的是 = 照补齐了的小猫图纸捏
图纸上 speak 那一手 = 小猫把那一手补全了
翻译官喵 = 放行：捏出来了
```

记住这两半就够了：**图纸上有一手只有招牌（`= 0`），它自己就捏不出来**；照它画下来的图纸，**把那些空招牌一手机一手补全，才捏得出来**。所以抽象图纸的用处从来不是「照它捏」，而是**当一份大家都得会的约定**。

## 三、抽象图纸上，别的都可以是正常的

本喵要特别说清楚一件事：**不是整张图纸都变成「空招牌」了**。

回头看第一段那段代码：`Animal` 上除了那一手空招牌，还有

- **一栏 `name`** —— 一个正常的、有名字的小鱼干仓库；
- **一个正常的出生招式** —— 照它的图纸都能用；
- **一手 `showName`** —— 一个动作写全了的正常招式。

这三样都是**实打实的**，谁照 `Animal` 画下来就白得一份，一个字都不用重写。

::: tip 猫咪提示
判断一张图纸是不是抽象图纸，只看一件事：**它身上有没有挂着「`= 0`」的那一手**。

- 有 → 它不能被直接照出来，只能被指着用；照它画下来的图纸**必须**把那几手全补上。
- 没有 → 它还是普通图纸，想生就生。

一张图纸上有几手空招牌都行，**只要有一手，它就是抽象图纸**。
:::

## 四、与猫的约定

现在说这一课名字里的另一半。

有时候本喵想要的不是「一张能长出小猫的图纸」，而是**一份约定**：本喵不关心你身上有几栏小鱼干仓库、不关心你妈妈是谁，**本喵只关心你会不会这几手**。

于是本喵画一张**干干净净的图纸**：没有一栏数据，没有出生招式，**只有几手空招牌**：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Speaker {
public:
    virtual void speak() const = 0;
    virtual ~Speaker() {}
};

class Cat : public Speaker {
    string name;
public:
    Cat(string n) : name(n) {}
    void speak() const override {
        cout << name << "：喵～" << endl;
    }
};

class Fish : public Speaker {
    string name;
public:
    Fish(string n) : name(n) {}
    void speak() const override {
        cout << name << "：咕噜咕噜～" << endl;
    }
};

int main() {
    Cat c("小橘");
    Fish f("大肥鱼");
    Speaker* roster[2] = { &c, &f };
    for (int i = 0; i < 2; i++) {
        roster[i]->speak();
    }
    return 0;
}
```

```text
小橘：喵～
大肥鱼：咕噜咕噜～
```

这张干干净净的图纸，叫 接口（与猫的约定）。它说的是：

> **说好会这几手的猫，都得能用这几手。**

看 `main` 里那三行 —— 那正是本喵要的东西：

- 本喵手上只有一排写着 `Speaker` 的牌子（`Speaker* roster[2]`），**牌子上写的是「会叫的」，不是「猫」也不是「鱼」**。
- 本喵挨个喊同一句 `roster[i]->speak()`，橘猫喵、大鱼吐泡泡 —— **各猫各样**。
- 橘猫和大肥鱼**没有半点血缘关系**，可它们都能站进这排牌子里，因为**它们都按约定把那几手补上了**。

**约定和「抽象图纸」的分别，本喵用一句话钉住：**

| | 抽象图纸（抽象类） | 与猫的约定（接口） |
|---|---|---|
| 身上有什么 | 约定那一手 **+ 正常的数据和招式** | **只有**约定那几手，别的什么都没有 |
| 照它画下来能得到什么 | 白得妈妈那一份数据和招式 | 什么都白得不着，**只有一份要还的约定** |
| 关心的是什么 | 「你是谁家的孩子」 | 「**你会不会这几手**」 |
| 典型场合 | 橘猫、狸花猫、黑猫 —— 都是猫 | 会叫的、会跳的、会数鱼的 —— 互不相干 |

::: warn 小心喵
两个最容易摔的地方，本喵都真跑过：

- **约定那张图纸上，收尾招式也要挂 `virtual`**（上面写的 `virtual ~Speaker() {}`）。上一课的规矩在这儿照样管用：老图纸有挂了招牌的招式，收尾就该挂招牌。本喵真跑过这一对：**漏挂**的时候顺着牌子 `delete` 那只猫，屏幕上除了喊话那句 `小橘：喵～`，只剩 `老图纸那半被拆了` —— 小猫自己那半**一声不响地没被拆**（翻译官喵只在 `delete` 那一行嘀咕一句 `warning: deleting object of abstract class type 'Speaker' which has non-virtual destructor will cause undefined behavior [-Wdelete-non-virtual-dtor]`，光看屏幕上印出来的东西发现不了）；把 `virtual` 挂上，屏幕上才是 `小猫那半也被拆了` 排在 `老图纸那半被拆了` 前面，而且连那句嘀咕都没有。
- **约定图纸上不许有数据**。有了一层需要填的初始化的东西，照它画下来的每一张图纸都得先想办法把它填上 —— 那就不再是「只会几手就行」的约定了。
:::

## 五、抽象图纸能做的三件事

本喵把抽象图纸能做的事收成三条，往后天天用：

1. **可以被「指着」**：`Speaker* p = &c;`、`Speaker& r = c;` —— 本喵手上是牌子，屋里住的是真猫。
2. **可以被「排成一排」**：`Speaker* roster[2] = { &c, &f };` —— **这就是上一课那份名单**，只是名字从「猫」换成了「会叫的」。
3. **可以当塞料收**：招式收一只 `const Speaker& s`，凡是按约定画下来的都能喂进去。

它**唯一不能做**的事，就是**被直接照出来**。

| 本喵写下的 | 它的意思 |
|---|---|
| `virtual void speak() const = 0;` | 只挂招牌、不写动作的那一手 —— 动作留给照它画下来的图纸 |
| `error: cannot declare variable 'a' to be of abstract type 'Animal'` | 本喵想直接照抽象图纸生一只 —— 翻译官喵拦下了 |
| `error: cannot declare variable 'c' to be of abstract type 'Cat'` | 小猫漏了招牌上的活 —— 翻译官喵替本喵记着 |
| `Animal& r = c;` | 抽象图纸只能被「指着」，不能被「照出来」 |
| `Speaker* roster[2] = { &c, &f };` | 一排写着「会这几手的」牌子 —— 橘猫和大肥鱼站在一起 |
| `virtual ~Speaker() {}` | 约定图纸上的收尾招式也挂招牌 |

## 小任务

1. 把第一节那段抄进练习场跑一次。然后把老图纸上那一行改成**没有 `= 0` 的空动作** `virtual void speak() const { }`，再跑一次 —— `Cat` 里那一手还在，所以两行输出一模一样。**这说明一件要紧的事：`= 0` 管的不是「小猫能不能改」，而是「小猫能不能不改」。**
2. 把第二节那段抄进去，确认翻译官喵真的报 `to be of abstract type 'Cat'`；再把 `Cat` 里漏掉的那一手补上，看它是不是就好了。
3. 给第四节再添一只 `Dog`（狗），照 `Speaker` 画下来、补上 `speak`，然后**只改 `main` 里那排牌子**（`Speaker* roster[3]`），让三只一起出声。体会一下：狗和猫和大肥鱼**互不相干**，可它们都能站进同一排牌子。
4. 想一想：本喵在第四节说「本喵只关心你会不会这几手」。那要是本喵哪天想把**会叫的**和**会跳的**合成一份约定，让一只猫同时答应两件事 —— 该怎么办？先记在心里喵。

下一课本喵要教一张**会量体裁衣的图纸**：同一张图纸，塞进去整数就裁成整数版，塞进去小数就裁成小数版，塞进去一串小鱼干就裁成一串小鱼干 —— 本喵一张图纸都不用重画。去下一课探险喵～ 🐾
