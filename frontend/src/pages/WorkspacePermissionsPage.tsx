import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Button, CircularProgress, MenuItem, Paper, Select, Stack, Typography } from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";

import { useWorkspaces } from "../features/workspaces/workspaces";
import { listRoles, type AdminRole } from "../features/admin/adminApi";
import { listRolePermissions, saveRolePermissions, type WsAccess } from "../features/admin/permissionsApi";
import { tokens } from "../theme";

type Level = "hidden" | WsAccess;

const LEVELS: { value: Level; label: string; fg: string; bg: string }[] = [
  { value: "hidden", label: "Hidden", fg: tokens.text3, bg: "transparent" },
  { value: "view", label: "View", fg: "#B4671E", bg: "#FBEFE7" },
  { value: "edit", label: "Edit", fg: tokens.kriyaInk, bg: tokens.kriyaWash },
];
const LEVEL_META = (v: Level) => LEVELS.find((l) => l.value === v) ?? LEVELS[0];

export default function WorkspacePermissionsPage() {
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const [roles, setRoles] = useState<AdminRole[] | null>(null);
  const [grid, setGrid] = useState<Record<number, Record<string, Level>>>({});
  const [forbidden, setForbidden] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    listRoles()
      .then(async (rs) => {
        setRoles(rs);
        const g: Record<number, Record<string, Level>> = {};
        for (const r of rs) {
          g[r.id] = {};
          for (const w of workspaces) g[r.id][w.key] = "hidden";
        }
        const all = await Promise.all(rs.map((r) => listRolePermissions(r.id).then((p) => [r.id, p] as const)));
        for (const [rid, perms] of all) for (const p of perms) g[rid][p.workspace] = p.access;
        setGrid(g);
      })
      .catch((e) => { if (e?.response?.status === 403) setForbidden(true); else setRoles([]); });
  }, []);

  const persist = async (roleId: number, next: Record<string, Level>) => {
    const permissions = workspaces
      .filter((w) => next[w.key] && next[w.key] !== "hidden")
      .map((w) => ({ workspace: w.key, access: next[w.key] as WsAccess }));
    setStatus("Saving…");
    try {
      await saveRolePermissions(roleId, permissions);
      setStatus("All changes saved");
    } catch {
      setStatus("Could not save — try again");
    }
  };

  const setCell = (roleId: number, wsKey: string, value: Level) => {
    setGrid((g) => {
      const next = { ...(g[roleId] ?? {}), [wsKey]: value };
      const merged = { ...g, [roleId]: next };
      persist(roleId, next);
      return merged;
    });
  };

  return (
    <Box sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 } }}>
      <Button size="small" startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 17 }} />} onClick={() => navigate("/admin/roles")}
        sx={{ color: tokens.text2, mb: 1, ml: -0.5 }}>
        Roles &amp; Access
      </Button>

      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" gap={2} flexWrap="wrap" sx={{ mb: 0.5 }}>
        <Typography variant="h1" sx={{ fontSize: 27 }}>Workspace permissions</Typography>
        {status && <Typography sx={{ fontSize: 12, color: status.startsWith("Could") ? tokens.attn : tokens.text3 }}>{status}</Typography>}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2.5 }}>
        Choose what each role can do in every workspace. <b>Hidden</b> — can't see it. <b>View</b> — can open and read, but not add or delete. <b>Edit</b> — full control.
      </Typography>

      {forbidden ? (
        <Typography sx={{ color: tokens.attn }}>You need administrator access to manage permissions.</Typography>
      ) : !roles ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      ) : (
        <Paper sx={{ borderRadius: "6px", overflowX: "auto" }}>
          <Box sx={{ minWidth: 240 + roles.length * 132, display: "grid",
            gridTemplateColumns: `240px repeat(${roles.length}, minmax(124px, 1fr))` }}>
            {/* header */}
            <Box sx={{ px: 1.75, py: 1.25, borderBottom: `1px solid ${tokens.line}`, position: "sticky", left: 0, bgcolor: tokens.surface, zIndex: 1 }}>
              <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: tokens.text3, fontWeight: 700 }}>Workspace</Typography>
            </Box>
            {roles.map((r) => (
              <Box key={r.id} sx={{ px: 1, py: 1.25, borderBottom: `1px solid ${tokens.line}`, borderLeft: `1px solid ${tokens.line}`, textAlign: "center" }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{r.name}</Typography>
              </Box>
            ))}

            {/* rows */}
            {workspaces.map((w, i) => (
              <Box key={w.key} sx={{ display: "contents" }}>
                <Box sx={{ px: 1.75, py: 1, borderBottom: i === workspaces.length - 1 ? "none" : `1px solid ${tokens.line}`,
                  position: "sticky", left: 0, bgcolor: tokens.surface, zIndex: 1, display: "flex", alignItems: "center", gap: 1.25 }}>
                  <Box sx={{ width: 26, height: 26, flexShrink: 0, borderRadius: "6px", display: "grid", placeItems: "center",
                    bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }}>
                    <w.Icon sx={{ fontSize: 15 }} />
                  </Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{w.label}</Typography>
                </Box>
                {roles.map((r) => {
                  const value = grid[r.id]?.[w.key] ?? "hidden";
                  const meta = LEVEL_META(value);
                  return (
                    <Box key={r.id} sx={{ px: 0.75, py: 0.75, display: "grid", placeItems: "center",
                      borderLeft: `1px solid ${tokens.line}`, borderBottom: i === workspaces.length - 1 ? "none" : `1px solid ${tokens.line}` }}>
                      <Select size="small" value={value} onChange={(e) => setCell(r.id, w.key, e.target.value as Level)}
                        sx={{ width: "100%", fontSize: 12.5, bgcolor: meta.bg, color: meta.fg, fontWeight: 600,
                          "& .MuiOutlinedInput-notchedOutline": { borderColor: value === "hidden" ? tokens.line : "transparent" },
                          "& .MuiSelect-select": { py: 0.6 } }}>
                        {LEVELS.map((l) => (
                          <MenuItem key={l.value} value={l.value} sx={{ fontSize: 12.5 }}>{l.label}</MenuItem>
                        ))}
                      </Select>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Paper>
      )}
    </Box>
  );
}
