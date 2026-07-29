import { Navigate, Outlet } from "react-router-dom";

import { useAppSelector } from "../../hooks";

/** Gate for authenticated routes. Server still enforces every request (§7.7);
 * this only controls navigation. */
export default function ProtectedRoute() {
  const user = useAppSelector((s) => s.auth.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
