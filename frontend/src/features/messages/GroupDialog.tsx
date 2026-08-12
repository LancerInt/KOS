import { useEffect, useMemo, useState } from "react";
import {
  Alert, Autocomplete, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Stack, TextField, Typography,
} from "@mui/material";
import GroupAddRoundedIcon from "@mui/icons-material/GroupAddRounded";

import {
  addGroupMembers, announceMessagesChanged, createGroup, directory,
  type GroupThread, type Person,
} from "./messagesApi";
import { initialsOf } from "./MessagePersonDialog";
import { tokens } from "../../theme";

interface Props {
  open: boolean;
  onClose: () => void;
  /** "create" builds a new group; "add" invites people into an existing one. */
  mode: "create" | "add";
  onCreated?: (groupId: number) => void;
  groupId?: number;
  /** People already in the group (hidden from the picker in "add" mode). */
  excludeIds?: number[];
  onAdded?: (group: GroupThread) => void;
}

/** Create a group (name + members) or add people to one. Anyone may do both. */
export default function GroupDialog({ open, onClose, mode, onCreated, groupId, excludeIds = [], onAdded }: Props) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(""); setPicked([]); setError("");
    directory().then((d) => setPeople(d.people)).catch(() => setPeople([]));
  }, [open]);

  const options = useMemo(
    () => (people ?? []).filter((p) => !excludeIds.includes(p.id)).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [people, excludeIds],
  );

  const canSubmit = mode === "create" ? !!name.trim() && picked.length > 0 : picked.length > 0;

  const submit = () => {
    if (busy || !canSubmit) return;
    setBusy(true); setError("");
    const ids = picked.map((p) => p.id);
    if (mode === "create") {
      createGroup(name.trim(), ids)
        .then((g) => { announceMessagesChanged(); onCreated?.(g.id); onClose(); })
        .catch((e) => setError(e?.response?.data?.name?.[0] ?? e?.response?.data?.members?.[0] ?? "Could not create the group."))
        .finally(() => setBusy(false));
    } else if (groupId) {
      addGroupMembers(groupId, ids)
        .then((g) => { announceMessagesChanged(); onAdded?.(g); onClose(); })
        .catch(() => setError("Could not add those people."))
        .finally(() => setBusy(false));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: "14px" } }}>
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 18, pb: 1 }}>
        {mode === "create" ? "New group" : "Add people"}
      </DialogTitle>
      <DialogContent sx={{ pt: "8px !important" }}>
        <Stack spacing={2}>
          {mode === "create" && (
            <TextField label="Group name" fullWidth autoFocus value={name}
              onChange={(e) => setName(e.target.value)} placeholder="e.g. Amazon Launch"
              inputProps={{ maxLength: 120 }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
          )}
          <Autocomplete
            multiple options={options} value={picked} onChange={(_, v) => setPicked(v)}
            loading={people === null} getOptionLabel={(o) => o.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderTags={(value, getTagProps) =>
              value.map((o, i) => (
                <Chip {...getTagProps({ index: i })} key={o.id} size="small" label={o.name}
                  avatar={<Avatar sx={{ bgcolor: tokens.kriyaInk, fontSize: 10 }}>{initialsOf(o.name)}</Avatar>} />
              ))
            }
            renderOption={(props, o) => (
              <Box component="li" {...props} key={o.id}>
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, py: 0.25 }}>
                  <Avatar sx={{ width: 28, height: 28, bgcolor: tokens.kriyaInk, fontSize: 11.5 }}>{initialsOf(o.name)}</Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13.5 }} noWrap>{o.name}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: tokens.text3 }} noWrap>{o.role || o.email}</Typography>
                  </Box>
                </Stack>
              </Box>
            )}
            renderInput={(params) => (
              <TextField {...params} label={mode === "create" ? "Members" : "Add people"} placeholder="Search people…"
                autoFocus={mode === "add"}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (<>{people === null && <CircularProgress size={16} />}{params.InputProps.endAdornment}</>),
                }} />
            )}
          />
          {error && <Alert severity="error" sx={{ fontSize: 13 }}>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ color: tokens.text2 }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit || busy}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <GroupAddRoundedIcon sx={{ fontSize: 18 }} />}>
          {mode === "create" ? "Create group" : "Add"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
