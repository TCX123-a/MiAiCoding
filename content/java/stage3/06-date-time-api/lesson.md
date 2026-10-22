---
id: java-stage3-06
lang: java
stage: 3
order: 10
title: 日期时间 API
tags: [日期时间, 格式化, 计算]
required: ["java-stage3-05"]
crossRefs: []
estMinutes: 26
keywords: [LocalDate, LocalTime, DateTimeFormatter, ChronoUnit, parse]
---

## 钩子：餐券上那张日期纸条

本喵要发一批小鱼干餐券，每张上都得写清楚：**哪一天发的、哪天过期**。这种事本喵可不敢自己数——数错一天，猫猫们就要饿肚子喵。

从前这种事只能自己拿笔算：这个月几天、下个月几天、跨年怎么办。现在不用了：Java 早在工具箱里备好了一整套「日期纸条」，本喵只要撕一张出来、念成想要的样子、再让两张纸条相减就行。

今天四件事：

1. 撕一张**只有年月日**的纸条、一张**只有时分秒**的纸条；
2. 为什么**纸条改不动**（想改就得撕新的）；
3. 怎么把纸条**念成你要的样子**；
4. 怎么让两张纸条**相减**。

## 一、撕一张「只有年月日」的纸条

```java
import java.time.LocalDate;

public class Main {
    public static void main(String[] args) {
        LocalDate d = LocalDate.of(2026, 9, 16);
        LocalDate d2 = LocalDate.parse("2026-12-31");

        System.out.println(d);
        System.out.println(d2);
    }
}
```

```text
2026-09-16
2026-12-31
```

两种撕法，各有各的用处：

- **`LocalDate.of(2026, 9, 16)`** —— 本喵自己报数：年、月、日，三样都写全。
- **`LocalDate.parse("2026-12-31")`** —— 递给它一串字，它自己读。这串字的规矩是固定的：**四位年，一个短横，两位月，一个短横，两位日**。

两个方法都是**从图纸上撕一张新纸条**（`new` 那一步被藏起来了），撕出来就长这样：`2026-09-16`。印出来的样子和递进去的规矩一模一样 —— 因为那就是它自己的正规模样。

## 二、撕一张「只有时分秒」的纸条

日期管「哪一天」，时刻管「一天里的哪一刻」：

```java
import java.time.LocalTime;

public class Main {
    public static void main(String[] args) {
        LocalTime t = LocalTime.of(9, 30);

        System.out.println(t);
        System.out.println(t.plusHours(3).plusMinutes(45));
    }
}
```

```text
09:30
13:15
```

- **`LocalTime.of(9, 30)`** —— 上午九点半，秒不用写（不写就是 0）。
- **`.plusHours(3).plusMinutes(45)`** —— 「往后挪三个小时，再往后挪四十五分钟」。连在一起写是很常见的写法：**它每一步都给你一张新纸条，拿新纸条接着往下算**。

一张纸条只有一半的信息（要么管日期、要么管时刻），这是它们**故意**分开的：光有「9 点半」不知道是哪天，光有「9 月 16 日」不知道几点 —— 分开放，才不会有人把两件事混着用喵。

## 三、纸条改不动：想改，就得撕一张新的

这一节是今天最要紧的一条，也是新手最容易摔的一脚：

```java
import java.time.LocalDate;

public class Main {
    public static void main(String[] args) {
        LocalDate d = LocalDate.of(2026, 9, 16);

        d.plusDays(3);
        System.out.println("本喵以为过了三天：" + d);

        LocalDate later = d.plusDays(3);
        System.out.println("接着它才对：" + later);
    }
}
```

```text
本喵以为过了三天：2026-09-16
接着它才对：2026-09-19
```

第一行**一点没变**。

为什么？因为这类纸条是**撕下来就定死**的：`.plusDays(3)` 不会在原来那张纸上改一个字，它是**另撕一张**写着三天后的纸给你。本喵没伸爪接住，那一张新纸条**当场就丢了** —— 手里还是原来那张。

这跟上一课那只空盒子是同一种脾气：**给了你东西，你不接就没了**，而且它**一个字都不会红**。

两行只差前面一截名字，走给你看：

