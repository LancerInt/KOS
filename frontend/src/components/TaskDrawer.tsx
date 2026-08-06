import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";

import {
  getTask,
  listProjectTasks,
  patchTask,
  setTaskStatus,
} from "../features/tasks/tasksApi";
import { addCommentSafe, toggleChecklistSafe } from "../offline/actions";
import type { TaskDetail, TaskListItem, UserMini } from "../features/tasks/types";
import { getWorkflow, type ResolvedWorkflow } from "../features/workflows/workflowsApi";
import {
  createBlocker, createDependency, deleteDependency, listBlockers, listDependencies,
  resolveBlocker, type Blocker, type Dependency, type DependencyType,
} from "../features/dependencies/depsApi";
import {
  createApproval, decideApproval, listTaskApprovals, type ApprovalRequest,
} from "../features/approvals/approvalsApi";
import { FlowRail, CATEGORY_COLOR, STATUSES, StatusChip } from "../features/tasks/display";
import AiActionButton, { AiActionBar } from "../features/ai/AiActionButton";
import { applySubtasks, task as taskAi, type SubtaskSuggestion } from "../features/ai/aiApi";
import { PRIORITY_COLOR } from "../features/projects/display";
import MentionComposer, { renderWithMentions } from "../features/tasks/MentionComposer";
import TimeSection from "../features/tasks/TimeSection";
import { listPeople, type Person } from "../features/email/emailsApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

