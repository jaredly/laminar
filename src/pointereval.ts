import { Linear } from './ast.ts';

type Ctx = {};

// OK folks.
// I think I might want to still do the linear Expr setup
// but with ptrs, which will reduce some of the bookkeeping.
// Does that mean ... that it's just like a setting?
// because the non-stack version is maybe ... easier to understand?
// hmmm. but the types change.
//
// Ok I'll do a separate impl, because it's easier to build up
// slowly.

const evalLinear = (ctx: Ctx, lin: Linear) => {};
