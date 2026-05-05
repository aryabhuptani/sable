const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGINS_ROOT = path.join(REPO_ROOT, "plugins");

const REQUIRED_FIELDS = [
  "id",
  "name",
  "version",
  "pluginApiVersion",
  "status",
  "category",
  "description",
  "runtime",
  "capabilities",
  "commands",
  "requiredConfig",
  "requiredSecrets",
  "diagnostics",
];

const VALID_STATUSES = new Set(["descriptive", "experimental", "stable"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const PRIVATE_PATH_PATTERN = /\/home\/arya(?:\/|$)/;
const CURRENT_PLUGIN_API_VERSION = 1;

function findPluginManifestPaths(pluginsRoot = PLUGINS_ROOT) {
  if (!fs.existsSync(pluginsRoot)) {
    return [];
  }

  return fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "schema")
    .map((entry) => path.join(pluginsRoot, entry.name, "plugin.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort();
}

function findPluginManifestPathsFromRoots(roots = []) {
  const seen = new Set();
  const paths = [];
  for (const root of roots) {
    for (const manifestPath of findPluginManifestPaths(root)) {
      const resolved = path.resolve(manifestPath);
      if (seen.has(resolved)) {
        continue;
      }
      seen.add(resolved);
      paths.push(resolved);
    }
  }
  return paths.sort();
}

function loadPluginManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function loadPluginManifests(pluginsRoot = PLUGINS_ROOT) {
  return findPluginManifestPaths(pluginsRoot).map((manifestPath) => ({
    source: "official",
    manifestPath,
    manifest: loadPluginManifest(manifestPath),
  }));
}

function loadPluginManifestsFromPaths(manifestPaths, { source = "local" } = {}) {
  return manifestPaths.map((manifestPath) => ({
    source,
    manifestPath,
    manifest: loadPluginManifest(manifestPath),
  }));
}

function loadPluginManifestsFromRoots(roots = [], { source = "local" } = {}) {
  return loadPluginManifestsFromPaths(findPluginManifestPathsFromRoots(roots), { source });
}

function validatePluginManifest(manifest, { manifestPath = "plugin.json" } = {}) {
  const errors = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [`${manifestPath}: manifest must be an object`];
  }

  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(manifest, field)) {
      errors.push(`${manifestPath}: missing required field ${field}`);
    }
  }

  if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) {
    errors.push(`${manifestPath}: id must be lowercase kebab-case`);
  }
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    errors.push(`${manifestPath}: name must be a non-empty string`);
  }
  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    errors.push(`${manifestPath}: version must be a non-empty string`);
  }
  if (manifest.pluginApiVersion !== CURRENT_PLUGIN_API_VERSION) {
    errors.push(`${manifestPath}: pluginApiVersion must be ${CURRENT_PLUGIN_API_VERSION}`);
  }
  if (!VALID_STATUSES.has(manifest.status)) {
    errors.push(`${manifestPath}: status must be one of ${[...VALID_STATUSES].join(", ")}`);
  }
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    errors.push(`${manifestPath}: capabilities must be a non-empty array`);
  }
  for (const field of ["commands", "requiredConfig", "requiredSecrets", "diagnostics"]) {
    if (!Array.isArray(manifest[field])) {
      errors.push(`${manifestPath}: ${field} must be an array`);
    }
  }
  if (!manifest.runtime || typeof manifest.runtime !== "object" || Array.isArray(manifest.runtime)) {
    errors.push(`${manifestPath}: runtime must be an object`);
  }

  const privatePathLeaks = findPrivatePathLeaks(manifest);
  for (const leak of privatePathLeaks) {
    errors.push(`${manifestPath}: private Arya path leaked at ${leak.path}`);
  }

  return errors;
}

function validatePluginRegistry(entries) {
  const errors = [];
  const ids = new Map();

  for (const entry of entries) {
    const manifestErrors = validatePluginManifest(entry.manifest, {
      manifestPath: entry.manifestPath,
    });
    errors.push(...manifestErrors);

    const id = entry.manifest?.id;
    if (!id) {
      continue;
    }
    if (ids.has(id)) {
      errors.push(`${entry.manifestPath}: duplicate plugin id ${id}; first seen at ${ids.get(id)}`);
    } else {
      ids.set(id, entry.manifestPath);
    }
  }

  return errors;
}

function validateDiscoveredPluginRegistry(entries, { allowLocalShadowIds = [] } = {}) {
  const errors = validatePluginRegistry(entries);
  const officialIds = new Map();
  const seenIds = new Map();
  const allowedShadowIds = new Set(allowLocalShadowIds);

  for (const entry of entries) {
    const id = entry.manifest?.id;
    if (!id) {
      continue;
    }
    if (entry.source === "official" && !officialIds.has(id)) {
      officialIds.set(id, entry.manifestPath);
    }
  }

  for (const entry of entries) {
    const id = entry.manifest?.id;
    if (!id) {
      continue;
    }
    if (entry.source === "local") {
      if (!id.startsWith("local-") && !allowedShadowIds.has(id)) {
        errors.push(
          `${entry.manifestPath}: local plugin id ${id} must start with local- unless explicitly allowed`
        );
      }
      if (officialIds.has(id) && !allowedShadowIds.has(id)) {
        errors.push(
          `${entry.manifestPath}: local plugin id ${id} shadows official plugin at ${officialIds.get(id)}`
        );
      }
    }
    const first = seenIds.get(id);
    if (first && first !== entry.manifestPath) {
      errors.push(`${entry.manifestPath}: duplicate discovered plugin id ${id}; first seen at ${first}`);
    } else {
      seenIds.set(id, entry.manifestPath);
    }
  }

  return [...new Set(errors)];
}

function findPrivatePathLeaks(value, pathParts = []) {
  const leaks = [];

  if (typeof value === "string") {
    if (PRIVATE_PATH_PATTERN.test(value)) {
      leaks.push({ path: pathParts.join(".") || "$", value });
    }
    return leaks;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      leaks.push(...findPrivatePathLeaks(item, [...pathParts, String(index)]));
    });
    return leaks;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      leaks.push(...findPrivatePathLeaks(child, [...pathParts, key]));
    }
  }

  return leaks;
}

module.exports = {
  CURRENT_PLUGIN_API_VERSION,
  PLUGINS_ROOT,
  findPluginManifestPaths,
  findPluginManifestPathsFromRoots,
  loadPluginManifest,
  loadPluginManifests,
  loadPluginManifestsFromPaths,
  loadPluginManifestsFromRoots,
  validateDiscoveredPluginRegistry,
  validatePluginManifest,
  validatePluginRegistry,
};
