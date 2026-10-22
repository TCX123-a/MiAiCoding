---
id: java-stage2-11
lang: java
stage: 2
order: 11
title: 枚举与内部类
tags: [枚举, 一次性图纸]
required: ["java-stage2-10"]
crossRefs: []
compare: ["common-10"]
estMinutes: 26
keywords: [enum, values, ordinal, anonymous class]
---

## 钩子：排班表上的第 8 天

本喵给七只猫排班：1 是周一、2 是周二……7 是周日。仓库里记着一个数，今天轮到谁，看一眼这个数就知道。

有天本喵手一滑，把 `8` 记了进去。翻译官喵**一个字都没说** —— 本喵真跑过这一块，它安安静静地把稿子翻完，跑出来是这样：

```java
public class Main {
    public static void main(String[] args) {
        int day = 8;
        System.out.println("今天排班：" + day);
    }
}
```

```text
今天排班：8
```

**8 号猫是谁喵？** 排班表上根本没画过第 8 天。可这件事翻译官喵管不着 —— 它只认「这是不是一个整数」，`8` 是整数，合法。至于那个整数具体代表哪一天，那是**本喵自己跟自己立的约定**，机器压根不知道。

这一课要解决的就是这件事：**当一样东西只有固定几种可能的时候，能不能把这几种可能直接列出来，让翻译官喵替本喵把关？**

## 一、把固定几种可能列成一张清单

Java 里专门有个词干这件事：`enum`。本喵把七天的名字列成一张清单。

```java
public class Main {
    enum Day {
        MON, TUE, WED, THU, FRI, SAT, SUN
    }

    public static void main(String[] args) {
        Day d = Day.WED;
        System.out.println(d);
        System.out.println(d.name());
        System.out.println(d.ordinal());
        System.out.println(Day.values().length);
    }
}
```

```text
WED
WED
2
7
```

一次说清三件事：

1. **清单的名字**写在 `enum` 后面（这里是 `Day`），**每一项**是本喵自己起的名字，逗号隔开；最后一项后面可以跟一个分号。
2. 想用哪一项，就写「清单名 + 点 + 那一项的名字」：`Day.WED`。**清单名和项名都得一个字母不差**，写错了翻译官喵会翻脸。
3. 清单上的每一项都自带两个本事：`name()` 把它的名字叼回来（就是本喵给它起的那一个），`ordinal()` 报它**排在第几个**（从 `0` 开始数，所以 `WED` 是 `2`）。`Day.values()` 则是把清单上每一项**挨个叼给你一遍**，`Day.values().length` 就是清单上一共几项。

### 写错了会怎样

本喵把 `MON` 手滑写成 `MONDY`，翻译官喵当场把稿子退回来：

```java
public class Main {
    enum Day {
        MON, TUE, WED, THU, FRI, SAT, SUN
    }

    public static void main(String[] args) {
        Day d = Day.MONDY;
        System.out.println(d);
    }
}
```

```text
Main.java:7: error: cannot find symbol
  symbol:   variable MONDY
  location: class Day
```

念起来是：**「`Day` 这张清单上没有叫 `MONDY` 的项喵。」** 这正是清单最值钱的地方 —— **清单之外的名字，编稿子那一关就被拦下了**，压根跑不到「8 号猫是谁」那一步。

回头看看开头那个 `int day = 8`：翻译官喵**只拦得住「不是整数」**（写 `int day = "周三";` 它会翻脸），拦不住「是整数但不是本喵要的那几种」。换成清单之后，**本喵的约定第一次变成了机器能读懂的规矩**。

清单上「名字」和「编号」是怎么对上的，本喵拆成一步一步，走给你看：

