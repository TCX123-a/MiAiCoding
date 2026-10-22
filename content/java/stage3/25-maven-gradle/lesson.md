---
id: java-stage3-25
lang: java
stage: 3
order: 25
title: 管家与采买——Maven 与 Gradle 入门
tags: [工具链, 工程素养]
required: ["java-stage3-24"]
compare: ["common-38"]
estMinutes: 22
keywords: [maven, gradle, pom, wrapper, dependency]
---

## 钩子：手敲命令的年代，是怎么撑不住的

二十课之前，本喵跑稿子就两下：先请翻译官喵翻一遍（`javac`），再喊它跑一遍（`java`）。一只稿子这么来还行，可你想想上一课那棵树的规模：两百只稿子互相打招呼、还要用别人写好的一大堆现成零件 —— 手敲的话得敲到爪子冒烟。

更麻烦的是「别人写好的零件」：去哪里拿、拿哪个版本、拿回来放哪、换了台电脑怎么再来一遍 —— 全是琐事，还全是**每次都要**做的琐事。大肥鱼把爪子一摊：「这活该交给管家喵！」

管家有两位：一位叫 **Maven**，一位叫 **Gradle**。今天先把它们干的事弄明白。

## 一、管家替本喵扛的三件事

**第一件：采买。** 你想要别人写好的零件，不用去官网翻下载页，只要在菜单上写一行「我要谁家的、叫什么、哪个版本」，管家就自己去**中央仓库**（全世界的公开货架）取回来，存进你本机的**库房**。下一只工程再用到同一件，库房里有货，直接取。

**第二件：摆结构。** 上一课那条 `src/main/java` 的台阶，你以为是 IDEA 的爱好？其实这是管家认的**统一尺寸**。全世界用同一套尺寸的好处：拿到别人的工程，不用问路就认得门。

**第三件：一条龙。** 「清场 → 翻稿子 → 给招式体检 → 打包」这套流水活，各自只有一条命令：`clean`、`compile`、`test`、`package`。你不用记先翻哪只后翻哪只，管家按顺序替你走完。

## 二、`pom.xml`：工程的菜单

管家干活前先读菜单。Maven 的菜单叫 `pom.xml`，就摆在工程根上，长这样：

```text
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.fish</groupId>
  <artifactId>tank-core</artifactId>
  <version>1.0.0</version>
  <packaging>jar</packaging>

  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
```

本喵替你划四处重点喵：

- **打头一行 `modelVersion`，照抄 `4.0.0` 就行**：它说的是「这份菜单按哪版格式写」，跟底下那个说「第几版」的 `version` 是两回事 —— 每个 pom 都得带着它，少了它管家读菜单时会报错；
- **接着三行是「报户口」**：`groupId`（这家姓什么）、`artifactId`（这一摊叫什么）、`version`（第几版），合起来就是这件东西的**坐标**。全世界范围里，这副坐标指到你家的这一摊，独一无二；
- **`dependencies` 是采买单**：里面每一件零件，也照同样的三件套报坐标。菜单上只写「要什么」，**不写去哪拿** —— 去哪拿是管家的事；
- **`<scope>test</scope>`**：这件零件只在「给招式体检」的时候上场，正式打包不带上它 —— 相当于跟管家说「这是体检专用，别放进外卖箱」。

菜单是用一只「箱子语言」写的 —— 尖括号一层套一层，谁在谁肚子里一眼就看得出。

## 三、坐标与库房：依赖从哪来

把上一节那副坐标真跑一遍，看看管家把它翻译成了什么。本喵这段小稿子干的活：拼出坐标、再拼出「它在本机库房里睡的格子」：

```java
public class Main {
    public static void main(String[] args) {
        String groupId = "com.fish";
        String artifactId = "tank-core";
        String version = "1.0.0";

        System.out.println("坐标：" + groupId + ":" + artifactId + ":" + version);

        String 库房格子 = groupId.replace(".", "/") + "/" + artifactId + "/" + version + "/"
                + artifactId + "-" + version + ".jar";
        System.out.println("本机库房里，它睡的格子：");
        System.out.println(库房格子);
    }
}
```

```text
坐标：com.fish:tank-core:1.0.0
本机库房里，它睡的格子：
com/fish/tank-core/1.0.0/tank-core-1.0.0.jar
```

三行结果就是采买的全流程喵：

- **坐标**用冒号连成一根线：`com.fish:tank-core:1.0.0`。你写在菜单上的就是它；
- 管家拿着坐标去**中央仓库**（或者国内的**镜像** —— 同样的货架，换一条更近的路）取货；
- 取回来存进本机库房时，地址有固定规矩：`groupId` 的点号换成斜杠，再挂上名字、版本，最后那份货本身叫「名字-版本.jar」。**格子是算出来的**，所以下次要找同一件，不用翻账本，报坐标就能算到门前。

一句大实话收尾这一段：这套「坐标 + 库房」的规矩不只为省事 —— 它让**没网的机器也能重复构建**（库房里有货），也让**换台电脑能原样重来**（报上坐标自动补齐）。这是「工程素养」里最硬的一块地基。

## 四、`mvnw`：项目自带的小管家

看到这里你可能会问：那本喵得先装一个 Maven 吗？不一定要 —— 现在 IDE 生成的新工程一般都会自带一名**小管家**：

