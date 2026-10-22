---
id: cpp-stage1-15
lang: cpp
stage: 1
order: 16
title: 综合项目：简易记账本
tags: [综合项目, 结构体, 数组]
required: ["cpp-stage1-14"]
crossRefs: []
estMinutes: 30
keywords: [struct, array, menu, project]
---

## 钩子：记一笔账，要带两样东西

第二台机器：**简易记账本**。

要记的每一笔都有两样东西：**它是什么**（猫粮、小鱼干、猫窝）和**花了多少条鱼干**。一句话说就是「猫粮 30」这样一条一条往下记。

可这就撞上一个麻烦：前面学过的储物柜，**每一格只能装一样东西**。

- `string names[3]` 只能装名字，装不下数目；
- `int amounts[3]` 只能装数目，装不下名字。

要是真的开两排柜子，就得时时刻刻记着「第 0 格的名字配第 0 格的数目」—— 记错一格，整本账就乱了。更别说往后想给一笔账再加个日期、再加个备注：柜子一排一排地开，越开越多，配对越配越乱。

本喵要的是**一张小卡片**：名字和数目写在同一张卡上，拿起来是一张，放下也是一张。今天第一节就把这张卡片造出来。

## 一、记账小卡片：`struct`

C++ 里造这种「几样东西捆在一起」的小卡片，用的是 `struct`（结构体）：

```cpp
#include <iostream>
#include <string>
using namespace std;

struct Record {
    string name;
    int amount;
};

int main() {
    Record r = {"猫粮", 30};
    cout << r.name << " " << r.amount << endl;

    r.amount = r.amount + 5;
    cout << r.name << " " << r.amount << endl;
    return 0;
}
```

```text
猫粮 30
猫粮 35
```

一段一段看喵：

- **`struct Record { string name; int amount; };`** —— 这就是**画卡片的那张图纸**。
  - `struct` 念作「structure」，结构、构造的意思；
  - `Record` 是这张卡片的名字（本喵自己起的，叫 `Bill`、`Item` 都行）；
  - 一对大括号里写着**这张卡上有哪几栏**：一栏叫 `name`（装一串小鱼干），一栏叫 `amount`（装一个整数）；
  - ⚠️ **最后那个分号千万别忘了** —— 大括号闭合以后还有一个 `;`，这是它和招式、圈最不一样的一点（招式和大括号结尾都不带分号，卡片图纸带）。
- **`Record r = {"猫粮", 30};`** —— 照图纸**做出**一张真卡片，名字按顺序填进那两栏里。念作「`r` 是一张 `Record`，第一栏 `猫粮`、第二栏 `30`」。
- **`r.name` / `r.amount`** —— **点号**是从卡片里取某一栏的办法。念作「`r` 这张卡片上的 `name` 那一栏」。取出来跟普通的碗一模一样，能印能改：`r.amount = r.amount + 5;` 就是把第二栏从 30 改成 35。

::: tip 猫咪提示
**卡片图纸和真卡片，是两样东西。** 这一点最容易搞混，本喵掰开说：

- `struct Record { ... };` —— **图纸**。它自己不吃地方、不能装东西，只是画在这儿：以后照这个样子做卡片。
- `Record r = {...};` —— **照图纸做出来的真卡片**。它才装得住东西。

和第九课那个「招式」有点像：招式写了不跑，得有人喊才跑；图纸画了不做卡片，得有人做出来才有东西用。图纸可以画在大括号外面（本喵上面就画在最外面），它的名字和招式名字一样，从画下的地方开始都能用喵。
:::

## 二、一排小卡片，走一遍看看

一张卡片当然不够，一栏一栏往下记才叫记账。卡片也能排成一排 —— 一排碗的写法原样搬过来就行：

```cpp
#include <iostream>
#include <string>
using namespace std;

struct Record {
    string name;
    int amount;
};

int main() {
    Record book[3] = {{"猫粮", 30}, {"小鱼干", 12}, {"猫窝", 88}};

    for (int i = 0; i < 3; i++) {
        cout << book[i].name << " " << book[i].amount << endl;
    }
    return 0;
}
```

```text
猫粮 30
小鱼干 12
猫窝 88
```

- **`Record book[3] = {{"猫粮", 30}, {"小鱼干", 12}, {"猫窝", 88}};`** —— 外面一圈大括号是这一排，里面每一个大括号是**一张卡片**。想读成「一排三张卡片，各自两栏」喵。
- **`book[i]`** —— 第 `i` 张卡片（第 08 课一排碗的老手艺：从 0 数起）。
- **`book[i].name`** —— 先按编号拿到第 `i` 张卡片，再用点号取那一栏。**先方括号、后点号**，两个记号各干各的活。

## 三、算一算：两个统计招式

