# Vận hành: staging, production và triển khai tự động (CD)

Story E0-2 (QLDA-33). Tài liệu này hướng dẫn **từng bước** để đưa ứng dụng lên staging và production. Viết cho người không chuyên DevOps: làm lần lượt từ trên xuống, mỗi bước ghi rõ bấm vào đâu, sao chép giá trị nào, dán vào đâu.

Tài liệu liên quan trong thư mục này:

- [migration-va-sao-luu.md](migration-va-sao-luu.md): quy trình đưa thay đổi CSDL lên staging rồi production, sao lưu và khôi phục (E0-10).
- [giam-sat.md](giam-sat.md): đề xuất công cụ giám sát lỗi, uptime và log (E0-4), chờ sếp chọn.

> **Trạng thái (2026-11-18):** mã CD, script và tài liệu đã sẵn sàng; **chưa có tài khoản Supabase/Vercel thật** nên CD đang tự bỏ qua (xám). Những chỗ ghi **[CHƯA KIỂM CHỨNG]** là chỗ chỉ xác nhận được khi có tài khoản thật. Giá dịch vụ lấy từ [tech-stack-matrix.md mục 4](../02-ba/tech-stack-matrix.md) và [ADR-002](../adr/ADR-002-email.md), **chưa đối chiếu trang giá chính thức** (R-008): tra lại trước khi mua.

## Mục lục

