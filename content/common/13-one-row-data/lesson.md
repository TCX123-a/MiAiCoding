---
id: common-13
lang: common
stage: 0
order: 7
title: 一排贴编号的猫粮碗——一维数据（数组与列表）
tags: [数组, 列表, 一维数据]
required: [common-06]
crossRefs: [common-04, common-06, java-stage1-08]
estMinutes: 12
keywords: [数组, 列表, 下标, 遍历]
---

## 钩子：十只猫的小鱼干数，本喵的爪子写酸了喵

今天本喵要给十只猫记账：每只猫今天吃了几条小鱼干。橘猫 3 条、狸花猫 1 条、黑白花 4 条……按老办法，本喵得给**每一条数**都起个名字：

```python
cat1 = 3
cat2 = 1
cat3 = 4
print(cat1 + cat2 + cat3)
```

输出是 `8`。三只猫还好，十只猫呢？本喵得想出十个不重名的名字，还得记住「`cat7` 是黑白花那只」——爪子写酸了不说，还容易记岔喵。

问题就出在：这些数其实是**同一批东西**，全都叫「某只猫今天的小鱼干数」，却被迫各自住单间。本喵想要的是——**把它们排成一排**。

## 一排贴编号的猫粮碗

于是本喵把十个碗在架子上排成一排，从最左边开始**贴上编号**。这一整排，就叫**数组（一排贴编号的猫粮碗）**。想拿哪一碗，报编号就行喵：

```python
fish = [3, 1, 4, 1, 5]
print(fish[0])
print(fish[4])
```

输出：

```text
3
5
```

`fish` 是**这一整排**的名字——只要一个名字就够啦；方括号里的数字，就是碗上的编号。`fish[0]` 是左边第一碗，`fish[4]` 是第五碗。

## 会自己长大的储物柜

有的语言里，这一排碗的个数得先说死：「本喵要留五个碗」，之后多一个都塞不进去。而 Python 的这排更省心，它是一台**列表（会自己长大的储物柜）**——想塞就塞，柜子自己会变大：

```python
fish = [3, 1]
fish.append(4)
print(len(fish))
```

输出 `3`。`append` 是「再塞一格」的招式，`len(fish)` 是「数一数柜子里现在有几格」的招式。

## 下标从 0 开始：新手必踩的坑

**编号是从 0 开始的，不是从 1 开始。** 这是本喵见过最多人摔跟头的地方喵：

- 第一碗 → `fish[0]`
- 第二碗 → `fish[1]`
- 第五碗 → `fish[4]`

所以「最后一碗」不是 `fish[5]`（那已经掉出架子外啦，翻译官喵会气鼓鼓地拦住你），而是 `fish[len(fish) - 1]`。

编号还能用来找碗放东西：

```python
fish = [3, 1, 4]
fish[1] = 99
print(fish)
```

输出 `[3, 99, 4]`——第二碗本来躺着 1 条，现在被本喵换成了 99 条喵。

## 怎么遍历一整排

要是本喵想**把每一碗都看一遍**呢？前面学过的**循环（绕鱼干跑圈）**正好派上用场：让代码绕着这一排跑，每跑一圈取一碗：

```python
fish = [3, 1, 4, 1, 5]
total = 0
for n in fish:
    total = total + n
print(total)
```

输出 `14`。`for n in fish` 读作「把这一排里的每一碗，挨个儿交给 `n`」：第一圈 `n` 是 3，第二圈是 1……跑满五圈，`total` 就把五碗全加起来了。

下面这段把五圈**一圈不落**地走一遍。盯着「这一刻的值」那一栏看：`n` 每换一次，就是又有一只碗被叼了过来喵。

