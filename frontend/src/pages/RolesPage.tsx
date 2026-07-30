import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import LoginRoundedIcon from "@mui/icons-material/LoginRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import RemoveCircleOutlineRoundedIcon from "@mui/icons-material/RemoveCircleOutlineRounded";
import {
  Avatar, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, IconButton, MenuItem, Paper, Select, Stack, Switch,
  TextField, Tooltip, Typography,
} from "@mui/material";

import {
  addMembership, createRole, createUser, deleteRole, deleteUser, listMiniProjects, listRoles, listUsers,
  updateRole, updateUser,
  type AdminRole, type AdminUser, type MiniProject, type ProjectRole, type RoleInput, type UserInput,
} from "../features/admin/adminApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const PROJECT_ROLES: ProjectRole[] = ["owner", "manager", "contributor", "reviewer", "viewer"];

// The fixed RBAC vocabulary (PRD §7.5 / §7.2) — mirrors apps/accounts/rbac.py.
const CAPABILITIES: { value: string; label: string }[] = [
  { value: "view", label: "View" },
  { value: "comment", label: "Comment" },
  { value: "update_assigned", label: "Update assigned work" },
  { value: "create_tasks", label: "Create tasks" },
  { value: "assign_tasks", label: "Assign tasks" },
  { value: "manage_backlog", label: "Manage backlog & sprint" },
  { value: "approve", label: "Approve deliverables" },
  { value: "manage_project", label: "Manage project" },
  { value: "manage_workflows", label: "Manage workflows" },
  { value: "view_reports", label: "View reports" },
  { value: "export_data", label: "Export data" },
  { value: "administer", label: "Administer system" },
];
const SCOPES: { value: string; label: string }[] = [
  { value: "organisation", label: "Organisation" },
  { value: "portfolio", label: "Portfolio" },
  { value: "project", label: "Project" },
  { value: "own", label: "Own" },
];

// A calm tint per role — the four core roles are fixed; extras rotate through the rest.
const ROLE_TINTS = [
  { bg: "#E6F3F5", fg: "#0B5D6B" }, // teal
  { bg: "#EAF1FC", fg: "#2E6BD0" }, // blue
  { bg: "#F0EAFB", fg: "#6B47C7" }, // purple
  { bg: "#E7F5EE", fg: "#1F7A4D" }, // green
  { bg: "#FBEFE7", fg: "#B4671E" }, // amber
  { bg: "#FBE9EC", fg: "#B23A5B" }, // rose
];
const NAMED_TINT: Record<string, number> = { "IT Team": 0, Executive: 1, Management: 2, Researcher: 3 };
const roleTint = (role: AdminRole, index: number) =>
  ROLE_TINTS[(NAMED_TINT[role.name] ?? 4 + index) % ROLE_TINTS.length];

function initials(u: AdminUser): string {
  return (u.first_name?.[0] ?? u.username?.[0] ?? "?").toUpperCase() + (u.last_name?.[0]?.toUpperCase() ?? "");
}

