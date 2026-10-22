---
id: common-24
lang: common
stage: 0
order: 21
title: 同一本账，两种写法——结构体版与类版并排看
tags: [面向对象, 类与对象, 封装]
required: ["common-23"]
crossRefs: ["cpp-stage2-01","java-stage1-12","python-stage1-14","common-10"]
estMinutes: 17
keywords: [struct, class, public, private]
---

## 钩子：同一本账，本喵写了两遍

上一课，本喵在猫窝学堂记下了一批学员的账：谁在册、各考了几分。家伙什是**结构体 + 站在外面的三招** —— `add_student` 记一位新学员、`find_by_name` 按名字找人、`print_all` 把账报一遍。能跑，本喵认账喵。

可上一课加「交换生」那回，本喵一层层数下去，越数爪尖越酸：图纸要动一处，`add_student` 和 `print_all` 两招要动（`find_by_name` 不用碰），一共**三处** —— 最疼的不是这三下，是本喵得凭记性挨个找。一路立下来的那句判据句，这回该拿出来对账了：**藏数据、露行为**。结构体版缺的，正是这六个字里的两样东西。

今天**不改需求、不换账本**：同一批学员、同一笔账，本喵把它**再写一遍**，换成另一种写法 —— 然后两版**并排摆在一起**看。

丑话说在前头：两版都能跑。差别不在「能不能用」，在三个地方 —— **招式站在哪、盖子在哪、外面从哪儿伸手**。看完这三样，你就摸到「从流水线到一群角色」的门了喵。

## 结构体版：招式站在外面（上一课那本）

先重温账本的第一版。核心只有三段：一张图纸、一排账、三招站在外面喵：

```c
#include <stdio.h>
#include <string.h>

typedef struct {
    char name[20];
    int score;
} Student;

Student list[100];      /* 一排学员的账，全校共用这一本 */
int count = 0;          /* 已经记了几位 */

void add_student(char name[], int score) {
    strcpy(list[count].name, name);
    list[count].score = score;
    count = count + 1;
}

int find_by_name(char name[]) {
    for (int i = 0; i < count; i++) {
        if (strcmp(list[i].name, name) == 0) {
            return i;
        }
    }
    return -1;
}

void print_all(void) {
    for (int i = 0; i < count; i++) {
        printf("%s %d\n", list[i].name, list[i].score);
    }
}
```

外面用起来是这样：

```c
add_student("小橘", 95);
add_student("狸花", 88);
print_all();
```

这一版有三处值得盯住看：

1. **三招都站在图纸外面**。想记人，把「名字、分数」告诉 `add_student`；想查人，`find_by_name` 报的是「第几位」（找不到回 `-1`）。账是账、招是招，两下是**分家**的。
2. **两格全敞着**。谁都能写一句 `list[0].score = list[0].score + 5;`，改了也没人拦 —— 因为 C 里根本没有「盖子」这回事。
3. **喊法不用点名**：`add_student(...)`、`print_all()` —— 不用提「跟哪本账说话」，因为账只有全局的这一本。

## 图纸版：招式画进图纸里（同一本账）

同一笔账，这次不换需求，只换写法。本喵先画**两张图纸**喵：

```python
class Student:
    def __init__(self, name, score):
        self._name = name        # 私有：名字
        self._score = score      # 私有：分数

    def get_name(self):          # 口子：报名字
        return self._name

    def add_score(self, delta):  # 口子：加分
        self._score = self._score + delta

    def report(self):            # 口子：报账
        print(f"{self._name}：{self._score} 分")

class Roster:
    def __init__(self):
        self._students = []      # 私有：一排学员

    def add(self, name, score):              # 口子：记一位新学员
        self._students.append(Student(name, score))

    def find(self, name):                    # 口子：按名字找人
        for s in self._students:
            if s.get_name() == name:
                return s
        return None

    def report_all(self):                    # 口子：把账报一遍
        for s in self._students:
            s.report()

roster = Roster()
roster.add("小橘", 95)
roster.add("狸花", 88)
roster.report_all()
```

```text
小橘：95 分
狸花：88 分
```

