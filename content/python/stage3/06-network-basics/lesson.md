---
id: python-stage3-06
lang: python
stage: 3
order: 7
title: 网络编程初步——隔着鱼塘传小鱼干
tags: [网络, HTTP, 第三方库]
required: ["python-stage3-05"]
crossRefs: []
estMinutes: 30
keywords: [socket, requests, http, status_code]
---

## 钩子：小鱼干怎么送到鱼塘那头？

本喵蹲在鱼塘这边，脚边摆着一碟刚晒好的小鱼干。鱼塘那头，好朋友大肥鱼——那条圆滚滚的蓝色大鱼——探出脑袋：「本喵也想吃喵～」

麻烦来了：本喵扔不过去。太远了，而且本喵准头一向不行。

可鱼塘两边的人，明明隔着水也能说上话呀。电脑和电脑之间也是这样：隔着网线、隔着好几座楼、隔着半个地球，照样能互相递东西。这门手艺在书上叫 **网络编程（隔着鱼塘传小鱼干）** —— 名字听着唬人，拆开看只有一件事：**这边喊一声，那头听得见，还能把小鱼干递过去。**

今天本喵就把这两件事都办了：先教你**怎么喊**（自己拉一根线），再教你**怎么按规矩递东西**（点菜单和回执）。

## 门牌号和窗口：两只猫怎么找到对方

要让远处的猫找到你，得先有**门牌号**。

本喵家的门牌号是四组数字用点隔开的一串东西，书面上叫 **IP 地址**。里面有一张特别的门牌号：`127.0.0.1` —— 它不代表任何一只远处的猫，它的意思是「**本喵自己**」。对着镜子敲自己的门，就是它喵。这一课的例子全都用它：不用真的连到别人家，跑一百遍结果都一样。

光有门牌号还不够。一台电脑上同时开着浏览器、聊天软件、还有本喵的摊子——东西寄到门口，得知道**从哪个窗口递进去**。这个窗口的编号，就叫**端口**。

所以摆摊的时候，本喵会写下一对东西：门牌号加窗口号，写成 `("127.0.0.1", 0)` 这个形状 —— 一对括号里装着两样。

前面那半是「本喵自己」的门牌，后面那个 `0` 是「**让系统随便挑一个此刻空着的窗口**」。

为什么不让本喵自己挑一个数字？万一挑中的窗口已经被别的程序占了呢？交给系统挑，就永远不会撞车。代价是——**窗口号每次都不一样**。

✨ 记住这一点，你就明白本喵后面为什么从来**不把窗口号印出来**了：本喵写的例子都是让程序自己拿着这个窗口号去敲门，印出来的是一个每次都在变的数字，抄进笔记里明天就对不上了喵。

## 拉一根线：`socket`

Python 里拉这根线用的招式叫 `socket`，它是**自带的**，不用装任何东西。`socket` 本来的意思是「插座」，可在本喵这儿它更像一根**电话线**：一头拿起来拨号，另一头接听，接通了就能你一句我一句。

先看最小的一段：两只猫，一问一答。

```python
import socket

守门猫 = socket.socket()
守门猫.bind(("127.0.0.1", 0))
守门猫.listen(1)

来访猫 = socket.socket()
来访猫.connect(守门猫.getsockname())
来访猫.sendall("小鱼干".encode("utf-8"))

连接, 客人地址 = 守门猫.accept()
print("收到:", 连接.recv(1024).decode("utf-8"))

连接.close()
来访猫.close()
守门猫.close()
```

```text
收到: 小鱼干
```

一行行拆开看喵：

