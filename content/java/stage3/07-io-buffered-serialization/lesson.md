---
id: java-stage3-07
lang: java
stage: 3
order: 11
title: IO 深入——缓冲流与对象序列化
tags: [IO, 缓冲, 序列化]
required: ["java-stage3-06"]
crossRefs: []
estMinutes: 26
keywords: [BufferedWriter, BufferedReader, readLine, Serializable, transient]
---

## 钩子：一条一条叼，腿都跑细了

本喵的鱼塘每天都要记一本账：谁来了、吃了几条。上一课本喵学会了把字**写进文件**、再**念回来** —— 可头一天记账，本喵就吃了个亏。

那天来了三十只猫。本喵老老实实地按老写法：写一行、跑一趟门口；再写一行、再跑一趟门口……记到第二十行，本喵的腿已经趴在地上不想动了喵。

大肥鱼在旁边看乐了，慢悠悠地说：**你不会攒一篮子再整趟搬吗？**

今天两件事：

1. **攒一篮子搬**（缓冲流）—— 写和念都快得多，代价是要记得**收工**；
2. **把一整只猫冻成字节存起来、再原样解冻回来（对象序列化）**—— 从前只能存字，现在整只猫都能存。

## 一、先把那条「管道」复习一句

写文件和念文件靠的都是**管道**：

```text
本喵 → 管子 → 文件
本喵 ← 管子 ← 文件
```

最小的写法是这样三句（上一章讲过，今天要用，先摆在这儿）：

```java
FileWriter 管 = new FileWriter("账本.txt");
管.write("小橘 3 条");
管.close();
```

- `new FileWriter("账本.txt")` —— 接一条通到那个文件的管子（文件不在就建一个）；
- `.write("...")` —— 往管子里塞字；
- `.close()` —— 收工，把管子拔掉。

念回来是另一条管子：`new FileReader("账本.txt")`，配上后面要讲的 `readLine()`。

## 二、套一只「大篮子」：缓冲流

问题就出在「一条一条叼」上：每写一次就真的往管子那头跑一趟。写一百行，就是跑一百趟。

**缓冲流**干的事只有一件：**在管子外面套一只大篮子**。字先扔进篮子；篮子满了（或者你收工时），才**整趟**搬一趟。跑腿次数从一百次变成一两次。

写法上，篮子就是把管子里里外外包一层：

```java
import java.io.BufferedWriter;
import java.io.FileWriter;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedWriter 笔 = new BufferedWriter(new FileWriter("账本.txt"));
        笔.write("小橘 3 条");
        笔.newLine();
        笔.write("狸花 5 条");
        笔.newLine();
        笔.close();

        System.out.println("两笔账记好了");
    }
}
```

```text
两笔账记好了
```

三层看这句 `new BufferedWriter(new FileWriter("账本.txt"))`：

| 写在里/外 | 是什么 |
|---|---|
| 里面的 `new FileWriter("账本.txt")` | 那条通到文件的**管子** |
| 外面的 `new BufferedWriter(...)` | 套在管子上的**大篮子** |
| 整句 | 「接一条管子，再给它套一只篮子」 |

篮子不能单独用 —— 一只孤零零的篮子不知道该往哪儿倒。

另外两个新动作：

- **`.newLine()`** —— 换一行。它比自己往字里塞换行符稳当：换行这码事，不同系统写出来的花样不完全一样，让管子自己处理最省心。
- **`.close()`** —— **先把篮子倒干净，再收工**。这一句今天最要紧，第四节专门讲它。

## 三、念回来：一行一行念

念的那一头也套一只篮子，而且它的用法有个很舒服的形状：

```java
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileReader;
import java.io.FileWriter;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedWriter 笔 = new BufferedWriter(new FileWriter("账本.txt"));
        笔.write("小橘 3 条");
        笔.newLine();
        笔.write("狸花 5 条");
        笔.newLine();
        笔.close();

        BufferedReader 眼 = new BufferedReader(new FileReader("账本.txt"));
        String 行;
        while ((行 = 眼.readLine()) != null) {
            System.out.println("念到：" + 行);
        }
        眼.close();
    }
}
```

