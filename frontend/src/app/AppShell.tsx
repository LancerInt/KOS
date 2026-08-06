import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Avatar, Box, InputAdornment, Stack, TextField, Tooltip, Typography } from "@mui/material";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import HubRoundedIcon from "@mui/icons-material/HubRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import QueryStatsRoundedIcon from "@mui/icons-material/QueryStatsRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";

import { useAppDispatch, useAppSelector } from "../hooks";
import { logout } from "../features/auth/authSlice";
import { unreadCount } from "../features/notifications/notificationsApi";
import { useWorkspaces } from "../features/workspaces/workspaces";
import NewWorkspaceDialog from "../features/workspaces/NewWorkspaceDialog";
import { useMyAccess, accessLevel } from "../features/workspaces/access";
import { AiProvider } from "../features/ai/AiContext";
import AiAssistantDrawer from "../features/ai/AiAssistantDrawer";
import OfflineBanner from "../offline/OfflineBanner";
import { tokens } from "../theme";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  capability?: string;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

// The sidebar is organised into labelled sections (matching the approved home
// mockup): a personal top block, the operational Workspaces, and the
// cross-cutting Platform tools. Capability-gated items drop out per user, and a
// section header is hidden whenever all of its items are filtered away.
// The static groups. The Workspaces group is built at render time from
// useWorkspaces() (built-ins + user-added), so new/restored ones appear live.
const NAV_TOP: NavGroup = {
  items: [
    { to: "/", label: "Dashboard", icon: <HomeRoundedIcon fontSize="small" /> },
    { to: "/notifications", label: "Notifications", icon: <NotificationsRoundedIcon fontSize="small" /> },
    { to: "/workload", label: "Workload", icon: <QueryStatsRoundedIcon fontSize="small" /> },
  ],
};
const NAV_PLATFORM: NavGroup = {
  title: "Platform",
  items: [
    // Everyone can connect their own email here; ERP tabs inside are IT/Management-only.
    { to: "/integrations", label: "Integrations", icon: <HubRoundedIcon fontSize="small" /> },
    { to: "/admin/ai", label: "AI Automation", icon: <AutoAwesomeRoundedIcon fontSize="small" />, capability: "administer" },
    { to: "/admin/roles", label: "Roles & Access", icon: <AdminPanelSettingsRoundedIcon fontSize="small" />, capability: "administer" },
    // Archive is for everyone — your own deleted items; IT/Management see all deletions.
    { to: "/archive", label: "Archive", icon: <Inventory2RoundedIcon fontSize="small" /> },
  ],
};

// Sidebar palette — deep teal rail.
const RAIL = {
  bg: "#0C3E47",
  gradient: "linear-gradient(180deg,#0E4A55,#0A343C)",
  border: "rgba(255,255,255,.10)",
  text: "rgba(255,255,255,.72)",
  textHover: "#FFFFFF",
  activeBg: "rgba(255,255,255,.12)",
  activeHoverBg: "rgba(255,255,255,.17)",
  activeText: "#FFFFFF",
  accent: "#16B8C9",
  hoverBg: "rgba(255,255,255,.06)",
  header: "rgba(255,255,255,.45)",
  brand: "#FFFFFF",
};

function GlobalSearchBar() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const submit = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <Box sx={{ position: "sticky", top: 0, zIndex: 5, bgcolor: "rgba(251,250,246,.85)", backdropFilter: "blur(6px)",
      borderBottom: `1px solid ${tokens.line}`, px: 3, py: 1.1 }}>
      <TextField
        size="small" placeholder="Search everything…  (press Enter)" value={q}
        onChange={(e) => setQ(e.target.value)} onKeyDown={submit}
        InputProps={{ startAdornment: (
          <InputAdornment position="start"><SearchRoundedIcon sx={{ fontSize: 18, color: tokens.text3 }} /></InputAdornment>
        ) }}
        sx={{ width: "100%", maxWidth: 460, "& .MuiOutlinedInput-root": { bgcolor: tokens.surface, borderRadius: 2 } }}
      />
    </Box>
  );
}

