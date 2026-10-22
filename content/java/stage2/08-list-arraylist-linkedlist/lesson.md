---
id: java-stage2-08
lang: java
stage: 2
order: 8
title: 集合框架：ArrayList 与 LinkedList
tags: [集合, 储物柜]
required: ["java-stage2-07"]
crossRefs: []
compare: ["common-13"]
estMinutes: 28
keywords: [List, ArrayList, LinkedList, add]
---

## 钩子：碗数钉死的那一排，不够用了

还记得学过的**一排贴编号的猫粮碗**吗？开的时候得说好「本喵要 5 个碗」，翻译官喵就给你削 5 个碗出来，编号 0 到 4。用起来是快，可它有个死板的脾气：**碗数在开头就钉死了**。

开饭的时候突然来了第六只猫怎么办？那排碗**一个都加不进去**，只能重新削一排更大的、把旧的五个碗一个一个搬过去 —— 搬一次还行，要是天天来新猫，那就搬不完了。

今天本喵要学的是**另一种装法：会自己长大的储物柜**。想吃就往里加一格，柜子自己会变大，编号照样从 0 起，取第几格就取第几格。这一课学完，往后装一串猫、一串纸条、一串账本，就都靠它了喵。

## 一、先立个名分：一边是「约定」，一边是「柜子」

Java 里这些会自己长大的柜子**不止一种**，每种装法各有各的长处。为了换柜子的时候不用把程序重写一遍，Java 把它们共同的用法抽出来写成了一份**接口（与猫的约定）** —— 这份约定叫 `List`，说的是：

> 谁家柜子想要叫 `List`，就得会 `add`（加一格）、`get`（按编号取）、`remove`（拿掉一格）、`size`（报格数）这几招。

约定和柜子是**分开写**的，写法长这样：

```java
List<String> bowls = new ArrayList<>();
```

- **左边那份名分**（`List` 后面跟一对尖括号，括号里写着 `String`）说的是「本喵要一份 `List` 的约定，里面装项链」—— 这是**名分**。
- **右边的 `new ArrayList<>()`** 说的是「具体给本喵来一个 `ArrayList` 这种柜子」—— 这是**实体**。
- **尖括号里那一块**（上面写的是 `String`）是「这柜子只装项链」的牌子（下一课、再下一课都在跟它打交道，今天先照着写）。`new` 后面那对**空的尖括号**是 Java 的省事写法，意思是「和左边一样」。

好处在哪？哪天发现 `ArrayList` 不合用，只要把右边一换 —— **左边那行名分不用改，别处的代码一行都不用动**。

## 二、柜子常用的招式

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> bowls = new ArrayList<>();
        bowls.add("小橘");
        bowls.add("狸花");
        bowls.add("大橘");
        System.out.println(bowls.get(1));
        System.out.println(bowls.contains("大橘"));
        System.out.println(bowls.indexOf("狸花"));
        bowls.remove("小橘");
        System.out.println(bowls.size());
        for (String name : bowls) {
            System.out.println("碗里有 " + name);
        }
    }
}
```

```text
狸花
true
1
2
碗里有 狸花
碗里有 大橘
```

- **`add("小橘")`** —— 往柜子**最后**加一格。注意：**不用事先说要几格**，柜子自己长大。
- **`get(1)`** —— 按编号取。编号照样**从 0 起**，所以取出来是第二格的 `狸花`。
- **`contains("大橘")`** —— 柜子里有没有这串字。
- **`indexOf("狸花")`** —— 它在第几格；找不到给 `-1`（记号，不是报错）。
- **`remove("小橘")`** —— 按**内容**拿掉那一格。拿掉之后后面的碗会**往前挪一格**，所以 `size()` 从 3 变成 2。
- **`for (String name : bowls)`** —— 从头到尾挨个摸一遍，这只写法叫「逐个过一遍」。它比按编号数省事，也不怕编号数错。

## 三、两种柜子并排看

`List` 这份约定底下，今天先认两个实体：

| 柜子 | 它长什么样 | 快在哪 |
|---|---|---|
| `ArrayList` | 一排**挨着**的碗，编号连号 | 按编号 `get` / 改某一格，**飞快** |
| `LinkedList` | 一串用**猫爪指向牌**连起来的碗，每只碗都叼着「下一只在哪」 | 在**两头**加一格、拿掉一格，**飞快** |

并排跑一遍看看：

```java
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> a = new ArrayList<>();
        List<String> b = new LinkedList<>();
        a.add("小橘");
        a.add("狸花");
        b.add("小橘");
        b.add("狸花");
        a.set(0, "大橘");
        b.remove(1);
        System.out.println(a);
        System.out.println(b);
        System.out.println(a.size() + " " + b.size());
    }
}
```

```text
[大橘, 狸花]
[小橘]
2 1
```

- **`a.set(0, "大橘")`** —— 把编号 0 那格**换掉**。挨着排的柜子干这个飞快：编号算一算位置就直接改。
- **`b.remove(1)`** —— 按**编号**拿掉一格。这一招两个柜子都会，但干活的方式不一样：挨着排的柜子拿掉中间一格，**后面的碗全得往前挪**；用指向牌连起来的柜子只要把前后两只碗的指向牌改一改就行。
- **`System.out.println(a)`** —— 柜子可以直接印出来看，方括号里按编号排，这是它自带的方便。
- **`a.size() + " " + b.size()`** —— 数字和项链相加，凑出一行 `2 1`。

「拿掉中间一格，后面的碗往前挪」这件事在屏幕上**看不见**，本喵把它放慢给你看 —— 盯着「柜子」那一栏，数一数到底搬了几格喵。

```demo
title: 拿掉中间一格：后面的碗是怎么挨个往前挪的
code:
| List<String> bowls = new ArrayList<>();
| bowls.add("小橘");
| bowls.add("狸花");
| bowls.add("大橘");
| bowls.add("花花");
| bowls.remove(1);
| System.out.println(bowls);

