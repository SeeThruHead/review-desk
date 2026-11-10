export const clean = (xs: ReadonlyArray<number>): ReadonlyArray<number> => xs.map((x) => x + 1).toSorted((a, b) => a - b)
