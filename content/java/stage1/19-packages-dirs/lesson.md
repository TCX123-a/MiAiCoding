---
id: java-stage1-19
lang: java
stage: 1
order: 7
title: 抽屉要摆对货架——包与目录的物理映射
tags: [工具链, 包]
required: ["java-stage1-16"]
compare: ["common-35"]
estMinutes: 15
keywords: [package, import, 目录, 全名]
---

## 钩子：包名不是咒语，是一张地址

上一课本喵说过：Java 的现成图纸太多，索性**按箱子分开装**——那种箱子叫**包**，`java.util`、`java.lang` 都是。当时你认识的只是「箱子」这个概念；今天要补的，是它**在硬盘上的真身**。

剧透一句：包**不是**什么虚拟咒语——它就是你文件夹里一层层的**文件夹**。包名 `com.fish.tank` 里的每一个点，点一下就是往下一层。今天这课讲的就是这张**点 ⇄ 斜杠**的对照表，外加一个新手最容易摆歪的地方：稿子自报的家门和它真实的住址，**必须对得上**喵。

## 包名怎么变出文件夹

两张「门牌」摆一起，一眼就懂：

```text
包名    com.fish.tank      ← 用点，念给翻译官喵听
路径    com/fish/tank/     ← 用斜杠，写给文件系统看
```

规矩一句话：**包名 `a.b.c` 就住 `a/b/c/` 三层文件夹**——点换斜杠，一层不落。`java.util` 也一样，它住的文件夹就叫 `java/util/`。

口诀不用死记，让程序替本喵念一遍：

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("包名里用点：com.fish.tank");
        System.out.println("文件夹里用斜杠：com/fish/tank");
    }
}
```

```text
包名里用点：com.fish.tank
文件夹里用斜杠：com/fish/tank
```

（这段先按单文件跑——真正的「抽屉」怎么摆、`package` 声明怎么和对，下一节就讲喵。）

## `package` 声明：稿子进门先报家门

稿子住进抽屉之后，第一行要**自报家门**。这个写法本课第一次登场：

```text
package com.fish.tank;
```

这就叫 **`package` 声明**——规则整整三条，一条都不能少：

1. **住顶上**：写在文件最顶上，比 `import` 还靠前。整个文件它是第一句；
2. **只一句**：一份稿子只自报一次家门；
3. **严丝合缝**：点对点、层对层——声明是 `com.fish.tank`，稿子就得真住在 `com/fish/tank/` 里。

于是本课的主角稿子长这样（住址：`com/fish/tank/`）：

```text
package com.fish.tank;

public class Main {
    public static void main(String[] args) {
        System.out.println("小鱼干进仓，三层抽屉都归位了喵");
    }
}
```

## 编译与喊人：一个用路径，一个用全名

站在**包树的根**上（也就是 `com` 的上一级文件夹，本喵叫它 `src/`），先看稿子住进来之前的样子：

```text
src/
└─ com/
   └─ fish/
      └─ tank/
         └─ Main.java
```

好，翻稿——这一版命令里带上了路径：

```text
javac com/fish/tank/Main.java
```

翻完一如既往一声不吭。别急着念，先看一眼抽屉：

```text
src/
└─ com/
   └─ fish/
      └─ tank/
         ├─ Main.java
         └─ Main.class      ← 新邻居：产物落在稿子旁边