step 先立名分，再给一只空柜子
at: 1
say: 左边 List<String> 是名分，右边 new ArrayList<>() 是实体。柜子这会儿一格都没有。
meow: 名分立好，空柜子到手喵～
pose: expect
柜子 = (空的)
搬了几格 = 0
size() = 0
印出来 = 还没印

step add("小橘") → 0 号格
at: 2
say: add 往最后加一格。柜子自己长大，本喵一句「要几格」都没说。小橘落在编号 0。
meow: 小橘住进 0 号格喵！
pose: busy
柜子 = 0:小橘
搬了几格 = 0
size() = 1
印出来 = 还没印

step add("狸花") → 1 号格
at: 3
say: 再加一格，狸花落在编号 1。
meow: 狸花住进 1 号格喵～
pose: busy
柜子 = 0:小橘 1:狸花
搬了几格 = 0
size() = 2
印出来 = 还没印

step add("大橘") → 2 号格
at: 4
say: 大橘落在编号 2。挨着排的柜子就是这样：一格挨着一格，编号连号。
meow: 大橘住进 2 号格喵！
pose: busy
柜子 = 0:小橘 1:狸花 2:大橘
搬了几格 = 0
size() = 3
印出来 = 还没印

step add("花花") → 3 号格
at: 5
say: 花花落在编号 3。柜子长到四格 —— 这四格在柜台里是**挨着坐**的。
meow: 花花住进 3 号格，够坐喵！
pose: busy
柜子 = 0:小橘 1:狸花 2:大橘 3:花花
搬了几格 = 0
size() = 4
印出来 = 还没印

step remove(1)：拿掉 1 号格
at: 6
say: remove 里给的是编号，所以拿掉的是 1 号格的狸花。这一格抽走，2 号和 3 号的位子就悬空了。
meow: 狸花被拿走了，中间空一格喵！
pose: think
柜子 = 0:小橘 1:(空) 2:大橘 3:花花
搬了几格 = 0
size() = 3
印出来 = 还没印

step 大橘往前挪一格
at: 6
say: 挨着坐的柜子不能留空位：大橘从 2 号搬到 1 号，搬了一格。
meow: 大橘往前挪一格，坐进 1 号喵～
pose: yay
柜子 = 0:小橘 1:大橘 2:(空) 3:花花
搬了几格 = 1
size() = 3
印出来 = 还没印

step 花花再往前挪一格
at: 6
say: 花花从 3 号搬到 2 号。这一下搬完，后面才没有空位 —— 挨着排的柜子拿掉中间一格，后面的每一格都得搬一次。
meow: 花花也挪一格，柜子又连号了喵！
pose: yay
柜子 = 0:小橘 1:大橘 2:花花
搬了几格 = 2
size() = 3
印出来 = 还没印

step 换成 LinkedList，这一下谁都不用搬
at: 6
say: 用猫爪指向牌连起来的柜子不挨着坐：拿掉一格，只要把前后两只碗的指向牌改一改。所以两头进出多的活儿才轮到它。
meow: 串起来的柜子只要改牌子喵～
pose: milestone
柜子 = 0:小橘 1:大橘 2:花花
搬了几格 = 2（LinkedList 是 0）
size() = 3
印出来 = 还没印

