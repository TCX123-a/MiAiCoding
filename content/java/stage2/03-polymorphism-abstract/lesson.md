---
id: java-stage2-03
lang: java
stage: 2
order: 3
title: 多态与抽象类
tags: [面向对象, 多态]
required: ["java-stage2-02"]
crossRefs: []
estMinutes: 25
keywords: [polymorphism, abstract, override, instanceof]
---

## 钩子：本喵不想写一长串「如果是猫就……如果是狗就……」

院子里现在有一窝宠物：小橘是猫、大黄是狗、大肥鱼是鱼。到了饭点，本喵要挨个喊它们出个声。

上一课的本事够用了，可写出来是这样的：**先问一句「这是猫吗」，再问一句「这是狗吗」，再问一句「这是鱼吗」**……每添一位新伙伴，本喵就得多补一句问话。院子里要是养了三十只，这段问话能写半屏。

本喵不服气：它们**都是动物**，出个声这件事，凭什么要本喵一只一只地问？

## 一、一句话喊出去，各猫各样

看 Java 给的答案：

```java
class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    void speak() {
        System.out.println(name + "：……");
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

class Dog extends Animal {
    Dog(String name) {
        super(name);
    }

    @Override
    void speak() {
        System.out.println(name + "：汪！");
    }
}

public class Main {
    public static void main(String[] args) {
        Animal[] pets = { new Cat("小橘"), new Dog("大黄"), new Cat("狸花") };
        for (Animal pet : pets) {
            pet.speak();
        }
    }
}
```

```text
小橘：喵～
大黄：汪！
狸花：喵～
```

盯着中间那三行看：本喵**只写了一句 `pet.speak();`**，写的时候压根不知道 `pet` 会是谁 —— 是猫就喵、是狗就汪，**同一句话，各猫各样**。这件事的正式名字叫**一声开饭，各猫各样（多态）**。

它的道理其实很简单：

- `pet` 这块牌子底下，**装的是一只真猫**（照哪张图纸生的，它自己知道）。
- 喊 `pet.speak()` 的时候，Java 是**照着那只真猫自己的图纸**去找这一招的 —— 不是照着 `Animal` 那张大图纸找，也不是照着本喵写代码时脑子里想的那张找。
- 所以本喵只管写「喊 `speak`」，**具体喵还是汪，交给那只会自己决定**。

这份省心，正是套图纸最值钱的地方：**本喵加的宠物越多，那个 `for` 一个字都不用改**。往后你添一只鸭子，只要它照着 `Animal` 画、自己重写一版 `speak`，上面那三行照样不用动喵。

那三行里最要紧的就是 `pet.speak();` 这一句 —— 它凭什么「各猫各样」？本喵把三轮拆开，走给你看：

