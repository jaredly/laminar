type Names = Names[] | string;
// virtual machine code idk
type VMC =
    | { type: 'recv'; value: VMC; names?: Names }
    | { type: 'get'; names: Names }
    | { type: 'tee'; value: VMC; names: Names }
    | { type: 'tee2'; value: VMC; target: VMC; as: Names }
    // basic js stuff
    | { type: 'const'; value: number | boolean | null }
    | { type: 'apply'; fn: VMC; args: VMC[] }
    | { type: 'fn' };
