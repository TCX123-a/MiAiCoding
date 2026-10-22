---
id: cpp-stage3-14
lang: cpp
stage: 3
order: 18
title: 设计模式入门——前辈猫的套路
tags: [设计模式, 单例]
required: ["cpp-stage3-13"]
crossRefs: []
estMinutes: 28
keywords: [singleton, factory, observer, virtual]
---

## 钩子：老猫眯着眼睛说「这个我见过」

鱼塘边上住着一只毛都白了的老猫。本喵每次碰上麻烦，它都眯着眼睛说一句：「**这个我见过。**」

它说这话是有底气的：年轻时它为了「全塘只留一只管账的猫」吃过大亏 —— 三只猫各记各的账，年底怎么都对不上；也为了「塘里添了新猫、老账本就得重写一遍」熬过夜。后来它把这几手攒成了**几个固定的动作**，做完就不容易再踩坑。

本喵后来发现：别的塘、别的猫，遇到同样的场面，做的也是**同样的动作** —— 这些动作被人起了名字，就叫 **设计模式（前辈猫的套路）**。

这一课不讲玄的，就学三手最常碰面的动作：**全塘只留一只**、**让图纸去接生**、**开饭一喊各家答应**。

## 一、全塘只留一只：独苗图纸

```cpp
#include <iostream>
using namespace std;

class FishBowl {
public:
    static FishBowl& getInstance() {
        static FishBowl only;
        return only;
    }
    void add(int n) { count += n; }
    int count = 0;
private:
    FishBowl() = default;
};

int main() {
    FishBowl& a = FishBowl::getInstance();
    a.add(5);
    FishBowl& b = FishBowl::getInstance();
    b.add(3);
    cout << "a 的碗：" << a.count << endl;
    cout << "b 的碗：" << b.count << endl;
    cout << "是不是同一只：" << (&a == &b ? "是" : "不是") << endl;
    return 0;
}
```

```text
a 的碗：8
b 的碗：8
是不是同一只：是
```

本喵**喊了两次**「把那口碗拿来」（`getInstance()` 就是喊猫过来的那一声），两次拿到的居然是**同一口碗**里的数：`a.add(5)` 和 `b.add(3)` 加在了一块儿，最后是 `8`。最后一行问的是「**这两个名字是不是同一只猫**」，答案是「是」。

凭什么是同一只？看图纸里那两句：

- 招式里面写的是 `static FishBowl only;` —— `static` 在这儿的意思是「**只造一次，造完就留在原地**」。头一次喊它的时候造一只，往后每喊一次，拿到的都是那一只。
- 交回来的形状写的是 `FishBowl&`，那个 `&` 的意思是「**把那只猫本身递出去**」。少了它，程序照样编得过 —— 只是每次递出来的都是**另一只长得一模一样的猫**。

那它到底什么时候出生的？

```cpp
#include <iostream>
using namespace std;

class FishBowl {
public:
    static FishBowl& getInstance() {
        static FishBowl only;
        return only;
    }
private:
    FishBowl() { cout << "（独苗图纸开工，造了一只）" << endl; }
};

int main() {
    cout << "还没喊它" << endl;
    FishBowl::getInstance();
    cout << "喊了一次" << endl;
    FishBowl::getInstance();
    cout << "又喊了一次" << endl;
    return 0;
}
```

```text
还没喊它
（独苗图纸开工，造了一只）
喊了一次
又喊了一次
```

「还没喊它」的时候，那只猫**还没出生** —— 写在招式里的 `static` 是**头一次喊它的时候才造**，不是程序一上来就造。后面喊了两次，却只印了一遍「造了一只」：这就是「全塘只留一只」最硬的凭据。

```cpp
#include <iostream>
using namespace std;

class FishBowl {
public:
    static FishBowl& getInstance() {
        static FishBowl only;
        return only;
    }
private:
    FishBowl() = default;
};

int main() {
    FishBowl mine;
    (void)mine;
    return 0;
}
```

翻译官喵当场拦下：

```text
main.cpp:15:14: error: 'constexpr FishBowl::FishBowl()' is private within this context
main.cpp:11:5: note: declared private here
```

