---
id: java-stage3-15
lang: java
stage: 3
order: 19
title: 综合项目：迷你聊天室（控制台多线程）
tags: [综合项目, 聊天室, 网络初步, 收尾]
required: ["java-stage3-14"]
crossRefs: []
estMinutes: 30
keywords: [ServerSocket, Socket, daemon, broadcast, UTF-8]
---

本课是一件**综合项目**：把这一路认下的招式拼成**一间迷你聊天室** —— 隔壁窝的猫敲敲门就能进来，说一句「开饭了」，屋里的猫都看得见。今天要认两样新家什（**一扇门**、**一支管子**），剩下的全是复习：派一只猫出去守着、给名单上锁、一行一行读写。

## 钩子：招式攒够了，缺的是一间屋子

本喵把这一路的招式数了一遍，单拎出哪一样都会用：

- 派一只猫出去干活（第 13 课）、给一段活上锁（第 14 课）、雇一队猫待在院子里（第 15 课）；
- 照 X 光把图纸拆开看（第 16 课）、往招式上贴纸条（第 17 课）、前辈猫留下的那几套摆法（第 18 课）。

可本喵真正想要的，是**一样东西**：一间能用的聊天室。要求说清楚就是四条：

1. **得有扇门，谁都能来。** 门开在本喵这儿，报一个**门牌号**；隔壁窝照着号敲门，敲开了就能说话。
2. **一位客人，一只猫守着。** 一只猫唠个没完，不能把别的猫堵在门外干等着。
3. **谁说的话，屋里所有猫都看得见。** 屋里几位是随时在变的（有进有出），那份名单会被好几只猫一起碰。
4. **说走利索走。** 该关的管子关掉，话说完程序就收工。

四条里，**第 1 条是新认的**（前 18 课没碰过「隔着管子说话」这件事），第 2、3 条是本喵早就认下的招式，第 4 条是这一课才要长记性的地方。下面一块砖一块砖摆。

## 一、第一块砖：一扇门，一支管子

先是门。开门就一句话：

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
            } catch (IOException e) {
            }
        });
        守门的.start();

        Socket 自己 = new Socket("127.0.0.1", 端口);
        写手(自己).println("开饭了");
        System.out.println("自己 听到：" + 读者(自己).readLine());
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
自己 听到：收到：开饭了
```

这一段里有五件事要说清：

- **`new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))` 就是「开一扇门」。** 三个投喂依次是：门牌号、门口最多排多长的队、认哪张网。**门牌号写 `0` 的意思是「随便挑一个空号」** —— 挑完的那一个，用 `门.getLocalPort()` 问回来。写死一个号（比如 8888）也能开，可那个号在别人窝里可能已经被人占着，本喵这份稿子就未必跑得动了。
- **`门.accept()` 是「站在门口等」。** 等到一位客人上门，它交回来一支**管子**（`Socket`）—— 之后跟这位客人说话，全走这支管子。
- **管子两头，各要一支写手一支读者。** 这就是 `写手(客)` 和 `读者(客)` 那两小段的意思：一支往外说（`PrintWriter`），一支往里听（`BufferedReader`）。两支都写明了按 `UTF-8` 走 —— 不写明的话，中文在管子里来回一趟就可能变成乱码。写手那儿的 `true` 是「每说一行就赶紧送出去，别攒在手里」。
- **收尾是有先后的。** `自己.close()` 是「本喵这一头说完了」；`守门的.join()` 是「站在这儿等门房那只猫把手头的活干完」。门房是一只猫（一台独立的活），不等它，母猫可能先跑掉。
- **绕圈里那些「可能出岔子」的活，得当场裹一层。** `门.accept()`、`守着一位(客)`、两头的写手读者，在自己的定义处都写着 `throws IOException` —— 意思是「这活可能出岔子，我先把话撂这儿」。而给 `Thread` 用的那对小括号里**不许往外撂这种话**。所以本喵在那一层裹了 `try { ... } catch (IOException e) { }`：出岔子就地咽下去，绕圈照常收场。母猫那边不用裹，是因为 `main` 头上写着 `throws Exception` —— 它有权把这话往上一撂。

> **猫在院里踩的坑：门牌号不是「谁先开谁说了算」。** 一个号同时只能有一扇门。本喵把门牌号写死过一次，跑第二遍的时候那个号还没退干净，当场就炸了。**写 `0` 让系统挑空号**，本喵这份稿子才在哪台机器上都跑得动 —— 要告诉别人号是多少，就 `getLocalPort()` 问一句。

## 二、第二块砖：一位客人，一只猫守着

门开了，接着是「谁来招呼客人」。上面那段里门房自己陪着客人说完了话 —— 那样的话，**门口再来一位，就得一直等着**。所以要改成：门房只管开门，开完派一只猫陪着这位客人：

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
                while (true) {
                    Socket 客 = 门.accept();
                    new Thread(() -> 守着一位(客)).start();
                }
            } catch (IOException e) {
            }
        });
        守门的.setDaemon(true);
        守门的.start();

        Socket 甲 = new Socket("127.0.0.1", 端口);
        Socket 乙 = new Socket("127.0.0.1", 端口);
        写手(乙).println("有鱼吗");
        System.out.println("乙 的管子：" + 读者(乙).readLine());
        甲.close();
        乙.close();
    }

    static void 守着一位(Socket 客) {
        try {
            写手(客).println("收到：" + 读者(客).readLine());
            客.close();
        } catch (IOException e) {
        }
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
乙 的管子：收到：有鱼吗
```

