import { Runtime } from "foldkit"
import { DeskClient } from "./pages/board/client.ts"
import { connecting, Model } from "./pages/board/model.ts"
import { subscriptions } from "./pages/board/subscriptions.ts"
import { update } from "./pages/board/update.ts"
import { view } from "./pages/board/view.ts"

const container = document.getElementById("root")

if (container !== null)
  Runtime.embed(
    Runtime.makeElement({
      Model,
      init: () => ({ model: connecting }),
      update,
      subscriptions,
      view,
      resources: DeskClient.layer,
      container
    })
  )
