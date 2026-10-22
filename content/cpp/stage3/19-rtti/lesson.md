---
id: cpp-stage3-19
lang: cpp
stage: 3
order: 22
title: RTTI 与类型转换——照 X 光看清是哪只猫
tags: ["多态","类型转换"]
required: ["cpp-stage3-18"]
crossRefs: ["cpp-stage2-10","cpp-stage3-18"]
estMinutes: 25
keywords: [RTTI, dynamic_cast, typeid, static_cast, bad_cast]
---

## 钩子：一叠写着「猫」的牌子

大肥鱼手上有一叠牌子，每一张上面都写着同样两个字：**猫**。

牌子上写的这一栏，是**纸面上定死的**（静态类型）—— 翻译官喵翻代码的时候，看见的就只有这一栏。可牌子指着的那间屋里，住的是橘猫还是狸花猫？那一栏一个字都没写，得**真跑起来**才知道（动态类型）。

第二阶段「多态与虚函数」那一课，本喵学会了「一声开饭，各猫各样」：顺着牌子喊一声 `speak()`，各猫做出各猫的动作。**可本喵现在想知道的是另一件事** —— 喊完之后，本喵怎么问出来这一位到底是谁？

为什么非要问出来？因为本喵要开小灶：**橘猫才有的那条小鱼干**，只想喂给橘猫，不能顺手塞进狸花猫碗里。手上只有一张写着「猫」的牌子时，本喵总得有个办法照一照，看清屋里住的到底是哪一只。

**跑起来还能认出屋里住的是谁**，这门本事书上叫 **RTTI**（run-time type information）。本喵管它叫**照 X 光**喵。

## 一、牌子上写一栏，屋里住的另一位

先把那一课那套摆出来，看一件很要紧的事：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(const string& n) : name(n) {}
    virtual ~Cat() {}
    virtual void speak() const {
        cout << name << "：喵～" << endl;
    }
};

class OrangeCat : public Cat {
public:
    OrangeCat(const string& n) : Cat(n) {}
    void speak() const override {
        cout << name << "：本喵是橘猫，喵喵喵！" << endl;
    }
};

class TabbyCat : public Cat {
public:
    TabbyCat(const string& n) : Cat(n) {}
    void speak() const override {
        cout << name << "：本喵是狸花猫，喵呜～" << endl;
    }
};

int main() {
    OrangeCat o("小橘");
    TabbyCat t("狸花");
    Cat* p = &o;
    p->speak();
    p = &t;
    p->speak();
    return 0;
}
```

```text
小橘：本喵是橘猫，喵喵喵！
狸花：本喵是狸花猫，喵呜～
```

两行都对 —— 挂了招牌的那一手会低头看屋里住的是谁，所以喊出来的台词各不相同。**可这只是「它做了自己那件事」**，不是「本喵问出了它是谁」。

看 `p` 这张牌子：从头到尾写的都是 `Cat`。这两行输出能印出来，靠的是**屋里那一位自己**会做这件事；牌子上仍然只有「猫」这一栏。本喵要是想写「如果是橘猫，就多喂一条小鱼干」，翻译官喵当场答不上来 —— 它手里只有牌子，牌子上没写这一栏。

::: tip 猫咪提示
**纸面上那一栏**（静态类型）= 写代码时牌子上写死的字，翻译官喵翻的时候只认它。
**屋里那一位**（动态类型）= 真跑起来那一刻，这间屋里实际住着的那只猫。

第二阶段「一声开饭，各猫各样」那一课那句「名字定终身」说的是**该跑哪一手**；这一课要问的是另一个问题：**跑起来之后，怎么把屋里那一位认出来**。这是两件事喵。
:::

## 二、照光那一手：`dynamic_cast` 到牌子

照 X 光有专门的写法，它长这样：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    Cat(const string& n) : name(n) {}
    virtual ~Cat() {}
};

class OrangeCat : public Cat {
public:
    OrangeCat(const string& n) : Cat(n) {}
};

class TabbyCat : public Cat {
public:
    TabbyCat(const string& n) : Cat(n) {}
};

int main() {
    OrangeCat o("小橘");
    Cat* p = &o;

    OrangeCat* a = dynamic_cast<OrangeCat*>(p);
    cout << (a == nullptr ? "空牌子" : "照出来了") << endl;

    TabbyCat* b = dynamic_cast<TabbyCat*>(p);
    cout << (b == nullptr ? "空牌子" : "照出来了") << endl;
    return 0;
}
```