念作「**这只的起手式是私房的，你在这儿造不出来**」。起手式写在 `private:` 底下，就只有图纸自己家里碰得到 —— 外面谁想「自己再造一只」都会被拦住，这就把门关上了。

::: warn 小心喵
**「只造一只」和「只递一只」是两件事。** 图纸里那只猫确实只有一只（`static` 管住了），可要是接货的时候写成 `FishBowl a = ...`（少写那个 `&`），接货的猫**复印一份**带走 —— 程序不报错、不提醒，只是各自捧着各自的碗。本喵当年就是这么把账记岔的：明明只有一口碗，两个地方各加各的。
:::

## 二、让图纸去接生

```cpp
#include <iostream>
#include <memory>
#include <string>
using namespace std;

class Cat {
public:
    virtual string speak() const { return "……"; }
    virtual ~Cat() = default;
};

class FishCat : public Cat {
public:
    string speak() const override { return "小鱼干喵！"; }
};

class BallCat : public Cat {
public:
    string speak() const override { return "毛线球喵！"; }
};

unique_ptr<Cat> makeCat(const string& kind) {
    if (kind == "fish") return make_unique<FishCat>();
    return make_unique<BallCat>();
}

int main() {
    auto c1 = makeCat("fish");
    auto c2 = makeCat("ball");
    cout << c1->speak() << endl;
    cout << c2->speak() << endl;
    return 0;
}
```

```text
小鱼干喵！
毛线球喵！
```

主猫那一句 `makeCat("fish")` 报的只是个**名字**：「给本喵来一只小鱼干猫」。至于小鱼干猫怎么造、要带什么，主猫一件都没提 —— 那都是**接生图纸**肚子里的活儿：

- 底图纸 `Cat` 写着「猫都该会的那一句」（`speak`），两张岔路图纸 `FishCat` 和 `BallCat` 各自把那一句换成自己的。岔路挂在底图纸上的写法是**图纸套图纸**：`class FishCat : public Cat`。
- 接生图纸 `makeCat` 里有一条岔路：报 `"fish"` 就接生小鱼干猫；报别的，兜底接生毛线球猫。
- 交回来那只猫装在 `unique_ptr` 里 —— 第六课那口**会自己收尾的箱子**，放猫的事不用本喵操心。

它省下的是什么？**「塘里添了新猫」这件事被圈在了一个地方**。以后要加一只会唱歌的猫，本喵只在接生图纸里添一条岔路，主猫那边一个字都不用改。

::: warn 小心喵
底图纸那一句上挂着一块牌子 `virtual`，意思是「**这一句各猫各样，走到谁面前就念谁那句**」。牌子要是忘了挂 —— 岔路那边也别写 `override` —— 程序照样编得过，一句抱怨都没有；可到了喊话的时候，全塘念的都是底图纸那句「……」，本喵就傻眼了。这种坑不报错、不提醒，只有一个「看着好像对」的结果。
:::

## 三、开饭一喊，各家答应

```cpp
#include <iostream>
#include <functional>
#include <string>
#include <vector>
using namespace std;

class DinnerBell {
public:
    void listen(function<void(const string&)> ear) {
        ears.push_back(ear);
    }
    void ring(const string& what) const {
        for (auto& ear : ears) ear(what);
    }
private:
    vector<function<void(const string&)>> ears;
};

int main() {
    DinnerBell bell;
    bell.listen([](const string& what) { cout << "咪爱听见了：" << what << endl; });
    bell.listen([](const string& what) { cout << "大肥鱼听见了：" << what << endl; });
    bell.ring("开饭啦");
    return 0;
}
```

```text
咪爱听见了：开饭啦
大肥鱼听见了：开饭啦
```

这一手叫**开饭喇叭**，三件事：

