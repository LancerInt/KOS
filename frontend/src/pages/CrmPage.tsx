import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Select, Stack, TextField, Typography,
} from "@mui/material";

import {
  convertToProject, createCustomer, createOpportunity, listCustomers, listOpportunities, updateOpportunity,
  type Customer, type Opportunity, type Stage,
} from "../features/crm/crmApi";
import AiActionButton, { AiActionBar } from "../features/ai/AiActionButton";
import { useAiPageContext } from "../features/ai/AiContext";
import { crm as crmAi } from "../features/ai/aiApi";
import { useAppSelector } from "../hooks";
import { tokens, monoFont } from "../theme";

const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "lead", label: "Lead", color: "#9AA3B2" },
  { key: "qualified", label: "Qualified", color: "#2E7DE0" },
  { key: "proposal", label: "Proposal", color: "#7C5CD6" },
  { key: "negotiation", label: "Negotiation", color: "#E0A83D" },
  { key: "won", label: "Won", color: "#2FA36B" },
  { key: "lost", label: "Lost", color: "#A65A6E" },
];

const money = (currency: string, amount: number) =>
  `${currency === "INR" ? "₹" : currency + " "}${Number(amount || 0).toLocaleString()}`;

export default function CrmPage() {
  const caps = useAppSelector((s) => s.auth.user?.effective_capabilities ?? {});
  const canWrite = ["create_tasks", "manage_project", "administer"].some((k) => k in caps);

  const [tab, setTab] = useState<"pipeline" | "customers">("pipeline");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [newOpp, setNewOpp] = useState(false);
  const [newCust, setNewCust] = useState(false);

  const load = () => {
    listCustomers().then(setCustomers).catch(() => setCustomers([]));
    listOpportunities().then(setOpps).catch(() => setOpps([]));
  };
  useEffect(load, []);

  const weightedTotal = useMemo(
    () => opps.filter((o) => o.is_open).reduce((s, o) => s + o.weighted_amount, 0),
    [opps],
  );

  useAiPageContext(
    useMemo(
      () => ({
        label: "CRM & Sales",
        text:
          `The user is viewing the CRM pipeline: ${customers.length} customers, ` +
          `${opps.filter((o) => o.is_open).length} open opportunities, ` +
          `weighted open pipeline ${Math.round(weightedTotal)} INR.`,
      }),
      [customers.length, opps, weightedTotal],
    ),
  );

  return (
    <Box sx={{ maxWidth: 1160, mx: "auto", px: 3, py: 4 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="h1" sx={{ fontSize: 27 }}>CRM &amp; Sales</Typography>
        {canWrite && (
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => setNewCust(true)}>Customer</Button>
            <Button size="small" variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setNewOpp(true)}>Opportunity</Button>
          </Stack>
        )}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: tokens.text3, mb: 2 }}>
        Weighted open pipeline: <Box component="span" sx={{ fontFamily: monoFont, color: tokens.kriyaInk, fontWeight: 600 }}>{money("INR", weightedTotal)}</Box>
      </Typography>

      <Stack direction="row" spacing={0.5} sx={{ borderBottom: `1px solid ${tokens.line}`, mb: 2.5 }}>
        {(["pipeline", "customers"] as const).map((t) => (
          <Box key={t} onClick={() => setTab(t)}
            sx={{ cursor: "pointer", px: 1.5, py: 1.1, fontSize: 13.5, fontWeight: 500, textTransform: "capitalize",
              color: tab === t ? tokens.kriyaInk : tokens.text2, borderBottom: `2px solid ${tab === t ? tokens.kriya : "transparent"}`, mb: "-1px" }}>
            {t}
          </Box>
        ))}
      </Stack>

      {tab === "pipeline" ? (
        <PipelineBoard opps={opps} canWrite={canWrite} reload={load} />
      ) : (
        <CustomersTab customers={customers} />
      )}

      {newOpp && <NewOpportunityDialog customers={customers} onClose={() => setNewOpp(false)} onCreated={() => { setNewOpp(false); load(); }} />}
      {newCust && <NewCustomerDialog onClose={() => setNewCust(false)} onCreated={() => { setNewCust(false); load(); }} />}
    </Box>
  );
}

