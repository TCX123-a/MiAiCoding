---
id: java-stage3-19
lang: java
stage: 3
order: 22
title: 网络编程——隔着鱼塘传小鱼干
tags: ["网络编程","Socket"]
required: ["java-stage3-18"]
crossRefs: ["java-stage3-15","java-stage3-09"]
estMinutes: 30
keywords: [socket, tcp, accept, flush, utf-8]
---

第 19 课那间聊天室，本喵是**照着摆**出来的：门怎么开、管子怎么接，照着摆对了就跑得起来。可摆归摆，有几件事本喵一直没敢细想 —— 站在门口那一行到底在等什么？说出去的话为什么有时**对面一个字都没收到**？两头明明写的一样，屏幕上为什么是一串怪字？

这一课就把门和管子**拆开**看喵。拆完你会发现：隔着鱼塘传小鱼干这一整套，底下还是那几样旧家什 —— 一支管子、一行一行说话、说完收工。

## 钩子：本喵今天要拆的五件事

第 19 课的门和管子是**现成摆好**的。今天本喵把它们拆开，五件事一件一件认：

1. **门开在哪儿、门牌号是什么。** 隔着一片鱼塘，凭什么能找到本喵这扇门？
2. **`门.accept()` 是「站在门口等」。** 等不到人的时候它干嘛？等到了又交回什么？
3. **一次来回长什么样。** 客人送一句、门房回一句，中间要几支管子、几支笔。
4. **两处最容易静默出事的地方。** 一是话**攒在手里没送出去**（程序不报错、对面就是收不到），二是两头的**字表不一样**（屏幕上变成一串怪字）。
5. **怎么收尾。** 该关的要关、该等的要等 —— 顺序摆错了，客人敲到的就不是门，是一句 `Connection refused`。

这五件事全是**真跑**验证过的：下面每一段程序都跑在本机上，`127.0.0.1` 回环，自己起自己连，跑完就关。别人窝里的机器一台都没碰过喵。

## 一、门开在哪儿：一个回环地址 + 一个门牌号

隔着鱼塘说话，得先有两样东西：**这扇门开在哪儿**，和**门牌号是多少**。这两样在 Java 里的名字是地址和端口 —— 一个地址上可以有很多扇门，门牌号就是用来分开它们的。

```java
import java.net.InetAddress;
import java.net.ServerSocket;

public class Main {
    public static void main(String[] args) throws Exception {
        ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        int 端口 = 门.getLocalPort();
        System.out.println("127.0.0.1 是本机自己吗：" + InetAddress.getByName("127.0.0.1").isLoopbackAddress());
        System.out.println("系统挑的门牌号落在 1 ~ 65535 里吗：" + (端口 >= 1 && 端口 <= 65535));
        门.close();
    }
}
```

```text
127.0.0.1 是本机自己吗：true
系统挑的门牌号落在 1 ~ 65535 里吗：true
```

- **`127.0.0.1` 是「本喵自己这台机器」。** 这种「绕回来找自己」的地址有个专门的说法，叫回环地址 —— 送到这儿的鱼干**根本不出门**，从本机的这一头绕回本机的另一头。所以本喵这门课从头到尾只敢开这种门：开给本机，跑完就关。
- **门牌号写 `0` = 让系统挑一个空号。** 挑完的那个号，用 `门.getLocalPort()` 问回来。要是写死一个号（比如 8888），碰巧被别人占着，本喵这份稿子就未必跑得动了 —— 第 19 课踩过这个坑。
- **`new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))` 里的三个投喂**：门牌号（`0` = 随便挑）、门口最多排多长的队（50 位）、认哪张网（本机这张）。第三个投喂是关键 —— 它决定了这扇门只认本机，**不认鱼塘外面的任何一只猫**。

::: warn 小心喵

本喵这门**只开给本机**。把第三个投喂换成「哪张网都认」的那种写法，或者换成本机对外那张网卡上的地址，就等于**把门开到鱼塘外面去了** —— 那种门要另说防火、另说看门、另说收工，不是这一课的事。这份稿子里的每一段都只开 `127.0.0.1`，而且每一段都**跑完就关**，不留一扇开着的门。

:::

## 二、`accept()` 的脾气：等不到人，它就堵在那儿

