import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { clerkClient, getAuth } from "@clerk/express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  db,
  cadAuditEvents,
  cadProjects,
  companies,
  companyLibraryAssets,
  companyLibrarySymbols,
  companyMemberships,
  projectLibraryOverrides,
} from "@workspace/db";
import { z } from "zod/v4";
import {
  createPrivateUpload,
  getPrivateFile,
  privateFileResponseHeaders,
  savePrivateFile,
} from "../lib/privateStorage";

const router = Router();
const companyIdSchema = z.string().uuid();
const symbolInputSchema = z.object({
  id: z.string().trim().min(1).max(160),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(100).default("Other"),
  discipline: z.enum(["P&ID", "PFD"]).default("P&ID"),
  entityCount: z.number().int().min(0).max(1_000_000).optional(),
  hasVectorGeometry: z.boolean().optional(),
});
const symbolImportSchema = z.object({ items: z.array(symbolInputSchema).min(1).max(500) });

function authenticated(req: Request, res: Response, next: NextFunction) {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  res.locals.userId = userId;
  next();
}

function userIdFrom(res: Response) {
  return String(res.locals.userId);
}

function normaliseEmail(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

async function bootstrapInitialAdmin(userId: string) {
  const allowlistedEmail = normaliseEmail(process.env.APP_INITIAL_ADMIN_EMAIL);
  if (!allowlistedEmail) return;
  const existing = await db
    .select({ companyId: companyMemberships.companyId })
    .from(companyMemberships)
    .where(eq(companyMemberships.clerkUserId, userId))
    .limit(1);
  if (existing.length) return;

  const clerkUser = await clerkClient.users.getUser(userId);
  const verifiedEmail = clerkUser.emailAddresses.find(
    (entry) =>
      normaliseEmail(entry.emailAddress) === allowlistedEmail &&
      entry.verification?.status === "verified",
  );
  if (!verifiedEmail) return;

  await db.transaction(async (tx) => {
    const [existingCompany] = await tx
      .select()
      .from(companies)
      .where(eq(companies.isInitialCompany, true))
      .limit(1);
    const [company] = existingCompany
      ? [existingCompany]
      : await tx
          .insert(companies)
          .values({ name: "Company Standard", isInitialCompany: true })
          .returning();
    await tx
      .insert(companyMemberships)
      .values({ companyId: company.id, clerkUserId: userId, role: "owner" })
      .onConflictDoNothing();
    await tx.insert(cadAuditEvents).values({
      companyId: company.id,
      actorClerkUserId: userId,
      eventType: "company.initial-owner-added",
      recordType: "company",
      recordId: company.id,
      details: {},
    });
  });
}

async function getCompanyRole(companyId: string, userId: string) {
  const [membership] = await db
    .select({ role: companyMemberships.role })
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.companyId, companyId),
        eq(companyMemberships.clerkUserId, userId),
      ),
    )
    .limit(1);
  return membership?.role;
}

async function recordAudit(
  writer: Pick<typeof db, "insert">,
  event: {
    companyId: string;
    actorClerkUserId: string;
    eventType: string;
    recordType: string;
    recordId: string;
    details?: Record<string, unknown>;
  },
) {
  await writer.insert(cadAuditEvents).values({
    ...event,
    details: event.details ?? {},
  });
}

async function companyAdmin(req: Request, res: Response) {
  const parsed = companyIdSchema.safeParse(req.params.companyId);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid company selection." });
    return null;
  }
  const role = await getCompanyRole(parsed.data, userIdFrom(res));
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: "You do not have admin access to this company." });
    return null;
  }
  return parsed.data;
}

router.use(authenticated);

router.get("/session", async (_req, res) => {
  const userId = userIdFrom(res);
  await bootstrapInitialAdmin(userId);
  const memberships = await db
    .select({
      companyId: companies.id,
      companyName: companies.name,
      role: companyMemberships.role,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(eq(companyMemberships.clerkUserId, userId))
    .orderBy(companies.name);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    memberships,
    canCreateCompany: memberships.some((membership) => membership.role === "owner"),
  });
});

