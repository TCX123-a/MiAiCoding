---
id: java-stage1-13
lang: java
stage: 1
order: 17
title: 构造方法与 this
tags: [面向对象, 构造方法, this]
required: [java-stage1-12]
crossRefs: []
estMinutes: 25
keywords: [constructor, this, overload]
---

## 钩子：一只猫的出生那一刻

上一课末尾留了个疑问：本喵想让猫**一出生就带着名字**，`new Cat("小橘")` 那对小括号里到底该写点什么？

那对小括号喊的，是画在图纸上、**和图纸同名的一手活儿** —— 术语里叫**构造方法**。它和别的招式都不一样：别的招式是本喵喊它它才干，它却是**在真猫出生那一刻自动跑一遍**，负责把这只新猫收拾利索。

今天本喵要把这一手练熟，还要认识一个天天出现的小词 `this`。顺便说，`this` 是新手最容易写漏、写漏了又**不报错、只出错结果**的地方 —— 本喵会在第四节当面撞给你看喵。

## 一、自己画第一手：和图纸同名的那一招

图纸上第一次动笔，本喵想给猫加一手「出生」，让它叼着名字和鱼干数进来：

```java
class Cat {
    String name;
    int fish;

    Cat(String name, int fish) {
        this.name = name;
        this.fish = fish;
    }

    void report() {
        System.out.println(this.name + " 吃了 " + this.fish + " 条");
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘", 3);
        c.report();
    }
}
```

```text
小橘 吃了 3 条
```

看这一手 `Cat(String name, int fish)`，三条规矩记牢：

- **名字和图纸一模一样**（都叫 `Cat`）—— 这是它唯一能叫的名字，改一个字母翻译官就不认识了。
- **前面没有 `void` 那一截，也没有任何类型** —— 别的手艺写 `void meow()`、`int add(...)`，它打头光秃秃的，就一个名字。
- **它在 `new Cat("小橘", 3)` 那一刻跑一遍**，本喵一声都没喊它，它自己就动了。

它跑到哪去了？看身子里的两句：`this.fish = fish;` 把喂进来的 `3` 收进这只猫自己的家当。等 `c.report()` 的时候，印出来的就是这只猫自己的名字和它的鱼干数喵。

## 二、看着它出生：那一刻真跑了一遍

嘴上说「自动跑一遍」太空，本喵让它在身子里印一句话：

```java
class Cat {
    String name;
    int fish;

    Cat(String name, int fish) {
        this.name = name;
        this.fish = fish;
        System.out.println("一只新猫出生了喵：" + this.name);
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c1 = new Cat("小橘", 3);
        Cat c2 = new Cat("狸花", 1);
        System.out.println(c1.name + " 和 " + c2.name + " 都到家了喵");
    }
}
```

```text
一只新猫出生了喵：小橘
一只新猫出生了喵：狸花
小橘 和 狸花 都到家了喵
```

前两行就是证据：每一次 `new`，那一手都**当场跑了一遍**。第一行印在 `c1` 出生的时候，第二行印在 `c2` 出生的时候，最后一行才是 `main` 里本喵自己写的。

上一课说「你一个都不写，Java 送你一个空手招式」，现在可以把它说明白了：**送了那一手，本喵才 `new` 得出一只什么都没有的空猫**；本喵自己画了这一手，出生的时候就能顺手把名字和鱼干数收好喵。

## 三、`this` 就是「这一只」

`this` 翻成猫话就是**「这一只」**。看上一节那一手活儿里最要紧的一句 —— `this.fish = fish;`：

这一句左右两边看着像在绕口令，其实清清楚楚：

- **右边的 `fish`** —— 是出生那一刻**从外面喂进来**的料（`new Cat("小橘", 3)` 里的 `3`）。
- **左边的 `this.fish`** —— 是「**这一只**猫随身带着的那件家当」。
- 整句的意思：把喂进来的 3，收进这只猫自己的账上。

**为什么要写 `this.` 这么一个前缀？** 因为本喵偷懒不写的时候，就是今天最大的那个坑 —— 下一节就撞。

## 四、最容易踩的坑：`name = name;`

本喵把上面那手活儿偷个懒，把 `this.` 去掉看看：

```java
class Cat {
    String name;

    Cat(String name) {
        name = name;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘");
        System.out.println(c.name);
    }
}
```

```text
null
```

