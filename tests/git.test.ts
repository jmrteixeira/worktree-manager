import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultWorktreeName,
  parseBranchRefs,
  parseStatusPorcelain,
  parseUnifiedDiff,
  parseWorktreePorcelain,
  sanitizeFilePart
} from "../server/git";

describe("git parsing", () => {
  it("parses porcelain worktrees and marks the current path", () => {
    const output = [
      "worktree /tmp/project",
      "HEAD a1b2c3d4",
      "branch refs/heads/main",
      "",
      "worktree /tmp/project-feature-auth",
      "HEAD d4e5f6a7",
      "branch refs/heads/feature/auth",
      ""
    ].join("\n");

    const currentPath = "/tmp/project";
    const featurePath = "/tmp/project-feature-auth";
    const worktrees = parseWorktreePorcelain(output, currentPath);

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({
      path: path.normalize(currentPath),
      branch: "main",
      head: "a1b2c3d4",
      isCurrent: true
    });
    expect(worktrees[1]).toMatchObject({
      path: path.normalize(featurePath),
      branch: "feature/auth",
      isCurrent: false
    });
  });

  it("parses local and remote branches", () => {
    const output = [
      "refs/heads/main\tmain\torigin/main\ta1b2c3d\t2026-07-01T10:00:00+01:00\tfeat: dashboard",
      "refs/heads/feature/auth\tfeature/auth\torigin/feature/auth\td4e5f6a\t2026-07-01T11:00:00+01:00\tfeat: auth",
      "refs/remotes/origin/main\torigin/main\t\ta1b2c3d\t2026-07-01T10:00:00+01:00\tfeat: dashboard"
    ].join("\n");

    const branches = parseBranchRefs(output, "main");

    expect(branches[0]).toMatchObject({
      name: "main",
      current: true,
      upstream: "origin/main",
      isRemote: false
    });
    expect(branches.at(-1)).toMatchObject({
      name: "origin/main",
      isRemote: true
    });
  });

  it("sanitizes default worktree folder names", () => {
    expect(sanitizeFilePart("feature/auth flow")).toBe("feature-auth-flow");
    expect(defaultWorktreeName("WorktreeManager", "feature/auth")).toBe(
      "WorktreeManager-feature-auth"
    );
  });

  it("parses porcelain file status", () => {
    const output = [
      " M README.md",
      "A  staged.txt",
      '?? "notes with space.txt"',
      "R  old.txt -> new.txt"
    ].join("\n");

    const files = parseStatusPorcelain(output);

    expect(files).toEqual([
      {
        path: "README.md",
        originalPath: null,
        indexStatus: " ",
        worktreeStatus: "M",
        label: "Modificado"
      },
      {
        path: "staged.txt",
        originalPath: null,
        indexStatus: "A",
        worktreeStatus: " ",
        label: "Adicionado"
      },
      {
        path: "notes with space.txt",
        originalPath: null,
        indexStatus: "?",
        worktreeStatus: "?",
        label: "Por seguir"
      },
      {
        path: "new.txt",
        originalPath: "old.txt",
        indexStatus: "R",
        worktreeStatus: " ",
        label: "Renomeado"
      }
    ]);
  });

  it("parses unified diff hunks and line metadata", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 1111111..2222222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      " import x from 'x';",
      "-const value = 1;",
      "+const value = 2;",
      "+const extra = true;",
      " export { value };",
      "\\ No newline at end of file"
    ].join("\n");

    const parsed = parseUnifiedDiff(diff);

    expect(parsed).toMatchObject({
      additions: 2,
      deletions: 1,
      binary: false,
      error: null
    });
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0]).toMatchObject({
      header: "@@ -1,3 +1,4 @@",
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4
    });
    expect(parsed.hunks[0].lines).toEqual([
      { type: "context", oldLineNumber: 1, newLineNumber: 1, content: "import x from 'x';" },
      { type: "delete", oldLineNumber: 2, newLineNumber: null, content: "const value = 1;" },
      { type: "add", oldLineNumber: null, newLineNumber: 2, content: "const value = 2;" },
      { type: "add", oldLineNumber: null, newLineNumber: 3, content: "const extra = true;" },
      { type: "context", oldLineNumber: 3, newLineNumber: 4, content: "export { value };" },
      { type: "meta", oldLineNumber: null, newLineNumber: null, content: "\\ No newline at end of file" }
    ]);
  });

  it("marks binary unified diffs as non-previewable", () => {
    const parsed = parseUnifiedDiff("Binary files a/image.png and b/image.png differ\n");

    expect(parsed).toMatchObject({
      binary: true,
      hunks: [],
      additions: 0,
      deletions: 0,
      error: "Ficheiro binário não pré-visualizável."
    });
  });
});