这就是行话里的**面向对象（真猫当主角）**：数据与操作绑在一起、长在一位位真猫身上，外面只跟口子打交道喵。这张「学员」的图纸，术语表里叫**类（猫猫图纸）**；照它生出来的每一位，叫**对象（根据图纸生出来的真猫）** —— 在这本账里，就是一位位真学员。拆开看：

- **学员图纸（`class Student`）**：两格账（名字、分数）都盖上了盖子 —— 名字前那一个下划线 `_` 就是盖子。露在外面的只有几道**口子**：`get_name` 报名字、`add_score` 加分、`report` 报账。
- **档案库图纸（`class Roster`）**：账本自己管自己 —— 它**自带**一排学员（`self._students`，也盖着盖子），露在外面的口子是 `add`（记人）、`find`（按名字找人）、`report_all`（报账）。
- **外面只剩口子可走**：`roster.add("小橘", 95)` —— 先说是**哪个档案库**，再喊口子名；比第一版多了一小段「跟谁说话」。

上一课那三招，一道道搬进图纸里：`add_student` → 口子 `add`；`find_by_name` → 口子 `find`（上一版报的是「第几位」，这版直接把**那一位学员**递出来，找不到回 `None`）；`print_all` → 口子 `report_all`。报账这件小事还分成了两层：档案库负责「走一圈」（`report_all`），每位学员负责「报自己」（`report`）。

拿一路立下来的判据句量一量：**封装（带盖的小鱼干盒）＝藏数据、露行为**。这一版里，数据（两格、一排名单）全藏进盖子，露在图纸外面的是口子 —— 这才叫改造到位。要是你把招式搬进大括号、两格还敞着，那可不算图纸版 —— 那是「**结构体＋招式容器**」，换了个地方收着而已喵。

## 三个维度，说出两版的差别

两版摆齐了，本喵用三个维度说出差别喵。

**维度一：招式站在哪儿 —— 数据与操作绑没绑在一起。**
第一版的 `add_student`、`find_by_name`、`print_all` 站在图纸**外面**，每次都得自己拎着「哪本账」去干活；第二版里，报账画在学员图纸里面（`report`）、记人画在档案库图纸里面（`add`）—— 谁的数据谁自己动，招式不用再满世界找账本。

**维度二：盖子开不开 —— 默认权限与「标签站哪一行」。**
第一版两格全敞着，不是本喵懒 —— 是 C 里没有盖子这个东西。到了有图纸和盖子的语言里，各家的规矩不一样：

- **C++**：开场白是 `struct` 的图纸，默认**敞开**；开场白是 `class` 的图纸，默认**盖着** —— 同一张图纸，就差开头那一个词。没写标签的时候，等于头顶**隐形**站着一块标签，站哪一块由开场白说了算：

```cpp
struct Student {      // 开场白：struct
    int score;        // 默认 = 谁都能碰（头顶隐形站着一句 public:）
};

// 同一张图纸，只换开场那一个词 —— 同一份代码里只立得住一块 Student，
// class 版收在下面，对着「默认」那一列读：
// class Student {
//     int score;      // 默认 = 藏起来（头顶隐形站着一句 private:）
// };
```

写出来的标签（`public:` / `private:`）也有规矩：**一块标签管一段，一直到下一块标签站起来**。这就是「标签站哪一行」的看头 —— 想知道一格归谁管，就往上找**最近的一块标签**喵。

- **Java**：每一格、每一道口子都习惯**写明** `private` 还是 `public`（不写的那档权限小得很，出了这个圈子就够不着）。
- **Python**：靠名字前面那一个下划线 `_` 把格子盖起来 —— 没有真锁，靠的是全体猫守的家规：谁起了这个头，别的猫就按规矩不掀。

**维度三：口子有几道 —— 「与猫的约定」和「改需求的改动面」。**
第二版里，外面跟这本账打交道的地方只剩几道口子：`roster.add(...)`、`roster.find(...)`、`roster.report_all()` —— 这几道口子合起来的那份约定，术语表里叫**接口（与猫的约定）**：说好会这招的猫，都得能用这招。

口子还有个最实在的好处：**改动面收窄**。以后本喵想让报账多印一句「（猫窝学堂）」，只改图纸里 `report` 那一招，外面所有喊口子的地方**一个字都不用动**。第一版遇到同样的改动，账和招式分着站，本喵得追着改一串地方 —— 上一课那笔滚起来的账，就是这么来的喵。

