"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function createEmployeeRuntime({
  employeeStore,
  repoRoot,
  dockerImage = "node:22-bookworm",
  dockerEnabled = true,
  codexModulePath = "/usr/lib/node_modules/@openai/codex",
  codexCredentialSource = "",
  codexCredentialFiles = ["auth.json", "config.toml", "installation_id"],
  codexBin = "codex",
  nodeBin = process.execPath,
  fsModule = fs,
  spawnFn = spawn,
  now = () => new Date().toISOString(),
} = {}) {
  if (!employeeStore) {
    throw new Error("createEmployeeRuntime requires employeeStore.");
  }
  if (!repoRoot) {
    throw new Error("createEmployeeRuntime requires repoRoot.");
  }

  function startEmployeeRun(id, prompt, options = {}) {
    const employee = employeeStore.getEmployee(id);
    if (!employee) {
      throw new Error(`Unknown employee: ${id}`);
    }
    const run = prepareEmployeeRun(employee, prompt, options);
    if (options.dryRun) {
      return run.status;
    }
    const child = spawnFn(
      nodeBin,
      [
        path.join(__dirname, "employee-run-worker.js"),
        "--status",
        run.statusPath,
        "--prompt",
        run.promptPath,
      ],
      {
        detached: true,
        env: process.env,
        stdio: "ignore",
      }
    );
    child.unref?.();
    writeJson(run.statusPath, {
      ...run.status,
      pid: child.pid || null,
      status: "running",
      updatedAt: now(),
    });
    return {
      ...run.status,
      pid: child.pid || null,
      status: "running",
      updatedAt: now(),
    };
  }

  function prepareEmployeeRun(employee, prompt, options = {}) {
    const runId = options.runId || createRunId(employee.id, now());
    const paths = employee.paths || employeeStore.deriveEmployeePaths(employee.id);
    const runDir = path.join(paths.runsDir, runId);
    fsModule.mkdirSync(runDir, { recursive: true });

    const promptPath = path.join(runDir, "prompt.md");
    const statusPath = path.join(runDir, "status.json");
    const stdoutPath = path.join(runDir, "stdout.jsonl");
    const stderrPath = path.join(runDir, "stderr.log");
    const lastMessagePath = path.join(runDir, "last-message.md");
    const fullPrompt = buildEmployeePrompt(employee, prompt);
    fsModule.writeFileSync(promptPath, fullPrompt, "utf8");
    const credentialFilesSeeded = seedCodexCredentials({
      employee,
      sourceRoot: options.codexCredentialSource ?? codexCredentialSource,
      fileNames: options.codexCredentialFiles ?? codexCredentialFiles,
      fsModule,
    });

    const docker = buildDockerInvocation({
      dockerImage: options.dockerImage || dockerImage,
      employee,
      promptPath,
      repoRoot,
      stdoutPath,
      stderrPath,
      lastMessagePath,
      codexModulePath: options.codexModulePath || codexModulePath,
      runDir,
    });
    const host = buildHostInvocation({
      codexBin: options.codexBin || codexBin,
      employee,
      lastMessagePath,
      repoRoot,
    });
    const invocation = options.dockerEnabled ?? dockerEnabled ? docker : host;
    const status = {
      id: runId,
      employeeId: employee.id,
      employeeHome: paths.home,
      runnerHome: paths.codexHome,
      runDir,
      promptPath,
      statusPath,
      stdoutPath,
      stderrPath,
      lastMessagePath,
      containerName: docker.containerName,
      dockerEnabled: invocation.type === "docker",
      invocation,
      mattermostChannelId: employee.mattermost?.channelId || "",
      credentialFilesSeeded,
      createdAt: now(),
      updatedAt: now(),
      status: options.dryRun ? "prepared" : "starting",
      pid: null,
    };
    writeJson(statusPath, status);
    return { promptPath, status, statusPath };
  }

  return {
    prepareEmployeeRun,
    startEmployeeRun,
  };
}

