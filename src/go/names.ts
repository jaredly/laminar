import type { ConcreteProgram } from '../concrete-ir.ts';
import {
    NameAllocator,
    functionNames as sharedFunctionNames,
    patternSlots,
    sourceBinding,
} from '../backend/names.ts';

export { patternSlots, sourceBinding };

const keywords = new Set(
    `break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var`.split(
        ' ',
    ),
);
// These predeclared names appear in generated expressions. Shadowing one would
// change the meaning of that code. min/max, for example, are safe source names.
const builtins = new Set(
    `any append bool byte float64 int len make new nil panic rune string true false uint32`.split(
        ' ',
    ),
);
const runtime = new Set([
    'main',
    'init',
    'stdin',
    'printNumber',
    'printString',
    'formatNumber',
    'laminarRound',
    'laminarMod',
    'hostInput',
    'hostRandom',
    'hostMu',
    'hostObjects',
    'hostNext',
    'hostRegister',
    'hostLookup',
    'hostSleep',
    'hostChanNew',
    'hostChanSend',
    'hostChanRecv',
    'hostListen',
    'hostAccept',
    'hostRecv',
    'hostSend',
    'hostClose',
    'hostSpawn',
    'net',
    'hostWriteFile',
    'hostRandomState',
    'hostKey',
    'hostKeys',
    'hostKeysOnce',
    'exec',
    'strings',
    'sync',
    'time',
    'fmt',
    'math',
    'strconv',
    'os',
    'bufio',
    'environment',
    'replacement',
    'focus',
    'write',
    'result',
]);
const generated =
    /^(?:L\d+|A\d+|v\d+|arg\d+|back\d+|Backing\d+|native\d+|result\d+|result_adapter\d+|(?:hostPrint|hostWrite|char_list|print)_[A-Za-z_0-9]+|Backing_[A-Za-z_0-9]+)$/;

export const goNameRules = { reserved: [...keywords, ...builtins, ...runtime], generated };

/** Go's package and function-local namespaces. */
export class GoNames extends NameAllocator {
    constructor(reserved: Iterable<string> = []) {
        super(goNameRules, reserved);
    }
}

export const functionNames = (program: ConcreteProgram) =>
    sharedFunctionNames(program, new GoNames());