router.post("/companies", async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(120) }).safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Enter a company name between 2 and 120 characters." });
    return;
  }
  const userId = userIdFrom(res);
  const [owner] = await db
    .select({ companyId: companyMemberships.companyId })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.clerkUserId, userId), eq(companyMemberships.role, "owner")))
    .limit(1);
  if (!owner) {
    res.status(403).json({ error: "Only an approved owner can add another company." });
    return;
  }
  const [company] = await db
    .insert(companies)
    .values({ name: input.data.name })
    .returning({ id: companies.id, name: companies.name });
  await db.insert(companyMemberships).values({
    companyId: company.id,
    clerkUserId: userId,
    role: "owner",
  });
  await recordAudit(db, {
    companyId: company.id,
    actorClerkUserId: userId,
    eventType: "company.created",
    recordType: "company",
    recordId: company.id,
  });
  res.status(201).json(company);
});

router.post("/companies/:companyId/admins", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const role = await getCompanyRole(companyId, userIdFrom(res));
  if (role !== "owner") {
    res.status(403).json({ error: "Only the company owner can add an admin." });
    return;
  }
  const input = z
    .object({ email: z.string().trim().email().max(254) })
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Enter the approved admin's company email." });
    return;
  }
  const matches = await clerkClient.users.getUserList({
    emailAddress: [normaliseEmail(input.data.email)],
    limit: 1,
  });
  const account = matches.data.find((candidate) =>
    candidate.emailAddresses.some(
      (entry) =>
        normaliseEmail(entry.emailAddress) === normaliseEmail(input.data.email) &&
        entry.verification?.status === "verified",
    ),
  );
  if (!account) {
    res.status(404).json({ error: "That verified account was not found. Ask them to sign in once first." });
    return;
  }
  await db
    .insert(companyMemberships)
    .values({ companyId, clerkUserId: account.id, role: "admin" })
    .onConflictDoUpdate({
      target: [companyMemberships.companyId, companyMemberships.clerkUserId],
      set: { role: "admin" },
    });
  await recordAudit(db, {
    companyId,
    actorClerkUserId: userIdFrom(res),
    eventType: "company.admin-approved",
    recordType: "membership",
    recordId: account.id,
  });
  res.status(201).json({ added: true });
});

router.get("/companies/:companyId/library", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const [symbols, assets, projects, audit] = await Promise.all([
    db
      .select()
      .from(companyLibrarySymbols)
      .where(eq(companyLibrarySymbols.companyId, companyId))
      .orderBy(companyLibrarySymbols.category, companyLibrarySymbols.name),
    db
      .select({
        id: companyLibraryAssets.id,
        displayName: companyLibraryAssets.displayName,
        contentType: companyLibraryAssets.contentType,
        sizeBytes: companyLibraryAssets.sizeBytes,
        uploadStatus: companyLibraryAssets.uploadStatus,
        projectId: companyLibraryAssets.projectId,
        createdAt: companyLibraryAssets.createdAt,
      })
      .from(companyLibraryAssets)
      .where(eq(companyLibraryAssets.companyId, companyId))
      .orderBy(desc(companyLibraryAssets.createdAt)),
    db
      .select({ id: cadProjects.id, name: cadProjects.name })
      .from(cadProjects)
      .where(eq(cadProjects.companyId, companyId))
      .orderBy(cadProjects.name),
    db
      .select({
        id: cadAuditEvents.id,
        actorClerkUserId: cadAuditEvents.actorClerkUserId,
        eventType: cadAuditEvents.eventType,
        recordType: cadAuditEvents.recordType,
        recordId: cadAuditEvents.recordId,
        details: cadAuditEvents.details,
        createdAt: cadAuditEvents.createdAt,
      })
      .from(cadAuditEvents)
      .where(eq(cadAuditEvents.companyId, companyId))
      .orderBy(desc(cadAuditEvents.createdAt))
      .limit(100),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ symbols, assets, projects, audit });
});

