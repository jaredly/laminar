/*
 * A hand-written C version of examples/mandelbrot.lm, for comparing performance.
 *
 * It writes the same file byte for byte: same header, same row padding, same colours.
 * The arithmetic is spelled with the same operations in the same order as the Laminar
 * program, because floating point results depend on it. Build and compare with
 *
 *   clang -O2 examples/mandelbrot-comparison.c -lm -o mandelbrot-c
 *   bun cli/laminar.ts emit examples/mandelbrot.lm --target native -o mandelbrot-laminar.c
 *   clang -O2 mandelbrot-laminar.c -lm -o mandelbrot-laminar
 *
 * and scale the image with -DWIDTH=1500 -DHEIGHT=1200 (the .lm file needs the same two
 * numbers edited in `width()` and `height()`).
 */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#ifndef WIDTH
#define WIDTH 150
#endif
#ifndef HEIGHT
#define HEIGHT 120
#endif
#define LIMIT 60
#define HEADER 54

/* a bmp row is padded out to a multiple of four bytes */
#define ROW_BYTES ((WIDTH * 3) + ((4 - ((WIDTH * 3) % 4)) % 4))
#define PIXEL_BYTES ((size_t)ROW_BYTES * HEIGHT)

/* little-endian */
static void put_le(unsigned char *bytes, size_t at, unsigned long n, int count) {
    for (int i = 0; i < count; i++) {
        bytes[at + i] = (unsigned char)(n % 256);
        n /= 256;
    }
}

/* ECMAScript Math.round, as the Laminar runtime defines it (only non-negative values here) */
static double round_half_up(double value) {
    double rounded = floor(value);
    if (value - rounded >= 0.5) rounded += 1;
    return rounded;
}

/* how many steps z -> z*z + c takes to leave the circle of radius 2 */
static double escape(double cr, double ci) {
    double zr = 0, zi = 0, n = 0;
    while (!(n >= LIMIT || zr * zr + zi * zi > 4)) {
        double next_zr = zr * zr - zi * zi + cr;
        double next_zi = 2 * zr * zi + ci;
        zr = next_zr;
        zi = next_zi;
        n = n + 1;
    }
    return n;
}

int main(void) {
    unsigned char *bytes = calloc(HEADER + PIXEL_BYTES, 1);
    if (!bytes) return 1;

    bytes[0] = 66;
    bytes[1] = 77;
    put_le(bytes, 2, HEADER + PIXEL_BYTES, 4);
    put_le(bytes, 10, HEADER, 4);
    put_le(bytes, 14, 40, 4);
    put_le(bytes, 18, WIDTH, 4);
    put_le(bytes, 22, HEIGHT, 4);
    put_le(bytes, 26, 1, 2);
    put_le(bytes, 28, 24, 2);
    put_le(bytes, 34, PIXEL_BYTES, 4);
    put_le(bytes, 38, 2835, 4);
    put_le(bytes, 42, 2835, 4);

    for (int y = 0; y < HEIGHT; y++) {
        for (int x = 0; x < WIDTH; x++) {
            double cr = x * (3.0 / WIDTH) - 2.1;
            double ci = 1.2 - y * (2.4 / HEIGHT);
            double n = escape(cr, ci);
            double blue = 0, green = 0, red = 0;
            if (n < LIMIT) {
                double t = n / LIMIT;
                double u = 1 - t;
                blue = round_half_up(8.5 * u * u * u * t * 255);
                green = round_half_up(15 * u * u * t * t * 255);
                red = round_half_up(9 * u * t * t * t * 255);
            }
            /* bmp rows run bottom to top */
            size_t at = HEADER + (size_t)(HEIGHT - 1 - y) * ROW_BYTES + (size_t)x * 3;
            bytes[at] = (unsigned char)blue;
            bytes[at + 1] = (unsigned char)green;
            bytes[at + 2] = (unsigned char)red;
        }
    }

    FILE *file = fopen("mandelbrot.bmp", "wb");
    if (!file) return 1;
    size_t written = fwrite(bytes, 1, HEADER + PIXEL_BYTES, file);
    if (fclose(file) != 0 || written != HEADER + PIXEL_BYTES) return 1;
    free(bytes);
    printf("wrote mandelbrot.bmp, %d x %d\n", WIDTH, HEIGHT);
    return 0;
}
