---
id: java-stage1-10
lang: java
stage: 1
order: 13
title: 方法重载与作用域
tags: [函数, 作用域]
required: [java-stage1-09]
crossRefs: []
estMinutes: 25
keywords: [overload, scope, block]
---

## 钩子：同一句「开饭啦」，各猫各样

本喵在猫窝门口喊一嗓子「开饭啦」，橘猫「噔噔噔」冲过来，狸花翻了个身才慢悠悠起身，大胖干脆装睡。同一句话，各猫各样的反应。

昨天本喵学会了自己造招式（方法）。今天要问的是：**同一个招名，能不能有好几种喂法？** 比如本喵想给「打招呼」这一招备三副面孔：没喂料的、喂名字的、喂名字又喂鱼干数的。要是每副面孔都得另起一个名字 —— `greet1`、`greet2`、`greet3` —— 本喵自己都记不住哪个是哪个喵。

Java 允许本喵**同用一个名字，写好几招**，喊的时候电脑自己挑该用哪一招。这套本事，术语里叫**重载**。

这一课还有半张纸要交代：上一课末尾那个「`i` 出了圈本喵就不认识了」的问题，今天一次讲透 —— 谁的牌子活在谁的地盘上。

## 一、同一个招名，几种喂法

先看本喵把「打招呼」写成两招，名字都叫 `greet`：

```java
public class Main {
    public static void greet() {
        System.out.println("你好喵～");
    }

    public static void greet(String name) {
        System.out.println("你好，" + name + "喵～");
    }

    public static void main(String[] args) {
        greet();
        greet("小橘");
    }
}
```

```text
你好喵～
你好，小橘喵～
```

图纸上现在住着**两招同名**的 `greet`，翻译官一点也不生气。凭什么？因为这两招的**投喂口不一样**：

| 招式 | 投喂口 | 怎么喊 |
|---|---|---|
| 第一招 | `()` —— 什么也不喂 | `greet();` |
| 第二招 | `(String name)` —— 喂一串项链 | `greet("小橘");` |

喊 `greet()` 的时候，本喵后面那对小括号里**空着**，电脑就挑了不带投喂口的那一招；喊 `greet("小橘")` 时本喵喂了一串项链，它就挑了收项链的那一招。**你喂什么料，它挑什么招** —— 这一步是电脑替你干的，本喵一个字都不用管喵。

这两声喊里「挑」的那一下，平时根本看不见。本喵把它拆成一步一步，走给你看：

