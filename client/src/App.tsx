import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { Role } from "./api/types";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { AdminTicketPage } from "./pages/admin/AdminTicket";
import { QueuePage } from "./pages/admin/Queue";
import { MyBooksPage } from "./pages/author/MyBooks";
import { MyTicketsPage } from "./pages/author/MyTickets";
import { NewTicketPage } from "./pages/author/NewTicket";
import { LoginPage } from "./pages/Login";

function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={user.role === "admin" ? "/admin/tickets" : "/books"} replace />;
  return <>{children}</>;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "admin" ? "/admin/tickets" : "/books"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/books" element={<RequireRole role="author"><MyBooksPage /></RequireRole>} />
        <Route path="/tickets/new" element={<RequireRole role="author"><NewTicketPage /></RequireRole>} />
        <Route path="/tickets" element={<RequireRole role="author"><MyTicketsPage /></RequireRole>} />
        <Route path="/tickets/:ticketId" element={<RequireRole role="author"><MyTicketsPage /></RequireRole>} />
        <Route path="/admin/tickets" element={<RequireRole role="admin"><QueuePage /></RequireRole>} />
        <Route path="/admin/tickets/:ticketId" element={<RequireRole role="admin"><AdminTicketPage /></RequireRole>} />
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
