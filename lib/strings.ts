/**
 * Mọi chuỗi giao diện tập trung ở đây (tiếng Việt).
 * Story E10-2 sẽ chuyển file này sang thư viện i18n (vi, en); không gõ cứng chuỗi trong component.
 */
export const strings = {
  app: {
    name: "Quản lý Dự án CNTT",
    logoLetters: "QL",
    description: "Ứng dụng quản lý dự án CNTT nội bộ",
  },
  language: {
    groupLabel: "Ngôn ngữ",
    viShort: "VI",
    vi: "Tiếng Việt",
    enShort: "EN",
    en: "English (sắp có)",
    comingSoon: "Sắp có",
  },
  brand: {
    eyebrow: "Hệ thống nội bộ",
    title: "Quản lý dự án CNTT",
    features: [
      { label: "01 / Lập kế hoạch", text: "Dự án, task, Gantt" },
      { label: "02 / Theo dõi", text: "Kanban, danh sách, dashboard" },
      { label: "03 / Báo cáo", text: "Xuất Excel, Word theo mẫu" },
    ],
  },
  login: {
    pageTitle: "Đăng nhập",
    eyebrow: "01 / Đăng nhập",
    heading: "Chào mừng trở lại",
    subtitle: "Dùng tài khoản được Admin mời vào hệ thống.",
    emailLabel: "Email",
    passwordLabel: "Mật khẩu",
    submit: "Đăng nhập",
    submitting: "Đang đăng nhập…",
    divider: "hoặc",
    google: "Tiếp tục với Google",
    googleRedirecting: "Đang chuyển tới Google…",
    googleHint: "Dùng tài khoản Google có email đã được Admin mời.",
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
    oauth: {
      not_invited:
        "Tài khoản Google này chưa được mời vào hệ thống. Liên hệ Admin để được mời.",
      rate_limited: "Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.",
      oauth_failed:
        "Không thể đăng nhập bằng Google (lỗi hoặc đã hủy). Vui lòng thử lại.",
    },
    field: {
      required: "Trường này là bắt buộc.",
      invalid_format: "Email không đúng định dạng.",
      too_long: "Giá trị quá dài.",
      invalid_value: "Giá trị không hợp lệ.",
      unknown_field: "Trường không được hỗ trợ.",
    },
  },
  api: {
    validationFailed: "Dữ liệu không hợp lệ.",
    unauthenticated: "Bạn chưa đăng nhập hoặc phiên đã hết hạn.",
    forbidden: "Bạn không có quyền thực hiện thao tác này.",
    notFound: "Không tìm thấy.",
    internal: "Có lỗi hệ thống. Vui lòng thử lại sau.",
  },
  tasks: {
    errors: {
      dateOrder: "Ngày kết thúc không được sớm hơn ngày bắt đầu.",
      assigneeNotMember:
        "Người được giao phải là PM hoặc Thành viên đang hoạt động của dự án.",
      forbiddenEdit: "Bạn chỉ sửa được task mình phụ trách hoặc do mình tạo.",
      forbiddenDelete: "Bạn chỉ xóa được task do mình tạo.",
      forbiddenCreate: "Người xem không tạo được task.",
    },
  },
} as const;
