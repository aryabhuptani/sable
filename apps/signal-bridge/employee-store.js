"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REGISTRY_VERSION = 1;
const DEFAULT_CONNECTORS = {
  mode: "disabled",
  allowEnv: [],
  shared: [],
};

function createEmployeeStore({
  agentsRoot = "",
  runtimeRoot = "",
  fsModule = fs,
  now = () => new Date().toISOString(),
} = {}) {
  if (!agentsRoot) {
    throw new Error("createEmployeeStore requires agentsRoot.");
  }
  if (!runtimeRoot) {
    throw new Error("createEmployeeStore requires runtimeRoot.");
  }

  const resolvedAgentsRoot = path.resolve(agentsRoot);
  const resolvedRuntimeRoot = path.resolve(runtimeRoot);
  const registryPath = path.join(resolvedAgentsRoot, "registry.json");

  function ensureRootDirs() {
    fsModule.mkdirSync(resolvedAgentsRoot, { recursive: true });
    fsModule.mkdirSync(resolvedRuntimeRoot, { recursive: true });
  }

  function loadRegistry() {
    try {
      const parsed = JSON.parse(fsModule.readFileSync(registryPath, "utf8"));
      const employees = Array.isArray(parsed.employees) ? parsed.employees : [];
      return {
        version: parsed.version === REGISTRY_VERSION ? parsed.version : REGISTRY_VERSION,
        employees: employees.map(normalizeEmployeeRecord).filter(Boolean),
      };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { version: REGISTRY_VERSION, employees: [] };
      }
      throw error;
    }
  }

  function saveRegistry(registry) {
    ensureRootDirs();
    const normalized = {
      version: REGISTRY_VERSION,
      employees: (registry.employees || []).map(normalizeEmployeeRecord).filter(Boolean),
    };
    fsModule.writeFileSync(registryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return normalized;
  }

  function listEmployees() {
    return loadRegistry().employees;
  }

  function getEmployee(id) {
    const normalizedId = normalizeEmployeeId(id);
    return loadRegistry().employees.find((employee) => employee.id === normalizedId) || null;
  }

  function createEmployee({
    id,
    displayName = "",
    role = "",
    mattermost = {},
    connectors = DEFAULT_CONNECTORS,
    force = false,
  } = {}) {
    ensureRootDirs();
    const normalizedId = normalizeEmployeeId(id);
    const registry = loadRegistry();
    const existing = registry.employees.find((employee) => employee.id === normalizedId);
    if (existing && !force) {
      ensureEmployeeSkeleton(existing, { overwrite: false });
      return { created: false, employee: existing };
    }

    const timestamp = now();
    const paths = deriveEmployeePaths(normalizedId);
    const employee = normalizeEmployeeRecord({
      id: normalizedId,
      displayName: displayName || titleizeId(normalizedId),
      role: role || "general",
      status: "active",
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      mattermost: normalizeMattermost(mattermost),
      connectors: normalizeConnectors(connectors),
      paths,
    });

    if (existing) {
      registry.employees = registry.employees.map((entry) =>
        entry.id === normalizedId ? employee : entry
      );
    } else {
      registry.employees.push(employee);
    }
    registry.employees.sort((a, b) => a.id.localeCompare(b.id));
    saveRegistry(registry);
    ensureEmployeeSkeleton(employee, { overwrite: Boolean(force) });
    return { created: !existing, employee };
  }

  function updateEmployee(id, patch = {}) {
    const normalizedId = normalizeEmployeeId(id);
    const registry = loadRegistry();
    let updated = null;
    registry.employees = registry.employees.map((employee) => {
      if (employee.id !== normalizedId) {
        return employee;
      }
      updated = normalizeEmployeeRecord({
        ...employee,
        ...patch,
        id: employee.id,
        createdAt: employee.createdAt,
        updatedAt: now(),
        mattermost: normalizeMattermost({
          ...(employee.mattermost || {}),
          ...(patch.mattermost || {}),
        }),
        connectors: normalizeConnectors({
          ...(employee.connectors || {}),
          ...(patch.connectors || {}),
        }),
        paths: employee.paths || deriveEmployeePaths(employee.id),
      });
      return updated;
    });
    if (!updated) {
      throw new Error(`Unknown employee: ${normalizedId}`);
    }
    saveRegistry(registry);
    return updated;
  }

  function archiveEmployee(id) {
    return updateEmployee(id, { status: "archived" });
  }

  function deriveEmployeePaths(id) {
    const normalizedId = normalizeEmployeeId(id);
    const home = assertInsideRoot(path.join(resolvedAgentsRoot, normalizedId), resolvedAgentsRoot);
    const runtime = assertInsideRoot(
      path.join(resolvedRuntimeRoot, normalizedId),
      resolvedRuntimeRoot
    );
    return {
      home,
      runtime,
      agentsPath: path.join(home, "AGENTS.md"),
      profilePath: path.join(home, "PROFILE.md"),
      tasksPath: path.join(home, "TASKS.md"),
      schedulePath: path.join(home, "SCHEDULE.json"),
      connectorsPath: path.join(home, "CONNECTORS.json"),
      statePath: path.join(home, "STATE.json"),
      logPath: path.join(home, "LOG.md"),
      logsDir: path.join(home, "logs"),
      runsDir: path.join(home, "logs", "runs"),
      mattermostLogPath: path.join(home, "logs", "mattermost.jsonl"),
      schedulerLogPath: path.join(home, "logs", "scheduler.jsonl"),
      memoryRoot: path.join(home, "memory"),
      knowledgeRoot: path.join(home, "memory", "knowledge"),
      tasksRoot: path.join(home, "memory", "tasks"),
      codexHome: path.join(runtime, "codex-home"),
      claudeHome: path.join(runtime, "claude-home"),
      containerHome: path.join(runtime, "container-home"),
      mattermostTokenPath: path.join(runtime, "mattermost-token"),
    };
  }

  function ensureEmployeeSkeleton(employee, { overwrite = false } = {}) {
    const paths = employee.paths || deriveEmployeePaths(employee.id);
    for (const dir of [
      paths.home,
      paths.logsDir,
      paths.runsDir,
      paths.memoryRoot,
      paths.knowledgeRoot,
      paths.tasksRoot,
      paths.runtime,
      paths.codexHome,
      paths.claudeHome,
      paths.containerHome,
    ]) {
      fsModule.mkdirSync(dir, { recursive: true });
    }

    writeIfMissing(paths.agentsPath, renderAgents(employee), overwrite);
    writeIfMissing(paths.profilePath, renderProfile(employee), overwrite);
    writeIfMissing(paths.tasksPath, "# Tasks\n\n", overwrite);
    writeJsonIfMissing(paths.schedulePath, { version: 1, jobs: [] }, overwrite);
    writeJsonIfMissing(paths.connectorsPath, employee.connectors || DEFAULT_CONNECTORS, overwrite);
    writeJsonIfMissing(
      paths.statePath,
      {
        version: 1,
        employeeId: employee.id,
        status: employee.status || "active",
        createdAt: employee.createdAt || now(),
        updatedAt: employee.updatedAt || now(),
      },
      overwrite
    );
    writeIfMissing(paths.logPath, `# ${employee.displayName || employee.id} Log\n\n`, overwrite);
  }

  function writeIfMissing(filePath, content, overwrite) {
    if (!overwrite && fsModule.existsSync(filePath)) {
      return;
    }
    fsModule.writeFileSync(filePath, content, "utf8");
  }

  function writeJsonIfMissing(filePath, value, overwrite) {
    writeIfMissing(filePath, `${JSON.stringify(value, null, 2)}\n`, overwrite);
  }

  return {
    agentsRoot: resolvedAgentsRoot,
    archiveEmployee,
    createEmployee,
    deriveEmployeePaths,
    ensureEmployeeSkeleton,
    getEmployee,
    listEmployees,
    loadRegistry,
    registryPath,
    runtimeRoot: resolvedRuntimeRoot,
    saveRegistry,
    updateEmployee,
  };
}

