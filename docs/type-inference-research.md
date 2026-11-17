# Research: HM-style inference before IR decomposition

Research date: 2026-11-16. Scope: the language and pointer evaluator in `ts/`, with inference on the source AST before `decompose.ts`. This is a design recommendation, not an implementation or a claim of soundness for the extended language.

## Update after language feedback (2026-11-17)

The implementation now follows the clarified affine resource model, superseding the local-polymorphism and alias-access recommendations below. Only top-level definitions are reusable schemes; first-class functions and other local values may be consumed at most once, with unused values allowed. Persistent aliases exclusively borrow their owners until scope exit. Closures move free values at definition time and cannot borrow outer storage. Capturing an alias value is valid if that alias is replenished before its lifetime ends. Type and availability states are joined across branches.

The original examples that access `x` while `y` or `(a, b)` still borrow it are invalid use-while-borrowed programs. End the alias scope before accessing the owner. Likewise, consuming a value on the RHS of assignment empties the target before the swap, so `inc` and `map` can correctly return unit; the earlier annotation-mismatch discussion missed this resource transition.

### Follow-up decision: scoped manual cleanup

The user clarified that a manual cleanup function may borrow surrounding storage
until restoration completes. This is a scoped restoration computation, not an
exception for ordinary escaping closures. Evaluate the cleanup expression at
restoration, invoke it with zero arguments, dispose its owned result, and only
then finish the frontend lens. Retain cleanup dependencies and owned focus storage
through this boundary. The checker and serialized typed/legacy reference paths now
implement that contract; physical manual-restoration adapters remain backend work.

## Recommendation

Add an AST inference/elaboration pass using first-order unification, fresh instantiation, and restricted rank-1 let-polymorphism. Preserve Laminar's distinction between ordinary values and lenses in the inferred function signatures. Thread a typing context through inference so lens updates can change the types of subsequent uses. A single immutable mapping from names to HM types cannot express the existing language.

Keep source inference independent of IR storage machinery: stack identifiers, references, cleanup closures, and heap allocation belong to decomposition. Return a checked AST handle plus inferred node types, binding identities, schemes, and diagnostics. Only successful inference should reach decomposition on the checked execution path.

Start with a conservative polymorphism policy: generalize non-addressable definitions whose evaluation does not capture mutable local state; keep mutable storage and lens aliases monomorphic. Broaden this after the flow/alias rules have been validated. Ordinary ML's value restriction alone does not cover Laminar, because even a function-valued local binding can be assigned through a lens.

## What the repository currently does

Paths below are relative to `ts/` unless prefixed with `../`.

| Area | Evidence and consequence |
| --- | --- |
| Source AST | `src/ast.ts:3–84` defines `Pat`, `Type`, `FileItem`, `Linear`, `Lens`, and `Term`. `Term` explicitly marks a lens with `{type: 'lens', lens}`. There is no inferred type representation or scheme. |
| Annotations | `src/laminar.cst` has declarations `name :: Type`, argument annotations, and function return annotations. `Type` supports names, tuples, functions, `~A`, and `A/B`, but no type application or explicit quantifiers. These are syntax objects, not solver types. |
| Desugaring | The grammar already turns lists into `nil`/`cons`, operators into applications, and blocks into nested lets. Inference can operate on that AST without reconstructing surface syntax. |
| Lowering | `src/decompose.ts:171` (`linearToExpr`) and `:419` (`lensToRvalue`) resolve names and generate references, swaps, cleanup blocks, and closures. Function annotations do not constrain lowering. Lens arguments must be last. Lens-valued function bodies lower to a pointer/cleanup pair. |
| Driver | `test/fixtures.ts:101–144` parses and classifies declarations and snapshot examples. At `:280–345`, it lowers/evaluates definitions and both sides of examples. Declarations are printed but do not check implementations; the harness associates the pending declaration with the next named function without verifying the name. There is no central checked compiler entry point yet. |
| Runtime | `src/eval.ts` evaluates IR with mutable pointers and dynamic checks. Assignment is a swap that returns the old value; unit is represented by `null`. Function calls evaluate their callee and then arguments, but decomposition can hoist work for a final lens argument. |
| Active fixtures | `test/pointers.test.ts:8` runs `src/systematic.test.lm` and `test/flow.test.lm`. These are more authoritative about current behavior than the README's older status/run instructions. |

