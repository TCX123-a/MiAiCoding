---
id: java-stage2-09
lang: java
stage: 2
order: 9
title: HashMap 与 HashSet
tags: [集合, 账本]
required: ["java-stage2-08"]
crossRefs: []
compare: ["common-13"]
estMinutes: 28
keywords: [HashMap, HashSet, put, get]
---

## 钩子：一万件东西里，怎么一秒找到那一件

上一课的储物柜有个死穴：**只能按编号找**。想要 `小橘` 那件东西，本喵得先记得它在第几格 —— 可要是柜子里塞了**一万件**，谁记得住小橘在第几格喵？

现实里本喵不这么干。本喵开一本**账本**：一页只记一件事，**左边写名字，右边写东西**。想找小橘？翻到写着「小橘」的那一行，右边就是它。名声在外，一眼就到。

这一课学的就是这种柜子：**按名字找，不按编号找**。

## 一、账本：名字 → 那件东西

这种「一个名字配一件东西」的搭配，正式说法叫**键值对** —— 「键」就是名字，它开的门；「值」就是挂在门后的那件东西。

在 Java 里它叫 `Map`，最常用的一种实体叫 `HashMap`：

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    public static void main(String[] args) {
        Map<String, Integer> book = new HashMap<>();
        book.put("小橘", 3);
        book.put("狸花", 5);
        book.put("小橘", 7);
        System.out.println(book.get("小橘"));
        System.out.println(book.size());
        System.out.println(book.containsKey("狸花"));
        System.out.println(book.get("大肥鱼"));
        System.out.println(book.getOrDefault("大肥鱼", 0));
    }
}
```

```text
7
2
true
null
0
```

尖括号里这次挂着**两块牌子**：第一块写名字是什么，第二块写东西是什么 —— 上面那句读作「名字是项链，东西是数字」。一字一字看喵：

- **`put("小橘", 3)`** —— 在账本上写一行：名字 `小橘`，东西 `3`。
- **`put("小橘", 7)`** —— **同一个名字再写一遍，不是加一行，是把那一行改写掉**。所以下面 `get("小橘")` 拿到的是 `7`，`size()` 也只有 `2` —— 账本上只有两个名字。
- **`get("狸花")`** —— 按名字取东西。
- **`containsKey("狸花")`** —— 账本上有没有这个名字。
- **`get("大肥鱼")`** —— 这个名字**不在账本上**，`get` 叼回来的是 `null`（一只**空口袋**）—— 它不报错，也不给你 `0`，就是「什么都没叼到」。
- **`getOrDefault("大肥鱼", 0)`** —— 带着兜底值去取：名字在就给真东西，不在就给你写好的那个 `0`。**拿可能不存在的名字时，这一招最省心。**

::: tip 猫咪提示

**`get` 拿不到东西时给的是 `null`，不是 `0`、也不是报错。** 所以要当心：直接拿 `null` 去算数（比如上一课那种「装数字的真猫」拆箱），当场就炸 —— 见下面第四节。**拿不准名字在不在**，就用 `containsKey` 先问一句，或者直接用 `getOrDefault` 兜底喵。

:::

这几手到底是怎么走的？本喵把它拆成一步一步，走给你看：

```demo
title: 递一个名字过去，账本是怎么一步够到那一行的
code:
| Map<String, Integer> book = new HashMap<>();
| book.put("小橘", 3);
| book.put("狸花", 5);
| book.put("小橘", 7);
| System.out.println(book.get("小橘"));
| System.out.println(book.size());
| System.out.println(book.get("大肥鱼"));

step 先立一本空账本
at: 1
say: `new HashMap<>()` 是一本**空账本**，一页都还没写。尖括号里那两块牌子（名字是什么、东西是什么）在这儿就挂好了，可账本上此刻一个名字都没有。
meow: 空账本到手，一页都还没写喵～
pose: expect
账本上 = （空的）
递过去的名字 = （还没递）
它直接翻到 = （还没翻）
叼回来的东西 = （还没取）

step 写第一行：递名字、放东西
at: 2
say: `put("小橘", 3)` 递进去两样：名字 `小橘`、东西 `3`。账本**不是从第一页一行行找起** —— 它按这个名字直奔该去的那一行，写上「小橘 → 3」。
meow: 名字一递，直奔那一行喵！
pose: busy
账本上 = 小橘 → 3
递过去的名字 = "小橘"
它直接翻到 = 小橘那一行
叼回来的东西 = （还没取）

step 再来一位：狸花 → 5
at: 3
say: 同一个道理：`狸花` 这个名字也是直奔它自己那一行写上去。账本上现在有**两行** —— 每行一个名字，名字和行是一对一的。
meow: 狸花也住进自己那一行咯～
pose: busy
账本上 = 小橘 → 3，狸花 → 5
递过去的名字 = "狸花"
它直接翻到 = 狸花那一行
叼回来的东西 = （还没取）

