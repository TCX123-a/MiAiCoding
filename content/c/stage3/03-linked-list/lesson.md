---
id: c-stage3-03
lang: c
stage: 3
order: 4
title: 链表——用猫爪指向牌串起来的链子
tags: [数据结构, 链表]
required: [c-stage3-02]
crossRefs: [c-stage2-04, c-stage2-05, c-stage3-05]
estMinutes: 18
keywords: [链表, typedef, struct, 节点]
---

## 钩子：捏在手里的第一只环

本喵小时候最爱玩一串玩具：每只环上都挂着一条小鱼干，环的旁边还伸出一只爪子，紧紧牵着**下一只环**。第一只环被本喵捏在手里——只要捏住它，顺着爪子一路摸下去，整条链子就都能摸个遍喵 ✨

这就是**链表（用猫爪指向牌串起来的链子）**。它和**一排贴编号的猫粮碗（数组）**最大的不同是：碗摆好就固定了，想往中间插一只新碗，后面的碗得挨个往后挪；而链子只要**把爪子的方向改一改**，新环就悄悄挂进去了，别的一只都不用动。

## 图纸：一只环长什么样

先给环画一张图纸（结构体）：

```c
typedef struct Node {
    int x;              /* 环上挂着的小鱼干 */
    struct Node *next;  /* 牵着下一只环的爪子 */
} Node;
```

`struct Node { ... }` 是图纸，它的全名要把两个词连起来念：`struct` 加上图纸标签 `Node`。而 `typedef` 干的事是**给图纸挂个外号**：以后 `struct Node` 这串全名可以简写成 `Node`，外面就能写 `Node *head;` 啦。

可是图纸**里面**偏偏不能偷懒！画图纸的时候，`typedef` 那一行还没读完，外号 `Node` 还没挂上去，翻译官喵这时只认得图纸标签，所以里面只能老老实实写全名 `struct Node *next;`。记住这条分界线：**图纸里面写 `struct Node *`，图纸外面才能写 `Node *`**。

::: warn 小心喵
在图纸里写成 `Node *next;`，翻译官喵会立刻板起脸丢给你一句 `unknown type name 'Node'`——它真的不认识这个还没挂上的外号喵。这不是怪规矩，只是因为外号是在整张图纸画完之后才生效的呀。
:::

## 造一只新环：又是租仓库

```c
Node *new_node(int x) {
    Node *p = (Node *)malloc(sizeof(Node));  /* 现要现租一只环的地方 */
    if (p == NULL) {
        printf("仓库没租到喵\n");
        return NULL;
    }
    p->x = x;        /* 挂上小鱼干 */
    p->next = NULL;  /* 爪子先空着 */
    return p;
}
```

跟前面学过的现要现租的仓库一模一样，只是这回要租的大小是**一整只环**（`sizeof(Node)`）。牌子到手先看 `NULL`；新环的爪子必须先设成 `NULL`，因为它暂时是链子的尾巴喵。

## 四套手法

**① 挂到最前面。** 新环的爪子去牵住原来的第一环，再把捏在手里的牌子换成新环：

```c
Node *push_front(Node *head, int x) {
    Node *p = new_node(x);
    if (p == NULL) { return head; }
    p->next = head;   /* 新环牵住旧的第一环 */
    return p;         /* 叼回新的第一环 */
}
```

这一招只有两句正经活，可它是整个「链子比碗排省事」的**现场**：插一只新环，**别的一只都不用动**。下面这段把动作放慢，盯着 `链子` 那一栏看 —— 它在第 7 步之前**一直没变过**喵。