1. `listen(...)` 是**把一只耳朵登记进名单**。登记的不是猫的名字，而是「听见之后要干什么」那一小段 —— 就是第九课学的那种**随身小招式**（`[]{ ... }` 的样子）。
2. `ring("开饭啦")` 是**喊一嗓子**：照着名单从头到尾喊一遍，登记过的耳朵全听得见。
3. 喇叭**不认识**名单上这些耳朵。它只管喊；听见之后要印字、要记账、还是要装没听见，全是耳朵自己的事。

它省下的是什么？**「以后谁想听、想听几只」被圈在了名单里**。想多一只耳朵，在主猫那儿多 `listen` 一次就好，喇叭那一句半句都不用改。

::: warn 小心喵
喊的时候得**从头到尾**喊一遍。本喵有一回手滑，把 `ring` 里那句写成了只喊名单上第一位 —— 程序编得过、跑得也安静，可名单上第二位那只猫一直没吃上饭，饿了一整天。**「登记了」不等于「喊到了」**，这两件事得分开检查。
:::

## 四、前辈猫的套路好在哪

三手动作看着不像一家人，其实干的是**同一件事**：把「以后可能会变的地方」**圈出来，围在一处**。

| 以后可能会变的是…… | 被圈在了哪儿 |
|---|---|
| 塘里添了新猫 | 接生图纸里那条岔路 |
| 谁想听开饭 | 喇叭那份名单 |
| 管账的猫该有几只 | 藏起来的那只独苗 |

圈好之后有两个好处：**一是变的时候只动一处**，别的地方不用跟着提心吊胆；**二是说得出名字**，别的猫一听「开饭喇叭」就知道你要干什么，不用从头解释一遍。

⚠️ 不过套路**不是越多越好**。本喵的鱼塘里只有三只猫的时候，硬上一套「开饭喇叭」反而多绕一层：喊的、听的、名单，三样都得摆在明面上。**先看场面，再挑套路** —— 前辈猫攒下这些，是给「这个场面又来了」的时候用的，不是见谁都摆一套。

## 一句话对照表

| 想干什么 | 怎么写 |
|---|---|
| 让一只猫全塘只留一只 | 招式里写 `static FishBowl only;` |
| 把那只猫本身递出去 | 交回来的形状写上 `&` |
| 不让外面的猫自己再造一只 | 起手式藏在 `private:` 底下 |
| 让图纸替你挑一只猫来造 | `unique_ptr` 接住 + 一条岔路 |
| 对岔路说「这一句各猫各样」 | 底图纸那一句挂上 `virtual` |
| 登记一只耳朵 | `bell.listen([](const string& what) { ... })` |
| 一嗓子喊遍名单 | `for (auto& ear : ears) ear(what);` |

::: tip 猫咪提示

- **三手动作干的是同一件事**：把「以后可能会变的地方」圈出来、围在一处 —— 变的时候只动那一处，而且说得出名字。
- **独苗那张图纸上，两句话各管一头**：招式里的 `static` 管「只造一次」，交回来的形状上那个 `&` 管「把那只猫本身递出去」。
- **「只造一只」和「只递一只」是两件事**：少写那个 `&`，接货的猫就复印一份带走 —— 程序不报错、不提醒，只是各自捧着各自的碗。
- **牌子忘了挂（岔路那边也别写 `override`），程序照样编得过**：到了喊话的时候全塘念的都是底图纸那一句，这种坑只有一个「看着好像对」的结果。
- **套路不是越多越好**：先看场面，再挑套路喵。

:::

## 小任务

1. 把第一节的 `add` 换成两处不同的加法，跑一遍看看最后那口碗里的数对不对得上。
2. 把接货那一行写成 `FishBowl a = ...`（少写一个 `&`），看看「是不是同一只」那行印的是什么。
3. 给接生图纸再添一条岔路：报 `"singing"` 就接生一只会唱歌的猫；报别的还是兜底接生毛线球猫。
4. 给开饭喇叭多登记一只耳朵，看看喊一嗓子会印出几行 —— 再多登记一只，行数变了没有？

下一课本喵要把这一路学来的东西全凑到一块儿：做一个**小图书馆**的管理系统 —— 登记在册、借出去、还回来，再存进小本本里。这一课的三手动作，到时候你会看到它们各自站在哪儿喵～ 🐾
