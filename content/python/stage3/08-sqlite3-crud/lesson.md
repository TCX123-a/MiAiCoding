---
id: python-stage3-08
lang: python
stage: 3
order: 9
title: 数据库操作 sqlite3
tags: [数据库, 增删改查]
required: ["python-stage3-07"]
crossRefs: []
estMinutes: 25
keywords: [sqlite3, connect, execute, commit, fetchall]
---

## 钩子：本喵的鱼干账本，写到第八页就糊了

本喵的仓库越来越热闹：原味的、海苔味的、麻辣味的，还有大肥鱼偷偷藏起来的那一批。一开始本喵拿一张纸记账：

```text
原味      3 条
海苔味    7 条
麻辣味    5 条
```

纸的好处是随手就能写。可它有三个躲不开的麻烦喵：

1. **查起来费劲**：账本记到八百行，本喵想问「海苔味还剩几条」，只能从头一行行捋到尾。
2. **改起来危险**：划掉旧数字、写上新的，手一抖就涂花了隔壁那行。
3. **两只猫不能一起记**：本喵在写、大肥鱼也在写，最后谁写的算数，全看谁先按爪子。

要是有一个**会自己记账的仓库**就好了——本喵只管说「存一条」「查一下」「把原味改成十条」，剩下的它自己去办。

这样一位仓库管家，名字叫**数据库**喵。

## 数据库：一柜子划好格子的账本

「数据库」听着吓人，其实就是**一本（或者一整柜）划好了格子的账本**。本喵把它画出来看看：

```text
名字      数量
原味      3
海苔味    7
麻辣味    5
```

三个词认一下，往后天天要用喵：

- **表**：一整张账本。一个仓库里可以摆好几张表——鱼干库存一张、客人名单一张、欠条一张。
- **行**：横着的一条，就是一个条目。「原味，3 条」是一行。
- **列**：竖着的那一格表头，比如「名字」这一列、「数量」这一列。

和纸账本最大的区别在**本喵不动手翻**。只要对它说一句**口令**，它就自己去找、自己去改。这套口令叫 **SQL**，长得像英文，念起来也像在下命令：

```text
CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)   ← 开一张新表，写好表头
INSERT INTO 库存 VALUES ('小鱼干', 3)         ← 添一行
SELECT * FROM 库存                            ← 把整张表端出来看
```

今天不背语法，只要记住一句话：**本喵说一句，管家办一件**。

## 请出管家：`sqlite3`

Python 自带一位管家，装在一个叫 `sqlite3` 的盒子里——**不用另外安装，`import` 一下就来**喵。

这位管家还特别好养活：它的整个仓库，就是**盘上的一个文件**。本喵说「拿 `小鱼干.db` 这个文件当仓库」，它就去开那个文件；文件要还不存在，它顺手给本喵建一个空的。

第一次连线，来看一段完整的：

```python
import sqlite3

con = sqlite3.connect("小鱼干.db")
cur = con.cursor()
cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")
cur.execute("INSERT INTO 库存 VALUES ('小鱼干', 3)")
con.commit()

cur.execute("SELECT * FROM 库存")
print(cur.fetchall())
con.close()
```
```text
[('小鱼干', 3)]
```

逐句拆开看喵：

- **`sqlite3.connect("小鱼干.db")`** —— **跟仓库连上线**。连上之后本喵手里就多了一个 `con`（就是「连线」），往后所有的话都顺着这根线说给管家听。
- **`con.cursor()`** —— 请出**记账的爪子** `cur`。真正一笔一画去表上写字的，是这只爪子：`cur.execute(...)` 就是「**递一句口令过去，让它办**」。
- **`cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")`** —— 开一张叫 `库存` 的新表，写好两个表头：`名字`（规格 `TEXT`，放文字）和 `数量`（规格 `INTEGER`，放整数）。这两个词是**给格子写的规格**，往后别人（还有三个月后的你自己）一眼就知道这一格该放什么货。
- **`cur.execute("INSERT INTO 库存 VALUES ('小鱼干', 3)")`** —— 往表里**添一行**：名字「小鱼干」，数量 3。注意文字要用**引号**圈起来——和 `print` 一个道理，引号里才是内容。
- **`con.commit()`** —— **盖上印章**。这一句最要紧，下一节单独讲。
- **`cur.execute("SELECT * FROM 库存")`** —— 查。`SELECT` 是「端出来看看」，`*` 是「所有列都要」。
- **`cur.fetchall()`** —— 把查到的结果**一口气全叼回来**。叼回来的是一串**行**，一行是一个括号包着的小组，格子的顺序**就是本喵建表时写下的顺序**：先 `名字`、后 `数量`。所以上面印的是 `[('小鱼干', 3)]`——一个储物柜，里头装着唯一的那一行。
- **`con.close()`** —— 用完把线收好。

