import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { HttpError } from "../lib/errors.js";
import { mediaDir } from "./images.js";
import { getVideoProvider } from "./video/provider.js";

const run = promisify(execFile);
export const videoDir = path.join(mediaDir, "videos");
const DEFAULT_DEADLINE_MS = 15 * 60 * 1000;
const MAX_BYTES = 50 * 1024 * 1024;
const RATIOS = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [720, 720] };

const deadlineMs = () => {
  const raw = Number(process.env.VIDEO_JOB_DEADLINE_MS);
  return Number.isSafeInteger(raw) && raw >= 60000 ? raw : DEFAULT_DEADLINE_MS;
};

export function validateVideoInput(input = {}) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > 2000)
    throw new HttpError(400, "Prompt video phải từ 1 đến 2000 ký tự.");
  const duration = input.duration === undefined ? 5 : Number(input.duration);
  if (!Number.isInteger(duration) || duration < 3 || duration > 15)
    throw new HttpError(400, "Thời lượng video phải từ 3 đến 15 giây.");
  const aspectRatio = input.aspectRatio || "16:9";
  const dims = RATIOS[aspectRatio];
  if (!dims) throw new HttpError(400, "Tỷ lệ khung hình phải là 16:9, 9:16 hoặc 1:1.");
  return {
    prompt,
    duration,
    aspectRatio,
    width: dims[0],
    height: dims[1],
    scriptVersion:
      Number.isInteger(input.scriptVersion) && input.scriptVersion > 0
        ? input.scriptVersion
        : 1,
  };
}

export async function getVideoState(db, jobId) {
  const asset = await db.videoAsset.findUnique({
    where: { jobId },
    include: { job: { include: { attempts: true } } },
  });
  if (!asset) throw new HttpError(404, "Không tìm thấy tác vụ video.");
  return {
    jobId,
    assetId: asset.id,
    status: asset.status,
    provider: asset.provider,
    prompt: asset.prompt,
    params: asset.params,
    result:
      asset.status === "SUCCEEDED"
        ? {
            url: asset.filePath,
            sha256: asset.sha256,
            mimeType: asset.mimeType,
            duration: asset.duration,
            width: asset.width,
            height: asset.height,
            codec: asset.codec,
            verification: asset.verification,
          }
        : null,
    error: asset.error,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

// Creates a generation job. The provider job ID is persisted BEFORE any poll:
// after a restart the job must be polled, never re-generated (HOANG-API04).
export async function createVideoJob(
  db,
  input,
  { provider = getVideoProvider(), pageId = "default", entityId, requestedBy = "system" } = {},
) {
  const params = validateVideoInput(input);
  let created;
  try {
    created = await provider.createJob(params);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "Không khởi tạo được tác vụ video phía nhà cung cấp.");
  }
  if (!created?.providerJobId || typeof created.providerJobId !== "string")
    throw new HttpError(502, "Nhà cung cấp video không trả về provider job ID.");
  const jobId = randomUUID();
  const assetId = randomUUID();
  await db.$transaction(async (tx) => {
    await tx.workflowJob.create({
      data: {
        id: jobId,
        kind: "video.generate",
        mode: "VIDEO_V1",
        entityId: entityId || assetId,
        status: "RUNNING",
        contractSnapshot: {
          kind: "video.generate",
          pageId,
          params,
          requestedBy,
          provider: provider.name,
          providerJobId: created.providerJobId,
        },
      },
    });
    await tx.workflowAttempt.create({
      data: {
        id: randomUUID(),
        jobId,
        leaseOwner: "video-api",
        leaseUntil: new Date(Date.now() + deadlineMs()),
        providerJobId: created.providerJobId,
      },
    });
    await tx.videoAsset.create({
      data: {
        id: assetId,
        jobId,
        provider: provider.name,
        prompt: params.prompt,
        params: {
          duration: params.duration,
          aspectRatio: params.aspectRatio,
          width: params.width,
          height: params.height,
          scriptVersion: params.scriptVersion,
        },
      },
    });
  });
  return getVideoState(db, jobId);
}

// Polls the EXISTING provider job once. Never calls provider.createJob: a
// timeout or unknown result is reconciled later, not silently re-generated.
export async function syncVideoJob(db, jobId, { provider = getVideoProvider() } = {}) {
  const asset = await db.videoAsset.findUnique({
    where: { jobId },
    include: { job: { include: { attempts: true } } },
  });
  if (!asset) throw new HttpError(404, "Không tìm thấy tác vụ video.");
  if (asset.status !== "PENDING") return getVideoState(db, jobId);
  const attempt = asset.job.attempts.find((a) => a.providerJobId) || asset.job.attempts[0];
  if (!attempt?.providerJobId)
    return finalize(db, asset, "FAILED", {
      error: "Thiếu provider job ID; không tự sinh lại.",
      jobError: "PROVIDER_NO_JOB",
    });
  let state;
  try {
    state = await provider.getJob(attempt.providerJobId);
  } catch (e) {
    // Transient provider error: keep PENDING and let the caller retry later.
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "Không kiểm tra được tác vụ video phía nhà cung cấp.");
  }
  if (state.status === "RUNNING") {
    if (Date.now() - asset.createdAt.getTime() > deadlineMs())
      return finalize(db, asset, "FAILED", {
        error:
          "Tác vụ video quá thời gian chờ (PROVIDER_TIMEOUT). Không tự sinh lại; chỉ tạo tác vụ mới khi thực sự cần.",
        jobError: "PROVIDER_TIMEOUT",
      });
    return getVideoState(db, jobId);
  }
  if (state.status === "FAILED")
    return finalize(db, asset, "FAILED", {
      error: state.error || "Tác vụ video thất bại phía nhà cung cấp.",
      jobError: "PROVIDER_FAILED",
    });
  let fetched;
  try {
    fetched = await provider.fetchVideo(state.videoUrl, asset.params || {});
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "Không tải được video kết quả.");
  }
  let probe;
  try {
    probe = await verifyVideo(fetched.bytes);
  } catch (e) {
    return finalize(db, asset, "FAILED", {
      error: e.message || "MP4 kết quả không hợp lệ.",
      jobError: "MP4_INVALID",
    });
  }
  await mkdir(videoDir, { recursive: true });
  const filename = `${randomUUID()}.mp4`;
  await writeFile(path.join(videoDir, filename), fetched.bytes);
  return finalize(db, asset, "SUCCEEDED", {
    filePath: `/media/videos/${filename}`,
    sha256: createHash("sha256").update(fetched.bytes).digest("hex"),
    mimeType: "video/mp4",
    ...probe,
  });
}

