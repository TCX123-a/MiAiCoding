---
id: c-stage3-12
lang: c
stage: 3
order: 13
title: 可变参数——不限数量投喂的招式
tags: [函数, 标准库]
required: [c-stage3-11]
crossRefs: []
estMinutes: 26
keywords: [stdarg, va_list, va_start, va_arg, vprintf]
---

## 钩子：不知道明天来几只猫

本喵今天要报数：`2 条`、`3 条`、`4 条`……有时候来三只猫，有时候来五只，谁也说不准明天有几只。

按以前的老办法，那是**一个坑一个萝卜**：来三只就写三个投喂。可明天来了五只呢？总不能每多一只就再写一招吧 —— 那本喵得写到明年。

本喵蹲在鱼塘边上，盯着那句天天都在用的招式看了半天：

```c
printf("%d 只猫，一共 %d 条鱼", 3, 9);
```

后头跟着几个，**压根没写在投喂表上**，想跟几个就跟几个喵。今天本喵就要把这一招学到手。

## 一个坑一个萝卜：写死的投喂表

先看看本喵现在的老实法子：

```c
#include <stdio.h>

int fish_total3(int a, int b, int c) {
    return a + b + c;
}

int main(void) {
    printf("三只猫的：%d\n", fish_total3(2, 3, 4));
    return 0;
}
```

```text
三只猫的：9
```

这招老实是老实，可它就是**只能收三份**：想报五只猫的数，得再写一招 `fish_total5`；六只再写一招……投喂表上写死几个，就得喂几个，多一份少一份翻译官喵都不答应。

## 三个点：后头还跟着一串

C 语言给留了个口子：在投喂表**最后一位**写**三个点** `...`，意思是「**后头还跟着一串，几份不好说**」。

本喵把上面那招改成这样：

```c
#include <stdio.h>
#include <stdarg.h>

int fish_total(int count, ...) {
    va_list list;
    va_start(list, count);
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += va_arg(list, int);
    }
    va_end(list);
    return sum;
}

int main(void) {
    printf("三只猫的：%d\n", fish_total(3, 2, 3, 4));
    printf("五只猫的：%d\n", fish_total(5, 1, 1, 1, 1, 1));
    return 0;
}
```

```text
三只猫的：9
五只猫的：5
```

同一招，三份也能收、五份也能收喵～

看仔细：`fish_total` 的投喂表分两截 ——

- 前头 `int count` 是**有名字的那位**，本喵自己传了个账本进去，说清这回来几只；
- 后头 `...` 那一串全是**没名字的散兵**，它们是谁、有几个，招式本身不知道，得靠本喵告诉它。

## 清单四步：开、挂、叼、收

`...` 后头那一串看不见摸不着，得靠 `stdarg.h` 这个工具房里的四步走：

| 四步 | 管什么 |
| --- | --- |
| `va_list list;` | **开一张清单**：后头那一串先记在它名下 |
| `va_start(list, count);` | **挂名字**：从 `count` 后面那一份开始记 |
| `va_arg(list, int);` | **叼一份**出来，说好它是 `int`；叼过的就往后挪一位，不会回头 |
| `va_end(list);` | **收摊**：清单用完了，交回去 |

盯住两个容易写错的地方喵：

1. `va_start` 的第二项**永远是最后那个有名字的投喂**（这里就是 `count`）。写成别的名字，清单就从错的地方开始记。
2. 三个点**必须写在最后一位**，而且前面**至少留一个有名字的投喂** —— 没名字可挂，清单就开不起来。

> 本喵试过只写三个点、前面什么名字都不留：这台翻译官**居然放它过去了**（新规矩松了），可没有名字能挂，那一串投喂只能原样躺着，谁也用不上。别偷这个懒喵。

这四步是按什么顺序走的、清单每叼一口挪到哪儿，本喵拆成一步一步走给你看（就用课文里 `fish_total(3, 2, 3, 4)` 那一句）：

