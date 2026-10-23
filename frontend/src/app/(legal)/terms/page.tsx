import type { Metadata } from "next";

export const metadata: Metadata = { title: "Điều khoản sử dụng | Hien Cafe PR" };

export default function Page() {
  return (
    <article>
      <h1>Điều khoản sử dụng</h1>
      <section style={{ marginTop: 24 }}>
        <h2>Phạm vi dịch vụ</h2>
        <p>Hien Cafe PR là dự án học tập và trình diễn quản lý truyền thông, sử dụng thương hiệu demo Hiên Cà Phê. Ứng dụng hỗ trợ lập kế hoạch, tạo nội dung và ảnh, duyệt, đặt lịch, quản lý cộng đồng và báo cáo. Tên thương hiệu không xác nhận sự tồn tại của một cửa hàng hay dịch vụ thực tế.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Trách nhiệm người sử dụng</h2>
        <p>Chỉ kết nối Page và sử dụng nội dung mà bạn có quyền quản lý. Không cung cấp thông tin sai lệch, nội dung xâm phạm quyền riêng tư, bản quyền hoặc dùng hệ thống để gửi thư rác. Bảo vệ tài khoản và thông tin truy cập; kiểm tra đúng Page và kênh trước khi xác nhận xuất bản.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Nội dung do AI hỗ trợ</h2>
        <p>Nội dung và ảnh do AI tạo có thể sai, thiếu thông tin hoặc không phù hợp. Người sử dụng phải kiểm tra dữ kiện, quyền sử dụng ảnh và tính phù hợp trước khi duyệt hoặc xuất bản. Thông cáo khủng hoảng luôn cần người duyệt; phản ánh trong tình huống demo không được coi là sự kiện đã được xác minh.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Xuất bản và tự động hóa</h2>
        <p>Duyệt bài và xuất bản là các bước riêng. Xuất bản lên Facebook hoặc gửi phản hồi có thể tạo nội dung công khai. Tự động hóa phụ thuộc cấu hình và điều kiện kiểm tra; lời chào Messenger chỉ được kích hoạt sau tin nhắn chủ động của khách. Người quản trị chịu trách nhiệm về cấu hình tự động hóa và nội dung mẫu.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Tính sẵn sàng</h2>
        <p>Ứng dụng phụ thuộc kết nối mạng, hạn mức và dịch vụ bên ngoài, nên không bảo đảm xử lý liên tục hoặc đúng thời điểm trong mọi trường hợp. Tính năng và điều khoản có thể được cập nhật theo phạm vi dự án. Không sử dụng kết quả AI thay cho đánh giá chuyên môn hoặc xác minh thực tế.</p>
      </section>
      <section style={{ marginTop: 24 }}>
        <h2>Liên hệ</h2>
        <p>Câu hỏi, phản ánh và yêu cầu hỗ trợ: huy0935162530@gmail.com. Cách xử lý dữ liệu được mô tả tại /privacy. Ngày cập nhật: 23/10/2026.</p>
      </section>
    </article>
  );
}
