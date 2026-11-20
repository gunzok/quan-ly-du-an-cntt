# Quy ước template báo cáo docx

Tài liệu cho người soạn template Word của công ty (Story E5-4, FR-15, S07, ADR-004). Ứng dụng mở template docx đang dùng (Admin tải lên ở S11, Story E5-2), điền dữ liệu dự án vào các **ô giữ chỗ** `{{...}}` bằng thư viện `docx-templates` rồi trả tệp docx cho PM tải về.

Khóa dữ liệu **giống hệt template Excel** (docs/03-design/report-template-xlsx.md): cùng tên `{{project.name}}`, `{{counts.total}}`, `{{task.title}}`... Khác Excel ở cách viết **bảng lặp** (mục 3) và mọi giá trị đều là chữ (Word không có ô có kiểu).

Công ty chưa có template thật (R-005). Ứng dụng có sẵn **template mẫu** minh họa đủ quy ước: Admin hoặc PM tải ở hộp thoại Xuất báo cáo (chọn Word) hoặc màn Template (`GET /api/v1/report-templates/sample?format=docx`), sửa theo mẫu công ty rồi tải lên làm template docx đang dùng.

Mã nguồn: `lib/reports/` (điền: `docx-fill.ts`, danh sách ô giữ chỗ: `placeholders.ts`, template mẫu: `sample-docx-template.ts`). Test `lib/reports/placeholders.test.ts` kiểm tài liệu này liệt kê đủ mọi ô giữ chỗ trong code.

## 1. Cú pháp

- Ô giữ chỗ viết `{{khóa}}` ở bất kỳ đâu trong chữ: đoạn văn, ô bảng, tiêu đề, đầu trang, chân trang. Khóa chữ thường, không dấu, ví dụ `{{project.name}}`. Cho phép dấu cách trong ngoặc (`{{ project.name }}`).
- Word hay cắt chữ thành nhiều đoạn định dạng; ô giữ chỗ bị cắt (ví dụ một nửa in đậm) vẫn điền được, giá trị lấy định dạng của **ký tự đầu tiên** của ô giữ chỗ. Nên gõ liền một lần hoặc dán dạng chữ thường.
- Giá trị là chữ đã định dạng theo ngôn ngữ của người xuất: ngày `30/11/2026` (en: `30 Nov 2026`), ngày giờ `30/11/2026 14:05` (giờ Việt Nam, UTC+7), số `1.234` (en: `1,234`), tỷ lệ `25%`.
- Giá trị trống (dự án không có ngày kết thúc, task chưa hoàn thành...) thành chuỗi rỗng.
- Mô tả nhiều dòng giữ ngắt dòng.
- **Khóa sai chính tả** (`{{project.nmae}}`) được giữ nguyên trong tệp xuất để người soạn nhìn thấy và sửa.
- Chữ người dùng nhập (tiêu đề task, tên dự án...) luôn là chữ thường: ký tự `<`, `&`, `||`, `{{...}}` trong tiêu đề hiện nguyên văn, không thành định dạng hay lệnh.

## 2. Ô giữ chỗ chung

Dùng ở bất kỳ đâu ngoài bảng lặp. Ý nghĩa và cách tính như template Excel (report-template-xlsx.md mục 2); ở Word mọi giá trị là chữ.

| Ô giữ chỗ | Ý nghĩa |
|---|---|
| `{{project.name}}` | Tên dự án |
| `{{project.description}}` | Mô tả dự án |
| `{{project.start_date}}` | Ngày bắt đầu dự án |
| `{{project.end_date}}` | Ngày kết thúc dự án |
| `{{project.status}}` | Đang hoạt động / Đã lưu trữ |
| `{{period.start}}` | Ngày đầu kỳ báo cáo |
| `{{period.end}}` | Ngày cuối kỳ (tính cả ngày này) |
| `{{period.days}}` | Số ngày của kỳ |
| `{{period.task_count}}` | Số task trong kỳ (số dòng của bảng task) |
| `{{period.created_count}}` | Task tạo mới trong kỳ |
| `{{period.completed_count}}` | Task hoàn thành trong kỳ |
| `{{period.due_count}}` | Task có hạn rơi vào kỳ |
| `{{report.generated_at}}` | Lúc xuất báo cáo |
| `{{report.generated_by}}` | Họ tên người xuất |
| `{{report.today}}` | Ngày xuất (giờ Việt Nam), mốc tính trễ hạn |
| `{{counts.total}}` | Tổng task của dự án tại lúc xuất |
| `{{counts.done}}` | Task đã xong |
| `{{counts.open}}` | Task chưa xong |
| `{{counts.todo}}` | Task nhóm Chưa bắt đầu |
| `{{counts.in_progress}}` | Task nhóm Đang thực hiện |
| `{{counts.overdue}}` | Task trễ hạn |
| `{{counts.open_no_due}}` | Task chưa xong và chưa có hạn |
| `{{counts.blocked}}` | Task đang bị chặn |
| `{{progress.percent}}` | % hoàn thành, số nguyên 0..100 (viết `{{progress.percent}}%`) |
| `{{progress.ratio}}` | Tỷ lệ hoàn thành, đã có dấu `%` (ví dụ `25%`) |
| `{{empty.tasks}}` | "Không có task nào trong kỳ." khi kỳ không có task, ngược lại trống |
| `{{empty.statuses}}` | "Không có dữ liệu." khi bảng theo trạng thái rỗng, ngược lại trống |
| `{{empty.assignees}}` | "Không có dữ liệu." khi bảng theo người phụ trách rỗng, ngược lại trống |