```demo
title: 清单上的名字，背后都站着一个编号
code:
| enum Day {
|     MON, TUE, WED, THU, FRI, SAT, SUN
| }
| public static void main(String[] args) {
|     Day d = Day.WED;
|     System.out.println(d.name());
|     System.out.println(d.ordinal());
|     System.out.println(Day.values().length);
| }

step 一次列全：只认列在这儿的名字
at: 2
say: 清单一次列全七项，每一项一个本喵自己起的名字，逗号隔开。**写几项，翻译官喵就只认这几项** —— 列在这儿之外的名字，编稿子那一关就拦下了。
meow: 七项列齐，清单外的它不认喵！
pose: expect
清单上有几项 = 7 项
d 指的是哪一项 = （还没指）
屏幕上 = 还没印

step 从清单上挑一项
at: 5
say: `Day d = Day.WED;` —— 清单名加项名，**一个字母都不能差**。`WED` 是清单上**第 3 个写下的**名字，本喵就先记住这个次序。
meow: 挑中 WED，第三项喵！
pose: busy
清单上有几项 = 7 项
d 指的是哪一项 = WED（第 3 项）
屏幕上 = 还没印

step name()：把名字叼回来
at: 6
say: `d.name()` 把本喵给它起的**名字**叼回来：`WED`。这个名字就是本喵写在清单上的那一个，一个字母不差。
meow: 名字叼回来，还是 WED 喵！
pose: yay
清单上有几项 = 7 项
d 指的是哪一项 = WED（第 3 项）
屏幕上 = WED

step ordinal()：报它排在第几个
at: 7
say: `d.ordinal()` 报它**排在第几个**：`2`。**名字背后藏着编号** —— 而且**从 0 起数**：MON 是 0、TUE 是 1、WED 才轮到 2。次序就是本喵写下的次序。
meow: 名字背后藏着 2 号喵！
pose: think
清单上有几项 = 7 项
d 指的是哪一项 = WED（第 3 项，编号 2）
屏幕上 = WED、2

step values()：把每一项挨个叼一遍
at: 8
say: `Day.values().length` 把清单上每一项**挨个叼给你一遍**，一共 `7` 项。配上 `ordinal()`，就是不重不漏过一遍整张清单的标准走法。
meow: 七项挨个叼，一个不落喵～
pose: yay
清单上有几项 = 7 项
d 指的是哪一项 = WED（第 3 项，编号 2）
屏幕上 = WED、2、7

step 回头看那张清单：约定搬进了稿子
at: 2
say: 再看开头那件事：`int day = 8` 翻译官喵一个字都没说，它只拦得住「不是整数」。换成这张清单，**本喵的约定第一次变成了机器读得懂的规矩** —— 想写 `MONDY`，编稿子那一关就过不去。
meow: 约定搬进稿子，机器替你把门喵！
pose: proud
清单上有几项 = 7 项（清单外的名字编稿子就挨拦）
d 指的是哪一项 = WED（第 3 项，编号 2）
屏幕上 = WED、2、7
```

一句话收住：**清单上写几项，就只有这几项；每一项背后还站着一个从 `0` 数起的编号**（`ordinal()`），想挨个过一遍就喊 `Day.values()`喵。

::: tip 猫咪提示
一句话记住清单的价值：**「合法的写法」从本喵脑子里搬进了稿子里**。往后凡是「只有固定几种」的东西 —— 星期、季节、订单的一堆状态、菜单上的几个选项 —— 都该列成清单，别用一个数去代。
:::

## 二、清单上的每一项，是照清单生出来的真猫

上一课学过「会量体裁衣的图纸」。清单其实也是图纸的一种：**清单上写几项，生出来的就是几只真猫**，`Day.WED` 就是其中一只。

既然是照图纸生出来的，那它当然**可以带自己的家当和招式**。

```java
public class Main {
    enum Day {
        MON("周一"), TUE("周二"), WED("周三"), THU("周四"), FRI("周五"), SAT("周六"), SUN("周日");

        private final String label;

        Day(String label) {
            this.label = label;
        }

        String label() {
            return label;
        }
    }

    public static void main(String[] args) {
        for (Day d : Day.values()) {
            System.out.println(d + " 是 " + d.label());
        }
    }
}
```

```text
MON 是 周一
TUE 是 周二
WED 是 周三
THU 是 周四
FRI 是 周五
SAT 是 周六
SUN 是 周日
```

要留意的地方有四处：

- **每一项后面多了一对小括号**，括号里喂进去的是这一项自己的小名牌（`MON("周一")`）。所以第一行末尾从逗号换成了**分号** —— 声明到这儿就结束了，后面接的是家当和招式。
- **家当那一格是 `private final`**：只有这张清单自己的人能伸进手，而且生出来之后不许再改。
- **`Day(String label)` 是出生那一手**，它在这个清单里**只给清单自己用** —— 本喵在别处写 `new Day("周一")` 是写不出来的，翻译官喵不让。
- **清单里的每一项，出厂顺序就是它写的顺序**，`ordinal()` 报的正是这个次序。

### 清单 + 分支：天生一对

