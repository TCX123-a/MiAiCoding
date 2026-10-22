---
id: cpp-stage3-15
lang: cpp
stage: 3
order: 19
title: 综合项目：图书管理系统
tags: [综合项目, 实战]
required: ["cpp-stage3-14"]
crossRefs: []
estMinutes: 32
keywords: [fstream, unique_ptr, virtual, count_if]
---

## 钩子：鱼塘的图书角开张了

鱼塘边上要开一个**图书角**，本喵当账房。塘里的猫把小鱼干换来的书放到架子上共享，规矩是三条：

1. 每件东西都要**登记在册**，谁借走了得记一笔；
2. 借还**看编号办事** —— 借出去的东西，当然不能再借一次；
3. 收摊的时候账要**存进小本本**，第二天开张再读回来，不然一晚上白记。

这一课**不教新本事**，而是把这一路学来的东西拼成一个真能用的东西：图纸、套图纸、各猫各样、独苗、会自己收尾的箱子、一排碗、随身小招式、小本本 —— 让它们各自站到自己的位置上。做完你会知道：**一个真程序，就是这么几块拼起来的。**

## 一、先画图纸：书和杂志各一套

```cpp
#include <iostream>
#include <memory>
#include <string>
#include <vector>
using namespace std;

class Item {
public:
    Item(int id, const string& name) : id(id), name(name) {}
    virtual ~Item() = default;
    virtual string kind() const { return "东西"; }
    virtual int keepDays() const { return 7; }

    int id;
    string name;
    bool out = false;
};

class Book : public Item {
public:
    Book(int id, const string& name) : Item(id, name) {}
    string kind() const override { return "书"; }
    int keepDays() const override { return 14; }
};

class Magazine : public Item {
public:
    Magazine(int id, const string& name) : Item(id, name) {}
    string kind() const override { return "杂志"; }
    int keepDays() const override { return 3; }
};

int main() {
    vector<unique_ptr<Item>> shelf;
    shelf.push_back(make_unique<Book>(1, "鱼干小百科"));
    shelf.push_back(make_unique<Magazine>(2, "猫粮月报"));
    shelf.push_back(make_unique<Book>(3, "大肥鱼自传"));

    for (const auto& it : shelf) {
        cout << it->id << " " << it->name << "（" << it->kind() << "，可借 " << it->keepDays() << " 天）" << endl;
    }
    return 0;
}
```

```text
1 鱼干小百科（书，可借 14 天）
2 猫粮月报（杂志，可借 3 天）
3 大肥鱼自传（书，可借 14 天）
```

三张图纸各管一摊：

- 底图纸 `Item` 写着「**每件东西都该有的样子**」：编号 `id`、名字 `name`、借出去没有 `out`，还有两句**各猫各样**的话 —— `kind()`（这是哪一种东西）和 `keepDays()`（能借几天）。底图纸先给了个兜底的说法（「东西」「7 天」），岔路想改就改。
- 两张岔路图纸 `Book`（「书」「14 天」）和 `Magazine`（「杂志」「3 天」）。写法就是上一课的**图纸套图纸**。
- 架子是一排碗 `vector<unique_ptr<Item>>`：碗里放的是**会自己收尾的箱子**装着的真猫 —— 第六课、第七课那套本事在这儿派上了用场，架子不用操心谁什么时候该被收拾。

架子**不认识**碗里具体是哪一种东西，只知道「都能问它 `kind()` 和 `keepDays()`」。所以第二行那句「杂志，可借 3 天」，是**走到那只猫面前才念出来的**。

起手式那两处新写法要认一下：

- `Item(int id, const string& name) : id(id), name(name) {}` —— 冒号后面那一截是「**出生的时候顺手把这两样填上**」：冒号前面是图纸上那个碗，括号里是投喂口递进来的那一样。
- `Book(int id, const string& name) : Item(id, name) {}` —— 岔路的起手式要**先把这几样转交给底图纸**。因为底图纸自己写了一个起手式，兜底那个就没了；岔路得说清楚「底图纸那一半拿什么填」。

漏了转交的那一截会怎样？本喵试给你看：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Item {
public:
    Item(int id, const string& name) : id(id), name(name) {}
    int id;
    string name;
};

class Book : public Item {
public:
    Book(int id) {}
};

int main() {
    Book b(1);
    cout << b.id << endl;
    return 0;
}
```

翻译官喵当场拦下：

```text
main.cpp: In constructor 'Book::Book(int)':
main.cpp:14:18: error: no matching function for call to 'Item::Item()'
```

念作「**你要造一只 Book，可它底图纸那一半本喵不知道该拿什么填**」。看到它，回头看看岔路起手式后面那一截 `: Item(...)` 是不是漏了。

## 二、借出去、还回来：一条命令一行

```cpp
#include <algorithm>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
using namespace std;