```demo
title: 清单是怎么一份一份往前挪的
code:
| int fish_total(int count, ...) {
|     va_list list;
|     va_start(list, count);
|     int sum = 0;
|     for (int i = 0; i < count; i++) {
|         sum += va_arg(list, int);
|     }
|     va_end(list);
|     return sum;
| }
| 
| int main(void) {
|     printf("三只猫的：%d\n", fish_total(3, 2, 3, 4));
|     return 0;
| }

step 喊招式：账本先递进去，后头跟着一串
at: 13
say: 这一句里本喵递进去两样：**前头的 `3` 是账本**（说清这回来几只），后面 `2、3、4` 是**那一串没名字的散兵**。它们跟着本喵一起进了 `fish_total` 的门。
meow: 递上账本 3，后头跟一串小鱼干喵～
pose: expect
账本上写着 = 3 份
清单眼下挂在哪 = 还没开
这一问的答案 = 还没轮到问
攒到手的 = （还没归零）

step 进门：投喂表分两截
at: 1
say: 进门第一眼是投喂表 `int count, ...`：前头 `count` 是**有名字的那位**，账本 3 就落在它身上；后头那三个点表示「后头还跟着一串」—— **那一串一个名字都没有**，招式自己不知道它们是谁、有几个。
meow: 有名字的只有 count 一位喵～
pose: expect
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 还没开
这一问的答案 = 还没轮到问
攒到手的 = （还没归零）

step 第一步 · 开一张清单
at: 2
say: `va_list list;` 是四步里的第一步 —— **开一张清单**，说好后头那一串记在它名下。**刚开出来的清单还挂不住任何一份**：它还不知道该从哪儿开始记。
meow: 清单开好了，还空着喵～
pose: busy
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 空清单（还没挂住谁）
这一问的答案 = 还没轮到问
攒到手的 = （还没归零）

step 第二步 · 挂名字：从 count 后面开始记
at: 3
say: `va_start(list, count);` 是**挂名字**：从 `count` **后面那一份**开始记 —— 这一挂就挂到了那一串的**第 1 份**上。第二项永远是**最后那个有名字的投喂**，写成别的名字，清单就从错的地方开始记。
meow: 挂在 count 后面那一份上喵！
pose: busy
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 第 1 份（就是 2）
这一问的答案 = 还没轮到问
攒到手的 = （还没归零）

step 把 sum 归零，准备攒数
at: 4
say: `int sum = 0;` 把 `sum` 归 0 —— 一会儿每叼回一份就往里加。**它和那一串投喂是两回事**：账本管「有几份」，它管「攒了多少」。
meow: sum 归零，准备攒数喵～
pose: expect
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 第 1 份（就是 2）
这一问的答案 = 还没轮到问
攒到手的 = 0

step 第一圈 · 先看眼色
at: 5
say: 绕圈第一拍是**眼色**：`i < count` 就是「0 比 3 小吗」。答真 —— 放行，进圈。**跑几圈是账本说了算**，清单自己数不了。
meow: 0 比 3 小，进圈叼鱼去喵！
pose: expect
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 第 1 份（就是 2）
这一问的答案 = 0 比 3 小吗 → 答真，进圈
攒到手的 = 0

step 第一口 · 叼走 2，清单往后挪一位
at: 6
say: `va_arg(list, int)` 从清单**眼下挂着的那一份**把 `2` 叼出来，加进 `sum`：攒到手的成了 2。**叼过的清单往后挪一位**，挂到第 2 份上 —— 它**不回头**，第 1 份再也叼不着了。
meow: 叼走 2，清单往后挪一位喵～
pose: busy
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 第 2 份（就是 3）
这一问的答案 = 0 比 3 小吗 → 答真
攒到手的 = 2

step 第二圈 · 先看眼色
at: 5
say: 收尾把 `i` 加到 1，绕回 `for` 又瞄一眼：`1 < count` 就是「1 比 3 小吗」，答真 —— 再进一圈。
meow: 1 比 3 小，再叼一口喵～
pose: expect
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 第 2 份（就是 3）
这一问的答案 = 1 比 3 小吗 → 答真，进圈
攒到手的 = 2

step 第二口 · 3 出列
at: 6
say: 清单正挂着第 2 份，`va_arg` 照挂住的位置再叼一口：`3` 出列，加进 `sum` —— 攒到手的 2 + 3 = **5**，清单挪到第 3 份。
meow: 第二口叼到 3，攒到 5 啦喵～
pose: busy
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 第 3 份（就是 4）
这一问的答案 = 1 比 3 小吗 → 答真，进圈
攒到手的 = 5

step 第三圈 · 再瞄一眼眼色
at: 5
say: 收尾再把 `i` 加到 2，绕回来瞄第三眼：`2 < 3` 还答真 —— 这是最后一圈。**跑几圈是开跑前就用账本定死的**，不是清单说了算。
meow: 2 比 3 小，最后一圈喵！
pose: expect
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 第 3 份（就是 4）
这一问的答案 = 2 比 3 小吗 → 答真，进圈
攒到手的 = 5

step 第三口 · 4 出列，清单见底了
at: 6
say: 最后一份 `4` 被叼走，攒到手的成了 **9**，清单挪到**那一串的队尾之后** —— 那儿什么都没有了。可它**不会自己停**：清单不知道串有多长，是账本 `count` 把它拦在这儿的。
meow: 第三口叼到 4，清单见底了喵！
pose: yay
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 队尾之后（那一串见底了）
这一问的答案 = 2 比 3 小吗 → 答真，进圈
攒到手的 = 9

step 第四次绕回来：眼色答假，圈停
at: 5
say: 第四次绕回 for：`i` 已经是 3，「3 比 3 小吗」答**假** —— 圈停了，`va_arg` 一次都没再跑。**这就是账本的用处**：叼几份全靠它说了算，多写一份它照样会去叼第四口。
meow: 3 不比 3 小，圈停了喵！
pose: think
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 队尾之后（那一串见底了）
这一问的答案 = 3 比 3 小吗 → 答假，圈停
攒到手的 = 9

step 第四步 · 收摊，把清单交回去
at: 8
say: `va_end(list);` 是四步里的最后一步：**收摊**。开、挂、叼、收 —— 到这儿四步走全了，清单用完了要交回去。
meow: 清单交回去，收摊喵～
pose: proud
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 收摊交回了
这一问的答案 = 3 比 3 小吗 → 答假，圈停
攒到手的 = 9

step 把攒到的数递回去
at: 9
say: `return sum;` 把攒到的 **9** 递回给 `main` 里那个 `printf` —— 招式进门时接的是账本和一串散兵，出门时只带走这一个数。
meow: 把 9 递回去交差喵！
pose: busy
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 收摊交回了
这一问的答案 = 3 比 3 小吗 → 答假，圈停
攒到手的 = 9（递回给 main 了）

step 印出来：三只猫的 9
at: 13
say: 屏幕上出现「三只猫的：9」—— 和课文里那个 TEXT 块的第一行一模一样。同一招换成 `fish_total(5, 1, 1, 1, 1, 1)`：账本写 5、叼五口，就是第二行那个 5。
meow: 三只猫的 9，印出来啦喵！
pose: proud
账本上写着 = 3 份（装在 count 里）
清单眼下挂在哪 = 收摊交回了
这一问的答案 = 3 比 3 小吗 → 答假，圈停
攒到手的 = 9（印出来了）
```

