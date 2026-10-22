---
id: cpp-stage2-15
lang: cpp
stage: 2
order: 15
title: 综合项目：银行账户系统
tags: [综合项目, 图纸套图纸, 一声开饭各猫各样, 软垫]
required: ["cpp-stage2-14"]
crossRefs: []
estMinutes: 38
keywords: [class, inheritance, virtual, exception]
---

## 钩子：鱼干银行开张

托儿所隔壁又开了一家店 —— **猫窝鱼干银行**。主人吃不完的鱼干存进来，要用的时候来取；本喵当柜员，管一本账。

这家银行有**两种账户**：

- **普通账户**：余额花完就没了，再多取就是「余额不够喵」；
- **信用账户**：能**透支**到一个额度 —— 余额见底了还能往外取，把额度也用光才算不够。

难处跟第 14 课一模一样：**一本名册要装两种账户**。本喵要在名册上挨着喊一句「取钱」，普通账户按普通账户的规矩应，信用账户按信用账户的规矩应 —— 第 10 课那一手「一声开饭，各猫各样」，今天要把它用在一门真生意上。

还有第二件麻烦：**取多了会翻车**。翻车不算错，谁都会遇上；要命的是程序**当场就没了**。第一章学过的那块**软垫**，今天该铺上场了。

## 一、先把「一本账」想清楚

开银行的第一步，还是老规矩：**先把一样东西想清楚，再动手画**。一本账身上有什么？

- 两格家底：**卡号** `id`（一串小鱼干的项链）、**余额** `balance`（整数，几条鱼干）；
- 两手活：**存钱** `save(...)`、外加两扇**小窗** `getId()` / `getBalance()` 给外面看。

```cpp
#include <iostream>
#include <string>
using namespace std;

class Account {
protected:
    string id;
    int balance;
public:
    Account(string i, int b) : id(i), balance(b) {}

    string getId() { return id; }
    int getBalance() { return balance; }

    void save(int amount) {
        balance = balance + amount;
        cout << id << " 存进 " << amount << " 条，现在 " << balance << " 条" << endl;
    }
};

int main() {
    Account a("A1", 50);
    cout << a.getId() << " 开户，余额 " << a.getBalance() << " 条" << endl;
    a.save(30);
    return 0;
}
```

```text
A1 开户，余额 50 条
A1 存进 30 条，现在 80 条
```

这一段里没有新东西，全是从前面十几课攒下来的：

- **两格家底挂在 `protected:` 下面**（第 04、09 课）—— 这张图纸自己够得着，**照着它画下来的新图纸也够得着**，外面（`main`）够不着。第二节那张储蓄账户的图纸要用到 `balance`，全靠这一小段。
- **出生那一手把料喂进两格**：`Account(string i, int b) : id(i), balance(b) {}`（第 02 课）。
- **存钱就是把旧的余额加上新的一笔，再写回那一格**：`balance = balance + amount;`（第 03 课的 `this`、第 07 课的运算，都是老熟人）。
- **两扇小窗是留给外面的**：`getId()` / `getBalance()`。柜台上要念卡号、报账要念余额，都走这两扇窗 —— 余额那一格**不是谁都能伸手改的**，外面想动它，只能走 `save` 那一手（第 04 课那个「带盖的小鱼干盒」说的就是这个）。

真跑出来就是上面那两行喵 —— 第一行念卡号和余额，第二行是存进去 30 条之后的样子。

## 二、两种账户：图纸套图纸，各加一格

储蓄账户跟普通账户**几乎一模一样**，只多一样东西：它会长利息。本喵当然不会把那两格家底、那两手活再抄一遍 —— **照着老图纸画一张新的就行**：

```cpp
#include <iostream>
#include <string>
using namespace std;

class Account {
protected:
    string id;
    int balance;
public:
    Account(string i, int b) : id(i), balance(b) {}

    string getId() { return id; }
    int getBalance() { return balance; }

    void save(int amount) {
        balance = balance + amount;
        cout << id << " 存进 " << amount << " 条，现在 " << balance << " 条" << endl;
    }
};

class SavingsAccount : public Account {
protected:
    int rate;
public:
    SavingsAccount(string i, int b, int r) : Account(i, b), rate(r) {}

    int interest() {
        return balance * rate / 100;
    }

    void showInterest() {
        cout << id << " 的利息是 " << interest() << " 条" << endl;
    }
};

int main() {
    SavingsAccount s("S1", 80, 5);
    s.save(20);
    s.showInterest();
    return 0;
}
```

