import { HttpError } from "../../lib/errors.js";
import { agnesProvider } from "./agnes.js";
import { mockProvider } from "./mock.js";

// Provider interface for AI video generation (HOANG-API04):
//   createJob({ prompt, duration, width, height }) -> { providerJobId }
//   getJob(providerJobId) -> { status: "RUNNING"|"SUCCEEDED"|"FAILED", videoUrl?, error? }
//   fetchVideo(videoUrl, params) -> { bytes, mimeType? }
// The provider job ID must be persisted before the first poll. Once a job has a
// provider job ID, never call createJob again for it: recovery means polling the
// old provider job, not submitting a new (billable) generation.
const providers = { agnes: agnesProvider, mock: mockProvider };

export function getVideoProvider(name = process.env.VIDEO_PROVIDER || "agnes") {
  const provider = providers[name];
  if (!provider) throw new HttpError(503, "Nhà cung cấp video chưa được hỗ trợ.");
  return provider;
}
