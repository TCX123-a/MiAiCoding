---
id: java-stage3-10
lang: java
stage: 3
order: 14
title: 线程同步与锁
tags: [多线程, 同步, 锁]
required: ["java-stage3-09"]
crossRefs: []
estMinutes: 26
keywords: [synchronized, Lock, ReentrantLock, unlock, deadlock]
---

## 钩子：账本只有一本

上一课本喵把猫派出去干活，那是**每只猫各数各的**：小橘数小橘那一格、狸花数狸花那一格，谁也不碰谁的东西。鱼塘上的账没这么好分 —— **账本只有一本**，两只猫都得往**同一本**上记。

同一天里两只猫一起记，会出什么事？本喵今天就把这件事跑给你看。

## 一、同一本账、两只猫一起记：数会少

一只猫每记一笔，机器要替它做三下：**把账本上的数读出来、加上一、再写回去**。

```java
public class Main {
    public static void main(String[] args) throws Exception {
        Cat 甲 = new Cat("小橘", 100000);
        Cat 乙 = new Cat("狸花", 100000);

        甲.start();
        乙.start();

        甲.join();
        乙.join();

        System.out.println("账本：" + Cat.账本 + " 条");
    }
}

class Cat extends Thread {
    static int 账本 = 0;

    String 名字;
    int 要记;

    Cat(String 名字, int 要记) {
        this.名字 = 名字;
        this.要记 = 要记;
    }

    public void run() {
        for (int i = 0; i < 要记; i++) {
            账本 = 账本 + 1;
        }
    }
}
```

`账本` 那一格摆在图纸上，还带了个 `static`，读作「**这一格只有一份，照这张图纸长的猫都共用它**」—— 两只猫记的是同一本账。一只十万笔、另一只也十万笔，加起来该是 `200000`。

本喵连跑了十趟，机器给回来的数是 `155425`、`115001`、`133833`、`155807`、`155281`、`140005`、`140703`、`131162`、`149183`、`136272` —— **一趟都没到 `200000`**，最惨的一趟连十五万五都摸不到。

不是哪只猫偷懒，是那三下**中间被插了队**：两只猫同时读到 `100000`，各自加一，各自写回 `100001` —— 其中一次加数就这么凭空没了。就像两个人同时写同一本账，甲写完、乙又照着自己刚才看到的旧数写了一遍。

::: warn 小心喵

**这一节本喵一个字的标准答案都没写。** 十趟十个样，写死哪一个都是假的。

这一课的坑跟上一课不一样：上一课是活**没人干**；这一课是活**干了、记丢了**。它不红不响、跑完收工，只有账本上的数不对 —— 所以更难发现。

:::

## 二、给这段活上锁

毛病出在「读出来、加一、写回去」这一套动作**不许两只猫一起做**。那就立个规矩：**一次只许一只猫进去记，进去的那一只没出来之前，别的猫在门口等。**

```java
public class Main {
    public static void main(String[] args) throws Exception {
        Cat 甲 = new Cat("小橘", 100000);
        Cat 乙 = new Cat("狸花", 100000);

        甲.start();
        乙.start();

        甲.join();
        乙.join();

        System.out.println("账本：" + Cat.账本 + " 条");
    }
}

class Cat extends Thread {
    static final Object 账本锁 = new Object();
    static int 账本 = 0;

    String 名字;
    int 要记;

    Cat(String 名字, int 要记) {
        this.名字 = 名字;
        this.要记 = 要记;
    }

    public void run() {
        for (int i = 0; i < 要记; i++) {
            synchronized (账本锁) {
                账本 = 账本 + 1;
            }
        }
    }
}
```

```text
账本：200000 条
```

多出来的就是那一对括号里的东西：`synchronized (账本锁) { ... }`，读作「**这一段，一次只许一只猫进来**」。

