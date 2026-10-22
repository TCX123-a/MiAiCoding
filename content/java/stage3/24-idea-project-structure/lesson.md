---
id: java-stage3-24
lang: java
stage: 3
order: 24
title: IDEA 里的大宅子——Project、Module、Package、Class
tags: [工具链, 工程组织]
required: ["java-stage3-20"]
compare: ["common-37"]
estMinutes: 20
keywords: [idea, project, module, package, class]
---

## 钩子：一按「新建」，左边长出一棵树

大肥鱼早年的习惯是把稿子全堆在同一只文件夹里。两百多只 `.java` 糊成一坨，想找「鱼缸打折」那只，得从第一只翻到第两百只。每次翻完它都要炸毛：「这代码写得太丑啦喵！」

后来它学乖了：新项目一律按 IDEA 的规矩摆。按下「新建项目」之后，左边栏立刻长出一棵小树 —— 这棵树不是摆设，它把「哪一摊是整只工程、哪一摊是子工程、哪一摊是哪间屋、哪一张是单独的图纸」交代得明明白白。今天本喵带你从树顶一层层往下钻。

## 一、四层大宅子：Project → Module → Package → Class

把左边那棵树从上往下数，一层一个身份：

- **Project（整只工程）**：这一摊子东西的总名，比如 `fish-farm`；
- **Module（子工程）**：整只工程里能**单独盖**的一栋楼，比如 `tank-core` 管鱼缸这一摊；
- **Package（包）**：一栋楼里的一间屋，比如 `com.fish.tank` 这间屋，住着和鱼缸有关的那批稿子；
- **Class（图纸）**：一张图纸画一只干活的小猫，住在一只 `.java` 稿子里，比如 `FishTank.java`。

四层的关系一句话就能记住：**工程里住楼房，楼里分屋子，屋里摆图纸**。摆成这样最大的好处是「找得到」—— 要动鱼缸那摊，顺着树钻三层就到，不用在两百只稿子里大海捞针。

先看一段会自己走路的演示，本喵带你一层层往下钻：

```demo
title: 四层大宅子：从工程一路钻到图纸
code:
| fish-farm                          ← ① Project：整只工程
| └── tank-core                      ← ② Module：能单独盖的子工程
|     └── src/main/java              ← ③ 放稿子的地方
|         └── com/fish/tank          ← ④ Package：一间屋，磁盘上一只文件夹
|             └── FishTank.java      ← ⑤ Class：一张图纸，住一只 .java 稿子

step 站到树顶：整只工程
at: 1
say: 树顶这一只叫 `fish-farm` —— 它是**整只工程**的名字。以后别人问「你那套鱼塘系统在哪」，你报的就是这个名字。
meow: 这就是本喵的窝喵！
pose: welcome
现在站在 = Project（整只工程）
再往下钻 = Module

step 往下第一层：子工程
at: 2
say: `tank-core` 是鱼缸这一摊的**子工程**。它的好处是「能单独盖」：鱼缸这套逻辑将来可以整栋搬走，塞进别的工程里照样盖得起来。
meow: 一栋楼，能单搬喵！
pose: guide
现在站在 = Module（tank-core）
再往下钻 = 放稿子的地方

step 路过稿子的家
at: 3
say: `src/main/java` 是稿子的家 —— 你以后写的每一只 `.java` 都从这儿往下长。它上面那截 `src` 是「稿子」这一大类，别嫌它烦，下一课你就会知道它为什么必须长这样。
meow: 稿子都住这里喵。
pose: think
现在站在 = src/main/java（稿子的家）
再往下钻 = Package

step 找到那一间屋
at: 4
say: `com/fish/tank` 三层文件夹，对上的正是**包名** `com.fish.tank` —— 点号换成斜杠，一段包名一只文件夹。同一间屋里的稿子，彼此打招呼可以省掉屋号，这就是包的第一层好处。
meow: 一间屋，认门牌喵！
pose: expect
现在站在 = Package（com.fish.tank）
再往下钻 = Class

step 屋里面那张图纸
at: 5
say: 最底下躺着 `FishTank.java` —— 一张**图纸**，画着鱼缸该记什么、该干什么。四层钻到底，你终于摸到以后真正要动手写的那一层了。
meow: 找到你啦，图纸喵！
pose: milestone
现在站在 = Class（FishTank）
再往下钻 = （没有了，这就是最底下的一层）
```

