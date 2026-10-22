---
id: java-stage3-11
lang: java
stage: 3
order: 15
title: 线程池与并发工具
tags: [多线程, 并发, 池子]
required: ["java-stage3-10"]
crossRefs: []
estMinutes: 26
keywords: [ExecutorService, submit, Future, ThreadPoolExecutor, shutdown]
---

## 钩子：每家活都现招一只猫，工钱全花在招收上了

本喵的鱼塘最近接了个大单：三百筐小鱼干，筐筐都要过秤、记账、贴标签。

本喵一开始的干法是：有活就**现招一只猫**，招来干完，当场辞退。头一天就发现不对劲——招猫本身要花功夫（安排窝、交代规矩、登记名字），真正干活的时间反倒没多少。三百件活招了三百次猫，本喵累得趴在鱼干上睡着了喵。

隔壁大肥鱼听说了，甩着尾巴给本喵出了个主意：**别现招了，雇一队猫常驻在院子里等着。** 有活就派一只出去，干完回来接着待命；活儿多的时候临时多雇两只，闲着太久就辞掉两只。这样招猫的功夫只花一次。

这个「雇一队猫待在院子里」的家伙事，正式名字叫线程池（本喵叫它**猫力池**）——一池子随时能派出去的猫。今天本喵就把这套家什拆开看清楚：

1. 怎么**雇一队猫**、怎么**派活**、怎么**收工打烊**；
2. 派出去的活怎么**把战利品叼回来**（`Future` 这张领货凭条）；
3. 池子上的**三个旋钮**分别管什么；
4. 为什么院子里**永远只有你雇的那几只猫**。

## 一、雇一队猫、派活、打烊

```java
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class Main {
    public static void main(String[] args) throws Exception {
        ExecutorService 池子 = Executors.newFixedThreadPool(2);

        Future<Integer> 凭条1 = 池子.submit(() -> 6 * 7);
        Future<Integer> 凭条2 = 池子.submit(() -> 10 + 5);

        System.out.println("第一件：" + 凭条1.get());
        System.out.println("第二件：" + 凭条2.get());

        池子.shutdown();
        System.out.println("打烊了吗？" + 池子.isShutdown());
    }
}
```

```text
第一件：42
第二件：15
打烊了吗？true
```

三句关键的话，一句一句看：

- **`Executors.newFixedThreadPool(2)`** —— 「雇一队**固定 2 只**的猫，常驻院子」。括号里那个数就是这队猫的**编制**。这句一执行，池子就建好了，猫在院子里等着（还没派活）。
- **`池子.submit(...)`** —— 派一件活出去。括号里那个东西是「**这件活怎么干**」：`() -> 6 * 7` 就是一张只有一招的纸条——不用投喂任何小鱼干，闷头算 `6 * 7`，算完把结果交上来。派完**立刻**返回一张**领货凭条**（`Future`），本喵先接住它。
- **`池子.shutdown()`** —— 打烊。**注意它不是「立刻下班」**：它说的是「从今往后不再接新活了，手上正在干的干完就散」。想立刻喊停是另一个招式，今天先记住有打烊这回事。

还有一件小事先说清楚：`submit` 派活是**不等**的。派完两件活，本喵手上只有两张凭条，活是那两只猫在院子里干——**谁先干完、谁后干完，本喵一概不知道，也不该去猜**。

## 二、领货凭条：`Future`

那本喵想拿结果怎么办？**凭条去取。**

```java
Future<Integer> 凭条1 = 池子.submit(() -> 6 * 7);
System.out.println("第一件：" + 凭条1.get());
```

- **`submit` 给你的是凭条，不是结果。** 凭条上写着「这件活派出去了，干完可以拿它来取货」。
- **`凭条.get()` 才是取货。** 取货的时候，如果那只猫**还没干完**，`get()` 就**站在那儿等**——不是报错、不是返回个空，而是老老实实等到干完为止。
- 所以 `凭条1.get()` 拿到的一定是 `42`。**不管那两只猫谁先干完、谁抢到了哪件活**，凭条 1 永远对应第一件活——这就是为什么上面那两行输出**顺序是定死的**。