function seedCodexCredentials({ employee, sourceRoot = "", fileNames = [], fsModule = fs } = {}) {
  const paths = employee.paths || {};
  const destinationRoot = paths.codexHome || "";
  const resolvedSourceRoot = sourceRoot ? path.resolve(sourceRoot) : "";
  if (!resolvedSourceRoot || !destinationRoot) {
    return [];
  }
  const copied = [];
  fsModule.mkdirSync(destinationRoot, { recursive: true });
  for (const fileName of fileNames || []) {
    const relativeName = normalizeCredentialFileName(fileName);
    if (!relativeName) {
      continue;
    }
    const sourcePath = path.join(resolvedSourceRoot, relativeName);
    const destinationPath = path.join(destinationRoot, relativeName);
    try {
      const sourceStat = fsModule.statSync(sourcePath);
      if (!sourceStat.isFile()) {
        continue;
      }
      const destinationStat = statOrNull(fsModule, destinationPath);
      if (destinationStat && destinationStat.mtimeMs >= sourceStat.mtimeMs) {
        continue;
      }
      fsModule.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fsModule.copyFileSync(sourcePath, destinationPath);
      fsModule.chmodSync?.(destinationPath, sourceStat.mode & 0o777);
      copied.push(relativeName);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return copied;
}

function normalizeCredentialFileName(fileName) {
  const value = String(fileName || "").trim();
  if (!value || path.isAbsolute(value) || value.includes("..")) {
    return "";
  }
  return value;
}

function statOrNull(fsModule, filePath) {
  try {
    return fsModule.statSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function buildEmployeePrompt(employee, prompt) {
  const paths = employee.paths || {};
  return [
    `You are ${employee.displayName || employee.id}, a Sable employee instance.`,
    "",
    `Employee id: ${employee.id}`,
    `Role: ${employee.role || "general"}`,
    `Employee home: ${paths.home || ""}`,
    `Log path: ${paths.logPath || ""}`,
    `Runs dir: ${paths.runsDir || ""}`,
    `Mattermost channel id: ${employee.mattermost?.channelId || "not configured"}`,
    "",
    "You use the same Sable codebase as parent Sable, but your state is isolated.",
    "You may inspect your own logs, memory, task files, and schedule.",
    "Parent Sable may inspect all employee logs and state.",
    "Stay within your employee scope unless the task explicitly asks for repo work.",
    "You must not hire, create, archive, start, or manage other Sable employees. Escalate employee-management needs to parent Sable.",
    "",
    "Task:",
    String(prompt || "").trim(),
    "",
  ].join("\n");
}

function buildDockerInvocation({
  dockerImage,
  employee,
  promptPath,
  repoRoot,
  lastMessagePath,
  codexModulePath,
  runDir,
}) {
  const paths = employee.paths || {};
  const containerName = `sable-employee-${employee.id}-${path.basename(runDir)}`.slice(0, 120);
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "-i",
    "-v",
    `${path.resolve(repoRoot)}:/workspace:ro`,
    "-v",
    `${path.resolve(paths.home)}:/employee`,
    "-v",
    `${path.resolve(paths.codexHome)}:/runner/codex-home`,
    "-v",
    `${path.resolve(codexModulePath)}:/opt/codex:ro`,
    "-e",
    "SABLE_INSTANCE_MODE=employee",
    "-e",
    `SABLE_EMPLOYEE_ID=${employee.id}`,
    "-e",
    "CODEX_HOME=/runner/codex-home",
    dockerImage,
    "node",
    "/opt/codex/bin/codex.js",
    "exec",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    "/workspace",
    "-o",
    containerPathForEmployeeFile(lastMessagePath),
    "-",
  ];
  return {
    type: "docker",
    bin: "docker",
    args,
    containerName,
    stdinPath: promptPath,
  };
}

function buildHostInvocation({ codexBin, employee, lastMessagePath, repoRoot }) {
  return {
    type: "host",
    bin: codexBin,
    args: [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--cd",
      repoRoot,
      "-o",
      lastMessagePath,
      "-",
    ],
    env: {
      CODEX_HOME: employee.paths?.codexHome || "",
      SABLE_INSTANCE_MODE: "employee",
      SABLE_EMPLOYEE_ID: employee.id,
    },
  };
}

function containerPathForEmployeeFile(filePath) {
  const marker = "/logs/runs/";
  const index = String(filePath).indexOf(marker);
  if (index === -1) {
    return "/employee/logs/last-message.md";
  }
  return `/employee${String(filePath).slice(index)}`;
}

function createRunId(employeeId, isoTimestamp) {
  const stamp = String(isoTimestamp || new Date().toISOString())
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `${stamp}-${employeeId}`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

module.exports = {
  buildDockerInvocation,
  buildEmployeePrompt,
  buildHostInvocation,
  createEmployeeRuntime,
};