门开了，可门自己不会招呼客人 —— 得有一只猫站到门口去等。等的这一行就是 `门.accept()`。它最要紧的脾气，本喵真跑了一遍才敢下笔：

```java
import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

public class Main {
    static volatile boolean 有人来了 = false;

    public static void main(String[] args) throws Exception {
        ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        int 端口 = 门.getLocalPort();

        Thread 守门的 = new Thread(() -> {
            try {
                Socket 客 = 门.accept();
                有人来了 = true;
                客.close();
            } catch (IOException e) {
            }
        });
        守门的.setDaemon(true);
        守门的.start();

        Thread.sleep(300);
        System.out.println("敲门之前，有人来了吗：" + 有人来了);

        Socket 自己 = new Socket("127.0.0.1", 端口);
        守门的.join();
        System.out.println("敲完门之后，有人来了吗：" + 有人来了);
        自己.close();
        门.close();
    }
}
```

```text
敲门之前，有人来了吗：false
敲完门之后，有人来了吗：true
```

这两行就是「**堵在那儿**」现场：母猫先等 300 毫秒、去看那个记号，是 `false` —— 因为**根本还没人敲门**。等母猫照着门牌号连上去（`new Socket("127.0.0.1", 端口)` 那一下），门口那只猫才从 `accept()` 上醒过来、把记号改成 `true`。

- **`accept()` 是「站住，等」**：没人来，它就**卡在那一行不动**，一行都不往下走。这种「卡在等」的脾气，行话叫阻塞 —— 堵住，不是坏了。
- **它等来的是「一位客人」，交回来的是一支管子**（`Socket 客`）。往后跟这位客人说话，全走这支管子。
- **堵在门口的只有那一只猫。** 母猫该等的等、该敲门的敲门，一点没被拖住 —— 因为「站门口」这活是**另派了一只猫**去干的。这也正是第 19 课说的「门房的本分是开门，不是陪聊」：门房自己陪着客人说话，第二位就得在门口干等。
- **还有一处也会堵住，位置在「听」那一头。** 第 19 课那个坑：甲进了门一直不说话，守着甲的猫就卡在 `读.readLine()` 上 —— 读一句也要堵着等人说。所以本喵给读的地方留了个话头：读不到东西时它会交回一个「空」（`null`），下一节本喵就拿它当判据。

## 三、一次来回：两条管子，一进一出

先把整条线**看一遍**：本喵把一扇门、一位客人、一次来回按先后摆开来 —— 点在每一步上，右边那几格会跟着变。

```demo
title: 隔着鱼塘传一条小鱼干
code:
| ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
| int 端口 = 门.getLocalPort();
| Thread 守门的 = new Thread(() -> {
|     Socket 客 = 门.accept();
|     写手(客).println("收到：" + 读者(客).readLine());
| });
| 守门的.setDaemon(true);
| 守门的.start();
| Socket 自己 = new Socket("127.0.0.1", 端口);
| 写手(自己).println("小鱼干");
| System.out.println("客人听到：" + 读者(自己).readLine());

step 一、开门
at: 1
say: `new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))` 就是开一扇门：门牌号写 `0`（随便挑个空号）、门口最多排 50 位、只认本机这张网。
meow: 在鱼塘边开一扇门喵！
pose: welcome
门开没开 = 开了（只认本机）

step 二、问回门牌号
at: 2
say: 系统挑完的空号得问回来 —— 隔壁窝的猫就是照着这个号找上门的。
meow: 号到手：系统挑的空号
pose: guide
门开没开 = 开了（只认本机）
门牌号 = 系统挑的空号

step 三、派一只猫去门口蹲着
at: 3
say: 「站在门口等」这件活得另派一只猫去干，所以先把要交代给它的事包成一只猫。
meow: 派一只猫去门口蹲喵～
pose: expect
门牌号 = 系统挑的空号
对面来没来 = 还没来

step 四、它堵在 accept() 上
at: 4
say: 这只猫走到 `门.accept()` 就停住了：没人敲门，它就卡在这一行不动 —— 这就叫堵在那儿。
meow: 门房：蹲住，不挪窝喵！
pose: busy
对面来没来 = 还没来（门房堵着呢）

step 五、设成后台的猫、放出去
at: 8
say: `守门的.setDaemon(true)` 是「母猫一收工你也跟着走」；再 `start()` 把它放出去。
meow: 门房上岗，母猫接着干喵
pose: proud
门房 = 后台的猫（已上岗）
对面来没来 = 还没来

step 六、客人划过来了
at: 9
say: 母猫照着门牌号连上来，就是「划过来」那一下 —— 门房当场从 `accept()` 上醒过来，把 `客` 这支管子交回手里。
meow: 有人敲门！管子接上了喵
pose: yay
对面来没来 = 来了（管子到手）

step 七、鱼干送过去、回话叼回来
at: 10
say: 写手 `println` 把「小鱼干」送过去；对面的读者收下、回一句「收到：小鱼干」，再用 `readLine()` 叼回来。
meow: 鱼干送到，回话叼回来啦！
pose: milestone
门房收到 = 收到：小鱼干

step 八、管子收尾
at: 11
say: 客人这一头说完就 `close()`；门房那头也把自己的管子关掉 —— 一扇门、两支管子，都收得干干净净。
meow: 管子关好，利索收工喵～
pose: soothe
管子 = 关好了
```