function normalizeEmployeeId(value) {
  const raw = String(value || "").trim();
  if (raw.includes("/") || raw.includes("\\") || raw === "." || raw === ".." || raw.includes("..")) {
    throw new Error(`Unsafe employee id: ${value}`);
  }
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) {
    throw new Error("Employee id is required.");
  }
  if (id.length > 64) {
    throw new Error("Employee id is too long.");
  }
  return id;
}

function normalizeEmployeeRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const id = normalizeEmployeeId(record.id);
  return {
    id,
    displayName: String(record.displayName || titleizeId(id)),
    role: String(record.role || "general"),
    status: String(record.status || "active"),
    createdAt: String(record.createdAt || ""),
    updatedAt: String(record.updatedAt || ""),
    mattermost: normalizeMattermost(record.mattermost),
    connectors: normalizeConnectors(record.connectors),
    paths: record.paths && typeof record.paths === "object" ? { ...record.paths } : null,
  };
}

function normalizeMattermost(value = {}) {
  return {
    channelId: String(value.channelId || ""),
    channelName: String(value.channelName || ""),
    userId: String(value.userId || ""),
    username: String(value.username || ""),
    tokenPath: String(value.tokenPath || ""),
  };
}

function normalizeConnectors(value = {}) {
  const mode = ["disabled", "shared", "env-allowlist", "isolated"].includes(value.mode)
    ? value.mode
    : "disabled";
  return {
    mode,
    allowEnv: Array.isArray(value.allowEnv)
      ? value.allowEnv.map(String).filter(Boolean)
      : [],
    shared: Array.isArray(value.shared)
      ? value.shared.map(String).filter(Boolean)
      : [],
  };
}

function assertInsideRoot(candidatePath, rootPath) {
  const resolved = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes root: ${candidatePath}`);
  }
  return resolved;
}

function titleizeId(id) {
  return String(id || "")
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function renderAgents(employee) {
  return [
    `# ${employee.displayName || employee.id}`,
    "",
    `You are ${employee.displayName || employee.id}, a Sable employee instance.`,
    "",
    `Employee id: \`${employee.id}\``,
    `Role: \`${employee.role || "general"}\``,
    "",
    "You use the same Sable codebase as parent Sable, but you have your own memory, task list, schedule, connector policy, and logs.",
    "You may read your own logs and state. Parent Sable may read all employee logs and state.",
    "You must not hire, create, archive, start, or manage other Sable employees. Escalate employee-management needs to parent Sable.",
    "Communicate through Mattermost when Mattermost context is provided.",
    "",
  ].join("\n");
}

function renderProfile(employee) {
  return [
    `# ${employee.displayName || employee.id} Profile`,
    "",
    `- id: ${employee.id}`,
    `- role: ${employee.role || "general"}`,
    `- status: ${employee.status || "active"}`,
    "",
  ].join("\n");
}

module.exports = {
  REGISTRY_VERSION,
  createEmployeeStore,
  normalizeEmployeeId,
};
