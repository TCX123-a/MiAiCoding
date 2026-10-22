---
id: java-stage3-12
lang: java
stage: 3
order: 16
title: 反射初步——照 X 光的猫
tags: [反射, 照 X 光, 骨架图]
required: ["java-stage3-11"]
crossRefs: []
estMinutes: 26
keywords: [Class, getDeclaredFields, getDeclaredMethods, getDeclaredConstructor, newInstance]
---

## 钩子：本喵要一张体检表，可本喵手里一只猫都没有

鱼塘要办一次骨骼体检。主人要的表长这样：每只猫身上有几根骨头、每根叫什么名字、是哪一种骨头。

本喵一开始的干法是：把猫一只只抓过来，挨个问「你有几根骨头」。可这活有两个麻烦：

- 有些猫是**别人家寄存**的，本喵压根叫不出它们身上那些名字；
- 更麻烦的是，主人先递过来的是**一张图纸**，不是猫。他说：「先把图纸上的骨头列出来，猫晚点再抓。」

手里只有一张图纸，怎么读出骨头？隔壁大肥鱼甩着尾巴说：这活有个专门的招式，叫**照 X 光**。照的不是猫，是那张图纸 —— 图纸往光下一放，上面画着几根骨头、每根什么名字，全看得清清楚楚喵。

## 一、照 X 光：从「手里有猫」到「手里有图纸」

平时本喵写的每一句，都是**手里有猫**才能干的：`橘.名字`、`橘.打招呼()`，前面那只猫必须先抓住。

照 X 光反过来：本喵手里先有一张**骨架图**，图上写着这个图纸有哪些骨头、哪些招式。这张图上光靠名字就能念出东西来 —— 不用先抓到猫。

那骨架图从哪儿来？手上有真猫的时候，叫一声就行：

```java
public class Main {
    static class 小猫 {
        String 名字 = "小橘";
        int 小鱼干 = 3;
    }

    public static void main(String[] args) {
        小猫 橘 = new 小猫();
        Class<?> 甲 = 橘.getClass();
        Class<?> 乙 = 小猫.class;
        System.out.println("两张是同一张吗：" + (甲 == 乙));
        System.out.println("短名字：" + 乙.getSimpleName());
        System.out.println("全名字：" + 乙.getName());
    }
}
```

```text
两张是同一张吗：true
短名字：小猫
全名字：Main$小猫
```

两行字值得停一下喵：

- **`甲 == 乙` 是 `true`。** 同一个图纸，不管从哪只真猫身上照，照出来的**永远是同一张**骨架图 —— 它记的是「这个图纸长什么样」，不是「这只猫现在什么样」。
- **有两套名字。** 短名字 `小猫` 是本喵写图纸时起的名字；全名字 `Main$小猫` 是它在整份稿子里的门牌号。上面那个 `$` 是因为这张图纸是本喵**画在 `Main` 里面**的。

`Class<?>` 这一对尖括号里那个问号，就是「本喵也不确定是哪张图纸，反正先接住」的意思 —— 跟你前面学过的问号是一个脾气。

## 二、三种拿法

| 本喵手上有什么 | 拿骨架图的招式 |
| --- | --- |
| 一只真猫 | `橘.getClass()` |
| 图纸本身（写稿子时就写在旁边） | `小猫.class` |
| 只有名字这一串字 | `Class.forName("Main$小猫")` |

第三条要**全名字**，还得接着会出事的那种（`throws Exception`）：名字打错一个字母，跑起来才炸，翻译官喵在翻译那一步**不会**替你多看一眼。

## 三、读骨头：`getDeclaredFields()`

```java
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Main {
    static class 小猫 {
        String 名字 = "小橘";
        int 小鱼干 = 3;
        boolean 睡着 = false;
    }

    public static void main(String[] args) {
        Class<?> 骨架图 = 小猫.class;
        List<String> 骨头们 = new ArrayList<>();
        for (Field 骨头 : 骨架图.getDeclaredFields()) {
            骨头们.add(骨头.getType().getSimpleName() + " " + 骨头.getName());
        }
        Collections.sort(骨头们);
        for (String 一行 : 骨头们) {
            System.out.println(一行);
        }
    }
}
```

```text
String 名字
boolean 睡着
int 小鱼干
```

三件事：