- `socket.socket()` —— 拿起一只听筒。守门猫拿起一只，来访猫也拿起一只。
- `守门猫.bind(("127.0.0.1", 0))` —— 把听筒**挂在自己家门牌的某个窗口上**，开始等客人。
- `守门猫.listen(1)` —— 竖起耳朵，先让 1 位客人在门口排着。
- `来访猫.connect(守门猫.getsockname())` —— **主动拨号**。`getsockname()` 是问守门猫「你挂在哪个窗口上」，把答案直接递过去——这样窗口号就不用印出来啦。
- `来访猫.sendall("小鱼干".encode("utf-8"))` —— 说话。注意中间那一步 `encode("utf-8")`：**线上跑的是一串字节**，得先把话翻成字节，才递得出去。
- `连接, 客人地址 = 守门猫.accept()` —— **接听**。它一次叼回来两样：一根**专门连着这位客人**的线，和这位**客人的地址**。往后摊主就用这根线和这位客人说话，不用再站在门口了。
- `连接.recv(1024)` —— 从那根线上听，一次最多听 1024 个字节。听到的还是字节，`decode("utf-8")` 把它翻回话。
- 三个 `close()` —— 挂断。

本喵把这一问一答拆成一步一步，走给你看：

```demo
title: 一问一答是怎么走完的
code:
| import socket
|
| 守门猫 = socket.socket()
| 守门猫.bind(("127.0.0.1", 0))
| 守门猫.listen(1)
|
| 来访猫 = socket.socket()
| 来访猫.connect(守门猫.getsockname())
| 来访猫.sendall("小鱼干".encode("utf-8"))
|
| 连接, 客人地址 = 守门猫.accept()
| print("收到:", 连接.recv(1024).decode("utf-8"))
|
| 连接.close()
| 来访猫.close()
| 守门猫.close()

step 守门猫先拿起一只听筒
at: 3
say: `socket.socket()` 就是「拿起一只听筒」。守门猫拿起一只 —— 此刻它还没有门牌、没有窗口，谁也找不到它。
meow: 听筒拿好了，还没挂上喵～
pose: expect
手里的线 = 守门猫：一只刚拿起的听筒
候客区 = （还没摆）
听到的话 = （还没听）

step 把听筒挂到自家门牌的某个窗口上
at: 4
say: `bind(("127.0.0.1", 0))` —— 门牌是「本喵自己」，后面的 `0` 是**让系统随便挑一个此刻空着的窗口**。所以窗口号每次都不一样，本喵从来不印它。
meow: 挂上窗口，等着客人喵～
pose: busy
手里的线 = 守门猫：听筒挂上了窗口
候客区 = （还没摆）
听到的话 = （还没听）

step listen：竖起耳朵，门口摆一个候客区
at: 5
say: `listen(1)` 是竖起耳朵，并在门口摆一个**候客区**：先让 1 位客人排着。这个候客区是后面「先拨号、后接听」也能行的关键。
meow: 耳朵竖起来，候客区摆好喵！
pose: expect
手里的线 = 守门猫：听筒挂上了窗口
候客区 = 摆好了，空着
听到的话 = （还没听）

step 来访猫也拿起一只听筒
at: 7
say: 换来访猫这一边：`socket.socket()` 也拿起一只听筒。两只猫各有一只，谁也不欠谁。
meow: 来访猫也拿好听筒喵～
pose: expect
手里的线 = 守门猫挂着听筒；来访猫也拿起了听筒
候客区 = 摆好了，空着
听到的话 = （还没听）

step 拨号：来访猫主动敲门
at: 8
say: `connect(守门猫.getsockname())` 是**主动拨号**。`getsockname()` 是问守门猫「你挂在哪个窗口上」，把答案直接递过去 —— 这样窗口号就不用印出来了。
meow: 拨通啦，两头连上线喵！
pose: busy
手里的线 = 一根线上连着两家（拨通了）
候客区 = 门口来了一位客人
听到的话 = （还没听）

step 说话：把话翻成字节递过去
at: 9
say: `sendall("小鱼干".encode("utf-8"))` —— **线上跑的是一串字节**，得先把话翻成字节才递得出去。注意此刻守门猫**还没有接听**，这句话先在候客区里排着，丢不了。
meow: 话变成字节，先排队等着喵！
pose: busy
手里的线 = 一根线上连着两家（拨通了）
候客区 = 排着 1 位客人，话先搁在里面
听到的话 = （还没听）

step 接听：一次叼回两样
at: 11
say: `accept()` 是**接听**。它一次叼回两样：一根**专门连着这位客人**的线，和这位**客人的地址**。往后就用这根线和这位客人说话，不用再站在门口了。
meow: 接听！专线拿到手喵～
pose: yay
手里的线 = 守门猫多了一根「专线」（只连着这位客人）
候客区 = （空出来了）
听到的话 = （还没听）

step 顺着线听：听到的还是一串字节
at: 12
say: `连接.recv(1024)` 从那根专线上听，一次最多听 1024 个字节。**听到的东西现在还不能读** —— 它是线上跑的那串字节。
meow: 听见一堆字节，还没翻喵！
pose: busy
手里的线 = 守门猫多了一根「专线」（只连着这位客人）
候客区 = （空出来了）
听到的话 = b'\xe5\xb0\x8f...'（9 个字节）

step 翻回人话才印得出来
at: 12
say: `.decode("utf-8")` 把字节翻回本喵的话，`print` 才印得出「收到: 小鱼干」。**收到的东西是字节，看懂要自己翻。**
meow: 翻成人话，小鱼干收到喵！
pose: proud
手里的线 = 守门猫多了一根「专线」（只连着这位客人）
候客区 = （空出来了）
听到的话 = 小鱼干

step 挂断
at: 14
say: 该收摊了：连着客人的那根线、来访猫的听筒、守门猫的听筒，**三个 `close()` 一个不落** —— 线用完就得挂断，不能让它在门口空挂着。
meow: 三根线都挂断，收摊喵～
pose: proud
手里的线 = 三根都挂断了
候客区 = （收摊了）
听到的话 = 小鱼干
```

