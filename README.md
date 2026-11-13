# Quản lý dự án CNTT

Ứng dụng quản lý dự án CNTT nội bộ. Stack: Next.js + TypeScript + Supabase (Postgres, Auth, Storage) + Vercel ([ADR-001](docs/adr/ADR-001-tech-stack.md)).

## Chạy cục bộ

### Yêu cầu

- Node theo `.nvmrc` (26) và pnpm theo trường `packageManager` trong `package.json`
- Docker đang chạy (Docker Desktop hoặc Colima: `colima start`); kiểm tra bằng `docker info`
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- gitleaks (cho `make security`)

### Cài đặt

```bash
make install
cp .env.example .env.local   # điền giá trị cục bộ, KHÔNG commit .env.local
```

### Khởi động CSDL và seed

```bash
make db-start    # chạy Supabase cục bộ, áp migration (lần đầu kéo image, mất vài phút)
make db-reset    # dựng lại CSDL từ đầu: migration + supabase/seed.sql
make db-seed     # tạo/cập nhật 4 tài khoản thử (cần SEED_PASSWORD)
make db-test     # test pgTAP trong supabase/tests/
```

`make db-start` in ra địa chỉ API, Studio (mặc định http://127.0.0.1:54323) và các khóa cục bộ. Chép URL API và khóa vào `.env.local` khi chạy app (`pnpm dev`).

Tài khoản thử dùng chung mật khẩu `SEED_PASSWORD` do bạn tự đặt (trong shell bằng `export SEED_PASSWORD=...` hoặc trong `.env.local`). Không có mật khẩu mặc định; thiếu biến thì script dừng và hướng dẫn cách đặt.

| Persona    | Email                |
| ---------- | -------------------- |
| Admin      | `admin@example.com`  |
| PM         | `pm@example.com`     |
| Thành viên | `member@example.com` |
| Người xem  | `viewer@example.com` |

Vai trò theo từng dự án chưa được gán (Story E1-3). `make db-reset` xóa cả tài khoản thử, chạy lại `make db-seed` sau đó. Script chỉ chạy với stack cục bộ và từ chối mọi URL không phải localhost.

### Dừng

```bash
make db-stop     # dừng stack, giữ dữ liệu cho lần sau
```

### Kiểm tra trước khi mở PR

```bash
make lint test build security
```

Nếu shell đặt sẵn `NODE_ENV` khác `production`, `next build` có thể lỗi; khi đó chạy `env -u NODE_ENV make lint test build security`.

## Quy ước

- Migration: một tệp SQL mới trong `supabase/migrations/` (`supabase migration new <ten>`), không sửa migration đã merge.
- Chỉ dữ liệu giả trong seed và test; repo công khai, không commit bí mật hay dữ liệu thật.
- Nhánh `type/QLDA-123-slug`, Conventional Commits có mã issue, PR vào `main` theo mẫu.