```text
S1 存进 20 条，现在 100 条
S1 的利息是 5 条
```

看这一张图纸：**它自己只写了一格 `rate`（利率）和两手活**（`interest()` 算利息、`showInterest()` 念出来），别的一个字都没重抄。

- **`class SavingsAccount : public Account`** —— 念作「照着 `Account` 画下来」（第 09 课）。老图纸上的两格和两手，它自动就有。
- **第一行那句「S1 存进 20 条，现在 100 条」是老图纸那一手印的** —— 新图纸上连 `save` 都没写，喊了照样管用喵。
- **新图纸自己多出来的一格 `rate`**，还有一手 `interest()`：`balance * rate / 100`。余额 100、利率 5，就是 `100 * 5 / 100 = 5` 条喵（两个整数相除，除不尽的小数点后面会被切掉 —— 柜台算利息够用了）。
- **出生那一手得分两步**：先把名字和余额**递回给老图纸那一手**，再管自己多出来的一格 —— `SavingsAccount(string i, int b, int r) : Account(i, b), rate(r) {}`。第 14 课摔过的那一跤（小猫出生时忘了递料）在这儿一样会摔。
- **`interest()` 里能直接喊 `balance`** —— 因为那一格挂在 `protected:` 下面，新图纸够得着。

## 三、一声「取钱」，各账户各样地应答

现在轮到这一课的重头戏：**信用账户**。它比储蓄账户麻烦一点 —— 多的一格不是「利息」，是**额度** `limit`；而且它要把「取钱」那一手**改写**成自己的规矩。

先给老图纸添上一手「取钱」`take`：余额不够的时候它**不打算硬撑**，而是扔一辆车上去（扔车和接车下一节细说，先记住它在那儿）；新图纸呢，把这一手**改写**掉：

```cpp
#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>
using namespace std;

class Account {
protected:
    string id;
    int balance;
public:
    Account(string i, int b) : id(i), balance(b) {}
    virtual ~Account() {}

    string getId() { return id; }
    int getBalance() { return balance; }

    void save(int amount) {
        balance = balance + amount;
        cout << id << " 存进 " << amount << " 条，现在 " << balance << " 条" << endl;
    }

    virtual void take(int amount) {
        if (amount > balance) {
            throw runtime_error("余额不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条，现在 " << balance << " 条" << endl;
    }
};

class CreditAccount : public Account {
protected:
    int limit;
public:
    CreditAccount(string i, int b, int l) : Account(i, b), limit(l) {}

    void take(int amount) override {
        if (amount > balance + limit) {
            throw runtime_error("额度也不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条（能透支），现在 " << balance << " 条" << endl;
    }
};

int main() {
    vector<Account*> roster;
    roster.push_back(new Account("A1", 50));
    roster.push_back(new CreditAccount("C1", 10, 100));

    for (Account* p : roster) {
        p->take(30);
    }

    for (Account* p : roster) {
        cout << p->getId() << " 还剩 " << p->getBalance() << " 条" << endl;
        delete p;
    }
    return 0;
}
```

```text
A1 取走 30 条，现在 20 条
C1 取走 30 条（能透支），现在 -20 条
A1 还剩 20 条
C1 还剩 -20 条
```

这几行的分量全在**顺序和差别**上：

