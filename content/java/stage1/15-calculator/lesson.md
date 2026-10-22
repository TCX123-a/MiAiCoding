---
id: java-stage1-15
lang: java
stage: 1
order: 19
title: 综合项目：控制台计算器
tags: [综合项目, 方法, 异常处理]
required: ["java-stage1-14"]
crossRefs: []
estMinutes: 30
keywords: [Scanner, while, break, try, catch]
---

## 钩子：大肥鱼的小摊缺一台计算器

大肥鱼在鱼塘边摆了个小摊，卖小鱼干。一只猫来买，它掰着鱼鳍还数得过来；十只猫一起来，它的鱼脑子当场冒烟 🐟。

「本喵给你写一台计算器吧，」本喵拍拍它的脑袋，「而且是**能用一整天**的那种——算完一单，接着算下一单。」

大肥鱼甩着尾巴问：「你不是才教到绕圈和招式吗？凑得出来？」

凑得出来。前面十八课，零件一件一件都摆在台面上了。今天这一课**不教新零件**，只干一件事：**把它们装成一台真的能用的计算器**。这是本阶段的最后一课，也是你第一次做「项目」。

装法分三步走：

1. **第一步：把四则运算各拆成一招** —— 每一招只干一件事；
2. **第二步：让它反复问** —— 算完一单接着算下一单，直到客人说收工；
3. **第三步：摔了怎么办** —— 遇上分不了的账，别让整台机器当场断气。

跟着本喵一步一步来。

## 第一步：把活拆成招式

先把最里层的零件造出来。一台计算器要会四样：加、减、乘、平均分。

最后一样本喵得解释一句：**「平均分」就是两个数相除**——比如「7 条小鱼干平均分给 2 只猫，每只分到几条」。鱼塘里天天算这个，所以本喵给这一招起名叫 `share`（分一分的意思）喵。

```java
public class Calculator {
    public static int add(int a, int b) {
        return a + b;
    }

    public static int sub(int a, int b) {
        return a - b;
    }

    public static int mul(int a, int b) {
        return a * b;
    }

    public static int share(int a, int b) {
        return a / b;
    }

    public static void main(String[] args) {
        System.out.println(add(3, 5));
        System.out.println(sub(3, 5));
        System.out.println(mul(3, 5));
        System.out.println(share(7, 2));
    }
}
```

```text
8
-2
15
3
```

四招长得一模一样，都是「打头写清楚要喂几样料、叼回什么料，身子里算一句就叼回来」。`main` 里就是四句命令，一行喊一招，屏幕上落下来四行。

有个地方要盯一眼：**最后一行 `share(7, 2)` 叼回来的是 `3`，不是 `3.5`。** 本喵这台机器算的是**整条**小鱼干——7 条分给 2 只猫，每只拿 3 条，剩的那 1 条不分了。想让零头留下来，得让算式里至少有一边带上小数点（`7 / 2.0` 就得 `3.5`）——那是运算符那一课讲过的老规矩，本喵这台机器先只装整份的喵。

那为什么非要拆成四招，不在一堆里顺着写？本喵要是把四样算法全塞进 `main`，过两天想改「平均分」的算盘，就得在一堆句子里翻找。拆开之后，**谁叫什么名字、干什么活，一眼就看完了**：改平均分就去动 `share`，碰不到 `add` 一根毫毛。

::: tip 猫咪提示
一段活儿该不该拆成一招？本喵的土办法是问自己两句：

1. **它会不会被用第二遍？** 会用第二遍的（加法、平均分天天用），现在不拆，往后也得拆。
2. **能不能用一句话说清它干什么？** 能（「把两个数加起来」），它就配有自己的名字；说不清，说明这段活儿还在乱着，先理顺再拆。

拆到「一招一件事」为止，别拆成碎渣喵。
:::

## 第二步：让它反复问——菜单绕圈

现在它会算了，可它只会算**一单**：跑一次、印四行、拍拍屁股走人。大肥鱼要的是「算完一单接着算下一单」。

