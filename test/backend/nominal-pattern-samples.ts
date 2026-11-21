/** Borrowed and `aslens` constructor-pattern programs over nominal data (lists). */
export const borrowedNominalSamples = [
    [
        'constructor aliases',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h := 3\n rest := []}\n xs}',
        [3],
    ],
    [
        'owned replacement after aliases end',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h := 3}\n xs := []\n xs}',
        [],
    ],
    [
        'borrowed match',
        '{let xs = [1, 2]\n match ~xs {[h, ...rest] -> {h := 3\n ()}; [] -> ()}\n xs}',
        [3, 2],
    ],
    [
        'empty borrowed match',
        '{let xs = []\n match ~xs {[h, ...rest] -> {h := 3\n ()}; [] -> ()}\n xs}',
        [],
    ],
    [
        'borrowed match result',
        '{let xs = [1, 2]\n let result = match ~xs {[h, ...rest] -> dup(~h); [] -> 0}\n (result, xs)}',
        [1, [1, 2]],
    ],
    [
        'type-changing fields',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n h := true\n rest := []}\n xs}',
        [true],
    ],
    ['borrowed tuple match', '{let xs = (1, 2)\n match ~xs {(h, rest) -> {h := 3}}\n xs}', [3, 2]],
    [
        'nested constructor patterns',
        '{let xs = [1, 2]\n {let [a, b] = ~xs\n a := 3\n b := 4}\n xs}',
        [3, 4],
    ],
    [
        'returned borrowed match',
        'fn first(~xs) ~{match ~xs {[h, ...rest] -> h}}\n {let xs = [1, 2]\n first(~xs) := 3\n xs}',
        [3, 2],
    ],
    ...(['true', 'false'] as const).map(
        (condition) =>
            [
                `branch over reconstructed field ${condition}`,
                `{let xs = [1, 2]
 {let [h, ...rest] = ~xs
 {let selected = ~{match ${condition} {true -> h; false -> h}}
 selected := 4}}
 xs}`,
                [4, 2],
            ] as const,
    ),
    [
        'reconstructed field captured and refilled',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n let f = fn () h\n h := 4\n f()}\n xs}',
        [4, 2],
    ],
    [
        'temporary cleanup updates reconstructed sibling',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n {let f = ~{{lens finalFocus <- h\nh := finalFocus\n{rest := []}}}\n f := 4}}\n xs}',
        [4],
    ],
    [
        'temporary cleanup refills reconstructed field',
        '{let xs = [1, 2]\n {let [h, ...rest] = ~xs\n {let f = ~{lens v <- h\n h := v}\n f := 4}}\n xs}',
        [4, 2],
    ],
] as const;
export const aslensNominalSamples = [
    [
        'constructor final type',
        '{let seen = 0\n {let f = ~{lens [h, ...t] <- 1\n seen := (h, t)}\n f := [3, 4]}\n seen}',
        [3, [4]],
    ],
    [
        'nested literals',
        '{let seen = 0\n {let f = ~{lens [1, v] <- ()\n seen := v}\n f := [1, 3]}\n seen}',
        3,
    ],
    ['string literal', '{let f = ~{lens "done" <- 1\n ()}\n f := "done"}', 1],
    ['owned fields need no refill', '{let f = ~{lens [h, ...t] <- 1\n (h, t)}\n f := [3, 4]}', 1],
] as const;