```demo
title: 两声 greet，电脑怎么知道该走哪一招
code:
| public static void greet() {
|     System.out.println("你好喵～");
| }
| public static void greet(String name) {
|     System.out.println("你好，" + name + "喵～");
| }
| public static void main(String[] args) {
|     greet();
|     greet("小橘");
| }

step 第一声：括号里空着
at: 8
say: 程序从 `main` 里那一行开跑。`greet();` 后面那对小括号里**空着** —— 一样料都没喂。电脑挑招，只看这里。
meow: 第一声喊出去，括号空空的喵～
pose: expect
喊的是哪一声 = greet()，括号里空着
电脑挑中哪一招 = 还在挑
屏幕上 = 还没印

step 拿括号里的东西去对投喂口：空对空
at: 1
say: 图纸上住着**两支都叫 `greet`** 的招（第 1 行和第 4 行）。电脑拿「括号里有几样料」去对两支护的投喂口：一样都没有 → 挑中投喂口也是空的第 1 支。**它只看打头那一行，不看招式里干了什么。**
meow: 空对空，挑中第 1 支！
pose: think
喊的是哪一声 = greet()，括号里空着
电脑挑中哪一招 = 第 1 支（投喂口空着）
屏幕上 = 还没印

step 挑定了才跳进去跑：印出「你好喵～」
at: 2
say: 挑完才轮到跑：电脑跳进第 1 支的花括号里，印出「你好喵～」。**挑招永远排在跑身子前面** —— 先定去哪一支，再动身。
meow: 跳进第 1 支，印出你好喵～！
pose: yay
喊的是哪一声 = greet()，括号里空着
电脑挑中哪一招 = 第 1 支（投喂口空着）
屏幕上 = 你好喵～

step 落回 main，接着喊第二声
at: 8
say: 跑完落回**刚才那一行**，下一句就是第 9 行 `greet("小橘");`。这一回括号里**递进去了一样料，还是一串项链**。
meow: 回来啦，第二声走起～
pose: busy
喊的是哪一声 = greet("小橘")，括号里一串项链
电脑挑中哪一招 = 还在挑
屏幕上 = 你好喵～

step 个数对上了，类型也对上了：挑中第 2 支
at: 4
say: 第 1 支的投喂口是空的，收不下这串项链；第 2 支的投喂口写着 `String` —— 个数对上了、类型也对上了，电脑挑中它（第 4 行）。**名字一样，靠括号里递的东西分家。**
meow: 个数、类型都对上，就是它喵！
pose: think
喊的是哪一声 = greet("小橘")，括号里一串项链
电脑挑中哪一招 = 第 2 支（收项链的）
屏幕上 = 你好喵～

step 跳进去跑：招式里现摆一只碗接住「小橘」
at: 5
say: 招式里现摆一只叫 `name` 的碗，「小橘」就装在里面 —— 这只碗是**招式自己的**，只活在 `greet` 那对大括号里，喊完就撤走。接着印出「你好，小橘喵～」。
meow: 现摆一只碗，装下小橘喵～
pose: yay
喊的是哪一声 = greet("小橘")，括号里一串项链
电脑挑中哪一招 = 第 2 支（收项链的）
屏幕上 = 你好喵～、你好，小橘喵～

step 收工：两声喊完，各走各的
at: 10
say: 落回 `main`，大括号合上，程序收工。两次喊的**名字一模一样**，走的却是两支不同的招 —— 分岔全在括号里递的东西：先数**个数**，再看**类型**。
meow: 同名的两招，各走各的喵～
pose: proud
喊的是哪一声 = 两声都喊完了
电脑挑中哪一招 = 各自挑了一支
屏幕上 = 你好喵～、你好，小橘喵～
```

**记住两件事**：电脑挑招，只拿括号里递的东西去对投喂口 —— 先数**个数**，再看**类型**，两把尺子都对上才是它；它**不看招式里写了什么**，也不看你打算把战利品装进哪只碗。另一件：招式里现摆的碗（比如那只 `name`）是招式自己的，**碗跟着那对大括号走** —— 喊完就撤，外面根本没有这个名字喵。

## 二、电脑怎么挑：看个数，也看类型

挑招的两把尺子是**个数**和**类型**。先看个数：

```java
public class Main {
    public static int add(int a, int b) {
        return a + b;
    }

    public static int add(int a, int b, int c) {
        return a + b + c;
    }

    public static void main(String[] args) {
        System.out.println(add(1, 2));
        System.out.println(add(1, 2, 3));
    }
}
```

```text
3
6
```

两招都叫 `add`，一个收两样料、一个收三样。喂两样就走两样的那招，喂三样就走三样的那招 —— **个数一数就分得清**。

再看类型。同一件事，喂整数和喂小数，本喵想走两条路：

```java
public class Main {
    public static void add(int a, int b) {
        System.out.println("整数版：" + (a + b));
    }

    public static void add(double a, double b) {
        System.out.println("小数版：" + (a + b));
    }

    public static void main(String[] args) {
        add(1, 2);
        add(1.5, 2.5);
    }
}
```

```text
整数版：3
小数版：4.0
```

`add(1, 2)` 喂进去的两样是**整数**，走 `int` 那招；`add(1.5, 2.5)` 喂进去带小数点，走 `double` 那招。**两把尺子合起来用**：先数个数，对上了再看类型，都对得上才是它要的那一招。

### 只有两样东西算数

本喵把判据写成一句话：**招名 + 投喂口（几样料、每样什么料）**。这两样合起来叫这一招的「签名」。签名不一样，就能重名；签名一样，就是写重了。

那**叼回来的战利品**算不算判据？本喵试了试，写两招同名的：一招叼整数、一招叼项链 —— 翻译官当场犯难：

```java
public class Main {
    public static int get() {
        return 1;
    }

    public static String get() {
        return "喵";
    }

    public static void main(String[] args) {
        System.out.println(get());
    }
}
```

```text
Main.java:6: error: method get() is already defined in class Main
    public static String get() {
                         ^
1 error
```