step 印出来
at: 7
say: 四格拿掉一格，size() 从 4 变成 3，印出来是 [小橘, 大橘, 花花] —— 编号重新连号，摸不到空位。
meow: 三格连号，一格不空喵！
pose: proud
柜子 = [小橘, 大橘, 花花]
搬了几格 = 2
size() = 3
印出来 = [小橘, 大橘, 花花]
```

那到底该用哪个？记住一条就够用：

- **绝大多数时候用 `ArrayList`** —— 本喵们的日常是「装一堆东西、挨个过一遍、偶尔按编号取一个」，这正好是它最擅长的。
- **只有一种情况想到 `LinkedList`**：东西总是从**两头**进、两头出（比如排队领小鱼干，永远在队尾加、队头取）。

::: warn 小心喵

- **两种柜子印出来长得一样、招式也几乎一样**，可**干活快慢不一样**。别因为「结果一样」就随手乱挑，量大起来差距很实在。
- **`remove` 有两个意思**：给**编号**（`remove(1)`）是拿掉第几格，给**项链**（`remove("小橘")`）是拿掉内容对得上的那一格。类型不同，做的事也不同。
- **柜子拿掉中间一格之后，后面所有编号都会往前挪一格**。如果你一边按编号摸、一边删，会摸到意想不到的东西 —— 要删就倒着数着删，或者攒起来回头一起删。

:::

## 四、编号数过了，当场炸

柜子不会给你 `null`，也不会默默放你过去：

```java
import java.util.ArrayList;

public class Main {
    public static void main(String[] args) {
        ArrayList<String> bowl = new ArrayList<>();
        bowl.add("小橘");
        bowl.add("狸花");
        System.out.println(bowl.get(5));
    }
}
```

```text
Exception in thread "main" java.lang.IndexOutOfBoundsException: Index 5 out of bounds for length 2
```

念起来是：**「你要第 5 格，可这柜子总共才 2 格喵。」** 这条护身符和项链的 `charAt` 是同一条规矩：能摸到的最大编号是 `size() - 1`。

::: tip 猫咪提示

1. **左边写名分 `List`（尖括号里写着装什么），右边写实体 `new ArrayList<>()`** —— 名分和柜子分开，将来换柜子只动一处。
2. **不用事先说几格**：想加就 `add`，柜子自己长大（这正是它比钉死的碗排好用的地方）。
3. **编号从 0 起，能摸到的最大编号是 `size() - 1`**，数过了当场炸。
4. **挑柜子的经验**：平常一律 `ArrayList`；东西总在两头进进出出，才轮到 `LinkedList`。
5. **挨个过一遍用 `for (String name : bowls)`**，比按编号数省事、也不容易数错。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `List` 名分配上 `new ArrayList<>()` | 左边是要一份 `List` 名分，右边实给一个挨着排的柜子 |
| `bowls.add("小橘")` | 在最后加一格，柜子自己长大 |
| `bowls.get(1)` | 按编号取（编号从 0 起） |
| `bowls.set(0, "大橘")` | 把编号 0 那格**换掉** |
| `bowls.remove("小橘")` / `bowls.remove(1)` | 按内容拿掉 / 按编号拿掉 |
| `bowls.contains("大橘")` / `bowls.indexOf("狸花")` | 有没有 / 在第几格（找不到给 `-1`） |
| `bowls.size()` | 现在有几格 |
| `for (String name : bowls)` | 从头到尾挨个摸一遍 |
| `new LinkedList<>()` | 换成用猫爪指向牌连起来的柜子（两头进出最快） |
| `bowl.get(5)`（只有 2 格） | 数过了 → 当场炸 `IndexOutOfBoundsException` |

## 小任务

1. 把第二节那段抄进练习场，把 `bowls.get(1)` 换成 `bowls.get(0)`，再在 `remove` 之后加一句 `System.out.println(bowls.get(0));` —— 亲眼看看「拿掉一格之后，后面的碗往前挪」是怎么回事。
2. 把第三节里 `b` 那行的柜子从 `new LinkedList<>()` 换成 `new ArrayList<>()`，看看印出来的东西是不是一模一样 —— 体会「约定一样、柜子不同」。
3. 试着把第二节那只柜子的牌子从 `String` 换成 `Integer`（只改名分那一行尖括号里的那块），往里面 `add` 几个数字、再用 `for` 过一遍把它们加起来印出来。（提示：这时候往柜子里塞的就是上一课那种「装数字的真猫」了。）
4. 想一想：如果本喵要装 **100 万**个数、还要不停按编号取第 50 万个，该挑哪个柜子？为什么？

下一课，本喵要教一种**不按编号、按名字找**的柜子：给它一个「名字」，它把那件东西**立刻**叼给你 —— 不管柜子里装了一万件还是一百万件。还有那种「同样的东西塞两遍只留一件」的柜子，一并认识喵～ 🐾
