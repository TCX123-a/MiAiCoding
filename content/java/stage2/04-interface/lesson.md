---
id: java-stage2-04
lang: java
stage: 2
order: 4
title: 接口——与猫的约定
tags: [面向对象, 接口]
required: ["java-stage2-03"]
crossRefs: []
estMinutes: 25
keywords: [interface, implements, default, override]
---

## 钩子：机器人也想站进那一排牌子

上一课结尾，本喵留了个悬念：院子里那排写 `Animal` 的牌子，谁想站进去，就得先**认亲**——照 `Animal` 这张图纸画出来才行。

可现在本喵院子里来了位新伙伴：**铁喵**。它是台机器猫，不吃饭、不睡觉、身上一根毛都没有，跟 `Animal` 那一家人八竿子打不着。照现在这个规矩，它永远站不进那排牌子。

本喵不服气：能不能**不认亲，只签一份字**？

> 凡是签了这份字的，都得会出声。

Java 说：能。这份字，就叫**接口（与猫的约定）**。

## 一、一份约定长什么样

先把约定立起来，让猫和机器人都来签：

```java
interface Speaker {
    void speak();
}

class Cat implements Speaker {
    public void speak() {
        System.out.println("喵～");
    }
}

class Robot implements Speaker {
    public void speak() {
        System.out.println("嘀嘀，我是机器人");
    }
}

public class Main {
    public static void main(String[] args) {
        Speaker[] crowd = { new Cat(), new Robot() };
        for (Speaker s : crowd) {
            s.speak();
        }
    }
}
```

```text
喵～
嘀嘀，我是机器人
```

逐行看这份约定：

- **`interface Speaker {`** —— 本喵在**立一份约定**，不是画图纸。约定里**不写家当、也不写出生那一手**，它只管一件事：说清楚「必须会哪几手」。
- **`void speak();`** —— 这一手后面**没有花括号**，直接分号收尾。它跟上一课那半张图纸上没写完的那一手长得一模一样，意思也一样：**这一手必须有，但怎么出声，留给签字的自己定**。
- **`class Cat implements Speaker`** —— `implements` 读作「**认下这份约定**」。猫签了字。
- **签了字的，就得把那一手写出来**，而且前面要写 `public`（为什么？下一节撞给你看）。
- **`Speaker[] crowd = { new Cat(), new Robot() };`** —— 一排写 `Speaker` 的牌子，装下一只猫和一台机器。它俩八竿子打不着，却站进了**同一排**：因为它们签的是**同一份字**。
- **`s.speak();`** —— 一句话喊出去，各猫各样。上一课学的本事，今天换了个由头：**装进去靠的是约定，不是认亲**。

要注意：签字的猫**还是它自己**。`Cat` 不必套在谁身上，它照旧是只普普通通的猫；签了字只是多了一张「我会出声」的凭证喵。

签字那一下到底签掉了什么、喊一声的时候又是谁在干活，本喵拆成一步一步给你看：