router.post("/companies/:companyId/library/import", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const input = symbolImportSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "The library file could not be read. Check the item names and try again." });
    return;
  }
  const uniqueIds = new Set(input.data.items.map((item) => item.id));
  if (uniqueIds.size !== input.data.items.length) {
    res.status(400).json({ error: "The library contains repeated item IDs." });
    return;
  }
  const rows = input.data.items.map((item) => ({
    companyId,
    externalId: item.id,
    name: item.name,
    category: item.category,
    discipline: item.discipline,
    status: "needs-review" as const,
    metadata: {
      ...(item.entityCount === undefined ? {} : { entityCount: item.entityCount }),
      ...(item.hasVectorGeometry === undefined
        ? {}
        : { hasVectorGeometry: item.hasVectorGeometry }),
    },
  }));
  await db.transaction(async (tx) => {
    await tx.insert(companyLibrarySymbols).values(rows).onConflictDoNothing();
    await recordAudit(tx, {
      companyId,
      actorClerkUserId: userIdFrom(res),
      eventType: "library.items-imported",
      recordType: "library",
      recordId: companyId,
      details: { importedCount: rows.length, reviewRequired: true },
    });
  });
  res.status(201).json({ importedCount: rows.length, reviewRequired: true });
});

router.post("/companies/:companyId/library/import-supplied", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "This one-time import is unavailable in this release." });
    return;
  }
  const [existing] = await db
    .select({ id: companyLibrarySymbols.id })
    .from(companyLibrarySymbols)
    .where(eq(companyLibrarySymbols.companyId, companyId))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "This company already has library items. No data was changed." });
    return;
  }
  try {
    const projectDir = path.resolve(process.cwd(), "../pid-mapping-studio");
    const [jsonText, dxfBytes] = await Promise.all([
      readFile(path.join(projectDir, "src/data/company-symbol-library.json"), "utf8"),
      readFile(path.join(projectDir, "src/assets/company-symbol-library.dxf")),
    ]);
    const parsed = JSON.parse(jsonText) as { items?: unknown[] };
    const input = symbolImportSchema.safeParse({ items: parsed.items });
    if (!input.success) {
      res.status(422).json({ error: "The supplied library data did not pass validation." });
      return;
    }
    const uniqueIds = new Set(input.data.items.map((item) => item.id));
    if (uniqueIds.size !== input.data.items.length) {
      res.status(422).json({ error: "The supplied library contains repeated item IDs." });
      return;
    }
    const assetId = randomUUID();
    const objectPath = await savePrivateFile(
      `company-library/${companyId}/${assetId}-library.dxf`,
      dxfBytes,
      "application/dxf",
    );
    const rows = input.data.items.map((item) => ({
      companyId,
      externalId: item.id,
      name: item.name,
      category: item.category,
      discipline: item.discipline,
      status: "needs-review" as const,
      metadata: {
        ...(item.entityCount === undefined ? {} : { entityCount: item.entityCount }),
        ...(item.hasVectorGeometry === undefined
          ? {}
          : { hasVectorGeometry: item.hasVectorGeometry }),
      },
    }));
    await db.transaction(async (tx) => {
      await tx.insert(companyLibrarySymbols).values(rows);
      await tx.insert(companyLibraryAssets).values({
        id: assetId,
        companyId,
        objectPath,
        displayName: "Company symbol library",
        contentType: "application/dxf",
        sizeBytes: dxfBytes.byteLength,
        uploadStatus: "ready",
        uploadedByClerkUserId: userIdFrom(res),
      });
      await recordAudit(tx, {
        companyId,
        actorClerkUserId: userIdFrom(res),
        eventType: "library.supplied-library-imported",
        recordType: "library-asset",
        recordId: assetId,
        details: { importedCount: rows.length, reviewRequired: true },
      });
    });
    res.status(201).json({ importedCount: rows.length, assetSaved: true, reviewRequired: true });
  } catch {
    res.status(500).json({ error: "The supplied library could not be imported. No files were shared." });
  }
});

