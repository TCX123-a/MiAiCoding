---
id: java-stage3-08
lang: java
stage: 3
order: 12
title: NIO 初步——更快的鱼塘管道
tags: [NIO, 文件工具, 缓冲]
required: ["java-stage3-07"]
crossRefs: []
estMinutes: 26
keywords: [Path, Files, ByteBuffer, FileChannel, StandardOpenOption]
---

## 钩子：鱼塘换了一套管子

上一课本喵拿着桶，一口一口往文件里舀字、再一口一口舀回来。稳是稳，就是慢 —— 舀一趟跑一趟。

今天鱼塘换了一套**管道**：一头接到水面、一头拖到岸上，中间挂一个**货舱**，字先在货舱里攒成**字节**，然后整趟搬过去。这套家什在 Java 里叫 NIO。

顺手，今天的工具箱里还多了一套**现成的手势** —— 不用自己开管子、不用自己收工，喊一句就干活。今天四件事：

1. 先撕一张**门牌**（`Path`）；
2. 一套现成的手势（`Files`）：问在不在、一口气写、一口气念；
3. 管子 + 货舱（`FileChannel` + `ByteBuffer`）—— 以及货舱里那只**必须拨回去的书签**；
4. 门牌不在的时候，它会怎么翻脸。

## 一、门牌：先把「哪份文件」撕成一张纸

上一课是直接把文件名那句字递给家什（`new FileWriter("账本.txt")`）。这一课先撕一张**门牌**：

```java
Path 门牌 = Path.of("账本.txt");
```

门牌里写的就是那份文件的**位置**。撕出来不用收工、也不会翻脸（就算文件还不存在，门牌照样撕得出来）—— 它只是一张写着位置的纸。

门牌还有个好处：**能拼**。本喵的账本要放进一个叫 `鱼塘` 的柜子里，就写两截：

```java
Path 门牌 = Path.of("鱼塘", "账本.txt");
```

它会自己补上本喵这台机器的**分隔符**（Windows 上是反斜杠，别的系统是斜杠）。自己拿字拼「鱼塘」加个斜杠再加文件名，在别人机器上就可能对不上 —— 交给它拼，这个坑就绕过去了。

## 二、`Files`：不用自己开管子的一整套手势

`Files` 这个名字下面挂着一排**现成手势**，每一手都自己开管子、自己收工：

```java
import java.nio.file.Files;
import java.nio.file.Path;

public class Main {
    public static void main(String[] args) throws Exception {
        Path 门牌 = Path.of("账本.txt");

        System.out.println("先问一声：文件在不在？" + Files.exists(门牌));

        Files.writeString(门牌, "小橘 3 条\n狸花 5 条\n");

        System.out.println("写完再问：文件在不在？" + Files.exists(门牌));
        System.out.println("念回来：");
        System.out.println(Files.readString(门牌));
    }
}
```

```text
先问一声：文件在不在？false
写完再问：文件在不在？true
念回来：
小橘 3 条
狸花 5 条
```

三个手势各管一件事：

- **`Files.exists(门牌)`** —— 问一声「在不在」，它答 `true` / `false`。本喵这次问了两遍：写之前不在（`false`），写完就在了（`true`）。
- **`Files.writeString(门牌, 一串字)`** —— 一口气把整串字写进去。文件**不在就顺手建一个**，所以第一手写完它就有了。
- **`Files.readString(门牌)`** —— 一口气把**整份文件**叼回来，装成一串字。

还有一手今天也要用：

- **`Files.size(门牌)`** —— 报「这份文件**几个字节**」。注意它报的是字节数，不是字数：本喵那两行中文（四个汉字加空格、数字、换行）加起来 26 个字节，比「字」多得多喵。

::: tip 猫咪提示

**这几手为什么短？** 因为「开管子、收工」这两步它替本喵做了。上一课那套写法是**本喵自己拿着桶**，桶有多大、什么时候倒、什么时候收，全得自己盯；`Files` 这几手是**喊一声就让家什办完**。省事，但有一件事要认：

**「一口气」意味着整份文件都端在本喵手里。** 一两行账本这么干最省事；真碰上几百 MB 的大东西，一口气全端进来会把本喵撑坏 —— 那时候还得回上一课那套一口一口的写法。

:::

## 三、管子 + 货舱：`FileChannel` 与 `ByteBuffer`

现在回到「更快」这件事上。这一套有两个角色：

- **`FileChannel`（通道）** —— 一根接到文件上的**管子**：一头能往里灌字节，一头能把字节拉出来。管子得**自己开、自己收**。
- **`ByteBuffer`（货舱）** —— 挂在管子上的**货舱**，装的全是**字节**。管子和文件之间搬东西，中间必须过这只货舱。