```text
tank-core/
├── pom.xml            ← 菜单
├── mvnw               ← 小管家脚本（Linux / macOS 那份）
├── mvnw.cmd           ← 小管家脚本（Windows 那份）
├── .mvn/
│   └── wrapper/       ← 小管家自己的家当
│       └── maven-wrapper.properties
└── src/
    └── main/java/ ...
```

这几只文件合起来叫 **wrapper**（小管家）。它的本事：别人拿到你的工程，就算机器上**一只 Maven 都没装**，敲一下自带的小管家脚本，它会照 `.mvn/wrapper/` 里记的版本，自己去取一份合尺寸的回来干活。版本还钉得死死的 —— 你的机器和同事的机器跑出来一模一样，「我这儿好好的呀」这类糊涂官司少掉一大半。

本喵这台开发机上就没装独立的 Maven 命令，所以接下来所有操作都走 IDEA 的面板（下一节细说）。等哪天你要在别的机器上跑，认准这两只就对了：Windows 上是 `mvnw.cmd`，别的系统上是 `mvnw`。

## 五、Gradle：换了位管家，活还是一家

另一位管家 Gradle 干的是同一家的事，只是换了一套写法：菜单从 `pom.xml` 变成 `build.gradle`，小管家脚本从 `mvnw` 变成 `gradlew`：

```text
tank-core/
├── build.gradle       ← 还是菜单，就是换了写法
├── gradlew            ← 小管家脚本（Linux / macOS 那份）
├── gradlew.bat        ← 小管家脚本（Windows 那份）
├── gradle/
│   └── wrapper/
│       └── gradle-wrapper.properties
└── src/
    └── main/java/ ...
```

```text
plugins {
    id 'java'
}

group = 'com.fish'
version = '1.0.0'

repositories {
    mavenCentral()
}

dependencies {
    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'
}
```

对照着读一眼就懂：`group` 加 `version` 还是「报户口」，`repositories` 说「去哪些货架取货」，`dependencies` 还是采买单，坐标直接写成一根冒号连的线。两位管家说的是同一套坐标语言，也常去同一排远程货架（`mavenCentral()` 指的就是 Maven Central 那家）；本地库房其实各用各的 —— 想在 Gradle 里翻 Maven 的本地存货，得在 `build.gradle` 里显式写一行 `mavenLocal()`，那不是默认，官方也不推荐拿它当常规来源。

选谁？眼下你只要记住：**新工程选谁都不亏，满世界两种都有人用**。别在「选哪个」上纠结太久，先把「菜单 + 坐标 + 库房」这套通用语言练熟。

## 六、在 IDEA 里把这一套跑一遍

本机没装独立 Maven，那就在 IDEA 里按：新建项目时「构建系统」选 Maven，创建完看右边竖栏 —— 大概率已经趴着一只「Maven」面板（没有的话，菜单 View → Tool Windows → Maven 把它请出来）：

- 展开面板能看到 `Lifecycle`，底下排着 `clean`、`compile`、`test`、`package` 一排动作。**双击 `package`** 就是让管家走一遍「翻稿子 → 体检 → 打包」；
- 双击 `clean` 是把上次的产物清场。两位管家都讲卫生，构建前清场是常规动作；
- 改了 `pom.xml` 之后，面板左上那只「重新加载」的转圈小图标点一下 —— 让管家**重新读一遍菜单**。不点的话，你新加的零件它还没听说过。

这一套跑完，你会在工程里看到一个新的文件夹 `target/`（Gradle 那边叫 `build/`）—— 打包出来的东西就躺在里面。它是机器自己收拾的窝，**别手动往里塞稿子**：管家下次清场会毫不留情地把它抹平。

::: warn 小心喵
`pom.xml` 里坐标敲错了，右栏里那件零件会标红 —— 先别慌，多半是拼写或版本写歪了。改完之后记得点「重新加载」，再等管家把货取回来。另外，别拿别人工程里的坐标三件套照抄，那报的是**别人家**的户口，你抄来只会取到别人的货（或者取不到）。
:::

## 小任务

在 IDEA 里新建一只 Maven 工程，叫 `fish-farm`，然后做四件事：

1. 找到根上的 `pom.xml`，把报户口的三件套抄进自己的笔记 —— 它们就是你这一摊在全世界的门牌；
2. 把 `<version>` 从默认的 `1.0-SNAPSHOT` 改成 `1.0.0`，保存；
3. 点「重新加载」，看面板里的名字跟着变了没有；
4. 到 Maven 面板里先双击 `clean`、再双击 `package`，跑到 `target/` 里看看多了什么。

::: tip 猫咪提示
今天记住三句话：**菜单**（`pom.xml` / `build.gradle`）写「要什么」；**坐标**（三件套）在全世界指认「是哪一件」；**库房 + 小管家脚本**保证「换台机器照样能重来」。下一课本喵把尺子掏出来 —— 有了大宅子、有了管家，代码里的名字该按什么规矩起？大肥鱼的祖传文件要挨罚了喵。
:::

🐾 到此，工程就算搭起来了。可大肥鱼瞟了一眼稿子里的名字，炸毛的声音已经传过来了：「`zheKouLv` 是什么鬼？！」—— 下一课，阿里那把尺子出场。
