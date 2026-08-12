import { Box, Stack, Typography } from "@mui/material";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";

import type { MessageAttachment } from "./messagesApi";
import { tokens } from "../../theme";

function fmtSize(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Images inline, voice notes as a player, other files as a download chip.
 *  `mine` tints the file chip to sit on the teal outgoing bubble. */
export default function MessageAttachments({ attachments, mine }: { attachments: MessageAttachment[]; mine: boolean }) {
  if (!attachments?.length) return null;
  const images = attachments.filter((a) => a.kind === "image");
  const audios = attachments.filter((a) => a.kind === "audio");
  const files = attachments.filter((a) => a.kind === "file");

  return (
    <Stack spacing={0.5} sx={{ mb: 0.5 }}>
      {images.length > 0 && (
        <Box sx={{ display: "grid", gap: 0.5, gridTemplateColumns: images.length > 1 ? "1fr 1fr" : "1fr" }}>
          {images.map((a) => (
            <Box key={a.id} component="a" href={a.url} target="_blank" rel="noopener"
              sx={{ display: "block", lineHeight: 0 }}>
              <Box component="img" src={a.url} alt={a.name}
                sx={{ width: "100%", maxWidth: images.length > 1 ? 132 : 240, maxHeight: 260,
                  objectFit: "cover", borderRadius: "10px", display: "block" }} />
            </Box>
          ))}
        </Box>
      )}

      {audios.map((a) => (
        <Box key={a.id} component="audio" controls preload="metadata" src={a.url}
          sx={{ height: 40, width: 232, maxWidth: "100%" }} />
      ))}

      {files.map((a) => (
        <Stack key={a.id} component="a" href={a.url} target="_blank" rel="noopener"
          direction="row" alignItems="center" spacing={1}
          sx={{ textDecoration: "none", p: 1, borderRadius: "9px", minWidth: 180, maxWidth: 268,
            bgcolor: mine ? "rgba(255,255,255,.18)" : tokens.paper,
            border: `1px solid ${mine ? "rgba(255,255,255,.28)" : tokens.line}`,
            color: mine ? "#fff" : tokens.text }}>
          <InsertDriveFileRoundedIcon sx={{ fontSize: 22, flexShrink: 0, color: mine ? "#fff" : tokens.kriyaInk }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>{a.name}</Typography>
            <Typography sx={{ fontSize: 10.5, opacity: 0.8 }}>{fmtSize(a.size)}</Typography>
          </Box>
          <DownloadRoundedIcon sx={{ fontSize: 18, flexShrink: 0, opacity: 0.8 }} />
        </Stack>
      ))}
    </Stack>
  );
}
