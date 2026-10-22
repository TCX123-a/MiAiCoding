---
id: cpp-stage2-04
lang: cpp
stage: 2
order: 4
title: 封装与访问控制
tags: [面向对象, 封装, 访问控制]
required: ["cpp-stage2-03"]
crossRefs: []
compare: ["common-10"]
estMinutes: 24
keywords: [private, public, getter, setter, access-control]
---

## 钩子：格子一直敞着，谁都能伸手

上一课收尾的时候，本喵说要给格子**盖上盖子**。先回头看看本喵的图纸 —— 到现在为止，所有格子都写在同一小段字底下：

```text
public:
    string name;
    int fish;
```

`public` 念作「**谁都能碰**」。也就是说，只要手里有一只猫，谁都能写下 `c1.fish = 10;` 把本喵辛苦攒的条数一笔抹掉 —— 本喵甚至还拦不住。这不行喵。

今天本喵要学的是**盖子**：

- 哪些格子**只有图纸自己**碰得着；
- 哪些招式是**留给外人的门**，从门上过的时候要守什么规矩；
- 并且 —— 门开几道、门上立什么规矩，**都由本喵说了算**。

这门手艺在行话里叫「封装（带盖的小鱼干盒）」：小鱼干装进带盖的盒子，盖子开给谁、什么时候开，主人说了算。

## 一、两区：谁都能碰的，和只有图纸自己能碰的

图纸肚子里可以分**区**。每一区的开头写一小段字，说清楚这一区是留给谁的：

- `public:` —— 「**谁都能碰**」的那一区；
- `private:` —— 「**只有图纸自己的招式能碰**」的那一区。

注意这一小段字的形状：`public` / `private` 后面都跟着一个**冒号**，而且这一小段字要**顶格写**，别缩进到里面去。它管到**下一区开始**为止 —— 所以图纸上完全可以有好几块 `public:`、好几块 `private:`，一块一块地盖。

现在本喵把两格家常都挪进 `private:`，只在下面留几道门：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
private:
    string name;
    int fish;

public:
    Cat(string n, int f) : name(n), fish(f) {}

    string getName() const {
        return name;
    }

    int getFish() const {
        return fish;
    }
};

int main() {
    Cat c1("小橘", 3);
    c1.fish = 10;
    cout << c1.getName() << " 有 " << c1.getFish() << " 条" << endl;
    return 0;
}
```

本喵猜有学员要撇嘴：「不就是把 `fish` 藏起来嘛，我照样伸手 —— 看本喵写 `c1.fish = 10;`」。那就写写看。翻译官喵当场就拦下了：

```text
main.cpp:24:8: error: 'int Cat::fish' is private within this context
main.cpp:8:9: note: declared private here
```

翻成猫话：**「这个 `fish` 是 `Cat` 的 `private` 格子，你现在站的这个地方碰不着它 —— 它是在第 8 行那里被盖上盖子的。」**（`context` 就是「你现在站的这个地方」。）

注意翻译官喵说的是 `private`（私有），而且它后面还贴心地补了一句：

```text
main.cpp:24:8: note: field 'int Cat::fish' can be accessed via 'int Cat::getFish() const'
```

念作：**「想碰 `fish`？隔着 `getFish()` 那道门。」** 翻译官喵连门都替你指出来了喵。

那把伸手改成走门，同一张图纸就顺着跑了：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
private:
    string name;
    int fish;

public:
    Cat(string n, int f) : name(n), fish(f) {}

    string getName() const {
        return name;
    }

    int getFish() const {
        return fish;
    }
};

int main() {
    Cat c1("小橘", 3);
    cout << c1.getName() << " 有 " << c1.getFish() << " 条" << endl;
    return 0;
}
```

```text
小橘 有 3 条
```

**盖子不是不让用，是不让乱碰。** 要几号格子里的数，就走对应的那道门。

这一段就两件事：**伸手被拦**和**走门进去了**。本喵把它拆成一步一步，走给你看：