## 盖上印章，才算数：`commit()`

刚才那一串里，有一句看着最没用、却最能坑人的：`con.commit()`。

本喵用人话讲一遍它管什么：**你递过去的口令，管家先记在自己随身的小本子上；等你说「盖章」，才真的写进仓库。**没盖章就散场，那些改动**整批作废**。

不信？本喵让两只猫同时去同一个仓库：一只在添货，另一只来查：

```python
import sqlite3

con = sqlite3.connect("小鱼干.db")
cur = con.cursor()
cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")
con.commit()

cur.execute("INSERT INTO 库存 VALUES ('小鱼干', 3)")

看客 = sqlite3.connect("小鱼干.db")
print("盖章之前，另一只猫看到：", 看客.execute("SELECT * FROM 库存").fetchall())
看客.close()

con.commit()

看客 = sqlite3.connect("小鱼干.db")
print("盖章之后，另一只猫看到：", 看客.execute("SELECT * FROM 库存").fetchall())
看客.close()
con.close()
```
```text
盖章之前，另一只猫看到： []
盖章之后，另一只猫看到： [('小鱼干', 3)]
```

**同一行货，盖不盖章就是两个世界喵**：

- 新连上去的那只猫（`看客`）只看得到**已经盖过章**的东西。没盖章的那一行，它连影子都摸不着。
- 本喵自己这根线上的 `cur` 倒是看得见刚写的那行——因为那还只是**自己小本子上的字**，没进仓库呢。

所以有一条铁规矩：**添完、改完、删完，一定要 `con.commit()`**。忘了它，程序跑完看着一切正常，可仓库里一个字都没变——下一回打开，货没了，你都不知道该怀疑谁。

::: tip 猫咪提示
- **查不用盖章。** `SELECT` 只是「看看」，什么都没改。要盖章的是**添、改、删**这三样。
- 还有一句偷懒的写法：`with sqlite3.connect("小鱼干.db") as con:` —— 离开这个块的时候，它会**自动帮本喵盖章**。不过本喵还是习惯自己明明白白写一句 `con.commit()`，毕竟「什么时候盖的章」最好是你自己说了算喵。
:::

没盖章和盖了章，两只猫眼里的仓库差在哪儿 —— 本喵拆成一步一步，走给你看：