::: tip 猫咪提示
**「同时干活」和「输出顺序」是两件事。** 一堆猫同时干活，它们干完的先后是**随机**的；可只要本喵**按派活的顺序**去挨个取货（`凭条1.get()` → `凭条2.get()`），输出就一定是定死的顺序 —— 先取的那张凭条，哪怕它最后才干完，本喵也等着它。

**想让程序输出确定，就用「按提交顺序逐个取货」这一个法子。** 反过来，如果让活自己往屏幕上印东西，谁先印就是运气了 —— 同一份代码跑两遍，输出可能不一样。这不是代码坏了，是它本来就这样，所以本喵宁可让猫**把结果叼回来**，屏幕上只由本喵一个人说话喵。
:::

## 三、池子上的三个旋钮

`Executors.newFixedThreadPool(2)` 是个简写。它背后那个真正的家伙事叫 `ThreadPoolExecutor`，身上有三个旋钮：

```java
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public class Main {
    public static void main(String[] args) {
        ThreadPoolExecutor 池子 = new ThreadPoolExecutor(
                2, 4, 30L, TimeUnit.SECONDS,
                new LinkedBlockingQueue<>());

        System.out.println("常驻：" + 池子.getCorePoolSize() + " 只");
        System.out.println("上限：" + 池子.getMaximumPoolSize() + " 只");
        System.out.println("排队区还能塞：" + 池子.getQueue().remainingCapacity());

        池子.shutdown();
    }
}
```

```text
常驻：2 只
上限：4 只
排队区还能塞：2147483647
```

四个投喂进去的东西，一格一格认：

| 投喂的东西 | 写的是 | 管什么 |
|---|---|---|
| 常驻数 | `2` | 院子里**常年养着**几只猫。哪怕一件活都没有，这 2 只也不辞退 |
| 上限数 | `4` | 最多的时候能有多少只。活多到常驻的猫忙不过来，就临时**多雇**到 4 只 |
| 空闲时长 | `30L, TimeUnit.SECONDS` | 临时多雇的那几只，**闲够 30 秒**就辞掉，缩回常驻编制 |
| 排队区 | `new LinkedBlockingQueue<>()` | 派出去的活**先在这儿排队**，等着被猫领走 |

这里有个**零基础最容易被绊倒的地方**，本喵要单独拎出来说：**活多了不是先多雇猫，而是先往排队区塞。** 只有排队区**塞满了**，池子才动手临时多雇猫。上面那个排队区的容量是 `2147483647`（二十多亿）——等于**永远塞不满**，所以这一池子**永远只会有 2 只猫在干活**，上限那个 `4` 一辈子也用不上。

换言之：**`newFixedThreadPool(2)` 就是「常驻 2 只、上限也是 2 只、排队区无限长」的那份简写**。想让上限真的起作用，得自己拿 `ThreadPoolExecutor` 建，并且给一个**有边界的**排队区。

::: warn 小心喵
**三个数的关系是有规矩的**：上限**不能**比常驻小，两边都不能是负数。写反了（比如常驻写 4、上限写 2），池子**当场就不干了**——它不是默默给你调过来，是直接甩你一个错误，程序从那儿断掉。本喵第一次写的时候就写反了，红字看半天才明白过来喵。

另一件更容易漏的：**打烊（`shutdown()`）不能忘**。池子里的猫是「常驻」的，它们在院子里等着派活；本喵不喊打烊，程序就一直这么等着，**不报错、也不退出**——看起来像卡住了。规矩很简单：**手上一件活都不派了，就喊一声打烊。**

