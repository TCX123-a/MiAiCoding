---
id: java-stage2-05
lang: java
stage: 2
order: 5
title: static 与 final
tags: [关键字, 静态成员, 常量]
required: ["java-stage2-04"]
crossRefs: []
compare: ["common-10"]
estMinutes: 25
keywords: [static, final, constant]
---

## 钩子：入口那一行里，那个抄了一百遍的 `static`

从第一课到现在，本喵每写一个程序，第一行都长一个样：

`public static void main(String[] args)`

那三个词里，`public` 上一课刚讲明白（谁都能喊），`void` 是「不叼东西回来」，`String[] args` 是投喂口——可中间那个 **`static`**，本喵抄了一百遍，一次都没问过它是干嘛的。

今天就连着另一个问题一起答了：

> 本喵院子里一共出生过几只猫，这个数该记在哪只猫头上？

记在 `a` 那两格里？那 `b` 出生的时候，谁跑去把 `a` 的格子加一？再说 `a` 自己哪天先散架了，这个数又该寄在哪儿喵？

答案本喵其实已经猜到了：这个数**不属于任何一只猫**，它属于**整张图纸**。这种「整张图纸共用一份」的东西，写法上的标记就是在前面加一个 `static`。

## 一、整张图纸共用一份：`static` 格子

先把「一共出生了几只」这件事办成：

```java
class Cat {
    static int count = 0;
    String name;

    Cat(String name) {
        this.name = name;
        count = count + 1;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat("小橘");
        Cat b = new Cat("狸花");
        Cat c = new Cat("大胖");
        System.out.println("一共出生了 " + Cat.count + " 只");
    }
}
```

```text
一共出生了 3 只
```

这段里有三处要拿小本本抄下来：

1. **图纸里**：`static int count = 0;`——前面那个 `static` 是宣告「这一格**整张图纸共用**」，不属于任何一只猫；后面那个 `= 0` 是它的**起步的数**。
2. **出生那一手里**：`count = count + 1;`——每生一只猫都去**同一个**格子上加一。生三只，加三次，所以是 `3`。
3. **读数的时候**：`Cat.count`——写成「图纸名 `.` 格子名」。

念法上，`Cat.count` 念作「**`Cat` 这张图纸上的 `count`**」。多写那个图纸名不是啰嗦：它一眼就告诉读代码的人「这一格不是某只猫自己的东西」。

::: tip 猫咪提示
**共用的那一份，一律用图纸名去念**（`Cat.count`）。写下 `Cat.` 这几个字符，读的人立刻知道「这不是某只猫自己的东西」——这条规矩能帮你省下很多想不明白的工夫喵。
:::

## 二、它真的只有一份

光听本喵说「共用」不算数，得亲手撞一次才踏实。下面这段是**故意使坏**：本喵拿一只猫去改那个数，再看看另外两位怎么看。

```java
class Cat {
    static int count = 0;
    String name;

    Cat(String name) {
        this.name = name;
        count = count + 1;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat("小橘");
        Cat b = new Cat("狸花");
        a.count = 100;
        System.out.println(Cat.count + " " + b.count);
    }
}
```

```text
100 100
```

本喵只写了 `a.count = 100;`，可印出来的是 `100 100`——`b` 那一侧也变了。

**因为它压根不是 `a` 的东西**：`a.count`、`b.count`、`Cat.count` 三种写法指的是**同一份**，一共就这一格。

本喵把两遍都真跑了，结果得分开说喵：

- **不拧开关**：翻译官喵**一个字都没说**——编得过、跑得动，就这么放过去了。
- **拧上挑刺的开关**（`-Xlint:static`）：它**当场念了两句**，点着的正是上面那两处：

> `warning: [static] static variable should be qualified by type name, Cat, instead of by an expression`

两句都是 `warning`，程序照旧印出 `100 100`。翻译官喵这话翻过来就是——**「共用的那一格，请拿图纸名去喊」**：它认得 `a.count` 这种写法，只是嫌它绕。