**记住清单的脾气**：它只会**往前挪**，叼过的一份绝不回头；它自己也**不数数** —— 有几份、每一份是什么类型，全得靠招式自己盯死（本喵靠的是传进去的那个 `count`）。

## 得自己知道有几份：`printf` 家族原理

这里有个绕不开的规矩：**后头那一串不带标签**。清单只知道「接下来还有东西」，它**不知道有几份**，也**不知道每一份是什么类型**。

所以：**谁写的招式，谁自己想办法数。**

那 `printf` 是怎么数的？它靠**格式串**喵：

- 格式串里有几个占位符（`%d`、`%s`……），后头那一串就有几份；
- 占位符写的是 `%d` 就按 `int` 叼、写 `%s` 就按一串项链叼 —— **类型也是它说了算**。

这就是 `printf` 家族原理：**格式串就是它的账本**。（本喵传进去的账本是那个 `count`，它传进去的账本是格式串 —— 一个道理喵。）

`printf` 这一家子人多得很，收法分两种：

| 收法 | 招式 |
| --- | --- |
| 后头**直接跟一串** | `printf`、`fprintf`、`sprintf`、`snprintf` |
| 收一张**已经开好的清单** | `vprintf`、`vfprintf`、`vsprintf`、`vsnprintf` |

为什么要两版？就为了**转发**喵。本喵想给 `printf` 穿一层自己的壳 ——「先印个抬头、再印主人的话」：

```c
#include <stdio.h>
#include <stdarg.h>

void report(const char *fmt, ...) {
    va_list list;
    va_start(list, fmt);
    vprintf(fmt, list);
    va_end(list);
    printf("\n");
}

int main(void) {
    report("%d 只猫，一共 %d 条鱼", 3, 9);
    report("只印一句话");
    return 0;
}
```

```text
3 只猫，一共 9 条鱼
只印一句话
```

`report` 自己这一串投喂，它**没法原样递给** `printf` —— 摆在手里的只是一张清单。所以有 `vprintf`：**收清单的那一版**。往后凡是要把「一串投喂」往下转交，认准名字里带 `v` 的那一位喵。

还有一位常用的：`vsnprintf` 先把话攒进一串项链里，回头再印。

```c
#include <stdio.h>
#include <stdarg.h>

void report(const char *fmt, ...) {
    char line[64];
    va_list list;
    va_start(list, fmt);
    vsnprintf(line, sizeof(line), fmt, list);
    va_end(list);
    printf("<%s>\n", line);
}

int main(void) {
    report("%d 只猫", 3);
    return 0;
}
```

