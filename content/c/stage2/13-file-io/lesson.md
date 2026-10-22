---
id: c-stage2-13
lang: c
stage: 2
order: 13
title: 文件操作——把小鱼干存进档案室
tags: [文件, 读写]
required: ["c-stage2-12"]
crossRefs: []
estMinutes: 25
keywords: [fopen, fclose, fprintf, fscanf, fread]
---

## 钩子：一关灯，账本就不见了

本喵在鱼塘边支了个小摊，每天收摊前都想记一笔今天收了几条小鱼干：

```c
#include <stdio.h>

int main(void) {
    int shouhuo = 3;
    printf("今天收了 %d 条小鱼干\n", shouhuo);
    return 0;
}
```

```text
今天收了 3 条小鱼干
```

第二天本喵把程序再跑一遍，傻眼了 —— 昨天那 3 条**不见了**。因为 `shouhuo` 这只仓库是**用完就拆**的：程序一收工，仓库里装的东西跟着一起没。

想让数字活过今晚，得把它写进**档案室**。档案室里放着一本本**册子**，每本都有名字，比如 `dangan.txt`。册子上的字是真真切切写在硬盘上的：关灯、关机、明天再来，它都还在。册子在术语里的名字叫**文件**，今天本喵就教你怎么把小鱼干存进去、再一条条取回来喵。

## 一、`fopen` 拉开抽屉，`fclose` 关上抽屉

要让翻译官喵替你动某本册子，先得**把它拉开**：

```c
#include <stdio.h>

int main(void) {
    FILE *fp = fopen("dangan.txt", "w");
    if (fp == NULL) {
        printf("档案室的门打不开喵\n");
        return 0;
    }
    fprintf(fp, "小鱼干 3 条\n");
    fprintf(fp, "猫粮 1 碗\n");
    fclose(fp);

    fp = fopen("dangan.txt", "r");
    if (fp == NULL) {
        printf("找不到这本册子喵\n");
        return 0;
    }
    char line[64];
    while (fgets(line, sizeof(line), fp) != NULL) {
        printf("读到：%s", line);
    }
    fclose(fp);
    return 0;
}
```

```text
读到：小鱼干 3 条
读到：猫粮 1 碗
```

本喵把「写」和「读」放在同一段里，你一次跑完就能看见效果（真用起来，这两件事常常隔得很远，甚至隔着一次关机）。一行一行拆开看：

- **`fopen("dangan.txt", "w")`** —— 「拉开抽屉」这个动作。括号里喂两样东西：
  1. **册子的名字**，要**加引号**（它是一串字，不是本喵要用的名字）。册子和程序放在同一个地方时，直接写名字就行，不用写一长串路径。名字你自己取，只要同一本册子前后写得一模一样、一个字母都不差。
  2. **打开方式**：`"w"` 是「本喵要往上面写字」。后面还会见到 `"r"`（读）和 `"a"`（接着写）。
- **`FILE *fp = ...`** —— `fopen` 干完这件事，会把**这本拉开的册子**叼回来，本喵给它起名叫 `fp`。（头上那个 `FILE *` 说的是「叼回来的是一张**册子的猫爪指向牌**」—— 牌子不装内容，装着「那本册子在哪儿」。）
- **`if (fp == NULL)`** —— **拉开失败**的时候，它叼回来的是一张「什么都没有」的牌子（`NULL`），得当场认出来、当场收手。
- **`fprintf(fp, "...")`** —— 往这本册子上写字。跟 `printf` 一比，它多喂了一样东西：**往哪本册子上写**。
- **`fclose(fp)`** —— **关上抽屉**。

::: warn 小心喵
`fclose` 别忘了，抽屉一直开着有两个麻烦：一是**写进去的字可能还揣在翻译官喵兜里**，没真落进册子（程序半路翻车时最容易吃这个亏）；二是抽屉开得太多，翻译官喵会忙不过来。

还有一条更要紧的：**`fopen` 的牌子一定要先检查再用。** 翻译官喵不会替你检查 —— 它只管你代码写得对不对，管不了那本册子到底在不在喵。
:::

### 打不开的时候，长什么样

**第一种：册子不在。** 本喵去拉一本根本没建过的册子：

```c
#include <stdio.h>

int main(void) {
    FILE *fp = fopen("meiyou.txt", "r");
    if (fp == NULL) {
        printf("这本册子不在，本喵先请你别急着往下走喵\n");
    } else {
        printf("居然开到了\n");
        fclose(fp);
    }
    return 0;
}
```

```text
这本册子不在，本喵先请你别急着往下走喵
```

