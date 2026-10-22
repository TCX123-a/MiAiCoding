---
id: java-stage3-03
lang: java
stage: 3
order: 7
title: 函数式接口与 lambda
tags: [lambda, 招式, 约定]
required: ["java-stage3-02"]
crossRefs: []
estMinutes: 27
keywords: [functional interface, lambda, method reference]
---

## 钩子：只用一次的那一手本事，不值得给它起名字

上一课那个帮工，本喵是**单独给它写了一张图纸**的：起名字、挂承诺、把那一手填进去。可要是那一手本事**只用这么一次**呢？为了这一次，本喵得另起一张图纸、起个名字、挂上承诺 —— 写下来的架子比真正要干的事还长。

这一课就讲怎么把这层架子拆掉：

1. **老写法**：当场造一只「只会这一手」的猫 —— 能用，就是啰嗦；
2. **新写法**：把那一手**直接写出来**，连名字都不起；
3. 为什么这种「直接写出来」的招式**只能挂在一张嘴的约定上**，以及怎么连那一小截都省掉。

一句话先说在前头：这一课**不教新本事**，只教**同一件事的另一种写法** —— 老写法能干的事，新写法一件不少。

## 一、老写法：当场造一只只会这一手的猫

```java
interface Speaker {
    void speak();
}

public class Main {
    static void letItSpeak(Speaker s) {
        s.speak();
    }

    public static void main(String[] args) {
        Speaker cat = new Speaker() {
            public void speak() {
                System.out.println("喵～");
            }
        };
        letItSpeak(cat);
    }
}
```

```text
喵～
```

`Speaker` 是一份**约定**，上面只写了一张嘴：`void speak();`。约定自己不会说话 —— 得有个东西**照着这份约定**把那张嘴填上。

老写法是**当场造一只猫**：`new Speaker() { ... }` 读作「照这份约定，现在就生一只」。本喵现场给它填上「喊一声喵～」这一手。这只猫**生出来就为了喊这一声**，本喵连名字都懒得给它起，造完随手就交出去了。

它能用，毛病只在**啰嗦**：本喵想说的其实只有「喵～」三个字，却写了四行。要是再来三只这样的猫，课文里就全是这种架子了。

## 二、新写法：把那一手直接写出来

把上面那只猫要干的事，**直接端出来**：

```java
interface Doubler {
    int twice(int x);
}

public class Main {
    static int run(Doubler d, int x) {
        return d.twice(x);
    }

    public static void main(String[] args) {
        Doubler d = x -> x * 2;
        System.out.println(run(d, 21));

        Doubler plusTen = (int x) -> x + 10;
        System.out.println(plusTen.twice(5));
    }
}
```

```text
42
15
```

`x -> x * 2` 这一小截，读作「**投喂给本喵一个 `x`，本喵叼回 `x * 2`**」。箭头左边是**投喂进来的**，右边是**要叼回去的**。就这么多 —— 没有图纸名、没有「照哪份约定」、没有那一对大括号。

`Doubler` 那份约定上只有一张嘴，所以这两小截**各自都认得出来**：左边那个 `x` 是整数，右边报的也是整数，跟约定上写的一模一样，翻译官喵一看就对得上账。

第二条那句 `(int x) -> x + 10` 里，本喵把左边那个的牌子**明写了出来**（写成 `int x`）。这不是必须的 —— 上面那条就没写，翻译官喵照样认得出来。**写不写都行，但要么全写、要么全不写**，不能一半写一半不写。

它俩跟老写法其实是**同一件事**：老写法是「造一只只干这一手的猫」，新写法是「把那一手直接端出来」，中间那只猫由翻译官喵自己造好，本喵看不见它而已。

## 三、一张嘴的约定：这种招式只能挂在它上面

先看一份「写了两张嘴」的约定：

```java
interface TwoThings {
    void a();

    void b();
}

public class Main {
    public static void main(String[] args) {
        TwoThings t = () -> System.out.println("喵");
        t.a();
    }
}
```

```text
Main.java:9: error: incompatible types: TwoThings is not a functional interface
        TwoThings t = () -> System.out.println("喵");
                      ^
    multiple non-overriding abstract methods found in interface TwoThings
1 error
```

红字里头一句原话 `TwoThings is not a functional interface`，翻过来就是「**`TwoThings` 不是一张嘴的约定**」；后头补的那句 `multiple non-overriding abstract methods found` 说的是「**里头找着不止一张嘴**」。

