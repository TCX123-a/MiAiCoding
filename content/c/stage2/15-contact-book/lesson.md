---
id: c-stage2-15
lang: c
stage: 2
order: 15
title: 综合项目：小鱼干通讯录管理系统
tags: [综合项目, 结构体]
required: ["c-stage2-14"]
crossRefs: []
estMinutes: 30
keywords: [struct, file persistence, menu, contact book]
---

## 钩子：本喵想给朋友们建个通讯录

本喵的朋友越来越多了，想给每只猫记两样东西 —— **名字**和**号码**。最朴素的办法是给每只猫配两只碗：

```c
#include <stdio.h>

int main(void) {
    char name[32] = "小橘";
    char phone[20] = "13800000001";
    printf("%s %s\n", name, phone);
    return 0;
}
```

```text
小橘 13800000001
```

两只碗能记一只猫。可本喵有十只朋友呢？二十只碗排一排，念名字的时候还得自己数着「第几只碗是哪只猫的」—— 太容易乱套了。

今天本喵要把这半学期学的东西**串成一件真作品**：把「一起走的几样东西」捆成一条记录，把记录排成一排，再存进册子、用菜单点着使 —— 一个真能用的**小鱼干通讯录**喵。

## 一、先定下「一条记录」长什么样

C 里有一个专门干这件事的家伙，叫**结构体**：它能把**几样一起走的东西捆成一条**，当成一样东西来搬：

```c
#define MAX 100

typedef struct {
    char name[32];
    char phone[20];
} Contact;
```

拆开念：

- **`struct { ... }`** 里面列的是这条记录**有哪几样**。本喵列了两样：`name`（一串字，最多 31 个字）和 `phone`（也是一串字）。
- **`Contact`** 是本喵给这条记录起的名字（contact 就是「联系人」）。起了名字它才好用。
- **`typedef`** 的意思是「以后本喵说 `Contact`，说的就是这条记录」—— 没有它，每回都得写一长串 `struct { ... }`，谁受得了。
- **`#define MAX 100`** 是本喵定的一个上限：通讯录最多记 100 条。写成名字的好处是 —— 以后想改成 200，只改这一处就行（这一招前面在「写在门口的大缸」那一课打过招呼，今天就用上了）。

有了 `Contact` 这个长相，本喵只要写一句 `Contact c;`，一条记录就到手了 —— 里面装着 `c.name` 和 `c.phone` 两只碗。

::: tip 猫咪提示
为什么名字和号码都用「一串字」的碗，号码不用整数装？因为号码**不是拿来算账的**：本喵不会去算「13800000001 加 2 等于几」。它只是一位位念出来的一串记号，那用装字的碗正合适 —— 还免得开头那个 0 被吃掉（在装整数的碗里，`0138` 那个 0 是不算的）喵。
:::

## 二、一排碗：把记录排成一排

一条记录到手了，接下来就是**把记录排成一排** —— 也就是本喵的通讯录：

```c
#include <stdio.h>
#include <string.h>

#define MAX 100

typedef struct {
    char name[32];
    char phone[20];
} Contact;

int main(void) {
    Contact book[MAX];
    strcpy(book[0].name, "小橘");
    strcpy(book[0].phone, "13800000001");
    strcpy(book[1].name, "狸花");
    strcpy(book[1].phone, "13900000002");

    for (int i = 0; i < 2; i++) {
        printf("%d. %s %s\n", i + 1, book[i].name, book[i].phone);
    }
    return 0;
}
```

```text
1. 小橘 13800000001
2. 狸花 13900000002
```

- **`Contact book[MAX];`** —— 一排 100 只碗，每只碗里装着**一条记录**（记录里又各有两只碗）。念起来就是「本喵的通讯录」。
- **`book[0].name`** —— 点名的写法是**一层一层往里走**：先指出**第几条**（`book[0]`），再用一个点指出**记录里的哪一样**（`.name`）。
- **`strcpy(book[0].name, "小橘")`** —— 往「一串字的碗」里塞字得用这一招（`strcpy` 住在头文件 `string.h` 家，直接把右边那一串原样抄进左边的碗）。因为碗是**一只固定的碗**，不能像别的碗那样直接给初值，得用「抄进去」的办法喵。

`for` 那段就是本喵念通讯录的样子：从第 0 只碗走到第 1 只碗，一只只印出来（心里印的是「第几条」所以要 `i + 1`，念的却是碗里的名字和号码）喵。

## 三、写成招式：加一条、列全部

上面的写法有个毛病：**每次要动通讯录，都得在 `main` 里现写一遍**。要加三条就得抄三段。本喵把它们各自打包成一招：

