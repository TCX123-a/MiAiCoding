---
id: java-stage2-07
lang: java
stage: 2
order: 7
title: String 深入与 StringBuilder
tags: [类型, 项链, 拼接]
required: ["java-stage2-06"]
crossRefs: []
compare: ["common-13"]
estMinutes: 25
keywords: [String, equals, StringBuilder, append]
---

## 钩子：两串一模一样的项链，本喵却说它们不是同一条

上一课结尾本喵提了一嘴：有一种家当叫**字符串（一串小鱼干的项链）**—— 项链上的每一颗小鱼干就是一个字符，一颗一颗排好队，谁也插不了队。

今天要审它三个怪脾气：**它改不了**、**`==` 会骗你**、**拼得多了会累死翻译官喵**。先看第一件：

```java
public class Main {
    public static void main(String[] args) {
        String s = "小鱼干";
        String t = s.concat("喵");
        System.out.println(s);
        System.out.println(t);
    }
}
```

```text
小鱼干
小鱼干喵
```

`s.concat("喵")` 是「接上一段」的招式，它确实接出来了 `t = 小鱼干喵`。可你再回头看 `s` —— **一个字都没变**。

## 一、项链是焊死的：想改，只能重新串一条

`String` 生出来之后就**永远不动了**。所谓「改」，其实是**另串一条新的**，原来那条原地不动躺在窝里。这条规矩的正式名字叫「项链是不可变的」，记住它的两个后果喵：

1. `s.concat(...)`、`s.toUpperCase(...)`、`s.substring(...)` 这些招式**都不动 `s` 自己**，它们叼一条**新项链**回来给你。
2. 所以上面那句 `t = s.concat("喵")`，其实串了一条新项链交给 `t`，`s` 还是老样子。

## 二、池子：正文写出来的项链，住在同一个窝

再看一段**会让零基础学员挠头**的代码：

```java
public class Main {
    public static void main(String[] args) {
        String a = "小鱼干";
        String b = "小鱼干";
        String c = new String("小鱼干");
        System.out.println(a == b);
        System.out.println(a == c);
        System.out.println(a.equals(c));
    }
}
```

```text
true
false
true
```

三行输出：前两行怪，第三行才对得上直觉。原因有两层喵：

- **`==` 问的是「是不是同一条项链」**，不是「串上的字一不一样」。`a` 和 `b` 都是本喵**直接在稿子上写出来的**同样一段字，翻译官喵很省事：它在自己窝里专门开了一个**配货池**，池子里已经泡着「小鱼干」这条项链了，就**直接把同一条**递给了 `b`。所以 `a == b` 是 `true` —— 它俩压根是同一条。
- **`c` 是明着喊 `new` 生的**，那就得**另串一条新项链**，字一样、项链不一样。所以 `a == c` 是 `false`。
- **`.equals(...)` 问的才是「串上的字一不一样」**，字一样它就是 `true` —— 所以第三行是答案。

::: warn 小心喵

**比项链一律用 `.equals(...)`，别用 `==`。** `==` 比的是「是不是同一条」，而两条项链「字一样、项链不一样」是家常便饭 —— 从纸条上读进来的、拼出来的、`new` 出来的，统统不是同一条。用 `==` 比项链，程序**不会报错**，只会安安静静地给你一个 `false`，这种 bug 最难查喵。

上面那条「`a == b` 恰好是 `true`」，只在**同一段稿子上写出来的两段一样的字**这个特殊情况下成立。别拿特例当规律用。

:::

## 三、项链上常挂的招式

项链身上挂着一排现成的招式，认得它们干活就轻松了：

```java
public class Main {
    public static void main(String[] args) {
        String s = "fish";
        String t = "小鱼干喵";
        System.out.println(s.toUpperCase());
        System.out.println(t.length());
        System.out.println(t.charAt(0));
        System.out.println(t.substring(0, 2));
        System.out.println(t.contains("鱼"));
        System.out.println(t.indexOf("喵"));
    }
}
```

