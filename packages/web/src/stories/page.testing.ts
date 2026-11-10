import { Layer } from "effect"
import { Runtime } from "foldkit"
import { DeskClient } from "../pages/board/client.ts"
import { connecting, Model } from "../pages/board/model.ts"
import { subscriptions } from "../pages/board/subscriptions.ts"
import { update } from "../pages/board/update.ts"
import { view } from "../pages/board/view.ts"
import { mount } from "./harness.testing.ts"

export const renderPage =
  (desk: DeskClient["Service"], start: Partial<Model> = {}) =>
  (): HTMLElement => {
    const container = document.createElement("div")
    container.setAttribute("id", "review-desk-page")

    return mount(container, () =>
      Runtime.embed(
        Runtime.makeElement({
          Model,
          init: () => ({ model: { ...connecting, ...start } }),
          update,
          subscriptions,
          view,
          resources: Layer.succeed(DeskClient, DeskClient.of(desk)),
          container
        })
      )
    )
  }