```java
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class Main {
    public static void main(String[] args) throws Exception {
        Path 门牌 = Path.of("鱼塘.txt");

        FileChannel 出口 = FileChannel.open(门牌, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        ByteBuffer 货舱 = ByteBuffer.wrap("小橘 3 条\n狸花 5 条\n".getBytes(StandardCharsets.UTF_8));
        出口.write(货舱);
        出口.close();

        FileChannel 入口 = FileChannel.open(门牌, StandardOpenOption.READ);
        ByteBuffer 另一个 = ByteBuffer.allocate((int) 入口.size());
        入口.read(另一个);
        另一个.flip();
        System.out.println("念到：");
        System.out.println(new String(另一个.array(), 另一个.position(), 另一个.remaining(), StandardCharsets.UTF_8));
        入口.close();
    }
}
```

```text
念到：
小橘 3 条
狸花 5 条
```

一行一行拆开看：

- **`FileChannel.open(门牌, 规矩...)`** —— 开管子。后面那串是**开门的规矩**（`StandardOpenOption`），本题里用到三样：
  - `CREATE` —— 文件不在就建一个；
  - `WRITE` —— 这一头是往里灌的；
  - `READ` —— 这一头是往外拉的。
- **`"…".getBytes(StandardCharsets.UTF_8)`** —— 把一串字变成**字节们**。字是给人看的，管子里走的只能是字节，所以中间得有这一步（`UTF_8` 是这本「字与字节怎么对应」的字典，前后两头用**同一本**才不会乱）。
- **`ByteBuffer.wrap(字节们)`** —— 拿现成的字节们糊一只货舱，装的就是刚变的那些。
- **`出口.write(货舱)`** —— 整趟灌进去。灌完照样要 `close()` 收工 —— 上一课那句「写了就收工」，在这里一个字都不用改。
- **`ByteBuffer.allocate((int) 入口.size())`** —— 另一头要拉字节，得先备货舱。`入口.size()` 报的是管子里那头一共几个字节，照它准备一只**正好装得下**的货舱。（`size()` 给的数比本喵平时用的大一号，前面加一句 `(int)` 是**跟它说一声「按本喵平时那个号来」**。）
- **`入口.read(另一个)`** —— 把字节拉进货舱。
- **`另一个.flip()`** —— 这一句是今天的重点，下一节单独讲。
- **`new String(另一个.array(), 另一个.position(), 另一个.remaining(), StandardCharsets.UTF_8)`** —— 读作「从货舱里**现在这个位置**起，取**还剩的这些**字节，按 UTF-8 那本字典拼回一串字」。货舱里的字节是**一整排**（`array()`），本喵要指明**从哪儿起、取多少**。

## 四、货舱里那枚必须拨回第一格的书签：`flip()`

`ByteBuffer` 里夹着一枚**书签**，记着「本喵现在读到哪儿了」。往里装字节的时候，书签一路往前挪；装完，它停在**末尾** —— 那意思是「本喵**写到这儿**了」。

可本喵接下来要干的是**念**它：念的时候要的是「从头念到写到的这儿」。这一正一反，中间就差一句：

```java
另一个.flip();
```

`flip()` 干的事很朴素：**把书签拨回开头，同时记下「读到哪儿为止」**。拨完，`position()`（书签现在停在哪）是 `0`，`remaining()`（从这儿到末尾还剩几个字节）就是刚装进来的那一整排。

要是忘了拨，会怎样？本喵真跑给你看（只把那句 `flip()` 去掉）：

```java
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class Main {
    public static void main(String[] args) throws Exception {
        Path 门牌 = Path.of("鱼塘.txt");

        FileChannel 出口 = FileChannel.open(门牌, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        ByteBuffer 货舱 = ByteBuffer.wrap("小橘 3 条\n狸花 5 条\n".getBytes(StandardCharsets.UTF_8));
        出口.write(货舱);
        出口.close();

        FileChannel 入口 = FileChannel.open(门牌, StandardOpenOption.READ);
        ByteBuffer 另一个 = ByteBuffer.allocate((int) 入口.size());
        入口.read(另一个);
        System.out.println("念到：" + new String(另一个.array(), 另一个.position(), 另一个.remaining(), StandardCharsets.UTF_8));
        System.out.println("货舱里的头一个位置：" + 另一个.position());
        入口.close();
    }
}
```

```text
念到：
货舱里的头一个位置：26
```