```text
FISH
4
小
小鱼
true
3
```

- **`s.toUpperCase()`** —— 全部变大写。原项链不动，叼回来的是新的。
- **`t.length()`** —— 串上**有几颗**小鱼干。注意它是带小括号的招式，后面会见到别家写法写成一个数，别记混。
- **`t.charAt(0)`** —— 摸出**编号 0** 那一颗。**编号从 0 数起**，这条最要紧。
- **`t.substring(0, 2)`** —— 从编号 0 开始剪，剪到**编号 2 之前**（**不含 2**）。所以剪出来是 `小鱼` 两颗，不是三颗。
- **`t.contains("鱼")`** —— 串上有没有这一小段。
- **`t.indexOf("喵")`** —— 那一小段**从哪个编号开始**；找不到会叼回 `-1` 回来（不是报错，是个记号）。

## 四、要拼很多段？换一个「会自己长大的抽屉」

先看这段**两种拼法并排**的代码：

```java
public class Main {
    public static void main(String[] args) {
        String slow = "";
        for (int i = 1; i <= 3; i++) {
            slow = slow + "第" + i + "条 ";
        }
        StringBuilder fast = new StringBuilder();
        for (int i = 1; i <= 3; i++) {
            fast.append("第").append(i).append("条 ");
        }
        System.out.println(slow);
        System.out.println(fast.toString());
        System.out.println(slow.equals(fast.toString()));
    }
}
```

```text
第1条 第2条 第3条 
第1条 第2条 第3条 
true
```

结果**一模一样** —— 最后一行的 `true` 就是证据。既然一样，为什么要多认一个 `StringBuilder`？因为**过程差得远**：

- 上面那种写法，每绕一圈都要**重新串一条新项链**：`slow + "第"` 串一条、再接 `i` 又串一条…… 三圈下来，窝里躺着一堆**用完就扔的半成品项链**。
- `StringBuilder` 是一根**会自己长大的抽屉**：生一个空抽屉，想加就往里塞（`append`），**自始至终只有这一根抽屉**，不产生那堆半成品。

圈数少的时候差别看不出来；**要拼几百上千段**（比如把一整份名单接成一段话）的时候，第一种写法的垃圾会堆成小山。所以记住这条经验：**一次性接两三个，直接 `+` 最舒服；要在一个绕圈的招式里反复接，就换 `StringBuilder`。**

上面这两段并排的写法，本喵拆成一步一步走给你看 —— 盯着「窝里的半成品」那一栏数：

