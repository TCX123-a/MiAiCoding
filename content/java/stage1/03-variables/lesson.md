---
id: java-stage1-03
lang: java
stage: 1
order: 4
title: 小鱼干仓库——Java 的变量与数据类型
tags: [变量, 类型]
required: ["java-stage1-18"]
crossRefs: ["common-04","c-stage1-03","cpp-stage1-03","python-stage1-03"]
estMinutes: 20
keywords: [int, double, char, boolean, long]
compare: ["common-04"]
---

## 钩子：全堆在一起，本喵找了大半天

本喵今天心血来潮，把小鱼干、罐头、逗猫棒一股脑全塞进一个大箱子。

结果主人喊：「把那条小银鱼干拿过来喵！」

本喵在箱子里刨啊刨，刨了半天也没找着——东西都堆在一块儿，谁是谁都认不出。

大肥鱼慢悠悠地甩着尾巴：「你缺的不是爪子，是**名字**呀。给每样东西一个**带名字的小格子**，下次喊名字，爪子自己就伸过去了。」

这一课的主角就是它：**变量（小鱼干仓库）**喵——给每样东西一间带名字的小格子。

## 开仓库三步：先挂牌，再起名，最后装东西

在 Java 里开一个小仓库，写出来是这么一句：

```java
int fish = 3;
```

短短一行塞了三件事，本喵拆给你看：

1. `int` —— **牌子**。它告诉 Java：这个格子里装的是**整个的小鱼干**（整数）。
2. `fish` —— **名字**。往后喊 `fish`，就是喊这个格子。
3. `= 3` —— 把 `3` **装进去**。
4. 行尾的 `;` —— 老规矩，句号，别忘。

::: warn 小心喵
那个 `=` 不是数学里的「等于」，是**「把右边的东西装进左边」**喵。想知道「两边一样吗」，得写 `==`——两个字符，长得像，意思差着十万八千里。第 8 课学比较的时候还会再说一遍，今天先记住它俩不是一个东西。
:::

## Java 的仓库：开张那一刻，牌子就钉死了

这是 Java 和 Python 最不一样的地方之一，本喵特意拎出来讲：

**Python 的仓库是「随便装」的**：`fish = 3` 装得好好的，过一会儿你想改成 `fish = "小银鱼"`，它照样收下，一句话都不问。

**Java 的仓库不行**：开张的时候说好装整数，往后就**只能装整数**。想装别的，得**另开一间**（重新挂牌、重新起名）。

规矩听起来是多了点，但好处马上就能摸到：翻稿子那一步就能替你拦下一大堆「装错了」的事故。

Java 给的牌子不算多，最常用的就这五种，够你写很久的程序喵：

| 牌子 | 装什么 | 长什么样 |
|---|---|---|
| `int` | 整数（整个的小鱼干） | `int fish = 3;` |
| `double` | 小数（能掰开的小鱼干） | `double price = 2.5;` |
| `char` | 单个字（一颗小珠子），用**单引号** | `char grade = 'A';` |
| `boolean` | 只有两面牌子：`true` / `false` | `boolean happy = true;` |
| `long` | 特别大的整数，尾巴加个大写 `L` | `long big = 8000000000L;` |

（Java 的牌子一共八种，剩下三种 `byte`、`short`、`float` 平时很少用到，遇到了再说喵。另外 `String` 那种「一串小鱼干的项链」也很常用，它的正式名字叫**字符串（一串小鱼干的项链）**，第 15 课专门讲它，今天先认得它的长相——**双引号**圈起来的那种。）

四种牌子一起开张，是这个样子：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 3;
        double price = 2.5;
        char grade = 'A';
        boolean happy = true;
        System.out.println(fish);
        System.out.println(price);
        System.out.println(grade);
        System.out.println(happy);
    }
}
```

```text
3
2.5
A
true
```

看仔细喵：`println` 念的是**仓库里装的东西**，不是仓库的名字——所以屏幕上冒出来的是 `3`，而不是 `fish`。

## 换仓库里的东西：不用再挂牌

牌子只在**开张那一次**写。往后想换里面的东西，直接喊名字就行：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 3;
        fish = fish + 1;
        System.out.println(fish);
    }
}
```

```text
4
```