- **`账本锁` 是本喵专门造出来当锁用的**：`static final Object 账本锁 = new Object();` —— 它上面不记任何东西，就管「谁在里面」。
- **要抢的必须是同一把锁。** `账本锁` 带 `static`，所以照这张图纸长的猫共用这一把；要是每只猫各造一把自己留着，就成了各锁各的门，谁也拦不住谁。
- **进不去的猫在门口等**，等到里面那只出来再进去 —— 等，不是丢下活走了。
- **锁只护住这一小段。** 那十万次转圈在锁外面，一次一次地进去、记一笔、出来。锁是「一圈只放一只猫」用的，不是把整段活全锁上。

这一对括号到底是怎么护住那三下的，本喵拆成一步一步走给你看：

```demo
title: 一把锁一次只放一只猫：谁在里面、谁在门口等
code:
| class Cat extends Thread {
|     static final Object 账本锁 = new Object();
|     static int 账本 = 0;
|
|     String 名字;
|     int 要记;
|
|     Cat(String 名字, int 要记) {
|         this.名字 = 名字;
|         this.要记 = 要记;
|     }
|
|     public void run() {
|         for (int i = 0; i < 要记; i++) {
|             synchronized (账本锁) {
|                 账本 = 账本 + 1;
|             }
|         }
|     }
| }
|
| Cat 甲 = new Cat("小橘", 100000);
| Cat 乙 = new Cat("狸花", 100000);
|
| 甲.start();
| 乙.start();
|
| 甲.join();
| 乙.join();
|
| System.out.println("账本：" + Cat.账本 + " 条");

step 先造那把锁
at: 2
say: `static final Object 账本锁 = new Object();` —— 这把锁是本喵专门造出来当锁用的：它上面不记任何东西，就管「谁在里面」。**`static` 是最要紧的一笔**，照这张图纸长的猫**共用这一把**。
meow: 先造一把大家共用的锁！
pose: expect
账本 = （还没摆出来）
两只猫 = （还没画）
锁在谁手上 = （刚造好，没人拿）
门口等着谁 = （没人）

step 账本也只有一份
at: 3
say: `static int 账本 = 0;` 也带 `static`，读作「**这一格只有一份，照这张图纸长的猫都共用它**」。两只猫记的是**同一本**账 —— 这一节要护住的就是它。
meow: 账本只有一本，两只猫共用喵！
pose: expect
账本 = 0
两只猫 = （还没画）
锁在谁手上 = （还没人拿）
门口等着谁 = （没人）

step 画两只猫，各领十万笔
at: 22
say: `Cat 甲 = new Cat("小橘", 100000);` 和紧接着的下一行，各画一只猫：递名字、递「这一趟要记**十万笔**」。两只要记的笔数一样多，都记完该是 `200000`。
meow: 两只猫各领十万笔的活！
pose: expect
账本 = 0
两只猫 = 甲、乙都画好了，各要记 100000 笔
锁在谁手上 = （还没人拿）
门口等着谁 = （没人）

step 派两只出去，各转各的
at: 25
say: `甲.start();`、`乙.start();` 两句把它们派出去 —— **派完本喵就往下走了**。两只猫各转各的十万圈，谁先转到第几圈，本喵写不了保证书。
meow: 两只都派出去，各转各的十万圈！
pose: busy
账本 = 0
两只猫 = 都派出去了，各转各的
锁在谁手上 = （还没人拿）
门口等着谁 = （没人）

step 甲撞上锁：门里没人，进去
at: 15
say: 甲转到某一圈，撞上 `synchronized (账本锁) {`：门里没人，甲**推门进去了**。这一对括号读作「**这一段，一次只许一只猫进来**」。
meow: 门里没人，甲推门进去啦！
pose: busy
账本 = 0
两只猫 = 都在转圈（甲撞上锁，进去了）
锁在谁手上 = 甲（小橘）
门口等着谁 = （还没人）

step 乙也撞上同一句：门口等
at: 15
say: 乙也转到同一句，可门里有人 —— **乙进不去，在门口等**。注意是「等」，不是把活丢下走了：等甲出来，乙立刻接上。（这一趟是甲先到；也可能乙先到，门里永远只有一只就对了。）
meow: 门里有人，乙乖乖在门口等～
pose: think
账本 = 0
两只猫 = 都在转圈（乙也到了门口）
锁在谁手上 = 甲（小橘）
门口等着谁 = 乙（狸花）

step 甲在门里记这一笔：先读出来、加上一
at: 16
say: 门里做的是 `账本 = 账本 + 1;`。机器替甲做三下：**读出来**（读到 0）、**加上一**（手里捏着 1）、**写回去**。这一步只做完前两下 —— **账本那一格还是 0**，本喵手里捏着 1。
meow: 读到 0，加一，还捏在手上喵！
pose: busy
账本 = 0（还没写回去）
两只猫 = 都在转圈
锁在谁手上 = 甲（小橘）
门口等着谁 = 乙（狸花）

step 第三下：写回去
at: 16
say: 第三下**写回去**：账本从 0 变成 1。**这三下是被那对括号圈成一整块的** —— 甲做完整块之前，乙连第一下都别想开始。第一节丢数丢的就是这道缝，这里它没了。
meow: 写回去！账本变 1 啦！
pose: yay
账本 = 1
两只猫 = 都在转圈
锁在谁手上 = 甲（小橘）
门口等着谁 = 乙（狸花）

step 甲出锁，乙立刻接手
at: 17
say: 甲出了这一对括号，锁放下 —— 门口等着的乙**立刻接手进去**。一圈就是这么走完的：撞锁、等、三下、出锁。
meow: 甲出来，乙马上接手进去！
pose: busy
账本 = 1
两只猫 = 都在转圈（乙进去了）
锁在谁手上 = 乙（狸花）
门口等着谁 = （没人）

step 一圈一圈，十万圈都这么来
at: 14
say: 一圈走完，控制回到 `for` 那一行接着转 —— 后面九万九千九百九十九圈，每一圈都是刚才这四步。锁护着的只是「读-加-写」那一小段：**十万次转圈都在锁外面**，一次一次地进去、记一笔、出来。
meow: 一圈一圈来，锁只护那一小段！
pose: busy
账本 = 一圈一笔地涨（还没数完）
两只猫 = 各转各的，轮着进出锁
锁在谁手上 = 甲、乙轮着拿
门口等着谁 = 轮着等

step 站门口等两只都回来
at: 28
say: `甲.join();`、`乙.join();` 是「**站门口等它俩都回来**」。两句都过了才轮到印 —— 不 join 就印，印出来的数说不准（第一节那十趟就是这么飘的）。
meow: 站门口等两只都回来再印！
pose: expect
账本 = 200000（两半都记完了）
两只猫 = 都转完了，各十万圈
锁在谁手上 = （没人拿）
门口等着谁 = （没人）

step 印出账本
at: 31
say: 印出来是 `账本：200000 条` —— **一笔都没丢**。对照第一节那把没上锁的版本：课文里连跑十趟，十趟都没到 200000。同一段活，差别只在那对括号上。
meow: 200000！一笔都没丢喵～
pose: proud
账本 = 200000
两只猫 = 都转完了
锁在谁手上 = （没人拿）
门口等着谁 = （没人）
```

**这一节就记一件事**：`synchronized (账本锁) { ... }` 把「读出来、加一、写回去」三下圈成一整块，一次只放一只猫进去；门口等着的猫是**等**，不是丢下活走了。第一节那把没上锁的版本，丢数就丢在这道缝里。

## 三、把锁上在「记一笔」这件事上

上一节那把锁是本喵自己造的。还有一种写法：**把锁直接上在「记一笔」这件事上**，谁要记谁就得先经过这儿。

```java
public class Main {
    public static void main(String[] args) throws Exception {
        Cat 甲 = new Cat("小橘", 100000);
        Cat 乙 = new Cat("狸花", 100000);

        甲.start();
        乙.start();

        甲.join();
        乙.join();

        System.out.println("账本：" + Cat.账本 + " 条");
    }
}

class Cat extends Thread {
    static int 账本 = 0;

    String 名字;
    int 要记;

    Cat(String 名字, int 要记) {
        this.名字 = 名字;
        this.要记 = 要记;
    }

    public void run() {
        for (int i = 0; i < 要记; i++) {
            记一笔();
        }
    }

    static synchronized void 记一笔() {
        账本 = 账本 + 1;
    }
}
```

```text
账本：200000 条
```

`static synchronized void 记一笔()` 里的 `synchronized` 读作「**这一刻只许一只猫进来**」：两只猫都得排这一把锁，排到了才能记上一笔。这里的锁不是本喵造的，是**这张图纸自己**—— 照它长的猫共用的还是同一把。

::: warn 小心喵

**那个 `static` 千万不能漏。** 本喵试过把 `static` 去掉（写成 `synchronized void 记一笔()`）：锁就从「这张图纸」变成了「**每一只猫自己**」—— 两只猫各锁各的，等于没锁。

去掉 `static` 之后本喵连跑五趟，数分别是 `186957`、`188092`、`194944`、`172659`、`177409`，一趟都没到 `200000`。**看着有锁，其实拦不住谁。**

:::

## 四、自己拿自己放：`Lock`

还有一路写法：**锁不用关键字，改成一只手动的**。本喵自己拿、自己放，但拿和放必须配对。

```java
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

public class Main {
    public static void main(String[] args) throws Exception {
        Cat 甲 = new Cat("小橘", 100000);
        Cat 乙 = new Cat("狸花", 100000);

        甲.start();
        乙.start();

        甲.join();
        乙.join();

        System.out.println("账本：" + Cat.账本 + " 条");
    }
}

class Cat extends Thread {
    static final Lock 锁 = new ReentrantLock();
    static int 账本 = 0;

    String 名字;
    int 要记;

    Cat(String 名字, int 要记) {
        this.名字 = 名字;
        this.要记 = 要记;
    }

    public void run() {
        for (int i = 0; i < 要记; i++) {
            锁.lock();
            try {
                账本 = 账本 + 1;
            } finally {
                锁.unlock();
            }
        }
    }
}
```

```text
账本：200000 条
```

- **`static final Lock 锁 = new ReentrantLock();`** —— 造一把手动锁。它跟 `synchronized` 干的是一件事，只是**拿和还要本喵自己写**。
- **`锁.lock();` 是拿**：别人拿着的时候，这一句会一直等着，等到拿上为止。
- **`锁.unlock();` 是还**：记完必须还，不然别的猫永远等在门口。
- **`unlock` 摆在 `finally` 里最稳**：`finally` 读作「**不管中间顺不顺，收尾这一下都得做**」。万一加数那一段出了岔子，锁照样还回去；直接写在后面，出了岔子就还不上了。

## 五、一次要拿两把锁：次序要统一

有时候一只猫要动两样东西：先拿碗、再拿账本，两样都拿到了才记一笔。这时候**次序**成了天大的事。

```java
public class Main {
    public static void main(String[] args) throws Exception {
        Cat 甲 = new Cat("小橘");
        Cat 乙 = new Cat("狸花");

        甲.start();
        乙.start();

        甲.join();
        乙.join();

        System.out.println("账本：" + Cat.账本 + " 条");
    }
}

class Cat extends Thread {
    static final Object 碗锁 = new Object();
    static final Object 账本锁 = new Object();
    static int 账本 = 0;

    String 名字;

    Cat(String 名字) {
        this.名字 = 名字;
    }

    public void run() {
        synchronized (碗锁) {
            synchronized (账本锁) {
                账本 = 账本 + 1;
            }
        }
    }
}
```

```text
账本：2 条
```

这一份里，**两只猫都是先拿碗、再拿账本** —— 次序一模一样，所以谁也等不到谁，两笔都记上了。

要是次序反着来呢？一只先拿碗、另一只先拿账本，那就有可能：**甲攥着碗不放、等着账本；乙攥着账本不放、等着碗** —— 两只都在等对方先撒手，永远等下去。书上管这个叫「**死锁**」。

::: warn 小心喵

**那个反着次序的版本本喵不在这里真跑。** 它不红、不报错、也不自己停 —— 本喵这边的机器会一直等到超时，白等一场，什么也看不见。

所以你只要记住一条：**要拿两把锁，就所有猫都按同一个次序拿**；要动两样东西，就把次序在图纸上写死。次序统一，就没有「各攥一把互不相让」的机会。

:::

## 六、空锁：光起了名字，没造锁

最后说一个最容易栽的跟头：

```java
public class Main {
    public static void main(String[] args) throws Exception {
        Cat 一只 = new Cat("小橘", 5);

        一只.start();
        一只.join();

        synchronized (Cat.锁) {
            Cat.账本 = Cat.账本 + 1;
        }

        System.out.println("账本：" + Cat.账本 + " 条");
    }
}

class Cat extends Thread {
    static Object 锁;
    static int 账本 = 0;

    String 名字;
    int 要记;

    Cat(String 名字, int 要记) {
        this.名字 = 名字;
        this.要记 = 要记;
    }

    public void run() {
        for (int i = 0; i < 要记; i++) {
            synchronized (锁) {
                账本 = 账本 + 1;
            }
        }
    }
}
```

```text
Exception in thread "main" java.lang.NullPointerException: Cannot enter synchronized block because "Cat.锁" is null
```

机器这句话读作「**这个叫 `Cat.锁` 的东西是空的，进不去**」。本喵只写了 `static Object 锁;` —— **名字起了，锁没造**。空着的东西当然不能当锁用。

造一把锁得写全：`static final Object 锁 = new Object();`（`new Object()` 那一下才是真造出来）。顺一句：那只猫也偷偷在旁边报了同样的一句话 —— 它比母猫更早撞上这堵墙，只是母猫这边也撞了，才闹到整段程序停住。

::: tip 猫咪提示

1. **书上管这一套叫「同步」**：几只猫按规矩轮流用同一个东西，不抢、不丢。
2. **抢同一本账 = 记丢**：读出来、加一、写回去，这三下中间被插队就少一笔。
3. **`synchronized (锁) { ... }` 一次只许一只猫进去**，别的猫在门口等。
4. **锁必须是同一把**：`static` 那一把才是大家共用的。每只猫各造一把 = 没锁。
5. **`Lock` 要自己拿自己放**，`unlock` 摆在 `finally` 里最稳。
6. **要拿两把锁，次序统一**，不然可能僵住（死锁）。

:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `static int 账本 = 0;` | 大家一起用的那一格账 |
| `static final Object 账本锁 = new Object();` | 造一把大家共用的锁 |
| `synchronized (账本锁) { ... }` | 这一段一次只许一只猫进来 |
| `static synchronized void 记一笔()` | 把锁上在「记一笔」这件事上 |
| 把那个 `static` 去掉 | 锁变成每只猫自己那一把 = 没锁 |
| `锁.lock();` | 拿锁（拿不到就在门口等） |
| `锁.unlock();` | 还锁（摆在 `finally` 里最稳） |
| 两只猫按**不同**次序拿两把锁 | 可能僵住（死锁） |

## 小任务

1. 第一节那个不上锁的版本多跑几趟，看印出来的数一趟一个样（本喵跑十趟，十趟没重过样）。
2. 第二节那个版本，把 `账本锁` 改成每只猫自己造一把（把 `static` 去掉、在图纸上 `new Object()`），跑几趟看看锁还管不管用。
3. 第三节那个版本，把 `static` 去掉再跑几趟 —— 亲眼看看「有锁也拦不住」是什么样。
4. 第四节那个版本，把 `finally` 那一句挪出来、直接写在加数后面，想想本喵为什么非要它待在 `finally` 里。
5. 第五节那个版本，把两只猫拿两把锁的次序改成一正一反，跑一下感受「僵住」—— 跑之前先想好怎么停它（本喵这边的规矩是别让闸门等到超时）。

下一课，本喵不再一只一只地派人：鱼塘边上备**一队随叫随到的猫**，干完一趟不散伙、下回接着使；还有几样现成的家什，能让几只猫「等齐了一起走」。队伍怎么排、排多长、等不齐怎么办，下课本喵细说喵。🐾
