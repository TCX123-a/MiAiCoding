---
id: java-stage2-13
lang: java
stage: 2
order: 13
title: 文件操作与 IO 流初步
tags: [文件, IO]
required: ["java-stage2-12"]
crossRefs: []
estMinutes: 28
keywords: [File, FileWriter, BufferedReader, readLine, IOException]
---

## 钩子：一关灯，账本就不见了

本喵在鱼塘边支了个小摊，每天收摊前都要数一数今天收了几条小鱼干。本喵写了段小程序记上：

```java
public class Main {
    public static void main(String[] args) {
        int shouhuo = 3;
        System.out.println("今天收了 " + shouhuo + " 条小鱼干");
    }
}
```

```text
今天收了 3 条小鱼干
```

第二天本喵再打开这段程序，傻眼了 —— 昨天那 3 条**不见了**。因为 `shouhuo` 这个**小鱼干仓库**是**用完就拆的**：程序一关灯，仓库里装着的东西跟着一起没了。想让数字活过今晚，得把它写进**档案室**。

档案室里放着一本本**册子**，每一本都有自己的名字，比如 `dangan.txt`。册子上的字是真真切切**落在硬盘上**的：关灯、关机、明天再来，它都还在。册子的正规叫法是**文件**。这一课，本喵就教你怎么把小鱼干存进档案室，又怎么把它们一条条取回来喵。

## 一、`File`：先给册子挂个名牌

要让翻译官喵动某一本册子，先得**说清是哪一本**。说的办法是照一张图纸生一个**名牌**：

```java
import java.io.File;

public class Main {
    public static void main(String[] args) {
        File f = new File("dangan.txt");
        System.out.println("名牌拿到了，册子叫 " + f.getName());
    }
}
```

```text
名牌拿到了，册子叫 dangan.txt
```

这里有个**第一次一定会想歪**的地方：`new File("dangan.txt")` **不会真的去动硬盘**。它只是照 `File` 这张图纸生了一个名牌，牌子上写着「本喵说的是名叫 `dangan.txt` 的那本册子」。册子到底在不在、有几页、多大，牌子自己一概不知道 —— 得**拿着牌子去问**。

问的本事有四个，都是拿牌子喊的：

```java
import java.io.File;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        File f = new File("dangan.txt");
        System.out.println("一开始，册子在不在：" + f.exists());
        System.out.println("新建成功了没：" + f.createNewFile());
        System.out.println("新建之后，册子在不在：" + f.exists());
        System.out.println("册子叫什么：" + f.getName());
        System.out.println("册子现在有多少字节：" + f.length());
    }
}
```

```text
一开始，册子在不在：false
新建成功了没：true
新建之后，册子在不在：true
册子叫什么：dangan.txt
册子现在有多少字节：0
```

四个本事逐个看：

| 拿牌子喊 | 叼回来的是 |
|---|---|
| `f.exists()` | 「这本册子在不在」—— 在就 `true`，不在就 `false` |
| `f.createNewFile()` | 当场新建一本**空册子** —— **建成了**叼回 `true`，本来就有就叼回 `false`（不会把原来那本撕掉） |
| `f.getName()` | 牌子上写的名字 |
| `f.length()` | 册子**有多少字节** —— 空册子是 `0` |

第一行那个 `false` 是这一课最值钱的一行：**本喵明明没写「删册子」，可册子就是不在。** 因为这是一台**干干净净**的机器 —— 上面从来没建过 `dangan.txt`。往后本喵每次跑，都是从这个「不在」开始的（本喵特意在真跑台上确认过：每一趟都是从零开始，所以这几行次次一模一样）。

::: tip 猫咪提示
`File` 这一张图纸的脾气管到底就一句话：**它是名牌，不是册子本身。** 想动册子，永远得「拿到名牌 → 喊本事去问 / 去建 / 去读 / 去写」。它自己**不存一个字的正文**喵。
:::

## 二、往册子上写字：`FileWriter`

名牌能回答「在不在」，可它不会写字。写字要请**一支笔**：

```java
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        try (FileWriter w = new FileWriter("dangan.txt")) {
            w.write("小鱼干 3 条\n");
        }
    }
}
```

`new FileWriter("dangan.txt")` 就是**拉开抽屉、把笔尖搁在纸上**那个动作。括号里喂的名字，就是册子的名字 —— **册子不在，它顺手给你新建一本**（所以这一步不需要先 `createNewFile()`）。

