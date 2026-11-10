import type { Relation, RelationKind } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"
import { Nothing } from "./Nothing.ts"

const kindText: { readonly [K in RelationKind]: string } = {
  "stacked-on": "Stacked on",
  "conflicts-with": "Conflicts with",
  "depends-on": "Merge after"
}

const kindColor: { readonly [K in RelationKind]: string } = {
  "stacked-on": "violet",
  "conflicts-with": "red",
  "depends-on": "gray"
}

export const RelationList = <M>(h: HtmlBuilder<M>, props: { readonly relations: ReadonlyArray<Relation> }): Html =>
  props.relations.length === 0
    ? Nothing(h)
    : ui.Group(h, {
        gap: 6,
        attributes: { root: { role: "list", "aria-label": "Related pull requests" } },
        children: props.relations.map((relation) =>
          ui.Badge(h, {
            size: "sm",
            variant: "outline",
            color: kindColor[relation.kind],
            attributes: { root: { role: "listitem" } },
            children: [`${kindText[relation.kind]} ${relation.label}`]
          })
        )
      })
