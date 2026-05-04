const assert = require("node:assert/strict");
const test = require("node:test");

const { createSignalProfilePlugin } = require("../apps/signal-bridge/signal-profile-plugin");

test("signal profile plugin updates and removes the Signal avatar through the live session", async () => {
  const requests = [];
  const plugin = createSignalProfilePlugin({
    sendSignalRequest: async (method, params) => {
      requests.push({ method, params });
      return { ok: true };
    },
  });

  await plugin.updateAvatar({ avatarPath: " /tmp/avatar.png " });
  await plugin.updateAvatar({ remove: true });

  assert.deepEqual(requests, [
    {
      method: "updateProfile",
      params: { avatar: "/tmp/avatar.png" },
    },
    {
      method: "updateProfile",
      params: { removeAvatar: true },
    },
  ]);
});

test("signal profile plugin rejects missing avatar paths", async () => {
  const plugin = createSignalProfilePlugin({
    sendSignalRequest: async () => ({ ok: true }),
  });

  await assert.rejects(plugin.updateAvatar({ avatarPath: "" }), /Missing avatar path/);
});