Several existing annotations specify genuinely type-changing lenses. For example, `test/flow.test.lm:25` gives `fst` the type `((a, b)/(a', b)) => a/a'`; at `:279`, `take :: (a/()) => a` replaces a value with unit and returns its old contents. Modeling every lens as a homogeneous mutable reference would reject intended examples.

Some existing signatures also conflict with runtime results: `inc :: (~Int) => ()` has a bare assignment body, which returns the old number, and `map` similarly declares unit while returning the replaced value. Strict annotation checking should report these mismatches. Recommend correcting fixture signatures (or explicitly writing a final unit expression where that is intended), rather than silently coercing assignment results to unit; `take` relies on the swap result.

The active fixtures also allow discarded values and include operations whose linearity is enforced dynamically. Introducing type inference will make previously unchecked programs fail earlier; it should not silently claim to have implemented the entire paper's linear resource discipline.

## Useful prior art already checked in

`../flow-typing-supplementary/flow-typing-compiler/src/infer.rs` is particularly useful:

- `infer_expr` distinguishes local variables from instantiations of declared definitions. Ordinary variable use takes the current type out of the context; declared uses instantiate their named type variables freshly.
- `infer_lens` (around line 536) receives separate expected read and replacement types. A variable lens replaces the context entry with its replacement type and unifies its read type with the old entry.
- `tunify_core` (around line 1651) distinguishes `Plain(T)` from `Flow(A, B)`. Mode mismatch is a type error; flow endpoints unify independently.
- `unify_core` has structural unification and an occurs check. Rigid named variables and flexible metavariables are separate representations.
- Local `Let` inference (around line 272) elaborates and extends a pattern, then retracts it after the body; it does not perform HM scheme generalization there. Top-level inference uses declarations and reports unresolved metavariables during completion.

Reuse these semantic distinctions, not the implementation wholesale. That compiler has curried arrows, a different AST, and explicitly unsupported lens forms; the TypeScript language has n-ary calls, lens lets, cases, manual cleanup, and `aslens`. Local let-polymorphism is additional design work.