```demo
title: 没盖章的那一行，另一只猫连影子都摸不着
code:
| import sqlite3
|
| con = sqlite3.connect("小鱼干.db")
| cur = con.cursor()
| cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")
| con.commit()
|
| cur.execute("INSERT INTO 库存 VALUES ('小鱼干', 3)")
| print("本喵这根线上：", cur.execute("SELECT * FROM 库存").fetchall())
|
| 看客 = sqlite3.connect("小鱼干.db")
| print("另一只猫：", 看客.execute("SELECT * FROM 库存").fetchall())
|
| con.commit()
|
| 看客 = sqlite3.connect("小鱼干.db")
| print("盖章之后，另一只猫：", 看客.execute("SELECT * FROM 库存").fetchall())
| con.close()

step 请管家进屋
at: 1
say: `import sqlite3` 把这位自带管家请进来。⚠️ 到这一刻只是**人到了**：仓库的门还没开，一根线都还没连上。
meow: 管家请进门，仓库还没开喵
pose: expect
仓库里 = 还没有库存表
管家的小本子上 = 空
印章 = 还没盖
另一只猫看得到 = 还没连上来

step 跟仓库连上线
at: 3
say: `sqlite3.connect("小鱼干.db")` **跟仓库连上线**。整个仓库就是盘上这个文件：文件不在，管家顺手建一个空的。连上之后，往后的话都顺着这根线说给它听。
meow: 线连上啦，仓库是个文件喵
pose: busy
仓库里 = 还没有库存表
管家的小本子上 = 空
印章 = 还没盖
另一只猫看得到 = 还没连上来

step 请出记账的爪子
at: 4
say: `con.cursor()` 请出**记账的爪子** `cur` —— 真正一笔一画去表上写字的是它。⚠️ 爪子只是本喵手里多了一件工具，仓库里什么都还没变。
meow: 爪子请出来，随时能写字喵
pose: busy
仓库里 = 还没有库存表
管家的小本子上 = 空
印章 = 还没盖
另一只猫看得到 = 还没连上来

step 递第一句口令：开一张新表
at: 5
say: `cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")` 是**递一句口令过去**。⚠️ 递过去 ≠ 办完了：管家先把它**记在自己随身的小本子上**，仓库里这会儿**还没有这张表**。
meow: 口令递过去，先记在小本子上喵
pose: think
仓库里 = 还没有库存表
管家的小本子上 = 记着「开表」
印章 = 还没盖
另一只猫看得到 = 还没连上来

step 第一次盖章：表才真的落地
at: 6
say: `con.commit()` —— **盖章**。小本子上那句「开表」这一刻才真的写进仓库。这一下非盖不可：不盖的话，另一只猫连「库存」这张表都看不见，它连查都没得查。
meow: 盖上章，库存表真的落地了喵！
pose: proud
仓库里 = 有库存表了，表里空着
管家的小本子上 = 已经并进仓库了
印章 = 刚盖过一下
另一只猫看得到 = 还没连上来

step 递第二句口令：添一行
at: 8
say: `cur.execute("INSERT INTO 库存 VALUES ('小鱼干', 3)")` 又递一句，这回是**添一行**。⚠️ 还是那句：管家先记在小本子上 —— **仓库里现在其实一行都没有**。
meow: 添一行，照样先记小本子喵
pose: busy
仓库里 = 有库存表了，表里空着
管家的小本子上 = 记着「添一行」
印章 = 还是刚才那一下（新货没盖）
另一只猫看得到 = 还没连上来

step 本喵自己这根线上：看得见
at: 9
say: 本喵顺着自己这根线一查，**看得见**那一行 —— 因为读的就是**自己小本子上的字**。⚠️ 看得见不等于写进去了：这一行还没盖章，仓库里还是空的。
meow: 自己线上看得见，可仓库里还没喵
pose: expect
仓库里 = 有库存表了，表里空着
管家的小本子上 = 记着「添一行」
印章 = 还是刚才那一下（新货没盖）
另一只猫看得到 = 还没连上来

step 另请一只猫连上来
at: 11
say: 本喵请出**另一只猫**（新的一根线）。这一条线只看得到**已经盖过章**的东西 —— 凡是还留在别人小本子上的字，它一个字都摸不着。
meow: 另请一只猫，从门口进来看喵
pose: guide
仓库里 = 有库存表了，表里空着
管家的小本子上 = 记着「添一行」
印章 = 还是刚才那一下（新货没盖）
另一只猫看得到 = 库存表在，表里是空的

step 另一只猫：一个影子都没看见
at: 12
say: 它查出来的是 `[]` —— **空的一串**。小鱼干那一行明明刚添过，可它连影子都没有。课文那句「同一行货，盖不盖章就是两个世界」，印出来就是这个样子。
meow: 空的！那一行它压根看不见喵
pose: think
仓库里 = 有库存表了，表里空着
管家的小本子上 = 记着「添一行」
印章 = 还是刚才那一下（新货没盖）
另一只猫看得到 = 看到 []

step 盖章：小本子上的字这一刻才进仓库
at: 14
say: `con.commit()` —— 这一下**盖章**，把「添一行」真的写进仓库。这是本课最要紧的一下：添完、改完、删完不盖章，程序跑完看着一切正常，可仓库里一个字都没变。
meow: 现在盖章，字才真的进仓库喵
pose: milestone
仓库里 = 有库存表了，里面 1 行
管家的小本子上 = 已经并进仓库了
印章 = 盖过了
另一只猫看得到 = 还是 []（那只猫没再查）