`fish = fish + 1;` 这一句，Java 是这么干的：**先把右边算出来**（`3 + 1`，得 `4`），**再装回左边**那个 `fish` 格子里。所以打印出来是 `4`。

（这里冒出来一个加号——加号自己的故事第 8 课讲。今天你只要看懂「先算右边，再装回左边」就够喵。）

本喵把这两拍拆成一步一步，走给你看：

```demo
title: 「先算右边，再装回左边」是怎么走的
code:
| int fish = 3;
| fish = fish + 1;
| System.out.println(fish);

step 开张那一次：挂牌、起名、装 3
at: 1
say: `int fish = 3;` 一次办完三件事：挂 `int` 的牌子（这格子只收整数）、起名 `fish`、把 `3` 装进去。**牌子只有开张这一次要写**，再往下你就见不到它了。
meow: 挂牌、起名、装货，一次办完喵！
pose: expect
fish 格子里 = 3
本喵手上 = （空）
屏幕上 = 还没印

step 第二句开头：一个牌子都没有
at: 2
say: 看 `fish = fish + 1;` 这行开头 —— **没有 `int`**。牌子只在开张时写一次，往后想换格子里的东西，直接喊名字就行，Java 认得这间仓库。
meow: 不用再挂牌啦，喊名字就开门～
pose: expect
fish 格子里 = 3
本喵手上 = （空）
屏幕上 = 还没印

step 先算右边：喊名字，叼出旧值
at: 2
say: Java 的规矩是**先把右边算完**。右边那个 `fish` 是喊名字，把格子里的东西叼出来 —— 取到的是 **3**。**注意：这一步格子里还是 3。**
meow: 喊一声 fish，格子里叼出 3！
pose: busy
fish 格子里 = 3
本喵手上 = 3
屏幕上 = 还没印

step 右边算完：3 + 1 得 4
at: 2
say: 叼出来的 3 加上 1，右边算完是 **4**，先捏在手上。**这一步格子里还是 3** —— 加号算得再热闹，也一下都没碰过那间格子。
meow: 3 加 1 得 4，先捏在爪子里～
pose: busy
fish 格子里 = 3
本喵手上 = 4
屏幕上 = 还没印

step 再装回左边那间格子
at: 2
say: 右边**全部算完**，才把 4 **装回左边**那间 `fish` 格子。原来的 3 被顶掉，格子里成了 4 —— 课文那句「先算右边，再装回左边」说的就是这两拍。
meow: 4 装回去，3 被顶掉啦！
pose: yay
fish 格子里 = 4
本喵手上 = （空）
屏幕上 = 还没印

step println：念的是格子里的东西
at: 3
say: 最后 `System.out.println(fish);` 喊的是 `fish` 这个名字，屏幕上冒出来的却是 **4** —— 因为 `println` 念的永远是**格子里装着的东西**，不是格子的名字。
meow: 屏幕上冒出个 4，收工喵！
pose: proud
fish 格子里 = 4
本喵手上 = （空）
屏幕上 = 4
```

**第 4 步是最容易看漏的一拍**：那个 4 还没装回去之前，格子里一直还是 3。往后凡是看见 `=`，心里都按「先算右边、再装回左边」这两拍念一遍，就不会绕晕喵。

## 起名字的规矩

名字随你起，但有几条 Java 的硬规矩：

- **不能以数字开头**：`fish1` 行，`1fish` 不行；
- **不能有空格**，也别夹符号（下划线 `_` 可以）；
- **大小写算两个名字**：`fish` 和 `Fish` 是两间互不相干的仓库；
- **Java 自己占用的词不能用**：`class`、`public`、`int` 这些都不行。

还有一条不算硬规矩，但所有猫都这么干：**名字要让人一眼看懂里面装什么**。装鱼干的数量，写 `fishCount` 就比写 `x` 强得多：

```java
public class Main {
    public static void main(String[] args) {
        int fishCount = 3;
        System.out.println(fishCount);
    }
}
```

```text
3
```

## 牌子和东西对不上，翻译官喵当场拦下

第 2 课说过：Java 有个大好处，**好多错在翻稿子那一步就被拦下了**。仓库最常摔的跤，正是「牌子和东西对不上」。

**把一串项链塞进整数仓库**：

```java
public class Main {
    public static void main(String[] args) {
        int fish = "3";
        System.out.println(fish);
    }
}
```