记账本最想干的两件事：**一共花了多少**、**哪一笔最贵**。一件一招，分开写：

```cpp
#include <iostream>
#include <string>
using namespace std;

struct Record {
    string name;
    int amount;
};

int total(Record book[], int n) {
    int sum = 0;
    for (int i = 0; i < n; i++) {
        sum = sum + book[i].amount;
    }
    return sum;
}

int biggest(Record book[], int n) {
    int top = 0;
    for (int i = 1; i < n; i++) {
        if (book[i].amount > book[top].amount) {
            top = i;
        }
    }
    return top;
}

int main() {
    Record book[3] = {{"猫粮", 30}, {"小鱼干", 12}, {"猫窝", 88}};

    cout << "一共 " << total(book, 3) << " 条鱼干喵" << endl;
    cout << "最大的一笔是 " << book[biggest(book, 3)].name << endl;
    return 0;
}
```

```text
一共 130 条鱼干喵
最大的一笔是 猫窝
```

两个招式都是上一课的老手艺 —— **一排卡片递过去，格数自己另外报**（`Record book[], int n`）：

- **`total`** 打个包：把每张卡片的 `amount` 那一栏加起来，叼回来。30 + 12 + 88 = 130。
- **`biggest`** 找冠军：`top` 是「目前最贵那张的编号」，从 0 号开始，一个一个比过去，谁大就把 `top` 换成谁。**注意它叼回来的是编号（`int`）而不是那张卡片** —— 因为卡片不好整个叼回来，编号好叼。
- 所以 `main` 里那一句才长成这样：`book[biggest(book, 3)].name` —— **先用 `biggest` 拿到编号，再用这个编号去取卡片，最后取 `name` 那一栏**。从里往外读一遍就通了：哪个编号 → 哪张卡片 → 哪一栏喵。

## 四、记一笔的招式：卡片和「温柔版」一起上

光会算还不够，还得能**往里记**。记一笔就是「往那一排的末尾放一张新卡片」：

```cpp
#include <iostream>
#include <string>
using namespace std;

struct Record {
    string name;
    int amount;
};

void addRecord(Record book[], int& count, string name, int amount) {
    book[count].name = name;
    book[count].amount = amount;
    count = count + 1;
}

int main() {
    Record book[8];
    int count = 0;

    addRecord(book, count, "猫粮", 30);
    addRecord(book, count, "小鱼干", 12);
    addRecord(book, count, "猫窝", 88);

    for (int i = 0; i < count; i++) {
        cout << book[i].name << " " << book[i].amount << endl;
    }
    cout << "一共记了 " << count << " 笔喵" << endl;
    return 0;
}
```

```text
猫粮 30
小鱼干 12
猫窝 88
一共记了 3 笔喵
```

这一招值得一个字一个字看，它把前面十四课的东西全串上了喵：

- **`Record book[]`** —— 那一排卡片。**格数不报**，因为这一招不用知道那一排有多长（它只在末尾放东西）。
- **`int& count`** —— 第十课那个**温柔版**的那个小记号。为什么这里非用它不可？
  因为 `count` 得**改**：每记一笔就加 1。要是写成 `int count`，那只是一份复印件，招式里加得再欢，外面那位还是 0 —— 下一笔又会盖在 0 号格上，账全被吃光。
- **`book[count].name = name;`** —— 把新卡片的 `name` 那一栏填上。这一行的读法：**先按编号拿到第 `count` 张卡片，再点出 `name` 那一栏，把料里的 `name` 填进去**。名字一样（都是 `name`），但左边的 `name` 是**卡片上的那一栏**，右边的是**招式收的那样料** —— 分不清的时候，看它前面有没有点号。
- **`count = count + 1;`** —— 这一句才是「记了一笔」的收尾：下次来的卡片放到下一格。
  （这一句要是漏了，三笔就会全盖在 0 号格上，最后只记下一笔 —— 本课最容易漏的就是它。）
- **`Record book[8];`** —— 先开一排 8 格的空位，记多少笔另说，`count` 说了算。（`book` 里那 8 张卡片是**空卡片**：`name` 是空的一串，`amount` 没填。所以下面那圈只走前 `count` 张 —— **从来没去碰后面那几张没填过的**。）

## 五、装成一台机器：菜单 + 按键

最后一步，把零件装成一台**能用菜单操作**的机器。老规矩：**键盘敲不进去，所以先写死三个按键当替身**：

