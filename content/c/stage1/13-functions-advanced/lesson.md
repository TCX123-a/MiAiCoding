---
id: c-stage1-13
lang: c
stage: 1
order: 13
title: 函数进阶——投喂方式与作用域
tags: [函数, 作用域, 参数传递, 函数声明]
required: ["c-stage1-12"]
crossRefs: []
estMinutes: 25
keywords: [scope, prototype, global, pass-by-value]
---

上一课你立起了第一招：写一次、喊一次、把战利品叼回来。招式能用了，可它身上还有两个脾气你没摸清 ——

- **「我喂进去的那条小鱼干，招式里给改了，我外面那份会不会跟着变？」**
- **「招式里摆的那些碗，出了招式的门还算数吗？」**

这两个问题听着像小事，其实是 C 脾气里最要命的一环。今天一次说清喵。

## 一、喂进去的，是抄件不是原件

先看一段让你心里发毛的代码：

```c
#include <stdio.h>

void feed(int n) {
    n = n + 1;
    printf("招式里：%d\n", n);
}

int main(void) {
    int fish = 5;
    feed(fish);
    printf("main 里：%d\n", fish);
    return 0;
}
```

```text
招式里：6
main 里：5
```

看仔细喵：招式里那只碗明明被加成了 `6`，可回到 `main` 一印，`fish` 还是 `5`。

**为什么？因为你喂进去的从来不是原件，是一张抄走的纸条。**

喊 `feed(fish)` 的那一瞬间，翻译官喵干了三件事：

1. 看一眼 `fish` 碗里装的是几 —— 是 `5`；
2. 抄一张纸条写上 `5`，把**纸条**投进招式里那只碗 `n`；
3. 招式接下来拿着纸条折腾，跟 `main` 里那只 `fish` 碗**再无任何关系**。

所以招式里那句 `n = n + 1` 改的是纸条。你那只碗在 `main` 里睡得好好的，一点没动。

这条规矩有个正式名字，叫「抄件（按值传递）」——**喂进去的是「值」，不是「碗」**。

本喵把那一声 `feed(fish)` 拆成一步一步，走给你看：

```demo
title: 喊一声招式，外面那只碗为什么没跟着变
code:
| void feed(int n) {
|     n = n + 1;
|     printf("招式里：%d\n", n);
| }
| int main(void) {
|     int fish = 5;
|     feed(fish);
|     printf("main 里：%d\n", fish);
| }

step main 里先摆好自己那只碗
at: 6
say: `int fish = 5;` 先在自己家里摆一只碗，贴上 `fish`，装上 5。这会儿招式还没被喊，`feed` 里一只碗都还没摆出来。
meow: 喵～外面那只碗先装满 5 条！
pose: expect
main 里的 fish = 5
招式里的 n = 还没摆
屏幕上 = 还没印

step 喊一声 feed(fish)：先瞄一眼里面是几
at: 7
say: 这一行是喊招式。翻译官喵先看括号里那条小鱼干 —— 报名字 `fish`，把碗里的数叼出来：**是 5**。
meow: 喊一嗓子，叼回来的是 5！
pose: busy
main 里的 fish = 5
招式里的 n = 还没摆
屏幕上 = 还没印

step 抄一张纸条，投进招式里那只碗
at: 7
say: 接下来端进去的**不是那只碗**，是一张写着 5 的纸条。招式里现摆一只崭新的碗 `n`，纸条投进去 —— 里面躺着的这个 5 是**抄件**。从这一刻起，两只碗各归各。
meow: 抄件投进去，两只碗从此不相干～
pose: busy
main 里的 fish = 5
招式里的 n = 5（抄件）
屏幕上 = 还没印

step 招式里那只碗自己加一
at: 2
say: 招式里这句 `n = n + 1` 改的是**招式里那只 n 碗**：5 加 1 得 6，装回去。**注意：外面那只 `fish` 从头到尾没被碰过，还是 5。**
meow: n 变成 6 啦，外面那碗睡得香～
pose: busy
main 里的 fish = 5
招式里的 n = 6
屏幕上 = 还没印

step 招式里喊一声，印出 6
at: 3
say: 这句 `printf` 印的是招式里那只 `n` 碗 —— 屏幕上出现「招式里：6」。这个 6 只在招式里成立，它是那张纸条上的数。
meow: 印出来是 6，跟外面没关系喵！
pose: yay
main 里的 fish = 5
招式里的 n = 6
屏幕上 = 招式里：6

step 招式收工：n 这只碗就地撤走
at: 4
say: 招式那块大括号一合，招式里现摆的那一套碗**立刻撤走** —— `n` 没了，它只在招式里活着。下次再喊 `feed`，里里外外是**崭新的一只 n**，不记得这次装过 6。
meow: n 跟着招式一起收摊，一点不留～
pose: busy
main 里的 fish = 5
招式里的 n = 撤走了
屏幕上 = 招式里：6

step 回到 main，印的是自己那只碗
at: 8
say: 控制权回到刚才喊招式的那一行，接着往下跑。这句 `printf` 印的是 **main 自己那只 `fish`** —— 它睡到现在，还是 5。
meow: 外面那只原封不动，还是 5 喵～
pose: expect
main 里的 fish = 5
招式里的 n = 撤走了
屏幕上 = 招式里：6 ／ main 里：5

step 大括号一合，整段收工
at: 9
say: 程序跑完，屏幕上两行：招式里 **6**、main 里 **5**。差别就在投进去的是抄件还是原件 —— 课文第二节那排猫粮碗是唯一的例外，整排碗交出去的是「碗架在哪儿」，招式里一改，外面真的会变。
meow: 抄件改了不算数，原件才作数喵！
pose: proud
main 里的 fish = 5
招式里的 n = 撤走了
屏幕上 = 招式里：6 ／ main 里：5
```