- **本喵只喊了一句「取钱」**（`p->take(30)`），两只账户应的话却不一样：普通账户印的是「取走 30 条」，信用账户印的是「取走 30 条**（能透支）**」。这就是「一声开饭，各猫各样」—— 牌子后面站的是谁，就跑谁那一版（第 10 课）。
- **`balance` 是 -20，那不是错，是透支**。信用账户那一手的判据跟老图纸不一样：老图纸是「取的钱比余额多就不干」，新图纸是「取的钱比**余额 + 额度**多才不干」。同一个门面，两套规矩。
- **老图纸那一手开头挂了 `virtual`**（`virtual void take(int amount)`）—— 「这一手别急着定死，等真跑起来再看手里到底是哪只猫」（第 10 课）。**只有老图纸那一手需要挂**；新图纸改写的那一份自动也是「看屋里住的是谁」的。
- **新图纸那一手挂着 `override`** —— 「本喵就是要改写老图纸那一手」。名字写错、料对不上，翻译官喵当场拦下（下一节摔法一就是这个）。
- **名册里装的是牌子，不是真猫**：`vector<Account*> roster;`。碗里要是装真猫（`vector<Account> roster`），信用账户放进去的时候会被**复印成老图纸的样子** —— 透支那一手当场没了（第 08 课那个「复印」的坑）。所以：真猫生在外面（`new Account("A1", 50)`），**牌子**插进碗里。
- **顺着牌子喊**：`p->take(30)` —— `p` 是牌子，`->` 是「顺着牌子去找那只猫」。
- **收尾的时候顺着牌子还**：`delete p;`。老图纸的收尾招式挂了 `virtual ~Account() {}` —— 拆屋子的时候**从新图纸那一半一路拆到老图纸那一半**（第 10、11 课）。漏挂 `virtual` 的那一跤，第 10 课已经摔给主人看过了。
- ⚠️ 这一节两只账户**都办成了**，所以没有一辆车被扔出来。可 `take` 那一手明明会扔车 —— 软垫还没铺呢，下一节就干这事。

## 四、取多了怎么办：铺软垫

柜台真开起来，取多了是天天有的事。本喵要取 80 条：普通账户里只有 50 —— 这时候 `take` 那一手扔出一辆车，车上贴着说明「余额不够喵」。

车扔出来得有人接。**软垫铺在真会翻的那几句周围**（第一章第 13 课）：

```cpp
#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>
using namespace std;

class Account {
protected:
    string id;
    int balance;
public:
    Account(string i, int b) : id(i), balance(b) {}
    virtual ~Account() {}

    string getId() { return id; }
    int getBalance() { return balance; }

    void save(int amount) {
        balance = balance + amount;
        cout << id << " 存进 " << amount << " 条，现在 " << balance << " 条" << endl;
    }

    virtual void take(int amount) {
        if (amount > balance) {
            throw runtime_error("余额不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条，现在 " << balance << " 条" << endl;
    }
};

class CreditAccount : public Account {
protected:
    int limit;
public:
    CreditAccount(string i, int b, int l) : Account(i, b), limit(l) {}

    void take(int amount) override {
        if (amount > balance + limit) {
            throw runtime_error("额度也不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条（能透支），现在 " << balance << " 条" << endl;
    }
};

int main() {
    vector<Account*> roster;
    roster.push_back(new Account("A1", 50));
    roster.push_back(new CreditAccount("C1", 10, 100));

    for (Account* p : roster) {
        try {
            p->take(80);
        } catch (const runtime_error& e) {
            cout << p->getId() << " 这一笔没办成：" << e.what() << endl;
        }
    }

    for (Account* p : roster) {
        cout << p->getId() << " 还剩 " << p->getBalance() << " 条" << endl;
        delete p;
    }
    return 0;
}
```

```text
A1 这一笔没办成：余额不够喵
C1 取走 80 条（能透支），现在 -70 条
A1 还剩 50 条
C1 还剩 -70 条
```

四行，一行都不多不少：

- **第一行是接住的车**：`catch (const runtime_error& e)` 接住了 `take` 扔出来的那一辆，`e.what()` 印出车上的说明 —— 「余额不够喵」（第一章学的两手，今天用上了）。
- **第二行是信用账户办成了**：它有 10 条余额加 100 的额度，取 80 够，取完余额 -70（透支）。
- **第三、四行是本喵后来报账**：普通账户的 50 条**一分没动**（那一笔根本没办成），信用账户成了 -70。
- **软垫是每一笔一块**：`try` 就套在 `p->take(80)` 那一句外面，在走名册的圈**里面**。所以普通账户翻了车，信用账户那笔**照样办**。
- **扔车的和接车的不用是同一层**（第一章那句）：`take` 那一手只管「这事不行，本喵扔上去」，接它的活儿是本喵这台机器（喊它的那位）干的。
- **那个 `if` 的判据要写准**：`amount > balance` 是普通账户的规矩，`amount > balance + limit` 是信用账户的。判据写错，程序照样跑得欢，只是**答案悄悄错了**（下一节的摔法二）。

