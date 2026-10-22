---
id: java-stage1-09
lang: java
stage: 1
order: 12
title: 方法——Java 里的自创招式
tags: [方法, 招式, 参数, 返回值]
required: [java-stage1-08]
crossRefs: ["common-07", "c-stage1-12", "cpp-stage1-09", "python-stage1-11"]
compare: ["common-07"]
estMinutes: 25
keywords: [方法, 参数, 返回值, static]
---

## 钩子：本喵想造一招

前几天本喵干活，都是把话一句句排在 `main` 里：印一句、算一下、再印一句。可有些活儿本喵一天要干好几遍——比如「打招呼」：印「你好喵～」。三只猫来了就抄三遍，十只猫来了就抄十遍。

本喵想要的是：**把这套动作打包起来，起个名字**，往后喊一声名字，它就替本喵干一遍。这一步，术语表里叫**招式**（Java 管它叫**方法**）喵。

## 本喵的第一招：`greet()`

```java
public class Main {
    public static void greet() {
        System.out.println("你好喵～");
    }

    public static void main(String[] args) {
        System.out.println("上课前");
        greet();
        System.out.println("下课后");
    }
}
```

```text
上课前
你好喵～
下课后
```

看看本喵把这一招摆在**哪儿**：它写在 `main` 的**上面**，而且——注意看大括号——它和 `main` 是**平起平坐的两段**，各自带着自己的花括号：

- **上面那段**就是新招式：`public static void greet()` 打头，后面跟着一对花括号，里面是这一招要干的活儿。
- **下面那段**还是老朋友 `main`，本喵程序的入口。
- 中间那句 `greet();` 就是**喊这一招**：写名字，后面跟**一对小括号**，再一个分号。

喊一声，电脑就跑到 `greet` 那对花括号里，把里面的活儿干完，再回来接着跑下一句。所以屏幕上先是「上课前」、再是招式里那句「你好喵～」、最后「下课后」——**喊一次只干一遍，回来接着往下走**喵。

### 招式名不是仓库名

`greet()` 后面那对小括号是「喊」的记号，**不能省**。省了写成 `greet`，翻译官会以为你在叫一块牌子（里面装着一串字或者一个数），可是本喵从来没摆过这样一块牌子。

再记一条：**招式名也算本喵自己起的名字**，跟摆牌子的名字一样，起了 `greet` 就一路喊 `greet`；大小写也不能乱换。喊错名字，翻译官照样拦。

## 把一招拆成五个零件

拿本喵下一招来拆——它会叼东西回来。这一招的**打头那一行**是 `public static int add(int a, int b) {`，**身子最后一句**是 `return a + b;`——下面那张表就按它们的位置，一格一格讲给你听（整招拼起来的样子，紧接着就有完整的一段喵）。

| 零件 | 这一段的原话 | 它负责什么 |
|---|---|---|
| 开门口号 | `public` | 「谁都能喊本喵这一招」。先跟着写，往后讲图纸的时候再细说 |
| 不用真猫 | `static` | 「不用先造出一只真猫，直接喊就行」的记号 |
| 战利品的类型 | `int` | 这一招要**叼回来**什么料。写 `void`（空）就是「干完活不叼东西回来」 |
| 招式名 | `add` | 本喵起的名字 |
| 投喂口 | `(int a, int b)` | **投喂的小鱼干（参数）**：喊的时候要喂进来的料，写「类型 + 名字」，几样就写几样，逗号隔开 |

再加上身子那两句：花括号里写活儿，`return a + b;` 是**叼回来的那一刻**——`return` 后面那个东西，就是这一招「叼回来的战利品（返回值）」喵。

会叼战利品的招，喊出来的结果**能当值用**，像这样：

```java
public class Main {
    public static int add(int a, int b) {
        return a + b;
    }

    public static void main(String[] args) {
        int total = add(3, 5);
        System.out.println(total);
        System.out.println(add(10, 1) + add(1, 1));
    }
}
```

```text
8
13
```

- `add(3, 5)` 喊一声，喂进去 `3` 和 `5`，这一招叼回 `8`——本喵把它装进 `total` 里再印。
- `add(10, 1) + add(1, 1)` 是喊了两遍：一遍叼回 `11`、一遍叼回 `2`，两个数再相加，印出 `13`。**喊招式的写法跟一个值一样好使**，想放哪儿放哪儿喵。

这一趟来回（跳进去、跑完、落回原处）看不见，本喵把它拆成一步一步，走给你看：

