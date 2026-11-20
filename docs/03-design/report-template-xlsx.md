# Quy ước template báo cáo xlsx

Tài liệu cho người soạn template Excel của công ty (Story E5-3, FR-14, S07, ADR-004). Ứng dụng mở template đang dùng (Admin tải lên ở S11, Story E5-2), điền dữ liệu dự án vào các **ô giữ chỗ** `{{...}}` bằng thư viện `exceljs` (MIT, 4.4.0) rồi trả tệp xlsx cho PM tải về.

Công ty chưa có template thật (R-005). Ứng dụng có sẵn **template mẫu** minh họa đủ quy ước dưới đây: Admin hoặc PM tải ở hộp thoại Xuất báo cáo hoặc màn Template (`GET /api/v1/report-templates/sample?format=xlsx`), sửa theo mẫu công ty rồi tải lên làm template đang dùng.

Mã nguồn: `lib/reports/` (điền: `xlsx-fill.ts`, danh sách ô giữ chỗ: `placeholders.ts`, template mẫu: `sample-template.ts`). Test `lib/reports/placeholders.test.ts` kiểm tài liệu này liệt kê đủ mọi ô giữ chỗ trong code.

## 1. Cú pháp

- Ô giữ chỗ viết `{{khóa}}` trong ô chữ, khóa chữ thường, không dấu, ví dụ `{{project.name}}`. Cho phép dấu cách trong ngoặc (`{{ project.name }}`).
- **Ô chỉ có đúng một ô giữ chỗ** (ví dụ ô B8 chỉ chứa `{{counts.total}}`): ghi giá trị **đúng kiểu** (số, ngày, ngày giờ, tỷ lệ) để Excel cộng, lọc, sắp xếp được. Định dạng số của ô trong template được giữ; ô để "General" thì ứng dụng gán mặc định: ngày `dd/mm/yyyy`, ngày giờ `dd/mm/yyyy hh:mm`, tỷ lệ `0%`.
- **Ô giữ chỗ lẫn trong chữ** (ví dụ `Kỳ báo cáo: {{period.start}} – {{period.end}}`): thay bằng chữ đã định dạng theo ngôn ngữ của người xuất (vi: `30/11/2026`, `1.234`; en: `30 Nov 2026`, `1,234`). Chữ nhiều kiểu (đậm một phần) giữ nguyên kiểu từng đoạn, miễn là một ô giữ chỗ không bị cắt ngang giữa hai kiểu.
- Ô giữ chỗ còn dùng được trong đầu trang, chân trang (Page Layout → Header/Footer), ví dụ `{{project.name}} · &P/&N`.
- **Khóa sai chính tả** được giữ nguyên trong tệp xuất để người soạn nhìn thấy và sửa.
- Ngày giờ ghi theo **giờ Việt Nam** (UTC+7). Excel không lưu múi giờ.
- Chữ người dùng nhập (tiêu đề task, tên dự án...) luôn ghi là ô chữ, không bao giờ thành công thức: tiêu đề bắt đầu bằng `=`, `+`, `-`, `@` không chạy được.
- Giá trị trống (dự án không có ngày kết thúc, task chưa hoàn thành...) để ô trống.

## 2. Ô giữ chỗ chung

Dùng ở bất kỳ ô nào ngoài dòng lặp.

