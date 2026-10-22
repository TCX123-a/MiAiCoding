---
id: java-stage2-01
lang: java
stage: 2
order: 1
title: 封装与访问修饰符
tags: [面向对象, 封装]
required: ["java-stage1-15"]
crossRefs: []
estMinutes: 25
keywords: [private, public, getter, setter]
---

## 钩子：账本被改成负数了喵

本喵在鱼塘边开了个小铺子：每只来吃饭的猫都有一本自己的小账本，上面记着名字、还有今天吃了几条小鱼干。开张头一天，本喵把账本摊在桌上就跑去晒太阳了 —— 回来一看，小橘那一页写着 **-5 条**。

代码就长这样：

```java
class Cat {
    String name;
    int fish;
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat();
        c.name = "小橘";
        c.fish = -5;
        System.out.println(c.name + " 有 " + c.fish + " 条小鱼干");
    }
}
```

```text
小橘 有 -5 条小鱼干
```

账本摊开着，谁路过都能伸手进来改一笔 —— 改成负的也没人拦，改完还不打招呼。今天本喵就要给账本加个**盖子**。

## 一、盖子开了给谁，由本喵说了算

盖子的正式名字叫**带盖的小鱼干盒（封装）**：家当还是那些家当，只是本喵给盒子配了盖子，**盖子开给谁、关着不给谁，是本喵自己定的规矩**。别人想动里面的东西，得走本喵留的那扇小窗。

Java 的盖子上有四档锁，写在一行家当的最前面：

| 写在最前面 | 谁伸得进手 |
|---|---|
| `private` | **只有这张图纸自己** —— 图纸里写的招式能用，出了这张图纸谁都别想 |
| 什么都不写 | 同一个外卖箱（包）里的邻居也能伸手 —— 本喵今天先不用这一档 |
| `protected` | 本喵自己，再加上照这张图纸往下再画的小图纸（下一课就学怎么画） |
| `public` | 谁都能伸手 —— 等于没盖子 |

四个词都叫**访问修饰符**：它管的就是「**这扇门，允许谁进去**」这一件事喵。

## 二、给账本盖上盖子，再开两扇小窗

本喵把两样家当都盖上，另外留两扇小窗：

```java
class Cat {
    private String name;
    private int fish;

    Cat(String name) {
        this.name = name;
    }

    public String getName() {
        return name;
    }

    public int getFish() {
        return fish;
    }

    public void setFish(int fish) {
        if (fish < 0) {
            System.out.println("鱼干数不能是负的喵");
            return;
        }
        this.fish = fish;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘");
        c.setFish(-5);
        c.setFish(3);
        System.out.println(c.getName() + " 有 " + c.getFish() + " 条小鱼干");
    }
}
```

```text
鱼干数不能是负的喵
小橘 有 3 条小鱼干
```

一行一行看喵：

- **`private String name;`** —— 名字这盒盖子扣上了，出了这张图纸谁都伸不进手。
- **`Cat(String name) { this.name = name; }`** —— 出生那一手**在图纸里面**，所以它伸手拿自己的私房家当**完全合法**。可见盖子拦的是「外面的人」，不是「本喵自己」。
- **`public String getName() { return name; }`** —— 这就是一扇小窗：外面喊一声 `c.getName()`，本喵替它把名字**读**出来。招式的身子在图纸里，所以它伸得进手。
- **`public void setFish(int fish) { ... }`** —— 这是**进货口**。外面想把鱼干数改掉，只能从这里递进来。本喵在门口立了块牌子：**小于 0 的一律不收**。
- **`c.setFish(-5);`** —— 递进来的是负数，被门口的牌子挡回去了，只印了一句提示，账本上**一个字都没改**。
- **`c.setFish(3);`** —— 这一笔收下了，账本才从 0 变成 3。

最后一行的 `小橘 有 3 条小鱼干` 就是证据：那笔坏账**根本没进盒子**。

**这两扇小窗是有名字的**：专门读的叫 `get` 开头的招式（读名字用 `getName`、读鱼干数用 `getFish`），专门写的叫 `set` 开头的招式（写名字用 `setName`、写鱼干数用 `setFish`）。这个起名习惯是 Java 世界里传下来的老规矩，谁看都知道它是干什么的，别自己另起名喵。

那笔坏账到底是在哪一步被挡回去的、盒子里的数有没有偷偷变过，本喵拆成一步一步走给你看：

