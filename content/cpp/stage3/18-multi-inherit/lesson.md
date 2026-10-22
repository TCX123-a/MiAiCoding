---
id: cpp-stage3-18
lang: cpp
stage: 3
order: 21
title: 多继承与虚基类——图纸套图纸的岔路
tags: ["继承","面向对象"]
required: ["cpp-stage3-17"]
crossRefs: ["cpp-stage2-09","cpp-stage2-10","java-stage2-04"]
estMinutes: 28
keywords: [multiple inheritance, diamond, virtual base, ambiguous]
---

## 钩子：两样本事，分在两张图纸上

鱼塘边来了一位猫客，要本喵画一只很特别的猫：**又会打呼噜、又会踩奶**。

本喵手里已经有两张图纸了 —— 一张「会打呼噜的猫」、一张「会踩奶的猫」。上一阶段本喵学过图纸套图纸：让新图纸照着老图纸画下来，老图纸上有的东西新图纸自动全有。

可这两样本事**分在两张图纸上**，照着谁画都缺一样。

老猫给本喵递了一招：**照着两张图纸一起画**。它正式的名字叫**照着两张图纸画（多继承）**。

听起来省事，可它给本喵留了一个岔路口 —— 那正是这一课最值钱的那个坑。往下看喵。

## 一、照着两张图纸一起画

写法只比上一阶段多一小段：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Purr {
protected:
    string purrName;
public:
    Purr(const string& n) : purrName(n) {
        cout << "先搭会打呼噜的那一半" << endl;
    }
    void purr() const {
        cout << purrName << "：呼噜呼噜～" << endl;
    }
};

class Knead {
protected:
    string kneadName;
public:
    Knead(const string& n) : kneadName(n) {
        cout << "再搭会踩奶的那一半" << endl;
    }
    void knead() const {
        cout << kneadName << "：踩踩踩～" << endl;
    }
};

class Baby : public Purr, public Knead {
public:
    Baby(const string& n) : Purr(n), Knead(n) {
        cout << "最后搭小猫这一半：" << purrName << endl;
    }
};

int main() {
    Baby b("小橘");
    b.purr();
    b.knead();
    return 0;
}
```

```text
先搭会打呼噜的那一半
再搭会踩奶的那一半
最后搭小猫这一半：小橘
小橘：呼噜呼噜～
小橘：踩踩踩～
```

看清楚这几件事喵：

- **`class Baby : public Purr, public Knead`** —— 照着两张图纸一起画，中间用**逗号**隔开。念作「`Baby` 这张图纸，照着 `Purr` 和 `Knead` 两张画下来」。
- **两张前面那个 `public` 一个都不能少。** 少写了就是上一阶段那一跤：老图纸给的公开东西全变成新图纸自己的私事，外面会说「够不着」。
- **出生顺序按本喵写的先后**：先 `Purr` 那一半、再 `Knead` 那一半，**最后才是自己那一半** —— 输出前三行就是它俩加自己。
- **照出来的小橘两样都会**（`b.purr()` 和 `b.knead()`），而且它**既是一只会打呼噜的猫，也是一只会踩奶的猫**：凡是能放「会打呼噜的猫」的地方，放它都成立。这是上一阶段那句老话的扩大版。
- 这里两张图纸**谁也不认识谁** —— 它们没有共同的底座，所以拼起来干干净净。麻烦出在它俩认识同一张图纸的时候。

## 二、岔路口：底座出现了两份

现在本喵让这两张图纸**都照着同一张底座画**。底座是「会喵的猫」（`MeowCat`），里面有一格名字、一手 `meow`。

顺带本喵在底座里挂了一个**共同的计数器**（`static int built`）：每搭一份底座它就加一 —— 这样本喵就能数出来，照出来的猫肚子里到底有几份底座。

```cpp
#include <iostream>
#include <string>
using namespace std;

class MeowCat {
protected:
    string name;
public:
    static int built;
    MeowCat(const string& n) : name(n) {
        built = built + 1;
        cout << "搭一份会喵的底座：" << name << endl;
    }
    void meow() const {
        cout << name << "：喵～" << endl;
    }
};

int MeowCat::built = 0;

