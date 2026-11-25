// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorAutocompleteProvider, useEditorAutocomplete } from "./EditorAutocompleteContext";

const queryState = vi.hoisted(() => ({ calls: [] as Array<{ enabled?: boolean }> }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { enabled?: boolean }) => {
    queryState.calls.push(options);
    return { data: [] };
  },
}));

vi.mock("./CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

function Harness() {
  const { ensureSlashCommandsLoaded } = useEditorAutocomplete();
  return <button onFocus={ensureSlashCommandsLoaded}>Editor</button>;
}

describe("EditorAutocompleteProvider", () => {
  afterEach(() => {
    queryState.calls = [];
  });

  it("loads skill and routine mentions only when the editor receives focus", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(
        <EditorAutocompleteProvider>
          <Harness />
        </EditorAutocompleteProvider>,
      ));

      expect(queryState.calls.slice(-2).map((query) => query.enabled)).toEqual([false, false]);
      await act(async () => {
        container.querySelector("button")?.focus();
      });
      expect(queryState.calls.slice(-2).map((query) => query.enabled)).toEqual([true, true]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