**第二种：打开方式写错了。** 比如顺手写成 `"rw"` —— 听着挺合理，可翻译官喵不认：

```c
#include <stdio.h>

int main(void) {
    FILE *fp = fopen("dangan.txt", "rw");
    if (fp == NULL) {
        printf("这个打开方式翻译官喵不认喵\n");
    } else {
        printf("居然开到了\n");
        fclose(fp);
    }
    return 0;
}
```

```text
这个打开方式翻译官喵不认喵
```

两次都是**同一张空牌子**（`NULL`）。所以「先检查、再动手」这一条，能同时挡住好几种麻烦喵。

## 二、`"w"` 是撕掉重写，`"a"` 是接着写

账本是天天要添的，本喵肯定不想每添一笔就把前面的全撕掉。先看用错了会怎样：

```c
#include <stdio.h>

int main(void) {
    FILE *fp = fopen("dangan.txt", "w");
    fprintf(fp, "第一天 3 条\n");
    fclose(fp);

    fp = fopen("dangan.txt", "w");
    fprintf(fp, "第二天 5 条\n");
    fclose(fp);

    fp = fopen("dangan.txt", "r");
    char line[64];
    while (fgets(line, sizeof(line), fp) != NULL) {
        printf("%s", line);
    }
    fclose(fp);
    return 0;
}
```

```text
第二天 5 条
```

第一天那条**没了** —— 第二回拉开抽屉的那一刻，第一回写的字就被擦掉了。

```demo
title: 第二回还是 w，第一天那条是怎么没的
code:
| #include <stdio.h>
|
| int main(void) {
|     FILE *fp = fopen("dangan.txt", "w");
|     fprintf(fp, "第一天 3 条\n");
|     fclose(fp);
|
|     fp = fopen("dangan.txt", "w");
|     fprintf(fp, "第二天 5 条\n");
|     fclose(fp);
|     return 0;
| }

step 起点：第一回拉开抽屉，方式是 w
at: 4
say: 第 4 行是第一回**拉开抽屉**：`fopen("dangan.txt", "w")`。括号里第二样写的就是打开方式 —— `"w"`。这一下拉开之后，册子是**空的**：`"w"` 一边拉开、一边先把它上头原来的字擦干净（这回册子本来就不在，等于新建一本空的）。
meow: 拉开抽屉，册子是空的喵～
pose: expect
册子叫 = dangan.txt
抽屉 = 拉开着，方式 w
册子上写着 = （空的）
兜里没落下的字 = 无

step 先把第一笔字写下去
at: 5
say: `fprintf(fp, "第一天 3 条\n")` —— 跟 `printf` 一比，它多喂了一样东西：**往哪本册子上写**（那个 `fp`）。可这一下**还不等于字已经落到册子上**：翻译官喵先把它揣进兜里攒着，所以面板上「册子上写着」这一格这会儿还没动。
meow: 字先揣进兜里，攒着喵～
pose: busy
册子叫 = dangan.txt
抽屉 = 拉开着，方式 w
册子上写着 = （空的）
兜里没落下的字 = 第一天 3 条

step fclose：关抽屉，兜里的字这才落下去
at: 6
say: `fclose(fp)` 是**关上抽屉**。这一下办了两件事：兜里那句「第一天 3 条」**真真切切落到册子上**了；抽屉也交还给翻译官喵，后面的活才有地方使。课文那本册子第一回跑完有字，靠的就是这一步。
meow: 抽屉一关，这句才真落进册子喵！
pose: proud
册子叫 = dangan.txt
抽屉 = 关着
册子上写着 = 第一天 3 条
兜里没落下的字 = 无

step 命门：第二回拉开，还是 w
at: 8
say: 这一行是全课的命门。第二回 `fopen("dangan.txt", "w")` 一拉开，**第一回写的那句当场就没了** —— 撕掉的时机不是「你写下新字的那一下」，而是**拉开抽屉的这一下**：整本册子从头清空。所以那本册子最后只剩第二天的字。
meow: 又是 w！这一拉开，昨天那条被撕掉啦喵！
pose: think
册子叫 = dangan.txt
抽屉 = 拉开着，方式 w
册子上写着 = （刚被撕空）
兜里没落下的字 = 无

step 再把第二笔揣进兜里
at: 9
say: `fprintf` 这回揣的是「第二天 5 条」。面板上「册子上写着」还是空的 —— 册子早被撕干净了，而这句新字**照旧先在兜里待着**，得等关抽屉那一下才落下去。
meow: 第二天的字也先揣兜里喵～
pose: busy
册子叫 = dangan.txt
抽屉 = 拉开着，方式 w
册子上写着 = （刚被撕空）
兜里没落下的字 = 第二天 5 条

step 收工关上：册子上只剩这一行
at: 10
say: 第二次 `fclose`，抽屉关上，「第二天 5 条」落进册子。**册子上现在只有这一行** —— 第一天那条再也找不回来了，它在第 8 行那一下就已经没了。想让先写的字留住，第二回拉开就得换个方式（下面那段就是这么改的）。
meow: 只剩第二天这一行，第一条回不来了喵……
pose: soothe
册子叫 = dangan.txt
抽屉 = 关着
册子上写着 = 第二天 5 条
兜里没落下的字 = 无
```

