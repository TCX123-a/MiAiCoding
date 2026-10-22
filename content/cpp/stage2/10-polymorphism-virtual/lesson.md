---
id: cpp-stage2-10
lang: cpp
stage: 2
order: 10
title: 多态与虚函数
tags: [面向对象, 多态]
required: ["cpp-stage2-09"]
crossRefs: []
estMinutes: 28
keywords: [virtual, override, destructor, polymorphism]
---

## 钩子：一声开饭啦，各猫各样

上一课本喵讲过一句要紧的话：**小橘是小猫，同时也就是一只猫。** 所以凡是「能放一只猫」的地方，放一只小猫同样成立。

现在本喵想把这句话用起来。本喵手里拿着**一张写着「猫」的名单**，挨个喊一声「开饭啦」—— 本喵指望的是：橘猫冲过来、狸花猫翻个身，**各猫做出各猫的动作**。

同一句话喊下去，各猫各样。这一手在猫咪世界里叫**一声开饭，各猫各样（多态）**。

可本喵第一次试的时候，它没这么干。往下看喵。

## 一、用「猫」的名字，喊出来的却是「猫」的动作

图纸是这样的：老图纸 `Cat` 有 `speak` 这一手，小猫图纸 `OrangeCat` 把这一手**改成了自己的版本**：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(string n) : name(n) {}
    void speak() const {
        cout << name << "：喵～" << endl;
    }
};

class OrangeCat : public Cat {
public:
    OrangeCat(string n) : Cat(n) {}
    void speak() const {
        cout << name << "：本喵是橘猫，喵喵喵！" << endl;
    }
};

int main() {
    OrangeCat o("小橘");
    Cat& r = o;
    r.speak();
    o.speak();
    return 0;
}
```

```text
小橘：喵～
小橘：本喵是橘猫，喵喵喵！
```

**注意第一行。** 本喵手里那张牌子上写的是「猫」（`Cat& r`），它指向的明明是橘猫小橘，可喊出来的却是**老图纸那个平平无奇的「喵～」**。

而第二行 `o.speak()` 用的是「橘猫」的名字，喊出来的就是橘猫那一版。**同一个动作，两个名字喊出两种结果** —— 这正是本喵想解决的问题。

为什么会这样？因为**翻译官喵在翻译的时候就把话说死了**：它看见牌子上写的是「猫」，就直接指到老图纸的 `speak` 上去了，根本没打算运行时再看一眼手里到底是哪只猫。**名字定终身，这就是「翻译阶段就定死」的脾气。**

本喵把这一段拆成一步一步走一遍 —— 每一步都盯着两样东西：**牌子上写的是什么**、**它实际指着谁**：

```demo
title: 牌子写「猫」，喊出来的就是「猫」那一版
code:
| class Cat { void speak() const { ... } };            // 老图纸那一手：没挂 virtual
| class OrangeCat : public Cat { ... };                // 橘猫图纸：把 speak 改成自己那一版
| OrangeCat o("小橘");                                  // 生一只橘猫
| Cat& r = o;                                           // 拿一张写着「猫」的牌子
| r.speak();                                            // 顺着牌子喊一声
| o.speak();                                            // 直接喊这只猫本人

step 老图纸那一手没挂 virtual
at: 1
say: 老图纸上这一手写着 `void speak() const`，印的是「名字：喵～」。**注意它开头没有 `virtual` 那三个字母** —— 差的正是那三个字母，下一节就补。
meow: 老图纸这一手，光秃秃的没挂牌喵～
pose: expect
牌子上写的是什么 = （还没这张牌子）
它实际指着谁 = （还没这只猫）
最后挑了谁的 = （还没喊）

step 生一只橘猫
at: 3
say: `OrangeCat o("小橘");` 照橘猫图纸生一只。它身上有妈妈那一份，也有自己改写的那一版 `speak` —— 这本来该是本喵想听到的声音。
meow: 橘猫生出来了，一肚子本事喵！
pose: busy
牌子上写的是什么 = （还没这张牌子）
它实际指着谁 = 小橘（橘猫）
最后挑了谁的 = （还没喊）

step 拿一张写着「猫」的牌子
at: 4
say: `Cat& r = o;` 牌子上写的是**妈妈的名字「猫」**，屋里住的却是橘猫。牌子只记录门牌号，不记屋里住的是谁 —— 这两件事从这一刻起就分家了。
meow: 牌子写「猫」，屋里住着橘猫喵～
pose: think
牌子上写的是什么 = 猫（妈妈那一版的名字）
它实际指着谁 = 小橘（橘猫）
最后挑了谁的 = （还没喊）

