---
id: common-26
lang: common
stage: 0
order: 23
title: 从租仓库到请猫入住——malloc 与 new 的分水岭
tags: [面向对象, 内存]
required: ["common-25"]
crossRefs: ["c-stage2-04","cpp-stage1-11","java-stage3-18"]
estMinutes: 17
keywords: [malloc, new, free, delete, gc]
---

## 钩子：本喵租的仓库里，坐着的不是猫

上一课，本喵给「递牌子」这门老手艺找了个温柔的接班人 —— 它给碗再挂一个名字，不写 `*`，照样把外面那只碗改到位喵。

可今天这件事，那位接班人管不着。本喵要给猫窝添一只新猫「小橘」，先在 C 那边的老办法里打了个转：**现要现租的仓库**（`malloc`）。地方是租回来了，本喵往里一瞧 —— **坐着的不是猫**：

名字那格写着一串谁也不认识的字，鱼干数那格是个看不出意义的数。它们是**上一回**留在这块地方的东西。仓库只是**一块地方**：地方是地方，猫是猫。想让「小橘」住进去，得当着一只猫来请 —— 名字摆好、小鱼干数摆好，它才算数喵。

C++ 那边有一句话，把前后两件事合成了一件：**`new Cat("小橘", 3)`**。说完这一句，地方有了，猫也入住了 —— 本喵都没来得及喊，它自己就来了。

今天就是站在这道**分水岭**上：`malloc` 与 `new`，到底差在哪喵？

## C 的老办法：先租仓库，再手动请猫

C 那边的家伙什，本喵先摆出来：仓库是论字节租的（`malloc`），租完叼回来一张**猫爪指向牌**；还仓库的招式叫 `free`。这一回要住的不是一排整数，是一只猫 —— 图纸（`struct`）先画好，再照它请一只喵：

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char name[20];
    int fish;
} Cat;

void cat_init(Cat *p, char name[], int fish) {   /* 请猫进门：本喵自己写的一招 */
    strcpy(p->name, name);
    p->fish = fish;
    printf("%s：本喵出生啦\n", p->name);          /* 报到这一声，也得自己写 */
}

void cat_say(Cat *p) {
    printf("%s：本喵有 %d 条小鱼干\n", p->name, p->fish);
}

int main(void) {
    Cat *p = (Cat *)malloc(sizeof(Cat));         /* 只租到一块地方 */
    if (p == NULL) {
        return 1;
    }
    cat_init(p, "小橘", 3);                      /* 手动把猫请进去 */
    cat_say(p);
    free(p);                                     /* 还仓库 */
    p = NULL;                                    /* 牌子擦干净 */
    return 0;
}
```

```text
小橘：本喵出生啦
小橘：本喵有 3 条小鱼干
```

这一版里，**每一件事都是本喵亲手办的**，一句一句看喵：

- **`(Cat *)malloc(sizeof(Cat))`** 只办「租地方」这一件事：先拿 `sizeof(Cat)` 量出一只猫该占多大，再向系统租一块这么大的地方。叼回来的牌子是张**没写牌面的万能牌**（行话 `void *`）—— 是那个 `(Cat *)` 强转把牌面补成「指着装 `Cat` 的仓库」。
- **租到手这一刻，里面还不是猫** —— 名字格、鱼干数格里坐着的，是上任租客留下的东西。地方有了，猫还没有。
- **`cat_init(p, "小橘", 3);`** 是「请猫进门」这一步，本喵自己写、自己喊：把名字抄进 `name` 格、把数写进 `fish` 格；连那声「本喵出生啦」，也是本喵在里面亲手 `printf` 的 —— C 不会替你做任何一步喵。
- **`cat_say(p);`** 报数这一招站在图纸**外面**，得把牌子喂进去，它才知道跟哪只猫说话。
- **`free(p);`** 用完还回去，再把牌子擦成 `NULL` —— 老规矩：还完不擦，顺手一用就摸到不再属于你的地方。
- 要是把 `cat_init` 那一行删掉？名字格就一直是那串不认识的东西 —— **具体印出什么，每台机器都不一样**。那不是猫，那是一块「还没有猫」的地方。

看出来了吗喵：请一只 C 的猫入住，本喵得办三件事 —— **量尺寸写牌面**（`sizeof` ＋ 强转）、**请猫**（`cat_init`）、**还账**（`free`）。哪一件忘了，都没人提醒你。

## C++ 的新办法：`new` 一喊，猫自己入住

同一件事搬到 C++，本喵是这么写的喵：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    int fish;

    Cat(string n, int f) {              /* 出生那一招 */
        name = n;
        fish = f;
        cout << name << "：本喵出生啦" << endl;
    }

    ~Cat() {                            /* 回窝那一招 */
        cout << name << "：本喵回窝啦" << endl;
    }

    void say() {
        cout << name << "：本喵有 " << fish << " 条小鱼干" << endl;
    }
};

int main() {
    Cat* p = new Cat("小橘", 3);        /* 一句：请猫入住 */
    p->say();
    delete p;                           /* 一句：送猫回窝 + 还地方 */
    return 0;
}
```

