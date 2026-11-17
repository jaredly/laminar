import type { ConcreteProgram } from '../concrete-ir.ts';
import { lowerC } from './lower.ts';
import { printC } from './syntax.ts';
export { lowerC, printC };
export const emitC = (program: ConcreteProgram): string => printC(lowerC(program));