class Item {
public:
    Item(int id, const string& name) : id(id), name(name) {}
    virtual ~Item() = default;
    virtual string kind() const { return "东西"; }
    virtual int keepDays() const { return 7; }

    int id;
    string name;
    bool out = false;
};

class Book : public Item {
public:
    Book(int id, const string& name) : Item(id, name) {}
    string kind() const override { return "书"; }
    int keepDays() const override { return 14; }
};

class Magazine : public Item {
public:
    Magazine(int id, const string& name) : Item(id, name) {}
    string kind() const override { return "杂志"; }
    int keepDays() const override { return 3; }
};

class Library {
public:
    static Library& getInstance() {
        static Library only;
        return only;
    }

    void add(unique_ptr<Item> it) { shelf.push_back(move(it)); }

    bool borrow(int id) {
        Item* it = find(id);
        if (!it || it->out) return false;
        it->out = true;
        return true;
    }

    bool giveBack(int id) {
        Item* it = find(id);
        if (!it || !it->out) return false;
        it->out = false;
        return true;
    }

    int outCount() const {
        return count_if(shelf.begin(), shelf.end(), [](const unique_ptr<Item>& p) { return p->out; });
    }

    void list() const {
        for (const auto& it : shelf) {
            cout << it->id << " " << it->name << "（" << it->kind() << "，可借 " << it->keepDays() << " 天）"
                 << (it->out ? " 借出" : " 在架") << endl;
        }
    }

private:
    Item* find(int id) {
        for (auto& it : shelf) if (it->id == id) return it.get();
        return nullptr;
    }

    Library() = default;
    vector<unique_ptr<Item>> shelf;
};