```demo
title: 哪些格子伸手就挨拦，哪些格子隔着门进得去
code:
| Cat c1("小橘", 3);
| c1.fish = 10;
| cout << c1.getName() << " 有 " << c1.getFish() << " 条" << endl;

step 生小橘：图纸自己的招式碰 private 格子不受限
at: 1
say: `Cat c1("小橘", 3);` 落地，出生招式跑起来。它是**图纸自己的招式** —— 伸手碰 `private:` 那一区的 `name`、`fish` 一点不受限制。盖子挡的**只是外面的手**，自己人照样随便碰。
meow: 自己人碰自己的格子，不叫乱碰～
pose: expect
走到哪一行了 = 第 1 行 · 生小橘
这一次够的是 = c1 那两格（图纸自己的招式在碰）
这一步的结果 = 两格都装好了

step 从外面直接伸手：被拦住了
at: 2
say: 学员不服气，非要从外面直接够：`c1.fish = 10;`。翻译官喵当场拦下 —— `error: 'int Cat::fish' is private within this context`。**注意它不是「悄悄把数改掉了」：这一步程序根本编不过，一行都跑不了。**
meow: 前门锁着呢，手伸不进去喵！
pose: think
走到哪一行了 = 第 2 行 · 伸手够 c1.fish
这一次够的是 = c1.fish（private 格子）
这一步的结果 = 被拦下（编译不过）

step 报错底下：翻译官喵把门指了出来
at: 2
say: 报错下面还跟着一句 `note: field 'int Cat::fish' can be accessed via 'int Cat::getFish() const'` —— 念作「**想碰 `fish`？隔着 `getFish()` 那道门**」。盖子锁着的那一格，门是开着的，报错连门都替本喵指了出来。
meow: 报错里连门都替你指出来啦！
pose: yay
走到哪一行了 = 第 2 行 · 报错顺手把门指了
这一次够的是 = c1.fish（private 格子）
这一步的结果 = 报错说：隔着 getFish() 那道门

step 收手改走门：先问名字
at: 3
say: 把伸手那一行**删掉**，改走 `getName()` 那道门。门里那几句是图纸自己的招式，碰 `name` 格子不受限制，把「小橘」原样叼出来。**走门不是绕开盖子，是从主人开的门进去。**
meow: 走门就进得去啦！
pose: busy
走到哪一行了 = 第 3 行 · 走两道门
这一次够的是 = c1.getName()（公开的门）
这一步的结果 = 门里叼回「小橘」

step 再走第二道门：把数叼回来
at: 3
say: 同一个 `cout` 接着走 `getFish()` 那道门，门里那句 `return fish;` 把 3 叼回来；行尾 `endl` 一加，整行落定 —— `小橘 有 3 条`。从头到尾，外面一次都没碰着格子。
meow: 两道门都走通了喵！
pose: proud
走到哪一行了 = 第 3 行 · 走两道门
这一次够的是 = c1.getFish()（公开的门）
这一步的结果 = 门里叼回 3 → 印出「小橘 有 3 条」
```

**看住这个对比就不会再晕**：同样是想碰 `fish`，「从外面伸手」当场编不过，「走 `getFish()` 那道门」就顺顺当当 —— 差别不在格子，在**手是从哪儿伸的**：图纸自己的招式（出生招式、门里那几句）随便碰，外面的手只能走门喵。

::: tip 猫咪提示
`private:` / `public:` 这类小段字，行话叫**访问控制** —— 「访问」就是「伸手过去碰」，`public` 是敞着的，`private` 是盖上盖子的。**图纸的招式里可以随便碰自己图纸上的任何格子**（哪怕它在 `private:` 里），盖上盖子挡的只是**外面**的手。
:::

## 二、留两道门：问数的，和改数的

上一节那两道门干的是同一件事 —— 把格子里的东西**原样递出来**。这样的门有个绰号叫 getter（念「盖特」），本喵叫它**问数的招式**：名字通常是 `get` 加上格子名，肚子里只有一句 `return`，尾巴上带 `const`（上一课说过：只看看、不动格子）。

