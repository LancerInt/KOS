import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Avatar, Box, Drawer, Stack, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import HubRoundedIcon from "@mui/icons-material/HubRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";

import { useAppDispatch, useAppSelector } from "../hooks";
import { logout } from "../features/auth/authSlice";
import { unreadCount } from "../features/notifications/notificationsApi";
import { messagesUnreadCount } from "../features/messages/messagesApi";
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
    { to: "/messages", label: "Messages", icon: <ForumRoundedIcon fontSize="small" /> },
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
  const [msgUnread, setMsgUnread] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      unreadCount().then((r) => { if (active) setUnread(r.unread); }).catch(() => {});
      messagesUnreadCount().then((r) => { if (active) setMsgUnread(r.unread); }).catch(() => {});
    };
    refresh();
    // Keep the sidebar badges honest without a full navigation: the
    // Notifications and Messages pages both clear items in place (no route
    // change), other tabs/devices add new ones. Re-read on focus, on the
    // explicit change events those pages fire, and on a slow interval as a
    // backstop.
    const onChanged = () => refresh();
    const onFocus = () => { if (document.visibilityState !== "hidden") refresh(); };
    window.addEventListener("kos:notifications-changed", onChanged);
    window.addEventListener("kos:messages-changed", onChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      active = false;
      window.removeEventListener("kos:notifications-changed", onChanged);
      window.removeEventListener("kos:messages-changed", onChanged);
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

  // Below md the rail would eat most of a phone's width, so it moves into a
  // drawer opened from a button in the top bar. The rail renders once and is
  // placed in whichever container the width calls for.
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [navOpen, setNavOpen] = useState(false);
  // Never collapsed inside the drawer: it is already a temporary surface, and
  // icon-only rows there would be a second thing to decipher.
  const railCollapsed = isMobile ? false : collapsed;

  // Navigating closes it. Without this the menu stays open over the very page
  // the user just asked for.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  const initials =
    (user?.first_name?.[0] ?? user?.username?.[0] ?? "?").toUpperCase() +
    (user?.last_name?.[0]?.toUpperCase() ?? "");

  const logoutBtn = (
    <Tooltip title="Sign out" placement={railCollapsed ? "right" : "top"}>
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

  const rail = (
    <Box sx={{ background: RAIL.gradient, color: RAIL.text, display: "flex", flexDirection: "column",
      p: railCollapsed ? 1 : 1.5, overflow: "hidden", height: "100%", minHeight: 0 }}>
        {/* brand (Kriya mark + KOS) + collapse toggle */}
        <Stack direction={railCollapsed ? "column" : "row"} alignItems="center" justifyContent={railCollapsed ? "center" : "space-between"}
          spacing={railCollapsed ? 0.75 : 0} sx={{ px: railCollapsed ? 0 : 0.75, py: 1, mb: 1, minWidth: 0 }}>
          {railCollapsed ? brandMark : (
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
              {brandMark}
              <Typography sx={{ color: RAIL.brand, fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 17, letterSpacing: "0.03em" }}>KOS</Typography>
            </Stack>
          )}
          {/* Collapsing is a desktop affordance; in the drawer the same corner
              is where a close button belongs. */}
          <Tooltip title={isMobile ? "Close menu" : railCollapsed ? "Expand" : "Collapse"} placement="right">
            <Box component="button"
              onClick={isMobile ? () => setNavOpen(false) : toggleCollapsed}
              aria-label={isMobile ? "Close menu" : railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              sx={{ border: "none", bgcolor: "transparent", color: RAIL.text, cursor: "pointer", display: "flex", p: 0.5, borderRadius: 1, flexShrink: 0,
                "&:hover": { color: RAIL.textHover, bgcolor: RAIL.hoverBg } }}>
              {isMobile ? <CloseRoundedIcon fontSize="small" />
                : railCollapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
            </Box>
          </Tooltip>
        </Stack>

        {/* nav — the rail's own scroll area, between the fixed brand row above
            and the fixed identity/logout row below. A long workspace list
            scrolls here without disturbing the page beside it. The scrollbar is
            restyled because the browser default is drawn for a light surface
            and reads as a bright stripe down the teal rail. */}
        <Stack spacing={0.25} sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
          overscrollBehavior: "contain",
          scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,.22) transparent",
          "&::-webkit-scrollbar": { width: 6 },
          "&::-webkit-scrollbar-thumb": { backgroundColor: "rgba(255,255,255,.22)", borderRadius: 3 },
          "&:hover::-webkit-scrollbar-thumb": { backgroundColor: "rgba(255,255,255,.34)" },
          "&::-webkit-scrollbar-track": { backgroundColor: "transparent" } }}>
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
                  railCollapsed ? (
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
                ) : (railCollapsed ? (
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
                    const badge = n.to === "/notifications" ? unread : n.to === "/messages" ? msgUnread : 0;
                    const showBadge = badge > 0;
                    return (
                      <Tooltip key={n.to} title={railCollapsed ? n.label : ""} placement="right" arrow>
                        <Box component={Link} to={n.to}
                          sx={{ position: "relative", display: "flex", alignItems: "center",
                            justifyContent: railCollapsed ? "center" : "flex-start",
                            gap: railCollapsed ? 0 : 1.25, px: railCollapsed ? 0 : 1.25, py: 1, borderRadius: "8px",
                            textDecoration: "none", fontSize: 13.5,
                            color: active ? RAIL.activeText : RAIL.text,
                            bgcolor: active ? RAIL.activeBg : "transparent",
                            boxShadow: active && !railCollapsed ? `inset 2px 0 0 ${RAIL.accent}` : "none",
                            "&:hover": { bgcolor: active ? RAIL.activeHoverBg : RAIL.hoverBg, color: active ? RAIL.activeText : RAIL.textHover } }}>
                          <Box sx={{ color: active ? RAIL.accent : "inherit", display: "flex" }}>{n.icon}</Box>
                          {!railCollapsed && n.label}
                          {!railCollapsed && showBadge && (
                            <Box sx={{ ml: "auto", minWidth: 18, height: 18, px: 0.5, borderRadius: 9, bgcolor: tokens.attn, color: "#fff", fontSize: 10.5, fontWeight: 700, display: "grid", placeItems: "center" }}>
                              {badge}
                            </Box>
                          )}
                          {railCollapsed && showBadge && (
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
          {railCollapsed ? (
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
  );

  return (
    <AiProvider>
    {/* The shell is a fixed-height frame, not a page that grows: the rail and
        the content are two independent scroll areas side by side. Growing (the
        old `minHeight`) gave the document a single scrollbar, so paging through
        a long project carried the whole sidebar off the top of the screen and
        the nav could only be reached by scrolling back up. `dvh` where it's
        supported, so mobile browser chrome doesn't clip the bottom row. */}
    <Box sx={{ display: "grid", height: "100vh", overflow: "hidden",
      "@supports (height: 100dvh)": { height: "100dvh" },
      gridTemplateColumns: isMobile ? "1fr" : railCollapsed ? "64px 1fr" : "232px 1fr",
      transition: "grid-template-columns .18s ease" }}>
      {/* The rail: a column of the grid on desktop, a temporary drawer below md.
          Anchored right so it opens under the thumb that reached the button. */}
      {isMobile ? (
        <Drawer anchor="right" open={navOpen} onClose={() => setNavOpen(false)}
          PaperProps={{ sx: { width: 264, maxWidth: "86vw", border: "none", bgcolor: "transparent" } }}>
          {rail}
        </Drawer>
      ) : rail}

      {/* main — the other scroll area. `minHeight: 0` is what actually lets it
          scroll: a grid item defaults to min-height:auto and would otherwise
          stretch to its content and push the frame open again. `contain` stops
          a flick past the end of this pane from scrolling anything behind it. */}
      <Box sx={{ bgcolor: "background.default", height: "100%", minHeight: 0, minWidth: 0,
        overflowY: "auto", overflowX: "auto", overscrollBehavior: "contain" }}>
        {isMobile && (
          <Stack direction="row" alignItems="center" justifyContent="space-between"
            sx={{ position: "sticky", top: 0, zIndex: 5, px: 2, py: 1,
              background: RAIL.gradient, color: RAIL.text }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
              {brandMark}
              <Typography sx={{ color: RAIL.brand, fontFamily: '"Manrope Variable"', fontWeight: 600, fontSize: 17, letterSpacing: "0.03em" }}>
                KOS
              </Typography>
            </Stack>
            <Box component="button" onClick={() => setNavOpen(true)} aria-label="Open menu"
              sx={{ position: "relative", border: "none", bgcolor: "transparent", color: RAIL.text,
                cursor: "pointer", display: "flex", p: 0.75, borderRadius: 1, flexShrink: 0,
                "&:hover": { color: RAIL.textHover, bgcolor: RAIL.hoverBg } }}>
              <MenuRoundedIcon />
              {/* The unread badges live on nav rows that are now hidden, so
                  they have to surface on the thing that opens the nav. */}
              {unread + msgUnread > 0 && (
                <Box sx={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%",
                  bgcolor: tokens.attn, border: `1.5px solid ${RAIL.bg}` }} />
              )}
            </Box>
          </Stack>
        )}
        <OfflineBanner />
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
