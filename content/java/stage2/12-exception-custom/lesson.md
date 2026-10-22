---
id: java-stage2-12
lang: java
stage: 2
order: 12
title: 异常进阶与自定义异常
tags: [异常, 报错]
required: ["java-stage2-11"]
crossRefs: []
compare: ["common-12"]
estMinutes: 28
keywords: [throw, throws, try, catch, finally, exception]
---

## 钩子：仓库空了那一刻

本喵写了一个取货招式：仓库里还有货，就拿 `n` 条出来。

那**仓库空了**的时候怎么办喵？最老实的办法是「印一句话，然后叼回一个 `0`」。可这办法有个绕不过去的毛病：**喊本喵的那只猫，分不清自己拿到的 `0` 是「仓库里真的只剩 0 条」，还是「根本没取成功」。** 它要分清楚，就得每次拿到货都回头看看那句提示印没印出来 —— 而提醒别人「记得检查一下」这件事，本喵已经知道靠不住了（上一课那个 `int day = 8` 就是活证据）。

Java 的答案很直接：**出事的时候，别偷偷糊过去，当场喊一声。**

## 一、「喊一声」：把出事这件事本身扔出去

喊的写法就一个词：

```java
throw new Exception("仓库空了喵");
```

拆开看：`new Exception(…)` 是**照图纸生一只专门代表「出事了」的真猫**，括号里那串话是留给别人的口信；前面的 `throw` 是**把这只猫往外扔**。

扔出去之后会怎样？它会**顺着喊本喵的那条路一路往上飞**：本喵的招式里不接，就飞到喊本喵的那只猫那儿；它也不接，就再往上飞；一路飞到最外面都没人接，程序就当场断气，把这只猫的名字和口信印出来，最后留下一串「出事的时候谁在干活」的脚印。

```java
public class Main {
    static void takeFish(int n) {
        if (n <= 0) {
            throw new RuntimeException("仓库空了喵");
        }
        System.out.println("拿到 " + n + " 条");
    }

    public static void main(String[] args) {
        takeFish(0);
    }
}
```

```text
Exception in thread "main" java.lang.RuntimeException: 仓库空了喵
	at Main.takeFish(Main.java:4)
	at Main.main(Main.java:10)
```

这一串怎么读喵：第一行是**出事那一只的名字 + 口信**；下面每一行 `at …` 是一格脚印，**从出事的地方往外排** —— 先 `takeFish` 第 4 行扔的，再 `main` 第 10 行喊的。倒着读就是一路下来的顺序。

## 二、出事的东西分两档，翻译官喵的态度完全不一样

上面那段代码**编得过**，是跑到那一步才炸的。可如果本喵把 `RuntimeException` 换成 `Exception`，同一个位置连编都编不过 —— 本喵真跑过：

```java
public class Main {
    static void takeFish(int n) throws Exception {
        if (n <= 0) {
            throw new Exception("仓库空了喵");
        }
        System.out.println("拿到 " + n + " 条");
    }

    public static void main(String[] args) {
        takeFish(0);
    }
}
```

```text
Main.java:10: error: unreported exception Exception; must be caught or declared to be thrown
```

念起来是：**「这只猫会出事，可你没说清出了事怎么办喵。」** `unreported` 是「没有交代」，后面那句 `must be caught or declared to be thrown` 是翻译官喵给的**两条出路**：要么当场接住，要么在招式头上声明「本喵不接，往上扔」。

为什么同样是出事，一个拦一个不拦？因为出事的东西**分两档**：

| 档 | 谁在这一档 | 翻译官喵的态度 |
|---|---|---|
| **要表态的** | `Exception` 这一家（不算它下面那个特例） | **你不写清怎么办，稿子就退回来** |
| **不表态也编得过** | `RuntimeException` 这一家 | 编得过，跑到那一步才炸 |
| **机器自己的病** | `Error` 这一家（机器没内存了之类） | 本喵管不了，**也别去接** |