（这一条本喵真跑过两次，两次的结果**不一样**，值得记一笔：**一件活都没派**就忘打烊，程序照样体面退出 —— 因为猫是**派第一件活的时候才去雇**的，院子里压根没猫；**派过活了**再忘掉，本喵掐着 5 秒的闹钟等它，5 秒里一个字都没吐，它就一直挂在那儿。所以这话的准确说法是：**派过活的池子，不打烊就不走。**）
:::

## 四、院子里到底有几只猫

「固定 2 只」这件事，本喵想看个究竟。每只猫都有一个**工号**，喊一声 `Thread.currentThread().getName()` 就能问出来：

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class Main {
    public static void main(String[] args) throws Exception {
        ExecutorService 池子 = Executors.newFixedThreadPool(2);

        List<Future<String>> 凭条们 = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            凭条们.add(池子.submit(() -> Thread.currentThread().getName()));
        }

        List<String> 工号们 = new ArrayList<>();
        for (Future<String> 凭条 : 凭条们) {
            String 工号 = 凭条.get();
            if (!工号们.contains(工号)) {
                工号们.add(工号);
            }
        }
        Collections.sort(工号们);

        System.out.println("干活的猫一共 " + 工号们.size() + " 只");
        for (String 工号 : 工号们) {
            System.out.println(工号);
        }

        池子.shutdown();
    }
}
```

```text
干活的猫一共 2 只
pool-1-thread-1
pool-1-thread-2
```

派了 6 件活出去，**院子里始终只有 2 只猫**在轮着干。上面这段代码故意把工号**排了序**再印 —— 因为「哪件活被哪只猫领走」是**不定**的，直接印出来每跑一遍都可能不一样；排完序，输出就定死了。

一条池子里的猫，工号长这样：`pool-1-thread-2`。念法是「**第 1 号池子里的第 2 只猫**」。换个池子，中间那个数字就变；同一池子里每只猫尾号都不同。

这一池子到底有几只猫在干活、`submit` 和 `get()` 各自是什么脾气，本喵拆成一步一步走给你看：

```demo
title: 六件活，院子里始终只有两只猫在轮着接
code:
| ExecutorService 池子 = Executors.newFixedThreadPool(2);
|
| List<Future<String>> 凭条们 = new ArrayList<>();
| for (int i = 0; i < 6; i++) {
|     凭条们.add(池子.submit(() -> Thread.currentThread().getName()));
| }
|
| List<String> 工号们 = new ArrayList<>();
| for (Future<String> 凭条 : 凭条们) {
|     String 工号 = 凭条.get();
|     if (!工号们.contains(工号)) {
|         工号们.add(工号);
|     }
| }
| Collections.sort(工号们);
|
| System.out.println("干活的猫一共 " + 工号们.size() + " 只");
| for (String 工号 : 工号们) {
|     System.out.println(工号);
| }
|
| 池子.shutdown();

step 先雇一队猫：编制定 2 只
at: 1
say: `Executors.newFixedThreadPool(2)` 读作「雇一队**固定 2 只**的猫，常驻院子」。**这一句只是把编制定下来，猫还没真去雇** —— 第三节里那句话说得很清楚：猫是**派第一件活的时候**才去雇的。
meow: 编制定 2 只，猫还没上班喵～
pose: expect
凭条们 = （柜子还没备）
工号们 = （柜子还没备）
池子里的猫 = 编制 2 只 —— 还没真去雇

step 备一个柜子装凭条
at: 3
say: `List<Future<String>> 凭条们 = new ArrayList<>();` —— 派活拿回来的**领货凭条**都先塞在这儿，一件活一张。
meow: 备好柜子，等着装凭条！
pose: expect
凭条们 = （空柜子，一张还没派）
工号们 = （柜子还没备）
池子里的猫 = 编制 2 只 —— 还没真去雇

step 派第一件活：凭条马上到手
at: 5
say: `池子.submit(...)` 派一件活。**`submit` 是不等的** —— 活刚递出去，本喵手上就多了一张凭条，活本身还等着猫来领。括号里那张纸条写的是「这件活怎么干」：问一句干活那只猫的工号。
meow: 派出去，凭条马上到手喵！
pose: busy
凭条们 = 1 张（第 1 件活的）
工号们 = （柜子还没备）
池子里的猫 = 2 只（派第 1 件活的时候才去雇）