1. [Bức tranh chung](#1-bức-tranh-chung)
2. [Quyết định trước: chi phí và gói dịch vụ](#2-quyết-định-trước-chi-phí-và-gói-dịch-vụ)
3. [Bước 1: Tạo 2 dự án Supabase](#3-bước-1-tạo-2-dự-án-supabase)
4. [Bước 2: Cấu hình đăng nhập (Supabase Auth)](#4-bước-2-cấu-hình-đăng-nhập-supabase-auth)
5. [Bước 3: Đăng nhập Google (OAuth)](#5-bước-3-đăng-nhập-google-oauth)
6. [Bước 4: Tạo dự án Vercel](#6-bước-4-tạo-dự-án-vercel)
7. [Bước 5: Biến môi trường trên Vercel](#7-bước-5-biến-môi-trường-trên-vercel)
8. [Bước 6: GitHub Environments, Secrets, Variables](#8-bước-6-github-environments-secrets-variables)
9. [Bước 7: Triển khai staging lần đầu](#9-bước-7-triển-khai-staging-lần-đầu)
10. [Bước 8: Tài khoản Admin đầu tiên](#10-bước-8-tài-khoản-admin-đầu-tiên)
11. [Bước 9: Phát hành production](#11-bước-9-phát-hành-production)
12. [Quay lại bản trước (rollback)](#12-quay-lại-bản-trước-rollback)
13. [Checklist sẵn sàng](#13-checklist-sẵn-sàng)
14. [Kiểm tra cục bộ và tham chiếu kỹ thuật](#14-kiểm-tra-cục-bộ-và-tham-chiếu-kỹ-thuật)
15. [Điều chưa kiểm chứng](#15-điều-chưa-kiểm-chứng)

## 1. Bức tranh chung

| Môi trường | Ứng dụng (Vercel) | CSDL + đăng nhập (Supabase) | Dữ liệu | Khi nào cập nhật |
|---|---|---|---|---|
| Local | `pnpm dev` / `next start` | Supabase CLI trên máy | Giả (`make db-seed`) | Khi lập trình |
| Staging | Bản **Preview** của dự án Vercel, gắn tên miền cố định (ví dụ `qlda-staging.vercel.app`) | Dự án Supabase **staging** | Dữ liệu thử, không dữ liệu thật | Tự động mỗi lần merge vào `main` và CI xanh |
| Production | Bản **Production** của cùng dự án Vercel | Dự án Supabase **production** | Dữ liệu thật | Khi gắn tag `vX.Y.Z` **và** người duyệt bấm đồng ý |

Luồng tự động (tệp [`.github/workflows/cd.yml`](../../.github/workflows/cd.yml)):

```
merge PR vào main
  └─ CI chạy (lint, test, build, security, test-db, e2e, ci-gate)
       └─ CI xanh → CD: plan → deploy-staging
            1. xem trước migration (supabase db push --dry-run)
            2. áp migration lên Supabase staging
            3. vercel deploy (Preview) → gắn tên miền staging
            4. kiểm tra khói (scripts/deploy/smoke.ts)
            5. ghi trạng thái "cd/staging = success" cho commit

git tag v1.0.0 && git push origin v1.0.0   (tag phải trỏ vào commit đã qua bước 5)
  └─ CD: plan (kiểm: commit thuộc main, ci-gate xanh, cd/staging xanh)
       └─ deploy-production: DỪNG CHỜ DUYỆT (environment production, người duyệt: gunzok)
            1. xem trước migration
            2. kiểm bản sao lưu (BACKUP_STRATEGY)
            3. áp migration lên Supabase production
            4. vercel deploy --prod
            5. kiểm tra khói tên miền production
```

Khi repo **chưa cấu hình** (hai biến `DEPLOY_STAGING_ENABLED`, `DEPLOY_PRODUCTION_ENABLED` chưa đặt `true`), job `plan` chỉ ghi thông báo "chưa cấu hình", các job triển khai bị bỏ qua (màu xám) và `main` **không đỏ**. Đã bật mà thiếu bí mật thì job triển khai đỏ và liệt kê **tên** bí mật còn thiếu (không in giá trị).

**Quyết định kỹ thuật đã chọn** (ghi để phiên điều phối đưa vào ADR nếu cần):

- **Triển khai Vercel bằng Vercel CLI từ GitHub Actions**, không dùng tích hợp Git của Vercel. Lý do: phải chạy migration **trước** khi đưa app mới lên, chỉ triển khai khi `ci-gate` xanh, và production phải dừng chờ duyệt trên GitHub. Tích hợp Git của Vercel tự build mỗi lần push, không chờ CI hay migration. Tệp [`vercel.json`](../../vercel.json) tắt tự triển khai từ Git (`git.deploymentEnabled: false`) để phòng khi lỡ kết nối repo, và chọn vùng hàm `sin1` (Singapore, gần Việt Nam).
- **Vercel build trên máy của Vercel** (`vercel deploy`, không `--prebuilt`): GitHub Actions không cần tải bí mật Supabase về runner; bí mật ứng dụng chỉ nằm trên Vercel.
- **Một dự án Vercel, staging = môi trường Preview**: biến môi trường "Preview" trỏ Supabase staging, "Production" trỏ Supabase production. Gói Hobby không có "custom environment" riêng cho staging; gói Pro có thể tạo môi trường "staging" riêng sau này.
- **Migration bằng chuỗi kết nối CSDL** (`supabase db push --remote=<chuỗi kết nối>`), không cần Access Token toàn tài khoản Supabase (quyền tối thiểu). Access Token chỉ cần khi muốn CD tự kiểm bản sao lưu (`BACKUP_STRATEGY=supabase`).

## 2. Quyết định trước: chi phí và gói dịch vụ

> **Cần sếp quyết (R-008, NFR-12: dưới 25 USD/tháng).** Giá dưới đây **chưa xác minh** từ trang chính thức (nguồn: tech-stack-matrix.md mục 4, ADR-002, tra 2026-11-13). Mở trang giá chính thức của [Supabase](https://supabase.com/pricing), [Vercel](https://vercel.com/pricing), [Resend](https://resend.com/pricing) và đối chiếu trước khi chọn.

Giá tham khảo từng dịch vụ:

| Dịch vụ | Gói | Giá/tháng (chưa xác minh) | Giới hạn chính cần biết |
|---|---|---|---|
| Supabase | Free | 0 USD | 500 MB CSDL; 2 dự án Free; **tạm dừng sau 7 ngày không dùng**; **không có sao lưu tự động** |
| Supabase | Pro | 25 USD/tổ chức | Sao lưu hằng ngày (giữ khoảng 7 ngày), không tạm dừng. Tín dụng compute đi kèm chỉ đủ cho 1 dự án nhỏ: dự án thứ hai trong cùng tổ chức Pro tốn thêm (khoảng 10 USD) |
| Vercel | Hobby | 0 USD | **Chỉ dùng cá nhân, phi thương mại** (ứng dụng nội bộ công ty được coi là thương mại); 1 thành viên; Deployment Protection mặc định cho bản Preview |
| Vercel | Pro | khoảng 20 USD/người | Được dùng thương mại; nhiều thành viên; custom environment |
| Resend | Free | 0 USD | 3.000 email/tháng, 100 email/ngày, 1 tên miền (ADR-002) |

Các phương án ghép:

| Phương án | Thành phần | Tổng ước tính | Ưu | Nhược / rủi ro |
|---|---|---|---|---|
| **P1. Thử nghiệm (pilot)** | Supabase Free × 2 (staging, production) + Vercel Hobby + Resend Free | **0 USD** | Không tốn tiền, đủ để chạy thử | Vercel Hobby **cấm thương mại**: chỉ hợp lệ khi chạy thử/demo, không vận hành chính thức. Không sao lưu tự động (phải sao lưu tay, `BACKUP_STRATEGY=manual`). Staging tạm dừng nếu 7 ngày không dùng |
| **P2. Vận hành tiết kiệm** | Supabase Free × 2 + **Vercel Pro** (1 người) + Resend Free | **khoảng 20 USD** | Dưới trần 25 USD; hợp lệ thương mại phía Vercel | Production không có sao lưu tự động: phải sao lưu tay đều đặn để đạt RPO 24 giờ; giới hạn 500 MB CSDL |
| **P3. Vận hành an toàn dữ liệu** | **Supabase Pro** (chỉ production, tổ chức riêng) + Supabase Free (staging, tổ chức khác) + **Vercel Pro** + Resend Free | **khoảng 45 USD** | Sao lưu tự động hằng ngày, không tạm dừng | **Vượt 25 USD**: cần sếp duyệt riêng (ADR-001) |
| P4. (không khuyến nghị) | Supabase Pro + Vercel Hobby | khoảng 25 USD | Có sao lưu tự động | Vẫn vi phạm điều khoản Hobby khi dùng thương mại |

> ⚠️ **Cảnh báo vượt ngân sách:** chỉ cần bật **Supabase Pro** và **Vercel Pro** cùng lúc là vượt 25 USD/tháng. Không tự nâng gói; mọi phương án trên 25 USD phải có sếp duyệt bằng văn bản. Thêm thành viên vào Vercel Pro (mỗi người khoảng 20 USD) hay thêm dự án vào tổ chức Supabase Pro cũng làm tăng chi phí. Nên bật **giới hạn chi tiêu** (Spend Management của Vercel, Spend Cap của Supabase) ngay khi lên gói trả phí.

**Đề xuất của agent:** P1 trong giai đoạn chạy thử ngắn (vài tuần, dữ liệu thử), sau đó P2 khi bắt đầu dùng thật (giữ dưới 25 USD, kỷ luật sao lưu tay hằng ngày), cân nhắc P3 khi dữ liệu quan trọng hơn chi phí. Đây là đề xuất, **sếp quyết**.

## 3. Bước 1: Tạo 2 dự án Supabase

Làm hai lần: một dự án **staging**, một dự án **production**. Nếu chọn P3, tạo hai **tổ chức** (organization) riêng: tổ chức Pro chứa production, tổ chức Free chứa staging.

1. Vào [supabase.com/dashboard](https://supabase.com/dashboard), đăng nhập bằng tài khoản công ty (không dùng tài khoản cá nhân để dễ bàn giao).
2. **New project** → chọn tổ chức → điền:
   - **Name**: `qlda-staging` (lần hai: `qlda-production`).
   - **Database Password**: bấm **Generate a password**, sao chép vào trình quản lý mật khẩu (1Password, Bitwarden...). **Không** ghi vào repo, chat hay email.
   - **Region**: **Southeast Asia (Singapore)** (gần Việt Nam nhất, cùng vùng `sin1` của Vercel).
3. Chờ dự án khởi tạo xong (vài phút).
4. Ghi lại các giá trị sau (vào trình quản lý mật khẩu, theo từng dự án):

| Giá trị | Lấy ở đâu trong Dashboard | Dùng cho | Bí mật? |
|---|---|---|---|
| **Project ref** (chuỗi khoảng 20 ký tự) | Project Settings → General → Project ID | `SUPABASE_PROJECT_REF` (GitHub) | Không |
| **Project URL** `https://<ref>.supabase.co` | Project Settings → Data API (hoặc nút **Connect**) | `NEXT_PUBLIC_SUPABASE_URL` (Vercel + GitHub) | Không |
| **Publishable key** (`sb_publishable_...`) hoặc khóa **anon** (legacy) | Project Settings → API Keys | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Vercel + GitHub) | Không (công khai trong trình duyệt) |
| **Secret key** (`sb_secret_...`) hoặc khóa **service_role** (legacy) | Project Settings → API Keys | `SUPABASE_SERVICE_ROLE_KEY` (**chỉ** Vercel) | **CÓ, tuyệt mật**: bỏ qua mọi phân quyền |
| **Chuỗi kết nối Session pooler** `postgresql://postgres.<ref>:<mật khẩu>@aws-...pooler.supabase.com:5432/postgres` | Nút **Connect** (đầu trang) → **Session pooler** → thay `[YOUR-PASSWORD]` bằng mật khẩu CSDL | `SUPABASE_DB_URL` (GitHub, cho migration) | **CÓ** |

> Dùng **Session pooler** (cổng 5432), không dùng "Direct connection": kết nối trực tiếp chỉ có IPv6, máy chạy GitHub Actions không vào được **[CHƯA KIỂM CHỨNG]**. Mật khẩu có ký tự đặc biệt (`@`, `:`, `/`, `#`...) thì phải mã hóa URL (ví dụ `@` → `%40`) hoặc đặt lại mật khẩu chỉ gồm chữ và số.

5. **Không** chạy `supabase/seed.sql` hay `make db-seed` lên staging/production: đó là dữ liệu giả cho máy cục bộ (script seed từ chối mọi URL không phải localhost). Migration (lược đồ, bảng, RLS) do CD áp ở [Bước 7](#9-bước-7-triển-khai-staging-lần-đầu).

## 4. Bước 2: Cấu hình đăng nhập (Supabase Auth)

Cấu hình trong [`supabase/config.toml`](../../supabase/config.toml) **chỉ áp cho máy cục bộ**; dự án thật phải đặt tay trong Dashboard (CD không đẩy cấu hình Auth để tránh ghi đè nhầm URL cục bộ). Làm cho **từng** dự án (staging và production), thay `<APP_URL>` bằng địa chỉ ứng dụng của môi trường đó (staging: tên miền staging bạn sẽ chọn ở Bước 4, ví dụ `https://qlda-staging.vercel.app`; production: tên miền production).

| Mục trong Dashboard | Đặt thành | Tương ứng config.toml / lý do |
|---|---|---|
| Authentication → **URL Configuration** → Site URL | `<APP_URL>` (không có `/` cuối) | `site_url`. Link trong email mời dùng `{{ .SiteURL }}` |
| Authentication → URL Configuration → **Redirect URLs** | `<APP_URL>/auth/callback` (chỉ đúng URL này, không dùng `*`) | `additional_redirect_urls`. Đăng nhập Google quay về đây |
| Authentication → **Sign In / Providers** → "Allow new users to sign up" | **TẮT** | `enable_signup = false`: chỉ Admin mời người dùng (E1-4). Tắt đăng ký không chặn lời mời |
| Sign In / Providers → "Allow anonymous sign-ins" | **TẮT** | `enable_anonymous_sign_ins = false` |
| Sign In / Providers → "Allow manual linking" | **TẮT** | `enable_manual_linking = false` |
| Sign In / Providers → **Email** → "Confirm email" | **TẮT** | `enable_confirmations = false` (người dùng do Admin mời, email đã xác thực qua link mời) |
| Email → "Secure email change" | **BẬT** | `double_confirm_changes = true` |
| Email → **Minimum password length** | **12** | `minimum_password_length = 12` (E1-7, khớp kiểm tra phía app) |
| Email → **Email OTP Expiration** (thời hạn link mời) | Đề xuất **86400** (24 giờ, mức tối đa) | Cục bộ đang 3600 (1 giờ), dễ hết hạn trước khi người được mời mở email (PROJECT_STATE "Việc phát sinh từ E1-4" (b)). Đánh đổi: link khôi phục mật khẩu cũng sống 24 giờ. **Sếp chọn** 3600 hay 86400 |
| Authentication → **Emails** → Templates → **Invite user** | Subject: `Lời mời vào Quản lý Dự án CNTT`; Body: dán **toàn bộ** nội dung [`supabase/templates/invite.html`](../../supabase/templates/invite.html) | Link trỏ `/auth/accept-invite?token_hash=...`, không dùng `{{ .ConfirmationURL }}` (trình quét link của hộp thư sẽ tiêu mất token) |
| Authentication → **Emails** → SMTP Settings | Tạm để mặc định ở staging; production nên dùng SMTP của Resend khi có tên miền (ADR-002, E4-3) | SMTP mặc định của Supabase giới hạn rất chặt (vài email/giờ) và có thể chỉ gửi tới email thành viên tổ chức **[CHƯA KIỂM CHỨNG]**: đủ để mời Admin đầu tiên, không đủ vận hành |
| Authentication → Sessions / JWT | Giữ mặc định (JWT 3600 giây, xoay vòng refresh token bật) | `jwt_expiry = 3600`, `enable_refresh_token_rotation = true` |
| Authentication → Multi-Factor | Giữ tắt | Chưa có Story MFA |

Kiểm tra lại sau khi lưu: mở **Authentication → URL Configuration** của cả hai dự án, đảm bảo staging không trỏ tên miền production và ngược lại.

## 5. Bước 3: Đăng nhập Google (OAuth)

Làm sau khi có tên miền staging/production. Nên tạo **hai OAuth client riêng** (staging, production) để thu hồi độc lập.

1. Vào [console.cloud.google.com](https://console.cloud.google.com) bằng tài khoản Google Workspace của công ty → tạo project `qlda` (hoặc dùng project có sẵn).
2. **APIs & Services → OAuth consent screen** (hoặc "Google Auth Platform → Branding/Audience"):
   - **User type / Audience**: chọn **Internal** nếu công ty dùng Google Workspace (chỉ người trong tên miền công ty đăng nhập được, không cần Google duyệt). Không có Workspace thì chọn External và thêm người dùng thử.
   - App name: `Quản lý Dự án CNTT`; email hỗ trợ: email công ty; Authorized domains: `vercel.app` (hoặc tên miền công ty) và `supabase.co`.
   - Scopes: chỉ `openid`, `email`, `profile` (mặc định).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → Application type **Web application**:
   - Name: `qlda-staging` (lần hai `qlda-production`).
   - **Authorized JavaScript origins**: `<APP_URL>`.
   - **Authorized redirect URIs**: `https://<project-ref>.supabase.co/auth/v1/callback` (ref của dự án Supabase tương ứng; Supabase hiển thị sẵn URL này ở trang provider Google).
   - Bấm Create → sao chép **Client ID** và **Client secret** (bí mật) vào trình quản lý mật khẩu.
4. Supabase Dashboard (đúng dự án) → **Authentication → Sign In / Providers → Google** → bật → dán Client ID, Client secret → Save.
5. Thử: mở `<APP_URL>/login` → "Đăng nhập bằng Google". Tài khoản Google **chưa được Admin mời** sẽ bị từ chối (vì đã tắt đăng ký); tài khoản đã được mời bằng cùng email sẽ vào được (PROJECT_STATE "Việc phát sinh từ E1-4" (d), **[CHƯA KIỂM CHỨNG]** với OAuth client thật).

Biến `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET` trong `.env.example` chỉ dùng cho Supabase **cục bộ**; dự án thật không cần đặt chúng ở Vercel hay GitHub.

## 6. Bước 4: Tạo dự án Vercel

1. Vào [vercel.com](https://vercel.com), đăng nhập (nên dùng email công ty). Chọn gói theo [mục 2](#2-quyết-định-trước-chi-phí-và-gói-dịch-vụ).
2. Tạo dự án **không kết nối Git** (CD triển khai bằng CLI). Cách đơn giản nhất trên máy của sếp, trong thư mục repo:
   ```bash
   npx vercel@65.9.0 login              # đăng nhập trình duyệt
   npx vercel@65.9.0 link               # tạo dự án mới, đặt tên ví dụ "qlda"; KHÔNG chọn kết nối Git
   cat .vercel/project.json             # ghi lại "orgId" và "projectId" (thư mục .vercel đã nằm trong .gitignore)
   ```
   Nếu lỡ tạo dự án bằng "Import Git Repository" trên web: vào Project → Settings → Git → **Disconnect**. `vercel.json` cũng đã tắt tự triển khai từ Git.
3. **Project → Settings → General**:
   - Framework Preset: **Next.js**; Build Command / Install Command: để mặc định (Vercel đọc `pnpm-lock.yaml` và trường `packageManager`).
   - **Node.js Version**: chọn bản cao nhất có. Repo yêu cầu Node 26 (`.nvmrc`, `engines` trong package.json); nếu Vercel chưa hỗ trợ Node 26 thì build sẽ báo lỗi phiên bản **[CHƯA KIỂM CHỨNG]**: báo lại để agent xử lý (nới `engines` sau khi chạy đủ test trên bản Node Vercel hỗ trợ).
4. **Settings → Functions → Function Region**: **Singapore (sin1)** (vercel.json đã đặt `regions: ["sin1"]`).
5. **Settings → Domains**:
   - Production: dùng tên miền mặc định `<tên-dự-án>.vercel.app` hoặc tên miền công ty (cần quyền DNS). Đây là `APP_URL` của environment **production**.
   - Staging: chọn một tên `*.vercel.app` còn trống, ví dụ `qlda-staging.vercel.app`. **Không** cần thêm ở Domains: CD gắn tên này vào mỗi bản staging bằng `vercel alias set`. Đây là `APP_URL` của environment **staging**.
6. **Settings → Deployment Protection**: mặc định Vercel bật "Vercel Authentication" cho bản Preview (staging), nghĩa là phải đăng nhập Vercel mới xem được staging.
   - Để CD kiểm tra khói được: mục **Protection Bypass for Automation** → tạo mã → lưu vào GitHub Secret `VERCEL_AUTOMATION_BYPASS_SECRET`.
   - Nếu muốn người thử (không có tài khoản Vercel) vào staging: tắt Vercel Authentication cho Preview (khi đó mọi bản Preview công khai, nhưng chỉ CD tạo Preview và staging chỉ có dữ liệu thử).
7. **Account Settings → Tokens → Create Token**: tên `github-cd-qlda`, scope: chỉ team/tài khoản chứa dự án, **Expiration**: 90 ngày hoặc 1 năm (ghi lịch gia hạn) → lưu vào GitHub Secret `VERCEL_TOKEN`.
8. Gói trả phí: bật **Spend Management** (giới hạn chi tiêu, cảnh báo qua email).

## 7. Bước 5: Biến môi trường trên Vercel

Project → Settings → **Environment Variables**. Mỗi biến chọn đúng môi trường: **Preview** = staging, **Production** = production. Không chọn "Development". Biến bí mật bật **Sensitive** (Vercel không cho xem lại giá trị).

Danh sách lấy từ việc quét mã (`grep -rhoE "process\.env\.[A-Z0-9_]+|env\.[A-Z][A-Z0-9_]+" app lib components proxy.ts next.config.ts | sort -u`) ngày 2026-11-18. Chạy lại lệnh này trước mỗi lần phát hành để không sót biến mới.

**Biến ứng dụng cần đặt:**

| Biến | Preview (staging) | Production | Bí mật | Ghi chú |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL dự án staging | URL dự án production | Không | Nhúng vào bundle **khi build**: đổi giá trị phải triển khai lại. Dùng trong CSP (`proxy.ts`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable/anon key staging | Publishable/anon key production | Không | App tự từ chối nếu lỡ dán khóa service_role/secret vào đây (`lib/supabase/env.ts`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret/service_role key staging | Secret/service_role key production | **CÓ** | **Bắt buộc**: đăng nhập fail-closed nếu thiếu (bộ đếm giới hạn tần suất, E0-5), màn quản trị người dùng gọi Auth Admin API |
| `RATE_LIMIT_SECRET` | Chuỗi ngẫu nhiên riêng | Chuỗi ngẫu nhiên **khác** staging | **CÓ** | Khóa HMAC băm IP/email cho bộ đếm. Tạo: `openssl rand -hex 32`. Thiếu thì dùng tạm `SUPABASE_SERVICE_ROLE_KEY` |

**Biến Vercel tự đặt (không tự tạo):** `NODE_ENV=production` (bật HSTS, ẩn `/dev/*`), `VERCEL`, `VERCEL_ENV`, `VERCEL_URL` (app tin header `x-real-ip` của Vercel khi giới hạn tần suất, và tự tắt chế độ nới giới hạn của e2e).

**Biến dự kiến của Story chưa merge** (tên cuối cùng lấy theo mã khi Story merge; chạy lại lệnh quét): gửi email E4-2/E4-3 (ADR-002) như `RESEND_API_KEY` (bí mật), địa chỉ gửi `EMAIL_FROM`, địa chỉ gốc app `APP_BASE_URL` (để tạo link trong email), `CRON_SECRET` (bí mật, bảo vệ endpoint job định kỳ). Chưa có trong mã ở `main` ngày 2026-11-18 nên **chưa đặt**.

**Tuyệt đối không đặt trên Vercel:** `SEED_PASSWORD`, `E2E_RELAXED_LOGIN_RATE_LIMIT`, `E2E_*`, `SUPABASE_URL`/`SUPABASE_ANON_KEY` (chỉ cho test tích hợp), `MAILPIT_URL`, `PERF_*`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` (chỉ cho Supabase cục bộ), chuỗi kết nối CSDL.

## 8. Bước 6: GitHub Environments, Secrets, Variables

Repo `gunzok/quan-ly-du-an-cntt` → **Settings**.

### 8.1 Environments (Settings → Environments)

| Environment | Cấu hình |
|---|---|
| `staging` | **Deployment branches and tags** → Selected → thêm nhánh `main`. Không cần người duyệt |
| `production` | (đã tạo ở Pha 0, người duyệt `gunzok`) **Required reviewers**: `gunzok`; bật **Prevent self-review** nếu có từ 2 người duyệt; **Deployment branches and tags** → Selected → thêm **tag** `v*.*.*` và nhánh `main` (cho job rollback chạy tay) |

### 8.2 Secrets (bí mật, GitHub che giá trị trong log)

| Tên | Đặt ở | Giá trị | Bắt buộc |
|---|---|---|---|
| `VERCEL_TOKEN` | Repository secret (Settings → Secrets and variables → Actions → Secrets) | Token Vercel (Bước 4 mục 7) | Có |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Repository secret | Mã Protection Bypass for Automation (Bước 4 mục 6) | Có nếu bật Deployment Protection |
| `SUPABASE_DB_URL` | **Environment secret** của `staging` và của `production` (giá trị khác nhau) | Chuỗi kết nối Session pooler của dự án tương ứng | Có |
| `SUPABASE_ACCESS_TOKEN` | Environment secret của `production` (và `staging` nếu muốn) | Supabase → Account → Access Tokens → Generate (đặt hạn dùng) | Chỉ khi `BACKUP_STRATEGY=supabase` |

### 8.3 Variables (không bí mật, Settings → Secrets and variables → Actions → Variables)

| Tên | Đặt ở | Giá trị |
|---|---|---|
| `VERCEL_ORG_ID` | Repository variable | `orgId` trong `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Repository variable | `projectId` trong `.vercel/project.json` |
| `APP_URL` | Environment variable của `staging` và `production` | staging: `https://qlda-staging.vercel.app`; production: tên miền production. Bắt đầu bằng `https://`, không `/` cuối |
| `NEXT_PUBLIC_SUPABASE_URL` | Environment variable (`staging`, `production`) | URL dự án Supabase tương ứng (CD dùng để kiểm tra khói: bản triển khai phải trỏ đúng dự án) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Environment variable (`staging`, `production`) | Publishable/anon key tương ứng (công khai; kiểm tra khói gọi `/auth/v1/health`) |
| `SUPABASE_PROJECT_REF` | Environment variable (`staging`, `production`) | Project ref (chỉ cần khi `BACKUP_STRATEGY=supabase`) |
| `BACKUP_STRATEGY` | Environment variable của `production` (bắt buộc), `staging` (tùy chọn) | `supabase` (gói Pro: CD kiểm có bản sao lưu dưới 26 giờ) hoặc `manual` (gói Free: người duyệt tự sao lưu trước khi duyệt, xem [migration-va-sao-luu.md](migration-va-sao-luu.md)) |
| `DEPLOY_STAGING_ENABLED` | Repository variable | `true` **sau cùng**, khi mọi thứ ở trên đã đặt cho staging |
| `DEPLOY_PRODUCTION_ENABLED` | Repository variable | `true` khi production đã sẵn sàng ([checklist](#13-checklist-sẵn-sàng)) |

Bật thêm (Settings → Code security): **Secret scanning** và **Push protection** (PROJECT_STATE: việc E0-5 chưa làm).

## 9. Bước 7: Triển khai staging lần đầu

1. Đặt `DEPLOY_STAGING_ENABLED=true`.
2. **Actions → CD → Run workflow** → nhánh `main`, target `staging` → Run. (Hoặc chờ lần merge tiếp theo.)
3. Theo dõi job `deploy-staging`:
   - "Xem trước migration": lần đầu sẽ liệt kê **toàn bộ** migration trong `supabase/migrations/`.
   - "Áp migration": tạo bảng, RLS, bucket Storage `report-templates`.
   - "Triển khai Vercel": in URL bản triển khai, gắn tên miền staging.
   - "Kiểm tra khói": bảng kết quả ở trang tóm tắt của lượt chạy.
4. Đỏ thì đọc thông báo lỗi (thường là thiếu/sai biến) → sửa → **Re-run failed jobs**.
5. Vào `APP_URL` của staging → trang đăng nhập hiện ra. Tạo Admin staging theo [Bước 8](#10-bước-8-tài-khoản-admin-đầu-tiên) để thử.

## 10. Bước 8: Tài khoản Admin đầu tiên

Không có mật khẩu nào trong repo. Admin đầu tiên được **mời qua email** rồi tự đặt mật khẩu; quyền Admin bật bằng một câu SQL trong Dashboard. Làm cho staging (để thử) và production.

1. Supabase Dashboard (đúng dự án) → **Authentication → Users → Add user → Send invitation** → nhập email công ty của người làm Admin.
2. Người đó mở email "Lời mời vào Quản lý Dự án CNTT" → bấm link → trang `/auth/accept-invite` → đặt mật khẩu **ít nhất 12 ký tự** (dùng trình quản lý mật khẩu).
   - Không nhận được email: kiểm thư rác; SMTP mặc định của Supabase giới hạn rất chặt, chờ rồi gửi lại, hoặc cấu hình SMTP Resend (Bước 2).
3. Dashboard → **SQL Editor** → New query → dán, **thay email** rồi Run:
   ```sql
   -- Bật quyền Admin cho đúng một tài khoản đã nhận lời mời.
   update public.profiles
   set is_admin = true
   where id = (select id from auth.users where email = 'email-cua-admin@cong-ty.vn')
   returning id, is_admin;
   ```
   Kết quả phải trả **đúng 1 dòng** `is_admin = true`. 0 dòng: email sai hoặc người đó chưa nhận lời mời.
4. Đăng nhập `APP_URL` bằng tài khoản này → menu Quản trị xuất hiện. Từ đây Admin mời người khác **trong ứng dụng** (màn Quản trị người dùng), không cần Dashboard nữa.

Không dùng `make db-seed` hay `SEED_PASSWORD` cho môi trường thật.

## 11. Bước 9: Phát hành production

Điều kiện: [checklist sẵn sàng production](#13-checklist-sẵn-sàng) đã đủ, `DEPLOY_PRODUCTION_ENABLED=true`.

1. Chọn commit trên `main` đã có trạng thái **cd/staging** xanh (dấu ✓ cạnh commit trên GitHub → "cd/staging"). Thường là commit mới nhất của `main` sau khi CD staging xong.
2. Thử nhanh trên staging các luồng chính (đăng nhập, tạo dự án, tạo task, Kanban, xuất báo cáo nếu có).
3. Gắn tag trên máy:
   ```bash
   git checkout main && git pull
   git tag -a v0.1.0 -m "Phát hành v0.1.0"
   git push origin v0.1.0
   ```
4. Actions → CD → lượt chạy của tag: job `plan` kiểm 3 chốt (commit thuộc `main`, `ci-gate` xanh, `cd/staging` xanh). Đỏ ở đây nghĩa là commit chưa đủ điều kiện, production không bị đụng tới.
5. Nếu `BACKUP_STRATEGY=manual`: **trước khi duyệt**, chạy `make db-backup DEPLOY_ENV=production` trên máy ([migration-va-sao-luu.md](migration-va-sao-luu.md)).
6. Job `deploy-production` hiện **Waiting for review** → người duyệt (`gunzok`) bấm **Review deployments → Approve**.
7. Theo dõi: xem trước migration → kiểm sao lưu → áp migration → Vercel `--prod` → kiểm tra khói. Xanh là xong; đỏ thì làm theo hướng dẫn trong trang tóm tắt của lượt chạy và [mục 12](#12-quay-lại-bản-trước-rollback).

## 12. Quay lại bản trước (rollback)

**Ứng dụng (Vercel)**, chọn một trong hai:

- **Qua GitHub (có duyệt, có kiểm tra khói):** Actions → CD → Run workflow → nhánh `main`, target **rollback-production**, `rollback_to` để trống (quay về bản production ngay trước) hoặc dán URL/id (`dpl_...`) của bản muốn quay về → Run → duyệt.
- **Qua Vercel Dashboard (nhanh nhất khi khẩn cấp):** Project → Deployments → chọn bản production đang chạy tốt trước đó → menu `⋯` → **Instant Rollback** (gói Hobby có thể chỉ quay về được bản ngay trước **[CHƯA KIỂM CHỨNG]**).

Sau khi rollback, Vercel **tắt tự gán tên miền** cho bản production mới; lần phát hành sau cần bật lại (Dashboard → Deployments → "Undo Rollback"/Promote) **[CHƯA KIỂM CHỨNG]**: kiểm tên miền trỏ đúng bản mới sau khi phát hành.

**CSDL (Supabase):** migration **không tự quay lại**. Thứ tự xử lý:

1. Nếu bản app cũ vẫn chạy được với lược đồ mới (migration tương thích ngược, xem quy tắc ở [migration-va-sao-luu.md](migration-va-sao-luu.md)): chỉ rollback app, sửa lỗi bằng migration mới.
2. Nếu dữ liệu hỏng: khôi phục từ bản sao lưu theo mục "Khôi phục" của [migration-va-sao-luu.md](migration-va-sao-luu.md).
3. Ghi sự cố (thời điểm, ảnh hưởng, cách xử lý) vào PROJECT_STATE.md.

**Staging** không cần rollback: merge bản sửa, CD triển khai lại; hoặc Run workflow target `staging`.

## 13. Checklist sẵn sàng

### Sẵn sàng staging

- [ ] Sếp đã chọn phương án chi phí ([mục 2](#2-quyết-định-trước-chi-phí-và-gói-dịch-vụ)) và đối chiếu giá chính thức.
- [ ] Dự án Supabase `qlda-staging` (Singapore), mật khẩu CSDL trong trình quản lý mật khẩu.
- [ ] Auth staging: Site URL, Redirect URLs, tắt đăng ký, mật khẩu tối thiểu 12, thời hạn link mời, mẫu Invite user ([Bước 2](#4-bước-2-cấu-hình-đăng-nhập-supabase-auth)).
- [ ] (Tùy chọn) Google OAuth client staging ([Bước 3](#5-bước-3-đăng-nhập-google-oauth)).
- [ ] Dự án Vercel không kết nối Git, vùng `sin1`, Node.js version phù hợp, bypass secret ([Bước 4](#6-bước-4-tạo-dự-án-vercel)).
- [ ] Biến môi trường **Preview** trên Vercel: 4 biến ứng dụng ([Bước 5](#7-bước-5-biến-môi-trường-trên-vercel)).
- [ ] GitHub: environment `staging` giới hạn nhánh `main`; secrets `VERCEL_TOKEN`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `SUPABASE_DB_URL` (staging); variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (staging).
- [ ] `DEPLOY_STAGING_ENABLED=true`, chạy CD target `staging` xanh, kiểm tra khói xanh.
- [ ] Admin staging tạo được, đăng nhập được, mời được người dùng thử (email đến nơi).

### Sẵn sàng production

- [ ] Mọi mục "Sẵn sàng staging" đã xong và staging chạy ổn ít nhất vài ngày.
- [ ] Sếp duyệt chi phí bằng văn bản (đặc biệt nếu trên 25 USD), bật giới hạn chi tiêu.
- [ ] Sếp xác nhận RPO/RTO (NFR-05) và chiến lược sao lưu (`BACKUP_STRATEGY`), đã thử khôi phục một lần trên staging hoặc cục bộ ([migration-va-sao-luu.md](migration-va-sao-luu.md)).
- [ ] Dự án Supabase `qlda-production` (Singapore); Auth production cấu hình giống staging với `APP_URL` production.
- [ ] SMTP Resend với tên miền công ty đã xác minh SPF/DKIM (ADR-002), hoặc chấp nhận SMTP mặc định cho giai đoạn đầu.
- [ ] Google OAuth client production (nếu dùng đăng nhập Google).
- [ ] Biến môi trường **Production** trên Vercel (giá trị production, `RATE_LIMIT_SECRET` khác staging).
- [ ] GitHub environment `production`: người duyệt `gunzok`, chỉ tag `v*.*.*` và `main`; secret `SUPABASE_DB_URL` (production); variables `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `BACKUP_STRATEGY` (+ `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` nếu `supabase`).
- [ ] Đã chọn công cụ giám sát tối thiểu ([giam-sat.md](giam-sat.md)) để biết khi app ngừng.
- [ ] Rà dữ liệu cá nhân theo NFR-14 (tên, email, số điện thoại) trước khi nhập dữ liệu thật.
- [ ] `DEPLOY_PRODUCTION_ENABLED=true`; phát hành `v0.1.0` theo [Bước 9](#11-bước-9-phát-hành-production); tạo Admin production ([Bước 8](#10-bước-8-tài-khoản-admin-đầu-tiên)).
- [ ] Ghi lịch: gia hạn `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`; sao lưu tay định kỳ nếu `manual`.

## 14. Kiểm tra cục bộ và tham chiếu kỹ thuật

| Lệnh | Việc |
|---|---|
| `make deploy-smoke URL=http://127.0.0.1:3100` | Kiểm tra khói một bản đang chạy (cục bộ hoặc đã triển khai). Cần bản build production (`pnpm build && pnpm start`): bản `pnpm dev` sẽ đỏ đúng ý (CSP dev có `unsafe-eval`, `/dev/ui` mở). Thêm `SMOKE_SUPABASE_URL`, `SMOKE_SUPABASE_ANON_KEY` để kiểm Supabase đầy đủ |
| `make check-migrations` | Kiểm quy tắc migration so với `origin/main` (CI chạy trên mỗi PR) |
| `make lint-workflows` | Kiểm cú pháp workflow bằng actionlint (CI chạy trong job lint) |
| `make db-backup DEPLOY_ENV=production` | Sao lưu tay CSDL thật về máy (ngoài repo) |

Kiểm tra khói ([`scripts/deploy/smoke.ts`](../../scripts/deploy/smoke.ts)) không cần đăng nhập hay khóa nhạy cảm:

1. `GET /login`: 200, CSP có nonce và `'strict-dynamic'`, không `'unsafe-eval'`/`'unsafe-inline'` cho script, mọi thẻ `<script>` mang đúng nonce, đủ header an toàn (HSTS khi https), không `X-Powered-By`.
2. `GET /api/v1/me` không cookie: 401 `unauthenticated`.
3. `GET /dev/ui`: 404.
4. `GET /` không cookie: chuyển hướng về `/login`.
5. Origin Supabase trong CSP `connect-src` khớp `NEXT_PUBLIC_SUPABASE_URL` mong đợi (phát hiện Vercel trỏ nhầm dự án), không trỏ máy cục bộ; `GET <supabase>/auth/v1/health` trả 200 với khóa anon (dự án không tạm dừng).

Không thêm endpoint `/api/health` vào ứng dụng: các kiểm tra trên đã chứng minh app chạy, proxy và cổng đăng nhập hoạt động, biến Supabase đúng dự án và Supabase sống, mà không phải đổi mã sản phẩm.

Phiên bản công cụ ghim trong `cd.yml`: Vercel CLI `65.9.0`, Supabase CLI `3.1.0` (cùng CI), actionlint `1.7.12` (ci.yml, kiểm SHA-256). Nâng phiên bản có chủ đích, đọc changelog trước.

## 15. Điều chưa kiểm chứng

Các điểm sau chỉ kiểm được khi có tài khoản thật; lần chạy CD đầu tiên cần người theo dõi:

- Cú pháp lệnh Vercel CLI 65.9.0 trên dự án thật: `vercel deploy --archive=tgz --meta`, `vercel alias set --scope`, `vercel rollback`; Vercel đọc `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` từ biến môi trường thay cho thư mục `.vercel`.
- Vercel hỗ trợ Node 26 hay chưa (repo yêu cầu `>=26 <27`).
- `supabase db push --remote=<chuỗi kết nối> --skip-vault --yes` và `--dry-run` trên dự án thật qua Session pooler; định dạng JSON của `supabase backups list -o json` (bộ đọc ở `scripts/deploy/backup-check.ts` theo tài liệu Management API).
- `scripts/deploy/backup.sh` với dự án thật (`supabase db dump --remote=<url>`), thời gian dump và khôi phục.
- Deployment Protection và mã bypass với tên miền staging gắn bằng alias.
- Hành vi tên miền production sau Instant Rollback.
- Gửi email mời qua SMTP mặc định của Supabase; Google OAuth với client thật.
- Giá và giới hạn gói (R-008).
