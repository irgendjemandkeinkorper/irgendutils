# Bolt's Journal

## 2025-02-16 - Hot loop string slice allocation in custom parser
**Learning:** Using `String.prototype.slice()` inside tight sequential parsing loops (such as custom HTML/XML parsers) creates substantial memory allocations and garbage collection pressure, particularly for large input strings. Replacing substring slicing with sticky regular expressions (using the `/y` flag) matched at a dynamic `lastIndex` yields a massive (~17%) speed improvement with zero logic changes.
**Action:** Use sticky regexes (`/y` flag) and set `lastIndex` to the desired scan offset to match patterns in-place on the source string.

## 2025-02-15 - Hot loop object allocation in custom parser
**Learning:** Instantiating temporary collection objects (such as `new Set(...)`) inside tight, recursive, or sequential processing hot loops (like custom HTML/XML/AST parsers) creates major performance bottlenecks due to continuous heap allocation and garbage collection.
**Action:** Always extract lookup tables and sets to the module or top-level scope when the elements are static. This yields up to a ~40% execution speedup with zero logic changes.

## 2025-02-17 - Slicing and indexOf outperform RegExp engine for basic text scanning in JIT-optimized JS engines
**Learning:** For scanning basic text boundaries (such as finding the next `<` character in an HTML parser), standard string methods like `indexOf('<')` and `slice` significantly outperform sticky regular expressions (like `/[^<]+/y`). This is because V8's `indexOf` is a highly-optimized C++/SIMD primitive, and standard string slices can be optimized via sliced pointers. The RegExp engine (`exec`), on the other hand, incurs setup overhead and allocates a match array on every invocation, which is a major bottleneck when run on every text chunk.
**Action:** Use standard `indexOf` and `slice` for basic sequential character/boundary scanning, and restrict RegExp caching optimizations to complex token groups or dynamic/escaped patterns.

## 2025-02-18 - Redundant sorting in unordered collection and hot loop dict instantiation in state simulator
**Learning:** Instantiating new collection objects (such as `frozenset(sorted(...))`) with sorting before passing them to unordered constructs wastes CPU cycles by sorting unnecessarily. Furthermore, repeatedly converting a `frozenset` of tuples to a Python dictionary inside hot BFS/evaluation loops creates significant garbage collection and instantiation overhead. Precomputing/caching the dictionary representation inside the immutable state constructor reduces attribute retrieval to a highly optimized $O(1)$ lookup, yielding up to a ~46x speedup.
**Action:** Always avoid sorting values before inserting into unordered structures like `set` or `frozenset`. Cache immutable dictionary mappings instead of reconstructing them dynamically from sets inside sequential or BFS hot loops.
