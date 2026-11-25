// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskChatMessageItem, TaskChatRuntimeRequestItem } from "./task-chat-model";
import { TaskChatThreadView } from "./TaskChatThreadView";

const moduleGate = vi.hoisted(() => {
  let resolveModule!: (value: unknown) => void;
  const promise = new Promise<unknown>((resolve) => { resolveModule = resolve; });
  return { promise, resolveModule: (value: unknown) => resolveModule(value) };
});
const renderState = vi.hoisted(() => ({ failProtocolCard: false }));

vi.mock("./TaskChatProtocolCard", () => moduleGate.promise);
vi.mock("./TaskChatBubble", () => ({
  TaskChatAgentIdentity: () => null,
  TaskChatBubble: ({ item }: { item: TaskChatMessageItem }) => <p data-testid="ordinary-message">{item.text}</p>,
}));

let container: HTMLDivElement;
let root: Root;

const message: TaskChatMessageItem = { id: "comment-1", kind: "message", author: "agent", text: "Ordinary conversation text" };
const request: TaskChatRuntimeRequestItem = {
  id: "request-1", kind: "protocol", surface: "runtime_request", runId: "run-1", requestId: "request-1",
  requestKind: "user_input", turnId: null, requestType: "input", status: "pending", prompt: "Choose an option",
  choices: [{ key: "yes", label: "Yes" }], fields: [],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  renderState.failProtocolCard = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("TaskChatThreadView deferred protocol card", () => {
  it("keeps ordinary messages visible while loading, preserves request callbacks, and isolates card failures", async () => {
    const onDecision = vi.fn();
    const items = [message, request];
    await act(async () => {
      root.render(<TaskChatThreadView items={items} scroll={false} onRuntimeRequestDecision={onDecision} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Ordinary conversation text");
    expect(container.textContent).toContain("Loading interaction…");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    function ProtocolCard({ item, onRuntimeRequestDecision }: {
      item: TaskChatRuntimeRequestItem;
      onRuntimeRequestDecision?: (item: TaskChatRuntimeRequestItem, decision: { action: "accept" }) => void | Promise<void>;
    }) {
      if (renderState.failProtocolCard) throw new Error("protocol renderer failed");
      return <button type="button" onClick={() => onRuntimeRequestDecision?.(item, { action: "accept" })}>{item.prompt}</button>;
    }
    await act(async () => {
      moduleGate.resolveModule({ TaskChatProtocolCard: ProtocolCard });
      await Promise.resolve();
    });

    const button = container.querySelector<HTMLButtonElement>('button')!;
    expect(button.textContent).toBe("Choose an option");
    await act(async () => button.click());
    expect(onDecision).toHaveBeenCalledWith(request, { action: "accept" });

    renderState.failProtocolCard = true;
    await act(async () => {
      root.render(<TaskChatThreadView items={[message, { ...request }]} scroll={false} onRuntimeRequestDecision={onDecision} />);
    });
    expect(container.textContent).toContain("Ordinary conversation text");
    expect(container.textContent).toContain("This interaction could not be loaded.");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
