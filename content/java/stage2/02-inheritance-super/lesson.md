---
id: java-stage2-02
lang: java
stage: 2
order: 2
title: 继承与 super——图纸套图纸
tags: [面向对象, 继承]
required: ["java-stage2-01"]
crossRefs: []
compare: ["common-10"]
estMinutes: 25
keywords: [extends, super, override, instanceof]
---

## 钩子：本喵画了五张一模一样的图纸

猫窝里的猫越来越多了：小橘、狸花、大胖、还有本喵的伙伴大肥鱼。每一只都得有名字，每一只都得会出一声。

本喵照着上一课的法子，**每来一只新猫就画一张新图纸**。画到第五张，爪子酸了：这五张纸上，`String name;` 那一段、出生那一手那一段、`speak` 那一段，**一字不差**；改了一处，另外四处还得再抄一遍。

这不对劲喵。它们本来就都是**动物**：都有名字、都会出一声。凭什么同一套设定要抄五遍？

本喵把最上面那张大图纸抽出来，重新写一张，上面只画「**凡是动物，都有名字、都会出一声**」；下面那五张，每张只改一行：**本喵这张图纸，照着上面那张画**。

## 一、图纸套图纸：一句话认亲

Java 里让一张图纸照着另一张画，靠的是 `extends` 这个小词：

```java
class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    void speak() {
        System.out.println(name + "发出了一声叫");
    }
}

class Cat extends Animal {
    Cat(String name) {
        super(name);
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘");
        c.speak();
    }
}
```

```text
小橘发出了一声叫
```

逐行看喵：

- **`class Animal { ... }`** —— 先画一张大图纸，上面画着**所有动物都有的那部分**：有名字这盒家当、有出生那一手、有一招 `speak`。
- **`class Cat extends Animal { ... }`** —— **今天最要紧的一行**！图纸名后面多了 `extends`，后面跟着另一张图纸的名字，读作「**照 `Animal` 那张图纸，再画一张 `Cat` 图纸**」。这件事的正式名字叫**图纸套图纸（继承）**。
- **`Cat(String name) { super(name); }`** —— 小图纸上写了自己的出生那一手。**`super(name)` 就是「请上一层那张图纸，把它那版出生那一手跑一遍」** —— 名字这盒家当是它装进去的。
- **`c.speak()`** —— 小图纸上**根本没写 `speak`**，可它照样喊得动！因为大图纸上有，**小图纸天生就会**。

套图纸最值钱的地方就在这儿：大图纸上的家当和招式，小图纸**一个字都不用重抄**。

### Java 的一条死规矩：一张图纸只能认一张大的

有件事要先说清楚：**`extends` 后面只能跟一张图纸的名字。** 想让 `Cat` 同时照 `Animal` 和 `Fish` 两张图纸画？翻译官喵会直接拦下你。

这不是 Java 小气，是为了不让「同一个招式名在两张大图纸上各画了一版」这种糊涂账出现。真需要「认好几份本事」的时候，Java 另有一套办法，本喵过两课就教你喵。

## 二、小图纸能把大图纸那一招盖掉

套来的招式有时不合心意：橘猫叫起来可不是「发出了一声叫」。那就**在小图纸上把这一招再写一遍**：

```java
class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    void speak() {
        System.out.println(name + "发出了一声叫");
    }
}

class Cat extends Animal {
    Cat(String name) {
        super(name);
    }

    @Override
    void speak() {
        System.out.println(name + "：喵～");
    }
}

public class Main {
    public static void main(String[] args) {
        Animal a = new Animal("大肥鱼");
        Cat c = new Cat("小橘");
        a.speak();
        c.speak();
    }
}
```

```text
大肥鱼发出了一声叫
小橘：喵～
```

- 小图纸上又写了一遍 `void speak()`，**名字一模一样、投喂的料一模一样、叼回来的东西也一样**。
- 这么一写，**小图纸这一版就把大图纸那一版盖住了**：凡是从 `Cat` 生出来的猫，喊 `speak` 走的都是小图纸这一版。
- 这个动作叫**重写（override）**：同一个招式名，在小图纸上重新画一遍，换成本喵想要的样子。
- 注意大图纸**一点都没被改动**：`a` 是照着 `Animal` 直接生的，它喊 `speak` 还是那一声「发出了一声叫」。**盖住只盖住这一条往下的路**。
- **`@Override`** 是写给翻译官喵看的一张小纸条，意思是「本喵这一手，是**故意**要盖掉上面某一版的」。写错了名字（比如手滑写成 `speek`）它会当场翻脸告诉你「根本没有这一手可盖」—— 这张小纸条能替你挡掉一大半低级错，**每次盖掉大图纸某一版，都写上它**喵。

