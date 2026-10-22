---
id: java-stage2-10
lang: java
stage: 2
order: 10
title: 泛型初步——会量体裁衣的图纸
tags: [泛型, 图纸]
required: ["java-stage2-09"]
crossRefs: []
compare: ["common-10"]
estMinutes: 28
keywords: [generics, type parameter, erasure]
---

## 钩子：那对尖括号，到底是什么

前两课的柜子，名分那一行都长这样：`List` 后面跟一对**尖括号**，括号里塞着一块牌子（上面写着 `String`）；账本则是 `Map` 后面一对尖括号，括号里塞着**两块**牌子（`String` 和 `Integer` 各一块）。尖括号里那块东西本喵一直让你「照着写」，今天该说清楚它是什么了。

一句话：**那是一张会量体裁衣的图纸上的、空着没填的尺码。**

## 一、先看看没有它的日子有多难受

要理解它好在哪，先看不填那块尺码的时候，日子是怎么过的：

```java
import java.util.ArrayList;

public class Main {
    public static void main(String[] args) {
        ArrayList box = new ArrayList();
        box.add("小鱼干");
        int n = (Integer) box.get(0);
        System.out.println(n);
    }
}
```

```text
Exception in thread "main" java.lang.ClassCastException: class java.lang.String cannot be cast to class java.lang.Integer (java.lang.String and java.lang.Integer are in module java.base of loader 'bootstrap')
```

念起来是：**「你贴上『数字』的标签要把它当数字用，可口袋里装的是项链喵。」**

那对尖括号不写的时候，柜子是个**万能口袋**：什么东西都收，因为收进去的时候都当成了 `Object`（万物都能装的那种口袋）。麻烦在后面 —— **取出来的时候，本喵得自己贴标签**：`(Integer) box.get(0)` 这一笔就是「本喵保证它是数字」。可柜子里装的其实是项链，保证落空，**跑到这一步才炸**。

最气人的是：**这个错写的时候看不出来、编译也不拦**，非得等程序跑到那一行才翻车。

本喵把这只**万能口袋**从领到手到翻车，一步一步走给你看：

```demo
title: 没填尺码的柜子，错在哪一步才炸
code:
| ArrayList box = new ArrayList();
| box.add("小鱼干");
| int n = (Integer) box.get(0);
| System.out.println(n);

step 领一只不填尺码的柜子
at: 1
say: `ArrayList box = new ArrayList()` 尖括号一个字都没写 —— 这只柜子是**万能口袋**，什么都收。此刻柜子还空着，本喵手上也空着。
meow: 领到一只不挑食的口袋喵～
pose: expect
柜子里装着 = （空）
本喵手上 = （空）
屏幕上 = 还没印
炸了吗 = 还没有

step 塞一条项链进去：收的时候当成「万物口袋」
at: 2
say: `box.add("小鱼干")` 把项链塞进去。没填尺码，**收进去的东西一律当成万物那种口袋（`Object`）** —— 柜子自己不记着这是项链，也不拦本喵塞什么。
meow: 塞进去啦，只记成 Object～
pose: busy
柜子里装着 = 小鱼干（记成 Object）
本喵手上 = （空）
屏幕上 = 还没印
炸了吗 = 还没有

step 先把第 0 件叼出来
at: 3
say: `box.get(0)` 把柜子里第 0 件叼出来。**叼出来的东西一律是「万物那种口袋」** —— 柜子不说它是什么，翻译官喵也没处问。
meow: 叼出来一件，它不说是啥喵～
pose: busy
柜子里装着 = 小鱼干（记成 Object）
本喵手上 = 小鱼干（当成 Object）
屏幕上 = 还没印
炸了吗 = 还没有

step 贴上「数字」标签：当场翻车
at: 3
say: `(Integer)` 这一笔是**本喵自己贴标签**：拍胸脯保证它是数字。可手上其实是项链 —— **一贴就露馅，当场炸 `ClassCastException`**。这一笔翻稿子的时候翻译官喵一个字都没说。
meow: 保证落空，当场翻车喵！
pose: think
柜子里装着 = 小鱼干（记成 Object）
本喵手上 = 贴上「数字」，对不上
屏幕上 = 还没印
炸了吗 = 炸了（ClassCastException）

step 最后一行一个字都没印
at: 4
say: `System.out.println(n)` **一个字都没印** —— 程序在上一行就断了气，这一行压根没轮到。屏幕上留下的只有出事那一只的名字和脚印，不是 `n` 的数。
meow: 最后一个字都没来得及印喵…
pose: think
柜子里装着 = 小鱼干（记成 Object）
本喵手上 = （炸没了）
屏幕上 = 没有数，只有出事那只的名字和脚印
炸了吗 = 炸了（ClassCastException）
```

