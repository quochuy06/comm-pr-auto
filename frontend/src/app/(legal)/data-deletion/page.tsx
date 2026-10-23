import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hướng dẫn yêu cầu xóa dữ liệu | Hien Cafe PR" };

export default function Page() {
  return (
    <article>
      <h1>Hướng dẫn yêu cầu xóa dữ liệu</h1>
      <section style={{ marginTop: 24 }}>
        <h2>Gửi yêu cầu</h2>
        <p>Gửi email tới huy0935162530@gmail.com với tiêu đề “Yêu cầu xóa dữ liệu – Hien Cafe PR”. Nêu loại dữ liệu muốn xóa, đường dẫn hoặc ID bài/bình luận liên quan nếu có, tên tài khoản và khoảng thời gian phát sinh để nhóm tìm đúng dữ liệu.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Xác minh yêu cầu</h2>
        <p>Không gửi mật khẩu, token, API key hoặc giấy tờ tùy thân trong email. Nhóm sẽ phản hồi để xác minh quyền yêu cầu bằng thông tin tối thiểu cần thiết trước khi xóa, tránh xóa dữ liệu của người khác. Việc xử lý hiện do nhóm thực hiện thủ công; chưa có chức năng xóa tức thì.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Phạm vi xử lý</h2>
        <p>Sau khi xác minh, nhóm sẽ xem xét xóa dữ liệu định danh và nội dung liên quan trong ứng dụng, bao gồm bản ghi bình luận, tin nhắn và lịch sử xử lý tương ứng theo phạm vi yêu cầu. Nếu bạn quản lý Page, hãy nêu rõ có muốn ngừng kết nối và ngừng đồng bộ Page hay không để tránh dữ liệu được nhập lại.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Facebook và bản sao lưu</h2>
        <p>Yêu cầu này áp dụng cho dữ liệu do ứng dụng quản lý. Bài viết, bình luận, phản hồi hoặc tin nhắn đã gửi lên Facebook không tự động bị xóa theo yêu cầu xóa dữ liệu trong ứng dụng. Bạn có thể quản lý chúng bằng công cụ Facebook hoặc liên hệ quản trị Page. Bản sao lưu có thể còn lưu dữ liệu cho tới khi bản sao đó được thay thế hoặc loại bỏ; nhóm sẽ thông báo giới hạn áp dụng khi phản hồi yêu cầu.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Theo dõi yêu cầu</h2>
        <p>Nhóm phản hồi tình trạng và kết quả qua email. Nếu chưa nhận phản hồi, bạn có thể gửi lại trong cùng chuỗi email. Ngày cập nhật: 23/10/2026.</p>
      </section>
    </article>
  );
}