```demo
title: 同一句 pet.speak()，三轮怎么挑出三版
code:
| Animal[] pets = { new Cat("小橘"), new Dog("大黄"), new Cat("狸花") };
| for (Animal pet : pets) {
|     pet.speak();
| }

step 三只真身，全装进写 Animal 的牌子
at: 1
say: 左边写的是 Animal，右边 new 出来的却是猫和狗 —— 这一行通得过，因为照 Cat 生的本来就也是一只 Animal（上一课学的认亲）。
meow: 三只真身，全装进动物的牌子！
pose: expect
牌子上的图纸名 = Animal
牌子底下那只 = （还没领出来）
跑的是哪一版 = （还没喊）

step 第 1 圈：从排头领一只
at: 2
say: for 每一圈从这一排里领一只，装进牌子 pet。牌子上的图纸名一直是 Animal，可牌子底下换人了 —— 这一圈领到的是小橘。
meow: 第 1 圈领到小橘喵～
pose: expect
牌子上的图纸名 = Animal
牌子底下那只 = 小橘（照 Cat 生的）
跑的是哪一版 = （还没喊）

step 编译时：先看牌子
at: 3
say: 本喵写下 pet.speak(); 这一行的时候，Java 只查一件事：Animal 这块牌子上有没有 speak。有 —— 这一行过得去。至于跑哪一版，这一眼还管不着。
meow: 先看牌子：Animal 上有 speak，过！
pose: think
牌子上的图纸名 = Animal
牌子底下那只 = 小橘（照 Cat 生的）
跑的是哪一版 = 编译这一关过了

step 运行时：看真身挑版本
at: 3
say: 真喊出去的那一瞬，看的是牌子底下那只的真身 —— 小橘的真身是 Cat，就跑 Cat 重写过的那版 speak：喵～。
meow: 小橘真身是猫，跑猫那版！
pose: yay
牌子上的图纸名 = Animal
牌子底下那只 = 小橘（照 Cat 生的）
跑的是哪一版 = Cat 那版（喵～）

step 第 2 圈：牌子底下换人了
at: 2
say: 绕回 for 这一行领下一位：这回牌子底下是大黄 —— 牌子还是那块写 Animal 的，真身换成了狗。
meow: 第 2 圈换大黄啦喵～
pose: expect
牌子上的图纸名 = Animal
牌子底下那只 = 大黄（照 Dog 生的）
跑的是哪一版 = （上一版印完了）

step 同一行字，这回挑狗那版
at: 3
say: 还是 pet.speak(); 这一行，一个字都没改 —— 可真身是狗，挑中的就是 Dog 那一版：汪！同一句调用，跑哪一版全看真身。
meow: 同一行字，这回汪了一声！
pose: yay
牌子上的图纸名 = Animal
牌子底下那只 = 大黄（照 Dog 生的）
跑的是哪一版 = Dog 那版（汪！）

step 第 3 圈
at: 2
say: 再领一只：狸花。牌子依旧，真身又换回了猫。
meow: 第 3 圈领到狸花喵～
pose: expect
牌子上的图纸名 = Animal
牌子底下那只 = 狸花（照 Cat 生的）
跑的是哪一版 = （上一版印完了）

step 又挑回猫那版
at: 3
say: 第三声还是同一行字，真身是猫，挑中的又变回 Cat 那一版：喵～。屏幕上三行正好是：喵～、汪！、喵～。
meow: 又是猫那版，喵～！
pose: yay
牌子上的图纸名 = Animal
牌子底下那只 = 狸花（照 Cat 生的）
跑的是哪一版 = Cat 那版（喵～）

step 排尾了：圈停
at: 2
say: 第 4 次绕回 for，这一排里一只都不剩了，圈就停了。三只都按自己的真身出过声，而 for 那一行、pet.speak(); 那一行，一个字都没改。
meow: 都出过声啦，收工喵！
pose: proud
牌子上的图纸名 = Animal
牌子底下那只 = （排空了）
跑的是哪一版 = 猫喵、狗汪，各是各的
```

**这两眼看清楚就不会再绕晕**：**编译时认的是牌子上写的图纸名**（它管着你喊得动哪些招式），**运行时认的是牌子底下那只的真身**（它管着跑哪一版）。`pet` 每一圈换一只真身，同一行字就挑出不同的版本 —— 写这一行的人压根不用知道它是谁喵。

## 二、牌子上的图纸名，可以和真猫不一样

第一节里有个细节本喵故意没说破：`Animal[] pets` 那一排牌子上写的是 **`Animal`**，可装进去的明明是猫和狗。这就是 Java 里最要紧的一步操作 —— **向上转型**：

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

class Dog extends Animal {
    Dog(String name) {
        super(name);
    }

    @Override
    void speak() {
        System.out.println(name + "：汪！");
    }
}

public class Main {
    public static void main(String[] args) {
        Animal a = new Cat("小橘");
        Animal b = new Dog("大黄");
        a.speak();
        b.speak();
    }
}
```

```text
小橘：喵～
大黄：汪！
```

**`Animal a = new Cat("小橘");`** 这一句，左边牌子写 `Animal`、右边生的却是 `Cat` —— 竟然通得过！道理是上一课学的认亲：**照 `Cat` 生的猫，本来也是一只 `Animal`**。牌子要的是「动物」，你给了一只猫，比它要的还具体，当然收下喵。

这一手的好处立刻显现：**一块写 `Animal` 的牌子，能装下任何照 `Animal` 画出来的真猫**。写这个 `for` 的人不需要知道院子里养了什么，只管喊 `speak`。

### 但牌子上的名字，管着你能喊哪些招式

Java 是**认字**的：本喵在代码里喊得出哪些招式，**是照着牌子上写的图纸名查的**。牌子写 `Animal`，就只喊得动 `Animal` 上也画着的招式：

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

    void sleep() {
        System.out.println(name + "睡着了");
    }
}

public class Main {
    public static void main(String[] args) {
        Animal a = new Cat("小橘");
        a.sleep();
    }
}
```

