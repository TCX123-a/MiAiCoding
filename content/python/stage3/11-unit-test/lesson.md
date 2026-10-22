---
id: python-stage3-11
lang: python
stage: 3
order: 12
title: 单元测试——给招式定期体检
tags: [测试, 断言, 代码质量]
required: ["python-stage3-10"]
crossRefs: []
estMinutes: 25
keywords: [unittest, TestCase, assertEqual, assertRaises]
---

## 钩子：改了半行，鱼干分错了

本喵有个「平分小鱼干」的招式：捞起一堆小鱼干，按猫头数分下去，除不尽的先放着。它稳稳当当地用了小半年。

昨天本喵顺手把里面一行改了改，看着挺顺眼，就没多想。结果今天分给三只猫的时候，每只猫面前出现了**一条半**的小鱼干——猫都愣住了，本喵也愣住了喵。

问题出在哪？出在**改完以后没人复查**。本喵当时确实瞄了一眼，可让人眼盯代码这件事，跟让猫盯着一盘小鱼干不许动一样不靠谱。

那有没有办法，让**招式自己报告自己坏没坏**？有喵——给招式安排**定期体检**。

## 体检是什么：喂进去知道的数，看叼回来的对不对

体检的思路特别简单：**拿确定的数喂进去，看叼回来的战利品是不是该有的那个**。

- 六条小鱼干分给两只猫，每只必须是三条——「必须是三条」就是一条**判据**。
- 七条分给两只猫，除不尽，每只也只能拿三条（半条鱼干不存在喵）。

把判据写成代码，让电脑自己去喂、自己去比，就叫**单元测试（给招式定期体检）**。往后本喵只说「体检」两个字，你脑袋里要自动把它翻译成「让招式自己报告自己对不对」喵。

体检的好处有两条，都要记住：

1. **改坏了立刻知道**，不用等下一位用户踩雷。
2. **改好了也立刻知道**——本喵修完一个毛病，怎么确认真修好了？再体检一遍，全绿就是修好了。

## 第一张体检单

Python 自带一套体检工具，住在 `unittest` 这个盒子里，**不用装**。下面这段是完整的、能直接跑的程序：

```python
import unittest, sys

def 平分(总数, 猫数):
    return 总数 / 猫数

class 平分体检(unittest.TestCase):
    def test_两只猫平分六条(self):
        self.assertEqual(平分(6, 2), 3)
    def test_除不尽时向下取整(self):
        self.assertEqual(平分(7, 2), 3)

unittest.main(testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
```

报告太长，本喵只抄要紧的几行（那行写「跑了几秒」的每次都变，就不抄了）：

```text
test_两只猫平分六条 (__main__.平分体检.test_两只猫平分六条) ... ok
test_除不尽时向下取整 (__main__.平分体检.test_除不尽时向下取整) ... FAIL
FAIL: test_除不尽时向下取整 (__main__.平分体检.test_除不尽时向下取整)
Traceback (most recent call last):
AssertionError: 3.5 != 3
FAILED (failures=1)
```

现在把这张单子拆开看：

- **`class 平分体检(unittest.TestCase)`** —— 照 `unittest.TestCase` 这张前辈猫画好的**图纸**，画一张自己的**体检单**。括号里那个 `TestCase` 不是投喂的小鱼干，它的意思是「本喵要照这张图纸画」——照它画的单子会自动带上「怎么跑、怎么记成绩、怎么打印报告」一整套家伙事，本喵只管写判据。
- **`def test_两只猫平分六条(self)`** —— 一个**体检项目**。名字**必须以 `test` 开头**：翻译官喵扫一遍单子，只把 `test` 开头的项目拎出来跑；你要是写成 `检查两只猫`，它理都不理。
- **`self.assertEqual(平分(6, 2), 3)`** —— 判据本身。`self` 是「本喵这张单子自己」，`assertEqual` 是「**要求这两样相等**」：左边是招式真跑出来的战利品，右边是本喵认定的标准答案。**不相等就红**。
- **`unittest.main(...)`** —— 喊开工。括号里那一长串是「报告请印到正文里、并且说详细点」，下一节解释为什么这么写喵。

