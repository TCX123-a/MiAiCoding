---
id: c-stage3-05
lang: c
stage: 3
order: 6
title: 二叉树——会分叉的猫爬架
tags: [数据结构, 树]
required: [c-stage3-04]
crossRefs: []
estMinutes: 22
keywords: [node, left, right, inorder, insert]
---

## 钩子：每层只分两叉的猫爬架

本喵的猫爬架有个怪脾气：每一层**只分两叉** —— 左边一叉、右边一叉，再往上还是各分两叉，绝不分成三叉五叉。这样的架子有个正经名字：**会分叉的猫爬架（二叉树）**喵。

它比前面学过的两样法宝都灵活：一摞碗只能从最上面拿，一条队伍只能从最前面走；而这架子只要记住「往左还是往右」的规矩，就能把一整堆数字理得井井有条。今天本喵教你三件事：怎么挂、怎么挨个报数、以及为什么它天生自带「从小到大」的本事喵 ✨

## 一只叉长什么样

一层架子就是一个**接头**：上面挂着一份东西（本喵挂的是整数），下面伸出两只牌子 —— 一只指左边的叉，一只指右边的叉。

```c
typedef struct Node {
    int value;
    struct Node *left;    /* 左边的叉 */
    struct Node *right;   /* 右边的叉 */
} Node;
```

和链表那一课的链子几乎一模一样，只是那只爪子从一只变成了两只。链子是一条直线，只能「一路摸到底」；叉是分岔的，摸到一层之后有两条路可以走 —— 这个差别，就是今天全部新东西的来源喵。

```c
Node *new_node(int value) {
    Node *p = (Node *)malloc(sizeof(Node));
    if (p == NULL) {
        return NULL;
    }
    p->value = value;
    p->left = NULL;
    p->right = NULL;
    return p;
}
```

新接头的两只牌子先都留空（`NULL`），意思是「这一层下面还没有叉」喵。

## 自己咬自己尾巴的招式

挂之前先讲一个今天反复要用的想法：**自己咬自己尾巴的招式（递归）**。

本喵想数清整架子上挂了多少个接头，怎么办？先看自己这一层，再让**左边那叉照一模一样的办法数一遍**，右边也一样，最后把三份加起来。左边那叉收到命令后，会照同样的办法再往下一层分 —— 一直分到**没有叉了**为止。

关键在于「没有叉了」这一句必须写出来，也就是摸到空叉就**收手**：`if (root == NULL) { return; }`。

没有这一句，招式会没完没了地喊自己，把机器的耐心耗光。它既是收手的地方，也是整招的第一句喵。

## 挂上去的规矩：小的往左、大的往右

有了招式，就能定义「挂」的规矩了：拿新来的数和这一层比 —— 小就往左走，大就往右走，走到空位就挂上去。

```c
Node *insert(Node *root, int value) {
    if (root == NULL) {
        return new_node(value);   /* 摸到空位：就挂在这儿 */
    }
    if (value < root->value) {
        root->left = insert(root->left, value);     /* 小的交给左边 */
    } else if (value > root->value) {
        root->right = insert(root->right, value);   /* 大的交给右边 */
    }
    return root;   /* 一样大就不重复挂，原样叼回 */
}
```

两个细节值得多念两遍喵：一是走到空位才挂 —— 所以每一层都拿**新来的数**和这一层的数比，比完再决定交给哪只牌子；二是这招**把整棵架子的顶叼回来**（`return root;`），所以外面调用时要写成 `root = insert(root, value);`，和链表那一课那招的写法一模一样。

## 三种报数方式

挨个走一遍整架架子，本喵有三种报数顺序，区别只在**「自己」排第几个**：

- **前序**：先报自己，再报左边，最后报右边。
- **中序**：先报左边，再报自己，最后报右边。
- **后序**：左边、右边都报完了，最后才轮到自己。