## 五、把柜台立起来

柜台不能只办一笔。真坐在柜台后面，号码是**一个一个进来**的：`1` 是存钱（后面跟一个金额）、`2` 是取钱（后面跟一个金额）、`3` 是报账（不要金额）、`0` 是收工。所以读号码的那一圈写成 `while (cin >> cmd)` —— 号码进得来就办，进不来（或者读到 `0`）就收摊：

```cpp
#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>
using namespace std;

class Account {
protected:
    string id;
    int balance;
public:
    Account(string i, int b) : id(i), balance(b) {}
    virtual ~Account() {}

    string getId() { return id; }
    int getBalance() { return balance; }

    void save(int amount) {
        balance = balance + amount;
        cout << id << " 存进 " << amount << " 条，现在 " << balance << " 条" << endl;
    }

    virtual void take(int amount) {
        if (amount > balance) {
            throw runtime_error("余额不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条，现在 " << balance << " 条" << endl;
    }
};

class CreditAccount : public Account {
protected:
    int limit;
public:
    CreditAccount(string i, int b, int l) : Account(i, b), limit(l) {}

    void take(int amount) override {
        if (amount > balance + limit) {
            throw runtime_error("额度也不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条（能透支），现在 " << balance << " 条" << endl;
    }
};

int main() {
    vector<Account*> roster;
    roster.push_back(new Account("A1", 50));
    roster.push_back(new CreditAccount("C1", 10, 100));

    cout << "鱼干银行开张喵。1 存钱 / 2 取钱 / 3 报账 / 0 收工" << endl;

    int cmd = -1;
    while (cin >> cmd) {
        if (cmd == 0) {
            cout << "收工喵" << endl;
            break;
        }

        int amount = 0;
        if (cmd == 1 || cmd == 2) {
            cin >> amount;
        }

        for (Account* p : roster) {
            try {
                if (cmd == 1) {
                    p->save(amount);
                } else if (cmd == 2) {
                    p->take(amount);
                } else {
                    cout << p->getId() << " 还有 " << p->getBalance() << " 条" << endl;
                }
            } catch (const runtime_error& e) {
                cout << p->getId() << " 这一笔没办成：" << e.what() << endl;
            }
        }
    }

    for (Account* p : roster) {
        delete p;
    }
    return 0;
}
```

```text
鱼干银行开张喵。1 存钱 / 2 取钱 / 3 报账 / 0 收工
```

这一行就是**没有号码喂进来**的时候屏幕上全部的东西：练习场里点「运行」，投喂口是空的，`cin >> cmd` 第一次就失败了，那个圈**一圈都没走**，程序直接走到收尾。

本喵在真柜台前喂了这一串号码进去（一行一个）：`3`、`1`、`20`、`2`、`80`、`0` —— 屏幕上从头到尾是这样：

```text
鱼干银行开张喵。1 存钱 / 2 取钱 / 3 报账 / 0 收工
A1 还有 50 条
C1 还有 10 条
A1 存进 20 条，现在 70 条
C1 存进 20 条，现在 30 条
A1 这一笔没办成：余额不够喵
C1 取走 80 条（能透支），现在 -50 条
收工喵
```

一行一行对：

- **先报账（`3`）**：两只账户的卡号和余额各印一行。
- **再存钱（`1` 后面跟 `20`）**：两只账户各存 20 条。存钱**从不翻车**，所以这两行稳稳当当。
- **再取钱（`2` 后面跟 `80`）**：普通账户余额 70 不够，扔车、被接住，印一句「这一笔没办成」；信用账户余额 30 加额度 100 够，取完 -50。**同一句「取钱」，两条命**。
- **最后 `0` 收工**：印「收工喵」，紧接着那个 `break;` **跳出走号码的圈**（第 14 课那一跤），后面的号码一个都不再走。
- **报账和收工不要金额**，所以 `cin >> amount;` 前面有那道门：`if (cmd == 1 || cmd == 2)`。要是不加这道门，程序**不会读空** —— 它会**把下一个号码当成金额吃掉**，号码一错位，后面的活全乱套。真跑的样子见下一段。

