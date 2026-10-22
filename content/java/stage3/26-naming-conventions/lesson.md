---
id: java-stage3-26
lang: java
stage: 3
order: 26
title: 阿里巴巴的尺子——Java 命名规范精讲
tags: [代码规范, 工程素养]
required: ["java-stage3-25"]
compare: ["common-41"]
estMinutes: 26
keywords: [upper-camel, lower-camel, constant, pinyin, alibaba]
---

## 钩子：大肥鱼翻出了祖传文件

大肥鱼今天收拾老仓底，翻出一只当年写的「订单服务」稿子，本喵凑过去看了头四行：

```text
public class order_service {
    private int zheKouLv;
    private String UserName;
    public static final int maxCount = 100;
```

它把爪子往文件上一拍，炸毛声传遍了鱼塘：「这代码写得太丑啦喵！」—— 同一个文件里，四个名字四套写法：一只全小写加下划线，一只拿拼音凑数，一只首字母大写，一只连常量都小写开头 —— 到底听谁的？

本喵把尺子往桌上一拍：「这就是缺一把统一尺子的下场。今天这把尺子，全国都在用。」

## 一、尺子从哪来：《阿里巴巴 Java 开发手册》

每家公司都该有自己的规矩，可要是一家一家从头立，人早就累跑了。于是国内 Java 圈最普及的一把公用尺子，是阿里把多年踩过的坑整理成的《阿里巴巴 Java 开发手册》—— 免费公开，成了行业里默认的参考。它把每条规矩分为两级：**【强制】**（没得商量，不达标就过不了评审）和 **【推荐】**（该这么做，个别场合可以说明理由）。

为什么企业肯花力气立这把尺子？因为代码被**读**的次数，远远多过被**写**的次数 —— 一只文件写一次，能被同事、被评审、被半年后的自己翻上几十遍。统一的尺子让「别人的代码」读起来像「自己写的」，这才是它最大的收益。

手册里和名字有关的几条【强制】，本喵摘给你看（节选，例子保留原样）：

```text
【强制】类名使用 UpperCamelCase 风格，必须遵从驼峰形式，但以下情形例外：DO / BO / DTO / VO / AO / PO / UID 等。
正例：ForceCode / UserDO / HtmlDTO / XmlService / TcpUdpDeal / TaPromotion
反例：forcecode / UserDo / HTMLDTO / XMLService / TCPUDPDeal / TAPromotion

【强制】方法名、参数名、成员变量、局部变量都统一使用 lowerCamelCase 风格，必须遵从驼峰形式。
正例：localValue / getHttpMessage() / inputUserId

【强制】常量命名全部大写，单词间用下划线隔开，力求语义表达完整清楚，不要嫌名字长。
正例：MAX_STOCK_COUNT / CACHE_EXPIRED_TIME
反例：MAX_COUNT / EXPIRED_TIME

【强制】包名统一使用小写，点分隔符之间有且仅有一个自然语义的英语单词。包名统一使用单数形式，但是类名如果有复数含义，类名可以使用复数形式。
正例：com.alibaba.ai.util / com.alibaba.trade.core

【强制】杜绝完全不规范的缩写，避免望文不知义。
反例：AbstractClass 缩写成 AbsClass；condition 缩写成 condi。

【强制】命名时严禁使用拼音与英文混合的方式，更不允许直接使用中文的方式。
正例：alibaba / taobao / youku / hangzhou 等国际通用的名称，可视同英文。
反例：DaZhePromotion [打折] / getPingfenByName() [评分]。
```

下面一节一节拆开讲喵。

## 二、图纸的名字：大驼峰

图纸的名字用**大驼峰**（UpperCamelCase）：每个单词的首字母都大写，像骆驼背上一串驼峰 —— `FishTank`、`OrderService`、`XmlService`。别用下划线，别全小写：`order_service`、`fish_tank` 都在这条线外。

有一条最容易栽的细节：**缩写词也按普通单词处理**。手册把 `XMLService` 明确列进反例，正例是 `XmlService` —— 因为一串大写字母堆在一起，读的人得停下来数它是哪几个词；按普通单词写，一眼就能读出来。同理：`HtmlDTO` 对，`HTMLDTO` 错；`TcpUdpDeal` 对，`TCPUDPDeal` 错。只有 `DO / BO / DTO / VO / AO / PO / UID` 这一小串行业里用滥的缩写，手册特许它们大写到底 —— 记住这串名单，别自己发明新的缩写。

## 三、方法与字段：小驼峰

招式（方法）的名字和字段的名字，用**小驼峰**（lowerCamelCase）：首字母小写，后面的单词首字母大写 —— `getHttpMessage`、`countFish`、`discountRate`、`userName`。

再补两条手感：

