import { type Delivered, Role, Settled, Triage } from "@review-desk/contract/Board.ts"
import { Forge, IsoTime, Login, type PrKey, RepoSlug, SessionName, Text } from "@review-desk/contract/Ids.ts"
import { SeenBranch } from "@review-desk/domain/Branches.ts"
import type { IssueClaim } from "../desk/IssueWatch.ts"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"

export class DeskRepoError extends Schema.TaggedError<DeskRepoError, { readonly brand: unique symbol }>()(
  "DeskRepoError",
  {
    cause: Schema.Defect()
  }
) {
  override get message() {
    return "Review Desk could not read or write its own records"
  }
}

const ClaimRow = Schema.Struct({ pull: Schema.String, session: SessionName })
const ClaimRoleRow = Schema.Struct({ pull: Schema.String, role: Role })
const TriageRow = Schema.Struct({
  pull: Schema.String,
  verdict: Triage.fields.verdict,
  reason: Triage.fields.reason,
  settled: Schema.fromJsonString(Schema.Array(Settled))
})
const PullRow = Schema.Struct({ pull: Schema.String, checks: Schema.String })
const ItemRow = Schema.Struct({ pull: Schema.String, item: Schema.String })
const SeenAtRow = Schema.Struct({ pull: Schema.String, at: IsoTime })
const DeliveryRow = Schema.Struct({ pull: Schema.String, text: Text, at: IsoTime })
const IssueClaimRow = Schema.Struct({
  id: Schema.String,
  forge: Forge,
  repo: RepoSlug,
  machine: Schema.NullOr(Schema.String),
  pane: Schema.String,
  from_logins: Schema.fromJsonString(Schema.Array(Login)),
  baselined: Schema.Int
})

const LoginsJson = Schema.fromJsonString(Schema.Array(Login))

const BranchRow = Schema.Struct({
  branch: Schema.String,
  done: Schema.fromJsonString(SeenBranch.fields.done),
  failing: Schema.fromJsonString(SeenBranch.fields.failing)
})

export type Records = {
  readonly claims: ReadonlyMap<string, SessionName>
  readonly claimRoles: ReadonlyMap<string, Role>
  readonly triage: ReadonlyMap<string, { readonly triage: Triage; readonly settled: ReadonlyArray<Settled> }>
  readonly known: ReadonlyMap<string, string>
  readonly seen: ReadonlySet<string>
  readonly seenAt: ReadonlyMap<string, IsoTime>
  readonly delivered: ReadonlyMap<string, Delivered>
}

const failed = Effect.mapError((cause: unknown) => new DeskRepoError({ cause }))

export class DeskRepo extends Context.Service<
  DeskRepo,
  {
    readonly records: Effect.Effect<Records, DeskRepoError>
    readonly claim: (pull: PrKey, session: SessionName, role: Role) => Effect.Effect<void, DeskRepoError>
    readonly saveTriage: (
      pull: PrKey,
      triage: Triage,
      settled: ReadonlyArray<Settled>
    ) => Effect.Effect<void, DeskRepoError>
    readonly remember: (pull: PrKey, checks: string, items: ReadonlyArray<string>) => Effect.Effect<void, DeskRepoError>
    readonly branches: Effect.Effect<ReadonlyMap<string, SeenBranch>, DeskRepoError>
    readonly saveBranch: (branch: string, seen: SeenBranch) => Effect.Effect<void, DeskRepoError>
    readonly issueClaims: Effect.Effect<ReadonlyArray<IssueClaim>, DeskRepoError>
    readonly claimIssues: (claim: Omit<IssueClaim, "baselined">) => Effect.Effect<void, DeskRepoError>
    readonly releaseIssues: (id: string) => Effect.Effect<boolean, DeskRepoError>
    readonly markBaselined: (id: string) => Effect.Effect<void, DeskRepoError>
    readonly rememberIssueItems: (id: string, items: ReadonlyArray<string>) => Effect.Effect<void, DeskRepoError>
    readonly markSeen: (pull: PrKey) => Effect.Effect<void, DeskRepoError>
    readonly noteDelivery: (pull: PrKey, text: string) => Effect.Effect<void, DeskRepoError>
  }
