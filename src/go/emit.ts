import type { ConcreteProgram } from '../concrete-ir.ts';
import { lowerGo } from './lower.ts';
import { printGo } from './syntax.ts';

export { lowerGo, printGo };
export const emitGo = (program: ConcreteProgram): string => printGo(lowerGo(program));