原话是 `method get() is already defined in class Main` —— **「`get()` 这一招在 `Main` 里已经写过了喵。」** 两招的投喂口都是空的，签名一模一样，只有叼回来的料不同 —— 这**不算**两种喂法。为什么？因为喊 `get()` 的时候，本喵手上没喂任何料，电脑**没法从你喂的东西里**看出你要哪一份战利品：它只能看喂料挑招，看不到你打算把战利品装进哪只碗喵。

## 三、写重了会怎样

上一节那一句 `already defined` 就是「写重了」的报错。本喵再撞一次最典型的：两招名字一样、投喂口也一样，只是**料的名字**不一样（一个叫 `name`、一个叫 `who`）：

```java
public class Main {
    public static void greet(String name) {
        System.out.println("你好，" + name + "喵～");
    }

    public static void greet(String who) {
        System.out.println("嗨，" + who);
    }

    public static void main(String[] args) {
        greet("小橘");
    }
}
```

```text
Main.java:6: error: method greet(String) is already defined in class Main
    public static void greet(String who) {
                       ^
1 error
```

看清楚喵：`String name` 和 `String who` 在翻译官眼里**是同一个签名** —— 它只认「一样什么类型的料」，**料在招里叫什么名字，它不管**。这种错**编译当场就拦下**，不用等跑起来。

::: warn 小心喵
重载的判据只有两样，背下来就够：**招名一样、投喂口不一样**。常见三种写重了的姿势：

- 投喂口的**类型和个数都一样**，只有料的名字不同 —— 签名一样，写重了。
- 投喂口的类型和个数都一样，**只有叼回来的战利品不同** —— 还是签名一样，写重了。
- 想用「招式里干的活不一样」来区分 —— 翻译官不看身子，只看打头那一行。

报错原话都是同一句：`method xxx is already defined in class xxx`。看到 `already defined` 就是这里撞了，回去数一数两个投喂口喵。
:::

## 四、地盘（作用域）：谁的牌子活在谁那儿

上半场说完了「重名」，下半场说**牌子活在哪块地方**。

本喵先摆两招，各自在身子里摆一只叫 `n` 的碗：

```java
public class Main {
    public static int doubleIt(int n) {
        n = n * 2;
        return n;
    }

    public static int square(int n) {
        n = n * n;
        return n;
    }

    public static void main(String[] args) {
        System.out.println(doubleIt(4));
        System.out.println(square(4));
    }
}
```

```text
8
16
```

两只招式里各有一只叫 `n` 的碗，名字撞得结结实实，翻译官一声不吭。**因为招式里摆的碗，就活在招式自己那对大括号里**：

- 每喊一次招式，就在招式里面**现摆一套崭新的碗**，喊完立刻撤走；
- 两只招式各摆各的，谁也看不见谁的碗；
- 所以同名完全不打架 —— 它们是两只**不同的**碗，只是碰巧起了同一个名字。

反过来说：**招式收工之后，外面就别想再喊到它里面的碗了。**

```java
public class Main {
    public static void make() {
        int n = 7;
    }

    public static void main(String[] args) {
        System.out.println(n);
    }
}
```

```text
Main.java:7: error: cannot find symbol
        System.out.println(n);
                           ^
  symbol:   variable n
  location: class Main
1 error
```

`cannot find symbol` 念起来是「**这个名字本喵没登记过**」；下面那两行还替本喵说清了缺的是什么：`symbol: variable n` —— 缺一块叫 `n` 的牌子。

`n` 只在 `make` 那间屋子里挂了号。站在 `main` 里喊它，等于**跑到别人家门口喊自家猫的名字**，谁也听不懂。这套「谁看得见谁」的规矩，正式的说法叫**地盘**（作用域）。

这一条其实本喵前面就撞过一回：「for 与 while」那一课绕圈那段，本喵在 `for` 的小括号里摆了一块 `i`，出了圈再喊 `i`，翻译官就说认不出它。现在有名字了 —— **那不是它记性差，是 `i` 的地盘只有那个圈**。

## 五、花括号就是一张地盘的边界

上一节说的是「招式」这层地盘。其实**每一对大括号都是一张地盘**：`if` 的花括号、`for` 的花括号、你随手写的一对空花括号，各是一块小地方。

