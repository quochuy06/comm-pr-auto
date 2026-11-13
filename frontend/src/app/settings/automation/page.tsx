"use client";
import { useState } from "react";
import { send, errorMessage, useResource } from "@/lib/api";
import { useAuth } from "@/components/shell";
import { PageTitle, Notice, Empty } from "@/components/ui";

type Channel = "COMMENT" | "MESSENGER";
type Mode = "OFF" | "SEMI_AUTO" | "AUTO";
type ChannelConfig = { channel: Channel; mode: Mode; version: number };
type ChannelModes = {
  pageId: string;
  channels: ChannelConfig[];
  adviceRuntimeEnabled: boolean;
};
type KeywordRule = {
  id: string;
  channel: Channel;
  keyword: string;
  keywordRaw: string;
  matchType: "WORD" | "PHRASE";
  priority: number;
  replyText: string | null;
  sourceDocId: string | null;
  active: boolean;
};
type DryRunMatch = {
  ruleId: string;
  keyword: string;
  matchType: "WORD" | "PHRASE";
  priority: number;
  replyText: string | null;
  sourceDocId: string | null;
};
type DryRunResult = {
  normalizedText: string;
  decision: "NO_MATCH" | "MATCH" | "CONFLICT";
  matches: DryRunMatch[];
};
type GreetingConfig = {
  version: string;
  commentEnabled: boolean;
  messengerEnabled: boolean;
  commentTemplate: string;
  messengerTemplate: string;
};

const channelLabel: Record<Channel, string> = {
  COMMENT: "Bình luận",
  MESSENGER: "Messenger",
};
const modeLabel: Record<Mode, string> = {
  OFF: "Tắt",
  SEMI_AUTO: "AI soạn chờ duyệt",
  AUTO: "Tự gửi",
};
const decisionLabel: Record<DryRunResult["decision"], string> = {
  NO_MATCH: "Không khớp luật",
  MATCH: "Khớp luật",
  CONFLICT: "Xung đột — chuyển người duyệt",
};
const fieldsetStyle = { border: 0, padding: 0, margin: 0, minWidth: 0 };