## 读懂红报告

- **`test_两只猫平分六条 ... ok`** —— 这个项目**过了**。报告把「体检单名 + 项目名」完整念了出来，所以名字起得越清楚，红了越省事。
- **`test_除不尽时向下取整 ... FAIL`** —— 这个项目**挂了**。
- **`FAIL: test_除不尽时向下取整 (...)`** —— 挂了的是哪一个项目，再念一遍全名。
- **`AssertionError: 3.5 != 3`** —— **最值钱的一行**。它把「真跑出来的」和「该是的」并排摆着：真跑出来 `3.5`，标准答案是 `3`。
- **`FAILED (failures=1)`** —— 总账：挂了一个项目。

`3.5` 这个数一眼就露了馅：半条小鱼干。原因正是本喵把 `总数 // 猫数` 改成了 `总数 / 猫数`——`//` 是**整除**（只留整个的），`/` 会算出小数。

**要是全部通过，最后一行就只剩一句 `OK`。** 记住这三个字，往后你每天都会见到它喵。

## 全绿：成绩记在一本「体检本子」上

报告底下那句 `OK`，其实是一个小本子念出来的。体检单跑完，会把成绩记进一个 `TestResult`（体检本子）里，报告只是负责把本子念一遍。本喵当然也可以**自己翻开本子看**：

```python
import unittest

def 平分(总数, 猫数):
    return 总数 // 猫数

class 平分体检(unittest.TestCase):
    def test_两只猫平分六条(self):
        self.assertEqual(平分(6, 2), 3)
    def test_除不尽时向下取整(self):
        self.assertEqual(平分(7, 2), 3)

本子 = unittest.TestResult()
unittest.defaultTestLoader.loadTestsFromTestCase(平分体检).run(本子)
print("体检了", 本子.testsRun, "项")
print("全绿喵" if 本子.wasSuccessful() else "有红的喵")
```

```text
体检了 2 项
全绿喵
```

这段就是**修好之后**的样子（`//` 回来了），所以两项目都过。本子上有三样东西值得记住：

| 本子上的 | 意思 |
|---|---|
| `本子.testsRun` | 一共跑了几个体检项目 |
| `本子.failures` | 挂掉的项目清单（一摞挂掉的项目，`len()` 一下就知道挂了几个） |
| `本子.wasSuccessful()` | 全绿吗？真 / 假 |

## 判据不止一种：断言家族

`assertEqual` 只是最常用的一条判据。本喵写一段**故意全红**的体检单，让你看看另外几位红了分别怎么说话：

```python
import unittest, sys

def 平分(总数, 猫数):
    if 猫数 <= 0:
        raise ValueError("没有猫，分不了喵")
    return 总数 // 猫数

class 判据长什么样(unittest.TestCase):
    def test_相等(self):
        self.assertEqual(平分(9, 2), 5)
    def test_为真(self):
        self.assertTrue(平分(7, 2) >= 5)
    def test_找得到(self):
        self.assertIn("鱼", "猫粮")
    def test_该拒绝就拒绝(self):
        self.assertRaises(ValueError, 平分, 6, 2)

unittest.main(testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
```

```text
FAIL: test_该拒绝就拒绝 (__main__.判据长什么样.test_该拒绝就拒绝)
Traceback (most recent call last):
AssertionError: 4 != 5
AssertionError: False is not true
AssertionError: '鱼' not found in '猫粮'
AssertionError: ValueError not raised by 平分
FAILED (failures=4)
```

这张单子上四个项目**全红**（本喵故意写的，就为了让你看清几种判据长什么样）：

