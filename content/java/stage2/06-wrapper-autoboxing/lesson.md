---
id: java-stage2-06
lang: java
stage: 2
order: 6
title: 包装类与自动装箱
tags: [类型, 装箱拆箱]
required: ["java-stage2-05"]
crossRefs: []
compare: ["common-04"]
estMinutes: 25
keywords: [Integer, autoboxing, unboxing, parseInt]
---

## 钩子：光溜溜的数字，进不了真猫的聚会

本喵的鱼干账本越来越热闹了。今天想办一场「猫猫聚餐」：每只猫的名字配上它今天吃了几条小鱼干，装进一个**会自己长大的储物柜**里，回头好一个一个翻。

可本喵刚把数字往柜子里塞，翻译官喵就把爪子拍下来了：

> 那个柜子只收**真猫**（照图纸生出来的东西）喵。裸数字这种**光溜溜的家当**，它一只都不收。

这就是今天要解的疙瘩：Java 把家当分成两拨 ——

- **光溜溜的家当**：`int`、`double`、`char`、`boolean`、`long`、`short`、`byte`、`float` 这八样。它们轻、快，可**不是真猫**，进不了只收真猫的地方。
- **照图纸生出来的真猫**：上一课学的那些 `new` 出来的家伙。

那本喵想往储物柜里塞数字怎么办？Java 的办法很贴心：**给每个光溜溜的类型都配一张图纸**，数字想进柜子时，就照那张图纸生一只真猫，把它装进口袋里。

## 一、八张「装数字的图纸」

| 光溜溜的家当 | 配的那张图纸 |
|---|---|
| `int` | `Integer` |
| `double` | `Double` |
| `char` | `Character` |
| `boolean` | `Boolean` |
| `long` | `Long` |
| `short` | `Short` |
| `byte` | `Byte` |
| `float` | `Float` |

这八张图纸的正式名字叫**包装类（装数字的图纸）**，因为它们干的事就是**把光溜溜的家当包起来**。注意两个小地方喵：

1. 名字**首字母大写了**（`int` 变小写的大爷，`Integer` 是它的图纸）；
2. **只有 `Integer` 和 `Character` 是全名**，别写成 `Int` 或 `Char` —— 那两个名字翻译官喵不认识。

## 二、装箱与拆箱：数字自己会钻口袋

以前要生一只装数字的真猫，得写 `new Integer(3)`。现在**不用了** —— 你把光溜溜的数字直接递给图纸那边，Java 自己会替你生：

```java
public class Main {
    public static void main(String[] args) {
        Integer boxed = 3;
        int raw = boxed;
        System.out.println(boxed + 1);
        System.out.println(raw);
    }
}
```

```text
4
3
```

一行一行看喵：

- **`Integer boxed = 3;`** —— 右边是个光溜溜的 `3`，左边要一只 `Integer`。翻译官喵一看两边对不上，就**自动**照图纸生了一只真猫、把 `3` 装进去，再交给 `boxed`。这个动作叫**装箱**（往图纸里装）。
- **`int raw = boxed;`** —— 反过来：左边要光溜溜的家当，右边是只真猫，它**自动**把口袋里的数字掏出来。这叫**拆箱**（从图纸里拆出来）。
- **`boxed + 1`** —— 加减乘除只认光溜溜的数字，所以这里**先拆箱**再算，得 `4`。
- **`raw`** 原样就是 `3`。

「自动」那两下 —— 装箱和拆箱 —— **代码里一个字都没写**，所以最容易忘。本喵把它拆成一步一步，盯住 `boxed` 手上到底是哪一种东西：