step 另一只猫再看：看见了
at: 17
say: 重新连一次、再查一遍，这回它看到了 `[('小鱼干', 3)]`。⚠️ 它看见的是**盖过章之后**的仓库 —— 所以那条铁规矩别忘了：添完、改完、删完，一定要 `con.commit()`。
meow: 看见啦，这下两只猫一个世界喵！
pose: yay
仓库里 = 有库存表了，里面 1 行
管家的小本子上 = 已经并进仓库了
印章 = 盖过了
另一只猫看得到 = 看到 [('小鱼干', 3)]
```

## 查：`SELECT`，和「行序」这件小事

货多了，「端出来看看」就得带点讲究。本喵想看库存还剩多少，还想**从多到少**摆好：

```python
import sqlite3

con = sqlite3.connect("小鱼干.db")
cur = con.cursor()
cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")
cur.executemany("INSERT INTO 库存 VALUES (?, ?)", [("原味", 3), ("海苔味", 7), ("麻辣味", 5)])
con.commit()

cur.execute("SELECT 名字, 数量 FROM 库存 ORDER BY 数量 DESC")
for 名字, 数量 in cur:
    print(f"{名字}：{数量} 条")
con.close()
```
```text
海苔味：7 条
麻辣味：5 条
原味：3 条
```

新东西有两个喵：

- **`cur.executemany(口令, 一串行)`** —— **一口气添好多行**。口令里那两个 `?` 是投喂口（下一节细讲），后面那串储物柜里每一小份都对上一条货。
- **`ORDER BY 数量 DESC`** —— **排排坐的规矩**：按 `数量` 这一列摆，`DESC` 是从大到小，换成 `ASC` 就是从小到大。想按名字摆就写 `ORDER BY 名字`。

再说说那个 `for 名字, 数量 in cur`：本喵**一行一行地叼**，每叼回一行，就把那一行里两格分别接到 `名字` 和 `数量` 两个小仓库里。行数多的时候，这种「叼一行、办一行」的写法比 `fetchall()` 省地方喵。

::: warn 小心喵
**不写 `ORDER BY`，行序是没有保证的。**

这不是吓唬你：那些行在后头怎么摆，是管家自己的事——在你机器上它今天可能碰巧按**进货的先后**给你，换一台机器、换一个版本，顺序就可能是别的样子。**而你程序印出来的东西会跟着变**，代码却一个字没改。

所以规矩很简单：**要印好几行，就得写 `ORDER BY`**。或者在 Python 里自己动手摆好（`for 行 in sorted(行们)` 也行）。只有「不关心顺序、只关心有没有这一行」的时候，才可以不写喵。
:::

## 投喂口 `?`：别把货缝进口令里

上面那个问号，是本课最值钱的一件东西，单独讲喵。

本喵想让管家「只把海苔味那一行端出来」，就得把「海苔味」这个名字告诉它。有两种说法：

**笨说法**：拿 f-string 把名字**缝**进口令里，拼成一句完整的话——

`cur.execute(f"SELECT * FROM 库存 WHERE 名字 = '{名字}'")`

**好说法**：口令里留一个**投喂口** `?`，货从旁边递进去：

```python
import sqlite3

con = sqlite3.connect("小鱼干.db")
cur = con.cursor()
cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")
cur.executemany("INSERT INTO 库存 VALUES (?, ?)", [("原味", 3), ("海苔味", 7)])
con.commit()

cur.execute("SELECT 数量 FROM 库存 WHERE 名字 = ?", ("海苔味",))
行 = cur.fetchone()
print(行[0])
con.close()
```
```text
7
```

- 口令里那个 `?` 就是**投喂口**，位置对着 `名字` 这一格。
- **货放在第二个逗号后面**，用一对括号包好递过去：`("海苔味",)`。
- **`cur.fetchone()`** —— 只叼**一行**回来（`fetchall()` 是整盘端走，`fetchone()` 是叼一口）。
- **`行[0]`** —— 这一行里第一格的货。口令里本喵只点了一道菜（`数量`），所以叼回来的一行只有一格，`行[0]` 就是它。

这种做法有个正经名字，叫参数化查询（投喂口写法）。它好在哪？先看看笨说法真跑一遍的下场喵：

```python
import sqlite3

