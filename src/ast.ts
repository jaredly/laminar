export type Id = { type: 'id'; text: string };
export type Pat =
    | Id
    | { type: 'drop' }
    | { type: 'tuple'; items: Pat[] }
    | { type: 'constructor'; name: string; args: Pat[] }
    | { type: 'lens'; inner: Pat };

export type Type =
    | Id
    | { type: 'lens'; left: Type; right?: Type }
    | { type: 'tuple'; items: Type[] }
    | { type: 'fn'; args: Type[]; body: Type };

export type Lens =
    | Id
    | { type: 'aslens'; pat: Pat; value: Linear; body: Linear }
    | { type: 'let'; pat: Pat; value: Term; body: Lens }
    | { type: 'apply'; fn: Linear; args: Term[] }
    | { type: 'tuple'; items: Lens[] }
    | { type: 'case'; value: Term; cases: { pat: Pat; body: Lens }[] };

export type Term = Linear | { type: 'lens'; lens: Lens };

export type LinearCase = { pat: Pat; body: Linear };

export type LinearOps =
    | { type: 'attr'; attr: string }
    | { type: 'index'; index: Linear }
    | { type: 'apply'; args: Linear[] };

export type FnArg = { pat: Pat; typ?: Type };
export type LinearInterp = { value: Linear; tail: string };
export type Linear =
    | Id
    | { type: 'assign'; lens: Lens; value: Linear }
    | { type: 'const'; value: number | boolean | null }
    | {
          type: 'string';
          head: string;
          interp: { value: Linear; tail: string }[];
      }
    // unlens???
    | { type: 'let'; pat: Pat; value: Term; body: Linear }
    | {
          type: 'fn';
          name?: string | null;
          args: FnArg[];
          ann?: Type | null;
          body: Term;
      }
    | { type: 'apply'; fn: Linear; args: Term[]; isLens?: boolean }
    | { type: 'tuple'; items: Linear[] }
    | { type: 'constructor'; name: string; args: Linear[] }
    | { type: 'case'; value: Term; cases: { pat: Pat; body: Linear }[] };