```demo
title: 签了字才干活：约定自己一个字都没干
code:
| interface Speaker {
|     void speak();
| }
|
| class Cat implements Speaker {
|     public void speak() {
|         System.out.println("喵～");
|     }
| }
|
| class Robot implements Speaker {
|     public void speak() {
|         System.out.println("嘀嘀，我是机器人");
|     }
| }
|
| Speaker[] crowd = { new Cat(), new Robot() };
| for (Speaker s : crowd) {
|     s.speak();
| }

step 立一份约定，不是画图纸
at: 1
say: interface Speaker —— 这不是图纸，是一份字（约定）。它不写家当、也不写出生那一手：它只管说清楚「必须会哪几手」。
meow: 立一份字，谁签谁就得会喵～
pose: expect
这份约定里有几手 = 1 手（speak）
谁签了字 = （还没有）
跑的是谁写的那一版 = （还没喊）

step 约定里只有名头：它不干活
at: 2
say: void speak(); 后面没有花括号，直接一个分号收尾 —— 意思是「这一手必须有，可怎么出声一个字都没说」。这就是约定和图纸最大的差别：约定不干活。
meow: 只写名头，怎么干空着喵！
pose: think
这份约定里有几手 = 1 手（只有名头，没写怎么干）
谁签了字 = （还没有）
跑的是谁写的那一版 = （还没喊）

step 猫签字
at: 5
say: implements Speaker 读作「认下这份约定」—— 猫签了字。签字是认约定、不是认亲：签字的猫还是它自己，不必套在谁身上。
meow: 猫签字啦，还是它自己喵～
pose: expect
这份约定里有几手 = 1 手（只有名头，没写怎么干）
谁签了字 = Cat
跑的是谁写的那一版 = （还没喊）

step 签了字，就得自己把活干出来
at: 7
say: 约定里空着的那一手，得由签字的自己写一版补上 —— 印出「喵～」是猫自己写的。约定一个字都没帮它干。
meow: 空着的那一手，猫自己补上！
pose: yay
这份约定里有几手 = 1 手（只有名头，没写怎么干）
谁签了字 = Cat（把那一手补上了）
跑的是谁写的那一版 = （还没喊）

step 机器人也签同一份字
at: 11
say: 铁喵也 implements Speaker。它是台机器，跟 Animal 那家人八竿子打不着 —— 照样能签。约定只认签字，不认血缘。
meow: 机器猫也签字，不看血缘喵！
pose: expect
这份约定里有几手 = 1 手（只有名头，没写怎么干）
谁签了字 = Cat、Robot（两个都补上了）
跑的是谁写的那一版 = （还没喊）

step 一排写约定名的牌子，收下签过字的
at: 17
say: Speaker[] crowd = { ... } 牌子那一头写的是约定名，装进去的却是猫和机器：它俩站进同一排，靠的是同一份字。生猫的那一头还是真图纸（new Cat()、new Robot()）—— 牌子能写约定，生不出来。
meow: 八竿子打不着的两只，站进一排！
pose: yay
这份约定里有几手 = 1 手（只有名头，没写怎么干）
谁签了字 = Cat、Robot（站进同一排）
跑的是谁写的那一版 = （还没喊）

step 第 1 圈：领第一只
at: 18
say: 牌子那一排排好了，for 每一圈领一只出来，装进写 Speaker 的牌子 s。牌子管得着哪些招式，是照着牌子上写的那份约定查的。
meow: 第 1 圈领到猫喵～
pose: expect
这份约定里有几手 = 1 手（只说要有）
谁签了字 = Cat、Robot
跑的是谁写的那一版 = （还没喊）

step 拿牌子喊一声：跑的是签字那只自己写的
at: 19
say: s.speak(); 喊出去，跑的是牌子底下那一只自己签了字、自己写的那一版 —— 猫写的：喵～。约定在这一步还是一个字都没干。
meow: 谁签的字，就跑谁那一版喵！
pose: yay
这份约定里有几手 = 1 手（只说要有）
谁签了字 = Cat、Robot
跑的是谁写的那一版 = 第 1 只 Cat 写的（喵～）

step 第 2 圈：牌子底下换人了
at: 18
say: 绕回 for 领下一只 —— 牌子还是那块写 Speaker 的，底下换成了机器人。牌子只认一件事：签过字的才装得进来。
meow: 换一只，牌子底下是机器喵～
pose: expect
这份约定里有几手 = 1 手（只说要有）
谁签了字 = Cat、Robot
跑的是谁写的那一版 = （上一版印完了）

step 同一句喊出去，这回跑机器那版
at: 19
say: 还是 s.speak(); 同一句，这回跑的是 Robot 自己写的那一版：嘀嘀，我是机器人。从头到尾，约定只负责「谁签了字谁站进来」，活全是签字的自己干的。
meow: 机器那版：嘀嘀，我是机器人！
pose: proud
这份约定里有几手 = 1 手（只说要有）
谁签了字 = Cat、Robot
跑的是谁写的那一版 = 第 2 只 Robot 写的（嘀嘀）
```

**一句话收住**：约定只写「必须会哪几手」，**一个字都不干**。谁站得进那排牌子，看的是**签没签字**（八竿子打不着也行）；可真要生出一只，还得靠一张真图纸 —— `new Speaker()` 编译就过不去（下面摔法三就撞）。所以约定管的是「认下来就得会」，不是「长什么样」喵。

## 二、翻译官喵会盯着你这么几条

约定一旦立好，规矩就是硬的。下面这几跤，本喵都替你摔过了。

### 摔法一：签了字，却没把那一手补上

```java
interface Speaker {
    void speak();
}

class Robot implements Speaker {
}

public class Main {
    public static void main(String[] args) {
        Speaker s = new Robot();
    }
}
```

```text
Main.java:5: error: Robot is not abstract and does not override abstract method speak() in Speaker
class Robot implements Speaker {
^
1 error
```