菜单就是这个意思：**先问客人要哪一样，读完他报的，算完再问一遍。**「再问一遍」这件事，正是绕圈最拿手的活儿：

```java
import java.util.Scanner;

public class Calculator {
    public static int add(int a, int b) {
        return a + b;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner("1 3 5\n0");
        while (true) {
            System.out.println("1 加法 0 收工");
            int choice = sc.nextInt();
            if (choice == 0) {
                System.out.println("收工啦喵～");
                break;
            }
            int a = sc.nextInt();
            int b = sc.nextInt();
            System.out.println("结果是 " + add(a, b));
        }
    }
}
```

```text
1 加法 0 收工
结果是 8
1 加法 0 收工
收工啦喵～
```

本喵一处一处指给你看。

**先说那根纸条。** 那句 `new Scanner("1 3 5\n0")` 就是递纸条：练习台里没有键盘，本喵还是用投喂与叼回那一课的老办法——纸条上排的是这位客人要说的话。先是选项（`1` 是加法，`0` 是收工），再是两个数（`3`、`5`），最后他报了一句 `0`，意思是「不用了，收工」。你在自己电脑上跑的时候，把纸条换成 `new Scanner(System.in)`，它就改听你的键盘了喵。

**再说圈里的四步。**

1. **先印菜单**——每一单都印一次，客人一抬头就看得见有哪些选项；
2. **读选项**（`int choice = sc.nextInt();`）——把客人报的数装进 `choice` 这块牌子；
3. **看眼色**（`if (choice == 0)`）——报的是 `0`，说明客人要走：印一句告别，紧接着 **`break;`**，整个圈子当场收工；
4. **不然就是普通一单**——再读两个数（`a` 和 `b`），算完印出来；圈子转回第 1 步，接着问下一位。

**最后说 `while (true)`。** 讲绕圈那一课时说过：眼色的答案变假，圈子才收工。这里本喵干脆写了个**永远答真**的眼色——也就是说，**光靠它自己，这个圈一辈子停不下来**。敢这么写，唯一的理由是圈里有一句**真的会被走到**的 `break`（就是第 3 步那一句）。这也是为什么「收工」这一项必须摆在菜单里：**它不只是给客人看的，它是这台机器的关机键**喵。

::: warn 小心喵
写完菜单绕圈，本喵一定回头检查一件事：**那句 `break` 真的走得到吗？**

- 要是把它写到 `if` 的花括号**外面**，第一单算完就收工了——菜单再也不问第二句；
- 要是眼色写反了（比如写成 `choice != 0`），第一位客人一报选项，圈子就收工了。

这两种都**一个错都不报**，程序安安静静地少干了活——比翻脸难查多了喵。
:::

## 第三步：遇上分不了的账

到这里，机器已经很能干了。可它身上还藏着一个致命毛病：**只要有一单算不了，整台机器就断气给你看。**

本喵把「7 条鱼干平均分给 0 只猫」这张纸条塞进去：

```java
public class Calculator {
    public static int share(int a, int b) {
        return a / b;
    }

    public static void main(String[] args) {
        System.out.println(share(7, 2));
        System.out.println(share(7, 0));
    }
}
```

```text
3
Exception in thread "main" java.lang.ArithmeticException: / by zero
	at Calculator.share(Calculator.java:3)
	at Calculator.main(Calculator.java:8)
```

第一行还算得好好的（7 条分给 2 只猫，每只 3 条），第二行**当场翻脸**：一只猫都没有，这账根本分不了。这一摞字本喵一行一行念给你听：

- **`Exception in thread "main"`** —— 「**`main` 这条主干道上出岔子了**」。一出岔子，后面排着的句子**一句都不跑了**。
- **`java.lang.ArithmeticException: / by zero`** —— 这是这个岔子的**大名**和**一句话说明**：算术上的「除以零」。
- **`at Calculator.share(Calculator.java:3)`** —— 「出事的地儿在这儿」：`Calculator` 里的 `share` 这一招，第 3 行正是那句 `return a / b;`。
- **`at Calculator.main(Calculator.java:8)`** —— 再往下一层：是 `main` 第 8 行把它叫起来的。这一摞缩进去的行像不像脚印？**越往下越靠近你自己写的那一行。**

