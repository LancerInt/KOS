/**
 * "My Work" band for the Dashboard (Model 2 — compact tiles + filtered list).
 *
 * Surfaces everything routed to the current user, bucketed into Overdue /
 * Due today / This week / Waiting for review / Blocked / Needs my decision.
 * Task buckets come from `/tasks/mine/`; the decision bucket is pending approval
 * requests assigned to this user and only shows for approvers (IT / Management).
 *
 * The whole band hides itself when nothing needs the user — so a workspace-only
 * account never sees an empty row of zeros. When shown it sits in its own tinted
 * container with chip-style tiles, kept visually distinct from the project tiles.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SvgIconComponent } from "@mui/icons-material";
import { Avatar, Box, Button, Paper, Stack, Typography } from "@mui/material";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import TodayRoundedIcon from "@mui/icons-material/TodayRounded";
import DateRangeRoundedIcon from "@mui/icons-material/DateRangeRounded";
import RateReviewRoundedIcon from "@mui/icons-material/RateReviewRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import GavelRoundedIcon from "@mui/icons-material/GavelRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";

import { listMyTasks } from "./tasksApi";
import type { TaskListItem } from "./types";
import { listPendingApprovals, decideApproval, type ApprovalRequest } from "../approvals/approvalsApi";
import { useAppSelector } from "../../hooks";
import { useMyAccess } from "../workspaces/access";
import { tokens, monoFont } from "../../theme";

type BucketKey = "overdue" | "due-today" | "this-week" | "review" | "blocked" | "decision";

interface Bucket {
  key: BucketKey;
  label: string;
  color: string;
  wash: string;
  Icon: SvgIconComponent;
  hot?: boolean;
}

const BUCKETS: Bucket[] = [
  { key: "overdue", label: "Overdue", color: tokens.attn, wash: tokens.attnWash, Icon: WarningAmberRoundedIcon, hot: true },
  { key: "due-today", label: "Due today", color: tokens.kriya, wash: tokens.kriyaWash, Icon: TodayRoundedIcon },
  { key: "this-week", label: "This week", color: "#4A6572", wash: "#EEF0F3", Icon: DateRangeRoundedIcon },
  { key: "review", label: "Waiting for review", color: "#7C5CD6", wash: "#EEE9FB", Icon: RateReviewRoundedIcon },
  { key: "blocked", label: "Blocked", color: "#C7891B", wash: "#FBF2DF", Icon: BlockRoundedIcon },
  { key: "decision", label: "Needs my decision", color: "#C0417A", wash: "#FAE7F0", Icon: GavelRoundedIcon },
];

const PRIORITY_COLOR: Record<string, string> = {
  critical: tokens.attn, high: "#C7891B", medium: tokens.kriya, low: tokens.text3,
};
const KIND_LABEL: Record<string, string> = {
  deliverable: "Deliverable sign-off", deadline_change: "Deadline change", deletion: "Deletion",
};

const pad = (n: number) => String(n).padStart(2, "0");
function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function initials(name: string): string {
  const parts = (name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const isLive = (t: TaskListItem) => t.category !== "done" && t.category !== "cancelled";

export default function MyWorkBand() {
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const caps = user?.effective_capabilities ?? {};
  const { mine } = useMyAccess();
  // "Needs my decision" is for approvers — supervisors (IT/Management) or anyone
  // with the approve capability.
  const canDecide = !!mine?.is_admin || "approve" in caps || "administer" in caps;

  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [picked, setPicked] = useState<BucketKey | null>(null);

  const load = () => {
    listMyTasks().then(setTasks).catch(() => setTasks([]));
    if (canDecide) {
      listPendingApprovals()
        .then((rs) => setApprovals(rs.filter((r) => r.approver === user?.id)))
        .catch(() => setApprovals([]));
    } else {
      setApprovals([]);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [canDecide, user?.id]);

  const today = isoOffset(0);
  const weekEnd = isoOffset(7);

  const match: Record<Exclude<BucketKey, "decision">, (t: TaskListItem) => boolean> = {
    overdue: (t) => isLive(t) && t.is_overdue,
    "due-today": (t) => isLive(t) && !t.is_overdue && t.due_date === today,
    "this-week": (t) => isLive(t) && !t.is_overdue && !!t.due_date && t.due_date > today && t.due_date <= weekEnd,
    review: (t) => t.category === "in_review",
    blocked: (t) => t.category === "waiting",
  };

  const visibleBuckets = canDecide ? BUCKETS : BUCKETS.filter((b) => b.key !== "decision");

  const counts = useMemo(() => {
    const c = { overdue: 0, "due-today": 0, "this-week": 0, review: 0, blocked: 0, decision: approvals.length } as Record<BucketKey, number>;
    for (const t of tasks ?? []) {
      (Object.keys(match) as Array<keyof typeof match>).forEach((k) => { if (match[k](t)) c[k] += 1; });
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, approvals, today, weekEnd]);

  const total = visibleBuckets.reduce((s, b) => s + counts[b.key], 0);

  // Still loading, or nothing needs the user → render nothing at all.
  if (!tasks) return null;
  if (total === 0) return null;

  // Default to the first bucket that actually has something.
  const active: BucketKey = picked ?? (visibleBuckets.find((b) => counts[b.key] > 0)?.key ?? "overdue");
  const shownTasks = active === "decision" ? [] : tasks.filter(match[active]);
  const hasList = active === "decision" ? approvals.length > 0 : shownTasks.length > 0;

  const decide = (a: ApprovalRequest, decision: "approve" | "reject") => {
    const reason = decision === "reject" ? (window.prompt("Reason for rejection (optional):") ?? "") : "";
    decideApproval(a.id, decision, reason).then(load).catch(() => {});
  };

  return (
    <Box sx={{ mb: 2.5, p: 1.75, borderRadius: "12px", border: `1px solid ${tokens.line}`, bgcolor: "#FCFBF8" }}>
      {/* head */}
      <Stack direction="row" alignItems="baseline" spacing={1.25} sx={{ mb: 1.25, flexWrap: "wrap" }}>
        <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 14.5, fontWeight: 700 }}>My Work</Typography>
        <Typography sx={{ fontSize: 12, color: tokens.text2 }}>
          <b style={{ color: tokens.ink }}>{counts["due-today"]}</b> due today · <b style={{ color: counts.overdue ? tokens.attn : tokens.ink }}>{counts.overdue}</b> overdue
          {canDecide && counts.decision ? <> · <b style={{ color: tokens.ink }}>{counts.decision}</b> to decide</> : null}
        </Typography>
      </Stack>

      {/* compact chip tiles — deliberately smaller than the project metric tiles */}
      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
        {visibleBuckets.map((b) => {
          const n = counts[b.key];
          const on = b.key === active;
          return (
            <Box key={b.key} onClick={() => setPicked(b.key)}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.7, pl: 0.85, pr: 0.6, py: 0.55, borderRadius: "9px", cursor: "pointer",
                border: on ? `1.5px solid ${b.color}` : `1px solid ${tokens.line}`,
                bgcolor: on ? b.wash : "#fff", opacity: n === 0 && !on ? 0.55 : 1, transition: "all .12s",
                "&:hover": { borderColor: b.color } }}>
              <b.Icon sx={{ fontSize: 15, color: b.color }} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: on ? b.color : tokens.text2 }}>{b.label}</Typography>
              <Box sx={{ minWidth: 18, textAlign: "center", px: 0.5, borderRadius: "9px", fontFamily: monoFont, fontSize: 11, fontWeight: 700,
                bgcolor: on ? "#fff" : "#EEF0F3", color: b.hot && n > 0 ? tokens.attn : tokens.text2 }}>{n}</Box>
            </Box>
          );
        })}
      </Stack>

      {/* list for the active bucket — only when it has items (no empty box) */}
      {hasList && (
        <Paper variant="outlined" sx={{ mt: 1.25, borderRadius: "10px", overflow: "hidden", borderColor: tokens.line }}>
          {active === "decision"
            ? approvals.map((a, i) => (
              <Row key={a.id} first={i === 0} dot="#C0417A"
                title={a.target_label || KIND_LABEL[a.kind] || "Approval request"}
                meta={<>{KIND_LABEL[a.kind] ?? a.kind}{a.requested_by_name ? <> · from {a.requested_by_name}</> : null}</>}
                who={a.requested_by_name}
                actions={<>
                  <Button size="small" variant="contained" onClick={() => decide(a, "approve")}
                    sx={{ minWidth: 0, px: 1.25, boxShadow: "none" }}>Approve</Button>
                  <Button size="small" variant="outlined" color="inherit" onClick={() => decide(a, "reject")}
                    sx={{ minWidth: 0, px: 1.25, color: tokens.text2, borderColor: tokens.line }}>Reject</Button>
                </>} />
            ))
            : shownTasks.map((t, i) => {
              const isDate = active === "overdue" || active === "due-today" || active === "this-week";
              const who = t.primary_owner_detail?.full_name || "You";
              return (
                <Row key={t.id} first={i === 0} dot={PRIORITY_COLOR[t.priority] ?? tokens.text3}
                  title={t.title}
                  meta={<>
                    <Box component="span" sx={{ fontFamily: monoFont, fontSize: 10.5, fontWeight: 600, px: 0.7, py: "1px", borderRadius: "4px", bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>{t.project_code}</Box>
                    <Box component="span" sx={{ mx: 0.6, color: tokens.text3 }}>·</Box>
                    <Box component="span" sx={{ fontFamily: monoFont, fontSize: 11, color: active === "overdue" ? tokens.attn : tokens.text3, fontWeight: active === "overdue" ? 600 : 400 }}>
                      {isDate ? (t.due_date ? fmtDate(t.due_date) : "no date") : t.status_label}
                    </Box>
                  </>}
                  who={who}
                  actions={
                    <Button size="small" variant="outlined" endIcon={<LaunchRoundedIcon sx={{ fontSize: 14 }} />}
                      onClick={() => navigate(`/projects/${t.project}`)}
                      sx={{ minWidth: 0, px: 1.25, color: tokens.text2, borderColor: tokens.line }}>Open</Button>
                  } />
              );
            })}
        </Paper>
      )}
    </Box>
  );
}

function Row({ first, dot, title, meta, who, actions }: {
  first: boolean; dot: string; title: string; meta: React.ReactNode; who: string; actions: React.ReactNode;
}) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.25}
      sx={{ px: 1.75, py: 1, borderTop: first ? "none" : `1px solid ${tokens.line}`, bgcolor: "#fff", "&:hover": { bgcolor: "#FCFBF8" } }}>
      <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: dot, flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 600 }} noWrap>{title}</Typography>
        <Typography component="div" sx={{ mt: 0.3, color: tokens.text3, fontSize: 11.5, display: "flex", alignItems: "center", flexWrap: "wrap" }}>{meta}</Typography>
      </Box>
      <Avatar title={who} sx={{ width: 24, height: 24, fontSize: 10, bgcolor: tokens.kriyaInk, display: { xs: "none", sm: "grid" } }}>{initials(who)}</Avatar>
      <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>{actions}</Stack>
    </Stack>
  );
}