## 三、`super`：先请大图纸把活干一遍

有时候本喵不是要「换掉」大图纸那一手，而是想「**在它干完之后再添一句**」。这时候用 `super` 点名请它出手：

```java
class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    void speak() {
        System.out.println(name + "发出了一声叫");
    }
}

class Cat extends Animal {
    Cat(String name) {
        super(name);
    }

    @Override
    void speak() {
        super.speak();
        System.out.println("……然后补了一声喵～");
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘");
        c.speak();
    }
}
```

```text
小橘发出了一声叫
……然后补了一声喵～
```

- **`super.speak();`** 读作「**请上一层那张图纸，把它那版 `speak` 跑一遍**」。它跑完，本喵再接着添自己的那一句。
- `super` 这个小词要用在**招式里面**，它说的「上一层」永远是**本喵现在站的这张图纸的上层**。

## 四、构造链：出生那一刻，大的先收拾一遍

本喵第一次写小图纸的时候，最想不通的就是：`Cat` 的出生那一手里为什么要写 `super(name)`？不写会怎样？

答案是：**大图纸的出生那一手，不会自己跑。**

```java
class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }
}

class Cat extends Animal {
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
Main.java:10: error: constructor Animal in class Animal cannot be applied to given types;
    Cat(String name) {
                     ^
  required: String
  found:    no arguments
  reason: actual and formal argument lists differ in length
1 error
```

念起来是：**「你这张小图纸出生的时候，`Animal` 那一手要一样东西（`required: String`），可你一样都没给它（`found: no arguments`）喵。」**

为什么翻译官会这么算账？因为 Java 有一条暗规矩：

- 小图纸的出生那一手，**第一句**如果不是 `super(...)`，翻译官就**自动替你插一句 `super()`** —— 也就是「请大图纸的空手那一手」。
- 可大图纸上**只有** `Animal(String name)` 这一手，压根没有空手那一版 —— 插进去的那句当然对不上，于是当场翻脸。
- 所以正路只有一条：**小图纸自己写了出生那一手，第一句就老老实实写 `super(...)`，把大图纸要的料喂给它。**

上一课刚学的盖子在这儿也咬人：大图纸的出生那一手才装得进名字这盒家当，小图纸只是**请它代劳**。

### 顺序：先请大图纸，再装自己的

小图纸想**多带一盒自己的家当**（比如鱼干数），只要在 `super(...)` 后面接着写：

```java
class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    void speak() {
        System.out.println(name + "发出了一声叫");
    }
}

class Cat extends Animal {
    int fish;

    Cat(String name, int fish) {
        super(name);
        this.fish = fish;
    }

    @Override
    void speak() {
        System.out.println(name + "：喵～本喵有 " + fish + " 条小鱼干");
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘", 3);
        c.speak();
    }
}
```

```text
小橘：喵～本喵有 3 条小鱼干
```

顺序很讲究：**先 `super(name)` 把大图纸那一份收拾好，再 `this.fish = fish` 装自己的那一份**。`super(...)` 必须是身子的**第一句** —— 大图纸还没收拾完，本喵就不能先动别的。

这一串「先请谁、再请谁」，本喵拆成一步一步走给你看 —— **顺序**就是这一节最要紧的地方：