```c
/* 前序：先自己，再左边，最后右边 */
void preorder(Node *root) {
    if (root == NULL) {
        return;
    }
    printf("%d ", root->value);
    preorder(root->left);
    preorder(root->right);
}

/* 中序：先左边，再自己，最后右边 */
void inorder(Node *root) {
    if (root == NULL) {
        return;
    }
    inorder(root->left);
    printf("%d ", root->value);
    inorder(root->right);
}

/* 后序：左边、右边都走完，最后才是自己 */
void postorder(Node *root) {
    if (root == NULL) {
        return;
    }
    postorder(root->left);
    postorder(root->right);
    printf("%d ", root->value);
}
```

三招长得几乎一样，只有 `printf` 的位置在挪。**中序**这一招最值钱：因为它把「自己」放在两只叉**中间**报，而规矩又是小的在左、大的在右，所以报出来的顺序正好**从小到大**喵。

下面这段拿 `5 3 8 1 4` 长出来的那架架子，把中序的**每一步**走给你看。留意「停在哪儿的层」那一栏 —— 它是「往上回到哪一层」的唯一线索，屏幕上完全看不见。

```demo
title: 中序遍历：为什么报出来正好是从小到大
code:
| void inorder(Node *root) {
|     if (root == NULL) { return; }
|     inorder(root->left);
|     printf("%d ", root->value);
|     inorder(root->right);
| }

step 先看清楚这架架子长什么样
at: 1
say: 挂上去的顺序是 5、3、8、1、4，按「小的往左、大的往右」长出来：5 在顶；3 是 5 的左叉，8 是 5 的右叉；1 是 3 的左叉，4 是 3 的右叉。
meow: 架子搭好啦，本喵从顶上开始爬～
pose: expect
这一层的 root = 5（最顶上那层）
走到哪了 = 还没出发
停在哪儿的层 = (暂时空的)
印出来 = (还没印)

step 第 1 层（5）· 先问是不是空叉
at: 2
say: 每一层的第一句都是这一句。5 号不是空叉，所以不返回，接着往下走。没有这一句，摸到空叉会当场断气（见下面的警告）。
meow: 5 号不是空的，能爬喵～
pose: think
这一层的 root = 5
走到哪了 = 第 1 层，刚问完空不空
停在哪儿的层 = (暂时空的)
印出来 = (还没印)

step 第 1 层（5）· 先走左边那叉
at: 3
say: 中序的第一件事是走左叉，所以 5 号停在第 3 行等着，控制权交给 3 号。记住这一刻：5 号报了名又没报数，它欠着一句「5」。
meow: 5 号先去左边，自己先欠着喵～
pose: busy
这一层的 root = 3（5 号的左叉）
走到哪了 = 钻进第 2 层
停在哪儿的层 = ①5 号（欠一句「5」）
印出来 = (还没印)

step 第 2 层（3）· 它也要先走左边
at: 3
say: 3 号照同一套办：先问空不空（不是），再走左叉 —— 也就是 1 号。现在半路上摞着两位了。
meow: 3 号也先往左钻，再摞一层～
pose: busy
这一层的 root = 1（3 号的左叉）
走到哪了 = 钻进第 3 层
停在哪儿的层 = ①5 号 ②3 号（都欠着自己那一句）
印出来 = (还没印)

step 第 3 层（1）· 左边是空叉，报自己
at: 4
say: 1 号的左边没有叉（空牌子）。inorder(NULL) 进去第一句就返回，所以左边这趟等于什么都没干。左边走完，轮到报自己：印「1」。这是屏幕上第一个数。
meow: 1 号没有左叉，直接报自己喵！
pose: yay
这一层的 root = 1
走到哪了 = 第 3 层，报出了自己
停在哪儿的层 = ①5 号 ②3 号
印出来 = 1

step 第 3 层（1）· 右边也是空叉，收工
at: 5
say: 1 号的右边同样是空叉，也是一进去就返回。两叉都走完，1 号这一招结束、消失，控制权交回停在第 3 行的 3 号。
meow: 1 号收工，爬回 3 号喵～
pose: milestone
这一层的 root = 3（回到第 2 层）
走到哪了 = 1 号整层走完
停在哪儿的层 = ①5 号（只剩它了）
印出来 = 1

step 第 2 层（3）· 左边走完了，报自己
at: 4
say: 3 号接着往下跑。它的左边（整棵 1 号）已经全部报完，所以现在轮到报自己：印「3」。
meow: 轮到 3 号啦，印一个 3！
pose: yay
这一层的 root = 3
走到哪了 = 第 2 层，报出了自己
停在哪儿的层 = ①5 号
印出来 = 1、3

step 第 2 层（3）· 再走右边那叉
at: 5
say: 报完自己才走右叉，这就是「自己夹在两只叉中间」。右边是 4 号。
meow: 3 号往右拐，去找 4 号～
pose: busy
这一层的 root = 4（3 号的右叉）
走到哪了 = 钻进 4 号
停在哪儿的层 = ①5 号 ②3 号
印出来 = 1、3

step 第 3 层（4）· 报完自己就收工
at: 4
say: 4 号的两只叉都是空的：一进去就走左边、返回，接着报自己（印「4」），再走右边、返回。4 号这一层结束，控制权交回 3 号 —— 3 号两叉都走完，也跟着结束，交回 5 号。
meow: 4 号报完，一路收工回到 5 号！
pose: milestone
这一层的 root = 5（一路回到最顶上）
走到哪了 = 3 号整棵子树走完了
停在哪儿的层 = (空的 —— 5 号重新开工了)
印出来 = 1、3、4

step 第 1 层（5）· 终于轮到自己
at: 4
say: 5 号等了一路，现在左边整棵都报完了，才轮到它自己：印「5」。顶上那层永远排在中间 —— 这就是中序。
meow: 5 号等好久啦，终于轮到它喵！
pose: yay
这一层的 root = 5
走到哪了 = 第 1 层，报出了自己
停在哪儿的层 = (空的)
印出来 = 1、3、4、5

step 第 1 层（5）· 走右边，收尾
at: 5
say: 5 号最后走右叉，也就是 8 号。8 号左右都是空叉，一进去就报自己：印「8」。整棵架子走完。
meow: 最后是 8！整棵爬完啦～
pose: busy
这一层的 root = 8
走到哪了 = 最后一层
停在哪儿的层 = (空的)
印出来 = 1、3、4、5、8

step 走完了：正好从小到大
at: 1
say: 报出来是 1 3 4 5 8 —— 正好排好了。这不是巧合：中序把「自己」夹在左右之间，而规矩又是小的在左、大的在右，于是小的先报、自己居中、大的最后，天生有序。
meow: 1 3 4 5 8，本喵爬完整棵树啦！
pose: proud
这一层的 root = (整棵走完)
走到哪了 = 三招共用同一套走法，只差 printf 的位置
停在哪儿的层 = (空的)
印出来 = 1、3、4、5、8
```