step 顺着牌子喊一声
at: 5
say: **关键的一步来了。** `r.speak()` 顺着牌子喊。翻译官喵在翻译阶段就把话说死了：它只看见牌子写的是「猫」，直接指到老图纸那一手上 —— 跑出来是平平无奇的「小橘：喵～」，**不是**橘猫改写的那一版。注意「它实际指着谁」这一栏写着小橘，可这**不影响结果**：挑版本看的是牌子，不看指着谁。
meow: 明明指着橘猫，出声的却是猫喵……
pose: think
牌子上写的是什么 = 猫（妈妈那一版的名字）
它实际指着谁 = 小橘（橘猫）
最后挑了谁的 = 老图纸那一手（牌子说了算）

step 不走牌子，直接喊它本人
at: 6
say: `o.speak()` 喊的是这只猫本人，不经过牌子 —— 这一回跑的是橘猫改写的那一版。同一个动作，两个名字喊出两种结果：差别不在猫身上，在**喊的时候看的是「名字」还是「本人」**。
meow: 直接喊它本人，就是橘猫那一版喵！
pose: proud
牌子上写的是什么 = 猫（妈妈那一版的名字）
它实际指着谁 = 小橘（橘猫）
最后挑了谁的 = 橘猫改写的那一版（直接喊的）
```

**这一步的教训钉在这儿**：本喵当初以为「指着橘猫就该出橘猫那一版」—— 错在哪儿？错在**翻译官喵只看了牌子上的字，没看它指着谁**。下一节那三个字母，治的就是这件事。

## 二、给老图纸那一手挂上 `virtual`

解法只有三个字母：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(string n) : name(n) {}
    virtual void speak() const {
        cout << name << "：喵～" << endl;
    }
};

class OrangeCat : public Cat {
public:
    OrangeCat(string n) : Cat(n) {}
    void speak() const override {
        cout << name << "：本喵是橘猫，喵喵喵！" << endl;
    }
};

int main() {
    OrangeCat o("小橘");
    Cat& r = o;
    r.speak();
    o.speak();
    return 0;
}
```

```text
小橘：本喵是橘猫，喵喵喵！
小橘：本喵是橘猫，喵喵喵！
```

两行**都变成橘猫那一版**了 —— 因为 `r` 手上那只，本来就是橘猫。

- **`virtual` 挂在老图纸那一手的开头**：`virtual void speak() const`。它说的是「**这一手别急着定死，等真跑起来再看手里到底是哪只猫**」。
- 用本喵的话说：挂了 `virtual` 的一手，是**一张会看屋里住的是谁的招牌** —— 招牌上写着「开饭啦」，谁走到招牌底下，就按谁的习惯来。
- **只有老图纸那一手挂 `virtual` 就够**。小猫图纸把它改写一遍，改写出来的那份**自动也是「会看屋里住的是谁」的**，不用再挂。
- **挂 `virtual` 的三条小规矩**（本喵见过太多猫栽在这里）：
  - 招式名、塞料、`const` 要和老图纸**一模一样**，差一个字就不是「改写」，而是「另外长了一手新的」。
  - 老图纸那一手不能是 `private`（小猫图纸得看得见它才能改写）。
  - 只有**顺着牌子或者不必还的名字**喊，才会「回头看一眼屋里住的是谁」。手里拿着一只**实打实的真猫**（像 `o.speak()`），那本来就是它自己那一版，跟 `virtual` 没关系。

## 三、`override`：让翻译官喵替你盯着

上面那条「差一个字就不是改写」，是靠本喵的眼睛盯的 —— 可本喵会打错字。这一手有个专门的护身符：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(string n) : name(n) {}
    virtual void speak() const {
        cout << name << "：喵～" << endl;
    }
};

class OrangeCat : public Cat {
public:
    OrangeCat(string n) : Cat(n) {}
    void speek() const override {
        cout << name << "：本喵是橘猫，喵喵喵！" << endl;
    }
};