里层能看见外层，外层看不见里层：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 5;
        if (fish > 0) {
            int bonus = 2;
            System.out.println(fish + bonus);
        }
        System.out.println(fish);
    }
}
```

```text
7
5
```

- 花括号**里面**那句用到了 `fish` 和 `bonus` 两只碗 —— `fish` 摆在外面（里层看得见外层），`bonus` 摆在里面。里层两只都够得着，印出 `7`。
- 花括号**外面**那句只喊 `fish`，印出 `5`；它要是敢喊 `bonus`，就是上一节那句 `cannot find symbol`。

这两层里外怎么进出、哪只碗活到哪一步，本喵也拆成一步一步，走给你看：

```demo
title: if 的大括号里外：两只碗各活在哪一层
code:
| public static void main(String[] args) {
|     int fish = 5;
|     if (fish > 0) {
|         int bonus = 2;
|         System.out.println(fish + bonus);
|     }
|     System.out.println(fish);
| }

step 外层先摆一只 fish，装进 5
at: 2
say: `main` 这对大括号就是**外层** —— 本喵自己的地盘。第 2 行在这儿摆一只叫 `fish` 的碗，装进 5，这只碗归外层管。
meow: 外层摆好一只 fish，装 5 喵！
pose: expect
外面的 fish = 5
里面的 bonus = 还没摆
屏幕上 = 还没印

step 碰到 if：先看眼色，再进里层
at: 3
say: 第 3 行这对花括号要开一块**里层**。进门前先看眼色 `fish > 0` —— 这一眼读得到 `fish`，正因为**里层看得见外层**。5 比 0 大，答真，本喵进去。
meow: 5 比 0 大，放本喵进里层！
pose: busy
外面的 fish = 5
里面的 bonus = 还没摆
屏幕上 = 还没印

step 里层自己摆一只 bonus，装进 2
at: 4
say: 进了里层，第 4 行在这儿摆一只叫 `bonus` 的碗，装进 2。这只碗**只在里层** —— 外层根本没有这个名字。
meow: 里层自己摆一只 bonus 喵～
pose: busy
外面的 fish = 5
里面的 bonus = 2
屏幕上 = 还没印

step 里层这一行：两只碗都够得着，印出 7
at: 5
say: 第 5 行要印 `fish + bonus`。`fish` 为什么够得着？因为**里层看得见外层** —— 够着的是外层**那一只**碗，不是「另一只改了个名的」（Java 里没有这回事）；`bonus` 是里层自己那只。5 加 2，印出 7。
meow: 两只碗都够得着，印出 7！
pose: yay
外面的 fish = 5
里面的 bonus = 2
屏幕上 = 7

step 里层收工：大括号一合，bonus 就没了
at: 6
say: 第 6 行这对大括号合上，里层这块地盘就**收了** —— `bonus` 跟着这块地盘一起没了。从这一刻起，站在外层喊 `bonus` 也没人认得（就是上一节那句 `cannot find symbol`）。
meow: 里层收摊，bonus 跟着走啦～
pose: think
外面的 fish = 5
里面的 bonus = （跟着里层收了）
屏幕上 = 7

step 回到外层：只印得出 fish 那一只
at: 7
say: 回到外层，第 7 行只喊得到 `fish`（外层自己那只），印出 **5**。里层加进去的那点活儿**一点没留在外面** —— 印出来还是 5，不是 7。
meow: 外面只认 fish，印出 5 喵～
pose: busy
外面的 fish = 5
里面的 bonus = （跟着里层收了）
屏幕上 = 7、5

step 收工：两层的规矩回头看一遍
at: 8
say: `main` 的大括号也合上，程序收工。这一趟的规矩两条：**里层看得见外层**（够着的是同一只碗），**外层看不见里层**（里层添的碗，出了那对大括号就没人认得）。课文下面还有一条更容易踩的：里层连「再摆一只跟外层同名的碗」都不许喵。
meow: 里层外层，各管各的碗～
pose: proud
外面的 fish = 5
里面的 bonus = （跟着里层收了）
屏幕上 = 7、5
```

**记住这两层的分工**：里层看得见外层 —— 够着的是**同一只**碗；外层看不见里层 —— 里层添的碗跟着那对大括号一起收了。所以想让一只碗活得久一点，就把它摆到外面那层去喵。

圈里的 `i` 也是同一个道理：

```java
public class Main {
    public static void main(String[] args) {
        for (int i = 0; i < 3; i++) {
            System.out.println("第 " + i + " 圈喵");
        }
        System.out.println(i);
    }
}
```

```text
Main.java:6: error: cannot find symbol
        System.out.println(i);
                           ^
  symbol:   variable i
  location: class Main