第一档之所以要表态，是因为那些事**本来就该有个说法**：文件读不到、东西没找到、数字转不动 —— 这些不是「程序写错了」，是「外面的世界不配合」，所以Java 逼本喵**在写稿子的时候就先想一遍**。第二档（`RuntimeException` 这一家）通常是**本喵自己的稿子写错了** —— 比如拿一个空口袋去取东西、拿 0 当除数、下标越界 —— 那就该让程序当场炸给本喵看，别捂着。

::: tip 猫咪提示
记住这两档的**分界线**：**「外面世界不配合」→ 要表态；「本喵自己写错了」→ 编得过、当场炸。**

所以本喵写招式的时候，凡是「外面的东西可能不配合」的地方（读文件、找东西、把项链转成数字），都要么接住、要么在招式头上声明；而「下标越界」这类自己写错的，让它在跑的时候炸出来反而更省事 —— 那是抓虫的线索，不是要藏起来的东西喵。
:::

## 三、接住它：`try` / `catch`

要接住，用的是一对兄弟词 `try` 和 `catch`。

```java
public class Main {
    public static void main(String[] args) {
        try {
            System.out.println("开门");
            int x = 10 / 0;
            System.out.println("数出来 " + x);
        } catch (ArithmeticException e) {
            System.out.println("接住了：" + e.getMessage());
        } finally {
            System.out.println("关门");
        }
    }
}
```

```text
开门
接住了：/ by zero
关门
```

三块各管一段：

- **`try { … }`** 里放「可能出事的活」。出事的那一行往后就不跑了 —— 所以 `数出来 …` 那句**一个字都没印**。
- **`catch (出事的东西 e) { … }`** 里放「接住了怎么办」。括号里写清**本喵要接哪一只**（这里是 `ArithmeticException`），接住的那一只被接在了名字 `e` 上，`e.getMessage()` 就是它带来的口信。
- **`finally { … }`** 里放「不管出没出事都要干的事」—— 收摊子用。上面例子里不管有没有出事，`关门` 都会印。

这三块的先后不是「写完的顺序」，是**真跑出来的顺序**。本喵按真实走位一步一步走给你看：

