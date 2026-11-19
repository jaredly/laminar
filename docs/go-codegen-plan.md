# Plan: Golang Backend for Laminar

Status: **Proposed**. Sits parallel to the existing C/Wasm backend (`ts/src/c/`). Reuses the verified frontend, semantic inference, generic typed IR, specialization, and representation inference (phases 0–3) to emit standalone, idiomatic Golang.

---

## 1. Executive Summary & Objective

The goal is to implement a **Golang backend** for Laminar that compiles verified `ConcreteProgram` (Concrete IR) into readable, standalone Go source code, executing natively via the standard Go toolchain (`go run` / `go build`).

### Why Go?
- **Complementary Execution Model**: C/Wasm provides raw memory control, sanitizer instrumentation, and WebAssembly linear memory targets. Go provides garbage collection, fast compilation, memory safety, cross-compilation out of the box, and native goroutine/concurrency primitives for future language expansions.
- **High Reuse**: Laminar's compiler pipeline isolates backend concerns behind `ConcreteProgram`. ~80% of compiler complexity (type inference, affine borrow tracking, lens representation inference, monomorphization, closure capture resolution) is target-independent and shared without modification.
- **Natural Feature Alignment**: Go's value-type structs, interior pointers (pointers to struct fields), and first-class functions map cleanly to Laminar's concrete layouts, lenses, and callable ABIs.

### Target Scope & Parity
The Go backend will initially target full parity with the **Phase 4–6 executable subset** currently supported by the C backend:
- Primitives: `Number` (`float64`), `Bool` (`bool`), `Unit` (`struct{}`).
- Aggregates: Tuples, records, and nested values.
- Storage & Lenses: Moves, swaps (`:=`), thin pointer lenses, and recursively scattered lenses.
- Control Flow: Pattern matching, first-match branching, storage version joins, and runtime traps.
- Callables: Direct calls, recursion, closure environments, dynamic dispatch, and callable joins.
- Restorations: Returned lenses with residual contexts, deferred restoration routines, and scoped manual cleanup (`aslens` / `manual`).

---

## 2. Architecture & Pipeline Positioning

The Go backend integrates cleanly alongside the existing C backend:

```text
Source Code
    ↓
Lexer & Parser (laminar-parser.ts)
    ↓
Semantic Inference & Elaboration (elaborated.ts, infer.ts)
    ↓
Generic Typed IR (typed-ir.ts, lower-typed.ts)
    ↓
Reachable Specialization (specialize.ts)
    ↓
Representation Inference (infer-representations.ts)
    ↓
Concrete IR (concrete-ir.ts, lower-concrete.ts)
    ├──> C Backend  (ts/src/c/lower.ts  → emitC  → clang / emcc)
    └──> Go Backend (ts/src/go/lower.ts → emitGo → gofmt → go run / go build)
```

The Go backend begins at `ConcreteProgram`. It does not perform semantic analysis, monomorphization, or representation analysis.

---

## 3. Language Mapping: Concrete IR to Go

| Laminar Concrete IR | C Backend Representation | Go Backend Representation | Rationale |
| :--- | :--- | :--- | :--- |
| **`f64`** | `double` | `float64` | Native 64-bit IEEE-754 float |
| **`bool`** | `_Bool` | `bool` | Native boolean |
| **`unit`** | `struct { unsigned char inhabitant; }` | `struct{}` or `struct{ Inhabitant byte }` | Zero-allocation or explicit inhabitant |
| **`record`** | `struct L0 { double item0; ... }` | `type L0 struct { Item0 float64; ... }` | Value-type struct copied on assignment |
| **`pointer`** | `T *` | `*T` | Native pointer, supporting interior fields |
| **`ConcreteABI`** | `TResult (*)(void *env, ...)` | `func(env any, arg0 T0, ...) TResult` | Typed function signature with opaque environment |
| **`CallableLayout`** | `struct { void *env; dispose_fn dispose; ... }` | `type L_Callable struct { Environment any; Dispose func(any); ... }` | Matches explicit callable layout in Concrete IR |
| **Thin Lens** | `struct { TRead *read; TWrite *replacement; }` | `struct { Read *TRead; Replacement *TReplacement }` | Interior field pointers `&obj.Item0` |
| **Residual Context** | `malloc(sizeof *ctx)` | `new(RestoreContext)` | Automatically heap-promoted and GC-managed |
| **Unused Locals** | `(void)name;` | `_ = name` | Avoids Go's "unused variable" compiler error |
| **Runtime Traps** | `abort()` | `panic("laminar: runtime trap")` | Idiomatic Go failure mode |