con = sqlite3.connect("小鱼干.db")
cur = con.cursor()
cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")
con.commit()

名字 = "大肥鱼's 私藏"
cur.execute(f"SELECT * FROM 库存 WHERE 名字 = '{名字}'")
print(cur.fetchall())
con.close()
```
```text
Traceback (most recent call last):
    cur.execute(f"SELECT * FROM 库存 WHERE 名字 = '{名字}'")
sqlite3.OperationalError: near "s": syntax error
```

**看清楚管家在气什么喵**：缝出来那句话里有**两个**撇号，而它的规矩是「撇号和撇号之间才算一串内容」，一下就配错了对，剩下半截 `s 私藏'` 它读不懂，只好撂挑子。

这里头藏着两件事，一件是「会崩」，另一件更吓人：

- **会崩**：名字里只要带一个撇号，程序当场断气。而客人名字、商品名、文件路径里带撇号太常见了——英文名 O'Brien 就是一个。
- **更吓人**：只要有人往名字里塞一句**装作口令的话**（比如塞半截 `'; DELETE FROM 库存; --` 进去），缝出来的那句话就会被管家**当真的口令执行**。你的仓库会被他动手清空，而你只是「查了个名字」。

换成投喂口，这两件事一件都不会发生：**从 `?` 递进去的货，永远是「货」，管家绝不会把它当口令读。**理由只有这一条，但足够充分了喵。

递货的时候有两条规矩，最好现在就记住喵。

### 规矩一：只有一个货时，括号里的逗号不能少

`("海苔味",)` 对，`("海苔味")` 错。后者只是「一个括号包着一串字」，不是本喵要递的那一份。递错了管家会当场跟你吵：

```python
import sqlite3

con = sqlite3.connect("小鱼干.db")
cur = con.cursor()
cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")
cur.executemany("INSERT INTO 库存 VALUES (?, ?)", [("原味", 3), ("海苔味", 7)])
con.commit()

cur.execute("SELECT 数量 FROM 库存 WHERE 名字 = ?", "海苔味")
print(cur.fetchall())
con.close()
```
```text
Traceback (most recent call last):
    cur.execute("SELECT 数量 FROM 库存 WHERE 名字 = ?", "海苔味")
sqlite3.ProgrammingError: Incorrect number of bindings supplied. The current statement uses 1, and there are 3 supplied.
```

管家说的是「**本喵只留了一个投喂口，你怎么递上来三份**」——因为它把 `"海苔味"` 这串三个字的项链**一个字一个字拆开**递了。逗号一补，三份重新变回一份，就对了。

### 规矩二：口令里有两个 `?`，就得递两份

`cur.execute("... VALUES (?, ?)", ("原味", 3))`——两格货，两份递上。数不对，管家照样跟你吵。

## 改一改、删一删

添和查讲完了，还剩两样：**改** 和 **删**。

```python
import sqlite3

con = sqlite3.connect("小鱼干.db")
cur = con.cursor()
cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")
cur.executemany("INSERT INTO 库存 VALUES (?, ?)", [("原味", 3), ("海苔味", 7), ("麻辣味", 5)])
con.commit()

cur.execute("UPDATE 库存 SET 数量 = ? WHERE 名字 = ?", (10, "原味"))
print("改了几行：", cur.rowcount)

cur.execute("DELETE FROM 库存 WHERE 数量 < ?", (6,))
print("删了几行：", cur.rowcount)

cur.execute("SELECT * FROM 库存 ORDER BY 数量")
print(cur.fetchall())
con.close()
```
```text
改了几行： 1
删了几行： 1
[('海苔味', 7), ('原味', 10)]
```