岔子本身不可怕，可怕的是**没人接住它**——规矩是：出了岔子没人接，程序当场断气。所以本喵给它配个兜子：

```java
public class Calculator {
    public static int share(int a, int b) {
        return a / b;
    }

    public static void main(String[] args) {
        try {
            System.out.println(share(7, 0));
        } catch (ArithmeticException e) {
            System.out.println("没有猫来分，这条算不了喵");
        }
        System.out.println("计算器还活着喵");
    }
}
```

```text
没有猫来分，这条算不了喵
计算器还活着喵
```

两个新词，形状先记住：

```text
try {
    ...会闹脾气的活儿...
} catch (哪一种闹脾气 e) {
    ...万一真闹了，本喵怎么办...
}
```

- **`try`** —— 「本喵先试一下」。会闹脾气的活儿放它的大括号里；
- **`catch (ArithmeticException e)`** —— 「万一闹了，本喵接住」。小括号里两样东西：**前一样是「接哪一种」**（这里写 `ArithmeticException`，就是刚才那个「除以零」的大名），**后一样是给接住的那份情报起的名字**（`e`，随你起）；
- 接住之后，程序**没有断气**，接着往下跑——所以屏幕上最后才多出一句「计算器还活着喵」。

本喵拿写着 `三 五` 的纸条试过一回：`sc.nextInt()` 读到一串字而不是数字，照样会甩出一摞红字来（大名是 `java.util.InputMismatchException`）。接它的办法一模一样，只是 `catch` 小括号里换成它的大名喵。

::: tip 猫咪提示
接住岔子的口诀就一句：**会闹的活儿放 `try`，接它的大名写进 `catch` 的小括号里。**

本课只接了「除以零」这一种，够用了——**先把最常摔的那一跤接住**，比一开始就想接住全世界省心得多喵。
:::

## 组装：完整的一台计算器

零件齐了。现在把三步拼起来——**四招运算 ＋ 菜单绕圈 ＋ 接住除以零**，这就是大肥鱼要的那台机器：

```java
import java.util.Scanner;

public class Calculator {
    public static int add(int a, int b) {
        return a + b;
    }

    public static int sub(int a, int b) {
        return a - b;
    }

    public static int mul(int a, int b) {
        return a * b;
    }

    public static int share(int a, int b) {
        return a / b;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner("1 3 5\n4 7 0\n9 1 1\n4 7 2\n0");
        while (true) {
            System.out.println("1 加法 2 减法 3 乘法 4 平均分 0 收工");
            int choice = sc.nextInt();
            if (choice == 0) {
                System.out.println("收工啦喵～");
                break;
            }
            int a = sc.nextInt();
            int b = sc.nextInt();
            try {
                if (choice == 1) {
                    System.out.println("结果是 " + add(a, b));
                } else if (choice == 2) {
                    System.out.println("结果是 " + sub(a, b));
                } else if (choice == 3) {
                    System.out.println("结果是 " + mul(a, b));
                } else if (choice == 4) {
                    System.out.println("结果是 " + share(a, b));
                } else {
                    System.out.println("本喵还不认识这个数喵");
                }
            } catch (ArithmeticException e) {
                System.out.println("没有猫来分，这条算不了喵");
            }
        }
    }
}
```

```text
1 加法 2 减法 3 乘法 4 平均分 0 收工
结果是 8
1 加法 2 减法 3 乘法 4 平均分 0 收工
没有猫来分，这条算不了喵
1 加法 2 减法 3 乘法 4 平均分 0 收工
本喵还不认识这个数喵
1 加法 2 减法 3 乘法 4 平均分 0 收工
结果是 3
1 加法 2 减法 3 乘法 4 平均分 0 收工
收工啦喵～
```