```demo
title: 出生那一刻：先请大图纸，再装自己那一份
code:
| class Animal {
|     String name;
|
|     Animal(String name) {
|         this.name = name;
|     }
| }
|
| class Cat extends Animal {
|     int fish;
|
|     Cat(String name, int fish) {
|         super(name);
|         this.fish = fish;
|     }
| }
|
| Cat c = new Cat("小橘", 3);

step 小图纸一句话认亲
at: 9
say: class Cat extends Animal 是今天最要紧的一行：照着 Animal 那张图纸再画一张 Cat。小图纸里从此含着一整个 Animal 的部分（名字这盒家当就是它带来的），自己只多写了 int fish; 这一点。
meow: 认亲啦，大图纸的东西全白拿！
pose: expect
大图纸装好的 name = （还没有这一只）
小图纸装好的 fish = （还没有这一只）
现在跑的是哪一手 = （还没开始）

step new 一只猫，先喊的是小图纸那一手
at: 18
say: Cat c = new Cat("小橘", 3); 喊的是小图纸的出生那一手 Cat(String name, int fish)，两样料「小橘」和「3」都交到它手上。
meow: 先喊小图纸那一手喵～
pose: expect
大图纸装好的 name = （还没装）
小图纸装好的 fish = （还没装）
现在跑的是哪一手 = Cat 的出生那一手

step 第一句就是 super(name)
at: 13
say: 本喵在小图纸的出生那一手里，第一句写的就是 super(name); —— 它不是招式名，是个小词，读作「请上一层那张图纸，把它那版出生那一手跑一遍」。它必须是身子的第一句：大图纸那一份还没收拾完，本喵就不能先动别的。
meow: 喊一声 super，请大图纸出手！
pose: busy
大图纸装好的 name = （还没装）
小图纸装好的 fish = （还没装）
现在跑的是哪一手 = 正要跳进大图纸

step 大图纸那一手接住了料
at: 4
say: 跳进来的这一手，就是大图纸上的 Animal(String name)。喂给小图纸的那块料「小橘」，顺着 super(name) 的手原样转给了它 —— 装名字这活儿从这儿起归大图纸干。
meow: 小橘转手交给大图纸喵～
pose: busy
大图纸装好的 name = （还没装）
小图纸装好的 fish = （还没装）
现在跑的是哪一手 = Animal 的出生那一手

step 大图纸把名字装好
at: 5
say: 大图纸那一版里跑的是 this.name = name;，把「小橘」收进它自己那份家当。注意此刻小图纸自己那份 fish 还是空的 —— 父先子后，这会儿还没轮到小的。
meow: 名字装进大图纸那一份啦！
pose: yay
大图纸装好的 name = 小橘
小图纸装好的 fish = （还没装）
现在跑的是哪一手 = Animal 的出生那一手

step 大图纸收工，回到小图纸装自己那一份
at: 14
say: 大图纸那一手跑完，活儿才回到小图纸 super(name); 的下一句：this.fish = fish;，把 3 装进小图纸多出来的那份家当。两层的家当这下都齐了。
meow: 回到小图纸，装自己那一份～
pose: yay
大图纸装好的 name = 小橘
小图纸装好的 fish = 3
现在跑的是哪一手 = 回到小图纸这一手

step 两层都齐了，new 才把猫交出来
at: 18
say: 两层家当都装好，出生这一手才算跑完 —— new 这一下收工，把这只猫交到本喵手上。往后 c.speak() 印出来的「小橘：喵～本喵有 3 条小鱼干」里，名字是大图纸装的、鱼干数是小图纸装的。
meow: 两层都装好，猫到手啦！
pose: proud
大图纸装好的 name = 小橘
小图纸装好的 fish = 3
现在跑的是哪一手 = （出生这一手跑完了）
```

**顺序颠不得**：`new` 小图纸上的猫 → 第一句 `super(...)` **先跳进大图纸** → 大图纸那一份装好 → 回到小图纸装自己那一份 → 两层齐了才交到本喵手上。`super(...)` 要是不写在第一句，翻译官喵当场就拦 —— 大图纸没收拾完，这一只就不算收拾好。

## 五、认亲：`instanceof`

套图纸是**从上往下认亲**的：照 `Cat` 生的猫，**也**是一只 `Animal`；可照 `Animal` 直接生的动物，**不是** `Cat`。

```java
class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }
}

class Cat extends Animal {
    Cat(String name) {
        super(name);
    }
}

public class Main {
    public static void main(String[] args) {
        Animal a = new Animal("大肥鱼");
        Cat c = new Cat("小橘");
        System.out.println(c instanceof Animal);
        System.out.println(a instanceof Cat);
    }
}
```

```text
true
false
```

`c instanceof Animal` 读作「**`c` 是不是照 `Animal` 这张图纸（或者它的下游图纸）生出来的**」。`c` 是照 `Cat` 生的，而 `Cat` 是套在 `Animal` 上画的，所以**也是**一只 `Animal`；反过来就不成立：`a` 直接照大图纸生的，它不是 `Cat`，所以是 `false` 喵。

## 六、盖了盖子的家当，小图纸也伸不进手

上一课刚学会给家当扣盖子。要是大图纸把名字盖上了，小图纸伸得进手吗？

