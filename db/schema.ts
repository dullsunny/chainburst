import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const onlineRooms = sqliteTable('online_rooms', {
  code: text('code').primaryKey(),
  revision: integer('revision').notNull().default(0),
  stateJson: text('state_json').notNull(),
  lastCommandId: text('last_command_id'),
  lastRequestHash: text('last_request_hash'),
  lastResultJson: text('last_result_json'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [
  index('idx_online_rooms_expires_at').on(table.expiresAt),
]);

export const onlineCommands = sqliteTable('online_commands', {
  roomCode: text('room_code').notNull().references(() => onlineRooms.code, { onDelete: 'cascade' }),
  commandId: text('command_id').notNull(),
  requestHash: text('request_hash').notNull(),
  resultJson: text('result_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomCode, table.commandId] }),
]);
