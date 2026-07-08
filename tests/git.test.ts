import { describe, expect, it } from "vitest";
import {
  defaultWorktreeName,
  parseBranchRefs,
  parseStatusPorcelain,
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

    const worktrees = parseWorktreePorcelain(output, "/tmp/project");

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({
      path: "/tmp/project",
      branch: "main",
      head: "a1b2c3d4",
      isCurrent: true
    });
    expect(worktrees[1]).toMatchObject({
      path: "/tmp/project-feature-auth",
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
});
