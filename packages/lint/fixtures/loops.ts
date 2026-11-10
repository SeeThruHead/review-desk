export const f = (xs: ReadonlyArray<number>) => {
  const out: Array<number> = []
  for (const x of xs) out.push(x)
  return out
}
