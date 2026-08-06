import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, CircularProgress, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";

import { useWorkspaces } from "../features/workspaces/workspaces";
import { listUsers, type AdminUser } from "../features/admin/adminApi";
import { getUserAccess, saveUserAccess, type UserWsLevel } from "../features/admin/permissionsApi";
import { tokens } from "../theme";

const LEVELS: { value: UserWsLevel; label: string; fg: string; bg: string }[] = [
  { value: "hidden", label: "Hidden", fg: tokens.text3, bg: "transparent" },
  { value: "view", label: "View", fg: "#B4671E", bg: "#FBEFE7" },
  { value: "edit", label: "Edit", fg: tokens.kriyaInk, bg: tokens.kriyaWash },
];
const META = (v: UserWsLevel) => LEVELS.find((l) => l.value === v) ?? LEVELS[0];

/**
 * Per-person workspace access. Pick a user, then set each workspace to
 * Hidden / View / Edit. This overrides whatever their role grants — "Hidden"
 * takes a workspace away even if the person's role allows it (see the backend
 * WorkspaceUserAccess override layer).
 */
export default function UserWorkspaceAccessPage() {
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [userId, setUserId] = useState<number | "">("");
  const [levels, setLevels] = useState<Record<string, UserWsLevel>>({});
  const [isSupervisor, setIsSupervisor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch((e) => { if (e?.response?.status === 403) setForbidden(true); else setUsers([]); });
  }, []);

  const loadUser = (id: number) => {
    setLoading(true);
    setStatus("");
    getUserAccess(id)
      .then((r) => {
        setIsSupervisor(r.is_supervisor);
        const g: Record<string, UserWsLevel> = {};
        for (const w of workspaces) g[w.key] = (r.access[w.key] as UserWsLevel) ?? "hidden";
        setLevels(g);
      })
      .catch(() => setLevels({}))
      .finally(() => setLoading(false));
  };

  const pickUser = (id: number) => { setUserId(id); loadUser(id); };

  const setCell = (wsKey: string, value: UserWsLevel) => {
    if (userId === "") return;
    const next = { ...levels, [wsKey]: value };
    setLevels(next);
    setStatus("Saving…");
    saveUserAccess(
      userId,
      workspaces.map((w) => ({ workspace: w.key, access: next[w.key] ?? "hidden" })),
    )
      .then(() => setStatus("All changes saved"))
      .catch(() => setStatus("Could not save — try again"));
  };

  const selectedUser = useMemo(() => users?.find((u) => u.id === userId), [users, userId]);

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Button size="small" startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 17 }} />} onClick={() => navigate("/admin/roles")}
        sx={{ color: tokens.text2, mb: 1, ml: -0.5 }}>
        Roles &amp; Access
      </Button>

      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" gap={2} flexWrap="wrap" sx={{ mb: 0.5 }}>
        <Typography variant="h1" sx={{ fontSize: 27 }}>Per-person workspace access</Typography>
        {status && (
          <Typography sx={{ fontSize: 12, color: status.startsWith("Could") ? tokens.attn : tokens.text3 }}>{status}</Typography>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2.5 }}>
        Pick a person, then set each workspace to <b>Hidden</b>, <b>View</b> or <b>Edit</b>. This{" "}
        <b>overrides</b> what their role grants — set <b>Hidden</b> to take a workspace away even if
        their role allows it.
      </Typography>

      {forbidden ? (
        <Typography sx={{ color: tokens.attn }}>You need administrator access to manage access.</Typography>
      ) : !users ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      ) : (
        <>
          <Select size="small" displayEmpty value={userId}
            onChange={(e) => pickUser(Number(e.target.value))}
            sx={{ minWidth: 300, mb: 2.5, fontSize: 13.5 }}>
            <MenuItem value="" disabled sx={{ fontSize: 13.5, color: tokens.text3 }}>Choose a person…</MenuItem>
            {users.map((u) => (
              <MenuItem key={u.id} value={u.id} sx={{ fontSize: 13.5 }}>
                {u.full_name || u.username} · @{u.username}
              </MenuItem>
            ))}
          </Select>

          {userId === "" ? null : loading ? (
            <Stack alignItems="center" sx={{ py: 5 }}><CircularProgress size={24} /></Stack>
          ) : isSupervisor ? (
            <Paper sx={{ p: 3, borderRadius: "6px" }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>
                {selectedUser?.full_name || selectedUser?.username} already sees every workspace
              </Typography>
              <Typography sx={{ fontSize: 13, color: tokens.text3 }}>
                They're an administrator / IT&nbsp;Team / Management member, so their workspace access
                can't be restricted here. Change their role on Roles &amp; Access if that's not intended.
              </Typography>
            </Paper>
          ) : (
            <Paper sx={{ borderRadius: "6px", overflow: "hidden" }}>
              {workspaces.map((w, i) => {
                const value = levels[w.key] ?? "hidden";
                const meta = META(value);
                return (
                  <Stack key={w.key} direction="row" alignItems="center" spacing={1.5}
                    sx={{ px: 2, py: 1, borderTop: i === 0 ? "none" : `1px solid ${tokens.line}` }}>
                    <Box sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "6px", display: "grid", placeItems: "center",
                      bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>
                      <w.Icon sx={{ fontSize: 16 }} />
                    </Box>
                    <Typography sx={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{w.label}</Typography>
                    <Select size="small" value={value} onChange={(e) => setCell(w.key, e.target.value as UserWsLevel)}
                      sx={{ minWidth: 118, fontSize: 12.5, bgcolor: meta.bg, color: meta.fg, fontWeight: 600,
                        "& .MuiOutlinedInput-notchedOutline": { borderColor: value === "hidden" ? tokens.line : "transparent" },
                        "& .MuiSelect-select": { py: 0.6 } }}>
                      {LEVELS.map((l) => (
                        <MenuItem key={l.value} value={l.value} sx={{ fontSize: 12.5 }}>{l.label}</MenuItem>
                      ))}
                    </Select>
                  </Stack>
                );
              })}
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