```text
念到：小橘 3 条
念到：狸花 5 条
```

一句一句拆：

- **`new BufferedReader(new FileReader("账本.txt"))`** —— 接一条念字的管子，再套一只篮子。念的时候也是一次抓一把回来，比一个字一个字叼快得多。
- **`眼.readLine()`** —— **念一行**。整行给你（行尾那个换行它会替你去掉），念完这一行，眼睛**就往前挪一格**。
- **念到末尾给 `null`** —— `null` 在这里的意思是「**没有了**」，不是出错。
- **`while ((行 = 眼.readLine()) != null)`** —— 这个形状读作：「念一行、存进 `行`，只要不是没有，就跑这一圈」。写成一行、用一对括号包起来，是这门语言里的惯用写法，照着抄就行。
- ⚠️ **`readLine()` 每喊一次就吞掉一整行**。所以上面那个 `while` 里，一条件里只能喊**一次** —— 一节里再喊第二次，它会接着往后念**下一行**，一行一行地漏。

想给每行配个号，就是多立一只篮子数数：

```java
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileReader;
import java.io.FileWriter;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedWriter 笔 = new BufferedWriter(new FileWriter("名单.txt"));
        笔.write("小橘");
        笔.newLine();
        笔.write("狸花");
        笔.newLine();
        笔.write("大肥鱼");
        笔.newLine();
        笔.close();

        BufferedReader 眼 = new BufferedReader(new FileReader("名单.txt"));
        String 行;
        int 号 = 0;
        while ((行 = 眼.readLine()) != null) {
            号 = 号 + 1;
            System.out.println(号 + "：" + 行);
        }
        眼.close();

        System.out.println("一共 " + 号 + " 行");
    }
}
```

```text
1：小橘
2：狸花
3：大肥鱼
一共 3 行
```

数数的那只篮子 `号` 要立在**绕圈外面**：立在圈里的话，每转一圈就重新归零，最后永远报 1。

## 四、忘了收工，篮子里的东西就没了

这是今天最容易摔的一脚，而且**一个字都不会红**：

```java
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.FileReader;
import java.io.FileWriter;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedWriter 笔 = new BufferedWriter(new FileWriter("账本.txt"));
        笔.write("小橘 3 条");
        笔.newLine();

        BufferedReader 眼 = new BufferedReader(new FileReader("账本.txt"));
        String 行 = 眼.readLine();
        if (行 == null) {
            System.out.println("账本上一个字都没有");
        } else {
            System.out.println("念到：" + 行);
        }
        眼.close();
    }
}
```

```text
账本上一个字都没有
```

那些字明明写过了呀！—— 它们**还在篮子里**，本喵没喊收工，篮子没倒，文件里就是一个字都没有。

这一脚一步一步走给你看，看清楚字是在哪一刻停在篮子里的：

