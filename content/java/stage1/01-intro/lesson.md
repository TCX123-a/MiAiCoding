---
id: java-stage1-01
lang: java
stage: 1
order: 1
title: 认识 Java 与第一个程序
tags: [入门, 程序结构]
required: ["common-01"]
crossRefs: ["common-01", "common-02"]
estMinutes: 15
keywords: [class, main, println]
compare: ["common-02"]
---

## 钩子：本喵的新朋友，名字叫「爪哇」

本喵凑到电脑跟前，认认真真地打了个招呼：「你好，喵～」

屏幕一点反应都没有。大肥鱼在旁边甩着尾巴笑：「它哪听得懂猫话呀——它只认得 0 和 1。」

要本喵直接写一串 0101 给它看，那还不如让本喵去学倒立喵。好在人类早就替猫猫们造了好些门**编程语言**，今天要认识的是其中一位脾气特别稳重的朋友：**Java**。

顺便说个冷知识：Java 这名字不是电脑起的，它来自**爪哇岛**（印度尼西亚的一座岛）上产的咖啡。听说当年几位程序员就是喝着那壶咖啡，才给新语言起了这个名字——所以 Java 的图标到今天还是一杯冒着热气的咖啡。学累了就当那杯咖啡是本喵给你倒的喵 ✨

## Java 是什么喵

Java 是一门**编程语言**。它的脾气和 Python 不太一样，先认识三点就够：

- **规矩多，但稳当。** 写 Java 得把每样东西的「种类」提前讲清楚，写起来比 Python 啰嗦一点；好处是它**翻脸之前常常先提醒你**——很多错还没跑就被它拦下来了，后面几课你会亲眼见到。
- **一切代码都要住在图纸里。** 哪怕只想念一句话，也得先画一张**图纸**、给图纸起个名字。术语表里管这张图纸叫**类（猫猫图纸）**，往后本喵就用「图纸」两个字喊它。
- **一次写好，哪儿都能跑。** 这是 Java 最出名的本事，靠的是一位住在每台电脑里的翻译官喵，它的正式名字叫 **JVM**（Java 虚拟机）。

### JVM：揣着一口「通用话」的随身翻译

别的语言的翻译官喵，常常直接把你的稿子翻成**这一台电脑的方言**——换一台电脑，就得重翻一遍。

Java 的翻译官喵精一些：它先把稿子翻成一种**全世界的猫都认得的通用话**（这门通用话的正式名字叫**字节码**），再由每台电脑上住着的那只 **JVM**，当场把通用话讲给这台电脑听。

所以同一份翻译稿，Windows 上的 JVM 念得出来，Mac 上的 JVM 也念得出来——这就是「一次写好，哪儿都能跑」喵。

（JVM 还随身带着一位**自动铲屎官**，会悄悄替你清走不要的东西。那是很深的话题，今天先知道有这么一位就够啦。）

## 第一个程序：让电脑念一句「你好，喵！」

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("你好，喵！");
    }
}
```

```text
你好，喵！
```

恭喜喵！这就是你的第一个 Java 程序。它比 Python 的版本身材长了不少，别慌，本喵一行一行拆给你看：

1. **`public class Main {` … `}`** —— 这是那张**图纸**，名字叫 `Main`；一对花括号把图纸里的内容整个圈起来。`public` 的意思是「谁都能用」，今天照抄就好。
2. **`public static void main(String[] args)`** —— 这是**入口**。程序跑起来，第一脚就踩在这一行上。这一整行是**固定写法**：一个词都不能少、一个字母都不能改，括号里那段 `String[] args` 也是它的一部分。含义本喵以后再拆，今天先把它当口诀背下来。
3. **`System.out.println("你好，喵！");`** —— 这是**嘴**。`System` 是 Java 自带的一件系统工具，`out` 指的是往外念的那个口子，`println` 是招式名（念完还会顺手**换一行**）。括号里用**引号**圈住要念的内容——引号里的话原样念出来，**引号本身不念**。
4. **行尾那个分号 `;`** —— 它是 Java 的**句号**，每句话说完都得点上。漏了它，Java 会当场翻脸（下一课你就看到它翻脸的样子喵）。

## 一行一行往下念

想让它念两句，就写两行：

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("拿小鱼干");
        System.out.println("放进碗里");
    }
}
```