```demo
title: 喊一声 add(3, 5)：电脑到底跑去了哪儿
code:
| public static int add(int a, int b) {
|     return a + b;
| }
| public static void main(String[] args) {
|     int total = add(3, 5);
|     System.out.println(total);
| }

step 起点：招式先住着，程序从 main 开跑
at: 4
say: `add` 这一招早就写在图纸上了（第 1 行打头那一行），可它**自己不会动** —— 没人喊，它一行都不跑。程序永远从 `main` 开跑，第一件活儿在下面。
meow: 招式乖乖待着，等本喵喊一声喵～
pose: expect
现在跑到哪 = main 里等着
招式里的两只碗 = 还没摆
total 装了吗 = 还没装

step 喊一声 add(3, 5)：先把回来的路记下
at: 5
say: 轮到 `int total = add(3, 5);` 了。电脑**先算等号右边**：喊一声 `add`。喊出去之前，它先在心里记下这一行的位置 —— 招式跑完，要落回这儿。
meow: 喊出去啦，回来的路先记好！
pose: busy
现在跑到哪 = 正往 add 里跳
招式里的两只碗 = 还没摆
total 装了吗 = 还没装

step 递料：招式里现摆两只碗接住 3 和 5
at: 1
say: 括号里的 `3` 和 `5` 是**复印一份**递进去的：招式里现摆两只碗 `a`、`b` 接住 —— `a` 里是 3，`b` 里是 5。这只是招式**自己的**两只碗，外面那两个数一点没动。
meow: 现摆两只碗，a 装 3、b 装 5 喵！
pose: busy
现在跑到哪 = add 的身子里
招式里的两只碗 = a = 3，b = 5
total 装了吗 = 还没装

step 招式体：算 a + b，return 把 8 叼起来
at: 2
say: 招式里先算右边 `a + b`：3 加 5 得 **8**，`return` 把 8 叼起来。**注意：这一步外面的 `total` 还是「还没装」，一点没变** —— 招式里跑的活儿，管不着外面那只碗。
meow: 3 加 5 得 8，叼起来！
pose: yay
现在跑到哪 = add 的身子里
招式里的两只碗 = a = 3，b = 5
total 装了吗 = 还没装

step 回来：落回喊它的那一行，装进 total
at: 5
say: 招式叼着 8 落回**刚才喊它的那一行**，把 8 装进左边的 `total`。`total` 到这一刻才第一次有值 —— 招式在里头跑着的时候，外面这只碗一直是空的。
meow: 8 落进 total 里啦！
pose: busy
现在跑到哪 = 落回 main
招式里的两只碗 = （撤走了）
total 装了吗 = 装了 8

step 报出 total：屏幕上印出 8
at: 6
say: 最后一行 `System.out.println(total)` 报出 `total`，屏幕上印出 **8** —— 课文上面那段结果里的第一个 8，就是它。这个 8 是 `add` 叼回来的，不是 `main` 自己算的。
meow: 印出 8，一分不差喵～
pose: yay
现在跑到哪 = main 的最后一行
招式里的两只碗 = （撤走了）
total 装了吗 = 装了 8

step 收工：main 跑完，招式里的碗撤走了
at: 7
say: `main` 的大括号合上，程序收工。回头看一眼这一趟：**喊一声 → 跳进招式里跑完 → 落回原处接着跑**。招式里的碗是喊一次现摆一次、喊完就撤，所以换样料再喊一遍，它会重新摆两只。
meow: 跑完啦，下次喊本喵重新摆碗～
pose: proud
现在跑到哪 = 程序收工
招式里的两只碗 = （撤走了）
total 装了吗 = 装了 8
```

**记住这一趟来回**：喊一声 = 电脑跳到招式里跑一趟，跑完**落回刚才喊它的那个地方**接着跑（喊声要是单独占一行，落回来的就是它的下一行）；递进去的料是**复印一份**，招式里那两只碗跟外面互不相干。所以上面那句 `int total = add(3, 5);` 里，`total` 一直要等到招式回来才装上东西喵。

### 两招长得很像，脾气不一样

| 打头写的 | 它是什么性格 | 喊完能得到什么 |
|---|---|---|
| `void` | 只干活、不叼东西 | 「没结果」——只能当一句话用，不能装进牌子 |
| `int` / `String` / … | 干完活还要叼回一样料 | 一样 `int`（或那样料），能装牌子、能进算式 |

看个 `void` 的：

```java
public class Main {
    public static void add(int a, int b) {
        System.out.println(a + b);
    }

    public static void main(String[] args) {
        add(3, 5);
    }
}
```