```c
#include <stdio.h>
#include <string.h>

#define MAX 100

typedef struct {
    char name[32];
    char phone[20];
} Contact;

int add_one(Contact book[], int n, char *name, char *phone) {
    if (n >= MAX) {
        printf("记满了喵\n");
        return n;
    }
    strcpy(book[n].name, name);
    strcpy(book[n].phone, phone);
    return n + 1;
}

void list_all(Contact book[], int n) {
    if (n == 0) {
        printf("还一条都没有喵\n");
        return;
    }
    for (int i = 0; i < n; i++) {
        printf("%d. %s %s\n", i + 1, book[i].name, book[i].phone);
    }
}

int main(void) {
    Contact book[MAX];
    int n = 0;

    list_all(book, n);
    n = add_one(book, n, "小橘", "13800000001");
    n = add_one(book, n, "狸花", "13900000002");
    n = add_one(book, n, "奶牛", "13700000003");
    printf("现在一共 %d 条\n", n);
    list_all(book, n);
    return 0;
}
```

```text
还一条都没有喵
现在一共 3 条
1. 小橘 13800000001
2. 狸花 13900000002
3. 奶牛 13700000003
```

两招的头上都有一串投喂，值得一个一个念：

| 招式 | 收到什么 | 干什么 |
|---|---|---|
| `add_one` | 那一排碗、**现在有几条**、新名字、新号码 | 把新的一条抄到**第 `n` 只碗**里，然后把「现在有几条」加一 |
| `list_all` | 那一排碗、**现在有几条** | 一条条念出来；一条都没有就提醒一声 |

**「现在有几条」为什么每回都要递进去、又递回来？** 因为通讯录里现在有几条，是 `main` 手里那只碗记着的事 —— `add_one` 想在它上面加一，只能**把新数字叼回来**，让 `main` 自己接着（`n = add_one(book, n, ...);`）。这就是上一课那句「要有个交代」在干活：加成功没成功、加完之后是几条，都在这一进一出里说清楚了。

`add_one` 里那句 `if (n >= MAX)` 就是**防御式检查**：100 条满了就提醒一声、原样把条数叼回去，绝不往碗外面写。

::: warn 小心喵
`add_one` 头上那句 `Contact book[]`，说的是「**递进来的是一排碗**」—— 所以招式里改的 `book[n]`，就是 `main` 里那一排碗**本尊**，改一处两边都变。

可 `int n` 不一样：它只是**把数抄了一份**递给招式。所以 `add_one` 里就算写 `n = n + 1;`，`main` 手里那个 `n` 也**纹丝不动** —— 这正是本喵让它用 `return n + 1;` 把新条数叼回来的原因喵。
:::

## 四、存进册子，再读回来

通讯录建好了，可一关灯还是没了（上一课那个钩子还记得吧）。本喵把「存」和「读」也各写成一招：

```c
#include <stdio.h>
#include <string.h>

#define MAX 100

typedef struct {
    char name[32];
    char phone[20];
} Contact;

int add_one(Contact book[], int n, char *name, char *phone) {
    if (n >= MAX) {
        printf("记满了喵\n");
        return n;
    }
    strcpy(book[n].name, name);
    strcpy(book[n].phone, phone);
    return n + 1;
}

void list_all(Contact book[], int n) {
    if (n == 0) {
        printf("还一条都没有喵\n");
        return;
    }
    for (int i = 0; i < n; i++) {
        printf("%d. %s %s\n", i + 1, book[i].name, book[i].phone);
    }
}

void save_all(Contact book[], int n, char *path) {
    FILE *fp = fopen(path, "w");
    if (fp == NULL) {
        printf("册子打不开喵\n");
        return;
    }
    for (int i = 0; i < n; i++) {
        fprintf(fp, "%s %s\n", book[i].name, book[i].phone);
    }
    fclose(fp);
    printf("存好了喵\n");
}

int load_all(Contact book[], char *path) {
    FILE *fp = fopen(path, "r");
    int n = 0;
    if (fp == NULL) {
        printf("还没有册子，这次从空的开始喵\n");
        return 0;
    }
    while (n < MAX && fscanf(fp, "%31s %19s", book[n].name, book[n].phone) == 2) {
        n = n + 1;
    }
    fclose(fp);
    return n;
}

int main(void) {
    Contact book[MAX];
    int n = 0;

    n = add_one(book, n, "小橘", "13800000001");
    n = add_one(book, n, "狸花", "13900000002");
    printf("本喵先加了两条，现在有 %d 条\n", n);
    list_all(book, n);

    save_all(book, n, "book.txt");

    n = load_all(book, "book.txt");
    printf("重新读回来 %d 条\n", n);
    list_all(book, n);
    return 0;
}
```

```text
本喵先加了两条，现在有 2 条
1. 小橘 13800000001
2. 狸花 13900000002
存好了喵
重新读回来 2 条
1. 小橘 13800000001
2. 狸花 13900000002
```