```demo
title: 装箱与拆箱：代码里没写的那两步
code:
| Integer boxed = 3;
| int raw = boxed;
| System.out.println(boxed + 1);
| System.out.println(raw);

step 两边对不上：翻译官喵自己动手
at: 1
say: `Integer boxed = 3;` 右边是**光溜溜的数字** `3`，左边要的是照图纸生出来的**真猫**。翻译官喵一看两边对不上，就**自动**照 `Integer` 那张图纸生一只真猫、把 `3` 装进口袋 —— 这几行代码里一个字都没写。这叫**装箱**。
meow: 悄悄生一只真猫，把 3 装进去喵！
pose: expect
boxed 手上 = 一只真猫（口袋里装着 3）
raw 手上 = （还没生）
屏幕上 = 还没印

step 反着来：把数字掏出来
at: 2
say: 反过来：左边要的是**光溜溜的数字**，右边递来一只真猫 —— 它自动把口袋里的数字掏出来交给 `raw`。这叫**拆箱**，同样不用本喵写招式。
meow: 口袋一掏，数字就出来了喵～
pose: busy
boxed 手上 = 一只真猫（口袋里装着 3）
raw 手上 = 光溜溜的数字 3
屏幕上 = 还没印

step 算式只认裸数字：先拆箱再算
at: 3
say: `boxed + 1`：加减乘除只认光溜溜的数字，所以这里**先拆箱**掏出 3，再算 `3 + 1` 得 `4`。盯着 `boxed`：这只真猫自己一点没变，口袋里还是 `3`。
meow: 先拆箱再算，得 4 喵！
pose: busy
boxed 手上 = 一只真猫（口袋里还是 3）
raw 手上 = 光溜溜的数字 3
屏幕上 = 还没印

step 算完才轮到印：4
at: 3
say: 算完才轮到 `println` 把这行印出去：`4`。这一步里动手的只有「拆箱 + 加法 + 打印」，**没有任何东西被装进图纸**。
meow: 印出 4，真猫却没动过喵～
pose: yay
boxed 手上 = 一只真猫（口袋里还是 3）
raw 手上 = 光溜溜的数字 3
屏幕上 = 4

step 印 raw：它本来就是裸的
at: 4
say: 印 `raw` —— 它本来就是光溜溜的数字 `3`，装箱拆箱都不用，直接印。所以上面那段印出来是 `4` 和 `3`。
meow: raw 是裸的，直接印就好喵！
pose: proud
boxed 手上 = 一只真猫（口袋里还是 3）
raw 手上 = 光溜溜的数字 3
屏幕上 = 4、3
```

记住这一条：**`Integer` 和 `int` 可以互相直接递**，中间那两步都是翻译官喵自己动手，代码里看不见。也正因为看不见，写错了才不好查 —— 第五节那块「怪事」，就是这个「看不见」闹出来的喵。

::: tip 猫咪提示

**「自动」两个字是重点，也是最容易忘的。** 装箱 = 裸数字进图纸，拆箱 = 从图纸里掏数字；这两步不用你写任何招式，Java 看见两边对不上就自己动手。所以你只要记住一件事：**`Integer` 和 `int` 是可以直接互相递的**喵。

:::

## 三、图纸上自带的一堆好用小招式

生出来的真猫不只是个口袋，它身上挂着一堆现成的招式：

```java
public class Main {
    public static void main(String[] args) {
        System.out.println(Integer.parseInt("39") + 3);
        System.out.println(Integer.MAX_VALUE);
        Integer n = Integer.valueOf(7);
        System.out.println(n.intValue());
    }
}
```

```text
42
2147483647
7
```

- **`Integer.parseInt("39")`** —— 把一串**小鱼干项链**变成光溜溜的数字。这是往后天天要用的一招：纸条上读进来的东西永远是项链，想算就得先把它变成数字。
- **`Integer.MAX_VALUE`** —— `int` 能装的最大数字（2147483647）。记不住这个数没关系，喊一声名字就行。
- **`Integer.valueOf(7)`** —— 明着写出来的装箱，和上面那个自动装箱是一回事。
- **`n.intValue()`** —— 明着写出来的拆箱。
- 还有 `n.equals(...)`（比数字**是不是一样**）、`n.toString()`（把数字变成项链）等等，往后用到再认喵。

## 四、拆箱会在空口袋上摔一跤

真猫有个裸数字没有的本事：**它可以是一只空口袋**（`null`）—— 图纸里的口袋什么都没装。