```demo
title: 一边每圈重新串一条，一边在同一根抽屉里长
code:
| String slow = "";
| for (int i = 1; i <= 3; i++) {
|     slow = slow + "第" + i + "条 ";
| }
| StringBuilder fast = new StringBuilder();
| for (int i = 1; i <= 3; i++) {
|     fast.append("第").append(i).append("条 ");
| }
| System.out.println(slow);
| System.out.println(fast.toString());

step 先备一条空项链
at: 1
say: `String slow = "";` 先有一条**空项链**（一颗珠子都没有），交给 `slow`。这条路走的是项链的老规矩：**它改不了**。
meow: 先备一条空项链喵～
pose: expect
slow 这条项链 = ""（一条空项链）
fast 这根抽屉 = （还没生）
窝里的半成品 = 0 条

step 第 1 圈：另串一条新的
at: 3
say: 第 1 圈：`slow + "第"` 这一下**不碰原来那条**，是**另串一条新的**，串完交给 `slow`。原来那条空项链没人接了，**躺在窝里**成了半成品。
meow: 第 1 圈就串了条新的喵！
pose: busy
slow 这条项链 = "第1条 "（新串的）
fast 这根抽屉 = （还没生）
窝里的半成品 = 1 条

step 第 2 圈：又另串一条
at: 3
say: 第 2 圈：老规矩 —— 还是**另串一条**「第1条 第2条 」。上一圈刚串好的那条，这一圈也被丢下了。
meow: 第二圈又串一条，旧的没人要喵～
pose: busy
slow 这条项链 = "第1条 第2条 "（又是新串的）
fast 这根抽屉 = （还没生）
窝里的半成品 = 2 条

step 第 3 圈：窝里躺满半成品
at: 3
say: 第 3 圈：再串一条「第1条 第2条 第3条 」。三圈跑完，窝里躺着 **3 条用完就扔的半成品项链** —— 圈数一多，这堆垃圾就堆成小山。
meow: 三圈躺了三条废项链喵！
pose: think
slow 这条项链 = "第1条 第2条 第3条 "
fast 这根抽屉 = （还没生）
窝里的半成品 = 3 条

step 换一根能自己动的家伙
at: 5
say: 换 `StringBuilder`：`new StringBuilder()` 生一根**空抽屉**。它不是项链 —— 项链是焊死的，抽屉**自己能动**，这是两种东西。
meow: 换抽屉啦，这根能自己长喵！
pose: expect
slow 这条项链 = "第1条 第2条 第3条 "
fast 这根抽屉 = （一根空抽屉）
窝里的半成品 = 3 条

step 第 1 圈：往同一根里塞，它自己长了
at: 7
say: 第 1 圈：`append` 把「第」「1」「条 」塞进**同一根抽屉**，抽屉里变成「第1条 」。是**它自己长了**，没有新东西被生出来 —— 半成品一条都没多。
meow: 塞进去，抽屉自己长了喵！
pose: yay
slow 这条项链 = "第1条 第2条 第3条 "
fast 这根抽屉 = "第1条 "（还是同一根）
窝里的半成品 = 3 条（一条没多）

step 第 2 圈：还是那根，原地长长
at: 7
say: 第 2 圈：还是**那根抽屉**，里子原地长长一截。看清楚：这一圈**没有生任何新东西**，只是同一根里的珠子多了几颗。
meow: 同一根，又长一截喵～
pose: yay
slow 这条项链 = "第1条 第2条 第3条 "
fast 这根抽屉 = "第1条 第2条 "（还是同一根）
窝里的半成品 = 3 条

step 第 3 圈：三圈都在同一根里长
at: 7
say: 第 3 圈：同一根抽屉再长一截。三圈下来，抽屉**自始至终就是一开始那一根** —— 这就是它省力气的地方。
meow: 三圈都在同一根里长喵！
pose: yay
slow 这条项链 = "第1条 第2条 第3条 "
fast 这根抽屉 = "第1条 第2条 第3条 "（还是同一根）
窝里的半成品 = 3 条

step 倒出来对一对：结果一样
at: 10
say: `slow` 和 `fast.toString()` 倒出来的是**一模一样**的整串（课文里那句 `slow.equals(...)` 印的正是 `true`）。**结果一样，过程差远了**：一边扔了 3 条半成品，一边一根抽屉用到头。
meow: 结果一样，过程差得远喵！
pose: proud
slow 这条项链 = "第1条 第2条 第3条 "
fast 这根抽屉 = 倒成项链 = "第1条 第2条 第3条 "
窝里的半成品 = 3 条（全是上面那条路扔的）
```

所以那条经验要连着两件事记：**项链是焊死的**（每接一次都另串一条，旧的当场成垃圾），**抽屉是能改的**（所有 `append` 都落在同一根上）。绕圈里反复接就换抽屉；只接两三个，直接 `+` 反而更省事喵。

抽屉自己也有常用的招式：

```java
public class Main {
    public static void main(String[] args) {
        StringBuilder sb = new StringBuilder();
        sb.append("小鱼干");
        sb.append("喵");
        System.out.println(sb.toString());
        System.out.println(sb.length());
        sb.insert(0, "今天吃");
        System.out.println(sb);
        sb.reverse();
        System.out.println(sb);
    }
}
```

```text
小鱼干喵
4
今天吃小鱼干喵
喵干鱼小吃天今
```