客人来了、管子到手了，接着就是**一次来回**：客人送一句过去的，门房回一句回来的。完整的一段长这样：

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class Main {
    public static void main(String[] args) throws Exception {
        ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        int 端口 = 门.getLocalPort();

        Thread 守门的 = new Thread(() -> {
            try {
                Socket 客 = 门.accept();
                写手(客).println("收到：" + 读者(客).readLine());
                客.close();
            } catch (IOException e) {
            }
        });
        守门的.setDaemon(true);
        守门的.start();

        Socket 自己 = new Socket("127.0.0.1", 端口);
        写手(自己).println("小鱼干");
        System.out.println("客人听到：" + 读者(自己).readLine());
        自己.close();
        守门的.join();
        门.close();
    }

    static PrintWriter 写手(Socket 客) throws IOException {
        return new PrintWriter(new OutputStreamWriter(客.getOutputStream(), StandardCharsets.UTF_8), true);
    }

    static BufferedReader 读者(Socket 客) throws IOException {
        return new BufferedReader(new InputStreamReader(客.getInputStream(), StandardCharsets.UTF_8));
    }
}
```

```text
客人听到：收到：小鱼干
```

对着这一段，把「一次来回」数一遍：

1. **母猫那头发**：`写手(自己).println("小鱼干")` —— 往自己这支管子里送出一行。
2. **门房这头收**：`读者(客).readLine()` —— 从对面那支管子里听回一行，听到的是 `小鱼干`。
3. **门房那头回**：`写手(客).println("收到：" + 小鱼干)` —— 顺着同一支管子送回一行。
4. **母猫这头收**：`读者(自己).readLine()` —— 收下 `收到：小鱼干`，前面接上「客人听到：」印出来。

一支管子**两头各有一个口**：门口这头看进去是「往外说的话」（`getOutputStream()`），另一头看进去是「往里听的话」（`getInputStream()`）。一进一出，各要一支笔：

- **写手**（`PrintWriter`）是往管子外说的笔。它外面裹了一层 `OutputStreamWriter`，那是**翻译官喵**的位置 —— 本喵说的话先按 `UTF-8` 翻成一串字节，再送进管子。
- **读者**（`BufferedReader`）是往里听的笔，裹的是 `InputStreamReader`，把管子里进来的字节按 `UTF-8` 翻回话。
- **两头都用 `println` / `readLine`，一行一行说。** 这一点第 19 课已经说死：一边 `println`、另一边 `readLine`，配着来；换成 `print`（不带行尾）配 `readLine`，对面就会一直等一个永远不来的行尾。
- **`守门的.join()` 是等门口那只猫收工。** 门房那只猫的活还没干完（它可能正卡在 `accept()` 上），母猫 Print 完就走的话，程序可能在门房开口之前就散场。

## 四、两处最容易静默出事的地方

这一节是本课的**正菜**：这两处出事的时候**程序一声不响、也不报错**，只是对面什么都没收到、或者屏幕上一串怪字。学员照着敲一遍，最容易在这两处卡住，而卡住的时候**没有任何提示**告诉他是哪一句出了问题。

### 4.1 话攒在手里，管子一关就跟着没了

先看这一段。写手造出来的时候，**末尾那个 `true` 漏了**：

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class Main {
    static String 门房收到 = "(还没说话)";

    public static void main(String[] args) throws Exception {
        ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        int 端口 = 门.getLocalPort();

        Thread 守门的 = new Thread(() -> {
            try {
                Socket 客 = 门.accept();
                String 一句 = 读者(客).readLine();
                门房收到 = 一句 == null ? "(空的 —— 什么都没收到)" : 一句;
                客.close();
            } catch (IOException e) {
            }
        });
        守门的.setDaemon(true);
        守门的.start();

        Socket 自己 = new Socket("127.0.0.1", 端口);
        PrintWriter 自己写 = new PrintWriter(new OutputStreamWriter(自己.getOutputStream(), StandardCharsets.UTF_8));
        自己写.println("小鱼干");
        自己.close();
        守门的.join();
        System.out.println("门房收到：" + 门房收到);
        门.close();
    }

    static BufferedReader 读者(Socket 客) throws IOException {
        return new BufferedReader(new InputStreamReader(客.getInputStream(), StandardCharsets.UTF_8));
    }
}
```