```text
照出来了
空牌子
```

尖括号里写的是**本喵想照成哪张图纸**（这里是 `OrangeCat*`），括号里是**手上那张牌子**。念作：「照着这张牌子，看看屋里那只是不是一张橘猫图纸做的。」

- **第一次照到了。** 屋里住的确实是小橘，`dynamic_cast<OrangeCat*>(p)` 递给本喵一张写着「橘猫」的牌子 `a`，不是空的。
- **第二次照空了。** 换一张目标再照 —— 屋里那只明明不是狸花猫。这一回本喵拿到的是一张**空牌子**（`nullptr`）。
- **照不出来的时候，它不报错、也不崩** —— 它只是把一张空牌子递给本喵，由本喵自己决定怎么办。所以紧接着那一步永远是查一查：`a == nullptr` 就是「没照出来」。
- 拿到了 `a` 之后，本喵才敢喊橘猫才有的那一手、才能多喂那条小鱼干。**照光是「先确认、再动手」那个确认。**

::: warn 小心喵
`dynamic_cast<OrangeCat*>(p)` 里的 `p` **从头到尾一个字都没变**。照光这一步不改牌子本身，它只是**另外递给本喵一张新牌子**。所以照完要接住（`OrangeCat* a = ...`），不接住就等于白照了喵。
:::

## 三、照到「不必还的名字」上：失败是抛出来的

本喵刚才照的是**牌子**（`OrangeCat*`）。要是照到**不必还的名字**上呢？写法少一个星号：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    Cat(const string& n) : name(n) {}
    virtual ~Cat() {}
};

class OrangeCat : public Cat {
public:
    OrangeCat(const string& n) : Cat(n) {}
};

class TabbyCat : public Cat {
public:
    TabbyCat(const string& n) : Cat(n) {}
};

int main() {
    OrangeCat o("小橘");
    Cat* p = &o;

    try {
        TabbyCat& r = dynamic_cast<TabbyCat&>(*p);
        cout << "照出来了：" << r.name << endl;
    } catch (const bad_cast& e) {
        cout << "照不出来：" << e.what() << endl;
    }

    TabbyCat* q = dynamic_cast<TabbyCat*>(p);
    cout << (q == nullptr ? "牌子是空的" : "牌子有货") << endl;
    return 0;
}
```

```text
照不出来：std::bad_cast
牌子是空的
```

**同样一件事、同样照不出来，两种写法给的东西完全不一样：**

| 照成什么 | 照不出来的时候 |
|---|---|
| 牌子：`dynamic_cast<TabbyCat*>(p)` | 递给本喵**一张空牌子**，`q == nullptr` |
| 不必还的名字：`dynamic_cast<TabbyCat&>(*p)` | **当场抛出来**一个 `bad_cast`，本喵得接住 |

「不必还的名字」这一边**没有一个「空」可以表示失败** —— 名字本来就不许是空的。所以它只能用另一种办法认输：**抛**。接不住的话，程序当场就没收场了。上面那两行输出正好把两种结果摆在一起：上面那行是接住的（`e.what()` 报出来的话是 `std::bad_cast`），下面那行是空牌子。

::: tip 猫咪提示
`e.what()` 是这一手自带的「一句话说明」。`std::bad_cast` 就是它报的名字 —— 意思很直白：「这一照，没照成」。
:::

::: warn 小心喵
**这两种失败方式千万别记混**，本喵见过太多猫在这里栽：

- 照**牌子**失败 → **给空牌子**，不抛。忘了查 `== nullptr` 就用，那才是真的出事。
- 照**不必还的名字**失败 → **抛 `bad_cast`**，不给空。忘了包起来，程序当场停在那儿。

至于为什么会失败 —— 屋里那只确实不是本喵要的那张图纸做的，这不是「出错了」，是**照实回答**喵。
:::

## 四、`typeid(x).name()` 报出来的名字

照光回答的是「**是不是**某一张图纸」，还有一种问法是「**你到底是哪一张**」：

```cpp
#include <iostream>
#include <string>
#include <typeinfo>
using namespace std;