可只有问数的门，猫就只能是死的。要改数，就得再开一道**改数的招式** —— 绰号 setter（念「塞特」），名字通常是 `set` 加格子名，收一个投喂口，把格子改成它。

关键在**门里那句规矩**。改数的招式是本喵亲手写的，所以本喵可以在门里立规矩 —— 比如「条数不许是负数」：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
private:
    string name;
    int fish;

public:
    Cat(string n, int f) : name(n), fish(f) {}

    int getFish() const {
        return fish;
    }

    void setFish(int f) {
        if (f < 0) {
            cout << "不许倒扣喵" << endl;
            return;
        }
        fish = f;
    }
};

int main() {
    Cat c1("小橘", 3);
    c1.setFish(5);
    cout << c1.getFish() << endl;
    c1.setFish(-2);
    cout << c1.getFish() << endl;
    return 0;
}
```

```text
5
不许倒扣喵
5
```

第二回投喂的是 `-2`，门上那句 `if (f < 0)` 把它挡在外面，格子里的数稳稳停在 `5` 上 —— 这就是**盖子真正的价值**：不是把格子藏起来好看，而是让**每一次改动都必须经过本喵立的规矩**。

要是门上不立规矩呢？那这道门就是白开的。把 `setFish` 里的守卫拿掉，改成 `fish = f;`，同一份 `main` 就会这样：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
private:
    string name;
    int fish;

public:
    Cat(string n, int f) : name(n), fish(f) {}

    int getFish() const {
        return fish;
    }

    void setFish(int f) {
        fish = f;
    }
};

int main() {
    Cat c1("小橘", 3);
    c1.setFish(-2);
    cout << "现在有 " << c1.getFish() << " 条" << endl;
    return 0;
}
```

```text
现在有 -2 条
```

**它编得过、跑得动，而且本喵拿最啰嗦的那档念叨（`-Wall`）真跑过一遍 —— 翻译官喵一个字都没说。** 负数的条数就这么安安静静地住进了 `private` 的格子里。

这件事值得记在小本本上：**盖子本身不检查对错，规矩才是**。格子藏得再深，只要门开得没规矩，外面的人照样能把荒唐的数字递进来。所以 private 和 getter / setter 是**一对儿**用的 —— 少了门里的规矩，盖子就只是个装饰。

### 问数的招式，得把数**叼回来**

还有个小地方容易写歪：`getFish` 前面那个 `int`。它是说「这一招会把一个整数**叼回来**给喊它的人」。喊它的人拿这个数去印、去算，都行。要是把它写成 `void`，这一招就变成「只在自己肚子里印一行字」的了 —— 那时候再想让它把数交给别人，翻译官喵就不认了：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
private:
    string name;
    int fish;

public:
    Cat(string n, int f) : name(n), fish(f) {}

    void getFish() const {
        cout << "格子里的数是 " << fish << endl;
    }
};

int main() {
    Cat c1("小橘", 3);
    cout << "本喵的账：" << c1.getFish() << endl;
    return 0;
}
```

```text
main.cpp:20:26: error: no match for 'operator<<' (operand types are 'std::basic_ostream<char>' and 'void')
```

念作：**「你要我把一个 `void` 印出来 —— `void` 是「啥都没叼回来」，它装不进 `<<` 的右半边。」** 看到 `no match for 'operator<<'`，先低头看看 `<<` 右边那一招**前面写的是什么**：写了 `void` 的招式，只能**自己喊**，不能塞进 `<<` 里。

一句话记住：**问数的招式前面写类型（它叼数回来），改数的招式前面写 `void`（它只干活，不叼东西回来 —— 格子改好了就是它的成果）。**

## 三、还有一档盖子：`protected`

盖子其实有**三档**，本喵已经认了前两档：

| 那一小段字 | 谁能碰 |
|---|---|
| `public:` | 谁都能碰 |
| `private:` | 只有图纸自己的招式能碰 |
| `protected:` | 只有图纸自己的招式 —— **以及「套着这张图纸」的下级图纸**能碰 |

第三档 `protected` 是为**图纸套图纸**准备的：有些格子本喵不想让外人碰，但想留给「照这张图纸再画一张更细的图纸」时用。图纸套图纸是后面某一课的正题，今天先认个脸就行 —— 但它的**下半句**今天就要记住：对外人来说，它和 `private` 一样碰不得。

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
protected:
    string name;
    int fish;

public:
    Cat(string n, int f) : name(n), fish(f) {}
};

int main() {
    Cat c1("小橘", 3);
    cout << c1.fish << endl;
    return 0;
}
```

