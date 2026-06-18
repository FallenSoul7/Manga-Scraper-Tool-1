import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Google profile ID
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  photo: text("photo").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Stores the user's full manga library as a single JSON blob.
// Simple and flexible — matches the frontend SavedManga Record<string, SavedManga>.
export const librarySync = pgTable("library_sync", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default("{}"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
