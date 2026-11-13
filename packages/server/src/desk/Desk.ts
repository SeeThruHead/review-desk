import type { Board, Role } from "@review-desk/contract/Board.ts"
import {
  type AgentListing,
  AgentUnreadable,
  type CommentRequest,
  type IssueClaimRequest,
  DeliveryFailed,
  NotConfigured,
  PostFailed,
  RoundLimitReached,
  SidediffFailed,
  Summary,
  type TriageReport,
  UnknownPull
} from "@review-desk/contract/Contract.ts"
import {
  Count,
  type Forge,
  IsoTime,
  Login,
  PrKey,
  type RepoSlug,
  SessionName,
  Text,
  Url,
  prKey
} from "@review-desk/contract/Ids.ts"
import { type BranchChange, type SeenBranch, branchChanges } from "@review-desk/domain/Branches.ts"
import type { IssueFacts, PullFacts, Side, Thread } from "@review-desk/domain/Facts.ts"
import { threadState } from "@review-desk/domain/Lifecycle.ts"
import { keyParts } from "@review-desk/domain/Keys.ts"
import { issueStamp, markerOf, stamp } from "@review-desk/domain/Protocol.ts"
import { summaryOf } from "@review-desk/domain/Summary.ts"
import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Semaphore,
  Stream,
  SubscriptionRef
} from "effect"
import { Agents, type LiveAgent, type Roster } from "../agents/Agents.ts"
import { targetFor } from "../agents/Directory.ts"
import type { AgentTarget } from "../agents/Remote.ts"
import { DeskConfig, areaAgent } from "../config/DeskConfig.ts"
import { type BranchRuns, type ForgeError, Forges } from "../forge/Forge.ts"
import { Shell } from "../platform/Shell.ts"
import { DeskRepo } from "../store/DeskRepo.ts"
import { type Reported, type Watched, branchMessage, watchedBranches } from "./BranchWatch.ts"
import { type Holder, absences } from "./Gone.ts"
import { claimId, issuePlan } from "./IssueWatch.ts"
import { type RepoRef, withDiscovered } from "./Repos.ts"
import { type Failure, crashed, healthAfter, overdue, starting } from "./Health.ts"
import { authorBrief, routingBrief } from "./Messages.ts"
import { areaFor, plan, roleOf, routingOf } from "./Plan.ts"

const markerRounds = (thread: Thread | undefined, side: Side): number =>
  Math.max(
    0,
    ...(thread?.comments ?? []).flatMap((comment) =>
      Option.toArray(markerOf(comment.body))
        .filter((marker) => marker.side === side)
        .map((marker) => marker.round)
    )
  )

export const findOrPoll = Effect.fnUntraced(function* <A, E>(
  find: Effect.Effect<A | undefined>,
  poll: Effect.Effect<void>,
  missing: () => E
) {
  const found = yield* find
  if (found !== undefined) return found
  yield* poll
  const polled = yield* find
  if (polled === undefined) return yield* Effect.fail(missing())

  return polled
})

export const roundFor = (thread: Thread | undefined, side: Side): number => {
  const reviewerRounds = markerRounds(thread, "reviewer")

  return side === "reviewer" ? reviewerRounds + 1 : Math.max(1, reviewerRounds)
}

const threadWith = (pull: PullFacts, commentId: string | null): Thread | undefined =>
  commentId === null
    ? undefined
    : pull.threads.find((thread) => thread.comments.some((comment) => comment.id === commentId))

export const threadReplyTarget = (pull: PullFacts, replyTo: string | null): string | null => {
  if (pull.forge !== "github") return null

  return threadWith(pull, replyTo) === undefined ? null : replyTo
}

const jobsFor =
  (gitea: BranchRuns, watched: Watched) =>
  (change: BranchChange): Effect.Effect<Reported> =>
    change.kind === "failed"
      ? gitea.failedJobs(watched.repo, change.run.id).pipe(
          Effect.orElseSucceed(() => []),
          Effect.map((jobs) => ({ ...change, jobs }))
        )
      : Effect.succeed({ ...change, jobs: [] })

const placeOf = (target: AgentTarget): string =>
  target.machine === null ? target.pane : `${target.pane} on ${target.machine}`