看完演示，本喵把这四层真跑一遍念给你听 —— 这段小稿子把每一层的「身份证」都打了出来：

```java
public class Main {
    static void 报一层(String 称号, String 名字, String 说明) {
        System.out.println(称号 + "：" + 名字 + "（" + 说明 + "）");
    }

    public static void main(String[] args) {
        报一层("Project", "fish-farm", "整个工程");
        报一层("Module", "tank-core", "一栋楼，能单独盖的子工程");
        报一层("Package", "com.fish.tank", "一间屋，磁盘上一个文件夹");
        报一层("Class", "FishTank", "一张图纸，住一个 .java 文件");
    }
}
```

```text
Project：fish-farm（整个工程）
Module：tank-core（一栋楼，能单独盖的子工程）
Package：com.fish.tank（一间屋，磁盘上一个文件夹）
Class：FishTank（一张图纸，住一个 .java 文件）
```

四行对上四种身份，一行都不多。顺手记两件小事喵：

- **这四层是「从大到小」排的**：工程最大，图纸最小。今后说「包坏了」还是「工程坏了」，差的是整整两层楼，别混着喊；
- **层数不是死数**：小练习一只工程一个子工程就够；将来活儿大了，一栋楼盖不住，再加一栋 `billing-core` 就行 —— 树会自己长，规则不变。

## 二、`src` 里为什么还有两层

细心的猫会问：都到家门口 `tank-core` 了，为什么还要钻 `src`、`main`、`java` 三层才轮到包？这台阶不是 IDEA 乱加的，是管家们认的**统一尺寸**（下一课的 Maven、Gradle 都按这个尺寸上门）：

- `src` ＝ 稿子住的地方（跟它并列的还有放产物的窝，比如 IDEA 自己收拾出来的 `out`，那都是机器的地盘）；
- `main` ＝ 正戏那一套稿子（旁边还站着 `test` 那套，专门住 23 课那种「给招式定期体检」的稿子）；
- `java` ＝ 「这门语言的稿子放这儿」（一个工程里混着别的语言的稿子时，各住各的屋）。

`java` 再往下，就是包的世界了。包名 `com.fish.tank` 落到磁盘上，点号换成斜杠，一段一只文件夹，一层套一层：

```text
tank-core/
└── src/
    └── main/
        └── java/
            └── com/
                └── fish/
                    ├── tank/
                    │   └── FishTank.java
                    └── feed/
                        └── FeedLog.java
```

两只稿子住在 `tank` 和 `feed` 两间屋里，它们上面的 `com/fish` 是一样的 —— 这就是「同一个大院子里的两间屋」。IDEA 里想添一间新屋，不必手动建三层文件夹：在 `java` 上右键 → 新建 → 包，敲 `com.fish.feed` 回车，三层文件夹一次长齐。

反过来，如果包名跟文件夹对不上（比如稿子里写着 `package com.fish.feed;`，人却住在 `tank` 屋里），IDEA 会当场给你标红提醒。这条规矩你现在只需记住一句话：**包名就是文件夹的路，对着写，别拧着来**。

## 三、新建项目向导背后，发生了什么

「新建项目」那一屏向导不是随便问的，它问的每一句都对应着树上的一件实物：

- **名字和存放位置** → 树顶那层文件夹（`fish-farm`）；
- **语言** → 决定稿子屋叫 `java` 还是别的；
- **构建系统**（Maven / Gradle / 先不选） → 决定往工程根上放哪张「菜单」：`pom.xml` 或 `build.gradle`（下一课的主角，今天先认个脸）；
- **JDK 版本** → 决定「用哪套工具翻稿子」（一柜子工具版本可以并存，工程各挑各的）；
- 按下「创建」之后，它还会顺手摆好 `.idea/` 配置、长出 `src/main/java` 这条台阶、再放一只能跑的主稿子让你先试水。