```text
小橘：本喵出生啦
小橘：本喵有 3 条小鱼干
小橘：本喵回窝啦
```

盯住 `new Cat("小橘", 3)` 这一句 —— **它一句话藏着两下**：

1. **照图纸租地方。** 该租多大由 `Cat` 这张图纸说了算，本喵一句 `sizeof` 都没写；叼回来的牌子本身就是 `Cat*`，也不用强转补牌面。它还顺手核对了一遍：这张图纸上有没有一招接得住「名字 ＋ 3」这对料？接不住当场拦下（写成 `new Cat(3)` 连编译都过不去）—— 行话管这叫**类型安全**。
2. **把出生那一招叫来跑。** 地方一到手，`new` 立刻把图纸上那招「出生」叫来 —— 名字、数当场装好，还替本喵打印了一声「本喵出生啦」。**main 里没有任何一句在喊它** —— 它是 `new` 自己叫来的喵。

`delete p;` 也是两下：先把「**回窝那一招**」叫来跑（屏幕上最后一声「本喵回窝啦」就是它），**然后**那间屋才真的还回去。对照 C：那边对应的只有 `free` 一下 —— 只有「还地方」，「回窝」这个角色压根不存在。

行话里，出生那一招叫**构造函数（出生招式）**，回窝那一招叫**析构函数（收尾招式）**。它们为什么会被自动叫、怎么写、一张图纸上能写几个 —— 那是下一课的戏，今天你只要认下这一点：**你没喊，它们真的会自己跑**。

于是那道分水岭，一句话说清：

> **`malloc` 管的是「有没有地方」；`new` 管的是一只猫的一生 —— 出生、住下、回窝。**

前一句的行话叫「内存管理」；升级后的这一句，叫**对象生命周期管理（从出生到回窝）** —— 今天你就是站在这句话上的喵。

## 四位翻译官喵，请同一只小橘

同一件事：请一只叫「小橘」的猫、带 3 条小鱼干，让它报到喵。

```compare
c::
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char name[20];
    int fish;
} Cat;

void cat_init(Cat *p, char name[], int fish) {
    strcpy(p->name, name);
    p->fish = fish;
    printf("%s：本喵出生啦\n", p->name);   /* 这一声，得亲手写 */
}

void cat_say(Cat *p) {
    printf("%s：本喵有 %d 条小鱼干\n", p->name, p->fish);
}

int main(void) {
    Cat *p = (Cat *)malloc(sizeof(Cat));   /* 租一间仓库 */
    cat_init(p, "小橘", 3);                /* 手动请猫 */
    cat_say(p);
    free(p);                               /* 还仓库 */
    return 0;
}

cpp::
#include <iostream>
#include <string>
using namespace std;

class Cat {
public:
    string name;
    int fish;

    Cat(string n, int f) {
        name = n;
        fish = f;
        cout << name << "：本喵出生啦" << endl;
    }

    void say() {
        cout << name << "：本喵有 " << fish << " 条小鱼干" << endl;
    }
};

int main() {
    Cat* p = new Cat("小橘", 3);   /* 请猫入住：出生那一招自己跑 */
    p->say();
    delete p;                      /* 还回去 */
    return 0;
}

java::
class Cat {
    String name;
    int fish;

    Cat(String n, int f) {
        name = n;
        fish = f;
        System.out.println(name + "：本喵出生啦");
    }

    void say() {
        System.out.println(name + "：本喵有 " + fish + " 条小鱼干");
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘", 3);   // 口令也叫 new
        c.say();
        // 没有 free，也没有 delete
    }
}

python::
class Cat:
    def __init__(self, name, fish):
        self.name = name
        self.fish = fish
        print(f"{self.name}：本喵出生啦")

    def say(self):
        print(f"{self.name}：本喵有 {self.fish} 条小鱼干")

cat = Cat("小橘", 3)   # 连 new 都不用写
cat.say()
# 也没有 free / delete
```

```text
小橘：本喵出生啦
小橘：本喵有 3 条小鱼干
```

四边屏幕上印的头两行**一模一样**，可第一行「出生啦」**是怎么来的**，差得远了喵：