step 同一句跑六遍：六张凭条
at: 5
say: 这一句同一个样子在 `for` 里跑了 **6 遍**，柜子里攒下 6 张凭条。**哪件活被哪只猫领走、谁先干完，本喵一概不知道，也不该去猜** —— 所以下面取货取回来的工号是谁的，也说不准。
meow: 6 件活都派出去了，6 张凭条！
pose: busy
凭条们 = 6 张（六件活都派出去了）
工号们 = （柜子还没备）
池子里的猫 = 2 只，6 件活轮着接

step 再备一个柜子装工号
at: 8
say: `List<String> 工号们 = new ArrayList<>();` —— 待会儿把猫的工号一个一个收进来，看看这一池子到底有几只猫在干。
meow: 再备一个柜子装工号～
pose: expect
凭条们 = 6 张
工号们 = （空柜子）
池子里的猫 = 2 只，6 件活轮着接

step 取第一张凭条的货
at: 10
say: 挨张取货：`凭条.get()`。**取货的时候那只猫要是还没干完，这一句就站在那儿等** —— 不是报错、也不是返回个空。取回来的工号跑不出 `pool-1-thread-1` 和 `pool-1-thread-2`，谁抢到这件活就是谁。
meow: 取货！工号跑不出那两只猫喵～
pose: busy
凭条们 = 还剩 5 张没取
工号们 = （空柜子）
池子里的猫 = 2 只，6 件活轮着接

step 收进柜子：重复的工号只记一笔
at: 12
say: 收进柜子之前，`if (!工号们.contains(工号))` 先问一句「这个工号柜子里有没有」。**6 件活分给 2 只猫，至少有一只接了不止一件**，所以取到后面工号一定会重复，这道门就是拿来挡重复的。
meow: 同一只猫接了好几件活喵！
pose: think
凭条们 = 还剩 5 张没取
工号们 = 收进来 1 个工号
池子里的猫 = 2 只，6 件活轮着接

step 六张走完：柜子里只有两个工号
at: 9
say: 六张凭条挨个走完，工号柜子里始终只装得下**两个** —— 派了 6 件活，院子里从头到尾就是这 2 只在轮着接。
meow: 六件活，就两只猫轮着接！
pose: yay
凭条们 = 都取完了
工号们 = 就两个工号（pool-1-thread-1、pool-1-thread-2）
池子里的猫 = 2 只，6 件活轮着接

step 排排坐：把输出定死
at: 15
say: `Collections.sort(工号们);` —— 「哪件活被哪只猫领走」是**不定**的，直接印每跑一遍都可能不一样；排完序，输出就定死了。**定住输出靠的是排序，不是靠猫听话。**
meow: 排排坐，输出就定死啦！
pose: expect
凭条们 = 都取完了
工号们 = 两个工号（排好序）
池子里的猫 = 2 只，6 件活轮着接

step 印出来：一共两只
at: 17
say: 印出来是 `干活的猫一共 2 只`，再一行一个印那两个工号 —— 这就是「院子里只有 2 只猫」的证据。想让上限那个 `4` 真起作用，得自己拿 `ThreadPoolExecutor` 建、再给一个有边界的排队区。
meow: 6 件活，始终只有 2 只猫在干！
pose: proud
凭条们 = 都取完了
工号们 = 两个工号（排好序）
池子里的猫 = 2 只（一个不多）

