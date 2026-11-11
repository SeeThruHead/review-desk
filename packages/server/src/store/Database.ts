import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { DeskConfig } from "../config/DeskConfig.ts"

const migrations = [
  "CREATE TABLE IF NOT EXISTS claims (pull TEXT PRIMARY KEY, session TEXT NOT NULL, claimed_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS triage (pull TEXT PRIMARY KEY, verdict TEXT NOT NULL, reason TEXT NOT NULL, settled TEXT NOT NULL, reported_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS seen_items (pull TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY (pull, item))",
  "CREATE TABLE IF NOT EXISTS pulls (pull TEXT PRIMARY KEY, first_seen TEXT NOT NULL, checks TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS branches (branch TEXT PRIMARY KEY, done TEXT NOT NULL, failing TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS claim_roles (pull TEXT PRIMARY KEY, role TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS issue_claims (id TEXT PRIMARY KEY, forge TEXT NOT NULL, repo TEXT NOT NULL, machine TEXT, pane TEXT NOT NULL, from_logins TEXT NOT NULL, baselined INTEGER NOT NULL)"
]

const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* Effect.forEach(migrations, (statement) => sql.unsafe(statement), { discard: true })
})

export const Database = Layer.effectDiscard(migrate).pipe(
  Layer.provideMerge(
    Layer.unwrap(
      Effect.gen(function* () {
        const config = yield* DeskConfig

        return SqliteClient.layer({ filename: `${config.home}/desk.sqlite` })
      })
    )
  )
)

export const DatabaseInMemory = Layer.effectDiscard(migrate).pipe(
  Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" }))
)