router.patch("/companies/:companyId/library/:symbolId", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const symbolId = z.string().uuid().safeParse(req.params.symbolId);
  const input = z
    .object({
      status: z.enum(["needs-review", "approved", "excluded"]).optional(),
      name: z.string().trim().min(1).max(200).optional(),
      category: z.string().trim().min(1).max(100).optional(),
      discipline: z.enum(["P&ID", "PFD"]).optional(),
    })
    .safeParse(req.body);
  if (!symbolId.success || !input.success || Object.keys(input.data).length === 0) {
    res.status(400).json({ error: "Choose a valid library item and a change to save." });
    return;
  }
  const [updated] = await db
    .update(companyLibrarySymbols)
    .set({ ...input.data, updatedAt: new Date() })
    .where(
      and(
        eq(companyLibrarySymbols.id, symbolId.data),
        eq(companyLibrarySymbols.companyId, companyId),
      ),
    )
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Library item not found." });
    return;
  }
  await recordAudit(db, {
    companyId,
    actorClerkUserId: userIdFrom(res),
    eventType: input.data.status === "approved" ? "library.item-approved" : "library.item-updated",
    recordType: "library-symbol",
    recordId: updated.id,
    details: {
      name: updated.name,
      status: updated.status,
      discipline: updated.discipline,
    },
  });
  res.json({ symbol: updated });
});

router.get("/companies/:companyId/projects", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const projects = await db
    .select()
    .from(cadProjects)
    .where(eq(cadProjects.companyId, companyId))
    .orderBy(cadProjects.name);
  res.json({ projects });
});

router.post("/companies/:companyId/projects", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const input = z.object({ name: z.string().trim().min(2).max(120) }).safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Enter a project name between 2 and 120 characters." });
    return;
  }
  const [project] = await db
    .insert(cadProjects)
    .values({ companyId, name: input.data.name })
    .returning();
  await recordAudit(db, {
    companyId,
    actorClerkUserId: userIdFrom(res),
    eventType: "project.created",
    recordType: "project",
    recordId: project.id,
    details: { name: project.name },
  });
  res.status(201).json({ project });
});

router.get("/companies/:companyId/projects/:projectId/overrides", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const projectId = z.string().uuid().safeParse(req.params.projectId);
  if (!projectId.success) {
    res.status(400).json({ error: "Invalid project selection." });
    return;
  }
  const rows = await db
    .select({
      id: projectLibraryOverrides.id,
      sourceSymbolId: projectLibraryOverrides.sourceSymbolId,
      replacementSymbolId: projectLibraryOverrides.replacementSymbolId,
      note: projectLibraryOverrides.note,
      sourceName: companyLibrarySymbols.name,
    })
    .from(projectLibraryOverrides)
    .innerJoin(
      cadProjects,
      and(
        eq(cadProjects.id, projectLibraryOverrides.projectId),
        eq(cadProjects.companyId, companyId),
      ),
    )
    .innerJoin(
      companyLibrarySymbols,
      eq(companyLibrarySymbols.id, projectLibraryOverrides.sourceSymbolId),
    )
    .where(eq(projectLibraryOverrides.projectId, projectId.data));
  res.json({ overrides: rows });
});