```cpp
#include <iostream>
#include <string>
using namespace std;

struct Record {
    string name;
    int amount;
};

void showMenu() {
    cout << "=== 小鱼干记账本 ===" << endl;
    cout << "1. 看看账本" << endl;
    cout << "2. 算算总数" << endl;
    cout << "3. 收工" << endl;
    cout << "选一个（1-3）：";
}

int total(Record book[], int n) {
    int sum = 0;
    for (int i = 0; i < n; i++) {
        sum = sum + book[i].amount;
    }
    return sum;
}

int biggest(Record book[], int n) {
    int top = 0;
    for (int i = 1; i < n; i++) {
        if (book[i].amount > book[top].amount) {
            top = i;
        }
    }
    return top;
}

void listAll(Record book[], int n) {
    for (int i = 0; i < n; i++) {
        cout << i + 1 << ". " << book[i].name << " " << book[i].amount << endl;
    }
}

int main() {
    Record book[3] = {{"猫粮", 30}, {"小鱼干", 12}, {"猫窝", 88}};
    int keys[3] = {1, 2, 3};

    for (int k = 0; k < 3; k++) {
        int choice = keys[k];
        showMenu();
        cout << choice << endl;

        if (choice == 1) {
            listAll(book, 3);
        } else if (choice == 2) {
            cout << "一共花了 " << total(book, 3) << " 条鱼干喵" << endl;
            cout << "最贵的一笔是 " << book[biggest(book, 3)].name << endl;
        } else {
            cout << "收工啦喵～" << endl;
        }
    }
    return 0;
}
```

```text
=== 小鱼干记账本 ===
1. 看看账本
2. 算算总数
3. 收工
选一个（1-3）：1
1. 猫粮 30
2. 小鱼干 12
3. 猫窝 88
=== 小鱼干记账本 ===
1. 看看账本
2. 算算总数
3. 收工
选一个（1-3）：2
一共花了 130 条鱼干喵
最贵的一笔是 猫窝
=== 小鱼干记账本 ===
1. 看看账本
2. 算算总数
3. 收工
选一个（1-3）：3
收工啦喵～
```

零件一个都不新，全是前面几课的老手艺：

- **`showMenu`** —— 印菜单、报一句「选一个」的那一招。**菜单单独做成一招**，是为了以后想加一项（比如「4. 记一笔」）只改这一处。
- **`int keys[3] = {1, 2, 3};`** —— **按键的替身**。你敲不进来，本喵就先写好：第一轮按 1、第二轮按 2、第三轮按 3。
- **`for (int k = 0; k < 3; k++)`** —— 这台机器正好转三轮（因为你只按了三次）。**转几圈是知道的，就用 `for`** —— 上一课那台猜数字机器不知道要转几圈，才用的 `while (true)`。
- **`cout << choice << endl;`** —— 把「本喵按了哪个键」也印出来，好让屏幕上的对话读得通。
- **三条岔路**就是菜单那三项，一项一招，各管各的。

## 六、真机版：自己敲按键

把按键替身换成投喂口，就是给你自己玩的那一版：

```text
#include <iostream>
#include <string>
using namespace std;

struct Record {
    string name;
    int amount;
};

int main() {
    Record book[3] = {{"猫粮", 30}, {"小鱼干", 12}, {"猫窝", 88}};
    int choice = 0;

    while (true) {
        cout << "=== 小鱼干记账本 ===" << endl;
        cout << "1. 看看账本" << endl;
        cout << "2. 算算总数" << endl;
        cout << "3. 收工" << endl;
        cout << "选一个（1-3）：";

        if (!(cin >> choice)) {
            cout << endl << "投喂口空了，本喵先收工喵" << endl;
            break;
        }
        if (choice == 3) {
            cout << "收工啦喵～" << endl;
            break;
        }
        if (choice == 1) {
            for (int i = 0; i < 3; i++) {
                cout << i + 1 << ". " << book[i].name << " " << book[i].amount << endl;
            }
        } else if (choice == 2) {
            int sum = 0;
            for (int i = 0; i < 3; i++) {
                sum = sum + book[i].amount;
            }
            cout << "一共花了 " << sum << " 条鱼干喵" << endl;
        } else {
            cout << "没有这一项喵，再选一次～" << endl;
        }
    }
    return 0;
}
```

这一段要敲键盘，所以本喵没法在这儿现场跑。本喵把 `1`、`2`、`3` 三次按键喂进去跑了一遍，屏幕上长这样：

```text
=== 小鱼干记账本 ===
1. 看看账本
2. 算算总数
3. 收工
选一个（1-3）：1. 猫粮 30
2. 小鱼干 12
3. 猫窝 88
=== 小鱼干记账本 ===
1. 看看账本
2. 算算总数
3. 收工
选一个（1-3）：一共花了 130 条鱼干喵
=== 小鱼干记账本 ===
1. 看看账本
2. 算算总数
3. 收工
选一个（1-3）：收工啦喵～
```