```

你瞧，`Main.class` 也住进了 `com/fish/tank/` 里——**产物跟着稿子的抽屉走**。

现在喊人。注意喊法变了：翻稿用**路径**，喊人用**全名**：

```text
java com.fish.tank.Main
```

念稿员顺着 `com` → `fish` → `tank` 一层层找进去，把 `Main.class` 念出声：

```text
小鱼干进仓，三层抽屉都归位了喵
```

（顺带一提：地址栏上你偶尔会见到反斜杠的写法，本喵这课统一用正斜杠 `/`，一条路走到底，不容易错喵。）

## 摆错抽屉会怎样：翻稿不吭声，喊人现原形

本喵故意捣一次乱：把稿子**留在根目录**，可第一行照样写着 `package com.fish.tank;`——声称住在 `tank`，人却站在大门口。

先翻：

```text
javac Main.java
```

翻译官喵**一声不吭**——直接翻这一份文件时，它不核对「你住哪间」，照翻不误；产物也随了稿子，`Main.class` 落在了根目录里。它俩谁都没觉得不对劲。

再照课文里那样喊人：

```text
java com.fish.tank.Main
```

```text
Error: Could not find or load main class com.fish.tank.Main
Caused by: java.lang.ClassNotFoundException: com.fish.tank.Main
```

念稿员按包名的地址去 `com/fish/tank/` 里找，翻了半天——那儿是空的，它当然找不着。

不死心，再试一句光秃秃的名字：

```text
java Main
```

```text
Error: Could not find or load main class Main
Caused by: java.lang.NoClassDefFoundError: Main (wrong name: com/fish/tank/Main)
```

这回更逗：它在根目录**摸到了一张** `Main.class`，打开一看，里面自报的家门写着 `com.fish.tank.Main`——和喊的名字对不上，`(wrong name: ...)` 说的就是这个。

看出来了吗：**翻译官喵不管地址，念稿员才管**。所以「声明和目录严丝合缝」不是形式主义，它俩合起来是一套**地址系统**——声明是稿子写的寄信地址，抽屉是它真实住的地方。地址对不上，信就寄不到喵。

## 同名图纸的麻烦：全名就是地址

现在你能明白「包」为什么值得存在了。假设对面的河里还住着一缸鱼，包名 `com.fish.river`，它家也画了一张叫 `Main` 的图纸——两份同名的稿子，各住各的抽屉：

```text
java com.fish.tank.Main
java com.fish.river.Main
```

两条命令各找各的，谁都不打架。重名的底气不在名字本身，在**地址**：全名 = 抽屉地址 + 图纸名，两份 `Main` 的抽屉地址不一样，喊全名就谁也不认错。第 6 课那句「简名一旦打架，就老老实实写全名」，全名的尾巴长什么样，今天算是见着真身了喵。

## 回头补第 6 课的一个尾巴：`import` 里的地址

`import` 后面那串东西，其实就是地址：

```text
import com.fish.river.Main;
```

翻译官喵看到这行，就按 `com` → `fish` → `river` 一层层找过去，把那份 `Main` 登记成本文件里的简名——第 6 课说过，`import` 只负责省字，现在你知道它省的这一笔，去哪个抽屉取的货了。而喊人的时候没有 `import` 可用，就把全名报完整：`java com.fish.tank.Main` 就是**全名喊人**的写法喵。

## 一步一步看：抽屉归位

整条链路本喵拆成四步，走给你看：

```demo
title: 抽屉归位
code:
| com/fish/tank/
| package com.fish.tank;
| javac com/fish/tank/Main.java
| java com.fish.tank.Main

step 摆抽屉：先把三级文件夹建出来
at: 1
say: 稿子还没搬，先建出 `com` → `fish` → `tank` 三级文件夹——在文件管理器里一层层点出来就行。记住名字的来路：包名 `com.fish.tank` 里的点，就是这三级的台阶喵。
meow: 三层抽屉，先摆好喵～
pose: guide
抽屉 = com/fish/tank/（刚建好）
稿子 = （还没搬进来）
屏幕上 = （空）

step 报家门：稿子第一行写 package
at: 2
say: 把稿子搬进最里层的 `tank/`，第一行敲上 `package com.fish.tank;`——点对着点，和抽屉地址严丝合缝。这是写给翻译官喵的进门第一句话：「本喵住这三层楼里」。
meow: 第一行报家门，点对点喵！
pose: busy
抽屉 = com/fish/tank/
稿子第一行 = package com.fish.tank;
屏幕上 = （空）

step 翻稿：命令里走路径
at: 3
say: 翻稿用**路径**：`javac com/fish/tank/Main.java`，从头到脚斜杠分层。翻完屏幕上又是一声不吭——去抽屉里找找，`Main.class` 已经挨着稿子落好座了喵。
meow: 斜杠翻稿，产物跟着抽屉走！
pose: busy
抽屉 = com/fish/tank/（多了一份 Main.class）
稿子第一行 = package com.fish.tank;
屏幕上 = （空）

step 喊人：全名点连点
at: 4
say: 喊人用**全名**：`java com.fish.tank.Main`，点连起来报完整。念稿员一层层找进去，把 `Main.class` 念出声——抽屉归位，开饭喵。
meow: 点喊人，归位开饭！
pose: yay
抽屉 = com/fish/tank/
稿子第一行 = package com.fish.tank;
屏幕上 = 小鱼干进仓，三层抽屉都归位了喵
```

## 小任务

1. 照课文摆三层抽屉：建出 `com/fish/tank/`（在文件管理器里一层层点就行）；
2. 把带 `package com.fish.tank;` 的那段稿子放进 `tank/`，站在根上敲 `javac com/fish/tank/Main.java`，看看 `Main.class` 落在哪一层；
3. 敲 `java com.fish.tank.Main`，听见那句「归位」；
4. 捣乱一次：把稿子挪回根目录，两条命令照旧走——这回**谁不吭声、谁翻脸**？课文里两条报错原话都给你抄好了，对着看喵。

下一课是算式摊子——`+ - * /` 这些运算符排队登场，还有一个专门用在文字上的 `+` 猫腻，本喵先卖个关子喵～ 🐾