- **`getDeclaredFields()` 交回来的是一柜子 `Field`。** 一根骨头一张牌，牌上写着它的名字（`getName()`）和它是哪一种（`getType()`）。
- **先给它们排排坐再印。** 光片上的骨头顺序**本喵说了不算**，谁先谁后是机器那边的事。要印出一张每次看都一样的表，就得自己先给名字**排排坐**（`Collections.sort`）—— 这也是为什么上面要多收一个柜子。
- **`getDeclaredFields()` 只列这张图纸自己写的骨头。** 本喵试过一张只写了自己 1 根骨头的小图纸：数出来就是 1 根，上一代传下来的那根**不在里面**。要把上一代的一起列出来，得换 `getFields()` —— 它列的是**别人能看的那些**（`public` 的），跟本喵写不写 `private` 无关。

「照 X 光」到底照的是什么、凭什么不用先抓到猫，本喵拆成一步一步走给你看：

```demo
title: 手里只有图纸也能念出骨头：照 X 光看一个类有什么
code:
| class 小猫 {
|     String 名字 = "小橘";
|     int 小鱼干 = 3;
|     boolean 睡着 = false;
| }
|
| Class<?> 骨架图 = 小猫.class;
| List<String> 骨头们 = new ArrayList<>();
| for (Field 骨头 : 骨架图.getDeclaredFields()) {
|     骨头们.add(骨头.getType().getSimpleName() + " " + 骨头.getName());
| }
| Collections.sort(骨头们);
| for (String 一行 : 骨头们) {
|     System.out.println(一行);
| }

step 先有图纸：三根骨头画在上面
at: 1
say: `class 小猫 { ... }` 这张图纸上画了三根骨头：`名字`、`小鱼干`、`睡着`，每根都标着是哪一种。**到这一步为止一只猫都还没画** —— 照 X 光要的就是图纸，不是猫。
meow: 手里只有图纸，一只猫都没有喵～
pose: expect
骨架图 = （还没照）
骨头们 = （还没备柜子）
屏幕上 = 还没印

step 照图纸拿骨架图：不用先抓猫
at: 7
say: `小猫.class` 就是照 X 光那一下：**不用先抓到猫**，图纸本身就能照出骨架图。手上有真猫的时候叫一句 `橘.getClass()`，照出来的是**同一张** —— 它记的是「这图纸长什么样」，不是「哪只猫现在什么样」。
meow: 光凭图纸就照出骨架图啦！
pose: expect
骨架图 = 小猫这张（一只猫都没抓）
骨头们 = （还没备柜子）
屏幕上 = 还没印

step 备一个柜子
at: 8
say: `List<String> 骨头们 = new ArrayList<>();` —— 待会儿一根骨头写一行，先拿它装着，最后才印。
meow: 备好柜子，一根骨头写一行～
pose: expect
骨架图 = 小猫这张（一只猫都没抓）
骨头们 = （空柜子）
屏幕上 = 还没印

step 骨架图交回一柜子牌
at: 9
say: `骨架图.getDeclaredFields()` 把图纸上**自己写的**骨头全交回来：一根骨头一张牌（`Field`）。牌上写着它的名字和它是哪一种 —— 骨架图本身不印字，得本喵自己一张一张念。
meow: 一根骨头一张牌，都交回来喵！
pose: busy
骨架图 = 小猫这张（一只猫都没抓）
骨头们 = （空柜子）
屏幕上 = 还没印

step 拆牌：问种类、问名字
at: 10
say: `骨头.getType().getSimpleName()` 问「**哪一种骨头**」（`String`、`int`、`boolean`），`骨头.getName()` 问「**叫什么**」。中间那个空格和谁先谁后，是本喵自己拼的。
meow: 问种类、再问名字，一个一个念～
pose: busy
骨架图 = 小猫这张（一只猫都没抓）
骨头们 = 1 行（机器给的先后，还没排）
屏幕上 = 还没印

step 三根骨头，三张牌都写好
at: 10
say: 这个圈转三遍，三根骨头各写一行进了柜子。**表上只有图纸自己写的这三根** —— 从上一代传下来的骨头不在这张表里，跟自己写的那条规矩是一样的。
meow: 三根骨头都写好了喵～
pose: yay
骨架图 = 小猫这张（一只猫都没抓）
骨头们 = 3 行（机器给的先后，还没排）
屏幕上 = 还没印

step 排排坐：顺序本喵说了不算
at: 12
say: `Collections.sort(骨头们);` —— **骨头的先后是机器那边的事**，本喵说了不算。要印出一张每次看都一样的表，就得自己先给它们排排坐。
meow: 机器说了不算，先排排坐！
pose: think
骨架图 = 小猫这张（一只猫都没抓）
骨头们 = 3 行（按名字排好序）
屏幕上 = 还没印

step 印出来：三根骨头一根不少
at: 14
say: 一行一根印出来：`String 名字`、`boolean 睡着`、`int 小鱼干`。全程**一只猫都没抓** —— 这就是照 X 光：光凭一张图纸，就把上面有什么看清楚了。
meow: 三根骨头，一根不少喵～
pose: proud
骨架图 = 小猫这张（一只猫都没抓）
骨头们 = 3 行（按名字排好序）
屏幕上 = String 名字 / boolean 睡着 / int 小鱼干
```