async function finalize(db, asset, status, fields = {}) {
  const { jobError, error, ...assetFields } = fields;
  await db.$transaction(async (tx) => {
    await tx.videoAsset.update({
      where: { id: asset.id },
      data: { status, error: error || null, ...assetFields },
    });
    await tx.workflowJob.update({
      where: { id: asset.jobId },
      data: { status, error: jobError || null },
    });
    const attempt = asset.job.attempts.find((a) => a.providerJobId) || asset.job.attempts[0];
    if (attempt)
      await tx.workflowAttempt.update({
        where: { id: attempt.id },
        data: { receipt: { jobId: asset.jobId, attemptId: attempt.id, status } },
      });
  });
  return getVideoState(db, asset.jobId);
}

// ffprobe check of container/codec/duration/dimensions (G4 profile). Falls back
// to CONTAINER_ONLY when ffprobe is unavailable — recorded in the asset.
export async function verifyVideo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32)
    throw new Error("Video kết quả quá nhỏ hoặc rỗng.");
  if (bytes.length > MAX_BYTES)
    throw new Error("Video vượt quá giới hạn 50 MB.");
  if (bytes.slice(4, 8).toString("ascii") !== "ftyp")
    throw new Error("Tệp không phải MP4 (thiếu hộp ftyp).");
  const dir = await mkdtemp(path.join(os.tmpdir(), "video-probe-"));
  const file = path.join(dir, "probe.mp4");
  try {
    await writeFile(file, bytes);
    let raw;
    try {
      ({ stdout: raw } = await run(
        "ffprobe",
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
        { maxBuffer: 1 << 20 },
      ));
    } catch (e) {
      if (e.code === "ENOENT")
        return { verification: "CONTAINER_ONLY", duration: null, width: null, height: null, codec: null };
      throw new Error("ffprobe không đọc được video kết quả.");
    }
    let info;
    try {
      info = JSON.parse(raw);
    } catch {
      throw new Error("ffprobe trả về dữ liệu không hợp lệ.");
    }
    const formatName = String(info.format?.format_name || "");
    if (!/(mp4|mov)/.test(formatName))
      throw new Error("Video không phải container MP4/MOV.");
    const stream = (info.streams || []).find((s) => s.codec_type === "video");
    if (!stream) throw new Error("Video không có luồng hình ảnh.");
    const duration = Number(info.format?.duration ?? stream.duration);
    const width = Number(stream.width);
    const height = Number(stream.height);
    if (!(duration > 0) || duration > 30)
      throw new Error("Thời lượng video không hợp lệ (phải trong khoảng 0–30 giây).");
    if (!(width > 0 && height > 0) || width > 1920 || height > 1920)
      throw new Error("Kích thước video vượt giới hạn 1920px.");
    return { verification: "FFPROBE", duration, width, height, codec: stream.codec_name || null };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