本喵明明喂了「小橘」，印出来却是 `null` —— **翻译官一声都没吭**，这句错不报错、不拦下，只给一个错结果。

原因在这里：**招式里面的料，和图纸上的家当，摆在两层不同的地方。** 喂进来的料也叫 `name`，它在本喵眼前那一层，把图纸上那件家当**整个挡住了**。所以：

- 招式里的 `name = name;` 里的两个 `name`，**指的都是喂进来的那块料**：把「小橘」写进「小橘」自己，等于原地转了一圈，什么也没发生。
- 图纸上那件家当从头到尾**没被人碰过**，还是刚出生时的默认值 `null`（上一课说过：装一串字的牌子，默认就是 `null`）。
- 本喵后来印 `c.name`，印的是图纸上那件家当 —— 它当然还是空的。

**记住一句话：只要喂进来的料和图纸上的家当同名，就老老实实写 `this.`。** `this.name = name;` 才是「**这一只**的名字，等于喂进来的名字」喵。

顺一句老账：「方法重载与作用域」那一课说过「同一个招式里，两块牌子不能重名」—— 那说的是**同一层**里的两块牌子；图纸上的家当和招式里的料**不是同一层**，所以同名不报错，只悄悄地挡住。**不报错，才更吓人。**

从 `new` 那一下开始，到两只碗各归各，本喵把它拆成一步一步走给你看：

```demo
title: new 的那一刻：从腾地方到两只碗各归各
code:
| class Cat {
|     String name;
|     int fish;
|
|     Cat(String name, int fish) {
|         this.name = name;
|         this.fish = fish;
|     }
|
|     void report() {
|         System.out.println(this.name + " 吃了 " + this.fish + " 条");
|     }
| }
|
| Cat c = new Cat("小橘", 3);
| c.report();

step 图纸先摆好，一只猫都还没生
at: 1
say: class Cat 是张图纸 —— 家当和出生那一手都画在上面。注意：图纸不等于猫，这一刻真猫一只都没有，那两件家当也就没人拥有。
meow: 图纸画好了，猫还没生喵～
pose: expect
家当 name = （还没有这一只）
料 name = （还没有料）
家当 fish = （还没有这一只）

step new 的第一件事：给新猫腾一块地方
at: 15
say: new Cat("小橘", 3) 跑起来，头一件事不是跑那一手，而是先腾出一块地方给这只新猫 —— 图纸上那两件家当在这儿各就各位，只是都还是默认值：装一串字的碗是 null，装整数的碗是 0。
meow: 地方腾好了，两只碗都空着喵～
pose: expect
家当 name = null
料 name = 小橘（还捏在手上）
家当 fish = 0

step 出生那一手自己动了
at: 5
say: 本喵一声都没喊它 —— 是 new 把这手 Cat(String name, int fish) 叫起来的。它一进来，喂的两样料「小橘」和「3」就归这一手管。
meow: 本喵没喊它，它自己动起来了！
pose: busy
家当 name = null（还没装）
料 name = 小橘
家当 fish = 0（还没装）

step 同一行上的两只碗：左、右各是谁的
at: 6
say: 看这一行的左右两边：左边的 this.name 是这一只自己的家当碗，右边的 name（没写 this. 的那个）是喂进来的料。两位同名，却是两只碗。
meow: 左边是这一只的，右边是料喵！
pose: think
家当 name = null（还没装）
料 name = 小橘
家当 fish = 0（还没装）

step 倒进去：这一只的名字到手
at: 6
say: 等号把右边那碗倒进左边那只碗：这一只的 name 从 null 变成「小橘」。能倒对碗全靠那个 this. —— 少了它，两边就成了同一只碗，原地转一圈，什么也没发生。
meow: 小橘倒进这只猫自己的碗里！
pose: yay
家当 name = 小橘
料 name = 小橘
家当 fish = 0（还没装）

step 第二件家当照办
at: 7
say: this.fish = fish; 一模一样的规矩：左边那只是这一只的鱼干碗，右边那块是喂进来的 3。装完这一句，这只新猫的家当就齐了。
meow: 鱼干数也装好了，3 条喵～
pose: yay
家当 name = 小橘
料 name = 3
家当 fish = 3

step 出生那一手跑完，new 才收工
at: 15
say: 那一手一结束，new 这一下就收工了 —— 它把刚收拾好的这只猫交到本喵手上，c 这块牌子底下就是它：名字小橘、鱼干 3 条，两件家当都是出生那一刻装好的。
meow: 一只装好的猫交到手上啦～
pose: proud
家当 name = 小橘
料 name = （这一手跑完了）
家当 fish = 3

step 报账时读的还是这一只自己的碗
at: 16
say: c.report() 里那句 this.name，读的还是牌子底下这一只的家当 —— 所以印出来是「小橘 吃了 3 条」，不是别的猫，也不是喂进来的料。
meow: 印出来：小橘 吃了 3 条！
pose: proud
家当 name = 小橘
料 name = （这一手跑完了）
家当 fish = 3
```