清单最家常的用处，就是拿它当分支的开关。看鱼干眼色行事那一套里，`switch` 的括号里可以直接放清单上的一项：

```java
public class Main {
    enum Day {
        MON, TUE, WED, THU, FRI, SAT, SUN
    }

    static boolean isRest(Day d) {
        switch (d) {
            case SAT:
            case SUN:
                return true;
            default:
                return false;
        }
    }

    public static void main(String[] args) {
        System.out.println(isRest(Day.SAT));
        System.out.println(isRest(Day.WED));
    }
}
```

```text
true
false
```

`case` 后面写**项名**就行（`case SAT:`）。本喵顺手试过写全的 `case Day.SAT:` —— 这一版翻译官喵**也收**，只是括号里已经说清是哪张清单了，那行多写一份清单名纯属啰嗦，所以习惯上只写项名喵。

## 三、一张只用一次的图纸，可以当场画

清单讲完了，换另一半：**当场画的图纸**。

先看一个常见的场面。本喵想让人帮忙干一件事 —— 比如「喊一声开饭」。这件事**只有这一处会用**，本喵不想为它单独存一张图纸、还起个名字。Java 允许本喵**在用的那一行原地画出来**：

```java
public class Main {
    interface Greeter {
        void greet();
    }

    public static void main(String[] args) {
        Greeter g = new Greeter() {
            @Override
            public void greet() {
                System.out.println("喵～本喵来啦");
            }
        };
        g.greet();
    }
}
```

```text
喵～本喵来啦
```

盯着中间那一段看，它其实是这样拼的：

```text
new 与猫的约定名()  {  招式的身子写在这儿  }
```

- **`new Greeter()`** —— 平常 `new` 后面跟的是图纸名，这里跟的是一份**与猫的约定**。意思是「本喵要一只**会照这份约定干活**的真猫」，可具体怎么干，本喵当场说。
- **紧跟的一对花括号** —— 这就是**当场画的那张图纸的身子**。里面写清 `greet()` 到底干什么。
- **末尾的分号别忘** —— 因为它整个是一句赋值，`Greeter g = ……;` 到分号才算完。

**它和普通图纸的差别只有一条：这张图纸没有名字。** 所以本喵只能在画的这一行顺手接住它（赋给一个名字，或者当场喂给某个招式）。画完之后，再也喊不出它来了 —— 想画第二只，就得再写一遍。

正因为「只用一次」，这种写法**天生适合当一次性的投喂**：

```java
public class Main {
    interface Greeter {
        void greet();
    }

    static void runTwice(Greeter g) {
        g.greet();
        g.greet();
    }

    public static void main(String[] args) {
        runTwice(new Greeter() {
            @Override
            public void greet() {
                System.out.println("开饭啦");
            }
        });
    }
}
```

```text
开饭啦
开饭啦
```

本喵把「干什么」直接塞进了 `runTwice` 的投喂口里，中间连个临时的名字都没起。这就是它最舒服的地方：**要变的是「干什么」，那就把「干什么」写在投喂的地方**，读的人一眼就看到，不用再翻另一张图纸去找。

「当场画」这一下到底画了什么，本喵拆成一步一步，走给你看：

