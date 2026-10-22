---
id: java-stage1-06
lang: java
stage: 1
order: 9
title: if 与 switch——看鱼干眼色行事
tags: [条件判断, 分支, switch, 三元运算]
required: [java-stage1-05]
crossRefs: ["common-05", "c-stage1-06", "cpp-stage1-06", "python-stage1-07"]
compare: ["common-05"]
estMinutes: 25
keywords: [if, else, switch, case, break]
---

## 钩子：出门前，本喵先看一眼猫粮碗

本喵每天早上出门前，都要先低头看一眼猫粮碗：

- 鱼干堆得冒尖 → 今天不慌，先回猫窝晒会儿太阳。
- 只剩两三根 → 得省着点吃，顺便盯着大肥鱼别偷拿。
- 碗底空空的 → 只好去鱼塘边找大肥鱼要点救济。

三条路，本喵看一眼就知道该走哪条。这一眼，术语表里叫**看鱼干眼色行事（条件判断）**，写进代码里靠的就是今天这几个词：`if`、`else if`、`else`、`switch` 喵。

## 一个眼色，一条路

先看最小的形状：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 3;
        if (fish > 0) {
            System.out.println("碗里还有鱼干，开吃喵");
        }
    }
}
```

```text
碗里还有鱼干，开吃喵
```

拆开只有三块：

1. **眼色** —— `fish > 0`。这是本喵问电脑的一句话：「碗里的条数比 0 大吗？」上一课学的比较锅铲，答出来只有 `true`（真）或者 `false`（假）两块牌子。
2. **一对大括号 `{}`** —— 把「归这条路管的话」圈起来。眼色答 `true`，大括号里的活儿才上场。
3. **里面那一句** —— 真正要干的活。

### 归谁管，看的是大括号

Java 圈人**只认大括号**。缩进（行首那几格空白）在 Java 里是**写给人看的**——让代码清清爽爽，翻译官喵根本不看它。这一条要跟本喵记牢：

- **大括号圈起来的，才是这条路的活儿。** 少写一个大括号，或者把 `}` 挪错了地方，那几句话的归属就变了。
- **缩进不能帮你兜底。** 你以为「往里让了一格」它就归上面管？Java 说：不行，本喵只认括号。

大括号里的活儿可以有好几句，一句也行：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 0;
        if (fish > 0) {
            System.out.println("碗里还有鱼干喵");
            System.out.println("本喵先吃一条喵");
        }
        System.out.println("不管碗里有几条，这一句都跑喵");
    }
}
```

```text
不管碗里有几条，这一句都跑喵
```

碗里是 0 条，所以眼色答了假，大括号圈起来的那两句**一句都没上场**；只有最后那句站在大括号外面的，照样跑。**里外差一层括号，命运就完全不同**——这就是「圈起来才归它管」的意思喵。

## 三路眼色：`if` / `else if` / `else`

只有一条路要挑的时候，一个 `if` 就够了。可本喵今天有三条路：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 2;

        if (fish >= 5) {
            System.out.println("鱼干满满，本喵先晒会儿太阳喵");
        } else if (fish > 0) {
            System.out.println("快见底啦，省着点吃喵");
        } else {
            System.out.println("碗空了，去找大肥鱼要点喵");
        }
    }
}
```

```text
快见底啦，省着点吃喵
```

读法只有一句话：**从上往下一个一个问，谁先答 `true` 就走谁那条路，然后整串眼色到此结束。**

本喵把第一行换个数，三条路就都露一次脸：

| `fish` 是几 | 谁答了真 | 屏幕上印出 |
|---|---|---|
| `9` | `fish >= 5` | 鱼干满满，本喵先晒会儿太阳喵 |
| `2` | `else if (fish > 0)` | 快见底啦，省着点吃喵 |
| `0` | 前面全答假，轮到 `else` | 碗空了，去找大肥鱼要点喵 |

`else` 是这一串的**兜底**：前面每个眼色都答了假，才轮到它。它后面**不写眼色**——它不用问，它就是「剩下的全归我」。

顺便交代两件事：

- 中间的候补（`else if`）**想排几个排几个**，一路往下排都行；但一串的末尾最多只站一个兜底。
- `else` **不是非写不可**。不写的话，前面全答假就**什么都不做**——这一串眼色整体跳过，程序接着往下跑喵。

### 第一个答了真，后面就不问了

这是 `else if` 最要紧的脾气，本喵单独拎出来。看这段：

```java
public class Main {
    public static void main(String[] args) {
        int score = 95;
        if (score >= 60) {
            System.out.println("及格喵");
        } else if (score >= 90) {
            System.out.println("优秀喵");
        }
    }
}
```

```text
及格喵
```

95 分，屏幕上却只印出「及格喵」。因为第一个眼色「大于等于 60 吗」已经答了真，电脑高高兴兴走了那条路，**后面那句「90 以上吗」根本没被问出口**。这段代码一个错都不报——它只是安安静静给出了不对的结果，这种最费眼神喵。

所以排眼色有一条规矩：**最严的条件放最上面**（先问「90 以上吗」，再问「60 以上吗」）。

这一段为什么只印出一句，本喵拆成一步一步，走给你看：

```demo
title: 95 分为什么只印出「及格喵」
code:
| int score = 95;
| if (score >= 60) {
|     System.out.println("及格喵");
| } else if (score >= 90) {
|     System.out.println("优秀喵");
| }