class Cat {
public:
    string name;
    Cat(const string& n) : name(n) {}
    virtual ~Cat() {}
};

class OrangeCat : public Cat {
public:
    OrangeCat(const string& n) : Cat(n) {}
};

class TabbyCat : public Cat {
public:
    TabbyCat(const string& n) : Cat(n) {}
};

int main() {
    OrangeCat o("小橘");
    TabbyCat t("狸花");
    Cat* p = &o;

    cout << typeid(*p).name() << endl;
    p = &t;
    cout << typeid(*p).name() << endl;
    cout << typeid(p).name() << endl;
    cout << (typeid(*p) == typeid(TabbyCat) ? "是狸花猫图纸" : "不是狸花猫图纸") << endl;
    return 0;
}
```

```text
9OrangeCat
8TabbyCat
P3Cat
是狸花猫图纸
```

一行一行看喵：

- `typeid(*p).name()` 跟着牌子变：先报 `9OrangeCat`，牌子改指狸花猫之后报 `8TabbyCat`。**它问的是屋里那一位**，所以它答得出来。
- **前面那个数字是名字的长度**：`OrangeCat` 九个字母，所以前面站着个 9；`TabbyCat` 八个字母，前面站着个 8。这是本机上翻译官喵（g++）的写法。
- **它是「实现定义」的**：`name()` 报出来的这串字**不是**保证原样印出图纸的名字，换个翻译官喵可能换一种写法，可能不带那个数字。**本喵要提醒的是：别把它当成「一定印出原来的名字」** —— 它对得上就对，对不上不代表程序错了。
- 第三行 `typeid(p).name()` 报的是 `P3Cat` —— 这次问的是**牌子本身**（`P` 就是牌子的意思，3 是 `Cat` 三个字母）。**写 `p` 问牌子，写 `*p` 问屋里那一位**，差一个星号，答案完全不同。
- **真正拿来判断的时候，用比较、不要比字**：`typeid(*p) == typeid(TabbyCat)` 才是本喵要的写法。它问的是「两张图纸是不是同一张」，跟名字被改写成什么样没关系，换个翻译官喵照样对。

::: warn 小心喵
`typeid(*p).name()` 报出来的那串字，**只适合给人看，不适合拿来做判断**。要判断就写 `typeid(*p) == typeid(TabbyCat)`，或者干脆用第二节的照光那一手。

还有一个更隐蔽的坑：`typeid` **必须写在 `*p` 上**。写在 `p` 上，它问的是牌子；本喵第一版就是这么写的，屏幕上印出来一串 `P3Cat`，本喵盯着看了半天才反应过来 —— 被问的是牌子，不是猫喵。
:::

## 五、不照光那一手：`static_cast`

同样是「把写着猫的牌子换成写着橘猫的牌子」，还有一手**不照光**的写法：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
public:
    Cat(const string& n) : name(n) {}
    virtual ~Cat() {}
    virtual void speak() const {
        cout << name << "：喵～" << endl;
    }
};

class OrangeCat : public Cat {
public:
    int weight;
    OrangeCat(const string& n) : Cat(n), weight(7) {}
    void speak() const override {
        cout << name << "：本喵是橘猫，喵喵喵！" << endl;
    }
};

class TabbyCat : public Cat {
public:
    int stripes;
    TabbyCat(const string& n) : Cat(n), stripes(13) {}
    void speak() const override {
        cout << name << "：本喵是狸花猫，喵呜～" << endl;
    }
};

int main() {
    TabbyCat t("狸花");
    Cat* p = &t;

    OrangeCat* hard = static_cast<OrangeCat*>(p);
    OrangeCat* soft = dynamic_cast<OrangeCat*>(p);

    cout << (hard == nullptr ? "牌子是空的" : "牌子有货") << endl;
    cout << (soft == nullptr ? "牌子是空的" : "牌子有货") << endl;

    hard->speak();
    cout << "橘猫的体重 = " << hard->weight << endl;
    return 0;
}
```