### Detailed Semantics

#### 1. Interior Pointers & Lenses
Laminar lenses rely on pointing directly to fields of structs (thin lenses) or tuples of pointers (scattered lenses). 
- In Go, taking `&s.Item0` is valid, safe, and fully supported by Go's compiler and garbage collector.
- Because the IR sequences operations through explicit temporaries (`declare`), all targets are bound to named variables prior to taking references, meeting Go's addressability rules.

#### 2. Closures & Environment Unpacking
In C, the environment pointer is `void *` and implicitly cast. In Go, the environment is typed as `any`.
Because `ConcreteProgram` statically records the concrete environment layout for every code block and wrapper (`c.environment`, `w.environment`), the Go emitter deterministically unpacks the environment via a concrete type assertion:
```go
func fn0(environment any, arg0 float64) float64 {
    captured := environment.(*Env0)
    // use captured.Capture0, etc.
}
```

#### 3. Memory Reclamation vs. Semantic Restoration
- **Memory Disposal**: In C, every closure and context must be explicitly freed (`free(ctx)`, `disposer(env)`). In Go, memory is managed by the runtime garbage collector, eliminating use-after-free and dangling pointer risks.
- **Semantic Restoration**: Laminar lenses have **restoration obligations** (writing modified focuses back to owner aggregates and running cleanup callbacks). In Go, restoration callbacks (`restore(ctx, replacement)`) and cleanup routines must still be executed in the exact deterministic order required by Laminar's affine semantics.

---

## 4. Syntax & Tooling Strategy: The `gofmt` Pipeline

Rather than depending on a heavy or non-existent TypeScript-based Go AST parser, the Go backend will follow the proven strategy used by `ts/src/c/syntax.ts` paired with official Go tooling:

1. **Lightweight Statement Tree (`ts/src/go/syntax.ts`)**:
   A ~30-line AST representing blocks, headers, and statements:
   ```typescript
   export type Statement = string | { head: string; body: Statement[] };
   export type GoFile = {
       packageName: string;
       imports: string[];
       declarations: string[];
       functions: { signature: string; body: Statement[] }[];
   };
   ```
2. **Deterministic Emission (`ts/src/go/emit.ts`)**:
   Serializes the tree into raw Go source text.
3. **Canonical Formatting via `gofmt`**:
   The emitted source is piped through `gofmt` (or `@wasm-fmt/gofmt`) before writing to disk or compiling. This:
   - Enforces idiomatic Go formatting (tabs, spacing, brace placement).
   - Catches unclosed braces or syntax malformations immediately before the compiler runs.

---

## 5. Phased Implementation Roadmap

### Phase 0: Target Configuration & Test Harness
**Goal:** Establish Go as a recognized backend target and setup compilation/execution infrastructure.

**Tasks:**
1. Extend `TargetConfig` in `ts/src/backend/target.ts`:
   - Add `abi: 'go'`.
   - Add `toolchain: { compiler: 'go'; version: string }`.
   - Add `goTargetConfig(version: string)` helper function.
2. Implement `ts/src/go/syntax.ts`:
   - Tree representation for Go files, imports, declarations, and nested statement blocks.
   - Standard statement printer.
3. Implement `ts/src/go/build.ts`:
   - Temporary directory workspace creation.
   - Formatting via `gofmt`.
   - Invocation of `go run` / `go build` via asynchronous subprocesses.
   - Parsing JSON output protocol from standard out.
4. Setup `ts/test/go/execute.test.ts` skeleton.

**Exit Gate:** A trivial hardcoded Go file compiles, runs, and reports JSON test results through `buildAndRunGo`.

---

### Phase 1: Scalars, Records, and Direct Calls
**Goal:** Execute simple expressions, direct functions, and arithmetic operations.

**Tasks:**
1. Implement `ts/src/go/lower.ts` base layouts:
   - Map `f64` → `float64`, `bool` → `bool`, `unit` → `struct{}`.
   - Generate struct definitions for records and tuples.
2. Port arithmetic intrinsics:
   - Operators `+`, `-`, `*`, `/`, `==`, `>=`, `<=`.
   - Division by zero and special float values (`NaN`, `+Infinity`, `-Infinity`, `-0`).
3. Port structured test output printer:
   - `printNumber(x float64)` matching Laminar's JSON protocol.
   - Recursive tuple printing `[1, 2, 3]`.
4. Direct function calls and self-recursion.

**Exit Gate:** Passes all scalar, arithmetic, tuple, and direct-call tests in `backendCorpus`.