```java
class Animal {
    private String name;

    Animal(String name) {
        this.name = name;
    }
}

class Cat extends Animal {
    Cat(String name) {
        super(name);
        System.out.println(this.name);
    }
}

public class Main {
    public static void main(String[] args) {
        Cat c = new Cat("小橘");
    }
}
```

```text
Main.java:12: error: name has private access in Animal
        System.out.println(this.name);
                               ^
1 error
```

**伸不进。** 盖子认的是「**哪张图纸写的招式**」，不是「谁跟谁认了亲」：`name` 是 `Animal` 扣上的，`Cat` 的招式照样在门外。想读？走大图纸留的那扇小窗 —— `getName()` 喵。

::: tip 猫咪提示

1. **`class Cat extends Animal`** —— 小图纸照着大图纸画；大图纸上的家当和招式，小图纸天生就会，**一个字都不用重抄**。
2. **一张图纸只能认一张大的**（`extends` 后面只跟一个名字）。
3. **重写** = 在小图纸上把同一招再画一遍，把上面那版盖住；**每次都写上 `@Override`**，那是给你自己上的保险。
4. **`super.speak()`** = 请上一层把它那版跑一遍，跑完本喵再接着添。
5. **`super(...)` 必须是出生那一手的第一句** —— 而且**非写不可**（除非大图纸上真有空手那一版）。
6. **认亲从上往下**：照 `Cat` 生的也是 `Animal`，反过来不成立，拿 `instanceof` 问一句就知道。
:::

::: warn 小心喵

- **大图纸的出生那一手不会自己跑。** 小图纸只要自己写了出生那一手，就必须**第一句** `super(...)` 把料喂过去，否则撞 `constructor ... cannot be applied to given types`。
- **盖着盖子的家当，小图纸也碰不得** —— 认亲不等于拿到钥匙，`private` 的家当要靠大图纸留的小窗读。
- **盖掉大图纸那一版，不是改大图纸本身。** 照大图纸直接生的那些动物，喊那一招还是老样子；小图纸改的只是**自己这条往下的路**。
- **`super` 不是招式名**，它是个小词：`super(name)` 请出生那一手，`super.speak()` 请某一招，别写成 `super().speak()` 喵。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `class Cat extends Animal { ... }` | 照着 `Animal` 那张大图纸，再画一张 `Cat` 小图纸 |
| `Cat(String name) { super(name); }` | 小图纸的出生那一手，第一句就请大图纸把它那版跑一遍 |
| `@Override` | 给翻译官喵的小纸条：本喵这一手是故意要盖掉上面那版的 |
| `super.speak();` | 请上一层把它那版 `speak` 跑一遍 |
| `c instanceof Animal` | 认亲：`c` 是不是照这张图纸（或它的下游）生出来的 |
| `a instanceof Cat` | 反过来就不成立 —— 认亲只从上往下 |
| `this.name`（在小图纸里，大图纸写着 `private`） | 伸不进去 → `name has private access in Animal` |
| 一张图纸只认一张大的 | `extends` 后面只能跟一个名字 |

## 小任务

1. 照第二节那样，给大图纸再画两张小图纸：`Dog`（叫起来是「汪！」）和 `Fish`（叫起来是「咕噜咕噜」），各生一只，看看大图纸那一段有没有被改动过喵。
2. 把 `Cat` 的出生那一手里的 `super(name);` **删掉**，编译一次，把翻译官喵的原话抄进小本本 —— 再想想它为什么说 `found: no arguments`。
3. 给 `Cat` 加一招 `void sleep()`，然后写一句 `new Cat("小橘").sleep()` 试试；再想想：`new Animal("大肥鱼").sleep()` 喊不喊得动？为什么喵？
4. 把大图纸的 `String name;` 改成 `private String name;`，然后在 `Cat` 的招式里伸手拿它 —— 编译一次，看看原话是什么；再把伸手改成走小窗，看看是不是就通了。
5. 想一想：如果本喵想写一句能装下「猫、狗、大肥鱼」的牌子，那句子的**图纸名**该写 `Animal` 还是 `Cat`？（下一课揭晓喵～）

下一课，本喵要讲一件更妙的事：写代码的时候**根本不用知道**手里这只到底是猫还是狗，一句「开饭啦」喊出去，是猫就喵、是狗就汪 —— 一句顶一窝。顺便还要认识一种「只画了一半的图纸」喵～ 🐾