const sameSummary = Schema.toEquivalence(Summary)

const failureOf = (error: ForgeError): Failure => ({
  message: error.paused === true ? error.reason : error.message,
  paused: error.paused === true,
  until: error.until ?? null
})

type Fetched<A> = { readonly found: ReadonlyArray<A>; readonly failure: Failure | null }

const isWatched = (facts: ReadonlyArray<PullFacts>, issues: ReadonlyArray<IssueFacts>, key: PrKey): boolean => {
  if (facts.some((pull) => pull.key === key)) return true

  return issues.some((issue) => prKey(issue.forge, issue.repo, issue.number) === key)
}

const lastCopy = <A extends { readonly forge: Forge; readonly repo: RepoSlug }>(
  ref: Ref.Ref<ReadonlyArray<A>>,
  entry: RepoRef,
  error: ForgeError
): Effect.Effect<Fetched<A>> =>
  Effect.map(Ref.get(ref), (all) => ({
    found: all.filter((item) => item.forge === entry.forge && item.repo === entry.slug),
    failure: failureOf(error)
  }))

const logFailure = (entry: RepoRef, what: string) => (error: ForgeError) =>
  error.paused === true
    ? Effect.logDebug(`${error.message}; keeping the last copy of ${entry.slug}'s ${what}`)
    : Effect.logWarning(`${error.message}; keeping the last copy of ${entry.slug}'s ${what}`)

export class Desk extends Context.Service<
  Desk,
  {
    readonly board: Stream.Stream<Board>
    readonly summary: Stream.Stream<Summary>
    readonly refresh: Effect.Effect<void>
    readonly reportTriage: (report: TriageReport) => Effect.Effect<void, UnknownPull>
    readonly claim: (
      key: PrKey,
      session: SessionName | null,
      role: Role
    ) => Effect.Effect<void, UnknownPull | DeliveryFailed>
    readonly postComment: (
      request: CommentRequest
    ) => Effect.Effect<{ readonly url: Url }, UnknownPull | RoundLimitReached | PostFailed>
    readonly openInSidediff: (key: PrKey) => Effect.Effect<void, UnknownPull | SidediffFailed | NotConfigured>
    readonly claimIssues: (
      request: IssueClaimRequest
    ) => Effect.Effect<{ readonly forges: ReadonlyArray<Forge> }, NotConfigured>
    readonly releaseIssues: (repo: RepoSlug, target: AgentTarget) => Effect.Effect<{ readonly released: Count }>
    readonly markSeen: (key: PrKey) => Effect.Effect<void, UnknownPull>
    readonly listAgents: Effect.Effect<AgentListing>
    readonly readAgent: (agent: string, lines: number) => Effect.Effect<{ readonly text: string }, AgentUnreadable>
  }
