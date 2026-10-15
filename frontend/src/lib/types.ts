export type Role = "ADMIN" | "EDITOR" | "REVIEWER";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}
export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  _count?: { posts: number };
}
export interface ReviewComment {
  id: string;
  postId: string;
  author: string;
  text: string;
  sentiment: string;
  risk: string;
  sensitive: boolean;
  analysisStatus: string;
  reason: string | null;
  suggestedReply: string | null;
  replyText: string | null;
  replyStatus: string;
  moderated: boolean;
  createdAt: string;
  post?: { id: string; topic: string };
}
export interface Alert {
  id: string;
  postId: string;
  trigger: string;
  evidence: { id: string; text: string; sentiment: string; risk: string }[];
  status: string;
  summary: string | null;
  statement: string | null;
  actions: string[] | null;
  reviewReason: string | null;
  createdAt: string;
  publishedAt: string | null;
  post?: { id: string; topic: string };
}
export interface Job {
  id: string;
  entityId: string;
  kind: string;
  status: string;
  error: string | null;
  createdAt: string;
}
export interface Post {
  id: string;
  topic: string;
  targetAudience: string | null;
  tone: string | null;
  platform: string;
  headline: string | null;
  content: string | null;
  bannerUrl: string | null;
  imagePrompt: string | null;
  imageStatus: string;
  imageReviewStatus: string;
  imageError: string | null;
  imageReview: {
    reason: string;
    observed: string;
    missingElements: string[];
    confidence: number;
  } | null;
  risk: string;
  reviewReason: string | null;
  approvedBy: string | null;
  status: string;
  createdAt: string;
  campaign: Campaign | null;
  comments: ReviewComment[];
  alerts: Alert[];
  job?: Job | null;
}
export interface Settings {
  mode: "MANUAL" | "CONDITIONAL";
  negativeThreshold: number;
  windowMinutes: number;
}
export interface Dashboard {
  posts: number;
  campaigns: number;
  pending: number;
  comments: number;
  alerts: number;
  sentiments: { sentiment: string; _count: { _all: number } }[];
  jobs: Job[];
  audits: {
    id: string;
    actor: string;
    action: string;
    detail: string | null;
    createdAt: string;
  }[];
  trend: { date: string; total: number; negative: number }[];
}