```text
牌子有货
牌子是空的
狸花：本喵是狸花猫，喵呜～
橘猫的体重 = 13
```

屋里住的明明是狸花猫。**同一张牌子、同一个目标，两手的差别一眼就看出来了：**

- **`static_cast` 给了「牌子有货」** —— 它不照光：翻译官喵在纸上就把地址算好了（从「猫」那一份挪到「橘猫」那一份该加多少，它是知道的），压根不看屋里住的是谁。于是本喵手里拿到一张写着「橘猫」的牌子，**而且一个错都不报**。
- **`dynamic_cast` 给了「牌子是空的」** —— 它照了光，照实回答：不是橘猫。
- **第三行更有意思**：本喵拿着那张硬换来的牌子喊了一声 `speak()`，居然喊出的是**狸花猫**的台词。因为那一手是「会看屋里住的是谁」的，喊下去还是低头看了屋里那一位 —— **虚的那一手反而把这次转错遮住了**，看着一切正常。
- **第四行露馅了**：本喵要读「橘猫的体重」，印出来是 `13` —— 那根本不是橘猫的体重（小橘那一格是 7），那是**狸花猫身上那一格的数**。因为 `static_cast` 算的是「从这一份挪到那一份」，屋里那位身上压根没有「橘猫的体重」这一格，本喵读到的就是隔壁那一格。

这就是 `static_cast` 的脾气：**它能算得快，是因为它压根不检查**。转对了皆大欢喜；转错了不报错、不抛、也不给空牌子 —— 它给本喵一张**看着挺正常的牌子**，等本喵真去用的时候，读出来的东西已经不对了。

::: warn 小心喵
上面第四行那个 `13` 是**本喵在这台机器上真跑出来的读数**，换个写法、换个翻译官喵，读到的可能是别的数。**别去背那个数字** —— 要背的是它的方向：

**转错了，`static_cast` 一声不吭。** 拿了那张牌子去读一格不属于它的东西，本喵读到的会是别人身上的数；要是那格是张牌子（地址），顺着它再喊一手，可能当场就崩。这中间**没有任何一处会告诉本喵「你转错了」**。

上一课那些「拆一半不报错」「忘了喂料不吭声」的坑，和这是同一类：**它安安静静，就等着本喵自己发现。**
:::

## 六、把四样摆在一起看一遍

下面这段演示把本喵今天照的四样东西摊开：照成功、照失败、问名字，再加上那手不照光的。跟着 `at:` 一步一步走，右边那一栏会跟着变喵。