所以本喵给自己立一条规矩：**共用的那份只写 `Cat.count`**。`a.count` 这种念法翻译官喵认，可它会让读代码的人（包括三天后的你自己）以为这是 `a` 自己的一格。

（跟别的语言不一样的地方顺带说一句：Java 的共用的那些格子，**起步的数就写在图纸里那一行**，不用在图纸外面再补一行。少写一处，少一处忘。）

再说回印出来的那个 `100 100`：本喵只动了 `a` 那一侧，`b` 那边怎么也变了？本喵把这段拆成一步一步，走给你看：

```demo
title: 共用的那一格 —— 为什么本喵动了 a，b 也跟着变
code:
| class Cat {
|     static int count = 0;
|     String name;
|     Cat(String name) {
|         this.name = name;
|         count = count + 1;
|     }
| }
| public static void main(String[] args) {
|     Cat a = new Cat("小橘");
|     Cat b = new Cat("狸花");
|     a.count = 100;
|     System.out.println(Cat.count + " " + b.count);
| }

step 图纸上先躺着那一格
at: 2
say: `static int count = 0;` 是写在**图纸里**的一格，起步的数是 `0`。要盯紧的是：这一格**不在任何一只猫身上** —— 此刻院子里一只猫都还没生。
meow: 图纸上先摆好一格，一只猫都还没生喵～
pose: expect
Cat.count 那一格 = 0（起步的数）
b 那边看见的 = （还没生）
屏幕上 = 还没印

step 生第一只：小橘
at: 10
say: `new Cat("小橘")` 会去喊出生那一手。先盯住它待会儿动的是**哪一格** —— 加一还没轮到，这一格现在还是 `0`。
meow: 第一只猫落地，要去动那张图纸喵！
pose: busy
Cat.count 那一格 = 0（还没加）
b 那边看见的 = （还没生）
屏幕上 = 还没印

step 出生那一手：加的是共用那一格
at: 6
say: `count = count + 1;` 加的是**图纸上那一格**，加完变成 `1`。同一手里那句 `this.name = name;` 装的是「小橘」，那是**它自己的一格**，跟共用那格不在一处。
meow: 加的是图纸那一格，不是自己的喵！
pose: yay
Cat.count 那一格 = 1
b 那边看见的 = （还没生）
屏幕上 = 还没印

step 生第二只：狸花
at: 11
say: 第二只猫落地，走的还是同一手。它**不是**在小橘那本账上加 —— 这一手待会儿要去动的，还是**那一格**。
meow: 第二只也来了，还是那张图纸喵～
pose: busy
Cat.count 那一格 = 1（还没加）
b 那边看见的 = （还没生完）
屏幕上 = 还没印

step 狸花也加一次：还是那一格
at: 6
say: 加完变成 `2`。看仔细：本喵一次都没碰过每只猫自己那格，可 `b` 那边看见的也是 `2` —— 它俩看的是**同一格**。
meow: 同一格再加一，狸花也看得见喵！
pose: yay
Cat.count 那一格 = 2
b 那边看见的 = 2
屏幕上 = 还没印

step 本喵拿 a 去改：改的还是那一格
at: 12
say: `a.count = 100;` —— 本喵写的是 `a`，可 `a.count`、`b.count`、`Cat.count` 三种写法指的是**同一格**。这一改，谁都看得见。
meow: 改的是同一格，谁都跑不掉喵！
pose: think
Cat.count 那一格 = 100
b 那边看见的 = 100
屏幕上 = 还没印

step 印出来：100 100
at: 13
say: `System.out.println(Cat.count + " " + b.count);` 印出 `100 100`。本喵一个字都没碰过 `b`，可 `b` 那边看见的也是 `100` —— **压根只有一格**。这就是课文那句「它真的只有一份」。
meow: 100 100，b 也跟着变啦喵！
pose: proud
Cat.count 那一格 = 100
b 那边看见的 = 100
屏幕上 = 100 100
```