::: warn 第 2 步那一句「是不是空叉」不是客套话
上面每一步里，`if (root == NULL) { return; }` 都在干活 —— 它拦下的是**空叉**。
要是把它删了，程序**不会**撑到「摞爆」，它会**当场断气**：
空牌子那一层还没被问，就伸手去掏 `root->value`，本机上是「访问违规」，一个字都印不出来。
所以这一句既是收手的地方，也是整招的第一句 —— 位置不能挪喵。
:::

## 完整程序：敲下来就能跑

```c
#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int value;
    struct Node *left;
    struct Node *right;
} Node;

Node *new_node(int value) {
    Node *p = (Node *)malloc(sizeof(Node));
    if (p == NULL) {
        return NULL;
    }
    p->value = value;
    p->left = NULL;
    p->right = NULL;
    return p;
}

/* 小的往左、大的往右，一路摸到空位就挂上去 */
Node *insert(Node *root, int value) {
    if (root == NULL) {
        return new_node(value);
    }
    if (value < root->value) {
        root->left = insert(root->left, value);
    } else if (value > root->value) {
        root->right = insert(root->right, value);
    }
    return root;
}

/* 前序：先自己，再左边，最后右边 */
void preorder(Node *root) {
    if (root == NULL) {
        return;
    }
    printf("%d ", root->value);
    preorder(root->left);
    preorder(root->right);
}

/* 中序：先左边，再自己，最后右边 */
void inorder(Node *root) {
    if (root == NULL) {
        return;
    }
    inorder(root->left);
    printf("%d ", root->value);
    inorder(root->right);
}

/* 后序：左边、右边都走完，最后才是自己 */
void postorder(Node *root) {
    if (root == NULL) {
        return;
    }
    postorder(root->left);
    postorder(root->right);
    printf("%d ", root->value);
}

/* 把整架架子还给仓库：两个叉也照同样的办法还 */
void free_tree(Node *root) {
    if (root == NULL) {
        return;
    }
    free_tree(root->left);
    free_tree(root->right);
    free(root);
}

int main(void) {
    Node *root = NULL;
    int values[5] = {5, 3, 8, 1, 4};
    for (int i = 0; i < 5; i++) {
        root = insert(root, values[i]);
    }

    printf("前序：");
    preorder(root);
    printf("\n中序：");
    inorder(root);
    printf("\n后序：");
    postorder(root);
    printf("\n");

    free_tree(root);
    root = NULL;
    return 0;
}
```

