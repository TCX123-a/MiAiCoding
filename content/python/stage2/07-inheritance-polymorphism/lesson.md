---
id: python-stage2-07
lang: python
stage: 2
order: 7
title: 面向对象深入——继承与多态
tags: [面向对象, 继承]
required: ["python-stage2-06"]
crossRefs: []
estMinutes: 25
keywords: [class, super, isinstance, override]
compare: ["common-10"]
---

## 钩子：本喵画了五张一模一样的图纸

猫窝里的猫越来越多：橘猫、狸花猫、布偶猫、大肥鱼的朋友……每一只都要有名字，每一只都要会喵一声。

本喵照着前面学的法子，**每来一只新猫就画一张新图纸**。画到第五张，本喵手酸了：这五张纸上，`__init__` 那一段、`speak` 那一段，**一字不差**，改了其中一处，另外四处还得再抄一遍。

这不对劲喵。它们本来就是同一种东西 —— 都是**动物**。凭什么同一套设定要抄五遍？

本喵把最上面那张大图纸抽出来，写上「**凡是动物，都有名字、都会叫**」，剩下那五张只改一行：**本喵这张图纸，照着上面那张画**。

这就是今天的第一件事 —— **图纸套图纸**。

## 图纸套图纸：一句话认亲

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        print(f"{self.name}发出了一声叫")

class Cat(Animal):
    pass

a = Animal("大肥鱼")
c = Cat("橘猫")
a.speak()
c.speak()
print(isinstance(c, Animal))
print(isinstance(a, Cat))
```

```text
大肥鱼发出了一声叫
橘猫发出了一声叫
True
False
```

逐行看喵：

- **`class Animal:`** —— 先画一张大图纸，写的是**所有动物都有的那部分**：有名字（`__init__`），会叫（`speak`）。
- **`class Cat(Animal):`** —— **最要紧的一行**！图纸名后面**多了一对小括号，里面填着另一张图纸的名字**，读作「**照 `Animal` 那张图纸，再画一张 `Cat` 图纸**」。这一句话，术语表里给它的原名是**继承（图纸套图纸）**。
- **`pass`** —— 「**这里先空着**」。Python 不许图纸里面一个字都不写，所以小图纸一时没东西可加的时候，就摆一个 `pass` 占位。
- **`c = Cat("橘猫")`** —— 小图纸上**根本没写 `__init__`**，可名字照样喂得进去！因为大图纸上有，**小图纸天生就会**。这就是套图纸最大的好处：大图纸上的说明和招式，小图纸**不用再写一遍**。
- **`c.speak()`** —— 印出「橘猫发出了一声叫」，用的也是大图纸那一招。
- **`print(isinstance(c, Animal))`** —— `isinstance(一只猫, 一张图纸)` 读作「**这只猫是不是照这张图纸（或它的下游图纸）生出来的**」。`c` 是照 `Cat` 生的，而 `Cat` 是套在 `Animal` 上画的，所以它**也是**一只 `Animal`，叼回 `True`。
- **`print(isinstance(a, Cat))`** —— 反过来就不成立了：`a` 是照着最上面那张大图纸直接生的，它**不是** `Cat`，所以是 `False`。套图纸是**从上往下认亲，不往上看**喵。

## 小图纸能把大图纸那一招盖掉

套来的招式有时不合心意。橘猫叫起来可不是「发出了一声叫」，是本喵最熟悉的「喵～」。那就**在小图纸上把这一招再写一遍**：

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        print(f"{self.name}发出了一声叫")

class Cat(Animal):
    def speak(self):
        print(f"{self.name}：喵～")

c = Cat("橘猫")
c.speak()
```

```text
橘猫：喵～
```

