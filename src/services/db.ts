import Dexie, { type Table } from 'dexie';

export interface DbMessage {
  id?: number;
  localId: string;
  serverId?: string;
  chatId: string;
  senderUsername: string;
  receiverUsername: string;
  text: string;
  timestamp: number;
  status: string; 
}

export interface DbContact {
  id?: number;
  username: string;
  nickname: string;
  avatarColor?: string;
  addedAt: number;
}

export interface DbUserProfile {
  id?: number;
  username: string;
  nickname: string;
  avatar_url?: string;
}

class WhispDatabase extends Dexie {
  messages!: Table<DbMessage, number>;
  contacts!: Table<DbContact, number>;
  userProfile!: Table<DbUserProfile, number>;

  constructor() {
    super('WhispDB');

    // نسخه قبلی برای حفظ تاریخچه مرورگر
    this.version(786).stores({
      messages: '++id, &localId, chatId, senderUsername, [chatId+timestamp]',
      contacts: '++id, &username, addedAt',
      userProfile: '++id, &username',
    });

    // ارتقا به نسخه 25 
    this.version(870).stores({
      messages: '++id, &localId, chatId, senderUsername, [chatId+timestamp]',
      contacts: '++id, &username, addedAt',
      userProfile: '++id, &username',
      invites: null,
      syncQueue: null
    });
  }
}

export const db = new WhispDatabase();

// ─── رفع باگ Race Condition با استفاده از Transaction ─────────────
export async function upsertMessage(msg: DbMessage): Promise<void> {
  // استفاده از تراکنش باعث می‌شود تا زمانی که عملیات قبلی تمام نشده، بعدی شروع نشود
  return db.transaction('rw', db.messages, async () => {
    const existing = await db.messages.where('localId').equals(msg.localId).first();
    if (existing?.id !== undefined) {
      await db.messages.update(existing.id, msg);
    } else {
      await db.messages.add(msg);
    }
  });
}

export async function bulkUpsertMessages(msgs: DbMessage[]): Promise<void> {
  return db.transaction('rw', db.messages, async () => {
    for (const msg of msgs) {
      const existing = await db.messages.where('localId').equals(msg.localId).first();
      if (existing?.id !== undefined) {
        await db.messages.update(existing.id, msg);
      } else {
        await db.messages.add(msg);
      }
    }
  });
}

// ─── رفع باگ SchemaError در زمان Hydration ─────────────
export async function getRecentMessagesForHydration(): Promise<DbMessage[]> {
  // به جای orderBy('id') از reverse مستقیم روی جدول استفاده می‌کنیم 
  // که به صورت ذاتی بر اساس کلید اصلی (id) سورت می‌کند و ارور نمی‌دهد
  const msgs = await db.messages.reverse().limit(1000).toArray();
  return msgs.reverse(); 
}

// ─── سایر هلپرها ─────────────

/**
 * getMessagesByChatId
 * پیام‌های یک مکالمه مشخص را از IndexedDB برمی‌گرداند — مرتب از قدیم به جدید.
 * در markAsRead استفاده می‌شود تا IDs پیام‌های خوانده‌نشده را برای ارسال
 * read receipt به سرور (mark_read) پیدا کنیم.
 */
export async function getMessagesByChatId(chatId: string): Promise<DbMessage[]> {
  return db.messages
    .where('[chatId+timestamp]')
    .between([chatId, Dexie.minKey], [chatId, Dexie.maxKey])
    .toArray();
}

export async function markChatRead(chatId: string, readerUsername: string): Promise<void> {
  const toMark = await db.messages
    .where('chatId').equals(chatId)
    .filter((m) => m.senderUsername !== readerUsername && m.status !== 'read')
    .toArray();
  await Promise.all(toMark.map((m) => db.messages.update(m.id!, { status: 'read' })));
}

export async function getAllContacts(): Promise<DbContact[]> {
  return db.contacts.orderBy('addedAt').toArray();
}

export async function upsertContact(contact: Omit<DbContact, 'id'>): Promise<void> {
  return db.transaction('rw', db.contacts, async () => {
    const existing = await db.contacts.where('username').equals(contact.username).first();
    if (existing?.id !== undefined) {
      await db.contacts.update(existing.id, {
        nickname: contact.nickname,
        ...(contact.avatarColor ? { avatarColor: contact.avatarColor } : {}),
      });
    } else {
      await db.contacts.add(contact as DbContact);
    }
  });
}

export async function clearChatMessages(chatId: string): Promise<void> {
  await db.messages.where('chatId').equals(chatId).delete();
}

export async function clearAllDatabase(): Promise<void> {
  await Promise.all([
    db.messages.clear(),
    db.contacts.clear(),
    db.userProfile.clear(),
  ]);
}