```demo
title: 当场画的那张图纸：有身子，没名字
code:
| interface Greeter {
|     void greet();
| }
| public static void main(String[] args) {
|     Greeter g = new Greeter() {
|         @Override
|         public void greet() {
|             System.out.println("喵～本喵来啦");
|         }
|     };
|     g.greet();
| }

step 先说好：这是一份约定
at: 1
say: `Greeter` 是一份**与猫的约定**：它只说「要会 `greet` 这一手」，**没说这一手怎么写**。此刻这里还只有骨架，没有身子，更没有哪只真猫。
meow: 只说要会 greet，没写怎么干喵～
pose: expect
图纸有名字吗 = 还只是一份约定，连身子都没有
本喵接住它了吗 = （还没画，也没接）
屏幕上 = 还没印

step new 的性质变了：后面跟的是约定
at: 5
say: 平常 `new` 后面跟的是**图纸名**，这里跟的是一份**约定**：意思是「本喵要一只**照这份约定干活**的真猫」，可具体怎么干，**当场说**。
meow: 当场画一只，图纸没名字喵！
pose: busy
图纸有名字吗 = 画好了，可**没有名字**（一次性）
本喵接住它了吗 = 正接住，起的名字叫 g
屏幕上 = 还没印

step 花括号里那段，就是图纸的身子
at: 8
say: 紧跟的一对花括号，就是**当场画的那张图纸的身子** —— `greet` 到底干什么，写在这儿。它和普通图纸的差别只有一条：**这张图纸没有名字**。
meow: 身子就写在这儿喵～
pose: busy
图纸有名字吗 = 画好了，可**没有名字**（一次性）
本喵接住它了吗 = 正接住，起的名字叫 g
屏幕上 = 还没印

step 喊一声，跑的就是当场写的身子
at: 11
say: `g.greet();` 喊一声，印出「喵～本喵来啦」—— 跑的就是当场写的那段身子。因为图纸没名字，**只能在画它的那一行顺手接住**（接住它的牌子叫 `g`）。
meow: 喊一声，当场写的话就出来了喵！
pose: yay
图纸有名字吗 = 没有名字（一次性）
本喵接住它了吗 = 接住了，只有 g 这一个名字
屏幕上 = 喵～本喵来啦

step 用完就再喊不出来
at: 5
say: 回头看 `new Greeter() {` 那一行：图纸没名字，**画完就再也喊不出它来** —— 想在第二处用，只能再抄一遍。所以它天生适合「只在这一处用一次」的活。
meow: 用完就扔，想再用得重画喵～
pose: proud
图纸有名字吗 = 没有（第二处想用只能再抄一遍）
本喵接住它了吗 = 接住了，只有 g 这一个名字
屏幕上 = 喵～本喵来啦
```

三个坑再点一遍：**末尾那个分号**属于赋值那一句（`Greeter g = ……;`），丢了翻译官喵会说 `';' expected`；花括号里写的是**招式完整的身子**；`@Override` 那个小帽子可有可无，是保险不是必需品喵。

::: warn 小心喵
当场画的图纸有三个常踩的坑，本喵都真跑过：

1. **末尾那个分号**。它属于「赋值」那一句，不是花括号的一部分。写完花括号就当完事、把分号丢掉，翻译官喵会指着最后那个 `}` 说 `';' expected`。
2. **里面写的是招式完整的身子**，不是一句话。省成 `greet() { … }` 它当场翻脸：`invalid method declaration; return type required` —— 「这一行看着像招式，可你没说它叼回来什么」。
3. **`@Override` 那个小帽子可有可无**。本喵不挂它真跑过一遍，照样跑得好好的；挂了它只是让翻译官喵帮本喵核对「名字是不是真跟约定上写的一样」。所以它是保险，不是必须要写的东西 —— 别以为漏了它程序就坏。

顺带一句：这种「在用的那一行原地画一张图纸」的写法，老名字叫**匿名内部类（当场画的一次性图纸）**，往后在别人的代码里见到「括号后面直接跟花括号」的长相，回来对上号就行喵。
:::

## 四、什么时候用哪个

| 想干的事 | 用哪个 | 为什么 |
|---|---|---|
| 一样东西只有**固定几种**，还想让机器替本喵把门 | 清单（`enum`） | 清单外的名字编稿子就被拦下，本喵的约定变成了机器读得懂的规矩 |
| 每一样还要带**自己的小名牌 / 家当** | 清单 + 家当 | 清单上的每一项本来就是照清单生出来的真猫，能带自己的东西 |
| 一段活**只在这一处用一次**，用完就扔 | 当场画 | 省掉「单独存一张、还得起名字」的啰嗦 |
| 同一段活**好几处都要用** | 老实画一张有名字的图纸 | 当场画的那种没有名字，第二处想用只能再抄一遍 |

## 五、小任务

1. 把本喵的排班表改一改：给七只猫各配一个「毛色」小名牌，然后绕鱼干跑一圈，把七天连毛色一起印出来。
2. 想一想：清单上每一项的 `ordinal()` 是从几开始数的？本喵要是把清单上的次序换了，`ordinal()` 会不会跟着变？
3. 试着用「当场画」的写法，给一个招呼招式分别喂两种不同的说法，看看跑出来有什么不一样。

下一课本喵要讲一个更硬的话题：**程序跑着跑着出事的时候怎么办**。仓库空了、编号越界了、项链想当数字用 —— 这些「事到临头才知道」的状况，Java 有一套完整的应对办法，本喵还要教你**自己画一种专门报这种事的图纸**喵～ 🐾
