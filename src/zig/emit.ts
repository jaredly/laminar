import type { ConcreteProgram } from '../concrete-ir.ts';
import { lowerZig } from './lower.ts';
import { printZig } from './syntax.ts';

export { lowerZig, printZig };
export const emitZig = (program: ConcreteProgram): string => printZig(lowerZig(program));