所以 `a.count` 这种写法翻译官喵认，可改的**还是那一格** —— 共用的那一份，一律拿图纸名去念（`Cat.count`），读代码的人才不会被骗喵。

## 三、`static` 招式：没有「本喵自己」的招式

有些活**不需要哪只猫也能干**——比如「报一报一共出生了几只」。这种活就该写成 `static` 招式：前面加 `static`，喊它的时候不需要先有一只猫。

```java
class Cat {
    static int count = 0;
    String name;

    Cat(String name) {
        this.name = name;
        count = count + 1;
    }

    static int howMany() {
        return count;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat("小橘");
        Cat b = new Cat("狸花");
        System.out.println("一共有 " + Cat.howMany() + " 只");
    }
}
```

```text
一共有 2 只
```

注意两件事：

- 喊它的时候，名字前面挂的是**图纸名**：`Cat.howMany()`。这件事不属于任何一只猫，所以从图纸上喊最自然。
- 它肚子里碰的是 `count`（共用的那一份），完全没问题。

（本喵也试过拿一只猫去喊：`a.howMany()`。翻译官喵照样放行，可读起来像是「这是 `a` 自己那一手」，本喵劝你别这么写。）

可要是它去碰**某只猫自己那一格**呢？翻译官喵当场拦下：

```java
class Cat {
    static int count = 0;
    String name;

    Cat(String name) {
        this.name = name;
        count = count + 1;
    }

    static int howMany() {
        return name.length();
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat("小橘");
        System.out.println(Cat.howMany());
    }
}
```

```text
Main.java:11: error: non-static variable name cannot be referenced from a static context
        return name.length();
```

念作：**「`name` 是每只猫自己的一份，可你现在站的是 `static` 招式——喊它的时候压根没有猫站在旁边，你要用的是哪只猫的 `name`？」**

`this` 也是同一个道理。上一课说过，`this` 就是「喊这一招的那只猫」；可 `static` 招式挂在图纸上，喊它的时候手里**根本没有猫**：

```java
class Cat {
    static int count = 0;

    Cat() {
        count = count + 1;
    }

    static int howMany() {
        return this.count;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat();
        System.out.println(Cat.howMany());
    }
}
```

```text
Main.java:9: error: non-static variable this cannot be referenced from a static context
        return this.count;
```

念作：**「`static` 招式里没有『本喵自己』这个东西——`this` 在这儿是空的。」**

一句话记住：**`static` 招式里，共用的格子随便碰，每只猫自己的格子一个都不能碰**（`this` 就更不能写）。

### 回到钩子：入口那一行为什么非得是这个 `static`

现在再回头看第一行，本喵一下就想通了：**`main` 本身就是一个 `static` 招式**。

道理特别朴素：程序刚起步那一刻，院子里**一只猫都还没生出来**。没有猫，就喊不动「哪只猫的招式」；能喊的只有那种挂在图纸上、不需要猫的招式。所以入口必须写成 `static` 的。

要是本喵在入口里忍不住去碰某只真猫自己的格子，撞的就是刚才那句话：

```java
public class Main {
    String name = "小橘";

    public static void main(String[] args) {
        System.out.println(name + "：喵～");
    }
}
```

```text
Main.java:5: error: non-static variable name cannot be referenced from a static context
        System.out.println(name + "：喵～");
```

（把入口那一行的 `static` 抠掉，它其实**编得过**——那一行本身是个合法招式。可一按运行，`java` 会拦下来说一句 `Error: Main method is not static in class Main, please define the main method as: public static void main(String[] args)`：入口不是 `static`，它就没法在没有猫的时候被喊起来。）

## 四、`final`：钉死了就不许改

`static` 管的是「**只有一份**」，接下来这个东西管的是「**只许填一次，往后谁都不许改**」——写法是在前面加 `final`。

```java
class Cat {
    final String name;

    Cat(String name) {
        this.name = name;
    }

    void greet() {
        System.out.println(name + "：喵～");
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat("小橘");
        a.greet();
    }
}
```

```text
小橘：喵～
```

