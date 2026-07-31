import { useCallback, useEffect, useState } from "react";
import {
  Autocomplete, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Snackbar, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import PersonRemoveRoundedIcon from "@mui/icons-material/PersonRemoveRounded";

import {
  addMember, addableMembers, listMembers, removeMember,
  type AddableUser, type WorkspaceMember,
} from "./workspaceMembersApi";
import { tokens } from "../../theme";

const DOMAIN_LABEL: Record<string, string> = { research: "Research", executive: "Executive" };

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Who can open a workspace. A member can add or remove teammates of the same
 * team; supervisors (IT/Management/admin) see every workspace and aren't shown. */
export default function MembersDialog({
  open, onClose, workspace, workspaceLabel, canManage, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  workspace: string;
  workspaceLabel: string;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [addable, setAddable] = useState<AddableUser[]>([]);
  const [domain, setDomain] = useState<string | null>(null);
  const [picked, setPicked] = useState<AddableUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [undo, setUndo] = useState<{ user: number; name: string } | null>(null);

  const load = useCallback(() => {
    setMembers(null); setErr("");
    listMembers(workspace).then(setMembers).catch(() => setMembers([]));
    if (canManage) {
      addableMembers(workspace)
        .then((a) => { setAddable(a.users); setDomain(a.domain); })
        .catch(() => setAddable([]));
    }
  }, [workspace, canManage]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const doAdd = async (userId: number) => {
    setBusy(true); setErr("");
    try {
      await addMember(workspace, userId);
      setPicked(null);
      load();
      onChanged?.();
    } catch (e) {
      const d = (e as { response?: { data?: { user?: string[] | string } } }).response?.data?.user;
      setErr(Array.isArray(d) ? d[0] : (d ?? "Could not add this person."));
    } finally { setBusy(false); }
  };

  const doRemove = async (m: WorkspaceMember) => {
    setBusy(true); setErr("");
    try {
      await removeMember(m.id);
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
        <Typography sx={{ fontSize: 12.5, color: tokens.text3, mb: 1.5 }}>
          Who can open <b>{workspaceLabel}</b>. IT&nbsp;Team, Management and admins see every
          workspace and aren't listed here.
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
              renderOption={(props, o) => (
                <Box component="li" {...props} key={o.id}>
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13.5 }} noWrap>{o.name}</Typography>
                    <Typography sx={{ fontSize: 11, color: tokens.text3 }} noWrap>{o.email}</Typography>
                  </Stack>
                </Box>
              )}
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
          <Typography sx={{ fontSize: 13, color: tokens.text3, py: 2, textAlign: "center" }}>
            No members yet.{canManage ? " Add teammates above." : ""}
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
                {canManage && (
                  <Tooltip title="Remove from workspace">
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
