import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  CloudUpload,
  Download,
  FileText,
  FolderKanban,
  Layers3,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { UserButton } from "@clerk/react";

type Membership = {
  companyId: string;
  companyName: string;
  role: "owner" | "admin" | "member";
};
type LibrarySymbol = {
  id: string;
  externalId: string;
  name: string;
  category: string;
  discipline: "P&ID" | "PFD";
  status: "needs-review" | "approved" | "excluded";
  metadata: Record<string, unknown>;
};
type LibraryAsset = {
  id: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  uploadStatus: string;
  projectId: string | null;
  createdAt: string;
};
type Project = { id: string; name: string };
type Override = {
  id: string;
  sourceSymbolId: string;
  replacementSymbolId: string;
  note: string;
  sourceName: string;
};
type AuditEvent = {
  id: string;
  actorClerkUserId: string;
  eventType: string;
  recordType: string;
  recordId: string;
  details: Record<string, unknown>;
  createdAt: string;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    credentials: "include",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "This change could not be saved.");
  }
  return body as T;
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-teal-800 text-white hover:bg-teal-900",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    quiet: "text-slate-600 hover:bg-slate-100",
    danger: "text-rose-700 hover:bg-rose-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export default function AdminLibraryPage() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [symbols, setSymbols] = useState<LibrarySymbol[]>([]);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [overrideSource, setOverrideSource] = useState("");
  const [overrideReplacement, setOverrideReplacement] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [canCreateCompany, setCanCreateCompany] = useState(false);
  const jsonInput = useRef<HTMLInputElement>(null);
  const cadInput = useRef<HTMLInputElement>(null);

  const currentMembership = memberships.find((entry) => entry.companyId === companyId);
  const isOwner = currentMembership?.role === "owner";
  const filteredSymbols = useMemo(() => {
    const text = query.trim().toLowerCase();
    return symbols.filter(
      (item) =>
        !text ||
        item.name.toLowerCase().includes(text) ||
        item.category.toLowerCase().includes(text) ||
        item.discipline.toLowerCase().includes(text),
    );
  }, [symbols, query]);
  const approvedSymbols = symbols.filter((item) => item.status === "approved");

  async function loadSession() {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ memberships: Membership[]; canCreateCompany: boolean }>("/session");
      setMemberships(data.memberships);
      setCanCreateCompany(data.canCreateCompany);
      setCompanyId((current) =>
        data.memberships.some((membership) => membership.companyId === current)
          ? current
          : data.memberships[0]?.companyId || "",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin access could not be checked.");
    } finally {
      setLoading(false);
    }
  }

  async function loadCompany(company: string) {
    if (!company) return;
    setError("");
    try {
      const [library, projectData] = await Promise.all([
        api<{ symbols: LibrarySymbol[]; assets: LibraryAsset[]; projects: Project[]; audit: AuditEvent[] }>(
          `/companies/${company}/library`,
        ),
        api<{ projects: Project[] }>(`/companies/${company}/projects`),
      ]);
      setSymbols(library.symbols);
      setAssets(library.assets);
      setAudit(library.audit);
      setProjects(projectData.projects);
      setSelectedProject((current) =>
        projectData.projects.some((project) => project.id === current)
          ? current
          : projectData.projects[0]?.id || "",
      );
    } catch (cause) {
      setSymbols([]);
      setAssets([]);
      setAudit([]);
      setProjects([]);
      setError(cause instanceof Error ? cause.message : "Legends Library could not be loaded.");
    }
  }

  async function loadOverrides(projectId: string) {
    if (!companyId || !projectId) {
      setOverrides([]);
      return;
    }
    try {
      const data = await api<{ overrides: Override[] }>(
        `/companies/${companyId}/projects/${projectId}/overrides`,
      );
      setOverrides(data.overrides);
    } catch {
      setOverrides([]);
    }
  }

  useEffect(() => {
    void loadSession();
  }, []);

  useEffect(() => {
    void loadCompany(companyId);
  }, [companyId]);

  useEffect(() => {
    void loadOverrides(selectedProject);
  }, [companyId, selectedProject]);

  async function runAction(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await loadCompany(companyId);
      await loadOverrides(selectedProject);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function importJson(file: File) {
    const parsed = JSON.parse(await file.text()) as { items?: unknown[]; symbols?: unknown[] } | unknown[];
    const rawItems = Array.isArray(parsed)
      ? parsed
      : parsed.items || parsed.symbols || [];
    const items = rawItems.map((raw, index) => {
      const item = raw as Record<string, unknown>;
      const name = String(item.name || item.label || "").trim();
      if (!name) throw new Error(`Item ${index + 1} has no name.`);
      return {
        id: String(item.id || item.key || `${name}-${index + 1}`),
        name,
        category: String(item.category || "Other"),
        discipline: item.discipline === "PFD" ? "PFD" : "P&ID",
        entityCount:
          typeof item.entityCount === "number" ? item.entityCount : undefined,
        hasVectorGeometry:
          typeof item.hasVectorGeometry === "boolean" ? item.hasVectorGeometry : undefined,
      };
    });
    await runAction(async () => {
      await api(`/companies/${companyId}/library/import`, {
        method: "POST",
        body: JSON.stringify({ items }),
      });
    }, `${items.length} items imported for review. Nothing was auto-approved.`);
  }

  async function uploadCadFile(file: File) {
    await runAction(async () => {
      const request = await api<{ assetId: string; uploadUrl: string }>(
        `/companies/${companyId}/assets/request`,
        {
          method: "POST",
          body: JSON.stringify({
            displayName: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          }),
        },
      );
      const upload = await fetch(request.uploadUrl, { method: "PUT", body: file });
      if (!upload.ok) throw new Error("The private CAD file upload failed. Try again.");
      await api(`/companies/${companyId}/assets/${request.assetId}/complete`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    }, "CAD file saved in private company storage.");
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-600">
          <RefreshCw className="h-4 w-4 animate-spin" /> Checking admin access…
        </div>
      </main>
    );
  }

  if (!memberships.length) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-8">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-teal-800">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">Admin access needed</h1>
          <p className="mt-3 leading-7 text-slate-600">
            This area holds the private Legends Library. Your account does not have access yet.
            The Legends Library owner must approve your verified account email.
          </p>
          {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          <div className="mt-7 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => void loadSession()}>
              <RefreshCw className="h-4 w-4" /> Check again
            </Button>
            <Link href="/" className="inline-flex min-h-10 items-center rounded-lg px-3.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to workspace
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f7f7] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Back to workspace"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-800 text-white">
              <Layers3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-800">Private workspace</p>
              <h1 className="truncate text-lg font-bold sm:text-xl">Engineering Data Manager</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs font-medium text-slate-500 sm:inline">© 2026 gaurav.cbiindia</span>
            <UserButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-teal-800">
              <ShieldCheck className="h-4 w-4" /> Admin-only data
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Legends Library and project standards</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              The Legends Library stays private. Project rules only affect the selected project.
              New library items need an admin’s approval before they are treated as standard.
            </p>
          </div>
          <label className="flex min-w-56 flex-col gap-1.5 text-xs font-semibold text-slate-600">
            Company
            <span className="relative">
              <select
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm font-semibold text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/15"
              >
                {memberships.map((membership) => (
                  <option key={membership.companyId} value={membership.companyId}>
                    {membership.companyName} · {membership.role}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-500" />
            </span>
          </label>
        </div>

        {(message || error) && (
          <div
            role={error ? "alert" : "status"}
            className={`mb-5 flex items-start gap-2 rounded-xl border p-3.5 text-sm ${
              error
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {error ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{error || message}</span>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)]">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                  <Layers3 className="h-4 w-4" /> Legends Library
                </div>
                <p className="mt-1 text-sm text-slate-500">{symbols.length} items · {symbols.filter((item) => item.status === "approved").length} approved</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => jsonInput.current?.click()}>
                  <FileText className="h-4 w-4" /> Import list
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => cadInput.current?.click()}>
                  <CloudUpload className="h-4 w-4" /> Add CAD file
                </Button>
                {import.meta.env.DEV && (
                  <Button
                    disabled={busy || symbols.length > 0}
                    onClick={() =>
                      void runAction(async () => {
                        await api(`/companies/${companyId}/library/import-supplied`, {
                          method: "POST",
                          body: JSON.stringify({}),
                        });
                      }, "Supplied library imported privately. Review every item before using it.")
                    }
                  >
                    <Archive className="h-4 w-4" /> Import supplied library
                  </Button>
                )}
              </div>
              <input
                ref={jsonInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importJson(file).finally(() => { event.target.value = ""; });
                }}
              />
              <input
                ref={cadInput}
                type="file"
                accept=".dxf,.dwg,.dwt"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadCadFile(file).finally(() => { event.target.value = ""; });
                }}
              />
            </div>

            <div className="border-b border-slate-100 px-5 py-4">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search symbol, category, or discipline"
                className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/15 sm:max-w-sm"
              />
            </div>

            <div className="max-h-[580px] overflow-auto">
              {filteredSymbols.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <Layers3 className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 font-semibold text-slate-700">No library items yet</p>
                  <p className="mt-1 text-sm text-slate-500">Import a JSON item list or add a private CAD file.</p>
                </div>
              ) : (
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Library item</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Part</th>
                      <th className="px-4 py-3 font-semibold">Review</th>
                      <th className="px-5 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSymbols.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                        <td className="max-w-[300px] px-5 py-3.5">
                          <div className="truncate font-semibold text-slate-900">{item.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.externalId}</div>
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">{item.category}</td>
                        <td className="px-4 py-3.5 text-slate-600">{item.discipline}</td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              item.status === "approved"
                                ? "bg-emerald-50 text-emerald-800"
                                : item.status === "excluded"
                                  ? "bg-slate-100 text-slate-600"
                                  : "bg-amber-50 text-amber-800"
                            }`}
                          >
                            {item.status === "needs-review" ? "Needs review" : item.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Button
                            variant={item.status === "approved" ? "quiet" : "secondary"}
                            disabled={busy}
                            onClick={() =>
                              void runAction(async () => {
                                const nextStatus = item.status === "approved" ? "needs-review" : "approved";
                                await api(`/companies/${companyId}/library/${item.id}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ status: nextStatus }),
                                });
                              }, item.status === "approved" ? "Item moved back to review." : "Item approved.")
                            }
                          >
                            {item.status === "approved" ? "Undo approval" : "Approve"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                <FolderKanban className="h-4 w-4" /> Project library rules
              </div>
              <p className="mt-1 text-sm leading-5 text-slate-500">
                Replace a company symbol for one project only. The company default stays unchanged.
              </p>
              {projects.length > 0 && (
                <>
                  <label className="mt-4 block text-xs font-semibold text-slate-600">
                    Project
                    <select
                      value={selectedProject}
                      onChange={(event) => setSelectedProject(event.target.value)}
                      className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    >
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                  </label>
                  <div className="mt-4 grid gap-3">
                    <select
                      value={overrideSource}
                      onChange={(event) => setOverrideSource(event.target.value)}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      <option value="">Choose the source item</option>
                      {symbols.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <select
                      value={overrideReplacement}
                      onChange={(event) => setOverrideReplacement(event.target.value)}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
                    >
                      <option value="">Choose approved replacement</option>
                      {approvedSymbols.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <input
                      value={overrideNote}
                      onChange={(event) => setOverrideNote(event.target.value)}
                      placeholder="Optional note"
                      className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
                    />
                    <Button
                      disabled={busy || !selectedProject || !overrideSource || !overrideReplacement}
                      onClick={() =>
                        void runAction(async () => {
                          await api(`/companies/${companyId}/projects/${selectedProject}/overrides`, {
                            method: "POST",
                            body: JSON.stringify({
                              sourceSymbolId: overrideSource,
                              replacementSymbolId: overrideReplacement,
                              note: overrideNote,
                            }),
                          });
                          setOverrideNote("");
                        }, "Project-only replacement rule saved.")
                      }
                    >
                      <Plus className="h-4 w-4" /> Save project rule
                    </Button>
                  </div>
                  <div className="mt-5 space-y-2 border-t border-slate-100 pt-4">
                    {overrides.length ? overrides.map((override) => (
                      <div key={override.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                        <span className="min-w-0 truncate font-medium">{override.sourceName}</span>
                        <Button
                          variant="danger"
                          disabled={busy}
                          onClick={() =>
                            void runAction(async () => {
                              await api(`/companies/${companyId}/projects/${selectedProject}/overrides/${override.id}`, { method: "DELETE" });
                            }, "Project rule removed.")
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    )) : <p className="text-xs text-slate-500">No project-only rules saved yet.</p>}
                  </div>
                </>
              )}
              <form
                className="mt-5 flex gap-2 border-t border-slate-100 pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!projectName.trim()) return;
                  void runAction(async () => {
                    const response = await api<{ project: Project }>(`/companies/${companyId}/projects`, {
                      method: "POST",
                      body: JSON.stringify({ name: projectName }),
                    });
                    setProjectName("");
                    setProjects((current) => [...current, response.project]);
                    setSelectedProject(response.project.id);
                  }, "Project created.");
                }}
              >
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="New project name"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                />
                <Button type="submit" disabled={busy || projectName.trim().length < 2}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </form>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                <FileText className="h-4 w-4" /> Private CAD files
              </div>
              <p className="mt-1 text-sm text-slate-500">Files are available to approved company admins only.</p>
              <div className="mt-4 space-y-2">
                {assets.length ? assets.map((asset) => (
                  <div key={asset.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{asset.displayName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {asset.uploadStatus === "ready" ? `${Math.ceil(asset.sizeBytes / 1024)} KB` : "Upload pending"}
                        {asset.projectId ? " · Project file" : " · Company default"}
                      </p>
                    </div>
                    {asset.uploadStatus === "ready" && (
                      <a
                        href={`/api/admin/companies/${companyId}/assets/${asset.id}/download`}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
                        aria-label={`Download ${asset.displayName}`}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                )) : <p className="text-xs text-slate-500">No CAD files have been uploaded.</p>}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                <RefreshCw className="h-4 w-4" /> Change history
              </div>
              <p className="mt-1 text-sm text-slate-500">Private record of library, project, and admin changes.</p>
              <div className="mt-4 max-h-64 space-y-2 overflow-auto">
                {audit.length ? audit.map((entry) => (
                  <div key={entry.id} className="rounded-lg bg-slate-50 px-3 py-2.5">
                    <p className="text-sm font-semibold text-slate-800">
                      {entry.eventType.replaceAll(".", " ").replaceAll("-", " ")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(entry.createdAt).toLocaleString()} · Admin …{entry.actorClerkUserId.slice(-6)}
                    </p>
                  </div>
                )) : <p className="text-xs text-slate-500">No changes have been recorded yet.</p>}
              </div>
            </section>

            {isOwner && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                  <Users className="h-4 w-4" /> Approved admins
                </div>
                <p className="mt-1 text-sm text-slate-500">Only add a verified account you trust with the Legends Library.</p>
                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runAction(async () => {
                      await api(`/companies/${companyId}/admins`, {
                        method: "POST",
                        body: JSON.stringify({ email: adminEmail }),
                      });
                      setAdminEmail("");
                    }, "Admin access approved.");
                  }}
                >
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(event) => setAdminEmail(event.target.value)}
                    placeholder="Verified company email"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                    required
                  />
                  <Button type="submit" disabled={busy}><Plus className="h-4 w-4" /> Add</Button>
                </form>
              </section>
            )}

            {canCreateCompany && isOwner && (
              <form
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runAction(async () => {
                    await api("/companies", {
                      method: "POST",
                      body: JSON.stringify({ name: companyName }),
                    });
                    setCompanyName("");
                    await loadSession();
                  }, "Company space created with its own private library.");
                }}
              >
                <label className="block text-sm font-semibold text-slate-800">Add another company</label>
                <div className="mt-3 flex gap-2">
                  <input
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    placeholder="Company name"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                    minLength={2}
                  />
                  <Button type="submit" disabled={busy || companyName.trim().length < 2}>
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Library approval and project rules are saved privately. The current PDF-to-CAD runner does not yet apply these rules automatically; conversion integration and AutoCAD validation remain separate work.
          </p>
        </div>
      </div>
    </main>
  );
}
