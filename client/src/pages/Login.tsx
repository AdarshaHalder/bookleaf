import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/ui";

const DEMO_ACCOUNTS = [
  { label: "Author · Priya Sharma (2 live books)", email: "priya.sharma@email.com", password: "author123" },
  { label: "Author · Ananya Reddy (never paid out)", email: "ananya.reddy@email.com", password: "author123" },
  { label: "Author · Sneha Kulkarni (book in production)", email: "sneha.kulkarni@email.com", password: "author123" },
  { label: "Admin · Aisha Verma (Support Lead)", email: "admin@bookleaf.com", password: "admin123" },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === "admin" ? "/admin/tickets" : "/books"} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      navigate(u.role === "admin" ? "/admin/tickets" : "/books");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">🍃 BookLeaf</div>
        <h1>Sign in to Author Support</h1>
        <p className="muted">Authors and the BookLeaf team sign in here.</p>
        <ErrorBanner error={error} />
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>

        <div className="demo-accounts">
          <div className="demo-title">Demo accounts (any of the 10 sample authors works with <code>author123</code>)</div>
          {DEMO_ACCOUNTS.map((a) => (
            <button type="button" key={a.email} className="demo-account" onClick={() => { setEmail(a.email); setPassword(a.password); }}>
              {a.label}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