class Purr : public MeowCat {
public:
    Purr(const string& n) : MeowCat(n) {}
    void rename(const string& n) { name = n; }
    void purr() const { cout << name << "：呼噜呼噜～" << endl; }
};

class Knead : public MeowCat {
public:
    Knead(const string& n) : MeowCat(n) {}
    void rename(const string& n) { name = n; }
    void knead() const { cout << name << "：踩踩踩～" << endl; }
};

class Baby : public Purr, public Knead {
public:
    Baby(const string& n) : Purr(n), Knead(n) {}
};

int main() {
    Baby b("小橘");
    cout << "底座份数 = " << MeowCat::built << endl;
    b.Purr::rename("小P");
    b.Purr::meow();
    b.Knead::meow();
    return 0;
}
```

```text
搭一份会喵的底座：小橘
搭一份会喵的底座：小橘
底座份数 = 2
小P：喵～
小橘：喵～
```

**数一数第一行印了几遍：两遍。** 再数一数照出来的小橘肚子里有几份底座：`底座份数 = 2`。

形状画出来是这样的：底座在最上面，往左岔出一张、往右岔出一张，最后又被一张图纸拼回一只猫 —— 像一个**菱形**。所以这一手在书里常被叫做**菱形的那条岔路**。

- **为什么会两份**：左边那张图纸照着底座画过一次，**右边那张又照着底座画了一次**。它不是「接着左边画」，是各自照着底座画。左右各带一份底座进到最下面的猫肚子里，于是两份。
- **这两份各过各的。** 本喵用 `b.Purr::rename("小P")` 从**左边那条路**改了名字，于是左边喊出来是「小P」，右边喊出来还是「小橘」。**同一个名字，两条路各有一份，改一份另一份纹丝不动。**
- **`b.Purr::meow()` 这种点着名字喊的写法**，就是岔路口上的路牌：告诉翻译官喵「本喵说的是左边那条路上那一份」。中间那一段 `Purr::` 就是路牌本身。

岔路口的问题就在这儿：**同一个底座，被两条路各带了一份。** 下面这段演示把它摊开给你看喵。

```demo
title: 菱形岔路口：底座先是两份，挂上 virtual 之后合并成一份
code:
| class MeowCat { ... };                          // 底座图纸：会喵的猫
| class Purr : public MeowCat { ... };            // 左边：会打呼噜
| class Knead : public MeowCat { ... };           // 右边：会踩奶
| class Baby : public Purr, public Knead { ... }; // 最后拼成一只两样都会的猫
| Baby b("小橘");
| class Purr : virtual public MeowCat { ... };    // 左边挂上那一手（右边也照做）
| Baby b2("小P");

step 摊开底座图纸
at: 1
say: 先摊开底座 `MeowCat`：会喵的猫。一张图纸本身不占地，所以这会儿底座份数还是 0 —— 照着它做出来的猫才带底座。
meow: 先摊开底座图纸喵～
pose: welcome
底座份数 = 0
直接喊喵 = 还没轮到

step 左边那条路照着底座画下来
at: 2
say: 会打呼噜这张图纸照着底座画。从这一笔起，凡是照它做出来的猫，肚子里都自带一份会喵的底座。
meow: 左边岔出来了，第一份底座到！
pose: expect
底座份数 = 1
直接喊喵 = 还没轮到

step 右边那条路**也**照着同一张底座画
at: 3
say: 注意看：会踩奶这张**不是接着左边画的**，而是又照着底座画了一遍。底座这一份是两条路各自带的 —— 所以这是第二份。
meow: 右边又照底座画一遍喵！
pose: think
底座份数 = 2
直接喊喵 = 还没轮到

step 最后拼回一只猫
at: 4
say: 「两样都会」这张图纸照着左右两张一起画。它自己没碰底座，可左右两边各带一份进来 —— 两份都跟着落到它肚子里了。
meow: 拼起来的猫，肚子里两份底座！
pose: busy
底座份数 = 2
直接喊喵 = 说不清（两条路都找得到）

