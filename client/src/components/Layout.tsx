import { NavLink, Outlet } from "react-router-dom";
import { useAuth, useLive } from "../auth/AuthContext";

export function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  const isAdmin = user?.role === "admin";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">🍃</span> BookLeaf <span className="brand-sub">{isAdmin ? "Support Console" : "Author Support"}</span>
        </div>
        <nav className="nav">
          {isAdmin ? (
            <NavLink to="/admin/tickets">Ticket queue</NavLink>
          ) : (
            <>
              <NavLink to="/books">My Books</NavLink>
              <NavLink to="/tickets" end>My Tickets</NavLink>
              <NavLink to="/tickets/new" className="nav-cta">New query</NavLink>
            </>
          )}
        </nav>
        <div className="user-menu">
          <span className={`live-dot ${connected ? "on" : ""}`} title={connected ? "Live updates on" : "Reconnecting…"} />
          <span className="user-name">{user?.name}</span>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
