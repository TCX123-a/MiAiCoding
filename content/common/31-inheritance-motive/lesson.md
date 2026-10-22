---
id: common-31
lang: common
stage: 0
order: 28
title: 先抄三遍，再抽一张公共图纸——继承的第一动机
tags: [面向对象, 继承]
required: ["common-30"]
crossRefs: ["java-stage2-02","python-stage2-07","cpp-stage2-09"]
estMinutes: 18
keywords: [inheritance, extends, super, override]
---

## 钩子：同一段说明，本喵抄了三遍

上一课《遥控器不是电视机——引用语义的第一张内存图》里，本喵总算把一件事掰扯清楚了：**名字是遥控器，不是电视机本身** —— 两个名字可以指着同一只猫，动一个，另一个也看得见。那管的是「名字和谁是一家」喵。

今天本喵遇到的是另一种乱子。

猫窝学堂最近越办越热闹：除了橘猫、狸花猫，还来了一条狗「大黄」，树梢上落了一只鸟「小啾」。本喵照老规矩办 —— **一种动物，画一张图纸**：

- 猫图纸上写着：有名字、会开饭、会出一声；
- 给大黄画图纸，本喵偷了个懒：把猫图纸上那段**整段抄下来**，只把「喵」改成「汪」；
- 给小啾画图纸，再抄一遍，只把「汪」改成「啾」。

同一段说明，本喵抄了三遍。三张图纸摊开一对照：**一字不差的地方占了大半**，各不相同的只有最后那一行。

抄三遍还不是最疼的。最疼的是往后：本喵想把「开饭啦～」印的这句话改一改（比如添上食堂的名字），得**三张图纸挨个改** —— 漏掉哪张，那只动物开饭时喊的话就跟别人不一样。本喵在这条线上记过「改一处要动几处」这本账，这回一开局就是三处。

今天本喵要把这件事从根上了结：**同一段东西抄了三遍，就把它抽成一张公共的大图纸，让三张小图纸都照着它画。**

## 先看清楚：没有「图纸套图纸」的世界长什么样

先别急着看终稿喵。本喵在 C 的地界干活那会儿，干的就是今天这场「抄」—— 而且抄得更惨：连**橘猫**和**狸花猫**之间那一点点不同，都得各写一整套。

```c
typedef struct { char name[20]; } OrangeCat;
typedef struct { char name[20]; } TabbyCat;

void orange_eat(OrangeCat c) { printf("%s：开饭啦～\n", c.name); }
void orange_meow(OrangeCat c) { printf("%s：喵～\n", c.name); }   /* 橘猫那一套 */

void tabby_eat(TabbyCat c)   { printf("%s：开饭啦～\n", c.name); }
void tabby_meow(TabbyCat c)  { printf("%s：喵。\n", c.name); }    /* 狸花猫：又一整套 */
```

两个盒子、两套招式，一模一样的句子写了两份。想改「开饭啦～」那句话？**两处都得动**。想再添一只黑白花？那就是第三套。

C 里没有「图纸套图纸」这回事，干活的老猫们琢磨过一个凑合的办法：**一个 struct 加一格 `int type;`，招式里用 `switch` 分流**：

```c
typedef struct {
    char name[20];
    int type;                /* 1 = 橘猫，2 = 狸花猫 */
} Cat;

void cat_meow(Cat c) {
    switch (c.type) {
        case 1: printf("%s：喵～\n", c.name); break;
        case 2: printf("%s：喵。\n", c.name); break;
    }
}
```

一个盒子装下所有品种，比抄两套强。可每个招式一进门，先要问一句「你是哪一型」；将来加一种动物，还得回来往每个 `switch` 里再见缝插一行。先看个够喵 —— 今天这一手学完，你回头再看这两段 C 代码，会觉得它像没装电梯的六楼。

## 第一步：先老老实实把两张图纸写全

到了有图纸的语言里，本喵先**不抽象** —— 老老实实按老规矩，把两种动物各写成一张**各自完整**的图纸。先写猫，再写狗：

