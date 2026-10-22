---
id: java-stage3-05
lang: java
stage: 3
order: 9
title: Optional 与空值处理
tags: [空值, 盒子, 工具]
required: ["java-stage3-04"]
crossRefs: []
estMinutes: 26
keywords: [Optional, null safety, orElse, ofNullable]
---

## 钩子：找不到，是常有的事

前面几课，本喵一直在柜子里翻东西。可现实里最常见的一种情况是：**要找的那样东西，压根不在**。

比方说本喵去翻鱼干，柜子里只有猫粮。这**不是出错**，这是常有的事 —— 一点毛病都没有。

麻烦在于，从前**这件事没有一个地方写得下**：本喵心里知道「可能找不到」，可代码里一个字都没提这件事；下一个接手这段代码的人（包括三天后的本喵）一点儿都不知道，随手就用，然后「啪」。

今天这一课就干一件事：**把「可能没有」这四个字，从本喵心里搬到名分上。**

## 一、空的痛：一碰就炸

先看这个爆炸长什么样：

```java
public class Main {
    public static void main(String[] args) {
        String name = null;
        System.out.println(name.length());
    }
}
```

```text
Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()" because "<local1>" is null
	at Main.main(Main.java:4)
```

`String name = null;` 这一行的意思是「本喵手上这个位置**现在是空的**」。下一句 `name.length()` 是「问它有几个字」—— 空的东西没有「几个字」可言，于是当场炸。

红字里那后半句原话值得整个抄进小本本：`Cannot invoke "String.length()" because "<local1>" is null`，直译是「**叫不动 `String.length()` 这一手，因为 `<local1>` 是空的**」。翻译官喵连**是哪儿空的**都告诉本喵了，这一点比从前好很多。

但这还不是最麻烦的地方。最麻烦的是这两条：

1. 它**跑起来才炸**，炸的那一行 `name.length()` **语法上一个毛病都没有**；
2. 真正该写下的那句话 —— 「**这个位置可能是空的**」—— **在代码里根本没有地方写**。

靠本喵心里记着？记不住的。这一课的整套写法，就是冲着第二条去的。

## 二、把「可能没有」写在名分上

换个写法：**去找东西的那一招，名分上就写清「可能找不到」**。

```java
import java.util.Optional;

public class Main {
    static Optional<String> find(String key) {
        if (key.equals("鱼干")) {
            return Optional.of("三袋鱼干");
        }
        return Optional.empty();
    }

    public static void main(String[] args) {
        System.out.println(find("鱼干").orElse("啥也没有"));
        System.out.println(find("猫粮").orElse("啥也没有"));
    }
}
```

```text
三袋鱼干
啥也没有
```

一句一句念：

- **名分上那只盒子** —— 这一招叼回来的**不是一样东西，是一只盒子**。名分里那句写死了：「这只盒子里**可能有东西，也可能空空如也**」。谁来看一眼名分，就知道要交代一句；
- **`return Optional.of("三袋鱼干");`** —— 找到的时候，把东西**装进盒子**交回去；
- **`return Optional.empty();`** —— 没找到的时候，交回**一只空盒子**；
- **`.orElse("啥也没有")`** —— 用的时候**当场交代**：「盒子里有就用盒子里的；空盒子就用这句兜底」。

最要紧的正是最后那一句：**「没有怎么办」成了用的人非说不可的一句话。** 从前它只在本喵心里，忘了就是一行红字；现在它写在名分上，**想忘也忘不了** —— 因为不交代，这段就写不下去。

同一件「找不到」，两条路走给你看 —— 一边是半路炸掉，一边是当场表态：