```text
拿小鱼干
放进碗里
```

和 Python 一样：**从上往下一行一行做**，谁写在前面谁先出声。把这两行换个个儿，念出来的顺序也跟着换。

## 引号里是话，不带引号是名字

`println` 的括号里，除了引号包着的文字，还能直接放**数字**：

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("小鱼干有");
        System.out.println(3);
        System.out.println("条");
    }
}
```

```text
小鱼干有
3
条
```

数字**不用加引号**，Java 照样念得出来。可要是把一句话的引号也去掉——写成 `System.out.println(你好喵)`——事情就不一样了：

```java
public class Main {
    public static void main(String[] args) {
        System.out.println(你好喵);
    }
}
```

翻译官喵当场摇头，甩给本喵这么一段：

```text
Main.java:3: error: cannot find symbol
        System.out.println(你好喵);
                           ^
  symbol:   variable 你好喵
  location: class Main
1 error
```

`cannot find symbol` 就是「**不认识这个名字**」：不带引号的东西，Java 一律当成一个**名字**去找——它先看看有没有哪个仓库、哪张图纸叫这个名字，一个都没找着，就报错给你看。

**记住这条分界：引号里的是「一句话」，不带引号的是「一个名字」。** 这一条往后天天要用喵。

## 两条要背下来的死规矩

### 规矩一：文件名必须和 `public class` 的名字一模一样

上面那段代码，本喵把它存成一个文件，文件名就得叫 **`Main.java`** ——因为图纸名叫 `Main`。屋名和图纸名要**一个字都不差**，大小写也算。

要是本喵手一抖，写成 `public class Hello` 却存进 `Main.java`，翻译官喵连代码内容都不看，直接甩脸：

```text
Main.java:1: error: class Hello is public, should be declared in a file named Hello.java
1 error
```

这句话的意思是：「`Hello` 是公开的，就该住在叫 `Hello.java` 的文件里。」所以名字这件事，第一天就要养成习惯：**先想好图纸名，再用同一个名字存文件。**

### 规矩二：入口那一行，一个字都别改

`public static void main(String[] args)` ——大小写、空格、括号里的内容，全是固定的。最容易摔的正好是两下：

- **`main` 和 `Main` 是两回事。** Java 认死理：大小写不同，就是两个不同的名字。
- **少一个词都不行。** 漏掉哪个词，要么翻不过去，要么翻过去了却「找不到入口」。

::: tip 猫咪提示
今天记住三件事就够：

1. Java 代码住在**图纸**里，图纸要起名字，而且**文件名和图纸名一模一样**（`Main.java` ↔ `public class Main`）；
2. 入口是 `public static void main(String[] args)`，**固定写法，当口诀背**；
3. 想让电脑念话，喊 `System.out.println("...")`，行尾别忘了那个分号。
:::

::: warn 小心喵
Java 里的引号 `"` 和分号 `;` 必须是**英文的**。中文输入法手滑打出来的「，」「；」「”」长得像，Java 却一个都不认，报出来的错还会指向别处。写完一行回头瞄一眼输入法，能省下你不少抓耳挠腮喵。
:::

## 小任务

新建一个文件，就叫 `Main.java`，把下面这段敲进去（引号里的字随你改）：

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("本喵会写 Java 啦");
    }
}
```

跑通之后，故意捣两个乱：① 把某一行末尾的分号删掉再跑，看看翻译官喵说什么；② 把图纸名改成 `Hello`、文件却还叫 `Main.java`，再跑一次。

两个报错都亲眼见一遍，下一课本喵就带你拆解：你的稿子到底是怎么被翻出来、又是怎么跑起来的喵～ 🐾