function PipelineBoard({ opps, canWrite, reload }: { opps: Opportunity[]; canWrite: boolean; reload: () => void }) {
  return (
    <Box sx={{ display: "flex", gap: 1.5, overflowX: "auto", pb: 1 }}>
      {STAGES.map((stage) => {
        const items = opps.filter((o) => o.stage === stage.key);
        const total = items.reduce((s, o) => s + o.amount, 0);
        return (
          <Box key={stage.key} sx={{ minWidth: 210, flex: "0 0 210px" }}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: stage.color }} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{stage.label}</Typography>
              <Typography sx={{ fontFamily: monoFont, fontSize: 11, color: tokens.text3 }}>{items.length}</Typography>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontFamily: monoFont, fontSize: 10.5, color: tokens.text3 }}>{money("INR", total)}</Typography>
            </Stack>
            <Stack spacing={1}>
              {items.map((o) => <OppCard key={o.id} o={o} canWrite={canWrite} reload={reload} />)}
              {items.length === 0 && <Box sx={{ height: 4 }} />}
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

function OppCard({ o, canWrite, reload }: { o: Opportunity; canWrite: boolean; reload: () => void }) {
  const navigate = useNavigate();
  const move = (stage: Stage) => updateOpportunity(o.id, { stage }).then(reload);
  const convert = () => convertToProject(o.id).then((r) => navigate(`/projects/${r.project}`));
  return (
    <Paper sx={{ p: 1.25, borderRadius: 2.5 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{o.title}</Typography>
      <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>{o.customer_name}</Typography>
      <Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: tokens.kriyaInk, mt: 0.5 }}>{money(o.currency, o.amount)}</Typography>
      {canWrite && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          <Select size="small" value={o.stage} onChange={(e) => move(e.target.value as Stage)} sx={{ fontSize: 11.5, height: 28 }}>
            {STAGES.map((s) => <MenuItem key={s.key} value={s.key} sx={{ fontSize: 12 }}>{s.label}</MenuItem>)}
          </Select>
          {o.stage === "won" && !o.project && (
            <Button size="small" variant="outlined" onClick={convert}>Convert to project</Button>
          )}
          {o.project && <Chip label="project created" size="small" sx={{ height: 18, fontSize: 9.5, bgcolor: tokens.kriyaWash, color: tokens.kriyaInk }} />}
        </Stack>
      )}
    </Paper>
  );
}

function CustomersTab({ customers }: { customers: Customer[] }) {
  return (
    <Stack spacing={1}>
      {customers.map((c) => (
        <Paper key={c.id} sx={{ p: 1.5, borderRadius: 3, display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{c.name}</Typography>
              <Chip label={c.status} size="small" sx={{ height: 18, fontSize: 9.5, textTransform: "capitalize", bgcolor: "#F1F3F5", color: tokens.text2 }} />
            </Stack>
            <Typography sx={{ fontSize: 11.5, color: tokens.text3 }}>
              {c.customer_type}{c.industry ? ` · ${c.industry}` : ""}{c.region ? ` · ${c.region}` : ""} · {c.contacts.length} contact{c.contacts.length === 1 ? "" : "s"}
            </Typography>
          </Box>
          <Box sx={{ textAlign: "right" }}>
            <Typography sx={{ fontFamily: monoFont, fontSize: 12.5, color: tokens.kriyaInk }}>{money("INR", c.pipeline_value)}</Typography>
            <Typography sx={{ fontSize: 10.5, color: tokens.text3 }}>{c.open_opportunities} open</Typography>
          </Box>
          <AiActionBar>
            <AiActionButton
              label="Summary"
              title={`Customer summary · ${c.name}`}
              run={() => crmAi.summary(c.id)}
            />
            <AiActionButton
              label="Draft reply"
              title={`Draft a reply to ${c.name}`}
              fields={[
                {
                  name: "incoming_message",
                  label: "Their message",
                  placeholder: "Paste the customer's email or enquiry…",
                  multiline: true,
                  required: true,
                },
                { name: "intent", label: "What should the reply do? (optional)", placeholder: "e.g. confirm delivery date and offer a call" },
              ]}
              run={(v) => crmAi.reply(c.id, v.incoming_message, { intent: v.intent })}
            />
            <AiActionButton
              label="Proposal"
              title={`Proposal for ${c.name}`}
              fields={[
                {
                  name: "brief",
                  label: "Brief",
                  placeholder: "What is being proposed, scope, commercial notes…",
                  multiline: true,
                  required: true,
                },
              ]}
              run={(v) => crmAi.proposal(c.id, v.brief)}
            />
          </AiActionBar>
        </Paper>
      ))}
      {customers.length === 0 && <Typography sx={{ fontSize: 13.5, color: tokens.text3 }}>No customers yet.</Typography>}
    </Stack>
  );
}

function NewOpportunityDialog({ customers, onClose, onCreated }: { customers: Customer[]; onClose: () => void; onCreated: () => void }) {
  const [customer, setCustomer] = useState<number | "">(customers[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<Stage>("lead");
  const [err, setErr] = useState("");
  const create = async () => {
    if (!customer || !title.trim()) { setErr("Customer and title are required."); return; }
    await createOpportunity({ customer: Number(customer), title, amount: Number(amount) || 0, stage });
    onCreated();
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>New opportunity</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Select size="small" value={customer} displayEmpty onChange={(e) => setCustomer(e.target.value as number)} fullWidth>
            <MenuItem value="" disabled sx={{ fontSize: 13 }}>Select customer…</MenuItem>
            {customers.map((c) => <MenuItem key={c.id} value={c.id} sx={{ fontSize: 13 }}>{c.name}</MenuItem>)}
          </Select>
          <TextField size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />
          <TextField size="small" label="Amount (₹)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} fullWidth />
          <Select size="small" value={stage} onChange={(e) => setStage(e.target.value as Stage)} fullWidth>
            {STAGES.map((s) => <MenuItem key={s.key} value={s.key} sx={{ fontSize: 13 }}>{s.label}</MenuItem>)}
          </Select>
          {err && <Typography sx={{ fontSize: 12.5, color: tokens.attn }}>{err}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={create}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}

function NewCustomerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("company");
  const [industry, setIndustry] = useState("");
  const [region, setRegion] = useState("");
  const create = async () => {
    if (!name.trim()) return;
    await createCustomer({ name, customer_type: type as Customer["customer_type"], industry, region });
    onCreated();
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontFamily: '"Manrope Variable"', fontSize: 19 }}>New customer</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <TextField size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <Select size="small" value={type} onChange={(e) => setType(e.target.value)} fullWidth>
            {["company", "individual", "government", "distributor"].map((t) => <MenuItem key={t} value={t} sx={{ fontSize: 13, textTransform: "capitalize" }}>{t}</MenuItem>)}
          </Select>
          <TextField size="small" label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} fullWidth />
          <TextField size="small" label="Region" value={region} onChange={(e) => setRegion(e.target.value)} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={create}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}