```demo
title: 白写的那一句：新纸条没人接，当场就丢了
code:
| import java.time.LocalDate;
|
| public class Main {
|     public static void main(String[] args) {
|         LocalDate d = LocalDate.of(2026, 9, 16);
|
|         d.plusDays(3);
|         System.out.println("本喵以为过了三天：" + d);
|
|         LocalDate later = d.plusDays(3);
|         System.out.println("接着它才对：" + later);
|     }
| }

step 起点：撕一张写着 9 月 16 日的纸条
at: 5
say: `LocalDate.of(2026, 9, 16)` 是从图纸上撕一张**新纸条**，上面写着 `2026-09-16`。本喵把它接进 `d` 这个名字里 —— 往下这一节全看这只名字里那张纸**动不动**。
meow: 撕一张 9 月 16 日的纸条，装进 d 喵
pose: expect
手里的纸条 = 2026-09-16
刚撕出来的那张 = （还没撕）
有人接吗 = （还没伸爪）

step 白写的那一句：它另撕了一张
at: 7
say: 走到 `d.plusDays(3);` 这一句 —— 它**不是在那张纸上改字**。它的动作是「**另撕一张**写着三天后的纸交给你」。撕是撕好了，纸上写着 `2026-09-19`，可是……
meow: 它另撕了一张三天后的纸！
pose: busy
手里的纸条 = 2026-09-16
刚撕出来的那张 = 2026-09-19（撕好了）
有人接吗 = 没接 —— 本喵没伸爪

step 没人接，新纸条当场就丢了
at: 7
say: 这一行**前面没有名字**。没有名字接住它，那张新纸条**当场就丢了** —— 纸上写着什么，从这一刻起没人知道。整个过程**一个字都不会红**：这一句语法上毫无毛病。
meow: 没伸爪接，新纸条当场丢啦喵
pose: think
手里的纸条 = 2026-09-16
刚撕出来的那张 = （丢了，没人接住）
有人接吗 = 没接 —— 本喵没伸爪

step 印出来一点没变
at: 8
say: 接着印 `d`，出来还是 `2026-09-16`。本喵「以为过了三天」，可手里那张纸**一个字都没动** —— 不是 `plusDays` 没干活，是**干了活的成果没人接**。
meow: 印出来还是 9 月 16 日，一点没变喵
pose: soothe
手里的纸条 = 2026-09-16（一点没变）
刚撕出来的那张 = （丢了，没人接住）
有人接吗 = 没接 —— 本喵没伸爪

step 一模一样的动作，这回伸爪接住
at: 10
say: 下一句是**一模一样**的 `d.plusDays(3)`，只多了一样：前面坐着名字 `later`。动作还是「另撕一张三天后的」—— 区别是这一次**有人接住它**。
meow: 这回有 later 接着，撕完不会丢喵
pose: expect
手里的纸条 = 2026-09-16（还是没变）
刚撕出来的那张 = 2026-09-19（撕好了）
有人接吗 = 接住了 —— 存进 later

step 接住了，印出来才对
at: 11
say: 印 `later` 出来是 `2026-09-19` —— 这就是「接着它才对」。这类纸条**撕下来就定死**：要哪张，就得把哪张接到一个名字里。`d` 从头到尾还是 9 月 16 日，一张纸都没被改过。
meow: 9 月 19 日，接住了才对喵！
pose: yay
手里的纸条 = 2026-09-16（到这儿还是没变）
刚撕出来的那张 = 2026-09-19（在 later 手里）
有人接吗 = 接住了 —— 存进 later

step 回头记一句：单独一行的 plusDays 先停一下
at: 7
say: 把这两行摆在一起看：`d.plusDays(3);` 和 `LocalDate later = d.plusDays(3);` —— **干的活一模一样**，差的只有前面那截名字。往后凡是 `.plusDays(...)`、`.plusMonths(...)` 单独占一行的，本喵都先问一句：**这一张，我接住了没有。**
meow: 单独一行的 plusDays，先问问接住了没！
pose: remind
手里的纸条 = 2026-09-16（到这一节结束都没变）
刚撕出来的那张 = 2026-09-19（在 later 手里）
有人接吗 = 接住了才有 later 这个名字
```

所以要记住这个动作：**要哪张纸，就把哪张纸接到一个名字里。** 数日子、改月份都是一个理：