**有一处和真键盘不一样，本喵说清楚**：本喵是**把按键喂进去**的，所以那个 `1`、`2`、`3` 没有出现在屏幕上（喂进去的数字屏幕不会自己回显）。你真坐在键盘前面玩的时候，敲下去的键会被屏幕自己印一遍，那一行读起来就是「选一个（1-3）：1」再接下面的内容 —— **内容一模一样，只是多了一个你自己敲出来的字符**。

（两边对一对，除了这一点，菜单会**每转一圈重印一遍** —— 所以你玩的时候屏幕上会一轮一轮往下滚，正是这个原因。想让菜单少滚一点，就把它挪到圈外面去：那样只在开头印一次。）

::: warn 小心喵
这一课最后三条避坑：

1. **卡片图纸后面那个分号。** `struct Record { ... };` —— 大括号闭合了还得补一个 `;`。这是它和招式、圈最不一样的地方，也是最容易漏的一个字符。
2. **想改外面那只碗，料那一头就得写温柔版的小记号**（`int& count`）。漏了它，招式里改得再对，外面那位也一点没变 —— `addRecord` 里那个 `count` 非写不可。
3. **一圈只走「真记过的」那几张。** `Record book[8];` 里后面那几张是没填过的空卡片，圈的条件写 `i < count`，别写 `i < 8` —— 那会印出一堆空行。
:::

## 小抄表

| 写法 | 念作 | 干什么 |
|---|---|---|
| `struct Record { string name; int amount; };` | 画一张卡片图纸 | 画完才能照它做卡片（**结尾别忘 `;`**） |
| `Record r = {"猫粮", 30};` | 照图纸做一张真卡片 | 按顺序把两栏填上 |
| `r.name` / `r.amount` | 点号取一栏 | 从卡片里取出某一栏，能印也能改 |
| `Record book[3] = {{"猫粮", 30}, ...};` | 一排小卡片 | 外面一圈是排，里面每个括号是一张卡 |
| `book[i].name` | 先编号、后点号 | 第 `i` 张卡片的 `name` 那一栏 |
| `void addRecord(Record book[], int& count, ...)` | 记一笔 | 一排卡片 + 温柔版的小记号（要改 `count`） |
| `book[count].name = name;` | 往第 `count` 张卡片上填一栏 | 左边是卡片上的栏，右边是收到的料 |
| `count = count + 1;` | 这一笔记完了 | 下次来的卡片放到下一格（**别漏**） |
| `showMenu();` | 印菜单那一招 | 菜单单独一招，加项只改一处 |

::: tip 猫咪提示
两台机器装完，回头看一遍**项目课的四个步骤**（上一课教的，这一课又走了一遍）：

1. **拆零件** —— 卡片、印卡片、算总数、找最贵、记一笔，一件一件单独跑通；
2. **一招一件事** —— `total` 只算、`biggest` 只找、`showMenu` 只印、`addRecord` 只记；
3. **串起来** —— 菜单 + 三条岔路 + 一排卡片，装成整台机器；
4. **换掉替身** —— 把写死的按键换成投喂口，就是给你自己玩的那一版。

**这一课到这儿，C++ 的第一阶段就走完了** —— 从「什么是程序」到两台自己会跑的小机器。前面学过的每一样东西今天都能在代码里指出它站在哪儿：`int`/`string`（卡片的两栏）、`if`（三条岔路）、`for`（走一排）、招式（四个零件）、一排碗（那排卡片）、温柔版（`int& count`）、卡片图纸（`struct`）喵。
:::

## 小任务

1. 把第一段里 `r.amount = r.amount + 5;` 改成 `r.amount = r.amount * 2;`，先猜猜第二行印什么，再跑一遍。
2. 给卡片图纸**加一栏** `int count;`（数量），然后把 `Record r = {"猫粮", 30};` 改成三样一起填。想想顺序。（提示：卡片上填东西是按顺序的。）
3. 把第三段里 `biggest` 里那句 `>` 改成 `<`，跑一次 —— 「最大的一笔」变成了什么？
4. 把第四段里的 `addRecord(book, count, "猫窝", 88);` 删掉一行，跑一次 —— 一共记了几笔？印出来几行？
5. 把第四段里 `int& count` 的那个小记号删掉（写成 `int count`），跑一次。先猜猜会发生什么，再对答案。
6. 给第五节那台机器**加一项菜单**：「4. 记一笔」。想清楚两件事再动手：菜单那一招要改哪儿？记一笔那一招要往哪儿带什么料喵？

两台机器都装完了，C++ 的第一阶段也到站了。往后还有更远的路：一堆卡片怎么排得更好用、招式怎么长得更像猫、图纸怎么套图纸…… 今天先把这两台机器跑顺，它们是你在这一阶段最拿得出手的两件作品喵～ 🐾