```python
class Cat:
    def __init__(self, name):
        self.name = name

    def eat(self):
        print(f"{self.name}：开饭啦～")

    def speak(self):
        print(f"{self.name}：喵～")

class Dog:
    def __init__(self, name):
        self.name = name

    def eat(self):
        print(f"{self.name}：开饭啦～")

    def speak(self):
        print(f"{self.name}：汪！")

cat = Cat("橘猫")
dog = Dog("大黄")
cat.speak()
dog.speak()
```

```text
橘猫：喵～
大黄：汪！
```

摊开看：`__init__` 那一段、`eat` 那一段，**两段一字不差**；`speak` 两段长得也一样，只有最后一行里的字不同。鸟图纸要是也这么写，就是第三遍。这么写没写错 —— 它**能跑**，把上面那段抄进练习场，屏幕上就是那两行；本喵特意先把它摆出来，就是要让你亲眼看见重复 —— 看不见重复，后面的「抽取」就成了变戏法喵。（先重复、后抽象，是本喵这条线上一路立的规矩。）

## 第二步：把一模一样的那半截提上来

下一步是关键动作，也是很多猫一开始就想反的地方：**不是把图纸往下抄，是把共同点往上提。**

本喵把两张图纸并排摊开，拿爪子一行一行圈：

- 名字那一格 `self.name`：两张图纸一模一样 → 圈走；
- 出生那一手 `__init__`：一模一样 → 圈走；
- 开饭那一招 `eat`：一模一样 → 圈走；
- 出一声 `speak`：名字一样、只有叫法不同 → 把「通用版」圈走，具体叫法留给各自。

圈出来的这半截，本喵把它重新画到**一张新图纸**上，起名叫 `Animal`（动物）：

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def eat(self):
        print(f"{self.name}：开饭啦～")

    def speak(self):
        print(f"{self.name}发出了一声叫")      # 通用版：不知道是啥动物时，先这么叫
```

这张 `Animal` 图纸，行话里叫**父类（大图纸）**；照着它画的小图纸们，叫**子类（小图纸）**。这一手 —— 小图纸照着大图纸画下来、大图纸上的东西小图纸自动全有 —— 的正式名字，术语表里叫**继承（图纸套图纸）**。

顺嘴说清一件事：这几张图纸之间的亲，是**先看见重复、后圈出来的**，不是开场就先写的咒语。图省事先套一张大图纸、再往里塞东西，那是把顺序整个倒过来了喵。

## 第三步：小图纸只剩各自不同处

提上去之后，把三张图纸摆在一起看：两张小图纸上，只剩「自己独有的那点东西」要写了。

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def eat(self):
        print(f"{self.name}：开饭啦～")

    def speak(self):
        print(f"{self.name}发出了一声叫")

class Cat(Animal):
    def __init__(self, name):
        super().__init__(name)      # 把名字交给大图纸那半截去装

    def speak(self):
        print(f"{self.name}：喵～")

class Dog(Animal):
    def __init__(self, name):
        super().__init__(name)

    def speak(self):
        print(f"{self.name}：汪！")
```

`class Cat(Animal):` 这一行读作「**猫图纸，照着动物图纸画**」。注意看：`Cat` 图纸上现在**没有** `self.name`、**没有** `eat` —— 一个字都没写，却样样都会，因为大图纸那半截上全有。小图纸只在**不一样的地方**盖掉重画：猫的 `speak` 是「喵～」，狗的 `speak` 是「汪！」。

小图纸把大图纸的一招**盖掉**、换上自己这版，这件事行话里叫**重写（override）**。今天只做最小的那种：改掉大图纸的**一个**方法 —— 别的都白捡。鸟也照这个法子来：`class Bird(Animal):`，只写自己那声「啾」。

好处立刻看得见喵：那段公共说明从此**只有一份**，安家在 `Animal` 上。往后想改「开饭啦～」印的话，只改 `Animal` 那一处，猫、狗、鸟**一起跟着变** —— 改动面从三处收回成一处。

## 出生那一刻，大图纸那半截要先吃饱

上面那段代码里藏着一句今天最要紧的话：**小图纸出生时，大图纸那半截要先吃饱** —— `super().__init__(name)` 就是干这个的。