**这条链子记住就不会再写漏 `this.`**：`new` 先腾地方 → 出生那一手**自动**跑一遍 → 里面每一句 `this.xxx = xxx`，左边是**这一只**的家当碗、右边是**喂进来的料**。换句话说，`this` 指的永远是「**正在做这件事的这一只**」。

## 五、一窝猫，两种出生法：重载构造

有的猫是主人抱着进门的（有名字、有鱼干数），有的猫是路边捡的（还没名字）—— 本喵想给这两种出生法各写一手：

```java
class Cat {
    String name;
    int fish;

    Cat() {
        this("无名氏", 0);
    }

    Cat(String name, int fish) {
        this.name = name;
        this.fish = fish;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c1 = new Cat();
        Cat c2 = new Cat("小橘", 3);
        System.out.println(c1.name + " " + c1.fish);
        System.out.println(c2.name + " " + c2.fish);
    }
}
```

```text
无名氏 0
小橘 3
```

两手的名字都叫 `Cat`，靠**喂料不一样**分开 —— 上一课学的挑招规矩（招名一样、投喂口不一样）在这儿又用上了：`new Cat()` 走空手那一手，`new Cat("小橘", 3)` 走收两样料的这一手喵。

第一手身子里那句 `this("无名氏", 0);` 是个省事的写法：**把这一只的活儿转给另一手干**。这样「挂名字、记鱼干数」这套活儿只写一遍，以后要改也只改一处。

它的死规矩只有一条：**必须是身子的第一句。** 转给另一手之前，这一只还没被收拾好，所以本喵不能先干别的、再回头转。

## 六、四处必撞的报错

### 1. 名字写错了

```java
class Cat {
    String name;

    Cat2(String name) {
        this.name = name;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘");
        System.out.println(c.name);
    }
}
```

```text
Main.java:4: error: invalid method declaration; return type required
    Cat2(String name) {
    ^
1 error
```

念起来是：**「这一手既不是正经招式（没写叼回来什么），名字又不是图纸名 —— 那它到底算什么喵？」**

翻译官认招式有一套死规矩：要么名字和图纸同名（那是出生那一手），要么前面写清「叼回来什么」（`void`、`int` 这些，那是普通招式）。`Cat2(...)` 两条都不占，它只能拦下来问本喵要个说法。

### 2. 多写了一截 `void`

```java
class Cat {
    String name;

    void Cat(String name) {
        this.name = name;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘");
        System.out.println(c.name);
    }
}
```

```text
Main.java:11: error: constructor Cat in class Cat cannot be applied to given types;
        Cat c = new Cat("小橘");
                ^
  required: no arguments
  found:    String
  reason: actual and formal argument lists differ in length
1 error
```

这一处特别值得看：本喵头一句明明写的是 `Cat`，可**多了一截 `void`**，它就从「出生那一手」变成了**一个碰巧叫 `Cat` 的普通招式**，身子里的活儿再也不会在出生那一刻跑了。

于是出生的时候，还是 Java 送的那个**空手招式**在管事（不收料、不干活），而本喵喂了「小橘」进去 —— `required: no arguments` 是「出生这一手一样东西都不收」，`found: String` 是「你却喂了一样东西」喵。

### 3. 出生时喂的料对不上

```java
class Cat {
    String name;

    Cat(String name) {
        this.name = name;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat();
        System.out.println(c.name);
    }
}
```

```text
Main.java:11: error: constructor Cat in class Cat cannot be applied to given types;
        Cat c = new Cat();
                ^
  required: String
  found:    no arguments
  reason: actual and formal argument lists differ in length
1 error
```

和上一处的报错长得一模一样，只是 `required` 和 `found` **对调了**：

| | required（出生那一手要什么） | found（本喵喂了什么） |
|---|---|---|
| 第 2 处：多写 `void` | `no arguments`（空手） | `String`（喂了一样） |
| 第 3 处：少喂料 | `String`（要一样） | `no arguments`（一声没喂） |