export default function RolesPage() {
  const navigate = useNavigate();
  const [roles, setRoles] = useState<AdminRole[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [editingUser, setEditingUser] = useState<{ user: AdminUser | null; presetRole?: number } | null>(null);
  const [editingRole, setEditingRole] = useState<AdminRole | "new" | null>(null);
  const [addingTo, setAddingTo] = useState<AdminRole | null>(null);

  const load = () => {
    listRoles().then(setRoles).catch((e) => { if (e?.response?.status === 403) setForbidden(true); else setRoles([]); });
    listUsers().then(setUsers).catch((e) => { if (e?.response?.status === 403) setForbidden(true); else setUsers([]); });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const membersOf = (roleId: number) => (users ?? []).filter((u) => u.roles.includes(roleId));
  const unassigned = (users ?? []).filter((u) => u.roles.length === 0);

  const removeFromRole = async (u: AdminUser, roleId: number, roleName: string) => {
    if (!window.confirm(`Remove ${u.full_name || u.username} from ${roleName}?`)) return;
    await updateUser(u.id, { roles: u.roles.filter((r) => r !== roleId) });
    load();
  };
  const assignToRole = async (u: AdminUser, roleId: number) => {
    await updateUser(u.id, { roles: [...u.roles, roleId] });
    load();
  };
  const removeRole = async (role: AdminRole) => {
    const n = membersOf(role.id).length;
    const warn = n > 0 ? ` ${n} member${n === 1 ? "" : "s"} will lose it.` : "";
    if (!window.confirm(`Delete the role "${role.name}"?${warn}`)) return;
    await deleteRole(role.id);
    load();
  };

  return (
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" gap={2} flexWrap="wrap" sx={{ mb: 0.5 }}>
        <Typography variant="h1" sx={{ fontSize: 28 }}>Roles &amp; Access</Typography>
        {!forbidden && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" startIcon={<LoginRoundedIcon sx={{ fontSize: 17 }} />} onClick={() => navigate("/admin/last-logins")}>
              Last logins
            </Button>
            <Button variant="outlined" size="small" startIcon={<TuneRoundedIcon sx={{ fontSize: 17 }} />} onClick={() => navigate("/admin/permissions")}>
              Permissions
            </Button>
            <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={() => setEditingRole("new")}>
              New role
            </Button>
          </Stack>
        )}
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        Each role is a team of people. Add, edit or remove members — and add new roles as the org grows.
      </Typography>

      {forbidden ? (
        <Typography sx={{ color: tokens.attn }}>You need administrator access to manage roles and members.</Typography>
      ) : !roles || !users ? (
        <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>
      ) : (
        <>
          <Stack spacing={1.5}>
            {roles.map((role, i) => {
              const tint = roleTint(role, i);
              const members = membersOf(role.id);
              return (
                <Paper key={role.id} sx={{ p: 2.25, borderRadius: "6px" }}>
                  <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: members.length ? 1.5 : 0.5 }}>
                    <Box sx={{ width: 36, height: 36, flexShrink: 0, borderRadius: "6px", display: "grid", placeItems: "center",
                      bgcolor: tint.bg, color: tint.fg, fontFamily: '"Manrope Variable"', fontWeight: 700, fontSize: 15 }}>
                      {role.name[0]?.toUpperCase()}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontFamily: '"Manrope Variable"', fontSize: 16, fontWeight: 600, lineHeight: 1.2 }} noWrap>
                        {role.name}
                      </Typography>
                      <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
                        {members.length} member{members.length === 1 ? "" : "s"} · {role.default_scope} scope · {role.capabilities.length} permission{role.capabilities.length === 1 ? "" : "s"}
                      </Typography>
                    </Box>
                    <Button size="small" variant="outlined" startIcon={<PersonAddAlt1RoundedIcon sx={{ fontSize: 16 }} />}
                      onClick={() => setAddingTo(role)}>
                      Add member
                    </Button>
                    <Tooltip title="Edit role & permissions">
                      <IconButton size="small" onClick={() => setEditingRole(role)}><EditRoundedIcon sx={{ fontSize: 17, color: tokens.text3 }} /></IconButton>
                    </Tooltip>
                    <Tooltip title="Delete role">
                      <IconButton size="small" onClick={() => removeRole(role)}><DeleteOutlineRoundedIcon sx={{ fontSize: 17, color: tokens.text3 }} /></IconButton>
                    </Tooltip>
                  </Stack>

                  {members.length === 0 ? (
                    <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No members yet — add the first one.</Typography>
                  ) : (
                    <Stack>
                      {members.map((u, mi) => (
                        <Stack key={u.id} direction="row" alignItems="center" spacing={1.25}
                          sx={{ py: 0.9, borderTop: mi === 0 ? "none" : `1px solid ${tokens.line}`, opacity: u.is_active ? 1 : 0.55 }}>
                          <Avatar sx={{ width: 30, height: 30, bgcolor: tint.fg, fontSize: 12, fontFamily: '"Manrope Variable"' }}>
                            {initials(u)}
                          </Avatar>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
                              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }} noWrap>{u.full_name || u.username}</Typography>
                              <Typography sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3 }}>@{u.username}</Typography>
                              {!u.is_active && <Chip label="inactive" size="small" sx={{ height: 17, fontSize: 9, bgcolor: "#F1F3F5", color: tokens.text3 }} />}
                              {u.mfa_enabled && <Chip label="MFA" size="small" sx={{ height: 17, fontSize: 9, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }} />}
                            </Stack>
                            <Typography sx={{ fontSize: 11.5, color: tokens.text3 }} noWrap>{u.email || "no email"}</Typography>
                          </Box>
                          <Button size="small" variant="text" startIcon={<EditRoundedIcon sx={{ fontSize: 15 }} />} onClick={() => setEditingUser({ user: u })}>Edit</Button>
                          <Tooltip title={`Remove from ${role.name}`}>
                            <IconButton size="small" onClick={() => removeFromRole(u, role.id, role.name)}>
                              <RemoveCircleOutlineRoundedIcon sx={{ fontSize: 17, color: tokens.text3 }} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Paper>
              );
            })}
          </Stack>

          {/* People not in any role — so nobody is hidden */}
          {unassigned.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <FieldLabel>Not in any role</FieldLabel>
              <Paper sx={{ borderRadius: "6px", mt: 1 }}>
                {unassigned.map((u, i) => (
                  <Stack key={u.id} direction="row" alignItems="center" spacing={1.25}
                    sx={{ px: 2, py: 1, borderTop: i === 0 ? "none" : `1px solid ${tokens.line}` }}>
                    <Avatar sx={{ width: 30, height: 30, bgcolor: tokens.text2, fontSize: 12, fontFamily: '"Manrope Variable"' }}>{initials(u)}</Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }} noWrap>{u.full_name || u.username}</Typography>
                      <Typography sx={{ fontSize: 11.5, color: tokens.text3 }} noWrap>@{u.username} · {u.email || "no email"}</Typography>
                    </Box>
                    <Select size="small" displayEmpty value="" onChange={(e) => assignToRole(u, Number(e.target.value))}
                      sx={{ fontSize: 12.5, minWidth: 150 }}>
                      <MenuItem value="" disabled sx={{ fontSize: 12.5, color: tokens.text3 }}>Assign to role…</MenuItem>
                      {roles.map((r) => <MenuItem key={r.id} value={r.id} sx={{ fontSize: 12.5 }}>{r.name}</MenuItem>)}
                    </Select>
                    <Button size="small" variant="text" startIcon={<EditRoundedIcon sx={{ fontSize: 15 }} />} onClick={() => setEditingUser({ user: u })}>Edit</Button>
                  </Stack>
                ))}
              </Paper>
            </Box>
          )}
        </>
      )}

      {addingTo && (
        <AddMemberDialog
          role={addingTo}
          users={users ?? []}
          onClose={() => setAddingTo(null)}
          onAssigned={() => { setAddingTo(null); load(); }}
          onCreateNew={() => { const r = addingTo; setAddingTo(null); setEditingUser({ user: null, presetRole: r.id }); }}
        />
      )}

      {editingUser && (
        <UserDialog user={editingUser.user} roles={roles ?? []} presetRoleId={editingUser.presetRole}
          onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); load(); }} />
      )}

      {editingRole && (
        <RoleEditorDialog role={editingRole === "new" ? null : editingRole}
          onClose={() => setEditingRole(null)} onSaved={() => { setEditingRole(null); load(); }} />
      )}
    </Box>
  );
}