- 小图纸上**又写了一遍 `def speak(self):`**，名字一模一样、投喂的东西也一模一样。
- 这么一写，**小图纸这一版就把大图纸那一版盖住了**：凡是从 `Cat` 生出来的猫，喊 `speak` 走的是小图纸这一版，大图纸那版安安静静躺在那儿，不再出声。
- 这个动作，本喵们叫它**重写（盖掉，换自己那版）**：同一个招式名，小图纸上重新画一遍，换成本喵想要的样子。
- 注意大图纸**一点都没被改动**。照 `Animal` 直接生出来的动物，喊 `speak` 还是那一声「发出了一声叫」—— **盖住只盖住这一条下游的路**。

## `super()`：先请大图纸把活干一遍

现在橘猫有自己的鱼干数了。本喵想给它单独加一段 `__init__`：

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        print(f"{self.name}发出了一声叫")

class Cat(Animal):
    def __init__(self, name, fish):
        super().__init__(name)
        self.fish = fish

    def speak(self):
        print(f"{self.name}：喵～本喵有 {self.fish} 条小鱼干")

c = Cat("橘猫", 3)
c.speak()
```

```text
橘猫：喵～本喵有 3 条小鱼干
```

- **小图纸自己写了 `__init__`，大图纸那一版就被盖住了**。所以「把名字放进仓库」这一步，**不会自动发生**了 —— 得本喵自己请回来干。
- **`super().__init__(name)`** 读作「**先请上一层图纸，把它那版 `__init__` 跑一遍**」。`super()` 就是「上一层」的意思。
- `super()` 后面**不用喂 `self`**：本喵正站在哪张小图纸上，Python 自己清楚，它会替本喵把 `self` 递过去。
- 顺序很讲究：**先 `super().__init__(name)` 把名字放好，再 `self.fish = fish` 放自己的那一份**。要是漏了 `super()` 这一句，`self.name` 这个仓库**压根没被建起来**，等下 `speak` 里一喊 `self.name` 就翻脸喵。

「先请上一层跑一遍、再跑自己那一句」这个顺序，本喵拆成一步一步走给你看：

```demo
title: 生一只猫的时候，两层图纸谁先跑
code:
| class Animal:
|     def __init__(self, name):
|         self.name = name
|     def speak(self):
|         print(f"{self.name}发出了一声叫")
| class Cat(Animal):
|     def __init__(self, name, fish):
|         super().__init__(name)
|         self.fish = fish
|     def speak(self):
|         print(f"{self.name}：喵～本喵有 {self.fish} 条小鱼干")
| c = Cat("橘猫", 3)
| c.speak()

step 最上面那张大图纸先立好
at: 1
say: `class Animal:` 是**先立大图纸**：上面写着凡是动物都有名字（`__init__`）、都会叫（`speak`）。**图纸上写的字不会自己变出动物** —— 这一刻一只猫都还没有。
meow: 大图纸摊好了，还没猫喵～
pose: expect
c 这只猫 = 还没生
名字仓库 = 还没建
鱼干仓库 = 还没建

step 小图纸照着大图纸画
at: 6
say: `class Cat(Animal):` 是最要紧的一行：图纸名后面括号里填着 `Animal`，读作「**照 Animal 那张，再画一张 Cat**」。大图纸上的说明和招式小图纸天生就会 —— 可它也**自己写了一版** `__init__`（下一行）。
meow: 一句话认亲，小图纸画好！
pose: expect
c 这只猫 = 还没生
名字仓库 = 还没建
鱼干仓库 = 还没建

step 照小图纸生一只：喊的是小图纸那一版
at: 12
say: `Cat("橘猫", 3)` 照小图纸生一只真猫。生的时候 Python 会喊一招 `__init__` —— 喊的是**小图纸自己这一版**（第 7 行），因为小图纸写了，大图纸那一版就被**盖住**了。
meow: 照小图纸生一只猫！
pose: busy
c 这只猫 = 刚生出来，仓库还空着
名字仓库 = 还没建
鱼干仓库 = 还没建

