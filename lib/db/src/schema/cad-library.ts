import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type CompanyRole = "owner" | "admin" | "member";
export type LibraryReviewStatus = "needs-review" | "approved" | "excluded";

export const companies = pgTable("cad_companies", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  isInitialCompany: boolean("is_initial_company").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cad_companies_initial_unique")
    .on(table.isInitialCompany)
    .where(sql`${table.isInitialCompany} = true`),
]);

export const companyMemberships = pgTable(
  "cad_company_memberships",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    role: text("role").$type<CompanyRole>().notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.clerkUserId] })],
);

export const cadProjects = pgTable(
  "cad_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("cad_projects_company_name_unique").on(table.companyId, table.name)],
);

export const companyLibrarySymbols = pgTable(
  "cad_library_symbols",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull().default("Other"),
    discipline: text("discipline").notNull().default("P&ID"),
    status: text("status").$type<LibraryReviewStatus>().notNull().default("needs-review"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cad_library_company_external_id_unique").on(table.companyId, table.externalId),
  ],
);

export const companyLibraryAssets = pgTable("cad_library_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => cadProjects.id, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull(),
  displayName: text("display_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadStatus: text("upload_status").notNull().default("pending"),
  uploadedByClerkUserId: text("uploaded_by_clerk_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectLibraryOverrides = pgTable(
  "cad_project_library_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => cadProjects.id, { onDelete: "cascade" }),
    sourceSymbolId: uuid("source_symbol_id")
      .notNull()
      .references(() => companyLibrarySymbols.id, { onDelete: "cascade" }),
    replacementSymbolId: uuid("replacement_symbol_id")
      .notNull()
      .references(() => companyLibrarySymbols.id, { onDelete: "cascade" }),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("cad_project_override_source_unique").on(table.projectId, table.sourceSymbolId),
  ],
);

export const cadAuditEvents = pgTable(
  "cad_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    eventType: text("event_type").notNull(),
    recordType: text("record_type").notNull(),
    recordId: text("record_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("cad_audit_company_created_idx").on(table.companyId, table.createdAt)],
);