值得细看的地方有四处：

1. **存的时候一条占一行**：`"%s %s\n"` —— 名字、空一格、号码、换行。**格式是你自己定的规矩，读的时候必须照着同一套规矩来**，不然两边对不上。
2. **读的时候，绕圈的条件里就带着「读到没有」**：`fscanf(...) == 2` 的意思是「这一趟成功读到两样了吗」。读到册子末尾、读不满两样，绕圈自然收工 —— 这就是上一课那句「要检查」在文件上的样子。
3. **`%31s` 和 `%19s` 里的数字**，说的是「**最多吃这么多个字**」：`name` 那只碗有 32 格，最多只吃 31 个（**得留一格给结尾的记号**）。碗有多大、这里就写多大，多一个字都不许进。
4. **`book[n].name` 前面没有 `&`** —— 它本身就是「一只碗」，正等着装字（不像装数的碗，得写 `&` 告诉它碗在哪）喵。

`load_all` 用**战利品**把「读到了几条」交代回来（`return n;`），`main` 拿它接着用，跟 `add_one` 是同一套干法喵。

## 五、册子被人拿记事本改坏了

通讯录存成一本**普通的册子**，好处是谁都能打开看；坏处也正是这个 —— **谁都能改**。本喵故意在册子里乱写一行试试：

```c
#include <stdio.h>
#include <string.h>

#define MAX 100

typedef struct {
    char name[32];
    char phone[20];
} Contact;

void list_all(Contact book[], int n) {
    if (n == 0) {
        printf("还一条都没有喵\n");
        return;
    }
    for (int i = 0; i < n; i++) {
        printf("%d. %s %s\n", i + 1, book[i].name, book[i].phone);
    }
}

int load_all(Contact book[], char *path) {
    FILE *fp = fopen(path, "r");
    int n = 0;
    if (fp == NULL) {
        printf("还没有册子，这次从空的开始喵\n");
        return 0;
    }
    while (n < MAX && fscanf(fp, "%31s %19s", book[n].name, book[n].phone) == 2) {
        n = n + 1;
    }
    fclose(fp);
    return n;
}

int main(void) {
    FILE *fp = fopen("book.txt", "w");
    fprintf(fp, "小橘 13800000001\n");
    fprintf(fp, "这一行乱写的 狸花\n");
    fclose(fp);

    Contact book[MAX];
    int n = load_all(book, "book.txt");
    list_all(book, n);
    printf("一共 %d 条\n", n);
    return 0;
}
```

```text
1. 小橘 13800000001
2. 这一行乱写的 狸花
一共 2 条
```

看出来了吗：**程序一声不吭就把那行乱的收下了** —— 它把 `这一行乱写的` 当成名字、把 `狸花` 当成号码，凑成了一条「记录」。

为什么会这样？因为 `fscanf` 只管按格式**抓两个词**，它**没法判断这两个词是不是一条真记录**（本喵也没告诉过它「名字里不该有空格、号码该是一串数字」）。格式上对得上，它就照收。

所以真做系统的时候，还得再加一道**检查**：读回来之后自己验一遍 —— 号码是不是一串数字、名字有没有超长、这条是不是空的。这就是**防御式检查**在数据上的样子：**不指望进来的东西是对的，先验一遍再说**喵。

::: tip 猫咪提示
本喵这套用法有个名字，叫**「数据持久化」** —— 说的是「程序收工了，东西还在」。有了它，你的程序才从「玩一玩」变成「真能用」：今天记下的朋友，明天打开还在。

存成册子的好处是**谁都能看、谁都能改**（用记事本就行）；代价就是**读了得检查**。想省掉检查也行 —— 换一套「不是写给眼睛看」的存法（就是上一课那对 `fwrite` / `fread`），代价是册子再也不能拿记事本看了喵。
:::

## 六、一个真能用的菜单

三样都齐了：**一排碗**装着记录、**两招**负责加和列、**两招**负责存和读。最后给它们装上**菜单** —— 让本喵点着使：