1 error
```

`i` 是在 `for` 的那对小括号里摆下的，它的地盘就是这一整个圈（从 `for` 的圆括号一直管到圈身子那对花括号）。圈跑完了，这块地盘也收了，站在 `main` 的地盘上再也喊不到它。

**想让圈数跑完之后还能用，就把它摆到圈外面**：先在 `main` 的地盘上摆一只 `int i = 0;`，圈子的小括号里只写 `i = 0; i < 3; i++`（不写 `int`）—— 这样它从头到尾都活在 `main` 的地盘上喵。

### 同一个地盘里，不能有两只同名的碗

```java
public class Main {
    public static void main(String[] args) {
        int fish = 5;
        int fish = 7;
        System.out.println(fish);
    }
}
```

```text
Main.java:4: error: variable fish is already defined in method main(String[])
        int fish = 7;
            ^
1 error
```

`already defined` 又见面了 —— 这回说的是牌子：**`fish` 在 `main` 这一招里已经摆过了**。同一个地盘里摆两只同名的碗，第二只是谁、第一只是谁，本喵自己都说不清，翻译官索性不许。

还有一条更容易踩的：连**里层块里再摆一只同名的**也不行 —— Java 不许内层把外层的名字盖住。所以写块的时候，里层起名字之前，先抬头看一眼外层有没有重名的喵。

## 一句话对照表

| 本喵写下的 | 它的意思 | 什么时候出问题 |
|---|---|---|
| `greet()` 和 `greet(String name)` | 同名两招，投喂口不一样 —— 重载 | 合法，电脑按喂料挑 |
| 两招投喂口**一模一样** | 签名一样 | **编译当场拦**：`method xxx is already defined` |
| 招式里摆的碗 | 地盘只在招式内部，喊一次现摆一套 | 外面喊它 → `cannot find symbol` |
| `for (int i = ...)` 里的 `i` | 地盘就是那个圈 | 出了圈再喊它 → `cannot find symbol` |
| 里层块里的碗 | 里层看得见外层，外层看不见里层 | 外面喊它 → `cannot find symbol` |
| 同一地盘里两只同名的碗 | 摆重了 | **编译当场拦**：`variable xxx is already defined` |

::: tip 猫咪提示
今天记住三句话：

1. **重载的判据只有两样：招名一样、投喂口不一样**（几样料、每样什么料）。料的**名字**、叼回来的**战利品**、身子里的干法都不算数。
2. **花括号就是地盘的边界**：招式一层、块一层。里层看得见外层，外层看不见里层。
3. **每层地盘里，同名的碗只能有一只**；想活得久一点，就把它摆到外面那层去。
:::

## 小任务

1. 把第一节那两招 `greet` 抄进练习场，再给本喵加第三招 `greet(String name, int fish)`（印「你好，小橘，今天 3 条喵」），三招一起喊一遍，看看电脑是不是各挑各的喵。
2. 把第二节 `add` 那两招的顺序**上下对调**（小数版写上面、整数版写下面），再跑一遍 —— 输出变了没有？想一想：电脑挑招，看的是先后顺序吗？
3. 故意把第二招的投喂口改成和第一招一样（都写 `String name`，但料名改成 `who`），编译一次，把原话抄进小本本。抄完记得改回来。
4. 写一招 `void countTo(int n)`，里面用圈从 1 数到 `n`；再在圈**外面**摆一块牌子记「一共数了几个数」，跑完印出来。想想那块牌子为什么必须摆在外面（提示：摆进去就是出了圈喊不着）。
5. 给 `countTo` 写成**两招**：一招 `countTo(int n)`，从 1 数到 `n`；另一招 `countTo()`，什么也不喂，直接印一句「本喵不数了喵」。两招一起写进图纸，喊两声看看电脑挑得对不对。

下一课「递归」，本喵要教你一招「自己咬自己尾巴」的功夫：招式在自己肚子里再喊一遍自己，把大问题一层层啃小——看仔细，它是怎么知道什么时候该停的喵。去下一课探险喵～ 🐾
