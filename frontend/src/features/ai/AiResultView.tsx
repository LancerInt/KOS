import { Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";

import { tokens } from "../../theme";
import type { AiOutcome } from "./aiApi";

/**
 * One renderer for every AI action.
 *
 * All endpoints return the same envelope and the JSON contracts share a small
 * vocabulary of keys (`summary`, `risks`, `recommendations`, `sections`…), so
 * this renders whichever of those are present rather than needing a component
 * per action. An unrecognised shape still renders legibly.
 *
 * **Colour policy:** the brand teal and neutrals only. Severity is carried by
 * order, weight and a mono label — never by hue. A traffic-light palette here
 * would both fight the calm of the rest of KOS and imply a precision these
 * judgements do not have.
 */

/** Most severe first. Anything unrecognised sorts last. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  warning: 1,
  medium: 2,
  low: 3,
  info: 3,
};

function rank(value: unknown): number {
  return SEVERITY_RANK[String(value ?? "").toLowerCase()] ?? 4;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 11px / uppercase / .06em — the section label used across KOS. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      sx={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: tokens.text3, mb: 0.75 }}
    >
      {children}
    </Typography>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Label>{title}</Label>
      {children}
    </Box>
  );
}

/** Severity as a mono caps label; the leading item is set in ink. */
function Severity({ value, lead }: { value: string; lead?: boolean }) {
  if (!value) return null;
  return (
    <Typography
      sx={{
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 10,
        letterSpacing: ".09em",
        textTransform: "uppercase",
        color: lead ? tokens.ink : tokens.text3,
        fontWeight: lead ? 600 : 400,
        mb: 0.25,
      }}
    >
      {value}
    </Typography>
  );
}

function Bullets({ items }: { items: unknown[] }) {
  const list = items.filter((i) => typeof i === "string" && i.trim()) as string[];
  if (!list.length) return null;
  return (
    <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
      {list.map((item, index) => (
        <Typography key={index} component="li" sx={{ fontSize: 13.5, lineHeight: 1.6 }}>
          {item}
        </Typography>
      ))}
    </Stack>
  );
}

function Prose({ text }: { text: string }) {
  return <Typography sx={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{text}</Typography>;
}

/** A panel in the finding list. The leading (most severe) item is emphasised. */
function Finding({ lead, children }: { lead?: boolean; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        p: 1.5,
        bgcolor: tokens.paper,
        border: `1px solid ${tokens.line}`,
        borderLeft: lead ? `2px solid ${tokens.kriya}` : `1px solid ${tokens.line}`,
        borderRadius: "6px",
      }}
    >
      {children}
    </Box>
  );
}