```demo
title: 字明明写过了，文件里为什么一个字都没有
code:
| import java.io.BufferedReader;
| import java.io.BufferedWriter;
| import java.io.FileReader;
| import java.io.FileWriter;
|
| public class Main {
|     public static void main(String[] args) throws Exception {
|         BufferedWriter 笔 = new BufferedWriter(new FileWriter("账本.txt"));
|         笔.write("小橘 3 条");
|         笔.newLine();
|
|         BufferedReader 眼 = new BufferedReader(new FileReader("账本.txt"));
|         String 行 = 眼.readLine();
|         if (行 == null) {
|             System.out.println("账本上一个字都没有");
|         } else {
|             System.out.println("念到：" + 行);
|         }
|         眼.close();
|     }
| }

step 起点：接一条管子，再套一只大篮子
at: 8
say: `new BufferedWriter(new FileWriter("账本.txt"))` 是**里外两层**：里面那条是**通到文件的管子**，外面那只是**套在管子上的大篮子**。从这一句起，本喵写下的字**先去篮子**，不是每写一笔就跑一趟门口。
meow: 管子接好，大篮子套上啦喵！
pose: expect
篮子里的字 = （还是空的）
文件里有什么 = （什么都还没有）
念回来的 = （还没去念）

step 头一笔：扔进篮子
at: 9
say: `笔.write("小橘 3 条")` 把这串字**扔进篮子**。看清楚这一刻：字已经写过了，可**文件里还是空的** —— 篮子没满，它不着急跑那一趟。
meow: 小橘这笔先放进篮子，不急喵
pose: busy
篮子里的字 = 小橘 3 条
文件里有什么 = （还是空的）
念回来的 = （还没去念）

step 换行也落进篮子
at: 10
say: `笔.newLine()` 让管子自己换一行（比自己往字里塞换行符稳当），这一下换行也**落在篮子里**。到这儿，篮子里攒着的是整整一行账。
meow: 换行也攒进篮子，一行齐了！
pose: busy
篮子里的字 = 小橘 3 条 + 一个换行
文件里有什么 = （还是空的）
念回来的 = （还没去念）

step 没喊收工，就另接一条念字的管子
at: 12
say: 本喵**没喊收工**，直接另接一条念字的管子去念**文件里真有的东西**。可文件此刻什么都还没有 —— 篮子里的字**一步都没往文件里走**。
meow: 换条管子去念，可文件还空着喵
pose: think
篮子里的字 = 小橘 3 条 + 一个换行（还在篮子里）
文件里有什么 = （一个字都没有）
念回来的 = （还没念）

step 喊一声念一行，结果是「没有了」
at: 13
say: `眼.readLine()` 一喊就念一行。文件里一个字都没有，念到末尾它给的是 `null` —— 这里的 `null` 意思是「**没有了**」，**不是出错**，程序一点毛病都没有。
meow: 喊一声念一行，结果是「没有了」喵
pose: soothe
篮子里的字 = 小橘 3 条 + 一个换行（还在篮子里）
文件里有什么 = （一个字都没有）
念回来的 = null（就是「没有了」）

step 所以拐进了「空」那一岔
at: 14
say: `if (行 == null)` 这一问答的是「真」，程序就拐进上面那一岔。它不是坏了、更不是报错 —— 它**老老实实照着「文件里没字」这个事实**走了一遍。
meow: 一问果然空，拐进「空」那一边喵
pose: think
篮子里的字 = 小橘 3 条 + 一个换行（还在篮子里）
文件里有什么 = （一个字都没有）
念回来的 = null（就是「没有了」）

step 印出来的那句话，就是这一脚的现场
at: 15
say: 印出来是 `账本上一个字都没有` —— 正是那位「明明写过了呀」。**写过的字一个字都没丢，全在篮子里**；只是本喵**没喊收工，篮子没倒**，所以文件里就是一个字都没有。
meow: 字都在篮子里，文件里空空如也喵
pose: soothe
篮子里的字 = 小橘 3 条 + 一个换行（还在篮子里）
文件里有什么 = （一个字都没有）
念回来的 = null（就是「没有了」）

step 补上收工那一句，篮子才倒干净
at: 10
say: 在 `笔.newLine();` 后面补一句 `笔.close();` —— 它干的是「**先把篮子倒干净，再收工**」。喊过收工，这一笔就一定躺在文件里，念回来才有的念。
meow: 补一句 close，篮子就倒干净啦！
pose: remind
篮子里的字 = （倒出去了）
文件里有什么 = 小橘 3 条 + 一个换行
念回来的 = 小橘 3 条

step 这一脚不红不响，只能靠习惯挡
at: 15
say: 这一脚最要命的地方是**它一个字都不会红**：管子开了、程序跑完了、文件也在，只是里面空的。所以往后记住这个习惯 —— **写了就收工**；只想先倒一趟、还要接着写，就喊 `flush()`。
meow: 不红不响，只能靠「写了就收工」喵！
pose: remind
篮子里的字 = （倒出去了）
文件里有什么 = 小橘 3 条 + 一个换行
念回来的 = 小橘 3 条
```

所以要记住这两件事：

- **`.close()` = 先倒干净、再收工**。收工之前它一定会把篮子倒空，所以喊了 `close()` 就一定不会丢。
- 只想**先倒一趟、但还要接着写**，就喊 **`.flush()`**（冲一次）。`flush` 是「把篮子里的现在就倒出去」，倒完篮子还在手上，可以接着写。