```text
Main.java:26: error: cannot find symbol
        a.sleep();
         ^
  symbol:   method sleep()
  location: variable a of type Animal
1 error
```

念起来是：**「`a` 这块牌子写的是 `Animal`，本喵翻遍了这张图纸，没找到叫 `sleep` 的招式喵。」**

注意底下那三行是它给的线索：`symbol: method sleep()` 是「你在找的招式名」，`location: variable a of type Animal` 是「你是在哪块牌子上找的」。这一句错话本喵见过太多次了，学会读它，能省下半小时抓头的时间喵。

想喊 `sleep` 也不是没办法：先用 `instanceof` 问一句「你是不是猫」，确认之后再换一块 `Cat` 的牌子（这叫**向下转型**），就能喊了：

```java
if (a instanceof Cat) {
    Cat c = (Cat) a;
    c.sleep();
}
```

## 三、只画了一半的图纸

回到院子里那窝宠物。本喵想让大图纸立个规矩：**凡是动物，都必须会出个声** —— 但「出声」这件事本身，本喵写不出一个统一的样子（猫喵狗汪，各有各的），只能空着，让每张小图纸自己去补。

Java 给这件事留了一手：

```java
abstract class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    abstract void speak();
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
        Animal a = new Cat("小橘");
        a.speak();
    }
}
```

```text
小橘：喵～
```

这一手的正式名字叫**只画了一半的图纸（抽象类）**，样子只有两处跟平时不一样：

- **图纸头上多一个 `abstract`**：`abstract class Animal` —— 明明白白告诉翻译官喵「这张图纸**不许直接拿来生真猫**」。
- **那一招只有个头、没有身子**：`abstract void speak();` —— 后面**没有一对花括号**，直接一个分号收尾。意思就是「这一招**必须**有，但怎么写，留给往下画的小图纸自己定」。

规矩很硬气：**凡是从这张图纸往下画的，都得把这一招补上**；补不上，翻译官喵当场翻脸（下一节撞给你看）。

## 四、半张图纸不许直接生猫

本喵试过直接照着半张图纸生一只：

```java
abstract class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    abstract void speak();
}

public class Main {
    public static void main(String[] args) {
        Animal a = new Animal("大肥鱼");
        a.speak();
    }
}
```

```text
Main.java:13: error: Animal is abstract; cannot be instantiated
        Animal a = new Animal("大肥鱼");
                   ^
1 error
```

念起来是：**「`Animal` 是张只画了一半的图纸，不能拿来生真猫喵。」**

这一条其实很合理：「出声」这一招**还没写呢**，现在生出来的猫，喊它出声的时候该干什么？翻译官喵宁可不让你生，也不想让一只「不知道该干什么」的猫跑到你的院子里喵。

## 五、小图纸没交那半张，也生不出来

那本喵照规矩画一张小图纸，可偏偏忘了补上那一招：

```java
abstract class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    abstract void speak();
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
Main.java:11: error: Cat is not abstract and does not override abstract method speak() in Animal
class Cat extends Animal {
^
1 error
```

念起来是：**「`Cat` 自己没写 `speak`，又不肯当半张图纸 —— 那它到底会不会出声喵？」**

翻译官喵给了两条路，本喵必须二选一：

1. **补上那一招**（大多数时候选这条）—— 在小图纸里写一版 `speak`，就完事了。
2. **自己也在头上写 `abstract`** —— 意思是「本喵这张也是半张，接着往下传」。可这样一路传下去，总得有一张图纸把话说完 —— 不然永远生不出真猫。

## 六、半张图纸上，也能有画完的招式

`abstract` 管的**只是那些没写完的招式**，别的一概照旧：家当、出生那一手、画完了的招式，全都能照常写在上面。

```java
abstract class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    abstract void speak();

    void sleep() {
        System.out.println(name + "睡着了，呼噜呼噜");
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
        Animal[] pets = { new Cat("小橘") };
        for (Animal pet : pets) {
            pet.speak();
            pet.sleep();
        }
    }
}
```

