import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  DataValidationError,
  findDataDir,
  loadData,
  readDataset,
  resolveBasis,
} from "../src/data-store/load.js";

const repoData = fileURLToPath(new URL("../data", import.meta.url));
const realBasis = fileURLToPath(new URL("../data/basis-documents.json", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "kpm-data-"));

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("data loading", () => {
  it("memoizes loadData per dataset", () => {
    expect(loadData("basis-documents")).toBe(loadData("basis-documents"));
  });

  it("finds the repository data directory from source", () => {
    expect(resolve(findDataDir())).toBe(resolve(repoData));
  });

  it("finds data next to package build and bundle layouts", () => {
    mkdirSync(join(tmp, "pkg/data"), { recursive: true });
    mkdirSync(join(tmp, "bundle/data"), { recursive: true });
    copyFileSync(realBasis, join(tmp, "pkg/data/basis-documents.json"));
    copyFileSync(realBasis, join(tmp, "bundle/data/basis-documents.json"));

    const pkgDir = findDataDir(pathToFileURL(join(tmp, "pkg/build/data-store/load.js")));
    const bundleDir = findDataDir(pathToFileURL(join(tmp, "bundle/server/index.js")));

    expect(realpathSync(pkgDir)).toBe(realpathSync(join(tmp, "pkg/data")));
    expect(realpathSync(bundleDir)).toBe(realpathSync(join(tmp, "bundle/data")));
    expect(readDataset(pkgDir, "basis-documents")).toEqual(readDataset(repoData, "basis-documents"));
    expect(readDataset(bundleDir, "basis-documents")).toEqual(readDataset(repoData, "basis-documents"));
  });

  it("throws when no data directory is found within the search depth", () => {
    expect(() => findDataDir(pathToFileURL(join(tmp, "none/a/b/c/d/x.js")))).toThrow(/data/);
  });

  it("resolves basis documents by id", () => {
    expect(resolveBasis(["holiday-regulation"])[0]?.law_api).toMatchObject({ kind: "law", mst: "285779" });
    expect(() => resolveBasis(["no-such-doc"])).toThrow("no-such-doc");
  });

  it("reports JSON syntax errors as DataValidationError", () => {
    mkdirSync(join(tmp, "bad"), { recursive: true });
    writeFileSync(join(tmp, "bad/basis-documents.json"), "{");
    expect(() => readDataset(join(tmp, "bad"), "basis-documents")).toThrow(DataValidationError);
  });
});