```text
8
```

这一招自己也印了 `8`，可它**啥也没叼回来**——本喵要是写成 `int x = add(3, 5);`，翻译官就要拦人了：那一招没有战利品，你装什么？**要叼东西就用 `return` 挑一样出来，并且在打头那儿写清是什么料**，两边说好才作数喵。

### `return` 一出场，这一招就结束

`return` 还有第二个身份：**它一出现，这一招立刻收工**，后面再排着多少句子都不跑了。

```java
public class Main {
    public static String check(int n) {
        if (n > 0) {
            return "还有鱼干喵";
        }
        System.out.println("这句只在没战利品可叼的时候才轮到");
        return "碗空了喵";
    }

    public static void main(String[] args) {
        System.out.println(check(5));
        System.out.println(check(0));
    }
}
```

```text
还有鱼干喵
这句只在没战利品可叼的时候才轮到
碗空了喵
```

第一次喊 `check(5)`：眼色答真，`return` 立刻把「还有鱼干喵」叼回来——**那一招当场收工**，底下那句提示语没轮到。第二次喊 `check(0)`：眼色答假，往下走，先把提示语印出来，最后才用 `return` 叼回「碗空了喵」。

上一课学的眼色和绕圈，从今天起就能包进招式里；`return` 跟 `break` 有点像——**都是「不干了、走人」**，只是 `return` 是整招收工，手里还带一样东西走喵。

## 为什么招式必须住在图纸里

这是今天最要紧的一问。本喵从第一天起就一直在写 `public class Main { ... }`，你有没有想过：**这一层壳是干嘛的？**

答案就一句话：**在 Java 里，招式不许飘在空气里，它必须写在某一张图纸的花括号里面。**

（图纸在代码里的记号就是 `class` 这个词——`public class Main` 的意思正是「本喵要画一张叫 `Main` 的猫猫图纸（类）」。本喵今天先立住这一条，往后几课会一直用。）

- **图纸就是 `public class Main { ... }` 那一对大括号。** 招式写在这对大括号**里面**，跟 `main` 平起平坐；`main` 也不例外，它只是「Main 这张图纸上、专门给电脑当入口的那一招」。
- **为什么这么定？** 因为 Java 把「东西」和「本事」看作**一家人的**：本事长在谁身上，就写进谁那张图纸里。往后本喵会画自己的图纸（比如「猫」图纸、「鱼干仓库」图纸），每张图纸里住着它自己的一堆招——**招式是图纸的成员，不是空气里的流浪猫**。
- **那 `Main` 呢？** 它是 Java 替本喵准备好的第一张图纸：`java Main` 这句命令的意思就是「去 `Main` 这张图纸里找入口」。所以本喵的程序现在是清清楚楚的两层：**图纸（类的花括号）在外，招式（方法）在内**。

图纸名这件事，本喵在命令行上撞过一次：文件叫 `Main.java`、图纸却写成 `public class Cat`，翻译官当场就说了 ——

> `class Cat is public, should be declared in a file named Cat.java`

念起来是：**「这张图纸叫 `Cat`，那它就得住在一个叫 `Cat.java` 的文件里喵。」** 本喵这些课的文件一直叫 `Main.java`，所以图纸也就跟着叫 `Main`——**图纸名和文件名必须对得上**。想给图纸起别的名字，就把文件也改成那个名字，两边一起改。（本喵的练习场里，翻译官会替你按图纸名把文件摆好，所以这一条你平时不太撞得到；但它在命令行上是铁规矩，记着总没错喵。）

### 那 `static` 是干嘛的

`main` 身上挂着 `static`，本喵新写的每一招也照着挂了。它的意思是：**这一招不用先按图纸生出一只真猫，直接喊就行。**

还有一条配套的规矩，本喵撞给你看过就知道深浅：

```java
public class Main {
    public void greet() {
        System.out.println("你好喵～");
    }

    public static void main(String[] args) {
        greet();
    }
}
```

```text
Main.java:7: error: non-static method greet() cannot be referenced from a static context
        greet();
        ^
1 error
```

翻译过来是：**「没挂 `static` 的招，站在没挂 `static` 的地方喊不出来喵。」** 本喵的土规矩先记成一句：**今天写的每一招都跟着 `main` 挂上 `static`**——挂了 `static` 的招，直接喊同样挂了 `static` 的招，两边都省事。往后学会按图纸生猫之后，另一半规矩自然就懂了喵。

