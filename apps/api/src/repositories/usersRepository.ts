// Data access for the `users` table. Same row<->domain-object mapping style
// as connectionsRepository.ts. `password_hash` never leaves this file except
// via getUserRowByUsername, used only by the login route.
import { randomUUID } from "node:crypto";
import type { User, UserRole } from "@bulk-github-update-tool/shared-types";
import type { AppDatabase } from "../db.js";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
  };
}

export interface InsertUserInput {
  username: string;
  passwordHash: string;
  role: UserRole;
}

export function insertUser(db: AppDatabase, input: InsertUserInput): User {
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, input.username, input.passwordHash, input.role, createdAt);

  return { id, username: input.username, role: input.role, createdAt };
}

/** Includes password_hash — only for the login route to bcrypt-compare
 * against. Every other caller should use getUserById/listUsers instead. */
export function getUserRowByUsername(db: AppDatabase, username: string): UserRow | null {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  return row ?? null;
}

export function getUserById(db: AppDatabase, id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/** Oldest first, with rowid as a secondary sort key so two users inserted
 * within the same millisecond (created_at collides) still come back in
 * actual insertion order — same tie-break reasoning as
 * getAllJobsOrderedByCreatedAtDesc in jobsRepository.ts. */
export function listUsers(db: AppDatabase): User[] {
  const rows = db
    .prepare("SELECT * FROM users ORDER BY created_at ASC, rowid ASC")
    .all() as unknown as UserRow[];
  return rows.map(rowToUser);
}

export function countUsers(db: AppDatabase): number {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

export function updateUserRole(db: AppDatabase, id: string, role: UserRole): User {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  const updated = getUserById(db, id);
  if (!updated) {
    throw new Error(`user ${id} not found after role update`);
  }
  return updated;
}

export function updateUserPasswordHash(db: AppDatabase, id: string, passwordHash: string): User {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
  const updated = getUserById(db, id);
  if (!updated) {
    throw new Error(`user ${id} not found after password update`);
  }
  return updated;
}
