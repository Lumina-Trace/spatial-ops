export const READ_CHUNK_BYTES = 4 * 1024 * 1024;
export const LARGE_MODEL_BYTES = 128 * 1024 * 1024;

export function validateModelFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!["ply", "splat", "spz", "ksplat"].includes(ext))
    throw new Error("请选择 PLY、SPLAT、SPZ 或 KSPLAT 格式。");
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new Error("文件为空或大小无效，请重新选择。");
  if (ext === "splat" && file.size % 32 !== 0)
    throw new Error("SPLAT 文件长度无效，应为标准的 32 字节记录格式。");
  return ext;
}

export async function inspectModelFile(file) {
  const ext = validateModelFile(file);
  let cloud = false,
    sourceCount = null;
  if (ext === "ply") {
    const header = new TextDecoder().decode(
      await file.slice(0, 65536).arrayBuffer(),
    );
    const end = /^end_header\r?$/m.exec(header);
    if (!header.startsWith("ply") || !end)
      throw new Error("PLY 文件头无效，或文件头超过支持的 64 KB。");
    const text = header.slice(0, end.index);
    cloud =
      !/^property\s+\S+\s+scale_0\s*$/m.test(text) &&
      !/^element\s+chunk\s/m.test(text);
    const match = /^element\s+vertex\s+(\d+)\s*$/m.exec(text);
    if (match) sourceCount = Number(match[1]);
  } else if (ext === "splat") sourceCount = file.size / 32;
  return { ext, cloud, sourceCount };
}

// Spark asks for the next chunk only when its worker is ready. Never materialize
// the full input file or enqueue all chunks at once on the UI thread.
export function createModelStream(
  file,
  onRead = () => {},
  chunkSize = READ_CHUNK_BYTES,
) {
  let offset = 0,
    stopped = false;
  const stream = new ReadableStream(
    {
      async pull(controller) {
        if (stopped) return;
        if (offset >= file.size) {
          controller.close();
          return;
        }
        try {
          const end = Math.min(file.size, offset + chunkSize);
          const bytes = new Uint8Array(
            await file.slice(offset, end).arrayBuffer(),
          );
          if (stopped) return;
          if (bytes.byteLength !== end - offset)
            throw new Error(
              "文件读取不完整，请检查文件是否仍在下载或被其他程序修改。",
            );
          offset = end;
          controller.enqueue(bytes);
          onRead(offset, file.size);
        } catch (error) {
          if (!stopped) controller.error(error);
        }
      },
      cancel() {
        stopped = true;
      },
    },
    { highWaterMark: 0 },
  );
  return stream;
}