**时机就这一条**：拨号、递话都可以**排在接听前面**（有候客区接着），而本喵真正把话拿到手里，是 `accept()` 之后顺着专线 `recv` 才做到的。

::: warn 小心喵
上面代码里有个**顺序有点怪**的地方：明明是来访猫先拨号，守门猫后接听，怎么也行？

因为本喵把两只猫塞进了同一个程序里喵。现实里守门猫会一直停在 `accept()` 那儿等，拨号一到它就醒过来。而且线上有个「候客区」：客人 `connect()` 成功了，话就先递过去排着，摊主晚一点接听也丢不了。
:::

顺便记住这张招式表，往后看别人的代码够用了：

| 写下这一句 | 它干了什么 |
|---|---|
| `socket.socket()` | 拿起一只听筒 |
| `.bind((门牌, 窗口))` | 把听筒挂在自己家的某个窗口上 |
| `.listen(1)` | 竖起耳朵，让客人先在门口排队 |
| `.connect(地址)` | 主动拨号 |
| `.accept()` | 接听，叼回「连着客人的线」和「客人的地址」 |
| `.sendall(字节)` | 顺着线说话 |
| `.recv(1024)` | 顺着线听 |
| `.close()` | 挂断 |

::: tip 猫咪提示
到这儿你已经会「通话」了。但光会通话还不够 —— 要是每只猫都自己发明一套说法（先问好还是先报价？话多长算说完？），那谁也听不懂谁。所以猫猫们一起定了**说话的规矩**，这就是下一节要讲的 HTTP 喵。
:::

## HTTP：一张点菜单，一张回执

`HTTP` 这份规矩简单得出奇：**客人递一张点菜单过来（请求），摊主回一张回执过去（响应）。** 就这两件事。

而且点菜单和回执都是**一行行大白话**，一行一条，谁都能读。本喵这就摆个摊子，让摊主把客人递来的那张点菜单**抄在自己的小本子上**，回头印给你看：