step 照它生一只小橘
at: 5
say: 真做出来的猫：左边那份底座先搭、左边那一半，再右边那份底座、右边那一半，最后才是它自己那一半 —— 「搭一份会喵的底座」会印两遍。
meow: 底座真的搭了两次喵……
pose: remind
底座份数 = 2
直接喊喵 = 说不清（两条路都找得到）

step 给照着画的那一行挂上 virtual
at: 6
say: 挂的地方是「照着底座画」的那一行：`class Purr : virtual public MeowCat`。写在 `public` 前面后面都行，但左右两条路都要挂。
meow: 照着画的那一行挂上 virtual！
pose: guide
底座份数 = 2
直接喊喵 = 说不清（两条路都找得到）

step 再照它生一只：底座只剩一份
at: 7
say: 这一回整只猫只留一份底座 —— 不管中间岔了几条路，挂过那一手的底座只搭一次，「直接喊喵」也不再说不清了。
meow: 合并成一份，喊起来也不打架啦！
pose: yay
底座份数 = 1
直接喊喵 = 清楚（只剩一条路）
```

## 三、两条路都找得到，翻译官喵说「说不清」

那要是不点路牌，直接喊 `b.meow()` 呢？本喵真跑过：

```cpp
#include <iostream>
#include <string>
using namespace std;

class MeowCat {
protected:
    string name;
public:
    MeowCat(const string& n) : name(n) {}
    void meow() const {
        cout << name << "：喵～" << endl;
    }
};

class Purr : public MeowCat {
public:
    Purr(const string& n) : MeowCat(n) {}
};

class Knead : public MeowCat {
public:
    Knead(const string& n) : MeowCat(n) {}
};

class Baby : public Purr, public Knead {
public:
    Baby(const string& n) : Purr(n), Knead(n) {}
};

int main() {
    Baby b("小橘");
    b.meow();
    return 0;
}
```

```text
main.cpp:32:7: error: request for member 'meow' is ambiguous
```

翻译官喵的原话是「**`meow` 说不清**」（`ambiguous` 就是「有好几种解释、本喵挑不出来」）。

注意它说的**不是「没有」**：两条路上都找得到 `meow`，左边那份底座有、右边那份底座也有 —— 正因为**都找得到**，它才挑不出来。哪一份都不比另一份更该被选中。

这一跤有个好处：**它当场就拦住你**，程序根本编不出来。上一阶段那些「拆一半不报错」「改一处不吭声」的坑，起码不会在这儿出现。

那怎么把话说清楚？两条路：

1. **点路牌**：`b.Purr::meow()` —— 明说走左边那条路。缺点是每喊一次都得点，哪天忘了点，又是一模一样的报错。
2. **让底座只留一份** —— 只剩一条路，也就没什么可挑的了。这才是这一课的正主，下一节喵。

## 四、挂上 `virtual`，底座只留一份

给「照着底座画」的那一行挂上一个词：

```cpp
#include <iostream>
#include <string>
using namespace std;

class MeowCat {
protected:
    string name;
public:
    static int built;
    MeowCat(const string& n) : name(n) {
        built = built + 1;
        cout << "搭一份会喵的底座：" << name << endl;
    }
    void meow() const {
        cout << name << "：喵～" << endl;
    }
};

int MeowCat::built = 0;

class Purr : virtual public MeowCat {
public:
    Purr(const string& n) : MeowCat(n) {}
    void rename(const string& n) { name = n; }
    void purr() const { cout << name << "：呼噜呼噜～" << endl; }
};

class Knead : virtual public MeowCat {
public:
    Knead(const string& n) : MeowCat(n) {}
    void rename(const string& n) { name = n; }
    void knead() const { cout << name << "：踩踩踩～" << endl; }
};

class Baby : public Purr, public Knead {
public:
    Baby(const string& n) : MeowCat(n), Purr(n), Knead(n) {}
};