```demo
title: 递一笔坏账进进货口，盒子里的数会不会变
code:
| class Cat {
|     private int fish;
|
|     public int getFish() {
|         return fish;
|     }
|
|     public void setFish(int fish) {
|         if (fish < 0) {
|             System.out.println("鱼干数不能是负的喵");
|             return;
|         }
|         this.fish = fish;
|     }
| }
|
| Cat c = new Cat();
| c.setFish(-5);
| c.setFish(3);
| System.out.println(c.getFish());

step 先把盖子扣上
at: 2
say: private int fish; —— 鱼干数这盒家当扣上了盖子。private 的意思是「只有这张图纸自己伸得进手」：图纸里写的招式能用它，出了这张图纸，谁都别想。
meow: 盖子扣好啦，钥匙只留图纸里喵～
pose: expect
盒子里的数 = 0（刚出生就是这个）
递进来的料 = （还没递）
外面推得动的门 = （一扇都还没有）

step 图纸里的招式伸自己的手，合法
at: 5
say: getFish() 是图纸上留下的一扇读的小窗。它念的 return fish; 是图纸里面的招式 —— 伸自己的手拿自己家的家当，完全合法。盖子拦的是外面的人，不拦自己。
meow: 自己人伸手，盖子不拦喵～
pose: expect
盒子里的数 = 0
递进来的料 = （还没递）
外面推得动的门 = 读窗 getFish（只读）

step 唯一能改数的那扇门：进货口
at: 8
say: setFish(int fish) 是进货口。外面想把鱼干数改掉，只有这一条路 —— 门开在图纸上，可料必须从门外递进来。
meow: 想改数？只能从这道门递喵～
pose: expect
盒子里的数 = 0
递进来的料 = （还没递）
外面推得动的门 = 进货口 setFish（唯一能改）

step 门口立着一块牌子
at: 9
say: 进货口里第一句就是本喵立的牌子：if (fish < 0) —— 小于 0 的一律不收。规矩写在图纸里，不指望别人自觉。
meow: 门口有牌子：负的一律不收！
pose: think
盒子里的数 = 0
递进来的料 = （还没递）
外面推得动的门 = 进货口 + 门口的牌子

step 把一笔 -5 顺着门递进去
at: 18
say: c.setFish(-5); 把 -5 递了进来。这一递，活儿就交给了图纸里那一手：门外的人只能递料，改数那一下得由图纸里的招式自己动手。
meow: 递进去一笔 -5，看它收不收～
pose: expect
盒子里的数 = 0
递进来的料 = -5（正递着）
外面推得动的门 = 进货口 + 门口的牌子

step 牌子先问一句
at: 9
say: 门口那块牌子当场一算：-5 小于 0 吗 —— 答「是」。牌子认出了这笔坏账，下面就不能再往下走了。
meow: -5 比 0 小，被牌子拦下！
pose: think
盒子里的数 = 0
递进来的料 = -5（被牌子拦下）
外面推得动的门 = 进货口 + 门口的牌子

step return 一跑，装数那句根本没轮到
at: 11
say: return; 的意思是「这一手到此为止」—— 它一跑，底下装数的 this.fish = fish; 就没轮到。所以盒子里一点没动，还是 0：坏账不是「悄悄进去了」，是被拦在门外了。
meow: 收手啦！盒子里的数一点没变～
pose: think
盒子里的数 = 0
递进来的料 = -5（没进去）
外面推得动的门 = 进货口 + 门口的牌子

step 再递 3：这回放行
at: 19
say: c.setFish(3); 又递一笔。牌子一算，3 不小于 0，没拦它的路 —— 装数那句真的跑到了，盒子里的数这才从 0 变成 3。同一扇门，一笔进不来、一笔进来了，差别全在门口那块牌子。
meow: 3 收下啦，盒子里变成 3！
pose: yay
盒子里的数 = 3
递进来的料 = 3（收下了）
外面推得动的门 = 进货口 + 门口的牌子

step 隔着读窗喊一声，屏幕上印出 3
at: 20
say: System.out.println(c.getFish()); 外面自己够不着那盒家当，只能隔着读窗喊一声，由图纸里的招式替它把数取出来 —— 屏幕上印出 3。这就是加盖子最值钱的地方：数字怎么变，规矩说了算。
meow: 印出来是 3，那笔坏账白递了喵～
pose: proud
盒子里的数 = 3
递进来的料 = （读窗只取不改）
外面推得动的门 = 读窗 getFish（只读）
```

**能推的门就这几扇**：读的走 `getXxx`、写的走 `setXxx`，坏账连门都进不来。要是不走小窗、直接伸手够外面的 `c.fish` 呢？那是**翻稿子的时候**就被拦下，程序一趟都跑不起来 —— 下一节就撞喵。