step 先把分数装进罐子
at: 1
say: `int score = 95;` 先把 95 装进 `score`。这一课两句眼色都要拿它去比，可这会儿**一句都还没问**，屏幕上也是空的。
meow: 95 分装好了，还没开始问喵！
pose: expect
score = 95
这一问的答案 = 还没问
走过哪几行 = 一行都还没走

step 问第一句：95 大于等于 60 吗
at: 2
say: 走到 `if (score >= 60)`。电脑先把小括号里这半句**算一遍** —— 它问的是「95 大于等于 60 吗」。算出来的只有一块牌子：`true`（真）或者 `false`（假）。
meow: 95 大于等于 60 吗？本喵算算～
pose: busy
score = 95
这一问的答案 = 正在算
走过哪几行 = 走到第 2 行

step 牌子亮出来了：true
at: 2
say: 算出来了，牌子是 **`true`**。**这一步电脑还什么都没干** —— 屏幕上空空的，它手里只有一块写着 `true` 的牌子，走哪条路还没挑。
meow: 是 true！牌子先捏在手上喵～
pose: busy
score = 95
这一问的答案 = true
走过哪几行 = 走到第 2 行

step 挑中这一条：印出「及格喵」
at: 3
say: 拿着 `true` 挑路，挑中的是大括号里那一句：屏幕上印出「及格喵」。**归这条路管的活儿，全看那一对大括号圈住了谁** —— 圈在里面的才跑。
meow: 门开了，「及格喵」印出来啦！
pose: yay
score = 95
这一问的答案 = true
走过哪几行 = 走过第 3 行

step 第二问：根本没问出口
at: 4
say: **最要紧的一步在这里**。这一串眼色到此结束了 —— 第 4 行那个 `else if (score >= 90)` **连问都没问**。95 分到底有没有 90 以上？电脑**根本不知道**，因为它压根没算过这一句。
meow: 第二问没轮到，电脑都不知道呢！
pose: think
score = 95
这一问的答案 = true
走过哪几行 = 走过第 3 行

step 「优秀喵」一个字都没印
at: 5
say: 所以第 5 行那句话**一个字都没印**：95 分的卷子，屏幕上只有「及格喵」。这段代码一个错都不报，它只是**安安静静给了你不对的结果** —— 这就是「最严的条件要放最上面」的道理。
meow: 优秀那句，今天白写了喵～
pose: proud
score = 95
这一问的答案 = true
走过哪几行 = 走过第 3 行
```

**这一条记牢**：`if` / `else if` / `else` 是一串**排队挨个问**的眼色 —— 谁先答 `true` 就走谁，**后面那几句问都不问**；所以最严的条件要排在最上面喵。

### 两个独立的眼色，两条路都可能走

要是本喵想让两句话**都**有机会印出来呢？那就写成**两个各自独立的 `if`**：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 3;
        if (fish > 0) {
            System.out.println("有鱼干，开吃喵");
        }
        if (fish > 2) {
            System.out.println("而且还挺多喵");
        }
    }
}
```

```text
有鱼干，开吃喵
而且还挺多喵
```

两句话都印出来了——因为这是**两个各自独立的眼色**，电脑会一个一个都问一遍，谁答真谁就上场。这跟上一段那种「一串眼色」是两回事：

