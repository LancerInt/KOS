import CloudOffRoundedIcon from "@mui/icons-material/CloudOffRounded";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import { Box, Button, Stack, Typography } from "@mui/material";

import { tokens } from "../theme";
import { useOffline } from "./useOffline";

/** A slim banner shown only when offline or with unsynced changes (PRD §25). */
export default function OfflineBanner() {
  const { online, pending, syncNow } = useOffline();
  if (online && pending === 0) return null;

  const offline = !online;
  const bg = offline ? tokens.ink : tokens.kriyaWash;
  const fg = offline ? "#E8EBF0" : tokens.kriyaInk;

  return (
    <Box sx={{ bgcolor: bg, color: fg, px: 3, py: 0.75 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        {offline ? <CloudOffRoundedIcon sx={{ fontSize: 17 }} /> : <SyncRoundedIcon sx={{ fontSize: 17 }} />}
        <Typography sx={{ fontSize: 12.5, flex: 1 }}>
          {offline
            ? `You're offline — comments and checklist ticks are saved and will sync${pending ? ` (${pending} pending)` : ""}.`
            : `${pending} change${pending === 1 ? "" : "s"} waiting to sync.`}
        </Typography>
        {online && pending > 0 && (
          <Button size="small" variant="text" onClick={syncNow} sx={{ color: fg, fontSize: 12, minWidth: 0, px: 1 }}>
            Sync now
          </Button>
        )}
      </Stack>
    </Box>
  );
}