这一段最要紧的是**时机**：没填尺码，翻译官喵一路放行，错要等程序跑到 `(Integer)` 那一笔才当场露头 —— 而且**那一炸之后，后面的活儿全部作废**。填了尺码以后这个时机往前挪到哪儿，第二节和第四节接着说。

## 二、会量体裁衣的图纸：尖括号里那块空尺码

这种「什么都收」的柜子当然有用 —— 明明只是想装一串东西，为什么非要挑一种？Java 的答案不是「别挑」，而是：**图纸上留一块空尺码，用的时候再填。**

```java
class Bowl<T> {
    private T thing;

    void put(T thing) {
        this.thing = thing;
    }

    T take() {
        return thing;
    }
}

public class Main {
    public static void main(String[] args) {
        Bowl<String> fish = new Bowl<>();
        fish.put("小鱼干");
        System.out.println(fish.take());

        Bowl<Integer> num = new Bowl<>();
        num.put(3);
        System.out.println(num.take() + 1);
    }
}
```

```text
小鱼干
4
```

- **图纸名字后面那对尖括号** —— 里面那个 `T` 就是**空着的尺码**。图纸上凡是写 `T` 的地方（口袋的形状、`put` 收什么、`take` 叼回什么），都读作「**用的时候填什么，这里就是什么**」。
- **尖括号里填 `String` 的那一句**（`fish` 那只柜子）—— 尺码填成项链：这只柜子只装项链。
- **尖括号里填 `Integer` 的那一句**（`num` 那只柜子）—— 尺码填成数字。于是 **`num.take() + 1` 可以直接做加法** —— 因为 `take` 叼回来的时候，Java 已经知道它是数字，**不用本喵再贴标签**。
- 那一对写在图纸上的 `T`，行话叫**占位符**：它自己**不是**某种具体的东西，只是「这里会有一块尺码」的记号。

这套会量体裁衣的本事有个正式名字，叫**泛型（会量体裁衣的图纸）**。

## 三、招式也能量体裁衣

图纸能这样，招式也能 —— 在招式名字**前面**加一对尖括号：

```java
public class Main {
    static <E> void printTwice(E item) {
        System.out.println(item);
        System.out.println(item);
    }

    public static void main(String[] args) {
        printTwice("喵");
        printTwice(7);
    }
}
```

```text
喵
喵
7
7
```

- **招式名字前面那对尖括号** —— 它写在**叼回什么之前**，括号里那个 `E` 是这一招的空尺码；投喂进来的 `item` 和招式里用到它的地方，都跟着这块尺码走。
- **`printTwice("喵")`** —— 喂一条项链进去，`E` 当场定成 `String`。
- **`printTwice(7)`** —— 喂一个数字进去，`E` 当场定成 `Integer`（自动装箱也在悄悄干活）。
- 一招就能伺候所有类型，**不用为每样东西各写一招**。

## 四、最大的好处：做错了当场就告诉本喵

回头看第一节那个错 —— 有尺码之后会怎么样：

```java
import java.util.ArrayList;

public class Main {
    public static void main(String[] args) {
        ArrayList<String> names = new ArrayList<>();
        names.add("小橘");
        names.add(3);
        System.out.println(names);
    }
}
```

```text
Main.java:7: error: incompatible types: int cannot be converted to String
        names.add(3);
                  ^
Note: Some messages have been simplified; recompile with -Xdiags:verbose to get full output
1 error
```

念起来是：**「这柜子填的尺码是项链，你塞进来一个数字，尺寸对不上喵。」**

这就是最值钱的地方：**错从「跑到那一行才炸」，提前到了「翻译稿子的时候就拦下」** ——

| | 不填尺码 | 填了尺码 |
|---|---|---|
| 塞错东西 | 照塞不误 | **编译期当场报错** |
| 取出来用 | 得自己贴标签 `(Integer)`，贴错就炸 | 直接就是那个类型，**不用贴标签** |
| 什么时候发现错 | 跑到那一行 | 翻译稿子的时候 |

## 五、擦除：跑起来的时候，尺码其实被擦掉了