## 招式能被喊好多遍

打包的好处就体现在这儿：**同一招，换个料，喊几遍都行**。

```java
public class Main {
    public static void greet(String name) {
        System.out.println("你好，" + name + "喵～");
    }

    public static void main(String[] args) {
        greet("小橘");
        greet("狸花");
    }
}
```

```text
你好，小橘喵～
你好，狸花喵～
```

招式名一个没改，只是每次喂进去的料不一样（`"小橘"`、`"狸花"`），屏幕上就换了名字。**这就是「打包一套动作」的意义**：动作写一遍，料每次现喂。喊十遍就是十只猫，本喵一句都不用重抄喵。

## 拿错料会怎样

**第一种：说好要叼东西，却空着手回来。**

```java
public class Main {
    public static int add(int a, int b) {
        int sum = a + b;
    }

    public static void main(String[] args) {
        System.out.println(add(3, 5));
    }
}
```

```text
Main.java:4: error: missing return statement
    }
    ^
1 error
```

翻译过来是：**「你说好要叼一个 `int` 回来的，可这一路上一个 `return` 都没有喵。」** 打头写了 `int`，身子里的每一条路都得能叼回一样 `int`——少写一个 `return`，翻译官**编译的时候就把你拦下**，不让你带着这个窟窿往下跑。

**第二种：喂的料数目对不上。** 本喵的 `add` 要两样料（`int a, int b`），只喂一样会怎样？翻译官的原话是：

`method add in class Main cannot be applied to given types; required: int,int`

念起来是：**「`add` 这一招要两个 `int`，你只喂了一个喵。」** 喂多了、喂少了、喂错料（比如本该喂整数却喂了一串项链），都是这一句——**喊招式的时候，几样、什么料，都得跟打头那儿写的一模一样**。

| 本喵写错的 | 翻译官说什么 | 啥时候出问题 |
|---|---|---|
| 打头写 `int`，身子没有 `return` | `missing return statement` | **编译当场拦** |
| 喂的料数目/类型跟打头不符 | `cannot be applied to given types` | **编译当场拦** |
| 招式没挂 `static`，直接在 `main` 里喊 | `non-static method ... cannot be referenced from a static context` | **编译当场拦** |
| 名字喊错、大小写不对 | `cannot find symbol` | **编译当场拦** |

招式写错**全都在编译时就被拦下**——这一点比上一课的越界省心：错了就跑不起来，不会偷偷给你一个错答案喵。

::: tip 猫咪提示
今天记住这五句话：

1. **招式 = 打头那行 + 一对花括号**：打头写清「谁能喊、叼不叼东西、叫什么、要喂什么」，花括号里写活儿。
2. **`void` 是干完活不叼东西，`int` 那些是要叼回一样料**；要叼就在身子里的**每条路**上都写 `return`。
3. **`return` 一出场，这一招立刻收工**，后面的句子都不跑了。
4. **招式必须写在图纸（类）的花括号里面**，跟 `main` 平起平坐；`java Main` 找的就是 `Main` 这张图纸，所以**图纸名要和文件名对上**。
5. **今天每一招都跟着挂 `static`**，这样它们能互相直接喊；喂料时，几样、什么料，都按打头那儿写的来。
:::

## 小任务

1. 把 `greet` 那一段抄进练习场，在 `main` 里多喊两句 `greet();`，看看屏幕上多印了几行喵。
2. 给 `add` 加一样料（比如变成 `add(int a, int b, int c)`，把三样加起来），改完在 `main` 里喊一遍——记得喂三样，本喵想看你会不会漏（漏了就是那句 `cannot be applied to given types`）。
3. 写一招 `int maxOf(int a, int b)`：叼回两个数里大的那个（提示：「if 与 switch」那一课的小眼色，`? :` 那对记号在这儿正合适）。
4. 写一招 `void printRow(int n)`：喊 `printRow(3)` 就印三行「绕圈喵」（提示：上一课的绕圈搬进来）。
5. 故意把 `greet` 前面那个 `static` 删掉再编译一次，把翻译官的原话抄给小本本；抄完记得**加回去**喵。

下一课，本喵要给招式**加兄弟**：同一个名字、不同的投喂口，喊的时候电脑自己挑该用哪一招（Java 管这叫**重载**）；还要把「哪块牌子活在哪一层」这件事讲透——「for 与 while」那一课本喵撞过的那个「`i` 出了圈就不认识」，到那儿就有正式答案啦。去下一课探险喵～ 🐾
