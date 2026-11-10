import { describe, expect, it } from "@effect/vitest"
import { Count, Login } from "@review-desk/contract/Ids.ts"
import { Option } from "effect"
import { Marker, excerpt, issueStamp, markerOf, plainText, settledOutcome, stamp } from "./Protocol.ts"

describe("the desk-to-desk comment protocol", () => {
  it.prop("a stamped comment always reads back the marker it was stamped with", [Marker], ([marker]) => {
    const body = stamp({ marker, owner: "Dana", limit: 3 }, "Retry swallows the 401")
    expect(markerOf(body)).toEqual(Option.some(marker))
  })

  it("labels a reviewer's comment as an agent review and an author's as an agent reply, with the round", () => {
    const reviewer = stamp(
      {
        marker: { side: "reviewer", round: Count.make(2), outcome: "open", desk: Login.make("dana") },
        owner: "Dana",
        limit: 3
      },
      "Fix this"
    )
    const author = stamp(
      {
        marker: { side: "author", round: Count.make(1), outcome: "fixed", desk: Login.make("lee") },
        owner: "Lee",
        limit: 3
      },
      "Done"
    )

    expect(reviewer.split("\n").slice(0, 3)).toEqual([
      "> [!NOTE]",
      "> AI agent review, not yet read by Dana",
      "> Review Desk, round 2 of 3"
    ])
    expect(author).toContain("> AI agent reply, not yet read by Lee")
  })

  it("treats a comment with no marker, or a malformed one, as written by a person", () => {
    expect(markerOf("Looks good to me")).toEqual(Option.none())
    expect(markerOf("<!-- review-desk v1 side=robot round=1 outcome=open desk=x -->")).toEqual(Option.none())
  })

  it("strips the note box and marker when showing a comment's text", () => {
    const body = stamp(
      {
        marker: { side: "reviewer", round: Count.make(1), outcome: "open", desk: Login.make("dana") },
        owner: "Dana",
        limit: 3
      },
      "Missing await\non the refresh"
    )
    expect(plainText(body)).toBe("Missing await on the refresh")
    expect(excerpt("a".repeat(200), 10)).toBe(`${"a".repeat(10)}…`)
    expect(settledOutcome("open")).toEqual(Option.none())
    expect(settledOutcome("dropped")).toEqual(Option.some("dropped"))
  })

  it("labels an agent's reply on an issue without a round", () => {
    expect(issueStamp("Dana", "  Fixed in abc123  ")).toBe(
      "> [!NOTE]\n> AI agent reply, not yet read by Dana\n> Review Desk, on an issue\n\nFixed in abc123"
    )
  })
})
