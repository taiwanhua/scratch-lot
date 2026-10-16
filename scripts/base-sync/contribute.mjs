/**
 * `contribute`:把引用專案一個已明選的 commit 的精確差異(相對它唯一的 parent),
 * 從底座最新 origin/main 準備成 contribution 分支(common 路徑,加上 `--accept-mixed` 明列的混合檔)。差異只 stage 不提交,provenance 在輸出與分支 metadata;
 * 不把專案分支 merge 回底座、不自動選 hunk。含 project / published-data / unknown 路徑一律拒絕,由 agent 先拆 commit。
 * mixed 只接受以 `--accept-mixed` 逐檔明列的檔案(agent 已整理成只含底座段落),其差異列進報告供審查;
 * 未明列的 mixed 仍拒絕,明列的檔不在差異內、不是 mixed 或是二進位也報錯(防止誤列;二進位無法逐段審查)。
 * `common` 只是路徑候選,是否通用仍須讀 exact delta 判斷,由使用者決定納入。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { classifyFiles } from "./classify.mjs";
import { fail } from "./errors.mjs";
import {
  FULL_SHA,
  commitExists,
  diffFiles,
  git,
  isAncestor,
  requireRepositoryRoot,
  resolveRef,
  runGit,
} from "./git.mjs";
import { loadProject, verifiedOrigin } from "./identity.mjs";
import {
  branchName,
  readSession,
  requireDirectory,
  requireFreeWorktreePath,
  requireNoOtherOperation,
  sessionWorktree,
  writeSession,
} from "./session.mjs";
import { fetchOriginMain } from "./upgrade.mjs";

const SESSION_KEYS = ["kind", "source", "parent", "main", "worktree", "state"];

function requireSourceCommit(root, commit) {
  if (!FULL_SHA.test(commit ?? "")) {
    fail("--commit 必須是完整 40 位 commit SHA");
  }
  if (!commitExists(root, commit)) fail("--commit 不在來源專案的本機歷史");
}

const MIXED_REVIEW_NOTE = "混合檔:只含底座段落,請審查";

/** 命令列路徑一律以 repo 相對、正斜線比對(容許 Windows 的反斜線與開頭的 `./`)。 */
const normalizePath = (file) =>
  file.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");

/** `git diff --numstat` 對二進位檔的增刪行數是 `-`。 */
function isBinaryChange(root, parent, commit, file) {
  return git(root, [
    "diff",
    "--numstat",
    "--no-renames",
    parent,
    commit,
    "--",
    file,
  ]).startsWith("-\t-\t");
}

/** 明列的檔必須在來源差異內、確實是 mixed 且是文字檔;回傳去重後的集合。路徑比對區分大小寫。 */
function acceptedMixedPaths(files, acceptMixed, { root, parent, commit }) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const accepted = new Set();
  for (const raw of acceptMixed) {
    const file = byPath.get(normalizePath(raw));
    if (file === undefined) {
      fail(
        `--accept-mixed 列的 ${normalizePath(raw)} 不在來源 commit 的差異內`,
      );
    }
    if (file.category !== "mixed") {
      fail(
        `--accept-mixed 只能列混合檔:${file.path} 是 ${file.category},請移除這個參數`,
      );
    }
    if (isBinaryChange(root, parent, commit, file.path)) {
      fail(
        `--accept-mixed 不接受二進位檔:${file.path} 無法逐段確認只含底座段落,請從回收 commit 拆出並人工處理`,
      );
    }
    accepted.add(file.path);
  }
  return accepted;
}

function sourceDelta(project, commit, acceptMixed) {
  const [, ...parents] = git(project.root, [
    "rev-list",
    "--parents",
    "-n",
    "1",
    commit,
  ]).split(" ");
  if (parents.length !== 1) {
    fail("只接受恰有一個 parent 的來源 commit(merge 與 root commit 不收)");
  }
  const [parent] = parents;
  const files = classifyFiles(diffFiles(project.root, parent, commit));
  if (files.length === 0) fail("來源 commit 沒有任何檔案差異");
  const accepted = acceptedMixedPaths(files, acceptMixed, {
    root: project.root,
    parent,
    commit,
  });
  const rejected = files.filter(
    (file) => file.category !== "common" && !accepted.has(file.path),
  );
  if (rejected.length > 0) {
    fail(
      `來源 commit 含未接受的非 common 路徑,請先拆出這些路徑,或以 --accept-mixed 明列只含底座段落的混合檔:${rejected
        .map((file) => `${file.path}(${file.category})`)
        .join("、")}`,
    );
  }
  const patch = git(project.root, [
    "diff",
    "--binary",
    "--full-index",
    "--no-renames",
    parent,
    commit,
    "--",
  ]);
  const mixedReview = files
    .filter((file) => accepted.has(file.path))
    .map((file) => ({
      path: file.path,
      status: file.status,
      diff: git(project.root, [
        "diff",
        "--full-index",
        "--no-renames",
        parent,
        commit,
        "--",
        file.path,
      ]),
    }));
  return { parent, files, mixedReview, patch: `${patch}\n` };
}

