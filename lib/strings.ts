/**
 * Mọi chuỗi giao diện tập trung ở đây (tiếng Việt).
 * Story E10-2 sẽ chuyển file này sang thư viện i18n (vi, en); không gõ cứng chuỗi trong component.
 */
export const strings = {
  app: {
    name: "Quản lý Dự án CNTT",
    logoLetter: "Q",
    description: "Ứng dụng quản lý dự án CNTT nội bộ",
  },
  language: {
    groupLabel: "Ngôn ngữ",
    vi: "Tiếng Việt",
    en: "English",
    comingSoon: "Sắp có",
  },
  login: {
    pageTitle: "Đăng nhập",
    heading: "Đăng nhập",
    subtitle: "Dùng tài khoản được Admin mời vào hệ thống.",
    emailLabel: "Email",
    passwordLabel: "Mật khẩu",
    submit: "Đăng nhập",
    submitting: "Đang đăng nhập…",
    divider: "hoặc",
    google: "Tiếp tục với Google",
    googleComingSoon: "Đăng nhập Google sắp có.",
    inviteOnly: "Chưa có tài khoản? Liên hệ Admin để được mời.",
  },
  home: {
    signedInAs: "Đang đăng nhập:",
    placeholder:
      "Trang giữ chỗ. Các tính năng sẽ được bổ sung theo từng Story.",
    signOut: "Đăng xuất",
    loading: "Đang tải…",
  },
  errors: {
    validationFailed: "Vui lòng kiểm tra lại thông tin đã nhập.",
    invalidCredentials: "Email hoặc mật khẩu không đúng.",
    rateLimited: "Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.",
    internal: "Không thể đăng nhập lúc này. Vui lòng thử lại sau.",
    unauthenticated: "Bạn chưa đăng nhập hoặc phiên đã hết hạn.",
    field: {
      required: "Trường này là bắt buộc.",
      invalid_format: "Email không đúng định dạng.",
      too_long: "Giá trị quá dài.",
    },
  },
} as const;