- **`UPDATE 库存 SET 数量 = ? WHERE 名字 = ?`** —— 「**改**」。读作：在 `库存` 这张表里，把 `名字` 是第二份的那一行的 `数量` 改成第一份。
- **`DELETE FROM 库存 WHERE 数量 < ?`** —— 「**删**」。读作：把 `数量` 少于这一份的那些行删掉。
- **`cur.rowcount`** —— 刚才那一下**动了几行**。改完删完顺手看一眼它，能救命：你以为只动了一行，它却告诉你「动了 3 行」，那就说明 `WHERE` 写漏了。
- 最后那句 `SELECT ... ORDER BY 数量` 印出剩下的货：麻辣味那行（5 条）被删掉了，原味那行被改成 10 条，从小到大摆好——正是上面那两句的结果。

::: warn 小心喵
**`UPDATE` 和 `DELETE` 后面一定要带 `WHERE`**，除非你真的想把整张表连根拔掉。

`cur.execute("DELETE FROM 库存")` 这句语法一点问题都没有，管家会**安安静静地把整张表清空**——不报错、不提问、不给你后悔的机会。

不过后悔药还是有一颗的：**只要还没 `con.commit()`，`con.rollback()` 就能把这批改动整批退回去**，货一条不少。所以本喵干活的老规矩是——先看一眼 `rowcount` 对不对，再决定盖不盖章喵。
:::

## 一句话口令表

| 本喵想干的事 | 递过去的口令 |
|---|---|
| 连上仓库 | `con = sqlite3.connect("小鱼干.db")` |
| 请出记账的爪子 | `cur = con.cursor()` |
| 开一张新表 | `cur.execute("CREATE TABLE 库存 (名字 TEXT, 数量 INTEGER)")` |
| 添一行 | `cur.execute("INSERT INTO 库存 VALUES (?, ?)", ("小鱼干", 3))` |
| 一口气添好多行 | `cur.executemany(口令, [第一份, 第二份])` |
| 端出来看 | `cur.execute("SELECT * FROM 库存")` |
| 只看某几列 | `cur.execute("SELECT 名字, 数量 FROM 库存")` |
| 只挑符合条件的 | `... WHERE 名字 = ?` + 递一份货 |
| 摆好顺序 | `ORDER BY 数量 DESC`（从大到小）/ `ASC`（从小到大） |
| 改一改 | `cur.execute("UPDATE 库存 SET 数量 = ? WHERE 名字 = ?", (10, "原味"))` |
| 删一删 | `cur.execute("DELETE FROM 库存 WHERE 数量 < ?", (6,))` |
| 盖上印章 | `con.commit()` |
| 退回没盖章的改动 | `con.rollback()` |

## 小任务

本喵把三只猫的猫粮碗记进仓库，还顺手筛掉了剩得少的：

```python
import sqlite3

con = sqlite3.connect("猫粮.db")
cur = con.cursor()
cur.execute("CREATE TABLE 猫粮碗 (名字 TEXT, 剩余 INTEGER)")
cur.executemany("INSERT INTO 猫粮碗 VALUES (?, ?)", [("小橘", 4), ("狸花", 9), ("三花", 2)])
con.commit()

cur.execute("SELECT * FROM 猫粮碗 WHERE 剩余 > ? ORDER BY 剩余 DESC", (3,))
for 名字, 剩余 in cur:
    print(f"{名字} 还有 {剩余} 口")
con.close()
```
```text
狸花 还有 9 口
小橘 还有 4 口
```

**试着改一改**：

1. 把门槛从 `3` 换成 `5`，再跑一遍——三花（2 口）和小橘（4 口）是不是都被筛掉了？
2. 把 `ORDER BY 剩余 DESC` 的 `DESC` 去掉，再跑一遍。印出来的顺序会变成什么样？先猜再跑喵。
3. 在最后补两句：`cur.execute("DELETE FROM 猫粮碗 WHERE 名字 = ?", ("三花",))` 和 `con.commit()`，跑完看看还剩几只猫的碗。再把那句 `con.commit()` 换成 `con.rollback()` 跑一遍——三花是不是又回来了？（没盖章的改动，随时退得回去喵。）

下一课，本喵要教你怎么让程序**把一路上发生的事自己记在小本子上**，还有跑歪的时候怎么顺着痕迹，把那只捣乱的小虫揪出来喵～ 🐾
