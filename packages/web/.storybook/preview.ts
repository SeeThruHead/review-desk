import type { Preview } from "@storybook/html-vite"

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        wide: { name: "Desktop (1440)", styles: { width: "1440px", height: "900px" } },
        phone: { name: "Phone (390)", styles: { width: "390px", height: "844px" } }
      }
    }
  },
  globalTypes: {
    scheme: {
      description: "Colour scheme",
      toolbar: { title: "Scheme", icon: "mirror", items: ["light", "dark"], dynamicTitle: true }
    }
  },
  initialGlobals: { scheme: "light" }
}

export default preview