**这一行就是「一位客人一只猫」挣来的喵。** 看仔细：`甲` 是先敲门的，可它进门之后**一直闷着、一个字都没说** —— 守着甲的那只猫就卡在「等甲说话」那一步上。要是门房亲自陪着甲，那乙连门都进不来；现在门房开完门就走，乙照样有人招呼。

- **`while (true) { ... }` 是门房的本分：一直站在门口。** 每来一位，就 `new Thread(() -> 守着一位(客)).start()` —— 派一只**新猫**去陪这位，门房自己立刻回到门口接着等。这一句就是第 13 课那个「派一只猫」。
- **`守门的.setDaemon(true)` 是把门房设成「后台的猫」。** 门房这一辈子都在门口站着（那个绕圈永远不结束），母猫的活干完了它也不会自己停。设成后台的，母猫一收工，它就跟着一起走，程序不用为它多站着。**这一句要是漏了、门也没人关，程序就不肯收工** —— 本喵真试过：母猫那行字印完了，本喵等了八秒，它还在门口站着不肯走。
- **每只猫的各样东西都在自己手里。** `守着一位` 里的读、写、关，都是这一位客人的管子 —— 几只猫同时招呼各自的客人，谁也碍不着谁。

> **猫在院里踩的坑：不派新猫、门房自己上，第二位就得在门口干等。** 本喵把 `new Thread(...).start()` 拆掉试过（门房开完门就地招待）：甲 进门后不说话，乙 敲门敲得进（门开着），可**乙送出去的那句一个字都没等到回话**，一直等到本喵给它掐了表。门房的本分是开门，不是陪聊 —— 这一条别省。

## 三、第三块砖：屋里那份名单，要上锁

两位都进屋了，就得记住「屋里现在有谁」—— 往后谁说话，照着这份名单挨个转过去。名单上放的是各位客人的**写手**（手里有写手，就能往那位那边递话）：

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Main {
    static final List<String> 进屋的名字 = Collections.synchronizedList(new ArrayList<>());

    public static void main(String[] args) throws Exception {
        Thread 甲 = new Thread(() -> 记上一千笔("甲"));
        Thread 乙 = new Thread(() -> 记上一千笔("乙"));
        甲.start();
        乙.start();
        甲.join();
        乙.join();
        System.out.println("名单上一共几位：" + 进屋的名字.size());
        System.out.println("名单上有 甲：" + 进屋的名字.contains("甲"));
        System.out.println("名单上有 乙：" + 进屋的名字.contains("乙"));
    }

    static void 记上一千笔(String 谁) {
        for (int i = 0; i < 1000; i++) {
            进屋的名字.add(谁);
        }
    }
}
```

```text
名单上一共几位：2000
名单上有 甲：true
名单上有 乙：true
```

两千笔，一笔不少 —— **因为名单自己带着锁**：

- **`Collections.synchronizedList(new ArrayList<>())`** 是「一张**自带锁**的名单」：好几只猫同时往里添、同时翻，它都替你排好队。第 14 课那个「同一本账、两只猫一起记，数会少」的坑，就是没上锁的名单踩出来的。不带锁的名单两只猫一起添，结果是**每次都不一样**（少多少看谁先谁后）—— 所以本课不拿它当演示摆出来，摆出来的话本喵自己都不知道该写哪个数。规矩记牢就行：**好几只猫一起碰的东西，就得带锁。**
- **翻名单的时候还要整段锁上。** 自带锁只保证「一次一笔」安全，可「从头翻到尾」是一连串动作 —— 翻到一半名单被人改了，翻的动作就乱了。所以真往外转话的时候，是这么写的：

```java
synchronized (屋里) {
    for (PrintWriter 写 : 屋里) {
        写.println(一句);
    }
}
```

这一段是第 14 课那只「一次只许一只猫进来」的锁，本课照原样用一遍。**注意这把锁跟名单自带的那把是同一把**（`synchronizedList` 锁的就是那张名单自己），所以「添一笔」和「翻一遍」互相之间也排得上队。

## 四、坑：管子关了，就不能再读

收尾那一条要求，本喵单独拎出来踩一遍。下面这段手里明明握着写手和读者，却把 `close()` 提到了读的前面：

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
            } catch (IOException e) {
            }
        });
        守门的.start();

        Socket 自己 = new Socket("127.0.0.1", 端口);
        PrintWriter 自己写 = 写手(自己);
        BufferedReader 自己读 = 读者(自己);
        自己写.println("开饭了");
        自己.close();
        System.out.println("自己 听到：" + 自己读.readLine());
        守门的.join();
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
Exception in thread "main" java.net.SocketException: Socket closed
```