```demo
title: 照 X 光：一张写着「猫」的牌子，照出屋里住的是谁
code:
| Cat* p = &o;                                  // 牌子上写「猫」，屋里住的是橘猫
| OrangeCat* a = dynamic_cast<OrangeCat*>(p);
| TabbyCat*  b = dynamic_cast<TabbyCat*>(p);
| cout << typeid(*p).name() << endl;
| Cat* q = &t;                                  // 这一次屋里住的是狸花猫
| OrangeCat* c = static_cast<OrangeCat*>(q);

step 本喵手里只有一张写着「猫」的牌子
at: 1
say: `p` 是一张「猫」的牌子，它指着橘猫小橘。牌子上写死的是「猫」这一栏，屋里住的是谁，牌子上一个字都没写。
meow: 牌子上写「猫」，屋里住着橘猫喵～
pose: welcome
这次照出来是哪一只 = 还没开始照
牌子空不空 = 还没开始照
它报出来的名字 = 还没问

step 对着橘猫照一次「是不是橘猫」
at: 2
say: 照光那一手低头看了屋里那一位，对上了 —— 递给本喵一张写着「橘猫」的牌子。照完记得接住，不然就白照了。
meow: 对上了！照出来真是橘猫～
pose: yay
这次照出来是哪一只 = 橘猫
牌子空不空 = 不空
它报出来的名字 = 还没问

step 对着同一只猫，再照一次「是不是狸花猫」
at: 3
say: 换一张目标再照。屋里明明是橘猫 —— 这一回照不出来。注意它不报错、不崩，递给本喵的是一张空牌子，本喵自己查 `== nullptr`。
meow: 这回照空了，手里一张空牌子喵
pose: think
这次照出来是哪一只 = 照不出来（空牌子）
牌子空不空 = 空
它报出来的名字 = 还没问

step 问一句「你到底是哪张图纸做的」
at: 4
say: `typeid(*p).name()` 报的是 `9OrangeCat` —— 前面那个 9 是名字的长度。这串字是**实现定义**的，换个翻译官喵可能换个写法，只能给人看，不能拿来比。
meow: 它报自己叫 9OrangeCat 喵！
pose: expect
这次照出来是哪一只 = 橘猫
牌子空不空 = 不空
它报出来的名字 = 9OrangeCat

step 换一只猫，牌子还是写着「猫」
at: 5
say: 同一张牌子改指着狸花猫。牌子上写的那一栏一辈子不变，变的只有屋里那一位 —— 所以光看牌子，本喵永远认不出屋里是谁。
meow: 还是那张「猫」牌子，屋里换人啦喵
pose: remind
这次照出来是哪一只 = 还没照
牌子空不空 = 还没照
它报出来的名字 = 还没问

step 这回不照光，硬当它是橘猫
at: 6
say: `static_cast` 在纸上就把地址算好了，压根不看屋里住的是谁。牌子照样拿到手、一个错都不报 —— 可屋里住的明明是狸花猫，本喵已经拿着一张写着「橘猫」的错牌子了。
meow: 不照光也拿到了牌子，一格错都不报喵
pose: soothe
这次照出来是哪一只 = 纸上说是橘猫（其实不是）
牌子空不空 = 不空（这才是最危险的）
它报出来的名字 = 8TabbyCat（问名字还是准的）
```

## 七、照光有个硬门槛：底座至少得有一手挂了招牌

照光那一手是从哪儿知道「屋里住的是谁」的？**得有人记着这件事。** 记着它的地方，是挂了招牌（`virtual`）的那一手带来的 —— 所以门槛来了：**底座图纸上至少得有一手挂着招牌**，照光才照得动。本喵把前面那套里那行 `virtual ~Cat() {}` 删掉试了一次：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    Cat(const string& n) : name(n) {}
    void speak() const {
        cout << name << "：喵～" << endl;
    }
};

class OrangeCat : public Cat {
public:
    OrangeCat(const string& n) : Cat(n) {}
};

int main() {
    OrangeCat o("小橘");
    Cat* p = &o;
    OrangeCat* a = dynamic_cast<OrangeCat*>(p);
    cout << (a == nullptr ? "空牌子" : a->name) << endl;
    return 0;
}
```

```text
main.cpp:22:20: error: cannot 'dynamic_cast' 'p' (of type 'class Cat*') to type 'class OrangeCat*' (source type is not polymorphic)
```

翻译官喵的原话里，最要紧的三个词是 `source type is not polymorphic` —— 它说的是「**本喵拿来照的这份料，不是会变的那种**」。本喵的话：这张底座图纸上一手挂招牌的都没有，所以**它压根没带「我是谁」的记录**，照光这一手没法开工。程序根本编不出来，翻译官喵当场拦住。

**这条门槛是好事**：它出错的时候是当场拦人，不是安安静静地错。

## 八、同一道门槛也管着 `typeid`

那把招牌删掉之后，`typeid` 编得过吗？本喵真跑过：

```cpp
#include <iostream>
#include <string>
#include <typeinfo>
using namespace std;

