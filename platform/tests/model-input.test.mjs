import test from "node:test";
import assert from "node:assert/strict";
import {
  validateModelFile,
  inspectModelFile,
  createModelStream,
  READ_CHUNK_BYTES,
} from "../dist/model-input.js";

test("large 3DGS files are accepted; unsupported, empty and damaged SPLAT rejected", () => {
  for (const ext of ["ply", "splat", "spz", "ksplat"]) {
    assert.equal(
      validateModelFile({ name: `map.${ext}`, size: 3 * 1024 ** 3 }),
      ext,
    );
  }
  assert.throws(() =>
    validateModelFile({ name: "map.pcd", size: 500_000_000 }),
  );
  assert.throws(() => validateModelFile({ name: "map.spz", size: 0 }));
  assert.throws(() => validateModelFile({ name: "map.splat", size: 33 }));
});

test("stream uses bounded slices and exact byte order without whole-file read", async () => {
  const data = Uint8Array.from({ length: 1027 }, (_, i) => i % 251);
  const slices = [];
  const progress = [];
  const file = {
    size: data.length,
    arrayBuffer() {
      throw Error("whole-file read forbidden");
    },
    slice(a, b) {
      slices.push([a, b]);
      return new Blob([data.subarray(a, b)]);
    },
  };
  const reader = createModelStream(
    file,
    (n) => progress.push(n),
    73,
  ).getReader();
  assert.equal(slices.length, 0, "no eager read before consumer requests data");
  const output = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output.push(...value);
  }
  assert.deepEqual(output, [...data]);
  assert(slices.every(([a, b]) => b - a <= 73));
  assert.equal(progress.at(-1), data.length);
});

test("over 500 MiB passes end-to-end input with max 4 MiB slices", async () => {
  let largest = 0,
    read = 0;
  const file = {
    size: 520 * 1024 ** 2 + 19,
    slice(a, b) {
      largest = Math.max(largest, b - a);
      return { arrayBuffer: async () => new ArrayBuffer(b - a) };
    },
  };
  const reader = createModelStream(file).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.length;
  }
  assert.equal(read, file.size);
  assert.equal(largest, READ_CHUNK_BYTES);
});

test("cancel stops future reads and short reads fail", async () => {
  let reads = 0;
  const file = {
    size: 32,
    slice(a, b) {
      reads++;
      return new Blob([new Uint8Array(b - a)]);
    },
  };
  const r = createModelStream(file, () => {}, 8).getReader();
  await r.read();
  await r.cancel();
  assert.equal(reads, 1);
  const bad = createModelStream({
    size: 10,
    slice() {
      return new Blob([new Uint8Array(5)]);
    },
  }).getReader();
  await assert.rejects(bad.read(), /读取不完整/);
});

test("PLY preflight reads header only, distinguishes Gaussian fields and rejects invalid headers", async () => {
  const data = new File(
    [
      "ply\nformat binary_little_endian 1.0\nelement vertex 2500000\nproperty float x\nproperty float scale_0\nend_header\n",
    ],
    "map.ply",
  );
  assert.deepEqual(await inspectModelFile(data), {
    ext: "ply",
    cloud: false,
    sourceCount: 2500000,
  });
  const plain = new File(
    [
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0",
    ],
    "plain.ply",
  );
  assert.equal((await inspectModelFile(plain)).cloud, true);
  await assert.rejects(
    inspectModelFile(new File(["ply\ninvalid"], "bad.ply")),
    /文件头/,
  );
});