**一句话收口**：招式里那只碗里躺的是**抄件**，怎么改都改不到外面那只原件；而招式的大括号一合，招式里那一套碗连同抄件一起撤走 —— 下一声喊，又是崭新的一套。

::: tip 一句话记住喵
招式里改了不算数，因为它改的是抄件。想让外面真的变，得另外想办法（下一课的主角就是它）。
:::

## 二、唯一的例外：整排猫粮碗交出去的是原件

那是不是所有东西喂进去都是抄件？**不是。有一样东西是例外，而且你一定要记住它。**

```c
#include <stdio.h>

void treat(int bowl[], int count) {
    int i;
    for (i = 0; i < count; i++) {
        bowl[i] = bowl[i] * 10;
    }
}

int main(void) {
    int bowl[3] = {1, 2, 3};
    treat(bowl, 3);
    printf("%d %d %d\n", bowl[0], bowl[1], bowl[2]);
    return 0;
}
```

```text
10 20 30
```

咦？这一趟明明也是喊招式，招式里也没写 `return`，怎么 `main` 里那排碗**真的被改了**？

因为**一整排碗太重了，抄一份太贵**。几百只碗挨个抄一遍，喊一次招式就这么折腾，太笨了喵。C 在这里换了做法：交出去的不是抄件，而是**「这排碗架在哪儿」这个信息** —— 招式拿着这个信息，就能直接走到那一排碗前面，伸手去动**你自己的原件**。

所以 `treat(bowl, 3)` 里那句 `bowl[i] = bowl[i] * 10` 改的是你本人的碗，出来一看，全变成十倍了。

::: warn 这条区别会一直跟着你喵
- **单个的碗**（整数、字符这种小东西）→ 喂进去是**抄件**，招式里改了，外面不变。
- **整排的碗** → 交出去的是**「碗架在哪儿」**，招式里改了，外面**真的会变**。

今天你只要记住这个结论就行。至于「碗架在哪儿」这条信息到底是什么东西、该怎么写下来 —— 那是下一课的主角：一张**猫爪指向牌**。本喵先卖个关子喵～
:::

## 三、招式自己的碗

第二个问题：招式里摆的碗，出了门还算数吗？先看两只招式抢名字：