- **招式用动词开头**：`countFish`、`useTank`、`getUserName` —— 说得出「它干什么」，比 `fishData`、`tankInfo` 这类名词强得多；
- **字段用名词**：`discountRate`、`userName`，因为它是一格存货，不是动作。

下划线在这儿是**禁区**：`use_tank` 这种写法是别的语言的习俗（Python 圈、C 圈就这么写），Java 里照样能编过、照样能跑，但在评审席上特别扎眼。另外 `_tempFlag`、`$money` 这种拿 `_` 或 `$` 打头的名字也趁早别用 —— 那是上几个年代留下的遗风，能编过，但不体面。下一节你会亲眼看到：连这种名字机器都照收。

## 四、常量：全大写加下划线

跨过整个程序都不变的值，叫**常量**，规矩是全大写，单词之间用下划线 `_` 隔开：`MAX_STOCK_COUNT`、`CACHE_EXPIRED_TIME`。手册还嫌 `MAX_COUNT` 太短 —— 它要的是**语义完整**：这只上限管的是什么？`MAX_STOCK_COUNT` 里的 `STOCK` 就把它说清楚了，别嫌名字长。

挨着这条还有一只小兄弟：写 `long` 或者 `Long` 的初始值，后缀要用**大写的 `L`**，不能写小写 `l` —— `100L` 对，`100l` 不合规（翻译官喵不会拦它 —— 又是机器不管、尺子管的一例）。理由特别实在：小写 `l` 和大写 `I`（还有数字 `1`）在小字号的屏幕上一模一样，`l` 和 `1` 打架的事故，前辈们都见过。

## 五、数字开头：那条编都编不过的红线

前面的规矩都能编过、能跑，只是体面问题。这一条不一样：**名字不能以数字开头**，它会当场拦住你。本喵写一只故意犯错的稿子试试：

```java
public class Main {
    public static void main(String[] args) {
        int 2Fish = 1;
        System.out.println(2Fish);
    }
}
```

翻译官喵当场犯难：

```text
Main.java:3: error: not a statement
        int 2Fish = 1;
Main.java:3: error: ';' expected
Main.java:4: error: ')' or ',' expected
Main.java:4: error: ';' expected
4 errors
```

一条坏名字，挨了**四条**报错 —— 别被数量唬住，源头只有一个：名字的**第一个符号是数字**。翻译官喵读稿子第一步是切词，它看到 `2Fish` 会先把它当**数字**切出来，读到后面的 `F` 才发现不对，只好开始猜「你大概想写个数、后面应该跟分号吧」，一路猜歪，冤枉的报错就跟着来。源头其实就一句话：名字可以由字母、数字、下划线、`$` 组成，但**头一个符号**必须是字母、`_` 或 `$` —— 数字往后站，就没事。

顺带把两句话钉牢：这一条和「丑不丑」无关，是「机器读不读得懂」；`fish2Tank` 数字在中间，完全合规。

## 六、拼音、中文与中英混拼

回到手册里那两条：拼音与英文不许混着用，更不许直接写中文。为什么这么狠？拿祖传文件那只 `zheKouLv` 说：读的人第一遍得在脑子里把拼音翻译回「折扣率」，第二遍才轮到想业务；换成 `discountRate`，一步到位。更麻烦的是拼音没有音调，同音能挂七八种意思，`shiYan` 到底是实验、试验还是誓言？再过半年，写它的人自己都答不上来。

有一类错比纯拼音**更坏**：中英混拼 —— `getPingfenByName` 这种半英半拼的名字，读的人得一只眼睛读英文、一只眼睛读拼音，脑子当场打结。要不全英文，要不这个坎过不去。

可是话说回来 —— 机器一点不在乎。本喵把三种丑名字凑在一只稿子里真跑了一遍：

```java
public class Main {
    public static void main(String[] args) {
        int zheKouLv = 20;
        int 库存数 = 30;
        int _tempFlag = 1;
        System.out.println("折扣率 " + zheKouLv);
        System.out.println("库存 " + 库存数);
        System.out.println("小旗子 " + _tempFlag);
    }
}
```

```text
折扣率 20
库存 30
小旗子 1
```

拼音收、中文收、下划线开头也收 —— 编得顺、跑得欢。这正说明尺子不是给机器立的：**丑的代价不在「跑」，在「读」**。它今天不咬你，等代码要给别猫看、要过评审、要上搜索，欠的账一次结清。

## 七、包名：全小写

包名的尺子最简单：**全小写**，点号分段，一段一个词，默认用单数 —— `com.fish.tank`、`com.fish.feed`。还记得上一课吗？包名落到磁盘上就是文件夹，全小写顺带躲开一桩跨平台麻烦：有的系统认大小写、有的不认，`com.Fish.Tank` 在两种系统上会走出两种结果，全小写就没这官司。

