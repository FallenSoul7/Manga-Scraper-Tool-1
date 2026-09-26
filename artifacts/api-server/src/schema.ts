import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

// 🚀 UPDATED: Uses UUID to match Supabase's exact ID format
export const users = pgTable("users", {
  id: uuid("id").primaryKey(), 
  email: text("email").notNull(),
  username: text("username"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lockPinHash: text("lock_pin_hash"),
  lockPinUpdatedAt: timestamp("lock_pin_updated_at").defaultNow(),
});

// 🚀 REMAINS THE SAME: This perfectly holds your offline localStorage data!
export const librarySync = pgTable("library_sync", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  planKey: text("plan_key").notNull(),
  paypalSubscriptionId: text("paypal_subscription_id").notNull().unique(),
  status: text("status").notNull().default("APPROVAL_PENDING"),
  expiresAt: timestamp("expires_at"),
  lastEvent: text("last_event"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