本喵拿一个**只有柜台、没有账户**的最小版本试过这道门：喂 `1 20 3 0` 进去，屏幕上只剩两行：

```text
办一笔 1：20 条
办一笔 3：0 条
```

看着跟对的版本**一模一样**，来路却正相反：对的那版里，报账那笔的 `0` 是**那一圈当场生出来的 `amount`**（压根没去读）；拆了门这版里，那个 `0` 是**把收工的号码吃进来**当成了金额。代价是收工的 `0` 已经没了 —— 圈里再没号码可走，**「收工喵」那一行永远不会印出来**。

## 六、四种摔法

### 摔法一：老图纸那一手漏挂了 `virtual`（新图纸还挂着 `override`）

本喵手一滑，把老图纸上 `take` 开头的 `virtual` 摘了，新图纸那一手却还老老实实挂着 `override`：

```cpp
#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>
using namespace std;

class Account {
protected:
    string id;
    int balance;
public:
    Account(string i, int b) : id(i), balance(b) {}
    virtual ~Account() {}

    string getId() { return id; }
    int getBalance() { return balance; }

    void save(int amount) {
        balance = balance + amount;
        cout << id << " 存进 " << amount << " 条，现在 " << balance << " 条" << endl;
    }

    void take(int amount) {
        if (amount > balance) {
            throw runtime_error("余额不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条，现在 " << balance << " 条" << endl;
    }
};

class CreditAccount : public Account {
protected:
    int limit;
public:
    CreditAccount(string i, int b, int l) : Account(i, b), limit(l) {}

    void take(int amount) override {
        if (amount > balance + limit) {
            throw runtime_error("额度也不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条（能透支），现在 " << balance << " 条" << endl;
    }
};

int main() {
    vector<Account*> roster;
    roster.push_back(new Account("A1", 50));
    roster.push_back(new CreditAccount("C1", 10, 100));

    for (Account* p : roster) {
        p->take(30);
    }

    for (Account* p : roster) {
        delete p;
    }
    return 0;
}
```

```text
main.cpp:38:10: error: 'void CreditAccount::take(int)' marked 'override', but does not override
```

翻译官喵**一个字都不多费**：老图纸那一手没挂招牌，新图纸却在本喵面前说「本喵要改写它」—— 那儿压根没有可以改写的，当场拦下。

这一跤算是**最好的一种**：还没跑起来就被人拦住了。（上面那行原话是本喵这台机器吐出来的；你自己机器上的行号八成不一样，措辞是一样的。）

### 摔法二：漏挂 `virtual`，连 `override` 也一并摘了

同一个手滑，这回本喵把新图纸那两个字也删了 —— 翻译官喵就**没什么可拦的了**：

```cpp
#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>
using namespace std;

class Account {
protected:
    string id;
    int balance;
public:
    Account(string i, int b) : id(i), balance(b) {}
    virtual ~Account() {}

    string getId() { return id; }
    int getBalance() { return balance; }

    void save(int amount) {
        balance = balance + amount;
        cout << id << " 存进 " << amount << " 条，现在 " << balance << " 条" << endl;
    }

    void take(int amount) {
        if (amount > balance) {
            throw runtime_error("余额不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条，现在 " << balance << " 条" << endl;
    }
};

class CreditAccount : public Account {
protected:
    int limit;
public:
    CreditAccount(string i, int b, int l) : Account(i, b), limit(l) {}

    void take(int amount) {
        if (amount > balance + limit) {
            throw runtime_error("额度也不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条（能透支），现在 " << balance << " 条" << endl;
    }
};

int main() {
    vector<Account*> roster;
    roster.push_back(new Account("A1", 50));
    roster.push_back(new CreditAccount("C1", 10, 100));

    for (Account* p : roster) {
        try {
            p->take(80);
        } catch (const runtime_error& e) {
            cout << p->getId() << " 这一笔没办成：" << e.what() << endl;
        }
    }

    for (Account* p : roster) {
        delete p;
    }
    return 0;
}
```