想把前面的留住，第二次要用 `"a"`：

```c
#include <stdio.h>

int main(void) {
    FILE *fp = fopen("dangan.txt", "w");
    fprintf(fp, "第一天 3 条\n");
    fclose(fp);

    fp = fopen("dangan.txt", "a");
    fprintf(fp, "第二天 5 条\n");
    fclose(fp);

    fp = fopen("dangan.txt", "r");
    char line[64];
    while (fgets(line, sizeof(line), fp) != NULL) {
        printf("%s", line);
    }
    fclose(fp);
    return 0;
}
```

```text
第一天 3 条
第二天 5 条
```

三种打开方式，记住这条分界线就够了：

| 打开方式 | 意思 |
|---|---|
| `"r"` | **只读**。册子上的字一个字都不动；册子要是不在，叼回来的就是 `NULL` |
| `"w"` | **写**。拉开的那一刻，**原来写的字全被撕掉**，从头写起；册子不在就新建一本 |
| `"a"` | **接着写**。保留原来的字，在停笔的地方往下写；册子不在就新建一本 |

## 三、一行一行读：`fgets`

册子要是几百行，本喵更想**一行一行看**。这时候用 `fgets`：

```c
#include <stdio.h>

int main(void) {
    FILE *fp = fopen("dangan.txt", "w");
    fprintf(fp, "第一行\n第二行\n");
    fclose(fp);

    fp = fopen("dangan.txt", "r");
    char line[64];
    int n = 0;
    while (fgets(line, sizeof(line), fp) != NULL) {
        n = n + 1;
        printf("第 %d 行：%s", n, line);
    }
    fclose(fp);
    printf("一共 %d 行\n", n);
    return 0;
}
```

```text
第 1 行：第一行
第 2 行：第二行
一共 2 行
```

`fgets(line, sizeof(line), fp)` 喂三样东西：

| 投喂 | 是什么 |
|---|---|
| `line` | 一只**碗**，用来接这一行 |
| `sizeof(line)` | 这只碗有多大 —— 一次最多接这么多个格子，**超了就只接这么多**，不会撑破碗 |
| `fp` | 从**哪本册子**上读 |

它每喊一次叼回来一行；**读到册子末尾、再没有下一行的时候，叼回来的就是 `NULL`**。所以这个绕圈的意思是「只要还叼得回一行，就接着读」。

还有个小地方值得盯一眼：`printf("第 %d 行：%s", n, line)` 里**没有写 `\n`** —— 因为 `fgets` 叼回来的那一行**末尾本来就带着一个换行符**，再加一个就多出空行了喵。

## 四、`fprintf` 与 `fscanf`：让翻译官喵替你摆格式

`fprintf` 和 `printf` 是同一招的两兄弟 —— `fprintf` 多喂一样「往哪本册子上写」：

```c
#include <stdio.h>

int main(void) {
    FILE *fp = fopen("shu.txt", "w");
    fprintf(fp, "3 5\n7 2\n");
    fclose(fp);

    fp = fopen("shu.txt", "r");
    int a, b;
    while (fscanf(fp, "%d %d", &a, &b) == 2) {
        printf("%d\n", a + b);
    }
    fclose(fp);
    return 0;
}
```

```text
8
9
```

`fscanf(fp, "%d %d", &a, &b)` 和 `scanf` 是一个脾气：**它要的不是碗里的东西，是碗在哪儿** —— 所以那两只碗前面必须写 `&`。这一条是第一堂课就打过招呼的老坑，忘了它照样会出事。

再看那句 `while (fscanf(fp, "%d %d", &a, &b) == 2)`：`fscanf` 每喊一次，**叼回来的是「这一次成功读到了几样东西」**。读到两样才算数，所以跟 `2` 比；读到册子末尾、读不到两样了，就比较不上，绕圈自然收工。

先写进去的是 `3 5`，加起来印 8；接着 `7 2`，印 9 喵。