它读作「**上一层那版出生那一手，也请你跑一遍**」。为什么非写不可？因为名字那一格其实长在大图纸那半截上：猫自己那手只干一件事 —— 把名字转交出去；大图纸的出生手不跑，那只猫的 `name` 格就是空的。

四门语言在这件事上脾气不一样喵：

- **Java**：`Cat(String name) { super(name); }` —— 不写 `super(...)`，翻译官喵当场拦下，**编译不过**。因为 `Animal` 只认得「带着名字出生」这一种生法，没有名字就没法开工，错了立刻知道。
- **Python**：`super().__init__(name)` 忘了写，**当场一点都不炸** —— `Cat("橘猫")` 照样出生，一直等到哪天用到 `self.name`，才突然报「这只猫没有 `name` 这格」。安安静静埋着，比 Java 那种当场拦下难抓多了。
- **C++**：不写单独的 `super` 一行，写在出生那一手**冒号后面那一小段**里（行话叫成员初始化列表）：`Cat(string n) : Animal(n) {}`。
- **C**：没有「出生那一手」这回事 —— 结构体出生时没人喂，名字得自己一格一格填（`strcpy(cat.name, ...)`）。

还有个一眼就会想歪的地方，本喵提前掐掉：出生那一刻**不是「先造一只动物、再造一只猫」** —— 从头到尾只有一只猫，大图纸那半截是**它身上先收拾好的那部分**。

本喵把出生这一路的来回，拆成一步一步走给你看喵：