```text
前序：5 3 1 4 8
中序：1 3 4 5 8
后序：1 4 3 8 5
```

挂上去的顺序是 5、3、8、1、4，长出来的架子是这样喵：5 在最上面；3 比 5 小挂左边，8 比 5 大挂右边；1 比 3 还小，挂在 3 的左边；4 比 3 大、又比 5 小，挂在 3 的右边。

- 前序从最上面那层出发，一路往左钻到底，所以是 `5 3 1 ...`；
- 中序把「自己」夹在两只叉中间报，于是**从小到大**：`1 3 4 5 8`；
- 后序等两只叉都报完了才报自己，最上面那层压在最后，所以 `5` 收尾。

::: warn 小心喵
三个坑，一次说清喵。① **收手那一句不能省**：忘了 `root == NULL` 就返回，招式会没完没了地喊自己 —— 不过本喵真跑了一遍，它**根本没等到「摞爆」就先摔了**：空牌子那一格还没问，它就伸手去掏 `root->value`，程序当场断气（本机是「访问违规」，一个字都没印出来）。**别指望它撑到摞爆那一步**喵。（翻译官喵会念一句 `-Winfinite-recursion`——「这一招在喊自己」，可它拦不住你。）② **空架子也要能处理**：`root` 是空牌子时，三招都该安安静静返回，不能去碰它 —— 这也是第一句就在问 `root == NULL` 的原因。③ **只有中序是从小到大的**：前序和后序都没有这个本事，别把它们当成「也能排好」喵。
:::

::: tip 猫咪提示
今天记住三件事：**接头上有两只牌子**（左边、右边），所以能分岔；**挂东西的规矩是小的往左、大的往右**；**报数的三种顺序，区别只在「自己」排第几个**（前序最前、中序中间、后序最后）。想验证自己画对了没有，就看中序那一行是不是从小到大的喵。
:::

## 小任务

给这棵爬架加一招 `int count_nodes(Node *root)`：数一数架子上总共挂了多少个接头（提示：空叉算 0 个，自己算 1 个，再加上左右两叉数出来的 —— 又是那句「自己咬自己尾巴」的老办法）。数完再顺手加一招 `int tree_height(Node *root)`，看看这架架子能爬多高喵。🐾