最后一件事，**能帮你少走很多弯路**。看这段：

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>();
        List<Integer> nums = new ArrayList<>();
        System.out.println(names.getClass() == nums.getClass());
    }
}
```

```text
true
```

两只柜子**明明是两种尺码**，可它们「是哪种柜子」居然答 `true` —— 同一只。原因叫**类型擦除**：

> 尺码是给**翻译官喵在翻稿子的时候**看的。翻完之后，尖括号里的东西**被擦掉了** —— 跑起来的时候，两只柜子都只是「一只 `ArrayList`」，柜子自己**不记得**里面装的是什么。

所以有两件事照着记喵：

- **好处**：带尖括号的名分**不会在跑的时候多花力气**，尺码只在翻译阶段站岗。
- **要留心的**：跑起来之后就**问不出**「这只柜子里装的是什么尺码」了。所以 `new T()`、`new T[10]` 这种「跑的时候还想用尺码」的写法**根本不合法**，写出来翻译官喵当场就拦 —— 那是它本来就做不到的事。

::: warn 小心喵

- **尖括号里只能填「真猫那种」**（图纸、项链、装数字的图纸……），**不能填光溜溜的家当**：把 `int` 那种裸类型写进尖括号是错的，得写成装数字的那张图纸 `Integer` —— 尖括号只认真猫，这也是为什么上一课那种装数字的图纸这么常用。
- **`T` / `E` 只是记号，随便起名也行**（`T`、`E` 是大家约定俗成的叫法），但**一旦起名就前后一致**，别半路换个字母，翻译官喵会对不上号。
- **填了尺码就不要想着「跑起来再问它是什么」** —— 类型擦除之后问不出来，这是本课的坑，也是设计上刻意的取舍喵。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| 图纸名 `Bowl` 后面挂一对尖括号、里面写个 `T` | 图纸上留一块空尺码，用的时候再填 |
| 尖括号里填 `String` 的那只柜子（`fish` 那只） | 尺码填项链：这只柜子只装项链 |
| 尖括号里填 `Integer` 的那只柜子（`num` 那只） | 尺码填数字：`take()` 叼回来就能直接算 |
| 招式名前面挂一对尖括号、里面写个 `E` | 招式也能量体裁衣（尖括号写在叼回什么之前） |
| `printTwice("喵")` / `printTwice(7)` | 一招伺候所有类型，尺码当场定 |
| `ArrayList box = new ArrayList();` | 不填尺码 = 万能口袋，什么都收 |
| `(Integer) box.get(0)` | 取出来自己贴标签 —— 贴错了跑到那一步才炸 |
| `names.add(3)`（尺码是项链） | 编译期当场报错：`incompatible types` |
| `names.getClass() == nums.getClass()` | 尺码被擦掉了 —— 跑起来两只柜子是同一种 |
| 尖括号里写 `int` 那种**裸类型** | 不合法：尖括号里只认真猫，得写装数字的那张图纸 `Integer` |

::: tip 猫咪提示

- **尖括号里那一块，就是图纸上留的空尺码** —— 用的时候填什么，图纸上写 `T` 的地方就是什么。
- **不填尺码的柜子是万能口袋**：塞什么都收，可取出来得自己贴标签，贴错了跑到那一步才炸。
- **填了尺码，错就提前到翻稿子那一步**：塞错东西当场被拦下，取出来也直接就是那个尺码，不用贴标签。
- **招式也能量体裁衣**：尖括号写在「叼回什么」的前面，一招就能伺候所有尺码。
- **尺码是给翻译官喵在翻稿子的时候看的**，翻完就被擦掉了 —— 跑起来之后问不出柜子里装的是哪种尺码，所以「跑起来还想用尺码」的写法根本不合法喵。

:::

## 小任务

1. 把第二节的图纸抄进练习场，再量一只尺码填成 `Double`（小数那种）的柜子，塞个 `3.5` 进去取出来印出来 —— 看看同一张图纸是不是真的能量出第三种尺寸。
2. 照第三节那招的样子自己写一招：招式名**前面**挂一对尖括号、里面写个别的字母，把同一件东西连印三遍，分别喂项链和数字各试一次。
3. 把第四节的 `names.add(3);` 删掉，看看红字是不是消失了；再把它改成 `names.add(3 + "")` 试试 —— 猜猜这样为什么就过了（提示：数字和项链相加，会变成什么）。
4. 想一想：既然跑起来之后尺码被擦掉了，那两只柜子（一只填的尺码是项链、一只填的是数字），**在翻译稿子的时候**是靠什么被区分开的？

下一课，本喵要教两种「起名字」的写法：一种是把**一串定好的选项**起个正式名字（比如「周一到周日」），另一种是把**一张小图纸直接塞进另一张图纸里**当零件 —— 都是往后写大程序时天天要用的东西喵～ 🐾