- **两个独立的 `if`**：两个眼色都会被问，可能两条路一起走。
- **`if` + `else if`**：一串眼色，前面那个答了真，后面的**连问都不问**。

想要「最多只走一条路」，就把它们串成一串；想要「每件事各问一句，该走的都走」，就分开写成几个 `if`。用哪种，看你心里的规矩是哪一条喵。

## 项链也能当眼色：`.equals(...)`

上一课学过的那条规矩，在这里天天要用：**两串字比「一样不一样」，要用 `.equals(...)`，不能用 `==`**。

```java
public class Main {
    public static void main(String[] args) {
        String weather = "晴";
        if (weather.equals("雨")) {
            System.out.println("带伞出门喵");
        } else {
            System.out.println("晒鱼干去喵");
        }
    }
}
```

```text
晒鱼干去喵
```

`weather.equals("雨")` 问的是「`weather` 里那串字，跟「雨」内里一样吗」，答出来也是一块 `true` / `false` 的牌子——凡是能问出牌子的地方，`if` 都收。而写成 `weather == "雨"` 就掉进上一课那个坑里了：屏幕上的字明明一样，它却可能给你一个 `false`，**一个错都不报**喵。

## `switch`：一根手指戳进一排格子

有时候本喵要看的不是「大于小于」，而是**「刚好等于哪一样」**——比如碗里正好是 1 条、2 条、还是 3 条。这种「一根手指戳进一排格子，戳中哪个就走哪个」的活儿，Java 备了一把专门的工具：`switch`。

```java
public class Main {
    public static void main(String[] args) {
        int n = 2;

        switch (n) {
            case 1:
                System.out.println("还剩一条喵");
                break;
            case 2:
                System.out.println("还剩两条喵");
                break;
            case 3:
                System.out.println("还剩三条喵");
                break;
            default:
                System.out.println("数不清了喵");
        }
    }
}
```

```text
还剩两条喵
```

拆开看：

- **`switch (n)`** —— 把要看的那个东西放进小括号。它只会问一件事：「你**等于**第几号格子？」
- **`case 1:`** —— 一个格子。`n` 等于 1 就从这儿往下跑。冒号不能少。
- **`break`** —— 「这一格办完了，收工走人」。撞上它，整个 `switch` 就结束了。
- **`default:`** —— 兜底格子，哪个 `case` 都没戳中才轮到它，跟 `else` 是一个角色。

### 忘了 `break` 会一路滑下去

`break` 是 `switch` 里最容易漏、后果最滑稽的一个词。本喵把上面那段里的 `break` 全拿掉给你看：

```java
public class Main {
    public static void main(String[] args) {
        int bowl = 2;

        switch (bowl) {
            case 1:
                System.out.println("只剩一条喵");
            case 2:
                System.out.println("还剩两条喵");
            case 3:
                System.out.println("还剩三条喵");
                break;
            default:
                System.out.println("数不清了喵");
        }
    }
}
```

```text
还剩两条喵
还剩三条喵
```

`bowl` 明明只有 2，屏幕上却冒出两句——因为 `switch` 戳中 `case 2` 之后**不会自己停**：它从戳中的那一格开始，**一路往下滑**，把下面的格子挨个执行过去，直到撞上 `break` 才刹车。第三格底下有个 `break`，所以滑到那儿就停了；要是连它也没有，`default` 那句也会跟着印出来。

::: warn 小心喵
`switch` 两条铁规矩：

1. **每一格办完事都要 `break`**（除非你**故意**想让它滑下去）。漏掉一个，屏幕就会多印几句，而程序一声不吭。
2. **`case` 后面只能写「扁扁的一个值」**——整数、字符、或者一串字（像 `case "晴":` 这样），不能写 `case n > 3:` 这种问句。要问「大于小于」，那是 `if` 的活。

还有一条：戳中哪个格子看的是**「是不是同一个值」**，跟上一课那条规矩合起来记——`switch` 比的是值，不是「是不是同一个东西」，所以它没有 `==` 那个坑喵。
:::

这一路滑下去是怎么发生的，本喵拆成一步一步，走给你看：