你要是见过 `com.HuaWei.Project` 这种大写开头的包名，那是老工程的旧账 —— 新工程别学。

## 八、让工具替本喵守规矩

靠眼睛记尺子，一定漏。让工具先替你过一遍：

- **IDEA 自带格式化**：Windows 上 `Ctrl + Alt + L` 一按，缩进、空格一波排齐。这是「排版尺」，管不了一整个名字，但能让稿子先像个样子；
- **改尺子在哪**：Settings → Editor → Code Style → Java 里能看到每一栏规矩 —— 将来公司有自己的尺子，就是改这里；
- **自带检查（Inspections）**：不用装任何东西，编辑区里就常驻着一位检查员 —— 名字下面的波浪线、边上的小灯泡，都是它先于运行挑出来的毛病；全部检查项列在 Settings → Editor → Inspections 里；
- **SonarLint（2024 年底起改名叫 SonarQube for IDE）**：插件市场里搜「SonarQube for IDE」能装到的那只静态分析插件 —— 打开稿子它就自动扫，把 bug、坏味道、安全问题一条条列出来（旧资料里，它还常被叫 SonarLint）；
- **规矩检查插件**：插件市场搜「Alibaba」能装到那只把违例当场标出来的插件。注意它官方版早就停更了，社区有热心人做了适配新版本的分支 —— 装之前看清它支持哪个版本，别为了装插件去降 IDEA 的版本；
- 将来进了团队，这套检查还会挂进打包流水线，**过不了尺子的代码根本到不了仓库**。

最后半句实话：工具管得了**格式**（空格、缩进），管不了**意思**（这个名字取得对不对、说不说人话）。那半把尺子，永远得自己拿着。

## 九、带着尺子回头看祖传文件

现在回到钩子里那只文件，四行里数出**四**处不合规，一处一行：

1. `public class order_service {` —— 图纸名该用大驼峰：`OrderService`，下划线在这儿不许出场；
2. `private int zheKouLv;` —— 拼音，该换成英文：`discountRate`；
3. `private String UserName;` —— 字段名该用小驼峰，首字母小写：`userName`；
4. `public static final int maxCount = 100;` —— 常量要全大写加下划线：`MAX_COUNT`。

修完的整只稿子长这样，本喵真跑过：

```java
public class OrderService {
    private int discountRate;
    private String userName;
    public static final int MAX_COUNT = 100;

    public static void main(String[] args) {
        OrderService sample = new OrderService();
        sample.discountRate = 80;
        sample.userName = "大肥鱼";
        System.out.println(sample.discountRate + " / " + sample.userName + " / " + MAX_COUNT);
    }
}
```

```text
80 / 大肥鱼 / 100
```

改名前后输出**一字不差** —— 名字是给人看的，机器根本不在乎它。别拿「它跑得通」当免死金牌；尺子量的是那只要给别猫读的半张稿子。

改名字的正路是 `Shift + F6`（重命名）：改一处、它替你跟着改一串地方，比手动找替换安全得多。

::: warn 小心喵
【强制】和【推荐】要分清楚：强制级（数字开头、包名大写这类）是硬线，碰了连编都编不过或必被评审打回；推荐级是体面问题，个别场合能说明理由。还有一条最容易被忽略的：**规则只管新代码**。老工程里的 `order_service` 别看到就随手改 —— 它可能被别处用到了八百回，改名要走重命名工具，还得通知用它的猫。
:::

## 小任务

把祖传文件抄下来，照上面四处全修好，再跑一遍，确认输出还是「80 / 大肥鱼 / 100」。然后做两件附加题：

1. 修好的稿子全文 `Ctrl + Alt + L` 排一遍，看看 IDEA 会不会顺手替你调整什么；
2. 打开你上一课建的 `fish-farm` 工程，数一数里面还有几个拼音名字、几个下划线名字 —— 写在纸上，那就是你今天抓到的「丑」。

::: tip 猫咪提示
这一课把名字分成了四家：**图纸名大驼峰**（`OrderService`）、**方法与字段小驼峰**（`discountRate`）、**常量全大写加下划线**（`MAX_STOCK_COUNT`）、**包名全小写**（`com.fish.tank`）；外加一条编都编不过的红线：**数字不能开头**。缩写词按普通单词处理，拼音与中文出场即罚。下一课尺子换一把 —— 从「名字」管到「说明」：注释该按什么规矩写，@param 和 @return 是谁，Javadoc 又是什么喵？
:::

🐾 题外一句：这把尺子不止 Java 有 —— Python 圈的 PEP 8、C++ 圈的谷歌风格，都是同一件事的方言版本。等把 Java 这把练熟了，别的方言你也能一眼看破。
