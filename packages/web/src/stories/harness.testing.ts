import { Predicate, Schema } from "effect"
import { Runtime } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { appTheme } from "../theme/theme.ts"
import { ui } from "../theme/ui.ts"

const Model = Schema.Struct({ events: Schema.Array(Schema.String) })
type Model = typeof Model.Type

export const StoryMessage = defineMessageUnion({ Logged: { event: Schema.String } })
export type StoryMessage = typeof StoryMessage.Type

export const logged = (event: string): StoryMessage => StoryMessage.Logged({ event })

export type Globals = { readonly globals: { readonly [name: string]: unknown } }

const replaced = "review-desk-story-replaced"

const schemeOf = (globals: Globals["globals"]): "light" | "dark" => (globals["scheme"] === "dark" ? "dark" : "light")

const stage = { padding: "16px" }

export const mount = (container: HTMLElement, start: () => { readonly dispose: () => void }): HTMLElement => {
  document.dispatchEvent(new Event(replaced))
  queueMicrotask(() => {
    const handle = start()
    document.addEventListener(replaced, handle.dispose, { once: true })
  })

  return container
}

export const story =
  (view: (h: HtmlBuilder<StoryMessage>) => Html, options: { readonly padded?: boolean } = {}) =>
  (_args: unknown, context: Globals): HTMLElement => {
    const container = document.createElement("div")
    container.setAttribute("id", "review-desk-story")

    return mount(container, () =>
      Runtime.embed(
        Runtime.makeElement({
          Model,
          init: () => ({ model: { events: [] } }),
          update: (model: Model, message: StoryMessage) => ({ model: { events: [...model.events, message.event] } }),
          view: (model: Model, h: HtmlBuilder<StoryMessage>) =>
            ui.ThemeProvider(h, {
              ...appTheme,
              colorScheme: schemeOf(context.globals),
              children: [
                h.div([h.Style(options.padded === false ? {} : stage)], [view(h)]),
                h.output(
                  [h.Role("log"), h.AriaLabel("Events"), h.Style({ display: "block", padding: "0 16px" })],
                  [model.events.join(", ")]
                )
              ]
            }),
          container
        })
      )
    )
  }

export const present = <A>(value: A | null | undefined): A => {
  if (Predicate.isNullish(value)) throw new Error("expected the element to be on the page")

  return value
}