道理很直：`() -> System.out.println("喵");` 这一小截，**只说得清一只手要干什么**。约定上写了两张嘴，本喵这一小截到底填的是哪一张？填不了，翻译官喵只好把稿子退回来。

所以这一小截只挂得上「**一张嘴的约定**」—— 那种约定存在的全部意义，就是给它当挂靠的地方。

### 交出去之后就不许再改

第二个坑更隐蔽：

```java
interface Speaker {
    void speak();
}

public class Main {
    public static void main(String[] args) {
        int count = 0;
        Speaker s = () -> System.out.println("喊了 " + count + " 声");
        count = 1;
        s.speak();
    }
}
```

```text
Main.java:8: error: local variables referenced from a lambda expression must be final or effectively final
        Speaker s = () -> System.out.println("喊了 " + count + " 声");
                                                     ^
1 error
```

那句原话直译过来：**「这一小截里提到的那些小鱼干仓库，必须是 `final`，或者事实上没被改过」**。

`int count = 0;` 这行本身并没有写 `final`，可它**后来被改成了 1**（就是那句 `count = 1;`），所以它两条都不占。注意这一回是**翻稿子的时候就红**，不是跑起来才炸 —— 早红是好事。

那把改的那句删掉呢：

```java
interface Speaker {
    void speak();
}

public class Main {
    public static void main(String[] args) {
        int count = 2;
        Speaker s = () -> System.out.println("喵了 " + count + " 声");
        s.speak();
    }
}
```

```text
喵了 2 声
```

这里 `count` 还是没写 `final`，可它**从头到尾一个字都没被改过** —— 这就叫「事实上没被改过」，照样交得出去。

为什么要立这一条？因为本喵把那一小截交出去之后，**它什么时候真的动起来、在哪儿动起来，本喵管不着**。要是它动起来的那一刻，本喵这边早就把仓库里的数换成了别的，那它手里拿到的到底是哪一个？说不清楚。所以翻译官喵把话说死：**交出去的招式碰过的仓库，交出去之后就不许再动。** 想换个值，就**另起一个仓库**（换个名字装），把新的那个交给它。

## 四、伸手一指：连那一小截都省了

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>();
        names.add("小橘");
        names.add("狸花");

        names.forEach(name -> System.out.println(name));
        names.forEach(System.out::println);
    }
}
```

```text
小橘
狸花
小橘
狸花
```

那两句话干的是**同一件事**，第二句还更短。

`System.out::println` 这一小截里的那两个冒号，读作「**本喵不写了，伸手一指那位现成的**」：投喂进来的东西**原封不动**递给 `println` 去印。

什么时候能这么指？得占住两条：

1. **那位现成的本来就在** —— 不用本喵现写一手出来；
2. **投喂进来的东西原封不动地递给它** —— 本喵不在中间加活儿。

要是中间还想加一手（比如印之前先问声好），那就只能老老实实写 `name -> System.out.println("你好 " + name)`，指不了。

### 把它当「规矩」递进去

这种「一小截直接写出来」的招式，最好用的地方是**当规矩递给别人**：

```java
import java.util.ArrayList;
import java.util.List;

interface Rule {
    boolean ok(int x);
}

public class Main {
    static int countIf(List<Integer> box, Rule rule) {
        int n = 0;
        for (int x : box) {
            if (rule.ok(x)) {
                n++;
            }
        }
        return n;
    }

    public static void main(String[] args) {
        List<Integer> box = new ArrayList<>();
        box.add(1);
        box.add(8);
        box.add(2);
        box.add(5);

        System.out.println("够大的有 " + countIf(box, x -> x >= 5) + " 件");
        System.out.println("偶数有 " + countIf(box, x -> x % 2 == 0) + " 件");
    }
}
```

```text
够大的有 2 件
偶数有 2 件
```

看 `countIf` 这一招：它**自己不写「什么样才算够大」**，它只把每一件递到那截规矩面前问一句「这一件，行吗？」。同一个柜子，本喵换上两截不同的规矩，就数出两个不同的数 —— **会变的那部分被拎出来了**，剩下的绕圈、计数一个字都不用重写。

这正是上一课「请帮工」那件事的**短写法**：帮工要单起一张图纸，这里当场写一截就行喵。

「把每一件递到那截规矩面前问一句『行吗』」到底是怎么走的？本喵拆成一步一步走给你看 —— 柜子里先装着 `1`、`8`、`2`、`5` 四件：

```demo
title: 递进去的是规矩本身，每一件都得自己去问它
code:
| interface Rule {
|     boolean ok(int x);
| }
|
| static int countIf(List<Integer> box, Rule rule) {
|     int n = 0;
|     for (int x : box) {
|         if (rule.ok(x)) {
|             n++;
|         }
|     }
|     return n;
| }
| System.out.println("够大的有 " + countIf(box, x -> x >= 5) + " 件");