step 喂进来的两样先接在手上
at: 7
say: 高亮这就**跳进了小图纸那一招**：喂进来的「橘猫」和 3 分别接在两个名字上 —— `name` 是「橘猫」、`fish` 是 3。**可它们此刻只是拿在手上**，还没进这只猫的仓库。
meow: 两样先接住，仓库还没建喵～
pose: busy
c 这只猫 = 刚生出来，仓库还空着
名字仓库 = 「橘猫」拿在手上（还没进仓库）
鱼干仓库 = 还没建

step 撞上 super()：先请上一层跑
at: 8
say: 第一句就是 `super().__init__(name)`：`super()` 是「**上一层图纸**」的意思，这一句读作「先请大图纸把它那版 `__init__` 跑一遍」。括号里**不用喂 `self`** —— 本喵站在哪张小图纸上，Python 自己清楚。
meow: 请上一层图纸先出手喵！
pose: expect
c 这只猫 = 刚生出来，仓库还空着
名字仓库 = 「橘猫」拿在手上（大图纸马上来建）
鱼干仓库 = 还没建

step 跳回大图纸：名字这就进仓库
at: 3
say: 高亮**跳回大图纸**那一行 —— 「橘猫」装进了这只猫的名字仓库。**这一趟是小图纸请回来的**：小图纸自己写了 `__init__`，大图纸那版不会自动跑，全靠刚才那句 `super()`。
meow: 名字进仓库了，大图纸干的！
pose: busy
c 这只猫 = 名字装好了
名字仓库 = 「橘猫」
鱼干仓库 = 还没建

step 回小图纸，跑自己那一句
at: 9
say: 大图纸那版跑完，**回到小图纸接着往下**：`self.fish = fish` 把 3 装进小图纸自己加的那只仓库。**两层谁先谁后就写在这两句的先后上**：请回来的那层先跑，自己这句后跑。
meow: 回来装自己的鱼干数喵！
pose: yay
c 这只猫 = 两层都装好了
名字仓库 = 「橘猫」
鱼干仓库 = 3

step 喊 speak：两个仓库都齐了
at: 13
say: `c.speak()` 走的是**小图纸这一版** `speak`（大图纸那一版被盖住了，安安静静躺着）。它要念 `self.name` 和 `self.fish` —— 两层的仓库**都装好了**，所以这句能完整念出声。
meow: 两个仓库都齐，念得出整句喵～
pose: proud
c 这只猫 = 两层都装好了，出声了
名字仓库 = 「橘猫」
鱼干仓库 = 3
```

**顺序就这四拍**：照小图纸生一只 → 小图纸那一版 `__init__` 先跑 → 撞上 `super()` 请大图纸跑一趟（名字这才进仓库）→ 再回来跑自己那一句。**大图纸那部分先装好、小图纸自己那份后装**；整段里少得了别的，少不得 `super()` 那一句喵。

## 一声开饭，各猫各样

```python
class Animal:
    def speak(self):
        print("……")

class Cat(Animal):
    def speak(self):
        print("喵～")

class Dog(Animal):
    def speak(self):
        print("汪！")

pets = [Cat(), Dog(), Cat()]
for pet in pets:
    pet.speak()