```text
门房收到：(空的 —— 什么都没收到)
```

母猫那一头**印出了这一行**、门房那一头**读到的是个空**。跑通了、不报错、不红字，可鱼干就是没送到 —— 这就是本课最阴的一处。

- **写手是个「攒字」的笔。** 它手里有个桶：`println("小鱼干")` 只是把字**倒进桶里**，攒着。攒满一整桶、或者本喵明确说一句「赶紧送」，才真的送进管子。
- **末尾那个 `true` 就是「每说一行就赶紧送出去」。** `new PrintWriter(..., true)` 里最后那一格，写 `true` 就是「别攒了，一行一送」。漏掉它，字就一直在桶里躺着。
- **`自己.close()` 关的是管子，不是那个桶。** 桶是写手这支笔自己的东西，管子一关，桶里攒的字**跟着一起没了**（不是报错，也不是补送 —— 是本喵亲手丢的）。所以这一段的教训很短：**要么造写手时写 `true`，要么在关管子之前自己喊一声「送」**（`自己写.flush();`）。
- **`readLine()` 的「空」不是坏消息。** 门房这头读到 `null`，意思是「对面把管子那头挂了，一句话都没说」—— 所以本喵拿它当判据，印出「什么都没收到」。要是这一句收到的是 `小鱼干`，说明话真送到了。

### 4.2 字表不一样，屏幕上就是一串怪字

第二处：**两头没对好字表**。本喵让门房这头按 `UTF-8` 写出去，客人那头偏偏按另一种字表（`GBK`）读回来：

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

public class Main {
    public static void main(String[] args) throws Exception {
        ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        int 端口 = 门.getLocalPort();

        Thread 守门的 = new Thread(() -> {
            try {
                Socket 客 = 门.accept();
                写手(客).println("收到：小鱼干");
                客.close();
            } catch (IOException e) {
            }
        });
        守门的.setDaemon(true);
        守门的.start();

        Socket 自己 = new Socket("127.0.0.1", 端口);
        BufferedReader 自己读 = new BufferedReader(new InputStreamReader(自己.getInputStream(), Charset.forName("GBK")));
        System.out.println("客人听到：" + 自己读.readLine());
        自己.close();
        守门的.join();
        门.close();
    }