```demo
title: 只报了一个 2，为什么印出两句
code:
| int bowl = 2;
| switch (bowl) {
|     case 1:
|         System.out.println("只剩一条喵");
|     case 2:
|         System.out.println("还剩两条喵");
|     case 3:
|         System.out.println("还剩三条喵");
|         break;
|     default:
|         System.out.println("数不清了喵");
| }

step 先把要看的数装好
at: 1
say: `int bowl = 2;` 先把要看的数装好：**2**。这会儿 `switch` 那一行还没走到，一个格子都还没戳过。
meow: 碗里 2 条，准备戳格子喵！
pose: expect
bowl = 2
戳中的格子 = 还没戳
现在跑到哪一格 = 还没进门

step 戳号：拿 2 去比格子
at: 2
say: `switch (bowl)` 干的是**戳一次**：拿 `bowl` 里的 2，去跟每个 `case` 后面的值比「你等于第几号格子」。它只问得了「等于哪一格」，「大于 3 吗」这种问句它答不了。
meow: 一格一格戳：你是 2 号吗？
pose: busy
bowl = 2
戳中的格子 = 正在戳
现在跑到哪一格 = 还没进门

step 戳出来了：第 2 格
at: 2
say: 戳出一个答案：**第 2 格**（`case 2`）。**到这一步电脑一行代码都还没跑** —— 屏幕上空空的，它只知道「该从哪一格开始」。
meow: 戳中第 2 格，就是它！
pose: busy
bowl = 2
戳中的格子 = 第 2 格（case 2）
现在跑到哪一格 = 还没进门

step 跳到第 2 格，从这儿往下跑
at: 5
say: 有了答案，电脑才跳到第 5 行的 `case 2:` —— **第 3、4 行那两行根本没碰**。`case` 只管「跳到这儿」，它不管「在这儿站住」。
meow: 直接跳到第 2 格，前两行没碰喵～
pose: expect
bowl = 2
戳中的格子 = 第 2 格（case 2）
现在跑到哪一格 = 第 2 格（case 2）

step 印出「还剩两条喵」
at: 6
say: 第 6 行的 `println` 跑掉，屏幕上印出「还剩两条喵」。到这儿一切正常 —— **麻烦在于这一格底下没有 `break`**：路还开着。
meow: 还剩两条，可路没封住喵～
pose: yay
bowl = 2
戳中的格子 = 第 2 格（case 2）
现在跑到哪一格 = 第 2 格（case 2）

step 走到下一格：它不拦人
at: 7
say: **最要命的一步在这里**。印完第 6 行，电脑顺路走到了第 7 行的 `case 3:` —— 可 `case` 只是一格**标签**，它不拦人。没有 `break` 把路封住，电脑就从这一格底下**接着往下滑**。
meow: 格子不拦人，就这么滑过去了！
pose: think
bowl = 2
戳中的格子 = 第 2 格（case 2）
现在跑到哪一格 = 滑到第 3 格（case 3）

step 又印出「还剩三条喵」
at: 8
say: 第 8 行的 `println` 也跑掉了，屏幕上冒出**第二句**：「还剩三条喵」。**注意「戳中的格子」那一栏一直停在第 2 格** —— 电脑**只戳了一次**，这句不是戳出来的，是顺着滑下来的。
meow: 三条也印了，本喵没戳它呀！
pose: think
bowl = 2
戳中的格子 = 第 2 格（case 2）
现在跑到哪一格 = 滑到第 3 格（case 3）

step 撞上 break，刹车
at: 9
say: 再往下滑，第 9 行站着一个 `break` —— 它才是那个**把路封住**的东西。撞上它，整个 `switch` 就结束了，电脑出门接着跑下面的代码。
meow: 撞上 break，刹车啦喵！
pose: proud
bowl = 2
戳中的格子 = 第 2 格（case 2）
现在跑到哪一格 = 出门了

step 收工：兜底那一格一行都没跑
at: 10
say: 出门以后回头看：第 10 行往下的 `default` **一行都没跑**。课文说「第三格底下有个 `break`，所以滑到那儿就停了」—— 滑的就是第 7 到第 9 行这三行。
meow: 兜底那句，今天没轮到它喵～
pose: proud
bowl = 2
戳中的格子 = 第 2 格（case 2）
现在跑到哪一格 = 出门了
```

**记住这一条**：`switch` 只**戳一次**（「戳中的格子」那一栏从头到尾没变过），戳完就从那一格往下**挨格滑**；想让路停下来，靠的是底下那个 `break` 喵。

`switch` 的格子可不只数字，一串字也照样戳：

