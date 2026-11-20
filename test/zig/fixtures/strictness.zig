// Phase-0 strictness fixture for the planned Zig backend (docs/zig-codegen-plan.md §3).
// Hand-written in the shape lower.ts will emit. It must compile with zero errors on
// the pinned Zig version; if a Zig release rejects an idiom here, the plan's
// uniform-discard rule needs revisiting before any lowering work.
const std = @import("std");

extern fn printf(format: [*:0]const u8, ...) c_int;
extern fn putchar(c: c_int) c_int;

// Unit is zero-sized; records are value structs.
const Unit = struct {};
const L0 = struct { item0: f64, item1: f64 };

// Typed code pointer with an opaque, nullable environment.
const Abi0 = *const fn (?*anyopaque, f64) f64;
const Dispose = *const fn (?*anyopaque) Unit;
const Callable0 = struct { environment: ?*anyopaque, dispose: ?Dispose, entry: Abi0 };
const Env0 = struct { capture0: f64 };

// Residual restoration context and its exact typed restoration ABI.
const Ctx0 = struct { parent: *L0 };
const Restore0 = *const fn (?*anyopaque, f64) Unit;

// Global allocator plus the same live counter the C backend checks.
var gpa: std.heap.DebugAllocator(.{}) = .init;
var live_contexts: usize = 0;

fn allocate(comptime T: type) *T {
    const p = gpa.allocator().create(T) catch @panic("laminar: allocation failed");
    live_contexts += 1;
    return p;
}

fn release(comptime T: type, p: *T) void {
    if (live_contexts == 0) @panic("laminar: double release");
    live_contexts -= 1;
    gpa.allocator().destroy(p);
}

// Uniform-discard rule: every binding is `var` + `_ = &name;`, used or not,
// mutated or not. Parameters are copied into locals on entry.
fn code0(environment: ?*anyopaque, arg0: f64) f64 {
    var p0 = arg0;
    _ = &p0;
    const env: *Env0 = @ptrCast(@alignCast(environment.?));
    var v0: f64 = env.capture0;
    _ = &v0;
    var v1: f64 = v0 + p0;
    _ = &v1;
    var v2: f64 = 0; // never read
    _ = &v2;
    return v1;
}

fn dispose0(environment: ?*anyopaque) Unit {
    const env: *Env0 = @ptrCast(@alignCast(environment.?));
    release(Env0, env);
    return .{};
}

// Capture-free code still takes (and ignores) the environment.
fn code1(environment: ?*anyopaque, arg0: f64) f64 {
    _ = environment;
    var p0 = arg0;
    _ = &p0;
    return p0 * 2;
}

fn restore0(opaque_ctx: ?*anyopaque, replacement: f64) Unit {
    var p0 = replacement;
    _ = &p0;
    const ctx: *Ctx0 = @ptrCast(@alignCast(opaque_ctx.?));
    ctx.parent.item0 = p0;
    release(Ctx0, ctx);
    return .{};
}

fn printNumber(x: f64) void {
    if (std.math.isNan(x)) {
        _ = printf("{\"number\":\"NaN\"}");
    } else if (std.math.isInf(x)) {
        _ = printf(if (x < 0) "{\"number\":\"-Infinity\"}" else "{\"number\":\"Infinity\"}");
    } else if (x == 0 and std.math.signbit(x)) {
        _ = printf("{\"number\":\"-0\"}");
    } else {
        _ = printf("%.17g", x);
    }
}

fn invoke(callable: Callable0, arg: f64) f64 {
    var v0: f64 = callable.entry(callable.environment, arg);
    _ = &v0;
    if (callable.dispose) |d| _ = d(callable.environment);
    return v0;
}

pub fn main() void {
    // Closure with a heap environment and a disposer.
    var env: *Env0 = allocate(Env0);
    _ = &env;
    env.* = .{ .capture0 = 40 };
    var c0: Callable0 = .{ .environment = env, .dispose = &dispose0, .entry = &code0 };
    _ = &c0;
    printNumber(invoke(c0, 2));
    _ = putchar(10);

    // Capture-free callable: null environment, no disposer.
    var c1: Callable0 = .{ .environment = null, .dispose = null, .entry = &code1 };
    _ = &c1;
    printNumber(invoke(c1, 21));
    _ = putchar(10);

    // Swap through a temporary. A literal that reads its own destination
    // (`x = .{ .item0 = x.item1, .item1 = x.item0 }`) yields {2, 2}: result
    // location semantics write item0 before item1 reads it.
    var x: L0 = .{ .item0 = 1, .item1 = 2 };
    _ = &x;
    var t0: L0 = .{ .item0 = x.item1, .item1 = x.item0 };
    _ = &t0;
    x = t0;
    _ = printf("[");
    printNumber(x.item0);
    _ = printf(",");
    printNumber(x.item1);
    _ = printf("]");
    _ = putchar(10);

    // Returned-lens style restoration through an erased context.
    var ctx: *Ctx0 = allocate(Ctx0);
    _ = &ctx;
    ctx.* = .{ .parent = &x };
    var r0: Restore0 = &restore0;
    _ = &r0;
    _ = r0(ctx, 7);
    printNumber(x.item0);
    _ = putchar(10);

    // Keyword-named identifiers are escaped.
    var @"type": f64 = 0;
    _ = &@"type";
    var neg: f64 = -@"type";
    _ = &neg;
    printNumber(neg);
    _ = putchar(10);
    printNumber(@"type" / @"type");
    _ = putchar(10);

    if (live_contexts != 0) @panic("laminar: live contexts at exit");
    if (gpa.deinit() == .leak) @panic("laminar: leaked allocations");
}