```

```text
喵～
汪！
喵～
```

看这三行输出：本喵从头到尾**只写了一句 `pet.speak()`**，写的时候压根不知道 `pet` 会是谁 —— 是猫就喵、是狗就汪，**同一句话，各猫各样**。

术语表里给这件事的原名是**多态（一声开饭，各猫各样）**。它的道理其实很简单：

- `pet` 这个名字底下，**装的是一只真猫**（照哪张图纸生的，它自己知道）。
- 喊 `pet.speak()` 的时候，Python 是**照着那只真猫自己的图纸**去找这一招的 —— 不是照着 `Animal` 大图纸找，也不是照着本喵写代码时脑子里想的那张找。
- 所以本喵只管写「喊 `speak`」，**具体喵还是汪，交给那只会自己决定**。

这份省心，正是套图纸最值钱的地方：**本喵加的宠物越多，`for` 那一行越不用改**。以后你再添一只鸭子，只要它照着 `Animal` 画、自己盖一版 `speak`，上面这三行一行都不用动喵。

::: tip 猫咪提示
- **`class Cat(Animal):`** —— 括号里填大图纸名，就是「照它画」；大图纸上的说明和招式，小图纸天生就会，不用重抄。
- **`pass`** —— 小图纸一时没东西可加，摆一个占位，不然 Python 不许。
- **重写** —— 小图纸上把同一招再写一遍，就把大图纸那版盖住了，大图纸本身不受影响。
- **`super().__init__(name)`** —— 小图纸自己写了 `__init__` 时，用这一句请大图纸把它那版先跑一遍；别忘了喂东西进去。
- **`isinstance(这只, 图纸名)`** —— 认亲用：从上往下认，不往上看。
- **各猫各样** —— 同一句 `pet.speak()`，是猫就喵、是狗就汪，写的人不用管它是谁。
:::

::: warn 小心喵
三个最容易踩的坑：

- **套了图纸，不等于大图纸的活会自动干。** 小图纸只要**自己写了** `__init__`，大图纸那一版就被盖住了 —— 名字不会自己进仓库。这时候必须自己补一句 `super().__init__(name)`。
- **`super()` 后面别加 `self`。** 写成 `super(self).__init__(name)` 翻译官喵会当场翻脸。
- **盖住的只是这一条路。** 小图纸把小招式改了，大图纸和它的其他下游**一点都不受影响** —— 这正是本喵想要的分寸，别误以为改了小的就等于改了大的喵。
:::

## 一句话对照表

| 写下的这一句 | 它干了什么 |
|---|---|
| `class Cat(Animal):` | 照着 `Animal` 那张大图纸，再画一张 `Cat` 小图纸 |
| `pass` | 小图纸里先空着，占个位 |
| `def speak(self):`（写在小图纸里） | **盖掉、换自己那版**：把大图纸那一版盖住，换成自己的画法 |
| `super().__init__(name)` | 先请上一层图纸，把它那版 `__init__` 跑一遍 |
| `super()` | 「上一层图纸」，不用喂 `self` |
| `isinstance(c, Animal)` | 认亲：`c` 是不是照这张图纸（或它的下游）生出来的 |
| `pet.speak()` | 是猫就喵、是狗就汪，写的人不用管它是谁 |

## 小任务

本喵把大肥鱼也请进宠物队伍里了 —— 它照着同一张大图纸画，但自己加了一段 `__init__`，还把 `speak` 盖成了自己那版：

```python
class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        print(f"{self.name}发出了一声叫")

class Cat(Animal):
    def speak(self):
        print(f"{self.name}：喵～")

class Fish(Animal):
    def __init__(self, name, fat):
        super().__init__(name)
        self.fat = fat

    def speak(self):
        print(f"{self.name}：咕噜咕噜，本鱼有 {self.fat} 斤")

pets = [Cat("橘猫"), Fish("大肥鱼", 9)]
for pet in pets:
    pet.speak()
```

```text
橘猫：喵～
大肥鱼：咕噜咕噜，本鱼有 9 斤
```

**试着改一改**：

1. 再画一张 `Dog` 小图纸，也盖一版 `speak` 印出「汪！」；然后往 `pets` 那一排里加一只 `Dog("大黄")` —— 看看底下那个 `for` 要不要动（答案是：一个字都不用改喵）。
2. 在 `Cat` 小图纸里加一招 `def sleep(self):`，然后写一句 `Cat("橘猫").sleep()` 试试。再想想看：`Fish("大肥鱼", 9).sleep()` 能不能喊得动？为什么？
3. 把 `Fish` 里那句 `super().__init__(name)` **注释掉**再跑一遍 —— 看看报的是什么错，就知道这一句为什么少不得了喵。

下一课，本喵要给图纸上那些名字被两条下划线夹着的招式排排队 —— `__str__`、`__add__` 这些，Python 会在什么时刻**自动**替你喊它们喵～ 🐾