```c
#include <stdio.h>
#include <string.h>

#define MAX 100

typedef struct {
    char name[32];
    char phone[20];
} Contact;

int add_one(Contact book[], int n, char *name, char *phone) {
    if (n >= MAX) {
        printf("记满了喵\n");
        return n;
    }
    strcpy(book[n].name, name);
    strcpy(book[n].phone, phone);
    return n + 1;
}

void list_all(Contact book[], int n) {
    if (n == 0) {
        printf("还一条都没有喵\n");
        return;
    }
    for (int i = 0; i < n; i++) {
        printf("%d. %s %s\n", i + 1, book[i].name, book[i].phone);
    }
}

void save_all(Contact book[], int n, char *path) {
    FILE *fp = fopen(path, "w");
    if (fp == NULL) {
        printf("册子打不开喵\n");
        return;
    }
    for (int i = 0; i < n; i++) {
        fprintf(fp, "%s %s\n", book[i].name, book[i].phone);
    }
    fclose(fp);
    printf("存好了喵\n");
}

int load_all(Contact book[], char *path) {
    FILE *fp = fopen(path, "r");
    int n = 0;
    if (fp == NULL) {
        printf("还没有册子，这次从空的开始喵\n");
        return 0;
    }
    while (n < MAX && fscanf(fp, "%31s %19s", book[n].name, book[n].phone) == 2) {
        n = n + 1;
    }
    fclose(fp);
    return n;
}

int main(void) {
    Contact book[MAX];
    int n = load_all(book, "book.txt");
    int choice = -1;
    int running = 1;

    while (running) {
        printf("=== 小鱼干通讯录 ===\n");
        printf("1 添加  2 列出  0 退出\n");
        printf("请选择> ");

        if (scanf("%d", &choice) != 1) {
            running = 0;
        } else if (choice == 0) {
            running = 0;
        } else if (choice == 1) {
            char name[32];
            char phone[20];
            printf("名字> ");
            scanf("%31s", name);
            printf("号码> ");
            scanf("%19s", phone);
            n = add_one(book, n, name, phone);
            save_all(book, n, "book.txt");
        } else if (choice == 2) {
            list_all(book, n);
        } else {
            printf("本喵不认得这个数字喵\n");
        }
    }
    printf("\n再见喵\n");
    return 0;
}
```

```text
还没有册子，这次从空的开始喵
=== 小鱼干通讯录 ===
1 添加  2 列出  0 退出
请选择> 
再见喵
```

拆开看这个 `main`：

- **一进门先把册子读进碗里**（`load_all`）—— 昨天记的朋友今天还在，这一句就是全部的秘密。
- **`while (running)`** 是菜单的骨架：转一圈、印一次菜单、等你敲一个数，然后按你敲的去做。想退出就把 `running` 设成 0，绕圈自然收工。
- **`if (scanf("%d", &choice) != 1)`** —— 这是菜单版的**防御式检查**：只要没读到数（比如你不小心敲了个字母、或者输入到头了），立刻 `running = 0` 收工，**绝不拿着一个没读到数的碗往下算**。
- **加一条的时候顺手就存**（`save_all`）—— 这样就算程序被强关了，也已经落进册子，一条都不会丢。
- **加号码的时候用 `scanf("%19s", phone)`**：这个 `19` 也是「最多吃多少个字」，和读册子时的规矩一样，碗有多大就写多大。

上面那段输出就是课文里跑出来的样子：跑台每次都**空着手**送来输入（没有东西可敲），所以菜单刚印出来、`scanf` 就发现读不到了，于是 `running` 归零、印一句「再见喵」收工 —— 正好让你看清「输入到头」这一支走得对不对喵。

::: warn 小心喵
菜单程序最容易摔的坑是**输入没读完**：`scanf("%d")` 只吃掉那个数，**剩下的换行符还留在原地**，你下一次读名字的时候可能就只读到一个空的换行。

本喵这里读名字、读号码用的都是 `%s`（它**会**自动跳过前面的空白、读到下一个空白为止），所以正好把那些多余的空白一并跳过 —— 这也是本喵为什么安心用它。等你自己写菜单、发现「输入老是跳掉一步」的时候，就回头想想是不是这件事喵。
:::

## 小任务

1. 给 `list_all` 加个「第几条」以外的花样：印成 `【1】小橘 13800000001` 这样，方括号里用第几条。先跑一遍看对不对。
2. 给菜单加上第 3 项：**删除最后一条**（提示：把条数减一就行 —— 想想为什么「减一」就够了，「最后一条」的那只碗不用管）。别忘了改完顺手 `save_all`。
3. 先猜再跑：把第四节 `load_all` 里的 `%31s %19s` 改成 `%s %s`，册子照样读得回来吗？先写下你的猜测，再跑一次对照。（提示：想想那道「最多吃多少个字」的闸门还挡不挡得住。）
4. 给第五节的册子再添一行更乱的（比如只写一个词），跑一遍看它读回来几条。想一想：你会怎么加检查，才能把这种行**当场拦下**？
5. 把这一课的程序整个抄进你自己的编辑器，改掉名字和号码，真跑一遍 —— 第一次跑完「1」添两条，「2」看一眼，退出；**然后再跑一次**，直接按「2」看看昨天那两条在不在。这一步就是你亲手验过的「数据持久化」喵。

这一路从「自己咬自己尾巴的招式」走到今天这个能存能读的小系统，C 语言的进阶部分就到这里了。往后要对付更大的程序时，本喵教的这些本事 —— 招式打包、结构捆扎、册子持久、先检查再干活 —— 一个都不会白学喵～ 🐾