```java
public class Main {
    public static void main(String[] args) {
        String weather = "雨";

        switch (weather) {
            case "晴":
                System.out.println("晒鱼干喵");
                break;
            case "雨":
                System.out.println("收鱼干喵");
                break;
            default:
                System.out.println("随它去吧喵");
        }
    }
}
```

```text
收鱼干喵
```

戳中的是「雨」那一格，印出「收鱼干喵」；要是 `weather` 换成「雪」，哪个格子都没戳中，就轮到 `default` 兜底啦喵。

## 三元运算：一句话里的小眼色

最后一样是给**懒猫**准备的。本喵只想要「两边挑大的那个」这一句话，写成 `if` / `else` 要占五、六行，太长了。Java 备了个一行写法：

```java
public class Main {
    public static void main(String[] args) {
        int a = 7;
        int b = 3;
        int max = a > b ? a : b;
        System.out.println(max);
        System.out.println(a > b ? "左边大喵" : "右边大喵");
    }
}
```

```text
7
左边大喵
```

念法就是它的全部秘密：

**`条件 ? 答真时候的值 : 答假时候的值`**

- `a > b` 是眼色，答真还是假。
- `?` 后面那一段：**答真**的时候用这个值。
- `:` 后面那一段：**答假**的时候用这个值。

所以 `a > b ? a : b` 读作「`a` 比 `b` 大吗？大就用 `a`，不然用 `b`」——`7` 比 `3` 大，`max` 拿到 `7`。第二行挑的是两串字，说明**三元也能挑项链**，两边放什么都行，只要是同一个料。

再念一遍那三个记号：**`?` 前面是眼色、`?` 后面是真值、`:` 后面是假值**。真值假值两边写反了，写出来的东西照样能跑，只是答案反了——这种最费眼神喵。

## 拿错料会怎样

`if` 的小括号里要的是**一块 `true` / `false` 的牌子**。本喵手滑写成一个等号（装东西的动作）会怎样：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 3;
        if (fish = 3) {
            System.out.println("碗里有鱼干喵");
        }
    }
}
```

翻译官喵当场拦下：

```text
Main.java:4: error: incompatible types: int cannot be converted to boolean
        if (fish = 3) {
                 ^
1 error
```

翻译过来是：**「这个位置要一块真假牌子，你给本喵一个整数，对不上。」** `=` 是装东西（`fish = 3` 的结果是一个整数），`==` 才是问话（结果是一块牌子）。这个小括号里，永远写 `==` 喵。

::: tip 猫咪提示
今天记住这五句话，看眼色就够用啦：

1. **眼色 = 能答出 `true` / `false` 的式子**；`if` 后面跟**大括号**，圈起来的才归它管。
2. **`if` / `else if` / `else` 是一串**：从上往下问，第一个答真的说了算，后面的连问都不问——所以**最严的条件放最上面**。
3. **想要「两条路都可能走」，就写成两个独立的 `if`。**
4. **`switch` 专供「刚好等于哪一样」**：一个 `case` 一格，办完事记得 `break`，兜底写 `default`。
5. **`条件 ? 真值 : 假值`**——三元就是一句话里的小眼色；两串字比一样不一样，永远用 `.equals(...)`。
:::

## 小任务

1. 把三路眼色那段抄进练习场，把第一行的 `fish` 依次改成 `9`、`2`、`0`，看看屏幕上走的是哪条路喵。
2. 再把 `if (fish >= 5)` 里的 `>=` 换成 `>`，重跑一遍——碗里正好 5 条的时候，还印「鱼干满满」吗？
3. 把第一行改成 `fish = 0`，再把 `else` 那一行和它大括号里的活儿一起删掉，跑一遍（`else` 可以不写）。碗空的时候，屏幕上还剩什么？
4. 把 `switch` 那段里 `case 1:` 底下的 `break` 删掉，把 `n` 改成 `1` 跑一遍——看看它滑到了哪儿。
5. 试着改一改：把「三路眼色」整段改写成 `switch` 能写吗？（提示：`switch` 只会问「等于几」，问不了「大于等于 5」——所以这一题的答案是**写不了**，本喵故意留给你撞一下喵。）

下一课，本喵要带你学**绕鱼干跑圈**：让同一套动作重复跑好多遍，`for` 和 `while` 一起上——今天的大括号和眼色老规矩，在那边还要接着用喵。去「for 与 while」探险喵～ 🐾