function AddMemberDialog({ role, users, onClose, onAssigned, onCreateNew }: {
  role: AdminRole; users: AdminUser[]; onClose: () => void; onAssigned: () => void; onCreateNew: () => void;
}) {
  const candidates = users.filter((u) => !u.roles.includes(role.id));
  const [pick, setPick] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!pick) return;
    const u = users.find((x) => x.id === pick);
    if (!u) return;
    setBusy(true);
    try {
      await updateUser(u.id, { roles: [...u.roles, role.id] });
      onAssigned();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>Add member to {role.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Box>
            <FieldLabel>Add an existing person</FieldLabel>
            <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
              <Select size="small" displayEmpty value={pick} onChange={(e) => setPick(e.target.value as number)}
                sx={{ flex: 1, fontSize: 13 }}>
                <MenuItem value="" disabled sx={{ fontSize: 13, color: tokens.text3 }}>
                  {candidates.length ? "Choose a person…" : "Everyone is already in this role"}
                </MenuItem>
                {candidates.map((u) => (
                  <MenuItem key={u.id} value={u.id} sx={{ fontSize: 13 }}>{u.full_name || u.username} · @{u.username}</MenuItem>
                ))}
              </Select>
              <Button variant="outlined" onClick={add} disabled={!pick || busy}>Add</Button>
            </Stack>
          </Box>
          <Divider sx={{ fontSize: 11, color: tokens.text3 }}>or</Divider>
          <Button variant="contained" startIcon={<PersonAddAlt1RoundedIcon />} onClick={onCreateNew} fullWidth>
            Create a new member
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function UserDialog({ user, roles, presetRoleId, onClose, onSaved }: {
  user: AdminUser | null; roles: AdminRole[]; presetRoleId?: number; onClose: () => void; onSaved: () => void;
}) {
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [password, setPassword] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<number[]>(user?.roles ?? (presetRoleId ? [presetRoleId] : []));
  const [isActive, setIsActive] = useState(user?.is_active ?? true);
  const [err, setErr] = useState("");
  const myId = useAppSelector((s) => s.auth.user?.id);

  const toggleRole = (id: number) =>
    setSelectedRoles((rs) => (rs.includes(id) ? rs.filter((r) => r !== id) : [...rs, id]));

  const remove = async () => {
    if (!user) return;
    if (!window.confirm(`Delete ${user.full_name || user.username}? This is permanent — if they might return, deactivate instead.`)) return;
    try {
      await deleteUser(user.id);
      onSaved();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: Record<string, string[] | string> } })?.response?.data;
      const first = d && (Object.values(d)[0] as string[] | string | undefined);
      setErr(Array.isArray(first) ? first[0] : (first as string) || "Could not delete this user.");
    }
  };

  const save = async () => {
    if (!username.trim()) { setErr("Username is required."); return; }
    if (!user && !email.trim()) { setErr("Email is required for a new member."); return; }
    if (!user && !password) { setErr("Set a password for the new user."); return; }
    const payload: UserInput = {
      username, email, first_name: firstName, last_name: lastName,
      roles: selectedRoles, is_active: isActive,
    };
    if (password) payload.password = password;
    try {
      if (user) await updateUser(user.id, payload);
      else await createUser(payload);
      onSaved();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: Record<string, string[] | string> } })?.response?.data;
      const first = d && (Object.values(d)[0] as string[] | string | undefined);
      setErr(Array.isArray(first) ? first[0] : (first as string) || "Could not save the user.");
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>{user ? "Edit member" : "New member"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Username" value={username} onChange={(e) => setUsername(e.target.value)} sx={{ flex: 1 }} />
            <TextField size="small" label="Email" required={!user} value={email} onChange={(e) => setEmail(e.target.value)} sx={{ flex: 1 }} />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} sx={{ flex: 1 }} />
            <TextField size="small" label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} sx={{ flex: 1 }} />
          </Stack>
          <TextField size="small" type="password" label={user ? "New password (leave blank to keep)" : "Password"}
            value={password} onChange={(e) => setPassword(e.target.value)} fullWidth />

          <Box>
            <FieldLabel>Roles</FieldLabel>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {roles.map((r) => (
                <FormControlLabel key={r.id}
                  control={<Checkbox size="small" checked={selectedRoles.includes(r.id)} onChange={() => toggleRole(r.id)} />}
                  label={<Typography sx={{ fontSize: 12.5 }}>{r.name}</Typography>} />
              ))}
              {roles.length === 0 && <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>No roles defined.</Typography>}
            </Box>
          </Box>

          <FormControlLabel control={<Switch size="small" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13 }}>Active (can sign in)</Typography>} />

          {user && (
            <>
              <Divider />
              <MembershipAdder userId={user.id} />
            </>
          )}

          {err && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3 }}>
        <Box>
          {user && user.id !== myId && (
            <Tooltip title="Delete user">
              <IconButton onClick={remove} color="error"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
            </Tooltip>
          )}
        </Box>
        <Box>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={save} sx={{ ml: 1 }}>{user ? "Save" : "Create member"}</Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}

