import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";

import { useAppDispatch } from "./hooks";
import { restoreSession } from "./features/auth/authSlice";
import ProtectedRoute from "./features/auth/ProtectedRoute";
import AppShell from "./app/AppShell";
import LoginPage from "./pages/LoginPage";
import RolesPage from "./pages/RolesPage";
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import WorkflowPage from "./pages/WorkflowPage";
import SprintBoardPage from "./pages/SprintBoardPage";
import NotificationsPage from "./pages/NotificationsPage";
import MessagesPage from "./pages/MessagesPage";
import RegistersPage from "./pages/RegistersPage";
import DocumentsPage from "./pages/DocumentsPage";
import SOPsPage from "./pages/SOPsPage";
import DashboardPage from "./pages/DashboardPage";
import SearchPage from "./pages/SearchPage";
import AutomationPage from "./pages/AutomationPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import CrmPage from "./pages/CrmPage";
import RegulatoryPage from "./pages/RegulatoryPage";
import WorkspacePage from "./pages/WorkspacePage";
import WorkspaceProjectPage from "./pages/WorkspaceProjectPage";
import WorkspacePermissionsPage from "./pages/WorkspacePermissionsPage";
import UserWorkspaceAccessPage from "./pages/UserWorkspaceAccessPage";
import AiSettingsPage from "./pages/AiSettingsPage";
import LastLoginsPage from "./pages/LastLoginsPage";
import ArchivePage from "./pages/ArchivePage";
import EmailPage from "./pages/EmailPage";

export default function App() {
  const dispatch = useAppDispatch();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    // Restore a session from a stored token, then render.
    dispatch(restoreSession()).finally(() => setBooted(true));
  }, [dispatch]);

  if (!booted) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/reports" element={<Navigate to="/" replace />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/projects/:id/workflow" element={<WorkflowPage />} />
            <Route path="/projects/:id/registers" element={<RegistersPage />} />
            <Route path="/projects/:id/documents" element={<DocumentsPage />} />
            <Route path="/projects/:id/automation" element={<AutomationPage />} />
            <Route path="/sprints/:id" element={<SprintBoardPage />} />
            <Route path="/workspaces/:key" element={<WorkspacePage />} />
            <Route path="/workspaces/:key/projects/:projectId" element={<WorkspaceProjectPage />} />
            <Route path="/sops" element={<SOPsPage />} />
            <Route path="/crm" element={<CrmPage />} />
            <Route path="/regulatory" element={<RegulatoryPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/g/:gid" element={<MessagesPage />} />
            <Route path="/messages/:id" element={<MessagesPage />} />
            <Route path="/email" element={<EmailPage />} />
            <Route path="/admin/roles" element={<RolesPage />} />
            <Route path="/admin/permissions" element={<WorkspacePermissionsPage />} />
            <Route path="/admin/user-access" element={<UserWorkspaceAccessPage />} />
            <Route path="/admin/last-logins" element={<LastLoginsPage />} />
            <Route path="/admin/ai" element={<AiSettingsPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
