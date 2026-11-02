import { pgTable, uuid, text, boolean, timestamp, primaryKey, foreignKey, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: uuid('id').defaultRandom().notNull(),
    name: text('name'),
    email: text('email'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    primaryKey({
        name: 'users_id_pk',
        columns: [table.id],
    }),
    unique('user_email_unique').on(table.email),
]);

export const auth_accounts = pgTable('auth_accounts', {
    id: uuid('id').defaultRandom().notNull(),
    user_id: uuid('user_id').notNull(),
    provider: text('provider').notNull(),
    provider_issuer: text('prodiver_issuer').notNull(),
    provider_subject: text('prodiver_subject').notNull(),
    email: text('email'),
    email_verified: boolean('email_verified'),
    display_name: text('display_name'),
    avatar_url: text('avatar_url'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    primaryKey({
        name: 'auth_id_pk',
        columns: [table.id],
    }),
    foreignKey({
        name: 'auth_user_fk',
        columns: [table.user_id],
        foreignColumns: [users.id],
    }).onDelete('cascade').onUpdate('cascade'),
    unique('provider_identity_unique').on(table.provider, table.provider_issuer, table.provider_subject),
]);

export const refresh_tokens = pgTable('refresh_tokens', {
    id: uuid('id').defaultRandom().notNull(),
    user_id: uuid('user_id').notNull(),
    token_hash: text('token_hash').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    replaced_by: uuid('replaced_by'),
}, (table) => [
    primaryKey({
        name: 'refresh_id_pk',
        columns: [table.id],
    }),
    foreignKey({
        name: 'refresh_user_pk',
        columns: [table.user_id],
        foreignColumns: [users.id],
    }).onDelete('cascade').onUpdate('cascade'),
    foreignKey({
        name: 'refresh_replace_pk',
        columns: [table.replaced_by],
        foreignColumns: [table.id],
    }),
    unique('refresh_hash_unique').on(table.token_hash),
]);