```java
public class Main {
    public static void main(String[] args) {
        Integer fish = null;
        int n = fish;
        System.out.println(n);
    }
}
```

```text
Exception in thread "main" java.lang.NullPointerException: Cannot invoke "java.lang.Integer.intValue()" because "<local1>" is null
```

原话念起来是：**「本喵要拆箱，可这只真猫的口袋是空的喵。」** 自动拆箱说到底就是偷偷喊了一声 `intValue()`，而空口袋上喊它，当场就炸。

这条往后**天天用得上**：从储物柜、从账本（下一课那些）里取出来的数字，都可能是空口袋。要么先问一句「它在不在」，要么给它一个兜底的值，别直接拆喵。

## 五、缓存趣事：小数字是「同一只猫」

最后讲一件**会让人挠头**的事。看这段：

```java
public class Main {
    public static void main(String[] args) {
        Integer a = 127;
        Integer b = 127;
        Integer c = 128;
        Integer d = 128;
        System.out.println(a == b);
        System.out.println(c == d);
        System.out.println(a.equals(b));
    }
}
```

```text
true
false
true
```

怪不怪？两对数字明明都一模一样，`==` 却给出了不一样的结果。

原因在于 `==` 比的是「**是不是同一只猫**」，不是「口袋里的数字一不一样」。Java 觉得 -128 到 127 这些小数字太常用了，干脆**提前画好一批真猫**放在窝里，谁要装箱就拿同一只给它用。所以 `a` 和 `b` 拿到的是**同一只**，`==` 说 `true`；而 `128` 超出了那批备货，每次都得现画一只新的，`c` 和 `d` 是两只不同的猫，`==` 就说 `false`。

「同一只猫」这件事光看数字是看不出来的。本喵把它拆成一步一步，盯住**谁从窝里拿、谁现画**：

```demo
title: 127 是同一只猫，128 不是
code:
| Integer a = 127;
| Integer b = 127;
| Integer c = 128;
| Integer d = 128;
| System.out.println(a == b);
| System.out.println(c == d);
| System.out.println(a.equals(b));

step 小数字有现货：直接从窝里拿
at: 1
say: `Integer a = 127;` 又是装箱。可 `127` 落在 -128 到 127 那一批里 —— Java 觉得这类小数字太常用，**提前把真猫画好放在窝里**，a 拿到的是**窝里备好的那一只**，不现画。
meow: 小数字有现货，直接从窝里拿喵！
pose: expect
a 和 b 手上 = a：窝里备好的那只 127（b 还没生）
c 和 d 手上 = （还没生）
屏幕上 = 还没印

step 再来一个 127：还是那一只
at: 2
say: `Integer b = 127;` 还是 127，Java 又把**同一只**递了过去 —— `a` 和 `b` 手上是**同一只猫**。这一点 `==` 待会儿会替本喵说出来。
meow: 同一只，递了第二回喵！
pose: busy
a 和 b 手上 = 两只手上是**同一只** 127
c 和 d 手上 = （还没生）
屏幕上 = 还没印

step 128 超出备货：只能现画
at: 3
say: `Integer c = 128;` —— `128` **超出了那批备货**，窝里没有，只能现画一只新的。数字一样，猫是新的。
meow: 128 没现货，现画一只喵～
pose: think
a 和 b 手上 = 两只手上是**同一只** 127
c 和 d 手上 = c：128 没备货，现画的一只（d 还没生）
屏幕上 = 还没印

step 再来一个 128：又画一只新的
at: 4
say: `Integer d = 128;` 又是 128，可窝里还是没有 —— **再画一只新的**。现在 `c` 和 `d` 是**两只各画各的**猫：数字一样、猫不一样。
meow: 又是现画的，两只不是一只喵！
pose: think
a 和 b 手上 = 两只手上是**同一只** 127
c 和 d 手上 = 两只**各画各的**猫（数字一样、猫不一样）
屏幕上 = 还没印

step a == b：问的是「是不是同一只」
at: 5
say: `a == b` 印出 `true` —— `==` 问的是「**是不是同一只猫**」。它俩本来就是同一只，当然真。
meow: 同一只，== 说 true 喵！
pose: yay
a 和 b 手上 = 两只手上是**同一只** 127
c 和 d 手上 = 两只**各画各的**猫
屏幕上 = true

step c == d：数字一样，猫不一样
at: 6
say: `c == d` 印出 `false` —— 两口袋里的数字都是 128，可**猫不是同一只**。这就是课文说的「会让人挠头」那一下。
meow: 数字一样，== 却说 false 喵！
pose: think
a 和 b 手上 = 两只手上是**同一只** 127
c 和 d 手上 = 两只**各画各的**猫
屏幕上 = true、false

step a.equals(b)：问的才是数字
at: 7
say: `a.equals(b)` 印出 `true` —— `.equals(...)` 问的才是「**口袋里的数字一不一样**」。想比数字，一律用它，别用 `==`。
meow: 比数字用 equals，记住啦喵！
pose: proud
a 和 b 手上 = 两只手上是**同一只** 127
c 和 d 手上 = 两只**各画各的**猫
屏幕上 = true、false、true
```

