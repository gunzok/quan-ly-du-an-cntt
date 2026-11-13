# User flow

Ngày: 2026-11-13 · Pha 3 · Liên quan: UC-01 đến UC-13, [screens.md](screens.md)

## 1. Luồng PM: từ dự án đến báo cáo
```mermaid
flowchart TD
    A[S01 Đăng nhập] --> B[S02 Danh sách dự án]
    B -->|Tạo dự án| B2[Tạo dự án, chọn template]
    B2 --> C
    B -->|Mở dự án| C[S03 Bảng Kanban]
    C -->|Chuyển tab| D[S04 Danh sách và bộ lọc]
    C -->|Bấm task| E[S05 Chi tiết task]
    D -->|Bấm task| E
    C -->|Tab Tổng quan| F[S06 Dashboard]
    C -->|Xuất báo cáo| G[S07 Xuất báo cáo]
    F -->|Xuất báo cáo| G
    G --> H[(Tải xlsx hoặc docx)]
```

## 2. Luồng Thành viên: nhận việc và cập nhật
```mermaid
flowchart TD
    A[Thông báo giao việc: app + email] --> B[S05 Chi tiết task]
    B --> C{Đổi trạng thái}
    C -->|Kéo thả ở Kanban| D[S03]
    C -->|Chọn trong chi tiết| B
    B -->|Task bị chặn| W[Hiển thị cảnh báo, vẫn cho hoàn thành]
    B --> E[Thêm việc con, tối đa 3 cấp]
```

## 3. Luồng Admin
```mermaid
flowchart TD
    A[S01 Đăng nhập] --> B[S08 Quản lý người dùng]
    B --> C[Mời người dùng, gán vai trò]
    B --> D[Khóa hoặc mở tài khoản]
    B --> E[Tải template báo cáo]
```

## 4. Luồng Người xem
Đăng nhập, mở dự án được mời, xem S03, S04, S06; mọi nút tạo, sửa, kéo thả, xuất báo cáo bị ẩn hoặc vô hiệu hóa (BR-02).

## 5. Luồng trên điện thoại
Từ S02 mở dự án, dùng S09: chọn cột bằng các nút ở đầu, mở menu "Chuyển đến cột" của thẻ thay cho kéo thả. Mọi vùng bấm từ 44 px.
