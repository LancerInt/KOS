import { useEffect, useMemo, useState } from "react";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import { tokens, monoFont } from "../theme";

/**
 * Classic Prev/Next paging — a small, shared control plus a hook that slices an
 * in-memory list a page at a time. Deliberately client-side: the lists it pages
 * (notifications, records, projects, archive) are already loaded whole so their
 * totals/tab-counts stay correct; this just spares the user an endless scroll.
 */

export const DEFAULT_PAGE_SIZE = 20;

export interface Paged<T> {
  page: number;
  setPage: (p: number) => void;
  pageCount: number;
  total: number;
  pageItems: T[];
  next: () => void;
  prev: () => void;
}

export function usePaged<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE): Paged<T> {
  const [page, setPage] = useState(1);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // When the list shrinks (a filter tightens, a row is dismissed) the current
  // page can fall past the end — clamp back so we never show an empty page.
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);
  const start = (page - 1) * pageSize;
  const pageItems = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);
  return {
    page, setPage, pageCount, total, pageItems,
    next: () => setPage((p) => Math.min(pageCount, p + 1)),
    prev: () => setPage((p) => Math.max(1, p - 1)),
  };
}

interface PagerProps {
  page: number;
  pageCount: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  /** Noun for the count, e.g. "notifications", "records". */
  unit?: string;
  sx?: SxProps<Theme>;
}

export default function Pager({ page, pageCount, total, onPrev, onNext, unit = "items", sx }: PagerProps) {
  // Nothing to page through — stay out of the way entirely.
  if (pageCount <= 1) return null;
  return (
    <Stack direction="row" alignItems="center" justifyContent="center" spacing={1}
      sx={{ py: 1.5, ...sx }}>
      <IconButton size="small" onClick={onPrev} disabled={page <= 1} aria-label="Previous page"
        sx={{ border: `1px solid ${tokens.line}` }}>
        <ChevronLeftRoundedIcon fontSize="small" />
      </IconButton>
      <Box sx={{ textAlign: "center", minWidth: 132 }}>
        <Typography sx={{ fontFamily: monoFont, fontSize: 12, color: tokens.text2, lineHeight: 1.3 }}>
          Page {page} / {pageCount}
        </Typography>
        <Typography sx={{ fontSize: 11, color: tokens.text3, lineHeight: 1.2 }}>
          {total} {unit}
        </Typography>
      </Box>
      <IconButton size="small" onClick={onNext} disabled={page >= pageCount} aria-label="Next page"
        sx={{ border: `1px solid ${tokens.line}` }}>
        <ChevronRightRoundedIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}