Số liệu `counts.*`, `progress.*` và bảng `statuses`, `assignees` là số liệu **toàn dự án tại lúc xuất**, cùng hàm CSDL với dashboard S06. Số liệu `period.*` và bảng `tasks` chỉ tính **trong kỳ**.

## 3. Bảng lặp

Một bảng lặp gồm **ba dòng liền nhau** trong bảng Word:

| | | |
|---|---|---|
| `{{FOR task IN tasks}}` | | |
| `{{task.index}}` | `{{task.title}}` | `{{task.due_date}}` |
| `{{END-FOR task}}` | | |

- Dòng `{{FOR task IN tasks}}` và dòng `{{END-FOR task}}` là **dòng dấu**, bị xóa khi xuất; các ô còn lại của hai dòng này để trống.
- Dòng giữa là **dòng mẫu**: ứng dụng nhân nó thành một dòng cho mỗi phần tử, giữ định dạng ô (màu nền, viền, căn lề, cỡ chữ). Có thể dùng nhiều dòng mẫu giữa hai dòng dấu (mỗi phần tử ra nhiều dòng).
- Tên biến sau `FOR` tùy ý nhưng nên dùng `task`, `status`, `assignee` để khớp tên khóa với Excel; có thể viết `{{$task.title}}` (cú pháp gốc của docx-templates) hay `{{task.title}}`.
- **Không** đặt `FOR` và `END-FOR` trên cùng một dòng: khi đó docx-templates nhân **ô** theo chiều ngang, không nhân dòng.
- Đánh dấu dòng tiêu đề bảng "Lặp lại hàng tiêu đề" (Table Properties → Row → Repeat as header row) để bảng dài sang trang vẫn có tiêu đề, như template mẫu.
- Bảng rỗng: dòng mẫu biến mất, chỉ còn dòng tiêu đề. Đặt `{{empty.tasks}}` (hoặc `{{empty.statuses}}`, `{{empty.assignees}}`) ở đoạn ngay dưới bảng để hiện câu "Không có task nào trong kỳ.".
- Vòng lặp cũng dùng được ngoài bảng (lặp đoạn văn): đặt `{{FOR task IN tasks}}` và `{{END-FOR task}}` ở hai đoạn riêng bao quanh các đoạn cần lặp.

Ba vùng lặp và các trường (ý nghĩa, thứ tự sắp xếp, trần 10.000 task như Excel, report-template-xlsx.md mục 3):

### 3.1. `{{FOR task IN tasks}}`: task trong kỳ

| Ô giữ chỗ | Ý nghĩa |
|---|---|
| `{{task.index}}` | Số thứ tự 1, 2, 3... |
| `{{task.title}}` | Tiêu đề |
| `{{task.status}}` | Tên trạng thái của dự án |
| `{{task.status_group}}` | Nhóm trạng thái: Chưa bắt đầu / Đang thực hiện / Đã xong |
| `{{task.assignee}}` | Người phụ trách; "Chưa giao"; "Người đã rời dự án" |
| `{{task.priority}}` | Ưu tiên: Thấp / Trung bình / Cao / Khẩn cấp |
| `{{task.type}}` | Loại task |
| `{{task.start_date}}` | Ngày bắt đầu |
| `{{task.due_date}}` | Hạn |
| `{{task.completed_at}}` | Lúc hoàn thành |
| `{{task.created_at}}` | Lúc tạo |
| `{{task.updated_at}}` | Lúc cập nhật lần cuối |
| `{{task.labels}}` | Nhãn, cách nhau bằng dấu phẩy |
| `{{task.overdue}}` | "Trễ hạn" nếu chưa xong mà quá hạn, ngược lại trống |
| `{{task.level}}` | Cấp trong cây task: 1 là task gốc, 2 là task con... |

### 3.2. `{{FOR status IN statuses}}`: số task theo trạng thái

| Ô giữ chỗ | Ý nghĩa |
|---|---|
| `{{status.index}}` | Số thứ tự |
| `{{status.name}}` | Tên trạng thái |
| `{{status.group}}` | Nhóm trạng thái |
| `{{status.count}}` | Số task |
| `{{status.ratio}}` | Tỷ lệ trên tổng task (có dấu `%`) |

### 3.3. `{{FOR assignee IN assignees}}`: số task theo người phụ trách

| Ô giữ chỗ | Ý nghĩa |
|---|---|
| `{{assignee.index}}` | Số thứ tự |
| `{{assignee.name}}` | Họ tên; "Chưa giao"; "Người đã rời dự án" |
| `{{assignee.total}}` | Tổng task |
| `{{assignee.done}}` | Đã xong |
| `{{assignee.open}}` | Chưa xong |
| `{{assignee.overdue}}` | Trễ hạn |