router.post("/companies/:companyId/projects/:projectId/overrides", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const projectId = z.string().uuid().safeParse(req.params.projectId);
  const input = z
    .object({
      sourceSymbolId: z.string().uuid(),
      replacementSymbolId: z.string().uuid(),
      note: z.string().trim().max(500).default(""),
    })
    .safeParse(req.body);
  if (!projectId.success || !input.success) {
    res.status(400).json({ error: "Choose a project and two valid library items." });
    return;
  }
  const [project] = await db
    .select({ id: cadProjects.id })
    .from(cadProjects)
    .where(and(eq(cadProjects.id, projectId.data), eq(cadProjects.companyId, companyId)))
    .limit(1);
  if (input.data.sourceSymbolId === input.data.replacementSymbolId) {
    res.status(400).json({ error: "Choose two different library items for a replacement rule." });
    return;
  }
  const symbols = await db
    .select({ id: companyLibrarySymbols.id })
    .from(companyLibrarySymbols)
    .where(
      and(
        eq(companyLibrarySymbols.companyId, companyId),
        inArray(companyLibrarySymbols.id, [
          input.data.sourceSymbolId,
          input.data.replacementSymbolId,
        ]),
      ),
    );
  const symbolIds = new Set(symbols.map((symbol) => symbol.id));
  if (
    !project ||
    !symbolIds.has(input.data.sourceSymbolId) ||
    !symbolIds.has(input.data.replacementSymbolId)
  ) {
    res.status(404).json({ error: "The project or one of the selected items was not found." });
    return;
  }
  const [replacement] = await db
    .select({ status: companyLibrarySymbols.status })
    .from(companyLibrarySymbols)
    .where(
      and(
        eq(companyLibrarySymbols.id, input.data.replacementSymbolId),
        eq(companyLibrarySymbols.companyId, companyId),
      ),
    )
    .limit(1);
  if (replacement?.status !== "approved") {
    res.status(409).json({ error: "Approve the replacement item before using it in a project." });
    return;
  }
  const [override] = await db
    .insert(projectLibraryOverrides)
    .values({
      companyId,
      projectId: projectId.data,
      sourceSymbolId: input.data.sourceSymbolId,
      replacementSymbolId: input.data.replacementSymbolId,
      note: input.data.note,
    })
    .onConflictDoUpdate({
      target: [projectLibraryOverrides.projectId, projectLibraryOverrides.sourceSymbolId],
      set: { replacementSymbolId: input.data.replacementSymbolId, note: input.data.note },
    })
    .returning();
  await recordAudit(db, {
    companyId,
    actorClerkUserId: userIdFrom(res),
    eventType: "project.library-override-saved",
    recordType: "project-library-override",
    recordId: override.id,
    details: {
      projectId: projectId.data,
      sourceSymbolId: input.data.sourceSymbolId,
      replacementSymbolId: input.data.replacementSymbolId,
    },
  });
  res.status(201).json({ override });
});

router.delete(
  "/companies/:companyId/projects/:projectId/overrides/:overrideId",
  async (req, res) => {
    const companyId = await companyAdmin(req, res);
    if (!companyId) return;
    const params = z
      .object({ projectId: z.string().uuid(), overrideId: z.string().uuid() })
      .safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project override." });
      return;
    }
    const [removed] = await db
      .delete(projectLibraryOverrides)
      .where(
        and(
          eq(projectLibraryOverrides.id, params.data.overrideId),
          eq(projectLibraryOverrides.projectId, params.data.projectId),
          eq(projectLibraryOverrides.companyId, companyId),
        ),
      )
      .returning();
    if (removed) {
      await recordAudit(db, {
        companyId,
        actorClerkUserId: userIdFrom(res),
        eventType: "project.library-override-removed",
        recordType: "project-library-override",
        recordId: removed.id,
        details: { projectId: params.data.projectId },
      });
    }
    res.status(204).end();
  },
);