int main() {
    Baby b("小橘");
    cout << "底座份数 = " << MeowCat::built << endl;
    b.Purr::rename("小P");
    b.meow();
    b.purr();
    b.knead();
    return 0;
}
```

```text
搭一份会喵的底座：小橘
底座份数 = 1
小P：喵～
小P：呼噜呼噜～
小P：踩踩踩～
```

跟第二节那段一比，只多了两个词，输出全变了：

- **`class Purr : virtual public MeowCat`** —— 就在「照着底座画」那一行上，多挂一个 `virtual`。念作「照着底座画，**但这份底座整只猫里只留一份**」。
- **底座只搭了一次**：`底座份数 = 1`，而且「搭一份会喵的底座」只印了一遍。
- **`b.meow()` 不用点路牌了。** 只剩一条路，翻译官喵再也不用挑。
- **改名字的影响面也变了**：还是从左边那条路改（`b.Purr::rename("小P")`），可这回三条路喊出来**全是小P** —— 因为从头到尾只有一份底座，左边改的就是大家看的那一份。

**规矩：左右两条路都要挂。** 只给一边挂上，岔路口还是说不清 —— 本喵真跑过那种写法，翻译官喵照样报 `request for member 'meow' is ambiguous`。那一边挂过的那份是共用的，可另一边还带着自己那份，肚子里依旧是两份。

::: tip 猫咪提示
`virtual` 这个词你在上一阶段见过一次 —— 那次是挂在**招式**前面（「这一手别急着定死，看屋里住的是谁」）。这一次它挂在**照着画的那一行**上，管的是完全另一件事：「这份底座只留一份」。

同一个词，两个位子，两件事。看它挂在哪儿就知道在说哪件事喵。
:::

## 五、那份共用的底座，由最外面的图纸喂料

挂上 `virtual` 之后，多出一条新规矩：**那份共用的底座，由最外面那张图纸负责搭。**

```cpp
#include <iostream>
#include <string>
using namespace std;

class MeowCat {
protected:
    string name;
public:
    MeowCat(const string& n) : name(n) {
        cout << "搭那份共用的底座：" << name << endl;
    }
    void meow() const {
        cout << name << "：喵～" << endl;
    }
};

class Purr : virtual public MeowCat {
public:
    Purr() : MeowCat("打呼噜的底座") {
        cout << "搭会打呼噜的那一半" << endl;
    }
    void purr() const { cout << name << "：呼噜呼噜～" << endl; }
};

class Knead : virtual public MeowCat {
public:
    Knead() : MeowCat("踩奶的底座") {
        cout << "搭会踩奶的那一半" << endl;
    }
    void knead() const { cout << name << "：踩踩踩～" << endl; }
};

class Baby : public Purr, public Knead {
public:
    Baby(const string& n) : MeowCat(n) {}
};

int main() {
    Baby b("小橘");
    b.meow();
    cout << "---- 单独照会打呼噜那张画一只 ----" << endl;
    Purr p;
    p.meow();
    return 0;
}
```

```text
搭那份共用的底座：小橘
搭会打呼噜的那一半
搭会踩奶的那一半
小橘：喵～
---- 单独照会打呼噜那张画一只 ----
搭那份共用的底座：打呼噜的底座
搭会打呼噜的那一半
打呼噜的底座：喵～
```

看仔细喵，这里有一件「明明写了却被无视」的事：

- `Purr` 和 `Knead` 的出生招式里，**各自都写了一句话给底座喂料**：一个喂「打呼噜的底座」、一个喂「踩奶的底座」。
- 可拼装成 `Baby` 的时候，**这两句话都不算数**。第一行印的是「小橘」—— 那是 `Baby` 自己那句 `MeowCat(n)` 喂进去的。共用的那份底座，只有**最外面那张图纸**说了算。
- 等本喵**单独**照 `Purr` 画一只（`Purr p;`），它才是那只猫的最外面一张图纸 —— 于是它那一句「打呼噜的底座」立刻生效（最后三行）。**同一个出生招式，站在不同的位子上，说的话一个算数一个不算数。**
- **顺序也一并记住了**：共用的底座**最先**搭，然后左边、右边，最后自己那一半。输出前四行就是这个顺序。拆的时候正好倒过来：先拆自己那一半，最后才拆那份共用的底座。

那要是**忘了喂**呢？本喵真跑过 —— 把 `Baby` 出生招式里那一小段 `MeowCat(n)` 删掉：

```cpp
#include <iostream>
#include <string>
using namespace std;