    static PrintWriter 写手(Socket 客) throws IOException {
        return new PrintWriter(new OutputStreamWriter(客.getOutputStream(), StandardCharsets.UTF_8), true);
    }
}
```

```text
客人听到：鏀跺埌锛氬皬楸煎共
```

`收到：小鱼干` 这五个字，到了客人那头成了 `鏀跺埌锛氬皬楸煎共`。**字一个没丢、一个没错**，只是被按另一张字表读了出来：

- **管子里走的从来不是「字」，是一串字节。** 本喵说的话要先按一张字表翻成字节（编码），对面收到字节再按一张字表翻回话（解码）。
- **两张字表必须是同一张。** 本喵这头用 `UTF-8` 翻出去，对面拿 `GBK` 翻回来 —— 同一串字节按另一张表读，读出来的当然是别的字。这就是屏幕上那串怪字的来历，不是管子坏了。
- **所以本喵在两头都写死 `StandardCharsets.UTF_8`**：写手那边写死、读者那边也写死。写死的意思不是「这台机器碰巧用哪张就用哪张」，而是「**本喵说好就用这张**」。
- **本机实测的一处细节，值得知道**：这台机器上的 Java 是 21 版，它俩的默认字表已经全是 `UTF-8` 了（本喵实测过 `Charset.defaultCharset()`）；可**控制台往外印字**用的还是另一张（`System.out.charset()` 是 `GBK`）。也就是说：不写死字表，在这台机器上**今天碰巧没事**，换一台、换一版就可能当场乱码。**写死才是能带走的那份稿子。**

::: tip 猫咪提示

两头都要写死字表：**写手那头一次、读者那头一次，一共两处**。只写了一处，另一处就会按「这台机器碰巧的字表」来 —— 而那是会变的。

:::

## 五、收尾的先后：该关的要关，顺序摆错就敲不到门

管子用完要关（`close()`），这一条第 19 课说过一半：**关了之后就不能再读**。这里补上另一半 —— **关的时机**。

下面这段，母猫**以为「该关的要早点关」**，拿到门牌号就把门关了：

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class Main {
    public static void main(String[] args) throws Exception {
        ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        int 端口 = 门.getLocalPort();
        门.close();

        Socket 自己 = new Socket("127.0.0.1", 端口);
        BufferedReader 自己读 = new BufferedReader(new InputStreamReader(自己.getInputStream(), StandardCharsets.UTF_8));
        System.out.println("客人听到：" + 自己读.readLine());
        自己.close();
    }
}
```

```text
Exception in thread "main" java.net.ConnectException: Connection refused: connect
```

`Connection refused` 的原话是「**没人接**」：门牌号还认得出来，可那个号底下**已经没有门了** —— 门被关掉了。

- **门是「这一扇」的门，关了就是真没了。** 门牌号本身还会被记着，本喵照着号敲门，敲到的是空气。
- **现实里更常见的情形是反过来的**：门那头还**没开**（母猫还没跑到 `new ServerSocket(...)` 那一句），这头就急着敲门 —— 敲到的也是同一句话。所以「谁先谁后」这件事在隔着鱼塘说话里是硬规矩：**开门的先站稳，敲门的后动手**；两头都在同一段程序里的时候，就是「把门开好、把门牌号问回来，再去连」。
- **这也顺带说明了为什么收尾要摆好次序**：该等的等（`守门的.join()`）、该送完的送完、**最后**才关（`门.close()`）。关早了，后面的客人敲到的就是这句 `Connection refused`。
- **门一定要关。** 一扇门占着一个门牌号，程序跑完还开着，那个号就下不来。本喵每一段都收在 `门.close()` 上，跑完不留一扇开着的门。

## 六、隔着鱼塘说「你好」：HTTP 就是这么几句话

拆到这儿，最后一样东西该露脸了：**本喵天天听的 HTTP**。它不在鱼塘的对岸，它就在**同一支管子**上。

