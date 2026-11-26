import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUp, LoaderCircle, Paperclip } from "lucide-react";
import type { Agent, Issue, IssueComment } from "@paperclipai/shared";
import type { LiveEvent } from "@paperclipai/shared";
import { AgentAvatar } from "@/components/AgentAvatar";
import { TaskChatThreadView } from "@/components/task-chat/TaskChatThreadView";
import { commentsToTaskChatItems } from "@/components/task-chat/task-chat-adapter";
import { transcriptToTaskChatItems } from "@/components/task-chat/transcript-adapter";
import type { TaskChatItem } from "@/components/task-chat/task-chat-model";
import { useLiveRunTranscripts } from "@/components/transcript/useLiveRunTranscripts";
import { useNativeRunTranscripts } from "@/components/transcript/useNativeRunTranscripts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/api/client";
import { agentChatsApi, type AgentChatBootstrap } from "@/api/agentChats";
import { issuesApi } from "@/api/issues";
import { clearDraftSubmission, loadDraft, loadDraftSubmission, saveDraft, saveDraftSubmission, settleDraftSubmission } from "@/lib/composer-draft";
import { createIssueDetailPath } from "@/lib/issueDetailBreadcrumb";
import { Link, useNavigate } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { useCompanyLiveEvent } from "@/context/LiveUpdatesProvider";

interface AgentChatFastPathProps {
  bootstrap: AgentChatBootstrap;
  companyId: string;
  userId: string;
  queryKey: readonly unknown[];
  isFetching: boolean;
  refetchBootstrap: () => Promise<unknown>;
}

export function shouldRefreshAgentChatForLiveEvent(event: LiveEvent, chatId: string | null): boolean {
  if (!chatId) return false;
  const payload = event.payload;
  if (event.type === "activity.logged") {
    return payload.entityType === "issue" && payload.entityId === chatId && (
      payload.action === "issue.comment_added" ||
      payload.action === "issue.conversation_session_started" ||
      payload.action === "issue.updated" ||
      payload.action === "issue.tree_hold_created" ||
      payload.action === "issue.tree_hold_released"
    );
  }
  return (
    event.type === "heartbeat.run.queued" || event.type === "heartbeat.run.status"
  ) && payload.issueId === chatId;
}

