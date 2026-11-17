# Generic typed IR

Phase 2 introduces a typed execution path independent of the existing pointer evaluator. It is still generic: semantic type variables are retained, and no physical pointer size, target layout, closure ABI, C source, or Wasm module is selected here.

## API

```ts
import { checkTypedFile } from '../src/check.ts';
import { executeTypedProgram } from '../src/eval-typed.ts';

// file is an ast.File produced by the existing parser.
const { program, definitions } = checkTypedFile(file);
const result = executeTypedProgram(program);
```

`checkTypedFile(file, environment?, constructors?, unitId?)` performs source inference once, lowers the retained elaborations, verifies the entire generic IR program, and returns frozen IR. It does not invoke legacy decomposition. Constructors and native signatures supplied to checking also become explicit generic import schemas in the program.

For callers already managing a `Checker`, `checker.lowerTyped(checked)` lowers and verifies an owned checked handle using the import signatures that were visible when it was checked. The result is one `IRUnit`; linking it into an executable program still requires its preceding definitions and imports. `lowerTypedProgram(elaborations, imports?)` builds and verifies a program directly from retained metadata, without rerunning source inference. `lowerTypedUnit` is the low-level lowering primitive; callers using it directly must verify the resulting linked program.

The existing `Checker.lower`, `checkFile`, snapshot runner, and pointer evaluator retain their behavior.

## Representation

`src/typed-ir.ts` defines ordered, single-assignment value temporaries and nested blocks. Every temporary has a semantic value/lens type, unique ID, and source origin. Logical places remain mutable resources; their type and availability change through explicit operations. The verifier tracks their revisions to reject invalidated computed lenses. Physical storage versions will be chosen during later lowering.

| Operation | Meaning |
| --- | --- |
| `constant`, `string`, `tuple`, `construct` | Produce typed owned values, consuming component temporaries once |
| `global` | Instantiate an explicitly declared generic definition/import using recorded type arguments |
| `move` | Consume a value from a logical place/projection, leaving unavailable storage |
| `acquire`, `lens-tuple` | Construct a thin logical view or a recursive bundle of component views; no physical representation is selected |
| `swap` | Install a replacement and return the previous focus value, with empty focuses represented logically as unit |
| `call` | Invoke a typed callable, applying its flow-argument effects; returned-lens effects remain deferred |
| `closure` | Transfer explicitly moved captures into a function environment |
| `bind` | Destructure an owned value into new slots or discard unbound fields |
| `borrow` | Open a lexical exclusive loan on an existing place |
| `scope`, `case` | Preserve nested lifetime and control-flow regions with typed results |

Blocks also contain explicit cleanup actions: drop an owned place if present, release a loan, or require a lens parameter to be restored with its declared replacement type. Cleanup of a plain-result block runs immediately after its result is taken. Cleanup of a lens-result block runs after the focus is replaced. This preserves nested alias scopes, lens-returning function frames, captured resources, and restoration order.

At affine branch joins, lowering inserts drops on edges where a value remains live but the joined source context makes it unavailable. This prevents leaking the value on an untaken-consumption path. Function and case-pattern locals have their own scope; their places cannot be used after retirement.

Function bodies are separate code records. Closure creation executes capture moves, not the body. Captures become owned slots in the invocation frame. Top-level reusable definitions must create a closed function; first-class closure values remain affine.

IR is JSON-serializable and remains verifiable after cloning/deserialization. Numeric constants/patterns encode `NaN`, infinities, and negative zero explicitly so JSON round trips preserve their values. Named constructor signatures are checked against registered generic constructor schemas rather than guessed from tags.

## Independent verification

`verifyTypedProgram` operates on IR, with no AST, solver state, or legacy evaluator dependency. It validates import/definition schemes, type arguments, temporary definition/use order, value/lens modes, arity, pattern types, place projections, exclusive loan permissions, capture environments, disposal, branch joins, and restored lens parameters. Restored parameters are checked independently of cleanup annotations, so deleting a cleanup instruction cannot turn an invalid function into a valid one.

Malformed IR raises `BackendDiagnostic` with code `invalid-ir`. The verifier runs in the checked whole-file path and again before reference execution. It rejects unknown operations and escaped rigid variables; it does not silently supply implicit `any` or call the legacy evaluator. It is a compiler consistency check, not a proof of correctness or a physical layout verifier.

## Reference execution

`executeTypedProgram` executes a detached, frozen IR snapshot. Its runtime has distinct empty storage, unit values, callable environments, and logical lens capabilities. It implements the current arithmetic imports, `round`, `dup` for supported data, `fst`, `charList`, and `heapsize` (zero because the checked reference subset has no explicit heap allocation primitive). Additional nominal constructors can be registered through their checking schemas. Native constants or imports without reference implementations produce explicit unsupported-import errors; callable duplication remains unsupported.

The reference runner executes source units in order and returns the last result. Earlier expression results are disposed; reusable definitions are installed without duplicating captures. This is a test convention, not the future public C/Wasm entry ABI. Optional execution traces, unused-closure disposal callbacks, and a deterministic step budget support regression tests.