规矩很简单：客人先送出一段**写死的格式**（第一行说「我要什么」，后面几张纸条说「我是谁」），门房照着回一段同样的格式（第一行说「成不成」，纸条里说「正文有几个字节」）。本喵把这两头真跑一遍：

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public class Main {
    public static void main(String[] args) throws Exception {
        ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        int 端口 = 门.getLocalPort();

        Thread 守门的 = new Thread(() -> {
            try {
                Socket 客 = 门.accept();
                BufferedReader 读 = new BufferedReader(new InputStreamReader(客.getInputStream(), StandardCharsets.UTF_8));
                PrintWriter 写 = new PrintWriter(new OutputStreamWriter(客.getOutputStream(), StandardCharsets.UTF_8), true);
                String 请求行 = 读.readLine();
                byte[] 鱼干 = "有鱼干".getBytes(StandardCharsets.UTF_8);
                写.print("HTTP/1.1 200 OK\r\n");
                写.print("Content-Length: " + 鱼干.length + "\r\n");
                写.print("\r\n");
                写.print("有鱼干");
                写.flush();
                客.close();
            } catch (IOException e) {
            }
        });
        守门的.setDaemon(true);
        守门的.start();

        Socket 自己 = new Socket("127.0.0.1", 端口);
        PrintWriter 自己写 = new PrintWriter(new OutputStreamWriter(自己.getOutputStream(), StandardCharsets.UTF_8), true);
        BufferedReader 自己读 = new BufferedReader(new InputStreamReader(自己.getInputStream(), StandardCharsets.UTF_8));

        自己写.print("GET /fish HTTP/1.1\r\n");
        自己写.print("Host: 127.0.0.1\r\n");
        自己写.print("\r\n");
        自己写.flush();

        System.out.println("门房回的第一行：" + 自己读.readLine());
        System.out.println("门房给的纸条：" + 自己读.readLine());
        System.out.println("纸条和鱼干之间的那一行是空的吗：" + 自己读.readLine().isEmpty());
        System.out.println("鱼干：" + 自己读.readLine());

        自己.close();
        守门的.join();
        门.close();
    }
}
```

```text
门房回的第一行：HTTP/1.1 200 OK
门房给的纸条：Content-Length: 9
纸条和鱼干之间的那一行是空的吗：true
鱼干：有鱼干
```

四行读完，一个「请求」长什么样就全在眼前了：

- **客人送出去的那三行，就是浏览器天天送的东西**：第一行 `GET /fish HTTP/1.1`（要什么、按哪版规矩），接着 `Host: 127.0.0.1`（我是找谁），最后**一个空行**（话说完了）。
- **门房回的第一行是「成不成」**：`HTTP/1.1 200 OK`。`200` 就是「有」，`OK` 是给人看的注解。
- **纸条（`Content-Length: 9`）是给对面数数的**：正文「有鱼干」按 `UTF-8` 是 9 个字节 —— 三个字，一个字 3 个字节。**前面这条规矩是必须的**：管子上没有「一行就是一条消息」这种便宜可占，对面得先知道**正文有几个字节**，才知道读到哪儿算读完（本喵这头是故意 `print` 出去的，一行一送的话，空行和正文会被当成两行话）。
- **最后那一个空行是「纸条完了，正文开始」**。所以读的时候才要「先读完纸条、跳过空行、再读正文」—— 那三行 `readLine()` 的顺序，就是这个格式的形状。
- **HTTP 底下什么都没有。** 它就是**在这支管子上按约定说话**：一行一行、纸条加正文、拿字节数当尺子。本喵这一课拆到底，拆出来的就是这个 —— 你天天听的那句「网上的东西」，底下是一支管子、两张对好的字表、和几句写死格式的话。

## 小任务

1. 把第三节那段「一次来回」改成**两次来回**：客人先送 `开门`、收一句回话，再送 `要鱼干`、再收一句 —— 该印出四行。想想门房那只要不要多回一句。
2. 把第四节那段（4.1）里漏掉的 `true` 补回去，跑一遍看门房收到什么。再把 `true` 换成一个 `自己写.flush();`（造写手时不写 `true`）—— 结果一样吗？想想这跟「攒字」那件事是什么关系。
3. 把第六节那段 HTTP 里的 `Content-Length` 故意改错（比如写成 `3`），想想客人会怎么表现：它照着字节数读，读到的是半句话还是整句话？再把那一句 `写.flush();` 删掉试试 —— 这回会当场报错，还是**两头都等对方、根本收不了工**？

## 尾声

这一课拆完了，回头看那份清单：

- **门开在本机（`127.0.0.1`）**，门牌号写 `0` 让系统挑空号，问回来再用。
- **`accept()` 是站住等**：没人来就堵在那一行不动；等来一位，交回一支管子。读那一头的 `readLine()` 也会堵着等人说话。
- **一次来回 = 两条管子（一进一出）+ 两支笔（写手按行写、读者按行读）**，两头都得写死 `UTF-8`。
- **两处静默的坑**：话攒在写手手里、管子一关就跟着没了（要 `true` 或 `flush()`）；两张字表不一样，屏幕上就是一串怪字。
- **收尾按次序**：该等的等、该送完的送完、最后关门。关早了、或者对面还没开门就敲门，敲到的都是 `Connection refused`。

第 19 课那间屋，本喵是照着摆的；这一课把它拆开看了一遍，再看回去就明白多了。往后你看见的任何一句「连不上」「收到的是乱码」「对面没反应」，拆开也就这五件事里的一件喵。