step 先立一份只开一张嘴的约定
at: 1
say: `Rule` 是一份**约定**：上头只写了一张嘴 `boolean ok(int x)` —— 收一件东西进去，答一个字「行」或者「不行」。约定自己不会干活，它只是**那一小截招式挂靠的地方**。
meow: 一份约定，只开一张嘴喵～
pose: expect
还没问过的 = 1 8 2 5
递到规矩面前的 = （还没递）
规矩报的答案 = （还没问）
数到几件 = （还没立起来）

step 递进去的是「要干的那件事」
at: 14
say: `countIf(box, x -> x >= 5)` 递进去**两样**：一只柜子，还有**那一小截招式本身**（「够得上 5 才算行」这件事）。递过去的**不是结果** —— 这一刻那截招式一次都还没响，因为它还不知道要问的是哪些东西。
meow: 递的是那件事，不是算好的结果喵！
pose: busy
还没问过的 = 1 8 2 5
递到规矩面前的 = （还没递）
规矩报的答案 = （还没问）
数到几件 = （还没立起来）

step 招式把两样都收下
at: 5
say: 进到 `countIf` 里，招式接住递来的两样：一只柜子 `box`、一截规矩 `rule`。**注意此刻规矩还是没动** —— 收下它，不等于叫它干活。
meow: 两样都收下了，规矩还没动喵～
pose: busy
还没问过的 = 1 8 2 5
递到规矩面前的 = （还没递）
规矩报的答案 = （还没问）
数到几件 = （还没立起来）

step 先立一只数数的小本子
at: 6
say: `int n = 0;` 先备一只数数的小本子，记 0。**数数是招式自己的活儿**，跟那截规矩没关系 —— 规矩只管答「这一件行不行」。
meow: 小本子立起来，先记 0 喵！
pose: busy
还没问过的 = 1 8 2 5
递到规矩面前的 = （还没递）
规矩报的答案 = （还没问）
数到几件 = 0

step 绕圈：一件一件叼出来
at: 7
say: `for (int x : box)` 开始一圈圈走：每圈从柜子里**叼一件**出来装进 `x`。排在最头里的是 `1`。
meow: 头一件叼出来，是 1 喵！
pose: expect
还没问过的 = 1 8 2 5
递到规矩面前的 = 1
规矩报的答案 = （还没问）
数到几件 = 0

step 头一件：递到规矩面前问一句
at: 8
say: `rule.ok(x)` —— **到这一秒那截招式才真的响了一声**：把 `1` 递到规矩面前问「这件行吗」。答的是 `false`（1 够不上 5），所以这一件**没被数上**，本子一动没动。
meow: 规矩答「不行」，这一件不算喵～
pose: think
还没问过的 = 8 2 5
递到规矩面前的 = 1
规矩报的答案 = false（够不上 5）
数到几件 = 0

step 第 2 件：答「行」，数上它
at: 8
say: 第 2 件 `8` 递到规矩面前：`8 >= 5` 成立，答 `true`。于是这一件被数上 —— 顺着往下走一行，`n++` 让本子从 0 变成 **1**。**同一截招式，这是第 2 次被问了。**
meow: 答「行」！本子上加一笔喵～
pose: yay
还没问过的 = 2 5
递到规矩面前的 = 8
规矩报的答案 = true（够得上 5）
数到几件 = 1

step 第 3 件：答「不行」，本子不动
at: 8
say: 第 3 件 `2`：`2 >= 5` 不成立，答 `false`。这一件被跳过，本子**一动不动**，还是 1。
meow: 又答「不行」，本子没动喵～
pose: think
还没问过的 = 5
递到规矩面前的 = 2
规矩报的答案 = false（够不上 5）
数到几件 = 1

step 第 4 件：踩着线也算过
at: 8
say: 第 4 件 `5`：`5 >= 5` 成立 —— 「够得上」是一条线，**踩着线也算过**。本子加到 **2**。
meow: 踩着线也算过，本子到 2 啦～
pose: yay
还没问过的 = （都问过了）
递到规矩面前的 = 5
规矩报的答案 = true（踩着线也算过）
数到几件 = 2