```text
小橘：喵～
小橘睡着了，呼噜呼噜
```

`speak` 是小图纸补的，`sleep` 是大图纸上就画好了的 —— 一块牌子喊两招，都走得通喵。

::: tip 猫咪提示

1. **牌子上的图纸名管着你喊哪些招式**：写 `Animal` 就只喊得动 `Animal` 上有的；要喊小图纸新加的，先 `instanceof` 问一句、再换牌子。
2. **向上转型随时可以**：照 `Cat` 生的猫本来就是 `Animal`，装进 `Animal` 的牌子天经地义。
3. **`abstract` 写头上** = 这张图纸不许直接生猫；**`abstract` 写招式上** = 这一招只有个头，谁往下画谁补。
4. **补不上就翻脸**：小图纸要么把那一招写出来，要么自己也在头上写 `abstract`。
5. **具体干什么活，由真猫的图纸说了算** —— 这就是「一句话喊出去，各猫各样」的全部秘密。
:::

::: warn 小心喵

- **半张图纸不能 `new`** —— 撞的是 `Animal is abstract; cannot be instantiated`，别以为是出生招式写错了。
- **招式只有个头时，后面一个花括号都不能有**：`abstract void speak();` 是分号收尾。写成 `abstract void speak() { }`，翻译官喵**当场就拦**，原话是 `abstract methods cannot have a body`（「只有个头的招式不许带身子」），`javac` 一行程序都不给你生成 —— 本喵真跑过，连 `.class` 都是零个。
- **`cannot find symbol` 先看最后一行**：`location: variable a of type ...` 会告诉你本喵是在哪块牌子上找的 —— 十有八九是牌子的图纸名写小了。
- **`@Override` 照旧要写**。补那一招的时候写错名字，翻译官只会说「你又画了一招新的」，而真正该有的那一招**还是空着**，报出来的原话会指向别处，绕一大圈才找得到喵。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `Animal[] pets = { new Cat("小橘"), new Dog("大黄") };` | 一排写 `Animal` 的牌子，装下照它画出来的各种真猫 |
| `pet.speak();` | 是猫就喵、是狗就汪 —— 写的人不用管它是谁 |
| `Animal a = new Cat("小橘");` | 向上转型：猫本来就是动物，收得下 |
| `a.sleep();`（`sleep` 只有小图纸才有） | 喊不动 → `cannot find symbol` |
| `abstract class Animal { ... }` | 只画了一半的图纸，不许直接拿来生真猫 |
| `abstract void speak();` | 这一招只有个头、没有身子，谁往下画谁补 |
| 小图纸没补那一招 | `Cat is not abstract and does not override abstract method speak() in Animal` |
| `new Animal("大肥鱼")`（半张图纸） | `Animal is abstract; cannot be instantiated` |
| `a instanceof Cat` 之后再 `(Cat) a` | 先认亲、再换牌子，才喊得动小图纸新加的招式 |

## 小任务

1. 照第一节那样，再画一张小图纸 `Fish`（出个声是「咕噜咕噜」），往那排宠物里加一只 —— 试试那个 `for` 要不要动（答案是：一个字都不用改喵）。
2. 把第二节最后那段 `if` 抄进练习场，先跑一遍 `a.sleep();` 记下原话，再补上 `instanceof` 和换牌子那两句，让它真的喊出声。
3. 给半张图纸再添一招没写完的 `abstract void play();`，然后**只补 `speak` 不补 `play`**，编译一次，看看原话里点名的是哪一招喵。
4. 把大图纸头上的 `abstract` 拿掉（招式那一行的 `abstract` 留着），编译一次，把原话抄下来 —— 想想翻译官喵为什么不许你这么做。
5. 想一想：本喵要是想立一条规矩，说「会出声的不一定都是动物，机器人也会出声」，那该怎么办？（下一课揭晓喵～）

下一课，本喵要认识一张**立规矩的清单**：它不画家当、不管出生，只写「凡是认下这份约定的，必须会这几手」。有了它，一只完全不是动物的机器人，也能和猫站进同一排牌子里喵～ 🐾
