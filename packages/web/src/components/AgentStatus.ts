import type { Agent } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { colors } from "@seethruhead/sth-ui/core/theme/tokens.stylex.ts"
import { ui } from "../theme/ui.ts"

type Status = {
  readonly label: string
  readonly text: string
  readonly color: string
  readonly processing: boolean
}

const describe = (agent: Agent | null): Status => {
  if (agent === null)
    return { label: "No agent yet", text: "No agent yet", color: colors.defaultBorder, processing: false }
  if (agent.working)
    return {
      label: `${agent.session} session is working`,
      text: `${agent.session} is working`,
      color: "green",
      processing: true
    }

  return {
    label: `${agent.session} session is idle`,
    text: `${agent.session} is idle`,
    color: colors.placeholder,
    processing: false
  }
}

export const AgentStatus = <M>(h: HtmlBuilder<M>, props: { readonly agent: Agent | null }): Html => {
  const status = describe(props.agent)

  return ui.Indicator(h, {
    inline: true,
    position: "middle-start",
    size: 8,
    color: status.color,
    processing: status.processing,
    attributes: { root: { role: "status", "aria-label": status.label } },
    children: [ui.Text(h, { size: "sm", c: "dimmed", pl: "md", children: [status.text] })]
  })
}