export function AgentChatFastPath({ bootstrap, companyId, userId, queryKey, isFetching, refetchBootstrap }: AgentChatFastPathProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const agent = bootstrap.agent;
  const chat = bootstrap.chat;
  const draftKey = "paperclip:agent-chat-draft:" + companyId + ":" + userId + ":" + agent.id;
  const [body, setBody] = useState(() => loadDraft(draftKey));
  const bodyRef = useRef(body);
  const [submitting, setSubmitting] = useState(false);
  const [olderPages, setOlderPages] = useState<IssueComment[][]>([]);
  const [olderCursor, setOlderCursor] = useState(bootstrap.page.olderCursor);
  const [canLoadOlder, setCanLoadOlder] = useState(bootstrap.page.hasOlder);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const [draftAttempt, setDraftAttempt] = useState(() => loadDraftSubmission(draftKey));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [optimisticComment, setOptimisticComment] = useState<IssueComment | null>(null);
  const submitLock = useRef(false);
  const ensureChatPromise = useRef<Promise<Issue> | null>(null);
  const openingDetailsLock = useRef(false);
  const [openingDetails, setOpeningDetails] = useState(false);

  useCompanyLiveEvent(useCallback((event) => {
    if (!shouldRefreshAgentChatForLiveEvent(event, chat?.id ?? null)) return;
    void queryClient.invalidateQueries({ queryKey });
  }, [chat?.id, queryClient, queryKey]));

  const activeRun = bootstrap.activeRun;
  const legacyRuns = useMemo(() => activeRun && activeRun.runtimeMode !== "native" ? [{
    id: activeRun.id,
    status: activeRun.status,
    adapterType: activeRun.adapterType,
    runtimeMode: activeRun.runtimeMode as "legacy" | "native",
    logBytes: activeRun.logBytes,
    lastOutputBytes: activeRun.lastOutputBytes,
  }] : [], [activeRun]);
  const nativeRuns = useMemo(() => activeRun?.runtimeMode === "native" ? [{
    id: activeRun.id,
    status: activeRun.status,
    runtimeMode: activeRun.runtimeMode as "legacy" | "native",
  }] : [], [activeRun]);
  const { transcriptByRun: legacyTranscriptByRun } = useLiveRunTranscripts({ companyId, runs: legacyRuns });
  const { transcriptByRun: nativeTranscriptByRun } = useNativeRunTranscripts(nativeRuns);

  const orderedComments = useMemo(() => {
    const rows = [...olderPages].reverse().flatMap(page => page)
      .concat([...bootstrap.messages].reverse());
    const byId = new Map(rows.map(comment => [comment.id, comment]));
    if (optimisticComment) byId.set(optimisticComment.id, optimisticComment);
    return [...byId.values()].sort((left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() || left.id.localeCompare(right.id));
  }, [bootstrap.messages, olderPages, optimisticComment]);
  const agentMap = useMemo(() => new Map([[agent.id, {
    id: agent.id, name: agent.name, icon: agent.icon, status: agent.status, adapterType: agent.adapterType,
  } as Agent]]), [agent]);
  const messageItems = useMemo(() => commentsToTaskChatItems(orderedComments, {
    agentMap,
    currentUserId: userId,
  }), [orderedComments, agentMap, userId]);
  const activeItems = useMemo(() => {
    if (!activeRun) return [];
    const entries = activeRun.runtimeMode === "native"
      ? nativeTranscriptByRun.get(activeRun.id) ?? []
      : legacyTranscriptByRun.get(activeRun.id) ?? [];
    const parsed = transcriptToTaskChatItems(entries, {
      runId: activeRun.id,
      agentName: activeRun.agentName || agent.name,
      running: activeRun.status === "running",
    });
    return [
      ...parsed,
      {
        id: activeRun.id + ":fast-status",
        kind: "status" as const,
        status: activeRun.status === "queued" ? "working" as const : "running" as const,
        label: activeRun.status === "queued" ? agent.name + " is queued" : agent.name + " is working",
        selfTalk: activeRun.currentStatusMessage ?? undefined,
        toolName: activeRun.currentToolName ?? undefined,
        startedAtMs: activeRun.startedAt ? new Date(activeRun.startedAt).getTime() : undefined,
      },
    ];
  }, [activeRun, agent.name, legacyTranscriptByRun, nativeTranscriptByRun]);
  const interactionItems: TaskChatItem[] = bootstrap.pendingInteractions.map(interaction => ({
    id: interaction.id,
    kind: "interaction",
    interaction,
  }));
  const items = useMemo(() => [...messageItems, ...interactionItems, ...activeItems], [messageItems, activeItems, interactionItems]);

  const updateBootstrapMessages = useCallback((comment: IssueComment, ensuredIssue?: Issue) => {
    queryClient.setQueryData<AgentChatBootstrap>(queryKey, previous => previous ? {
      ...previous,
      chat: previous.chat ?? (ensuredIssue ? {
        id: ensuredIssue.id,
        identifier: ensuredIssue.identifier ?? null,
        title: ensuredIssue.title,
        status: ensuredIssue.status,
        conversationState: ensuredIssue.conversationState ?? null,
        conversationSessionGeneration: ensuredIssue.conversationSessionGeneration ?? null,
        executionRunId: ensuredIssue.executionRunId ?? null,
        updatedAt: ensuredIssue.updatedAt,
      } : null),
      messages: [comment, ...previous.messages.filter(row => row.id !== comment.id)]
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, previous.page.limit),
      page: { ...previous.page, latestCommentId: comment.id, latestCommentAt: comment.createdAt },
    } : previous);
  }, [queryClient, queryKey]);

  const submit = useCallback(async () => {
    const draftAtSubmit = bodyRef.current;
    const submittedBody = (draftAttempt ? loadDraft(draftKey) : draftAtSubmit).trim();
    if (submitLock.current) return;
    if (!submittedBody) return;
    const attemptId = draftAttempt?.attemptId ?? crypto.randomUUID();
    submitLock.current = true;
    setSubmitting(true);
    setSubmitError(null);
    let attemptCreated = false;
    try {
      const freshGuard = await agentChatsApi.bootstrap(companyId, agent.id);
      queryClient.setQueryData(queryKey, freshGuard);
      const isReset = submittedBody === "/new" && freshGuard.sendGuard.resetAllowed;
      if ((!freshGuard.sendGuard.enabled && !isReset) || freshGuard.sendGuard.pendingInteractionCount > 0) {
        setSubmitError(freshGuard.sendGuard.pendingInteractionCount > 0
          ? "Respond to the open request in Details before sending another message."
          : freshGuard.sendGuard.disabledReason ?? "This conversation is temporarily unable to accept a message.");
        return;
      }
      const pendingAttempt = { attemptId, reviewed: false };
      saveDraftSubmission(draftKey, pendingAttempt);
      setDraftAttempt(pendingAttempt);
      attemptCreated = true;
      const optimistic: IssueComment = {
        id: attemptId,
        clientRequestId: attemptId,
        companyId,
        issueId: chat?.id ?? "pending-" + agent.id,
        authorType: "user",
        authorAgentId: null,
        authorUserId: userId,
        body: submittedBody,
        presentation: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setOptimisticComment(optimistic);
      let issueId = chat?.id;
      let ensuredIssue: Issue | undefined;
      if (!issueId) {
        const promise = ensureChatPromise.current ??= agentChatsApi.ensure(companyId, agent.id);
        try {
          ensuredIssue = await promise;
          issueId = ensuredIssue.id;
        } finally {
          ensureChatPromise.current = null;
        }
      }
      const accepted = await issuesApi.addComment(issueId, submittedBody, undefined, undefined, undefined, attemptId);
      const nextDraft = bodyRef.current === draftAtSubmit ? "" : bodyRef.current;
      settleDraftSubmission(draftKey, attemptId, nextDraft);
      setDraftAttempt(null);
      bodyRef.current = nextDraft;
      setBody(nextDraft);
      setOptimisticComment(null);
      updateBootstrapMessages(accepted, ensuredIssue);
      setSubmitError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentChats.list(companyId, userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId) });
      void refetchBootstrap();
    } catch (error) {
      if (attemptCreated && error instanceof ApiError && error.status < 500) {
        clearDraftSubmission(draftKey, attemptId);
        setDraftAttempt(null);
        setOptimisticComment(null);
        setSubmitError(error.message || "The message was not accepted. Try again.");
      } else {
        setSubmitError(attemptCreated
          ? "We couldn’t confirm whether this message was sent. Check or retry it with the same request ID."
          : error instanceof Error ? error.message : "Couldn’t verify that this conversation can accept a message. Try again.");
      }
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }, [agent.id, body, chat?.id, companyId, draftAttempt, draftKey, queryClient, queryKey, refetchBootstrap, updateBootstrapMessages, userId]);

  const checkOrRetry = useCallback(async () => {
    const attemptId = draftAttempt?.attemptId;
    if (!attemptId || submitLock.current) return;
    const submittedBody = loadDraft(draftKey).trim();
    if (!submittedBody) return;
    const refreshed = await agentChatsApi.bootstrap(companyId, agent.id);
    const accepted = refreshed.messages.find(comment => comment.clientRequestId === attemptId);
    if (accepted) {
      settleDraftSubmission(draftKey, attemptId, "");
      setDraftAttempt(null);
      bodyRef.current = "";
      setBody("");
      setOptimisticComment(null);
      updateBootstrapMessages(accepted);
      return;
    }
    bodyRef.current = submittedBody;
    setBody(submittedBody);
    await submit();
  }, [agent.id, companyId, draftAttempt?.attemptId, draftKey, submit, updateBootstrapMessages]);

  const openAttachmentsAndTools = useCallback(async () => {
    if (chat) {
      navigate(createIssueDetailPath(chat.id));
      return;
    }
    if (openingDetailsLock.current || submitLock.current) return;
    openingDetailsLock.current = true;
    setOpeningDetails(true);
    setSubmitError(null);
    const ensurePromise = ensureChatPromise.current ??= agentChatsApi.ensure(companyId, agent.id);
    try {
      const ensuredIssue = await ensurePromise;
      queryClient.setQueryData<AgentChatBootstrap>(queryKey, previous => previous ? {
        ...previous,
        chat: {
          id: ensuredIssue.id,
          identifier: ensuredIssue.identifier ?? null,
          title: ensuredIssue.title,
          status: ensuredIssue.status,
          conversationState: ensuredIssue.conversationState ?? null,
          conversationSessionGeneration: ensuredIssue.conversationSessionGeneration ?? null,
          executionRunId: ensuredIssue.executionRunId ?? null,
          updatedAt: ensuredIssue.updatedAt,
        },
      } : previous);
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentChats.list(companyId, userId) });
      navigate(createIssueDetailPath(ensuredIssue.id));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Couldn’t open conversation details. Try again.");
    } finally {
      if (ensureChatPromise.current === ensurePromise) ensureChatPromise.current = null;
      openingDetailsLock.current = false;
      setOpeningDetails(false);
    }
  }, [agent.id, chat, companyId, navigate, queryClient, queryKey, userId]);

  const loadEarlier = useCallback(async () => {
    if (!olderCursor || olderLoading) return;
    setOlderLoading(true);
    setOlderError(null);
    try {
      const page = await agentChatsApi.bootstrap(companyId, agent.id, { limit: bootstrap.page.limit, before: olderCursor });
      setOlderPages(previous => [...previous, page.messages]);
      setCanLoadOlder(page.page.hasOlder);
      setOlderCursor(page.page.hasOlder ? page.page.olderCursor : null);
    } catch (error) {
      setOlderError(error instanceof Error ? error.message : "Couldn’t load earlier messages.");
    } finally {
      setOlderLoading(false);
    }
  }, [agent.id, bootstrap.page.limit, companyId, olderCursor, olderLoading]);

  const threadHeader = (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <AgentAvatar agent={agent} size={32} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold" data-testid="agent-chat-title">{agent.name}</h1>
        <p className="truncate text-xs text-muted-foreground">{activeRun ? "Working on your message" : agent.title ?? "Conversation"}</p>
      </div>
      {chat ? <Button asChild size="sm" variant="outline"><Link to={createIssueDetailPath(chat.id)}>Details</Link></Button> : null}
    </div>
  );
  const historyControl = canLoadOlder && olderCursor ? (
    <div className="flex flex-col items-center gap-1">
      {olderError ? <p role="alert" className="text-xs text-destructive">{olderError}</p> : null}
      <Button type="button" size="sm" variant="outline" disabled={olderLoading} onClick={() => void loadEarlier()}>
        {olderLoading ? <><LoaderCircle className="size-4 animate-spin" /> Loading earlier messages…</> : olderError ? "Try loading earlier messages again" : "Load earlier messages"}
      </Button>
    </div>
  ) : null;
  const canReset = body.trim() === "/new" && bootstrap.sendGuard.resetAllowed;
  const canSend = (bootstrap.sendGuard.enabled || canReset) && bootstrap.sendGuard.pendingInteractionCount === 0 && !draftAttempt;
  const statusMessage = bootstrap.sendGuard.pendingInteractionCount > 0
    ? "Respond to the open request in Details before sending another message."
    : !bootstrap.sendGuard.enabled && !canReset
      ? bootstrap.sendGuard.disabledReason ?? "This conversation is temporarily unable to accept a message."
      : isFetching ? "Refreshing conversation status…"
      : null;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-(--tc-shell-max-w) flex-col gap-3 px-4 py-3" data-testid="agent-chat-fast-path">
      {threadHeader}
      {bootstrap.sendGuard.pendingInteractionCount > 0 ? (
        <section className="rounded-lg border border-input bg-card p-3" aria-label="Requests waiting for your response">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{bootstrap.sendGuard.pendingInteractionCount} request{bootstrap.sendGuard.pendingInteractionCount === 1 ? "" : "s"} need your response</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {bootstrap.pendingInteractions.map(interaction => <li key={interaction.id}>{interaction.title ?? interaction.summary ?? "A request from the agent"}</li>)}
                {bootstrap.pendingInteractionsTruncated ? <li>More requests are available in task details.</li> : null}
              </ul>
              {chat ? <Button asChild className="mt-3" size="sm" variant="outline"><Link to={createIssueDetailPath(chat.id)}>Review requests</Link></Button> : null}
            </div>
          </div>
        </section>
      ) : null}
      {bootstrap.queue?.entries.length ? (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground" role="status">
          {bootstrap.queue.entries.length} message{bootstrap.queue.entries.length === 1 ? "" : "s"} waiting for the current turn. {chat ? <Link className="underline underline-offset-2" to={createIssueDetailPath(chat.id)}>Manage queued messages</Link> : null}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col" data-testid="agent-chat-thread-shell">
        <TaskChatThreadView
          items={items}
          historyControl={historyControl}
          renderInteraction={(item) => (
            <div className="rounded-lg border border-input bg-card px-3 py-2 text-sm">
              <p className="font-medium">{item.interaction.title ?? item.interaction.summary ?? "A request needs your response"}</p>
              {chat ? <Link className="mt-1 inline-flex text-xs text-primary underline underline-offset-2" to={createIssueDetailPath(chat.id)}>Open details to respond</Link> : null}
            </div>
          )}
          tail={items.length === 0 && !chat ? <p className="mx-auto max-w-sm py-8 text-center text-sm text-muted-foreground">Start with a question or idea. Your conversation will be saved when you send the first message.</p> : null}
          contentKey={chat?.id + ":" + items.length + ":" + items.map(item => item.id).join(":")}
        />
      </div>
      <form className="rounded-xl border border-input bg-card p-2" onSubmit={(event) => { event.preventDefault(); void submit(); }} aria-label={"Message " + agent.name}>
        <Textarea
          value={body}
          onChange={(event) => { bodyRef.current = event.target.value; setBody(event.target.value); saveDraft(draftKey, event.target.value); }}
          placeholder={draftAttempt ? "Checking an earlier message before allowing edits…" : "Message " + agent.name + "…"}
          aria-label={"Message " + agent.name}
          disabled={submitting || !!draftAttempt}
          rows={2}
          className="max-h-40 min-h-12 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex items-center gap-2 pt-1">
          {chat ? (
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link to={createIssueDetailPath(chat.id)} aria-label="Open attachments and task tools"><Paperclip className="size-4" /><span className="sr-only">Attachments and tools</span></Link>
            </Button>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={openingDetails || submitting} onClick={() => void openAttachmentsAndTools()} aria-label="Open attachments and task tools">
              {openingDetails ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
              <span className="sr-only">Attachments and tools</span>
            </Button>
          )}
          <span className="min-w-0 flex-1 text-xs text-muted-foreground" role={submitError || statusMessage ? "status" : undefined}>{submitError ?? statusMessage ?? "Enter to send · Shift+Enter for a new line"}</span>
          {draftAttempt ? (
            <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={() => void checkOrRetry()}>
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : "Check or retry"}
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label="Send message" disabled={!canSend || !body.trim() || submitting}>
              {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