```demo
title: 同一件「找不到」走两条路：一条半路炸，一条逼你当场表态
code:
| import java.util.Optional;
|
| public class Main {
|     static String findOld(String key) {
|         if (key.equals("鱼干")) return "三袋鱼干";
|         return null;
|     }
|
|     static Optional<String> findNew(String key) {
|         if (key.equals("鱼干")) return Optional.of("三袋鱼干");
|         return Optional.empty();
|     }
|
|     public static void main(String[] args) {
|         String got = findOld("猫粮");
|         System.out.println(got.length());
|         Optional<String> box = findNew("猫粮");
|         System.out.println(box.orElse("啥也没有"));
|     }
| }

step 起点：两条路都摆在这儿，问的是同一件东西
at: 14
say: 这一段本喵拿**同一个问题**走两条路：两条都问「猫粮」，而柜子里只有鱼干 —— 所以两条路上**都是找不到**。差别不在找不找得到，而在**「可能找不到」这件事有没有写在名分上**。
meow: 两条路问同一个问题：猫粮！
pose: expect
本喵问的是 = 猫粮
捞回来的 = （还没伸手）
名分上交代了吗 = （还没看名分）
接下来会怎样 = （还没走到）

step 第一条路：名分上写的是 String
at: 15
say: 先走老写法那条。`findOld` 的**名分**那一头写的是 `String`，一个字都没提「可能找不到」；本喵伸手把叼回来的东西接进 `got` 这个名字里 —— 接的时候**什么都不会响**。
meow: 老写法这一手，名分上啥也没写喵
pose: expect
本喵问的是 = 猫粮
捞回来的 = 接住了，还不知道接的是啥
名分上交代了吗 = 没交代 —— 名分只写了 String
接下来会怎样 = （还没走到）

step 老写法没找着，交回来的是一个「空」
at: 6
say: 老写法找不着就走 `return null;` —— 它交回**一个「空」**。注意：这个「空」**不是出错**，它本来就是柜子里没鱼干时的正常结果。真正的问题在**名分上一声没吭**，接着它的人根本不知道会接到这个。
meow: 没找着，老写法交回来一个空喵
pose: think
本喵问的是 = 猫粮
捞回来的 = 空（null）
名分上交代了吗 = 没交代 —— 名分只写了 String
接下来会怎样 = （还没走到）

step 一碰就炸：空值在半路上炸掉
at: 16
say: 本喵手里捏着这个「空」，下一句 `got.length()` 问它**有几个字**。空的东西没有「几个字」可言 —— **当场炸**。要命的是这两条：它**跑起来才炸**，而炸的这一行 `got.length()` **语法上一个毛病都没有**。
meow: 问空东西有几个字，当场炸啦！
pose: soothe
本喵问的是 = 猫粮
捞回来的 = 空（null）
名分上交代了吗 = 没交代 —— 名分只写了 String
接下来会怎样 = 问「几个字」→ 当场炸（NullPointerException）

step 第二条路：名分上换成一只盒子
at: 17
say: 换第二条路走。`findNew` 的名分上写的是 `Optional<String>` —— 那不是「一样东西」，是**一只盒子**，名分里写死了「里面**可能有，也可能空空如也**」。谁来看一眼这个名字，就知道**用之前得交代一句**。
meow: 这回名分上写清了：叼回来的是盒子！
pose: expect
本喵问的是 = 猫粮
捞回来的 = 一只盒子（还没打开）
名分上交代了吗 = 交代了 —— 可能有，可能没有
接下来会怎样 = （还没走到）

step 还是找不到，可这回是「一只空盒子」
at: 11
say: 找不着的时候走的是 `return Optional.empty();` —— **交回一只空盒子**。要说清楚的是：换盒子**并没有让「找不到」这件事消失**，柜子里还是没鱼干；变的只有一样 —— 这件事**现在摆在名分上了**。
meow: 没找着也不炸，交回一只空盒子喵
pose: expect
本喵问的是 = 猫粮
捞回来的 = 一只空盒子
名分上交代了吗 = 交代了 —— 可能有，可能没有
接下来会怎样 = （还没走到）

step 用的时候，非交代一句不可
at: 18
say: 关键就在这一句：`.orElse("啥也没有")` 是「盒子里有就用里面的；空盒子就用这句兜底」。**这一句不写，盒子就掏不出来** —— 所以「没有怎么办」从「本喵心里记着」变成了**写的人非说不可的一句话**。
meow: 空盒子？那本喵说好：啥也没有！
pose: yay
本喵问的是 = 猫粮
捞回来的 = 一只空盒子
名分上交代了吗 = 交代了 —— 可能有，可能没有
接下来会怎样 = 当场交代兜底 → 印出「啥也没有」

step 同一件「找不到」，第二次稳稳过去了
at: 18
say: 回头把两条路对一眼：同样一句「没找着」，第一条路上炸在半路的 `got.length()`；这一条路上**当场交代完就过去了**。两条路的差别不在柜子里有没有鱼干，在**有没有一个地方逼你说出「没有怎么办」**。
meow: 同一件事，这回稳稳当当喵～
pose: proud
本喵问的是 = 猫粮
捞回来的 = 一只空盒子
名分上交代了吗 = 交代了 —— 可能有，可能没有
接下来会怎样 = 稳稳过去：啥也没有
```