The [flow-typing paper](https://people.cs.nott.ac.uk/pszgmh/flow-typing.pdf), especially sections 4–6, motivates a context that changes during evaluation and distinct read/replacement types. Its translation gives the conceptual basis for checking source expressions before lowering. It does not establish correctness of this proposed HM extension.

For the polymorphic core, [Damas and Milner](https://www.cs.tufts.edu/comp/150FP/archive/robin-milner/damas-milner-original.pdf) provide the standard unification, instantiation, generalization, and principal-scheme basis for the applicative fragment. Mutation needs additional restrictions: the [SML/NJ account of the value restriction](https://www.smlnj.org/doc/Conversion/types.html) explains the corresponding ML limitation. Neither result automatically proves principality or soundness for Laminar's aliases and type-changing updates.

## Proposed internal representation

Keep `ast.Type` as parsed syntax and introduce solver-owned types, approximately:

```ts
type Ty =
  | { tag: 'meta'; id: number }
  | { tag: 'rigid'; id: number }
  | { tag: 'con'; name: string; args: Ty[] }
  | { tag: 'tuple'; items: Ty[] }
  | { tag: 'fn'; args: FlowTy[]; result: FlowTy };
type FlowTy =
  | { tag: 'plain'; value: Ty }
  | { tag: 'flow'; read: Ty; write: Ty };
type Scheme = { quantified: number[]; body: Ty };
```

Use `Number`, `Bool`, and `String` as initial primitives, unit as the empty tuple, and internal `List(a)` and registered nominal constructors. Existing `Int` annotations require an explicit compatibility decision: recommend accepting `Int` as an alias for `Number` initially, since decimal literals and JavaScript division are already supported. This does not promise integer arithmetic. Keep one-element tuple treatment consistent with parsing/evaluation, which currently normalize some singleton forms differently.

Function arity is structural: `(a, b) => c` has two arguments, while `((a, b)) => c` conceptually has one tuple argument. Do not import the Rust compiler's curried application rules. Plain/flow modes are fixed by syntax and constraints; no mode polymorphism, higher-rank arguments, subtyping, or numeric overloading initially.

Separate lexical resolution from storage typing. A binding ID identifies a declaration under shadowing; a storage identity identifies the value or component a lens aliases. Scope maps names to binding IDs, with schemes for reusable definitions and monotypes/current states for storage. Do not use `Loc` as a unique node or binding ID: AST wrappers can share locations and some type nodes lack their own location. Use AST object identity or explicit IDs and retain locations for diagnostics.

The unifier needs pruning/substitution, structural constructor and arity checks, an occurs check, and a no-op when unifying a metavariable with itself. Generalization quantifies `freeVars(type) - freeVars(environment)` only after applying current substitutions and the eligibility restrictions below. Instantiate only quantified variables, freshly at every eligible value use. Unsolved variables can appear in generalized schemes; they should not all become “could not deduce type” errors.

## AST rules and context flow

Use separate `inferLinear`, `inferLens`, `inferTerm`, and `checkPattern` functions sharing a solver. Each inference result includes the updated context; lens inference includes read and write types. Binding schemes and current storage types must remain distinct throughout.

| AST form | Constraint or obligation |
| --- | --- |
| Literal | Fixed primitive type; empty tuple is unit. Initially allow any type in interpolation to match the evaluator's string conversion, without implying resource-safe printing. |
| Identifier/operator | Resolve lexically. Instantiate a reusable scheme; otherwise read the current monotype. Operators use registered builtin signatures. Track consumed/unavailable storage if resource checking is enabled. |
| Tuple/constructor | Infer components in runtime order. Constructors instantiate one registered signature per occurrence, then check argument count/types. `nil : List(a)` and `cons : (a, List(a)) => List(a)` make lists homogeneous. |
| Function | Fresh monotypes for parameters; infer in a child scope. Check parameter annotations and constrain the result by `ann`. A lens parameter has independent entry and exit types, linked to its body state at return. A lens body gives a flow result, rather than a plain tuple encoding its cleanup. |
| Application | Unify callee with an n-ary function whose argument modes match the terms and whose result mode matches value/lens position. Reject plain/lens mismatches and a non-final lens argument before lowering. Higher-order calls use the same representation. |
| Let | Infer RHS before introducing its pattern; destructure against its type. Parameters, pattern variables in cases, and recursive placeholders are monomorphic. Generalize only eligible let-bound values. Lens RHS binds aliases, not independently instantiated values. |
| Pattern | Literal constrains the expected type; wildcard binds nothing; tuples check arity; constructors use the same registry as expressions. Diagnose repeated names in a pattern. Validate where lens patterns are legal instead of permitting them recursively and relying on lowering to throw. |
| Assignment | If the target lens has read type `A` and replacement type `B`, check RHS as `B`, return `A`, and expose the target's post-update type to later expressions. Never equate `A` and `B` merely because both belong to one variable. |
| Case | Check the scrutinee and infer each branch from an independent copy of its post-scrutinee context. Unify result types **and** surviving outer binding states at the join. Branch-local names must not leak. Lens cases join both endpoints and restoration obligations. Exhaustiveness is a separate check. |

Example: `{ let x = 1; x := true; x }` should infer `Bool`; the assignment itself has type `Number`. An old numeric type metavariable must not be globally unified with `Bool`: that would conflate the storage's successive states. Preserve distinct states and the relationship imposed by the update.

Aliases make this harder: `{ let x = 1; let y = ~x; y := true; x }` must observe `Bool` through `x`, or be rejected under a stated temporary restriction. Giving `y` a copied environment entry is incorrect. Tuple aliases must update corresponding component state; overlapping lenses need either exclusive access checks or explicit alias tracking. A conservative first version can reject overlapping active aliases rather than infer inconsistent views.

For complex lens forms:

- `Lens.let` must keep aliases/restoration obligations alive through its body and discharge them at the scope boundary.
- `manual` checks a lens frontend and a nullary plain backend (its result is discarded by current lowering), while propagating the backend's context effects at cleanup time. Ordinary function result unification cannot model those delayed effects by itself.
- `aslens` allocates a temporary focus from a linear value and runs a backend using the final focus. Its local pattern must be checked against that final state; the produced lens cannot let storage escape after cleanup.
- Lens-returning functions need restoration information that relates result replacement to input exit types, as the annotated `fst` example demonstrates.

These forms require scoped obligations, not just a `FlowTy` pair. For an incremental release, reject any form whose context/restoration behavior is not yet modeled with an explicit inference diagnostic. Keep the unchecked evaluator available for research fixtures. Do not label unsupported forms as successfully typed through a catch-all `any`.

### Evaluation order is part of the contract

Audit order against decomposition before fixing the inference traversal. For example, `linearToExpr` extracts a final lens argument into a surrounding block, and assignment obtains a lens before evaluating the RHS swap. Inference must model the actual order, including cleanup order, or lowering must be changed deliberately to implement an agreed source order. The Rust reference's traversal order is not automatically correct for this implementation. Add focused examples where lens setup, callee evaluation, and arguments all update the same outer state.

## Polymorphism, recursion, and annotations

Unrestricted HM generalization is unsafe here. If a local identity function is generalized, then a lens can overwrite its cell with a numeric-only function while another use still instantiates the old scheme at `Bool`. Restricting RHS expressions to syntactic values does not prevent that overwrite.

Recommended initial policy:

1. Generalize top-level definitions that cannot be lens targets and do not capture mutable local state. Reject borrowing/assigning these reusable definition names.
2. Generalize local closed function values only when a lexical binding-use analysis proves the binding is never used as a lens target, directly or through a lens expression. Resolve shadowing before that analysis. Ordinary references to mutable cells remain monomorphic, even when their initializer is a function or identifier.
3. Do not generalize aliases, allocation results, expansive applications, or closures capturing mutable state. Keep captured free metavariables in the environment during generalization. If the proof of eligibility is uncertain, choose monomorphism.
4. Shared polymorphic definitions require a resource policy too. Keep this phase explicitly limited to type compatibility and flow state; retain dynamic resource checks. A later static linearity pass must distinguish reusable closed functions from closures that own consumable captures.

Named top-level recursion already has driver support through the global name scope. Infer a monomorphic self-placeholder within a definition, solve it, then generalize for later definitions. Initially retain source-order visibility; mutual recursion requires explicit grouping or dependency/SCC analysis and should be a separate extension. A local named function inside the parser's wildcard let is specially rebound by `letToExpr`; inference must mirror that naming rule without accidentally granting local recursion that lowering does not support.

Elaborate annotation names with a table of primitive names and scoped type variables. Interpret `~A` as `A/A`; share occurrences of `a` within a signature and distinguish `a'`. Treat a full declared polymorphic signature as a contract: infer/generalize the implementation, then check that it supports the declared scheme using rigid/skolem variables. Simply freshening the signature and unifying would accept an implementation of `(a) => a` that only works on numbers. Partial parameter/result annotations need an explicit common variable scope within the function. Diagnose mismatched declaration/definition names and orphan declarations.

Internal parameterized types can precede surface syntax for them. Add a type-application form to `Type` and `laminar.cst` when annotations such as `List a` are introduced; the current grammar does not support that notation. Regenerate `laminar-parser.ts` from the grammar rather than hand-editing generated rules.

## Builtins, integration, and diagnostics

Create a builtin/constructor signature registry independent of JavaScript `any` declarations in `test/fixtures.ts`. Audit runtime arity and conventions individually: arithmetic can use concrete numeric signatures, `fst` has a flow argument/result, and `dup` consumes a lens view while returning a value. Do not infer source signatures from JavaScript function arity: evaluator callbacks receive a hidden context argument, and several existing fixture builtins use inconsistent conventions. `heap` is principally an implementation primitive, not automatically a source-level polymorphic reference API. Unknown constructors should be diagnosed rather than assigned arbitrary signatures per use.

Proposed modules:

- `src/types.ts`: solver types, schemes, substitutions, instantiation/generalization, pretty-printing.
- `src/infer.ts`: lexical IDs, pattern checking, AST rules, context states and restoration obligations.
- `src/builtins.ts`: checked source signatures paired with runtime registrations where practical.
- `src/check.ts`: checked entry point taking a file/definition plus an environment; it calls inference before decomposition and does not lower on errors.

The result should retain the original AST and expose finalized types in a side table, plus schemes and resolved bindings. A branded checked handle can prevent accidental unchecked lowering at the driver boundary; the existing low-level lowering functions can remain useful to IR tests. Do not attach a single generalized scheme to every occurrence: occurrence types are instantiated monotypes.

Integrate initially in the snapshot driver behind an explicit checked mode. Definitions extend the persistent type environment only after successful checking. Check each test body and expected expression independently against that environment, then compare their inferred result types as well as runtime results. Keep evaluator-only error tests distinct from inference-error tests. IR snapshot text should remain unchanged for accepted programs unless a separately justified evaluation-order fix is necessary.

Diagnostics should include a stable error code, source location, expected/actual types, and the origin of the conflicting constraint. Useful categories include unbound name, unknown constructor, arity mismatch, plain/flow mismatch, infinite type, annotation mismatch, incompatible branch state, alias conflict, and unsupported restoration behavior. Reuse `locLines` for presentation; show both the original binding/update and failing use where possible. Normalize type-variable names for stable snapshots.

## Verification and delivery sequence

This research changed documentation only; no implementation or runtime test run is claimed.

1. Implement/test the solver and monomorphic ordinary AST fragment: occurs checks, substitution composition, arity, tuples, constructors, patterns, and annotation contracts.
2. Add context transitions and lens endpoints: swap returns the old type, type-changing updates, aliases, tuple focuses, higher-order flow signatures, branch-state joins, and actual evaluation order. Use `take`, `map`, `fst`, and `fcomp` as source examples.
3. Add restricted schemes: independent numeric/boolean instantiations of a reusable identity, no generalization of lambda parameters or mutable captures, rejection of polymorphic-cell misuse, monomorphic recursion, and correct shadowing.
4. Model complex lens cleanup and escapes, integrate checked snapshots, and classify currently accepted programs that become errors. Include negative tests proving rejected ASTs never reach decomposition or evaluation.

Minimum regression cases include heterogeneous lists, calling a lens-taking function with a value, using a lens-returning call in value position, inconsistent branch results and outer states, duplicate pattern names, false generic annotations, alias updates followed by owner reads, and overlapping tuple lenses. Preserve existing accepted IR/results and dynamic resource checks. Test generalized scheme equality modulo variable renaming rather than depending on solver IDs.

The phases share one typing/context contract; they should not be developed as independent inference implementations. Complex restoration rules and builtin auditing are the largest unresolved engineering costs, rather than unification itself.

## Design decisions

### Decisions made or recommended

- **Fixed placement:** infer on the parsed AST before IR decomposition, as requested. Types describe source values and flow modes.
- **HM-style core:** rank-1 schemes and first-order unification, with distinct rigid annotation variables. Principal typing is an objective for the restricted core, not a proven property of the full extension.
- **Type-changing flow:** preserve separate read/replacement endpoints and thread current storage types. Homogeneous-reference inference would lose existing language behavior.
- **Conservative generalization:** reusable non-addressable definitions first; mutable cells and lens aliases stay monomorphic. Treat eligibility analysis as part of implementation, not an optional optimization.
- **Explicit staging:** type compatibility and flow-state inference first, with existing dynamic resource checks retained. Full static linearity, unrestricted aliases, mode polymorphism, and mutual recursion are follow-up work.
- **Compatibility defaults:** concrete JavaScript-style numbers with an initial `Int` alias; explicit registries for constructors/builtins; declaration contracts checked rather than trusted; unsupported complex lens rules diagnosed until implemented.

### Choices to confirm before implementation

1. **First-release coverage:** implement all current lens restoration forms immediately, or ship the ordinary fragment and basic lenses with explicit unsupported-form errors? Recommendation: stage coverage while keeping the existing unchecked research runner available.
2. **Resource checking scope:** should this work also reject duplicated/unused linear resources statically? Recommendation: keep that a separately specified extension, but make context states and restoration obligations capable of supporting it.

Neither choice changes the requested AST-before-IR architecture.