| Ô giữ chỗ | Kiểu | Ý nghĩa |
|---|---|---|
| `{{project.name}}` | chữ | Tên dự án |
| `{{project.description}}` | chữ | Mô tả dự án |
| `{{project.start_date}}` | ngày | Ngày bắt đầu dự án |
| `{{project.end_date}}` | ngày | Ngày kết thúc dự án |
| `{{project.status}}` | chữ | Đang hoạt động / Đã lưu trữ |
| `{{period.start}}` | ngày | Ngày đầu kỳ báo cáo |
| `{{period.end}}` | ngày | Ngày cuối kỳ (tính cả ngày này) |
| `{{period.days}}` | số | Số ngày của kỳ |
| `{{period.task_count}}` | số | Số task trong kỳ (số dòng của `{{#tasks}}`) |
| `{{period.created_count}}` | số | Task tạo mới trong kỳ |
| `{{period.completed_count}}` | số | Task hoàn thành trong kỳ |
| `{{period.due_count}}` | số | Task có hạn rơi vào kỳ |
| `{{report.generated_at}}` | ngày giờ | Lúc xuất báo cáo |
| `{{report.generated_by}}` | chữ | Họ tên người xuất |
| `{{report.today}}` | ngày | Ngày xuất (giờ Việt Nam), mốc tính trễ hạn |
| `{{counts.total}}` | số | Tổng task của dự án tại lúc xuất |
| `{{counts.done}}` | số | Task đã xong |
| `{{counts.open}}` | số | Task chưa xong |
| `{{counts.todo}}` | số | Task nhóm Chưa bắt đầu |
| `{{counts.in_progress}}` | số | Task nhóm Đang thực hiện |
| `{{counts.overdue}}` | số | Task trễ hạn |
| `{{counts.open_no_due}}` | số | Task chưa xong và chưa có hạn |
| `{{counts.blocked}}` | số | Task đang bị chặn |
| `{{progress.percent}}` | số | % hoàn thành, số nguyên 0..100 (cùng công thức S06) |
| `{{progress.ratio}}` | tỷ lệ | Tỷ lệ hoàn thành 0..1 (định dạng `0%`) |

Số liệu `counts.*`, `progress.*` và bảng `statuses`, `assignees` là số liệu **toàn dự án tại lúc xuất**, cùng hàm CSDL với dashboard S06. Số liệu `period.*` và bảng `tasks` chỉ tính **trong kỳ**.

## 3. Dòng lặp

Đặt dấu `{{#tasks}}` (hoặc `{{#statuses}}`, `{{#assignees}}`) vào **một ô bất kỳ** của một dòng, thường cùng ô với trường đầu tiên: `{{#tasks}}{{task.index}}`. Dòng đó là **dòng mẫu**: ứng dụng nhân nó thành một dòng cho mỗi phần tử, các ô trong dòng dùng `{{task.<trường>}}`. Dấu đóng `{{/tasks}}` không bắt buộc; nếu có, ứng dụng xóa đi.

Khi nhân dòng, ứng dụng giữ và dời theo:

- kiểu ô, chiều cao dòng, ô gộp nằm gọn trong dòng mẫu (gộp lại trên mỗi dòng mới);
- mọi thứ **nằm dưới** dòng mẫu dời xuống: ô, ô gộp, công thức, định dạng có điều kiện, kiểm dữ liệu, bộ lọc, vùng in, ngắt trang, ảnh, tên vùng;
- công thức có vùng **chứa dòng mẫu** giãn ra phủ mọi dòng mới, ở bất kỳ trang nào: dòng tổng `=COUNTA(B20:B20)` thành `=COUNTA(B20:B2019)` khi có 2.000 task;
- công thức trong dòng mẫu tham chiếu chính dòng đó trỏ sang dòng của từng phần tử (`=D20*E20` thành `=D21*E21` ở dòng sau).

Kỳ không có phần tử nào: giữ một dòng, ghi "Không có task nào trong kỳ." (hoặc "Không có dữ liệu.") vào ô có ô giữ chỗ đầu tiên, xóa các ô giữ chỗ còn lại.

Nhiều dòng lặp trên cùng một trang hoặc ở nhiều trang đều được. Không đặt hai dấu `{{#...}}` trên cùng một dòng; không gộp ô kéo dài qua nhiều dòng có chứa dòng mẫu.

Template được đặt "tính lại khi mở" nên kết quả công thức cập nhật khi mở bằng Excel, LibreOffice, Google Sheets.

### 3.1. `{{#tasks}}`: task trong kỳ

Task **trong kỳ** là task có ít nhất một mốc rơi vào kỳ (giờ Việt Nam, tính cả hai đầu): tạo, cập nhật lần cuối, hoàn thành, hoặc hạn. Sắp xếp: hạn sớm trước (không hạn ở cuối), rồi ngày tạo. Tối đa 10.000 task một lần xuất (vượt: thu hẹp kỳ).