step 打烊
at: 22
say: 最后一句 `池子.shutdown();` 是**打烊**，不是「立刻下班」：说的是「从今往后不再接新活，手上正在干的干完就散」。这句忘了写，派过活的池子就一直等着派活 —— **不报错、也不退出**，看着像卡住。
meow: 打烊啦，猫们收工回家喵～
pose: proud
凭条们 = 都取完了
工号们 = 两个工号（排好序）
池子里的猫 = 打烊了，不再接新活
```

**「同时干活」和「输出顺序」是两件事**：哪件活被哪只猫领走是不定的（所以印之前先排排坐），可「院子里始终只有你雇的那 2 只」是定死的。

## 五、池子里的活出了事，会怎么样

这是本喵最想让你记住的一段。上面那些活都是一算就完的小事，**可活也会出事**——比如本喵递进去的那件活自己踩了坑：

```java
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class Main {
    public static void main(String[] args) throws Exception {
        ExecutorService 池子 = Executors.newFixedThreadPool(1);

        Future<Integer> 凭条 = 池子.submit(() -> {
            int[] 一排碗 = new int[3];
            return 一排碗[5];
        });

        System.out.println("拿到的数：" + 凭条.get());
        池子.shutdown();
    }
}
```

```text
Exception in thread "main" java.util.concurrent.ExecutionException: java.lang.ArrayIndexOutOfBoundsException: Index 5 out of bounds for length 3
```

本喵只派了 3 只碗（下标 0、1、2），却伸手去抓第 5 只——翻译官喵不拦（它看不出运行时碗架上只有 3 只），于是**那只猫在院子里踩了坑**。这时候出事的地方**不是那只猫**，是**等货的本喵**：`凭条.get()` 这一句炸了。

红字里那一长串念法是：**「取的货出事了」**（`ExecutionException`），而后面跟着的才是**真正的病根**——**「下标 5 越界了，碗架长度是 3」**。

这就是取货这个动作的脾气，本喵总结成一句：

> **猫在院子里踩的坑，`get()` 会原封不动地把它摔回给你。** 正因为如此，`get()` 这一句必须放在**能接住坏事**的地方——本喵在上面的 `main` 后面写了 `throws Exception`，就是先把这句话揽下来。

也正因为如此，前面每一段代码的 `main` 后面都跟着 `throws Exception`：只要手上有凭条、要 `get()`，就得预备着接这一下喵。\n\n（本喵再叮嘱一句：这段跑完红字之后，**它不会自己停下来** —— `池子.shutdown()` 那一句排在出事那行后面，永远轮不到它；池子里那只猫还在院子里等着派活。这正是第三节那句「**派过活的池子，不打烊就不走**」。想在命令行里把它停下，按 `Ctrl+C` 就行喵。）

## 六、一句话小抄

| 想干的事 | 写什么 |
|---|---|
| 雇一队固定编制的猫 | `Executors.newFixedThreadPool(2)` |
| 自己拧三个旋钮 | `new ThreadPoolExecutor(常驻, 上限, 空闲时长, 单位, 排队区)` |
| 派一件活出去 | `池子.submit(...)` → 拿到**领货凭条** |
| 取货（没干完就等） | `凭条.get()` |
| 打烊（干完手上的就散） | `池子.shutdown()` |
| 问打烊了没有 | `池子.isShutdown()` |

## 小任务

今天的小任务，本喵留两个：

1. 把上面第一段代码里的 `newFixedThreadPool(2)` 改成 `(1)`，再跑一遍——看看输出是不是**一个字都没变**。想清楚：**为什么「只有一只猫」也不影响输出的顺序？**（想通了你就摸到「按提交顺序取货」这条规矩的脾气了。）
2. 自己写一段：雇 3 只猫，派 4 件活，每件活把投喂进去的数**翻倍**，然后**按派活的顺序**把四个结果取回来印成四行。数你自己挑——只要记住「屏幕上只由你一个人说话，猫只管把结果叼回来」这一条喵。

下一课本喵要带你玩一样更玄的东西：**趁程序跑着，把一张图纸的里里外外看个通透** —— 它有几个小仓、几个招式、叫什么名字，连private锁着的都能撬开看。这样东西叫照 X 光的猫喵～ 🐾