function MembershipAdder({ userId }: { userId: number }) {
  const [projects, setProjects] = useState<MiniProject[]>([]);
  const [project, setProject] = useState<number | "">("");
  const [role, setRole] = useState<ProjectRole>("contributor");
  const [msg, setMsg] = useState("");

  useEffect(() => { listMiniProjects().then(setProjects).catch(() => setProjects([])); }, []);

  const add = async () => {
    if (!project) return;
    try {
      await addMembership(userId, Number(project), role);
      const p = projects.find((x) => x.id === project);
      setMsg(`Added to ${p?.code ?? "project"} as ${role}.`);
      setProject("");
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string; non_field_errors?: string[] } } })?.response?.data;
      setMsg(d?.non_field_errors?.[0] || d?.detail || "Could not add — maybe already a member.");
    }
  };

  return (
    <Box>
      <FieldLabel>Add to a project</FieldLabel>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }}>
        <Select size="small" displayEmpty value={project} onChange={(e) => setProject(e.target.value as number)} sx={{ flex: 1, fontSize: 12.5 }}>
          <MenuItem value="" sx={{ fontSize: 12.5, color: tokens.text3 }}>Choose project…</MenuItem>
          {projects.map((p) => <MenuItem key={p.id} value={p.id} sx={{ fontSize: 12.5 }}>{p.code} · {p.name}</MenuItem>)}
        </Select>
        <Select size="small" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)} sx={{ fontSize: 12.5, minWidth: 120 }}>
          {PROJECT_ROLES.map((r) => <MenuItem key={r} value={r} sx={{ fontSize: 12.5, textTransform: "capitalize" }}>{r}</MenuItem>)}
        </Select>
        <Button size="small" variant="outlined" onClick={add} disabled={!project}>Add</Button>
      </Stack>
      {msg && <Typography sx={{ fontSize: 11.5, color: tokens.kriyaInk, mt: 0.5 }}>{msg}</Typography>}
    </Box>
  );
}

