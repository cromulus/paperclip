import { Component, Suspense, lazy, type ReactNode } from "react";
import type { TaskChatProtocolCardProps } from "./TaskChatProtocolCard";

const LazyTaskChatProtocolCard = lazy(() =>
  import("./TaskChatProtocolCard").then((module) => ({ default: module.TaskChatProtocolCard })),
);

class TaskChatProtocolCardErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">This interaction could not be loaded.</div>;
    }
    return this.props.children;
  }
}

/** Loads the protocol renderer only when a transcript row needs it. */
export function DeferredTaskChatProtocolCard(props: TaskChatProtocolCardProps) {
  return (
    <TaskChatProtocolCardErrorBoundary key={props.item.id}>
      <Suspense fallback={<div role="status" aria-busy="true" className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">Loading interaction…</div>}>
        <LazyTaskChatProtocolCard {...props} />
      </Suspense>
    </TaskChatProtocolCardErrorBoundary>
  );
}
