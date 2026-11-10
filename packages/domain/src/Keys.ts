import { type Forge, type PrKey, PrNumber, RepoSlug } from "@review-desk/contract/Ids.ts"

export type KeyParts = { readonly forge: Forge; readonly repo: RepoSlug; readonly number: PrNumber }

export const keyParts = (key: PrKey): KeyParts => {
  const colon = key.indexOf(":")
  const hash = key.lastIndexOf("#")
  const forge: Forge = key.startsWith("github:") ? "github" : "gitea"

  return {
    forge,
    repo: RepoSlug.make(key.slice(colon + 1, hash)),
    number: PrNumber.make(Number(key.slice(hash + 1)))
  }
}