**照 X 光看的是图纸，不是猫**：图纸往光下一放，骨头一根一根列出来；表上谁先谁后是机器说了算，所以印之前要自己先排排坐。

## 四、读招式：`getDeclaredMethods()`

```java
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Main {
    static class 小猫 {
        String 名字 = "小橘";

        void 打招呼() {
            System.out.println("喵");
        }

        int 要鱼干(int 几根) {
            return 几根 * 2;
        }
    }

    public static void main(String[] args) {
        List<String> 招式们 = new ArrayList<>();
        for (Method 一招 : 小猫.class.getDeclaredMethods()) {
            招式们.add(一招.getName() + "，投喂 " + 一招.getParameterCount() + " 样东西");
        }
        Collections.sort(招式们);
        for (String 一行 : 招式们) {
            System.out.println(一行);
        }
        System.out.println("一共 " + 招式们.size() + " 招");
    }
}
```

```text
打招呼，投喂 0 样东西
要鱼干，投喂 1 样东西
一共 2 招
```

牌换成了 `Method`，能问的东西也多了几样：`getName()` 问名字，`getParameterCount()` 问「这一招要投喂几样东西」。

注意表上**只有本喵自己写的 2 招**：图纸上那些从上一代继承来的招式（比如大家都会的那些）不在这张表里，跟自己写的骨头是同一条规矩。

## 五、照图纸接生一只

光看还不够。骨架图上还画着**产房**：照着它，本喵能凭空接生出一只新猫来，根本不用知道图纸上写了什么名字。

```java
import java.lang.reflect.Constructor;

public class Main {
    static class 小猫 {
        String 名字;
        int 小鱼干;

        小猫(String 名字, int 小鱼干) {
            this.名字 = 名字;
            this.小鱼干 = 小鱼干;
        }
    }

    public static void main(String[] args) throws Exception {
        Constructor<?> 产房 = 小猫.class.getDeclaredConstructor(String.class, int.class);
        小猫 新的 = (小猫) 产房.newInstance("煤球", 5);
        System.out.println(新的.名字 + " 有 " + 新的.小鱼干 + " 根小鱼干");
    }
}
```

```text
煤球 有 5 根小鱼干
```

两个新动作：

- **`getDeclaredConstructor(...)` 是「找那间产房」。** 括号里要报的**不是值**，是**样子的名字**：`String.class` 报的是「一间收串字项链的」，`int.class` 报的是「一间收整数的」。报几样、报什么，都得跟图纸上那间**一模一样**。
- **`newInstance(...)` 才是真接生。** 要投喂的东西写在这里，投喂几样就得跟产房对得上。它叼回来的是一只「不知道哪张图纸生出来的猫」，所以要**自己写明白接的是哪一种**：前面那个 `(小猫)` 就是干这个的。

## 六、连私房骨头都能碰：`setAccessible(true)`

骨头上贴着「只给本喵看」的标签（`private`），平时外面伸手去拿是会被拦的。照 X 光之后，本喵能**掀开盖子**：

```java
import java.lang.reflect.Field;

public class Main {
    public static void main(String[] args) throws Exception {
        小猫 橘 = new 小猫();
        Field 骨头 = 小猫.class.getDeclaredField("名字");
        骨头.setAccessible(true);
        System.out.println("照之前：" + 骨头.get(橘));
        骨头.set(橘, "大橘");
        System.out.println("照之后：" + 骨头.get(橘));
    }
}

class 小猫 {
    private String 名字 = "小橘";
}
```

```text
照之前：小橘
照之后：大橘
```

- `骨头.get(橘)` 是「从这只猫身上把这根骨头读出来」，`骨头.set(橘, "大橘")` 是「给它改掉」。
- **少了 `setAccessible(true)` 这一句，就会被当场拦下来。** 本喵试过：这两张图纸（`Main` 和 `小猫`）是**各自独立**的，本喵站在 `Main` 这张图上伸进 `小猫` 那张图里拿私房骨头，不掀盖子是不行的。这一句的意思就是本喵**自己**担这个责任：盖子是本喵掀的。
- 名字（`getDeclaredField("名字")`）也得跟图纸上**一模一样**，差一个字都找不到。