拉开之后，`w.write("…")` 往册子上写字。这里有两件事要记牢喵：

- **每一句话末尾的换行符 `\n`，得自己写。** `System.out.println` 是「印完自动换一行」，`w.write` **没有这个脾气**：你写什么，册子上就是什么。
- **`\n` 不是「反斜杠加 n 两个字符」，是藏起来的一个换行**（上一课已经见过它了）。

本喵把「忘了写 `\n`」这件事真跑了一遍，你看是什么下场：

```java
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        try (FileWriter w = new FileWriter("dangan.txt")) {
            w.write("小鱼干 3 条");
            w.write("猫粮 1 碗");
        }
        try (BufferedReader r = new BufferedReader(new FileReader("dangan.txt"))) {
            int n = 0;
            String hang = r.readLine();
            while (hang != null) {
                n++;
                System.out.println(n + " 号格子：" + hang);
                hang = r.readLine();
            }
            System.out.println("一共 " + n + " 行");
        }
    }
}
```

```text
1 号格子：小鱼干 3 条猫粮 1 碗
一共 1 行
```

两条记录**挤成了一条**，行数也跟着错了。这条教训很值钱：**册子上哪一句是自己一行，全看你写没写那个 `\n`。**

### 那支笔用完要收

抽屉一直开着是有代价的。本喵拿两个数给你看：

```java
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        File f = new File("dangan.txt");
        try (FileWriter w = new FileWriter(f)) {
            w.write("小鱼干 3 条\n");
            System.out.println("抽屉还开着的时候，册子上有 " + f.length() + " 字节");
        }
        System.out.println("关上抽屉之后，册子上有 " + f.length() + " 字节");
    }
}
```

```text
抽屉还开着的时候，册子上有 0 字节
关上抽屉之后，册子上有 16 字节
```

**抽屉还开着的时候，册子上一个字节都没有。** 本喵明明写了字数进去呀？—— 因为写下去的字**还揣在翻译官喵的兜里**，没真的落进册子。它得等抽屉关上的那一刻才把兜里的字一次倒出来。

这就是「用完要收」的理由：**你写的字没落进册子之前，程序要是半路翻车了，那些字就跟着没了。** 上一课学的 `try ( … )` 正好把这个动作焊死 —— **这一段做完，不管出没出事，翻译官喵都会替你把抽屉关上**，`close()` 一个字都不用写，想忘也忘不掉。

顺带看一眼那个 `16`：写进去的是「小鱼干 3 条」加一个换行。三个字 + 两个空格 + 一个数字 + 一个「条」+ 一个换行 = 16 字节 —— 也就是说**一个中文字在这里占 3 个字节**（往后的正文里也一样，本喵真数过喵）。

## 三、把字叼回来：`BufferedReader` 和 `readLine()`

写字有笔，读字有**一张会叼东西回来的嘴**：

```java
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        try (FileWriter w = new FileWriter("dangan.txt")) {
            w.write("小鱼干 3 条\n");
            w.write("猫粮 1 碗\n");
        }
        try (BufferedReader r = new BufferedReader(new FileReader("dangan.txt"))) {
            String hang = r.readLine();
            while (hang != null) {
                System.out.println("档案里有：" + hang);
                hang = r.readLine();
            }
        }
    }
}
```

```text
档案里有：小鱼干 3 条
档案里有：猫粮 1 碗
```

一行一行拆开看：

- **`new FileReader("dangan.txt")`** —— 拉开册子准备**读**。这个动作和写字用同一个册子名字。
- **外面那层 `new BufferedReader( … )`** —— 给这张嘴**加一圈缓冲**：翻译官喵先把册子上一大块字捞进兜里，然后一行一行递给你。名字里的 `Buffered` 就是「带兜的」。
- **`r.readLine()`** —— 叼回**一整行**，**不带那个行尾的换行符**（这正是上一课那个「多出一个空行」的老朋友）。而且它知道什么时候到头。
- **到头了叼回什么？`null`。** 所以绕圈的条件写成 `hang != null` —— **「读到叼回 `null`」就是读完了的信号**。（`null` 是「什么都没有」的意思，本喵印出来的时候屏幕上就是 `null` 这四个字母。）

**三句一个骨架**，往后读册子长度一律照这个形状写：

