import { NameAllocator } from '../backend/names.ts';

const keywords = `auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local bool true false NULL`;
// Identifiers declared by the headers the generated code includes. Taking one
// would redeclare a library function or macro, so source names never use them.
const library = `
abort abs atexit atof atoi atol bsearch calloc div exit free getenv labs malloc qsort rand realloc srand strtod strtol strtoul system
size_t ptrdiff_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t intptr_t uintptr_t
FILE EOF stdin stdout stderr fclose fflush fgetc fgets fopen fprintf fputc fputs fread fscanf fwrite getc getchar printf putc putchar puts scanf snprintf sprintf
memchr memcmp memcpy memmove memset strcat strchr strcmp strcpy strlen strncmp strncpy strrchr strstr
acos asin atan atan2 cbrt ceil copysign cos cosh exp exp2 expm1 fabs floor fma fmax fmin fmod frexp hypot ldexp lgamma log log10 log1p log2 lrint lround modf nan nearbyint pow remainder rint round scalbn signbit sin sinh sqrt tan tanh tgamma trunc isfinite isinf isnan isnormal fpclassify HUGE_VAL INFINITY NAN
`;
// The C runtime's own symbols and the hidden parameter names of generated bodies.
const runtime = `main live_contexts allocate_context release_context print_number print_string encode String string_builder environment opaque ctx replacement focus write result value cell handle`;
const generated =
    /^(?:L\d+|A\d+|fn\d+|v\d+|i\d+|arg\d+|back\d+|read\d+|write\d+|value\d+|result\d+|native\d+|dispose\d+|focus[A-Za-z_0-9]*|restore[A-Za-z_0-9]*|Restore\d+|LensResult[A-Za-z_0-9]*|Backing_[A-Za-z_0-9]*|result_adapter\d+|(?:drop|dup|print|char_list|round|host_print|host_input|vector_[a-z]+)_[A-Za-z_0-9]+|(?:laminar|string|builder)_[A-Za-z_0-9]*)$/;

export const cNameRules = {
    reserved: [keywords, library, runtime].flatMap((s) => s.split(/\s+/).filter(Boolean)),
    generated,
};

/** C's ordinary-identifier namespace: functions, typedefs and file-scope objects. */
export class CNames extends NameAllocator {
    constructor(reserved: Iterable<string> = []) {
        super(cNameRules, reserved);
    }
}

export const cScalars = { f64: 'double', bool: 'bool', string: 'String' };