- **`assertEqual(甲, 乙)`** —— 要求相等，报告直接并排给你看两个数：`4 != 5`。（九条分给两只猫，先拿四条才符合「整除」，本喵却在标准答案里写了 5——**红的常常不是招式，是本喵自己把数记错了**。这也是体检的价值：它逼你把「该是多少」写死，写错了当场露馅。）
- **`assertTrue(某句话)`** —— 要求这句话为真，红了只说 `False is not true`。它比 `assertEqual` 含糊：只告诉你「不成立」，不告诉你**差多少**。所以能写 `assertEqual` 就别偷懒用它喵。
- **`assertIn(小东西, 一大串)`** —— 要求小东西出现在那一大串里，红了说 `'鱼' not found in '猫粮'`：在 `猫粮` 里找不到 `鱼`。查一串东西里有没有某个部件时特别好用。
- **`assertRaises(该炸的错, 招式, 喂进去的...)`** —— **要求它炸**！有些招式在特定输入下本来就该拒绝干活（没有猫，分什么鱼干），`assertRaises` 就是拿这种「该拒绝」当判据。可这条偏偏也红了，红成 `ValueError not raised by 平分`——「本喵以为它会拒绝，它却没拒绝」。为什么？因为本喵**把喂进去的数写错了**：那条判据本来该喂 `6, 0`（没有猫才对），本喵手一滑写成了 `6, 2`，于是它老老实实分了鱼干，当然不炸喵。注意它喂小鱼干的姿势：招式名和喂进去的东西是**分开排队**的，不是塞进一对括号里。

## 平时怎么跑：一行 `unittest.main()`

上面每段体检单的最后一行都写得很长，那是为了把报告引到**正文**里给你看。自己用的时候，一行就够：

```python
import unittest

class 空体检(unittest.TestCase):
    def test_一加一(self):
        self.assertEqual(1 + 1, 2)

unittest.main()
```

这段跑起来，**在正文里什么都看不到**——因为 `unittest.main()` 的报告默认走**侧渠**（跟日志走的是同一条），而本喵这边只有正文会被读走。这不是它坏了，是它的分工：报告是印给**终端里的你**看的，不是让程序接着用的数据。你自己跑的时候，终端里该出现的字样一个都不会少喵。

::: tip 猫咪提示
今天记住四件事：① **体检 = 喂已知的数，看叼回来的对不对**；② 项目名**必须 `test` 开头**，判据写 `self.assertXxx(...)`；③ 红了先看 `AssertionError` 那一行，它把「真跑出来的」和「该是的」并排摆着；④ 修完必须**再跑一遍**，全绿才算修好喵。
:::

::: warn 小心喵
两个坑，都特别容易踩：

1. **别为了变绿去改体检单。** 招式分错了，该改的是招式。把标准答案改成 `3.5` 确实能让它变绿——那叫把体温计按进冰水里，病一点没好喵。
2. **只写「正常情况」的体检单，等于没体检。** 上面那个 `总数 / 猫数` 的坏法，光靠「六条分给两只猫」这一项能一路绿下去（`3.0` 和 `3` 是相等的）。真正咬住 bug 的往往是**边界**：除不尽、一个都没有、只有一个、数目大得离谱。本喵这次就是被「除不尽」那一项救回来的喵。
:::

## 小任务

本喵给你留两个：

1. 把上面那段「判据长什么样」的体检单**改成全绿**——四处都得改对：标准答案写错的那处改成真正的商；`assertIn` 里的「鱼」换成真在 `猫粮` 里出现过的字；`assertRaises` 那条喂对让它该拒绝的数。改完再跑一遍，看到 `OK` 才算数喵。
2. 给本喵这段招式补两张体检单：**一张喂正常值，一张喂边界值**（`猫数` 是 `0` 的时候你希望它怎么办？那就用 `assertRaises` 要求它拒绝干活喵）。

```python
def 平分(总数, 猫数):
    if 猫数 <= 0:
        raise ValueError("没有猫，分不了喵")
    return 总数 // 猫数
```

下一课本喵带你把一堆招式装进一个像样的猫窝：分成几间屋、外请来的帮手怎么记账、每间屋怎么配自己的柜子——都是「把作业变成工程」的活儿喵～ 🐾