```text
String hang = r.readLine();
while (hang != null) {
    想让每行做什么，写在这里
    hang = r.readLine();
}
```

::: warn 小心喵
这个骨架有**两处**新手最容易摔的地方喵：

1. **绕圈里最后那句 `hang = r.readLine();` 忘了写** —— 那么 `hang` 一直是同一行，程序就印同一行印到天荒地老（本喵叫它「死绕圈」，只能按停止键）。**它的位置在圈里的最后一格**，不是最前面。
2. **条件写成 `hang != ""`** —— 空行和「读完了」是两件事。这么写**根本停不下来**：读到头之后 `readLine()` 叼回来的是 `null`，而 `null` 跟一个空字符串**不相等**，圈子就一直转下去，屏幕上刷满 `档案里有：null`（本喵真跑过：4 秒钟印了四十七万行，最后是掐掉的）。**认准一个字：读到 `null` 才算读完了。**

对照着看：`readLine()` 自己会跳到下一行，**你要做的只是「再喊一次」**喵。
:::

```demo
title: 叼一行、问一次：圈子是怎么自己停的
code:
| // 册子上已经排着两行：小鱼干 3 条 / 猫粮 1 碗
| BufferedReader r = new BufferedReader(new FileReader("dangan.txt"));
| String hang = r.readLine();
| while (hang != null) {
|     System.out.println("档案里有：" + hang);
|     hang = r.readLine();
| }

step 起点 · 拉开册子，加一圈兜
at: 2
say: `new FileReader("dangan.txt")` 是**拉开册子准备读**；外面那层 `new BufferedReader( … )` 给这张嘴**加一圈兜** —— 翻译官喵先把册子上一大块字捞进兜里，再一行一行递给你。
meow: 册子拉开，还给嘴加了圈兜喵！
pose: expect
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = （还空着）
这一口是 null 吗 = （还没叼）
屏幕上 = （还空着）

step 头一口：叼回一整行
at: 3
say: `String hang = r.readLine();` —— 头一口就叼回**一整行**「小鱼干 3 条」，**不带行尾那个换行**。想接住它，得先有只格子：`String hang`。
meow: 头一口就叼回一整行喵！
pose: busy
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = 小鱼干 3 条
这一口是 null 吗 = 不是，叼到了
屏幕上 = （还空着）

step 问一句：这一口是 null 吗
at: 4
say: `while (hang != null)` 问的正是「这一口是不是 `null`」。格子里装着的是真字，**不是 null** —— 答真，放行进圈。
meow: 不是 null，放本喵进圈喵！
pose: expect
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = 小鱼干 3 条
这一口是 null 吗 = 不是 → 进圈
屏幕上 = （还空着）

step 第 1 圈 · 印出来
at: 5
say: 圈里那一行把它印到屏幕上 —— 「档案里有：小鱼干 3 条」。册子上的一行字，到这儿变成了屏幕上的一行字。
meow: 第 1 行印出来，档案里有小鱼干喵！
pose: yay
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = 小鱼干 3 条
这一口是 null 吗 = 不是 → 进圈
屏幕上 = 档案里有：小鱼干 3 条

step 圈里最后一格：再喊一次
at: 6
say: 第 6 行是圈里的**最后一格**：再喊一次 `readLine()`。新手最常漏的就是这一句 —— 漏了它，`hang` 一直是同一行，屏幕就印同一行印到天荒地老。`readLine()` 自己会跳到下一行，**你要做的只是「再喊一次」**。
meow: 再喊一次，叼回第二行喵！
pose: busy
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = 猫粮 1 碗
这一口是 null 吗 = 不是，叼到了
屏幕上 = 档案里有：小鱼干 3 条

step 又转回来问一次
at: 4
say: 转回判断那一行再问一次：格子里装着「猫粮 1 碗」，**还不是 `null`** —— 答真，再进一圈。
meow: 还是不是 null，再进一圈喵～
pose: expect
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = 猫粮 1 碗
这一口是 null 吗 = 不是 → 进圈
屏幕上 = 档案里有：小鱼干 3 条

step 第 2 圈 · 印出来
at: 5
say: 同一行代码又跑一遍 —— 屏幕上多出「档案里有：猫粮 1 碗」，册子上的两条都印完了。
meow: 第 2 行也印出来啦，两条到齐喵！
pose: yay
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = 猫粮 1 碗
这一口是 null 吗 = 不是 → 进圈
屏幕上 = 档案里有：小鱼干 3 条 / 档案里有：猫粮 1 碗

step 再喊一次：叼回来的是 null
at: 6
say: 第 6 行再喊一次 `readLine()` —— 册子读到头了，这回它叼回来的**不是一个字，是 `null`**（「什么都没有」）。
meow: 这回叼回来的是 null，啥都没有喵……
pose: think
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = null（什么都没有）
这一口是 null 吗 = 是

step 到头了：圈子自己停
at: 4
say: 转回判断那一行：`hang != null` 答**假** —— 圈子到此为止，不再绕。**「读到叼回 `null`」就是读完了的信号**，不是空行、不是别的什么。
meow: 读到 null 就算读完了，收工喵！
pose: proud
册子上排着 = 小鱼干 3 条 / 猫粮 1 碗
hang 这只格子 = null（什么都没有）
这一口是 null 吗 = 是 → 圈子停
屏幕上 = 档案里有：小鱼干 3 条 / 档案里有：猫粮 1 碗
```

