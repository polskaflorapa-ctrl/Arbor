const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const dateStamp = new Date().toISOString().slice(0, 10);
const deviceName = `Pixel-8-Auto-${Date.now()}`;
const noteSlug = deviceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const noteRelativePath = path.join("docs", `mobile-device-qa-${dateStamp}-android-${noteSlug}.md`);
const notePath = path.join(rootDir, noteRelativePath);

function runNodeScript(script, args = []) {
  return spawnSync(process.execPath, [path.join(rootDir, "scripts", script), ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

function fillPassingNote() {
  let content = fs.readFileSync(notePath, "utf8");
  content = content.replace(/^- \[ \] /gm, "- [x] ");
  content = content.replace("- Fresh install pass:", "- Fresh install pass: yes");
  content = content.replace("- Upgrade install pass:", "- Upgrade install pass: not tested for first preview");
  content = content.replace("```text\n\n```", "```text\nOK | Sesja | token present\nOK | API | healthy\n```");
  content = content.replace("- Issue:", "- Issue: none");
  content = content.replace("- Impact:", "- Impact: none");
  content = content.replace("- Workaround:", "- Workaround: none");
  content = content.replace("- Owner:", "- Owner: QA");
  content = content.replace("- Decision:", "- Decision: GO");
  content = content.replace("- Approver:", "- Approver: QA");
  fs.writeFileSync(notePath, content);
}

function removeOtherAutoNotes() {
  const docsDir = path.join(rootDir, "docs");
  for (const name of fs.readdirSync(docsDir)) {
    if (/^mobile-device-qa-\d{4}-\d{2}-\d{2}-android-pixel-8-auto-/.test(name)) {
      fs.rmSync(path.join(docsDir, name), { force: true });
    }
  }
}

try {
  removeOtherAutoNotes();

  const create = runNodeScript("create-device-qa-note.cjs", [
    "--tester=QA-Auto",
    `--device=${deviceName}`,
    "--os=Android-15",
    "--role=Brygadzista",
  ]);
  assert.equal(create.status, 0, create.stderr || create.stdout);
  assert.equal(fs.existsSync(notePath), true);

  const noGo = runNodeScript("validate-device-qa-note.cjs", [noteRelativePath]);
  assert.equal(noGo.status, 1, noGo.stdout);
  assert.match(noGo.stdout, /NO-GO/);
  assert.match(noGo.stdout, /required result checkbox/);

  fillPassingNote();

  const go = runNodeScript("validate-device-qa-note.cjs", [noteRelativePath]);
  assert.equal(go.status, 0, go.stderr || go.stdout);
  assert.match(go.stdout, /GO: device QA note/);

  const review = runNodeScript("review-device-qa-notes.cjs");
  assert.equal(review.status, 0, review.stderr || review.stdout);
  assert.match(review.stdout, /GO: all discovered device QA notes pass validation/);

  console.log("ok testDeviceQaNote");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.rmSync(notePath, { force: true });
}
