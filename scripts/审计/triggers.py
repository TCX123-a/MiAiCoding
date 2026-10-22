# -*- coding: utf-8 -*-
"""每条报错规则的触发用例。

键是规则的 **pattern 字符串**（不是序号）—— 序号会随优先级调整而平移，
一旦平移，实测台就会拿 A 的用例去测 B，而且不报错。详见 retrigger.py 的说明。

【2026-09-14 大修】13 条「触发器写得不对」的换成实测命中的写法。
每条的旧写法为什么不行，都写在 _fix_round2.py 的 REPLACE 里 —— 那份注释是证据，别删。
"""

TRIGGERS = {
    # ── common（10 条）──
    "common": {
        "ld returned 1 exit status|collect2[.]exe|[Ll]inker command failed":
            "int f(void);\nint main(void) { f(); return 0; }\n",
        "No such file or directory":
            "#include <这个头文件不存在.h>\nint main(void) { return 0; }\n",
        "Permission denied":
            "#include <stdio.h>\nint main(void) {\n  FILE* fp = fopen(\"C:/Windows/System32/config/SAM\", \"r\");\n  if (!fp) { perror(\"open\"); return 1; }\n  return 0;\n}\n",
        "Segmentation fault|SIGSEGV":
            "int main(void) { int* p = 0; *p = 1; return 0; }\n",
        "Aborted|core dumped":
            "#include <stdlib.h>\nint main(void) { abort(); return 0; }\n",
        "out of memory|MemoryError|std::bad_alloc|Cannot allocate memory":
            "#include <stdlib.h>\n#include <stdio.h>\nint main(void) {\n  while (1) { void* p = malloc(1024 * 1024 * 256);\n    if (!p) { printf(\"out of memory\\n\"); return 1; } }\n  return 0;\n}\n",
        "timed out|timeout expired|Timeout waiting":
            "#include <stdio.h>\nint main(void) {\n  printf(\"connection timed out\\n\"); return 1;\n}\n",
        "Killed|terminated":
            "#include <stdio.h>\nint main(void) {\n  printf(\"worker terminated\\n\"); return 1;\n}\n",
        "undefined reference to [`']([^']+)'":
            "int f(void);\nint main(void) { f(); return 0; }\n",
        "is not recognized as an internal or external command|不是内部或外部命令":
            "#include <stdlib.h>\nint main(void) {\n  return system(\"__MIAI_NONEXISTENT_TOOL__\") == 0 ? 0 : 1;\n}\n",
    },
    # ── c（25 条）──
    "c": {
        "stray '([^']+)' in program":
            "int main(void) { char *s = “abc”; return 0; }\n",
        "expected ',' or ';' before '([^']+)'":
            "#include <stdio.h>\nint main(void) { int a = 1 return 0; }\n",
        "expected ';' (?:before|after) '?[^']*'?":
            "int main(void) { return 0 }\n",
        "expected declaration or statement at end of input|expected '}' at end of input":
            "#include <stdio.h>\nint main(void) { return 0;\n",
        "fatal error: ([^:]+): No such file or directory":
            "#include <这个头文件不存在.h>\nint main(void) { return 0; }\n",
        "'([^']+)' undeclared \\(first use in this function\\)":
            "#include <stdio.h>\nint main(void) { printf(\"%d\", 没声明过的); return 0; }\n",
        "implicit declaration of function '([^']+)'":
            "int main(void) { 没写原型的函数(); return 0; }\n",
        "unknown type name '([^']+)'":
            "喵型 a;\nint main(void) { return 0; }\n",
        "lvalue required as left operand of assignment":
            "int main(void) { 1 = 2; return 0; }\n",
        "expected expression before '([^']+)'":
            "int main(void) { int a = ; return 0; }\n",
        "too few arguments to function '([^']+)'":
            "int f(int a, int b);\nint main(void) { f(1); return 0; }\nint f(int a, int b) { return a + b; }\n",
        "too many arguments to function '([^']+)'":
            "int f(int a);\nint main(void) { f(1, 2); return 0; }\nint f(int a) { return a; }\n",
        "format '%([^']+)' expects argument of type '([^']+)', but argument (\\d+) has type '([^']+)'":
            "#include <stdio.h>\nint main(void) { printf(\"%d\", \"喵\"); return 0; }\n",
        "redefinition of '([^']+)'":
            "int a = 1;\nint a = 2;\nint main(void) { return 0; }\n",
        "conflicting types for '([^']+)'":
            "int f(void);\nchar f(void);\nint main(void) { return 0; }\n",
        "'([^']+)' redeclared as different kind of symbol":
            "int a;\nint a(void);\nint main(void) { return 0; }\n",
        "case label not within a switch statement":
            "int main(void) { case 1: return 0; }\n",
        "break statement not within loop or switch":
            "int main(void) { break; return 0; }\n",
        "called object '([^']+)' is not a function":
            "int main(void) { int a = 1; a(); return 0; }\n",
        "array subscript is not an integer":
            "int main(void) { int a[3]; a[\"喵\"] = 1; return 0; }\n",
        "invalid operands to binary":
            "struct S { int x; };\nint main(void) { struct S a, b; return a + b; }\n",
        "expected identifier":
            "int main(void) { int 1a = 1; return 0; }\n",
        "expected specifier-qualifier-list|expected expression":
            "struct S { 1 x; };\nint main(void) { return 0; }\n",
        "'?return'? with a value, in function returning void":
            "void f(void) { return 1; }\nint main(void) { return 0; }\n",
        "invalid suffix '([^\\x00-\\x7F]+)' on integer constant":
            "#include <stdio.h>\nint main(void) { int a = 1； return 0; }\n",
    },
    # ── cpp（32 条）──
    "cpp": {
        "'([^']+)' was not declared in this scope; did you mean 'std::([^']+)'":
            "#include <iostream>\nint main() { std::cout << endl; return 0; }\n",
        "'([^']+)' was not declared in this scope":
            "int main() { 完全没定义的东西 = 1; return 0; }\n",
        "error: expected ';' (?:before|after) '?[^']*'?":
            "struct S { int x }\nint main() { return 0; }\n",
        "a function-definition is not allowed here before '\\{' token":
            "int main() { int f() { return 1; } return 0; }\n",
        "error: expected '}' at end of input|expected declaration or statement at end of input":
            "int main() { return 0;\n",
        "error: expected primary-expression before '([^']+)'":
            "int main() { int a = ; return 0; }\n",
        "no matching function for call to '([^']+)'":
            "#include <string>\nint main() { std::string s; s.append(\"喵\", \"鱼\", \"干\"); return 0; }\n",
        "invalid conversion from '([^']+)' to '([^']+)'|cannot convert '([^']+)' to '([^']+)'":
            "int main() { int* p = 1; return 0; }\n",
        "'([^']+)' does not name a type":
            "不存在的类型 a;\nint main() { return 0; }\n",
        "'([^']+)' is not a member of '([^']+)'":
            "#include <string>\nint main() { std::string::喵喵 x; return 0; }\n",
        "call of overloaded '([^']+)' is ambiguous":
            "#include <string>\nvoid f(long);\nvoid f(double);\nint main() { f(1); return 0; }\n",
        "no match for 'operator([^']+)'":
            "#include <string>\nstruct S {};\nint main() { S a, b; a + b; return 0; }\n",
        "error: '([^']+)' cannot be used as a function":
            "int main() { int a = 1; a(); return 0; }\n",
        "error: too few arguments to function":
            "void f(int, int);\nint main() { f(1); return 0; }\nvoid f(int, int) {}\n",
        "error: return-statement with a value, in function returning 'void'":
            "void f() { return 1; }\nint main() { return 0; }\n",
        "error: void value not ignored as it ought to be":
            "void f() {}\nint main() { int a = f(); return 0; }\n",
        "fatal error: ([^:]+): No such file or directory":
            "#include <这个头文件不存在.h>\nint main() { return 0; }\n",
        "error: template argument 1 is invalid|template argument .* is invalid":
            "#include <vector>\nint main() { std::vector<1> v; return 0; }\n",
        "error: binding reference of type .* discards qualifiers":
            "int main() { const int a = 1; int& r = a; return 0; }\n",
        "error: expected initializer before '?([^'\\r\\n]+?)'?(?=[\\r\\n]|$)":
            "int main() { int a 1; return 0; }\n",
        "'([^']+)'(?: {aka '[^']+'})? has no member named '([^']+)'":
            "#include <string>\nint main() { std::string s; s.喵(); return 0; }\n",
        "unable to find numeric literal operator 'operator\"\"([^']+)'":
            "int main() { int a = 1； return 0; }\n",
        "error: expected unqualified-id before '?([^'\\r\\n]+?)'?(?: token)?(?=[\\r\\n]|$)":
            "int = 1;\nint main() { return 0; }\n",
        # ── 2026-09-16 补的 9 条（cpp 23 → 32）──
        # 每一段都在本机 g++ 16.1.0 上真跑过，报错原文抄在 cpp.json 每条的 note 里。
        "error: expected ',' or ';' before '([^']+)'":
            "#include <iostream>\nint main() {\n    int a = 1\n    std::cout << a << std::endl;\n    return 0;\n}\n",
        "error: expected declaration before '[}]' token":
            "#include <iostream>\nint main() {\n    std::cout << \"喵\" << std::endl;\n    return 0;\n}\n}\n",
        "invalid operands of types '([^']+)' and '([^']+)' to binary 'operator([^']+)'":
            "#include <iostream>\nint main() {\n    std::cout << \"你好\" + \"喵\" << std::endl;\n    return 0;\n}\n",
        # 这条是**唯一插在文件中间**的新规则（排在「was not declared in this scope」前面）：
        # 真实场景里它后面必跟两句「name/fish 没见过」，排后面会被那句抢走。理由写在 cpp.json 的 note 里。
        "non-member function '([^']+)' cannot have cv-qualifier":
            "class Cat {\npublic:\n    void show() const;\n};\nvoid show() const { }\nint main() {\n    return 0;\n}\n",
        "error: return type specification for constructor invalid":
            "#include <string>\nclass Cat {\npublic:\n    std::string name;\n    void Cat(std::string n) { name = n; }\n};\nint main() {\n    Cat c1(\"小橘\");\n    return 0;\n}\n",
        "error: too many arguments to function '([^']+)'":
            "void feed(int a) { }\nint main() {\n    feed(1, 2);\n    return 0;\n}\n",
        "'([^']+)' is private within this context":
            "class Cat {\n    int secret;\n};\nint main() {\n    Cat c;\n    c.secret = 1;\n    return 0;\n}\n",
        "error: passing '([^']+)' as 'this' argument discards qualifiers":
            "class Cat {\npublic:\n    void meow() { }\n};\nint main() {\n    const Cat c;\n    c.meow();\n    return 0;\n}\n",
        "cannot declare variable '([^']+)' to be of abstract type '([^']+)'":
            "class Animal {\npublic:\n    virtual void speak() = 0;\n};\nint main() {\n    Animal a;\n    return 0;\n}\n",
    },
    # ── java（36 条）──
    "java": {
        "symbol:[ ]+class[ ]+([A-Za-z_$][A-Za-z0-9_$]*)":
            "public class Main { public static void main(String[] a) { Foo x; } }\n",
        "symbol:[ ]+variable[ ]+([A-Za-z_$][A-Za-z0-9_$]*)":
            "public class Main { public static void main(String[] a) { System.out.println(unknownVar); } }\n",
        "symbol:[ ]+method[ ]+([A-Za-z_$][A-Za-z0-9_$]*)":
            "public class Main { public static void main(String[] a) { System.out.unknownMethod(); } }\n",
        "error: cannot find symbol":
            "public class Main { public static void main(String[] a) { unknownCall(); } }\n",
        "error: ';' expected":
            "public class Main { public static void main(String[] a) { int x = 1 } }\n",
        "class ([A-Za-z_$][A-Za-z0-9_$]*) is public, should be declared in a file named":
            "public class Foo { public static void main(String[] a) { } }\n",
        "reached end of file while parsing":
            "public class Main { public static void main(String[] a) {\n",
        "error: illegal character":
            "public class Main { public static void main(String[] a) { int x = 1； } }\n",
        "error: '[)]' expected":
            "public class Main { public static void main(String[] a) { if (true { } } }\n",
        "error: '}' expected":
            "public class Main {\n  public static void main(String[] a) {\n    int[] x = {1, 2;\n    System.out.println(x[0]);\n  }\n}\n",
        "error: illegal start of expression":
            "public class Main { public static void main(String[] a) { int x = * 1; } }\n",
        "error: not a statement":
            "public class Main { public static void main(String[] a) { 1 + 1; } }\n",
        "error: 'else' without 'if'":
            "public class Main { public static void main(String[] a) { else { } } }\n",
        "error: unclosed string literal":
            "public class Main { public static void main(String[] a) { System.out.println(\"喵); } }\n",
        "error: unclosed character literal":
            "public class Main { public static void main(String[] a) { char c = '喵; } }\n",
        "incompatible types: possible lossy conversion from double to int":
            "public class Main { public static void main(String[] a) { int x = 1.5; } }\n",
        "incompatible types: ([A-Za-z_$][A-Za-z0-9_$.<>\\[\\]]*) cannot be converted to ([A-Za-z_$][A-Za-z0-9_$.<>\\[\\]]*)":
            "public class Main { public static void main(String[] a) { String s = 1; } }\n",
        "error: missing return statement":
            "public class Main { static int f(boolean b) { if (b) { return 1; } }\n  public static void main(String[] a) { } }\n",
        "non-static (variable|method) ([A-Za-z_$][A-Za-z0-9_$]*) cannot be referenced from a static context":
            "public class Main { int x = 1;\n  public static void main(String[] a) { System.out.println(x); } }\n",
        "error: variable ([A-Za-z_$][A-Za-z0-9_$]*) might not have been initialized":
            "public class Main { public static void main(String[] a) { int x; System.out.println(x); } }\n",
        "error: package ([A-Za-z0-9_.]+) does not exist":
            "import no.such.pkg.Here;\npublic class Main { public static void main(String[] a) { } }\n",
        "method ([A-Za-z_$][A-Za-z0-9_$]*) in class ([A-Za-z_$][A-Za-z0-9_$]*) cannot be applied to given types":
            "public class Main {\n  static void f(int a, int b) { }\n  public static void main(String[] a) { f(1); }\n}\n",
        "error: no suitable method found for":
            "public class Main { public static void main(String[] a) { Math.max(\"a\", \"b\"); } }\n",
        "bad operand types for binary operator '([^']+)'":
            "public class Main { public static void main(String[] a) { String s = \"喵\" - 1; } }\n",
        "error: array required, but ([A-Za-z_$][A-Za-z0-9_$.<>\\[\\]]*) found":
            "public class Main { public static void main(String[] a) { int x = 1; x[0] = 1; } }\n",
        "Main method not found in class|error: missing method body":
            "public class Main { public static void main(String[] a); }\n",
        "java[.]lang[.]ArithmeticException: / by zero":
            "public class Main { public static void main(String[] a) { int x = 1 / 0; } }\n",
        "java[.]lang[.]ArrayIndexOutOfBoundsException: Index ([0-9]+[^\\n]*)":
            "public class Main { public static void main(String[] a) { int[] x = new int[1]; System.out.println(x[9]); } }\n",
        "java[.]lang[.]NullPointerException":
            "public class Main { public static void main(String[] a) { String s = null; s.length(); } }\n",
        "java[.]lang[.]NumberFormatException: For input string: \"([^\"]*)\"":
            "public class Main { public static void main(String[] a) { Integer.parseInt(\"喵\"); } }\n",
        "java[.]util[.]InputMismatchException":
            "import java.util.Scanner;\npublic class Main { public static void main(String[] a) {\n  Scanner sc = new Scanner(\"喵\");\n  System.out.println(sc.nextInt()); } }\n",
        "java[.]util[.]NoSuchElementException":
            "import java.util.Scanner;\npublic class Main { public static void main(String[] a) {\n  Scanner sc = new Scanner(\"\");\n  System.out.println(sc.nextInt()); } }\n",
        "java[.]lang[.]StackOverflowError":
            "public class Main { static void f() { f(); }\n  public static void main(String[] a) { f(); } }\n",
        "error: <identifier> expected":
            "public class Main {\n  void f(int) { }\n  public static void main(String[] a) { }\n}\n",
        "error: (?:[A-Za-z_$][A-Za-z0-9_$]* )?([A-Za-z_$][A-Za-z0-9_$]*) is already defined":
            "public class Main { public static void main(String[] a) { int x = 1; int x = 2; } }\n",
        "error: no suitable constructor found for|error: constructor .* cannot be applied to given types":
            "public class Main { public static void main(String[] a) { new String(1, 2, 3); } }\n",
    },
    # ── python（39 条）──
    "python": {
        "TabError":
            "if True:\n\tx = 1\n        y = 2\n",
        "IndentationError: expected an indented block":
            "if True:\nprint(\"喵\")\n",
        "IndentationError: unexpected indent":
            "x = 1\n    y = 2\n",
        "IndentationError":
            "def f():\n    x = 1\n  y = 2\n",
        "NameError: name '([^']+)' is not defined[.] Did you mean: '([^']+)'":
            "a = []\nprint(lenn(a))\n",
        "NameError: name '([^']+)' is not defined":
            "print(never_defined_thing)\n",
        "UnboundLocalError: cannot access local variable '([^']+)'":
            "def f():\n    print(x)\n    x = 1\nf()\n",
        "SyntaxError: expected ':'":
            "if True\n    print(\"喵\")\n",
        "SyntaxError: invalid character '([^']+)'":
            "print(\"喵\"）\n",
        "SyntaxError: unmatched '\\)'":
            "print(\"喵\"))\n",
        "SyntaxError: unterminated string literal":
            "print(\"喵)\n",
        "SyntaxError: Missing parentheses in call to 'print'":
            "print \"喵\"\n",
        "SyntaxError: 'return' outside function":
            "return 1\n",
        "SyntaxError: invalid syntax":
            "x = = 1\n",
        "TypeError: can only concatenate str [(]not \"([^\"]+)\"[)] to str|TypeError: unsupported operand type[(]s[)] for [+]: 'str' and '([^']+)'":
            "print(\"喵\" + 1)\n",
        "'(int|float|str|list|dict|tuple)' object is not callable":
            "str = \"喵\"\nprint(str(1))\n",
        "TypeError: list indices must be integers or slices, not ([^\\n]+)":
            "a = [1, 2]\nprint(a[\"喵\"])\n",
        "'NoneType' object is not (?:subscriptable|iterable)":
            "x = None\nprint(x[0])\n",
        "'NoneType' object has no attribute '([^']+)'":
            "x = None\nprint(x.fish)\n",
        "TypeError: ([A-Za-z_][A-Za-z0-9_]*)[(][)] missing 1 required positional argument":
            "def f(a):\n    return a\nf()\n",
        "TypeError: ([A-Za-z_][A-Za-z0-9_]*)[(][)] takes (\\d+) positional arguments? but (\\d+) (?:was|were) given":
            "def f(a):\n    return a\nf(1, 2)\n",
        "TypeError: can't multiply sequence by non-int":
            "print(\"喵\" * \"鱼\")\n",
        "TypeError":
            "print(len(1))\n",
        "ValueError: invalid literal for int[(][)] with base 10: '([^']+)'":
            "print(int(\"喵\"))\n",
        "ValueError: could not convert string to float":
            "print(float(\"喵\"))\n",
        "ValueError: too many values to unpack":
            "a, b = [1, 2, 3]\n",
        "ValueError":
            "print(\"喵\".index(\"鱼\"))\n",
        "ZeroDivisionError":
            "print(1 / 0)\n",
        "IndexError: list index out of range":
            "a = [1]\nprint(a[9])\n",
        "KeyError: '([^']+)'":
            "d = {\"a\": 1}\nprint(d[\"喵\"])\n",
        "AttributeError: '([^']+)' object has no attribute '([^']+)'":
            "\"喵\".swim()\n",
        "FileNotFoundError: [^\\n]*No such file or directory: '([^']+)'":
            "open(\"不存在的文件喵.txt\")\n",
        "ModuleNotFoundError: No module named '([^']+)'":
            "import 不存在的工具箱\n",
        "ImportError: cannot import name '([^']+)' from '([^']+)'":
            "from math import 喵喵喵\n",
        "RecursionError: maximum recursion depth exceeded":
            "def f():\n    return f()\nf()\n",
        "EOFError: EOF when reading a line":
            "input(\"说点什么喵：\")\n",
        "KeyboardInterrupt":
            "raise KeyboardInterrupt\n",
        "NameError":
            "del_me = 1\ndel del_me\nprint(del_me)\n",
        "SyntaxError: '([([{])' was never closed":
            "print(\"喵\"\n",
    },
}