class Cat {
public:
    string name;
    Cat(const string& n) : name(n) {}
};

class OrangeCat : public Cat {
public:
    OrangeCat(const string& n) : Cat(n) {}
};

int main() {
    OrangeCat o("小橘");
    Cat* p = &o;
    cout << "照牌子看见的：" << typeid(*p).name() << endl;
    cout << "照真猫看见的：" << typeid(o).name() << endl;
    return 0;
}
```

```text
照牌子看见的：3Cat
照真猫看见的：9OrangeCat
```

**编得过，可它看错了地方。** `typeid(*p)` 本来该报屋里那一位，可底座没有挂招牌的那一手，也就没有「我是谁」的记录可以查 —— 于是它只好照着**牌子上写的那一栏**回答：`3Cat`。同一只猫，本喵直接问它自己（`typeid(o)`）就是 `9OrangeCat`。

**一句话记住：`dynamic_cast` 和 `typeid` 认的是同一份记录，所以它俩要的是同一道门槛** —— 底座图纸上至少有一手挂着招牌。挂了，两个都灵；没挂，一个是编不过，另一个是**照牌子的字回答，安安静静地答错**。

那警告算不算数？本喵也顺手试了一种写歪的接法 —— 照不必还的名字、接住的时候把「不必还」那个 `&` 写漏了：

```cpp
#include <iostream>
#include <string>
#include <typeinfo>
using namespace std;

class Cat {
public:
    string name;
    Cat(const string& n) : name(n) {}
    virtual ~Cat() {}
};

class OrangeCat : public Cat {
public:
    OrangeCat(const string& n) : Cat(n) {}
};

class TabbyCat : public Cat {
public:
    TabbyCat(const string& n) : Cat(n) {}
};