第一行念回来的**是空的**（「念到：」后面什么都没有），第二行报出书签停在 `26` —— 那正是本喵刚装进去的 26 个字节。书签停在末尾，「还剩的这些」就是 `0` 个字节，取 `0` 个拼出来自然是空字。

这枚书签是怎么一步步挪到末尾的，本喵盯着它走一遍：

```demo
title: 字节明明拉进来了，念出来却是空的
code:
| import java.nio.ByteBuffer;
| import java.nio.channels.FileChannel;
| import java.nio.charset.StandardCharsets;
| import java.nio.file.Path;
| import java.nio.file.StandardOpenOption;
|
| public class Main {
|     public static void main(String[] args) throws Exception {
|         Path 门牌 = Path.of("鱼塘.txt");
|
|         FileChannel 出口 = FileChannel.open(门牌, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
|         ByteBuffer 货舱 = ByteBuffer.wrap("小橘 3 条\n狸花 5 条\n".getBytes(StandardCharsets.UTF_8));
|         出口.write(货舱);
|         出口.close();
|
|         FileChannel 入口 = FileChannel.open(门牌, StandardOpenOption.READ);
|         ByteBuffer 另一个 = ByteBuffer.allocate((int) 入口.size());
|         入口.read(另一个);
|         System.out.println("念到：" + new String(另一个.array(), 另一个.position(), 另一个.remaining(), StandardCharsets.UTF_8));
|         System.out.println("货舱里的头一个位置：" + 另一个.position());
|         入口.close();
|     }
| }

step 起点：先把门牌撕好
at: 9
say: `Path.of("鱼塘.txt")` 撕的是一张**门牌**，上面写着那份文件在哪儿。撕门牌不用收工、也不会翻脸（文件还不存在，门牌照样撕得出来）—— 它只是一张写着位置的纸。
meow: 先把门牌撕好，位置写在上面喵
pose: expect
货舱里的字节 = （还没备货舱）
书签停在 = （还没开始装）
念回来的是 = （还没念）

step 开一根管子，这一头是往里灌的
at: 11
say: `FileChannel.open(门牌, 规矩...)` 开一根**接到文件上的管子**。后面那串是开门的规矩：`CREATE`（文件不在就建一个）、`WRITE`（这一头是往里灌的）。**管子得自己开、自己收。**
meow: 管子开好了，这一头是往里灌的喵
pose: expect
货舱里的字节 = （还没备货舱）
书签停在 = （还没开始装）
念回来的是 = （还没念）

step 字先变成字节，再糊成一只货舱
at: 12
say: `"…".getBytes(StandardCharsets.UTF_8)` 把那串字**变成字节们**（管子里走的只能是字节）；`ByteBuffer.wrap(字节们)` 再拿它们糊一只**货舱**。本喵这两行账，正好 26 个字节。
meow: 字变字节，糊好一只货舱喵！
pose: busy
货舱里的字节 = 26 个（糊好了）
书签停在 = （还没开始装）
念回来的是 = （还没念）

step 整趟灌进去，顺手收工
at: 13
say: `出口.write(货舱)` 把货舱里的字节**整趟灌进管子**；紧接的一行 `出口.close()` 收工。**写的那一头到这儿就完事了** —— 记住这一条，往下那一句才是今天的重点。
meow: 整趟灌进去，写这头收工啦！
pose: yay
货舱里的字节 = 26 个（都灌进文件了）
书签停在 = （还没开始装）
念回来的是 = （还没念）

step 换一根往外拉的管子，再备一只货舱
at: 16
say: 换方向：带上 `StandardOpenOption.READ` 开一根**往外拉**的管子。管子和文件之间搬东西，**中间必须过一只货舱** —— 所以要念，就得先备一只新的。
meow: 换根往外拉的管子，再备只货舱喵
pose: busy
货舱里的字节 = 新货舱，还空着（备了 26 格）
书签停在 = 0（第一格）
念回来的是 = （还没念）

step 照 size 备一只正好装得下的
at: 17
say: `ByteBuffer.allocate((int) 入口.size())` 照「管子里那头一共几个字节」备一只**正好装得下**的。刚备好的货舱，**书签停在第一格**，一个字节都还没进来。
meow: 货舱备好了，书签停在第一格喵
pose: expect
货舱里的字节 = （还没拉，货舱备好 26 格）
书签停在 = 0（第一格）
念回来的是 = （还没念）

step 拉进来：书签一路往前挪到末尾
at: 18
say: `入口.read(另一个)` 把字节**拉进货舱**：书签一路往前挪，26 个字节拉完，它停在 **26**。往里装的时候书签就是这么走的 —— 停在末尾，那意思是「本喵**写到这儿**了」。
meow: 拉进来 26 个字节，书签挪到末尾啦
pose: busy
货舱里的字节 = 26 个（都装进来了）
书签停在 = 26（末尾）
念回来的是 = （还没念）

step 要念，可书签正停在末尾
at: 19
say: 这一行要**念**货舱里的字节：`new String(另一个.array(), 另一个.position(), 另一个.remaining(), ...)` 读作「从**书签现在这个位置**起，取**还剩的这些**字节」。可书签此刻停在末尾 —— **从末尾往后取，一个字节都取不到**。
meow: 书签停在末尾，往后一个都取不到喵
pose: think
货舱里的字节 = 26 个（都装进来了）
书签停在 = 26（末尾）
念回来的是 = （取到 0 个字节）

step 印出来那一行数字，就是证据
at: 20
say: 第二行把书签的位置原样印出来：`货舱里的头一个位置：26`。**这行数字就是证据** —— 26 个字节明明都躺在货舱里，可书签停在末尾，「还剩的这些」是 **0 个**，取 0 个拼出来自然是个空字。
meow: 印出来真是 26，字节都还在躺着喵
pose: soothe
货舱里的字节 = 26 个（都装进来了）
书签停在 = 26（末尾）
念回来的是 = （一个空字）

step 要念之前，先补一句把书签拨回去
at: 19
say: 补上 `另一个.flip()`：它把**书签拨回开头**，同时记下「读到哪儿为止」。拨完 `position()` 是 `0`、`remaining()` 是 26 —— 这才是「从头念到写到的这儿」。记住这个动作：**写的那一头不用拨；要从货舱里念，先拨。**
meow: 念之前先拨回开头，26 个就都念得到喵
pose: remind
货舱里的字节 = 26 个（都装进来了）
书签停在 = 0（拨回第一格了）
念回来的是 = 小橘 3 条 / 狸花 5 条
```