这一手叫**出生时钉死**：`final String name;` 报个名字，**具体是哪个名字，在出生那一手里填进去、填完就锁死**。要是名字天生就定好了，也可以当场填：

```java
class Cat {
    final String name = "无名猫";

    void greet() {
        System.out.println(name + "：喵～");
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat();
        a.greet();
    }
}
```

```text
无名猫：喵～
```

两条路都行，但**必须二选一**：要么在出生那一手里填满，要么在声明那一行就填好。两条都不占，翻译官喵照样拦：

```java
class Cat {
    final String name;

    Cat() {
        System.out.println("一只小猫出生了");
    }
}

public class Main {
    public static void main(String[] args) {
        new Cat();
    }
}
```

```text
Main.java:6: error: variable name might not have been initialized
```

念作：**「这一格你说好了钉死——那它到底钉的是哪个名字？本喵等到出生那一手写完，也没见你填过。」**

钉死之后还想改呢？当场挨拦：

```java
class Cat {
    final String name;

    Cat(String name) {
        this.name = name;
    }

    void rename() {
        name = "大胖";
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat("小橘");
        a.rename();
    }
}
```

```text
Main.java:9: error: cannot assign a value to final variable name
        name = "大胖";
```

念作：**「这一格你出生时已经填过、锁上了——现在谁都不许再往里塞东西。」**

这一格「出生时钉死」是怎么钉上的，本喵也拆成一步一步，走给你看：

```demo
title: final 那一格：出生时填一次，往后就锁死
code:
| class Cat {
|     final String name;
|     Cat(String name) {
|         this.name = name;
|     }
|     void greet() {
|         System.out.println(name + "：喵～");
|     }
| }
| public static void main(String[] args) {
|     Cat a = new Cat("小橘");
|     a.greet();
| }

step 报个名字，说好钉死
at: 2
say: `final String name;` 只报名字、不定内容 —— 说好这一格**只许填一次**。此刻它还空着。
meow: 先说好钉死，格子还空着喵～
pose: expect
name 那一格 = （还空着）
锁 = 还没上
屏幕上 = 还没印

step 生小橘：把名字递进出生那一手
at: 11
say: `new Cat("小橘")` 把「小橘」递给出生那一手。这是**唯一**能填这一格的机会 —— 过了这一手就再没门了，所以此刻它**还是空着**。
meow: 递名字进去，就这一回喵！
pose: busy
name 那一格 = （还空着）
锁 = 还没上
屏幕上 = 还没印

step 填进去的这一下，锁就上了
at: 4
say: `this.name = name;` 把「小橘」装进那一格 —— **填过就锁死**。课文说的「出生时钉死」，钉的就是这一下。
meow: 填进去，当场锁死喵！
pose: yay
name 那一格 = 小橘（填过、锁了）
锁 = 锁上了
屏幕上 = 还没印

step 念出来：小橘还在里面
at: 12
say: `a.greet()` 去念这一格，印出「小橘：喵～」—— 填进去的东西**一直都在**，只是谁都不许再改它。
meow: 名字稳稳躺着，念得出来喵～
pose: yay
name 那一格 = 小橘（锁着）
锁 = 锁上了
屏幕上 = 小橘：喵～

step 想填第二次？封条在那儿
at: 2
say: 回头看这一行：`final` 就是本喵贴的封条。课文里 `rename` 那一手想在别处再填一次，翻译官喵当场拦下：`cannot assign a value to final variable name`。**声明那一行、出生那一手，两条总得占一条；占过就锁死。**
meow: 第二次想填？封条在那儿喵！
pose: proud
name 那一格 = 小橘（谁都改不了）
锁 = 锁上了（第二次填 → 挨拦）
屏幕上 = 小橘：喵～
```

所以 `final` 那两句话要连起来记：**要么在声明那一行填，要么在出生那一手里填**，两条都不占，翻译官喵会说 `variable name might not have been initialized`；占了一条之后，这一格就再也填不进第二次了喵。

## 五、`final` 招式与 `final` 图纸：不许别人往下改