```demo
title: 往最前面挂一只环，别的环一只都没动
code:
| Node *push_front(Node *head, int x) {
|     Node *p = new_node(x);
|     if (p == NULL) { return head; }
|     p->next = head;
|     return p;
| }

step 手上捏着什么
at: 1
say: 现在外面有一条链子 1 → 2 → 3，尾巴那只的爪子牵着 NULL（表示到头了）。本喵手里捏着的是第一环的牌子，也就是 1 号环。
meow: 本喵捏着第一环，别的一只没动喵～
pose: expect
head = 捏着 1 号环
p = 还没这只新环
链子 = 1 → 2 → 3 → NULL

step 现要现租一只新环
at: 2
say: new_node(0) 里的 malloc 租的是一整只环那么大（sizeof(Node)）：一格装小鱼干，一格装爪子。跟前面学过的仓库一模一样，只是这回租的是「一只环」。
meow: 租一只新环！本喵现要现租～
pose: busy
head = 捏着 1 号环
p = 刚租到一只新环
链子 = 1 → 2 → 3 → NULL

step 新环挂上小鱼干，爪子先空着
at: 2
say: 新环的小鱼干是 0，两只爪子先设成 NULL —— 它暂时是链子的尾巴，后面还没有环。
meow: 挂上 0 号鱼干，爪子先空着喵～
pose: busy
head = 捏着 1 号环
p = 新环：挂着 0，爪子空着
链子 = 1 → 2 → 3 → NULL

step 先看一眼租到没有
at: 3
say: 牌子到手第一件事永远是看 NULL。租不到就该原样把 head 交回去，一个字都不改。这次租到了，跳过。
meow: 不是空的，租到啦！
pose: think
head = 捏着 1 号环
p = 新环：挂着 0，爪子空着
链子 = 1 → 2 → 3 → NULL

step 新环的爪子转个方向
at: 4
say: p->next = head; 把新环那只空爪子，牵到原来捏在手里的第一环上——也就是 1 号环。不是把新环接到链子尾巴，是接到最前面。
meow: 新环的爪子牵住 1 号环啦！
pose: yay
head = 捏着 1 号环
p = 新环：爪子牵着 1 号环
链子 = 1 → 2 → 3 → NULL

step 再看一眼链子：一只都没动
at: 4
say: 到这一步，2 号环、3 号环一个字都没改，1 号环也没改。变的只有刚租来的那只新环身上的一条爪子。这就是链子比碗排省事的地方。
meow: 老环们一根毛都没碰，喵！
pose: milestone
head = 捏着 1 号环
p = 新环：爪子牵着 1 号环
链子 = 1 → 2 → 3 → NULL

step 把新的第一环叼回去
at: 5
say: return p 把新环交出去，外面写成 head = push_front(head, 0) 就会把它重新捏在手里。到这一刻链子才变成 0 开头 —— 先改爪子、后换牌子，顺序反了中间就会出现一段没人认领的环。
meow: 牌子换成 0 号环，链子变长一格！
pose: proud
head = 捏着新环（0 号）
p = 新环：爪子牵着 1 号环
链子 = 0 → 1 → 2 → 3 → NULL
```

::: tip 和「往碗排中间插一只」对照着看
碗排插一只新碗，后面所有的碗**都得挨个往后挪一格**；链子插一只新环，改的是**一条爪子**。
代价在别处：碗排报个编号就能直接跳到第 5 只，链子只能从第一环顺着爪子一只只摸过去 ——
第 7 步那句 `print_list` 就是这件事的样子喵。
:::

**② 挂到最后面。** 先看链子是不是空的——空的就直接让它当第一环；不然就一路摸到最后一环，把它的爪子接到新环上：

```c
Node *push_back(Node *head, int x) {
    Node *p = new_node(x);
    if (p == NULL) { return head; }
    if (head == NULL) { return p; }   /* 空链子：它就是第一环 */
    Node *cur = head;
    while (cur->next != NULL) {       /* 摸到尾巴为止 */
        cur = cur->next;
    }
    cur->next = p;
    return head;
}
```

**③ 摘掉某一只。** 得同时记住「当前这只」和「上一只」：摘中间那只时，要让上一只的爪子跨过去牵住下一只。

```c
Node *remove_value(Node *head, int x, int *found) {
    Node *cur = head;
    Node *prev = NULL;
    *found = 0;
    while (cur != NULL) {
        if (cur->x == x) {
            if (prev == NULL) {
                head = cur->next;       /* 摘的是第一环：牌子往下挪一格 */
            } else {
                prev->next = cur->next; /* 上一环跨过去牵住下一环 */
            }
            free(cur);                  /* 摘下来的环还给仓库 */
            *found = 1;
            return head;
        }
        prev = cur;
        cur = cur->next;
    }
    return head;   /* 摸到尾也没找到：原样叼回 */
}
```

这里有两个边界要当心：要摘的正好是**第一环**时，没有上一只可以跨过去，只能把牌子往下挪一格；走到底都没找到，就原样叼回，一个字都别改喵。

**④ 从头走到尾。** 捏住第一环，顺着爪子一只只走过去，走到空爪子就说明到头了：

```c
void print_list(Node *head) {
    Node *cur = head;
    while (cur != NULL) {
        printf("%d -> ", cur->x);
        cur = cur->next;
    }
    printf("NULL\n");
}
```