int main() {
    OrangeCat o("小橘");
    o.speak();
    return 0;
}
```

```text
main.cpp:18:10: error: 'void OrangeCat::speek() const' marked 'override', but does not override
```

念作：「**你给这一手挂了「我要改写妈妈那一手」的牌子，可妈妈图纸上根本没有一手能让你改写喵。**」

注意看本喵把 `speak` 打成了 `speek` —— 少了个 `a`。**没有 `override` 的话，翻译官喵会一声不响地放行**，然后在某一天，本喵对着满屋子猫喊了半天，一只都没动，还找不出原因。有了 `override`，它当场就把这一跤拦下来了。

**所以本喵的规矩是：凡是打算改写妈妈那一手的，一律挂上 `override`。** 六个字母，换一辈子不摔。

## 四、一声开饭，各猫各样

现在把本喵真正想要的效果跑一遍 —— 手里只拿一份「猫」的名单：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(string n) : name(n) {}
    virtual void speak() const {
        cout << name << "：喵～" << endl;
    }
};

class OrangeCat : public Cat {
public:
    OrangeCat(string n) : Cat(n) {}
    void speak() const override {
        cout << name << "：本喵是橘猫，喵喵喵！" << endl;
    }
};

class TabbyCat : public Cat {
public:
    TabbyCat(string n) : Cat(n) {}
    void speak() const override {
        cout << name << "：本喵是狸花猫，喵呜～" << endl;
    }
};

int main() {
    OrangeCat o("小橘");
    TabbyCat t("狸花");
    Cat* cats[2] = { &o, &t };
    for (int i = 0; i < 2; i++) {
        cats[i]->speak();
    }
    return 0;
}
```

```text
小橘：本喵是橘猫，喵喵喵！
狸花：本喵是狸花猫，喵呜～
```

**这就是本喵要的东西。** 本喵手上只有一份「猫」的名单（`Cat* cats[2]`），本喵挨个喊同一句 `cats[i]->speak()` —— 各猫做出了各猫的动作。

- **`Cat* cats[2] = { &o, &t };`** 是一排猫爪指向牌，每一张上面写的是「猫」，指的却分别是橘猫和狸花猫。本喵第一阶段讲过：牌子只记录门牌号，不记录屋里住的是谁。
- **`cats[i]->speak()`** 是一直顺着牌子喊 —— 喊下去的那一刻，程序才低头看一眼「这家住的到底是哪位」，再决定跑哪一版。**这就是「等真跑起来再看」的意思。**
- **那一整排牌子，本喵一份都没写错**：不管是橘猫还是狸花猫，都是照着 `Cat` 画下来的，所以都能站进「猫」的位置。**上一课那句「小猫本来就是猫」就是这里的钥匙。**

**往后写程序时这一手就是「加一种猫，不用改名单」**：本喵哪天再画一张 `BlackCat`，只要它照 `Cat` 画下来、把 `speak` 改写好，就能直接塞进这排牌子里，`main` 里一个字都不用动喵。

这一回牌子还是写着「猫」，为什么就挑对了？本喵把「挑版本」那一拍拆开走一遍：

```demo
title: 同一句喊声，低头看一眼屋里住的是谁
code:
| class Cat { virtual void speak() const { ... } };    // 老图纸那一手挂上了 virtual
| class OrangeCat : public Cat { ... };                // 橘猫：改写成自己那一版
| class TabbyCat : public Cat { ... };                 // 狸花猫：也改写
| OrangeCat o("小橘");                                  // 一只橘猫
| TabbyCat t("狸花");                                   // 一只狸花猫
| Cat* cats[2] = { &o, &t };                            // 一排写着「猫」的牌子
| for (int i = 0; i < 2; i++) {                         // 挨个喊
|     cats[i]->speak();                                 // 顺着这张牌子喊一声
| }

step 老图纸那一手挂上了 virtual
at: 1
say: 和上一段比，图纸只多了一个词：`virtual void speak() const`。它说的是「**这一手别急着定死，等真跑起来再看手里到底是哪只猫**」。小猫图纸改写的那一份**自动跟着**，不用再挂。
meow: 三个字母一挂，这手就不急着定死喵～
pose: expect
牌子上写的是什么 = （还没这排牌子）
它实际指着谁 = （还没喊）
最后挑了谁的 = （还没喊）

step 排一排写着「猫」的牌子
at: 6
say: `Cat* cats[2] = { &o, &t };` 两张牌子上写的**都是「猫」**，指的却分别是橘猫和狸花猫。这一排牌子里，本喵一份都没写错 —— 两只猫都是照 `Cat` 画下来的。
meow: 两张牌子都写「猫」，指的各不同喵～
pose: busy
牌子上写的是什么 = 猫（两张都是）
它实际指着谁 = 小橘、狸花（还没喊）
最后挑了谁的 = （还没喊）

step 第 1 圈：喊下去，才低头看
at: 8
say: `cats[i]->speak();` 顺着第 0 张牌子喊。挂了 `virtual` 的这一手**不在翻译阶段定死了** —— 程序喊下去的那一刻才低头看一眼「这家住的到底是哪位」，看出是小橘，跑橘猫那一版。
meow: 喊下去才低头看，住的是小橘喵！
pose: yay
牌子上写的是什么 = 猫（两张都是）
它实际指着谁 = 小橘（第 0 张牌子指着它）
最后挑了谁的 = 橘猫那一版

step 第 2 圈：换一张牌子，再低头看
at: 8
say: 第 2 圈 `i` 是 1，换第 1 张牌子喊 —— 同一个动作、同一句代码，这一回低头看出的是狸花，跑狸花那一版。**各猫各样，靠的就是每喊一次都低头看一眼。**
meow: 同一句喊声，狸花翻了个身喵～
pose: yay
牌子上写的是什么 = 猫（两张都是）
它实际指着谁 = 狸花（第 1 张牌子指着它）
最后挑了谁的 = 狸花猫那一版

step 两圈跑完，收工
at: 7
say: 第 3 次绕回 `for` 这一行，`i` 已经是 2，眼色不成立，圈停了。回头数一遍：**牌子上从头到尾都写着「猫」，一次都没变过**；变的只是程序低头看出来的那只。
meow: 牌子没变过，低头看的变了喵～
pose: proud
牌子上写的是什么 = 猫（两张都是，一直没变）
它实际指着谁 = 小橘、狸花（两只都喊完了）
最后挑了谁的 = 各猫各样（橘猫一版、狸花一版）
```