从上往下读一遍，正好就是本课的三步：

1. **最上面那四招**——第一步拆出来的零件，一招一个算法；
2. **`main` 里的绕圈**——印菜单、读选项、报 `0` 就走人，这是第二步的菜单；
3. **`try` / `catch`**——第三步的兜子。

纸条上是五位客人的五单，跟屏幕上的五行对得上：

| 客人报的 | 走的路 |
|---|---|
| `1 3 5` | 加法，3 ＋ 5 得 `8` |
| `4 7 0` | 平均分，可一只猫都没有——被 `catch` 接住 |
| `9 1 1` | 菜单上没有 `9`，落到最后那条「不认识」的岔路上 |
| `4 7 2` | 平均分，7 条分给 2 只猫，每只 `3` 条 |
| `0` | 收工，`break` 关掉圈子 |

第 3 点里有个细节要盯：**`try` 是写在圈子里的**，不是写在圈子外面的。所以「7 条分给 0 只猫」那一单被接住之后，**圈子还在转**，下一位客人接着来——你看屏幕上，接住那句话之后菜单又印了一遍，后面还接着算了「7 条分给 2 只猫」那一单。要是把 `try` 挪到圈子外面去，第一单出了岔子，圈子就跟着一起没了喵。

### 图纸名要和文件名对上

这一课的图纸本喵起名叫 `Calculator`，所以**文件也得叫 `Calculator.java`**——这条规矩在招式那一课立过。本喵在命令行上撞过一次：文件留在 `Main.java`、图纸却写着 `public class Calculator`，翻译官当场就说了——

> `Main.java:1: error: class Calculator is public, should be declared in a file named Calculator.java`

念起来是：**「这张图纸叫 `Calculator`，那它就得住在一个叫 `Calculator.java` 的文件里。」** 想给图纸换名字，就把文件也一起改，两边对得上才作数。（练习场里翻译官会替你按图纸名把文件摆好，所以平时不太撞得到；命令行上是铁规矩，记着总没错喵。）

### 本课零件小抄

| 零件 | 干什么用的 |
|---|---|
| `public static int add(int a, int b)` | 一招只算一件事：喂两样料，叼回一个结果 |
| `new Scanner("...")` | 递一根写好的纸条——练习台里没有键盘 |
| `while (true)` | 停不下来的圈，出口全靠 `break` |
| `break;` | 收工：整个圈子当场停下 |
| `try { ... }` | 把「会闹脾气的活儿」圈起来 |
| `catch (ArithmeticException e) { ... }` | 接住那一种岔子；接住之后程序接着往下跑 |

::: tip 猫咪提示
整课就记一句话：**「招式拆开 → 菜单绕圈 → 岔子接住。」**

这是你第一台真正能用的小机器，它和往后你写的大程序**结构上是一回事**：先把活拆成招式，再用一个圈把「一直问」串起来，最后想清楚「哪一步可能出岔子、出了怎么办」喵。
:::

## 小任务

1. **多给一招**：`%` 这个记号在运算符那一课见过，它管的是「除完剩多少零头」——写一招 `public static int rest(int a, int b) { return a % b; }`，喊一声 `rest(7, 2)` 看看叼回来几，再把它挂进菜单（多印一行 `5 取余`，多一条 `else if (choice == 5)`）。
2. **让它真的摔一次**：把 `try` 那几句**挪到圈子外面**，再跑「7 条分给 0 只猫」那一单——接住之后，下一位客人的账还问不问得出来？
3. **自己当客人**：把纸条换成 `new Scanner(System.in)`，在你自己的电脑上敲着玩。试着报一个菜单上没有的数字（比如 `9`），看看机器怎么回你。
4. **给告别加一句**：把收工那句改成「今天一共算了几单」——提示：在圈子外面摆一块数数的牌子，每算完一单就加一，收工的时候一起印出来。

改完记得跑一遍。大肥鱼的小摊从今天起就账目清楚了——**这是你本阶段的毕业作品**，本喵给你记一功 🐾✨