```text
A1 这一笔没办成：余额不够喵
C1 这一笔没办成：余额不够喵
```

对比第四节该有的那四行：**信用账户明明有 100 的额度，却按老图纸的规矩给打回来了**（那一笔该办成、该透支成 -70）。

- 编得过、跑得完、**一句抱怨都没有**。屏幕上两行都像模像样，只有你心里知道第二行是错的。
- 根子在于：老图纸那一手没挂招牌，本喵顺着牌子喊「取钱」，程序就**只认牌子上写的那个名字**，不看牌子后面站的是谁（第 10 课）。
- 想抓住它，只能靠「**拿该有的答案来对**」—— 这正是本喵要反向验证每一道题的原因。

### 摔法三：没铺软垫（程序当场停）

把第四节那段里的 `try` 和 `catch` 整块拆掉，直接喊一句：

```text
for (Account* p : roster) {
    p->take(80);
}
```

本喵真跑过：屏幕上最后两行是

`terminate called after throwing an instance of 'std::runtime_error'`
`  what():  余额不够喵`

程序**当场就没了** —— 后面收尾那些 `delete` 一句都没跑到，更别说接着办下一笔。

- **车扔出来没人接，程序就停**。不是「印一句错话接着跑」，是整台机器没了。
- 所以规矩很简单：**只要有一段活会扔车，上面就得有人接着** —— 要么是本喵这台机器（这一课的写法），要么是更外面那一层。
- 顺带说一句：接车的牌子写错（比如信用账户扔的是 `runtime_error`，本喵却写 `catch (const string& e)`），**一样接不住**，屏幕上还是这两行（第一章那种「牌子对不上，车从手边过去」的翻车）。

### 摔法四：软垫铺得太外面

第四节的软垫是**一笔一块**（套在圈里面）。本喵偷懒，把它挪到了整个圈子外面：

```cpp
#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>
using namespace std;

class Account {
protected:
    string id;
    int balance;
public:
    Account(string i, int b) : id(i), balance(b) {}
    virtual ~Account() {}

    string getId() { return id; }
    int getBalance() { return balance; }

    void save(int amount) {
        balance = balance + amount;
        cout << id << " 存进 " << amount << " 条，现在 " << balance << " 条" << endl;
    }

    virtual void take(int amount) {
        if (amount > balance) {
            throw runtime_error("余额不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条，现在 " << balance << " 条" << endl;
    }
};

class CreditAccount : public Account {
protected:
    int limit;
public:
    CreditAccount(string i, int b, int l) : Account(i, b), limit(l) {}

    void take(int amount) override {
        if (amount > balance + limit) {
            throw runtime_error("额度也不够喵");
        }
        balance = balance - amount;
        cout << id << " 取走 " << amount << " 条（能透支），现在 " << balance << " 条" << endl;
    }
};

int main() {
    vector<Account*> roster;
    roster.push_back(new Account("A1", 50));
    roster.push_back(new CreditAccount("C1", 10, 100));

    try {
        for (Account* p : roster) {
            p->take(80);
        }
    } catch (const runtime_error& e) {
        cout << "有一笔没办成：" << e.what() << endl;
    }

    for (Account* p : roster) {
        delete p;
    }
    return 0;
}
```

```text
有一笔没办成：余额不够喵
```

第四节该印四行，这一版只剩**一行**：普通账户翻车那一下，车把**整个圈**一起带走了 —— 信用账户那一笔**根本没轮上办**。

- 软垫不是为了「让屏幕好看」，是为了**别把整段活一起带走**。铺得太外面，一翻车后面的全都不办了。
- 另一头也别铺太小：只套住半句话（比如只套 `amount > balance` 那一行判断），该接的车接不住。
- 本喵的规矩：**软垫铺在「真的会翻的那几句」周围** —— 这里就是「喊某一笔`take`」那一句，一笔一块。