## 四、接着写，还是撕掉重写？

账本是天天要添的。本喵不想每添一笔就把前面写的全撕掉 —— 可 `new FileWriter(名字)` **每次拉开抽屉的那一刻，都会把册子上原来的字全擦干净**（不是删册子，是**擦干净**）。本喵真跑了一遍，给你看擦掉的样子：

```java
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        try (FileWriter w = new FileWriter("dangan.txt")) {
            w.write("第一天：3 条\n");
        }
        try (FileWriter w = new FileWriter("dangan.txt")) {
            w.write("第二天：5 条\n");
        }
        try (BufferedReader r = new BufferedReader(new FileReader("dangan.txt"))) {
            String hang = r.readLine();
            while (hang != null) {
                System.out.println("档案里有：" + hang);
                hang = r.readLine();
            }
        }
    }
}
```

```text
档案里有：第二天：5 条
```

第一天那条**没了**。想要「接着写」，就在名字后面再喂一个 `true`：

```java
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        try (FileWriter w = new FileWriter("dangan.txt")) {
            w.write("第一天：3 条\n");
        }
        try (FileWriter w = new FileWriter("dangan.txt", true)) {
            w.write("第二天：5 条\n");
        }
        try (BufferedReader r = new BufferedReader(new FileReader("dangan.txt"))) {
            String hang = r.readLine();
            while (hang != null) {
                System.out.println("档案里有：" + hang);
                hang = r.readLine();
            }
        }
    }
}
```

```text
档案里有：第一天：3 条
档案里有：第二天：5 条
```

记住这条分界线喵：**想留住原来的字，喂 `true`；想从白纸开始写，就别喂。** 册子本来不在的时候，两种写法都会顺手新建一本，差别只在那本旧册子上的字留不留。

## 五、册子这套东西，是「要表态的」

上一课学过：出事的东西分两档，一档是**要表态的**（`Exception` 这一家）—— 你不写清怎么办，稿子就退回来。**册子这一套本事，全在这一档里。**

本喵把「忘了表态」那版真跑了一遍，翻译官喵当场犯难：

```java
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.FileWriter;

public class Main {
    public static void main(String[] args) {
        try (FileWriter w = new FileWriter("dangan.txt")) {
            w.write("小鱼干 3 条\n");
        }
        try (BufferedReader r = new BufferedReader(new FileReader("dangan.txt"))) {
            System.out.println("写进去的字：" + r.readLine());
        }
    }
}
```

```text
Main.java:7: error: unreported exception IOException; must be caught or declared to be thrown
  exception thrown from implicit call to close() on resource variable 'w'
Main.java:10: error: unreported exception FileNotFoundException; must be caught or declared to be thrown
```

第一条和它下面那一句说的是同一件事：**拉开抽屉（`new FileWriter(…)`）和关上抽屉这几下，都可能出事，你没说清怎么办。** 最后一条是新面孔 —— 册子**不在**的时候，`FileReader` 拉开的是个空抽屉，它报的名字叫 `FileNotFoundException`（「册子没找到」）。

怎么办？两条出路，和上一课一模一样：**当场接住**，或者**在招式头上表态**。本喵这边一律选第二条 —— 在 `main` 的头上写一句 `throws IOException` 就行（那个 `import java.io.IOException;` 也别忘）：