```text
<3 只猫>
```

`64` 是这条项链最长能穿多少颗，`sizeof(line)` 就是照着这排猫粮碗的总长度报数 —— 攒的时候攒不下会自己剪断，不会撑破碗边喵。

## 两个最阴的坑

**坑一：类型说错。**清单不认字，你说按 `int` 叼，它就真按 `int` 去抓：

```c
#include <stdio.h>
#include <stdarg.h>

int show_int(int count, ...) {
    va_list list;
    va_start(list, count);
    int v = va_arg(list, int);
    va_end(list);
    return v;
}

int main(void) {
    double a = 1.5;
    printf("%d\n", show_int(1, a));
    return 0;
}
```

本喵喂进去的是 `1.5`，说好按 `int` 叼 —— 翻译官喵**一声没吭**，跑出来印的是 `0`。这就是最阴的地方：它不报错、不警告，只是叼回来一个跟原来毫无关系的数。类型对不上，程序照样跑，错得安安静静喵。

**坑二：份数说错。**本喵写 `fish_total(3, 2, 3)`：嘴上说三份，手里只给了两份。

```c
#include <stdio.h>
#include <stdarg.h>

int fish_total(int count, ...) {
    va_list list;
    va_start(list, count);
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += va_arg(list, int);
    }
    va_end(list);
    return sum;
}

int main(void) {
    printf("%d\n", fish_total(3, 2, 3));
    return 0;
}
```

它照着 `3` 一路叼下去，第三份是**谁也不知道从哪儿抓来的**东西 —— 本喵试的时候印出来是个毫无意义的数，而且**再跑一遍又是另一个数**（本喵就见过它换过）。那数看着像回事，其实什么都不是。份数错了，账本就成了瞎账喵。

⚠️ 顺手对照一下：`printf` 那一族有格式串当账本，翻译官喵能替你核一核 —— 本喵写了句 `printf("%d\n", 3.5)`，它当场嘟囔了一句警告（`-Wformat=`）。可本喵自己写的这一串，它**核不了**：类型、份数，全得你自己盯死。

## 忘带工具房那一句

`va_list`、`va_start`、`va_arg`、`va_end` **不是** C 语言自带的语法字，是 `stdarg.h` 这个工具房里现成的东西。本喵把 `#include <stdarg.h>` 那一行删掉试试：

```c
#include <stdio.h>

int fish_total(int count, ...) {
    va_list list;
    va_start(list, count);
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += va_arg(list, int);
    }
    va_end(list);
    return sum;
}

int main(void) {
    printf("三只猫的：%d\n", fish_total(3, 2, 3, 4));
    return 0;
}
```

```text
main.c: In function 'fish_total':
main.c:5:5: error: implicit declaration of function 'va_start' [-Wimplicit-function-declaration]
main.c:8:16: error: implicit declaration of function 'va_arg' [-Wimplicit-function-declaration]
main.c:8:29: error: expected expression before 'int'
main.c:10:5: error: implicit declaration of function 'va_end' [-Wimplicit-function-declaration]
```

翻译官喵压根不认识这几件工具，只当是没听过的新招式名字，一路报下去喵。中间那条 `expected expression before 'int'` 是**它在替上一句收尾** —— 它已经把 `va_arg(list, int)` 当成喊一个不认识的招式了，于是逗号后面那个 `int` 它就没法安放。**一条错引出下一条**，所以别被后面的条数吓着，先修最上面那一句。

看见 `implicit declaration`，先摸一摸是不是忘了带工具房那一行。

::: tip 猫咪提示
不限量投喂的四句口诀，背下来就够用喵：

1. **三个点写在最后一位**，前面至少留一个**有名字**的投喂；
2. `va_start(清单, 那个名字)` —— 名字一定是最后那个固定的投喂；
3. **自己数着数叼**（多叼一份毫无意义），**类型一定和喂进去的对上**（说错不报错）；
4. 叼完记得 `va_end` 收摊；要把这一串转交出去，只能用**名字里带 `v`** 的那一版。

再配一句：`printf` 的账本是**格式串**，本喵的账本是**自己传的 `count`** —— 清单不会替谁记账喵。
:::

## 小任务

写一招 `int biggest(int count, ...)`：从不定量的一串里挑出**最大**的那个数叼回来。

- 先传账本 `count`，再用 `va_arg(list, int)` 一份一份叼；
- 自己在 `main` 里试两回：`biggest(4, 3, 9, 2, 7)` 该叼回 `9`；`biggest(2, 5, 1)` 该叼回 `5`；
- 做完再故意把 `count` 写成比实际多一份，看看印出来是什么 —— 记住这个坑的样子喵。