step 同一个名字再写一遍：改写那一行
at: 4
say: 又是 `小橘` —— 它翻到的**还是刚才那一行**。这一行最要紧的话就在这儿：`put` 一个已经有的名字**不是加一行，是把那一行改写掉**。所以账本上还是两行。
meow: 还是那一行，改写掉，不加新的喵！
pose: think
账本上 = 小橘 → 7，狸花 → 5（还是两行）
递过去的名字 = "小橘"
它直接翻到 = 小橘那一行（同一行）
叼回来的东西 = （还没取）

step 拿东西：递名字，一步取回
at: 5
say: `get("小橘")` 只递一个名字。它同样**不是从头一行行翻**，而是直奔小橘那一行，把右边的东西叼回来 —— 取到的是 `7`，就是刚才改写进去的那个 7。
meow: 一步跳到小橘那行，叼回 7！
pose: yay
账本上 = 小橘 → 7，狸花 → 5
递过去的名字 = "小橘"
它直接翻到 = 小橘那一行（一步就到）
叼回来的东西 = 7

step 数一数：账本上有几个名字
at: 6
say: `size()` 这一手不用递名字，它报的是账本上**有几行名字**。一共写过三回（小橘、狸花、小橘），可小橘那一回是改写 —— 所以是 **2**，不是 3。
meow: 两行就是两行，改写不算新的喵！
pose: proud
账本上 = 小橘 → 7，狸花 → 5
递过去的名字 = （这一手不用递名字）
它直接翻到 = （不用翻）
叼回来的东西 = 2

step 递一个账本上没有的名字
at: 7
say: `get("大肥鱼")` —— 这个名字该去的那一行**是空着的**，账本上没有东西可给。它不报错、也不给 `0`，叼回来的是一只**空口袋**（`null`）。
meow: 那行空着，只叼回一只空口袋喵…
pose: think
账本上 = 小橘 → 7，狸花 → 5
递过去的名字 = "大肥鱼"
它直接翻到 = 大肥鱼那一行（空着）
叼回来的东西 = 空口袋（null）
```

**最要紧的一句**：从头到尾账本**一次都没从第一页翻起** —— 名字一递过去，它就直奔那一行。它是怎么做到的？下一节就讲喵。

## 二、为什么它这么快：名字会被算成一个「座位号」

账本可不是从第一页翻到最后一页找名字的 —— 那样一万行得翻一万次，就不叫「一眼就到」了。

Java 的办法是：**把名字算成一个数字**（这套算法叫**哈希**），按这个数字直接翻到那一页去。所以名字一递过来，它一步就能跳到该看的地方，行数多也不怕。

这里有个要记住的后果：**账本是按名字算出来的座位号摆的，不按你写进去的先后摆**。所以你挨个过一遍的时候，出来的顺序看着**乱七八糟** —— 那不是出 bug 了，那就是它本来的样子喵。

正因为顺序不保证，本喵**从不指望它按什么顺序出来**。要挨个过一遍时，本喵只做「跟顺序无关的事」，比如把所有数字加起来：

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    public static void main(String[] args) {
        Map<String, Integer> book = new HashMap<>();
        book.put("小橘", 3);
        book.put("狸花", 5);
        book.put("大橘", 2);
        int total = 0;
        for (String name : book.keySet()) {
            total = total + book.get(name);
        }
        System.out.println("一共 " + total + " 条");
        System.out.println(book.keySet().size());
    }
}
```

```text
一共 10 条
3
```

- **`book.keySet()`** —— 把账本上**所有名字**拢成一串，好挨个摸。
- **`for (String name : book.keySet())`** —— 名字一个一个来；`book.get(name)` 就能拿到那一行右边的东西。
- **加出来的总数**和名字的个数，都**跟顺序无关**，所以这个结果永远是稳的。
- 想按顺序摆着看，得另外喊一招（`TreeMap` 那种一进去就自己排好的柜子），今天先不铺开。

## 三、只留一件的柜子：`HashSet`

有时候本喵只关心「**来过没有**」：今天来吃饭的猫有哪些？小橘来了三趟，可名单上它只能算**一只**。

```java
import java.util.HashSet;
import java.util.Set;

public class Main {
    public static void main(String[] args) {
        Set<String> names = new HashSet<>();
        names.add("小橘");
        names.add("狸花");
        names.add("小橘");
        System.out.println(names.size());
        System.out.println(names.contains("小橘"));
        System.out.println(names.contains("大肥鱼"));
        System.out.println(names.remove("狸花"));
    }
}
```

```text
2
true
false
true
```

- **`Set`** 和 `Map` 是同一个道理：`Map` 是名字配东西的账本，`Set` 是**只要名字**的名单。
- **`add("小橘")` 写两遍，名单上也只有一只** —— 同样的东西塞两遍只留一件，这正是它最常用的地方（去重）。所以 `size()` 是 `2`。
- **`contains`** 问名字在不在，`remove` 拿掉一个（`remove` 会叼回来一个 `true` / `false`，告诉你到底拿掉没拿掉）。
- 它也不保证顺序，原因和账本一样喵。