/** 在暫存 index 上確認 patch 能乾淨套在底座 main,才建立任何分支或工作樹。 */
function requireCleanApply(baseRoot, mainCommit, patch) {
  const dir = mkdtempSync(path.join(tmpdir(), "base-sync-index-"));
  try {
    const env = { GIT_INDEX_FILE: path.join(dir, "index") };
    git(baseRoot, ["read-tree", mainCommit], { env });
    const check = runGit(baseRoot, ["apply", "--cached", "--check"], {
      env,
      input: patch,
    });
    if (check.status !== 0) {
      fail(
        "來源差異無法乾淨套用到底座最新 main;請在專案端依底座現況調整後重選 commit",
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 既有 contribution 分支:記錄須是完整準備過的同一來源,且實際 Git 狀態仍以記錄的底座 main 為基線。
 * 準備後的人工審查(未 stage / 已 stage / 已提交)保留,不比對內容、不重套 patch。
 */
function verifyResumable(baseRoot, branch, expected) {
  const session = readSession(baseRoot, branch, SESSION_KEYS);
  if (session.state !== "prepared") {
    fail(
      `分支 ${branch} 已存在但沒有完成準備的記錄(可能中斷或不是本工具建立);請人工檢查,不自動重套`,
    );
  }
  if (
    session.kind !== "contribute" ||
    session.source !== expected.source ||
    session.parent !== expected.parent
  ) {
    fail(`分支 ${branch} 已存在但不是同一個來源 commit;不覆蓋`);
  }
  if (session.main !== expected.mainCommit) {
    fail(
      `底座 origin/main 已從 ${session.main} 前進到 ${expected.mainCommit};請從新 main 重建 contribution 分支(本工具不 reset / rebase)`,
    );
  }
  const worktree = sessionWorktree(baseRoot, branch, session.worktree);
  requireNoOtherOperation(worktree);
  if (resolveRef(worktree, "MERGE_HEAD") !== null) {
    fail(`工作樹 ${worktree} 有進行中的 merge;不接手`);
  }
  const head = git(worktree, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!isAncestor(worktree, expected.mainCommit, head)) {
    fail(`工作樹 ${worktree} 的 HEAD 已不在記錄的底座 main 之後;不接手`);
  }
  return worktree;
}

export function contribute(options, { fetchRemote }) {
  const worktreeRoot = requireDirectory(
    options.worktreeRoot,
    "--worktree-root",
  );
  const projectRoot = requireRepositoryRoot(options.project, "--project");
  const { commit } = options;
  requireSourceCommit(projectRoot, commit);
  // 來源身分與 wowgoBase 取自選定的 commit 本身,不讀工作樹裡可能未提交的值
  const project = loadProject(projectRoot, {
    ref: commit,
    requireUpstream: false,
  });
  const baseRoot = requireRepositoryRoot(options.base, "--base");
  const knownBaseRef =
    resolveRef(baseRoot, "refs/remotes/origin/main^{commit}") ?? "HEAD";
  verifiedOrigin(baseRoot, "--base", knownBaseRef);
  const delta = sourceDelta(project, commit, options.acceptMixed ?? []);
  const mainCommit = fetchOriginMain(baseRoot, "--base", fetchRemote);
  const baseRepository = verifiedOrigin(baseRoot, "--base", mainCommit);
  if (baseRepository !== project.adopted.repository) {
    fail(
      `--base 的 origin(${baseRepository})不是來源 commit 記錄的 wowgoBase.repository(${project.adopted.repository})`,
    );
  }
  const source = `${project.repository}@${commit}`;
  const branch = branchName(baseRoot, `base-contribute-${commit.slice(0, 12)}`);

  let worktree;
  const exists = resolveRef(baseRoot, `refs/heads/${branch}`) !== null;
  if (exists) {
    worktree = verifyResumable(baseRoot, branch, {
      source,
      parent: delta.parent,
      mainCommit,
    });
  } else {
    requireCleanApply(baseRoot, mainCommit, delta.patch);
    const repoName = baseRepository.split("/")[1];
    worktree = path.join(
      worktreeRoot,
      `${repoName}-contribute-${commit.slice(0, 12)}`,
    );
    requireFreeWorktreePath(worktree);
    git(baseRoot, [
      "worktree",
      "add",
      "--no-track",
      "-b",
      branch,
      worktree,
      mainCommit,
    ]);
    git(worktree, ["apply", "--index"], { input: delta.patch });
    // 套用成功後才記錄;state 最後寫,缺它就代表準備沒有完成
    writeSession(baseRoot, branch, {
      kind: "contribute",
      source,
      parent: delta.parent,
      main: mainCommit,
      worktree,
    });
    writeSession(baseRoot, branch, { state: "prepared" });
  }
  return {
    schemaVersion: 1,
    command: "contribute",
    state: exists ? "existing" : "prepared",
    source: { repository: project.repository, commit, parent: delta.parent },
    base: { repository: baseRepository, root: baseRoot, mainCommit },
    branch,
    worktree,
    files: delta.files,
    mixedReview: { note: MIXED_REVIEW_NOTE, files: delta.mixedReview },
  };
}