## 五、`fwrite` 与 `fread`：把整排碗原样搬

前面三招写的都是**给人看的字**。要是本喵想搬的不是字，而是**一整排碗里的东西**呢？

```c
#include <stdio.h>

int main(void) {
    int bowl[3] = {3, 5, 7};

    FILE *fp = fopen("dangan.bin", "wb");
    if (fp == NULL) {
        printf("打不开喵\n");
        return 0;
    }
    fwrite(bowl, sizeof(int), 3, fp);
    fclose(fp);

    int back[3] = {0, 0, 0};
    fp = fopen("dangan.bin", "rb");
    if (fp == NULL) {
        printf("读不到喵\n");
        return 0;
    }
    int n = (int)fread(back, sizeof(int), 3, fp);
    fclose(fp);

    printf("读回来 %d 个数\n", n);
    for (int i = 0; i < 3; i++) {
        printf("%d\n", back[i]);
    }
    return 0;
}
```

```text
读回来 3 个数
3
5
7
```

`fwrite` 收到四样投喂，本喵按顺序念给你听：

| 投喂 | 是什么 |
|---|---|
| `bowl` | 从哪儿搬（那一排碗） |
| `sizeof(int)` | 每只碗多大 |
| `3` | 搬几只 |
| `fp` | 搬到哪本册子上 |

`fread` 是反着来的一套，四样投喂一个不多一个不少。

注意打开方式后面多了一个 `b`（`"wb"`、`"rb"`）—— 它的意思是「**这是原样搬的，不是给猫看的字**」，所以叫**二进制**。用 `"w"` 打开一本二进制册子、再拿记事本去看，你会看到一堆莫名其妙的符号，那很正常：**那本册子本来就不是写给眼睛看的**。

`fread` 叼回来的是「**这一趟真搬到了几个**」—— 本喵把它印出来，值是 3，说明三只碗都搬回来了喵。

## 六、忘了请档案管理员出场

`FILE`、`fopen`、`fprintf`、`fclose` 这一家子，全都住在头文件 `stdio.h` 家里。本喵故意把 `#include` 那一行拿掉，好让你看清没有它会报成什么样：

```c
int main(void) {
    FILE *fp = fopen("dangan.txt", "w");
    fprintf(fp, "小鱼干\n");
    fclose(fp);
    return 0;
}
```

```text
main.c:2:5: error: unknown type name 'FILE'
main.c:2:16: error: implicit declaration of function 'fopen' [-Wimplicit-function-declaration]
```

翻译官喵最上面那两句连起来是：「**`FILE` 这个名字本喵没见过**；`fopen` 也一样，没见过就先用上了。」（底下当然还跟着一串，都是从这两句牵出来的。）

它其实还很贴心 —— 真正的报错里会跟一句「`FILE` 定义在头文件 `stdio.h` 里面，加上 `#include` 大概就好了」。**看见这句提示，就别再盯着代码找错别字了**，去文件头上补那一行喵。

::: tip 猫咪提示
今天收五句话：

1. **`fopen` 拉开抽屉、`fclose` 关上抽屉**，中间的活都拿那张牌子（`fp`）去干。
2. **牌子先检查再用** —— 拉不开的时候叼回来的是 `NULL`。
3. **`"w"` 是撕掉重写，`"a"` 是接着写，`"r"` 是只读。**
4. **`fgets` 一行一行读**，读到末尾叼回 `NULL`；`fscanf` 像 `scanf` 一样**要写 `&`**。
5. **写给眼睛看的用 `fprintf`，原样搬碗里的东西用 `fwrite`**（打开方式记得带 `b`）。
:::

## 小任务

1. 建一本自己的册子 `zhangben.txt`：用 `"w"` 写上三行记录，每行末尾记得写 `\n`。
2. **关掉程序、重新开一次**（这一步是重点 —— 上一次关灯时还在的东西，这一回还在不在？），再用 `"r"` 把它读出来，一行一行印出来。
3. 用 `"a"` 再添一条进去，读出来看看原来那三条还在不在。然后把这次实验里的 `"a"` 故意改成 `"w"` 跑一遍 —— 亲眼看看原来那三条是怎么没的，看完记得改回来。
4. 先猜再跑：把第五节的 `"wb"` / `"rb"` 改成 `"w"` / `"r"`，读回来的数还对不对？猜完跑一次，再想想那个 `b` 到底管什么。

下一课本喵要教你一件很实用的事：**让程序一开口就能听你说话** —— 你在命令行上顺口说的那几样东西，程序怎么接住；接不到的时候又该怎么体面地收场喵～ 🐾