```python
import http.server
import threading

import requests

本子 = {}


class 小摊(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        本子["点菜行"] = self.requestline
        body = "小鱼干已送达".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


摊 = http.server.HTTPServer(("127.0.0.1", 0), 小摊)
threading.Thread(target=摊.serve_forever, daemon=True).start()

r = requests.get(f"http://127.0.0.1:{摊.server_address[1]}/fish", timeout=5, headers={"Connection": "close"})
print("小摊本子上记着:", 本子["点菜行"])
print("状态码:", r.status_code, r.reason)
print("正文的类型:", r.headers["Content-Type"])
print("正文多长:", r.headers["Content-Length"])
print("正文:", r.text)
摊.shutdown()
摊.server_close()
```

```text
小摊本子上记着: GET /fish HTTP/1.1
状态码: 200 OK
正文的类型: text/plain; charset=utf-8
正文多长: 18
正文: 小鱼干已送达
```

这段有点长，因为它同时干了摆摊和点菜两件事。拆开看喵：

**摆摊那一半**（摊主）：

- `class 小摊(http.server.BaseHTTPRequestHandler)` —— 照 `http.server` 给的**图纸**画一个摊主。`http.server` 是自带的，不用装。
- `do_GET` —— 图纸上写死的招式名：**客人用 `GET` 方式点菜时，摊主就跑这一招**。你只管往里面填「客人要什么、本喵回什么」。
- `send_response(200)` —— 回执的第一行，`200` 就是「办妥了」。
- `send_header(名字, 值)` —— 往回执上加一行头。本喵加了两行：`Content-Type` 说明正文是什么**种类**，`Content-Length` 说明正文有多少**字节**（一个中文字占三个字节，「小鱼干已送达」六个字，所以是 `18`）。
- `end_headers()` —— 「头写完了」，后面开始写正文。
- `wfile.write(body)` —— 把正文递出去。
- `log_message(...)` —— 摊主默认会往**侧渠（日志）**里唠叨每一笔访问。本喵把它的嘴捂上了：**想让人看见的东西走正文，唠叨不算**。

**点菜那一半**（客人）：

- `requests.get(门牌, timeout=5)` —— 派一位客人去敲门，要 `/fish` 这道菜。`timeout=5` 是「最多等 5 秒，等不到就别傻站着」。
- `headers={"Connection": "close"}` —— 往点菜单上多写一行「这趟说完就挂断」（就是下面拆点菜单时会讲到的那一行）。说了它，摊主回完话会自己关门 —— 本喵最后收摊（`摊.shutdown()`）才不会干等喵。
- `r.status_code` 是**状态码**，`r.reason` 是紧跟状态码的那句原因话。
- `r.headers["名字"]` 用来读回执上的某一**头**。
- `r.text` 就是**正文**——已经被翻译成人话递到爪子上了。

::: warn 小心喵
本喵印出来的这五行，全都是**每次跑都一模一样**的行。可回执上其实还有别的行，本喵**故意不印**：

- 有一行 `Date:`，记着这份回执是什么时候发出来的 —— 它**每秒钟都在变**。抄进笔记，明天就过期了。
- 请求那一张点菜单上还有一行 `Host:`，里面带着门牌和**窗口号** —— 窗口号每次都是新挑的，也没法抄。

往后你写文档、记笔记、贴日志，遇到带时刻或者带窗口号的行，学本喵这样把它跳过去，只留不会变的那几行喵。
:::

再补一句状态码：它是**三个数字**，第一位就是家族记号。

| 开头 | 意思是 | 例子 |
|---|---|---|
| `2` | 办妥了 | `200 OK`「给你」 |
| `4` | 客人这边要错了 | `404 Not Found`「本摊没有这道菜」 |
| `5` | 摊主自己捅了篓子 | `500 Internal Server Error`「摊主手滑了」 |

## 点菜单其实可以自己拼

上面摊主记下的那一行 `GET /fish HTTP/1.1`，不是 `requests` 变出来的戏法 —— **它就是一行字**，一行谁都能写的大白话。整个 HTTP 就是这么回事：**一张报文拆开，前面是几行「名字: 值」，空一行，后面才是正文。**（点菜单和回执这一整张，书面上都叫**报文**。）

本喵这回不用 `requests`，拿前面那根电话线，自己把这张点菜单拼出来递给摊主：