## 三、装箱的两手，脾气完全相反

盒子的关键在**怎么把东西装进去**。这件事有两手，脾气正好相反。

先看**严厉**那一手：

```java
import java.util.Optional;

public class Main {
    public static void main(String[] args) {
        String maybe = null;
        System.out.println(Optional.of(maybe).orElse("兜里是空的"));
    }
}
```

```text
Exception in thread "main" java.lang.NullPointerException
	at java.base/java.util.Objects.requireNonNull(Objects.java:233)
	at java.base/java.util.Optional.of(Optional.java:113)
	at Main.main(Main.java:6)
```

`Optional.of(...)` 的意思是「**本喵拿命担保，递过来的东西一定不是空的**」。本喵偏偏把一个**真的是空**的东西递给它 —— 它当场翻脸。

红字里那几行 `at ...` 指得很准：`Optional.of(...)` 那一行，往里是 `Objects.requireNonNull(...)` 那一行。后头这个名字读作「**本喵要求这东西不是空的**」，就是它动的手。

还要看出一个细节：它是**在装箱那一步就炸的**，不是等后面用的时候才炸 —— 所以那一整行 `System.out.println` **一个字都没印出来**。

那**宽容**的那一手呢：

```java
import java.util.Optional;

public class Main {
    public static void main(String[] args) {
        String maybe = null;
        System.out.println(Optional.ofNullable(maybe).orElse("兜里是空的"));
    }
}
```

```text
兜里是空的
```

`Optional.ofNullable(...)` 读作「**装了；要是递过来的是空的，就给本喵一只空盒子**」。这一回它老老实实交回一只**空盒子**，不炸。后面 `.orElse("兜里是空的")` 一看盒子是空的，就把兜底那句话报出来。

把这两手并排记住：

> **`Optional.of(...)`**：拿命担保不是空的 —— **空东西递进去就当场炸**。
> **`Optional.ofNullable(...)`**：不担保 —— **空的就装成一只空盒子**。

**不是严厉那一手不能用**，而是**别拿空东西去撞它**。第三节开头那个找东西的招式里用的就是严厉那一手，可它递进去的东西**开头已经比过了、真的不是空的**，所以完全没问题。

## 四、盒子上自带的那几手

盒子不只是个袋子，它身上还带着几手很方便的活儿：

```java
import java.util.Optional;

public class Main {
    static Optional<String> find(String key) {
        if (key.equals("鱼干")) {
            return Optional.of("三袋鱼干");
        }
        return Optional.empty();
    }

    public static void main(String[] args) {
        find("鱼干").map(s -> s.length()).ifPresent(n -> System.out.println("长度是 " + n));

        String maybe = null;
        System.out.println(Optional.ofNullable(maybe).orElse("兜里是空的"));
    }
}
```

```text
长度是 4
兜里是空的
```

- **`.map(s -> s.length())`** —— 读作「**要是盒子里有东西，就对它动这一手**」。盒子空的时候它**什么都不做**，直接把一只空盒子还回来；
- **`.ifPresent(n -> System.out.println("长度是 " + n))`** —— 读作「**要是盒子里有东西，就做这件事**」。空盒子就跳过，一句话不说。

这两手最舒服的地方是：**空盒子会一路自动传下去**。本喵不用在每一层都手动问一句「空了没」—— 有一手挂一手，全是空的就一路空到底，中途一次都不会炸。

最后那一句 `Optional.ofNullable(maybe).orElse("兜里是空的")`，正是第三节那个炸掉的写法换成了宽容的那一手 —— 这回它老实交回空盒子，兜底的话就报出来了。

### 用的时候，三种交代

| 本喵想干的 | 用哪一手 |
|---|---|
| 有就用里面的，没有就用兜底的 | `.orElse(...)` |
| 有东西的时候才做一件事 | `.ifPresent(...)` |
| 有东西的时候加工一下再交出来 | `.map(...)` |

**千万别用 `.get()`。** 它读作「**不管怎么样，把里面的东西掏给我**」—— 盒子空着的时候，它一样会当场炸，只不过换了一行红字：

```java
import java.util.Optional;

public class Main {
    public static void main(String[] args) {
        Optional<String> box = Optional.empty();
        System.out.println(box.get());
    }
}
```