class MeowCat {
protected:
    string name;
public:
    MeowCat(const string& n) : name(n) {
        cout << "搭那份共用的底座：" << name << endl;
    }
    void meow() const {
        cout << name << "：喵～" << endl;
    }
};

class Purr : virtual public MeowCat {
public:
    Purr(const string& n) : MeowCat(n) {}
    void purr() const { cout << name << "：呼噜呼噜～" << endl; }
};

class Knead : virtual public MeowCat {
public:
    Knead(const string& n) : MeowCat(n) {}
    void knead() const { cout << name << "：踩踩踩～" << endl; }
};

class Baby : public Purr, public Knead {
public:
    Baby(const string& n) : Purr(n), Knead(n) {}
};

int main() {
    Baby b("小橘");
    b.meow();
    return 0;
}
```

```text
main.cpp:31:45: error: no matching function for call to 'MeowCat::MeowCat()'
```

翻译官喵说的是「**找不到一个不用喂料的搭法**」：`Baby` 那句里没喂料，`Purr`、`Knead` 里写的那两句又**被无视了**，而底座那张图纸的出生招式**要求喂一个名字**（它没有「什么都不用喂」的那一种）—— 于是它当场停下。

注意这条报错**站的位置**：它指着 `Baby` 自己那一行。因为「最外面那张图纸负责喂料」这条规矩，责任也在它头上。

::: warn 小心喵
**这一跤有两种长相，第二种是安静的：**

- **底座要求喂料**（上面这段）→ 编不过。翻译官喵当场拦你，这种最好办。
- **底座本来就有一个「什么都不用喂」的出生招式** → **一声都不吭**。本喵真跑过：忘了喂照样编得过、跑得起来，只是底座里那一格用的是它自己默认的值（本喵那次印出来是「(还没起名字)：喵～」）。**安静地错，才是这一课最贵的坑。**

所以挂上 `virtual` 之后，第一件事就是回头看 `Baby` 那一行：**共用的底座，本喵喂料了吗？**
:::

## 六、这笔账：多出来的块头，和什么时候别用它

两份底座不只是「名字说不清」的问题，它还**占地方**。本喵把两种写法摆在一块儿量了一次：

```cpp
#include <iostream>
#include <string>
using namespace std;

class MeowCat {
protected:
    string name;
public:
    MeowCat(const string& n) : name(n) {}
};

class PurrPlain : public MeowCat {
public:
    PurrPlain(const string& n) : MeowCat(n) {}
};

class KneadPlain : public MeowCat {
public:
    KneadPlain(const string& n) : MeowCat(n) {}
};

class BabyPlain : public PurrPlain, public KneadPlain {
public:
    BabyPlain(const string& n) : PurrPlain(n), KneadPlain(n) {}
};

class PurrVirt : virtual public MeowCat {
public:
    PurrVirt(const string& n) : MeowCat(n) {}
};

class KneadVirt : virtual public MeowCat {
public:
    KneadVirt(const string& n) : MeowCat(n) {}
};

class BabyVirt : public PurrVirt, public KneadVirt {
public:
    BabyVirt(const string& n) : MeowCat(n), PurrVirt(n), KneadVirt(n) {}
};