```text
public static void main(String[] args) throws IOException {
```

`IOException` 是这一家**总的名字**（`FileNotFoundException` 认它当师父），所以头上写这一句，把上面那三条一并盖住。

为什么册子这套本事这么爱出事？因为它们**都是「外面的世界答不答应」**的事：硬盘有没有空、册子在不在、笔有没有被别的程序抢走 —— 这些都不是本喵稿子写得对不对能决定的。Java 逼本喵**写稿子的时候就先想一遍**，正是这个道理。

那要是册子真不在，程序会怎么样？本喵真跑了一遍「读一本不存在的册子」：

```java
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader r = new BufferedReader(new FileReader("meiyou.txt"));
        System.out.println("读到了：" + r.readLine());
        r.close();
    }
}
```

```text
Exception in thread "main" java.io.FileNotFoundException: meiyou.txt (系统找不到指定的文件。)
```

**当场断气**，和上一课那个没接住的 `RuntimeException` 一模一样的下场（下面还跟着一串 `at …` 的脚印，本喵这里省掉了）。所以头上一句 `throws IOException` 的意思**不是「不会出事」**，是「出了事本喵不在这儿管，往上报」—— 上一课那条「出事那一行之后的活全都不干」照样成立喵。

## 六、字节流和字符流：两条管子

最后说一件**名字听着吓人、其实一看就懂**的事。

册子上存的到底是什么？是**字节** —— 一格一格的 0 和 1。所以往外搬字的那套本事，按**怎么搬**分成两条管子：

- **一条一格一格地搬**（一次搬一小格 0/1）—— 这样的管子叫**字节流**。它什么都能搬：照片、压缩包、音乐，反正对着一格一格的字节搬就是了。
- **一条按「字」搬**（一次搬一个字）—— 这样的管子叫**字符流**。它替你把「哪些字节合起来算一个字」这件事办好了，你只管按字读写。

本喵这一课用的全是**第二条**：`FileWriter` / `FileReader` 是字符流（看名字：写的是「字」）。上一节那个 `16` 就是它们在背后干的活 —— 本喵写「小鱼干」三个字，它们按 UTF-8 的规矩把这三个字拆成 9 个字节落到册子上，读回来的时候再照同一套规矩拼回三个字。**一个有中文字的册子，用字符流是对的**；哪天要搬照片，就轮到字节流上场了（那是后面的事，今天先有个印象就够喵）。

::: tip 猫咪提示
这一课的五件事，一句话串起来喵：

1. **`new File(名字)`** 只是拿**名牌**，要问「在不在 / 叫什么 / 多大」就喊它的本事；
2. **`new FileWriter(名字)`** 拉开抽屉写字 —— **册子不在就顺手新建**，`write` **不会自己换行**，`\n` 得自己写；
3. **`new BufferedReader(new FileReader(名字))`** 加一圈兜，`readLine()` **一行一行叼**，叼回 `null` 就是到头了；
4. **名字后面喂 `true` 才是接着写**，不喂就是把册子擦干净重来；
5. 这几套本事都归 **`IOException`** 那一档 —— **要么当场接住，要么头上写 `throws IOException`**。
:::

## 小任务

1. 照着第一节的 `File` 那四个本事，把册子名字换成一个你自己的（比如 `zhangben.txt`）跑一遍，亲眼看一遍那个 `false` —— 然后**再跑一遍**，看看第二遍的「一开始在不在」变了没有。（本喵这边每次都是新的空机器，你那边可不一样喵。）
2. 用 `try (FileWriter w = …)` 往册子上写三行小鱼干记录，**每行末尾都写 `\n`**；再换成不写 `\n` 跑一遍，看看那三行是怎么挤成一条的。
3. 用 `readLine()` 的骨架把册子上的字一行行印出来，每行前面加上序号，最后印一行「一共 N 行」。
4. 第三步跑完之后，把写字的 `true` 去掉再跑一遍 —— **亲眼看一眼「撕掉重写」是怎么把前面那些字擦掉的**。
5. 故意把 `throws IOException` 删掉跑一次，把翻译官喵说的那句话抄下来；看完记得加回去。

下一课，本喵要把这一路学的东西全用上，做一个**用菜单指挥的小管理器** —— 去「待办事项管理器」探险喵～ 🐾