**牌子上写的是「猫」，从第一张到最后一张都没动过** —— 变的只是程序低头看出来的那只。这就是「等真跑起来再看」的意思；下一节本喵要讲它另一个要紧的用处：**拆屋子的时候，也得靠它**。

## 五、虚析构：拆屋子的时候别只拆一半

本喵在上一课留了一个尾巴：**老图纸的收尾动作一定要跑到。** 现在它找上门了。

看一段「只拆一半」的真事：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(string n) : name(n) {
        cout << "搭猫妈妈那一半：" << name << endl;
    }
    ~Cat() {
        cout << "拆猫妈妈那一半：" << name << endl;
    }
};

class Kitten : public Cat {
public:
    Kitten(string n) : Cat(n) {
        cout << "搭小猫那一半：" << name << endl;
    }
    ~Kitten() {
        cout << "拆小猫那一半：" << name << endl;
    }
};

int main() {
    Cat* p = new Kitten("小橘");
    delete p;
    return 0;
}
```

```text
搭猫妈妈那一半：小橘
搭小猫那一半：小橘
拆猫妈妈那一半：小橘
```

**数一数：搭的时候是两半，拆的时候只剩一半。** 「拆小猫那一半」这一行**根本没出现** —— 小猫那一半里的东西就这么留在原地了。

原因和第一节一模一样：本喵手上那张牌子上写的是「猫」，翻译官喵在翻译的时候就把「拆」指到老图纸那一半上去了，**它压根没打算看一眼屋里住的是不是一只小猫**。

**解法也是同一个：给老图纸的收尾招式也挂上 `virtual`。**

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(string n) : name(n) {
        cout << "搭猫妈妈那一半：" << name << endl;
    }
    virtual ~Cat() {
        cout << "拆猫妈妈那一半：" << name << endl;
    }
};

class Kitten : public Cat {
public:
    Kitten(string n) : Cat(n) {
        cout << "搭小猫那一半：" << name << endl;
    }
    ~Kitten() {
        cout << "拆小猫那一半：" << name << endl;
    }
};

int main() {
    Cat* p = new Kitten("小橘");
    delete p;
    return 0;
}
```

```text
搭猫妈妈那一半：小橘
搭小猫那一半：小橘
拆小猫那一半：小橘
拆猫妈妈那一半：小橘
```

四行全齐了：**先搭妈妈、再搭小猫；拆的时候小猫先走、妈妈后走**（上一课那句话，一个字没变）。

- **`virtual ~Cat()`** 的写法就是这一手：在老图纸的收尾招式前面挂上 `virtual`。它一挂上，顺着牌子喊「拆」的时候，程序就会先低头看一眼屋里住的是谁，**从小猫那一半一直拆到妈妈那一半**。
- **规矩：只要老图纸上有一手挂了 `virtual`，它的收尾招式就也该挂上 `virtual`。** 不然就是本喵这一段 —— 搭的时候搭两半、拆的时候只拆一半，东西悄悄留在那儿。
- 这一条在「继承」那一课尤其要命：小猫那一半里很可能装着**第 08 课学的「现要现租的仓库」**。收尾没跑到，那间屋就再也没人还了。