## 四位翻译官喵，同一笔账

同一件事：给账上记一位学员「小橘，95 分」，再请它自己报一报喵。

```compare
c::
#include <stdio.h>
#include <string.h>

typedef struct {
    char name[20];
    int score;
} Student;

void report(Student s) {          /* 报账这一招站在图纸外面 */
    printf("%s：%d 分\n", s.name, s.score);
}

int main(void) {
    Student s;
    strcpy(s.name, "小橘");
    s.score = 95;
    report(s);                    /* 把整只盒子喂进招式里 */
    return 0;
}

cpp::
#include <iostream>
#include <string>
using namespace std;

class Student {
private:                    // class 默认就是盖着的，这里写明给你看
    string name;
    int score;

public:                     // 这一行起，下面是留给外面的口子
    void fill(string n, int s) {
        name = n;
        score = s;
    }

    void report() {
        cout << name << "：" << score << " 分" << endl;
    }
};

int main() {
    Student s;
    s.fill("小橘", 95);      // 填格子走口子
    s.report();              // 报账由这一位自己做
    return 0;
}

java::
class Student {
    private String name;
    private int score;

    public void fill(String n, int s) {
        name = n;
        score = s;
    }

    public void report() {
        System.out.println(name + "：" + score + " 分");
    }
}

public class Main {
    public static void main(String[] args) {
        Student s = new Student();
        s.fill("小橘", 95);
        s.report();
    }
}

python::
class Student:
    def __init__(self, name, score):
        self._name = name        # 出生那一刻就把两格装好
        self._score = score

    def report(self):
        print(f"{self._name}：{self._score} 分")

s = Student("小橘", 95)
s.report()
```

```text
小橘：95 分
```

看出来了吗喵：**同一个需求，C 只给得出版本一，后面三位给的都已经是版本二了**。

- **C**：`struct` 装两格，报账这一招**站在外面**（`report(s)`），还得把整位学员喂进去；两格没有盖子，谁都能伸手。
- **C++**：`class` 图纸先写 `private:`（其实 `class` 默认就是盖着的），再写 `public:` 留口子；外面只能 `s.fill(...)`、`s.report()`。C++ 那一线管这样的 `struct` 叫「卡片图纸」—— 它和 `class` 几乎是同一台机器，差别就在开场那一个词。
- **Java**：每一格、每一道口子都**写明** `private` / `public`；生一只要喊 `new`。
- **Python**：`__init__` 在出生那一刻就把两格装好；名字前面那一个下划线（像 `_name` 这样的）就是盖子，露在外面的是 `report` 这道口子。

四位翻译官喵的共识就一条：**数据可以盖起来，口子得写清楚**喵。

## 走一遍：两位学员，两本账

图纸版转起来是什么样，本喵拆成一步一步给你看喵：