step 收工：把 2 叼回去
at: 12
say: 柜子走空了，绕圈停下，最后一行 `return n` 把本子上的 **2** 叼回印的地方 —— 屏幕上出来「够大的有 2 件」。整条活儿里本喵**一次都没写「什么样才算够大」**，那是递进来的那截规矩的事。
meow: 叼回 2 件，规矩说完就收工喵～
pose: proud
还没问过的 = （都问过了）
递到规矩面前的 = （递完了）
规矩报的答案 = （问完了）
数到几件 = 2
```

一句话收住：**递进去的是「怎么算行」这件事本身，不是算好的结果** —— 所以它落到招式里以后，柜子里的每一件都得自己走一趟去问它；换一截规矩，同一个柜子就数出另一个数，会变的那部分已经被拎出来了。

::: warn 小心喵

- **只挂得上「一张嘴的约定」。** 约定上写了不止一张嘴，`() -> ...` 这种写法就填不清是哪一张，翻译稿子时直接红（`is not a functional interface`）。
- **左手那一栏要么都写、要么都不写。** `(int x) -> ...` 和 `x -> ...` 都对，但 `(int x, y) -> ...` 这种一半写一半不写的，翻译官喵不认。
- **交出去之后不许再改它碰过的仓库。** 这一条翻译稿子时就查，所以看见 `must be final or effectively final` 就往这上面想 —— 把改的那句挪走，或者另起一个仓库。
- **中间加了活儿就别伸手一指。** 只有「原封不动递过去」才指得上；想加工就老老实实写完整那一小截。
- **一小截别写太长。** 超过一行还塞不下的话，宁可给它起个名字单独放开 —— 图的就是短，不是图省字。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `new Speaker() { ... }` | 老写法：**当场造一只只会这一手的猫**（要起架子，啰嗦） |
| `x -> x * 2` | 新写法：投喂一个 `x`，叼回 `x * 2` —— 连名字都不起 |
| `(int x) -> x + 10` | 左边那一栏把牌子**明写出来**，写不写都行 |
| 约定上写了两张嘴，还想用 `() -> ...` | **翻稿子时就红**：`is not a functional interface` |
| `int count = 0;` 之后又有 `count = 1;` 再交出去用 | **翻稿子时就红**：`must be final or effectively final` |
| `int count = 2;` 之后一个字没改，就交出去用 | 合法：这就叫「**事实上没被改过**」 |
| `System.out::println` | 伸手一指那位现成的：投喂进来的**原封不动**递过去 |
| `name -> System.out.println("你好 " + name)` | 中间加了活儿，**指不了**，只能完整写出来 |
| `countIf(box, x -> x >= 5)` | 把一小截**当规矩递进去** —— 会变的那部分被拎出来了 |

::: tip 猫咪提示

- **老写法和新写法是同一件事**：老的是当场造一只只会这一手的猫，新的是把那一手直接端出来 —— 中间那只猫由翻译官喵自己造好，本喵看不见它。
- **箭头左边是投喂进来的、右边是要叼回去的**；左边那一栏要么都写、要么都不写。
- **这种写法只挂得上「一张嘴的约定」**：约定上写了不止一张嘴，本喵这一小截就填不清是哪一张。
- **交出去的招式碰过的仓库，交出去之后就不许再动** —— 想换值，就另起一个仓库，把新的那个交给它。
- **伸手一指要占住两条**：那位现成的本来就在、投喂进来的东西原封不动递给它；中间想加活儿，就老老实实写完整喵。

:::

## 小任务

1. 把第一节那只当场造出来的猫，照着第二节改成一小截直接写出来的招式，跑一遍看输出是不是还是 `喵～`。
2. 把第三节那个「喊了 N 声」的例子**原样跑一遍**，确认它真的编不过；再把 `count = 1;` 那一行删掉跑一遍，比较两次的结果。
3. 给第四节那个 `countIf` 加第三条规矩：**数一数大于 3 的那些**。想想为什么这一招**一个字都不用改**。
4. 把 `names.forEach(System.out::println);` 换成 `names.forEach(name -> System.out.println(name.length()));`，先猜输出，再跑一遍验证。
5. 想一想：为什么「交出去的招式碰过的仓库不许再改」是**在保护本喵**，而不是在为难本喵？

下一课，本喵要把这一小截招式**串成一条流水线**：从柜子头上接出来，中间挂上过筛子、加工几道活儿，最后挂一道收尾，一口气把活儿干完 —— 而且**中间那几道挂上去的时候，其实一件东西都还没动喵**～ 🐾