>()("review-desk/server/DeskRepo") {
  static readonly layer = Layer.effect(
    DeskRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const now = Effect.map(DateTime.now, DateTime.formatIso)

      const records = Effect.gen(function* () {
        const [claims, roles, triage, pulls, items, seenAt, delivered] = yield* Effect.all([
          sql`SELECT pull, session FROM claims`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ClaimRow)))
          ),
          sql`SELECT pull, role FROM claim_roles`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ClaimRoleRow)))
          ),
          sql`SELECT pull, verdict, reason, settled FROM triage`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(TriageRow)))
          ),
          sql`SELECT pull, checks FROM pulls`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(PullRow)))),
          sql`SELECT pull, item FROM seen_items`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ItemRow)))
          ),
          sql`SELECT pull, at FROM seen_at`.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SeenAtRow)))),
          sql`SELECT pull, text, at FROM deliveries`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(DeliveryRow)))
          )
        ])

        return {
          claims: new Map(claims.map((row) => [row.pull, row.session])),
          claimRoles: new Map(roles.map((row) => [row.pull, row.role])),
          triage: new Map(
            triage.map((row) => [
              row.pull,
              { triage: { verdict: row.verdict, reason: row.reason }, settled: row.settled }
            ])
          ),
          known: new Map(pulls.map((row) => [row.pull, row.checks])),
          seen: new Set(items.map((row) => `${row.pull} ${row.item}`)),
          seenAt: new Map(seenAt.map((row) => [row.pull, row.at])),
          delivered: new Map(delivered.map((row) => [row.pull, { text: row.text, at: row.at }]))
        }
      }).pipe(failed, Effect.withSpan("DeskRepo.records"))

      const claim = Effect.fn("DeskRepo.claim")(function* (pull: PrKey, session: SessionName, role: Role) {
        const at = yield* now
        yield* sql`INSERT INTO claims (pull, session, claimed_at) VALUES (${pull}, ${session}, ${at})
          ON CONFLICT (pull) DO UPDATE SET session = excluded.session, claimed_at = excluded.claimed_at`
        yield* sql`INSERT INTO claim_roles (pull, role) VALUES (${pull}, ${role})
          ON CONFLICT (pull) DO UPDATE SET role = excluded.role`
      }, failed)

      const saveTriage = Effect.fn("DeskRepo.saveTriage")(function* (
        pull: PrKey,
        triage: Triage,
        settled: ReadonlyArray<Settled>
      ) {
        const at = yield* now
        const settledJson = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Settled)))(settled)
        yield* sql`INSERT INTO triage (pull, verdict, reason, settled, reported_at) VALUES (${pull}, ${triage.verdict}, ${triage.reason}, ${settledJson}, ${at})
          ON CONFLICT (pull) DO UPDATE SET verdict = excluded.verdict, reason = excluded.reason, settled = excluded.settled, reported_at = excluded.reported_at`
      }, failed)

      const remember = Effect.fn("DeskRepo.remember")(function* (
        pull: PrKey,
        checks: string,
        items: ReadonlyArray<string>
      ) {
        const at = yield* now
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO pulls (pull, first_seen, checks) VALUES (${pull}, ${at}, ${checks})
              ON CONFLICT (pull) DO UPDATE SET checks = excluded.checks`
            yield* Effect.forEach(
              items,
              (item) => sql`INSERT OR IGNORE INTO seen_items (pull, item) VALUES (${pull}, ${item})`,
              { discard: true }
            )
          })
        )
      }, failed)

      const branches = sql`SELECT branch, done, failing FROM branches`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(BranchRow))),
        Effect.map((rows) => new Map(rows.map((row) => [row.branch, { done: row.done, failing: row.failing }]))),
        failed,
        Effect.withSpan("DeskRepo.branches")
      )

      const saveBranch = Effect.fn("DeskRepo.saveBranch")(function* (branch: string, seen: SeenBranch) {
        const done = yield* Schema.encodeEffect(BranchRow.fields.done)(seen.done)
        const failing = yield* Schema.encodeEffect(BranchRow.fields.failing)(seen.failing)
        yield* sql`INSERT INTO branches (branch, done, failing) VALUES (${branch}, ${done}, ${failing})
          ON CONFLICT (branch) DO UPDATE SET done = excluded.done, failing = excluded.failing`
      }, failed)

      const issueClaims = sql`SELECT id, forge, repo, machine, pane, from_logins, baselined FROM issue_claims`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(IssueClaimRow))),
        Effect.map((rows) =>
          rows.map((row): IssueClaim => ({
            id: row.id,
            forge: row.forge,
            repo: row.repo,
            from: row.from_logins,
            target: { machine: row.machine, pane: row.pane },
            baselined: row.baselined === 1
          }))
        ),
        failed,
        Effect.withSpan("DeskRepo.issueClaims")
      )

      const claimIssues = Effect.fn("DeskRepo.claimIssues")(function* (issueClaim: Omit<IssueClaim, "baselined">) {
        const from = yield* Schema.encodeEffect(LoginsJson)(issueClaim.from)
        yield* sql`INSERT INTO issue_claims (id, forge, repo, machine, pane, from_logins, baselined)
          VALUES (${issueClaim.id}, ${issueClaim.forge}, ${issueClaim.repo}, ${issueClaim.target.machine}, ${issueClaim.target.pane}, ${from}, 0)
          ON CONFLICT (id) DO UPDATE SET from_logins = excluded.from_logins`
      }, failed)

      const releaseIssues = Effect.fn("DeskRepo.releaseIssues")(function* (id: string) {
        const before = yield* sql`SELECT id FROM issue_claims WHERE id = ${id}`
        yield* sql`DELETE FROM issue_claims WHERE id = ${id}`

        return before.length > 0
      }, failed)

      const markBaselined = Effect.fn("DeskRepo.markBaselined")(function* (id: string) {
        yield* sql`UPDATE issue_claims SET baselined = 1 WHERE id = ${id}`
      }, failed)

      const rememberIssueItems = Effect.fn("DeskRepo.rememberIssueItems")(function* (
        id: string,
        items: ReadonlyArray<string>
      ) {
        yield* Effect.forEach(
          items,
          (item) => sql`INSERT OR IGNORE INTO seen_items (pull, item) VALUES (${id}, ${item})`,
          {
            discard: true
          }
        )
      }, failed)

      const markSeen = Effect.fn("DeskRepo.markSeen")(function* (pull: PrKey) {
        const at = yield* now
        yield* sql`INSERT INTO seen_at (pull, at) VALUES (${pull}, ${at})
          ON CONFLICT (pull) DO UPDATE SET at = excluded.at`
      }, failed)

      const noteDelivery = Effect.fn("DeskRepo.noteDelivery")(function* (pull: PrKey, text: string) {
        const at = yield* now
        yield* sql`INSERT INTO deliveries (pull, text, at) VALUES (${pull}, ${text}, ${at})
          ON CONFLICT (pull) DO UPDATE SET text = excluded.text, at = excluded.at`
      }, failed)

      return DeskRepo.of({
        records,
        claim,
        saveTriage,
        remember,
        branches,
        saveBranch,
        issueClaims,
        claimIssues,
        releaseIssues,
        markBaselined,
        rememberIssueItems,
        markSeen,
        noteDelivery
      })
    })
  )
}