```c
#include <stdio.h>

int doubleIt(int n) {
    n = n * 2;
    return n;
}

int square(int n) {
    n = n * n;
    return n;
}

int main(void) {
    printf("%d\n", doubleIt(4));
    printf("%d\n", square(4));
    return 0;
}
```

```text
8
16
```

两只招式里都摆了一只叫 `n` 的碗，名字撞上了，翻译官喵却一点都不生气。凭什么？

因为**招式里的碗，地盘只在招式内部**。每喊一次招式，就在招式里**现摆**一套崭新的碗；招式一收工，整套碗立刻撤走。两个不同的招式各摆各的，谁也看不见谁。

连和外面的碗撞名字也不怕，照样跑：

```c
#include <stdio.h>

void feed(int fish) {
    fish = fish + 1;
    printf("招式里：%d\n", fish);
}

int main(void) {
    int fish = 5;
    feed(fish);
    printf("main 里：%d\n", fish);
    return 0;
}
```

```text
招式里：6
main 里：5
```

招式里那只 `fish` 和 `main` 里那只 `fish`，名字一样、**其实是两只完全不同的碗**。招式里改的是它自己那只，外面那只纹丝不动 —— 结果和第一段的 `n` 一模一样。

这套「谁看得见谁」的规矩，正式叫法是地盘（作用域）。

那反过来呢？**招式收工后，外面能不能喊招式里那只碗？**

```c
#include <stdio.h>

void make(void) {
    int n = 7;
}

int main(void) {
    printf("%d\n", n);
    return 0;
}
```

```text
main.c:8:20: error: 'n' undeclared (first use in this function)
    8 |     printf("%d\n", n);
```

翻译官喵说：`'n' undeclared` —— 也就是「`n` 这个名字本喵没登记过」。

`n` 只在 `make` 那间屋子里挂了号。站在 `main` 里喊它，等于跑到别人家门口喊自己家猫的名字，谁也听不懂喵。**招式里的碗，只在招式里活着。**

## 四、摆在门口的大缸

有些东西偏偏**就该让所有招式都看得见** —— 比如「今天一共发出去多少条小鱼干」，每喊一招就往上涨一点。

那就别把它放在谁家里，摆在**大门口**：写在所有招式的外面。

```c
#include <stdio.h>

int fishCount = 0;

void addOne(void) {
    fishCount = fishCount + 1;
}

void addThree(void) {
    fishCount = fishCount + 3;
}

int main(void) {
    addOne();
    addThree();
    printf("大缸里现在有 %d 条\n", fishCount);
    return 0;
}
```

```text
大缸里现在有 4 条
```

这个摆在门外的 `fishCount`，两只招式都能看见、都能往里伸手。喊完 `addOne()` 再喊 `addThree()`，大缸里就攒到了 `4`。

这种摆在所有招式门外的仓库，正式叫法是大缸（全局变量）。它有两个和「招式里的碗」正好相反的脾气：

**脾气一：不写初值，翻译官喵自动给你装 0。**

```c
#include <stdio.h>

int total;

int main(void) {
    printf("%d\n", total);
    return 0;
}
```

```text
0
```

注意：这一条**只对门口的大缸成立**。招式里的碗要是不写初值，里面装的是上一次谁用剩的垃圾，印出来是什么全看运气 —— 这种「结果不稳定」的东西本喵没法给你演示，只能提醒你：**招式里的碗，一律自己写上初值。**

**脾气二：和招式里的碗撞名字时，招式里的那只赢。**

```c
#include <stdio.h>

int fish = 10;

int main(void) {
    printf("大缸里：%d\n", fish);
    int fish = 3;
    printf("自己的碗里：%d\n", fish);
    return 0;
}
```

```text
大缸里：10
自己的碗里：3
```

第一行印的时候，本喵自己那只 `fish` 还没摆出来，所以看到的是大缸里的 `10`。第二行前面刚写了 `int fish = 3;` —— 从这一行起，这条街上再说 `fish`，都指**自己的碗**，大缸里那 `10` 被挡在后头了。