```demo
title: 一只猫的出生：大图纸那半截先吃饱，自己的叫声再盖上
code:
| class Animal:
|     def __init__(self, name):
|         self.name = name
|     def eat(self):
|         print(f"{self.name}：开饭啦～")
|     def speak(self):
|         print(f"{self.name}发出了一声叫")
| class Cat(Animal):
|     def __init__(self, name):
|         super().__init__(name)
|     def speak(self):
|         print(f"{self.name}：喵～")
| class Dog(Animal):
|     def __init__(self, name):
|         super().__init__(name)
|     def speak(self):
|         print(f"{self.name}：汪！")
| cat = Cat("橘猫")
| dog = Dog("大黄")
| cat.speak()
| dog.speak()
| cat.eat()

step 先画公共那半截：凡是动物都有的
at: 1
say: `class Animal:` 开工。第 2~3 行是名字那一格与出生那一手，第 4~5 行是开饭，第 6~7 行是「出一声」的通用版 —— 不知道手里是啥动物时，先这么叫。
meow: 大图纸摊开了，动物还没生喵～
pose: expect
大图纸 Animal = 摊开了（出生那手还没跑过）
小图纸 Cat = 还没画
小图纸 Dog = 还没画
cat 的仓库 = 还没生
dog 的仓库 = 还没生
屏幕上 = 还没印

step 猫认亲：括号里写着照谁画
at: 8
say: `class Cat(Animal):` —— 猫图纸自己没有名字格、没有开饭招，全在 `Animal` 上。它只写两处自己的话：出生那一手补一句、叫声盖一版。
meow: 认了亲，白捡一整张图纸喵！
pose: expect
大图纸 Animal = 摊开了（出生那手还没跑过）
小图纸 Cat = 认了亲（只剩自己那点）
小图纸 Dog = 还没画
cat 的仓库 = 还没生
dog 的仓库 = 还没生
屏幕上 = 还没印

step 狗也认亲：同一句话，只换叫法
at: 13
say: `class Dog(Animal):` —— 跟猫一模一样的认亲动作。省下来的，正是刚才圈出来的那几处重复：从今往后，「开饭啦～」这句话只有 `Animal` 上的一份。
meow: 两张小图纸，合用一个爹喵～
pose: expect
大图纸 Animal = 摊开了（出生那手还没跑过）
小图纸 Cat = 认了亲（只剩自己那点）
小图纸 Dog = 认了亲（只剩自己那点）
cat 的仓库 = 还没生
dog 的仓库 = 还没生
屏幕上 = 还没印

step 喊一声 Cat("橘猫")：出生开始
at: 18
say: 新猫先跑到**猫自己**的出生那一手（第 9 行）。可它手里只有名字，名字那格还长在大图纸那半截上 —— 猫自己这手第一件事，就是回头去请大图纸。
meow: 猫来了，先把名字交上去喵～
pose: busy
大图纸 Animal = 摊开了（出生那手开跑）
小图纸 Cat = 认了亲（只剩自己那点）
小图纸 Dog = 认了亲（只剩自己那点）
cat 的仓库 = 刚出生，名字还没装
dog 的仓库 = 还没生
屏幕上 = 还没印

step super 一出场：大图纸那半截先吃饱
at: 10
say: `super().__init__(name)` 读作「上一层那版出生那一手，也请你跑一遍」—— 跳到**大图纸**第 2 行去。这一步要是漏掉，名字就没人装；Java 当场编译不过，Python 会安静地拖到用名字那天才炸。
meow: 先请老爹把名字装好喵！
pose: busy
大图纸 Animal = 摊开了（出生那手开跑）
小图纸 Cat = 认了亲（只剩自己那点）
小图纸 Dog = 认了亲（只剩自己那点）
cat 的仓库 = 刚出生，名字还没装
dog 的仓库 = 还没生
屏幕上 = 还没印

step 名字落进这只猫自己的仓库
at: 3
say: `self.name = name` 在大图纸那半截里跑 —— 注意 `self` 一路指的都是**刚出生的同一只猫**（遥控器照旧指着它），不是另造了一只动物。「橘猫」装进它自己的仓库，跑完才回到猫自己那手收尾。
meow: 名字进仓库，这只猫收拾好了喵！
pose: yay
大图纸 Animal = 摊开了（出生那手开跑）
小图纸 Cat = 认了亲（只剩自己那点）
小图纸 Dog = 认了亲（只剩自己那点）
cat 的仓库 = 名字「橘猫」
dog 的仓库 = 还没生
屏幕上 = 还没印

step 第二只：同一条路，走一遍
at: 19
say: `dog = Dog("大黄")` —— 路线一个字没变：狗自己的出生手 → 回头请大图纸 → 名字落进**狗自己**的仓库。两只各带各的名字，谁也不碰谁。
meow: 同一段路，第二只也有了仓库喵！
pose: yay
大图纸 Animal = 摊开了（出生那手开跑）
小图纸 Cat = 认了亲（只剩自己那点）
小图纸 Dog = 认了亲（只剩自己那点）
cat 的仓库 = 名字「橘猫」
dog 的仓库 = 名字「大黄」
屏幕上 = 还没印

step 各喊各的 speak：自己那版盖过大图纸的
at: 20
say: `cat.speak()` 走到猫重写的那一版（第 12 行）—— 大图纸的通用版被它**盖掉**了，所以是「喵～」；第 21 行的狗一样，走第 17 行：「汪！」。同一句招式名，各应各的，可**靠什么知道该走哪一版**，下一课才揭盖。
meow: 猫答喵、狗答汪，各叫各的喵！
pose: busy
大图纸 Animal = 摊开了（出生那手开跑）
小图纸 Cat = 认了亲（只剩自己那点）
小图纸 Dog = 认了亲（只剩自己那点）
cat 的仓库 = 名字「橘猫」
dog 的仓库 = 名字「大黄」
屏幕上 = 2 行：橘猫：喵～ / 大黄：汪！

step 白捡的那一招：大图纸的 eat 照样能喊
at: 22
say: `cat.eat()` —— 猫图纸上**根本没写这一招**，第 4~5 行的开饭长在大图纸上，照样跑得动。这就是「提起共同点」最实在的回报：写的时候省一遍，改的时候也只改一处。
meow: 开饭啦——！白捡的招真好用～
pose: proud
大图纸 Animal = 摊开了（出生那手开跑）
小图纸 Cat = 认了亲（只剩自己那点）
小图纸 Dog = 认了亲（只剩自己那点）
cat 的仓库 = 名字「橘猫」
dog 的仓库 = 名字「大黄」
屏幕上 = 3 行：橘猫：喵～ / 大黄：汪！ / 橘猫：开饭啦～
```