router.post("/companies/:companyId/assets/request", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const input = z
    .object({
      displayName: z.string().trim().min(1).max(150),
      contentType: z.string().trim().min(1).max(120),
      sizeBytes: z.number().int().min(1).max(25 * 1024 * 1024),
      projectId: z.string().uuid().nullable().optional(),
    })
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Choose a CAD library file smaller than 25 MB." });
    return;
  }
  const extension = path.extname(input.data.displayName).toLowerCase();
  if (![".dxf", ".dwg", ".dwt"].includes(extension)) {
    res.status(415).json({ error: "Only DXF, DWG, and DWT library files are accepted here." });
    return;
  }
  if (input.data.projectId) {
    const [project] = await db
      .select({ id: cadProjects.id })
      .from(cadProjects)
      .where(
        and(
          eq(cadProjects.id, input.data.projectId),
          eq(cadProjects.companyId, companyId),
        ),
      )
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found in this company." });
      return;
    }
  }
  const assetId = randomUUID();
  const { uploadUrl, objectPath } = await createPrivateUpload(input.data.displayName);
  await db.insert(companyLibraryAssets).values({
    id: assetId,
    companyId,
    projectId: input.data.projectId ?? null,
    objectPath,
    displayName: input.data.displayName,
    contentType: input.data.contentType,
    sizeBytes: input.data.sizeBytes,
    uploadStatus: "pending",
    uploadedByClerkUserId: userIdFrom(res),
  });
  await recordAudit(db, {
    companyId,
    actorClerkUserId: userIdFrom(res),
    eventType: "library.asset-upload-started",
    recordType: "library-asset",
    recordId: assetId,
    details: { displayName: input.data.displayName, projectId: input.data.projectId ?? null },
  });
  res.status(201).json({ assetId, uploadUrl });
});

router.post("/companies/:companyId/assets/:assetId/complete", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const assetId = z.string().uuid().safeParse(req.params.assetId);
  if (!assetId.success) {
    res.status(400).json({ error: "Invalid library file." });
    return;
  }
  const [asset] = await db
    .select()
    .from(companyLibraryAssets)
    .where(
      and(
        eq(companyLibraryAssets.id, assetId.data),
        eq(companyLibraryAssets.companyId, companyId),
      ),
    )
    .limit(1);
  if (!asset) {
    res.status(404).json({ error: "Library file not found." });
    return;
  }
  try {
    const file = await getPrivateFile(asset.objectPath);
    const headers = await privateFileResponseHeaders(file);
    const actualSize = Number(headers.contentLength || 0);
    if (!actualSize || actualSize > 25 * 1024 * 1024 || actualSize !== asset.sizeBytes) {
      res.status(413).json({ error: "The uploaded file size did not match the approved limit." });
      return;
    }
    await db
      .update(companyLibraryAssets)
      .set({ uploadStatus: "ready" })
      .where(eq(companyLibraryAssets.id, asset.id));
    await recordAudit(db, {
      companyId,
      actorClerkUserId: userIdFrom(res),
      eventType: "library.asset-upload-completed",
      recordType: "library-asset",
      recordId: asset.id,
      details: { displayName: asset.displayName, sizeBytes: actualSize },
    });
    res.json({ completed: true });
  } catch {
    res.status(409).json({ error: "The private upload has not finished yet." });
  }
});

router.get("/companies/:companyId/assets/:assetId/download", async (req, res) => {
  const companyId = await companyAdmin(req, res);
  if (!companyId) return;
  const assetId = z.string().uuid().safeParse(req.params.assetId);
  if (!assetId.success) {
    res.status(400).json({ error: "Invalid library file." });
    return;
  }
  const [asset] = await db
    .select()
    .from(companyLibraryAssets)
    .where(
      and(
        eq(companyLibraryAssets.id, assetId.data),
        eq(companyLibraryAssets.companyId, companyId),
        eq(companyLibraryAssets.uploadStatus, "ready"),
      ),
    )
    .limit(1);
  if (!asset) {
    res.status(404).json({ error: "Library file not found." });
    return;
  }
  try {
    const file = await getPrivateFile(asset.objectPath);
    const headers = await privateFileResponseHeaders(file);
    res.setHeader("Content-Type", headers.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    if (headers.contentLength) res.setHeader("Content-Length", headers.contentLength);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(asset.displayName)}`,
    );
    file.createReadStream().on("error", () => res.destroy()).pipe(res);
  } catch {
    res.status(404).json({ error: "Library file could not be opened." });
  }
});

export default router;