```python
import http.server
import socket
import threading


class 小摊(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        body = "小鱼干已送达".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


摊 = http.server.HTTPServer(("127.0.0.1", 0), 小摊)
threading.Thread(target=摊.serve_forever, daemon=True).start()

客 = socket.socket()
客.connect(摊.server_address)
客.sendall("GET /fish HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n".encode("utf-8"))

回应 = b""
while True:
    一小块 = 客.recv(4096)
    if not 一小块:
        break
    回应 += 一小块
客.close()
摊.shutdown()
摊.server_close()

文本 = 回应.decode("utf-8")
头, _, 正文 = 文本.partition("\r\n\r\n")
print("回执第一行:", 头.split("\r\n")[0])
print("正文:", 正文)
```

```text
回执第一行: HTTP/1.1 200 OK
正文: 小鱼干已送达
```

拆开看喵：

- **客人那一半**：整张点菜单就是那一串字节。里面一组组的 `\r\n` 是**换行** —— HTTP 规定每一行用「回车 + 换行」两个字符收尾，**最后空出一行**（`\r\n\r\n`）表示「头写完了，下面是正文」；本喵这回没装东西，所以正文是空的。
  - `Host:` 那一行不能少：一个门牌上可能摆着好几个摊子，得说清本喵找的是哪个。
  - `Connection: close` 是「这趟说完就挂断」。说了它，摊主回完话会自己关门，本喵才好知道**什么时候算听完**。
- **摊主那一半**：跟前面一模一样，一个字没改 —— 摊主才不管这张点菜单是 `requests` 写的还是本喵手写的，**它只认那几行字**。
- **收回应**：一直 `recv` 到**再也听不到东西**（`一小块` 变成空的）为止。因为约好了 `close`，这个圈一定会停。
- 最后 `文本.partition("\r\n\r\n")` 把回执从那个**空行**处一分为二：前面是头，后面是正文。再从头上 `split("\r\n")[0]` 取出**第一行** —— 那就是状态行。

✨ 以后看到一段手写的网络请求，别被那堆 `\r\n` 吓到：**把它当一封信来读** —— 信封上（头）写着「寄给谁、用什么方式」，空一行，后面才是信纸（正文）喵。

## `requests` 要自己装：别人给的代码为什么一跑就报错

前面派出去的那位客人叫 `requests`，它是本喵最喜欢用的点菜招式，写起来短、读回执也顺手。但有一件事必须先说清楚：

**`requests` 不是 Python 自带的，得先装。**

```text
pip install requests
```

这一行不是 Python 代码，是敲在**命令行**里的安装指令（Python 装好时 `pip` 一起装好了）。装了之后，你的 Python 才认识 `import requests` 这个名字。

这件事值得单独讲，因为它是新手最常撞的一堵墙：**别人给你的代码，你原样一跑就报错**。报错长这样喵：

```python
import 超厉害的网络库

print("这行不会被执行")
```

```text
Traceback (most recent call last):
ModuleNotFoundError: No module named '超厉害的网络库'
```

（本喵这儿得拿一个**根本没装过的名字**来演给你看：`requests` 一旦装好了，就不会再报这个错，也就演不了它了。）

看清楚这句 `ModuleNotFoundError: No module named ...`：它不是在说你写错了代码，它是在说「**这个仓库里没有叫这个名字的东西**」——十有八九就是**你还没装它**。照着名字 `pip install` 一下，多半就好了。

::: tip 猫咪提示
Python **自带**的点菜招式其实也有一个，叫 `urllib.request`，一个字母都不用装。只是它用起来啰嗦一点：回来的东西得用 `with` 接住，还要自己 `read()`、自己 `decode("utf-8")` 才拿到正文。

同一次请求，两招并排摆着看：

