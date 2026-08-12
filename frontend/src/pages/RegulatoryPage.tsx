import { useEffect, useState } from "react";
import { useAutoRefresh } from "../useAutoRefresh";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Select, Stack, TextField, Typography,
} from "@mui/material";

import {
  createRegistration, listRegistrations, transitionRegistration,
  type Authority, type Registration, type RegStatus,
} from "../features/regulatory/regulatoryApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const REG_COLOR: Record<RegStatus, string> = {
  draft: tokens.text3, submitted: "#2E7DE0", under_review: "#7C5CD6", query_raised: "#E0A83D",
  approved: "#2FA36B", rejected: tokens.attn, renewal_due: "#E0A83D", expired: tokens.attn,
};
const REG_ACTION_LABEL: Record<RegStatus, string> = {
  draft: "Send back to draft", submitted: "Submit", under_review: "Move to review",
  query_raised: "Raise query", approved: "Approve", rejected: "Reject",
  renewal_due: "Mark renewal due", expired: "Mark expired",
};
const AUTHORITIES: { v: Authority; l: string }[] = [
  { v: "cibrc", l: "CIBRC" }, { v: "epa", l: "US EPA" }, { v: "state", l: "State Dept" }, { v: "other", l: "Other" },
];

export default function RegulatoryPage() {
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canWrite = ["create_tasks", "manage_project", "administer"].some((k) => k in caps);
  const [regs, setRegs] = useState<Registration[]>([]);
  const [open, setOpen] = useState(false);

  const load = () => { listRegistrations().then(setRegs).catch(() => setRegs([])); };
  useEffect(() => { load(); }, []);
  useAutoRefresh(load);

  return (
    <Box sx={{ px: 3, py: 2.5 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="h1" sx={{ fontSize: 27 }}>Regulatory</Typography>
        {canWrite && <Button size="small" variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setOpen(true)}>New registration</Button>}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2.5 }}>
        Product registrations (CIBRC / EPA) — lifecycle, dossiers and renewal reminders.
      </Typography>

      <Stack spacing={1.25}>
        {regs.map((r) => <RegCard key={r.id} reg={r} canWrite={canWrite} reload={load} />)}
        {regs.length === 0 && <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No registrations yet.</Typography>}
      </Stack>

      {open && <NewRegistrationDialog onClose={() => setOpen(false)} onCreated={() => { setOpen(false); load(); }} />}
    </Box>
  );
}

function RegCard({ reg, canWrite, reload }: { reg: Registration; canWrite: boolean; reload: () => void }) {
  const move = (to: RegStatus) =>
    transitionRegistration(reg.id, to).then(reload).catch((e) => alert(e?.response?.data?.to || e?.response?.data?.detail || "Transition not allowed."));
  return (
    <Paper sx={{ p: 1.75, borderRadius: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>{reg.product_name}</Typography>
        <Chip label={reg.status_display} size="small" sx={{ height: 20, fontSize: 10.5, color: REG_COLOR[reg.status], bgcolor: `${REG_COLOR[reg.status]}1a` }} />
        <Chip label={reg.authority_display.split(" ")[0]} size="small" sx={{ height: 20, fontSize: 10, bgcolor: "#F1F3F5", color: tokens.text2 }} />
        <ExpiryBadge reg={reg} />
      </Stack>
      <Typography sx={{ fontSize: 11.5, color: tokens.text3, mt: 0.4 }}>
        {reg.category || "—"}
        {reg.registration_number && <> · <Box component="span" sx={{ fontFamily: monoFont }}>{reg.registration_number}</Box></>}
        {reg.owner_name && ` · ${reg.owner_name}`}
      </Typography>

      {reg.document_titles.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.75 }}>
          <DescriptionRoundedIcon sx={{ fontSize: 14, color: tokens.text3 }} />
          <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>{reg.document_titles.length} document{reg.document_titles.length === 1 ? "" : "s"}</Typography>
        </Stack>
      )}

      {canWrite && reg.next_stages.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.25 }} flexWrap="wrap" useFlexGap>
          {reg.next_stages.map((to) => (
            <Button key={to} size="small" variant={to === "approved" ? "contained" : "outlined"}
              color={to === "rejected" || to === "expired" ? "error" : "primary"} onClick={() => move(to)}>
              {REG_ACTION_LABEL[to]}
            </Button>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function ExpiryBadge({ reg }: { reg: Registration }) {
  if (!reg.expiry_date) return null;
  if (reg.is_expired) return <Chip label="Expired" size="small" sx={{ height: 20, fontSize: 10.5, color: tokens.attn, bgcolor: tokens.attnWash }} />;
  const days = reg.expires_in_days;
  const soon = days !== null && days <= reg.reminder_lead_days;
  return (
    <Chip label={soon ? `Renews in ${days}d` : `Valid to ${reg.expiry_date}`} size="small"
      sx={{ height: 20, fontSize: 10.5, fontFamily: soon ? undefined : monoFont, color: soon ? "#B26A00" : tokens.text3, bgcolor: soon ? "#FBEFD6" : "#F1F3F5" }} />
  );
}

function NewRegistrationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [productName, setProductName] = useState("");
  const [authority, setAuthority] = useState<Authority>("cibrc");
  const [category, setCategory] = useState("");
  const [expiry, setExpiry] = useState("");
  const create = async () => {
    if (!productName.trim()) return;
    await createRegistration({ product_name: productName, authority, category, expiry_date: expiry || null });
    onCreated();
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>New registration</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <TextField size="small" label="Product name" value={productName} onChange={(e) => setProductName(e.target.value)} fullWidth />
          <Select size="small" value={authority} onChange={(e) => setAuthority(e.target.value as Authority)} fullWidth>
            {AUTHORITIES.map((a) => <MenuItem key={a.v} value={a.v} sx={{ fontSize: 13 }}>{a.l}</MenuItem>)}
          </Select>
          <TextField size="small" label="Category" placeholder="Insecticide, Fungicide…" value={category} onChange={(e) => setCategory(e.target.value)} fullWidth />
          <TextField size="small" type="date" label="Expiry / valid until" InputLabelProps={{ shrink: true }} value={expiry} onChange={(e) => setExpiry(e.target.value)} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={create}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}
