export type Pin = { kind: "file"; path: string } | { kind: "symbol"; name: string; path: string; line: number };