- **C**：这一声是 `cat_init` 里那句**手写的 `printf`** —— 不写就没有；两格也是手动装的；用完 `free(p);`，一句都不少。
- **C++**：这一声是 `new` 自己把**出生那一招**叫来的 —— 本喵一个字都没写「出生」。这段里 `delete p;` 也在（租来的要还）；这张图纸没写回窝那一招，所以它还不出声 —— 别急，下一段拆步里本喵让它出声给你听。
- **Java**：口令也叫 `new`，出生那一招照样自己跑；可是**没有 `free`、没有 `delete`** —— 院子里养着自动铲屎官（内存回收），谁没人要了它自己来扫（那条线在 java-stage3-18，专门讲它）。
- **Python**：连 `new` 都不用写 —— 喊一声图纸名 `Cat("小橘", 3)`，出生那一招自己跑；也没有还的活，同样是铲屎官看着的。

到这儿，那句「`new` 就是 `malloc` 换个名字」，可以正式判掉了喵：**换名字的话，猫不会自己出声。**

## 走一遍：`new` 与 `delete` 的两声「自己跑」

```demo
title: new 一句话里的两下，与 delete 的两下
code:
| class Cat {
| public:
|     string name;
|     int fish;
|     Cat(string n, int f) {
|         name = n;
|         fish = f;
|         cout << name << "：本喵出生啦" << endl;
|     }
|     ~Cat() {
|         cout << name << "：本喵回窝啦" << endl;
|     }
|     void say() {
|         cout << name << "：本喵有 " << fish << " 条小鱼干" << endl;
|     }
| };
| int main() {
|     Cat* p = new Cat("小橘", 3);
|     p->say();
|     delete p;
|     return 0;
| }

step 图纸先摊开：两格，加三招
at: 1
say: 图纸上一共三招：**出生那一招**（第 5 行）、**回窝那一招**（第 10 行，名字前带一个小波浪 `~`）、**报数那一招**（第 13 行）。这一刻两格都还空着，碗边还没有猫。对照 C：那边的图纸（`struct`）里只有两格，一招都进不去。
meow: 图纸画好了，猫还没来喵～
pose: expect
图纸 Cat = 画好了（两格 + 三招）
小橘 = 还没出生
小橘的仓库 = 还没租
屏幕上 = 还没印

step new 第一下：照图纸租地方
at: 18
say: `Cat* p = new Cat("小橘", 3);` —— 翻译官喵先照图纸算好该租多大，本喵一句 `sizeof` 都没写；然后伸手租回来一间空屋。到这一步为止，C 那边也一样（那句 `malloc`），差别在下半句。
meow: 地方先备好，猫随后到喵～
pose: busy
图纸 Cat = 画好了（两格 + 三招）
小橘 = 还没出生
小橘的仓库 = 租好了（空的 —— 里面还不是猫）
屏幕上 = 还没印

step new 第二下：出生那一招自己来了
at: 5
say: 地方一到手，`new` **立刻**把出生那一招叫来跑 —— main 里没有任何一句在喊它。对照 C：这一步在那边叫 `cat_init(...)`，是**你亲手写、亲手喊**的一招。
meow: 没人喊，它自己就来了喵！
pose: yay
图纸 Cat = 画好了（两格 + 三招）
小橘 = 刚出生，两格还没装
小橘的仓库 = 租好了（空的）
屏幕上 = 还没印

step 两格当场装好
at: 6
say: 出生那一招里，`name = n` 把「小橘」装进名字格；下一行 `fish = f` 把 3 装进鱼干格 —— 投喂进来的料，落进的正是**这只猫自己**的两格。
meow: 名字进去啦，小鱼干数也进去～
pose: busy
小橘 = 两格装好（小橘，3 条）
小橘的仓库 = 租好了（猫住进去了）
屏幕上 = 还没印

step 报到那一声
at: 8
say: `cout << name << "：本喵出生啦"` —— 出生那一招里的打印。**这一声不是 main 里喊出来的**，是图纸上的招式自己跑出来的声音。（对照 C：同一声，是 `cat_init` 里那句亲手写的 `printf`。）
meow: 出生啦！这一声可不是本喵喊的喵～
pose: yay
小橘 = 两格装好（小橘，3 条）
小橘的仓库 = 租好了（猫住进去了）
屏幕上 = 1 行：小橘：本喵出生啦

step 顺着牌子喊它报数
at: 19
say: `p->say()` —— `->` 读作「顺着牌子，去找它指着的那只猫」，再喊它那一招。念的是**它自己**那份数。对照 C：同样的活写成 `cat_say(p)`，得把牌子喂进站在外面的招式里。
meow: 顺着牌子一喊，3 条喵！
pose: expect
小橘 = 两格装好（小橘，3 条）
小橘的仓库 = 租好了（猫住进去了）
屏幕上 = 2 行：出生啦 / 有 3 条小鱼干

step delete 第一下：回窝那一招自己跑
at: 20
say: `delete p;` 一喊，回窝那一招（第 10 行）自己跑起来，印出最后一行。**C 那边没有这一声** —— 「回窝」这个角色，那边压根不存在。
meow: 回窝啦 —— 这一声也是它自己报的喵～
pose: think
小橘 = 回窝了
小橘的仓库 = 马上还回去
屏幕上 = 3 行：出生啦 / 有 3 条 / 回窝啦

step delete 第二下：地方这才真的还了
at: 20
say: 回窝戏唱完，那间屋才真的还回去。注意牌子 `p` **还在本喵手里** —— 顺着它再喊招式，就是摸进已经退租的屋子（C 那边同一条规矩：`free` 完把牌子擦成 `NULL`）。
meow: 地方还掉了，牌子还不许再顺喵～
pose: proud
牌子 p = 还挂着（可它指的地方已经还了）
小橘 = 回窝了
小橘的仓库 = 还回去了
屏幕上 = 3 行（收工）
```