`final` 还能挂在**招式**和**图纸**头上，意思是「这一手/这张图纸，到此为止，不许别人接着改」：

```java
class Animal {
    final void speak() {
        System.out.println("……");
    }
}

class Cat extends Animal {
    void speak() {
        System.out.println("喵～");
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat();
        c.speak();
    }
}
```

```text
Main.java:8: error: speak() in Cat cannot override speak() in Animal
    void speak() {
  overridden method is final
```

念作：**「长辈那一手是钉死的——它不许你盖掉。」**

挂在图纸头上，就是不许别人拿它往下套：

```java
final class Animal {
    String name;
}

class Cat extends Animal {
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat();
        c.name = "小橘";
    }
}
```

```text
Main.java:5: error: cannot inherit from final Animal
class Cat extends Animal {
```

念作：**「这张图纸钉死了，不许再往下套新图纸。」**

这两条听起来像在跟别人过不去，其实用意是**上锁**：本喵写好的关键那一手（比如算钱、算鱼干数量的那一手），不想被谁顺手改掉；本喵画好的一张图纸，不想被人套出个奇奇怪怪的后代。`final` 就是本喵自己贴上去的封条。

## 六、常量：全院子共用、又钉死的那一份

把今天学的两样合起来用，就得到了一个特别常见的东西——**常量**：

```java
class Cat {
    static final int MAX_FISH = 3;

    String name;

    Cat(String name) {
        this.name = name;
    }

    void eat(int fish) {
        if (fish > MAX_FISH) {
            System.out.println(name + "：太多啦，一顿最多 " + MAX_FISH + " 条");
        } else {
            System.out.println(name + "：吃了 " + fish + " 条");
        }
    }
}

public class Main {
    public static void main(String[] args) {
        Cat a = new Cat("小橘");
        a.eat(2);
        a.eat(9);
        System.out.println("上限是 " + Cat.MAX_FISH + " 条");
    }
}
```

```text
小橘：吃了 2 条
小橘：太多啦，一顿最多 3 条
上限是 3 条
```

`static final int MAX_FISH = 3;` 这一行是两个词各管一半：

- **`static`**：整张图纸一共就这一格，全院子共用；
- **`final`**：钉死，谁都不许改。

两样加起来就是「**全院子共用、又谁都改不了**」的一条规矩——这正是「一顿最多三条」这种数该待的地方：**要改就只改这一处，改完全院立刻都按新规矩来**。

本喵给自己定的写法：常量的名字**全用大写字母，词和词之间用小下划线**（`MAX_FISH`），念的时候挂上图纸名（`Cat.MAX_FISH`）。这样一眼就看得出「这不是哪只猫的格子，是全院子钉死的规矩」。

想改它？翻译官喵拦得比 `final` 家当还严一点：

```java
class Cat {
    static final int MAX_FISH = 3;
}

public class Main {
    public static void main(String[] args) {
        Cat.MAX_FISH = 5;
    }
}
```

```text
Main.java:7: error: cannot assign a value to static final variable MAX_FISH
        Cat.MAX_FISH = 5;
```

顺手对上上一课：本喵在那张对照表里写过「约定里写下的家当，天然是全院子共用、谁都不许改的」——现在你知道那句话说的是什么了，就是这里的 `static final` 喵。

::: tip 猫咪提示

1. **只跟「图纸」有关、跟具体哪只猫无关的事**，就请 `static` 出来：一共出生了几只、全院子共用的上限、总开关。
2. **共用的那一份一律用图纸名念**：`Cat.count`、`Cat.MAX_FISH`。别写 `a.count`——它改的还是同一份，只会骗到读代码的人。
3. **`main` 是 `static` 招式**：程序起步时一只猫都没有，所以入口只能是不需要猫也能喊的那种招式。
4. **`final` 是「只填一次、往后锁死」**：要么在声明那一行填，要么在出生那一手里填，两条总得占一条。
5. **常量 = `static final`**，名字全大写加下划线，要改只改一处。
:::