## 4. Lệnh KHÔNG được phép (an toàn)

`docx-templates` vốn cho template chạy JavaScript (`{{= biểu thức}}`, `{{EXEC ...}}`, `{{! ...}}`, `{{IMAGE ...}}`, `{{HTML ...}}`, `{{LINK ...}}`, `{{ALIAS ...}}`, `{{*bí danh}}`, `{{QUERY ...}}`, `{{IF ...}}`). Template do Admin tải lên nên đây là rủi ro bảo mật chính: một template độc hại có thể đọc tệp, biến môi trường (khóa bí mật) của máy chủ. Ứng dụng **không chạy mã của template**:

1. Trước khi điền, ứng dụng đọc mọi lệnh trong template (thân, đầu trang, chân trang). Chỉ chấp nhận ô giữ chỗ là **đường dẫn khóa** (`a.b.c`: chữ thường, số, gạch dưới, có thể bắt đầu bằng `$`), `{{FOR x IN tasks|statuses|assignees}}` và `{{END-FOR x}}`. Có bất kỳ lệnh nào khác, hoặc biểu thức (dấu ngoặc, toán tử, chuỗi, `process`, `require`, `constructor`, `__proto__`...): **từ chối cả template**, không xuất gì, trả `422 business_rule_violated` kèm lời nhắn "Template Word đang dùng có lệnh không được phép"; máy chủ ghi log mã template và tên lệnh.
2. Bộ chạy JavaScript của thư viện được thay hẳn bằng bộ **tra khóa** trên dữ liệu ứng dụng dựng sẵn (đối tượng không prototype): không gọi hàm, không đọc biến toàn cục. Đây là lớp chặn thứ hai nếu bước 1 bị lách.
3. Dấu chèn XML thô của thư viện (mặc định `||`) đổi thành chuỗi ngẫu nhiên mỗi lần xuất, nên chữ người dùng nhập không chèn được XML vào tệp.

Test `lib/reports/docx-fill.test.ts` (nhóm "an toàn") chứng minh template độc hại không đọc được tệp, biến môi trường, không ghi được biến toàn cục.

Muốn hiện/ẩn theo điều kiện thì dùng bảng lặp (bảng rỗng tự biến mất) hoặc `{{empty.*}}`; không có `IF`.

## 5. Giới hạn đã biết

- Dòng dấu `FOR`/`END-FOR` bắt buộc nằm ở dòng riêng (mục 3). Template Excel không cần dấu đóng; template Word cần.
- Nên đặt ô giữ chỗ trong đoạn văn, ô bảng, đầu trang, chân trang (đã kiểm thử); không đặt trong SmartArt, biểu đồ.
- Trường (field) như số trang giữ nguyên, Word tự cập nhật; mục lục cần cập nhật tay (F9) sau khi mở.
- Ảnh, biểu đồ, kiểu chữ, đầu trang, chân trang của template được giữ nguyên; ứng dụng không chèn ảnh động.
- Template chứa macro (.docm) bị từ chối ngay khi tải lên (E5-2).

## 6. Thư viện

`docx-templates` 4.15.0 (giấy phép MIT, kho github.com/guigrpa/docx-templates, bản 2025-12-03), phụ thuộc `jszip` 3.10 (MIT hoặc GPL-3.0, dùng theo MIT, đã có sẵn qua `exceljs`) và `sax` 1.3.0 (ISC). Kích thước giải nén khoảng 1,3 MB, chỉ chạy ở máy chủ (Route Handler Node, ADR-004). `pnpm audit` không có cảnh báo cho ba gói này (2026-11-20). Số đo trên máy phát triển (2026-11-20): bước điền template mẫu 2.000 task khoảng 0,4 giây, 10.000 task (trần) khoảng 1,7 giây, RSS đỉnh khoảng 0,5 GB; đầu-cuối có đọc CSDL (`make perf-seed && make perf-report`) 2.000 task P50 khoảng 0,47 giây. Test `lib/reports/export-2000.test.ts` (E5-5) giữ golden ổn định cho cả xlsx và docx.

## 7. API và lỗi

`POST /api/v1/projects/{id}/reports` với `{ "format": "docx", "period_start": "2026-11-01", "period_end": "2026-11-30" }`, chỉ PM của dự án và Admin; kỳ dài tối đa 366 ngày. Mỗi lần xuất thành công ghi một dòng `report_exports` với `format = 'docx'` (không sửa, không xóa).

| Tình huống | Mã |
|---|---|
| Không có template docx đang dùng (dù có template xlsx) | `422 report_template_missing` |
| Template hỏng, không mở được, hoặc sai quy ước (FOR trên khóa không phải vùng lặp, alias không có...) | `422 business_rule_violated` |
| Template có lệnh không được phép (mục 4) | `422 business_rule_violated` |
| Kỳ có hơn 10.000 task | `422 business_rule_violated` (`period_end`) |
| Quá 10 lần xuất trong 10 phút (chung cho xlsx và docx) | `429 rate_limited` |
| Xử lý quá 25 giây | `504 report_timeout` |