```python
import http.server
import threading
import urllib.request

import requests


class 小摊(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        body = "小鱼干已送达".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


摊 = http.server.HTTPServer(("127.0.0.1", 0), 小摊)
threading.Thread(target=摊.serve_forever, daemon=True).start()
门牌 = f"http://127.0.0.1:{摊.server_address[1]}"

with urllib.request.urlopen(门牌 + "/fish", timeout=5) as 回执:
    print("自带的:", 回执.status, 回执.read().decode("utf-8"))

r = requests.get(门牌 + "/fish", timeout=5, headers={"Connection": "close"})
print("第三方的:", r.status_code, r.text)

摊.shutdown()
摊.server_close()
```

```text
自带的: 200 小鱼干已送达
第三方的: 200 小鱼干已送达
```

两招要回来的东西**一模一样**，只是 `requests` 把「读正文、翻译成人话」这两步替你做了。

分工记一句就够：**`urllib.request` 不挑环境、哪台机器都能跑；要连着发好几个请求、要顺手读回执上的头，就用 `requests`。** 遇到一个陌生的环境不确定装没装，先用自带的那个保底，是不会错的。
:::

## 状态码：`200` 和 `404` 分别是什么样

光知道「有状态码」不够，本喵让摊子自己演一遍给你看：点**有的菜**和点**没有的菜**，回执有什么不同。

```python
import http.server
import threading

import requests


class 小摊(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if self.path == "/fish":
            话 = "小鱼干已送达"
            码 = 200
        else:
            话 = "本摊没有这条鱼"
            码 = 404
        body = 话.encode("utf-8")
        self.send_response(码)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


摊 = http.server.HTTPServer(("127.0.0.1", 0), 小摊)
threading.Thread(target=摊.serve_forever, daemon=True).start()
门牌 = f"http://127.0.0.1:{摊.server_address[1]}"

有鱼 = requests.get(门牌 + "/fish", timeout=5, headers={"Connection": "close"})
没鱼 = requests.get(门牌 + "/stone", timeout=5, headers={"Connection": "close"})
print(有鱼.status_code, 有鱼.text)
print(没鱼.status_code, 没鱼.text)
摊.shutdown()
摊.server_close()
```

```text
200 小鱼干已送达
404 本摊没有这条鱼
```

这里有个**容易误会**的地方，本喵要重重画一道线喵：

**`404` 不是「程序坏了」，也不是「网断了」。** 你看，两次点菜**都正常跑完了**，回执也正常收到了，只是第二次的回执上写着「没有这道菜」。

这正是 HTTP 状态码的用法：**它是一条消息的内容，不是一个错误**。所以千万**别**看到状态码不是 `200` 就当程序崩了去修代码 —— 该做的是**读一读它说了什么**：`404` 说明地址写错了（`/fish` 写成了 `/stone`），换个地址再点就是了。

::: warn 小心喵
`requests` 一般是因为「**压根没联系上**」（门牌写错、摊子没开、网断了）而当场炸掉（还有一种是：连上了、却迟迟等不到回执，到 `timeout` 那一刻也会炸一次）；**联系上了**、只是回了个 `404`，它照样把回执安安静静递给你。

所以本喵这套例子里，每一句点菜后面都跟着 `timeout=5`：等不到回执就别死等。真遇到连不上的情况，它会甩一段 `ConnectionError` 给你 —— 那才是「没联系上」。
:::

## 点菜的方式：`GET` 和 `POST`

前面点的菜，点菜单第一行都是 `GET /fish HTTP/1.1`。`GET` 的意思是**只看一看、不动手**：要什么全写在地址里，客人手里空空的。

还有一种方式叫 `POST`：**客人把东西装在肚子里带过去。** 装在哪儿？装在整张点菜单**最后面**那一段 —— 那一段叫**请求体**。前面那几行头只负责描述，请求体负责装货。

本喵摆一个只接 `POST` 的摊子，再派客人把「小鱼干」装在肚子里送过去：

