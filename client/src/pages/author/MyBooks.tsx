import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { Book, BookSummary } from "../../api/types";
import { date, inr } from "../../components/format";
import { EmptyState, ErrorBanner, Spinner } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";

export function MyBooksPage() {
  const { data, error, loading } = useAsync(() => api<{ data: Book[]; summary: BookSummary }>("/books"), []);

  if (loading) return <Spinner />;
  if (error || !data) return <ErrorBanner error={error ?? "Could not load your books"} />;
  const { data: books, summary } = data;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My Books</h1>
          <p className="muted">Sales and royalties across all your BookLeaf titles. Royalties are paid quarterly, within 45 days of each quarter ending.</p>
        </div>
      </div>

      <div className="stats">
        <Stat label="Titles" value={`${summary.publishedBooks} live / ${summary.totalBooks}`} />
        <Stat label="Copies sold" value={summary.totalCopiesSold.toLocaleString("en-IN")} />
        <Stat label="Royalty earned" value={inr(summary.totalRoyaltyEarned)} />
        <Stat label="Royalty paid" value={inr(summary.totalRoyaltyPaid)} />
        <Stat label="Royalty pending" value={inr(summary.totalRoyaltyPending)} highlight={summary.totalRoyaltyPending > 0} />
      </div>

      {books.length === 0 ? (
        <EmptyState title="No books yet">Once your manuscript is with us, it will show up here.</EmptyState>
      ) : (
        <div className="book-grid">
          {books.map((b) => <BookCard key={b.id} book={b} />)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`stat ${highlight ? "stat-highlight" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function BookCard({ book: b }: { book: Book }) {
  return (
    <article className="card book-card">
      <div className="book-head">
        <div>
          <h2>{b.title}</h2>
          <div className="muted small">{b.genre} · ISBN {b.isbn ?? "pending"}</div>
        </div>
        <span className={`badge ${b.isPublished ? "status-resolved" : "status-in-progress"}`}>{b.status}</span>
      </div>

      {b.isPublished ? (
        <>
          <dl className="facts">
            <div><dt>Published</dt><dd>{date(b.publication_date)}</dd></div>
            <div><dt>MRP</dt><dd>{inr(b.mrp)}</dd></div>
            <div><dt>Copies sold</dt><dd>{b.total_copies_sold.toLocaleString("en-IN")}</dd></div>
            <div><dt>Royalty / copy</dt><dd>{inr(b.author_royalty_per_copy)}</dd></div>
          </dl>
          <div className="royalty-bar" aria-label="Royalty paid vs pending">
            <div className="royalty-paid" style={{ width: `${b.total_royalty_earned ? (b.royalty_paid / b.total_royalty_earned) * 100 : 0}%` }} />
          </div>
          <dl className="facts">
            <div><dt>Earned</dt><dd>{inr(b.total_royalty_earned)}</dd></div>
            <div><dt>Paid</dt><dd>{inr(b.royalty_paid)}</dd></div>
            <div><dt>Pending</dt><dd className={b.royalty_pending > 0 ? "text-accent" : ""}>{inr(b.royalty_pending)}</dd></div>
            <div><dt>Last payout</dt><dd>{b.last_royalty_payout_date ? date(b.last_royalty_payout_date) : "Not yet"}</dd></div>
          </dl>
          {b.royalty_pending > 0 && b.royalty_pending < 1000 && (
            <p className="hint">Below the ₹1,000 payout threshold, so this rolls over to the next quarter.</p>
          )}
          <div className="platforms">
            {b.platforms.map((p) => <span key={p} className="chip">{p}</span>)}
          </div>
        </>
      ) : (
        <p className="muted">This book is still in production. Sales and royalty figures will appear once it's published and live.</p>
      )}

      <div className="card-actions">
        <Link className="btn btn-secondary btn-sm" to={`/tickets/new?bookId=${b.id}`}>Ask about this book</Link>
      </div>
    </article>
  );
}
