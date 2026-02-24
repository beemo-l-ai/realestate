import { execSync } from "node:child_process";

const run = (cmd: string): void => {
  execSync(cmd, { stdio: "inherit" });
};

const hasUnmerged = (): boolean => {
  const output = execSync("git diff --name-only --diff-filter=U", { encoding: "utf8" }).trim();
  return output.length > 0;
};

const targetFiles = [
  "src/apps/quickstart/server.ts",
  "src/apps/README.md",
  "package.json",
  "README.md",
  "docs/REPO_STRUCTURE.md",
  "docs/DEVELOPMENT_RULES.md",
  "src/README.md",
];

const resolve = (): void => {
  if (!hasUnmerged()) {
    console.log("No merge conflicts detected.");
    return;
  }

  for (const file of targetFiles) {
    try {
      run(`git checkout --theirs -- ${file}`);
      run(`git add ${file}`);
    } catch {
      // file may not be conflicted in this merge; ignore
    }
  }

  run("git add -A");
  const left = execSync("git diff --name-only --diff-filter=U", { encoding: "utf8" }).trim();
  if (left.length > 0) {
    console.error("Unresolved files remain:\n" + left);
    process.exit(1);
  }

  console.log("Conflicts resolved for known PR #2 overlap files. Review and commit merge.");
};

resolve();
