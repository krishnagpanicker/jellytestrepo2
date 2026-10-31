import { pgTable, uuid, text, boolean, timestamp, primaryKey, foreignKey, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
    id: uuid('id').defaultRandom().notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
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