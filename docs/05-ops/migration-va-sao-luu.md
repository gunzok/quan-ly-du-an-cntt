# Migration lên staging/production và sao lưu

Story E0-10 (chuẩn bị trong QLDA-33). Quy tắc nền: [database.md mục 6](../03-design/database.md#6-migration); mục tiêu khôi phục: NFR-05 (RPO 24 giờ, RTO 4 giờ, **đề xuất, chưa chốt**). Cấu hình tài khoản ở [README.md](README.md).

> **[CHƯA KIỂM CHỨNG]** Chưa có dự án Supabase thật: các lệnh dưới đây đã kiểm cú pháp với Supabase CLI 3.1.0 nhưng chưa chạy trên dự án thật. Lần đầu làm theo tài liệu này nên có người theo dõi.

## 1. Quy tắc khi viết migration

1. Mỗi thay đổi lược đồ là **một tệp mới** `supabase/migrations/<YYYYMMDDHHMMSS>_<ten_thuong>.sql`, timestamp **lớn hơn** migration mới nhất trên `main`.
2. **Không sửa, xóa, đổi tên** migration đã merge: nó có thể đã chạy trên staging/production. Muốn đổi thì viết migration mới.
3. Migration phải **tương thích ngược với bản app đang chạy**: CD áp migration **trước** khi đưa app mới lên, và rollback chỉ quay lại app, không quay lại CSDL. Ví dụ đổi tên cột: thêm cột mới → app mới dùng cột mới → phát hành sau mới xóa cột cũ ("mở rộng rồi thu hẹp").
4. Không đưa dữ liệu thật vào migration hay `seed.sql` (repo công khai). Migration không chạy `seed.sql` trên staging/production (`supabase db push` không có `--include-seed`).
5. Tránh khóa bảng lâu trên bảng lớn (tạo chỉ mục lớn, đổi kiểu cột): tách migration riêng, chạy ngoài giờ hành chính.

CI kiểm tự động trên mỗi PR (`make check-migrations`, [`scripts/deploy/check-migrations.ts`](../../scripts/deploy/check-migrations.ts)): đỏ khi sửa/xóa/đổi tên migration đã có trên `main`, tên sai dạng hoặc trùng timestamp; cảnh báo khi timestamp mới không lớn hơn migration mới nhất (khi đó `supabase db push` sẽ từ chối, đổi tên tệp trước khi merge).

## 2. Luồng đưa migration lên (gắn vào CD)

```
PR có migration
  └─ CI: check-migrations, make test-db (pgTAP), test-integration, e2e trên CSDL cục bộ
merge vào main → CD deploy-staging
  1. supabase db push --dry-run   (in danh sách migration sẽ chạy, không ghi)
  2. (BACKUP_STRATEGY=supabase) kiểm bản sao lưu staging, chỉ cảnh báo
  3. supabase db push --yes       (áp lên staging)
  4. triển khai app, kiểm tra khói → trạng thái cd/staging = success
kiểm thử tay trên staging (luồng chính có dùng thay đổi mới)
gắn tag vX.Y.Z → CD deploy-production (DỪNG CHỜ DUYỆT)
  1. dry-run trên production (đọc log trước khi yên tâm)
  2. kiểm bản sao lưu: supabase → bắt buộc có bản ≤ 26 giờ hoặc PITR; manual → người duyệt tự xác nhận
  3. supabase db push --yes       (áp lên production)
  4. vercel deploy --prod, kiểm tra khói
```

Tiêu chí 1 của E0-10 ("lên staging trước, qua kiểm tra rồi mới lên production") được CD **ép buộc**: job `plan` từ chối phát hành tag nếu commit chưa có trạng thái `cd/staging = success`.

`supabase db push` ghi lịch sử vào bảng `supabase_migrations.schema_migrations` của từng dự án nên mỗi migration chỉ chạy một lần. Mỗi tệp migration chạy trong một giao dịch: lỗi giữa chừng thì tệp đó không áp nửa vời (các tệp trước trong cùng lượt đã áp vẫn giữ).

## 3. Chiến lược sao lưu (biến `BACKUP_STRATEGY` của environment)

| Giá trị | Khi nào | CD làm gì trước migration production |
|---|---|---|
| `supabase` | Dự án production ở gói **Pro** trở lên (sao lưu tự động hằng ngày, giữ khoảng 7 ngày, chưa xác minh R-008) | Gọi `supabase backups list` (cần `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`), [`backup-check.ts`](../../scripts/deploy/backup-check.ts) đòi bản `COMPLETED` trong 26 giờ hoặc PITR bật; không có thì **đỏ, không migrate** |
| `manual` | Gói **Free** (không có sao lưu tự động) | In cảnh báo; **người duyệt phải tự sao lưu tay** (mục 4) trước khi bấm duyệt |

Với `manual`, để đạt RPO 24 giờ cần sao lưu tay **mỗi ngày làm việc**, không chỉ trước mỗi lần phát hành. Nếu kỷ luật này khó giữ, đó là lý do nâng production lên Supabase Pro (phương án P3, cần sếp duyệt vì vượt 25 USD, xem [README mục 2](README.md#2-quyết-định-trước-chi-phí-và-gói-dịch-vụ)).

## 4. Sao lưu tay

Trên máy của sếp (cần Supabase CLI và Docker đang chạy):

```bash
make db-backup DEPLOY_ENV=production
# dán chuỗi kết nối Session pooler (Dashboard → Connect → Session pooler, cổng 5432) khi được hỏi
```

[`scripts/deploy/backup.sh`](../../scripts/deploy/backup.sh) tạo thư mục `~/qlda-backups/production-<thời gian UTC>/` gồm `roles.sql`, `schema.sql`, `data.sql`, `SHA256SUMS`; quyền 700/600; từ chối ghi vào trong repo; không in chuỗi kết nối.

Lưu ý an toàn:

- Tệp sao lưu chứa **dữ liệu thật** (tên, email, số điện thoại: NFR-14). Giữ trên ổ mã hóa (FileVault), chép thêm một bản sang nơi lưu trữ công ty có kiểm soát quyền. Không gửi qua chat/email, không đưa vào repo.
- **Tệp trong Supabase Storage** (template báo cáo) **không** nằm trong bản dump. Khi bắt đầu có tệp thật, tải thêm qua Dashboard → Storage hoặc bổ sung script sau.
- Xóa bản cũ theo lịch giữ (đề xuất: 7 bản hằng ngày + 4 bản hằng tuần), **[CẦN XÁC NHẬN]** với sếp.

## 5. Khôi phục

Chỉ khôi phục khi sự cố làm **mất hoặc hỏng dữ liệu**. Lỗi lược đồ thông thường xử lý bằng migration sửa (forward fix), không khôi phục.

### 5.1 Gói Pro (BACKUP_STRATEGY=supabase)

Dashboard dự án → **Database → Backups** → chọn bản → **Restore**. Dự án ngừng phục vụ trong lúc khôi phục; dữ liệu sau thời điểm sao lưu bị mất. Thời gian khôi phục tùy dung lượng, chưa đo.

### 5.2 Từ bản sao lưu tay

Nên khôi phục vào **một dự án Supabase mới** (hoặc dự án staging sau khi xóa sạch) rồi chuyển app sang, thay vì ghi đè production đang hỏng:

```bash
cd ~/qlda-backups/production-<thời gian>
shasum -a 256 -c SHA256SUMS                 # kiểm tệp không hỏng
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "<chuỗi kết nối Session pooler của dự án đích>"
```

(Theo hướng dẫn khôi phục từ dump của Supabase; `session_replication_role = replica` tắt trigger trong lúc nạp dữ liệu.) Sau đó:

1. Kiểm `supabase migration list --remote="<chuỗi kết nối>"`: lịch sử migration khớp thư mục `supabase/migrations`.
2. Nếu khôi phục vào dự án mới: cập nhật biến môi trường Production trên Vercel (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) và environment `production` trên GitHub (`SUPABASE_DB_URL`, `NEXT_PUBLIC_*`, `SUPABASE_PROJECT_REF`), cấu hình lại Auth theo [README Bước 2, 3](README.md#4-bước-2-cấu-hình-đăng-nhập-supabase-auth), rồi Vercel → Redeploy.
3. Chạy `make deploy-smoke URL=<tên miền production> SMOKE_SUPABASE_URL=... SMOKE_SUPABASE_ANON_KEY=...`, đăng nhập thử bằng tài khoản Admin.
4. Báo người dùng khoảng dữ liệu bị mất (từ thời điểm sao lưu đến lúc sự cố).

### 5.3 Diễn tập khôi phục (task "Thử khôi phục từ sao lưu" của E0-10)

Làm **một lần khi đã có dự án staging**, sau đó mỗi quý:

1. `make db-backup DEPLOY_ENV=staging`, ghi lại thời gian dump.
2. Tạo dự án Supabase Free tạm (hoặc dùng `make db-start` cục bộ, chuỗi kết nối `postgresql://postgres:postgres@127.0.0.1:54322/postgres` sau khi xóa schema `public`) và khôi phục theo 5.2.
3. Đo thời gian từ lúc bắt đầu đến lúc đăng nhập được → so với RTO 4 giờ; ghi kết quả vào PROJECT_STATE.md (phiên điều phối).
4. Xóa dự án tạm và bản sao lưu thử.

> Không chạy diễn tập trên CSDL cục bộ dùng chung khi agent khác đang chạy e2e (quy ước repo: không `db-reset` CSDL dùng chung).

## 6. Sự cố khi migrate

| Tình huống | Làm gì |
|---|---|
| `db push` báo migration "insert before the last migration" | Timestamp tệp mới nhỏ hơn migration đã áp. Đổi tên tệp sang timestamp mới hơn trong PR mới (chưa áp ở đâu thì đổi tên được) |
| `db push` đỏ giữa chừng | Xem log tệp nào lỗi. Các tệp trước đó đã áp, tệp lỗi không áp. Kiểm `supabase migration list --remote="<chuỗi>"`. Sửa bằng **migration mới**, merge, CD chạy lại |
| Migration đã áp nhưng app mới lỗi | Quay lại app ([README mục 12](README.md#12-quay-lại-bản-trước-rollback)); migration tương thích ngược (quy tắc 3) nên app cũ vẫn chạy |
| Migration làm hỏng dữ liệu | Dừng ghi (tạm khóa người dùng nếu cần), khôi phục theo mục 5, rồi forward fix |
| Lịch sử migration lệch (ai đó sửa tay trên Dashboard) | Không sửa tay trên staging/production. Nếu đã lỡ: `supabase migration repair` theo hướng dẫn Supabase, có người thứ hai xem lại |

## 7. Việc còn chờ sếp

- Chốt RPO/RTO (NFR-05) và lịch giữ bản sao lưu.
- Chọn gói production (Free + sao lưu tay, hay Pro) — quyết định `BACKUP_STRATEGY`.
- Chỉ định người giữ bản sao lưu tay và nơi lưu trữ thứ hai.
