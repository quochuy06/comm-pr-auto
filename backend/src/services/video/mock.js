import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);

// MOCK provider — not a real AI service. For tests and offline demos only; the
// provider name "mock" is persisted so a mock asset can never be mistaken for a
// real generation. It renders a real short clip with ffmpeg (testsrc2) so the
// ffprobe verification path is exercised end to end; without ffmpeg it falls
// back to a minimal MP4 container (container check only).
function minimalMp4() {
  // ftyp (isom/mp42) + empty mdat: enough for the container check, not playable.
  const ftyp = Buffer.from([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  ]);
  const mdat = Buffer.from([0, 0, 0, 8, 0x6d, 0x64, 0x61, 0x74]);
  return Buffer.concat([ftyp, mdat]);
}

export const mockProvider = {
  name: "mock",
  async createJob({ duration = 5, width = 640, height = 360 }) {
    return { providerJobId: `mock-${randomUUID()}`, params: { duration, width, height } };
  },
  async getJob(providerJobId) {
    if (!/^mock-[0-9a-f-]{36}$/.test(providerJobId || ""))
      return { status: "FAILED", error: "Provider job ID mock không hợp lệ." };
    if (process.env.MOCK_VIDEO_FAIL === "true")
      return { status: "FAILED", error: "MOCK_VIDEO_FAIL đang được bật." };
    return { status: "SUCCEEDED", videoUrl: `mock://clip/${providerJobId}` };
  },
  async fetchVideo(videoUrl, { duration = 5, width = 640, height = 360 } = {}) {
    if (!/^mock:\/\/clip\/mock-/.test(videoUrl || ""))
      throw new Error("URL video mock không hợp lệ.");
    const seconds = Math.min(Math.max(Number(duration) || 5, 1), 3);
    const dir = await mkdtemp(path.join(tmpdir(), "mock-video-"));
    const out = path.join(dir, "clip.mp4");
    try {
      await run("ffmpeg", [
        "-y", "-v", "error", "-f", "lavfi",
        "-i", `testsrc2=duration=${seconds}:size=${width}x${height}:rate=24`,
        "-pix_fmt", "yuv420p", "-an", out,
      ]);
      return { bytes: await readFile(out), mimeType: "video/mp4" };
    } catch {
      return { bytes: minimalMp4(), mimeType: "video/mp4" };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