function RoleEditorDialog({ role, onClose, onSaved }: { role: AdminRole | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [defaultScope, setDefaultScope] = useState(role?.default_scope ?? "project");
  const [caps, setCaps] = useState<Record<string, { granted: boolean; scope: string }>>(() => {
    const m: Record<string, { granted: boolean; scope: string }> = {};
    for (const c of CAPABILITIES) m[c.value] = { granted: false, scope: "" };
    if (role) for (const rc of role.capabilities) m[rc.capability] = { granted: true, scope: rc.scope || "" };
    return m;
  });
  const [err, setErr] = useState("");

  const setCap = (value: string, patch: Partial<{ granted: boolean; scope: string }>) =>
    setCaps((c) => ({ ...c, [value]: { ...c[value], ...patch } }));

  const save = async () => {
    if (!name.trim()) { setErr("Give the role a name."); return; }
    const capabilities = CAPABILITIES
      .filter((c) => caps[c.value].granted)
      .map((c) => ({ capability: c.value, scope: caps[c.value].scope || "" }));
    const payload: RoleInput = { name, description, default_scope: defaultScope, capabilities };
    try {
      if (role) await updateRole(role.id, payload);
      else await createRole(payload);
      onSaved();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: Record<string, string[] | string> } })?.response?.data;
      const first = d && (Object.values(d)[0] as string[] | string | undefined);
      setErr(Array.isArray(first) ? first[0] : (first as string) || "Could not save the role.");
    }
  };

  const remove = async () => {
    if (!role) return;
    if (!window.confirm(`Delete the role "${role.name}"? Members lose its capabilities.`)) return;
    try { await deleteRole(role.id); onSaved(); } catch { setErr("Could not delete this role."); }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>{role ? `Edit role · ${role.name}` : "New role"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1}>
            <TextField size="small" label="Role name" value={name} onChange={(e) => setName(e.target.value)} sx={{ flex: 1 }} />
            <Select size="small" value={defaultScope} onChange={(e) => setDefaultScope(e.target.value)} sx={{ minWidth: 150, fontSize: 13 }}>
              {SCOPES.map((s) => <MenuItem key={s.value} value={s.value} sx={{ fontSize: 13 }}>Default: {s.label}</MenuItem>)}
            </Select>
          </Stack>
          <TextField size="small" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth />

          <FieldLabel>Permissions — what this role can do, and at what scope</FieldLabel>
          <Stack spacing={0.25}>
            {CAPABILITIES.map((c) => {
              const st = caps[c.value];
              return (
                <Stack key={c.value} direction="row" alignItems="center" spacing={1} sx={{ py: 0.25 }}>
                  <FormControlLabel sx={{ flex: 1, mr: 0 }}
                    control={<Checkbox size="small" checked={st.granted} onChange={() => setCap(c.value, { granted: !st.granted })} />}
                    label={<Typography sx={{ fontSize: 12.5 }}>{c.label}</Typography>} />
                  <Select size="small" disabled={!st.granted} value={st.scope} onChange={(e) => setCap(c.value, { scope: e.target.value })}
                    sx={{ minWidth: 150, fontSize: 12 }}>
                    <MenuItem value="" sx={{ fontSize: 12, color: tokens.text3 }}>Inherit default</MenuItem>
                    {SCOPES.map((s) => <MenuItem key={s.value} value={s.value} sx={{ fontSize: 12 }}>{s.label}</MenuItem>)}
                  </Select>
                </Stack>
              );
            })}
          </Stack>
          {err && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3 }}>
        <Box>
          {role && !role.is_system && (
            <Tooltip title="Delete role">
              <IconButton onClick={remove} color="error"><DeleteOutlineRoundedIcon fontSize="small" /></IconButton>
            </Tooltip>
          )}
        </Box>
        <Box>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={save} sx={{ ml: 1 }}>{role ? "Save" : "Create role"}</Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600 }}>
      {children}
    </Typography>
  );
}