int main() {
    Library& lib = Library::getInstance();
    lib.add(make_unique<Book>(1, "鱼干小百科"));
    lib.add(make_unique<Magazine>(2, "猫粮月报"));
    lib.add(make_unique<Book>(3, "大肥鱼自传"));

    vector<string> keys = {"list", "borrow 2", "borrow 2", "back 2", "borrow 9", "out", "list"};
    for (const string& line : keys) {
        istringstream ss(line);
        string cmd;
        ss >> cmd;
        if (cmd == "list") {
            lib.list();
        } else if (cmd == "borrow" || cmd == "back") {
            int id = 0;
            ss >> id;
            bool ok = (cmd == "borrow") ? lib.borrow(id) : lib.giveBack(id);
            cout << (ok ? "办好了" : "办不了") << " " << id << endl;
        } else if (cmd == "out") {
            cout << "借出去 " << lib.outCount() << " 件" << endl;
        }
    }
    return 0;
}
```

```text
1 鱼干小百科（书，可借 14 天） 在架
2 猫粮月报（杂志，可借 3 天） 在架
3 大肥鱼自传（书，可借 14 天） 在架
办好了 2
办不了 2
办好了 2
办不了 9
借出去 0 件
1 鱼干小百科（书，可借 14 天） 在架
2 猫粮月报（杂志，可借 3 天） 在架
3 大肥鱼自传（书，可借 14 天） 在架
```

- 图书角做成了**独苗**（上一课那手）：全塘只有一间，`Library::getInstance()` 喊来的永远是同一间，起手式藏在 `private:` 底下。
- 主猫的活是「**一条命令一行**」：要办的事写在一小串命令里（`vector<string> keys`），一格一条，挨着办过去。命令一共四种：`list` 看架子、`borrow 编号` 借、`back 编号` 还、`out` 数一数借出去几件。
- 每收到一条命令，先用 `istringstream` 把它**拆成两截**：头一截是干什么（`list` / `borrow` / `back` / `out`），第二截是编号。拆完再看头一截挑一支走。
- 借还的规矩写在 `borrow` 和 `giveBack` 里：先按编号**挨个碗看一遍**（`find`），找不到就回「办不了」；找到了再看 `out` —— 已经借出去的不能再借，没借出去的也「还」不了。
- `outCount` 用了第五课那手 `count_if`：挨个问一句「这一件借出去了吗」，算的就把手里的数加一，最后叼回来「一共几件」。
- 对着答复看这几行：`borrow 2` 头一次「办好了 2」，紧接着又一次「办不了 2」（已经借出去了），`back 2` 又「办好了 2」。**这三行就是规矩在说话。** 最后 `list` 里那一排「在架」，是因为还回来了。

::: tip 猫咪提示
**真坐在键盘前面的时候，只换两行。** 把

`vector<string> keys = {"list", "borrow 2", ...};`

和

`for (const string& line : keys) {`

换成

`string line;`

和

`while (getline(cin, line)) {`

**圈里剩下的字一个都不用动** —— 主人敲一行、本喵办一件，一行就是一条命令（`getline` 一次叼回一整行，正是上一阶段那一手）。敲完了收摊（`Ctrl+D`，Windows 上是 `Ctrl+Z` 再回车），本喵走出圈，程序收工。
:::

::: warn 小心喵
`find` 交回来的是**那只猫的坐标**（`Item*`），不是复印的一份 —— 所以 `borrow` 里改的 `it->out = true;` 改的是**架子上那件真东西**。要是贪省事把 `find` 写成交回一只 `Item`（少写那个 `*`），借出去这件事只会发生在**复印的那一份**身上，架子上那件还是「在架」—— 程序不报错，账永远对不上。
:::

## 三、存进小本本、下次读回来

```cpp
#include <algorithm>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
using namespace std;

class Item {
public:
    Item(int id, const string& name) : id(id), name(name) {}
    virtual ~Item() = default;
    virtual string kind() const { return "东西"; }
    virtual int keepDays() const { return 7; }

    int id;
    string name;
    bool out = false;
};

class Book : public Item {
public:
    Book(int id, const string& name) : Item(id, name) {}
    string kind() const override { return "书"; }
    int keepDays() const override { return 14; }
};

class Magazine : public Item {
public:
    Magazine(int id, const string& name) : Item(id, name) {}
    string kind() const override { return "杂志"; }
    int keepDays() const override { return 3; }
};

class Library {
public:
    static Library& getInstance() {
        static Library only;
        return only;
    }

    void add(unique_ptr<Item> it) { shelf.push_back(move(it)); }

    bool borrow(int id) {
        Item* it = find(id);
        if (!it || it->out) return false;
        it->out = true;
        return true;
    }

    bool giveBack(int id) {
        Item* it = find(id);
        if (!it || !it->out) return false;
        it->out = false;
        return true;
    }

    int outCount() const {
        return count_if(shelf.begin(), shelf.end(), [](const unique_ptr<Item>& p) { return p->out; });
    }

    void save(const string& path) const {
        ofstream outFile(path);
        for (const auto& it : shelf) outFile << it->id << " " << it->kind() << " " << it->name << " " << it->out << endl;
    }

    bool load(const string& path) {
        ifstream inFile(path);
        if (!inFile) return false;
        shelf.clear();
        int id = 0;
        bool out = false;
        string kind, name;
        while (inFile >> id >> kind >> name >> out) {
            unique_ptr<Item> it;
            if (kind == "杂志") it = make_unique<Magazine>(id, name);
            else it = make_unique<Book>(id, name);
            it->out = out;
            shelf.push_back(move(it));
        }
        return true;
    }

    void list() const {
        for (const auto& it : shelf) {
            cout << it->id << " " << it->name << "（" << it->kind() << "，可借 " << it->keepDays() << " 天）"
                 << (it->out ? " 借出" : " 在架") << endl;
        }
    }

private:
    Item* find(int id) {
        for (auto& it : shelf) if (it->id == id) return it.get();
        return nullptr;
    }

    Library() = default;
    vector<unique_ptr<Item>> shelf;
};

int main() {
    Library& lib = Library::getInstance();
    lib.add(make_unique<Book>(1, "鱼干小百科"));
    lib.add(make_unique<Magazine>(2, "猫粮月报"));
    lib.add(make_unique<Book>(3, "大肥鱼自传"));

    vector<string> keys = {"list", "borrow 2", "save books.txt", "back 2", "list", "load books.txt", "list", "out"};
    for (const string& line : keys) {
        istringstream ss(line);
        string cmd;
        ss >> cmd;
        if (cmd == "list") {
            lib.list();
        } else if (cmd == "borrow" || cmd == "back") {
            int id = 0;
            ss >> id;
            bool ok = (cmd == "borrow") ? lib.borrow(id) : lib.giveBack(id);
            cout << (ok ? "办好了" : "办不了") << " " << id << endl;
        } else if (cmd == "save" || cmd == "load") {
            string path;
            ss >> path;
            if (cmd == "save") {
                lib.save(path);
                cout << "存好了" << endl;
            } else {
                cout << (lib.load(path) ? "读回来了" : "没有这个小本本") << endl;
            }
        } else if (cmd == "out") {
            cout << "借出去 " << lib.outCount() << " 件" << endl;
        }
    }
    return 0;
}
```

```text
1 鱼干小百科（书，可借 14 天） 在架
2 猫粮月报（杂志，可借 3 天） 在架
3 大肥鱼自传（书，可借 14 天） 在架
办好了 2
存好了
办好了 2
1 鱼干小百科（书，可借 14 天） 在架
2 猫粮月报（杂志，可借 3 天） 在架
3 大肥鱼自传（书，可借 14 天） 在架
读回来了
1 鱼干小百科（书，可借 14 天） 在架
2 猫粮月报（杂志，可借 3 天） 借出
3 大肥鱼自传（书，可借 14 天） 在架
借出去 1 件
```

- `save` 把每件东西写成**一行**：编号、是哪一种、名字、借出去没有 —— 四样，空格隔开。用的就是第十一课那套小本本本事。
- `load` 反过来：**一行一行**读，四样都读齐了才收一件。动手之前先看看小本本在不在（`if (!inFile) return false;`）—— 不然第二天开张会拿到一本空账。
- 读回来的时候要**看名字接生**（上一课那手）：小本本上写着「杂志」就用杂志那张图纸接生，写着「书」就用书那张。
- 那两行 `list` 对着看最有意思：`back 2` 之后架子上明明是「在架」，**读回来之后又变回「借出」**。因为小本本记的是**存下去那一刻**的样子 —— 「存」和「读」管的就是「程序关掉之后还剩下什么」。

::: warn 小心喵
**存的时候写几样，读的时候就得读几样。** 本喵试过把 `save` 最后那一栏（借出去没有）省掉：程序**不报错**，`load` 还照样回一句「读回来了」，可架子上**一件都不剩** —— 少一栏，读的那一步就永远凑不齐四样，读到一半卡住，前面读到的也不算数了。屏幕上只剩空空的架子，一个字都不印。**两边对不上的约定，是最不容易看出来的坑。**
:::

## 四、这一路的本事，各自站在哪儿

| 图书角里的东西 | 用的是哪一手的本事 |
|---|---|
| 底图纸 `Item`、两张岔路图纸 | 图纸与**图纸套图纸** |
| `kind()` 走到谁面前念谁那句 | **各猫各样** |
| 全塘只有一间图书角 | **独苗**（起手式藏起来） |
| 架子 `vector<unique_ptr<Item>>` | **会自己收尾的箱子** + 一排碗 |
| `count_if` 数一数借出去几件 | 挨个过一遍 |
| `borrow` 里那句 `it->out` | 看鱼干眼色行事 |
| `for (const string& line : keys)` 一条命令一行 | 绕鱼干跑圈 |
| `make_unique<Book>(1, "鱼干小百科")` | 投喂的小鱼干 |
| `save` / `load` 小本本 | 小本本（文件流） |
| `load` 里那句「看名字接生」 | 上一课的**接生图纸** |

⚠️ 一句老实话：真写起来，**花时间的往往不是这几块，而是它们之间的接缝** —— 比如「存四栏、读四栏」这种两处必须对齐的约定，比如「改的到底是架子那件、还是它的复印」。这种地方不会报错，只会在某天突然对不上账。写的时候在旁边留一行字记下来，能省下半夜的抓虫。

## 一句话对照表

| 想干什么 | 怎么写 |
|---|---|
| 每件东西都该有什么 | 底图纸里写 `id` / `name` / `out` |
| 让岔路说自己的话 | `string kind() const override { return "杂志"; }` |
| 出生时把底图纸那一半填上 | `Book(int id, const string& name) : Item(id, name) {}` |
| 全塘只留一间 | `static Library& getInstance()` |
| 按编号找一件 | `for (auto& it : shelf) if (it->id == id) return it.get();` |
| 数一数借出去几件 | `count_if(shelf.begin(), shelf.end(), [](const unique_ptr<Item>& p) { return p->out; })` |
| 一行写一件 | `outFile << it->id << " " << it->kind() << " " << it->name << " " << it->out << endl;` |
| 一行一行读回来 | `while (inFile >> id >> kind >> name >> out)` |
| 读回来时看名字接生 | `if (kind == "杂志") it = make_unique<Magazine>(id, name);` |

## 小任务

1. 给图书角添一种「地图」（可借 `30` 天）：底图纸一个字都不用动，添一张岔路图纸、再在 `load` 里添一条岔路就行。
2. 把底图纸那个兜底的 `7` 天改成 `10` 天，跑一遍看看哪些东西会跟着变 —— 哪些不会变，为什么？
3. 给主猫添一条命令 `find 编号`：找到了印它的名字，找不到印「没有这一件」。
4. 故意把 `save` 最后那一栏去掉，再 `load` 一遍，看看架子上还剩几件（**这一条就是个坑**，试完记得改回来）。

从「给小鱼干排排坐」到「开一间图书角」，本喵这一路把 C++ 的家当用得差不多了喵。后面还有几节底子课：位运算、多继承、调试工具、多文件工程 —— 把这几块补齐，这条线才走得圆。歇口气，接着来喵～ 🐾
