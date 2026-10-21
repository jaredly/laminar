export type JSONValue = { [key: string]: JSONValue } | string | JSONValue[] | number | null;
export type JSONPair = [string, JSONValue];