::: warn 小心喵

- **写完不 `close()`，字就留在篮子里**。程序跑完了，文件是空的，还一个字都不红 —— 只能靠「写了就收工」这个习惯挡。
- **`readLine()` 一喊就吞掉一行**。`while (眼.readLine() != null)` 里再套一句 `眼.readLine()`，念出来的就会隔一行漏一行，末尾还会多印一个 `null`。
- **`while ((行 = 眼.readLine()) != null)` 里那对括号不能省**。少了它，`行 = ...` 那一截会被当成「行 是不是不等于 null」来读，不是「先把念到的存进 行、再问它是不是没有」。
- **数数的篮子别立在圈里**，立在里面每圈归零，最后永远报 1。

:::

## 五、把一整只猫冻成字节

前面搬来搬去的都是**字**。可本喵真正想存下来的，是**一整只猫**：它的名字、它今天吃了几条。

从今天起这件事有办法了：**把整只猫冻成一串字节存进文件，要用的时候再解冻回来** —— 这就是**序列化**。

冻和解冻要两台家什：一台往外冻（`ObjectOutputStream`）、一台往回解（`ObjectInputStream`）。而那只猫自己得先**挂一块牌子**，写上「本喵可以冻」：

```java
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.Serializable;

class Fish implements Serializable {
    String 名字;
    int 条数;
    transient String 备注 = "本喵的私房话";

    Fish(String 名字, int 条数) {
        this.名字 = 名字;
        this.条数 = 条数;
    }
}

public class Main {
    public static void main(String[] args) throws Exception {
        Fish 原猫 = new Fish("小橘", 3);

        ObjectOutputStream 出口 = new ObjectOutputStream(new FileOutputStream("猫.bin"));
        出口.writeObject(原猫);
        出口.close();

        ObjectInputStream 入口 = new ObjectInputStream(new FileInputStream("猫.bin"));
        Fish 回来的猫 = (Fish) 入口.readObject();
        入口.close();

        System.out.println("名字：" + 回来的猫.名字);
        System.out.println("条数：" + 回来的猫.条数);
        System.out.println("备注：" + 回来的猫.备注);
    }
}
```

```text
名字：小橘
条数：3
备注：null
```

一行一行看：

- **`class Fish implements Serializable`** —— 在图纸后面挂一块牌子：「这只猫可以冻」。**少了这块牌子，冻的时候会当场拦你**（下一节就演给你看）。
- **`出口.writeObject(原猫)`** —— 把整只猫冻成一串字节写出去。文件名叫 `猫.bin`，`.bin` 是「一堆字节」的常见叫法 —— 那里面不是能直接读的字，是一串二进制。
- **`(Fish) 入口.readObject()`** —— 解冻回来。解冻那一手叼回来的东西，Java 只知道它是「一样东西」，**不知道它原来是哪种猫**，所以本喵得自己交代一句：前面那个 `(Fish)` 就是「按 `Fish` 这只猫收下」。这句不能省。
- **第三行印出 `备注：null`** —— 因为 `备注` 那一格挂了 `transient` 牌子，见下节。

## 六、`transient`：有些话不带出门

`备注` 那一格，本喵在图纸里写的是 `transient String 备注 = "本喵的私房话";`，可是解冻回来印出来是 `null`。

**`transient` 的意思就四个字：这格不冻。** 冻的时候跳过它，解冻回来那格就是空的。

为什么要有这么一个词？因为有些东西**本来就冻不了**（管子、文件、别的猫……），硬要冻就会摔；还有些东西是**不想带走**的（临时的悄悄话、能重新算出来的中间结果）。

⚠️ 还有一处要留神：解冻回来的那只猫，**图纸上那句「= 本喵的私房话」不会重跑**。解冻走的是另一条路 —— 它不喊构造方法、也不执行字段后面那半句初始值，直接把冻存的那几格填回去。所以那格是 `null`，不是那句默认话。

## 七、忘了挂牌子，冻的那一刻当场拦你