这一段的怪，全在「拿到的是哪一只猫」上：**小数字常住同一个窝**，所以 `==` 时真时假。规矩就一句 —— **比数字一不一样，用 `.equals(...)`；`==` 问的是「是不是同一只」**，缓存圈内外结果不一样，这种 bug 看着像见鬼喵。

::: warn 小心喵

- **想比数字一不一样，用 `.equals(...)`，别用 `==`。** `==` 问的是「是不是同一只」，缓存范围内外结果不一样，这种 bug 看着像见鬼。这一条和往后那条**小鱼干项链的 `==` 陷阱**是同一个道理，一定记牢。
- **空口袋拆箱会炸。** `Integer` 可以是 `null`，`int` 不行；把一只空口袋的真猫直接递给 `int`，得到的是一段红字，不是 `0`。
- **八张图纸只认全名**：`Integer`、`Character` 是特例，没有 `Int`、`Char` 这种写法喵。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `Integer boxed = 3;` | 装箱：光溜溜的数字自动进图纸，变成真猫 |
| `int raw = boxed;` | 拆箱：从真猫口袋里把数字掏出来 |
| `boxed + 1` | 算式里先自动拆箱，再算 |
| `Integer.parseInt("39")` | 把一串项链变成数字 |
| `Integer.MAX_VALUE` | `int` 装得下的最大数字 |
| `Integer.valueOf(7)` / `n.intValue()` | 明着写出来的装箱 / 拆箱 |
| `n.equals(other)` | 比口袋里的数字**是不是一样**（正确的比法） |
| `a == b` | 比**是不是同一只猫** —— 小数字常住同一个窝，所以时真时假 |
| `int n = fish;`（`fish` 是 `null`） | 空口袋拆箱 → 当场炸 |

## 小任务

1. 把第二节那段抄进练习场，把 `Integer boxed = 3;` 换成 `Double boxed = 3.5;` 试试 —— 看看装箱这件事是不是**每张图纸都会**。
2. 改一改第四节的例子：把 `Integer fish = null;` 换成 `Integer fish = 0;`，看看红字还在不在；再想想，要是数字真的是从别处拿来的、可能是空口袋，你打算怎么先问一句「它在不在」。
3. 拿第五节的 127 换成 `-128` 和 `-129`，各跑一遍，把 `==` 印出来的结果记进小本本，看看那条「备货」的界线画在哪儿。
4. 想一想：`System.out.println(boxed + 1)` 里那只真猫，装箱之后**什么时候又会变回光溜溜的**？

下一课，本喵要专门审一审那串**小鱼干项链**（String）：为什么两串看起来一模一样的项链，用 `==` 比会说不相等；还有一条**会自己长大的抽屉** —— 要拼很多段话的时候，它能省下不少力气喵～ 🐾