看到 `constructor ... cannot be applied to given types`，就照这两行读一遍：**要什么、给了什么**，对不上就是它。第 3 处的正路很简单：`new Cat("小橘")`，把料喂上喵。

### 4. `this(...)` 没放在第一句

```java
class Cat {
    String name;
    int fish;

    Cat() {
        System.out.println("先印一句喵");
        this("无名氏", 0);
    }

    Cat(String name, int fish) {
        this.name = name;
        this.fish = fish;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat();
        System.out.println(c.name);
    }
}
```

```text
Main.java:7: error: call to this must be first statement in constructor
        this("无名氏", 0);
            ^
1 error
```

念起来是：**「喊 `this(...)` 那一句必须是出生这一手的第一句喵。」** 本喵先印了一句才转手，翻译官就在转手那一行拦下了 —— 不是它小气，是「转手」这件事的含义就是「这一只从头按另一手来收拾」，中间夹了别的活儿，就说不清了喵。

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `Cat(String name, int fish) { ... }` | **出生那一手**：名字和图纸同名、前面不带 `void` 那一截 |
| `new Cat("小橘", 3)` | 照图纸生一只，并且**当场**把这一手跑一遍 |
| `this.name = name;` | 「**这一只**的名字」＝喂进来的名字 |
| `name = name;`（忘了 `this.`） | 料把图纸上的家当挡住了 → 家当还是 `null`（**不报错**） |
| `Cat() { this("无名氏", 0); }` | 空的出生法，把活儿转给另一手干 |
| `this(...)` 的位置 | **必须是身子的第一句** |
| `Cat2(...)` | 名字既不是图纸名、又没写叼回来什么 → `invalid method declaration` |
| `void Cat(...)` | 变普通招式了，不再管出生 → `constructor ... cannot be applied` |

::: tip 猫咪提示
今天记住四句话：

1. **出生那一手＝名字和图纸同名、不带 `void` 那一截、在 `new` 的那一刻自动跑一遍。**
2. **`this` 就是「这一只」**：`this.name` 是这只猫自己的家当，光写 `name` 是本喵眼前那块料。
3. **料和家当同名，一律写 `this.`** —— 忘了它不报错，只给一个错结果。
4. **`this(...)` 转手必须是第一句**；空手 / 带料两种出生法同名不同料，电脑按喂料自己挑（重载那一套）。
:::

::: warn 小心喵
三个最容易摔的地方：

- **`name = name;` 这种「原地转一圈」**是本课最阴的坑：翻译官不吭声，本喵得自己看出来 —— 印出来是 `null`、不是喂进去的名字，就是它。
- **`void Cat(...)` 看着像出生那一手，其实已经被降级成普通招式了**；出生时用的还是 Java 送的空手那一手。
- **`new Cat()` 喂的料必须和某一手出生法对得上**，对不上就撞 `cannot be applied to given types`；读了 `required` / `found` 两行就知道差在哪。
:::

## 小任务

1. 给本喵的 `Cat` 写一手出生法 `Cat(String name)`（只收名字），身子里把鱼干数记成 `0`。再生两只猫，印出它们的名字和鱼干数看看喵。
2. 把第四节那个坑`name = name;` 抄进去、跑一遍，确认印出来是 `null`；再把 `this.` 补上，再跑一遍，把两次的输出抄在小本本上对照。
3. 故意把出生那一手的名字写成 `Cat2`，编译一次，把原话抄下来；再把 `void` 加回去（变普通招式），编译一次，看看第二句原话里 `required` / `found` 各写了什么。
4. 给图纸写**三手**出生法：`Cat()`、`Cat(String name)`、`Cat(String name, int fish)`。让前两手都把活儿转给最后一手干（`this(...)`），自己动手试出「转手必须是第一句」这条规矩（提示：把 `this(...)` 挪到印字后面，看看原话是什么）。
5. 想一想：`this.fish = fish;` 里的 `this` 和上一课 `c.meow()` 里的 `c`，说的是不是同一只猫？（下一课揭晓喵～）

下一课是本阶段的最后一课，本喵要教一件**保命**的本事：程序跑到一半翻车了怎么办 —— 不会用这一手的人，写出来的东西一撞上意外就当场断气；会用的人，能让它翻完车接着把账记完。去下一课探险喵～ 🐾