```text
Main.java:3: error: incompatible types: String cannot be converted to int
        int fish = "3";
                   ^
1 error
```

`incompatible types` 的意思就是「**牌子和东西对不上**」；后面那句 `String cannot be converted to int` 说得更直白：「带双引号的这串项链，变不成整数。」

**把小数塞进整数仓库**：

```java
public class Main {
    public static void main(String[] args) {
        int fish = 3.5;
        System.out.println(fish);
    }
}
```

```text
Main.java:3: error: incompatible types: possible lossy conversion from double to int
        int fish = 3.5;
                   ^
1 error
```

`possible lossy conversion from double to int` 是在说：「小数要塞进整数仓库，会**掉一块肉**（`.5` 那半截就没了）。」Java 不肯背着你偷偷扔，宁可让你自己拿主意——要么换个装小数的仓库（`double`），要么干脆装个整数喵。

**单个字的牌子，配的却是双引号**：

```java
public class Main {
    public static void main(String[] args) {
        char grade = "A";
        System.out.println(grade);
    }
}
```

```text
Main.java:3: error: incompatible types: String cannot be converted to char
        char grade = "A";
                     ^
1 error
```

看那个小箭头，它正指着 `"A"` 喵。`char` 装的是**一颗小珠子**（单个字），写法是**单引号** `'A'`；**双引号**圈起来的是**一串**，是条项链——一颗珠子当然装不下一整串。

**太大太大，装不下的整数**：

```java
public class Main {
    public static void main(String[] args) {
        long big = 8000000000;
        System.out.println(big);
    }
}
```

```text
Main.java:3: error: integer number too large
        long big = 8000000000;
                   ^
1 error
```

`8000000000` 这个数，比普通整数仓库的容量还大。Java 看见**不带尾巴**的数字，默认按普通整数去量——一量发现装不下，就报 `integer number too large`（「数字太大」）。

办法是**在尾巴上加一个大写的 `L`**，等于告诉 Java「拿大号的牌子来接它」：

```java
public class Main {
    public static void main(String[] args) {
        long big = 8000000000L;
        System.out.println(big);
    }
}
```

```text
8000000000
```

## 和 Python 的仓库比一比

| | Python 那边的仓库 | Java 的小鱼干仓库 |
|---|---|---|
| 怎么开 | `fish = 3` 就行 | 先挂牌：`int fish = 3;` |
| 牌子 | 装什么就变成什么，随时能换 | 开张就钉死，往后只收这种牌子的东西 |
| 名字的规矩 | 不能数字开头、区分大小写 | 一样 |
| 什么时候发现装错了 | 跑起来撞上才报错 | **翻稿子那一步就报**，程序根本生不出来 |

最后一行，就是 Java「规矩多、但稳当」的底气所在喵。

::: tip 猫咪提示
开仓库三步口诀：**先说牌子（`int`）→ 再起名字（`fish`）→ 最后装东西（`= 3`）**。三个都不能少，顺序也别调。
:::

::: warn 小心喵
- `=` 是「装进去」，`==` 才是「一样吗」——差一个字符，意思完全两样喵。
- 一句话用**双引号**（`"你好"`），单个字用**单引号**（`'A'`），别搞反。
- 中文输入法手滑打出来的「，」「；」「”」Java 一个都不认，写完全行回头瞄一眼输入法，能省下不少抓耳挠腮。
:::

## 小任务

1. 开四个仓库：`int`、`double`、`char`、`boolean`，各装一样你自己挑的东西，再一起打印出来；
2. 把 `int` 那间仓库塞进 `"3"`（带双引号），跑一次，把翻译官喵的原话念一遍；
3. 把 `3.5` 塞进 `int` 那间仓库，再跑一次；
4. 把 `fish` 改名叫 `fishCount`，故意漏改其中一处，看看报错长什么样。

```java
public class Main {
    public static void main(String[] args) {
        int fish = 3;
        double price = 2.5;
        char grade = 'A';
        boolean happy = true;
        System.out.println(fish);
        System.out.println(price);
        System.out.println(grade);
        System.out.println(happy);
    }
}
```

现在本喵的程序会「说」，可还不会「听」——主人想喂几条鱼，本喵只能先写死在稿子里。下一课，本喵让程序**张嘴问**主人，把敲进来的数接住喵～ 🐾
