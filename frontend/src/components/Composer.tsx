import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../lib/api";
import { sendWs } from "../lib/realtime";
import type { Attachment, Conversation, Message } from "../lib/types";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

const EMOJI = ["😀", "😂", "🥹", "😊", "😍", "🥰", "😎", "🤔", "😴", "😭", "😤", "🙃", "👍", "👏", "🙌", "🙏", "💪", "👋", "❤️", "🧡", "💛", "💚", "💙", "💜", "🔥", "✨", "🎉", "🎂", "☕", "🍕", "⚽", "🎮", "🐶", "🐱", "🌸", "🌈", "☀️", "🌙", "✅", "👀"];

interface Props {
  conv: Conversation;
  replyTo: Message | null;
  editing: Message | null;
  onCancel: () => void;
  onSent: () => void;
  disabled?: string | null;
}

export function Composer({ conv, replyTo, editing, onCancel, onSent, disabled }: Props) {
  const me = useStore((s) => s.me)!;
  const toast = useStore((s) => s.toast);
  const addMessage = useStore((s) => s.addMessage);
  const failPending = useStore((s) => s.failPending);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  const stopTimer = useRef<number>();
  const drafts = useRef<Record<number, string>>({});

  // Keep a draft per conversation; stop typing when leaving one.
  useEffect(() => {
    setText(drafts.current[conv.id] ?? "");
    setAttachment(null);
    ta.current?.focus();
    return () => stopTyping(conv.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  useEffect(() => {
    if (editing) {
      setText(editing.body);
      requestAnimationFrame(() => {
        ta.current?.focus();
        ta.current?.setSelectionRange(editing.body.length, editing.body.length);
      });
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) ta.current?.focus();
  }, [replyTo]);

  // Smoothly auto-grow up to ~8 lines.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [text]);

  function stopTyping(convId = conv.id) {
    clearTimeout(stopTimer.current);
    if (typingSent.current) {
      sendWs({ type: "typing", conversation_id: convId, typing: false });
      typingSent.current = 0;
    }
  }

  function onChange(v: string) {
    setText(v);
    if (!editing) drafts.current[conv.id] = v;
    if (editing) return;
    if (!v.trim()) return stopTyping();
    const now = Date.now();
    // Real typing signal, throttled to one event every 3s while typing.
    if (now - typingSent.current > 3000) {
      sendWs({ type: "typing", conversation_id: conv.id, typing: true });
      typingSent.current = now;
    }
    clearTimeout(stopTimer.current);
    stopTimer.current = window.setTimeout(() => stopTyping(), 4000);
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const r = await api.upload<{ attachment: Attachment }>(`/api/conversations/${conv.id}/attachments`, file);
      setAttachment(r.attachment);
      ta.current?.focus();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Upload failed.", "error");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function submit() {
    const body = text.trim();
    if (sending) return;
    if (editing) {
      if (!body || body === editing.body) return onCancel();
      setSending(true);
      try {
        await api.patch(`/api/messages/${editing.id}`, { body });
        setText(drafts.current[conv.id] ?? "");
        onCancel();
      } catch (e) {
        toast(e instanceof ApiError ? e.message : "Couldn't edit message.", "error");
      } finally {
        setSending(false);
      }
      return;
    }
    if (!body && !attachment) return;
    stopTyping();
    const clientId = crypto.randomUUID();
    const optimistic: Message = {
      id: Number.MAX_SAFE_INTEGER - Date.now(),
      conversation_id: conv.id,
      sender_id: me.id,
      kind: "text",
      body,
      forwarded: false,
      reply_to: replyTo ? { id: replyTo.id, sender_id: replyTo.sender_id, body: replyTo.body, deleted: false, has_attachment: !!replyTo.attachment } : null,
      attachment,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted: false,
      pinned_at: null,
      reactions: [],
      client_id: clientId,
      pending: true,
    };
    addMessage(optimistic);
    const payload = { body, reply_to_id: replyTo?.id ?? null, attachment_id: attachment?.id ?? null, client_id: clientId };
    setText("");
    drafts.current[conv.id] = "";
    setAttachment(null);
    onCancel();
    onSent();
    try {
      const r = await api.post<{ message: Message }>(`/api/conversations/${conv.id}/messages`, payload);
      // The WebSocket usually delivers it first; this covers a slow socket.
      addMessage(r.message, { clientId });
    } catch (e) {
      failPending(conv.id, clientId);
      useStore.setState((s) => ({
        messages: {
          ...s.messages,
          [conv.id]: { ...s.messages[conv.id], items: s.messages[conv.id].items.map((x) => (x.client_id === clientId ? { ...x, retryPayload: payload } as Message : x)) },
        },
      }));
      toast(e instanceof ApiError ? e.message : "Message not sent.", "error");
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    const enterSends = me.preferences.enter_to_send !== false;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (enterSends || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && (editing || replyTo)) {
      onCancel();
      if (editing) setText(drafts.current[conv.id] ?? "");
    }
  }

  const canSend = !!text.trim() || !!attachment;

  if (disabled) {
    return <div className="border-t border-line/70 px-6 py-4 text-center text-sm text-muted">{disabled}</div>;
  }

  return (
    <div className="composer px-3 sm:px-5 pb-3 pt-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
      {(replyTo || editing) && (
        <div className="mx-1 mb-2 flex items-center gap-3 rounded-2xl bg-ink/[.04] px-3.5 py-2 anim-rise">
          <Icon name={editing ? "edit" : "reply"} size={16} className="text-accent shrink-0" />
          <div className="min-w-0 flex-1 text-[0.82rem]">
            <span className="font-medium text-accent">{editing ? "Editing message" : `Replying to ${replyTo!.sender_id === me.id ? "yourself" : conv.members.find((m) => m.id === replyTo!.sender_id)?.display_name ?? "message"}`}</span>
            <span className="block truncate text-muted">{(editing ?? replyTo)!.body || "Attachment"}</span>
          </div>
          <button className="icon-btn h-7 w-7" onClick={() => { onCancel(); if (editing) setText(drafts.current[conv.id] ?? ""); }} aria-label="Cancel">
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {(attachment || uploading) && (
        <div className="mx-1 mb-2 flex items-center gap-3 rounded-2xl bg-ink/[.04] p-2 pr-3 anim-rise">
          {uploading ? (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-raised text-muted"><Spinner /></div>
          ) : attachment!.is_image ? (
            <img src={attachment!.url} alt="" className="h-12 w-12 rounded-xl object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon name="file" /></div>
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{uploading ? "Uploading…" : attachment!.name}</span>
          {!uploading && (
            <button className="icon-btn h-7 w-7" onClick={() => setAttachment(null)} aria-label="Remove attachment">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      )}
      <div className="relative flex items-end gap-2">
        <button className="icon-btn h-10 w-10 shrink-0 mb-[1px]" onClick={() => fileInput.current?.click()} title="Attach a file" disabled={!!editing || uploading}>
          <Icon name="plus" size={22} />
        </button>
        <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,application/zip,text/plain" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <div
          className={`flex flex-1 items-end rounded-[22px] border bg-panel transition-all duration-200 ease-soft ${
            focused ? "border-accent/40 shadow-[0_0_0_4px_rgb(var(--accent)/.08)]" : "border-line"
          }`}
        >
          <textarea
            ref={ta}
            rows={1}
            value={text}
            placeholder={editing ? "Edit message" : `Message ${conv.kind === "group" ? conv.name ?? "group" : conv.members.find((m) => m.id !== me.id)?.display_name ?? ""}`}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); stopTyping(); }}
            onPaste={(e) => { const f = e.clipboardData.files[0]; if (f) { e.preventDefault(); upload(f); } }}
            maxLength={4000}
            className="scroll max-h-[180px] min-h-[42px] flex-1 resize-none bg-transparent py-[10px] pl-4 pr-1 text-[0.95rem] leading-[1.38] outline-none placeholder:text-faint transition-[height] duration-150"
            aria-label="Message"
          />
          <button className="icon-btn mb-[3px] h-9 w-9 shrink-0" onClick={() => setEmojiOpen((v) => !v)} title="Emoji" type="button">
            <Icon name="smile" size={20} />
          </button>
          <button
            onClick={submit}
            disabled={!canSend || sending}
            aria-label={editing ? "Save edit" : "Send"}
            className={`mb-[4px] mr-[4px] flex h-[34px] shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-all duration-200 ease-soft active:scale-90 ${
              canSend ? "w-[34px] scale-100 opacity-100" : "w-0 scale-50 opacity-0 pointer-events-none !mr-0"
            }`}
          >
            {sending ? <Spinner size={16} /> : <Icon name={editing ? "check" : "send"} size={18} strokeWidth={2.4} />}
          </button>
        </div>
        {emojiOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
            <div className="absolute bottom-full right-0 z-20 mb-2 grid w-[288px] grid-cols-8 gap-0.5 rounded-2xl border border-line bg-panel p-2 shadow-pop anim-pop">
              {EMOJI.map((e) => (
                <button
                  key={e}
                  className="h-8 w-8 rounded-lg text-xl transition-transform hover:scale-110 hover:bg-ink/5"
                  onClick={() => {
                    const el = ta.current!;
                    const start = el.selectionStart ?? text.length;
                    const next = text.slice(0, start) + e + text.slice(el.selectionEnd ?? start);
                    onChange(next);
                    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + e.length, start + e.length); });
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export async function retrySend(m: Message & { retryPayload?: object }) {
  const s = useStore.getState();
  if (!m.retryPayload || !m.client_id) return;
  useStore.setState({
    messages: { ...s.messages, [m.conversation_id]: { ...s.messages[m.conversation_id], items: s.messages[m.conversation_id].items.map((x) => (x.client_id === m.client_id ? { ...x, failed: false, pending: true } : x)) } },
  });
  try {
    const r = await api.post<{ message: Message }>(`/api/conversations/${m.conversation_id}/messages`, m.retryPayload);
    s.addMessage(r.message, { clientId: m.client_id });
  } catch (e) {
    s.failPending(m.conversation_id, m.client_id);
    s.toast(e instanceof ApiError ? e.message : "Message not sent.", "error");
  }
}
