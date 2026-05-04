const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createScheduledAttachmentDiscovery,
  extractExistingAbsolutePaths,
  guessContentTypeFromFilename,
  isSupportedLocalFilePath,
  isSupportedLocalImagePath,
} = require("../apps/signal-bridge/scheduled-attachment-discovery");

test("scheduled attachment discovery extracts existing absolute paths from prompts", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-scheduled-attachments-"));
  try {
    const target = path.join(tempRoot, "note.md");
    await fs.writeFile(target, "hello", "utf8");

    assert.deepEqual(
      extractExistingAbsolutePaths(`Read ${target}, then ignore /tmp/does-not-exist.`),
      [target]
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("scheduled attachment discovery finds latest local KB image assets with size limits", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-scheduled-attachments-"));
  try {
    const assetsDir = path.join(tempRoot, "topic", "raw", "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    const oldImage = path.join(assetsDir, "old.png");
    const newImage = path.join(assetsDir, "new.jpg");
    const tooLarge = path.join(assetsDir, "large.png");
    await fs.writeFile(oldImage, "old", "utf8");
    await fs.writeFile(newImage, "new", "utf8");
    await fs.writeFile(tooLarge, "large-image", "utf8");
    const oldTime = new Date("2026-05-04T09:00:00.000Z");
    const newTime = new Date("2026-05-04T10:00:00.000Z");
    await fs.utimes(oldImage, oldTime, oldTime);
    await fs.utimes(newImage, newTime, newTime);

    const discovery = createScheduledAttachmentDiscovery({
      maxImages: 3,
      maxImageBytes: 5,
      maxTotalImageBytes: 20,
    });

    assert.deepEqual(discovery.discoverImageAttachments(`Attach ${path.join(tempRoot, "topic")}`), [
      {
        id: `local:${newImage}`,
        filename: "new.jpg",
        contentType: "image/jpeg",
        localPath: newImage,
      },
      {
        id: `local:${oldImage}`,
        filename: "old.png",
        contentType: "image/png",
        localPath: oldImage,
      },
    ]);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("scheduled attachment discovery finds local KB inbox files and skips images", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sable-scheduled-attachments-"));
  try {
    const inboxDir = path.join(tempRoot, "topic", "raw", "inbox");
    await fs.mkdir(inboxDir, { recursive: true });
    const markdown = path.join(inboxDir, "brief.md");
    const data = path.join(inboxDir, "data.json");
    const image = path.join(inboxDir, "image.png");
    await fs.writeFile(markdown, "# Brief", "utf8");
    await fs.writeFile(data, "{}", "utf8");
    await fs.writeFile(image, "image", "utf8");

    const discovery = createScheduledAttachmentDiscovery();
    const attachments = discovery.discoverFileAttachments(`Read ${path.join(tempRoot, "topic")}`);

    assert.deepEqual(
      attachments
        .map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          localPath: attachment.localPath,
        }))
        .sort((left, right) => left.filename.localeCompare(right.filename)),
      [
        { filename: "brief.md", contentType: "text/markdown", localPath: markdown },
        { filename: "data.json", contentType: "application/json", localPath: data },
      ]
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("scheduled attachment discovery classifies supported file and image types", () => {
  assert.equal(isSupportedLocalImagePath("/tmp/photo.webp"), true);
  assert.equal(isSupportedLocalImagePath("/tmp/note.md"), false);
  assert.equal(isSupportedLocalFilePath("/tmp/note.md"), true);
  assert.equal(isSupportedLocalFilePath("/tmp/photo.png"), false);
  assert.equal(guessContentTypeFromFilename("/tmp/report.pdf"), "application/pdf");
  assert.equal(guessContentTypeFromFilename("/tmp/table.tsv"), "text/csv");
});