一句话总结向导的边界：**它只替你搭台子，不替你唱戏**。台子搭好之后，`FishTank.java` 里写什么、`com.fish.tank` 屋里住几间房，全是你的事。

## 四、那张公开图纸，为什么必须和文件同名

四层里最容易让新手栽跟头的是最底下这层：**公开的那张图纸，名字必须和稿子文件名逐字相同**。

先看一段本喵真跑过的小稿子。它的文件叫 `Main.java`，里面却住了**两张**图纸 —— 一张公开的 `Main`，一张捎带的 `Sunfish`：

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("公开的那张图纸：" + Main.class.getSimpleName());
        System.out.println("捎带在同一个文件里的另一张：" + Sunfish.class.getSimpleName());
        System.out.println("所以文件叫：" + Main.class.getSimpleName() + ".java");
    }
}

class Sunfish {
}
```

```text
公开的那张图纸：Main
捎带在同一个文件里的另一张：Sunfish
所以文件叫：Main.java
```

三条规矩从这三行里全读得出来：

- **一只能有公开**：一只稿子里最多住一张「公开的图纸」（写 `public` 的那张），其余的只能当陪住；
- **公开的必须同名**：图纸叫 `Main`，文件就得叫 `Main.java`。名字对不上时，翻译官喵连门都不敲，直接甩一句「这张公开的图纸得住进同名文件里」；
- **文件按公开那张命名**：所以「文件叫 Main.java」不是本喵手写的，是照着公开那张的身份证念出来的。

那为什么非要对上不可？因为翻译官喵找人时手里只有**文件名**。你让它翻 `Main.java`，它就按「公开图纸叫 `Main`」这个约定去屋里认人 —— 名字能对上，才敢动手。IDEA 里新建图纸时会自动起一张同名稿子；要改名字，记得走它的「重命名」（对着名字按 `Shift + F6`），文件名和图纸名会一起改，别手动改一半留一半。

::: warn 小心喵
新手最常踩的坑：手动把文件名敲改了、图纸名忘了改（或者反过来）。对着报错一脸懵的时候，先看这一对名字是不是**逐字一模一样** —— 大小写也算数，`main` 和 `Main` 在它眼里是两只猫。
:::

## 五、工具窗巡查：运行结果和命令行住哪一栏

台子搭好，本喵再带你认三只天天要用的**工具窗** —— 界面上每一摊专门管一件事的小窗口，都叫工具窗：

- **Project**：开头那棵树就在这只窗里，默认蹲在**左边栏**；哪天它不见了，菜单 View → Tool Windows → Project 把它请回来；
- **Run**：**底部**。按下运行之后，程序印出来的每一行都落在这儿 —— 觉得「点了运行怎么没反应」的时候，先低头看它一眼；
- **Terminal**：也在**底部**，Run 的隔壁，是敲命令的窗口（菜单 View → Tool Windows → Terminal 请出来）—— 以后有工具没有面板按钮，就得从这儿喊它开工。

三只都只是观察台：关掉再请回来，稿子一根毛都不会少。

## 小任务

在 IDEA 里新建一只 Java 工程，名字叫 `fish-farm`，然后做三件事：

1. 顺着左边那棵树，把四层挨个指认一遍（工程名、子工程、`src/main/java`、包、图纸）；
2. 在 `java` 上右键新建一只包 `com.fish.tank`，看三层文件夹怎么一次长齐；
3. 把向导给的主稿子重命名成 `FishTank`（对着名字按 `Shift + F6`），盯住左边的文件名 —— 它跟着变了没有？

🐾 下一课本喵请出「管家」：一只工程几百只稿子、还要用别人写好的现成零件时，手敲命令就彻底不够看了 —— 看看 `pom.xml` 这张菜单是怎么把「翻稿子、体检、打包」一条龙安排好的。