原话是 `Socket closed` —— 「管子已经关了」。**`close()` 的意思是「这一头到此为止」**：关了之后再读、再写，跑起来那一刻当场就炸。所以收尾的次序永远是先弄完手里的（该读的读完、该写的写完），**再**关管子。

## 五、拼起来：一间能用的聊天室

四块砖齐了，摆成一间屋。规矩定三条：

1. **进门先报名字。** 敲开门的第一句是名字（`甲`），屋里回一句 `欢迎 甲`。
2. **谁说话，转给屋里所有人**（连说话的那位自己也收一份 —— 聊天室里自己看得到自己说的话，才顺眼）。
3. **说 `再见` 就走。** 屋里把这位从名单上划掉、管子关上。

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
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Main {
    static final List<PrintWriter> 屋里 = Collections.synchronizedList(new ArrayList<>());

    public static void main(String[] args) throws Exception {
        ServerSocket 门 = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        int 端口 = 门.getLocalPort();
        Thread 守门的 = new Thread(() -> {
            try {
                while (true) {
                    Socket 客 = 门.accept();
                    new Thread(() -> 守着一位(客)).start();
                }
            } catch (IOException e) {
            }
        });
        守门的.setDaemon(true);
        守门的.start();

        Socket 甲 = new Socket("127.0.0.1", 端口);
        Socket 乙 = new Socket("127.0.0.1", 端口);
        PrintWriter 甲写 = 写手(甲);
        PrintWriter 乙写 = 写手(乙);
        BufferedReader 甲读 = 读者(甲);
        BufferedReader 乙读 = 读者(乙);

        甲写.println("甲");
        乙写.println("乙");
        System.out.println("甲 听到：" + 甲读.readLine());
        System.out.println("乙 听到：" + 乙读.readLine());

        甲写.println("甲：开饭了");
        System.out.println("甲 听到：" + 甲读.readLine());
        System.out.println("乙 听到：" + 乙读.readLine());

        乙写.println("乙：有鱼吗");
        System.out.println("甲 听到：" + 甲读.readLine());
        System.out.println("乙 听到：" + 乙读.readLine());

        甲写.println("再见");
        乙写.println("再见");
        甲.close();
        乙.close();
    }

    static PrintWriter 写手(Socket 客) throws IOException {
        return new PrintWriter(new OutputStreamWriter(客.getOutputStream(), StandardCharsets.UTF_8), true);
    }

    static BufferedReader 读者(Socket 客) throws IOException {
        return new BufferedReader(new InputStreamReader(客.getInputStream(), StandardCharsets.UTF_8));
    }

    static void 守着一位(Socket 客) {
        try {
            BufferedReader 读 = 读者(客);
            PrintWriter 写 = 写手(客);
            String 名字 = 读.readLine();
            屋里.add(写);
            写.println("欢迎 " + 名字);
            String 一句;
            while ((一句 = 读.readLine()) != null) {
                if (一句.equals("再见")) {
                    break;
                }
                转给所有人(一句);
            }
            屋里.remove(写);
            客.close();
        } catch (IOException e) {
        }
    }

    static void 转给所有人(String 一句) {
        synchronized (屋里) {
            for (PrintWriter 写 : 屋里) {
                写.println(一句);
            }
        }
    }
}
```

```text
甲 听到：欢迎 甲
乙 听到：欢迎 乙
甲 听到：甲：开饭了
乙 听到：甲：开饭了
甲 听到：乙：有鱼吗
乙 听到：乙：有鱼吗
```

对着这一版，回头认认每一段是哪块砖：

- **门与管子**：`门`、`端口`、`甲`、`乙` 那几行；管子两头各一支写手一支读者，都按 `UTF-8` 走。
- **一只猫守一位**：`守门的` 那个绕圈 + `new Thread(() -> 守着一位(客)).start()`；门房设成后台的。
- **名单与锁**：`屋里` 那张自带锁的名单，添在 `守着一位` 里、划在收尾处，翻在 `转给所有人` 里 —— 翻的时候整段锁上。
- **行话是一行一行说的**：两头都用 `readLine()` 收、`println(...)` 发；说 `再见` 就从绕圈里跳出来。
- **母猫的活**：两位进场、报名字、按**本喵自己摆的先后**（先甲后乙）收话、说完送客。

有一处是刻意的喵：**母猫收到的第一行是「欢迎」**。这一行同时充当「报名凭据」—— 甲 的欢迎到了，就说明门房已经把甲那支管子记进名单了。所以本喵敢在收完两位的欢迎之后再开口说话：**这时候两位肯定都在屋里**，谁说的话两位都收得到。要是省掉这一步、连上就说话，就可能出现「乙还没进屋，甲那句话它就没听见」—— 那不是管子坏了，是次序没摆好。

## 这份项目用到了哪几课的家什

| 这一课里的东西 | 哪儿来的 |
| --- | --- |
| `new Thread(() -> ...).start()` 派一只猫 | 第 13 课：一路活交给一只猫 |
| `synchronized (屋里) { ... }` 整段只许一只猫进 | 第 14 课：给一段活上锁 |
| 名单自带锁（`Collections.synchronizedList`） | 第 14 课那个「数会少」的坑 |
| `join()` 等一只猫收工 | 第 13 课、第 15 课 |
| 一支写手一支读者、按行读写、该关就关 | 第 11、12 课的读写家什 |
| 门与管子（`ServerSocket`、`Socket`、门牌号） | **本课新认的** |

::: tip 猫咪提示

- **门牌号写 `0` 让系统自己挑一个空号**；要告诉别人号是多少，就拿 `getLocalPort()` 问回来。
- **门房只干开门这一件事**：每来一位就派一只新猫去陪这位，门房自己立刻回到门口接着等 —— 门房亲自陪聊，第二位就得在门口干等。
- **门房要设成后台的猫**：母猫一收工，它就跟着一起走；这一句要是漏了、门又没人关，程序就不肯收工。
- **屋里那份名单自带锁，翻的时候还要整段锁上**：好几只猫一起碰的东西，就得带锁。
- **收尾的次序永远是先弄完手里的、再关管子** —— 管子一关就是「这一头到此为止」，再读再写当场就炸。

:::

## 小任务

1. 给这间屋添第三位客人（`丙`），让它也报名字、也收得到别人说的话 —— 名单和广播那两处要改吗？
2. 把「说 `再见` 就走」改成让屋里**广播一句** `甲 走了`（先转给所有人，再退房）。想想为什么这一句得在 `break` 之前转。
3. 把 `守门的.setDaemon(true)` 那一行删掉再跑一遍 —— 程序肯收工吗？为什么？

## 阶段小结

这一课没有新招式，只有**摆法**：门开着，一位一只猫，名单上着锁，话一行一行说，说完利索收工。

回头看一眼这三阶走完的路：从一条小鱼干的仓库开始，本喵现在能派一队猫、能照 X 光、能贴纸条、能按前辈猫的套路摆屋子，最后把它们拼成一件**真正能用的东西**。往后你看见的任何一间聊天室、任何一个服务器，里面拆开来也就是这四块砖 —— 门、管子、名单、收工。**能拆开看、能自己拼起来**，这一路就没白走喵。