> **猫在院里踩的坑：图纸套在图纸里面的那种，盖子反而拦不住本喵。**
> 本喵把 `小猫` 写进 `Main` 里（像第二节那样画在 `Main` 里面）的时候，**不写 `setAccessible(true)` 也照样读得动** —— 画在自己身上的图纸，盖子拦不住自己人。要演示「被拦下来」这件事，就得像上面这段一样，把两张图纸**平着摆**：一张 `Main`、一张 `小猫`，谁都够不着谁的口袋。

## 七、它不是替本喵猜的

本喵头一回写「找那间收整数的产房」，可图纸上画的是「收一串字的产房」，跑起来就挨了这么一句：

```java
import java.lang.reflect.Constructor;

public class Main {
    static class Kitty {
        Kitty(String name) {
        }
    }

    public static void main(String[] args) throws Exception {
        Constructor<?> 产房 = Kitty.class.getDeclaredConstructor(int.class);
        System.out.println("产房要投喂 " + 产房.getParameterCount() + " 样东西");
    }
}
```

```text
Exception in thread "main" java.lang.NoSuchMethodException: Main$Kitty.<init>(int)
```

前半句是「本喵照着名字找一圈，没找到」；后半句是它在念本喵报的那个名字：`Main$Kitty.<init>(int)` —— 图纸上那间产房明明收的是 `String`，本喵报的却是 `int`。**它不会替本喵猜「大概想说的是另一间吧」**，找不到就是找不到。

这里顺带说一句那块代码为什么用英文名 `Kitty`：报错原话里会把名字**原样印出来**，本喵头一回拿中文名字试，屏幕上印出来的是 `Main$Сè` 这种烤糊了的字 —— 名字本身没错，是报错那一路的字形转了一道手。演示报错的地方用英文名，报错原话才能一个字母不差地抄给你们看。

## 八、什么时候该照 X 光、代价是什么

这门本事不是拿来天天用的。**平时写代码，本喵手里都有猫** —— 直接叫它做事，翻译官喵在翻译那一步就能替本喵挑错，名字打错、投喂的东西不对，全都当场拦下。

照 X 光把这一层保护**绕过去了**：名字是写在字符串里的，翻译那一步看不见它，只有真跑到那一句才发现不对（上面那句报错就是这么来的）。所以它的位置很清楚：

- **只在「写稿子的时候还不知道要碰谁」的地方用** —— 比如一个谁也认不出来的通用工具、一堆图纸挨个照一遍的批量活；
- **能用真正名字写死的，就别用照 X 光。** 它慢，而且错都在跑起来之后才现形。

## 一句话小抄

| 本喵想干什么 | 招式 |
| --- | --- |
| 从真猫身上拿光片 | `橘.getClass()` |
| 手上有图纸 | `小猫.class` |
| 只有名字这串字 | `Class.forName("全名字")` |
| 读骨头 | `图纸.getDeclaredFields()` → `Field` |
| 读招式 | `图纸.getDeclaredMethods()` → `Method` |
| 找产房 | `图纸.getDeclaredConstructor(String.class, int.class)` → `Constructor` |
| 照图纸接生 | `产房.newInstance("煤球", 5)` |
| 掀开私房盖 | `骨头.setAccessible(true)` |
| 名字对不对 | 全名字长这样：`Main$小猫` |

::: tip 猫咪提示

- **手上有真猫、有图纸、只有一串字，三条路各有一手**：真猫身上叫 `.getClass()`、图纸旁边写 `.class`、只认名字就 `Class.forName(...)` —— 最后那条要报全名字，报错一个字母，跑起来才炸。
- **读骨头、读招式都只列图纸自己写的那些**：从上一代传下来的不在表里。
- **表上谁先谁后本喵说了不算**：想印出一张每次看都一样的表，得自己先给名字排排坐。
- **找产房要报「样子的名字」**，还得跟图纸上那间一模一样 —— 报错了它不会替本喵猜，找不到就是找不到。
- **能用真正名字写死的，就别照 X 光**：名字写成一串字之后，翻译稿子那一步看不见它，错都留到跑起来才现形。

:::

## 小任务

1. 给第三节那张图纸再加上一根骨头（比如 `double 体重`），再跑一次，看那张表上多出来哪一行、排在第几位。
2. 把第三节的 `getDeclaredFields()` 换成 `getFields()` 跑一遍，数数表上还剩几行 —— 再想想为什么少了（提示：那三根骨头里，哪一根是「别人能看的」？）。
3. 拿第五节那段，把产房换成**只收一样东西**的那间（先照着改图纸，再改报名字的那一处），接生一只属于你自己的猫。
