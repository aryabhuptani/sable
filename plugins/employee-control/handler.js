"use strict";

function registerPlugin(api) {
  api.registerCommand(
    "/employee",
    async ({ args }) => handleEmployeeCommand(args, api),
    { description: "Manage Sable employee instances." }
  );
}

async function handleEmployeeCommand(args, api) {
  const services = api.services || {};
  const store = services.employeeStore;
  const runtime = services.employeeRuntime;
  if (!store) {
    return "Employee store is not available.";
  }
  const tokens = tokenize(args);
  const subcommand = tokens.shift() || "list";

  if (subcommand === "list") {
    const employees = store.listEmployees();
    if (employees.length === 0) {
      return "No Sable employees exist yet.";
    }
    return [
      `Sable employees: ${employees.length}`,
      ...employees.map((employee) =>
        `- ${employee.id}: ${employee.displayName} (${employee.role}, ${employee.status})`
      ),
    ].join("\n");
  }

  if (subcommand === "create") {
    const id = tokens.shift();
    if (!id) {
      return "Usage: /employee create <id> [role]";
    }
    const role = tokens.join(" ") || "general";
    const result = store.createEmployee({ id, role });
    return result.created
      ? `Created employee ${result.employee.id} (${result.employee.role}).`
      : `Employee ${result.employee.id} already exists.`;
  }

  if (subcommand === "show" || subcommand === "status") {
    const id = tokens.shift();
    if (!id) {
      return "Usage: /employee show <id>";
    }
    const employee = store.getEmployee(id);
    if (!employee) {
      return `No employee matched ${id}.`;
    }
    return formatEmployee(employee);
  }

  if (subcommand === "logs") {
    const id = tokens.shift();
    if (!id) {
      return "Usage: /employee logs <id>";
    }
    const employee = store.getEmployee(id);
    if (!employee) {
      return `No employee matched ${id}.`;
    }
    return [
      `${employee.id} logs:`,
      `- log: ${employee.paths?.logPath || ""}`,
      `- runs: ${employee.paths?.runsDir || ""}`,
      `- mattermost: ${employee.paths?.mattermostLogPath || ""}`,
      `- scheduler: ${employee.paths?.schedulerLogPath || ""}`,
    ].join("\n");
  }

  if (subcommand === "start") {
    const id = tokens.shift();
    const prompt = tokens.join(" ");
    if (!id || !prompt) {
      return "Usage: /employee start <id> <prompt>";
    }
    if (!store.getEmployee(id)) {
      return `No employee matched ${id}.`;
    }
    if (!runtime) {
      return "Employee runtime is not available.";
    }
    const status = runtime.startEmployeeRun(id, prompt);
    return [
      `Started employee run ${status.id} for ${status.employeeId}.`,
      `status: ${status.status}`,
      `logs: ${status.runDir}`,
    ].join("\n");
  }

  return [
    "Employee commands:",
    "- /employee list",
    "- /employee create <id> [role]",
    "- /employee show <id>",
    "- /employee logs <id>",
    "- /employee start <id> <prompt>",
  ].join("\n");
}

function formatEmployee(employee) {
  return [
    `${employee.displayName} (${employee.id})`,
    `role: ${employee.role}`,
    `status: ${employee.status}`,
    `home: ${employee.paths?.home || ""}`,
    `runtime: ${employee.paths?.runtime || ""}`,
    `mattermost channel: ${employee.mattermost?.channelId || employee.mattermost?.channelName || "none"}`,
    `connectors: ${employee.connectors?.mode || "disabled"}`,
  ].join("\n");
}

function tokenize(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

module.exports = {
  handleEmployeeCommand,
  registerPlugin,
};
