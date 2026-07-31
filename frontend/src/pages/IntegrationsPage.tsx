import { useEffect, useState, type ReactNode } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import {
  Box, Button, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Paper, Select, Stack, Switch, TextField, Typography,
} from "@mui/material";

import {
  createConnection, deleteConnection, listConnections, listDeliveries, listEvents, listInbound,
  retryDelivery, testConnection, updateConnection,
  type AuthScheme, type ConnectionInput, type ErpConnection, type EventOption,
  type InboundEvent, type WebhookDelivery,
} from "../features/integrations/integrationsApi";
import {
  getEmailAccount, updateEmailAccount, testEmailAccount, type EmailAccount, type EmailAccountInput,
} from "../features/notifications/notificationsApi";
import { tokens, monoFont } from "../theme";

const DSTATUS: Record<string, string> = {
  delivered: "#2FA36B", mocked: tokens.kriya, pending: "#E0A83D", failed: tokens.attn,
};

export default function IntegrationsPage() {
  const [tab, setTab] = useState<"connections" | "deliveries" | "inbound" | "email">("connections");
  const [forbidden, setForbidden] = useState(false);
  const onForbidden = () => setForbidden(true);

  if (forbidden) {
    return (
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
        <Typography variant="h1" sx={{ fontSize: 27, mb: 1 }}>Integrations</Typography>
        <Typography sx={{ color: tokens.attn, fontSize: 14 }}>ERP integration settings are restricted to administrators.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1080, mx: "auto", px: 3, py: 4 }}>
      <Typography variant="h1" sx={{ fontSize: 27, mb: 0.5 }}>ERP integration</Typography>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2 }}>
        Publish events to the ERP and accept updates back — signed, logged and retried.
      </Typography>

      <Stack direction="row" spacing={0.5} sx={{ borderBottom: `1px solid ${tokens.line}`, mb: 2.5 }}>
        {(["connections", "deliveries", "inbound", "email"] as const).map((t) => (
          <Box key={t} onClick={() => setTab(t)}
            sx={{ cursor: "pointer", px: 1.5, py: 1.1, fontSize: 13.5, fontWeight: 500, textTransform: "capitalize",
              color: tab === t ? tokens.kriyaInk : tokens.text2,
              borderBottom: `2px solid ${tab === t ? tokens.kriya : "transparent"}`, mb: "-1px" }}>
            {t}
          </Box>
        ))}
      </Stack>

      {tab === "connections" && <ConnectionsTab onForbidden={onForbidden} />}
      {tab === "deliveries" && <DeliveriesTab onForbidden={onForbidden} />}
      {tab === "inbound" && <InboundTab onForbidden={onForbidden} />}
      {tab === "email" && <EmailTab onForbidden={onForbidden} />}
    </Box>
  );
}

