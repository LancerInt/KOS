import { useCallback, useEffect, useState, type HTMLAttributes, type Key, type ReactNode } from "react";
import {
  Autocomplete, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Snackbar, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import PersonRemoveRoundedIcon from "@mui/icons-material/PersonRemoveRounded";

import type { AddableUser, MemberRow, MemberScope } from "./memberScope";
import { tokens } from "../../theme";

const DOMAIN_LABEL: Record<string, string> = { research: "Research", executive: "Executive" };

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Who can open a workspace — or one project inside it.
 *
 * Both tiers grant access to named people out of the same team, so both drive
 * this one dialog through a `MemberScope`; only `note` differs, because what an
 * empty roster means differs (a workspace with no members is simply empty; a
 * project with no members is open to its whole workspace). A member can add or
 * remove teammates; supervisors (IT/Management/admin) see everything and are
 * never listed. */
export default function MembersDialog({
  open, onClose, scope, note, emptyNote, removeTooltip = "Remove", canManage, canRemove, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  scope: MemberScope;
  /** What this roster governs, named — sits above the list. */
  note: ReactNode;
  /** What an *empty* roster means here. Falls back to the plain "none yet". */
  emptyNote?: ReactNode;
  removeTooltip?: string;
  canManage: boolean;
  /** Per-row gate for the remove (✕) button. Omit to allow removing anyone the
   *  manager can see (the project-roster default); pass it to narrow removal,
   *  e.g. workspace members only removable by their adder or IT/Management. */
  canRemove?: (m: MemberRow) => boolean;
  onChanged?: () => void;
}) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [addable, setAddable] = useState<AddableUser[]>([]);
  const [domain, setDomain] = useState<string | null>(null);
  const [picked, setPicked] = useState<AddableUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [undo, setUndo] = useState<{ user: number; name: string } | null>(null);

  const load = useCallback(() => {
    setMembers(null); setErr("");
    scope.list().then(setMembers).catch(() => setMembers([]));
    if (canManage) {
      scope.addable()
        .then((a) => { setAddable(a.users); setDomain(a.domain); })
        .catch(() => setAddable([]));
    }
  }, [scope, canManage]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const doAdd = async (userId: number) => {
    setBusy(true); setErr("");
    try {
      await scope.add(userId);
      setPicked(null);
      load();
      onChanged?.();
    } catch (e) {
      const d = (e as { response?: { data?: { user?: string[] | string } } }).response?.data?.user;
      setErr(Array.isArray(d) ? d[0] : (d ?? "Could not add this person."));
    } finally { setBusy(false); }
  };

  const doRemove = async (m: MemberRow) => {
    setBusy(true); setErr("");
    try {
      await scope.remove(m.id);
      setUndo({ user: m.user, name: m.user_name });
      load();
      onChanged?.();
    } catch {
      setErr("Could not remove this person.");
    } finally { setBusy(false); }
  };

  const doUndo = async () => {
    if (!undo) return;
    const u = undo; setUndo(null);
    await doAdd(u.user);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19, pb: 0.5 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <GroupRoundedIcon sx={{ fontSize: 20, color: tokens.text3 }} />
          <span>Members</span>
          {domain && (
            <Chip size="small" label={`${DOMAIN_LABEL[domain] ?? domain} team`}
              sx={{ height: 20, fontSize: 11, fontWeight: 600 }} />
          )}
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Typography component="div" sx={{ fontSize: 12.5, color: tokens.text3, mb: 1.5 }}>
          {note}
        </Typography>

        {canManage && (
          <Stack direction="row" spacing={1} sx={{ mb: 1.75 }}>
            <Autocomplete
              size="small" fullWidth options={addable} value={picked}
              onChange={(_, v) => setPicked(v)}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              noOptionsText="No teammates left to add"
              renderInput={(p) => <TextField {...p} placeholder="Add a teammate…" />}
              renderOption={(props, o) => {
                // MUI v6: `key` is inside props — spreading it into JSX is a
                // React error and can break option selection. Pull it out.
                const { key, ...liProps } = props as HTMLAttributes<HTMLLIElement> & { key?: Key };
                return (
                  <Box component="li" key={key ?? o.id} {...liProps}>
                    <Stack sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13.5 }} noWrap>{o.name}</Typography>
                      <Typography sx={{ fontSize: 11, color: tokens.text3 }} noWrap>{o.email}</Typography>
                    </Stack>
                  </Box>
                );
              }}
            />
            <Button variant="contained" disabled={!picked || busy}
              onClick={() => picked && doAdd(picked.id)}
              startIcon={<PersonAddAlt1RoundedIcon sx={{ fontSize: 17 }} />}>Add</Button>
          </Stack>
        )}

        {err && <Typography sx={{ fontSize: 12.5, color: tokens.attn, mb: 1 }}>{err}</Typography>}

        {members === null ? (
          <Stack alignItems="center" sx={{ py: 3 }}><CircularProgress size={22} /></Stack>
        ) : members.length === 0 ? (
          <Typography component="div" sx={{ fontSize: 13, color: tokens.text3, py: 2, textAlign: "center" }}>
            {emptyNote ?? <>No members yet.{canManage ? " Add teammates above." : ""}</>}
          </Typography>
        ) : (
          <Stack spacing={0.25}>
            {members.map((m) => (
              <Stack key={m.id} direction="row" alignItems="center" spacing={1.25}
                sx={{ p: 0.75, borderRadius: "8px", "&:hover": { bgcolor: tokens.surface } }}>
                <Avatar sx={{ width: 30, height: 30, fontSize: 12, bgcolor: tokens.kriyaInk, fontFamily: '"Manrope Variable"' }}>
                  {initials(m.user_name)}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 500 }} noWrap>{m.user_name}</Typography>
                  <Typography sx={{ fontSize: 11, color: tokens.text3 }} noWrap>{m.user_email}</Typography>
                </Box>
                {canManage && (!canRemove || canRemove(m)) && (
                  <Tooltip title={removeTooltip}>
                    <IconButton size="small" disabled={busy} onClick={() => doRemove(m)}
                      sx={{ color: tokens.text3, "&:hover": { color: tokens.attn, bgcolor: tokens.attnWash } }}>
                      <PersonRemoveRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>

      <Snackbar open={!!undo} autoHideDuration={6000} onClose={() => setUndo(null)}
        message={undo ? `Removed ${undo.name}` : ""}
        action={<Button size="small" onClick={doUndo} sx={{ color: "#fff" }}>Undo</Button>}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }} />
    </Dialog>
  );
}