Empty unit focuses are materialized at call boundaries: a callee's read contract describes a unit value even when the caller's storage was empty. This follows the checker's flow model. The old evaluator cannot clone its private deleted sentinel for `dup` on an empty focus; that case has an explicit logical-unit regression rather than treating the old runtime failure as the intended result. Other differential tests normalize private deleted sentinel results to unit and compare ordinary values directly.

## Verification and remaining work

`test/typed-ir.test.ts` covers the shared acceptance corpus, serialized IR, independent corruption rejection, differential evaluation, branch-specific disposal, nested aliases, returned and scattered lenses, capture/refill closures, registered constructor patterns, numeric edge cases, unmatched-case traps, and API ownership. `test/backend/legacy-reference.ts` is only a test adapter; it is not part of typed execution.

Run `bun test test/typed-ir.test.ts`, `bun test`, and `bunx tsc --noEmit`. Phase 3 must add reachable specialization and recursive representation constraints before this IR can be described as concrete. Phase 4 remains the first native C/Emscripten execution milestone. The reference interpreter passing a case is not evidence of C/Wasm code generation.

## Persistent computed aliases

A loan with an `owners` array introduces an independent focus at its `place`
(with an empty projection and no parent). Its `borrow` operand supplies the
computed lens capability and owns the deferred restoration. The ordered owner
references, including parent permits, must exactly match the capability's targets;
the verifier derives those targets independently. An empty owner array represents
a focus with no external owners, rather than a direct-place loan.

Alias bindings refer to the focus place with the loan's permit. Active loans
protect both that focus and all retained owners. `release` requires an initialized
focus of the replacement type, applies the original capability, and retires the
focus. Lens-valued scopes defer release until their result is restored. Returned
focus provenance is traced through computed loans to lens parameters; owned local
storage still cannot escape. The detached reference interpreter maps the focus
to the retained lens and invokes its restoration once at release. Representation
analysis and its independent verifier preserve the computed focus topology.

## Lens-valued branches

A `case` may produce a flow value. Each arm retains its lens capability and
branch-local storage until restoration. Its block cleanup runs after the selected
focus is replaced. Optional `setup` and `restored` arrays on an arm contain only
`drop-place` actions: they normalize affine availability after setup and after
restoration, respectively. Owned cases continue to use ordinary block cleanup.
Only the selected arm executes either normalization edge or deferred cleanup.
Pattern storage is retired after that cleanup, including when the result passes
through further lens-valued scopes or persistent aliases.

Independent verification checks every arm at setup, derives the union of protected
external owners from capabilities, and retains separate branch states. At
restoration it checks every possible replacement effect, verifies cleanup and
branch-local disposal, and joins outer types and availability. Function-return
provenance is checked in each branch state, so an owned local focus cannot escape
by being hidden in a branch. Retained elaboration records setup and restored
states separately and rejects missing restoration-state records.

The serialized typed interpreter and active legacy pointer evaluator execute these
branches. Legacy decomposition retains owned pattern and lens-block storage on
the heap until selected cleanup finishes. Representation inference normalizes branch results to a common thin focus while
preserving each arm’s original topology. Concrete IR retains a `lensJoin` contract
with the selected adapter kind, ordered source shapes, and result shape. Independent
verification checks this contract and both normalization edges against typed IR.
C storage lowering dispatches deferred restoration using the retained selector,
reconstructs selected owner outputs, and merges their logical storage versions.
Scalar/tuple cases, including thin/scattered joins, execute on native C and Wasm.

## Manual restoration

`manual` consumes a frontend lens temporary and retains a `cleanup` block plus
`holds` dependency references. The output has the frontend's focus contract.
Cleanup runs at restoration, after staging the final contents but before the
frontend's original restoration. Its owned block result is disposed. A separate
staging operation in the verifier preserves this order through tuples, scopes,
and branch selections; ordinary non-manual restoration keeps its atomic contract.

The verifier derives external dependency references from cleanup instructions,
normalizes nested borrow permissions, and compares them with `holds`. Its active
loan protections cover those dependencies and the frontend owners. Pending
computed owners remain inaccessible during cleanup. A manual capability explicitly
retains owned frontend storage; enclosing deferred scope/parameter cleanup must
still dispose every owned value. Raw local-lens escape checks remain unchanged
outside that contract. Elaboration's `manuals` records retain frontend/cleanup node
identities, dependency binding IDs, whether a function literal is scoped, and
staged/cleaned/restored storage states.

The typed interpreter executes this detached block and retains its frame until
restoration completes. The legacy pointer path uses retained scoped cleanup
thunks, so reading a temporary or owned callback after a function return sees its
final contents and live lexical storage. Representation analysis and independent
verification cover manual topology and deferred cleanup temporaries/calls, using
restoration-time data annotations and protected callable provenance. Concrete
lowering still rejects manual instructions with `unsupported-concrete` and the
concrete deferred-cleanup adapter diagnostic; no manual C/Wasm execution is claimed.