## 完整程序：敲下来就能跑

```c
#include <stdio.h>
#include <stdlib.h>

/* 图纸：一只环 = 一条小鱼干 + 一只牵下一环的爪子 */
typedef struct Node {
    int x;
    struct Node *next;
} Node;

/* 造一只新环：小鱼干是 x，爪子先空着 */
Node *new_node(int x) {
    Node *p = (Node *)malloc(sizeof(Node));
    if (p == NULL) {
        printf("仓库没租到喵\n");
        return NULL;
    }
    p->x = x;
    p->next = NULL;
    return p;
}

/* 挂到最前面，叼回新的第一环 */
Node *push_front(Node *head, int x) {
    Node *p = new_node(x);
    if (p == NULL) {
        return head;
    }
    p->next = head;
    return p;
}

/* 挂到最后面，叼回第一环（可能没变） */
Node *push_back(Node *head, int x) {
    Node *p = new_node(x);
    if (p == NULL) {
        return head;
    }
    if (head == NULL) {
        return p;
    }
    Node *cur = head;
    while (cur->next != NULL) {
        cur = cur->next;
    }
    cur->next = p;
    return head;
}

/* 摘掉第一只编号为 x 的环；found 里记下摘到没有，叼回第一环 */
Node *remove_value(Node *head, int x, int *found) {
    Node *cur = head;
    Node *prev = NULL;
    *found = 0;
    while (cur != NULL) {
        if (cur->x == x) {
            if (prev == NULL) {
                head = cur->next;
            } else {
                prev->next = cur->next;
            }
            free(cur);
            *found = 1;
            return head;
        }
        prev = cur;
        cur = cur->next;
    }
    return head;
}

/* 从头走到尾，一路报数 */
void print_list(Node *head) {
    Node *cur = head;
    while (cur != NULL) {
        printf("%d -> ", cur->x);
        cur = cur->next;
    }
    printf("NULL\n");
}

/* 把整条链子还给仓库 */
void free_list(Node *head) {
    Node *cur = head;
    while (cur != NULL) {
        Node *next = cur->next;   /* 先记牢下一环 */
        free(cur);                /* 再放掉这一环 */
        cur = next;
    }
}

int main() {
    Node *head = NULL;
    int found = 0;

    head = push_back(head, 1);
    head = push_back(head, 2);
    head = push_back(head, 3);
    printf("尾部插 1、2、3：");
    print_list(head);

    head = push_front(head, 0);
    printf("头部插 0：");
    print_list(head);

    head = remove_value(head, 0, &found);
    printf("摘 0（%s）：", found ? "摘到了" : "没找到");
    print_list(head);

    head = remove_value(head, 3, &found);
    printf("摘 3（%s）：", found ? "摘到了" : "没找到");
    print_list(head);

    head = remove_value(head, 99, &found);
    printf("摘 99（%s）：", found ? "摘到了" : "没找到");
    print_list(head);

    free_list(head);
    head = NULL;
    return 0;
}
```

本喵真的跑过它，输出是这样喵：

```text
尾部插 1、2、3：1 -> 2 -> 3 -> NULL
头部插 0：0 -> 1 -> 2 -> 3 -> NULL
摘 0（摘到了）：1 -> 2 -> 3 -> NULL
摘 3（摘到了）：1 -> 2 -> NULL
摘 99（没找到）：1 -> 2 -> NULL
```

三处小地方多念两遍就通了：招式都把新的第一环**叼回来重新捏好**，所以调用时写成 `head = push_back(head, 1);`；`found` 是把自己仓库的牌子递进去，让招式往里面写「摘到没有」；最后 `free_list` 一边走一边先记牢下一环再放掉当前这只——顺序反了就会牵断链子、漏还仓库喵。

::: tip 猫咪提示
链子三件事：**第一环的牌子捏在手里**（`head`，空链子是 `NULL`）；**每只环的爪子牵下一只**（尾巴那只牵 `NULL`）；**租来的环要一只只还**（先记下一环，再 `free` 当前）。C 里没有自动铲屎官，链子用完全靠你自己还喵。
:::

## 小任务

给这条链子加一招 `int list_len(Node *head)`，一边走一边数，把环的只数叼回来；然后让 `main` 分别在插入前、删除后各喊一次，看看数目对不对喵。接着可以试试把编号换成小鱼干的名字，做一条会排队的链子～ 🐾