这一脚**一个字都不红**：管子开了、字节拉了、程序跑完了，只是念出来是空的。所以往后记住这个动作：**「写」的那一头不用拨；一旦要拿货舱里的字节「念」，先 `flip()`。**

## 五、接着后面添：喊一声 `APPEND`

`Files.writeString` 默认是**从头写**：文件里原来有字，先擦干净再写。本喵写了两笔，第二笔就把第一笔盖掉了：

```java
import java.nio.file.Files;
import java.nio.file.Path;

public class Main {
    public static void main(String[] args) throws Exception {
        Path 门牌 = Path.of("账本.txt");

        Files.writeString(门牌, "小橘 3 条\n");
        Files.writeString(门牌, "狸花 5 条\n");

        System.out.println("念回来：");
        System.out.print(Files.readString(门牌));
    }
}
```

```text
念回来：
狸花 5 条
```

第一笔「小橘 3 条」不见了。想**接着后面添**，得在本喵这头**喊一声**：

```java
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class Main {
    public static void main(String[] args) throws Exception {
        Path 柜子 = Path.of("鱼塘");
        Files.createDirectories(柜子);
        Path 门牌 = Path.of("鱼塘", "账本.txt");

        Files.writeString(门牌, "小橘 3 条\n");
        Files.writeString(门牌, "狸花 5 条\n", StandardOpenOption.APPEND);

        System.out.println("一共几个字节：" + Files.size(门牌));
        System.out.print(Files.readString(门牌));
    }
}
```

```text
一共几个字节：26
小橘 3 条
狸花 5 条
```

两笔都在，一共 26 个字节。这一段里还有两件新东西：

- **`Files.createDirectories(柜子)`** —— 「这个柜子不在就先造一个」。它一路把中间缺的柜子都造出来；已经在的话也不翻脸，照样往下走。
- **`Path.of("鱼塘", "账本.txt")`** —— 门牌拼进柜子，就是第一节讲过的那一手。
- **`StandardOpenOption.APPEND`** —— 「接着后面添」。默认那三样（建、擦、写）里没有它，所以想要，得**在本喵这头喊出来**：它写在`writeString` 的**第三格**上（前两格是门牌和要写的字）。这个清单里常用的四样：`READ`（往外拉）、`WRITE`（往里灌）、`CREATE`（不在就建）、`APPEND`（接着添）。

## 六、门牌不在的时候，它会当场拦住本喵

`Files.readString` 是「一口气把整份文件念回来」。本喵要是念了一份**还没有的**文件：