int main() {
    OrangeCat o("小橘");
    Cat* p = &o;
    try {
        TabbyCat& r = dynamic_cast<TabbyCat&>(*p);
        cout << "照出来了：" << r.name << endl;
    } catch (bad_cast e) {
        cout << "照不出来：" << e.what() << endl;
    }
    return 0;
}
```

```text
照不出来：std::bad_cast
```

接是接住了，可翻译官喵顺口念叨了一句：

```text
main.cpp:29:23: warning: catching polymorphic type 'class std::bad_cast' by value [-Wcatch-value=]
```

它的意思是「这份料身上挂着招牌，本喵接住的却是一份**抄本**，不是原来那一份」。**注意这是警告、不是错误** —— 程序照样编出来、照样跑。只是那句 `catch (bad_cast e)` 少了那个小小的 `&`，接住的就不是原来那一位了。

::: tip 猫咪提示
`catch (const bad_cast& e)` 里那个 `&` 不能省 —— 和本喵在上一课写 `const string& n` 是同一个道理：**不必还的接法**，才不会接住一份抄本。
:::

## 九、四种写法对照

书上把这一课的写法归成一桌四手。本喵把它们摆出来，顺便说清各自该什么时候上：

| 本喵写下的 | 它干什么 | 什么时候用 |
|---|---|---|
| `static_cast<...>` | **不照光**：纸上算好怎么挪，不做运行期检查 | 数值换算、朝着底座那一边走（上行）、本喵心里有数的时候 |
| `dynamic_cast<...>` | **照光**：真跑起来低头看屋里住的是谁，认的是那份「我是谁」的记录 | 手里只有底座的牌子，要确认是不是某一张小图纸 —— 有运行期代价 |
| `const_cast<...>` | 只动「许不许改」这一条，别的什么都不改 | 极少用；本喵只在收拾老代码的时候见过它，动了不该动的格子是自找麻烦 |
| `reinterpret_cast<...>` | 把同一块地方**硬当另一种东西**看，比 `static_cast` 还不管不顾 | 基本不碰。要用之前先想三遍，再想一遍 |

本喵最想让你带走的三句话：

1. **朝着底座那一边走（上行），`static_cast` 就够了** —— 小猫本来就是猫，这一步没有照光的必要。
2. **反着走（下行）才要当心**：要么用 `dynamic_cast` 照一照（慢一点，可它照实回答），要么用 `static_cast` 硬来（快，可**转错了它一声不吭**）。写之前先问自己一句：这一位**一定是**那张小图纸做的吗？答不上来就照光。
3. **后两种基本不碰。** `const_cast` 和 `reinterpret_cast` 属于「本喵确实知道自己在干什么」时才用的那一档；初学阶段遇到它们的地方，九成是换个写法会更好。

::: warn 小心喵
**照光不是免费的。** `dynamic_cast` 真跑起来要低头查那份记录，所以它比 `static_cast` 慢一点点。本喵的规矩是：**只有「本喵真的不确定」的时候才照光**。

反过来更贵的是另一种：明明不确定，却为了省那一点点用了不照光的写法 —— 转错了不报错，等本喵发现的时候，屏幕上已经是一个查不出原因的怪数字了喵。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `Cat* p = &o;` | 一张写着「猫」的牌子，屋里住的是橘猫 —— 纸面一栏，屋里一位 |
| `dynamic_cast<OrangeCat*>(p)` | 照光，照的是**牌子**：对上给新牌子，对不上给**空牌子** |
| `dynamic_cast<TabbyCat&>(*p)` | 照光，照的是**不必还的名字**：对上给名字，对不上**抛 `bad_cast`** |
| `catch (const bad_cast& e)` | 把上面那一抛接住；`e.what()` 报出来的是 `std::bad_cast` |
| `typeid(*p).name()` | 问「你到底是哪张图纸做的」，报出来的是**实现定义**的名字（本机上是 `9OrangeCat`，9 是名字长度） |
| `typeid(p).name()` | 问的是**牌子**，报出来是 `P3Cat` —— 差一个星号，问的东西完全不同 |
| `typeid(*p) == typeid(TabbyCat)` | 要判断就用这个：它问「是不是同一张图纸」，换个翻译官喵照样对 |
| `static_cast<OrangeCat*>(p)` | **不照光**：直接换一张牌子，不做检查 —— 转错了牌子照样是「有货」 |
| 那张转错的牌子读出来的 `13` | 读到了别人那一格的数；**转错了不报错**，这才是最贵的坑 |
| 底座上没挂招牌就照光 | `source type is not polymorphic` —— 编不过（当场拦人，这条最好） |
| 底座上没挂招牌就 `typeid` | 编得过，可它照着**牌子上那一栏**回答：`3Cat`（安静地答错） |

## 小任务

1. 把第二节那段抄进练习场跑一次，把两次照光的结果对一遍：一次「照出来了」、一次「空牌子」。然后把第二次照光的目标改成 `OrangeCat*` —— 猜猜这回是什么，再跑一次对照。
2. 把第三节那段抄进去跑一遍，确认它真的印出 `照不出来：std::bad_cast`；再把 `catch (const bad_cast& e)` 那一整段 `try` / `catch` **删掉**再跑一次 —— 看看程序是怎么收场的。那一堆话里有没有一句是 `bad_cast`？
3. 先猜再跑：把第四节那段里第三行 `typeid(p).name()` 改成 `typeid(*p).name()`，两个数字会怎么变？然后**把 `virtual ~Cat() {}` 那一行删掉**，再跑一次，看看 `typeid(*p)` 报出来的名字变成了什么 —— 先写下猜测，再真跑对照。
4. 把第五节那段抄进去跑一次，数一数「牌子有货」「牌子是空的」各印了几遍；再想想：要是把 `hard->weight` 那一行换成 `hard->speak()`，输出会不会露出马脚？（本喵上面那段已经演过答案了，自己跑一遍才算数。）

下一课本喵要往前再走一步：**给特定材料开小灶** —— 那张会量体裁衣的图纸，碰上某些特别的料子时，本喵想让它的裁法变一变。去下一课探险喵～ 🐾