念起来是：**「`Robot` 认了这份约定，却没把 `speak` 写出来 —— 那它到底会不会出声喵？」**

这句话跟上一课那句「小图纸没补上那半张」是同一句话的两种场合。翻译官喵给的出路也一样：要么补上，要么自己也当一张「只画了一半的图纸」。

### 摔法二：补是补了，可漏了 `public`

```java
interface Speaker {
    void speak();
}

class Robot implements Speaker {
    void speak() {
        System.out.println("嘀嘀，我是机器人");
    }
}

public class Main {
    public static void main(String[] args) {
        Speaker s = new Robot();
        s.speak();
    }
}
```

```text
Main.java:6: error: speak() in Robot cannot implement speak() in Speaker
    void speak() {
         ^
  attempting to assign weaker access privileges; was public
1 error
```

念起来是：**「约定上写的可是『谁都能喊这一手』，你补的这版怎么缩手缩脚的喵？」**

道理是这样的：约定是立给**所有人**看的，所以约定上的每一手，天生就带着 `public`（谁都能喊）的招牌。你补的时候漏了 `public`，等于**悄悄把招牌摘了**——翻译官喵不许你把一件「本来谁都能喊的事」改小。补上 `public` 就完事了喵。

### 摔法三：直接拿约定去生猫

```java
interface Speaker {
    void speak();
}

public class Main {
    public static void main(String[] args) {
        Speaker s = new Speaker();
        s.speak();
    }
}
```

```text
Main.java:7: error: Speaker is abstract; cannot be instantiated
        Speaker s = new Speaker();
                    ^
1 error
```

约定**不是图纸**，它压根没画过一只真猫长什么样——拿它生，翻译官喵只会说「这不许生」。牌子可以写 `Speaker`（装签了字的真猫），但**生**的那一头必须交给一张真图纸。

### 摔法四：把认约定写成了认亲

```java
interface Speaker {
    void speak();
}

class Robot extends Speaker {
    void speak() {
        System.out.println("嘀嘀");
    }
}

public class Main {
    public static void main(String[] args) {
        Robot r = new Robot();
        r.speak();
    }
}
```

```text
Main.java:5: error: no interface expected here
class Robot extends Speaker {
                    ^
1 error
```

念起来是：**「`extends` 后面本喵等着的是一张图纸，你怎么递了份约定过来喵？」**

`extends` 是**认亲**（图纸套图纸），`implements` 才是**认约定**——两个词分工清楚，不能互相客串。

## 三、它和「只画了一半的图纸」差在哪

到这儿你大概要问了：上一课那半张图纸，不也是「只写名头、逼着小图纸补全」吗？两样东西看着像，用处不一样喵。

| 想问的 | 只画了一半的图纸（`abstract class`） | 与猫的约定（`interface`） |
|---|---|---|
| 怎么认下来 | `class Cat extends Animal` | `class Cat implements Speaker` |
| 一只真猫能认几份 | **亲爹只能有一个**：`extends` 后面只跟得下一张图纸 | **想认几份认几份**：逗号隔开，一路跟下去 |
| 里头能放家当吗 | 能：家当、出生那一手、画完了的招式都行 | 不能放「属于每只真猫自己的」家当；写下的家当**天然是全院子共用、谁都不许改的**那种 |
| 认下来之后 | 是「它家的孩子」，长辈画好的招式和家当**白拿** | 不是一家人：**每一手都得自己写**（除非那一手是约定里已经写好怎么干的，见下一节） |

第二条是约定最值钱的地方。看这只猫，它**同时认下两份约定**：

```java
interface Speaker {
    void speak();
}

interface Walker {
    void walk();
}

class Cat implements Speaker, Walker {
    public void speak() {
        System.out.println("喵～");
    }

    public void walk() {
        System.out.println("四只爪子走过去了");
    }
}

public class Main {
    public static void main(String[] args) {
        Speaker s = new Cat();
        Walker w = new Cat();
        s.speak();
        w.walk();
    }
}
```

```text
喵～
四只爪子走过去了
```

院子里还是**同一只猫**，本喵却手里握着两块写着不同约定的牌子：拿写 `Speaker` 的那块喊，只喊得动出声这一手；换写 `Walker` 的那块，才喊得动走路。

**一块牌子管得着哪些招式，是照着牌子上写的那份约定查的**——这一条跟上一课「牌子上写什么图纸名，就只喊得动那张图纸上的招式」是同一个道理，只是现在牌子上写的从图纸名换成了约定名喵。