```text
main.cpp:16:16: error: 'int Cat::fish' is protected within this context
main.cpp:8:9: note: declared protected here
```

翻译官喵的话和前面几乎一模一样，只是把 `private` 换成了 `protected`。**`protected` 不是「半开着的门」**，外面照样伸手就挨拦。

## 四、本喵今天记住的三句话

::: tip 猫咪提示
1. **盖子分三档**：`public:` 谁都能碰、`private:` 只有图纸自己的招式能碰、`protected:` 对图纸自己和「套着它的下级图纸」开，对外人一样碰不得。这些字后面**都带冒号**，而且管到下一区为止。
2. **盖子配门才成事**：问数的招式（`getXxx`，尾巴带 `const`，肚子里一句 `return`）＋ 改数的招式（`setXxx`，收一个投喂口）。**规矩立在门里**，盖子才有意义。
3. **招式前面那个词要说实话**：要叼个数回来就写类型（`int`），只干活不叼东西就写 `void`。`void` 的招式塞不进 `<<`。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `private:` | 盖上盖子：只有图纸自己的招式碰得着 |
| `public:` | 敞着：谁都能碰 |
| `protected:` | 留给「套着它的下级图纸」的那一档，对外人一样碰不得 |
| `c1.fish = 10;`（格子是 private） | 外面伸手 —— 翻译官喵拦下：`is private within this context` |
| `int getFish() const { return fish; }` | 问数的门：把格子里的数**叼回来** |
| `void setFish(int f) { ... }` | 改数的门：只干活、不叼东西回来 |
| `if (f < 0) { ... return; }` | 立在门里的规矩 —— 盖子真正的价值在这儿 |
| `void getFish() const` | 只在自己肚子里印字，叼不回数 —— 塞进 `<<` 会挨 `no match for 'operator<<'` |

## 小任务

1. 把第一节里那个 `private:` 改成 `public:`，真跑一次 —— 报错是不是就没了？然后再改回 `private:`，再跑一次。**这一来一回是本课最省事的一次实验**：你亲眼看见盖子确实在起作用。
2. 给第一节的图纸添一道门 `void setName(string n)`（肚子里写 `name = n;`），把它也写进 `main` 里喊一次，看看名字改得动还是改不动。
3. 本喵在 `setFish` 门上立了「不许是负数」，你再加一条：**条数超过 99 也不许**（提示：`if (f > 99)` 怎么写，守卫那句就照着抄）。写完真跑一次，各投喂 `5`、`-2`、`120` 试试。
4. 把 `getFish` 尾巴上那颗 `const` 拿掉，然后生一只**带封印的猫**（`const Cat`）去喊它 —— 看看翻译官喵说什么。这是上一课学过的东西，你要能自己预测出它会说 `discards qualifiers` 才算真学会。
5. 想一想：本喵把 `name` 和 `fish` 都盖上盖子之后，**外面还剩几条路能碰到它们**？把能走的路一条条念出来（那两道门 + 出生招式）。再想一想：要是 `getFish` 里那句 `return fish;` 被本喵改成了 `return fish + 1;`，外面的人**看得出来**吗？——这个小实验留给你自己跑。

下一课，本喵要让图纸上出现**一份「所有猫共用」的格子**：不管生了多少只猫，它只有一份，谁都能看到它、改它。它到底归哪只猫？又该怎么数清楚一共有多少只猫？去下一课探险喵～ 🐾
