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

### Chạy ứng dụng cục bộ

```bash
make db-start                      # in ra API URL và khóa cục bộ
supabase status -o env             # xem lại: API_URL, ANON_KEY (hoặc PUBLISHABLE_KEY)
# Điền vào .env.local: NEXT_PUBLIC_SUPABASE_URL=<API_URL>, NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
# (CLI mới gọi là publishable key; dự án giữ tên biến cũ). KHÔNG đặt khóa service_role vào biến NEXT_PUBLIC_*.
make db-seed                       # tài khoản thử, xem bảng bên trên
pnpm dev                           # http://localhost:3000, đăng nhập tại /login
make test-integration              # test tích hợp đăng nhập (email, Google mô phỏng), đăng xuất, hết phiên
```

### Đăng nhập Google (tùy chọn)

Nút "Tiếp tục với Google" ở `/login` đi qua Supabase Auth (luồng PKCE, cookie httpOnly). Hệ thống **chỉ cho người được Admin mời**: `enable_signup = false` trong `supabase/config.toml` tắt đăng ký ở mọi kênh, nên tài khoản Google có email chưa có trong hệ thống bị từ chối ("liên hệ Admin để được mời"); email đã được mời (tạo bằng API admin hoặc `make db-seed`) đăng nhập Google được và dùng chung tài khoản đó.

1. **Tạo OAuth client** ở [Google Cloud Console](https://console.cloud.google.com/apis/credentials): chọn (hoặc tạo) project, cấu hình _OAuth consent screen_ (loại _Internal_ nếu dùng Google Workspace của công ty, nếu không thì _External_ và thêm người thử), rồi _Create credentials → OAuth client ID → Web application_.
2. **Authorized redirect URIs** là địa chỉ callback của **Supabase Auth** (không phải của app):

   | Môi trường         | Redirect URI trên Google                             |
   | ------------------ | ---------------------------------------------------- |
   | Cục bộ             | `http://127.0.0.1:54321/auth/v1/callback`            |
   | Staging/production | `https://<project-ref>.supabase.co/auth/v1/callback` |

   _Authorized JavaScript origins_ không bắt buộc (app không gọi Google từ trình duyệt).

3. **Đặt biến** (KHÔNG commit, tên biến có trong `.env.example`). Cục bộ: ghi vào `supabase/.env` (Supabase CLI tự đọc, `.gitignore` đã chặn) hoặc `export` trong shell, rồi `make db-stop && make db-start` để Auth nhận giá trị mới:

   ```bash
   SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
   SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<client-secret>
   ```

   Thiếu hai biến này stack vẫn chạy; bấm nút Google sẽ gặp lỗi `invalid_client` của Google. Đăng nhập email không bị ảnh hưởng.

4. **Staging/production** (Supabase Dashboard của project; `config.toml` chỉ áp cho stack cục bộ):
   - _Authentication → Sign In / Providers → Google_: bật, dán Client ID và Client Secret.
   - _Authentication → Sign In / Providers_: **tắt "Allow new users to sign up"** (tương đương `enable_signup = false`). Bước này bắt buộc: thiếu nó, ai có tài khoản Google cũng tự tạo được tài khoản.
   - _Authentication → URL Configuration_: _Site URL_ là địa chỉ app; _Redirect URLs_ chỉ gồm `https://<tên-miền-app>/auth/callback` (thêm URL preview Vercel nếu cần, tránh ký tự đại diện rộng).

Cục bộ, app chạy ở `http://localhost:3000` hoặc `http://127.0.0.1:3000` (cả hai `.../auth/callback` đã có trong `additional_redirect_urls`). Kiểm tra tự động không cần Google thật: `make test-integration` chạy cả `tests/integration/google-auth.test.ts`.

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