```java
import java.time.LocalDate;

public class Main {
    public static void main(String[] args) {
        LocalDate d = LocalDate.of(2026, 1, 31);

        System.out.println("往后挪一个月：" + d.plusMonths(1));
        System.out.println("这个月有几天：" + d.lengthOfMonth());
        System.out.println("把这个月拉到 1 号：" + d.withDayOfMonth(1));
    }
}
```

```text
往后挪一个月：2026-02-28
这个月有几天：31
把这个月拉到 1 号：2026-01-01
```

注意第一行：1 月 31 日往后挪一个月，落到了 **2 月 28 日**。二月没有 31 日，它就自己退到那个月的**最后一天**，不红不闹 —— 这是它替本喵想好的一步，别为它写成「2 月 31 日」发愁喵。

## 四、把纸条念成你要的样子

纸条自己的正规模样是 `2026-09-16`，可餐券上本喵想印成「2026年09月16日」。这时候要用一张**念法清单**：

```java
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

public class Main {
    public static void main(String[] args) {
        LocalDate d = LocalDate.of(2026, 9, 16);

        System.out.println(d.format(DateTimeFormatter.ofPattern("yyyy年MM月dd日")));
    }
}
```

```text
2026年09月16日
```

`DateTimeFormatter.ofPattern("...")` 里那串字母，就是「哪一位念成什么」的清单：

| 写下的 | 念成什么 |
|---|---|
| `yyyy` | 四位年（`2026`） |
| `MM` | 两位月（`09`） |
| `dd` | 两位日（`16`） |
| 引号里不能写的汉字 / 标点 | 原样印出来（`年`、`月`、`日`） |

这套念法最坑人的地方，是**字母的大小写是两件完全不同的事**。本喵真跑给你看：

```java
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

public class Main {
    public static void main(String[] args) {
        LocalDate d = LocalDate.of(2026, 9, 16);

        System.out.println(d.format(DateTimeFormatter.ofPattern("yyyy-MM-dd")));
        System.out.println(d.format(DateTimeFormatter.ofPattern("yyyy-MM-DD")));
    }
}
```

```text
2026-09-16
2026-09-259
```

第二行印出来的是 **`2026-09-259`**：`DD` 不是「两位日」，它是**「这一年里的第几天」** —— 9 月 16 日正好是 2026 年的第 259 天。所以它给出的数可能是 259 这种三位数。

这一脚**一个字都不红**，只是印出来的东西不是你要的。所以本喵给自己定的规矩是：**念法写完之后，先把结果印出来看一眼**，别让它闷声跑完一整批餐券。

## 五、两张纸条相减

要算「这张券还有几天过期」，就把两张纸条相减。这件事交给一个叫 `ChronoUnit` 的量尺：

```java
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

public class Main {
    public static void main(String[] args) {
        LocalDate start = LocalDate.of(2026, 9, 1);
        LocalDate end = LocalDate.of(2026, 9, 11);

        System.out.println("差多少天：" + ChronoUnit.DAYS.between(start, end));
        System.out.println("后一张是不是更晚：" + end.isAfter(start));
        System.out.println("前一张是星期几：" + start.getDayOfWeek());
    }
}
```

```text
差多少天：10
后一张是不是更晚：true
前一张是星期几：TUESDAY
```

- **`ChronoUnit.DAYS.between(起, 止)`** —— 把量尺的单位换成 `MONTHS`、`YEARS`，同一句话就能问「差几个月」「差几年」。
- **`isAfter` / `isBefore`** —— 问先后，答「是 / 不是」。
- **`getDayOfWeek()`** —— 报星期几。它报出来的是 `TUESDAY` 这样的洋文，想印成「星期二」得自己配一张对照表（或者写进念法模板里）。

⚠️ **`between` 的先后不能反。** 反着写不会报错，它只会给你一个**负数** —— 比如本该差 10 天，写成 `between(end, start)` 就印成 `-10`。这种错不红不响，只是账单上多一个减号，所以写完先对着答案看一眼喵。

## 六、念不出来的纸条，它会当场拦你

本喵要是把日期写成了别的花样，翻译官喵（编译器）不管这种错 —— 它只检查语法，不检查这串字像不像日期。真正管这件事的是**跑起来的那一刻**：

```java
import java.time.LocalDate;

public class Main {
    public static void main(String[] args) {
        LocalDate d = LocalDate.parse("2026/09/16");
        System.out.println(d);
    }
}
```

```text
Exception in thread "main" java.time.format.DateTimeParseException: Text '2026/09/16' could not be parsed at index 4
```

