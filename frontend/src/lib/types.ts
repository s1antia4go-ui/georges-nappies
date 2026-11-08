export type Presence = "online" | "idle" | "offline";

export interface PublicUser {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  banner_url: string | null;
  banner_color: string;
  accent_color: string;
  bio: string;
  created_at: string;
  presence: Presence;
  last_seen_at: string | null;
}

export interface Preferences {
  theme?: "system" | "light" | "dark";
  accent?: string;
  text_animation?: "on" | "off" | "reduced";
  font_scale?: number;
  notify_messages?: boolean;
  notify_friend_requests?: boolean;
  notify_sounds?: boolean;
  notify_previews?: boolean;
  enter_to_send?: boolean;
}

export interface Me extends PublicUser {
  email: string;
  status: "online" | "idle" | "invisible";
  privacy: { discoverable: boolean; send_read_receipts: boolean; show_presence: boolean; allow_requests: boolean };
  preferences: Preferences;
}

export interface Member extends PublicUser {
  role: "owner" | "admin" | "member";
  last_read_id: number | null;
  last_delivered_id: number;
}

export interface Attachment {
  id: number;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  is_image: boolean;
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  kind: "text" | "system";
  body: string;
  forwarded: boolean;
  reply_to: { id: number; sender_id: number | null; body: string; deleted: boolean; has_attachment: boolean } | null;
  attachment: Attachment | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  pinned_at: string | null;
  reactions: { emoji: string; user_ids: number[] }[];
  // client-only
  client_id?: string;
  pending?: boolean;
  failed?: boolean;
  retryPayload?: object;
}

export interface Conversation {
  id: number;
  kind: "direct" | "group";
  name: string | null;
  avatar_url: string | null;
  created_by: number | null;
  created_at: string;
  last_message_at: string;
  muted: boolean;
  my_role: "owner" | "admin" | "member";
  unread_count: number;
  last_message: Message | null;
  members: Member[];
}

export interface FriendRequest {
  id: number;
  from_user_id: number;
  to_user_id: number;
  created_at: string;
  user: PublicUser;
}

export interface Friend extends PublicUser {
  friends_since: string;
  favorite: boolean;
}

export interface Profile {
  user: PublicUser;
  relationship: "self" | "friend" | "none" | "incoming" | "outgoing" | "blocked";
  favorite: boolean;
  mutual_groups: { id: number; name: string }[];
}