>()("review-desk/server/Desk") {
  static readonly layer = Layer.effect(
    Desk,
    Effect.gen(function* () {
      const config = yield* DeskConfig
      const forges = yield* Forges
      const agents = yield* Agents
      const repo = yield* DeskRepo
      const shell = yield* Shell
      const empty: Board = {
        desk: Login.make(config.desk),
        cards: [],
        ready: [],
        sidediff: config.sidediff !== null,
        polledAt: null,
        mentions: [],
        health: starting,
        routing: routingOf(config, []),
        budget: null
      }
      const boardRef = yield* SubscriptionRef.make(empty)
      const factsRef = yield* Ref.make<ReadonlyArray<PullFacts>>([])
      const issuesRef = yield* Ref.make<ReadonlyArray<IssueFacts>>([])
      const lock = yield* Semaphore.make(1)

      const reposRef = yield* Ref.make<ReadonlyArray<RepoRef>>(config.repos)

      const discover = Effect.gen(function* () {
        const gitea = forges.gitea
        if (gitea === null || config.gitea?.discoverOwned !== true) return
        const owned = yield* gitea.ownedRepos([config.desk, ...config.aliases])
        yield* Ref.set(reposRef, withDiscovered(config.repos, "gitea", owned, config.owners))
      }).pipe(Effect.catch((error) => Effect.logWarning(`${error.message}; keeping the last list of repositories`)))

      const fetchRepo = (entry: RepoRef): Effect.Effect<Fetched<PullFacts>> => {
        const client = forges[entry.forge]
        if (client === null) return Effect.succeed({ found: [], failure: null })

        return client.pulls(entry.slug).pipe(
          Effect.map((found) => ({ found, failure: null })),
          Effect.tapError(logFailure(entry, "pull requests")),
          Effect.catch((error) => lastCopy(factsRef, entry, error))
        )
      }

      const fetchMentions = (entry: RepoRef): Effect.Effect<Fetched<IssueFacts>> => {
        const client = forges[entry.forge]
        if (client === null) return Effect.succeed({ found: [], failure: null })

        return client.mentions(entry.slug).pipe(
          Effect.map((found) => ({ found, failure: null })),
          Effect.tapError(logFailure(entry, "mentions")),
          Effect.catch((error) => lastCopy(issuesRef, entry, error))
        )
      }

      const fetchAll = <A>(fetch: (entry: RepoRef) => Effect.Effect<Fetched<A>>) =>
        Effect.flatMap(Ref.get(reposRef), (repos) => Effect.forEach(repos, fetch, { concurrency: 2 })).pipe(
          Effect.map((all) => ({
            found: all.flatMap((one) => one.found),
            failures: all.flatMap((one) => (one.failure === null ? [] : [one.failure]))
          }))
        )

      const now = Effect.map(DateTime.now, (time) => IsoTime.make(DateTime.formatIso(time)))

      const claimGraceMinutes = config.claimGraceMinutes ?? 30

      const noRoster: Roster = { agents: [], reached: [], complete: false, prefixes: [], refused: new Map() }

      const wantedAgents = repo.records.pipe(
        Effect.map((records) => [...config.areas.map(areaAgent), ...records.claims.values()]),
        Effect.orElseSucceed(() => config.areas.map(areaAgent))
      )

      const roster = wantedAgents.pipe(
        Effect.flatMap(agents.roster),
        Effect.tapError((error) => Effect.logWarning(error.message)),
        Effect.orElseSucceed(() => noRoster)
      )

      const missingRef = yield* Ref.make<ReadonlyMap<string, number>>(new Map())

      const release = (holder: Holder) => {
        const who = holder._tag === "Session" ? holder.session : `${holder.pane} on ${holder.machine ?? "this machine"}`
        const done =
          holder._tag === "Session" ? repo.releasePull(PrKey.make(holder.key)) : repo.releaseIssues(holder.key)

        return done.pipe(
          Effect.andThen(
            Effect.logInfo(
              `released the claim ${holder.key}: its agent ${who} was gone for the whole grace period (${claimGraceMinutes} min)`
            )
          )
        )
      }

      const releaseGone = Effect.fn("Desk.releaseGone")(
        function* (found: Roster) {
          const records = yield* repo.records
          const watchers = yield* repo.issueClaims
          const holders: ReadonlyArray<Holder> = [
            ...[...records.claims].map(([key, session]): Holder => ({ _tag: "Session", key, session })),
            ...watchers.map((watcher): Holder => ({
              _tag: "Pane",
              key: watcher.id,
              machine: watcher.target.machine,
              pane: watcher.target.pane
            }))
          ]
          const clock = yield* DateTime.now
          const before = yield* Ref.get(missingRef)
          const judged = absences(holders, found, before, DateTime.toEpochMillis(clock), claimGraceMinutes * 60_000)
          yield* Ref.set(missingRef, judged.missing)
          yield* Effect.forEach(judged.expired, release, { discard: true })
        },
        Effect.catch((error) => Effect.logWarning(error.message))
      )

      const execute = Effect.fn("Desk.execute")(function* (steps: ReturnType<typeof plan>) {
        yield* Effect.forEach(
          steps.routes,
          (route) =>
            agents.prompt(route.target, route.message).pipe(
              Effect.andThen(repo.claim(route.pull.key, route.session, "reviewer")),
              Effect.andThen(repo.remember(route.pull.key, route.pull.checks, route.items)),
              Effect.andThen(repo.noteDelivery(route.pull.key, `Sent to ${route.session} for review`)),
              Effect.tap(() =>
                Effect.logInfo(`routed ${route.pull.key} to ${route.session} (${placeOf(route.target)})`)
              ),
              Effect.catch((error) => Effect.logWarning(error.message))
            ),
          { discard: true }
        )
        yield* Effect.forEach(
          steps.deliveries,
          (delivery) =>
            agents.prompt(delivery.agent, delivery.message).pipe(
              Effect.andThen(repo.remember(delivery.pull.key, delivery.pull.checks, delivery.items)),
              Effect.andThen(repo.noteDelivery(delivery.pull.key, delivery.note)),
              Effect.tap(() =>
                Effect.logInfo(
                  `delivered ${delivery.items.length} updates on ${delivery.pull.key} to ${placeOf(delivery.agent)}`
                )
              ),
              Effect.catch((error) => Effect.logWarning(error.message))
            ),
          { discard: true }
        )
        yield* Effect.forEach(
          steps.remember,
          (entry) =>
            repo
              .remember(entry.pull.key, entry.pull.checks, entry.items)
              .pipe(Effect.catch((error) => Effect.logWarning(error.message))),
          { discard: true }
        )
      })

      const watchBranch = Effect.fn("Desk.watchBranch")(function* (
        gitea: BranchRuns,
        watched: Watched,
        seen: SeenBranch | undefined
      ) {
        yield* Effect.annotateCurrentSpan("branch", watched.key)
        const runs = yield* gitea.runs(watched.repo, watched.branch)
        const { changes, next } = branchChanges(runs, seen)
        const reported = yield* Effect.forEach(changes, jobsFor(gitea, watched))
        const message = branchMessage(watched, reported, config.owner)
        yield* Effect.forEach(
          reported.length === 0 ? [] : watched.agents,
          (target) =>
            agents.prompt(target, message).pipe(
              Effect.tap(() => Effect.logInfo(`delivered CI updates on ${watched.key} to ${placeOf(target)}`)),
              Effect.catch((error) => Effect.logWarning(error.message))
            ),
          { discard: true }
        )
        yield* repo.saveBranch(watched.key, next)
      })

      const watchBranches = (
        settings: typeof config,
        facts: ReadonlyArray<PullFacts>,
        live: ReadonlyArray<LiveAgent>
      ) => {
        const gitea = forges.gitea
        const host = forges.giteaHost
        if (gitea === null || host === null) return Effect.void

        return repo.branches.pipe(
          Effect.flatMap((seen) =>
            Effect.forEach(
              watchedBranches(settings, host, facts, live),
              (watched) =>
                watchBranch(gitea, watched, seen.get(watched.key)).pipe(
                  Effect.catch((error) => Effect.logWarning(error.message))
                ),
              { concurrency: 2, discard: true }
            )
          ),
          Effect.catch((error) => Effect.logWarning(error.message))
        )
      }

      const forgesFor = (repos: ReadonlyArray<RepoRef>, slug: string) =>
        repos.filter((entry) => entry.slug.toLowerCase() === slug.toLowerCase() && forges[entry.forge] !== null)

      const issuesOf = (forge: Forge, slug: RepoSlug) => {
        const client = forges[forge]
        if (client === null) return Effect.succeed([])

        return client.issues(slug).pipe(
          Effect.tapError((error) => Effect.logWarning(`${error.message}; skipping ${slug}'s issues this time`)),
          Effect.orElseSucceed(() => [])
        )
      }

      const watchIssues = Effect.gen(function* () {
        const claims = yield* repo.issueClaims
        const wanted = [...new Map(claims.map((claim) => [`${claim.forge}:${claim.repo}`, claim])).values()]
        const issues = yield* Effect.forEach(wanted, (claim) => issuesOf(claim.forge, claim.repo), { concurrency: 2 })
        const records = yield* repo.records
        const steps = issuePlan(claims, issues.flat(), records.seen, config.owner)
        const delivered = new Set(
          steps.deliveries.flatMap((delivery) => delivery.items.map((item) => `${delivery.claimId} ${item}`))
        )
        yield* Effect.forEach(
          steps.deliveries,
          (delivery) =>
            agents.prompt(delivery.target, delivery.message).pipe(
              Effect.andThen(repo.rememberIssueItems(delivery.claimId, delivery.items)),
              Effect.tap(() =>
                Effect.logInfo(`delivered ${delivery.items.length} issue updates to ${placeOf(delivery.target)}`)
              ),
              Effect.catch((error) => Effect.logWarning(error.message))
            ),
          { discard: true }
        )
        yield* Effect.forEach(
          steps.remember,
          (entry) =>
            repo.rememberIssueItems(
              entry.claimId,
              entry.items.filter((item) => !delivered.has(`${entry.claimId} ${item}`))
            ),
          { discard: true }
        )
        yield* Effect.forEach(steps.baselined, repo.markBaselined, { discard: true })
      }).pipe(
        Effect.catch((error) => Effect.logWarning(error.message)),
        Effect.withSpan("Desk.watchIssues")
      )

      const budgetNow = forges.github === null ? Effect.succeed(null) : forges.github.budget

      const publish = Effect.fnUntraced(function* (
        settings: typeof config,
        found: Roster,
        failures: ReadonlyArray<Failure> | null
      ) {
        const facts = yield* Ref.get(factsRef)
        const issues = yield* Ref.get(issuesRef)
        const records = yield* repo.records
        const steps = plan({ settings, facts, issues, records, agents: found.agents, refused: found.refused })
        const polledAt = yield* now
        const budget = yield* budgetNow
        yield* SubscriptionRef.update(boardRef, (before) => ({
          ...empty,
          cards: steps.cards,
          ready: steps.ready,
          mentions: steps.mentions,
          routing: steps.routing,
          budget,
          polledAt: failures === null ? before.polledAt : polledAt,
          health: failures === null ? before.health : healthAfter(failures, before.health, polledAt)
        }))
      })

      const rosterRef = yield* Ref.make<Roster>(noRoster)

      const cycle = lock
        .withPermits(1)(
          Effect.gen(function* () {
            yield* discover
            const settings = { ...config, repos: yield* Ref.get(reposRef) }
            const [pulls, found] = yield* Effect.all([fetchAll(fetchRepo), roster], { concurrency: 2 })
            const live = found.agents
            const mentioned = yield* fetchAll(fetchMentions)
            yield* Ref.set(factsRef, pulls.found)
            yield* Ref.set(issuesRef, mentioned.found)
            yield* Ref.set(rosterRef, found)
            const before = yield* repo.records
            yield* execute(
              plan({ settings, facts: pulls.found, records: before, agents: live, refused: found.refused })
            )
            yield* watchBranches(settings, pulls.found, live)
            yield* watchIssues
            yield* releaseGone(found)
            yield* publish(settings, found, [...pulls.failures, ...mentioned.failures])
          })
        )
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("poll failed", cause).pipe(
              Effect.andThen(
                SubscriptionRef.update(boardRef, (before) => ({ ...before, health: crashed(before.health) }))
              )
            )
          ),
          Effect.withSpan("Desk.cycle")
        )

      const watchdog = Effect.gen(function* () {
        const clock = yield* DateTime.now
        const millis = DateTime.toEpochMillis(clock)
        yield* SubscriptionRef.update(boardRef, (before) => ({
          ...before,
          health: overdue(before.health, millis, config.pollSeconds)
        }))
      })

      yield* Effect.forkScoped(Effect.repeat(cycle, Schedule.spaced(Duration.seconds(config.pollSeconds))))
      yield* Effect.forkScoped(Effect.repeat(watchdog, Schedule.spaced(Duration.seconds(30))))

      const refresh = Effect.asVoid(Effect.forkDetach(cycle))

      const known = (key: PrKey) =>
        Ref.get(factsRef).pipe(Effect.map((facts) => facts.find((pull) => pull.key === key)))

      const pullOf = (key: PrKey) => findOrPoll(known(key), cycle, () => new UnknownPull({ key }))

      const reportTriage = Effect.fn("Desk.reportTriage")(function* (report: TriageReport) {
        yield* Effect.annotateCurrentSpan("pull", report.key)
        yield* pullOf(report.key)
        yield* repo
          .saveTriage(report.key, { verdict: report.verdict, reason: report.reason }, report.settled)
          .pipe(Effect.orDie)
        yield* refresh
      })

      const claim = Effect.fn("Desk.claim")(function* (key: PrKey, session: SessionName | null, role: Role) {
        yield* Effect.annotateCurrentSpan("pull", key)
        const pull = yield* pullOf(key)
        const area = areaFor(config, pull)
        const chosen = session ?? (area === undefined ? undefined : areaAgent(area))
        if (chosen === undefined)
          return yield* new DeliveryFailed({
            key,
            reason: Text.make("no area in the config covers this repository; pass --session")
          })
        const brief = { owner: config.owner, limit: config.roundLimit, desk: config.desk }
        const found = yield* roster
        const message = role === "author" ? authorBrief(pull, brief) : routingBrief(pull, brief)
        const targeted = targetFor(chosen, found.agents, found.refused)
        if (targeted._tag === "Refused") return yield* new DeliveryFailed({ key, reason: Text.make(targeted.reason) })
        yield* agents
          .prompt(targeted.target, message)
          .pipe(Effect.mapError((error) => new DeliveryFailed({ key, reason: Text.make(error.message) })))
        yield* repo.claim(key, SessionName.make(chosen), role).pipe(Effect.orDie)
        yield* refresh
      })

      const postIssueComment = Effect.fn("Desk.postIssueComment")(function* (request: CommentRequest) {
        yield* Effect.annotateCurrentSpan("issue", request.key)
        const parts = keyParts(request.key)
        const repos = yield* Ref.get(reposRef)
        const client = forgesFor(repos, parts.repo).some((entry) => entry.forge === parts.forge)
          ? forges[parts.forge]
          : null
        if (client === null) return yield* new UnknownPull({ key: request.key })
        const failed = (error: { readonly message: string }) =>
          new PostFailed({ key: request.key, reason: Text.make(error.message) })
        const url = yield* client
          .commentOnIssue(parts.repo, parts.number, issueStamp(config.owner, request.body))
          .pipe(Effect.mapError(failed))
        yield* request.close === true
          ? client.closeIssue(parts.repo, parts.number).pipe(Effect.mapError(failed))
          : Effect.void

        return { url: Url.make(url) }
      })

      const postComment = (request: CommentRequest) =>
        Effect.flatMap(Ref.get(factsRef), (facts) =>
          facts.some((pull) => pull.key === request.key) ? postPullComment(request) : postIssueComment(request)
        )

      const claimIssues = Effect.fn("Desk.claimIssues")(function* (request: IssueClaimRequest) {
        const repos = yield* Ref.get(reposRef)
        const entries = forgesFor(repos, request.repo)
        if (entries.length === 0)
          return yield* new NotConfigured({ feature: Text.make(`issues for ${request.repo} (add it to repos)`) })
        const target = { machine: request.machine, pane: request.pane }
        yield* Effect.forEach(
          entries,
          (entry) =>
            repo.claimIssues({
              id: claimId(entry.forge, entry.slug, target),
              forge: entry.forge,
              repo: entry.slug,
              from: request.from,
              target
            }),
          { discard: true }
        ).pipe(Effect.orDie)
        yield* refresh

        return { forges: entries.map((entry) => entry.forge) }
      })

      const releaseIssues = Effect.fn("Desk.releaseIssues")(function* (slug: RepoSlug, target: AgentTarget) {
        const repos = yield* Ref.get(reposRef)
        const released = yield* Effect.forEach(forgesFor(repos, slug), (entry) =>
          repo.releaseIssues(claimId(entry.forge, entry.slug, target))
        ).pipe(Effect.orDie)

        return { released: Count.make(released.filter((one) => one).length) }
      })

      const postPullComment = Effect.fn("Desk.postComment")(function* (request: CommentRequest) {
        yield* Effect.annotateCurrentSpan("pull", request.key)
        const pull = yield* pullOf(request.key)
        const records = yield* repo.records.pipe(Effect.orDie)
        const role = roleOf(config, pull, records) ?? "reviewer"
        const side: Side = role === "reviewer" ? "reviewer" : "author"
        const thread = threadWith(pull, request.replyTo)
        const round = roundFor(thread, side)
        const limit = Count.make(config.roundLimit)
        if (side === "reviewer" && round > config.roundLimit)
          return yield* new RoundLimitReached({ key: pull.key, limit })
        if (thread !== undefined && threadState(thread, config.roundLimit)._tag === "AtLimit")
          return yield* new RoundLimitReached({ key: pull.key, limit })
        const client = forges[pull.forge]
        if (client === null)
          return yield* new PostFailed({ key: pull.key, reason: Text.make(`${pull.forge} is not set up`) })
        const body = stamp(
          {
            marker: { side, round: Count.make(round), outcome: request.outcome, desk: Login.make(config.desk) },
            owner: config.owner,
            limit: config.roundLimit
          },
          request.body
        )
        const url = yield* client
          .post(pull, {
            body,
            replyTo: threadReplyTarget(pull, request.replyTo),
            path: request.path ?? thread?.path ?? null,
            line: request.line ?? thread?.line ?? null
          })
          .pipe(Effect.mapError((error) => new PostFailed({ key: pull.key, reason: Text.make(error.message) })))
        yield* refresh

        return { url: Url.make(url) }
      })

      const openInSidediff = Effect.fn("Desk.openInSidediff")(function* (key: PrKey) {
        yield* Effect.annotateCurrentSpan("pull", key)
        const pull = yield* pullOf(key)
        if (config.sidediff === null) return yield* new NotConfigured({ feature: Text.make("sidediff") })
        const checkout = config.sidediff.checkouts[pull.repo]
        if (checkout === undefined)
          return yield* new SidediffFailed({
            key,
            reason: Text.make(`no checkout of ${pull.repo} is listed under sidediff.checkouts`)
          })
        const failed = (error: { readonly message: string }) =>
          new SidediffFailed({ key, reason: Text.make(error.message) })
        yield* shell.run("git", ["-C", checkout, "fetch", "origin", pull.base, pull.head]).pipe(Effect.mapError(failed))
        yield* shell
          .launch("sidediff", ["--open", `origin/${pull.base}...origin/${pull.head}`], checkout)
          .pipe(Effect.mapError(failed))
      })

      const markSeen = Effect.fn("Desk.markSeen")(function* (key: PrKey) {
        yield* Effect.annotateCurrentSpan("pull", key)
        const facts = yield* Ref.get(factsRef)
        const issues = yield* Ref.get(issuesRef)
        if (!isWatched(facts, issues, key)) return yield* new UnknownPull({ key })
        yield* repo.markSeen(key).pipe(Effect.orDie)
        const settings = { ...config, repos: yield* Ref.get(reposRef) }
        const found = yield* Ref.get(rosterRef)
        yield* lock
          .withPermits(1)(publish(settings, found, null))
          .pipe(Effect.orDie)
      })

      const board = Stream.concat(Stream.fromEffect(SubscriptionRef.get(boardRef)), SubscriptionRef.changes(boardRef))

      const listAgents = Effect.map(roster, (found): AgentListing => ({
        agents: found.agents.map((agent) => ({
          name: agent.name,
          machine: agent.machine,
          host: agent.host,
          pane: agent.pane,
          cwd: agent.cwd,
          status: agent.status
        })),
        reached: found.reached
      }))

      const readAgent = Effect.fn("Desk.readAgent")(function* (agent: string, lines: number) {
        const found = yield* roster
        const targeted = targetFor(agent, found.agents, found.refused)
        if (targeted._tag === "Refused")
          return yield* new AgentUnreadable({ agent: Text.make(agent), reason: Text.make(targeted.reason) })
        const text = yield* agents
          .read(targeted.target, lines)
          .pipe(
            Effect.mapError(
              (error) => new AgentUnreadable({ agent: Text.make(agent), reason: Text.make(error.reason) })
            )
          )

        return { text }
      })

      return Desk.of({
        board,
        summary: board.pipe(Stream.map(summaryOf), Stream.changesWith(sameSummary)),
        refresh,
        reportTriage,
        claim,
        postComment,
        openInSidediff,
        claimIssues,
        releaseIssues,
        markSeen,
        listAgents,
        readAgent
      })
    })
  )
}