把上面那块 `implements Serializable` 牌子摘掉，再冻一次 —— 编译的时候它一声不响（这话本喵真跑过），**跑起来的那一刻**才当场翻脸：

```java
import java.io.FileOutputStream;
import java.io.ObjectOutputStream;

class Fish {
    String 名字;

    Fish(String 名字) {
        this.名字 = 名字;
    }
}

public class Main {
    public static void main(String[] args) throws Exception {
        Fish 原猫 = new Fish("小橘");
        ObjectOutputStream 出口 = new ObjectOutputStream(new FileOutputStream("猫.bin"));
        出口.writeObject(原猫);
        出口.close();
        System.out.println("存好了");
    }
}
```

```text
Exception in thread "main" java.io.NotSerializableException: Fish
```

最后那行原话读作：**`Fish` 这只猫没有挂「可以冻」的牌子**，所以这台往外冻的家什不干。

两个要留心的地方：

- 这行字里的 **`Fish` 是图纸的名字** —— 换个名字，这行字就跟着换。本喵特意把这次真跑的原话抄下来，你屏幕上的应该长得一样。
- 这个错是**跑起来**才出的：`javac` 只管语法，不会因为「这只猫没挂牌子」拦你。

::: tip 猫咪提示

今天记住六件事：

1. **篮子 = 缓冲流**：`new BufferedWriter(new FileWriter("..."))`、`new BufferedReader(new FileReader("..."))` —— 套一层，少的是一趟一趟的跑腿；
2. **写完一定要 `close()`** —— 它会先把篮子倒干净再收工；只想倒一趟就接着写，喊 `flush()`；
3. **念一行用 `readLine()`**，念到末尾给 `null`；**每喊一次就吞一行**；
4. **整只猫能存**：图纸挂 `implements Serializable`，用 `writeObject` 冻、`readObject` 解；
5. **解冻回来要自己交代一句**：`(Fish) 入口.readObject()`；
6. **`transient` = 这格不冻**，解冻回来是 `null`（那句初始值也不会重跑）。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `new BufferedWriter(new FileWriter("账本.txt"))` | 写字的管子外面套一只大篮子 |
| `笔.write("小橘 3 条")` | 往篮子里塞一串字 |
| `笔.newLine()` | 换一行 |
| `笔.flush()` | 把篮子里的先倒出去（不收工，还能接着写） |
| `笔.close()` | 倒干净 + 收工 |
| `new BufferedReader(new FileReader("账本.txt"))` | 念字的管子外面套一只大篮子 |
| `眼.readLine()` | 念一行；念到末尾给 `null` |
| `class Fish implements Serializable` | 给图纸挂「可以冻」的牌子 |
| `出口.writeObject(原猫)` | 把整只猫冻成字节写出去 |
| `(Fish) 入口.readObject()` | 解冻回来，自己交代它原来是哪种猫 |
| `transient String 备注;` | 这一格不跟着冻，解冻回来是 `null` |

## 小任务

1. 把第二节那个「两笔账」的例子跑一遍，然后**故意删掉** `笔.close();`，再跑一次，看看念回来还剩几行 —— 亲手撞一次「篮子没倒」，比读十遍解释都记得牢。
2. 把第三节的名单换成你认识的三只猫，再加上一行 `笔.write("大肥鱼")`，看看 `一共几行` 变成多少。
3. 把 `readLine()` 那个 `while` 里的 `行` 偷偷改成 `眼.readLine()`（就是那个「一喊吞一行」的错法），先猜结果再跑，验证本喵说的「隔一行漏一行」。
4. 给 `Fish` 再加一格 `int 饭量 = 99;`，**不要**加 `transient`，跑一遍看看解冻回来是几；再给它戴上 `transient` 跑一遍 —— 两次对一下。
5. 把 `Fish` 的名字改一个字（比如 `Cat`），再跑一次那个「没挂牌子」的程序，看看报错原话里哪个词跟着变了。

下一课，本喵要给鱼塘换上**更宽、更快的管道**：一次搬的不是一只篮子，而是一整只木桶；还要认识几件现成的家什 —— 开文件、读一整份、写一整份，喊一声就办完了，连管子都不用自己接喵～ 🐾
