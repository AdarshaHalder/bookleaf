import { useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import type { AuthorTicketDetail, Book } from "../../api/types";
import { fileSize } from "../../components/format";
import { ErrorBanner, Spinner } from "../../components/ui";
import { useAsync } from "../../hooks/useAsync";

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;

export function NewTicketPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const books = useAsync(() => api<{ data: Book[] }>("/books"), []);
  const [bookId, setBookId] = useState(params.get("bookId") ?? "general");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_FILES);
    const tooBig = next.find((f) => f.size > MAX_BYTES);
    if (tooBig) return setError(new Error(`${tooBig.name} is larger than 5 MB.`));
    setError(null);
    setFiles(next);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("bookId", bookId);
    form.set("subject", subject);
    form.set("description", description);
    files.forEach((f) => form.append("attachments", f));
    try {
      const r = await api<{ data: AuthorTicketDetail }>("/tickets", { method: "POST", body: form });
      navigate(`/tickets/${r.data.ticket.id}`, { state: { justCreated: true } });
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (f: string) => (error instanceof ApiError ? error.fieldError(f) : undefined);
  if (books.loading) return <Spinner />;

  return (
    <div className="page narrow">
      <h1>Raise a support query</h1>
      <p className="muted">Our team usually replies within one business day. Urgent payment and ISBN issues are prioritised.</p>
      <form className="card form" onSubmit={submit} noValidate>
        {error && !(error instanceof ApiError && error.details) && <ErrorBanner error={error} />}

        <label className="field">
          <span>What is this about?</span>
          <select value={bookId} onChange={(e) => setBookId(e.target.value)}>
            <option value="general">General / Account level</option>
            {books.data?.data.map((b) => (
              <option key={b.id} value={b.id}>{b.title}{b.isPublished ? "" : ` (${b.status.replace("In Production - ", "in production: ")})`}</option>
            ))}
          </select>
          {fieldError("bookId") && <small className="field-error">{fieldError("bookId")}</small>}
        </label>

        <label className="field">
          <span>Subject</span>
          <input value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Royalty for Q3 not received" required />
          {fieldError("subject") && <small className="field-error">{fieldError("subject")}</small>}
        </label>

        <label className="field">
          <span>Details</span>
          <textarea rows={7} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us what happened, when, and anything you've already tried. Include platform links or order numbers if relevant." required />
          <small className="muted">{description.length}/5000</small>
          {fieldError("description") && <small className="field-error">{fieldError("description")}</small>}
        </label>

        <div className="field">
          <span>Attachments <span className="muted">(optional: photos or PDFs, up to 3 files, 5 MB each)</span></span>
          <div className="dropzone" onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            Drop files here or <u>browse</u>
            <input ref={fileInput} type="file" hidden multiple accept="image/*,application/pdf" onChange={(e) => addFiles(e.target.files)} />
          </div>
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={i}>{f.name} <span className="muted">{fileSize(f.size)}</span>
                  <button type="button" className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? "Submitting…" : "Submit query"}</button>
        </div>
      </form>
    </div>
  );
}