int main() {
    cout << "两份底座那只猫的块头：" << sizeof(BabyPlain) << endl;
    cout << "合并成一份那只猫的块头：" << sizeof(BabyVirt) << endl;
    return 0;
}
```

```text
两份底座那只猫的块头：64
合并成一份那只猫的块头：48
```

（这两行是本喵在这台机器上真跑出来的读数。左边的 64 里装着**两份**底座，右边的 48 里只装一份外加一点「记着那份共用在哪儿」的账本 —— 数字会随机器和写法变，记住**方向**就行：合并之后省下一整份底座。）

那是不是说明 `virtual` 一定更划算？**不是。** 它省下一份底座，代价是多了一层「先查账本、再找到那份共用的」的间接，而且多出一条「最外面的图纸负责喂料」的规矩要记。写代码的时候，这几件事要一起称一称：

| 情形 | 本喵的建议 |
|---|---|
| 两样本事分在两张**不相干**的图纸上，你要的猫确实两样都是 | 该用 —— 这正是照着两张图纸画最拿手的活 |
| 只是想把现成的东西**再捡一点回来** | **别用**。单链的图纸套图纸就够了，而且不会有岔路口 |
| 两条路最后要回到**同一张底座** | 两条路上**都挂上那一手**，让底座只留一份；不然就得处处点路牌 |
| 已经挂了那一手 | 记住：**共用的底座由最外面那张图纸喂料**，别指望里面那两句 |

::: tip 猫咪提示
今天记住六句话：

1. **`class Baby : public Purr, public Knead`** —— 照着两张图纸一起画，中间用逗号隔开，两边前面的 `public` 都不能省。
2. **出生顺序按本喵写的先后**，最后才是自己那一半；拆的时候正好倒过来。
3. **两条路都照着同一张底座画 = 岔路口**：肚子里的底座有两份，名字也会说不清（`ambiguous`）。
4. **点路牌**（`b.Purr::meow()`）能说清走哪条路，但每喊一次都要点。
5. **挂上 `virtual`**（`class Purr : virtual public MeowCat`）—— 那份底座整只猫只留一份，两条路都要挂，挂完就能直接喊。
6. **挂过 `virtual` 之后，共用的底座由最外面那张图纸喂料**；忘了喂，要么编不过，要么安静地用上默认值。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `class Baby : public Purr, public Knead { ... };` | 照着两张图纸一起画 —— 两样本事都到手 |
| `class Purr : Cat { ... };` | **漏了 `public`** —— 上一阶段那一跤，两张图纸上都不能犯 |
| 出生顺序 | 按写在后面的名单从左到右，**最后才是自己那一半** |
| 拆的顺序 | 正好倒过来：自己那一半先拆，共用的底座最后拆 |
| `b.Purr::meow();` | 岔路口上点路牌：本喵说的是左边那条路上那一份 |
| `b.meow();`（岔路口上） | 两条路都找得到 —— 翻译官喵报 `ambiguous`，程序编不出来 |
| `class Purr : virtual public MeowCat { ... };` | 照着底座画，但**这份底座整只猫只留一份** |
| 两条路只挂一条 | 不管用 —— 那一份共用了，另一条路上还带着自己那份，照样说不清 |
| `Baby(...) : MeowCat(n), Purr(n), Knead(n)` | 共用的底座由最外面那张图纸喂料；里面那两句会被无视 |
| 忘了喂料 | 底座要求喂 → 编不过；底座有默认搭法 → **一声不吭地用默认值** |
| `sizeof` 那两个数 | 两份底座 64、合并成一份 48（本机读数，方向比数字要紧） |

## 小任务

1. 把第二节那段抄进练习场跑一次，数一数「搭一份会喵的底座」印了几遍；再把左右两张图纸里**照着底座画的那一行**各加一个 `virtual`（顺便把 `Baby` 那一行的 `MeowCat(n)` 补上）跑一次，看它变成几遍。`b.Purr::rename("小P")` 那一句留着别删 —— 两次输出一比，你就亲眼看见「两份」和「一份」的差别了。
2. 把第三节那段抄进去，确认翻译官喵真的报 `ambiguous`；然后把 `b.meow()` 换成 `b.Purr::meow();` 和 `b.Knead::meow();` 各一句，看它编不编得过、印出来是什么。**点路牌这一手能救急，但记住它治不了「两份底座」。**
3. 把第五节那段抄进去，然后把 `Baby` 出生招式里 `MeowCat(n)` 那一小段**删掉**再跑一次，把翻译官喵的原话抄进小本本；再给底座添一个什么都不用喂的出生招式，重跑一遍 —— 这回它不吭声了，你猜输出会变成什么？
4. 先猜再跑：把第六节那段里，给底座再添一格 `int weight;`，那两个数会怎么变？先写下你的猜测，再真跑一次对照。想想看：为什么「合并成一份」的那个数**不是**简单地把两份加起来砍一半？

下一课本喵要教你照 X 光：手里只有一张写着「猫」的牌子时，怎么看清屋里住的到底是哪只猫 —— 那一手叫照 X 光看清是哪只猫（`dynamic_cast`）喵～ 🐾