---

### Phase 2: Lenses, Swaps, and Place Aliases
**Goal:** Support mutable lens views, interior pointers, and affine updates.

**Tasks:**
1. Adapt `ts/src/c/storage.ts` for Go:
   - Retain cell/path identities and projections across version updates.
2. Implement pointer layouts and lens generation:
   - Thin lenses (`Read *TRead`, `Replacement *TReplacement`).
   - Scattered lenses (tuples of component lens structs).
3. Lower `swap` (`:=`) and `move` operations:
   - Dereferencing `*lens.Read` and assigning `*lens.Replacement`.
4. Implement lexical aliases and direct subloans.

**Exit Gate:** Passes all lens and swap samples (`lexical-alias`, `swap-order`, thin and scattered lens tests).

---

### Phase 3: Control Flow, Branches, and Version Joins
**Goal:** Support pattern matching, conditional arms, and storage version reconciliation.

**Tasks:**
1. Lower `case` instructions:
   - Pattern match testing (`matches(pattern, value)`).
   - Sequential `if / else if / else` evaluation.
   - Unmatched case aborts (`panic("unmatched case")`).
2. Phi assignment and storage joins:
   - Declaring phi variables in the outer block before entering branch arms.
   - Assigning version updates in each arm.
   - Merging storage cell states after branch completion.
3. Cleanup joins and branch normalization.

**Exit Gate:** Passes all branch tests (`lensBranchSamples`, `storageJoinSamples`, `aggregateJoinSamples`).

---

### Phase 4: Closures, Callables, and Restorations
**Goal:** First-class functions, dynamic dispatch, and lens-returning functions with deferred restoration.

**Tasks:**
1. Callable layouts and wrappers:
   - Struct definitions containing environment pointers and entry function types.
   - `make-callable` environment construction and capture loading.
   - `invoke` lowering with explicit type assertion unpacks (`environment.(*EnvN)`).
   - Result adapters and dynamic dispatchers.
2. Lens-returning functions & residual contexts:
   - Allocate residual context struct (`new(Context)`).
   - Generate exact typed restoration functions (`func(ctx any, repl T) Unit`).
   - Package returned lens structs with restoration pointers and context references.
3. Scoped manual cleanup:
   - Staging replacement contents before cleanup execution.
   - Executing late cleanup expressions and deferred restoration.

**Exit Gate:** Passes all closure, callable join, callable focus, and manual restoration samples (`callableFocusSamples`, `manualRestorationSamples`, `deferredStorageSamples`).

---

### Phase 5: Complete Test Parity & CI Integration
**Goal:** Validate 100% parity against the C backend across the entire accepted test suite.

**Tasks:**
1. Run `ts/test/go/execute.test.ts` concurrently across all 200+ acceptance corpus samples.
2. Compare results directly against `executeTypedProgram` and C backend output.
3. Document any Go-specific edge cases, performance benchmarks, and compilation profiles in `ts/docs/go-backend.md`.

**Exit Gate:** Zero failures across all applicable test suites.

---

## 6. Directory Structure & Key Files

```text
ts/
├── docs/
│   ├── go-codegen-plan.md        # This plan
│   └── go-backend.md             # Architecture, ABI, and reference docs
├── src/
│   ├── backend/
│   │   └── target.ts             # TargetConfig with Go support
│   └── go/
│       ├── syntax.ts             # Go statement AST and printer
│       ├── emit.ts               # Entry point (emitGo)
│       ├── lower.ts              # ConcreteProgram -> Go lowering pass
│       ├── storage.ts            # Versioned storage and cell tracking
│       └── build.ts              # Subprocess gofmt and go run runner
└── test/
    └── go/
        └── execute.test.ts       # Full acceptance suite executed via Go
```

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **Go compiler unused variable / import errors** | Build failures | Systematically emit `_ = varName` for parameters and local bindings; only import used packages (`fmt`, `math`, `os`). |
| **Addressability of expressions** | Inability to take `&expr` | The lowering pass always binds non-trivial expressions to named local variables via `declare()` before taking addresses. |
| **Type assertion overhead on `environment any`** | Slight runtime overhead | Interface type assertion in Go (`env.(*ConcreteType)`) is a single pointer comparison (fast type check); well within acceptable performance. |
| **Subprocess execution performance in tests** | Slow test suite runs | Bun test runner concurrency with build slots (identical to `execute.test.ts`), plus caching binary outputs where applicable. `go run` is generally faster to compile small units than `clang -O2`. |
