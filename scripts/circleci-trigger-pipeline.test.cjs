const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_PROJECT_SLUG, parseArgs, triggerPipeline } = require("./circleci-trigger-pipeline.cjs");

test("parseArgs defaults to the Arbor CircleCI project slug", () => {
  assert.deepEqual(parseArgs([]), {
    branch: null,
    projectSlug: DEFAULT_PROJECT_SLUG,
  });
});

test("parseArgs accepts branch and project slug flags", () => {
  assert.deepEqual(parseArgs(["--branch=master", "--project-slug", "gh/acme/repo"]), {
    branch: "master",
    projectSlug: "gh/acme/repo",
  });
});

test("triggerPipeline requires a token", async () => {
  await assert.rejects(
    () => triggerPipeline({ token: "", branch: "master", projectSlug: DEFAULT_PROJECT_SLUG, fetchImpl: async () => {} }),
    /CIRCLECI_TOKEN/,
  );
});

test("triggerPipeline posts branch to CircleCI API", async () => {
  const requests = [];
  const result = await triggerPipeline({
    token: "test-token",
    branch: "master",
    projectSlug: DEFAULT_PROJECT_SLUG,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify({ id: "pipeline-id", number: 42 }),
      };
    },
  });

  assert.deepEqual(result, { id: "pipeline-id", number: 42 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://circleci.com/api/v2/project/gh%2Fpolskaflorapa-ctrl%2FArbor/pipeline");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["Circle-Token"], "test-token");
  assert.equal(requests[0].options.body, JSON.stringify({ branch: "master" }));
});

test("triggerPipeline surfaces CircleCI API errors", async () => {
  await assert.rejects(
    () =>
      triggerPipeline({
        token: "test-token",
        branch: "master",
        projectSlug: DEFAULT_PROJECT_SLUG,
        fetchImpl: async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found",
          text: async () => JSON.stringify({ message: "Project not found" }),
        }),
      }),
    /Project not found/,
  );
});