## 一句话对照表

| 这一课拼起来的零件 | 念作 | 是第几课学的 |
|---|---|---|
| `class Account { ... };` | 画一张图纸 | 第 01 课 |
| `protected:` 那两格家底 | 家底只给照着画的图纸看 | 第 04、09 课 |
| `Account(string i, int b) : id(i), balance(b) {}` | 出生先把料喂进去 | 第 02 课 |
| `balance = balance + amount;` | 旧的加上新的一笔，再写回那一格 | 第 03、07 课 |
| `class CreditAccount : public Account` | 照着老图纸画一张新的 | 第 09 课 |
| `virtual void take(int amount)` | 老图纸那一手挂上「别急着定死」 | 第 10 课 |
| `void take(int amount) override` | 新图纸改写那一手 | 第 10 课 |
| `vector<Account*> roster;` | 一只会自己变长的碗，碗里装的是牌子 | 第 13、10 课 |
| `new Account("A1", 50)` / `delete p` | 真猫生在外面 / 顺着牌子还回去 | 第 10 课 |
| `virtual ~Account() {}` | 收尾招式也挂招牌：两半都拆 | 第 10、11 课 |
| `throw runtime_error("余额不够喵")` | 扔一辆带说明的车 | 第 13 课 |
| `try { ... } catch (const runtime_error& e)` | 铺软垫、接车、`e.what()` 看说明 | 第 13 课 |
| `while (cin >> cmd)` | 号码一个一个进来就办一个 | 第 14 课 |
| `break;` | 收工就跳出走号码的圈 | 第 14 课 |

::: tip 猫咪提示

- **一张图纸先想清楚**：新图纸只写自己多出来的那点东西，家底和别的活全照着老图纸拿 —— 一个字都不用重抄。
- **「别急着定死」那块招牌挂在老图纸那一手上**，新图纸上挂的是「本喵要改写它」；名字写错、料对不上，翻译官喵当场拦下。
- **名册里插的是牌子，不是真猫** —— 插真猫会被复印成老图纸的样子，改写的那一手当场就没了。
- **软垫铺在「真的会翻的那几句」周围，一笔一块**：铺得太外面，一翻车后面几笔全都不办了。
- **最阴的一跤是「编得过、跑得完、一句抱怨都没有」**：屏幕上两行都像模像样，只有拿该有的答案来对，才抓得住它。

:::

## 小任务

1. 给 `Account` 再添一格「主人」（一串小鱼干的项链，挂 `protected:`），让 `save` 印的时候把主人也念出来 —— **新图纸一个字都不用改**，跑一次验证一下。
2. 给柜台菜单加一支 `4`：报账的时候把「卡号和余额」印成一行。喂一次号码（`4` 然后 `0`），看看办不办得成。
3. 把信用账户的额度从 100 改成 30，再把第四节那段抄进练习场跑一次 —— 这次哪些账户翻车？屏幕上少了哪一行？
4. 把第四节里 `catch (const runtime_error& e)` 换成兜底那一块（`catch (...)`），跑一次 —— 输出一样吗？**「余额不够喵」那句说明还印得出来吗？**（想一想：兜底那一块手里根本没有车，`e.what()` 从哪儿来？）
5. 把第三节那段里 `virtual ~Account() {}` 那一行删掉，跑一次 —— 屏幕上的输出**一模一样**。那它到底管什么？（提示：第 10 课那个「只拆一半」。）
6. 留一问给你：第 14 课托儿所那台菜单，和这一课柜台这台菜单，长得越来越像了 —— 换一家店（比如说「鱼干租借店」），本喵是不是得把这一整套再抄一遍？下一章见分晓喵。

下一课翻开**第三章**：本喵先教你给一段活儿**数圈数** —— 同一件事，哪种写法更省力气，不再拍脑袋，拿数字说话。数完，就把手里这些家什收进一只**工具柜**：那儿的家伙什都是现成的，本喵不必什么都自己造了 —— 头一件就是**会自己往前走的牌子**（迭代器），还有一大柜子的容器和手法在等着喵。去吃鱼干喵～ 🐾
