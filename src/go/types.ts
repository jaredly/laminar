import type { ConcreteProgram } from '../concrete-ir.ts';
import { layoutNames } from '../backend/type-names.ts';
import { GoNames } from './names.ts';

export { fingerprint } from '../backend/type-names.ts';

export function goTypes(program: ConcreteProgram, reserved: Iterable<string>) {
    const allocator = new GoNames(reserved);
    const scalars = { f64: 'float64', bool: 'bool', string: 'string' };
    return { ...layoutNames(program, allocator, scalars), allocator };
}
