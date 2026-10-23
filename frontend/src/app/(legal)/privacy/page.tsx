import type { Metadata } from "next";

export const metadata: Metadata = { title: "Chính sách quyền riêng tư | Hien Cafe PR" };

export default function Page() {
  return (
    <article>
      <h1>Chính sách quyền riêng tư</h1>
      <section style={{ marginTop: 24 }}>
        <h2>Đơn vị vận hành và liên hệ</h2>
        <p>Hien Cafe PR là ứng dụng của nhóm dự án Communication & PR, sử dụng thương hiệu demo Hiên Cà Phê. Website: https://top2lowcode.io.vn. Mọi câu hỏi về dữ liệu xin gửi tới huy0935162530@gmail.com.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Dữ liệu được xử lý</h2>
        <p>Ứng dụng xử lý thông tin tài khoản và phiên đăng nhập của người sử dụng hệ thống; chiến dịch, nội dung, ảnh, lịch đăng và lịch sử phê duyệt. Khi kết nối Facebook Page, ứng dụng có thể xử lý ID và tên Page, bài đăng, bình luận, ID và tên hiển thị người bình luận, nội dung tin nhắn gửi tới Page, thông tin người gửi do Meta cung cấp và số liệu tương tác mà Page được phép truy cập. Token truy cập được giữ phía máy chủ để kết nối dịch vụ.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Mục đích sử dụng</h2>
        <p>Dữ liệu phục vụ quản lý nội dung, xuất bản bài được duyệt theo lịch, phân loại và phản hồi bình luận, gửi lời chào khi người dùng chủ động nhắn tới Page, phát hiện rủi ro và lập báo cáo. Bình luận không kích hoạt tin nhắn riêng. Hệ thống sử dụng cookie phiên cho đăng nhập.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Dịch vụ bên ngoài và AI</h2>
        <p>Hệ thống sử dụng Meta để đọc và gửi nội dung trên Page; Google Gemini để hỗ trợ soạn, đánh giá nội dung và phân tích bình luận; Pollinations để tạo ảnh theo mô tả. Nội dung cần thiết cho tác vụ có thể được chuyển tới các dịch vụ này; ảnh có thể được gửi cho Gemini để đánh giá. Không gửi thông tin nhạy cảm hoặc bí mật vào bài viết, bình luận hay tin nhắn dùng để thử nghiệm. Các dịch vụ có chính sách xử lý dữ liệu riêng.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Lưu trữ và quyền truy cập</h2>
        <p>Dữ liệu được lưu trên hạ tầng máy chủ của dự án và trong bản sao lưu phục vụ khôi phục. Quyền truy cập trong ứng dụng được phân theo vai trò. Dữ liệu được giữ khi cần cho hoạt động của dự án; hiện chưa có lịch tự động xóa định kỳ. Nhóm không bán dữ liệu cá nhân. Không có hệ thống nào bảo đảm an toàn tuyệt đối.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Yêu cầu về dữ liệu</h2>
        <p>Bạn có thể liên hệ email trên để yêu cầu xem, sửa hoặc xóa dữ liệu liên quan đến mình. Xem hướng dẫn chi tiết tại /data-deletion. Xóa dữ liệu trong ứng dụng không tự động xóa bài, bình luận hoặc tin nhắn đã lưu trên Facebook; các dữ liệu đó còn chịu sự quản lý của Meta.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Cập nhật chính sách</h2>
        <p>Chính sách được cập nhật trên trang này khi cách xử lý dữ liệu thay đổi. Ngày cập nhật: 23/10/2026.</p>
      </section>
    </article>
  );
}
