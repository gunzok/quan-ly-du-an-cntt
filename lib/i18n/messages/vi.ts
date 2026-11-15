/**
 * Từ điển tiếng Việt: ngôn ngữ GỐC của giao diện (Story E10-2). Mọi chuỗi hiển thị đặt ở đây;
 * en.ts phải có đúng cùng tập khóa (kiểu `Messages` bắt lỗi thiếu/thừa khóa lúc biên dịch,
 * lib/i18n/messages.test.ts kiểm lại lúc chạy).
 *
 * Hàm (ví dụ `(n: number) => ...`) dùng cho chuỗi có tham số; bản en giữ đúng chữ ký.
 * Thông điệp lỗi API vẫn trả tiếng Việt cho khách API (`message`) kèm `message_key` là đường dẫn
 * khóa trong từ điển này để giao diện dịch (lib/i18n/message-key.ts).
 */
const viMessages = {
  app: {
    name: "Quản lý Dự án CNTT",
    logoLetters: "QL",
    description: "Ứng dụng quản lý dự án CNTT nội bộ",
  },
  /** Bộ chọn ngôn ngữ (Story E10-2). Tên ngôn ngữ viết bằng chính ngôn ngữ đó ở cả hai từ điển. */
  language: {
    groupLabel: "Ngôn ngữ",
    viShort: "VI",
    vi: "Tiếng Việt",
    enShort: "EN",
    en: "English",
    changing: "Đang đổi ngôn ngữ…",
    changeFailed: "Không đổi được ngôn ngữ. Vui lòng thử lại.",
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
    adminUsers: "Quản trị người dùng",
    loading: "Đang tải…",
  },
  /** Chuỗi của bộ component nền (components/ui/, Story E10-1). */
  ui: {
    loading: "Đang tải…",
    close: "Đóng",
    cancel: "Hủy",
    toast: {
      region: "Thông báo",
      dismiss: "Đóng thông báo",
    },
    status: {
      todo: "Cần làm",
      in_progress: "Đang làm",
      done: "Hoàn thành",
      blocked: "Bị chặn",
      overdue: "Trễ hạn",
    },
    priority: {
      low: "Thấp",
      medium: "Trung bình",
      high: "Cao",
      urgent: "Khẩn cấp",
    },
    badgeNew: "Mới",
  },
  /** Trang xem thử component, chỉ có ở môi trường phát triển (/dev/ui). */
  devUi: {
    pageTitle: "Bộ component nền",
    eyebrow: "Design system / Blueprint · Chỉ môi trường phát triển",
    intro:
      "Trang kiểm tra nhanh trạng thái, focus và tương phản của component nền ở chế độ sáng và tối.",
    themeLabel: "Chế độ hiển thị",
    themeSystem: "Theo hệ thống",
    themeLight: "Sáng",
    themeDark: "Tối",
    sections: {
      buttons: "01 / Nút",
      fields: "02 / Ô nhập",
      choices: "03 / Lựa chọn",
      badges: "04 / Huy hiệu",
      avatars: "05 / Ảnh đại diện",
      feedback: "06 / Phản hồi",
      tabs: "07 / Tab",
      empty: "08 / Trạng thái rỗng",
    },
    sample: {
      primary: "Tạo task",
      secondary: "Xuất báo cáo",
      danger: "Xóa vĩnh viễn",
      text: "Xem tất cả",
      saving: "Đang lưu…",
      disabled: "Không khả dụng",
      nameLabel: "Tên dự án",
      namePlaceholder: "Ví dụ: Cổng thông tin nội bộ",
      nameHint: "Tối đa 120 ký tự.",
      codeLabel: "Mã dự án",
      codeError: "Mã dự án đã tồn tại.",
      disabledLabel: "Phòng ban",
      disabledValue: "Khối Công nghệ",
      descriptionLabel: "Mô tả",
      selectLabel: "Mức ưu tiên",
      selectPlaceholder: "Chọn mức ưu tiên",
      checkboxLabel: "Nhận email thông báo",
      checkboxCheckedLabel: "Hiện task đã xong",
      checkboxDisabledLabel: "Chỉ Admin được đổi",
      switchLabel: "Thông báo đẩy",
      switchCheckedLabel: "Chế độ gọn",
      switchDisabledLabel: "Đồng bộ lịch (sắp có)",
      label: "Nhãn",
      avatarPeople: ["Nguyễn Văn An", "Trần Thị Bình", "Lê Minh", "Phạm Hà"],
      avatarGroupLabel: "Thành viên dự án",
      openDialog: "Xóa dự án…",
      dialogTitle: "Xóa vĩnh viễn dự án này?",
      dialogDescription:
        "Toàn bộ task, bình luận và tệp đính kèm sẽ bị xóa và không khôi phục được.",
      dialogConfirm: "Xóa vĩnh viễn",
      dialogDone: "Đã xóa dự án (mô phỏng).",
      toastSuccess: "Hiện thông báo thành công",
      toastError: "Hiện thông báo lỗi",
      toastWarning: "Hiện thông báo cảnh báo",
      toastSuccessText: "Đã lưu thay đổi.",
      toastErrorText: "Không lưu được. Vui lòng thử lại.",
      toastWarningText: "Task sắp đến hạn trong 24 giờ.",
      skeletonLabel: "Đang tải danh sách task",
      tabOverview: "Tổng quan",
      tabTasks: "Task",
      tabMembers: "Thành viên",
      tabOverviewText: "Tóm tắt tiến độ dự án.",
      tabTasksText: "Danh sách task của dự án.",
      tabMembersText: "Thành viên và vai trò.",
      emptyTitle: "Chưa có task nào",
      emptyDescription: "Tạo task đầu tiên để bắt đầu theo dõi tiến độ dự án.",
      emptyAction: "Tạo task",
    },
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
  adminUsers: {
    pageTitle: "Người dùng",
    eyebrow: "Quản trị",
    eyebrowCount: (n: number) =>
      `Quản trị / ${String(n).padStart(2, "0")} người dùng`,
    heading: "Người dùng",
    intro:
      "Mời người dùng, gán phòng ban, cấp quyền Admin, khóa hoặc mở tài khoản. Vai trò trong dự án gán ở trang Thành viên của từng dự án.",
    navLabel: "Điều hướng quản trị",
    navSection: "Quản trị",
    navUsers: "Người dùng",
    navHome: "Trang chủ",
    adminBadge: "Admin",
    searchLabel: "Tìm theo tên hoặc email",
    searchPlaceholder: "Tìm theo tên hoặc email…",
    tableCaption: "Danh sách người dùng",
    columns: {
      user: "Người dùng",
      department: "Phòng ban",
      admin: "Quyền Admin",
      projects: "Dự án tham gia",
      status: "Trạng thái",
      lastSignIn: "Đăng nhập gần nhất",
      actions: "Thao tác",
    },
    noDepartment: "Chưa gán",
    departmentFilterLabel: "Phòng ban",
    departmentFilterAll: "Tất cả",
    departmentFilterNone: "Chưa gán phòng ban",
    archivedSuffix: " (đã lưu trữ)",
    emptyFilter: "Không có người dùng nào thuộc phòng ban đã chọn.",
    changeDepartment: "Đổi",
    changeDepartmentAction: (name: string) => `Đổi phòng ban của ${name}`,
    manageDepartments: "Quản lý phòng ban",
    assign: {
      title: (name: string) => `Đổi phòng ban của ${name}`,
      description:
        "Phòng ban đã lưu trữ không gán mới được; người đang thuộc phòng đó vẫn giữ.",
      label: "Phòng ban",
      none: "Chưa gán",
      submit: "Lưu",
      submitting: "Đang lưu…",
      cancel: "Hủy",
    },
    noName: "(Chưa có tên)",
    adminYes: "Admin",
    adminNo: "Không",
    projectsAll: "Tất cả",
    projectsNone: "Chưa tham gia",
    projectsCount: (n: number, pm: number) =>
      pm > 0 ? `${n} dự án (PM ở ${pm})` : `${n} dự án`,
    status: {
      active: "Hoạt động",
      locked: "Đã khóa",
      invited: "Chờ nhận lời mời",
    },
    lastSignInNever: "Chưa đăng nhập",
    lastSignInToday: (time: string) => `Hôm nay ${time}`,
    lastSignInYesterday: (time: string) => `Hôm qua ${time}`,
    you: "(bạn)",
    lock: "Khóa",
    unlock: "Mở khóa",
    grantAdmin: "Cấp Admin",
    revokeAdmin: "Thu quyền Admin",
    selfActionHint: "Bạn không thể tự khóa hoặc tự thu quyền Admin của mình.",
    rowActionsLabel: (name: string) => `Thao tác với ${name}`,
    loading: "Đang tải danh sách người dùng…",
    loadMore: "Tải thêm",
    loadingMore: "Đang tải thêm…",
    empty: "Chưa có người dùng nào. Bấm “Mời người dùng” để bắt đầu.",
    emptySearch: (q: string) => `Không có người dùng nào khớp “${q}”.`,
    loadError: "Không tải được danh sách người dùng.",
    retry: "Thử lại",
    invite: {
      open: "Mời người dùng",
      title: "Mời người dùng",
      description:
        "Hệ thống gửi email mời. Tài khoản ở trạng thái chờ cho tới khi người đó nhận lời mời.",
      emailLabel: "Email",
      nameLabel: "Họ tên (tùy chọn)",
      departmentLabel: "Phòng ban (tùy chọn)",
      departmentNone: "Chưa gán",
      submit: "Gửi lời mời",
      submitting: "Đang gửi…",
      cancel: "Hủy",
      success: (email: string) => `Đã gửi lời mời tới ${email}.`,
    },
    confirm: {
      cancel: "Hủy",
      lockTitle: (name: string) => `Khóa tài khoản ${name}?`,
      lockBody:
        "Người này bị đăng xuất và không đăng nhập được nữa. Dữ liệu và lịch sử vẫn giữ nguyên.",
      unlockTitle: (name: string) => `Mở khóa tài khoản ${name}?`,
      unlockBody:
        "Người này đăng nhập lại được với quyền như trước khi bị khóa.",
      grantTitle: (name: string) => `Cấp quyền Admin cho ${name}?`,
      grantBody:
        "Admin xem và quản trị toàn bộ hệ thống, kể cả người dùng và mọi dự án.",
      revokeTitle: (name: string) => `Thu quyền Admin của ${name}?`,
      revokeBody: "Người này chỉ còn quyền theo vai trò trong từng dự án.",
      working: "Đang xử lý…",
    },
    done: {
      locked: (name: string) => `Đã khóa tài khoản ${name}.`,
      unlocked: (name: string) => `Đã mở khóa tài khoản ${name}.`,
      granted: (name: string) => `Đã cấp quyền Admin cho ${name}.`,
      revoked: (name: string) => `Đã thu quyền Admin của ${name}.`,
      departmentChanged: (name: string, department: string) =>
        `Đã chuyển ${name} sang ${department}.`,
    },
    errors: {
      emailExists: "Email này đã có tài khoản trong hệ thống.",
      departmentNotFound: "Phòng ban không tồn tại.",
      departmentArchived:
        "Phòng ban đã lưu trữ, không gán mới được. Chọn phòng ban khác hoặc dùng lại phòng ban này.",
      selfLock: "Bạn không thể tự khóa tài khoản của mình.",
      selfRevokeAdmin: "Bạn không thể tự thu quyền Admin của mình.",
      lastAdmin: "Không thể khóa hoặc thu quyền Admin cuối cùng của hệ thống.",
      notAdminAnymore: "Bạn không còn quyền Admin.",
      authSyncFailed:
        "Đã lưu thay đổi nhưng chưa cập nhật được trạng thái đăng nhập. Vui lòng thử lại thao tác.",
      network: "Không kết nối được máy chủ. Vui lòng thử lại.",
    },
  },
  departments: {
    title: "Danh mục phòng ban",
    description:
      "Thêm, đổi tên hoặc lưu trữ phòng ban. Phòng ban không xóa được; lưu trữ để ẩn khỏi danh sách chọn, người đang thuộc vẫn giữ.",
    addLabel: "Tên phòng ban mới",
    add: "Thêm",
    adding: "Đang thêm…",
    listLabel: "Phòng ban hiện có",
    empty: "Chưa có phòng ban nào.",
    archivedBadge: "Đã lưu trữ",
    rename: "Đổi tên",
    renameLabel: (name: string) => `Tên mới cho ${name}`,
    renameAction: (name: string) => `Đổi tên ${name}`,
    save: "Lưu",
    saving: "Đang lưu…",
    cancel: "Hủy",
    archive: "Lưu trữ",
    archiveAction: (name: string) => `Lưu trữ ${name}`,
    restore: "Dùng lại",
    restoreAction: (name: string) => `Dùng lại ${name}`,
    close: "Đóng",
    done: {
      added: (name: string) => `Đã thêm phòng ban ${name}.`,
      renamed: (name: string) => `Đã đổi tên thành ${name}.`,
      archived: (name: string) => `Đã lưu trữ phòng ban ${name}.`,
      restored: (name: string) => `Đã dùng lại phòng ban ${name}.`,
    },
    errors: {
      nameExists: "Đã có phòng ban trùng tên (không phân biệt hoa thường).",
    },
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
  /** Story E2-4 (QLDA-42): việc con tối đa 3 cấp và quy tắc đóng task cha (BR-04). */
  subtasks: {
    errors: {
      parentNotFound: "Task cha không tồn tại trong dự án này.",
      parentNotEditable: "Bạn chỉ gắn việc con vào task mình sửa được.",
      depthExceeded: "Chỉ chia việc con tối đa 3 cấp.",
      cycle:
        "Không thể chọn chính task này hoặc một việc con của nó làm task cha.",
      openSubtasks:
        "Còn việc con chưa xong. Hoàn thành hoặc đóng mọi việc con trước khi đóng task cha.",
      statusChangeBlocked:
        "Không thực hiện được: một task cha sẽ chuyển sang nhóm hoàn thành trong khi còn việc con chưa xong.",
      concurrentChange: "Dữ liệu vừa thay đổi. Vui lòng thử lại.",
    },
  },
  /** Story E2-1 (QLDA-37): API dự án và màn S02 Danh sách dự án. */
  projects: {
    pageTitle: "Dự án",
    eyebrow: "Danh mục",
    navLabel: "Điều hướng chính",
    navProjects: "Dự án",
    navAdminSection: "Quản trị",
    navUsers: "Người dùng",
    eyebrowActive: (n: number) =>
      `Danh mục / ${String(n).padStart(2, "0")} dự án đang hoạt động`,
    create: "Tạo dự án",
    tabsLabel: "Trạng thái dự án",
    tabActive: (n: number | null) =>
      n === null ? "Đang hoạt động" : `Đang hoạt động (${n})`,
    tabArchived: (n: number | null) =>
      n === null ? "Lưu trữ" : `Lưu trữ (${n})`,
    searchLabel: "Lọc theo tên dự án",
    searchPlaceholder: "Lọc theo tên dự án…",
    listLabel: "Danh sách dự án",
    loading: "Đang tải danh sách dự án",
    loadMore: "Tải thêm",
    retry: "Thử lại",
    loadError: "Không tải được danh sách dự án.",
    emptyActiveTitle: "Chưa có dự án",
    emptyActiveCanCreate: "Tạo dự án đầu tiên để bắt đầu theo dõi tiến độ.",
    emptyActiveNoCreate:
      "Bạn chưa thuộc dự án nào. Hãy nhờ PM hoặc Admin thêm bạn vào dự án.",
    emptyArchivedTitle: "Chưa có dự án lưu trữ",
    emptyArchivedBody: "Dự án được lưu trữ sẽ hiện ở đây.",
    emptySearchTitle: "Không có dự án khớp",
    emptySearchBody: (q: string) => `Không có dự án nào có tên chứa “${q}”.`,
    createFirst: "Tạo dự án đầu tiên",
    card: {
      eyebrow: "Dự án",
      archived: "Lưu trữ",
      progress: "Tiến độ",
      progressOf: (name: string) => `Tiến độ ${name}`,
      tasks: "Task",
      overdue: "Trễ hạn",
      overdueNone: "Không",
      due: "Hạn",
      dueNone: "Chưa đặt",
      members: (n: number) => `${n} thành viên`,
      membersLabel: (name: string) => `Thành viên dự án ${name}`,
      actionsLabel: (name: string) => `Thao tác với dự án ${name}`,
      edit: "Sửa",
      editAction: (name: string) => `Sửa dự án ${name}`,
      archive: "Lưu trữ",
      archiveAction: (name: string) => `Lưu trữ dự án ${name}`,
      restore: "Khôi phục",
      restoreAction: (name: string) => `Khôi phục dự án ${name}`,
      delete: "Xóa vĩnh viễn",
      deleteAction: (name: string) => `Xóa vĩnh viễn dự án ${name}`,
      unnamedMember: "Thành viên",
    },
    roles: {
      admin: "Admin",
      pm: "PM",
      member: "Thành viên",
      viewer: "Người xem",
    },
    form: {
      createEyebrow: "Dự án / Mới",
      createTitle: "Tạo dự án",
      editEyebrow: "Dự án / Sửa",
      editTitle: "Sửa dự án",
      description: "Người tạo trở thành PM của dự án.",
      editDescription: "Đổi tên, mô tả và thời gian của dự án.",
      name: "Tên dự án",
      descriptionLabel: "Mô tả",
      descriptionHint: "Không bắt buộc.",
      startDate: "Ngày bắt đầu",
      endDate: "Ngày kết thúc",
      submitCreate: "Tạo dự án",
      submitEdit: "Lưu thay đổi",
      saving: "Đang lưu…",
      nameRequired: "Nhập tên dự án.",
      nameTooLong: "Tên dự án tối đa 200 ký tự.",
      descriptionTooLong: "Mô tả tối đa 5000 ký tự.",
      invalidDate: "Ngày không hợp lệ.",
    },
    confirm: {
      archiveTitle: (name: string) => `Lưu trữ dự án “${name}”?`,
      archiveBody:
        "Dự án chuyển sang tab Lưu trữ. Dữ liệu được giữ nguyên và có thể khôi phục.",
      restoreTitle: (name: string) => `Khôi phục dự án “${name}”?`,
      restoreBody: "Dự án quay lại danh sách đang hoạt động.",
      deleteTitle: (name: string) => `Xóa vĩnh viễn dự án “${name}”?`,
      deleteBody:
        "Mọi task và thành viên của dự án bị xóa theo. Không hoàn tác được.",
    },
    done: {
      created: (name: string) => `Đã tạo dự án “${name}”.`,
      updated: (name: string) => `Đã lưu dự án “${name}”.`,
      archived: (name: string) => `Đã lưu trữ dự án “${name}”.`,
      restored: (name: string) => `Đã khôi phục dự án “${name}”.`,
      deleted: (name: string) => `Đã xóa vĩnh viễn dự án “${name}”.`,
    },
    errors: {
      dateOrder: "Ngày kết thúc không được sớm hơn ngày bắt đầu.",
      forbiddenCreate:
        "Chỉ Admin hoặc PM của ít nhất một dự án mới tạo được dự án.",
      forbiddenEdit: "Chỉ PM của dự án hoặc Admin mới sửa được dự án.",
      forbiddenDelete: "Chỉ Admin mới xóa vĩnh viễn được dự án.",
      network: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
      actionFailed: "Không thực hiện được thao tác.",
    },
  },
  /** Story E2-3 (QLDA-41): trạng thái, loại task, nhãn theo dự án (API và màn cấu hình dự án). */
  projectConfig: {
    pageTitle: "Cấu hình dự án",
    eyebrow: (project: string) => `Dự án / ${project} / Cấu hình`,
    heading: "Cấu hình dự án",
    canEditNote:
      "Chỉ PM của dự án và Admin được sửa; Thành viên và Người xem chỉ đọc.",
    readOnly: "Bạn đang xem ở chế độ chỉ đọc.",
    backToProjects: "Danh sách dự án",
    openSettings: "Cấu hình",
    openSettingsAction: (name: string) => `Cấu hình dự án ${name}`,
    tabsLabel: "Mục cấu hình",
    loading: "Đang tải cấu hình dự án",
    loadError: "Không tải được cấu hình dự án.",
    retry: "Thử lại",
    deleteHint:
      "Xóa một trạng thái hoặc loại task đang có task sẽ yêu cầu chọn mục thay thế cho các task đó.",
    taskCount: (n: number) => `${n} task`,
    milestone: "Mốc",
    categories: {
      todo: "Chưa bắt đầu",
      in_progress: "Đang thực hiện",
      done: "Đã xong",
    },
    colors: {
      gray: "Xám",
      blue: "Xanh dương",
      purple: "Tím",
      pink: "Hồng",
      amber: "Hổ phách",
      green: "Xanh lá",
      slate: "Xám đậm",
      red: "Đỏ",
      custom: "Màu riêng",
    },
    kinds: {
      statuses: {
        tab: "Trạng thái",
        listLabel: "Danh sách trạng thái",
        empty: "Chưa có trạng thái nào.",
        add: "Thêm trạng thái",
        addTitle: "Thêm trạng thái",
        editTitle: (name: string) => `Sửa trạng thái “${name}”`,
        deleteTitle: (name: string) => `Xóa trạng thái “${name}”?`,
        inUseBody: (n: number) =>
          `Có ${n} task đang ở trạng thái này. Chọn trạng thái để chuyển các task sang trước khi xóa.`,
        unusedBody: "Không có task nào ở trạng thái này. Không hoàn tác được.",
        replaceLabel: "Chuyển task sang trạng thái",
      },
      "task-types": {
        tab: "Loại task",
        listLabel: "Danh sách loại task",
        empty: "Chưa có loại task nào.",
        add: "Thêm loại",
        addTitle: "Thêm loại task",
        editTitle: (name: string) => `Sửa loại task “${name}”`,
        deleteTitle: (name: string) => `Xóa loại task “${name}”?`,
        inUseBody: (n: number) =>
          `Có ${n} task thuộc loại này. Chọn loại để chuyển các task sang trước khi xóa.`,
        unusedBody: "Không có task nào thuộc loại này. Không hoàn tác được.",
        replaceLabel: "Chuyển task sang loại",
      },
      labels: {
        tab: "Nhãn",
        listLabel: "Danh sách nhãn",
        empty: "Chưa có nhãn nào.",
        add: "Thêm nhãn",
        addTitle: "Thêm nhãn",
        editTitle: (name: string) => `Sửa nhãn “${name}”`,
        deleteTitle: (name: string) => `Xóa nhãn “${name}”?`,
        inUseBody: (n: number) =>
          `Nhãn đang gắn với ${n} task; xóa sẽ gỡ nhãn khỏi các task đó. Không hoàn tác được.`,
        unusedBody: "Nhãn chưa gắn với task nào. Không hoàn tác được.",
        replaceLabel: "",
      },
    },
    form: {
      name: "Tên",
      category: "Nhóm",
      categoryHint: "Nhóm “Đã xong” được tính là hoàn thành khi tính tiến độ.",
      color: "Màu",
      milestone: "Là mốc (milestone)",
      save: "Lưu",
      saving: "Đang lưu…",
      add: "Thêm",
      nameRequired: "Nhập tên.",
      nameTooLong: "Tên tối đa 100 ký tự.",
    },
    actions: {
      groupLabel: (name: string) => `Thao tác với ${name}`,
      edit: "Sửa",
      moveUp: "Lên",
      moveDown: "Xuống",
      moveUpAction: (name: string) => `Đưa ${name} lên`,
      moveDownAction: (name: string) => `Đưa ${name} xuống`,
      delete: "Xóa",
      confirmDelete: "Xóa",
      moveAndDelete: "Chuyển task và xóa",
    },
    done: {
      added: (name: string) => `Đã thêm “${name}”.`,
      updated: (name: string) => `Đã lưu “${name}”.`,
      moved: (name: string) => `Đã đổi thứ tự “${name}”.`,
      deleted: (name: string) => `Đã xóa “${name}”.`,
      deletedMoved: (name: string, n: number) =>
        `Đã xóa “${name}” và chuyển ${n} task.`,
    },
    errors: {
      nameExists: {
        statuses:
          "Dự án đã có trạng thái trùng tên (không phân biệt hoa thường).",
        "task-types":
          "Dự án đã có loại task trùng tên (không phân biệt hoa thường).",
        labels: "Dự án đã có nhãn trùng tên (không phân biệt hoa thường).",
      },
      inUse: {
        statuses:
          "Trạng thái đang có task. Chọn trạng thái thay thế (replace_with) để chuyển task trước khi xóa.",
        "task-types":
          "Loại task đang được dùng. Chọn loại thay thế (replace_with) để chuyển task trước khi xóa.",
        labels: "Nhãn đang được dùng.",
      },
      invalidReplacement: "Mục thay thế phải là một mục khác thuộc cùng dự án.",
      lastOfCategory:
        "Dự án phải còn ít nhất một trạng thái nhóm “Chưa bắt đầu” và một trạng thái nhóm “Đã xong”.",
      lastType: "Dự án phải còn ít nhất một loại task.",
      forbidden:
        "Chỉ PM của dự án hoặc Admin mới sửa được trạng thái, loại task, nhãn.",
      statusNotInProject: "Trạng thái hoặc loại task không thuộc dự án này.",
      typeNotInProject: "Loại task không thuộc dự án này.",
      labelNotInProject: "Nhãn không thuộc dự án của task.",
      replaceRequired: "Chọn mục thay thế.",
      network: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
      actionFailed: "Không thực hiện được thao tác.",
    },
  },
  /** Story E1-6 (QLDA-33): thành viên dự án và vai trò (API và tab Thành viên ở màn cấu hình). */
  projectMembers: {
    tab: "Thành viên",
    listLabel: "Thành viên dự án",
    loading: "Đang tải thành viên dự án",
    loadError: "Không tải được thành viên dự án.",
    retry: "Thử lại",
    empty: "Dự án chưa có thành viên.",
    add: "Thêm thành viên",
    you: "(Bạn)",
    locked: "Đã khóa",
    noEmail: "Chưa có email",
    roleNote:
      "PM quản lý dự án và thành viên; Thành viên tạo và sửa task của mình; Người xem chỉ đọc. Dự án luôn phải còn ít nhất một PM đang hoạt động.",
    assigneeNote:
      "Gỡ thành viên không đổi người phụ trách của các task đã giao cho họ.",
    roleOf: (name: string) => `Vai trò của ${name}`,
    actions: {
      groupLabel: (name: string) => `Thao tác với thành viên ${name}`,
      changeRole: "Đổi vai trò",
      remove: "Gỡ",
      removeAction: (name: string) => `Gỡ ${name} khỏi dự án`,
    },
    addDialog: {
      title: "Thêm thành viên",
      description:
        "Tìm theo họ tên hoặc email (chưa hỗ trợ gõ không dấu), chọn người rồi chọn vai trò.",
      search: "Tìm người",
      searchPlaceholder: "Họ tên hoặc email…",
      searchHint: "Nhập ít nhất 2 ký tự.",
      results: "Kết quả tìm",
      searching: "Đang tìm…",
      noResults: "Không tìm thấy người đang hoạt động nào chưa thuộc dự án.",
      resultCount: (n: number) => `${n} người phù hợp`,
      role: "Vai trò",
      submit: "Thêm vào dự án",
      pickRequired: "Chọn một người trong kết quả tìm.",
    },
    roleDialog: {
      title: (name: string) => `Đổi vai trò của ${name}`,
      description: "Vai trò áp dụng riêng cho dự án này.",
      role: "Vai trò mới",
      save: "Lưu vai trò",
      selfWarning:
        "Bạn đang đổi vai trò của chính mình. Nếu không còn là PM, bạn sẽ không quản lý được dự án này nữa.",
      lastPmWarning:
        "Đây là PM đang hoạt động cuối cùng của dự án: thêm hoặc chỉ định một PM khác trước khi đổi.",
    },
    removeDialog: {
      title: (name: string) => `Gỡ ${name} khỏi dự án?`,
      body: "Người này không còn thấy dự án. Các task đã giao cho họ giữ nguyên người phụ trách.",
      selfBody:
        "Bạn sẽ rời dự án và không còn thấy dự án này. Các task đã giao cho bạn giữ nguyên người phụ trách.",
      confirm: "Gỡ khỏi dự án",
    },
    done: {
      added: (name: string, role: string) =>
        `Đã thêm ${name} vào dự án với vai trò ${role}.`,
      changed: (name: string, role: string) =>
        `Đã đổi vai trò của ${name} thành ${role}.`,
      unchanged: (name: string, role: string) =>
        `${name} đã có vai trò ${role}.`,
      removed: (name: string) => `Đã gỡ ${name} khỏi dự án.`,
    },
    errors: {
      forbidden:
        "Chỉ PM của dự án hoặc Admin mới thêm, đổi vai trò, gỡ thành viên.",
      searchForbidden:
        "Chỉ Admin hoặc PM của ít nhất một dự án mới tìm người để thêm vào dự án.",
      userInactive: "Người này không tồn tại hoặc đã bị khóa.",
      lastPm:
        "Dự án phải còn ít nhất một PM đang hoạt động. Hãy chỉ định PM khác trước.",
      actionFailed: "Không thực hiện được thao tác.",
    },
  },
  /** Story E8-1 (QLDA-55): lỗi API quan hệ task (trước nằm ở lib/task-relations/messages.ts). */
  taskRelations: {
    errors: {
      cycle: "Quan hệ này tạo vòng",
      duplicate: "Quan hệ này đã có",
      selfRelation: "Task không thể quan hệ với chính nó.",
      crossProject: "Hai task phải thuộc cùng một dự án.",
      forbiddenEdit:
        "Bạn cần quyền sửa cả hai task để đặt hoặc bỏ quan hệ giữa chúng.",
    },
  },
  /** Thông điệp lỗi của lớp bảo mật chung (Story E0-5): CSRF, giới hạn tần suất. */
  security: {
    crossOrigin: "Yêu cầu không đến từ ứng dụng này nên bị từ chối.",
    rateLimited: "Bạn gửi quá nhiều yêu cầu. Vui lòng đợi rồi thử lại.",
  },
  /** Trang nhận lời mời và đặt mật khẩu /auth/accept-invite (Story E1-7, QLDA-80). */
  acceptInvite: {
    pageTitle: "Nhận lời mời",
    eyebrow: "Lời mời",
    heading: "Đặt mật khẩu",
    subtitle:
      "Bạn được Admin mời vào hệ thống. Đặt mật khẩu để đăng nhập lần sau.",
    passwordLabel: "Mật khẩu mới",
    passwordHint: "Ít nhất 12 ký tự. Nên dùng cụm từ dài dễ nhớ.",
    confirmLabel: "Nhập lại mật khẩu",
    submit: "Đặt mật khẩu và vào ứng dụng",
    submitting: "Đang lưu…",
    divider: "hoặc",
    google: "Tiếp tục với Google",
    googleRedirecting: "Đang chuyển tới Google…",
    googleHint: "Chỉ dùng được tài khoản Google có đúng email đã nhận lời mời.",
    backToLogin: "Về trang đăng nhập",
    invalidHeading: "Link mời không dùng được",
    invalidBody:
      "Link này không hợp lệ, đã hết hạn hoặc đã được dùng. Mỗi link mời chỉ dùng được một lần.",
    invalidAction:
      "Hãy liên hệ Admin để được gửi lại lời mời, rồi mở link trong email mới nhất.",
    invalidHintSignedUp:
      "Nếu bạn đã đặt mật khẩu trước đó, hãy đăng nhập như bình thường.",
    fieldErrors: {
      password: {
        required: "Vui lòng nhập mật khẩu.",
        too_short: "Mật khẩu cần ít nhất 12 ký tự.",
        too_long: "Mật khẩu quá dài (tối đa 72 byte).",
      },
      confirm: {
        required: "Vui lòng nhập lại mật khẩu.",
        mismatch: "Hai mật khẩu không khớp.",
      },
    },
    errors: {
      rateLimited: "Bạn thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.",
      unavailable: "Không thể xử lý lời mời lúc này. Vui lòng thử lại sau.",
      passwordNotSet:
        "Lời mời đã được xác nhận nhưng chưa đặt được mật khẩu. Hãy thử đăng nhập bằng Google hoặc liên hệ Admin.",
    },
  },
  /** Chế độ xem đã lưu (Story E13-1, QLDA-53). Chỉ thông điệp lỗi API; giao diện ở E13-2/E13-3. */
  savedViews: {
    errors: {
      forbidden: "Bạn chỉ sửa, xóa được chế độ xem riêng của mình.",
      publicForbidden:
        "Chỉ PM của dự án và Admin được tạo, sửa, xóa chế độ xem công khai.",
      privatizeForbidden:
        "Chỉ người tạo chế độ xem được chuyển nó về riêng tư.",
      defaultReadOnly: "Chế độ xem mặc định không sửa, xóa được.",
      nameExists: "Bạn đã có chế độ xem cùng tên trong dự án này.",
    },
  },
  /** Dashboard tiến độ S06 (Story E5-1, QLDA-60). */
  dashboard: {
    pageTitle: "Tổng quan dự án",
    backToProjects: "Danh sách dự án",
    eyebrow: (name: string, total: number) => `Dự án / ${name} · ${total} task`,
    heading: "Tổng quan",
    navLabel: "Chế độ xem dự án",
    nav: {
      board: "Bảng",
      dashboard: "Tổng quan",
      settings: "Cấu hình",
    },
    loading: "Đang tải số liệu dự án",
    loadError: "Không tải được số liệu dự án.",
    retry: "Thử lại",
    todayNote: (date: string) =>
      `Trễ hạn tính đến hết ngày ${date} (giờ Việt Nam); task đã xong không tính trễ.`,
    percent: (n: number) => `${n}%`,
    kpisLabel: "Chỉ số chính",
    kpi: {
      completion: "Hoàn thành",
      completionNote: (done: string, total: string) =>
        `${done} / ${total} task`,
      completionAria: (n: number) => `Hoàn thành ${n}%`,
      inProgress: "Đang làm",
      inProgressNote: "task đang thực hiện",
      overdue: "Trễ hạn",
      overdueNote: "chưa xong, đã quá hạn",
      blocked: "Bị chặn",
      blockedNote: "đang chờ task khác",
    },
    colCount: "Số task",
    colShare: "Tỉ lệ",
    byGroup: {
      title: "Theo nhóm trạng thái",
      summary: (parts: string) => `Phân bố theo nhóm trạng thái: ${parts}`,
      part: (name: string, count: string, pct: number) =>
        `${name} ${count} (${pct}%)`,
    },
    byStatus: {
      title: "Phân bố theo trạng thái",
      total: (n: string) => `${n} task`,
      colStatus: "Trạng thái",
      colGroup: "Nhóm",
    },
    byAssignee: {
      title: "Việc theo người phụ trách",
      colPerson: "Người phụ trách",
      colOpen: "Đang mở",
      colOverdue: "Trễ hạn",
      colDone: "Đã xong",
      unassigned: "Chưa giao",
      formerMember: "Người đã rời dự án",
      leftBadge: "Đã rời dự án",
      empty: "Chưa có task nào.",
    },
    byPriority: {
      title: "Theo ưu tiên",
      colPriority: "Ưu tiên",
    },
    byType: {
      title: "Theo loại task",
      colType: "Loại",
      milestone: "Mốc",
    },
    overdueList: {
      title: "Task trễ hạn",
      empty: "Không có task trễ hạn.",
      days: (n: number) => `Trễ ${n} ngày`,
      due: (date: string) => `Hạn ${date}`,
      more: (shown: number, total: number) =>
        `Đang hiện ${shown} / ${total} task trễ hạn, hạn sớm nhất trước.`,
    },
    empty: {
      title: "Dự án chưa có task",
      bodyCanCreate:
        "Số liệu tiến độ sẽ hiện ở đây khi dự án có task. Hãy tạo task đầu tiên trên bảng của dự án.",
      bodyReadOnly:
        "Số liệu tiến độ sẽ hiện ở đây khi PM hoặc thành viên của dự án tạo task.",
      action: "Mở bảng để tạo task",
    },
  },
} as const;

/** Nới kiểu chữ cố định thành string (giữ cấu trúc, chữ ký hàm) để en.ts khai báo theo. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : { readonly [K in keyof T]: Widen<T[K]> };

/** Kiểu của một từ điển: mọi ngôn ngữ phải khớp đúng kiểu này. */
export type Messages = Widen<typeof viMessages>;

export const vi: Messages = viMessages;