::: tip 猫咪提示
今天守好三句喵：

1. **`malloc` 管地方，`new` 管一只猫的一生** —— 出生那一招与回窝那一招，`new`、`delete` 会自己替你叫。
2. **还账要配对**：`malloc` 配 `free`、`new` 配 `delete`；租一排还一排时写 `delete[]`，后面那对方括号别丢。
3. **Java / Python 没有还的活**：铲屎官（GC）照看；C 与 C++ 里，还的活是你的。
:::

::: warn 小心喵
三个坑，本喵标出来：

- **别在 `malloc` 的仓库上喊招式。** 编译那关可能放行，可里面坐着的不是猫 —— 出生那一招一次没跑过，两格是空的。请猫用 `new`，改回来就好。
- **`delete` 与 `delete[]` 别搭错。** 租一间（`new int(7)`、`new Cat(...)`）用光板的 `delete`；租一排（`new int[3]`）用 `delete[]`。账还要一一对：`new` 出来的别拿 `free` 还、`malloc` 出来的别拿 `delete` 还。更深一层的账先记一眼：C 里 `free` 只管还地方，猫身上要是挂着别家租来的东西（比如它自己租的一串小鱼干），得在 `free` 前自己先清干净 —— 那是后头语言线的戏。
- **还完的牌子别再用。** `delete p;` 之后牌子还在手里，可地方已经还了 —— 顺着它再喊招式，等于摸进已退租的屋子（C 那边同一条规矩：`free` 完擦成 `NULL`）。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `(Cat *)malloc(sizeof(Cat))` | 只租地方：尺寸自己量、牌面（强转）自己补；此刻它还不是猫 |
| `cat_init(p, "小橘", 3);` | 手动请猫：两格自己装，连报到那一声也自己 `printf` |
| `free(p);` | 还仓库（C 的还账方式，还完把牌子擦成 `NULL`） |
| `new Cat("小橘", 3)` | 请猫入住：量尺寸、租地方、叫出生那一招 —— 一句办完，还顺手核对料对不对 |
| `p->say();` | 顺着牌子找到猫，喊它报数 |
| `delete p;` | 先送猫回窝（回窝那一招自己跑），再还地方 |
| Java / Python 那一半 | 只 `new`（Python 连 `new` 都不写），没有还的活 —— 铲屎官在 |

## 小任务

1. **数一数（动脑）**：C 的三件事（量尺寸写牌面、请猫、还账）搬到 C++，本喵只剩两句（`new`、`delete`）。哪几笔是「自动」替你办的？一条条列出来喵。
2. **动手**：把 C++ 那段抄进练习场，先**删掉 `delete p;` 跑一遍**，记下屏幕上几行；再加回来跑一遍 —— 多出来的那一行，是什么时候出现的？
3. **再动手**：把 `cat_init(p, "小橘", 3);` 那一行删掉、原样再跑一遍那段 C，**先猜**屏幕上会印出什么。跑完对一对：那串东西是你写的吗？为什么会这样喵？

下一课，本喵把今天这两声「自己跑」掰开揉碎：那一招到底长什么样、为什么你没喊它也会来、一张图纸上能写几个 —— 《图纸上的第一条说明——构造函数与析构函数》，探险见喵～ 🐾