function ConnectionsTab({ onForbidden }: { onForbidden: () => void }) {
  const [connections, setConnections] = useState<ErpConnection[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [editing, setEditing] = useState<ErpConnection | "new" | null>(null);

  const load = () => listConnections().then(setConnections).catch((e) => { if (e?.response?.status === 403) onForbidden(); });
  useEffect(() => { load(); listEvents().then(setEvents).catch(() => {}); /* eslint-disable-next-line */ }, []);

  const toggle = (c: ErpConnection) => updateConnection(c.id, { is_active: !c.is_active }).then(load);
  const test = (c: ErpConnection) => testConnection(c.id).then(() => load());
  const remove = (c: ErpConnection) => { if (window.confirm(`Delete connection "${c.name}"?`)) deleteConnection(c.id).then(load); };

  return (
    <>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1.5 }}>
        <Button variant="contained" size="small" startIcon={<AddRoundedIcon />} onClick={() => setEditing("new")}>New connection</Button>
      </Stack>

      <Stack spacing={1.25}>
        {connections.map((c) => (
          <Paper key={c.id} sx={{ p: 1.75, borderRadius: "6px", opacity: c.is_active ? 1 : 0.6 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
              <Typography sx={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{c.name}</Typography>
              <Chip label={c.mock_mode ? "mock" : "live"} size="small"
                sx={{ height: 19, fontSize: 10, color: c.mock_mode ? tokens.kriyaInk : "#2FA36B", bgcolor: c.mock_mode ? tokens.kriyaWash : "#E7F5EE" }} />
              {c.inbound_enabled && <Chip label="inbound" size="small" sx={{ height: 19, fontSize: 10, bgcolor: "#F1F3F5", color: tokens.text2 }} />}
              <Switch size="small" checked={c.is_active} onChange={() => toggle(c)} />
            </Stack>
            <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text3, mb: 0.75 }} noWrap>{c.base_url}</Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              {c.subscribed_events.length === 0 && <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>No events subscribed.</Typography>}
              {c.subscribed_events.map((e) => (
                <Chip key={e} label={e} size="small" sx={{ height: 18, fontSize: 9.5, fontFamily: monoFont, bgcolor: "#F1F3F5", color: tokens.text2 }} />
              ))}
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Button size="small" variant="outlined" startIcon={<SendRoundedIcon sx={{ fontSize: 15 }} />} onClick={() => test(c)}>Send test</Button>
              <Button size="small" variant="text" startIcon={<EditRoundedIcon sx={{ fontSize: 15 }} />} onClick={() => setEditing(c)}>Edit</Button>
              <Button size="small" variant="text" color="error" startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />} onClick={() => remove(c)}>Delete</Button>
              <Box sx={{ flex: 1 }} />
              {c.last_delivery_at && <Typography sx={{ fontSize: 11, color: tokens.text3 }}>last: {new Date(c.last_delivery_at).toLocaleString()}</Typography>}
            </Stack>
          </Paper>
        ))}
        {connections.length === 0 && <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No ERP connections configured.</Typography>}
      </Stack>

      {editing && (
        <ConnectionDialog conn={editing === "new" ? null : editing} events={events}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}

function ConnectionDialog({ conn, events, onClose, onSaved }: {
  conn: ErpConnection | null; events: EventOption[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(conn?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(conn?.base_url ?? "");
  const [secret, setSecret] = useState("");
  const [authScheme, setAuthScheme] = useState<AuthScheme>(conn?.auth_scheme ?? "none");
  const [authToken, setAuthToken] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState(conn?.auth_header_name ?? "X-API-Key");
  const [subscribed, setSubscribed] = useState<string[]>(conn?.subscribed_events ?? []);
  const [mockMode, setMockMode] = useState(conn?.mock_mode ?? true);
  const [inbound, setInbound] = useState(conn?.inbound_enabled ?? false);
  const [err, setErr] = useState("");

  const toggleEvent = (value: string) =>
    setSubscribed((s) => (s.includes(value) ? s.filter((v) => v !== value) : [...s, value]));

  const save = async () => {
    if (!name.trim() || !baseUrl.trim()) { setErr("Name and endpoint URL are required."); return; }
    const payload: ConnectionInput = {
      name, base_url: baseUrl, auth_scheme: authScheme, auth_header_name: authHeaderName,
      subscribed_events: subscribed, mock_mode: mockMode, inbound_enabled: inbound,
    };
    if (secret) payload.secret = secret;
    if (authToken) payload.auth_token = authToken;
    try {
      if (conn) await updateConnection(conn.id, payload);
      else await createConnection(payload);
      onSaved();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string; base_url?: string[] } } })?.response?.data;
      setErr(d?.detail || d?.base_url?.[0] || "Could not save the connection.");
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>{conn ? "Edit connection" : "New ERP connection"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <TextField size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <TextField size="small" label="Endpoint URL" placeholder="https://erp.example/webhooks/kos" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} fullWidth />
          <TextField size="small" type="password" label="Signing secret (HMAC)" placeholder={conn?.has_secret ? "•••••• (leave blank to keep)" : "Shared secret"} value={secret} onChange={(e) => setSecret(e.target.value)} fullWidth />

          <Stack direction="row" spacing={1}>
            <Select size="small" value={authScheme} onChange={(e) => setAuthScheme(e.target.value as AuthScheme)} sx={{ fontSize: 13, minWidth: 130 }}>
              <MenuItem value="none" sx={{ fontSize: 13 }}>No auth</MenuItem>
              <MenuItem value="bearer" sx={{ fontSize: 13 }}>Bearer token</MenuItem>
              <MenuItem value="header" sx={{ fontSize: 13 }}>Custom header</MenuItem>
            </Select>
            {authScheme !== "none" && (
              <TextField size="small" type="password" label="Token" placeholder="leave blank to keep" value={authToken} onChange={(e) => setAuthToken(e.target.value)} sx={{ flex: 1 }} />
            )}
            {authScheme === "header" && (
              <TextField size="small" label="Header" value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} sx={{ width: 120 }} />
            )}
          </Stack>

          <Box>
            <FieldLabel>Publish these events</FieldLabel>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
              {events.map((ev) => (
                <FormControlLabel key={ev.value}
                  control={<Checkbox size="small" checked={subscribed.includes(ev.value)} onChange={() => toggleEvent(ev.value)} />}
                  label={<Typography sx={{ fontSize: 12.5 }}>{ev.label}</Typography>} />
              ))}
            </Box>
          </Box>

          <Stack direction="row" spacing={2}>
            <FormControlLabel control={<Switch size="small" checked={mockMode} onChange={(e) => setMockMode(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 13 }}>Mock mode (simulate delivery)</Typography>} />
            <FormControlLabel control={<Switch size="small" checked={inbound} onChange={(e) => setInbound(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 13 }}>Accept inbound</Typography>} />
          </Stack>
          {err && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>{conn ? "Save" : "Create"}</Button>
      </DialogActions>
    </Dialog>
  );
}

function DeliveriesTab({ onForbidden }: { onForbidden: () => void }) {
  const [rows, setRows] = useState<WebhookDelivery[]>([]);
  const load = () => listDeliveries().then(setRows).catch((e) => { if (e?.response?.status === 403) onForbidden(); });
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <Paper sx={{ borderRadius: "6px", overflow: "hidden" }}>
      {rows.map((d, i) => <DeliveryRow key={d.id} d={d} first={i === 0} onRetried={load} />)}
      {rows.length === 0 && <Typography sx={{ fontSize: 13.5, color: tokens.text3, p: 2 }}>No deliveries yet — subscribe a connection to an event, or send a test.</Typography>}
    </Paper>
  );
}

function DeliveryRow({ d, first, onRetried }: { d: WebhookDelivery; first: boolean; onRetried: () => void }) {
  const [open, setOpen] = useState(false);
  const color = DSTATUS[d.status] ?? tokens.text3;
  const canRetry = d.status === "failed" || d.status === "pending";
  return (
    <Box sx={{ borderTop: first ? "none" : `1px solid ${tokens.line}` }}>
      <Box sx={{ px: 1.75, py: 1.1, display: "flex", alignItems: "center", gap: 1.25 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }} />
        <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text2, width: 170, flexShrink: 0 }} noWrap>{d.event_type}</Typography>
        <Typography sx={{ fontSize: 12.5, flex: 1 }} noWrap>{d.connection_name}</Typography>
        <Chip label={d.status} size="small" sx={{ height: 19, fontSize: 10, color, bgcolor: `${color}1a` }} />
        <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>×{d.attempts}</Typography>
        {canRetry && <Button size="small" variant="text" startIcon={<ReplayRoundedIcon sx={{ fontSize: 15 }} />} onClick={() => retryDelivery(d.id).then(onRetried)}>Retry</Button>}
        <ExpandMoreRoundedIcon onClick={() => setOpen((v) => !v)} sx={{ fontSize: 18, color: tokens.text3, cursor: "pointer", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 4.25, pb: 1.5, bgcolor: tokens.paper }}>
          {d.error && <Typography sx={{ fontSize: 12, color: tokens.attn, mb: 0.5 }}>{d.error}</Typography>}
          {d.response_status != null && <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>HTTP {d.response_status} · {new Date(d.created_at).toLocaleString()}</Typography>}
          <Typography sx={{ fontFamily: monoFont, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", mt: 0.5 }}>
            {JSON.stringify(d.payload, null, 2)}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
}

function InboundTab({ onForbidden }: { onForbidden: () => void }) {
  const [rows, setRows] = useState<InboundEvent[]>([]);
  useEffect(() => {
    listInbound().then(setRows).catch((e) => { if (e?.response?.status === 403) onForbidden(); });
    // eslint-disable-next-line
  }, []);

  return (
    <>
      <Paper sx={{ p: 1.75, borderRadius: "6px", mb: 2, bgcolor: tokens.kriyaWash, borderColor: tokens.kriyaWash }}>
        <Typography sx={{ fontSize: 12.5, color: tokens.kriyaInk }}>
          The ERP posts signed events to <Box component="code" sx={{ fontFamily: monoFont, fontSize: 11.5 }}>POST /api/integrations/inbound/</Box> with an
          <Box component="code" sx={{ fontFamily: monoFont, fontSize: 11.5 }}> X-KOS-Signature</Box> HMAC header. Enable "Accept inbound" on a connection first.
        </Typography>
      </Paper>
      <Paper sx={{ borderRadius: "6px", overflow: "hidden" }}>
        {rows.map((e, i) => (
          <Box key={e.id} sx={{ px: 1.75, py: 1.1, display: "flex", alignItems: "center", gap: 1.25, borderTop: i === 0 ? "none" : `1px solid ${tokens.line}` }}>
            <Typography sx={{ fontFamily: monoFont, fontSize: 11.5, color: tokens.text2, width: 150, flexShrink: 0 }} noWrap>{e.event_type || "—"}</Typography>
            <Typography sx={{ fontSize: 12.5, flex: 1 }} noWrap>{e.result || e.connection_name}</Typography>
            <Chip label={e.status} size="small" sx={{ height: 19, fontSize: 10, bgcolor: "#F1F3F5", color: tokens.text2 }} />
            <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>{new Date(e.created_at).toLocaleString()}</Typography>
          </Box>
        ))}
        {rows.length === 0 && <Typography sx={{ fontSize: 13.5, color: tokens.text3, p: 2 }}>No inbound events received.</Typography>}
      </Paper>
    </>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: tokens.text3, fontWeight: 600, mb: 0.5 }}>{children}</Typography>;
}

function EmailTab({ onForbidden }: { onForbidden: () => void }) {
  const [acct, setAcct] = useState<EmailAccount | null>(null);
  const [form, setForm] = useState<EmailAccountInput>({});
  const [password, setPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    getEmailAccount()
      .then((a) => { setAcct(a); setForm({ host: a.host, port: a.port, use_tls: a.use_tls, username: a.username, from_email: a.from_email, is_enabled: a.is_enabled }); })
      .catch((e) => { if (e?.response?.status === 403) onForbidden(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (patch: EmailAccountInput) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true); setStatus(null);
    try {
      const payload: EmailAccountInput = { ...form };
      if (password) payload.password = password;
      const a = await updateEmailAccount(payload);
      setAcct(a); setPassword("");
      setStatus({ ok: true, msg: "Saved." });
    } catch {
      setStatus({ ok: false, msg: "Could not save." });
    } finally { setSaving(false); }
  };

  const sendTest = async () => {
    setTesting(true); setStatus(null);
    try {
      const r = await testEmailAccount({ ...form, ...(password ? { password } : {}), to: testTo || form.username });
      setStatus({ ok: r.ok, msg: r.detail });
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setStatus({ ok: false, msg: detail ?? "Test failed." });
    } finally { setTesting(false); }
  };

  if (!acct) return <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={26} /></Stack>;

  return (
    <Box sx={{ maxWidth: 620 }}>
      <Typography sx={{ fontSize: 13.5, color: tokens.text2, mb: 2 }}>
        The account KOS sends notification &amp; AI emails <b>from</b>. For Gmail, use your address and a
        16‑character <b>App Password</b> (Google Account → Security → App passwords). Stored encrypted;
        leave blank to keep the current one. If disabled, KOS falls back to the server default.
      </Typography>

      <Paper sx={{ p: 2.5, borderRadius: "6px" }}>
        <Stack spacing={2}>
          <FormControlLabel
            control={<Switch checked={!!form.is_enabled} onChange={(e) => set({ is_enabled: e.target.checked })} />}
            label={<Typography sx={{ fontSize: 13.5 }}>Send emails through this account</Typography>} />

          <Box>
            <FieldLabel>Sender email (SMTP login)</FieldLabel>
            <TextField size="small" fullWidth placeholder="yourname@gmail.com" value={form.username ?? ""}
              onChange={(e) => set({ username: e.target.value })} />
          </Box>
          <Box>
            <FieldLabel>App password</FieldLabel>
            <TextField size="small" fullWidth type="password"
              placeholder={acct.has_password ? "•••••••••••• (saved — leave blank to keep)" : "16-character app password"}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Box>
          <Box>
            <FieldLabel>From address (optional)</FieldLabel>
            <TextField size="small" fullWidth placeholder="defaults to the sender email" value={form.from_email ?? ""}
              onChange={(e) => set({ from_email: e.target.value })} />
          </Box>
          <Stack direction="row" spacing={1.5}>
            <Box sx={{ flex: 1 }}>
              <FieldLabel>SMTP host</FieldLabel>
              <TextField size="small" fullWidth value={form.host ?? ""} onChange={(e) => set({ host: e.target.value })} />
            </Box>
            <Box sx={{ width: 90 }}>
              <FieldLabel>Port</FieldLabel>
              <TextField size="small" fullWidth type="number" value={form.port ?? 587}
                onChange={(e) => set({ port: Number(e.target.value) })} />
            </Box>
            <Box sx={{ pt: 2.75 }}>
              <FormControlLabel control={<Checkbox size="small" checked={!!form.use_tls} onChange={(e) => set({ use_tls: e.target.checked })} />}
                label={<Typography sx={{ fontSize: 13 }}>TLS</Typography>} />
            </Box>
          </Stack>

          <Box sx={{ borderTop: `1px dashed ${tokens.line}`, pt: 2 }}>
            <FieldLabel>Send a test to</FieldLabel>
            <Stack direction="row" spacing={1}>
              <TextField size="small" fullWidth placeholder={form.username || "you@example.com"} value={testTo}
                onChange={(e) => setTestTo(e.target.value)} />
              <Button variant="outlined" startIcon={<SendRoundedIcon sx={{ fontSize: 16 }} />} onClick={sendTest}
                disabled={testing} sx={{ flexShrink: 0 }}>
                {testing ? "Sending…" : "Send test"}
              </Button>
            </Stack>
          </Box>

          {status && (
            <Typography sx={{ fontSize: 12.5, color: status.ok ? "#2FA36B" : tokens.attn }}>{status.msg}</Typography>
          )}

          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button variant="contained" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            {acct.updated_at && <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>Updated {new Date(acct.updated_at).toLocaleString()}</Typography>}
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
