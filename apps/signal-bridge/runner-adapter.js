const { createBridgeCodexClient } = require("./bridge-codex-client");

function createCodexCliRunnerAdapter(options) {
  const client = createBridgeCodexClient(options);

  return {
    id: "codex-cli",
    kind: "runner",
    displayName: "Codex CLI",

    buildLaunchArgs: client.buildCodexAppServerArgs,
    buildChildEnv: client.buildCodexChildEnv,
    recordTestLaunchArgs: client.recordTestAppServerSpawnArgs,
    createSessionClient: client.createAppServerClient,
    call: client.callCodexAppServer,
    probeRuntimeProfile: client.probeRuntimeProfile,

    // Compatibility aliases for the current bridge call sites and tests.
    buildCodexAppServerArgs: client.buildCodexAppServerArgs,
    buildCodexChildEnv: client.buildCodexChildEnv,
    recordTestAppServerSpawnArgs: client.recordTestAppServerSpawnArgs,
    createAppServerClient: client.createAppServerClient,
    callCodexAppServer: client.callCodexAppServer,
  };
}

module.exports = {
  createCodexCliRunnerAdapter,
};