```demo
title: 同一个档案库、两位学员，账是怎么各归各的
code:
| class Student:
|     def __init__(self, name, score):
|         self._name = name
|         self._score = score
|     def report(self):
|         print(f"{self._name}：{self._score} 分")
| class Roster:
|     def __init__(self):
|         self._students = []
|     def add(self, name, score):
|         self._students.append(Student(name, score))
|     def report_all(self):
|         for s in self._students:
|             s.report()
| roster = Roster()
| roster.add("小橘", 95)
| roster.add("狸花", 88)
| roster.report_all()

step 画学员图纸：两格 + 一道口子先占位
at: 1
say: `class Student:` 一落笔，学员图纸开了个头。图纸上将来有**两格**（第 3、4 行是它们出生时被装好的样子）、一道报账口子（第 5 行）—— 两格都盖着盖子。对照第一版：结构体版这里只有两格光溜溜的格子，报账那一招站在图纸**外面**。
meow: 图纸摊开了，账上还没人喵～
pose: expect
图纸 Student = 画好了（本身不是学员）
图纸 Roster = 还没画
roster 的名册 = 还没生
小橘的账 = 还没生
狸花的账 = 还没生
屏幕上 = 还没印

step 出生那一招先画上：一生出来就装好两格
at: 2
say: `def __init__(self, name, score):` 是图纸上的一条说明：照它生学员的时候，先把名字和分数喂进来。这一刻它还**一次都没跑过** —— 还没有学员出生。第一版里没有这一招，生完还得自己伸手一格一格装。
meow: 这一招先画着，等学员来喊它～
pose: expect
图纸 Student = 画好了（那招还没跑过）
图纸 Roster = 还没画
roster 的名册 = 还没生
小橘的账 = 还没生
狸花的账 = 还没生
屏幕上 = 还没印

step 再画档案库图纸：自带一排名单 + 两道口子
at: 7
say: 第二张图纸 `class Roster:`（档案库）开工。它**自己带**一排学员名单（第 9 行那句 `self._students = []`，名单也盖着盖子），图纸上留了两道口子：`add`（记一位新学员）和 `report_all`（把账报一遍）。
meow: 库的图纸好了，就等学员来住～
pose: expect
图纸 Student = 画好了（那招还没跑过）
图纸 Roster = 画好了（自带一排名单）
roster 的名册 = 还没生
小橘的账 = 还没生
狸花的账 = 还没生
屏幕上 = 还没印

step 照档案库图纸生一个真档案库
at: 15
say: `roster = Roster()` 生出的是**档案库**，不是学员 —— 账上还是一个人都没有：图纸画的是「库该有什么、会什么」，库站在那儿，等你往里记人。
meow: 库站好了，账上还是空的喵～
pose: busy
图纸 Student = 画好了（那招还没跑过）
图纸 Roster = 画好了（自带一排名单）
roster 的名册 = 空的
小橘的账 = 还没生
狸花的账 = 还没生
屏幕上 = 还没印

step 走 add 口子，记第一位
at: 16
say: `roster.add("小橘", 95)` —— 外面**不伸手掏格子**，只喊口子。口子里那一句（第 11 行）先照 `Student` 图纸生一位新学员：图纸上那招出生法（第 2 行）这时候才真的开始跑。
meow: 口子一喊，新学员站起来啦！
pose: busy
图纸 Student = 画好了（那招开始跑了）
图纸 Roster = 画好了（自带一排名单）
roster 的名册 = 空（这一位还在出生）
小橘的账 = 刚出生，两格还空着
狸花的账 = 还没生
屏幕上 = 还没印

step 「小橘」落进它自己的格子
at: 3
say: `self._name = name` —— 喂进来的「小橘」装进**这一位自己**的名字格。名字前面那一个下划线就是盖子 —— 不过这是全体猫的家规，不是真锁：外面**看得见** `s._name`，可规矩是「别人的格子，不许伸爪子」。想知道名字，走它留的口子。
meow: 名字进自己的格子，盖子盖上喵～
pose: busy
图纸 Student = 画好了（那招开始跑了）
图纸 Roster = 画好了（自带一排名单）
roster 的名册 = 空（这一位还没收进来）
小橘的账 = 名字「小橘」、分数（还没装）
狸花的账 = 还没生
屏幕上 = 还没印

step 95 分也落进它自己那格
at: 4
say: `self._score = score` 同一套动作；装完，第一位学员两格齐了 —— 名字和分数都在**它自己**身上，不在图纸上。生好之后，它才被收进档案库的名册里（第 11 行后半句）。
meow: 两格装满，收进名册～
pose: yay
图纸 Student = 画好了（那招开始跑了）
图纸 Roster = 画好了（自带一排名单）
roster 的名册 = 小橘这一位
小橘的账 = 名字「小橘」、分数 95
狸花的账 = 还没生
屏幕上 = 还没印

step 第二声口子：狸花也来了
at: 17
say: `roster.add("狸花", 88)` —— **同一段口子、同一张图纸**，第二位学员站起来，两格都是它自己的：狸花 88 分。回头瞧一眼小橘 —— 一点没动，还是 95 分。**同一段代码、两位学员，账各是各的**，这是改造后最值钱的一条。
meow: 同一套口子，第二位也有自己的账！
pose: yay
图纸 Student = 画好了（那招开始跑了）
图纸 Roster = 画好了（自带一排名单）
roster 的名册 = 小橘、狸花 两位
小橘的账 = 名字「小橘」、分数 95
狸花的账 = 名字「狸花」、分数 88
屏幕上 = 还没印

step report_all 一喊，名册从头走到尾
at: 18
say: 报账也不用外面挨个念 —— `roster.report_all()` 这道口子一喊，档案库自己从名册头走到尾（第 13 行那一圈）：轮到谁，谁就报到。
meow: 不用一位位喊，库自己走喵～
pose: expect
图纸 Student = 画好了（那招开始跑了）
图纸 Roster = 画好了（自带一排名单）
roster 的名册 = 小橘、狸花 两位
小橘的账 = 名字「小橘」、分数 95
狸花的账 = 名字「狸花」、分数 88
屏幕上 = 还没印

step 轮到谁，谁自己报
at: 14
say: 圈里那一句 `s.report()` 是**学员自己**会的一招 —— 念的是自己的名字、自己的分。两圈走完，屏幕落下两行。对照第一版：报账的人站在图纸外面，得把整位学员喂进招式里，它才念得出来。
meow: 各报各的账，两行收工喵～
pose: proud
图纸 Student = 画好了（那招开始跑了）
图纸 Roster = 画好了（自带一排名单）
roster 的名册 = 小橘、狸花 两位
小橘的账 = 名字「小橘」、分数 95
狸花的账 = 名字「狸花」、分数 88
屏幕上 = 2 行：小橘：95 分 / 狸花：88 分
```