## 是不是亲生的？——「是一种」判据

套图纸不是随便套的，套之前先问一句：**小图纸「是一种」大图纸吗？**

- 猫**是一种**动物 ✓、狗**是一种**动物 ✓ —— 套得对，动物图纸上那半截，它们本来就都该有。
- 猫**有一条**尾巴 —— 尾巴不是猫的「一种」，是猫**拥有**的一样东西。这时候**不许**写 `class Cat(Tail)` 这种怪图纸：照它生出来的猫会带上「尾巴的一切设定」，却丢了名字和开饭，而且「猫是尾巴」这句话本身就说不通。正确的做法是把尾巴放进**猫身上的一格**（`self.tail = ...`），或者单独画一张尾巴图纸、把它当一格收进来。

一句话：**「是一种」才套图纸，「有一条」放进格子**。套之前拿这句卡一下，能挡下大多数乱认亲喵。

::: tip 猫咪提示
今天记住三句话喵：

1. **先重复、后抽象**：先照原样把两张图纸各写全、跑通，亲眼看见哪几行一字不差，再把共同的那半截**往上提**成一张公共大图纸 —— 顺序反过来，就成了变戏法。
2. **出生那一刻，大图纸先吃饱**：小图纸自己的出生手一动，第一件事就是把料交给大图纸那半截（`super(...)`；C++ 写在冒号后面那一小段）。漏了它，名字就没人装。
3. **重写**：小图纸把大图纸的一招盖掉、换成自己这版 —— 今天只盖**一个**方法，别的全是从大图纸白捡的。
:::

::: warn 小心喵
两个坑，本喵标出来：

- **忘了请大图纸，一个响一个哑**：Java 里 `super(...)` 不写，翻译官喵当场拦下、**编译不过**；Python 里 `super().__init__(...)` 不写，**当场一声不响**，一直拖到哪天用到名字才炸。哑的那个难抓得多。
- **「是一种」才套图纸**：猫**是一种**动物，套得；猫**有一条**尾巴 —— 尾巴不是猫的「一种」，不许写 `class Cat(Tail)` 那种怪图纸，该把尾巴放进**猫身上的一格**。
:::

## 四位翻译官喵，同一张公共图纸

同一件事：动物都有名字、会开饭、会出一声；给出一张公共大图纸，让猫和狗各自只补自己那声叫，然后各喊各的。

```compare
c::
#include <stdio.h>
#include <string.h>

typedef struct { char name[20]; } Cat;
typedef struct { char name[20]; } Dog;

void cat_speak(Cat c) { printf("%s：喵～\n", c.name); }   /* 猫自己一套 */
void dog_speak(Dog d) { printf("%s：汪！\n", d.name); }   /* 狗再抄一套 */

int main(void) {
    Cat cat; Dog dog;
    strcpy(cat.name, "橘猫");
    strcpy(dog.name, "大黄");
    cat_speak(cat);
    dog_speak(dog);
    return 0;
}

cpp::
#include <iostream>
#include <string>
using namespace std;

class Animal {
public:
    string name;
    Animal(string n) : name(n) {}
    void eat() { cout << name << "：开饭啦～" << endl; }
    void speak() { cout << name << "发出了一声叫" << endl; }
};

class Cat : public Animal {
public:
    Cat(string n) : Animal(n) {}                        // 冒号后面先喂饱大图纸那半截
    void speak() { cout << name << "：喵～" << endl; }
};

class Dog : public Animal {
public:
    Dog(string n) : Animal(n) {}
    void speak() { cout << name << "：汪！" << endl; }
};

int main() {
    Cat cat("橘猫");
    Dog dog("大黄");
    cat.speak();
    dog.speak();
    return 0;
}

java::
class Animal {
    String name;

    Animal(String name) {
        this.name = name;
    }

    void eat() {
        System.out.println(name + "：开饭啦～");
    }

    void speak() {
        System.out.println(name + "发出了一声叫");
    }
}

class Cat extends Animal {
    Cat(String name) {
        super(name);                    // 这行不写，编译不过
    }

    void speak() {
        System.out.println(name + "：喵～");
    }
}

class Dog extends Animal {
    Dog(String name) {
        super(name);
    }

    void speak() {
        System.out.println(name + "：汪！");
    }
}

public class Main {
    public static void main(String[] args) {
        Cat cat = new Cat("橘猫");
        Dog dog = new Dog("大黄");
        cat.speak();
        dog.speak();
    }
}

python::
class Animal:
    def __init__(self, name):
        self.name = name

    def eat(self):
        print(f"{self.name}：开饭啦～")

    def speak(self):
        print(f"{self.name}发出了一声叫")

class Cat(Animal):
    def __init__(self, name):
        super().__init__(name)

    def speak(self):
        print(f"{self.name}：喵～")

class Dog(Animal):
    def __init__(self, name):
        super().__init__(name)

    def speak(self):
        print(f"{self.name}：汪！")

cat = Cat("橘猫")
dog = Dog("大黄")
cat.speak()
dog.speak()
```