function ChannelModesSection() {
  const user = useAuth();
  const admin = user?.role === "ADMIN";
  const {
    data,
    error: loadError,
    loading,
    refresh,
  } = useResource<ChannelModes>(admin ? "/automation/channels" : null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function save(channel: Channel, mode: Mode, expectedVersion: number) {
    setBusy(channel);
    setError("");
    setNotice("");
    try {
      await send(`/automation/channels/${channel}`, "PATCH", {
        mode,
        expectedVersion,
      });
      setNotice(`Đã lưu chế độ tự động cho kênh ${channelLabel[channel]}.`);
      refresh();
    } catch (e) {
      const msg = errorMessage(e);
      refresh();
      if (msg.includes("Cấu hình đã đổi") || msg.includes("409"))
        setError("Cấu hình đã thay đổi, vui lòng thử lại");
      else setError(msg);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="card">
      <h2>Chế độ tự động theo kênh</h2>
      <p className="hint">
        Tắt: không tự động hành động. AI soạn chờ duyệt: hệ thống soạn nội dung
        nhưng người duyệt quyết định gửi. Tự gửi: hệ thống tự gửi khi đủ điều
        kiện an toàn. Luồng chào cố định chạy độc lập với cài đặt này.
      </p>
      <Notice error={error || loadError} message={notice} />
      {!admin ? (
        <p className="notice">
          Chỉ quản trị viên được xem và thay đổi chế độ tự động theo kênh.
        </p>
      ) : loading ? (
        <p>Đang tải cấu hình kênh…</p>
      ) : !data ? (
        <Empty>Chưa tải được cấu hình kênh. Hãy bấm Tải lại.</Empty>
      ) : (
        <>
          {data.channels.map((ch) => (
            <form
              key={`${ch.channel}-${ch.version}`}
              onSubmit={(e) => {
                e.preventDefault();
                const mode = new FormData(e.currentTarget).get(
                  "mode",
                ) as Mode;
                void save(ch.channel, mode, ch.version);
              }}
            >
              <fieldset disabled={busy !== ""} style={fieldsetStyle}>
                <h3>{channelLabel[ch.channel]}</h3>
                <div className="field">
                  <label htmlFor={`mode-${ch.channel}`}>Chế độ</label>
                  <select
                    id={`mode-${ch.channel}`}
                    name="mode"
                    defaultValue={ch.mode}
                  >
                    <option value="OFF">{modeLabel.OFF}</option>
                    <option value="SEMI_AUTO">{modeLabel.SEMI_AUTO}</option>
                    <option value="AUTO">{modeLabel.AUTO}</option>
                  </select>
                </div>
                <button className="btn" type="submit">
                  {busy === ch.channel ? "Đang lưu…" : "Lưu chế độ"}
                </button>
                <p className="hint">Phiên bản cấu hình: {ch.version}</p>
              </fieldset>
            </form>
          ))}
          <button
            className="btn secondary"
            type="button"
            disabled={busy !== ""}
            onClick={refresh}
          >
            Tải lại
          </button>
        </>
      )}
    </section>
  );
}

function KeywordRulesSection() {
  const user = useAuth();
  const admin = user?.role === "ADMIN";
  const {
    data: rules,
    error: loadError,
    loading,
    refresh,
  } = useResource<KeywordRule[]>("/keyword-rules");
  const [editing, setEditing] = useState<KeywordRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = {
      channel: String(f.get("channel") || "COMMENT"),
      keyword: String(f.get("keyword") || "").trim(),
      matchType: String(f.get("matchType") || "PHRASE"),
      priority: Number(f.get("priority")),
      replyText: String(f.get("replyText") || "").trim(),
      sourceDocId: String(f.get("sourceDocId") || "").trim(),
    };
    if (!body.replyText && !body.sourceDocId) {
      setError("Luật phải có câu trả lời hoặc nguồn FAQ tham chiếu.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (editing) {
        await send(`/keyword-rules/${editing.id}`, "PATCH", {
          ...body,
          active: f.get("active") === "on",
        });
        setNotice("Đã cập nhật luật từ khóa.");
      } else {
        await send("/keyword-rules", "POST", body);
        setNotice("Đã thêm luật từ khóa mới.");
        form.reset();
      }
      setEditing(null);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: KeywordRule) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await send(`/keyword-rules/${rule.id}`, "PATCH", {
        channel: rule.channel,
        keyword: rule.keywordRaw,
        matchType: rule.matchType,
        priority: rule.priority,
        replyText: rule.replyText ?? "",
        sourceDocId: rule.sourceDocId ?? "",
        active: !rule.active,
      });
      setNotice(
        `Đã ${rule.active ? "tắt" : "bật"} luật “${rule.keywordRaw}”.`,
      );
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule: KeywordRule) {
    if (!window.confirm(`Xóa luật “${rule.keywordRaw}”?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await send(`/keyword-rules/${rule.id}`, "DELETE");
      if (editing?.id === rule.id) setEditing(null);
      setNotice("Đã xóa luật từ khóa.");
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Luật từ khóa</h2>
      <p className="hint">
        Luật chỉ định tuyến nội dung đến câu trả lời hoặc nguồn FAQ tham chiếu;
        luật không tự gửi tin nhắn. Từ khóa được chuẩn hóa (bỏ dấu, hạ chữ
        thường) khi khớp.
      </p>
      <Notice error={error || loadError} message={notice} />
      <div className="row wrap">
        <button
          className="btn secondary"
          type="button"
          disabled={busy || !admin}
          onClick={() => {
            setEditing(null);
            setError("");
            setNotice("");
          }}
        >
          Thêm luật mới
        </button>
        <button
          className="btn secondary"
          type="button"
          disabled={busy}
          onClick={refresh}
        >
          Tải lại
        </button>
      </div>
      {loading ? (
        <p>Đang tải danh sách luật…</p>
      ) : !rules?.length ? (
        <Empty>
          Chưa có luật từ khóa. Hãy thêm luật đầu tiên bằng biểu mẫu bên dưới.
        </Empty>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Từ khóa gốc</th>
                <th>Kênh</th>
                <th>Loại khớp</th>
                <th>Ưu tiên</th>
                <th>Câu trả lời / nguồn</th>
                <th>Đang bật</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.keywordRaw}</td>
                  <td>{channelLabel[rule.channel] || rule.channel}</td>
                  <td>
                    {rule.matchType === "WORD"
                      ? "Khớp từ (WORD)"
                      : "Khớp cụm (PHRASE)"}
                  </td>
                  <td>{rule.priority}</td>
                  <td>
                    {rule.replyText ||
                      (rule.sourceDocId
                        ? `Nguồn FAQ: ${rule.sourceDocId}`
                        : "—")}
                  </td>
                  <td>
                    <span className={rule.active ? "badge good" : "badge"}>
                      {rule.active ? "Đang bật" : "Đã tắt"}
                    </span>
                  </td>
                  <td>
                    <div className="row wrap">
                      <button
                        className="btn secondary small"
                        type="button"
                        disabled={busy || !admin}
                        onClick={() => {
                          setEditing(rule);
                          setError("");
                          setNotice("");
                        }}
                      >
                        Sửa
                      </button>
                      <button
                        className="btn secondary small"
                        type="button"
                        disabled={busy || !admin}
                        onClick={() => void toggle(rule)}
                      >
                        {rule.active ? "Tắt" : "Bật"}
                      </button>
                      <button
                        className="btn danger small"
                        type="button"
                        disabled={busy || !admin}
                        onClick={() => void remove(rule)}
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>{editing ? "Sửa luật từ khóa" : "Thêm luật từ khóa"}</h3>
      <form key={editing?.id || "new"} onSubmit={submit}>
        <fieldset disabled={busy || !admin} style={fieldsetStyle}>
          <div className="field">
            <label htmlFor="rule-keyword">Từ khóa gốc</label>
            <input
              id="rule-keyword"
              name="keyword"
              required
              maxLength={100}
              defaultValue={editing?.keywordRaw ?? ""}
              placeholder="Ví dụ: giá cà phê sữa"
            />
          </div>
          <div className="grid two">
            <div className="field">
              <label htmlFor="rule-channel">Kênh</label>
              <select
                id="rule-channel"
                name="channel"
                defaultValue={editing?.channel ?? "COMMENT"}
              >
                <option value="COMMENT">Bình luận</option>
                <option value="MESSENGER">Messenger</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="rule-matchType">Loại khớp</label>
              <select
                id="rule-matchType"
                name="matchType"
                defaultValue={editing?.matchType ?? "PHRASE"}
              >
                <option value="PHRASE">Khớp cụm (PHRASE)</option>
                <option value="WORD">Khớp từ (WORD)</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="rule-priority">
              Độ ưu tiên (1 = cao nhất, tối đa 100)
            </label>
            <input
              id="rule-priority"
              name="priority"
              type="number"
              min={1}
              max={100}
              required
              defaultValue={editing?.priority ?? 1}
            />
          </div>
          <div className="field">
            <label htmlFor="rule-replyText">Câu trả lời</label>
            <textarea
              id="rule-replyText"
              name="replyText"
              rows={3}
              maxLength={2000}
              defaultValue={editing?.replyText ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="rule-sourceDocId">
              Nguồn FAQ tham chiếu (ID tài liệu, không bắt buộc)
            </label>
            <input
              id="rule-sourceDocId"
              name="sourceDocId"
              defaultValue={editing?.sourceDocId ?? ""}
            />
            <p className="hint">
              Luật phải có câu trả lời hoặc nguồn FAQ tham chiếu.
            </p>
          </div>
          {editing && (
            <label className="mt">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing.active}
              />{" "}
              Đang bật
            </label>
          )}
          <button className="btn" type="submit">
            {busy
              ? "Đang xử lý…"
              : editing
                ? "Lưu thay đổi"
                : "Thêm luật"}
          </button>
        </fieldset>
        {!admin && (
          <p className="hint mt">
            Chỉ quản trị viên được thêm, sửa hoặc xóa luật từ khóa. Bạn đang ở
            chế độ chỉ xem.
          </p>
        )}
      </form>
    </section>
  );
}

function DryRunSection() {
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await send<DryRunResult>("/keyword-rules/dry-run", "POST", {
          channel: String(f.get("channel") || "COMMENT"),
          text: String(f.get("text") || ""),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Thử luật (dry-run)</h2>
      <p className="notice info">
        Thử luật KHÔNG gửi tin nhắn nào — chỉ cho biết luật nào sẽ khớp với nội
        dung bạn nhập.
      </p>
      <form onSubmit={run}>
        <fieldset disabled={busy} style={fieldsetStyle}>
          <div className="field">
            <label htmlFor="dry-text">Nội dung kiểm thử</label>
            <textarea
              id="dry-text"
              name="text"
              rows={3}
              required
              maxLength={2000}
              placeholder="Ví dụ: Cho mình hỏi giá cà phê sữa?"
            />
          </div>
          <div className="field">
            <label htmlFor="dry-channel">Kênh</label>
            <select id="dry-channel" name="channel" defaultValue="COMMENT">
              <option value="COMMENT">Bình luận</option>
              <option value="MESSENGER">Messenger</option>
            </select>
          </div>
          <button className="btn" type="submit">
            {busy ? "Đang thử…" : "Thử luật"}
          </button>
        </fieldset>
      </form>
      <Notice error={error} />
      {result && (
        <div className="mt">
          <p>
            <strong>Kết quả:</strong>{" "}
            <span
              className={
                result.decision === "MATCH"
                  ? "badge good"
                  : result.decision === "CONFLICT"
                    ? "badge danger"
                    : "badge"
              }
            >
              {decisionLabel[result.decision]}
            </span>
          </p>
          <p className="hint">
            Văn bản đã chuẩn hóa: “{result.normalizedText}”.{" "}
            {result.decision === "MATCH"
              ? "Sẽ dùng câu trả lời của luật ưu tiên cao nhất."
              : result.decision === "CONFLICT"
                ? "Các luật cùng ưu tiên nhưng nội dung khác nhau — cần người duyệt chọn."
                : "Không có luật nào khớp; nội dung sẽ không được tự động trả lời."}
          </p>
          {!result.matches.length ? (
            <Empty>Không có luật nào khớp.</Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Từ khóa</th>
                    <th>Loại khớp</th>
                    <th>Ưu tiên</th>
                    <th>Câu trả lời / nguồn</th>
                  </tr>
                </thead>
                <tbody>
                  {result.matches.map((m) => (
                    <tr key={m.ruleId}>
                      <td>{m.keyword}</td>
                      <td>
                        {m.matchType === "WORD"
                          ? "Khớp từ (WORD)"
                          : "Khớp cụm (PHRASE)"}
                      </td>
                      <td>{m.priority}</td>
                      <td>
                        {m.replyText ||
                          (m.sourceDocId
                            ? `Nguồn FAQ: ${m.sourceDocId}`
                            : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function GreetingTemplatesSection() {
  const user = useAuth();
  const admin = user?.role === "ADMIN";
  const {
    data,
    error: loadError,
    loading,
    refresh,
  } = useResource<GreetingConfig | null>(
    admin ? "/facebook/automation" : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await send("/facebook/automation", "PUT", {
        commentEnabled: f.get("commentEnabled") === "on",
        messengerEnabled: f.get("messengerEnabled") === "on",
        commentTemplate: f.get("commentTemplate"),
        messengerTemplate: f.get("messengerTemplate"),
        confirmAutomatic: f.get("confirmAutomatic") === "on",
      });
      setNotice("Đã lưu cấu hình lời chào tự động.");
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Mẫu lời chào tự động</h2>
      <p className="hint">
        Dùng mẫu cố định để trả lời bình luận và chào khách nhắn Messenger (tối
        đa một lời chào/người/60 phút). Biến {"{name}"} được thay bằng tên
        Facebook; thiếu tên sẽ dùng “bạn”. Messenger cần quyền pages_messaging.
        Cấu hình này chung với mục Kết nối Facebook tại trang Cài đặt.
      </p>
      <Notice error={error || loadError} message={notice} />
      {admin && loading ? (
        <p>Đang tải cấu hình lời chào…</p>
      ) : (
        <form key={data?.version || "new"} onSubmit={submit}>
          <fieldset disabled={busy || !admin} style={fieldsetStyle}>
            <label className="mt">
              <input
                type="checkbox"
                name="commentEnabled"
                defaultChecked={data?.commentEnabled || false}
              />{" "}
              Tự trả lời bình luận Facebook
            </label>
            <div className="field mt">
              <label htmlFor="greeting-comment">Mẫu dưới bình luận</label>
              <textarea
                id="greeting-comment"
                name="commentTemplate"
                rows={2}
                required
                maxLength={800}
                defaultValue={data?.commentTemplate ?? ""}
                placeholder="Chào {name}! Chúng mình có thể giúp gì cho bạn?"
              />
            </div>
            <label className="mt">
              <input
                type="checkbox"
                name="messengerEnabled"
                defaultChecked={data?.messengerEnabled || false}
              />{" "}
              Tự chào khi khách nhắn Messenger
            </label>
            <div className="field mt">
              <label htmlFor="greeting-messenger">Mẫu Messenger</label>
              <textarea
                id="greeting-messenger"
                name="messengerTemplate"
                rows={2}
                required
                maxLength={800}
                defaultValue={data?.messengerTemplate ?? ""}
                placeholder="Chào {name}! Bạn cứ gửi câu hỏi tại đây nhé."
              />
            </div>
            <label className="mt">
              <input type="checkbox" name="confirmAutomatic" /> Tôi đã xem các
              mẫu và cho phép hệ thống tự gửi theo các luồng được bật.
            </label>
            <button className="btn mt" type="submit">
              {busy ? "Đang lưu…" : "Lưu mẫu và trạng thái"}
            </button>
          </fieldset>
          {!admin && (
            <p className="hint mt">
              Chỉ quản trị viên được cấu hình lời chào tự động. Bạn đang ở chế
              độ chỉ xem.
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export default function AutomationSettingsPage() {
  return (
    <>
      <PageTitle
        title="Tự động hóa cộng đồng"
        description="Cấu hình chế độ tự động theo kênh, luật từ khóa và thử luật trước khi áp dụng cho bình luận và Messenger."
      />
      <div className="stack">
        <ChannelModesSection />
        <KeywordRulesSection />
        <DryRunSection />
        <GreetingTemplatesSection />
      </div>
    </>
  );
}