```text
Exception in thread "main" java.util.NoSuchElementException: No value present
	at java.base/java.util.Optional.get(Optional.java:143)
	at Main.main(Main.java:6)
```

`No value present` 直译是「**里头没东西**」。用了 `.get()` 就等于把「可能没有」这件事**又原封不动扔了回去** —— 那这一课的功夫就白下了。宁可多写一句 `orElse`，也别用 `.get()`。

::: warn 小心喵

- **严厉那一手别拿空的去撞。** `Optional.of(...)` 是拿命担保，撞上去当场炸，而且是**装箱那一步**就炸。
- **宽容那一手不炸，但兜底还得你交代。** `ofNullable` 只负责把空东西变成空盒子，**「空了怎么办」仍然是写的人的责任**。
- **兜底那个值要挑好。** 别让兜底值和「真找到的东西」撞车 —— 要是找到的东西本身也可能是 `0`，那用 `0` 报「没找到」就分不清了。
- **别用 `.get()`。** 它把「可能没有」又扔回给用的人，等于白拿盒子。
- **盒子最值钱的地方是「写在名分上」。** 该用它的地方是**那些真的可能找不到**的招式；明明一定有东西的地方也套一层盒子，只会让读的人多绕一圈。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `String name = null;` 之后又 `name.length()` | **跑起来才炸**：`NullPointerException`（炸的那行语法没问题） |
| 名分上写着 `Optional<String>` | 这一招叼回来的**是一只盒子**：「可能有，也可能没有」 |
| `Optional.of(...)` | **严厉**那一手：拿命担保不是空的 —— 空的递进去当场炸 |
| `Optional.ofNullable(...)` | **宽容**那一手：是空的就装成一只空盒子 |
| `Optional.empty()` | 交回**一只空盒子** |
| `.orElse("啥也没有")` | 有就用里面的；空盒子就用这句兜底 |
| `.ifPresent(n -> ...)` | **有东西的时候才做**这件事；空盒子跳过 |
| `.map(s -> s.length())` | **有东西的时候**加工一下再装回盒子里 |
| `.get()` | **别用**：空盒子会炸出 `NoSuchElementException: No value present` |
| 空盒子一路往下挂 | 空**自动传下去**，中途一次都不会炸 |

::: tip 猫咪提示

- **这一课整套写法就冲着一件事去**：把「可能没有」从本喵心里搬到名分上 —— 谁看一眼名分，就知道要交代一句。
- **装箱两手脾气正相反**：`of(...)` 是拿命担保，空东西递进去当场就炸；`ofNullable(...)` 不担保，空的就装成一只空盒子。
- **用的时候三种交代**：有就用里面的、没有就用兜底的写 `orElse`；有东西才做一件事写 `ifPresent`；有东西才加工写 `map`。
- **空盒子会一路自动传下去**：本喵不用在每一层都手动问一句「空了没」。
- **别用 `.get()`**：它把「可能没有」原封不动扔回给用的人 —— 明明一定有东西的地方，也别套盒子喵。

:::

## 小任务

1. 把第一节那个「一碰就炸」的例子原样跑一遍，把那句红字**整个**抄进小本本；再把那一行改成先从名分上交代一句的写法，比较两次。
2. 把第三节那两个装箱的例子**都跑一遍**，确认严厉那一手真的炸、宽容那一手真的不炸。注意炸的那次是**第几行**红的。
3. 写一招「去柜子里找第一件够大的」，名分上就写明可能找不到；找到就装盒交回，没找到就交回空盒子。印的时候用 `orElse(0)` 兜底。
4. 把第四节那个 `.map(...).ifPresent(...)` 那一行，改成盒子空着的情况（把 `find("鱼干")` 换成 `find("猫粮")`），先猜输出再跑一遍。
5. 想一想：为什么说 `.get()` 等于「把这一课的功夫白下了」？它跟第一节那种一碰就炸的写法，究竟差在哪里？

到这里，stage3 的前五课就串起来了：**尖括号里加门槛和问号 → 柜子的向导与帮工 → 一小截直接写出来的招式 → 一条流水线 → 把「可能没有」写在名分上**。下一课本喵要翻出一套全新的工具：**跟日期和时间打交道的那些喵** —— 记住一个日子、算算过了几天、换个花样印出来喵～ 🐾
