import type { ReactNode } from "react";
import type { LiveRunForIssue } from "../api/heartbeats";
import type { TranscriptEntry } from "../adapters";
import { useLiveRunTranscripts } from "./transcript/useLiveRunTranscripts";

export interface ActiveAgentsTranscriptState {
  transcriptByRun: Map<string, TranscriptEntry[]>;
  hasOutputForRun: (runId: string) => boolean;
}

export function ActiveAgentsTranscriptProvider({
  companyId,
  runs,
  maxChunksPerRun,
  logPollIntervalMs,
  logReadLimitBytes,
  enableRealtimeUpdates,
  children,
}: {
  companyId: string;
  runs: LiveRunForIssue[];
  maxChunksPerRun: number;
  logPollIntervalMs: number;
  logReadLimitBytes: number;
  enableRealtimeUpdates: boolean;
  children: (state: ActiveAgentsTranscriptState) => ReactNode;
}) {
  const transcriptState = useLiveRunTranscripts({
    runs,
    companyId,
    maxChunksPerRun,
    logPollIntervalMs,
    logReadLimitBytes,
    enableRealtimeUpdates,
  });

  return children(transcriptState);
}