## 三、隔着盖子伸手，翻译官喵当场拦下

本喵试过不走小窗、直接伸手 —— 结果连编译那一关都过不去：

```java
class Cat {
    private String name;

    Cat(String name) {
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
Main.java:12: error: name has private access in Cat
        System.out.println(c.name);
                            ^
1 error
```

原话念起来是：**「`name` 是 `Cat` 自己的私房家当，外面的人不许直接碰喵。」**

有一件事要记牢：这颗钉子是在**翻译官喵翻稿子的时候**就钉下来的 —— 程序**一趟都没跑**，javac 直接不让它出生。

::: warn 小心喵

- **盖子拦的是外面，不拦自己。** 图纸里的招式、还有出生那一手，伸手拿 `private` 家当照样合法 —— 上面第二节那手 `this.name = name;` 就是活证据。
- **这颗钉子是编译期钉的，不是运行期炸的。** 你会先看到 `error:` 原话，然后才发现程序压根没跑起来 —— 和「跑到一半才翻车」完全不一样。
- **四面盖子没有「更安全」的默认值**。什么都不写不是 `private`，是「同一个外卖箱里的邻居也能伸手」。想锁就老老实实写 `private` 喵。
:::

## 四、只给读的小窗，就是「只能看不能改」

小窗不是必须成对开的。有的家当本喵**只想让人看**，那就只开读的那一扇：

```java
class Cat {
    private int fish;

    public int getFish() {
        return fish;
    }

    public void feed(int n) {
        fish = fish + n;
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat();
        c.feed(2);
        c.feed(3);
        System.out.println(c.getFish());
    }
}
```

```text
5
```

鱼干数只有 `feed` 这一条路能改（喂一顿加一点），外面**没有任何一扇窗可以直接写它**。想吃鱼干？喂就是了 —— 想凭空把数字改成 100？没门儿喵。

这就是加盖子最值钱的地方：**规矩写在图纸里，而不是写在「大家自觉一点」里**。小橘的账本从此只有本喵能记账。

::: tip 猫咪提示

1. **家当一律先盖盖子**（`private`），要开就开小窗 —— 这是 Java 世界的默认姿势。
2. **小窗分两扇**：`getXxx` 只读、`setXxx` 才写；只开读的那扇，盒子就是「只能看不能改」。
3. **小窗是唯一的口子，也是立规矩的地方** —— 想挡住坏账，就把检查写在 `setXxx` 里（本喵那块「小于 0 不收」的牌子）。
4. **四个盖子词**：`private`（只有自己）、什么都不写（同外卖箱的邻居）、`protected`（自己 + 往下画的小图纸）、`public`（谁都能伸）。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `private String name;` | 给这盒家当扣上盖子，出了图纸谁都别想碰 |
| `public String getName() { return name; }` | 开一扇**只读**的小窗 |
| `public void setFish(int fish) { ... }` | 开一扇**可写**的小窗，顺便在门口立规矩 |
| `this.name = name;`（写在图纸里） | 自己人伸手，合法 |
| `c.name`（写在图纸外面） | 隔着盖子伸手 → `name has private access in Cat` |
| `c.setFish(-5);` 被挡回去 | 坏账连盒子都没进 —— 这就是加盖子的意义 |
| `protected` | 自己 + 照这张图纸往下再画的小图纸能用 |
| 什么都不写 | 同一个外卖箱里的邻居也能伸手（不是「更安全」） |

## 小任务

1. 给本喵的 `Cat` 再加一盒盖起来的家当 `private String hobby;`（爱好），配一扇读的小窗和一扇写的小窗，生一只猫、写下它的爱好、再读出来看看喵。
2. 把 `setFish` 里那块牌子改成「**一次最多只收 5 条**」（超过就只印一句提示、不收），试试 `c.setFish(100)` 之后账本上还是几。
3. 把第三节那段抄进练习场，编译一次，把翻译官喵的原话一字不差地记进小本本；再删掉那个 `private`（变成什么都不写），看看还报不报错 —— 体会一下「盖子是自己扣上的，不是天生就有的」。
4. 想一想：本喵这个盒子，**只开读的那扇窗、不开写的那扇**的时候，外面的猫还有没有办法把数字改掉？（提示：真猫是照图纸生出来的，本喵要看看它自己的家当在哪儿。）

下一课，本喵要教一个更省事的办法：**图纸套图纸** —— 两张图纸上有一模一样的家当和招式，就不用抄两遍了，让小的那张天生就会大图纸上的一切。另外还要认识 `super` 这个小词，它是图纸套图纸时最要紧的一句话喵～ 🐾