```demo
title: for n in fish 是怎么一碗碗走过去的
code:
| fish = [3, 1, 4, 1, 5]
| total = 0
| for n in fish:
|     total = total + n
| print(total)

step 先摆好这排碗
at: 1
say: 五个碗排成一排，编号从 0 到 4。碗里躺着 3、1、4、1、5。
meow: 喵～五个碗摆好啦！
pose: expect
fish = [3, 1, 4, 1, 5]
total = 还没洗
n = 还没轮到

step 洗一只小碗装总数
at: 2
say: total 这只小碗先洗成 0。等下每走过一个碗，就往它里面倒一点。
meow: 小碗洗干净，一滴不多喵～
pose: busy
fish = [3, 1, 4, 1, 5]
total = 0
n = 还没轮到

step 第 1 圈 · 把第 0 碗交给 n
at: 3
say: for 从排头开始，把第 0 碗里的 3 交给 n —— 这一圈 n 就是 3。
meow: 喵！叼回来一条小鱼干！
pose: yay
fish = [3, 1, 4, 1, 5]
total = 0
n = 3

step 第 1 圈 · 倒进小碗
at: 4
say: total + n 就是 0 + 3，把结果放回 total。现在小碗里有 3 条了。
meow: 3 条进碗，稳稳的喵～
pose: busy
fish = [3, 1, 4, 1, 5]
total = 3
n = 3

step 第 2 圈 · 轮到第 1 碗
at: 3
say: 绕回 for，下一个碗是编号 1，里面躺着 1 条。n 换成 1。
meow: 又叼一条！这条瘦瘦的～
pose: yay
fish = [3, 1, 4, 1, 5]
total = 3
n = 1

step 第 2 圈 · 倒进小碗
at: 4
say: 3 + 1 = 4，放回 total。小碗里现在 4 条。
meow: 凑成 4 条啦喵！
pose: busy
fish = [3, 1, 4, 1, 5]
total = 4
n = 1

step 第 3 圈 · 轮到第 2 碗
at: 3
say: 编号 2 的碗里是 4 条，n 换成 4。
meow: 这条最肥！叼住喵～
pose: yay
fish = [3, 1, 4, 1, 5]
total = 4
n = 4

step 第 3 圈 · 倒进小碗
at: 4
say: 4 + 4 = 8，放回 total。
meow: 8 条！本喵的碗沉了一点～
pose: busy
fish = [3, 1, 4, 1, 5]
total = 8
n = 4

step 第 4 圈 · 轮到第 3 碗
at: 3
say: 编号 3 的碗里又是 1 条 —— 这排碗里 1 出现了两次，别数岔了喵。
meow: 咦，又是一条瘦的～
pose: think
fish = [3, 1, 4, 1, 5]
total = 8
n = 1

step 第 4 圈 · 倒进小碗
at: 4
say: 8 + 1 = 9，放回 total。
meow: 9 条，还剩最后一碗喵～
pose: busy
fish = [3, 1, 4, 1, 5]
total = 9
n = 1

step 第 5 圈 · 最后一碗
at: 3
say: 编号 4 是排尾，里面 5 条。n 换成 5 —— 这是最后一圈了。
meow: 最后一碗！这条好大喵！
pose: yay
fish = [3, 1, 4, 1, 5]
total = 9
n = 5

step 第 5 圈 · 倒进小碗
at: 4
say: 9 + 5 = 14。五个碗全走完了，for 再绕回来时排尾后面已经没有碗，循环收工。
meow: 14 条！全倒进小碗啦喵！
pose: busy
fish = [3, 1, 4, 1, 5]
total = 14
n = 5

step 把总数念出来
at: 5
say: print(total) 念出小碗里的数：14。这就是五个碗加起来的总数。
meow: 答案是 14！本喵数对啦～
pose: proud
fish = [3, 1, 4, 1, 5]
total = 14
n = 5
念出来 = 14
```

要是你还想**知道现在是第几碗**，就让编号陪着一起跑：

```python
fish = [3, 1, 4]
for i in range(len(fish)):
    print(f"第 {i} 碗：{fish[i]} 条")
```

输出：

```text
第 0 碗：3 条
第 1 碗：1 条
第 2 碗：4 条
```

注意它从「第 0 碗」开始报——不是本喵数错了，是编号本来就从 0 起喵。

## 四种语言怎么取出一整排

同一个任务：把一整排数**逐个取出来**。四只翻译官喵的写法长这样，看个眼熟就行：

```compare
c::
#include <stdio.h>

int main() {
    int fish[5] = {3, 1, 4, 1, 5};
    for (int i = 0; i < 5; i++) {
        printf("%d\n", fish[i]);
    }
    return 0;
}

cpp::
#include <iostream>

int main() {
    int fish[5] = {3, 1, 4, 1, 5};
    for (int i = 0; i < 5; i++) {
        std::cout << fish[i] << std::endl;
    }
    return 0;
}

java::
public class Main {
    public static void main(String[] args) {
        int[] fish = {3, 1, 4, 1, 5};
        for (int n : fish) {
            System.out.println(n);
        }
    }
}

python::
fish = [3, 1, 4, 1, 5]
for n in fish:
    print(n)
```

四段都会把 `3 1 4 1 5` 竖着念一遍。C 和 Java 的碗得先说好摆几个，Python 的储物柜想长就长；可「报编号取一碗」和「绕圈挨个取」的心思，四个语言一模一样喵。

::: tip 猫咪提示
记三件事：**一整排东西只用一个名字**；**编号从 0 起，最后一碗的编号是 `len(...) - 1`**；**想把整排取一遍，就用绕鱼干跑圈**。
:::

::: warn 小心喵
写 `fish[5]` 这种「要第六碗」的写法，翻译官喵会当场翻脸报 `IndexError: list index out of range`——不是碗里的数不对，是架子上**根本没有这一碗**喵。落笔写编号前先用爪爪数一遍：最后一碗的编号永远是「总数 − 1」。
:::

## 小任务

把最后那段代码里的 `fish` 换成你自己的五个数，再改一改，让它只打印**偶数编号**的碗（提示：`if i % 2 == 0:`）。这一排的编号规矩，往后学哪门语言都用得上喵～ 🐾