::: warn 大缸很方便，但别乱用喵
它谁都能改，而且「谁在什么时候改的」你根本追不到。今天这两只招式还算乖，要是十几只招式都往同一口缸里伸手，出了错你连从哪儿查起都不知道。

小家伙的规矩：**能用招式里的碗就用碗，大缸只留给真正「所有招式都该看见」的东西。**
:::

## 五、先在门口挂块牌子

还有一条 C 独有的讲究：**招式得先登场，后施展。**

```c
#include <stdio.h>

int main(void) {
    printf("%d\n", add(2, 5));
    return 0;
}

int add(int a, int b) {
    return a + b;
}
```

```text
main.c:4:20: error: implicit declaration of function 'add' [-Wimplicit-function-declaration]
    4 |     printf("%d\n", add(2, 5));
```

翻译官喵一路往下念，念到 `main` 里那句 `add(2, 5)` 时愣住了：**「`add` 是谁？本喵没听过这个名字。」**

C 的脾气是**从上往下念一遍、念到哪儿办到哪儿**：它念到 `add(2, 5)` 的时候，后面那个 `add` 的招式还没有登场，它当然不认识。注意这里和第 11 课那次不一样 —— 那次是忘了请档案管理员，这次是**顺序**的问题。

那是不是非得把招式全塞到 `main` 前面？不用。**先在门口挂块牌子**就行：

```c
#include <stdio.h>

int add(int a, int b);

int main(void) {
    printf("%d\n", add(2, 5));
    return 0;
}

int add(int a, int b) {
    return a + b;
}
```

```text
7
```

牌子长这样：`int add(int a, int b);` —— **把招式头上那一行原样抄一遍，后面加个分号**，招式身体一个字都不写。

这块牌子等于提前跟翻译官喵打了招呼：「后头有个叫 `add` 的招式，要喂两个整数，会叼回一个整数。」等它真念到招式那里，对一下牌子，对得上就直接开张。

牌子的正式叫法是招式招牌（函数声明 / 原型）。

牌子必须和真招式**一字不差地对上**。写歪了会怎样？

```c
#include <stdio.h>

int add(int a, int b);

int main(void) {
    printf("%d\n", add(2, 5));
    return 0;
}

int add(int a, int b, int c) {
    return a + b + c;
}
```

```text
main.c:10:5: error: conflicting types for 'add'; have 'int(int,  int,  int)'
main.c:3:5: note: previous declaration of 'add' with type 'int(int,  int)'
```

`conflicting types` 就是「对不上号」：牌子上说这招收**两只**碗，真招式却摆了三只。翻译官喵两边一对照，当场拦下。

牌子还有个好处：**招式的身体写多长都行，招牌只有短短一行。** 读到 `main` 的时候，一眼就能知道后面有哪些招能用。

## 一句话对照表

| 东西 | 写在哪儿 | 谁看得见 | 喂进去是 |
|---|---|---|---|
| 招式里的碗 | 招式的大括号里面 | 只有这一招 | —— |
| 门口的大缸 | 所有招式的外面 | 所有招式 | —— |
| 单个的小东西喂进招式 | —— | —— | **抄件**，改了外面不变 |
| 整排的碗交进招式 | —— | —— | **碗架在哪儿**，改了外面真的变 |

## 小任务

1. 把第一段那段代码亲手跑一遍。然后把招式里那句改成 `n = n + 100;`，再跑一次 —— 猜猜 `main` 里印出来是几？（剧透：还是 `5`，因为它改的是抄件。）
2. 第三段最后那段代码跑完之后，把 `make` 里那句 `int n = 7;` **挪进 `main`**（写在 `printf` 前面），再跑一次。这次能印出来吗？想想为什么换个地方住就活了。
3. 给大缸那段代码加一招 `addFive`，一次往大缸里放 `5` 条，然后在 `main` 里连喊 `addOne()`、`addFive()` 各一次，看看大缸最后是几条。
4. 把第 5 段最后那段代码的招牌改成 `int add(int a);`（少写一只碗），跑一次，看看翻译官喵会不会拦下来。