| Ô giữ chỗ | Kiểu | Ý nghĩa |
|---|---|---|
| `{{task.index}}` | số | Số thứ tự 1, 2, 3... |
| `{{task.title}}` | chữ | Tiêu đề |
| `{{task.status}}` | chữ | Tên trạng thái của dự án |
| `{{task.status_group}}` | chữ | Nhóm trạng thái: Chưa bắt đầu / Đang thực hiện / Đã xong |
| `{{task.assignee}}` | chữ | Người phụ trách; "Chưa giao"; "Người đã rời dự án" |
| `{{task.priority}}` | chữ | Ưu tiên: Thấp / Trung bình / Cao / Khẩn cấp |
| `{{task.type}}` | chữ | Loại task |
| `{{task.start_date}}` | ngày | Ngày bắt đầu |
| `{{task.due_date}}` | ngày | Hạn |
| `{{task.completed_at}}` | ngày giờ | Lúc hoàn thành |
| `{{task.created_at}}` | ngày giờ | Lúc tạo |
| `{{task.updated_at}}` | ngày giờ | Lúc cập nhật lần cuối |
| `{{task.labels}}` | chữ | Nhãn, cách nhau bằng dấu phẩy |
| `{{task.overdue}}` | chữ | "Trễ hạn" nếu chưa xong mà quá hạn, ngược lại trống |
| `{{task.level}}` | số | Cấp trong cây task: 1 là task gốc, 2 là task con... |

### 3.2. `{{#statuses}}`: số task theo trạng thái

| Ô giữ chỗ | Kiểu | Ý nghĩa |
|---|---|---|
| `{{status.index}}` | số | Số thứ tự |
| `{{status.name}}` | chữ | Tên trạng thái |
| `{{status.group}}` | chữ | Nhóm trạng thái |
| `{{status.count}}` | số | Số task |
| `{{status.ratio}}` | tỷ lệ | Tỷ lệ trên tổng task |

### 3.3. `{{#assignees}}`: số task theo người phụ trách

| Ô giữ chỗ | Kiểu | Ý nghĩa |
|---|---|---|
| `{{assignee.index}}` | số | Số thứ tự |
| `{{assignee.name}}` | chữ | Họ tên; "Chưa giao"; "Người đã rời dự án" |
| `{{assignee.total}}` | số | Tổng task |
| `{{assignee.done}}` | số | Đã xong |
| `{{assignee.open}}` | số | Chưa xong |
| `{{assignee.overdue}}` | số | Trễ hạn |

## 4. Giới hạn đã biết

- `exceljs` đọc rồi ghi lại cả tệp: biểu đồ, pivot, slicer, macro không được giữ. Template chứa macro bị từ chối ngay khi tải lên (E5-2). Dùng công thức và định dạng có điều kiện thay cho biểu đồ.
- Bảng Excel (Insert → Table) không tự giãn; dùng vùng thường kèm bộ lọc (Data → Filter) như template mẫu.
- Tham chiếu có cấu trúc, tên vùng động (OFFSET) không được dời; dùng tham chiếu A1 thường.

## 5. API và lỗi

`POST /api/v1/projects/{id}/reports` với `{ "format": "xlsx", "period_start": "2026-11-01", "period_end": "2026-11-30" }`, chỉ PM của dự án và Admin; kỳ dài tối đa 366 ngày. Mỗi lần xuất thành công ghi một dòng `report_exports` (không sửa, không xóa).

| Tình huống | Mã |
|---|---|
| Không có template xlsx đang dùng | `422 report_template_missing` |
| Template hỏng, không mở được | `422 business_rule_violated` |
| Kỳ có hơn 10.000 task | `422 business_rule_violated` (`period_end`) |
| `format: "docx"` (Story E5-4 chưa làm) | `422 business_rule_violated` (`format`) |
| Quá 10 lần xuất trong 10 phút | `429 rate_limited` |
| Xử lý quá 25 giây | `504 report_timeout` |