最后一行读作：**「`2026/09/16` 这串字，从第 4 个位置（从 0 数起）开始就不对」** —— 那个位置正是本喵写成斜杠的地方，它要的是短横。

（本喵特意把这一行原话抄下来，是因为它跟本喵这台机器上真跑出来的一模一样。你要是在别的地方见到措辞不同，那多半是版本换了，以你自己屏幕上那句为准喵。）

要念自己的花样，就得**同时把花样也递给它**：

```java
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

public class Main {
    public static void main(String[] args) {
        DateTimeFormatter fmt = DateTimeFormatter.ofPattern("yyyy/MM/dd");

        LocalDate d = LocalDate.parse("2026/09/16", fmt);
        System.out.println(d);
    }
}
```

```text
2026-09-16
```

念法对了，同一串字就念得出来；印出来的还是它自己的正规模样。

::: tip 猫咪提示

今天记住四句话就够：

1. **`LocalDate` 管年月日，`LocalTime` 管时分秒**，各管一段，互不掺和；
2. **纸条改不动** —— `.plusDays()`、`.plusMonths()` 都是**撕一张新的**，不接住就丢了；
3. **念法清单 `ofPattern` 里大小写是两件事**：`MM` 是月、`DD` 是「一年里的第几天」；
4. **量尺 `ChronoUnit.DAYS.between(起, 止)`**，先后不能反。

:::

::: warn 小心喵

- **`d.plusDays(3);` 单独一行 = 白写。** 新纸条没人接，当场丢；这种错**不红不响**，只能靠「接住它」这个习惯挡。
- **`yyyy-MM-DD` 不报错、但印出来是错的。** 它给的是「一年里的第几天」，像 `2026-09-259` 这种。认准小写 `dd`。
- **`parse` 的规矩是定死的**：默认只认 `2026-09-16` 这个形状。自己那套花样，必须把 `DateTimeFormatter` 一起递过去。
- **`between` 反着写只是负数**，不会红 —— 它不会好心提醒你「你是不是写反了」。
- **`getDayOfWeek()` 报的是洋文**（`TUESDAY`），要中文得自己配对照，别指望它自动翻。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `LocalDate.of(2026, 9, 16)` | 自己报数撕一张年月日纸条 |
| `LocalDate.parse("2026-12-31")` | 递给它一串字，按**默认规矩**念 |
| `LocalTime.of(9, 30)` | 撕一张时分秒纸条 |
| `d.plusDays(3)` | **另撕一张**三天后的，原来那张不动 |
| `d.lengthOfMonth()` | 这个月有几天 |
| `d.withDayOfMonth(1)` | 撕一张「这个月 1 号」 |
| `DateTimeFormatter.ofPattern("yyyy年MM月dd日")` | 念法清单：年 / 月 / 日 |
| `yyyy` / `MM` / `dd` | 四位年 / 两位月 / 两位日 |
| `DD` | **一年里的第几天**（不是日！） |
| `ChronoUnit.DAYS.between(起, 止)` | 两张纸条差多少天 |
| `isAfter` / `isBefore` | 问先后，答是 / 不是 |
| `getDayOfWeek()` | 报星期几（洋文） |

## 小任务

1. 把第一节那个 `LocalDate.of(2026, 9, 16)` 改成你自己的生日（年份随便挑），印出来看看。
2. 把第三节那个「白写」的例子**原样跑一遍**，确认第一行真的没变；再把结果接住，比较两次输出。
3. 拿 `DateTimeFormatter.ofPattern` 试三种花样：`MM/dd`、`yyyy年MM月dd日`、`yyyy-MM-DD` —— 最后那种先猜结果再跑，验证本喵说的「第几天」。
4. 算一算「从今天到今年 12 月 31 日还有多少天」：起止两张纸条都用 `.of(...)` 撕出来，别忘了 `between` 的先后。
5. 顺手把 `getDayOfWeek()` 的结果和 `LocalDate.of(2026, 9, 16).getDayOfWeek()` 对一下，看看那两天隔了几周。

下一课，本喵要讲「一件东西怎么原样搬进搬出」：**一口气整趟搬**（比一颗一颗叼快得多），以及怎么把一整只猫**冻成字节**存起来、再解冻回来。那可是本喵的看家本事喵～ 🐾