## 四、空口袋拿去拆箱，当场就炸

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    public static void main(String[] args) {
        Map<String, Integer> book = new HashMap<>();
        book.put("小橘", 3);
        int n = book.get("大肥鱼");
        System.out.println(n);
    }
}
```

```text
Exception in thread "main" java.lang.NullPointerException: Cannot invoke "java.lang.Integer.intValue()" because the return value of "java.util.Map.get(Object)" is null
```

念起来是：**「你要把 `get` 叼回来的东西拆箱，可它叼回来的是一只空口袋喵。」** 名字不在账本上 → `get` 给 `null` → 赋给光溜溜的 `int` 时自动拆箱 → 炸在拆箱那一步。

这一条是本课最值钱的坑：**「拿不到」在账本这里是常态，不是意外**。要么 `getOrDefault` 兜底，要么先 `containsKey` 问一句。

## 五、名字得是「同一个名字」：`equals` 与 `hashCode`

账本按名字算座位号，那它怎么判断两个名字是**同一个名字**？靠两招搭档：

- **`hashCode()`** —— 算出**座位号**（名字先被算成一个数字）。
- **`equals(...)`** —— 座位号撞上时，再比一次**字是不是真的对得上**。

上一课那条项链的规矩在这里正好用上。看这段：

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    public static void main(String[] args) {
        Map<String, Integer> book = new HashMap<>();
        String a = new String("小橘");
        String b = new String("小橘");
        book.put(a, 3);
        book.put(b, 7);
        System.out.println(a.equals(b));
        System.out.println(book.size());
        System.out.println(book.get("小橘"));
    }
}
```

```text
true
1
7
```

`a` 和 `b` 是**两条不同的项链**（都是 `new` 出来的），可账本上只有 `1` 行 —— 因为项链身上的这两招，Java 早就替它写好了：**字一样的名字，就算同一个名字**。所以第二句 `put` 是把第一句**改写**掉，`get("小橘")` 拿到的是 `7`。

::: warn 小心喵

**你要是自己画一张图纸、拿它的真猫当名字，就得自己把那两招写好** —— 座位号一招（`hashCode`）、比字一招（`equals`），**两个都要**，少写一个就会出现「明明是同一个名字，账本上却记了两行」这种见鬼的事。今天就先记住这条规矩的**名字**，等你自己画图纸当钥匙时会再遇到它喵。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `Map` 名分配上 `new HashMap<>()` | 一本账本：尖括号里两块牌子，写名字是什么、东西是什么 |
| `book.put("小橘", 3)` | 写一行；**同一个名字再写就是改写那一行** |
| `book.get("狸花")` | 按名字取东西 |
| `book.get("大肥鱼")` | 名字不在 → 叼回 `null`（空口袋） |
| `book.getOrDefault("大肥鱼", 0)` | 不在就给兜底值 —— 最省心的一招 |
| `book.containsKey("狸花")` | 账本上有没有这个名字 |
| `book.size()` | 账本上有几个名字 |
| `book.keySet()` | 把所有名字拢成一串，好挨个摸 |
| `Set` 名分配上 `new HashSet<>()` | 只要名字的名单：同样的塞两遍只留一件 |
| `names.contains("小橘")` / `names.remove("狸花")` | 在不在 / 拿掉一个（叼回 `true` / `false`） |
| `int n = book.get("大肥鱼");` | 空口袋拆箱 → 当场炸 `NullPointerException` |
| `hashCode()` + `equals(...)` | 座位号 + 比字：两招搭档决定「是不是同一个名字」 |

## 小任务

1. 把第一节那段抄进练习场，把最后那句 `getOrDefault` 换成 `get`，再把结果印出来看看 —— 亲眼看看「拿不到」长什么样。
2. 改一改第三节的例子：往名单里 `add` 三次 `"小橘"`，看看 `size()` 是几；再把 `"小橘"` 换成一条 `new String("小橘")`，看看 `size()` 变不变（提示：项链那两招 Java 已经写好了）。
3. 把第二节的账本改成「名字是项链、东西也是项链」的那种 —— 名分那一行尖括号里两块牌子都写成项链，记下每只猫最爱吃的东西，再挨个印出来。
4. 想一想：本喵要统计「每种鱼干被吃了几条」，为什么用账本特别顺手？写的时候该用 `get` 还是 `getOrDefault`？

下一课，本喵要教一张**会量体裁衣的图纸**：同一张图纸，装鱼干的时候裁成鱼干的口袋，装数字的时候裁成数字的口袋 —— 而且**做错了当场就告诉本喵**，不用等跑起来才炸。这是在验货呢，还是真能省事？下回分解喵～ 🐾
