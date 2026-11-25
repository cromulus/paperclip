import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createUiDevWatchOptions } from "./src/lib/vite-watch";
import { createApiProxy } from "./src/lib/vite-api-proxy";
import { serviceWorkerBuildIdPlugin } from "./src/lib/vite-sw-build-id";
import { readBrowserBuildCommit } from "./src/lib/vite-build-commit";

const apiProxy = createApiProxy();

export default defineConfig(({ mode }) => ({
  define: {
    __PAPERCLIP_BUILD_COMMIT__: JSON.stringify(
      readBrowserBuildCommit(__dirname),
    ),
  },
  plugins: [react(), tailwindcss(), serviceWorkerBuildIdPlugin()],
  build: {
    minify: "esbuild",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "board-startup", tags: ["$initial"], priority: 10 },
            { name: "chat-draft-state", test: /\/lib\/composer-draft\.ts$/, priority: 11 },
            // Message and plugin Markdown is shared by chat, issue detail, and
            // other surfaces. Keep it out of the task-detail workbench chunk
            // so a chat page never needs to download the full issue UI.
            { name: "markdown-renderer", test: /\/components\/MarkdownBody\.tsx$/, priority: 8 },
            // The task-chat renderer is shared by agent chat and issue detail.
            // Split it so opening a chat does not fetch the full workbench.
            {
              name: "task-chat",
              test: /\/components\/task-chat\/(?:TaskChatThreadView|DeferredTaskChatProtocolCard|TaskChatBubble|TaskChatTurn|TaskChatMarker|TaskChatStatusPill|TaskChatToolCard|TaskChatUsageReadout|TaskChatRunnerActivityGroup|TaskChatActivityPhase|TaskChatThinking|TaskMessageScroller|TaskChatProtocolActivityRow|TaskChatPlanPreviewCard|TaskChatProjectCreatedCard|TaskChatSkillCreatedCard)\.tsx$|\/components\/task-chat\/(?:task-chat-adapter|task-chat-model|task-protocol-surfaces)\.ts$|\/lib\/composer-draft\.ts$/,
              priority: 7,
            },
            // Chat views consume transcript hooks also used by task detail.
            // Keep those small shared runtime pieces out of the detail chunk.
            { name: "chat-transcripts", test: /\/components\/transcript\/(?:useLiveRunTranscripts|useNativeRunTranscripts|native-run-events|read-transcript-request)\.ts$/, priority: 7 },
            // The list implementation is also used by plugin SDK views. Its
            // dependency graph should load only for those views or task pages.
            { name: "issue-lists", test: /\/components\/(?:IssuesList|LegacyIssuesList)\.tsx$/, priority: 6 },
            { name: "issue-detail", test: /\/src\/pages\/IssueDetail\.tsx$/, priority: 5 },
          ],
        },
      },
    },
  },
  esbuild:
    mode === "production"
      ? {
          // React's component trace uses function names. Keep those useful in
          // error reports without publishing source maps or page context.
          keepNames: true,
          drop: ["console", "debugger"],
          legalComments: "none",
        }
      : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  server: {
    port: 5173,
    watch: createUiDevWatchOptions(process.cwd()),
    proxy: apiProxy,
  },
  preview: {
    port: 3101,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy,
  },
}));
