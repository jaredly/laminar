/*

ok folks let's talk.

# PAT
vbl
(pat, pat)
()

# LIN
-> easy
vbl
(lin, lin)
let pat = lin in lin
fn(pat) => lin
lin(lin)
()
Left(lin)
Right(lin)
case lin
    Left(pat) -> lin
    Right(pat) -> lin
lin & lin // SPLIT
fst(lin)
snd(lin)

-> hard
lens := lin
unlens lens in lin
let pat = ~lens in lin
fn(pat) => ~lens
lin(~lens)
case ~lens
    Left(pat) -> lin
    Right(pat) -> lin
false(term) ???
true(lin)
promote??discard??copy??derelict??


# LENS
-> easier
vbl
(lens, lens)
()
lin(lin)
lin(~lens)
aslens vbl <- lin in lin

-> harder
let pat = lin in lens
let pat = ~lens in lens
case lin
    Left(pat) -> lens
    Right(pat) -> lens
case ~lens
    Left(pat) -> lens
    Right(pat) -> lens
false(term)


So that's the language level syntax.
BUT
we can replace all of the lenses with, like, lambda functions. right?



*/

import { Linear, Term } from './ast.ts';

/*

Question being:
can we ... turn the lin+lens language into just the linear language?
That would be quite interesting.

Then we just need reliable generation for the linear language.

*/

type Scope = Record<string, string>;

export const linearToTS = (scope: Scope, lin: Linear): string => {
    switch (lin.type) {
        case 'op':
        case 'id': {
            if (!scope[lin.text]) {
                throw new Error(`Unbound ${lin.text}`);
            }
            return scope[lin.text];
        }
        case 'string': {
            return (
                '`' +
                lin.head +
                lin.interp
                    .map(({ value, tail }): string => linearToTS(scope, value) + tail)
                    .join('') +
                '`'
            );
        }
        case 'assign': {
            throw new Error(`assigns should have been compiled out by now`);
        }
        case 'const': {
            return lin.value + '';
        }
        case 'let': {
            if (lin.value.type === 'lens') {
                throw new Error('lens not compilede out');
            }
            const bodyScope = { ...scope };
            return `let ${patLHS(lin.pat, bodyScope)} = ${linearToTS(scope, lin.value)};\n${linearToTS(bodyScope, lin.body)}`;
        }
        case 'fn': {
        }
        case 'apply': {
        }
        case 'tuple':
        case 'constructor':
        case 'case':
    }
};