- **`sb.append("...")`** —— 往抽屉里塞一段。
- **`sb.toString()`** —— 把抽屉里攒的东西**倒出来成一条项链**。项链和抽屉是两种东西，倒出来之后才能交给只收项链的地方。
- **`sb.insert(0, "今天吃")`** —— 插在**编号 0** 那个位置。
- **`sb.reverse()`** —— 整根倒过来。
- 和项链不同，**这些招式改的是抽屉自己**，不产生新的抽屉。

## 五、编号从 0 起，数过了当场炸

```java
public class Main {
    public static void main(String[] args) {
        String s = "小鱼干喵";
        System.out.println(s.length());
        System.out.println(s.charAt(4));
    }
}
```

```text
Exception in thread "main" java.lang.StringIndexOutOfBoundsException: Index 4 out of bounds for length 4
```

念起来是：**「你摸的是编号 4，可这条项链总共才 4 颗（编号只到 3）喵。」** 四颗小鱼干的编号是 0、1、2、3 —— 所以能摸到的最大编号是 `length() - 1`。`charAt` 数过了不会给你 `null`，也不给你 `-1`，它**当场炸**。

::: tip 猫咪提示

1. **项链焊死了**：所有「改」的招式都叼回**新项链**，原来那条一个字不动。
2. **比字用 `.equals(...)`**，`==` 比的是「是不是同一条」—— 这个坑不报错、只给假答案，最阴。
3. **编号从 0 起**：`charAt` / `substring` 都按这个规矩，能摸到的最大编号是 `length() - 1`。
4. **拼两三个用 `+`，绕圈里反复拼用 `StringBuilder`** —— 后者的招式和抽屉一样，改的是它自己。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `s = "小鱼干";` | 从配货池里拿一条（写出来的同样字共用一条） |
| `new String("小鱼干")` | 另串一条新的，字一样、项链不一样 |
| `a.equals(c)` | 比**串上的字**一不一样（正确的比法） |
| `a == c` | 比**是不是同一条项链** —— 不是！ |
| `s.toUpperCase()` / `s.substring(0, 2)` | 叼回一条**新**项链，`s` 自己不动 |
| `t.length()` | 串上有几颗 |
| `t.charAt(0)` | 摸编号 0 那一颗（编号从 0 起） |
| `t.substring(0, 2)` | 剪 [0, 2) —— 不含编号 2 |
| `t.indexOf("喵")` | 从哪个编号开始；找不到给 `-1` |
| `slow = slow + "第" + i` | 每圈重新串一条，绕圈多了会堆一堆半成品 |
| `sb.append(...)` / `sb.toString()` | 往抽屉里塞 / 把抽屉倒成一条项链 |
| `t.charAt(4)`（`t` 只有 4 颗） | 数过了 → 当场炸 `StringIndexOutOfBoundsException` |

## 小任务

1. 把第二节那段抄进练习场，把 `String c = new String("小鱼干");` 改成 `String c = "小鱼干";`，看看 `a == c` 变成什么 —— 体会一下「配货池」这条规矩。
2. 改一改第三节的例子：把 `t.substring(0, 2)` 换成 `t.substring(2, 4)`，先猜猜剪出来是哪几颗，再跑一遍对答案。
3. 把第五节的 `s.charAt(4)` 换成 `s.charAt(3)`，看看红字是不是消失了；再换成 `s.charAt(-1)` 试试 —— 猜猜翻译官喵会说什么。
4. 第四节那段两种拼法，把绕圈次数从 `3` 改成 `1000`，各跑一遍感受一下（本喵提醒：这点规模两种写法都还很快，差别要更大规模才看得出来，所以**记住的是那条经验，不是这次的秒数**）。

下一课，本喵要教你**一排会自己排队的猫粮碗**：不用事先钉死碗的数量，想加几碗加几碗，还能按编号随手抽一碗出来 —— 以及，什么时候该换另一种排法喵～ 🐾
