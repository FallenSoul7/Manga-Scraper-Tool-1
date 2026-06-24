import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";

// 🚀 UPDATED: Uses UUID to match Supabase's exact ID format
export const users = pgTable("users", {
  id: uuid("id").primaryKey(), 
  email: text("email").notNull(),
  username: text("username"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 🚀 REMAINS THE SAME: This perfectly holds your offline localStorage data!
export const librarySync = pgTable("library_sync", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