```python
import http.server
import threading

import requests


class 小摊(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        长度 = int(self.headers["Content-Length"])
        送来的 = self.rfile.read(长度).decode("utf-8")
        body = ("摊主收下了：" + 送来的).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


摊 = http.server.HTTPServer(("127.0.0.1", 0), 小摊)
threading.Thread(target=摊.serve_forever, daemon=True).start()

r = requests.post(f"http://127.0.0.1:{摊.server_address[1]}/fish", data="小鱼干", timeout=5, headers={"Connection": "close"})
print("状态码:", r.status_code)
print("正文:", r.text)
摊.shutdown()
摊.server_close()
```

```text
状态码: 200
正文: 摊主收下了：小鱼干
```

跟上面那份点菜单比，只换了两个地方喵：

- **摊主那一半**：`do_GET` 换成了 `do_POST` —— **客人用哪种方式上门，摊主就跑名字对应的那一招**。而且摊主这回得先读 `self.headers["Content-Length"]`（客人报的「本喵带了多少字节」），再照着这个数字 `self.rfile.read(长度)` 去读：不先问清楚，摊主根本不知道该从身上读多长。
- **客人那一半**：`requests.get(...)` 换成了 `requests.post(...)`，多喂了一样「装在肚子里的货」。

一句话分清：**`GET` 是「本喵要这个」，`POST` 是「本喵要这个，顺便把东西给你」。**

## 一句话对照表

| 写下这一句 | 它干了什么 |
|---|---|
| `socket.socket()` | 拿起一只听筒（自带） |
| `.connect((门牌, 窗口))` | 主动拨号到别人家 |
| `.sendall(...)` / `.recv(1024)` | 顺着线说话 / 听 |
| `http.server.HTTPServer(...)` | 在本机摆一个摊子（自带） |
| `.serve_forever()` | 守着摊子，来一位客人接一位 |
| `requests.get(门牌, timeout=5)` | 派一位客人去点菜（要装） |
| `requests.post(门牌, data=...)` | 派客人把东西装在肚子里送过去（也要装） |
| `self.rfile.read(长度)` | 摊主照着客人报的字节数，把请求体读下来 |
| `r.status_code` | 回执上的状态码，`200` 就是办妥了 |
| `r.reason` | 状态码后面那句原因话 |
| `r.headers["名字"]` | 读回执上的某一行头 |
| `r.text` | 回执的正文，已经翻成人话 |
| `pip install requests` | 敲在命令行里，把第三方的招式装进来 |

## 小任务

约好了规矩，就该轮到你说话了：让摊主**回一句嘴**。

上面那根线是可以**两边都说**的。本喵让摊主收下小鱼干之后，回一句话过去：

```python
import socket

守门猫 = socket.socket()
守门猫.bind(("127.0.0.1", 0))
守门猫.listen(1)

来访猫 = socket.socket()
来访猫.connect(守门猫.getsockname())
来访猫.sendall("小鱼干".encode("utf-8"))

连接, 客人地址 = 守门猫.accept()
print("客人说:", 连接.recv(1024).decode("utf-8"))
连接.sendall("收到啦，马上送到".encode("utf-8"))

来访猫.settimeout(5)
print("摊主回:", 来访猫.recv(1024).decode("utf-8"))

连接.close()
来访猫.close()
守门猫.close()
```

```text
客人说: 小鱼干
摊主回: 收到啦，马上送到
```

注意守门猫这回是**接听之后主动说话**：它是顺着 `accept()` 叼回来的那根线说的，说的还是「先编码成字节」那一套。

**试着改一改**：

1. 把摊主回的那句话改成别的（比如「今天小鱼干打折喵」），再跑一遍 —— 客人听到的是你改过的吗？
2. 把来访猫送过去的那句话改长一点（比如「本喵要三条小鱼干，打包带走」），再跑一遍 —— 摊主收到的还是完整的一句话吗？
3. 把 `print("摊主回:", ...)` 那一行整行删掉再跑 —— 猜猜摊主说的那句话跑哪儿去了？

下一课，本喵要教你一件跟「递东西」密切相关的本事：怎么把格子柜里的东西打成一张**谁都看得懂的纸条**，隔着鱼塘寄给别的软件读 —— 那是另一个故事了喵～ 🐾
