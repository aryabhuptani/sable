"use strict";

function createSignalProfilePlugin({ sendSignalRequest } = {}) {
  if (typeof sendSignalRequest !== "function") {
    throw new Error("createSignalProfilePlugin requires sendSignalRequest.");
  }

  function updateAvatar({ avatarPath = "", remove = false } = {}) {
    if (remove) {
      return sendSignalRequest("updateProfile", {
        removeAvatar: true,
      });
    }

    const normalizedPath = normalizeText(avatarPath);
    if (!normalizedPath) {
      return Promise.reject(new Error("Missing avatar path."));
    }

    return sendSignalRequest("updateProfile", {
      avatar: normalizedPath,
    });
  }

  return {
    updateAvatar,
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

module.exports = {
  createSignalProfilePlugin,
};