::: tip 猫咪提示
今天记住三句话喵：

1. **招式站在哪儿**：结构体版的招式站在图纸**外面**（自由招式，得自己拎着账本）；图纸版的招式画在图纸**里面**（口子，谁的数据谁自己动）。
2. **盖子**：结构体版默认全敞着；图纸版的格子默认盖着 —— 在 C++ 里，开口那个词（`struct` / `class`）决定没写标签时头顶**隐形**站着的是哪一块标签。
3. **口子（接口）**：外面只从口子进 —— 于是「改需求」的改动面收窄到图纸和口子里。
:::

::: warn 小心喵
两个坑，本喵标出来：

- **「结构体＋招式容器」不是图纸版**：只把招式搬进大括号、两格照旧敞着，那是换了个地方收着。当场拿判据句量一量：**藏数据、露行为** —— 藏没藏、露没露，两样都得做到。
- **默认权限是一门语言一门规矩**：C 里没有盖子这回事；C++ 里 `class` 默认盖着、`struct` 默认敞开；Java 习惯一格一格写明；Python 的 `_` 是**家规**不是锁。别把一门的规矩当成全世界的规矩，也别把「名字前面划了一道」当成保险箱喵。
:::

## 一句话对照表

| 本喵写下的 | 它的意思 |
|---|---|
| `class Student:` | 画一张「学员」图纸，招式就画在上面（图纸本身不是学员） |
| `self._name = name` | 名字落进「这一位自己」的格子；`_` 开头 = 盖着盖子（家规守的） |
| `def report(self):` | 报账这一招画在图纸**里面**，是学员自己会的一招 |
| `class Roster:` | 画「档案库」图纸：账本自己管自己那一排名单 |
| `roster.add("小橘", 95)` | 走口子记一位新学员 —— 外面不伸手掏格子 |
| `roster.report_all()` | 走口子把账报一遍：轮到谁，谁自己报 |

## 小任务

1. **数一数（动脑）**：从第一版到第二版，本喵一共动了哪几处？照着「两格账 → 报账的招式 → 外面喊招式的地方」列一张单子，数出总数喵。
2. **动手**：把课文里那段图纸版代码抄进练习场，给账上再添一位「大胖，91 分」，跑一跑 —— 屏幕上是不是三行了？
3. **再动手**：把 `report` 里印的那句话改一改（比如在名字后面加「（猫窝学堂）」），跑一遍。想一想：外面那几声口子（`roster.add`、`roster.report_all`）需要跟着改吗？为什么喵？

下一课，本喵要给「递牌子」这门老手艺找个接班人：想改外面的数，老手艺靠的是递进去一张**猫爪指向牌** —— 新来的这位，不写 `*` 也能把同一件活干成。它是谁、长什么样？下一课探险见喵～ 🐾
