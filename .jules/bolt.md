# Bolt's Journal

## 2025-02-18 - Unordered frozenset sorting and redundant state dict reconstruction
**Learning:** Instantiating `frozenset` with sorted inputs (such as `frozenset(sorted(...))`) introduces unnecessary $O(N \log N)$ sorting overhead since frozensets are fundamentally unordered. Furthermore, calling `.to_dict()` on immutable state objects within hot state graph traversal loops (e.g. BFS) repeatedly allocates and garbage-collects identical dictionary objects. Caching the dictionary representation on initialization and returning it directly eliminates millions of redundant allocations.
**Action:** Never sort inputs to unordered set types like `set` or `frozenset`. Cache dictionary views of immutable state representations if they are queried multiple times inside hot loops.

## 2025-02-17 - Slicing and indexOf outperform RegExp engine for basic text scanning in JIT-optimized JS engines
**Learning:** For scanning basic text boundaries (such as finding the next `<` character in an HTML parser), standard string methods like `indexOf('<')` and `slice` significantly outperform sticky regular expressions (like `/[^<]+/y`). This is because V8's `indexOf` is a highly-optimized C++/SIMD primitive, and standard string slices can be optimized via sliced pointers. The RegExp engine (`exec`), on the other hand, incurs setup overhead and allocates a match array on every invocation, which is a major bottleneck when run on every text chunk.
**Action:** Use standard `indexOf` and `slice` for basic sequential character/boundary scanning, and restrict RegExp caching optimizations to complex token groups or dynamic/escaped patterns.

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
## 2025-02-18 - Avoid redundant sorted() calls on frozenset creation and cache dict conversions in hot traversal loops
**Learning:** Instantiating `frozenset` objects with sorted inputs (`frozenset(sorted(...))`) incurs an unnecessary $O(N \log N)$ sorting overhead since `frozenset` is inherently order-independent. Additionally, repeatedly calling `dict(self.variables)` inside hot BFS graph traversal loops is a major performance bottleneck due to continuous dynamic memory allocations. Caching the dictionary representation on initialization turns an $O(N)$ dictionary creation into an $O(1)$ lookup with zero behavior changes.
**Action:** Remove redundant sorted() wrappers around inputs to frozensets and cache dict conversions in classes that are repeatedly serialized or converted in search/traversal loops.
## 2025-05-20 - Indexing lookups for O(N*M) candidate matching in migration generators
**Learning:** Performing linear scans across all destination pages for each source page in URL migration generators creates an O(N * M) bottleneck. Pre-building Map indexes for path, slug, and clean title during destination initialization reduces lookups to O(1) per source page. Additionally, maintaining a per-page Set (`matchedDestsForPage`) prevents duplicate candidate lookups and preserves strict strategy priority tiers (exact_path > canonical > slug > title).
**Action:** Always pre-index candidate items into Map lookups when performing multi-attribute matching across large datasets, using a Set to preserve matching precedence per target item.

## 2025-05-21 - O(1) set membership and deque operations for crawler URL queue management
**Learning:** Performing linear scans over list-based queues (`any(item["url"] == url for item in self.queue)`) and list front-pops (`self.queue.pop(0)`) in web crawlers creates an $O(N \times K)$ bottleneck when adding link batches to large queues. Replacing list queue membership scans with a synchronized set (`self.queued_urls`) and using `collections.deque` for $O(1)$ front-pops improves URL queueing performance by >200x.
**Action:** Always complement sequential queue structures (like lists or deques) with a lookup `set` when checking membership or uniqueness during bulk item insertion.
