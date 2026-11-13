import { DeskRpcs } from "@review-desk/contract/Contract.ts"
import { Effect } from "effect"
import { Desk } from "../desk/Desk.ts"

export const Handlers = DeskRpcs.toLayer(
  Effect.gen(function* () {
    const desk = yield* Desk

    return DeskRpcs.of({
      WatchBoard: () => desk.board,
      WatchSummary: () => desk.summary,
      OpenInSidediff: ({ key }) => desk.openInSidediff(key),
      ReportTriage: (report) => desk.reportTriage(report),
      PostComment: (request) => desk.postComment(request),
      Claim: ({ key, session, role }) => desk.claim(key, session, role ?? "reviewer"),
      ClaimIssues: (request) => desk.claimIssues(request),
      ReleaseIssues: ({ repo, machine, pane }) => desk.releaseIssues(repo, { machine, pane }),
      MarkSeen: ({ key }) => desk.markSeen(key),
      ListAgents: () => desk.listAgents,
      ReadAgent: ({ agent, lines }) => desk.readAgent(agent, lines)
    })
  })
)
