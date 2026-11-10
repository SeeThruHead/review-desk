import type { StorybookConfig } from "@storybook/html-vite"

const config: StorybookConfig = {
  framework: "@storybook/html-vite",
  stories: ["../src/**/*.stories.ts"],
  addons: [],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  features: { sidebarOnboardingChecklist: false, menuOnboardingChecklist: false },
  viteFinal: (vite) => ({
    ...vite,
    optimizeDeps: {
      ...vite.optimizeDeps,
      include: [
        ...(vite.optimizeDeps?.include ?? []),
        "effect",
        "foldkit",
        "foldkit/html",
        "foldkit/runtime",
        "foldkit/message",
        "foldkit/command",
        "foldkit/mount",
        "foldkit/schema",
        "foldkit/subscription",
        "@foldkit/ui/anchor",
        "@foldkit/ui/animation",
        "storybook/test"
      ]
    }
  })
}

export default config
