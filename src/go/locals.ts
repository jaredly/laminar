import { Locals } from '../backend/imperative/locals.ts';
import { goSyntax } from './syntax.ts';

/** The shared expression/declaration passes, spelling synthesized code as Go. */
export class GoLocals extends Locals {
    constructor() {
        super(goSyntax);
    }
}