```text
橘猫：喵～
大黄：汪！
```

看出来了吗喵：**四段说的是同一件事，写起来差在「认亲」那一小段**。

- **C**：只有版本一 —— 两个盒子各配一套招式（`cat_speak`、`dog_speak`），改一句话要改两处；C 里没有「把公共半截提上来」这回事。
- **C++**：`class Cat : public Animal` —— 认亲写在小图纸名字后面；喂饱大图纸那半截，写在出生那一手**冒号后面那一小段**（`Cat(string n) : Animal(n) {}`）。顺带埋一句：C++ 认亲之后还藏着一个 `virtual` 的机关，今天先不拆，「一声开饭，各猫各样」那一课专门伺候它。
- **Java**：`class Cat extends Animal` —— `extends` 后面跟大图纸的名字；大图纸那半截靠 `super(name);` 喂饱，**不写编译不过**。
- **Python**：认亲写在**括号**里（`class Cat(Animal):`），喂饱大图纸那半截靠 `super().__init__(name)`；**忘了写，当场不报错**，用到名字那天才炸。

四位翻译官喵的共识就一条：**共同的那半截提上去，小图纸只写自己的**喵。

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `class Animal:` | 画一张公共大图纸：凡是动物都有的那半截写这儿 |
| `class Cat(Animal):` | 猫图纸照着动物图纸画（Python 的认亲写法） |
| `extends` / `: public` | Java / C++ 里「照着画」的写法 |
| `super().__init__(name)` | 出生时先请大图纸那半截吃饱（Java 写 `super(name)`；C++ 写在冒号后面 `Animal(n)`） |
| 小图纸里再写一遍 `speak` | 重写（override）：把大图纸那一招盖掉，换成自己的叫法 |
| `cat.eat()`（`eat` 长在大图纸上） | 小图纸一个字没写也喊得动 —— 提上去的东西自动全有 |

## 小任务

1. **动脑**：本喵的伙伴大肥鱼也要入档了。如果要给「猫」和「鲸鱼」抽一张公共大图纸 `Animal`，上面能写哪几样？（提示：凡是动物都有的 —— 名字、开饭、出一声。那「会游泳」呢？它该放哪儿喵？）
2. **动手**：把课文里 `Animal`、`Cat`、`Dog` 那段抄进练习场，添一张 `Bird` 图纸照 `Animal` 画，只改 `speak`（「啾」），生一只小啾、喊它一声 —— 跑起来看看，屏幕上是不是两行变三行喵？
3. **再想一想**：下面三句话，哪几句该用「套图纸」、哪句该用「放格子」？① 狗是一种动物；② 狗有一条尾巴；③ 狸花猫是一种猫。

下一课，本喵要让这些图纸活起来：站着喊一声「开饭啦 —— ！」，不管手里拿的是猫是狗，各吃各的、各应各的；至于本喵之前在 C 里用惯的那套 `switch` —— 该请它出去了喵。下一课「一声开饭，各吃各的」见喵～ 🐾