```demo
title: 三块是怎么按顺序走下来的
code:
| try {
|     System.out.println("开门");
|     int x = 10 / 0;
|     System.out.println("数出来 " + x);
| } catch (ArithmeticException e) {
|     System.out.println("接住了：" + e.getMessage());
| } finally {
|     System.out.println("关门");
| }

step 先划一块「本喵盯着」的地盘
at: 1
say: `try {` 划出一块地盘：里面的活儿照常一行行往下跑，**出了事就在这块地盘上截住**，不让它直接飞到外面去。
meow: 地盘划好，盯着这儿喵～
pose: expect
屏幕上 = 还没印
现在走到哪 = 刚进 try
出事了吗 = 还没
x 有值了吗 = 还没有

step 出事之前那一行：印出「开门」
at: 2
say: `System.out.println("开门")` 跑到了 —— 因为它在出事之前。屏幕上的第一行就是它。
meow: 开门啦，这声印出来了～
pose: busy
屏幕上 = 开门
现在走到哪 = try 里，第 2 行跑完
出事了吗 = 还没
x 有值了吗 = 还没有

step 撞上除数是 0
at: 3
say: `10 / 0` 出事就在这一行：除数是 0，**算数当场喊一声**（`ArithmeticException`，口信是 `/ by zero`）。注意：喊出来的这一刻，这个值**还没交到 `x` 手上**。
meow: 除数是 0，算数当场喊了喵！
pose: think
屏幕上 = 开门
现在走到哪 = try 里，第 3 行出事
出事了吗 = 出事了：ArithmeticException（口信 / by zero）
x 有值了吗 = 还没有（值没交出来）

step 这一行往后就不跑了
at: 4
say: 出事那一行**往后全部作废**：第 4 行 `数出来 …` 一个字都没印。飞出来的那只猫**顺着喊它的这条路往外找**，去找接它的人。
meow: 第 4 行没轮到，猫飞出去啦！
pose: expect
屏幕上 = 开门
现在走到哪 = 从 try 里往外飞
出事了吗 = 出事了：ArithmeticException（口信 / by zero）
x 有值了吗 = 还没有（永远不会有）

step 门口牌子对上了：接住
at: 5
say: `catch (ArithmeticException e)` 是**门口的牌子**：本喵要接的正是「算数出岔子」这一只。飞出来的就是它，**当场接住**，接住的那只从此挂在名字 `e` 上。
meow: 牌子对上了，当场接住喵！
pose: yay
屏幕上 = 开门
现在走到哪 = catch 里，接住的那只叫 e
出事了吗 = 接住了（口信在 e 身上：/ by zero）
x 有值了吗 = 还没有

step 把接住那只的口信印出来
at: 6
say: `e.getMessage()` 把**接住那只带来的口信**叼出来印出去：`接住了：/ by zero`。这句话不是本喵另写的字，是出事那只自己带来的。
meow: 口信印出来啦，/ by zero～
pose: yay
屏幕上 = 开门、接住了：/ by zero
现在走到哪 = catch 里
出事了吗 = 接住了（口信在 e 身上：/ by zero）
x 有值了吗 = 还没有

step finally：这一块必定要走
at: 7
say: `finally {` 这一块**不管出没出事都要走一趟**：接住了要走，没人接也要走；连招式里提前 `return`，都得等它跑完才放行 —— 收摊子的活就该放这儿。
meow: 收摊子这块，跑不掉喵～
pose: milestone
屏幕上 = 开门、接住了：/ by zero
现在走到哪 = finally 里
出事了吗 = 已经接住了
x 有值了吗 = 还没有

step 印出「关门」
at: 8
say: `System.out.println("关门")` 印出来了。三段输出到这儿齐了：`开门` → `接住了：/ by zero` → `关门`，和上面跑出来的一模一样。
meow: 关门啦，三段齐活喵～
pose: busy
屏幕上 = 开门、接住了：/ by zero、关门
现在走到哪 = finally 里，最后一行跑完
出事了吗 = 已经接住了
x 有值了吗 = 还没有

step 三块走完，接着往下跑
at: 9
say: 最后那个 `}` 收掉整个这一段。出事已经被接住，**程序不会在这儿断气**，接着往下走 —— 这一条正是「接住」和「没接住」的差别。
meow: 接住了，程序还能往下走喵！
pose: proud
屏幕上 = 开门、接住了：/ by zero、关门
现在走到哪 = 三块走完，接着往下
出事了吗 = 已经接住了（程序没断气）
x 有值了吗 = 还没有（这一趟永远不会有）
```

三块的**时机**各不相同：`try` 里一行行按顺序跑、出事那一行往后的活儿全部作废；`catch` 只接住飞出来的那一只，接住之后程序照常往下走；`finally` 是收摊子的一格，**不管出没出事都跑得掉**。

`finally` 有个不小的本事：**连招式里提前 `return` 了，它也要跑完才走。** 本喵真跑过这一段：

```java
public class Main {
    static int peek() {
        try {
            return 1;
        } finally {
            System.out.println("finally 还是跑了");
        }
    }

    public static void main(String[] args) {
        System.out.println("结果 " + peek());
    }
}
```

```text
finally 还是跑了
结果 1
```

看顺序：`finally` 里那句**先**印出来，然后才轮到外面印「结果 1」。所以想把「用完的管子关掉」这类收尾放在 `finally` 里，是**靠得住**的喵。

::: warn 小心喵
接东西有个**先小后大**的规矩。本喵要是先写 `catch (Exception e)`、再写 `catch (ArithmeticException e)`，翻译官喵会翻脸：

```java
public class Main {
    public static void main(String[] args) {
        try {
            int x = 10 / 0;
            System.out.println(x);
        } catch (Exception e) {
            System.out.println("大的先接");
        } catch (ArithmeticException e) {
            System.out.println("小的后接");
        }
    }
}
```

```text
Main.java:8: error: exception ArithmeticException has already been caught
```

道理不绕：**能接住 `ArithmeticException` 的那只猫，本来就能接住它的所有小辈** —— 上面那只 `Exception` 已经把它一网打尽了，下面那只**永远轮不到**。所以顺序得反过来：**越具体的越写前面**喵。
:::

## 四、自己画一张专门报这种事的图纸

用现成的出事图纸有个毛病：**一把抓**。别人接住一只 `Exception`，压根不知道是本喵的仓库空了，还是文件读不到 —— 只能去翻口信。

办法是**自己画一张**。下面这段的上半截，就是新画出来的那张图纸；下半截是它的用法：

```java
class FishEmptyException extends Exception {
    FishEmptyException(String msg) {
        super(msg);
    }
}

public class Main {
    static void takeFish(int n) throws FishEmptyException {
        if (n <= 0) {
            throw new FishEmptyException("仓库空了喵");
        }
        System.out.println("拿到 " + n + " 条");
    }

    public static void main(String[] args) {
        try {
            takeFish(0);
        } catch (FishEmptyException e) {
            System.out.println("本喵接住了：" + e.getMessage());
        }
    }
}
```

```text
本喵接住了：仓库空了喵
```

新图纸那三行，每一行都有用：

- **`extends Exception`** —— 「认谁当师父」。这一句决定了本喵这张图纸归**哪一档**：认 `Exception` 当师父，新图纸就归「**要表态的**」那一档；要是认 `RuntimeException` 当师父，就归「编得过、当场炸」那一档。**师父是谁，这一档就跟着谁**喵。
- **`FishEmptyException(String msg)`** 是出生那一手，它接住别人递进来的那句口信。
- **`super(msg)`** 是把口信**往上交给师父**（上一课学过 `super` 这个词）。交给它之后，`e.getMessage()` 才叼得回那句话 —— 不交上去，那只猫就是一只**空口信**的猫，接住它的人什么也读不到。

再看下半截是**怎么用起来**的：`takeFish` 头上多了一句 `throws FishEmptyException`（本喵自己先声明「出了事本喵不在这儿处理」），`main` 里的 `catch` 只接本喵自家这一只。别人家的出事图纸飘到本喵这儿，**接不住，也不该接** —— 这正是「画一张专门报这种事的图纸」的用意：**名字一亮出来，接的人就知道出了什么事**。

## 五、使用原则：四条

1. **接得住才接，接不住就往上扔。** 招式头上那句 `throws`，是**本喵自己先声明**：「这招可能出事，出了事本喵不在这儿处理，谁喊本喵谁接着」。硬接一只本喵处理不了的猫，等于把麻烦藏在自己的屋子里。
2. **别吞。** 接住了、括号里什么都不写，程序会**照常往下走**，而且**翻译官喵一个字都不说**（本喵真跑过）。出事的那一格脚印从此断在这儿，等以后出问题的时候，本喵连「它是在哪儿丢的」都找不着。
3. **别拿它当跳转用。** 能用「看鱼干眼色行事」判出来的正常分支（该印哪句话、该走哪条路），就老老实实用分支 —— 出事的东西是留给**意外**的，不是用来抄近路的。
4. **图纸要画得有意义。** 一张专门代表「仓库空了」的图纸，比一只什么都代表的 `Exception` 值钱得多：**看到名字就知道出了什么事**，接住的人不用去猜口信。反过来，什么都能装的那种万能图纸，等于回到了「一把抓」。

## 六、小任务

1. 给上面那个「仓库空了」的图纸再加一格家当：比如「当时还剩几条」。想一想，存进去之后接住它的猫要怎么读出来？
2. 把取货招式改成「仓库不够 `n` 条也得喊一声」，看看同一张出事图纸能不能用在两种情形上。
3. 想一想：本喵把「仓库空了」那张图纸的师父从 `Exception` 换成 `RuntimeException`，`takeFish` 头上那句 `throws` 还留着会怎样？翻译官喵会拦吗？

下一课本喵要带你去碰**真正待在硬盘上的东西**了：怎么在代码里指着一个文件说话、怎么把一句话写进去、怎么把它读回来 —— 那里面有一类特别容易踩的坑，正好用得上这一课学的本事喵～ 🐾
