/**
 * JSCPP Compatibility Layer  v1.4.2
 * --------------------------------
 * 增强浏览器内 JSCPP 解释器的 C++ 兼容能力。
 *
 * 已支持：
 *  - 大量常用头文件映射（bits/stdc++.h、vector、string、algorithm 等）
 *  - 基础 auto 类型推导
 *  - vector / deque / queue / stack / pair / priority_queue（含嵌套）
 *  - range-based for + 基础迭代器（begin/end 以索引模拟）
 *  - 常用 <algorithm>：sort（greater<> / less<> / 自定义函数比较器）/ reverse /
 *    find / count / lower_bound / upper_bound / binary_search /
 *    min_element / max_element / fill / unique / accumulate
 *  - 更完整的 string 方法 shim（length/size/substr/find/append/...）
 *  - std:: 限定符展开、竞赛常用 typedef / #define
 *  - 更稳健的尖括号匹配（跳过字符串/注释）
 *
 * 依赖：全局 JSCPP（由 JSCPP.es5.min.js 提供）
 * 暴露：window.JSCPPCompat
 *
 * 限制（仍不支持）：
 *  - map / set / list 等关联容器
 *  - 真正的迭代器对象、随机访问以外的迭代器算术
 *  - 自定义比较器的完整模板、复杂 string 流、异常
 */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 工具：在字符串/字符字面量与注释之外匹配尖括号
   * ------------------------------------------------------------------ */
  function findMatchingAngleBracket(text, openIdx) {
    var depth = 1;
    var i = openIdx + 1;
    var n = text.length;
    while (i < n) {
      var ch = text[i];
      // 跳过字符串
      if (ch === '"') {
        i++;
        while (i < n) {
          if (text[i] === "\\") { i += 2; continue; }
          if (text[i] === '"') { i++; break; }
          i++;
        }
        continue;
      }
      // 跳过字符字面量
      if (ch === "'") {
        i++;
        while (i < n) {
          if (text[i] === "\\") { i += 2; continue; }
          if (text[i] === "'") { i++; break; }
          i++;
        }
        continue;
      }
      // 跳过 // 行注释
      if (ch === "/" && text[i + 1] === "/") {
        i += 2;
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      // 跳过 /* */ 块注释
      if (ch === "/" && text[i + 1] === "*") {
        i += 2;
        while (i < n - 1 && !(text[i] === "*" && text[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      if (ch === "<") depth++;
      else if (ch === ">") {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
    return -1;
  }

  function splitTopLevelComma(text) {
    var parts = [];
    var depth = 0;
    var last = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === "<" || ch === "(") depth++;
      else if (ch === ">" || ch === ")") depth--;
      else if (ch === "," && depth === 0) {
        parts.push(text.slice(last, i));
        last = i + 1;
      }
    }
    parts.push(text.slice(last));
    return parts.map(function (s) { return s.trim(); });
  }

  function sanitizeSTLAliasPart(s) {
    return s
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_]/g, "_");
  }

  function findTopLevelColon(s) {
    var depth = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === "(" || c === "[" || c === "<") depth++;
      else if (c === ")" || c === "]" || c === ">") depth--;
      else if (c === ":" && depth === 0) {
        if (s[i + 1] === ":" || s[i - 1] === ":") {
          i++;
          continue;
        }
        return i;
      }
    }
    return -1;
  }

  /* ------------------------------------------------------------------ *
   * 基础 STL 名称规范化
   * ------------------------------------------------------------------ */
  function applyJSCPPSTLCompat(code) {
    var out = code;
    out = out
      .replace(/\bstd::vector\b/g, "vector")
      .replace(/\bstd::queue\b/g, "queue")
      .replace(/\bstd::stack\b/g, "stack")
      .replace(/\bstd::deque\b/g, "deque")
      .replace(/\bstd::priority_queue\b/g, "priority_queue")
      .replace(/\bstd::string\b/g, "string")
      .replace(/\bstd::pair\b/g, "pair")
      .replace(/\bstd::make_pair\b/g, "make_pair");

    // 修复 AI / Markdown 产生的模板转义
    out = out.replace(/\\+</g, "<").replace(/\\+>/g, ">");
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 容器模板 → 普通标识符别名
   * 支持：vector / deque / queue / stack / pair / priority_queue
   * ------------------------------------------------------------------ */
  function transpileSTLContainers(code, registrations, registryMap) {
    var kwRe = /\b(vector|queue|stack|pair|deque|priority_queue)\s*</;
    var out = code;
    var guard = 0;
    while (guard++ < 3000) {
      var m = kwRe.exec(out);
      if (!m) break;
      var kw = m[1];
      var startIdx = m.index;
      var openIdx = out.indexOf("<", startIdx);
      var closeIdx = findMatchingAngleBracket(out, openIdx);
      if (closeIdx === -1) break;

      var inner = out.slice(openIdx + 1, closeIdx);
      inner = transpileSTLContainers(inner, registrations, registryMap);

      var elemsTokens =
        kw === "pair" ? splitTopLevelComma(inner) : [inner.trim()];
      // priority_queue 可能写 priority_queue<T, vector<T>, greater<T>>
      // 只取第一个元素类型，其余忽略
      if (kw === "priority_queue") {
        elemsTokens = [elemsTokens[0] || "int"];
      }

      var normElems = elemsTokens.map(function (t) {
        return t.trim().replace(/\s+/g, " ");
      });
      var canonicalKey = kw + "<" + normElems.join(",") + ">";

      var alias = registryMap[canonicalKey];
      if (!alias) {
        var base = "__" + kw + "_" + normElems.map(sanitizeSTLAliasPart).join("_");
        var uniq = base;
        var ctr = 1;
        var existing = registrations.map(function (r) { return r.alias; });
        while (existing.indexOf(uniq) !== -1) {
          uniq = base + "_" + ctr++;
        }
        alias = uniq;
        registryMap[canonicalKey] = alias;

        var kind = kw;
        if (kw === "deque") kind = "vector"; // 方法集与 vector 相同
        registrations.push({ alias: alias, kind: kind, elems: normElems });
      }

      out = out.slice(0, startIdx) + alias + out.slice(closeIdx + 1);
      // 重置正则，因为字符串已变
      kwRe.lastIndex = 0;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 初始化列表转译：Type var = {a, b}; / Type var{a, b}; / func({a, b})
   * 转为声明 + 连续 push_back / 临时变量
   * ------------------------------------------------------------------ */
  function transpileInitializerLists(code) {
    var out = code;

    // 辅助：提取平衡大括号内的内容
    function extractBraceContent(text, start) {
      var depth = 0;
      var i = start;
      while (i < text.length) {
        var ch = text[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) return { content: text.slice(start + 1, i), end: i };
        }
        i++;
      }
      return null;
    }

    // 1. 变量声明初始化列表：Type name = { ... }; / Type name{ ... };
    // 匹配：Type name = { ... } ; 或 Type name { ... } ;
    var declInitRe = /\b([A-Za-z_]\w*(?:\s*<[^>]+>)?)\s+([A-Za-z_]\w*)\s*(?:=\s*|)\{([^}]*)\}\s*;/g;
    out = out.replace(declInitRe, function (mm, type, name, content) {
      if (!content.trim()) return type + " " + name + ";";
      var elems = content.split(",").map(function (e) { return e.trim(); });
      var lines = type + " " + name + ";";
      elems.forEach(function (e) {
        if (e) lines += " " + name + ".push_back(" + e + ");";
      });
      return lines;
    });

    // 2. 函数调用中的初始化列表：push_back({...}) / insert(pos, {...}) 等
    // 简化：生成临时变量 __ilist_N
    var callInitRe = /(\b[A-Za-z_]\w*\s*\(\s*)\{([^}]*)\}\s*\)/g;
    var ilistCounter = 0;
    out = out.replace(callInitRe, function (mm, prefix, content) {
      if (!content.trim()) return prefix + ")";
      var elems = content.split(",").map(function (e) { return e.trim(); });
      var temp = "__ilist_" + (ilistCounter++);
      var decl = "vector<int> " + temp + "; "; // 类型暂用 int，实际推断复杂，依赖重载
      elems.forEach(function (e) {
        if (e) decl += temp + ".push_back(" + e + "); ";
      });
      return prefix + temp + ")";
    });

    return out;
  }
  function transpileRangeFor(code, registryMap) {
    var out = "";
    var i = 0;
    var counter = 0;
    var forRe = /\bfor\s*\(/g;

    // 简单的类型推断：从容器表达式推断元素类型
    function inferElementType(expr) {
      expr = expr.trim();
      // vector<T> / deque<T> / queue<T> / stack<T> / priority_queue<T>
      var containerMatch = expr.match(/\b(vector|deque|queue|stack|priority_queue)\s*<\s*([^<>]+(?:\s*<[^<>]*>\s*[^<>]*)*)\s*>/);
      if (containerMatch) {
        return containerMatch[2].trim();
      }
      // string
      if (/\bstring\b/.test(expr) && !/vector|deque|queue|stack|priority_queue/.test(expr)) {
        return "string";
      }
      // 数组或 C 风格数组
      if (/\[\s*\]/.test(expr) || /\[\s*\d+\s*\]/.test(expr)) {
        return "int"; // 无法确定，默认 int
      }
      return "auto"; // 无法推断
    }

    while (true) {
      forRe.lastIndex = i;
      var m = forRe.exec(code);
      if (!m) {
        out += code.slice(i);
        break;
      }
      var forStart = m.index;
      var parenOpen = forRe.lastIndex - 1;
      out += code.slice(i, forStart);

      var depth = 1;
      var j = parenOpen + 1;
      while (j < code.length && depth > 0) {
        var c = code[j];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        j++;
      }
      if (depth !== 0) {
        out += code.slice(forStart);
        i = code.length;
        break;
      }
      var headerEnd = j - 1;
      var header = code.slice(parenOpen + 1, headerEnd);
      var colonIdx = findTopLevelColon(header);

      if (colonIdx === -1) {
        out += code.slice(forStart, headerEnd + 1);
        i = headerEnd + 1;
        continue;
      }

      var declPart = header.slice(0, colonIdx).trim();
      var exprPart = header.slice(colonIdx + 1).trim();
      var cleanedDecl = declPart
        .replace(/&/g, " ")
        .replace(/\bconst\b/g, " ")
        .replace(/\bauto\b/g, " ")
        .trim();
      var declMatch = /^([\s\S]*?)([A-Za-z_]\w*)$/.exec(cleanedDecl);
      var varType = declMatch ? declMatch[1].trim() : "";
      var varName = declMatch ? declMatch[2] : "__rfe" + counter;
      
      // 改进的类型推断：优先使用显式类型，其次从容器推断，最后回退到 int
      if (!varType || varType === "auto") {
        var inferred = inferElementType(exprPart);
        if (inferred !== "auto") {
          varType = inferred;
        } else {
          varType = "int";
        }
      }

      var bodyStart = headerEnd + 1;
      while (bodyStart < code.length && /\s/.test(code[bodyStart])) bodyStart++;

      var bodyEnd;
      var bodyText;
      if (code[bodyStart] === "{") {
        var bdepth = 1;
        var k = bodyStart + 1;
        while (k < code.length && bdepth > 0) {
          if (code[k] === "{") bdepth++;
          else if (code[k] === "}") bdepth--;
          k++;
        }
        bodyEnd = k;
        bodyText = code.slice(bodyStart + 1, k - 1);
      } else {
        var sdepth = 0;
        var k2 = bodyStart;
        while (k2 < code.length) {
          var cc = code[k2];
          if (cc === "(" || cc === "{" || cc === "[") sdepth++;
          else if (cc === ")" || cc === "}" || cc === "]") sdepth--;
          else if (cc === ";" && sdepth === 0) {
            k2++;
            break;
          }
          k2++;
        }
        bodyEnd = k2;
        bodyText = code.slice(bodyStart, bodyEnd);
      }

      // 递归处理 bodyText 中的嵌套 range-for
      if (bodyText && bodyText.indexOf("for") >= 0) {
        bodyText = transpileRangeFor(bodyText, registryMap);
      }

      var idxVar = "__rfi_" + counter++;
      var replacement =
        "for (int " + idxVar + " = 0; " + idxVar + " < (" + exprPart + ").size(); " + idxVar + "++) { " +
        varType + " " + varName + " = (" + exprPart + ")[" + idxVar + "]; " +
        bodyText + " }";
      out += replacement;
      i = bodyEnd;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * map/set 模拟：将 map<K,V> / set<K> 声明的变量转为 vector 实现。
   * 仅对「实际声明为 map/set 的变量名」做方法改写，
   * 绝不影响普通数组 / vector 的下标语法。
   * ------------------------------------------------------------------ */
  function transpileMapSet(code) {
    var out = code;
    var mapVars = {};
    var setVars = {};

    // 1. 收集 map/set 声明的变量名（启发式：类型关键字后到 ;/{/= 之间的首个标识符）
    function collectVarNames(typeRe, target) {
      var m;
      typeRe.lastIndex = 0;
      while ((m = typeRe.exec(out)) !== null) {
        var rest = m[1];
        var idm = /([A-Za-z_]\w*)\s*(?:[=\(;,\)\[\{]|$)/.exec(rest);
        if (idm) target[idm[1]] = true;
      }
    }
    // 匹配 "map<K,V> <剩余声明>" —— m[1] 是类型后的剩余文本
    collectVarNames(/\b(?:std::)?(?:(?:unordered_)?map)\s*<[^;\{\}=]*>\s*([^\n;]*)/g, mapVars);
    collectVarNames(/\b(?:std::)?(?:(?:unordered_)?set)\s*<[^;\{\}=]*>\s*([^\n;]*)/g, setVars);

    var hasMaps = Object.keys(mapVars).length > 0;
    var hasSets = Object.keys(setVars).length > 0;
    if (!hasMaps && !hasSets) return out;

    // 2. 类型替换（仅类型 token，不动变量名）
    //    map<K,V>   → vector<pair<K,V>>
    //    set<K>     → vector<K>
    out = out.replace(
      /\b(?:std::)?(?:unordered_)?map\s*<\s*([^<>]*(?:<[^<>]*>[^<>]*)*)\s*,\s*([^<>]*(?:<[^<>]*>[^<>]*)*)\s*>/g,
      function (mm, k, v) {
        return "vector<pair<" + k.trim() + "," + v.trim() + ">>";
      }
    );
    out = out.replace(
      /\b(?:std::)?(?:unordered_)?set\s*<\s*([^<>]*(?:<[^<>]*>[^<>]*)*)\s*>/g,
      function (mm, k) {
        return "vector<" + k.trim() + ">";
      }
    );

    function inNames(names, n) {
      return Object.prototype.hasOwnProperty.call(names, n);
    }

    // 3. 方法改写：仅当变量名在已收集集合中才改写
    // 3a. m[key] = value;  →  m.__map_set(key, value);
    out = out.replace(
      /\b([A-Za-z_]\w*)\s*\[\s*([^\]\n]+?)\s*\]\s*=\s*([^;\n]+?);/g,
      function (mm, name, key, val) {
        if (inNames(mapVars, name)) {
          return name + ".__map_set(" + key + ", " + val + ");";
        }
        return mm;
      }
    );

    // 3b. m[key] 读 → m.__map_get(key)
    out = out.replace(
      /\b([A-Za-z_]\w*)\s*\[\s*([^\]\n]+?)\s*\]/g,
      function (mm, name, key) {
        if (inNames(mapVars, name)) {
          return name + ".__map_get(" + key + ")";
        }
        return mm;
      }
    );

    // 3c. 成员函数
    out = out.replace(/\b([A-Za-z_]\w*)\s*\.\s*find\s*\(/g, function (mm, name) {
      if (inNames(mapVars, name)) return name + ".__map_find(";
      if (inNames(setVars, name)) return name + ".__set_find(";
      return mm;
    });
    out = out.replace(/\b([A-Za-z_]\w*)\s*\.\s*count\s*\(/g, function (mm, name) {
      if (inNames(mapVars, name)) return name + ".__map_count(";
      if (inNames(setVars, name)) return name + ".__set_count(";
      return mm;
    });
    out = out.replace(/\b([A-Za-z_]\w*)\s*\.\s*erase\s*\(/g, function (mm, name) {
      if (inNames(mapVars, name)) return name + ".__map_erase(";
      if (inNames(setVars, name)) return name + ".__set_erase(";
      return mm;
    });
    out = out.replace(
      /\b([A-Za-z_]\w*)\s*\.\s*insert\s*\(\s*\{([^,]+?)\s*,\s*([^}]+?)\}\s*\)/g,
      function (mm, name, k, v) {
        if (inNames(mapVars, name)) return name + ".__map_set(" + k + ", " + v + ")";
        return mm;
      }
    );
    out = out.replace(
      /\b([A-Za-z_]\w*)\s*\.\s*insert\s*\(\s*(?:std::)?make_pair\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)\s*\)/g,
      function (mm, name, k, v) {
        if (inNames(mapVars, name)) return name + ".__map_set(" + k + ", " + v + ")";
        return mm;
      }
    );
    out = out.replace(/\b([A-Za-z_]\w*)\s*\.\s*insert\s*\(/g, function (mm, name) {
      if (inNames(setVars, name)) return name + ".__set_insert(";
      return mm;
    });

    return out;
  }

  /* ------------------------------------------------------------------ *
   * 不支持特性检测（给出友好提示）
   * ------------------------------------------------------------------ */
  function detectUnsupportedSTLUsage(code) {
    var checks = [
      {
        re: /\b(multimap|multiset|list|forward_list)\s*</,
        name: "multimap / multiset / list 等容器",
      },
      {
        // map/unordered_map/set/unordered_set 现在通过 vector 模拟支持
        re: /\b(map|unordered_map|set|unordered_set)\s*</,
        name: null, // 支持，不报错
      },
      {
        re: /\blambda\s*\[/,
        name: "Lambda 表达式",
      },
      {
        re: /\bstd::function\b/,
        name: "std::function",
      },
      {
        re: /\bstd::thread\b/,
        name: "std::thread (多线程)",
      },
      {
        re: /\bstd::mutex\b/,
        name: "std::mutex (互斥锁)",
      },
      {
        re: /\bstd::atomic\b/,
        name: "std::atomic (原子操作)",
      },
      {
        re: /\bstd::future\b|\bstd::promise\b/,
        name: "std::future/promise (异步)",
      },
      {
        re: /\bstd::filesystem\b/,
        name: "std::filesystem (文件系统)",
      },
      {
        re: /\bstd::regex\b/,
        name: "std::regex (正则表达式)",
      },
      {
        re: /\bstd::chrono\b/,
        name: "std::chrono (时间/日期)",
      },
      // begin/end 与常用 algorithm 已通过 shim + 预处理支持，不再硬拒绝
      {
        re: /\bstd::(?!cout|cin|cerr|endl|string|getline|ios|streamsize|fixed|setprecision|setw|setfill|left|right|hex|dec|oct|showpoint|noshowpoint|scientific|defaultfloat|boolalpha|noboolalpha|showbase|noshowbase|uppercase|nouppercase|unitbuf|nounitbuf|internal|size_t|ptrdiff_t|nullptr_t|int8_t|int16_t|int32_t|int64_t|uint8_t|uint16_t|uint32_t|uint64_t|intmax_t|uintmax_t|abs|fabs|sqrt|pow|sin|cos|tan|floor|ceil|round|min|max|swap|to_string)\w+/,
        name: "未支持的 std:: 功能",
      },
    ];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].re.test(code) && checks[i].name) return checks[i].name;
    }
    return null;
  }

  /**
   * 把经典 iterator 风格算法调用改写成容器方法调用，例如：
   *   sort(v.begin(), v.end())           → v.__algo_sort()
   *   reverse(v.begin(), v.end())        → v.__algo_reverse()
   *   find(v.begin(), v.end(), x)        → v.__algo_find(x)
   *   count(v.begin(), v.end(), x)       → v.__algo_count(x)
   *   lower_bound(v.begin(), v.end(), x) → v.__algo_lower_bound(x)
   *   upper_bound(v.begin(), v.end(), x) → v.__algo_upper_bound(x)
   *   binary_search(v.begin(), v.end(), x) → v.__algo_binary_search(x)
   *   fill(v.begin(), v.end(), x)        → v.__algo_fill(x)
   *   unique(v.begin(), v.end())         → v.__algo_unique()
   *   accumulate(v.begin(), v.end(), init) → v.__algo_accumulate(init)
   *   min_element / max_element 同理
   *
   * 同时把 v.begin()/v.end() 在其它上下文中保留为方法（返回索引）。
   */
  function transpileAlgorithms(code) {
    var out = code;

    /**
     * sort 比较器识别（优先级从高到低）：
     *   1. greater<T>() / greater<>()  → 降序 __algo_sort_desc
     *   2. less<T>()    / less<>()     → 升序 __algo_sort
     *   3. 命名函数 / 函数指针 cmp      → 内联选择排序，调用 cmp(a,b)
     *   4. Ident() 函数对象风格        → 按命名函数尝试（需有 bool Ident(T,T)）
     *   5. 其它未知表达式               → 升序兜底
     *
     * 命名比较函数约定（与 std::sort 一致）：
     *   bool cmp(T a, T b);  // 若 a 应排在 b 前面则返回 true
     */
    var __sortCmpId = 0;
    function emitSortWithNamedCmp(cont, cmpName) {
      var id = __sortCmpId++;
      return (
        "{ int __scn_" + id + " = (" + cont + ").size();" +
        " for (int __sci_" + id + " = 0; __sci_" + id + " < __scn_" + id + "; ++__sci_" + id + ")" +
        " for (int __scj_" + id + " = __sci_" + id + " + 1; __scj_" + id + " < __scn_" + id + "; ++__scj_" + id + ")" +
        " if ((" + cmpName + ")((" + cont + ")[__scj_" + id + "], (" + cont + ")[__sci_" + id + "]))" +
        " (" + cont + ").__swap_at(__sci_" + id + ", __scj_" + id + "); }"
      );
    }

    // 1. greater → 降序
    out = out.replace(
      /\b(?:std::)?(?:sort|stable_sort)\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*(?:std::)?greater\s*(?:<\s*[^>]*>)?\s*\(\s*\)\s*\)/g,
      "$1.__algo_sort_desc()"
    );
    // 2. less → 升序
    out = out.replace(
      /\b(?:std::)?(?:sort|stable_sort)\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*(?:std::)?less\s*(?:<\s*[^>]*>)?\s*\(\s*\)\s*\)/g,
      "$1.__algo_sort()"
    );
    // 3. 命名函数/函数指针：sort(v.begin(), v.end(), cmp)
    out = out.replace(
      /\b(?:std::)?(?:sort|stable_sort)\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\)/g,
      function (_m, cont, cmp) {
        return emitSortWithNamedCmp(cont, cmp);
      }
    );
    // 4. 函数对象风格 Ident()：剥离括号当函数名尝试
    out = out.replace(
      /\b(?:std::)?(?:sort|stable_sort)\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\(\s*\)\s*\)/g,
      function (_m, cont, cmp) {
        return emitSortWithNamedCmp(cont, cmp);
      }
    );
    // 5. 其它未知比较器 → 升序兜底
    out = out.replace(
      /\b(?:std::)?(?:sort|stable_sort)\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*[^)]+\)/g,
      "$1.__algo_sort()"
    );
    // 6. 无比较器
    out = out.replace(
      /\b(?:std::)?(?:sort|stable_sort)\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.__algo_sort()"
    );
    out = out.replace(
      /\b(?:std::)?reverse\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.__algo_reverse()"
    );
    out = out.replace(
      /\b(?:std::)?find\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([^)]+)\)/g,
      "$1.__algo_find($2)"
    );
    out = out.replace(
      /\b(?:std::)?count\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([^)]+)\)/g,
      "$1.__algo_count($2)"
    );
    out = out.replace(
      /\b(?:std::)?lower_bound\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([^)]+)\)/g,
      "$1.__algo_lower_bound($2)"
    );
    out = out.replace(
      /\b(?:std::)?upper_bound\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([^)]+)\)/g,
      "$1.__algo_upper_bound($2)"
    );
    out = out.replace(
      /\b(?:std::)?binary_search\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([^)]+)\)/g,
      "$1.__algo_binary_search($2)"
    );
    out = out.replace(
      /\b(?:std::)?fill\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([^)]+)\)/g,
      "$1.__algo_fill($2)"
    );
    out = out.replace(
      /\b(?:std::)?unique\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.__algo_unique()"
    );
    out = out.replace(
      /\b(?:std::)?accumulate\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([^)]+)\)/g,
      "$1.__algo_accumulate($2)"
    );
    out = out.replace(
      /\b(?:std::)?min_element\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.__algo_min_element()"
    );
    out = out.replace(
      /\b(?:std::)?max_element\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.__algo_max_element()"
    );

    out = out.replace(
      /\b(?:std::)?max_element\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.__algo_max_element()"
    );

    // transform(v.begin(), v.end(), out.begin(), func)
    out = out.replace(
      /\b(?:std::)?transform\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\)/g,
      function (match, src, dst, func) {
        return dst + ".transform(" + src + ", " + func + ")";
      }
    );
    // transform 单参数版本
    out = out.replace(
      /\b(?:std::)?transform\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\)/g,
      function (match, src, dst, func) {
        return dst + ".transform(" + src + ", " + func + ")";
      }
    );

    // copy
    out = out.replace(
      /\b(?:std::)?copy\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*\)/g,
      "$2.copy_from($1)"
    );

    // generate
    out = out.replace(
      /\b(?:std::)?generate\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\)/g,
      "$1.generate($2)"
    );

    // iota
    out = out.replace(
      /\b(?:std::)?iota\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([^)]+)\)/g,
      "$1.__algo_iota($2)"
    );

    // for_each
    out = out.replace(
      /\b(?:std::)?for_each\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\)/g,
      "$1.for_each($2)"
    );

    // min/max (两个参数)
    out = out.replace(
      /\b(?:std::)?min\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/g,
      "min($1, $2)"
    );
    out = out.replace(
      /\b(?:std::)?max\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/g,
      "max($1, $2)"
    );

    // clamp (C++17)
    out = out.replace(
      /\b(?:std::)?clamp\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\)/g,
      "clamp($1, $2, $3)"
    );

    // swap
    out = out.replace(
      /\b(?:std::)?swap\s*\(\s*([^,]+)\s*,\s*([^)]+)\)/g,
      "swap($1, $2)"
    );

    // set operations
    out = out.replace(
      /\b(?:std::)?set_union\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\2\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*\)/g,
      "$3.set_union($1, $2)"
    );
    out = out.replace(
      /\b(?:std::)?set_intersection\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\2\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*\)/g,
      "$3.set_intersection($1, $2)"
    );
    out = out.replace(
      /\b(?:std::)?set_difference\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\2\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*\)/g,
      "$3.set_difference($1, $2)"
    );
    out = out.replace(
      /\b(?:std::)?set_symmetric_difference\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\2\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*\)/g,
      "$3.set_symmetric_difference($1, $2)"
    );

    // merge / inplace_merge
    out = out.replace(
      /\b(?:std::)?merge\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\2\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*\)/g,
      "$3.merge($1, $2)"
    );
    out = out.replace(
      /\b(?:std::)?inplace_merge\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.inplace_merge($2)"
    );

    // lexicographical_compare
    out = out.replace(
      /\b(?:std::)?lexicographical_compare\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\2\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.lexicographical_compare($2)"
    );

    // is_sorted / is_sorted_until
    out = out.replace(
      /\b(?:std::)?is_sorted\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.is_sorted()"
    );
    out = out.replace(
      /\b(?:std::)?is_sorted_until\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.is_sorted_until()"
    );

    // includes
    out = out.replace(
      /\b(?:std::)?includes\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\2\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.includes($2)"
    );

    // equal / mismatch
    out = out.replace(
      /\b(?:std::)?equal\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*\)/g,
      "$1.equal($2)"
    );
    out = out.replace(
      /\b(?:std::)?mismatch\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*\)/g,
      "$1.mismatch($2)"
    );

    // search / search_n
    out = out.replace(
      /\b(?:std::)?search\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\2\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.search($2)"
    );

    // rotate
    out = out.replace(
      /\b(?:std::)?rotate\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*\)/g,
      "$1.rotate($2)"
    );

    // shuffle (简化版)
    out = out.replace(
      /\b(?:std::)?shuffle\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\)/g,
      "$1.shuffle($2)"
    );

    // sample (C++17)
    out = out.replace(
      /\b(?:std::)?sample\s*\(\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*\1\s*\.\s*end\s*\(\s*\)\s*,\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*,\s*([^,]+)\s*,\s*([^)]+)\)/g,
      "$2.sample($1, $3, $4)"
    );

    // 裸 sort(v) 等（部分教学代码）
    out = out.replace(/\b(?:std::)?sort\s*\(\s*([A-Za-z_]\w*)\s*\)/g, "$1.__algo_sort()");
    out = out.replace(/\b(?:std::)?reverse\s*\(\s*([A-Za-z_]\w*)\s*\)/g, "$1.__algo_reverse()");

    return out;
  }

  /**
   * 把 for (auto it = v.begin(); it != v.end(); ++it) { ... *it ... }
   * 粗略改成下标循环。仅处理最常见的简单形式。
   */
  function transpileIteratorFor(code) {
    // for (TYPE it = CONT.begin(); it != CONT.end(); ++it) 或 it++
    var re =
      /\bfor\s*\(\s*(?:auto|int|long|size_t|unsigned[^;]*?)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\.\s*begin\s*\(\s*\)\s*;\s*\1\s*!=\s*\2\s*\.\s*end\s*\(\s*\)\s*;\s*(?:\+\+\1|\1\+\+)\s*\)/g;

    return code.replace(re, function (match, it, cont) {
      // 替换后仍用同名 it 作为下标；循环体中的 *it 在下一步处理
      return (
        "for (int " +
        it +
        " = 0; " +
        it +
        " != (" +
        cont +
        ").size(); ++" +
        it +
        ")"
      );
    });
  }

  /** 把 *it 在简单场景下替换为 cont[it] 较难全局做；对常见写法做局部替换 */
  function transpileIteratorDeref(code) {
    // 仅当刚做完 iterator for 时，用户代码里 *it 仍可能存在。
    // 保守策略：不盲目替换所有 *it（会破坏指针代码），交给用户用下标或 range-for。
    return code;
  }

  /* ------------------------------------------------------------------ *
   * auto 基础类型推导
   * ------------------------------------------------------------------ */
  function transpileAuto(code) {
    var out = code;

    // auto x = 整数;
    out = out.replace(
      /\bauto\s+([A-Za-z_]\w*)\s*=\s*(-?\d+[uUlL]*)\s*;/g,
      "int $1 = $2;"
    );
    // auto x = 浮点;
    out = out.replace(
      /\bauto\s+([A-Za-z_]\w*)\s*=\s*(-?\d+\.\d*(?:[eE][+-]?\d+)?[fFlL]?|-?\d+[eE][+-]?\d+[fFlL]?)\s*;/g,
      "double $1 = $2;"
    );
    // auto x = true/false;
    out = out.replace(
      /\bauto\s+([A-Za-z_]\w*)\s*=\s*(true|false)\s*;/g,
      "bool $1 = $2;"
    );
    // auto x = 'c';
    out = out.replace(
      /\bauto\s+([A-Za-z_]\w*)\s*=\s*('(?:\\.|[^\\'])*')\s*;/g,
      "char $1 = $2;"
    );
    // auto x = "str";
    out = out.replace(
      /\bauto\s+([A-Za-z_]\w*)\s*=\s*("(?:\\.|[^\\"])*")\s*;/g,
      "string $1 = $2;"
    );
    // const auto& / auto&& / auto&
    out = out.replace(
      /\b(?:const\s+)?auto\s*&&?\s*([A-Za-z_]\w*)\s*=/g,
      "int $1 ="
    );
    // 剩余 auto var =
    out = out.replace(/\bauto\s+([A-Za-z_]\w*)\s*=/g, "int $1 =");
    // 残留 auto 关键字
    if (/\bauto\b/.test(out)) {
      out = out.replace(/\bauto\b/g, "/*auto→*/int");
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 竞赛常用 typedef / using / 简单 #define 展开
   * ------------------------------------------------------------------ */
  function expandContestTypedefs(code) {
    var out = code;

    // #define ll long long   /  #define int long long 等（仅单行、无参数）
    out = out.replace(
      /#\s*define\s+(ll|LL|i64|I64)\s+long\s+long\b/g,
      "/* #define $1 long long */ typedef long long $1;"
    );
    out = out.replace(
      /#\s*define\s+(ull|ULL|u64|U64)\s+unsigned\s+long\s+long\b/g,
      "/* #define $1 unsigned long long */ typedef unsigned long long $1;"
    );

    // typedef long long ll;
    out = out.replace(
      /\btypedef\s+long\s+long\s+(ll|LL|i64)\s*;/g,
      "typedef long long $1;"
    );
    // using ll = long long;
    out = out.replace(
      /\busing\s+(ll|LL|i64)\s*=\s*long\s+long\s*;/g,
      "typedef long long $1;"
    );
    out = out.replace(
      /\busing\s+(ull|ULL|u64)\s*=\s*unsigned\s+long\s+long\s*;/g,
      "typedef unsigned long long $1;"
    );

    // 常见 size_t 等已在后面统一替换
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 元素类型解析
   * ------------------------------------------------------------------ */
  function resolveSTLElementType(rt, token, createdTypes) {
    var t = token.trim().replace(/\s+/g, " ");
    if (createdTypes[t]) return createdTypes[t];

    // 去掉可能的 const / volatile
    t = t.replace(/\bconst\b/g, "").replace(/\bvolatile\b/g, "").trim().replace(/\s+/g, " ");

    var map = {
      int: rt.intTypeLiteral,
      bool: rt.boolTypeLiteral,
      char: rt.charTypeLiteral,
      double: rt.doubleTypeLiteral,
      float: rt.floatTypeLiteral,
      long: rt.primitiveType("long"),
      "long int": rt.primitiveType("long"),
      "long long": rt.primitiveType("long long"),
      "long long int": rt.primitiveType("long long"),
      short: rt.primitiveType("short"),
      "short int": rt.primitiveType("short"),
      unsigned: rt.primitiveType("unsigned"),
      "unsigned int": rt.primitiveType("unsigned int"),
      "unsigned long": rt.primitiveType("unsigned long"),
      "unsigned long long": rt.primitiveType("unsigned long long"),
      "unsigned short": rt.primitiveType("unsigned short"),
      "unsigned char": rt.primitiveType("unsigned char"),
      "signed char": rt.primitiveType("signed char"),
      // 别名
      size_t: rt.primitiveType("unsigned long"),
      "unsigned long int": rt.primitiveType("unsigned long"),
      ll: rt.primitiveType("long long"),
      LL: rt.primitiveType("long long"),
      i64: rt.primitiveType("long long"),
      ull: rt.primitiveType("unsigned long long"),
      ULL: rt.primitiveType("unsigned long long"),
      // std::string 支持（通过 loadStringLib 注入）
      string: (function () {
        for (var k in rt.types) {
          var tt = rt.types[k];
          if (tt && tt.name === "string") return tt;
        }
        return null;
      })(),
    };
    return map[t] || null;
  }

  /* ------------------------------------------------------------------ *
   * std::string 库（JSCPP 不内置，通过 config.includes 注入）
   * ------------------------------------------------------------------ */
  function loadStringLib(rt) {
    if (rt.__stringLibLoaded) return;
    rt.__stringLibLoaded = true;

    // ---- 修补 getCompatibleFunc：原版 castable 遇到类类型会抛 "not implemented"，
    //      导致 "字面量" 参数匹配 string 重载时直接崩溃。此处逐字复刻原逻辑，
    //      仅把类相关分支改为安全返回 false（跳过该候选）。
    if (!rt.__gcPatched) {
      rt.__gcPatched = true;
      rt.getCompatibleFunc = function (e, a, r) {
        var sig2 = rt.getTypeSignature(e);
        if (!(sig2 in rt.types)) rt.raiseException("type " + rt.makeTypeString(e) + " is unknown");
        var g = rt.types[sig2].handlers;
        if (!(a in g)) rt.raiseException("method " + a + " is not defined in " + rt.makeTypeString(e));
        var c = r.map(function (x) { return x.t; });
        var callSig = rt.makeParametersSignature(c);
        if (callSig in g[a].functions) return g[a].functions[callSig];
        function safeCastable(provT, paramT) {
          if (provT === "dummy" || paramT === "dummy") return false;
          if (rt.isTypeEqualTo(provT, paramT)) return true;
          if (rt.isPrimitiveType(provT) && rt.isPrimitiveType(paramT))
            return rt.isNumericType(paramT) && rt.isNumericType(provT);
          if (rt.isPointerType(provT) && rt.isPointerType(paramT))
            return rt.isFunctionType(provT) ? rt.isPointerType(paramT) : !rt.isFunctionType(paramT);
          return false;
        }
        var matched = [];
        var regMap = g[a].reg;
        Object.keys(regMap).forEach(function (key) {
          var entry = regMap[key];
          var n = entry.args, i = entry.optionalArgs, rr;
          if (n[n.length - 1] === "?" && n.length - 1 <= c.length) { rr = c.slice(0, n.length - 1); n = n.slice(0, -1); }
          else rr = c;
          if (n.length <= rr.length) {
            var ok = true, o = 0;
            while (ok && o < n.length) { ok = safeCastable(rr[o], n[o]); o++; }
            while (ok && o < rr.length) {
              if (!i || !i[o - n.length]) { ok = false; break; }
              ok = safeCastable(rr[o], i[o - n.length].type); o++;
            }
            if (ok) matched.push(g[a].functions[rt.makeParametersSignature(entry.args)]);
          }
        });
        if (matched.length === 0) {
          if ("#default" in g[a]) return g[a].functions["#default"];
          rt.raiseException("no method " + a + " in " + rt.makeTypeString(e) + " accepts " +
            c.map(function (t) { return rt.makeTypeString(t); }).join(", "));
        }
        if (matched.length > 1) rt.raiseException("ambiguous method invoking, " + matched.length + " compatible methods");
        return matched[0];
      };
    }

    var strType = rt.newClass("string", [
      { name: "data", type: rt.intTypeLiteral, initialize: function () { return ""; } },
    ]);
    var sig = rt.getTypeSignature(strType);
    rt.types[sig].father = "object";

    function slot(self) {
      if (!self.v) self.v = {};
      if (!self.v.members) self.v.members = {};
      var d = self.v.members.data;
      if (!d || typeof d.v !== "string") {
        d = self.v.members.data = { t: rt.intTypeLiteral, v: "" };
      }
      return d;
    }
    function isStrObj(x) {
      return x && x.t && x.t.type === "class" && x.t.name === "string" && x.v && x.v.members;
    }
    function toStr(rt, x) {
      if (x === undefined || x === null) return "";
      if (isStrObj(x)) return String(slot(x).v);
      if (typeof x.v === "string") return x.v;
      try { return rt.getStringFromCharArray(x); } catch (e) {}
      try { return String(x.v); } catch (e2) {}
      return "";
    }
    function mk(rt, js) {
      return { t: strType, v: { members: { data: { t: rt.intTypeLiteral, v: String(js) } } }, left: false };
    }

    var H = rt.types[sig].handlers;

    H["o(=)"] = { default: function (rt, self, rhs) { slot(self).v = toStr(rt, rhs); return self; } };
    H["o(+)"] = { default: function (rt, l, r) { return mk(rt, toStr(rt, l) + toStr(rt, r)); } };
    H["o(+=)"] = { default: function (rt, self, rhs) { var d = slot(self); d.v = d.v + toStr(rt, rhs); return self; } };

    var cmps = [
      ["o(==)", function (a, b) { return a === b; }], ["o(!=)", function (a, b) { return a !== b; }],
      ["o(<)", function (a, b) { return a < b; }], ["o(>)", function (a, b) { return a > b; }],
      ["o(<=)", function (a, b) { return a <= b; }], ["o(>=)", function (a, b) { return a >= b; }],
    ];
    cmps.forEach(function (pair) {
      H[pair[0]] = { default: function (rt, l, r) { return rt.val(rt.boolTypeLiteral, pair[1](toStr(rt, l), toStr(rt, r)) ? 1 : 0); } };
    });

    H["o([])"] = {
      default: function (rt, self, idx) {
        var s = slot(self).v;
        var i = Math.trunc(idx.v);
        if (i < 0 || i >= s.length) rt.raiseException("string index out of range: " + i);
        return rt.val(rt.charTypeLiteral, s.charCodeAt(i));
      },
    };

    function reg(name, params, ret, fn) { rt.regFunc(fn, strType, name, params, ret); }
    var I = rt.intTypeLiteral, B = rt.boolTypeLiteral, V = rt.voidTypeLiteral, C = rt.charTypeLiteral;
    var charPtr = rt.normalPointerType(C);

    reg("size", [], I, function (rt, self) { return rt.val(I, slot(self).v.length); });
    reg("length", [], I, function (rt, self) { return rt.val(I, slot(self).v.length); });
    reg("empty", [], B, function (rt, self) { return rt.val(B, slot(self).v.length === 0 ? 1 : 0); });
    reg("clear", [], V, function (rt, self) { slot(self).v = ""; });
    reg("push_back", [C], V, function (rt, self, ch) { var d = slot(self); d.v = d.v + String.fromCharCode(ch.v); });
    reg("pop_back", [], V, function (rt, self) { var d = slot(self); d.v = d.v.slice(0, -1); });
    reg("append", [strType], strType, function (rt, self, s2) { var d = slot(self); d.v = d.v + toStr(rt, s2); return self; });
    reg("append", [charPtr], strType, function (rt, self, s2) { var d = slot(self); d.v = d.v + toStr(rt, s2); return self; });
    reg("assign", [strType], strType, function (rt, self, s2) { slot(self).v = toStr(rt, s2); return self; });
    reg("assign", [charPtr], strType, function (rt, self, s2) { slot(self).v = toStr(rt, s2); return self; });
    reg("compare", [strType], I, function (rt, self, s2) { var a = slot(self).v, b = toStr(rt, s2); return rt.val(I, a < b ? -1 : a > b ? 1 : 0); });
    reg("compare", [charPtr], I, function (rt, self, s2) { var a = slot(self).v, b = toStr(rt, s2); return rt.val(I, a < b ? -1 : a > b ? 1 : 0); });
    // 可选参数用 "?" 哨兵（JSCPP 的可变参机制）
    rt.regFunc(function (rt, self, pos, len) {
      var s = slot(self).v;
      var p = Math.trunc(pos.v);
      var l = len === undefined ? s.length - p : Math.trunc(len.v);
      return mk(rt, s.substr(p, l));
    }, strType, "substr", [I, "?"], strType, [{ type: I }]);
    rt.regFunc(function (rt, self, s2, pos) {
      var s = slot(self).v;
      var start = pos === undefined ? 0 : Math.trunc(pos.v);
      return rt.val(I, s.indexOf(toStr(rt, s2), start));
    }, strType, "find", [strType, "?"], I, [{ type: I }]);
    rt.regFunc(function (rt, self, s2, pos) {
      var s = slot(self).v;
      var start = pos === undefined ? 0 : Math.trunc(pos.v);
      return rt.val(I, s.indexOf(toStr(rt, s2), start));
    }, strType, "find", [charPtr, "?"], I, [{ type: I }]);
    reg("at", [I], C, function (rt, self, i) { var s = slot(self).v; var k = Math.trunc(i.v); if (k < 0 || k >= s.length) rt.raiseException("string::at out of range"); return rt.val(C, s.charCodeAt(k)); });
    reg("c_str", [], charPtr, function (rt, self) { return rt.val(charPtr, rt.makeCharArrayFromString(slot(self).v).v); });
    reg("insert", [I, strType], V, function (rt, self, pos, s2) { var d = slot(self); var p = Math.trunc(pos.v); d.v = d.v.slice(0, p) + toStr(rt, s2) + d.v.slice(p); });
    reg("insert", [I, charPtr], V, function (rt, self, pos, s2) { var d = slot(self); var p = Math.trunc(pos.v); d.v = d.v.slice(0, p) + toStr(rt, s2) + d.v.slice(p); });
    reg("erase", [I, I], V, function (rt, self, pos, len) { var d = slot(self); var p = Math.trunc(pos.v); d.v = d.v.slice(0, p) + d.v.slice(p + Math.trunc(len.v)); });

    // C++20 string methods
    reg("starts_with", [strType], B, function (rt, self, prefix) { return rt.val(B, slot(self).v.startsWith(toStr(rt, prefix)) ? 1 : 0); });
    reg("starts_with", [charPtr], B, function (rt, self, prefix) { return rt.val(B, slot(self).v.startsWith(toStr(rt, prefix)) ? 1 : 0); });
    reg("ends_with", [strType], B, function (rt, self, suffix) { return rt.val(B, slot(self).v.endsWith(toStr(rt, suffix)) ? 1 : 0); });
    reg("ends_with", [charPtr], B, function (rt, self, suffix) { return rt.val(B, slot(self).v.endsWith(toStr(rt, suffix)) ? 1 : 0); });

    reg("rfind", [strType, "?"], I, function (rt, self, s2, pos) {
      var s = slot(self).v;
      var start = pos === undefined ? s.length - 1 : Math.trunc(pos.v);
      return rt.val(I, s.lastIndexOf(toStr(rt, s2), start));
    });
    reg("rfind", [charPtr, "?"], I, function (rt, self, s2, pos) {
      var s = slot(self).v;
      var start = pos === undefined ? s.length - 1 : Math.trunc(pos.v);
      return rt.val(I, s.lastIndexOf(toStr(rt, s2), start));
    });

    reg("replace", [I, I, strType], strType, function (rt, self, pos, len, s2) {
      var d = slot(self);
      var p = Math.trunc(pos.v);
      var l = Math.trunc(len.v);
      d.v = d.v.slice(0, p) + toStr(rt, s2) + d.v.slice(p + l);
      return self;
    });
    reg("replace", [I, I, charPtr], strType, function (rt, self, pos, len, s2) {
      var d = slot(self);
      var p = Math.trunc(pos.v);
      var l = Math.trunc(len.v);
      d.v = d.v.slice(0, p) + toStr(rt, s2) + d.v.slice(p + l);
      return self;
    });

    // split (简化版，按单字符分隔符)
    reg("split", [charPtr], elemType, function (rt, self, delim) {
      var s = slot(self).v;
      var d = String(rt.cast(charPtr, delim).v || "");
      var parts = d ? s.split(d) : s.split("");
      var vecType = rt.newClass("vector<string>", [{ name: "data", type: rt.intTypeLiteral, initialize: function () { return []; } }]);
      var vec = { t: vecType, v: { members: { data: [] } }, left: false };
      for (var i = 0; i < parts.length; i++) {
        vec.v.members.data.push(mk(rt, parts[i]));
      }
      return vec;
    });

    // join (简化版)
    reg("join", [elemType], strType, function (rt, self, vec) {
      var a = arr(vec);
      var parts = [];
      for (var i = 0; i < a.length; i++) parts.push(toStr(rt, a[i]));
      return mk(rt, parts.join(toStr(rt, self)));
    });

    // join (简化版)
    reg("join", [elemType], strType, function (rt, self, vec) {
      var a = arr(vec);
      var parts = [];
      for (var i = 0; i < a.length; i++) parts.push(toStr(rt, a[i]));
      return mk(rt, parts.join(toStr(rt, self)));
    });

    // 更多字符串操作
    reg("to_lower", [], strType, function (rt, self) { return mk(rt, slot(self).v.toLowerCase()); });
    reg("to_upper", [], strType, function (rt, self) { return mk(rt, slot(self).v.toUpperCase()); });
    reg("trim", [], strType, function (rt, self) { return mk(rt, slot(self).v.trim()); });
    reg("trim_left", [], strType, function (rt, self) { return mk(rt, slot(self).v.trimStart()); });
    reg("trim_right", [], strType, function (rt, self) { return mk(rt, slot(self).v.trimEnd()); });
    reg("contains", [strType], B, function (rt, self, s2) { return rt.val(B, slot(self).v.includes(toStr(rt, s2)) ? 1 : 0); });
    reg("contains", [charPtr], B, function (rt, self, s2) { return rt.val(B, slot(self).v.includes(toStr(rt, s2)) ? 1 : 0); });

    reg("repeat", [I], strType, function (rt, self, n) {
      var s = slot(self).v;
      var n = Math.trunc(n.v);
      return mk(rt, s.repeat(n));
    });

    reg("pad_start", [I, "?"], strType, function (rt, self, n, pad) {
      var s = slot(self).v;
      var n = Math.trunc(n.v);
      var padStr = pad === undefined ? " " : toStr(rt, pad);
      if (padStr.length > 1) padStr = padStr[0];
      return mk(rt, s.padStart(n, padStr));
    });
    reg("pad_end", [I, "?"], strType, function (rt, self, n, pad) {
      var s = slot(self).v;
      var n = Math.trunc(n.v);
      var padStr = pad === undefined ? " " : toStr(rt, pad);
      if (padStr.length > 1) padStr = padStr[0];
      return mk(rt, s.padEnd(n, padStr));
    });

    reg("char_at", [I], C, function (rt, self, i) {
      var s = slot(self).v;
      var idx = Math.trunc(i.v);
      if (idx < 0 || idx >= s.length) rt.raiseException("string index out of range");
      return rt.val(C, s.charCodeAt(idx));
    });

    reg("code_point_at", [I], I, function (rt, self, i) {
      var s = slot(self).v;
      var idx = Math.trunc(i.v);
      if (idx < 0 || idx >= s.length) rt.raiseException("string index out of range");
      return rt.val(I, s.codePointAt(idx));
    });

    // slice (类似 substr 但支持负索引)
    reg("slice", [I, "?"], strType, function (rt, self, pos, len) {
      var s = slot(self).v;
      var p = Math.trunc(pos.v);
      var l = len === undefined ? s.length : Math.trunc(len.v);
      return mk(rt, s.slice(p, l));
    });

    // 正则表达式相关 (简化版)
    reg("match", [charPtr], elemType, function (rt, self, pattern) {
      var s = slot(self).v;
      try {
        var regex = new RegExp(toStr(rt, pattern));
        var match = s.match(regex);
        if (!match) return mk(rt, ""); // 返回空字符串表示无匹配
        return mk(rt, match[0]);
      } catch (e) {
        return mk(rt, "");
      }
    });

    // ---- iostream 包装（延迟到 iostream 加载后） ----
    var wrapped = false;
    function tryWrap() {
      if (wrapped) return true;
      var cout = rt.scope[0].variables.cout;
      var cin = rt.scope[0].variables.cin;
      if (!cout || !cin) return false;
      var osSig = rt.getTypeSignature(cout.t);
      var osH = rt.types[osSig].handlers;
      if (osH["o(<<)"] && !osH["o(<<)"].__strWrapped) {
        var orig = osH["o(<<)"].default;
        osH["o(<<)"].default = function (rt, os, x) {
          if (isStrObj(x)) return orig(rt, os, rt.makeCharArrayFromString(slot(x).v));
          return orig(rt, os, x);
        };
        osH["o(<<)"].__strWrapped = true;
      }
      var isSig = rt.getTypeSignature(cin.t);
      var isH = rt.types[isSig].handlers;
      if (isH["o(>>)"] && !isH["o(>>)"].__strWrapped) {
        var origIn = isH["o(>>)"].default;
        isH["o(>>)"].default = function (rt, cinV, target) {
          if (isStrObj(target)) {
            var buf = String(cinV.v.buf == null ? "" : cinV.v.buf);
            buf = buf.replace(/^\s+/, "");
            var m = /^\S+/.exec(buf);
            if (!m || !m[0].length) rt.raiseException("input format mismatch string");
            slot(target).v = m[0];
            cinV.v.buf = buf.slice(m[0].length);
            return cinV;
          }
          return origIn(rt, cinV, target);
        };
        isH["o(>>)"].__strWrapped = true;
      }
      wrapped = true;
      return true;
    }

    if (!tryWrap()) {
      var origInclude = rt.include.bind(rt);
      rt.include = function (name) {
        var r = origInclude(name);
        tryWrap();
        return r;
      };
    }

    // ---- 全局自由函数（回调签名为 (rt, 占位, 参数...)） ----
    rt.regFunc(function (rt, _p, x) { return mk(rt, String(rt.cast(rt.doubleTypeLiteral, x).v)); }, "global", "to_string", [rt.doubleTypeLiteral], strType);
    rt.regFunc(function (rt, _p, s) { var m = /^\s*[+-]?\d+/.exec(toStr(rt, s)); if (!m) rt.raiseException("stoi: invalid argument"); return rt.val(I, parseInt(m[0], 10)); }, "global", "stoi", [strType], I);
    rt.regFunc(function (rt, _p, s) { var m = /^\s*[+-]?\d+/.exec(toStr(rt, s)); if (!m) rt.raiseException("stoi: invalid argument"); return rt.val(I, parseInt(m[0], 10)); }, "global", "stoi", [charPtr], I);
    rt.regFunc(function (rt, _p, s) { var m = /^\s*[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(toStr(rt, s)); if (!m) rt.raiseException("stod: invalid argument"); return rt.val(rt.doubleTypeLiteral, parseFloat(m[0])); }, "global", "stod", [strType], rt.doubleTypeLiteral);
    rt.regFunc(function (rt, _p, s) { var m = /^\s*[+-]?\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(toStr(rt, s)); if (!m) rt.raiseException("stod: invalid argument"); return rt.val(rt.doubleTypeLiteral, parseFloat(m[0])); }, "global", "stod", [charPtr], rt.doubleTypeLiteral);

    // getline(cin, s)
    var cinType = rt.scope[0].variables.cin ? rt.scope[0].variables.cin.t : null;
    if (cinType) {
      rt.regFunc(function (rt, _p, cinV, target) {
        var buf = String(cinV.v.buf == null ? "" : cinV.v.buf);
        var nl = buf.indexOf("\n");
        var line, rest;
        if (nl === -1) { line = buf.replace(/\r$/, ""); rest = ""; }
        else { line = buf.slice(0, nl).replace(/\r$/, ""); rest = buf.slice(nl + 1); }
        slot(target).v = line;
        cinV.v.buf = rest;
      }, "global", "getline", [cinType, strType], V);
    }
  }

  /* ------------------------------------------------------------------ *
   * string 预处理改写：
   *  1) 声明初始化 string a = x, b = y; → 声明 + 赋值（JSCPP 不支持类 cast）
   *  2) "lit" + expr → expr + "lit"（string 的 o(+) 仅左操作数生效）
   * ------------------------------------------------------------------ */
  function transpileStringSupport(code) {
    var out = code;
    // 多声明符拆分（顶层逗号，忽略引号/括号内）
    out = out.replace(/\bstring\s+((?:[A-Za-z_]\w*\s*=\s*[^;]+?)(?:\s*,\s*[A-Za-z_]\w*\s*=\s*[^;]+?)*)\s*;/g,
      function (mm, decls) {
        var parts = [];
        var cur = "", q = null, depth = 0;
        for (var i = 0; i < decls.length; i++) {
          var ch = decls[i];
          if (q) { cur += ch; if (ch === q) q = null; continue; }
          if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
          if (ch === "(" || ch === "[") depth++;
          if (ch === ")" || ch === "]") depth--;
          if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
          cur += ch;
        }
        parts.push(cur);
        var res = "";
        parts.forEach(function (p) {
          var m2 = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(p);
          if (m2) res += "string " + m2[1] + "; " + m2[1] + " = " + m2[2] + "; ";
          else res += "string " + p.trim() + "; ";
        });
        return res;
      });
    // 反向拼接交换
    out = out.replace(/"((?:\\.|[^"\\])*)"\s*\+\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*(?:\s*\([^()]*\))?)/g, "$2 + \"$1\"");
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 运行时注册容器类与方法
   * ------------------------------------------------------------------ */
  var __pendingSTLRegistrations = [];

  function installSTLShimTypes(rt, registrations) {
    var createdTypes = {};

    function regContainerMethods(cType, sig, elemType, kind) {
      function arr(self) {
        // 确保 data 始终是数组（嵌套 vector resize 后可能未正确初始化）
        if (!self.v) self.v = {};
        if (!self.v.members) self.v.members = {};
        if (!Array.isArray(self.v.members.data)) self.v.members.data = [];
        return self.v.members.data;
      }

      /**
       * 构造默认元素。嵌套容器必须走 JSCPP cConstructor，
       * 否则缺少正确的类型信息，会触发 reading 'type'。
       */
      function makeDefaultElem() {
        try {
          var esig = rt.getTypeSignature(elemType);
          var et = rt.types[esig];
          if (et && typeof et.cConstructor === "function") {
            var obj = { t: elemType, v: {}, left: true };
            et.cConstructor(rt, obj);
            if (!obj.v.members) obj.v.members = {};
            if (!Array.isArray(obj.v.members.data)) obj.v.members.data = [];
            return obj;
          }
        } catch (e) {}

        try {
          var dv = rt.defaultValue(elemType, true);
          if (dv && typeof dv === "object" && "v" in dv) {
            return { t: elemType, v: dv.v, left: true };
          }
        } catch (e2) {}

        try {
          if (elemType === rt.boolTypeLiteral || (elemType && elemType.name === "bool")) {
            return rt.val(rt.boolTypeLiteral, false, true);
          }
          return rt.val(elemType, 0, true);
        } catch (e3) {}

        return { t: elemType, v: 0, left: true };
      }

      // 元素比较键：对 string 取 data.v（JS 字符串），其它直接用 v
      function elemKey(x) {
        if (x && x.t && x.t.name === "string" && x.v && x.v.members && x.v.members.data) {
          return String(x.v.members.data.v);
        }
        return x.v;
      }

      function copyElem(x) {
        if (x === undefined || x === null) return makeDefaultElem();

        // 容器值：拷贝 data，保留类型对象
        if (x && x.t && x.v && typeof x.v === "object" && x.v.members && Array.isArray(x.v.members.data)) {
          return {
            t: x.t,
            v: { members: { data: x.v.members.data.slice() } },
            left: true,
          };
        }

        try {
          var casted = rt.cast(elemType, x);
          if (casted && casted.v !== undefined && casted.v !== null) {
            if (
              typeof casted.v === "object" &&
              casted.v.members &&
              Array.isArray(casted.v.members.data)
            ) {
              return {
                t: elemType,
                v: { members: { data: casted.v.members.data.slice() } },
                left: true,
              };
            }
            return { t: elemType, v: casted.v, left: true };
          }
        } catch (e) {}

        if (x && x.v !== undefined) {
          return { t: elemType, v: x.v, left: true };
        }
        return makeDefaultElem();
      }

      // 判断元素类型是否为 pair（别名形如 __pair_K_V，不能用 name === "pair" 判断）
      function isPairElemType() {
        try {
          var s = rt.getTypeSignature(elemType);
          if (typeof s === "string" && s.indexOf("__pair") !== -1) return true;
        } catch (e0) {}
        try {
          if (elemType && typeof elemType.name === "string" && elemType.name.indexOf("__pair") === 0) return true;
        } catch (e1) {}
        return false;
      }

      if (kind === "vector") {
        // 基本修改
        rt.regFunc(function (rt, self, x) {
          arr(self).push(copyElem(x));
        }, cType, "push_back", [elemType], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self, x) {
          arr(self).push(copyElem(x));
        }, cType, "emplace_back", [elemType], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("pop_back on empty vector");
          a.pop();
        }, cType, "pop_back", [], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, arr(self).length);
        }, cType, "size", [], rt.intTypeLiteral);

        rt.regFunc(function (rt, self) {
          return rt.val(rt.boolTypeLiteral, arr(self).length === 0);
        }, cType, "empty", [], rt.boolTypeLiteral);

        rt.regFunc(function (rt, self) {
          arr(self).length = 0;
        }, cType, "clear", [], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("front on empty vector");
          if (!a[0]) a[0] = makeDefaultElem();
          return a[0];
        }, cType, "front", [], elemType);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("back on empty vector");
          if (!a[a.length - 1]) a[a.length - 1] = makeDefaultElem();
          return a[a.length - 1];
        }, cType, "back", [], elemType);

        rt.regFunc(function (rt, self, idxVal) {
          var a = arr(self);
          var i = Math.trunc(idxVal.v);
          if (i < 0 || i >= a.length) rt.raiseException("vector::at out of range: " + i);
          if (!a[i]) a[i] = makeDefaultElem();
          return a[i];
        }, cType, "at", [rt.intTypeLiteral], elemType);

        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, arr(self).length);
        }, cType, "capacity", [], rt.intTypeLiteral);

        rt.regFunc(function (rt, self, n) {
          void n;
        }, cType, "reserve", [rt.intTypeLiteral], rt.voidTypeLiteral);

        // resize(n)：用正确的空元素填充（修复嵌套 vector 的 defaultValue 问题）
        rt.regFunc(function (rt, self, n) {
          var a = arr(self);
          var sz = Math.trunc(n.v);
          if (sz < 0) sz = 0;
          while (a.length > sz) a.pop();
          while (a.length < sz) a.push(makeDefaultElem());
        }, cType, "resize", [rt.intTypeLiteral], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self, n, val) {
          var a = arr(self);
          var sz = Math.trunc(n.v);
          if (sz < 0) sz = 0;
          while (a.length > sz) a.pop();
          while (a.length < sz) a.push(copyElem(val));
        }, cType, "resize", [rt.intTypeLiteral, elemType], rt.voidTypeLiteral);

        // assign(n, val) —— 用户代码里 v.assign(n+1, 0)
        rt.regFunc(function (rt, self, n, val) {
          var a = arr(self);
          var sz = Math.trunc(n.v);
          if (sz < 0) sz = 0;
          a.length = 0;
          for (var i = 0; i < sz; i++) a.push(copyElem(val));
        }, cType, "assign", [rt.intTypeLiteral, elemType], rt.voidTypeLiteral);

        // assign(n) 填默认值
        rt.regFunc(function (rt, self, n) {
          var a = arr(self);
          var sz = Math.trunc(n.v);
          if (sz < 0) sz = 0;
          a.length = 0;
          for (var i = 0; i < sz; i++) a.push(makeDefaultElem());
        }, cType, "assign", [rt.intTypeLiteral], rt.voidTypeLiteral);

        // 迭代器：用整数下标模拟 begin/end
        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, 0);
        }, cType, "begin", [], rt.intTypeLiteral);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, 0);
        }, cType, "cbegin", [], rt.intTypeLiteral);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, arr(self).length);
        }, cType, "end", [], rt.intTypeLiteral);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, arr(self).length);
        }, cType, "cend", [], rt.intTypeLiteral);

        // ----- algorithm 方法（由 transpileAlgorithms 改写调用） -----
        // 升序（默认 / less<>）
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          a.sort(function (x, y) {
            var xv = elemKey(x), yv = elemKey(y);
            if (xv < yv) return -1;
            if (xv > yv) return 1;
            return 0;
          });
        }, cType, "__algo_sort", [], rt.voidTypeLiteral);

        // 降序（greater<>）
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          a.sort(function (x, y) {
            var xv = elemKey(x), yv = elemKey(y);
            if (xv > yv) return -1;
            if (xv < yv) return 1;
            return 0;
          });
        }, cType, "__algo_sort_desc", [], rt.voidTypeLiteral);

        // 供自定义比较函数 sort 使用的元素交换
        rt.regFunc(function (rt, self, iVal, jVal) {
          var a = arr(self);
          var i = Math.trunc(iVal.v);
          var j = Math.trunc(jVal.v);
          if (i < 0 || j < 0 || i >= a.length || j >= a.length) {
            rt.raiseException("vector::__swap_at out of range");
          }
          var tmp = a[i];
          a[i] = a[j];
          a[j] = tmp;
        }, cType, "__swap_at", [rt.intTypeLiteral, rt.intTypeLiteral], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self) {
          arr(self).reverse();
        }, cType, "__algo_reverse", [], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self, val) {
          var a = arr(self);
          var target = rt.cast(elemType, val).v;
          for (var i = 0; i < a.length; i++) {
            if (elemKey(a[i]) === target) return rt.val(rt.intTypeLiteral, i);
          }
          return rt.val(rt.intTypeLiteral, a.length); // end()
        }, cType, "__algo_find", [elemType], rt.intTypeLiteral);

        rt.regFunc(function (rt, self, val) {
          var a = arr(self);
          var target = rt.cast(elemType, val).v;
          var cnt = 0;
          for (var i = 0; i < a.length; i++) if (elemKey(a[i]) === target) cnt++;
          return rt.val(rt.intTypeLiteral, cnt);
        }, cType, "__algo_count", [elemType], rt.intTypeLiteral);

        rt.regFunc(function (rt, self, val) {
          var a = arr(self);
          var target = rt.cast(elemType, val).v;
          var lo = 0, hi = a.length;
          while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (elemKey(a[mid]) < target) lo = mid + 1;
            else hi = mid;
          }
          return rt.val(rt.intTypeLiteral, lo);
        }, cType, "__algo_lower_bound", [elemType], rt.intTypeLiteral);

        rt.regFunc(function (rt, self, val) {
          var a = arr(self);
          var target = rt.cast(elemType, val).v;
          var lo = 0, hi = a.length;
          while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (elemKey(a[mid]) <= target) lo = mid + 1;
            else hi = mid;
          }
          return rt.val(rt.intTypeLiteral, lo);
        }, cType, "__algo_upper_bound", [elemType], rt.intTypeLiteral);

        rt.regFunc(function (rt, self, val) {
          var a = arr(self);
          var target = rt.cast(elemType, val).v;
          var lo = 0, hi = a.length;
          while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (elemKey(a[mid]) < target) lo = mid + 1;
            else hi = mid;
          }
          var found = lo < a.length && elemKey(a[lo]) === target;
          return rt.val(rt.boolTypeLiteral, found);
        }, cType, "__algo_binary_search", [elemType], rt.boolTypeLiteral);

        rt.regFunc(function (rt, self, val) {
          var a = arr(self);
          var c = copyElem(val);
          for (var i = 0; i < a.length; i++) a[i] = copyElem(val);
        }, cType, "__algo_fill", [elemType], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) return rt.val(rt.intTypeLiteral, 0);
          var w = 1;
          for (var i = 1; i < a.length; i++) {
            if (elemKey(a[i]) !== elemKey(a[w - 1])) {
              a[w] = a[i];
              w++;
            }
          }
          a.length = w;
          return rt.val(rt.intTypeLiteral, w);
        }, cType, "__algo_unique", [], rt.intTypeLiteral);

        rt.regFunc(function (rt, self, initVal) {
          var a = arr(self);
          var sum = rt.cast(elemType, initVal).v;
          for (var i = 0; i < a.length; i++) sum = sum + elemKey(a[i]);
          return rt.val(elemType, sum);
        }, cType, "__algo_accumulate", [elemType], elemType);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) return rt.val(rt.intTypeLiteral, 0);
          var best = 0;
          for (var i = 1; i < a.length; i++) if (elemKey(a[i]) < elemKey(a[best])) best = i;
          return rt.val(rt.intTypeLiteral, best);
        }, cType, "__algo_min_element", [], rt.intTypeLiteral);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) return rt.val(rt.intTypeLiteral, 0);
          var best = 0;
          for (var i = 1; i < a.length; i++) if (elemKey(a[i]) > elemKey(a[best])) best = i;
          return rt.val(rt.intTypeLiteral, best);
        }, cType, "__algo_max_element", [], rt.intTypeLiteral);

        // partial_sort
        rt.regFunc(function (rt, self, middle, last) {
          var a = arr(self);
          var mid = rt.cast(rt.intTypeLiteral, middle).v;
          var lastIdx = last ? rt.cast(rt.intTypeLiteral, last).v : a.length;
          var sub = a.slice(0, lastIdx);
          sub.sort(function (x, y) { return elemKey(x) - elemKey(y); });
          a.splice(0, Math.min(mid, lastIdx), ...sub.slice(0, mid));
        }, cType, "__algo_partial_sort", [rt.intTypeLiteral, rt.intTypeLiteral], rt.voidTypeLiteral);

        // partial_sort_copy
        rt.regFunc(function (rt, self, result_first, result_last) {
          var a = arr(self);
          var res = arr(arguments[2]);
          var n = Math.min(a.length, res.length);
          var indices = Array.from({ length: a.length }, (_, i) => i);
          indices.sort(function (i, j) { return elemKey(a[i]) - elemKey(a[j]); });
          for (var i = 0; i < Math.min(a.length, res.length); i++) {
            res[i] = copyElem(a[indices[i]]);
          }
        }, cType, "__algo_partial_sort_copy", [elemType, elemType], rt.voidTypeLiteral);

        // heap operations
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          // make_heap
          for (var i = Math.floor(a.length / 2) - 1; i >= 0; i--) {
            var idx = i;
            while (true) {
              var largest = idx;
              var l = idx * 2 + 1;
              var r = l + 1;
              if (l < a.length && elemKey(a[l]) > elemKey(a[largest])) largest = l;
              if (r < a.length && elemKey(a[r]) > elemKey(a[largest])) largest = r;
              if (largest === idx) break;
              var tmp = a[idx];
              a[idx] = a[largest];
              a[largest] = tmp;
              idx = largest;
            }
          }
        }, cType, "__algo_make_heap", [], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self, value) {
          var a = arr(self);
          a.push(copyElem(arguments[2]));
          var idx = a.length - 1;
          while (idx > 0) {
            var p = (idx - 1) >> 1;
            if (elemKey(a[p]) >= elemKey(a[idx])) break;
            var tmp = a[p];
            a[p] = a[idx];
            a[idx] = tmp;
            idx = p;
          }
        }, cType, "push_heap", [elemType], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) return;
          a[0] = a[a.length - 1];
          a.pop();
          var idx = 0;
          while (true) {
            var l = idx * 2 + 1;
            var r = l + 1;
            var largest = idx;
            if (l < a.length && elemKey(a[l]) > elemKey(a[largest])) largest = l;
            if (r < a.length && elemKey(a[r]) > elemKey(a[largest])) largest = r;
            if (largest === idx) break;
            var tmp = a[idx];
            a[idx] = a[largest];
            a[largest] = tmp;
            idx = largest;
          }
        }, cType, "pop_heap", [], rt.voidTypeLiteral);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          // sort_heap
          for (var i = a.length - 1; i > 0; i--) {
            var tmp = a[0];
            a[0] = a[i];
            a[i] = tmp;
            var idx = 0;
            var end = i;
            while (true) {
              var l = idx * 2 + 1;
              var r = l + 1;
              var largest = idx;
              if (l < end && elemKey(a[l]) > elemKey(a[largest])) largest = l;
              if (r < end && elemKey(a[r]) > elemKey(a[largest])) largest = r;
              if (largest === idx) break;
              var tmp = a[idx];
              a[idx] = a[largest];
              a[largest] = tmp;
              idx = largest;
            }
          }
        }, cType, "sort_heap", [], rt.voidTypeLiteral);

        // is_heap / is_heap_until
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          for (var i = 1; i < a.length; i++) {
            var p = (i - 1) >> 1;
            if (elemKey(a[p]) < elemKey(a[i])) return rt.val(rt.boolTypeLiteral, false);
          }
          return rt.val(rt.boolTypeLiteral, true);
        }, cType, "is_heap", [], rt.boolTypeLiteral);

        rt.regFunc(function (rt, self) {
          var a = arr(self);
          for (var i = 1; i < a.length; i++) {
            var p = (i - 1) >> 1;
            if (elemKey(a[p]) < elemKey(a[i])) return rt.val(rt.intTypeLiteral, i);
          }
          return rt.val(rt.intTypeLiteral, a.length);
        }, cType, "is_heap_until", [], rt.intTypeLiteral);

        // iota
        rt.regFunc(function (rt, self, nth, last) {
          var a = arr(self);
          var nthIdx = rt.cast(rt.intTypeLiteral, nth).v;
          var lastIdx = last ? rt.cast(rt.intTypeLiteral, last).v : a.length;
          var sub = a.slice(0, lastIdx);
          sub.sort(function (x, y) { return elemKey(x) - elemKey(y); });
          a.splice(0, lastIdx, ...sub);
        }, cType, "__algo_nth_element", [rt.intTypeLiteral, rt.intTypeLiteral], rt.voidTypeLiteral);

        // partition
        rt.regFunc(function (rt, self, pred) {
          var a = arr(self);
          var left = 0, right = a.length - 1;
          while (left <= right) {
            while (left <= right && rt.cast(rt.boolTypeLiteral, pred(rt, rt.undefined, a[left])).v) left++;
            while (left <= right && !rt.cast(rt.boolTypeLiteral, pred(rt, rt.undefined, a[right])).v) right--;
            if (left < right) {
              var tmp = a[left];
              a[left] = a[right];
              a[right] = tmp;
              left++; right--;
            }
          }
          return rt.val(rt.intTypeLiteral, left);
        }, cType, "__algo_partition", [rt.voidTypeLiteral], rt.intTypeLiteral);

        // stable_partition (简化版)
        rt.regFunc(function (rt, self, pred) {
          var a = arr(self);
          var trueVals = [], falseVals = [];
          for (var i = 0; i < a.length; i++) {
            if (rt.cast(rt.boolTypeLiteral, pred(rt, rt.undefined, a[i])).v) {
              trueVals.push(a[i]);
            } else {
              falseVals.push(a[i]);
            }
          }
          a.length = 0;
          a.push.apply(a, trueVals.concat(falseVals));
          return rt.val(rt.intTypeLiteral, trueVals.length);
        }, cType, "__algo_stable_partition", [rt.voidTypeLiteral], rt.intTypeLiteral);

        // iota
        rt.regFunc(function (rt, self, initVal) {
          var a = arr(self);
          var val = rt.cast(elemType, initVal).v;
          for (var i = 0; i < a.length; i++) {
            a[i] = { t: elemType, v: val, left: true };
            val = val + 1;
          }
        }, cType, "__algo_iota", [elemType], rt.voidTypeLiteral);

        // transform: dst.transform(src, func)
        rt.regFunc(function (rt, self, src, func) {
          var a = arr(self);
          var srcArr = arr(src);
          var len = Math.min(a.length, srcArr.length);
          for (var i = 0; i < len; i++) {
            // 简单调用函数：func(srcArr[i])
            try {
              var res = func(rt, rt.undefined, srcArr[i]);
              a[i] = res;
            } catch (e) {
              a[i] = makeDefaultElem();
            }
          }
        }, cType, "transform", [rt.getTypeSignature(strType), rt.getTypeSignature(strType)], rt.voidTypeLiteral);

        // copy: dst.copy_from(src)
        rt.regFunc(function (rt, self, src) {
          var a = arr(self);
          var srcArr = arr(src);
          var len = Math.min(a.length, srcArr.length);
          for (var i = 0; i < len; i++) {
            a[i] = copyElem(srcArr[i]);
          }
        }, cType, "copy_from", [elemType], rt.voidTypeLiteral);

        // generate
        rt.regFunc(function (rt, self, func) {
          var a = arr(self);
          for (var i = 0; i < a.length; i++) {
            try {
              var res = func(rt, rt.undefined);
              a[i] = res;
            } catch (e) {
              a[i] = makeDefaultElem();
            }
          }
        }, cType, "generate", [rt.voidTypeLiteral], rt.voidTypeLiteral);

        // iota
        rt.regFunc(function (rt, self, initVal) {
          var a = arr(self);
          var val = rt.cast(elemType, initVal).v;
          for (var i = 0; i < a.length; i++) {
            a[i] = { t: elemType, v: val, left: true };
            val = val + 1;
          }
        }, cType, "__algo_iota", [elemType], rt.voidTypeLiteral);

        // for_each
        rt.regFunc(function (rt, self, func) {
          var a = arr(self);
          for (var i = 0; i < a.length; i++) {
            try {
              func(rt, rt.undefined, a[i]);
            } catch (e) {}
          }
        }, cType, "for_each", [rt.voidTypeLiteral], rt.voidTypeLiteral);

        // merge: dst.merge(src1, src2)
        rt.regFunc(function (rt, self, src1, src2) {
          var a = arr(self);
          var s1 = arr(src1);
          var s2 = arr(src2);
          var i = 0, j = 0, k = 0;
          while (i < s1.length && j < s2.length) {
            if (elemKey(s1[i]) <= elemKey(s2[j])) {
              a[k++] = copyElem(s1[i++]);
            } else {
              a[k++] = copyElem(s2[j++]);
            }
          }
          while (i < s1.length) a[k++] = copyElem(s1[i++]);
          while (j < s2.length) a[k++] = copyElem(s2[j++]);
          a.length = k;
        }, cType, "merge", [elemType, elemType], rt.voidTypeLiteral);

        // inplace_merge
        rt.regFunc(function (rt, self, middle) {
          var a = arr(self);
          var mid = rt.cast(rt.intTypeLiteral, middle).v;
          var left = a.slice(0, mid);
          var right = a.slice(mid);
          var i = 0, j = 0, k = 0;
          while (i < left.length && j < right.length) {
            if (elemKey(left[i]) <= elemKey(right[j])) {
              a[k++] = copyElem(left[i++]);
            } else {
              a[k++] = copyElem(right[j++]);
            }
          }
          while (i < left.length) a[k++] = copyElem(left[i++]);
          while (j < right.length) a[k++] = copyElem(right[j++]);
        }, cType, "inplace_merge", [rt.intTypeLiteral], rt.voidTypeLiteral);

        // set_union
        rt.regFunc(function (rt, self, src1, src2) {
          var a = arr(self);
          var s1 = arr(src1);
          var s2 = arr(src2);
          var i = 0, j = 0, k = 0;
          while (i < s1.length && j < s2.length) {
            var v1 = elemKey(s1[i]), v2 = elemKey(s2[j]);
            if (v1 < v2) a[k++] = copyElem(s1[i++]);
            else if (v2 < v1) a[k++] = copyElem(s2[j++]);
            else { a[k++] = copyElem(s1[i++]); j++; }
          }
          while (i < s1.length) a[k++] = copyElem(s1[i++]);
          while (j < s2.length) a[k++] = copyElem(s2[j++]);
          a.length = k;
        }, cType, "set_union", [elemType, elemType], rt.voidTypeLiteral);

        // set_intersection
        rt.regFunc(function (rt, self, src1, src2) {
          var a = arr(self);
          var s1 = arr(src1);
          var s2 = arr(src2);
          var i = 0, j = 0, k = 0;
          while (i < s1.length && j < s2.length) {
            var v1 = elemKey(s1[i]), v2 = elemKey(s2[j]);
            if (v1 < v2) i++;
            else if (v2 < v1) j++;
            else { a[k++] = copyElem(s1[i++]); j++; }
          }
          a.length = k;
        }, cType, "set_intersection", [elemType, elemType], rt.voidTypeLiteral);

        // set_difference
        rt.regFunc(function (rt, self, src1, src2) {
          var a = arr(self);
          var s1 = arr(src1);
          var s2 = arr(src2);
          var i = 0, j = 0, k = 0;
          while (i < s1.length && j < s2.length) {
            var v1 = elemKey(s1[i]), v2 = elemKey(s2[j]);
            if (v1 < v2) { a[k++] = copyElem(s1[i++]); }
            else if (v2 < v1) j++;
            else { i++; j++; }
          }
          while (i < s1.length) a[k++] = copyElem(s1[i++]);
          a.length = k;
        }, cType, "set_difference", [elemType, elemType], rt.voidTypeLiteral);

        // set_symmetric_difference
        rt.regFunc(function (rt, self, src1, src2) {
          var a = arr(self);
          var s1 = arr(src1);
          var s2 = arr(src2);
          var i = 0, j = 0, k = 0;
          while (i < s1.length && j < s2.length) {
            var v1 = elemKey(s1[i]), v2 = elemKey(s2[j]);
            if (v1 < v2) { a[k++] = copyElem(s1[i++]); }
            else if (v2 < v1) { a[k++] = copyElem(s2[j++]); }
            else { i++; j++; }
          }
          while (i < s1.length) a[k++] = copyElem(s1[i++]);
          while (j < s2.length) a[k++] = copyElem(s2[j++]);
          a.length = k;
        }, cType, "set_symmetric_difference", [elemType, elemType], rt.voidTypeLiteral);

        // merge: dst.merge(src1, src2)
        rt.regFunc(function (rt, self, src1, src2) {
          var a = arr(self);
          var s1 = arr(src1);
          var s2 = arr(src2);
          var i = 0, j = 0, k = 0;
          while (i < s1.length && j < s2.length) {
            if (elemKey(s1[i]) <= elemKey(s2[j])) a[k++] = copyElem(s1[i++]);
            else a[k++] = copyElem(s2[j++]);
          }
          while (i < s1.length) a[k++] = copyElem(s1[i++]);
          while (j < s2.length) a[k++] = copyElem(s2[j++]);
          a.length = k;
        }, cType, "merge", [elemType, elemType], rt.voidTypeLiteral);

        // inplace_merge
        rt.regFunc(function (rt, self, middle) {
          var a = arr(self);
          var mid = rt.cast(rt.intTypeLiteral, middle).v;
          var left = a.slice(0, mid);
          var right = a.slice(mid);
          var i = 0, j = 0, k = 0;
          while (i < left.length && j < right.length) {
            if (elemKey(left[i]) <= elemKey(right[j])) a[k++] = copyElem(left[i++]);
            else a[k++] = copyElem(right[j++]);
          }
          while (i < left.length) a[k++] = copyElem(left[i++]);
          while (j < right.length) a[k++] = copyElem(right[j++]);
        }, cType, "inplace_merge", [rt.intTypeLiteral], rt.voidTypeLiteral);

        // lexicographical_compare
        rt.regFunc(function (rt, self, other) {
          var a = arr(self);
          var b = arr(other);
          var n = Math.min(a.length, b.length);
          for (var i = 0; i < n; i++) {
            var va = elemKey(a[i]), vb = elemKey(b[i]);
            if (va < vb) return rt.val(rt.boolTypeLiteral, true);
            if (va > vb) return rt.val(rt.boolTypeLiteral, false);
          }
          return rt.val(rt.boolTypeLiteral, a.length < b.length);
        }, cType, "lexicographical_compare", [elemType], rt.boolTypeLiteral);

        // is_sorted
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          for (var i = 1; i < a.length; i++) {
            if (elemKey(a[i]) < elemKey(a[i - 1])) return rt.val(rt.boolTypeLiteral, false);
          }
          return rt.val(rt.boolTypeLiteral, true);
        }, cType, "is_sorted", [], rt.boolTypeLiteral);

        // is_sorted_until
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          for (var i = 1; i < a.length; i++) {
            if (elemKey(a[i]) < elemKey(a[i - 1])) return rt.val(rt.intTypeLiteral, i);
          }
          return rt.val(rt.intTypeLiteral, a.length);
        }, cType, "is_sorted_until", [], rt.intTypeLiteral);

        // includes
        rt.regFunc(function (rt, self, other) {
          var a = arr(self);
          var b = arr(other);
          var i = 0, j = 0;
          while (i < a.length && j < b.length) {
            var va = elemKey(a[i]), vb = elemKey(b[j]);
            if (va < vb) i++;
            else if (va > vb) return rt.val(rt.boolTypeLiteral, false);
            else { i++; j++; }
          }
          return rt.val(rt.boolTypeLiteral, j === b.length);
        }, cType, "includes", [elemType], rt.boolTypeLiteral);

        // equal
        rt.regFunc(function (rt, self, other) {
          var a = arr(self);
          var b = arr(other);
          if (a.length !== b.length) return rt.val(rt.boolTypeLiteral, false);
          for (var i = 0; i < a.length; i++) {
            if (elemKey(a[i]) !== elemKey(b[i])) return rt.val(rt.boolTypeLiteral, false);
          }
          return rt.val(rt.boolTypeLiteral, true);
        }, cType, "equal", [elemType], rt.boolTypeLiteral);

        // mismatch
        rt.regFunc(function (rt, self, other) {
          var a = arr(self);
          var b = arr(other);
          var n = Math.min(a.length, b.length);
          for (var i = 0; i < n; i++) {
            if (elemKey(a[i]) !== elemKey(b[i])) return rt.val(rt.intTypeLiteral, i);
          }
          return rt.val(rt.intTypeLiteral, n);
        }, cType, "mismatch", [elemType], rt.intTypeLiteral);

        // search
        rt.regFunc(function (rt, self, pattern) {
          var a = arr(self);
          var p = arr(pattern);
          if (!p.length) return rt.val(rt.intTypeLiteral, 0);
          for (var i = 0; i <= a.length - p.length; i++) {
            var match = true;
            for (var j = 0; j < p.length; j++) {
              if (elemKey(a[i + j]) !== elemKey(p[j])) { match = false; break; }
            }
            if (match) return rt.val(rt.intTypeLiteral, i);
          }
          return rt.val(rt.intTypeLiteral, a.length);
        }, cType, "search", [elemType], rt.intTypeLiteral);

        // rotate
        rt.regFunc(function (rt, self, middle) {
          var a = arr(self);
          var mid = rt.cast(rt.intTypeLiteral, middle).v;
          var left = a.slice(0, mid);
          var right = a.slice(mid);
          a.length = 0;
          a.push.apply(a, right.concat(left));
        }, cType, "rotate", [rt.intTypeLiteral], rt.voidTypeLiteral);

        // shuffle (简化版 Fisher-Yates)
        rt.regFunc(function (rt, self, rng) {
          var a = arr(self);
          for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = a[i];
            a[i] = a[j];
            a[j] = tmp;
          }
        }, cType, "shuffle", [rt.voidTypeLiteral], rt.voidTypeLiteral);

        // sample (简化版)
        rt.regFunc(function (rt, self, out, n, rng) {
          var a = arr(self);
          var outArr = arr(out);
          var k = rt.cast(rt.intTypeLiteral, n).v;
          var idxs = [];
          for (var i = 0; i < a.length; i++) idxs.push(i);
          for (var i = idxs.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = idxs[i];
            idxs[i] = idxs[j];
            idxs[j] = tmp;
          }
          var k = Math.min(k, a.length);
          for (var i = 0; i < k; i++) outArr.push(copyElem(a[idxs[i]]));
          outArr.length = k;
        }, cType, "sample", [elemType, rt.intTypeLiteral, rt.voidTypeLiteral], rt.voidTypeLiteral);
        // 这些方法通过检测元素类型来决定行为

        // __map_set(key, value) - 设置/更新键值对
        rt.regFunc(function (rt, self, keyVal, valueVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          var value = rt.cast(elemType, valueVal);
          // 检查是否为 pair 类型
          var isPair = isPairElemType();
          if (isPair) {
            // 查找现有 key
            for (var i = 0; i < a.length; i++) {
              if (a[i].v && a[i].v.members && a[i].v.members.first && a[i].v.members.first.v === key.v) {
                a[i].v.members.second = copyElem(valueVal);
                return;
              }
            }
            // 不存在则添加新 pair
            var newPair = makeDefaultElem();
            newPair.v.members.first = copyElem(keyVal);
            newPair.v.members.second = copyElem(valueVal);
            a.push(newPair);
          }
        }, cType, "__map_set", [elemType, elemType], rt.voidTypeLiteral);

        // __map_get(key) - 获取值（不存在则创建默认值）
        rt.regFunc(function (rt, self, keyVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          var isPair = isPairElemType();
          if (isPair) {
            for (var i = 0; i < a.length; i++) {
              if (a[i].v && a[i].v.members && a[i].v.members.first && a[i].v.members.first.v === key.v) {
                a[i].left = true;
                return a[i].v.members.second;
              }
            }
            // 不存在则创建默认值
            var newPair = makeDefaultElem();
            newPair.v.members.first = copyElem(keyVal);
            a.push(newPair);
            newPair.left = true;
            return newPair.v.members.second;
          }
          return makeDefaultElem();
        }, cType, "__map_get", [elemType], elemType);

        // __map_find(key) - 查找键，返回迭代器（索引）
        rt.regFunc(function (rt, self, keyVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          var isPair = isPairElemType();
          if (isPair) {
            for (var i = 0; i < a.length; i++) {
              if (a[i].v && a[i].v.members && a[i].v.members.first && a[i].v.members.first.v === key.v) {
                return rt.val(rt.intTypeLiteral, i);
              }
            }
          }
          return rt.val(rt.intTypeLiteral, a.length); // end()
        }, cType, "__map_find", [elemType], rt.intTypeLiteral);

        // __map_erase(key) - 删除键
        rt.regFunc(function (rt, self, keyVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          var isPair = isPairElemType();
          if (isPair) {
            for (var i = 0; i < a.length; i++) {
              if (a[i].v && a[i].v.members && a[i].v.members.first && a[i].v.members.first.v === key.v) {
                a.splice(i, 1);
                return rt.val(rt.intTypeLiteral, 1);
              }
            }
          }
          return rt.val(rt.intTypeLiteral, 0);
        }, cType, "__map_erase", [elemType], rt.intTypeLiteral);

        // __map_count(key) - 键计数（0 或 1）
        rt.regFunc(function (rt, self, keyVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          if (isPairElemType()) {
            for (var i = 0; i < a.length; i++) {
              if (a[i].v && a[i].v.members && a[i].v.members.first && a[i].v.members.first.v === key.v) {
                return rt.val(rt.intTypeLiteral, 1);
              }
            }
          }
          return rt.val(rt.intTypeLiteral, 0);
        }, cType, "__map_count", [elemType], rt.intTypeLiteral);

        // __set_find(key) - set 查找
        rt.regFunc(function (rt, self, keyVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          var isPair = isPairElemType();
          if (!isPair) {
            for (var i = 0; i < a.length; i++) {
              if (a[i].v === key.v) {
                return rt.val(rt.intTypeLiteral, i);
              }
            }
          }
          return rt.val(rt.intTypeLiteral, a.length);
        }, cType, "__set_find", [elemType], rt.intTypeLiteral);

        // __set_insert(key) - set 插入
        rt.regFunc(function (rt, self, keyVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          var isPair = isPairElemType();
          if (!isPair) {
            // 检查是否已存在
            for (var i = 0; i < a.length; i++) {
              if (a[i].v === key.v) {
                return rt.val(rt.intTypeLiteral, i);
              }
            }
            a.push(copyElem(keyVal));
            return rt.val(rt.intTypeLiteral, a.length - 1);
          }
          return rt.val(rt.intTypeLiteral, -1);
        }, cType, "__set_insert", [elemType], rt.intTypeLiteral);

        // __set_erase(key) - set 删除
        rt.regFunc(function (rt, self, keyVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          var isPair = isPairElemType();
          if (!isPair) {
            for (var i = 0; i < a.length; i++) {
              if (a[i].v === key.v) {
                a.splice(i, 1);
                return rt.val(rt.intTypeLiteral, 1);
              }
            }
          }
          return rt.val(rt.intTypeLiteral, 0);
        }, cType, "__set_erase", [elemType], rt.intTypeLiteral);

        // __set_count(key) - 元素计数（0 或 1）
        rt.regFunc(function (rt, self, keyVal) {
          var a = arr(self);
          var key = rt.cast(elemType, keyVal);
          if (!isPairElemType()) {
            for (var i = 0; i < a.length; i++) {
              if (a[i].v === key.v) {
                return rt.val(rt.intTypeLiteral, 1);
              }
            }
          }
          return rt.val(rt.intTypeLiteral, 0);
        }, cType, "__set_count", [elemType], rt.intTypeLiteral);

        // operator[]：保证返回可用的左值元素（支持 cin>>a[i] 与嵌套 G[u].push_back）
        rt.types[sig].handlers["o([])"] = {
          default: function (rt, self, idxVal) {
            var a = arr(self);
            var i = Math.trunc(idxVal.v);
            if (i < 0 || i >= a.length) {
              rt.raiseException("vector subscript out of range: " + i);
            }
            if (!a[i]) a[i] = makeDefaultElem();
            // 嵌套容器：确保 data 数组存在
            if (a[i].v && typeof a[i].v === "object") {
              if (!a[i].v.members) a[i].v.members = {};
              if (a[i].v.members.data === undefined) a[i].v.members.data = [];
            }
            a[i].left = true;
            a[i].t = elemType;
            return a[i];
          },
        };
      } else if (kind === "queue") {
        rt.regFunc(function (rt, self, x) {
          arr(self).push(copyElem(x));
        }, cType, "push", [elemType], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self, x) {
          arr(self).push(copyElem(x));
        }, cType, "emplace", [elemType], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("pop on empty queue");
          a.shift();
        }, cType, "pop", [], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("front on empty queue");
          return a[0];
        }, cType, "front", [], elemType);
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("back on empty queue");
          return a[a.length - 1];
        }, cType, "back", [], elemType);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.boolTypeLiteral, arr(self).length === 0);
        }, cType, "empty", [], rt.boolTypeLiteral);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, arr(self).length);
        }, cType, "size", [], rt.intTypeLiteral);
      } else if (kind === "stack") {
        rt.regFunc(function (rt, self, x) {
          arr(self).push(copyElem(x));
        }, cType, "push", [elemType], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self, x) {
          arr(self).push(copyElem(x));
        }, cType, "emplace", [elemType], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("pop on empty stack");
          a.pop();
        }, cType, "pop", [], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("top on empty stack");
          return a[a.length - 1];
        }, cType, "top", [], elemType);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.boolTypeLiteral, arr(self).length === 0);
        }, cType, "empty", [], rt.boolTypeLiteral);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, arr(self).length);
        }, cType, "size", [], rt.intTypeLiteral);
      } else if (kind === "priority_queue") {
        // 简化版最大堆（仅支持可比较的数值类型）
        function heapUp(a, idx) {
          while (idx > 0) {
            var p = (idx - 1) >> 1;
            if (a[p].v >= a[idx].v) break;
            var tmp = a[p];
            a[p] = a[idx];
            a[idx] = tmp;
            idx = p;
          }
        }
        function heapDown(a, idx) {
          var n = a.length;
          while (true) {
            var l = idx * 2 + 1;
            var r = l + 1;
            var largest = idx;
            if (l < n && a[l].v > a[largest].v) largest = l;
            if (r < n && a[r].v > a[largest].v) largest = r;
            if (largest === idx) break;
            var tmp = a[idx];
            a[idx] = a[largest];
            a[largest] = tmp;
            idx = largest;
          }
        }
        rt.regFunc(function (rt, self, x) {
          var a = arr(self);
          a.push(copyElem(x));
          heapUp(a, a.length - 1);
        }, cType, "push", [elemType], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self, x) {
          var a = arr(self);
          a.push(copyElem(x));
          heapUp(a, a.length - 1);
        }, cType, "emplace", [elemType], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("pop on empty priority_queue");
          a[0] = a[a.length - 1];
          a.pop();
          if (a.length) heapDown(a, 0);
        }, cType, "pop", [], rt.voidTypeLiteral);
        rt.regFunc(function (rt, self) {
          var a = arr(self);
          if (!a.length) rt.raiseException("top on empty priority_queue");
          return a[0];
        }, cType, "top", [], elemType);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.boolTypeLiteral, arr(self).length === 0);
        }, cType, "empty", [], rt.boolTypeLiteral);
        rt.regFunc(function (rt, self) {
          return rt.val(rt.intTypeLiteral, arr(self).length);
        }, cType, "size", [], rt.intTypeLiteral);
}
  }

    // 注册 string 类型的方法 shim（如果代码中使用了 string）
    // 注意：JSCPP 内置了基础 string，但方法可能不全，这里补充
    function regStringMethods(rt) {
      try {
        // 查找 string 类型
        var stringType = null;
        for (var key in rt.types) {
          var t = rt.types[key];
          if (t && (t.name === "string" || t.name === "std::string" || key.indexOf("string") >= 0)) {
            stringType = t;
            break;
          }
        }
        if (stringType && stringType.handlers) {
          var h = stringType.handlers;
          // size() / length()
          if (!h["m(size)"]) {
            h["m(size)"] = {
              default: function (rt, self) {
                var s = self.v || "";
                return rt.val(rt.intTypeLiteral, String(s).length);
              }
            };
          }
          if (!h["m(length)"]) {
            h["m(length)"] = h["m(size)"];
          }
          // empty()
          if (!h["m(empty)"]) {
            h["m(empty)"] = {
              default: function (rt, self) {
                var s = self.v || "";
                return rt.val(rt.boolTypeLiteral, String(s).length === 0);
              }
            };
          }
          // clear()
          if (!h["m(clear)"]) {
            h["m(clear)"] = {
              default: function (rt, self) {
                self.v = "";
              }
            };
          }
          // push_back(char)
          if (!h["m(push_back)"]) {
            h["m(push_back)"] = {
              default: function (rt, self, ch) {
                var c = rt.cast(rt.charTypeLiteral, ch).v;
                self.v = (self.v || "") + String.fromCharCode(c);
              }
            };
          }
          // pop_back()
          if (!h["m(pop_back)"]) {
            h["m(pop_back)"] = {
              default: function (rt, self) {
                var s = String(self.v || "");
                if (s.length > 0) self.v = s.slice(0, -1);
              }
            };
          }
          // front() / back()
          if (!h["m(front)"]) {
            h["m(front)"] = {
              default: function (rt, self) {
                var s = String(self.v || "");
                return rt.val(rt.charTypeLiteral, s.length > 0 ? s.charCodeAt(0) : 0);
              }
            };
          }
          if (!h["m(back)"]) {
            h["m(back)"] = {
              default: function (rt, self) {
                var s = String(self.v || "");
                return rt.val(rt.charTypeLiteral, s.length > 0 ? s.charCodeAt(s.length - 1) : 0);
              }
            };
          }
          // operator[](size_t)
          if (!h["o([])"]) {
            h["o([])"] = {
              default: function (rt, self, idxVal) {
                var s = String(self.v || "");
                var i = Math.trunc(idxVal.v);
                if (i < 0 || i >= s.length) rt.raiseException("string subscript out of range");
                var ch = s.charCodeAt(i);
                var result = rt.val(rt.charTypeLiteral, ch);
                result.left = true;
                return result;
              }
            };
          }
          // at(size_t)
          if (!h["m(at)"]) {
            h["m(at)"] = h["o([])"];
          }
          // substr(pos, len)
          if (!h["m(substr)"]) {
            h["m(substr)"] = {
              default: function (rt, self, posVal, lenVal) {
                var s = String(self.v || "");
                var pos = Math.trunc(posVal.v);
                var len = lenVal ? Math.trunc(lenVal.v) : s.length - pos;
                if (pos < 0) pos = 0;
                if (pos > s.length) pos = s.length;
                if (pos + len > s.length) len = s.length - pos;
                var sub = s.substr(pos, len);
                return rt.val(stringType, sub, true);
              }
            };
          }
          // find(str, pos)
          if (!h["m(find)"]) {
            h["m(find)"] = {
              default: function (rt, self, strVal, posVal) {
                var s = String(self.v || "");
                var search = String(rt.cast(stringType, strVal).v || "");
                var pos = posVal ? Math.trunc(posVal.v) : 0;
                var idx = s.indexOf(search, pos);
                return rt.val(rt.intTypeLiteral, idx >= 0 ? idx : -1);
              }
            };
          }
          // append(str)
          if (!h["m(append)"]) {
            h["m(append)"] = {
              default: function (rt, self, strVal) {
                var s = String(self.v || "");
                var appendStr = String(rt.cast(stringType, strVal).v || "");
                self.v = s + appendStr;
              }
            };
          }
          // c_str() / data() - 返回自身（因为内部就是 JS 字符串）
          if (!h["m(c_str)"] && !h["m(data)"]) {
            h["m(c_str)"] = {
              default: function (rt, self) {
                return self; // 返回自身，兼容 C 风格字符串
              }
            };
            h["m(data)"] = h["m(c_str)"];
          }
        }
      } catch (e) {
        // 忽略 string shim 注册失败
      }
    }
    regStringMethods(rt);

    for (var idx = 0; idx < registrations.length; idx++) {
      var reg = registrations[idx];

      if (reg.kind === "pair") {
        var typeA = resolveSTLElementType(rt, reg.elems[0], createdTypes);
        var typeB = resolveSTLElementType(rt, reg.elems[1], createdTypes);
        if (!typeA || !typeB) {
          rt.raiseException("不支持的 pair 元素类型: " + reg.elems.join(", "));
          continue;
        }
        var pType = rt.newClass(reg.alias, [
          { name: "first", type: typeA },
          { name: "second", type: typeB },
        ]);
        rt.types[rt.getTypeSignature(pType)].father = "object";
        createdTypes[reg.alias] = pType;
        continue;
      }

      var elemType = resolveSTLElementType(rt, reg.elems[0], createdTypes);
      if (!elemType) {
        rt.raiseException("不支持的容器元素类型: " + reg.elems[0]);
        continue;
      }
      var cType = rt.newClass(reg.alias, [
        {
          name: "data",
          type: rt.intTypeLiteral,
          // initialize(rt, self) —— 返回原始 JS 数组作为内部存储
          initialize: function (/* rt, self */) {
            return [];
          },
        },
      ]);
      var sig = rt.getTypeSignature(cType);
      rt.types[sig].father = "object";
      createdTypes[reg.alias] = cType;
      regContainerMethods(cType, sig, elemType, reg.kind);
    }
  }

  /* ------------------------------------------------------------------ *
   * 主预处理入口
   * ------------------------------------------------------------------ */
  function preprocessCppForJSCPP(code) {
    // 0. 修复从 Markdown/HTML 代码块复制时产生的转义损坏
    var out = String(code || "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#9;/g, "\t")
      .replace(/&#x9;/gi, "\t")
      .replace(/&nbsp;/g, " ")
      .replace(/\\\\</g, "<")
      .replace(/\\\\>/g, ">")
      .replace(/\\_/g, "_")
      .replace(/\\:/g, ":")
      .replace(/\\\\/g, "\\");

    for (var fixRound = 0; fixRound < 3; fixRound++) {
      out = out
        .replace(/\\\\</g, "<")
        .replace(/\\\\>/g, ">")
        .replace(/\\</g, "<")
        .replace(/\\>/g, ">");
    }
    out = out
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#60;/g, "<")
      .replace(/&#62;/g, ">");

    out = applyJSCPPSTLCompat(out);
    out = expandContestTypedefs(out);

    // 1. 展开 bits/stdc++.h（string 库由 config.includes 注入，需保留 <string>）
    var stdcppBundle =
      "#include <iostream>\n" +
      "#include <string>\n" +
      "#include <cstdio>\n" +
      "#include <cstdlib>\n" +
      "#include <cstring>\n" +
      "#include <cmath>\n" +
      "#include <cctype>\n" +
      "#include <climits>\n" +
      "#include <ctime>\n" +
      "#include <iomanip>\n";

    out = out.replace(
      /#\s*include\s*[<"]bits\/stdc\+\+\.h[>"]/gi,
      stdcppBundle
    );

    // 2. 头文件映射
    //    注意：<string> 不再映射——由 config.includes 注入自实现的 string 库
    var headerMap = {
      "<vector>": "<iostream>",
      "<algorithm>": "<iostream>",
      "<map>": "<iostream>",
      "<set>": "<iostream>",
      "<queue>": "<iostream>",
      "<stack>": "<iostream>",
      "<deque>": "<iostream>",
      "<list>": "<iostream>",
      "<utility>": "<iostream>",
      "<functional>": "<iostream>",
      "<numeric>": "<iostream>",
      "<limits>": "<climits>",
      "<sstream>": "<iostream>",
      "<fstream>": "<cstdio>",
      "<iomanip>": "<iomanip>",
      "<iostream>": "<iostream>",
      "<cstdio>": "<cstdio>",
      "<cstdlib>": "<cstdlib>",
      "<cstring>": "<cstring>",
      "<cmath>": "<cmath>",
      "<cctype>": "<cctype>",
      "<climits>": "<climits>",
      "<ctime>": "<ctime>",
      "<array>": "<iostream>",
      "<bitset>": "<iostream>",
      "<complex>": "<cmath>",
      "<valarray>": "<iostream>",
      "<iterator>": "<iostream>",
      "<memory>": "<iostream>",
      "<new>": "<cstdlib>",
      "<typeinfo>": "<iostream>",
      "<exception>": "<iostream>",
      "<stdexcept>": "<iostream>",
      "<cassert>": "<cstdlib>",
      "<cfloat>": "<cmath>",
      "<cstdarg>": "<cstdlib>",
      "<cstddef>": "<cstdlib>",
      "<cstdint>": "<climits>",
      "<cinttypes>": "<cstdio>",
      "<cstdbool>": "<cstdlib>",
      "<cwchar>": "<cstring>",
      "<cwctype>": "<cctype>",
      "<cfenv>": "<cmath>",
      "<clocale>": "<cstdlib>",
      "<codecvt>": "<iostream>",
      "<regex>": "<iostream>",
      "<random>": "<cstdlib>",
      "<chrono>": "<ctime>",
      "<ratio>": "<iostream>",
      "<tuple>": "<iostream>",
      "<type_traits>": "<iostream>",
      "<initializer_list>": "<iostream>",
      "<scoped_allocator>": "<iostream>",
      "<system_error>": "<iostream>",
      "<thread>": "<iostream>",
      "<mutex>": "<iostream>",
      "<atomic>": "<iostream>",
      "<future>": "<iostream>",
      "<condition_variable>": "<iostream>",
      "<unordered_map>": "<iostream>",
      "<unordered_set>": "<iostream>",
      "<forward_list>": "<iostream>",
      "<stdio.h>": "<cstdio>",
      "<stdlib.h>": "<cstdlib>",
      "<string.h>": "<cstring>",
      "<math.h>": "<cmath>",
      "<ctype.h>": "<cctype>",
      "<limits.h>": "<climits>",
      "<time.h>": "<ctime>",
      "<iostream.h>": "<iostream>",
      "<assert.h>": "<cstdlib>",
      "<float.h>": "<cmath>",
      "<stdarg.h>": "<cstdlib>",
      "<stddef.h>": "<cstdlib>",
      "<stdint.h>": "<climits>",
      "<inttypes.h>": "<cstdio>",
      "<stdbool.h>": "<cstdlib>",
      "<wchar.h>": "<cstring>",
      "<wctype.h>": "<cctype>",
      "<locale.h>": "<cstdlib>",
      "<errno.h>": "<cstdlib>",
      "<fenv.h>": "<cmath>",
      // 旧式 / 非标准 .h 头（部分教材仍在使用）
      "<vector.h>": "<iostream>",
      "<queue.h>": "<iostream>",
      "<stack.h>": "<iostream>",
      "<deque.h>": "<iostream>",
      "<list.h>": "<iostream>",
      "<map.h>": "<iostream>",
      "<set.h>": "<iostream>",
      "<algorithm.h>": "<iostream>",
      "<utility.h>": "<iostream>",
      "<fstream.h>": "<cstdio>",
      "<sstream.h>": "<iostream>",
      "<iomanip.h>": "<iomanip>",
    };

    out = out.replace(
      /#\s*include\s*([<"])([^>"]+)([>"])/g,
      function (match, open, name, close) {
        var key = open + name + close;
        var lowerKey = key.toLowerCase();
        if (
          /<(iostream|string|cstdio|cstdlib|cstring|cmath|cctype|climits|ctime|iomanip)>/.test(
            lowerKey
          )
        ) {
          return match;
        }
        for (var k in headerMap) {
          if (
            lowerKey === k.toLowerCase() ||
            lowerKey === k.replace(/[<>]/g, "").toLowerCase()
          ) {
            return headerMap[k]
              ? "#include " + headerMap[k]
              : "/* removed unsupported include: " + match + " */";
          }
        }
        return "/* unsupported include: " + match + " */";
      }
    );

    // 3. std:: 展开
    var stdReplacements = [
      [/\bstd::cout\b/g, "cout"],
      [/\bstd::cin\b/g, "cin"],
      [/\bstd::cerr\b/g, "cerr"],
      [/\bstd::clog\b/g, "cerr"],
      [/\bstd::endl\b/g, "endl"],
      [/\bstd::string\b/g, "string"],
      [/\bstd::getline\b/g, "getline"],
      [/\bstd::ios\b/g, "ios"],
      [/\bstd::ios_base\b/g, "ios_base"],
      [/\bstd::streamsize\b/g, "streamsize"],
      [/\bstd::fixed\b/g, "fixed"],
      [/\bstd::setprecision\b/g, "setprecision"],
      [/\bstd::setw\b/g, "setw"],
      [/\bstd::setfill\b/g, "setfill"],
      [/\bstd::left\b/g, "left"],
      [/\bstd::right\b/g, "right"],
      [/\bstd::hex\b/g, "hex"],
      [/\bstd::dec\b/g, "dec"],
      [/\bstd::oct\b/g, "oct"],
      [/\bstd::showpoint\b/g, "showpoint"],
      [/\bstd::noshowpoint\b/g, "noshowpoint"],
      [/\bstd::scientific\b/g, "scientific"],
      [/\bstd::defaultfloat\b/g, "defaultfloat"],
      [/\bstd::boolalpha\b/g, "boolalpha"],
      [/\bstd::noboolalpha\b/g, "noboolalpha"],
      [/\bstd::showbase\b/g, "showbase"],
      [/\bstd::noshowbase\b/g, "noshowbase"],
      [/\bstd::uppercase\b/g, "uppercase"],
      [/\bstd::nouppercase\b/g, "nouppercase"],
      [/\bstd::unitbuf\b/g, "unitbuf"],
      [/\bstd::nounitbuf\b/g, "nounitbuf"],
      [/\bstd::internal\b/g, "internal"],
      [/\bstd::size_t\b/g, "unsigned long"],
      [/\bstd::ptrdiff_t\b/g, "long"],
      [/\bstd::nullptr_t\b/g, "void*"],
      [/\bstd::int8_t\b/g, "signed char"],
      [/\bstd::int16_t\b/g, "short"],
      [/\bstd::int32_t\b/g, "int"],
      [/\bstd::int64_t\b/g, "long long"],
      [/\bstd::uint8_t\b/g, "unsigned char"],
      [/\bstd::uint16_t\b/g, "unsigned short"],
      [/\bstd::uint32_t\b/g, "unsigned int"],
      [/\bstd::uint64_t\b/g, "unsigned long long"],
      [/\bstd::intmax_t\b/g, "long long"],
      [/\bstd::uintmax_t\b/g, "unsigned long long"],
      [/\bstd::abs\b/g, "abs"],
      [/\bstd::fabs\b/g, "fabs"],
      [/\bstd::sqrt\b/g, "sqrt"],
      [/\bstd::pow\b/g, "pow"],
      [/\bstd::sin\b/g, "sin"],
      [/\bstd::cos\b/g, "cos"],
      [/\bstd::tan\b/g, "tan"],
      [/\bstd::floor\b/g, "floor"],
      [/\bstd::ceil\b/g, "ceil"],
      [/\bstd::round\b/g, "round"],
      [/\bstd::min\b/g, "min"],
      [/\bstd::max\b/g, "max"],
      [/\bstd::swap\b/g, "swap"],
      [/\bstd::to_string\b/g, "to_string"],
      // 更多数学函数
      [/\bstd::log\b/g, "log"],
      [/\bstd::log10\b/g, "log10"],
      [/\bstd::exp\b/g, "exp"],
      [/\bstd::asin\b/g, "asin"],
      [/\bstd::acos\b/g, "acos"],
      [/\bstd::atan\b/g, "atan"],
      [/\bstd::atan2\b/g, "atan2"],
      [/\bstd::sinh\b/g, "sinh"],
      [/\bstd::cosh\b/g, "cosh"],
      [/\bstd::tanh\b/g, "tanh"],
      [/\bstd::fmod\b/g, "fmod"],
      [/\bstd::fmax\b/g, "fmax"],
      [/\bstd::fmin\b/g, "fmin"],
      [/\bstd::hypot\b/g, "hypot"],
      [/\bstd::cbrt\b/g, "cbrt"],
      [/\bstd::trunc\b/g, "trunc"],
      [/\bstd::ldexp\b/g, "ldexp"],
      [/\bstd::frexp\b/g, "frexp"],
      [/\bstd::modf\b/g, "modf"],
      [/\bstd::scalbn\b/g, "scalbn"],
      [/\bstd::nextafter\b/g, "nextafter"],
      [/\bstd::copysign\b/g, "copysign"],
    ];
    for (var i = 0; i < stdReplacements.length; i++) {
      out = out.replace(stdReplacements[i][0], stdReplacements[i][1]);
    }

    // 4. 自动补 using namespace std;
    if (
      /#include\s*<(iostream|iomanip|cstdio)>/.test(out) &&
      !/using\s+namespace\s+std\s*;/.test(out)
    ) {
      out = out.replace(
        /(#include\s*<[^>]+>\s*\n?)/,
        "$1using namespace std;\n"
      );
    }

    out = applyJSCPPSTLCompat(out);

    // 4.4 string 支持：确保 <string> 被包含 + 声明初始化/拼接改写
    if (/\bstring\s+[A-Za-z_]\w*\s*[=;\[),]/.test(out) && !/#include\s*<string>/.test(out)) {
      out = out.replace(/(#include\s*<[^>]+>\s*\n?)/, "$1#include <string>\n");
      if (!/#include\s*<string>/.test(out)) {
        out = "#include <string>\n" + out;
      }
    }
    out = transpileStringSupport(out);

    // 4.5 map/set 模拟：先于容器别名化执行，
    //     使生成的 vector<pair<K,V>> 能被 transpileSTLContainers 正常别名化
    out = transpileMapSet(out);

    // 5. 容器模板 → 别名
    var registrations = [];
    var registryMap = {};
    out = transpileSTLContainers(out, registrations, registryMap);

    // 6. 算法调用改写（必须在容器别名之后，变量名仍是原标识符）
    out = transpileAlgorithms(out);

    // 7. 迭代器风格 for + range-for
    out = transpileIteratorFor(out);
    out = transpileRangeFor(out, registryMap);

    // 7. 初始化列表转译
    out = transpileInitializerLists(out);

    // 8. auto
    out = transpileAuto(out);

    // 9. 额外类型别名与 string 常用写法兼容
    out = out
      .replace(/\bsize_t\b/g, "unsigned long")
      .replace(/\bptrdiff_t\b/g, "long")
      .replace(/\bnullptr\b/g, "0");

    // string 常见方法别名（JSCPP 内置 string 能力有限，做名称兼容）
    // s.length() 与 s.size() 在多数实现中等价；若只有其一也能用
    out = out.replace(/\.length\s*\(\s*\)/g, ".size()");
    // string 常用方法映射
    out = out.replace(/\.substr\s*\(/g, ".substr(");
    out = out.replace(/\.find\s*\(/g, ".find(");
    out = out.replace(/\.append\s*\(/g, ".append(");
    out = out.replace(/\.c_str\s*\(\s*\)/g, ".c_str()");
    out = out.replace(/\.data\s*\(\s*\)/g, ".data()");
    // 支持 string 的 operator+=
    // 支持 to_string (已在 std:: 映射中)

    // 10. 支持基础的 std::move / std::forward 语义（忽略，按引用传递）
    out = out.replace(/\bstd::move\s*\(/g, "(");
    out = out.replace(/\bstd::forward\s*<\s*[^>]*>\s*\(/g, "(");
    out = out.replace(/\bstd::ref\s*\(/g, "(");
    out = out.replace(/\bstd::cref\s*\(/g, "(");

    // 11. 支持基础的 initializer_list 语法（转为 vector 初始化）
    // {1, 2, 3} -> vector<int>{1, 2, 3} 等较复杂，暂不处理

    // 12. 不支持检测
    var unsupported = detectUnsupportedSTLUsage(out);
    if (unsupported) {
      throw new Error(
        "该代码用到了 " +
          unsupported +
          "，当前浏览器内置的 C++ 解释器（JSCPP）暂不支持。\n" +
          "目前支持:\n" +
          "  • 容器: vector / deque / queue / stack / pair / priority_queue（含嵌套）\n" +
          "  • 迭代器: begin/end（索引模拟）、range-based for、经典 for(it=begin;it!=end;++it)\n" +
          "  • 算法: sort / reverse / find / count / lower_bound / upper_bound /\n" +
          "          binary_search / fill / unique / accumulate / min_element / max_element\n" +
          "  • 其它: 基础 auto、大量头文件映射、竞赛 typedef/#define\n" +
          "建议改用支持的写法，或使用普通数组 + 经典 for 循环改写。"
      );
    }

    __pendingSTLRegistrations = registrations;
    if (registrations.length) {
      out = "#include <__stl_shim>\n" + out;
    }

    return out;
  }

  /* ------------------------------------------------------------------ *
   * 对外 API
   * ------------------------------------------------------------------ */
  var api = {
    version: "1.5.0",
    preprocess: preprocessCppForJSCPP,
    installSTLShimTypes: installSTLShimTypes,
loadStringLib: loadStringLib,
    transpileStringSupport: transpileStringSupport,
    getPendingSTLRegistrations: function () {
      return __pendingSTLRegistrations || [];
    },
    setPendingSTLRegistrations: function (regs) {
      __pendingSTLRegistrations = regs || [];
    },
    applyJSCPPSTLCompat: applyJSCPPSTLCompat,
    transpileSTLContainers: transpileSTLContainers,
    transpileRangeFor: transpileRangeFor,
    transpileAuto: transpileAuto,
    transpileAlgorithms: transpileAlgorithms,
    transpileIteratorFor: transpileIteratorFor,
    detectUnsupportedSTLUsage: detectUnsupportedSTLUsage,
    expandContestTypedefs: expandContestTypedefs,
    CompilerRuntime: (function () {
      var __stdinLines = [];
      var __terminalEcho = "";
      var __inputWaiter = null;
      var jscppReady = false;
      var jscppLoading = null;

      function loadScript(src) {
        return new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = src;
          s.async = true;
          s.onload = resolve;
          s.onerror = function () { reject(new Error("加载脚本失败: " + src)); };
          document.head.appendChild(s);
        });
      }

      async function ensureJSCPP() {
        if (jscppReady && typeof JSCPP !== "undefined" && typeof JSCPP.run === "function" && typeof JSCPPCompat !== "undefined" && typeof JSCPPCompat.preprocess === "function") {
          return;
        }
        if (window.jscppLoading) return window.jscppLoading;

        window.jscppLoading = (async function () {
          // 1. 加载核心 JSCPP 解释器
          const urls = [
            "vendor/JSCPP.es5.min.js",
            "./vendor/JSCPP.es5.min.js",
            "/vendor/JSCPP.es5.min.js",
            "https://felixhao28.github.io/JSCPP/dist/JSCPP.es5.min.js",
          ];
          let lastErr = null;
          for (let i = 0; i < urls.length; i++) {
            try {
              await loadScript(urls[i]);
              if (typeof JSCPP !== "undefined" && typeof JSCPP.run === "function") break;
            } catch (e) { lastErr = e; }
          }
          if (typeof JSCPP === "undefined" || typeof JSCPP.run !== "function") throw lastErr || new Error("无法加载 C/C++ 解释器 (JSCPP)");

          if (typeof JSCPPCompat === "undefined" || typeof JSCPPCompat.preprocess !== "function") {
            const compatUrls = ["vendor/jscpp-compat.js", "./vendor/jscpp-compat.js", "/vendor/jscpp-compat.js"];
            let compatErr = null;
            for (let ci = 0; ci < compatUrls.length; ci++) {
              try { await loadScript(compatUrls[ci]); if (typeof JSCPPCompat !== "undefined" && typeof JSCPPCompat.preprocess === "function") { break; } }
              catch (e) { compatErr = e; }
            }
            if (typeof JSCPPCompat === "undefined" || typeof JSCPPCompat.preprocess !== "function") throw compatErr || new Error("无法加载 JSCPP 兼容层");
          }

          if (typeof JSCPPCompat !== "undefined" && typeof JSCPP !== "undefined") JSCPP.compat = JSCPPCompat;
        })();

        try { await window.jscppLoading; } catch (e) { window.jscppLoading = null; throw e; }
      }

      var __stdinLines = [];
      var __terminalEcho = "";
      var __inputWaiter = null;

      function resetTerminalEcho() { window.__terminalEcho = ""; }

      function appendTerminal(text) {
        window.__terminalEcho = (window.__terminalEcho || "") + text;
        var output = document.getElementById("runner-output");
        if (output) { output.textContent = window.__terminalEcho; output.className = ""; output.parentElement && (output.parentElement.scrollTop = output.parentElement.scrollHeight); }
      }

      function setupInteractiveInputUI() {
        var bar = document.getElementById("runner-interactive-input");
        var input = document.getElementById("runner-live-input");
        var submit = document.getElementById("runner-live-submit");
        var promptEl = document.getElementById("runner-prompt-text");
        if (!bar || !input || !submit) return;

        function hide() { bar.classList.remove("active"); input.value = ""; }

        function accept() {
          if (!window.__inputWaiter) return;
          var val = document.getElementById("runner-live-input").value;
          var p = window.__inputWaiter.promptText || "";
          appendTerminal(p + val + "\n");
          var resolve = window.__inputWaiter.resolve;
          window.__inputWaiter = null;
          hide();
          resolve(val);
        }

        window.__showRunnerPrompt = function (promptText) {
          var bar = document.getElementById("runner-interactive-input");
          var input = document.getElementById("runner-live-input");
          var promptEl = document.getElementById("runner-prompt-text");
          if (!bar || !input || !promptEl) return;
          bar.classList.add("active");
          promptEl.textContent = promptText && String(promptText).trim() ? String(promptText) : ">>>";
          document.getElementById("runner-live-input").value = "";
          setTimeout(function () { input.focus(); }, 0);
        };
        window.__hideRunnerPrompt = function () { document.getElementById("runner-interactive-input").classList.remove("active"); };

        document.getElementById("runner-live-submit").onclick = function () { accept(); };
        document.getElementById("runner-live-input").onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); accept(); } };
      }

      function resetTerminalEcho() { window.__terminalEcho = ""; }

      function appendTerminal(text) { window.__terminalEcho = (window.__terminalEcho || "") + text; var output = document.getElementById("runner-output"); if (output) { output.textContent = window.__terminalEcho; output.className = ""; output.parentElement && (output.parentElement.scrollTop = output.parentElement.scrollHeight); } }

      var __stdinLines = [];
      var __terminalEcho = "";
      var __inputWaiter = null;

      function resetTerminalEcho() { window.__terminalEcho = ""; }

      function appendTerminal(text) {
        window.__terminalEcho = (window.__terminalEcho || "") + text;
        var output = document.getElementById("runner-output");
        if (output) { output.textContent = window.__terminalEcho; output.className = ""; output.parentElement && (output.parentElement.scrollTop = output.parentElement.scrollHeight); }
      }

      var __stdinLines = [];
      var __terminalEcho = "";
      var __inputWaiter = null;

      function prepareStdinQueue(stdin) {
        window.__stdinLines = [];
        if (!stdin) return;
        var normalized = String(stdin).replace(/\r\n/g, "\n");
        window.__stdinLines = normalized.split("\n");
        if (window.__stdinLines.length && window.__stdinLines[window.__stdinLines.length - 1] === "") window.__stdinLines.pop();
      }

      function asyncReadLine(promptText) {
        if (window.__stdinLines.length > 0) {
          var line = window.__stdinLines.shift();
          appendTerminal((promptText || "") + line + "\n");
          return Promise.resolve(line);
        }
        return new Promise(function (resolve) {
          window.__inputWaiter = { resolve: resolve, promptText: promptText || "" };
          if (promptText) appendTerminal(promptText);
          if (typeof window.__showRunnerPrompt === "function") window.__showRunnerPrompt(promptText || ">>>");
        });
      }

      function prepareStdinQueue(stdin) {
        window.__stdinLines = [];
        if (!stdin) return;
        var normalized = String(stdin).replace(/\r\n/g, "\n");
        window.__stdinLines = normalized.split("\n");
        if (window.__stdinLines.length && window.__stdinLines[window.__stdinLines.length - 1] === "") window.__stdinLines.pop();
      }

      async function runCppOrC(source, stdin) {
        await ensureJSCPP();
        setupInteractiveInputUI();
        window.__terminalEcho = "";
        prepareStdinQueue(stdin);

        var result = "";
        var err = "";
        var inputbuffer = stdin ? String(stdin) : "";

        if (!inputbuffer.trim() && /\bcin\b|\bscanf\s*\(/.test(source)) {
          appendTerminal("程序正在等待输入... (在下方终端输入后按 Enter)\n");
          var line = await asyncReadLine("");
          if (line !== null && line !== undefined) inputbuffer = String(line) + "\n";
        }

        var config = {
          stdio: {
            drain: function () { if (inputbuffer && inputbuffer.length > 0) { var all = inputbuffer; inputbuffer = ""; return all; } return ""; },
            write: function (s) { result += s; appendTerminal(s); },
          },
          unsigned_overflow: "ignore",
          maxTimeout: 10000,
          includes: {
            __stl_shim: { load: function (rt) { if (typeof JSCPPCompat !== "undefined") JSCPPCompat.installSTLShimTypes(rt, JSCPPCompat.getPendingSTLRegistrations()); } },
            string: { load: function (rt) { if (typeof JSCPPCompat !== "undefined" && JSCPPCompat.loadStringLib) JSCPPCompat.loadStringLib(rt); } },
          },
        };

        try {
          var api = JSCPP;
          if (api && api.default && typeof api.default.run === "function") api = api.default;
          if (!api || typeof api.run !== "function") throw new Error("JSCPP.run 不可用");
          var exitCode = api.run(source, inputbuffer || "", config);
          if (exitCode !== 0 && exitCode !== undefined && exitCode !== null) err = "程序退出码: " + exitCode;
        } catch (e) {
          err = String(e && e.message ? e.message : e);
          if (err.indexOf("Parsing Failure") >= 0) err = "编译解析错误：请检查 C/C++ 语法或不支持的库。\n" + err;
          else if (err.indexOf("Maximum call stack size exceeded") >= 0) err = "运行错误：递归深度过大，超过浏览器运行限制。";
          appendTerminal(err + "\n");
        }

        if (typeof window.__hideRunnerPrompt === "function") window.__hideRunnerPrompt();
        window.__inputWaiter = null;
        return { stdout: window.__terminalEcho || result, stderr: err };
      }

      return {
        ensureJSCPP: ensureJSCPP,
        runCppOrC: runCppOrC,
        runPython: async function (source, stdin) {
          const pyodide = await ensurePyodide();
          setupInteractiveInputUI();
          resetTerminalEcho();
          prepareStdinQueue(stdin);

          window.__asyncReadLine = function (promptText) { return asyncReadLine(promptText || ""); };

          var prefilled = [];
          if (stdin && String(stdin).length) {
            var normalized = String(stdin).replace(/\r\n/g, "\n");
            prefilled = normalized.split("\n");
            if (prefilled.length && prefilled[prefilled.length - 1] === "") prefilled.pop();
          }
          pyodide.globals.set("__js_stdin_lines", pyodide.toPy(prefilled));

          let stdout = "", stderr = "";
          pyodide.setStdout({ batched: function (text) { stdout += text + "\n"; appendTerminal(text.endsWith("\n") ? text : text + "\n"); } });
          pyodide.setStderr({ batched: function (text) { stderr += text + "\n"; appendTerminal(text.endsWith("\n") ? text : text + "\n"); } });

          await pyodide.runPythonAsync(`
import builtins
from js import window
_stdin_q = list(__js_stdin_lines) if __js_stdin_lines is not None else []
_run_sync = None
try:
    from pyodide.ffi import run_sync as _run_sync
except Exception:
    try:
        from pyodide import run_sync as _run_sync
    except Exception:
        _run_sync = None
def _interactive_input(prompt=""):
    p = str(prompt) if prompt is not None else ""
    if _stdin_q:
        line = _stdin_q.pop(0)
        if p: print(p + line)
        else: print(line)
        return str(line)
    if _run_sync is None:
        raise RuntimeError("需要输入但当前环境不支持交互 input()。Pyodide 版本可能过旧，建议在代码中避免使用 input()。")
    val = _run_sync(window.__asyncReadLine(p))
    if val is None: raise EOFError("EOF when reading a line")
    return str(val)
builtins.input = _interactive_input
`);
          try { await pyodide.runPythonAsync(source); } catch (e) { var msg = String(e && e.message ? e.message : e); stderr += msg + "\n"; appendTerminal(msg + "\n"); }
          if (typeof window.__hideRunnerPrompt === "function") window.__hideRunnerPrompt();
          window.__inputWaiter = null;
return { stdout: window.__terminalEcho || stdout, stderr: stderr };
        },
    // === End Runtime ===
    };
  })(),
  };

  global.JSCPPCompat = api;
  if (typeof global.JSCPP !== "undefined") {
    global.JSCPP.compat = api;
  }
})(typeof window !== "undefined" ? window : this);