::: warn 小心喵

- **`static` 招式里碰每只猫自己的格子**，撞的是 `non-static variable name cannot be referenced from a static context`——连 `this` 都写不了。
- **共用的格子忘了挂图纸名**（在 `main` 里直接写 `count`），撞的是 `cannot find symbol`，底下那行 `location: class Main` 会告诉你「本喵是在 `Main` 里找的，可这一格不在 `Main` 上」。
- **钉死的格子没人填**，撞的是 `variable name might not have been initialized`——注意它指的是**出生那一手写完的时候**还没填上。
- **改钉死的格子**，撞的是 `cannot assign a value to final variable ...`；改的是全院子共用的那种，还会多出来一个词：`cannot assign a value to static final variable ...`。
- **盖掉钉死的招式**、**往下套钉死的图纸**，撞的是 `... cannot override ...`（底下跟一句 `overridden method is final`）和 `cannot inherit from final ...`。
- **别给每只猫各有一份的东西加 `static`**：名字、这只猫自己的条数加了它，三只猫会互相覆盖，只剩下最后生的那一个。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `static int count = 0;`（图纸里） | 整张图纸共用一份的格子，起步的数就写在这儿，不用在外面再补一行 |
| `Cat.count` | 「`Cat` 这张图纸上的 `count`」，一共只有一份 |
| `a.count = 100;` | 翻译官喵认这种写法，可改的还是**那同一份**——不是 `a` 自己的一格 |
| `static int howMany() { return count; }` | 挂在图纸上的招式：碰共用的格子没问题 |
| `static int howMany() { return name.length(); }` | 挨拦：`non-static variable name cannot be referenced from a static context` |
| `return this.count;`（在 `static` 招式里） | 挨拦：`non-static variable this cannot be referenced from a static context` |
| `public static void main(String[] args)` | 入口必须是这种「不需要猫也能喊」的招式 |
| `final String name;`（在出生那一手里填） | 出生时钉死：填过一次，往后谁都不许改 |
| `name = "大胖";`（改钉死的家当） | 挨拦：`cannot assign a value to final variable name` |
| `final void speak()` | 这一手钉死了，小图纸不许重写：`overridden method is final` |
| `final class Animal` | 这张图纸钉死了，不许往下套：`cannot inherit from final Animal` |
| `static final int MAX_FISH = 3;` | 常量：全院子共用、又谁都改不了的那一份 |
| `Cat.MAX_FISH = 5;` | 挨拦：`cannot assign a value to static final variable MAX_FISH` |

## 小任务

1. 把第一节那段里的 `Cat.count` 换成 `a.count`，真跑一次看看结果变不变；再把 `a.count = 100;` 那一手自己试一遍，看看另外一只猫是不是也「看见」了。
2. 给图纸加一格共用的 `static int total;`，在出生那一手里把这只猫的条数加进去；再写一个 `static int getTotal()` 把它叼回来。**起步的数别忘了写在图纸里。**
3. 把第三节「回到钩子」那段里的 `name` 改成 `this.name`，真跑一次，把翻译官喵的原话抄进小本本——重点是记住：`static` 招式里没有「本喵自己」。
4. 试着把第四节那段出生那一手里的 `this.name = name;` 删掉（`final` 那一行留着），真跑一次，看看翻译官喵说什么。这一条就是为了让你记住：**钉死的格子必须有人填，而且只在出生那一手填一次**。
5. 把第六节那段里的 `static final` 拆成两半试两次：先只留 `static`（改成 `static int MAX_FISH = 3;`），真跑一次，看看 `Cat.MAX_FISH = 5;` 那一行还拦不拦；再只留 `final`，看看 `Cat.MAX_FISH` 这种念法还认不认。想一想这两个词各自管的是什么。

下一课，本喵要讲一件怪事：本该只是「一颗小鱼干」的一个数，怎么摇身一变，成了**会自己出招的真猫**——还有它跟「一排贴编号的猫粮碗」之间那种自动来回的本事喵～ 🐾
