import prisma from "../prisma.js";
import { HttpError, text, choice } from "../lib/errors.js";
import { createArtifact, dateInput, publicationHash } from "./expansion.js";
export function checkedVariants(result) {
  if (!Array.isArray(result?.variants) || result.variants.length !== 3) throw new HttpError(400, "Cần đủ ba phiên bản nền tảng.");
  const seen = new Set();
  const variants = result.variants.map(v => {
    const platform = choice(v.platform, ["Facebook", "LinkedIn", "X"], "Nền tảng");
    if (seen.has(platform)) throw new HttpError(400, "Nền tảng bị trùng."); seen.add(platform);
    return { platform, headline: text(v.headline, "Tiêu đề", 500), content: text(v.content, "Nội dung", { X: 280, LinkedIn: 3000, Facebook: 12000 }[platform]) };
  });
  return { variants };
}
export function checkedReport(result) {
  if (!Array.isArray(result?.recommendations) || result.recommendations.length > 10) throw new HttpError(400, "Đề xuất không hợp lệ.");
  return { summary: text(result.summary, "Nhận xét", 5000), recommendations: result.recommendations.map(x => text(x, "Đề xuất", 1000)) };
}
export async function reportInput(campaignId, start, end) {
  const from = dateInput(start, "Ngày bắt đầu"), to = dateInput(end, "Ngày kết thúc");
  if (from >= to || to - from > 366 * 86400000 || to > new Date(Date.now()+60000)) throw new HttpError(400, "Kỳ báo cáo cần trong quá khứ, dài tối đa 366 ngày; ngày kết thúc không tính vào kỳ.");
  // One snapshot: all counts refer to the same database state and [start,end).
  return prisma.$transaction(async db => {
    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const period = { gte: from, lt: to };
    const postWhere = { campaignId, createdAt: period };
    const commentWhere = { post: { campaignId }, createdAt: period, remoteDeleted: false };
    const [createdPosts, publishedPosts, rejectedPosts, comments, sentiments, alerts] = await Promise.all([
      db.post.count({where:postWhere}),
      db.post.count({where:{campaignId,publishedAt:period}}),
      db.post.count({where:{...postWhere,status:"REJECTED"}}),
      db.comment.count({where:commentWhere}),
      db.comment.groupBy({by:["sentiment"],where:{...commentWhere,analysisStatus:"DONE"},_count:{_all:true}}),
      db.alert.count({where:{post:{campaignId},createdAt:period}}),
    ]);
    const analyzed = sentiments.reduce((n,s)=>n+s._count._all,0);
    const negative = sentiments.filter(s=>["NEGATIVE","CRISIS"].includes(s.sentiment)).reduce((n,s)=>n+s._count._all,0);
    const sources = await db.comment.groupBy({ by: ["source"], where: commentWhere, _count: { _all: true } });
    const schedules = await db.postSchedule.findMany({ where: { target: "FACEBOOK", status: "PUBLISHED", post: { campaignId } }, include: { metricSnapshots: { where: { capturedAt: period }, orderBy: { capturedAt: "desc" }, take: 1 } } });
    const facebook = schedules.filter(s => s.metricSnapshots.length).map(s => ({ postId: s.postId, externalPostId: s.externalPostId, capturedAt: s.metricSnapshots[0].capturedAt.toISOString(), ...s.metricSnapshots[0].metrics }));
    return { campaign: { id: campaign.id, name: campaign.name }, period: { from: from.toISOString(), to: to.toISOString() }, capturedAt: new Date().toISOString(),
      metrics: { createdPosts, publishedPosts, rejectedPosts, comments, analyzedComments: analyzed, negativeComments: negative, negativeRate: analyzed ? Math.round(negative / analyzed * 10000)/100 : null, alerts },
      commentSources: Object.fromEntries(sources.map(s => [s.source, s._count._all])), facebook,
      definitions: "Kỳ [từ,đến). Bài từ chối: trạng thái hiện tại của bài tạo trong kỳ. Tỷ lệ tiêu cực tính trên bình luận đã phân tích, loại bình luận đã xóa. Bình luận tách nguồn SIMULATOR/FACEBOOK. Facebook: snapshot gần nhất thu thập trong kỳ, số tích lũy của bài chứ không phải tương tác phát sinh trong kỳ. Chỉ số thiếu là null. Bài cũ chưa ghi publishedAt không tính số bài đăng." };
  }, { isolationLevel: "RepeatableRead" });
}
export async function createWeeklyReports() {
  const now = new Date();
  // Monday 00:00 in Asia/Ho_Chi_Minh, converted back to UTC.
  const local = new Date(now.getTime()+7*3600000);
  local.setUTCHours(0,0,0,0); local.setUTCDate(local.getUTCDate() - (local.getUTCDay()+6)%7);
  const end = new Date(local.getTime()-7*3600000), start = new Date(end.getTime()-7*86400000);
  const campaigns = await prisma.campaign.findMany({ where: { posts: { some: {} } }, select: { id:true }, orderBy: { id:"asc" }, take:100 });
  const jobs=[];
  for (const c of campaigns) {
    const dedupeKey = `weekly:${c.id}:${start.toISOString()}`;
    if (await prisma.workflowArtifact.findUnique({where:{dedupeKey}})) continue;
    const input = await reportInput(c.id,start.toISOString(),end.toISOString());
    try { const created=await prisma.$transaction(db=>createArtifact(db,"report",input,{campaignId:c.id,dedupeKey})); jobs.push(created.job); }
    catch(e) { if(e.code!=="P2002") throw e; }
  }
  return jobs;
}
export const sourceRevision = publicationHash;
export function reportCsv(a) {
  const quote = value => '"' + String(value ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
  const rows = [["Chiến dịch",a.input.campaign.name],["Từ (bao gồm)",a.input.period.from],["Đến (không bao gồm)",a.input.period.to],...Object.entries(a.input.metrics),["Định nghĩa",a.input.definitions]];
  for (const [source, count] of Object.entries(a.input.commentSources || {})) rows.push([`Bình luận ${source}`, count]);
  for (const s of a.input.facebook || []) rows.push(["Facebook post", s.externalPostId], ["Thu thập", s.capturedAt], ["Reactions", s.reactions], ["Comments", s.comments], ["Shares", s.shares], ["Views", s.views]);
  return '\uFEFF'+rows.map(row=>row.map(quote).join(',')).join('\r\n');
}