interface Props {
  taskId: number | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

function initials(u: UserMini): string {
  const parts = (u.full_name || u.username).split(" ");
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export default function TaskDrawer({ taskId, open, onClose, onChanged }: Props) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [wf, setWf] = useState<ResolvedWorkflow | null>(null);
  const [statusError, setStatusError] = useState<string[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  const load = () => {
    if (taskId) getTask(taskId).then(setTask);
  };

  // People for the @mention picker — fetched once when the drawer first opens.
  useEffect(() => {
    if (open && people.length === 0) listPeople().then(setPeople).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setTask(null);
    setWf(null);
    setStatusError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Load the project's workflow so the status control offers the right options.
  useEffect(() => {
    if (task?.project) getWorkflow(task.project).then(setWf).catch(() => setWf(null));
  }, [task?.project]);

  // Strict workflows restrict the dropdown to the allowed next statuses.
  const statusOptions = (() => {
    if (!wf || !task) return STATUSES;
    if (!wf.strict) return wf.statuses;
    const allowed = new Set<string>([task.status]);
    wf.transitions.forEach((t) => { if (t.from === task.status) allowed.add(t.to); });
    return wf.statuses.filter((s) => allowed.has(s.key));
  })();

  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canEdit = ["manage_project", "assign_tasks", "update_assigned", "administer"].some((k) => k in caps);

  const canApprove = "approve" in caps || "administer" in caps;
  const userId = useAppSelector((s) => s.auth.user?.id);

  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [projTasks, setProjTasks] = useState<TaskListItem[]>([]);
  const [newDepType, setNewDepType] = useState<DependencyType>("fs");
  const [newPred, setNewPred] = useState<number | "">("");
  const [newExtNote, setNewExtNote] = useState("");
  const [newBlockerDesc, setNewBlockerDesc] = useState("");
  const [newBlockerSev, setNewBlockerSev] = useState("medium");

  const loadExtras = () => {
    if (!task) return;
    listDependencies(task.id).then(setDeps).catch(() => setDeps([]));
    listBlockers(task.id).then(setBlockers).catch(() => setBlockers([]));
    listProjectTasks(task.project).then(setProjTasks).catch(() => setProjTasks([]));
    listTaskApprovals(task.id).then(setApprovals).catch(() => setApprovals([]));
  };
  useEffect(() => { if (task?.id) loadExtras(); /* eslint-disable-next-line */ }, [task?.id]);

  const addDependency = async () => {
    if (!task) return;
    try {
      if (newDepType === "external") {
        if (!newExtNote.trim()) return;
        await createDependency({ successor: task.id, dependency_type: "external", external_note: newExtNote });
      } else {
        if (!newPred) return;
        await createDependency({ successor: task.id, dependency_type: newDepType, predecessor_task: Number(newPred) });
      }
      setNewPred(""); setNewExtNote("");
      loadExtras(); load(); onChanged?.();
    } catch (e: any) {
      window.alert(e?.response?.data?.[0] ?? e?.response?.data?.detail ?? "Could not add dependency.");
    }
  };
  const removeDependency = async (depId: number) => { await deleteDependency(depId); loadExtras(); load(); onChanged?.(); };

  const addBlocker = async () => {
    if (!task || !newBlockerDesc.trim()) return;
    await createBlocker({ task: task.id, description: newBlockerDesc, severity: newBlockerSev });
    setNewBlockerDesc(""); loadExtras(); load(); onChanged?.();
  };
  const resolveBlockerFn = async (blockerId: number) => {
    const note = window.prompt("Resolution note?") ?? "";
    await resolveBlocker(blockerId, note);
    loadExtras(); load(); onChanged?.();
  };

  const submitForApproval = async () => {
    if (!task) return;
    await createApproval({ kind: "deliverable", task: task.id });
    loadExtras(); load(); onChanged?.();
  };
  const requestDeadlineChange = async () => {
    if (!task) return;
    const d = window.prompt("New due date (YYYY-MM-DD):", task.due_date ?? "");
    if (!d) return;
    await createApproval({ kind: "deadline_change", task: task.id, payload: { new_due_date: d } });
    loadExtras(); onChanged?.();
  };
  const decide = async (approvalId: number, decision: "approve" | "reject" | "request_changes") => {
    let reason = "";
    if (decision !== "approve") {
      reason = window.prompt("Reason:") ?? "";
      if (!reason) return;
    }
    await decideApproval(approvalId, decision, reason);
    loadExtras(); load(); onChanged?.();
  };

  const changeStatus = async (status: string) => {
    if (!task) return;
    setStatusError(null);
    try {
      const updated = await setTaskStatus(task.id, status);
      setTask(updated);
      onChanged?.();
    } catch (e: any) {
      setStatusError(e?.response?.data?.blocking_reasons ?? [e?.response?.data?.status ?? "Could not change status."]);
    }
  };

  const toggle = async (id: number, done: boolean) => {
    const res = await toggleChecklistSafe(id, done);
    if (res.queued) {
      // Optimistic: reflect the tick locally until it syncs.
      setTask((t) =>
        t ? { ...t, checklist_items: t.checklist_items.map((c) => (c.id === id ? { ...c, is_done: done } : c)) } : t,
      );
    } else {
      load();
    }
  };

  const postComment = async (body: string, mentionIds: number[]) => {
    if (!task || !body.trim()) return;
    const res = await addCommentSafe(task.id, body, mentionIds);
    if (res.queued) {
      // Optimistic: show the pending comment until it syncs.
      const optimistic = {
        id: -Date.now(),
        task: task.id,
        author: null,
        author_detail: { full_name: "You (pending sync)", username: "you" } as unknown as UserMini,
        body,
        mentions: mentionIds,
        created_at: new Date().toISOString(),
      };
      setTask((t) => (t ? { ...t, comments: [...t.comments, optimistic] } : t));
    } else {
      load();
      onChanged?.();
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}
      PaperProps={{ sx: { width: 480, maxWidth: "94vw", bgcolor: "background.default" } }}>
      {!task ? (
        <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={24} /></Stack>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* top */}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2.25, py: 1.75, bgcolor: "background.paper", borderBottom: `1px solid ${tokens.line}` }}>
            <Chip label={task.project_code} size="small" sx={{ fontFamily: monoFont, fontSize: 11, height: 20, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }} />
            <Chip label={`#${task.id}`} size="small" sx={{ fontFamily: monoFont, fontSize: 11, height: 20, bgcolor: "#EEF0F3", color: tokens.text3 }} />
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={onClose}><CloseRoundedIcon fontSize="small" /></IconButton>
          </Stack>

          <Box sx={{ overflowY: "auto", px: 2.25, py: 2.25, flex: 1 }}>
            <Typography variant="h3" sx={{ fontSize: 19, mb: 1.5 }}>{task.title}</Typography>

            <FlowRail category={task.category} showCaps />

            {/* status control */}
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 2 }}>
              <Typography sx={{ fontSize: 12, color: tokens.text3 }}>Status</Typography>
              <Select
                value={task.status}
                size="small"
                onChange={(e) => changeStatus(e.target.value)}
                sx={{ fontSize: 13, minWidth: 170 }}
              >
                {statusOptions.map((s) => (
                  <MenuItem key={s.key} value={s.key} sx={{ fontSize: 13 }}>
                    <StatusChip label={s.label} category={s.category} />
                  </MenuItem>
                ))}
              </Select>
            </Stack>
            {statusError && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {statusError.map((r, i) => <div key={i}>{r}</div>)}
              </Alert>
            )}

            {/* meta */}
            <Stack direction="row" spacing={3} sx={{ mt: 2.5 }}>
              <Meta label="Priority">
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: PRIORITY_COLOR[task.priority] }} />
                  <Typography sx={{ fontSize: 13, textTransform: "capitalize" }}>{task.priority}</Typography>
                </Stack>
              </Meta>
              <Meta label="Due">
                <Typography sx={{ fontSize: 13, fontFamily: monoFont, color: task.is_overdue ? tokens.attn : tokens.text }}>
                  {task.due_date ?? "—"}
                </Typography>
              </Meta>
              <Meta label="Owners">
                <Stack direction="row">
                  {task.owners_detail.map((o, i) => (
                    <Avatar key={o.id} title={o.full_name || o.username}
                      sx={{ width: 24, height: 24, fontSize: 10, ml: i === 0 ? 0 : "-6px", border: "2px solid #fff",
                        bgcolor: o.id === task.primary_owner ? tokens.kriyaInk : tokens.text2 }}>
                      {initials(o)}
                    </Avatar>
                  ))}
                  {task.primary_owner && <StarRoundedIcon sx={{ fontSize: 13, color: "#E5A138", ml: 0.5, alignSelf: "center" }} />}
                </Stack>
              </Meta>
            </Stack>

            {/* AI actions. Generation only previews — applying is an explicit
                second step that writes through the normal task API. */}
            <Box sx={{ py: 0.5 }}>
              <AiActionBar>
                <AiActionButton label="Summarize" title={`Summary · ${task.title}`} run={() => taskAi.summary(task.id)} />
                <AiActionButton
                  label="Rewrite"
                  title="Rewrite the description"
                  run={() => taskAi.rewrite(task.id)}
                  disabled={!task.description}
                  disabledReason="This task has no description to rewrite."
                  apply={{
                    label: "Replace description",
                    onApply: async (outcome) => {
                      const text = String((outcome.data as { text?: string }).text ?? "").trim();
                      if (!text) return false;
                      await patchTask(task.id, { description: text });
                      load();
                      onChanged?.();
                    },
                  }}
                />
                <AiActionButton
                  label="Create subtasks"
                  title="Suggested subtasks"
                  run={() => taskAi.subtasks(task.id)}
                  apply={{
                    label: "Add subtasks",
                    onApply: async (outcome) => {
                      const suggestions = (outcome.data as { subtasks?: SubtaskSuggestion[] }).subtasks ?? [];
                      const titles = suggestions.map((s) => s.title).filter(Boolean);
                      if (!titles.length) return false;
                      await applySubtasks(task.id, titles);
                      load();
                      onChanged?.();
                    },
                  }}
                />
                <AiActionButton label="Estimate effort" title="Effort estimate" run={() => taskAi.estimate(task.id)} />
                <AiActionButton
                  label="Prioritise"
                  title="Suggested priority"
                  run={() => taskAi.prioritize(task.id)}
                  apply={{
                    label: "Apply priority",
                    onApply: async (outcome) => {
                      const priority = String(
                        (outcome.data as { suggested_priority?: string }).suggested_priority ?? "",
                      ).toLowerCase();
                      if (!["low", "medium", "high", "critical"].includes(priority)) return false;
                      await patchTask(task.id, { priority });
                      load();
                      onChanged?.();
                    },
                  }}
                />
              </AiActionBar>
            </Box>

            {task.deliverable && (
              <Section title="Deliverable"><Typography sx={{ fontSize: 13.5 }}>{task.deliverable}</Typography></Section>
            )}
            {task.description && (
              <Section title="Description"><Typography sx={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{task.description}</Typography></Section>
            )}

            {/* checklist */}
            {task.checklist_items.length > 0 && (
              <Section title={`Checklist · ${task.checklist_done}/${task.checklist_total}`}>
                {task.checklist_items.map((c) => (
                  <Stack key={c.id} direction="row" alignItems="center" spacing={0.5}>
                    <Checkbox size="small" checked={c.is_done} onChange={(e) => toggle(c.id, e.target.checked)} sx={{ p: 0.5 }} />
                    <Typography sx={{ fontSize: 13.5, textDecoration: c.is_done ? "line-through" : "none", color: c.is_done ? tokens.text3 : tokens.text }}>
                      {c.title}
                    </Typography>
                    {c.is_required && <Chip label="required" size="small" sx={{ height: 16, fontSize: 9, bgcolor: tokens.attnWash, color: tokens.attn }} />}
                  </Stack>
                ))}
              </Section>
            )}

            {/* subtasks */}
            {task.subtasks.length > 0 && (
              <Section title="Subtasks">
                {task.subtasks.map((s) => (
                  <Stack key={s.id} direction="row" alignItems="center" spacing={1}>
                    <Checkbox size="small" checked={s.is_done} disabled sx={{ p: 0.5 }} />
                    <Typography sx={{ fontSize: 13.5 }}>{s.title}</Typography>
                  </Stack>
                ))}
              </Section>
            )}

            {/* dependencies */}
            <Section title="Dependencies">
              <Stack spacing={0.75}>
                {deps.map((d) => (
                  <Stack key={d.id} direction="row" alignItems="center" spacing={1}>
                    <Box title={d.is_satisfied ? "satisfied" : "not met"}
                      sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: d.is_satisfied ? CATEGORY_COLOR.done : CATEGORY_COLOR.waiting }} />
                    <Typography sx={{ fontSize: 13.5, flex: 1 }}>{d.label}</Typography>
                    {d.is_mandatory && <Chip label="mandatory" size="small" sx={{ height: 16, fontSize: 9, bgcolor: tokens.attnWash, color: tokens.attn }} />}
                    {canEdit && <IconButton size="small" onClick={() => removeDependency(d.id)}><CloseRoundedIcon sx={{ fontSize: 15 }} /></IconButton>}
                  </Stack>
                ))}
                {deps.length === 0 && <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No dependencies.</Typography>}
              </Stack>
              {canEdit && (
                <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Select size="small" value={newDepType} onChange={(e) => setNewDepType(e.target.value as DependencyType)} sx={{ fontSize: 12.5, minWidth: 120 }}>
                    <MenuItem value="fs" sx={{ fontSize: 12.5 }}>Finish → Start</MenuItem>
                    <MenuItem value="ss" sx={{ fontSize: 12.5 }}>Start → Start</MenuItem>
                    <MenuItem value="external" sx={{ fontSize: 12.5 }}>External</MenuItem>
                  </Select>
                  {newDepType === "external" ? (
                    <TextField size="small" placeholder="External note" value={newExtNote} onChange={(e) => setNewExtNote(e.target.value)} sx={{ flex: 1, minWidth: 140 }} />
                  ) : (
                    <Select size="small" displayEmpty value={newPred} onChange={(e) => setNewPred(Number(e.target.value))} sx={{ fontSize: 12.5, flex: 1, minWidth: 160 }}>
                      <MenuItem value="" disabled sx={{ fontSize: 12.5 }}>Predecessor task…</MenuItem>
                      {projTasks.filter((t) => t.id !== task.id).map((t) => (
                        <MenuItem key={t.id} value={t.id} sx={{ fontSize: 12.5 }}>{t.title}</MenuItem>
                      ))}
                    </Select>
                  )}
                  <Button size="small" variant="outlined" onClick={addDependency}>Add</Button>
                </Stack>
              )}
            </Section>

            {/* blockers */}
            <Section title="Blockers">
              <Stack spacing={1}>
                {blockers.map((b) => (
                  <Box key={b.id}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Chip label={b.severity} size="small" sx={{ height: 18, fontSize: 9.5, textTransform: "capitalize", color: PRIORITY_COLOR[b.severity], bgcolor: `${PRIORITY_COLOR[b.severity]}1a` }} />
                      <Typography sx={{ fontSize: 13.5, flex: 1, textDecoration: b.is_open ? "none" : "line-through", color: b.is_open ? tokens.text : tokens.text3 }}>{b.description}</Typography>
                      {b.is_open
                        ? <Typography sx={{ fontSize: 11, color: tokens.attn, fontFamily: monoFont }}>age {b.age_hours}h</Typography>
                        : <Chip label="resolved" size="small" sx={{ height: 18, fontSize: 9.5, bgcolor: "#E7F5EE", color: "#1F7A4D" }} />}
                    </Stack>
                    {b.is_open && canEdit && (
                      <Button size="small" onClick={() => resolveBlockerFn(b.id)} sx={{ mt: 0.25 }}>Resolve</Button>
                    )}
                  </Box>
                ))}
                {blockers.length === 0 && <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No blockers.</Typography>}
              </Stack>
              {canEdit && (
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <TextField size="small" placeholder="Describe the blocker" value={newBlockerDesc} onChange={(e) => setNewBlockerDesc(e.target.value)} fullWidth />
                  <Select size="small" value={newBlockerSev} onChange={(e) => setNewBlockerSev(e.target.value)} sx={{ fontSize: 12.5 }}>
                    {["critical", "high", "medium", "low"].map((s) => (
                      <MenuItem key={s} value={s} sx={{ fontSize: 12.5, textTransform: "capitalize" }}>{s}</MenuItem>
                    ))}
                  </Select>
                  <Button size="small" variant="outlined" color="error" onClick={addBlocker} disabled={!newBlockerDesc.trim()}>Block</Button>
                </Stack>
              )}
            </Section>

            {/* approvals */}
            <Section title="Approvals">
              <Stack spacing={1}>
                {approvals.map((a) => (
                  <Box key={a.id}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Chip label={a.kind.replace("_", " ")} size="small" sx={{ height: 18, fontSize: 9.5, textTransform: "capitalize", bgcolor: "#EEF0F3", color: tokens.text2 }} />
                      <Typography sx={{ fontSize: 13, flex: 1 }}>{a.requested_by_name}</Typography>
                      <Chip label={a.status.replace("_", " ")} size="small" sx={{
                        height: 18, fontSize: 9.5, textTransform: "capitalize",
                        bgcolor: a.status === "approved" ? "#E7F5EE" : a.status === "rejected" ? tokens.attnWash : a.status === "pending" ? "#FBF2E0" : "#EEF0F3",
                        color: a.status === "approved" ? "#1F7A4D" : a.status === "rejected" ? tokens.attn : a.status === "pending" ? "#B47C1E" : tokens.text2,
                      }} />
                    </Stack>
                    {a.decision_reason && <Typography sx={{ fontSize: 12, color: tokens.text3, mt: 0.25 }}>“{a.decision_reason}”</Typography>}
                    {a.status === "pending" && canApprove && a.requested_by !== userId && (
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                        <Button size="small" variant="contained" onClick={() => decide(a.id, "approve")}>Approve</Button>
                        <Button size="small" onClick={() => decide(a.id, "request_changes")}>Request changes</Button>
                        <Button size="small" color="error" onClick={() => decide(a.id, "reject")}>Reject</Button>
                      </Stack>
                    )}
                  </Box>
                ))}
                {approvals.length === 0 && <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No approval requests.</Typography>}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                {canEdit && <Button size="small" variant="outlined" onClick={submitForApproval}>Submit for approval</Button>}
                <Button size="small" onClick={requestDeadlineChange}>Request deadline change</Button>
              </Stack>
            </Section>

            {/* time tracking */}
            <Section title="Time">
              <TimeSection task={task} onChanged={load} />
            </Section>

            {/* comments */}
            <Section title="Comments">
              <Stack spacing={1.25} sx={{ mb: 1.5 }}>
                {task.comments.map((c) => {
                  const names = (c.mentions ?? [])
                    .map((id) => people.find((p) => p.id === id)?.name)
                    .filter((n): n is string => Boolean(n));
                  return (
                    <Box key={c.id}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{c.author_detail?.full_name || c.author_detail?.username}</Typography>
                        <Typography sx={{ fontSize: 11, color: tokens.text3, fontFamily: monoFont }}>{c.created_at.slice(0, 16).replace("T", " ")}</Typography>
                      </Stack>
                      <Typography sx={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{renderWithMentions(c.body, names)}</Typography>
                    </Box>
                  );
                })}
                {task.comments.length === 0 && <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No comments yet.</Typography>}
              </Stack>
              <MentionComposer people={people} onSubmit={postComment} />
            </Section>

            {/* activity */}
            {task.activities.length > 0 && (
              <Section title="Activity">
                <Stack spacing={0.75}>
                  {task.activities.map((a) => (
                    <Stack key={a.id} direction="row" spacing={1} alignItems="baseline">
                      <Typography sx={{ fontSize: 12.5 }}>
                        <b>{a.actor_detail?.full_name || a.actor_detail?.username || "System"}</b> {a.verb_display}
                        {a.detail?.from && a.detail?.to ? ` · ${a.detail.from} → ${a.detail.to}` : ""}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Typography sx={{ fontSize: 10.5, color: tokens.text3, fontFamily: monoFont }}>{a.created_at.slice(0, 10)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Section>
            )}
          </Box>
        </Box>
      )}
    </Drawer>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: tokens.text3, mb: 0.5 }}>{label}</Typography>
      {children}
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 2.5 }}>
      <Divider sx={{ mb: 1.5 }} />
      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 1 }}>{title}</Typography>
      {children}
    </Box>
  );
}
