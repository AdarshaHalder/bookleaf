import { downloadAttachment } from "../api/client";
import type { Attachment, Message, Role } from "../api/types";
import { dateTime, fileSize } from "./format";

/** Conversation view shared by both portals; `viewer` decides which side is "mine". */
export function Thread({ messages, viewer }: { messages: Message[]; viewer: Role }) {
  return (
    <ol className="thread">
      {messages.map((m) => (
        <li key={m.id} className={`msg ${m.senderRole === viewer ? "msg-mine" : "msg-theirs"} msg-${m.senderRole}`}>
          <div className="msg-meta">
            <strong>{m.senderName}</strong>
            {m.aiAssisted && <span className="source-tag source-ai" title="Sent from an AI draft">AI-assisted</span>}
            <span className="muted">{dateTime(m.createdAt)}</span>
          </div>
          <div className="msg-body">{m.body}</div>
        </li>
      ))}
    </ol>
  );
}

export function AttachmentList({ ticketId, attachments }: { ticketId: number; attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <ul className="file-list">
      {attachments.map((a) => (
        <li key={a.id}>
          📎 <button className="link" onClick={() => downloadAttachment(ticketId, a.id, a.name).catch((e) => alert(e.message))}>{a.name}</button>{" "}
          <span className="muted">{fileSize(a.size)}</span>
        </li>
      ))}
    </ul>
  );
}
