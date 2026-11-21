/**
 * Test result protocol. Each entry prints one JSON result line. When a program
 * performs host I/O, stdout also carries its output, so a record separator
 * (U+001E) introduces each result line; everything else is program output.
 */
export function parseRun(text: string): { results: unknown[]; output: string } {
    if (!text.includes('\x1e'))
        return {
            results: text
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line)),
            output: '',
        };
    const [first, ...records] = text.split('\x1e');
    let output = first!;
    const results = records.map((record) => {
        const end = record.indexOf('\n');
        output += end < 0 ? '' : record.slice(end + 1);
        return JSON.parse(end < 0 ? record : record.slice(0, end));
    });
    return { results, output };
}