## 四、约定里也能有「已经写好怎么干」的招式

立约定的人不总是想得出全部招式。有时候得**往一份已经立好的约定上再添一手**——可这一添，全院签过字的猫都得返工，那也太折腾了。

Java 给这个场面留了一手：`default`。

```java
interface Greeter {
    void greet();

    default void greetTwice() {
        greet();
        greet();
    }
}

class Cat implements Greeter {
    public void greet() {
        System.out.println("喵～");
    }
}

public class Main {
    public static void main(String[] args) {
        Greeter g = new Cat();
        g.greetTwice();
    }
}
```

```text
喵～
喵～
```

看那两手的区别：

- `void greet();` —— **没有花括号**：必须会，怎么干由签字的自己写。猫写了。
- `default void greetTwice() { ... }` —— **有花括号，而且写好了怎么干**：签字的猫**一个字都不用写，白拿**。猫喊 `greetTwice()` 印出来两个喵，它自己可没写过这一手。

想改也行：签字的猫要是看不上这一手，自己重写一版就是。`default` 只是「**给你一份现成的，不想用就自己来**」，不是「不许改」。

::: tip 猫咪提示

1. **约定只写「必须会哪几手」**，不写怎么干 —— 所以约定里的招式后面**没有花括号**，直接分号收尾。
2. **`implements` 是认约定，`extends` 是认亲**，两个词别互相客串。
3. **认下约定，就得把每一手写出来**，而且**必须写 `public`**。
4. **约定不是图纸**：牌子可以写约定名（装签字的真猫），但**不能拿约定去生猫**。
5. **一份字可以签好几份约定**（亲爹却只能有一个）——这是约定比图纸套图纸更灵活的地方。
6. **`default` 那一手是白拿的**：签字的不用写也能喊，看不顺眼就自己盖一版。
:::

::: warn 小心喵

- **漏了 `public` 撞的是 `attempting to assign weaker access privileges; was public`** —— 别以为是招式名写错了，真正的原因是「约定上的招牌是天生的 `public`，你补的那版比它小」。
- **签了字没补全，撞的是 `... is not abstract and does not override abstract method ...`** —— 注意这跟「直接拿约定生猫」是两句不同的话：这一句说的是**没补全**，那一句说的是**不许生**。
- **约定里放不下「属于每只真猫自己的」家当**。想给猫存个名字，还是老规矩：画一张真图纸，让猫套上去、顺便签个字就好喵。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `interface Speaker { void speak(); }` | 立一份约定：签了字的都得会这一手，怎么干自己定 |
| `class Robot implements Speaker` | 机器人认下这份约定 —— 它不是动物，也照样能签 |
| `class Cat implements Speaker, Walker` | 一份字签好几份约定，中间用逗号隔开 |
| 补那一手时漏了 `public` | `attempting to assign weaker access privileges; was public` |
| 签了字却漏补那一手 | `Robot is not abstract and does not override abstract method speak() in Speaker` |
| `new Speaker()` | `Speaker is abstract; cannot be instantiated` —— 约定不许直接拿来生 |
| `class Robot extends Speaker` | `no interface expected here` —— 认约定要用 `implements` |
| `default void greetTwice() { ... }` | 约定里给一手**已经写好怎么干**的招式，签字的白拿 |
| `Speaker s = new Cat();` | 一块写约定名的牌子，装下任何签过字的真猫 |

## 小任务

1. 再立一份约定 `Jumper`，里面一手 `void jump();`（跳一次印一行「跳过了一条小鱼干」）。让 `Cat` 把它也签上（`implements Speaker, Jumper`），在 `main` 里拿写 `Jumper` 的牌子喊一次。
2. 给那份 `Speaker` 约定添一手 `default void speakTwice() { speak(); speak(); }`，让 `Cat` 白拿它；再让 `Robot` 自己盖掉重画一版（比如只印一遍「嘀嘀（我不想说两遍）」），跑跑看两只各印什么。
3. 把第二节「摔法二」那段代码的 `public` 补回去，编译一次看它是不是就通了——顺手记住那句原话，往后天天要用。
4. 想一想：约定里那手 `default` 的招式，为什么 Java 要说是「后来才添的救命手」？（提示：一份约定立下去，全院签过字的猫都可能已经散在院子里了喵。）

下一课，本喵要拆一个从第一天起就天天照抄、却从没问过的名字：入口那一行里的 **`static`** 到底是干嘛的——顺便再教你一样**钉死了就不许改**的东西喵～ 🐾