```java
import java.nio.file.Files;
import java.nio.file.Path;

public class Main {
    public static void main(String[] args) throws Exception {
        Path 门牌 = Path.of("还没建的账本.txt");

        System.out.println(Files.readString(门牌));
    }
}
```

```text
Exception in thread "main" java.nio.file.NoSuchFileException: 还没建的账本.txt
```

原话读作：**「没有这份文件：还没建的账本.txt」**。它跟上一课那些「不红不响」的坑正好相反 —— 这一次它**当场拦住**，一个字都不含糊：念一份不存在的文件，它没法给本喵任何东西，所以干脆翻脸。

想让它「没有就先建一份」，得本喵自己先问一声：

```java
import java.nio.file.Files;
import java.nio.file.Path;

public class Main {
    public static void main(String[] args) throws Exception {
        Path 门牌 = Path.of("还没建的账本.txt");

        if (!Files.exists(门牌)) {
            Files.writeString(门牌, "空空如也\n");
        }

        System.out.println(Files.readString(门牌));
    }
}
```

```text
空空如也
```

`if (!Files.exists(门牌))` 读作「**要是不在**」，不在就先写一句进去（`writeString` 顺手把文件建出来）；回过头再念，念的就是刚写进去的那句。

::: warn 小心喵

- **忘了 `flip()`，念回来是空的**，而且一个字都不红。写的那一头不用拨，**要从货舱里念，先拨**。
- **`Files.writeString` 默认从头写。** 想接着添，必须喊 `StandardOpenOption.APPEND` —— 忘了它，前面的字**当场被擦掉**，同样不红不响。
- **`Files.readString` 碰上不存在的门牌会当场翻脸**（`NoSuchFileException`）。先问 `Files.exists`，或者干脆先 `writeString` 写一句进去。
- **`Files.createDirectories` 不翻脸**：柜子已经在，它照样往下走；所以不必先问在不在，直接造。
- **货舱要备够大。** 读的那一头最省事的备法就是照 `入口.size()` 备一只正好装下的；备小了，一趟拉不完，得来回好几趟。
- **`Files` 那几手是「一口气」**：文件不大时最省事，大文件还得回上一课那套一口一口的写法。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `Path.of("账本.txt")` | 撕一张写着位置的门牌 |
| `Path.of("鱼塘", "账本.txt")` | 门牌拼进柜子（分隔符它自己补） |
| `Files.exists(门牌)` | 问一声在不在，答 `true` / `false` |
| `Files.writeString(门牌, 字)` | 一口气写进去（**默认从头写**，不在就建） |
| `Files.readString(门牌)` | 一口气念回整份文件 |
| `Files.size(门牌)` | 这份文件**几个字节** |
| `Files.createDirectories(柜子)` | 柜子不在就先造 |
| `StandardOpenOption.APPEND` | 接着后面添 |
| `FileChannel.open(门牌, 规矩...)` | 开管子（READ / WRITE / CREATE） |
| `ByteBuffer.wrap(字节们)` | 拿现成字节糊一只货舱 |
| `ByteBuffer.allocate(n)` | 备一只装得下 n 个字节的货舱 |
| `.getBytes(StandardCharsets.UTF_8)` | 字变成字节们 |
| `另一个.flip()` | **把书签拨回开头**，准备念 |
| `另一个.position()` / `.remaining()` | 书签现在停在哪 / 还剩几个字节 |

## 小任务

1. 把第二节那段原样跑一遍，再把 `Files.writeString` 里的两行改成三行，看看 `Files.size` 报的数变了多少 —— 对上「字节数不是字数」这件事。
2. **把 `flip()` 那一句去掉**跑一遍，确认「念到：」后面真的是空的；再把 `position()` / `remaining()` 也印出来，跟本喵报的 `26` 对一眼。
3. 第五节的覆盖那一版，把第二手也喊上 `StandardOpenOption.APPEND`，验证两笔都在。
4. 撕一张 `Path.of("鱼塘", "深水区", "账本.txt")`，用 `Files.createDirectories` 把中间那层也造出来，再往里写一笔 —— 看看柜子是怎么一层层长出来的。
5. 把 `Files.readString` 换回上一课的写法（开管子、一口一口念）跑一遍，两种写法对同一份文件念出来的东西应该一模一样。

下一课，本喵一个人忙不过来：要**同时**派好几只猫去干同一件活 —— 一只猫管一个鱼塘，谁也不用等谁。到时候本喵会讲清楚「同时开工」到底是怎么发生的、每只猫的名字从哪儿来、以及它们闹起来的时候本喵怎么知道谁干完了喵。🐾