export default function AppShell() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAppSelector((s) => s.auth.user);
  const caps = user?.effective_capabilities ?? {};
  const { mine, loading: accessLoading } = useMyAccess();
  const workspaces = useWorkspaces();
  const [newWsOpen, setNewWsOpen] = useState(false);

  // Built-ins + user-added workspaces, rebuilt whenever the dynamic set changes.
  const NAV: NavGroup[] = [
    NAV_TOP,
    {
      title: "Workspaces",
      items: workspaces.map((w) => ({ to: `/workspaces/${w.key}`, label: w.label, icon: <w.Icon fontSize="small" /> })),
    },
    NAV_PLATFORM,
  ];

  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => { unreadCount().then((r) => { if (active) setUnread(r.unread); }).catch(() => {}); };
    refresh();
    // Keep the sidebar badge honest without a full navigation: the Notifications
    // page marks items read in place (no route change), other tabs/devices add
    // new ones. Re-read on focus, on an explicit change event the page fires,
    // and on a slow interval as a backstop.
    const onChanged = () => refresh();
    const onFocus = () => { if (document.visibilityState !== "hidden") refresh(); };
    window.addEventListener("kos:notifications-changed", onChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      active = false;
      window.removeEventListener("kos:notifications-changed", onChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(timer);
    };
  }, [location.pathname]);

  const [markError, setMarkError] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("kos_sidebar_collapsed") === "1");
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("kos_sidebar_collapsed", next ? "1" : "0");
      return next;
    });

  const initials =
    (user?.first_name?.[0] ?? user?.username?.[0] ?? "?").toUpperCase() +
    (user?.last_name?.[0]?.toUpperCase() ?? "");

  const logoutBtn = (
    <Tooltip title="Sign out" placement={collapsed ? "right" : "top"}>
      <Box component="button" onClick={() => dispatch(logout())}
        sx={{ border: "none", bgcolor: "transparent", color: RAIL.text, cursor: "pointer", display: "flex", p: 0.5, borderRadius: 1,
          "&:hover": { color: RAIL.textHover, bgcolor: RAIL.hoverBg } }}>
        <LogoutRoundedIcon fontSize="small" />
      </Box>
    </Tooltip>
  );

  const brandMark = markError ? (
    <Box sx={{ width: 30, height: 30, borderRadius: "8px", flexShrink: 0,
      background: `linear-gradient(150deg, ${tokens.kriyaGlow}, ${tokens.kriya})`,
      display: "grid", placeItems: "center", color: "#fff", fontFamily: '"Manrope Variable", sans-serif', fontWeight: 700, fontSize: 15 }}>K</Box>
  ) : (
    <Box component="img" src="/kriya-mark-t.png" alt="Kriya" onError={() => setMarkError(true)}
      sx={{ width: 30, height: 30, objectFit: "contain", flexShrink: 0, display: "block" }} />
  );

  return (
    <AiProvider>
    <Box sx={{ display: "grid", gridTemplateColumns: collapsed ? "64px 1fr" : "232px 1fr", minHeight: "100vh",
      transition: "grid-template-columns .18s ease" }}>
      {/* Teal sidebar */}
      <Box sx={{ background: RAIL.gradient, color: RAIL.text, display: "flex", flexDirection: "column", p: collapsed ? 1 : 1.5, overflow: "hidden" }}>
        {/* brand (Kriya mark + KOS) + collapse toggle */}
        <Stack direction={collapsed ? "column" : "row"} alignItems="center" justifyContent={collapsed ? "center" : "space-between"}
          spacing={collapsed ? 0.75 : 0} sx={{ px: collapsed ? 0 : 0.75, py: 1, mb: 1, minWidth: 0 }}>
          {collapsed ? brandMark : (
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
              {brandMark}
              <Typography sx={{ color: RAIL.brand, fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 17, letterSpacing: "0.03em" }}>KOS</Typography>
            </Stack>
          )}
          <Tooltip title={collapsed ? "Expand" : "Collapse"} placement="right">
            <Box component="button" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              sx={{ border: "none", bgcolor: "transparent", color: RAIL.text, cursor: "pointer", display: "flex", p: 0.5, borderRadius: 1, flexShrink: 0,
                "&:hover": { color: RAIL.textHover, bgcolor: RAIL.hoverBg } }}>
              {collapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
            </Box>
          </Tooltip>
        </Stack>

        {/* nav */}
        <Stack spacing={0.25} sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
          {NAV.map((group, gi) => {
            const items = group.items.filter((n) => {
              if (n.capability && !(n.capability in caps)) return false;
              // Workspace links appear only where the user has at least view access.
              if (n.to.startsWith("/workspaces/")) {
                if (accessLoading) return false; // reveal once access resolves — avoids flashing hidden ones
                return accessLevel(mine, n.to.slice("/workspaces/".length)) !== "none";
              }
              return true;
            });
            if (items.length === 0) return null;
            return (
              <Box key={group.title ?? `g${gi}`} sx={{ mb: 0.75 }}>
                {group.title && (group.title === "Workspaces" ? (
                  collapsed ? (
                    <Tooltip title="New workspace" placement="right" arrow>
                      <Box component="button" onClick={() => setNewWsOpen(true)}
                        sx={{ display: "flex", mx: "auto", my: 0.75, p: 0.5, border: "none", bgcolor: "transparent", cursor: "pointer",
                          color: RAIL.text, borderRadius: 1, "&:hover": { color: RAIL.textHover, bgcolor: RAIL.hoverBg } }}>
                        <AddRoundedIcon fontSize="small" />
                      </Box>
                    </Tooltip>
                  ) : (
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pl: 1.25, pr: 0.25, pt: gi === 0 ? 0 : 1, pb: 0.75 }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", color: RAIL.header }}>
                        {group.title}
                      </Typography>
                      <Tooltip title="New workspace" arrow>
                        <Box component="button" aria-label="New workspace" onClick={() => setNewWsOpen(true)}
                          sx={{ display: "flex", p: 0.25, border: "none", bgcolor: "transparent", cursor: "pointer",
                            color: RAIL.header, borderRadius: 1, "&:hover": { color: RAIL.textHover, bgcolor: RAIL.hoverBg } }}>
                          <AddRoundedIcon sx={{ fontSize: 16 }} />
                        </Box>
                      </Tooltip>
                    </Stack>
                  )
                ) : (collapsed ? (
                  <Box sx={{ height: "1px", bgcolor: RAIL.border, mx: 1, my: 0.75 }} />
                ) : (
                  <Typography sx={{ px: 1.25, pt: gi === 0 ? 0 : 1, pb: 0.75, fontSize: 10, fontWeight: 700,
                    letterSpacing: ".09em", textTransform: "uppercase", color: RAIL.header }}>
                    {group.title}
                  </Typography>
                )))}
                <Stack spacing={0.5}>
                  {items.map((n) => {
                    const active = n.to === "/" ? location.pathname === "/" : location.pathname.startsWith(n.to);
                    const showBadge = n.to === "/notifications" && unread > 0;
                    return (
                      <Tooltip key={n.to} title={collapsed ? n.label : ""} placement="right" arrow>
                        <Box component={Link} to={n.to}
                          sx={{ position: "relative", display: "flex", alignItems: "center",
                            justifyContent: collapsed ? "center" : "flex-start",
                            gap: collapsed ? 0 : 1.25, px: collapsed ? 0 : 1.25, py: 1, borderRadius: "8px",
                            textDecoration: "none", fontSize: 13.5,
                            color: active ? RAIL.activeText : RAIL.text,
                            bgcolor: active ? RAIL.activeBg : "transparent",
                            boxShadow: active && !collapsed ? `inset 2px 0 0 ${RAIL.accent}` : "none",
                            "&:hover": { bgcolor: active ? RAIL.activeHoverBg : RAIL.hoverBg, color: active ? RAIL.activeText : RAIL.textHover } }}>
                          <Box sx={{ color: active ? RAIL.accent : "inherit", display: "flex" }}>{n.icon}</Box>
                          {!collapsed && n.label}
                          {!collapsed && showBadge && (
                            <Box sx={{ ml: "auto", minWidth: 18, height: 18, px: 0.5, borderRadius: 9, bgcolor: tokens.attn, color: "#fff", fontSize: 10.5, fontWeight: 700, display: "grid", placeItems: "center" }}>
                              {unread}
                            </Box>
                          )}
                          {collapsed && showBadge && (
                            <Box sx={{ position: "absolute", top: 5, right: 9, width: 7, height: 7, borderRadius: "50%", bgcolor: tokens.attn, border: `1.5px solid ${RAIL.bg}` }} />
                          )}
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Stack>
              </Box>
            );
          })}
        </Stack>

        {/* footer: identity + logout */}
        <Box sx={{ mt: "auto", pt: 1.5, borderTop: `1px solid ${RAIL.border}` }}>
          {collapsed ? (
            <Stack alignItems="center" spacing={1} sx={{ py: 0.5 }}>
              <Tooltip title={user?.full_name || user?.username || ""} placement="right">
                <Avatar sx={{ width: 30, height: 30, bgcolor: tokens.kriyaInk, fontSize: 12, fontFamily: '"Manrope Variable"' }}>
                  {initials}
                </Avatar>
              </Tooltip>
              {logoutBtn}
            </Stack>
          ) : (
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 0.5, py: 0.5 }}>
              <Avatar sx={{ width: 30, height: 30, bgcolor: tokens.kriyaInk, fontSize: 12, fontFamily: '"Manrope Variable"' }}>
                {initials}
              </Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography noWrap sx={{ color: RAIL.brand, fontSize: 12.5, fontWeight: 500 }}>
                  {user?.full_name || user?.username}
                </Typography>
                <Typography noWrap sx={{ color: RAIL.header, fontSize: 11 }}>
                  {user?.role_names?.[0] ?? "No role"}
                </Typography>
              </Box>
              {logoutBtn}
            </Stack>
          )}
        </Box>
      </Box>

      {/* main */}
      <Box sx={{ bgcolor: "background.default", overflowY: "auto", minWidth: 0 }}>
        <OfflineBanner />
        <GlobalSearchBar />
        <Outlet />
      </Box>

      {/* Floating assistant — available from every page (AI spec §Frontend). */}
      <AiAssistantDrawer />

      <NewWorkspaceDialog open={newWsOpen} onClose={() => setNewWsOpen(false)}
        onCreated={(key) => { setNewWsOpen(false); navigate(`/workspaces/${key}`); }} />
    </Box>
    </AiProvider>
  );
}