/** Mirrors ProgressBar in features/projects/display — same teal, same metrics. */
function ScoreBar({ score, label }: { score: number; label: string }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <Typography
        sx={{ fontFamily: '"Manrope Variable"', fontSize: 32, fontWeight: 700, color: tokens.kriyaInk, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}
      >
        {score}
      </Typography>
      <Box sx={{ flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <Typography sx={{ fontSize: 12.5, color: tokens.text2 }}>Health score</Typography>
          {label && (
            <Chip
              size="small"
              label={label.replace(/_/g, " ")}
              sx={{ height: 20, fontSize: 10.5, textTransform: "capitalize", bgcolor: "#F1F3F5", color: tokens.text2 }}
            />
          )}
        </Stack>
        <LinearProgress
          variant="determinate"
          value={Math.max(0, Math.min(100, score))}
          sx={{
            height: 6,
            borderRadius: 3,
            bgcolor: "#EEF0F3",
            "& .MuiLinearProgress-bar": {
              borderRadius: 3,
              background: `linear-gradient(90deg, ${tokens.kriya}, ${tokens.kriyaGlow})`,
            },
          }}
        />
      </Box>
    </Stack>
  );
}

export default function AiResultView({ outcome }: { outcome: AiOutcome<object> }) {
  // The model ignored the JSON contract — show what it did say rather than nothing.
  if (!outcome.structured) {
    return <Prose text={outcome.text || "The AI returned an empty response."} />;
  }

  const data = outcome.data as Record<string, unknown>;
  const blocks: React.ReactNode[] = [];
  const push = (key: string, node: React.ReactNode) => blocks.push(<Box key={key}>{node}</Box>);

  // --- headline figures ---------------------------------------------------- //
  const score = Number(data.health_score);
  if (data.health_score !== undefined && data.health_score !== "" && data.health_score !== null && !Number.isNaN(score)) {
    push("score", <ScoreBar score={score} label={asText(data.health_label)} />);
  }

  const chips = [
    asText(data.risk_level) && `Risk: ${asText(data.risk_level)}`,
    asText(data.urgency) && `Urgency: ${asText(data.urgency)}`,
    asText(data.sentiment) && `Tone: ${asText(data.sentiment)}`,
    asText(data.relationship_health) && `Relationship: ${asText(data.relationship_health)}`,
    asText(data.overall_rating) && `Rating: ${asText(data.overall_rating).replace(/_/g, " ")}`,
  ].filter(Boolean) as string[];

  if (chips.length) {
    push(
      "chips",
      <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
        {chips.map((chip) => (
          <Chip
            key={chip}
            size="small"
            label={chip}
            sx={{ height: 20, fontSize: 10.5, textTransform: "capitalize", bgcolor: "#F1F3F5", color: tokens.text2 }}
          />
        ))}
      </Stack>,
    );
  }

  // --- narrative ----------------------------------------------------------- //
  const headline = asText(data.headline);
  if (headline) push("headline", <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{headline}</Typography>);

  for (const key of ["summary", "executive_summary", "explanation", "reasoning"]) {
    const value = asText(data[key]);
    if (value) {
      push(key, <Prose text={value} />);
      break;
    }
  }

  // --- rewritten / translated text ----------------------------------------- //
  const rewritten = asText(data.text);
  if (rewritten) {
    push(
      "text",
      <Section title="Suggested text">
        <Box sx={{ p: 1.5, bgcolor: tokens.paper, border: `1px solid ${tokens.line}`, borderRadius: "6px" }}>
          <Prose text={rewritten} />
        </Box>
      </Section>,
    );
  }
  if (asArray(data.changes).length) {
    push("changes", <Section title="What changed"><Bullets items={asArray(data.changes)} /></Section>);
  }

  // --- email --------------------------------------------------------------- //
  if (asText(data.subject) || asText(data.body)) {
    push(
      "email",
      <Section title="Draft email">
        <Box sx={{ border: `1px solid ${tokens.line}`, borderRadius: "6px", overflow: "hidden" }}>
          <Box sx={{ px: 1.5, py: 1, bgcolor: tokens.paper, borderBottom: `1px solid ${tokens.line}` }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{asText(data.subject)}</Typography>
          </Box>
          <Box sx={{ px: 1.5, py: 1.25 }}>
            <Prose text={asText(data.body)} />
          </Box>
        </Box>
      </Section>,
    );
  }

  // --- structured lists ---------------------------------------------------- //
  const listSections: [string, string][] = [
    ["key_points", "Key points"],
    ["highlights", "Highlights"],
    ["decisions", "Decisions"],
    ["achievements", "Achievements"],
    ["strengths", "Strengths"],
    ["areas_for_improvement", "Areas for improvement"],
    ["trends", "Trends"],
    ["assumptions", "Assumptions"],
    ["key_takeaways", "Key takeaways"],
    ["watch_outs", "Watch out for"],
    ["open_questions", "Open questions"],
    ["responsibilities", "Responsibilities"],
    ["required_qualifications", "Required qualifications"],
    ["preferred_qualifications", "Preferred qualifications"],
    ["skills", "Skills"],
    ["recommended_order", "Recommended order"],
    ["action_items", "Action items"],
    ["next_actions", "Next actions"],
    ["next_steps", "Next steps"],
    ["recommendations", "Recommendations"],
  ];

  for (const [key, title] of listSections) {
    const items = asArray(data[key]);
    if (!items.length) continue;

    // action_items can be objects ({action, owner, due_in_days}) or strings.
    if (typeof items[0] === "object" && items[0] !== null) {
      push(
        key,
        <Section title={title}>
          <Stack spacing={0.75}>
            {items.map((item, index) => {
              const entry = item as Record<string, unknown>;
              const main = asText(entry.action) || asText(entry.title) || asText(entry.heading);
              const owner = asText(entry.owner);
              const due = Number(entry.due_in_days) || 0;
              return (
                <Finding key={index}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{main}</Typography>
                  {(owner || due > 0) && (
                    <Typography sx={{ fontSize: 12, color: tokens.text2, mt: 0.25 }}>
                      {owner && `Owner: ${owner}`}
                      {owner && due > 0 && " · "}
                      {due > 0 && `Due in ${due} day${due === 1 ? "" : "s"}`}
                    </Typography>
                  )}
                </Finding>
              );
            })}
          </Stack>
        </Section>,
      );
    } else {
      push(key, <Section title={title}><Bullets items={items} /></Section>);
    }
  }

  // --- risks --------------------------------------------------------------- //
  const risks = [...asArray(data.risks)].sort(
    (a, b) => rank((a as Record<string, unknown>)?.severity) - rank((b as Record<string, unknown>)?.severity),
  );
  if (risks.length) {
    push(
      "risks",
      <Section title="Risks">
        <Stack spacing={0.75}>
          {risks.map((risk, index) => {
            if (typeof risk === "string") {
              return (
                <Typography key={index} sx={{ fontSize: 13.5 }}>
                  • {risk}
                </Typography>
              );
            }
            const entry = risk as Record<string, unknown>;
            const severity = asText(entry.severity);
            // Only the leading risk is emphasised; rank carries the rest.
            const lead = index === 0 && rank(severity) <= 1;
            return (
              <Finding key={index} lead={lead}>
                <Severity value={severity} lead={lead} />
                <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{asText(entry.title)}</Typography>
                {asText(entry.impact) && (
                  <Typography sx={{ fontSize: 12.5, color: tokens.text2, mt: 0.5 }}>{asText(entry.impact)}</Typography>
                )}
                {asText(entry.mitigation) && (
                  <Typography sx={{ fontSize: 12.5, mt: 0.5 }}>
                    <strong>Mitigation:</strong> {asText(entry.mitigation)}
                  </Typography>
                )}
              </Finding>
            );
          })}
        </Stack>
      </Section>,
    );
  }

  // --- delay prediction ---------------------------------------------------- //
  const delay = data.delay_prediction as Record<string, unknown> | undefined;
  if (delay && typeof delay === "object") {
    const willSlip = delay.will_be_delayed === true || asText(delay.will_be_delayed) === "true";
    const days = Number(delay.estimated_delay_days) || 0;
    push(
      "delay",
      <Section title="Delay prediction">
        <Finding lead={willSlip}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
            {willSlip
              ? `Likely to slip by about ${days} day${days === 1 ? "" : "s"}`
              : "On track to meet the target date"}
            {asText(delay.confidence) && ` · ${asText(delay.confidence)} confidence`}
          </Typography>
          {asText(delay.reasoning) && (
            <Typography sx={{ fontSize: 12.5, color: tokens.text2, mt: 0.5 }}>{asText(delay.reasoning)}</Typography>
          )}
        </Finding>
      </Section>,
    );
  }

  // --- insights ------------------------------------------------------------ //
  const insights = [...asArray(data.insights)].sort(
    (a, b) => rank((a as Record<string, unknown>)?.severity) - rank((b as Record<string, unknown>)?.severity),
  );
  if (insights.length) {
    push(
      "insights",
      <Section title="Insights">
        <Stack spacing={0.75}>
          {insights.map((item, index) => {
            const entry = item as Record<string, unknown>;
            const severity = asText(entry.severity);
            const lead = index === 0 && rank(severity) <= 1;
            return (
              <Finding key={index} lead={lead}>
                <Severity value={severity} lead={lead} />
                <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{asText(entry.title)}</Typography>
                <Typography sx={{ fontSize: 12.5, color: tokens.text2, mt: 0.25 }}>{asText(entry.detail)}</Typography>
              </Finding>
            );
          })}
        </Stack>
      </Section>,
    );
  }

  // --- estimate ------------------------------------------------------------ //
  if (data.estimated_hours !== undefined && data.estimated_hours !== "") {
    push(
      "estimate",
      <Section title="Effort estimate">
        <Stack direction="row" alignItems="baseline" spacing={1}>
          <Typography
            sx={{ fontFamily: '"Manrope Variable"', fontSize: 30, fontWeight: 700, lineHeight: 1, color: tokens.kriyaInk, fontVariantNumeric: "tabular-nums" }}
          >
            {String(data.estimated_hours)}
          </Typography>
          <Typography sx={{ fontSize: 13, color: tokens.text2 }}>hours</Typography>
          {(Number(data.range_low_hours) > 0 || Number(data.range_high_hours) > 0) && (
            <Typography sx={{ fontSize: 12.5, color: tokens.text3 }}>
              (range {String(data.range_low_hours)}–{String(data.range_high_hours)}h ·{" "}
              {asText(data.confidence)} confidence)
            </Typography>
          )}
        </Stack>
      </Section>,
    );
  }

  // --- priority suggestion -------------------------------------------------- //
  if (asText(data.suggested_priority)) {
    push(
      "priority",
      <Section title="Suggested priority">
        <Stack direction="row" spacing={0.75}>
          <Chip
            size="small"
            label={asText(data.suggested_priority)}
            sx={{ height: 20, fontSize: 10.5, textTransform: "capitalize", bgcolor: tokens.kriyaWash, color: tokens.kriyaInk, fontWeight: 600 }}
          />
          {asText(data.suggested_risk_level) && (
            <Chip
              size="small"
              label={`Risk: ${asText(data.suggested_risk_level)}`}
              sx={{ height: 20, fontSize: 10.5, textTransform: "capitalize", bgcolor: "#F1F3F5", color: tokens.text2 }}
            />
          )}
        </Stack>
      </Section>,
    );
  }

  // --- generic sections (reports, proposals) -------------------------------- //
  const sections = asArray(data.sections);
  if (sections.length) {
    push(
      "sections",
      <Stack spacing={1.5}>
        {sections.map((item, index) => {
          const entry = item as Record<string, unknown>;
          return (
            <Box key={index}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>{asText(entry.heading)}</Typography>
              <Prose text={asText(entry.content)} />
            </Box>
          );
        })}
      </Stack>,
    );
  }

  // --- subtask / task suggestions ------------------------------------------ //
  const suggestions = [...asArray(data.subtasks), ...asArray(data.tasks)];
  if (suggestions.length) {
    push(
      "suggestions",
      <Section title="Suggestions">
        <Stack spacing={0.5}>
          {suggestions.map((item, index) => {
            const entry = typeof item === "string" ? { title: item } : (item as Record<string, unknown>);
            return (
              <Finding key={index}>
                <Typography sx={{ fontSize: 13.5 }}>{asText(entry.title)}</Typography>
                {asText(entry.reason) && (
                  <Typography sx={{ fontSize: 12, color: tokens.text3 }}>{asText(entry.reason)}</Typography>
                )}
              </Finding>
            );
          })}
        </Stack>
      </Section>,
    );
  }

  // --- duplicates & workload ------------------------------------------------ //
  const duplicates = asArray(data.duplicates);
  if (duplicates.length) {
    push(
      "duplicates",
      <Section title="Possible duplicates">
        <Stack spacing={0.5}>
          {duplicates.map((item, index) => {
            const entry = item as Record<string, unknown>;
            return (
              <Typography key={index} sx={{ fontSize: 13 }}>
                Task {asText(entry.id)} ↔ {asText(entry.duplicate_of)} ({asText(entry.confidence)}) —{" "}
                {asText(entry.reason)}
              </Typography>
            );
          })}
        </Stack>
      </Section>,
    );
  }

  for (const [key, title] of [
    ["overloaded", "Overloaded"],
    ["underutilised", "Has capacity"],
    ["burnout_risks", "Burnout risk"],
  ] as [string, string][]) {
    const items = asArray(data[key]);
    if (!items.length) continue;
    push(
      key,
      <Section title={title}>
        <Stack spacing={0.5}>
          {items.map((item, index) => {
            const entry = item as Record<string, unknown>;
            const detail = asText(entry.reason) || asText(entry.capacity_note) || asArray(entry.signals).join(", ");
            return (
              <Typography key={index} sx={{ fontSize: 13 }}>
                <strong>{asText(entry.person)}</strong>
                {detail && ` — ${detail}`}
              </Typography>
            );
          })}
        </Stack>
      </Section>,
    );
  }

  // Nothing matched a known key — show the payload rather than an empty panel.
  if (!blocks.length) {
    return (
      <Box component="pre" sx={{ fontSize: 12, whiteSpace: "pre-wrap", fontFamily: "monospace", m: 0 }}>
        {JSON.stringify(data, null, 2)}
      </Box>
    );
  }

  // Spacing separates the blocks; full-width rules between every one read as noise.
  return <Stack spacing={2.25}>{blocks}</Stack>;
}