::: tip 猫咪提示
今天记住六句话：

1. **不挂 `virtual` 的时候，翻译官喵在翻译阶段就把话说死了** —— 牌子上写的是「猫」，就跑猫那一版，它不看屋里到底住的是谁。
2. **`virtual` 挂在老图纸那一手的开头**，小猫图纸改写的那一份自动跟着「看屋里住的是谁」，不用再挂。
3. **改写的时候名字、塞料、`const` 要一字不差**，差一个字就变成「另外长了一手新的」，而不是改写。
4. **打算改写的都挂上 `override`** —— 打错字的时候翻译官喵当场拦住你。
5. **只有顺着牌子（`cats[i]->`）或者不必还的名字（`Cat& r`）喊，才会回头看一眼屋里住的是谁**；手里拿着一只实打实的真猫，那本来就是它自己那一版。
6. **老图纸有 `virtual` 的招式，收尾招式也要挂 `virtual`** —— 不然「拆」只拆一半，小猫那一半的东西全漏掉。
:::

::: warn 小心喵
- **别把 `virtual` 挂在小猫图纸那一手上去「补」**。老图纸没挂，小猫挂了，顺着牌子喊还是跑老图纸那一版 —— 你补的地方根本轮不到上场。
- **收尾招式漏挂 `virtual` 不会报错、不会崩、输出也「看起来挺正常」** —— 它只是**少印了一行、少还了一间屋**。这种错只能靠「数输出行数」发现，本喵第一次就是这么栽的。
- **别给每张图纸的每一手都挂 `virtual`。** 它是要花一点代价的。本喵的规矩：**这一手是要被改写的**才挂；不确定的时候问自己一句 —— 我会不会拿「猫」的名单喊它？
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `virtual void speak() const { ... }` | 老图纸那一手挂上「别急着定死」的招牌 —— 真跑起来再看手里是哪只猫 |
| `void speak() const override { ... }` | 小猫图纸改写那一手，并请翻译官喵替本喵盯着有没有写错名字 |
| `marked 'override', but does not override` | 名字打错（比如 `speek`）—— 你想改写的那一手妈妈图纸上没有 |
| `Cat& r = o;` | 不必还的名字，上面写的是「猫」，屋里住的可能是小猫 |
| `Cat* cats[2] = { &o, &t };` | 一排牌子，每一张都写着「猫」，指着不同的猫 |
| `cats[i]->speak();` | 顺着牌子喊 —— 喊下去才看屋里住的是谁，各猫各样 |
| `virtual ~Cat() { ... }` | 收尾招式也挂上招牌：拆的时候**从小猫那一半一路拆到妈妈那一半** |
| 只拆一半的那一段输出 | 三行而不是四行 —— 小猫那一半的东西留在原地了，而且**一个错都不报** |

## 小任务

1. 把第一节那段抄进练习场跑一次，对着两行输出确认「牌子写猫、喊出猫」。然后把 `virtual` 加上再跑一次 —— 两行的差别，就是这一课的全部。
2. 把第三节那段抄进去，确认翻译官喵真的报 `marked 'override', but does not override`；再把 `speek` 改成 `speak`，看它是不是就好了。**这个小护身符以后每课都跟着你。**
3. 给第四节再画一张 `BlackCat`（黑猫）图纸，照着 `Cat` 画下来、把 `speak` 改写成它自己的台词，然后**只改 `main` 里那排牌子**（`Cat* cats[3]`），让三只猫轮流出声。跑通了，你就摸到这一手真正的价值了。
4. 把第五节两段都跑一遍，**数一数输出有几行**。第二段是四行 —— 那多出来的一行，就是这一课最值钱的一行。
5. 想一想：本喵在第四节说「再画一张新猫，`main` 一个字都不用动」。可小任务 3 里本喵还是动了 `main`（牌子的个数）。**有没有办法连那一个数字都不用改？** 这是下一阶段的钥匙，先记在心里喵。

下一课本喵要往前走一大步：**有些图纸本来就不该被直接照出来，它只是一份「大家都要会这些」的约定**—— 本喵管那种图纸叫抽象图纸，照着它画下来的小猫必须把该会的手都会了才能出生。去下一课探险喵～ 🐾
