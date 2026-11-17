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
  /** Story E3-1 (QLDA-47): thanh điều hướng con của dự án (Bảng, Tổng quan, Cấu hình). */
  projectNav: {
    eyebrow: "Dự án",
    backToProjects: "Danh sách dự án",
    navLabel: "Chế độ xem dự án",
    board: "Bảng",
    dashboard: "Tổng quan",
    settings: "Cấu hình",
  },
  /** Story E3-1 (QLDA-47): bảng Kanban (S03) và Kanban trên điện thoại (S09). */
  kanban: {
    pageTitle: "Bảng Kanban",
    boardLabel: "Bảng Kanban",
    loading: "Đang tải bảng Kanban",
    loadingMore: (n: number) => `Đang tải task… (${n})`,
    loadError: "Không tải được bảng Kanban.",
    retry: "Thử lại",
    readOnly: "Chỉ xem",
    readOnlyNote:
      "Bạn là Người xem của dự án này: xem được bảng nhưng không kéo thả hay chuyển task.",
    memberNote:
      "Bạn kéo thả, chuyển được task mình phụ trách hoặc do mình tạo.",
    noStatusesTitle: "Dự án chưa có trạng thái",
    noStatusesBody: "Thêm trạng thái ở Cấu hình để có cột trên bảng.",
    openSettings: "Mở Cấu hình",
    emptyTitle: "Chưa có task",
    emptyBody:
      "Task của dự án sẽ hiện ở đây, mỗi trạng thái một cột. Cột lấy theo trạng thái ở Cấu hình.",
    noMatchTitle: "Không có task khớp bộ lọc",
    noMatchBody: "Thử bỏ bớt điều kiện lọc hoặc từ khóa.",
    clearFilters: "Xóa bộ lọc",
    columnEmpty: "Chưa có task",
    columnCount: (n: number) => `${n} task`,
    showMore: (n: number) => `Hiện thêm ${n} task`,
    chooseColumn: "Chọn cột để xem",
    filters: {
      label: "Lọc nhanh",
      assignee: "Người phụ trách",
      assigneeAll: "Mọi người",
      unassigned: "Chưa giao",
      priority: "Ưu tiên",
      priorityAll: "Mọi mức",
      labelFilter: "Nhãn",
      labelAll: "Mọi nhãn",
      search: "Tìm trong dự án",
      searchPlaceholder: "Tìm trong dự án…",
      searching: "Đang tìm…",
      searchError: "Không tìm được. Thử lại sau.",
      resultCount: (n: number) => `${n} task khớp`,
    },
    card: {
      due: (date: string) => `Hạn · ${date}`,
      overdue: (date: string) => `Trễ · ${date}`,
      overdueLabel: "Trễ hạn",
      subtasks: (done: number, total: number) =>
        `${done} trên ${total} việc con đã xong`,
      unassigned: "Chưa giao",
      assignee: (name: string) => `Người phụ trách: ${name}`,
      formerMember: "Người ngoài dự án",
      dragHandle: (title: string) => `Kéo để di chuyển task ${title}`,
      moveMenu: (title: string) => `Chuyển task ${title} đến cột khác`,
      labels: "Nhãn",
      saving: "Đang lưu…",
    },
    move: {
      title: "Chuyển đến cột",
      description: (title: string) =>
        `Chọn cột cho task “${title}”. Task được đặt ở cuối cột.`,
      listLabel: "Các cột",
      current: "Cột hiện tại",
      moved: (title: string, column: string) =>
        `Đã chuyển “${title}” sang ${column}.`,
      failed: (title: string) => `Không chuyển được task “${title}”`,
      approximate:
        "Thẻ được đặt gần vị trí đã chọn vì không sắp lại được các task bên cạnh (thiếu quyền sửa hoặc quá nhiều task).",
      reorderFailed:
        "Một số task bên cạnh chưa lưu được thứ tự; bảng đã được tải lại.",
      notFound:
        "Task không còn tồn tại hoặc bạn không còn quyền xem. Bảng đã được tải lại.",
      forbidden:
        "Bạn không có quyền sửa task này (Thành viên chỉ sửa task mình phụ trách hoặc tạo). Thẻ đã về chỗ cũ.",
      openSubtasks:
        "Task còn việc con chưa xong nên chưa chuyển sang cột hoàn thành được. Hoàn thành các việc con trước. Thẻ đã về chỗ cũ.",
    },
    dnd: {
      instructions:
        "Để di chuyển task bằng bàn phím: đưa tiêu điểm tới nút kéo, nhấn Space để nhấc, dùng phím mũi tên để di chuyển giữa các thẻ và các cột, nhấn Space để thả hoặc Esc để hủy.",
      start: (title: string) => `Đã nhấc task ${title}.`,
      over: (title: string, column: string, index: number) =>
        `Task ${title} đang ở cột ${column}, vị trí ${index}.`,
      overNone: (title: string) => `Task ${title} chưa ở trên cột nào.`,
      end: (title: string, column: string, index: number) =>
        `Đã thả task ${title} vào cột ${column}, vị trí ${index}.`,
      cancel: (title: string) => `Đã hủy di chuyển task ${title}.`,
    },
  },
  /** Dashboard tiến độ S06 (Story E5-1, QLDA-60). */
  dashboard: {
    open: "Xem tổng quan",
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
  /** Story E2-5 (QLDA-46): ngăn chi tiết task (S05 v2). */
  taskDetail: {
    pageTitle: "Chi tiết task",
    panelLabel: "Chi tiết task",
    eyebrow: (typeName: string, projectName: string) =>
      `${typeName} · ${projectName}`,
    close: "Đóng chi tiết task",
    backToBoard: "Về bảng dự án",
    loading: "Đang tải chi tiết task",
    loadError: "Không tải được chi tiết task.",
    retry: "Thử lại",
    readOnlyBadge: "Chỉ đọc",
    readOnly: {
      viewer: "Bạn là Người xem trong dự án này nên chỉ xem được task.",
      notOwner:
        "Bạn chỉ sửa được task mình phụ trách hoặc do mình tạo, nên các trường của task này đang khóa.",
    },
    reassignLocked:
      "Chỉ người tạo task, PM hoặc Admin đổi được người phụ trách.",
    propertiesLabel: "Thuộc tính task",
    fields: {
      title: "tiêu đề",
      description: "mô tả",
      type_id: "Loại",
      status_id: "Trạng thái",
      assignee_id: "Người phụ trách",
      priority: "Ưu tiên",
      start_date: "Ngày bắt đầu",
      due_date: "Ngày kết thúc (hạn)",
      label_ids: "Nhãn",
    },
    unassigned: "Chưa giao",
    notSet: "Chưa đặt",
    unknown: "Không rõ",
    overdue: (date: string) => `Trễ · ${date}`,
    notAssignable: (name: string) => `${name} (không còn giao được)`,
    labels: {
      none: "Chưa có nhãn",
      projectEmpty: "Dự án chưa có nhãn nào.",
      edit: "Sửa nhãn",
      done: "Xong",
      legend: "Chọn nhãn cho task",
    },
    title: {
      edit: "Sửa tiêu đề",
      label: "Tiêu đề task",
      save: "Lưu tiêu đề",
      cancel: "Hủy",
      required: "Tiêu đề không được để trống.",
      tooLong: "Tiêu đề tối đa 500 ký tự.",
    },
    description: {
      heading: "Mô tả",
      empty: "Chưa có mô tả.",
      add: "Thêm mô tả",
      edit: "Sửa mô tả",
      label: "Mô tả task",
      hint: "Văn bản thuần, giữ nguyên xuống dòng. Tối đa 10.000 ký tự.",
      save: "Lưu mô tả",
      cancel: "Hủy",
      tooLong: "Mô tả tối đa 10.000 ký tự.",
    },
    subtasks: {
      heading: "Việc con",
      parent: "Task cha",
      listLabel: "Danh sách việc con",
      progressLabel: (done: number, total: number) =>
        `Việc con hoàn thành ${done} trên ${total}`,
      empty: "Chưa có việc con.",
      addLabel: "Tên việc con mới",
      add: "Thêm việc con",
      required: "Nhập tên việc con.",
      added: (title: string) => `Đã thêm việc con “${title}”.`,
      maxDepth:
        "Task này đã ở cấp 3 nên không thêm được việc con (tối đa 3 cấp).",
      doneMark: "Đã xong",
      truncated: "Chỉ hiện 200 việc con đầu tiên.",
    },
    relations: {
      heading: "Quan hệ",
      listLabel: "Quan hệ với task khác",
      empty: "Chưa có quan hệ nào với task khác.",
      loading: "Đang tải quan hệ",
      loadError: "Không tải được quan hệ.",
      kinds: {
        relates: "Liên quan",
        blocks: "Chặn",
        blocked_by: "Bị chặn bởi",
        precedes: "Đứng trước",
        follows: "Đứng sau",
        duplicates: "Trùng lặp",
        duplicated_by: "Bị trùng bởi",
      },
    },
    blocked: (titles: string) =>
      `Task này bị chặn bởi ${titles} (chưa xong). Bạn vẫn có thể đánh dấu hoàn thành.`,
    save: {
      saving: (field: string) => `Đang lưu ${field}…`,
      saved: (field: string) => `Đã lưu ${field}.`,
      undo: "Hoàn tác",
      undone: (field: string) => `Đã hoàn tác ${field}.`,
      failed: (field: string) => `Chưa lưu được ${field}.`,
      stale:
        "Task vừa được người khác sửa. Ngăn đã tải lại bản mới nhất, hãy kiểm tra rồi sửa lại.",
    },
    delete: {
      action: "Xóa task",
      title: (title: string) => `Xóa task “${title}”?`,
      body: "Task sẽ bị xóa vĩnh viễn, không hoàn tác được.",
      bodyWithSubtasks: (count: number) =>
        `Task và cả ${count} việc con của nó sẽ bị xóa vĩnh viễn, không hoàn tác được.`,
      confirm: "Xóa vĩnh viễn",
      failed: "Chưa xóa được task.",
    },
    errors: {
      stale: "Task vừa được người khác sửa. Hãy tải lại rồi thử lại.",
    },
  },
  /** Thêm, bỏ quan hệ giữa task trong ngăn chi tiết (Story E8-2, S05 v2). */
  taskRelationsUi: {
    add: "Thêm quan hệ",
    locked:
      "Bạn cần quyền sửa cả hai task để thêm hoặc bỏ quan hệ. Thành viên chỉ sửa được task mình phụ trách hoặc tạo.",
    dialogTitle: "Thêm quan hệ",
    dialogDescription: (title: string) =>
      `Chọn kiểu quan hệ và task đích cho “${title}”.`,
    kindLabel: "Kiểu quan hệ",
    preview: {
      relates: (a: string, b: string) => `“${a}” liên quan đến “${b}”.`,
      blocks: (a: string, b: string) =>
        `“${a}” chặn “${b}”: “${b}” phải chờ “${a}” xong.`,
      blocked_by: (a: string, b: string) =>
        `“${a}” bị chặn bởi “${b}”: “${a}” phải chờ “${b}” xong.`,
      precedes: (a: string, b: string) =>
        `“${a}” đứng trước “${b}” (dùng cho lịch, Gantt).`,
      follows: (a: string, b: string) =>
        `“${a}” đứng sau “${b}” (dùng cho lịch, Gantt).`,
      duplicates: (a: string, b: string) => `“${a}” trùng lặp với “${b}”.`,
    },
    targetPlaceholder: "task đích",
    lagLabel: "Độ trễ (ngày)",
    lagHint: "Số ngày chờ giữa hai task, từ −365 đến 365. Để 0 nếu không cần.",
    lagInvalid: "Nhập số nguyên từ −365 đến 365.",
    targetLabel: "Task đích",
    searchPlaceholder: "Tìm theo tiêu đề, gõ không dấu cũng được",
    searchHint: "Dùng phím mũi tên lên, xuống để chọn, Enter để chốt task.",
    resultsLabel: "Task trong dự án",
    searching: "Đang tìm task…",
    noResults: "Không có task nào khớp.",
    searchError: "Không tìm được task.",
    cannotEditTarget: "Bạn không sửa được task này",
    selected: (title: string) => `Đã chọn: ${title}`,
    targetRequired: "Hãy chọn task đích trong danh sách.",
    submit: "Thêm quan hệ",
    added: (label: string, title: string) =>
      `Đã thêm quan hệ “${label}” với “${title}”.`,
    addFailed: "Chưa thêm được quan hệ.",
    lag: (days: number) =>
      days > 0 ? `trễ ${days} ngày` : `sớm ${Math.abs(days)} ngày`,
    removeLabel: (label: string, title: string) =>
      `Bỏ quan hệ “${label}” với “${title}”`,
    remove: "Bỏ",
    removeTitle: "Bỏ quan hệ này?",
    removeBody: (label: string, title: string) =>
      `Bỏ quan hệ “${label}” với task “${title}”. Hai task vẫn giữ nguyên.`,
    removeConfirm: "Bỏ quan hệ",
    removed: "Đã bỏ quan hệ.",
    removeFailed: "Chưa bỏ được quan hệ.",
    errors: {
      cycle:
        "Quan hệ này tạo vòng: chuỗi chặn hoặc đứng trước sẽ quay lại chính task này. Hãy chọn task khác hoặc bỏ quan hệ cũ trước.",
      duplicate: "Hai task đã có quan hệ này rồi.",
      selfRelation: "Không thể đặt quan hệ giữa một task với chính nó.",
      crossProject: "Chỉ đặt quan hệ được giữa hai task cùng dự án.",
      forbidden:
        "Bạn không đủ quyền: cần sửa được cả hai task (Thành viên chỉ sửa task mình phụ trách hoặc tạo).",
      notFound:
        "Task hoặc quan hệ không còn (có thể vừa bị xóa). Danh sách quan hệ đã được tải lại.",
    },
  },
  notifications: {
    bellLabel: "Thông báo",
    bellLabelUnread: (count: number) => `Thông báo, ${count} chưa đọc`,
    badgeOverflow: "99+",
    announceNew: (count: number) =>
      count === 1
        ? "Bạn có 1 thông báo mới."
        : `Bạn có ${count} thông báo mới.`,
    panelLabel: "Hộp thư thông báo",
    eyebrow: (count: number) =>
      `Hộp thư / ${String(count).padStart(2, "0")} chưa đọc`,
    heading: "Thông báo",
    filterLabel: "Lọc thông báo",
    filterUnread: (count: number) => `Chưa đọc (${count})`,
    filterAll: "Tất cả",
    markAllRead: "Đánh dấu tất cả đã đọc",
    markRead: "Đánh dấu đã đọc",
    markReadOf: (text: string) => `Đánh dấu đã đọc: ${text}`,
    unreadMark: "Chưa đọc",
    loading: "Đang tải thông báo",
    loadMore: "Tải thêm",
    loadError: "Không tải được thông báo.",
    retry: "Thử lại",
    actionFailed: "Chưa đánh dấu được. Hãy thử lại.",
    emptyUnreadTitle: "Không còn thông báo chưa đọc",
    emptyUnreadBody: "Bạn đã xem hết. Chọn “Tất cả” để xem lại thông báo cũ.",
    emptyAllTitle: "Chưa có thông báo",
    emptyAllBody:
      "Bạn sẽ nhận thông báo ở đây khi được giao task hoặc task của bạn đổi trạng thái.",
    someone: "Một người",
    assigned: (actor: string, title: string) =>
      `${actor} giao cho bạn task ${title}`,
    assignedNoActor: (title: string) => `Bạn được giao task ${title}`,
    statusChanged: (actor: string, title: string, status: string) =>
      `${actor} đổi trạng thái task ${title} sang ${status}`,
    statusChangedNoActor: (title: string, status: string) =>
      `Task ${title} đã chuyển sang ${status}`,
    hiddenAssigned:
      "Bạn từng được giao một task mà nay bạn không còn quyền xem.",
    hiddenStatusChanged: "Một task bạn không còn quyền xem đã đổi trạng thái.",
    today: (time: string) => `Hôm nay ${time}`,
    yesterday: (time: string) => `Hôm qua ${time}`,
  },
  /** Story E3-2 (QLDA-51): bảng phân cấp, nhóm, chọn cột (S04, S12). */
  taskList: {
    pageTitle: "Danh sách task",
    navTab: "Danh sách",
    tableLabel: "Bảng task phân cấp",
    loading: "Đang tải danh sách task",
    loadingMore: (n: number) => `Đang tải task… (${n})`,
    loadError: "Không tải được danh sách task.",
    retry: "Thử lại",
    readOnly: "Chỉ xem",
    readOnlyNote:
      "Bạn là Người xem của dự án này: xem được danh sách nhưng không tạo hay sửa task.",
    emptyTitle: "Chưa có task",
    emptyBody: "Task của dự án sẽ hiện ở đây theo cấu trúc cha-con.",
    emptyAction: "Tạo task đầu tiên",
    noMatchTitle: "Không có task khớp bộ lọc",
    noMatchBody: "Thử bỏ bớt điều kiện lọc hoặc từ khóa.",
    clearFilters: "Xóa bộ lọc",
    resultCount: (n: number) => `${n} task`,
    contextHint: "Task cha hiện để giữ cấu trúc, bản thân không khớp bộ lọc.",
    filters: {
      regionLabel: "Lọc danh sách",
      search: "Tìm trong dự án",
      searchPlaceholder: "Tìm theo tên, mô tả…",
      searching: "Đang tìm…",
      searchError: "Không tìm được. Thử lại sau.",
      status: "Trạng thái",
      statusAll: "Mọi trạng thái",
      statusOpen: "Chưa xong",
      statusCustom: (n: number) => `${n} trạng thái đã chọn`,
      assignee: "Người phụ trách",
      assigneeAll: "Mọi người",
      priority: "Ưu tiên",
      priorityAll: "Mọi mức",
      label: "Nhãn",
      labelAll: "Mọi nhãn",
      dueAfter: "Hạn từ ngày",
      dueBefore: "Hạn đến ngày",
      dueOrder: "Ngày cuối phải sau ngày đầu; khoảng hạn chưa được áp dụng.",
    },
    toolbar: {
      label: "Cách hiển thị",
      groupBy: "Nhóm theo",
      groupNone: "Không nhóm",
      expandAll: "Mở rộng tất cả",
      collapseAll: "Thu gọn tất cả",
      columns: "Chọn cột",
      columnsCount: (n: number) => `Chọn cột (${n})`,
    },
    groupBy: {
      status_id: "Trạng thái",
      type_id: "Loại",
      assignee_id: "Người phụ trách",
      priority: "Ưu tiên",
      label_ids: "Nhãn",
    },
    groupNone: {
      status_id: "Không có trạng thái",
      type_id: "Không có loại",
      assignee_id: "Chưa giao",
      priority: "Không có ưu tiên",
      label_ids: "Không nhãn",
    },
    groupCount: (count: number) => `(${count} task)`,
    columns: {
      title: "Tên task",
      status_id: "Trạng thái",
      type_id: "Loại",
      priority: "Ưu tiên",
      assignee_id: "Người phụ trách",
      created_by: "Người tạo",
      start_date: "Ngày bắt đầu",
      due_date: "Hạn",
      label_ids: "Nhãn",
      parent_id: "Task cha",
      created_at: "Ngày tạo",
      updated_at: "Cập nhật",
      completed_at: "Ngày hoàn thành",
    },
    columnDialog: {
      title: "Chọn cột hiển thị",
      description:
        "Tên task luôn hiện. Lựa chọn được ghi nhớ trên trình duyệt này cho dự án.",
      reset: "Về mặc định",
      done: "Xong",
    },
    sort: {
      by: (column: string) => `Sắp xếp theo ${column}`,
      ascending: "tăng dần",
      descending: "giảm dần",
    },
    row: {
      expand: (title: string, n: number) => `Mở rộng ${title} (${n} việc con)`,
      collapse: (title: string, n: number) =>
        `Thu gọn ${title} (${n} việc con)`,
      level: (n: number) => `Cấp ${n}`,
      unassigned: "Chưa giao",
      formerMember: "Người ngoài dự án",
      overdue: (date: string) => `Trễ · ${date}`,
      none: "—",
    },
    create: {
      action: "Tạo task",
      title: "Tạo task nhanh",
      description:
        "Nhập tên task. Task mới ở trạng thái đầu tiên; mở task để điền thêm chi tiết.",
      name: "Tên task",
      submit: "Tạo task",
      submitting: "Đang tạo…",
      created: (title: string) => `Đã tạo task “${title}”.`,
      failed: "Chưa tạo được task.",
    },
  },
  /** Template báo cáo do Admin tải lên (Story E5-2, S17 tab "Template báo cáo"). */
  reportTemplates: {
    pageTitle: "Template báo cáo",
    navLink: "Template báo cáo",
    eyebrow: "Quản trị / Template",
    heading: "Template báo cáo",
    intro:
      "Admin tải lên template Excel và Word của công ty. PM dùng template đang bật khi xuất báo cáo tiến độ.",
    upload: {
      action: "Tải lên template báo cáo",
      dropTitle: "Kéo thả tệp .xlsx hoặc .docx vào đây",
      dropOr: "hoặc",
      choose: "Chọn tệp",
      inputLabel: "Chọn tệp template (.xlsx hoặc .docx)",
      hint: "Tối đa 4 MB. Không nhận tệp có macro (.xlsm, .docm).",
      uploading: (file: string) => `Đang tải lên ${file}…`,
      uploaded: (name: string) => `Đã tải lên template “${name}”.`,
      failed: "Chưa tải lên được template.",
      onlyOne: "Mỗi lần chỉ tải lên một tệp.",
    },
    tableCaption: "Danh sách template báo cáo",
    columns: {
      name: "Tên",
      format: "Định dạng",
      size: "Dung lượng",
      uploadedBy: "Tải lên bởi",
      date: "Ngày",
      status: "Trạng thái",
      actions: "Thao tác",
    },
    sizeKb: (kb: string) => `${kb} KB`,
    status: {
      active: "Đang dùng",
      inactive: "Không dùng",
    },
    unknownUploader: "Không rõ",
    actions: {
      download: (name: string) => `Tải xuống ${name}`,
      downloadShort: "Tải xuống",
      activate: "Bật dùng",
      deactivate: "Ngừng dùng",
      activateLabel: (name: string) => `Bật dùng ${name}`,
      deactivateLabel: (name: string) => `Ngừng dùng ${name}`,
      delete: "Xóa",
      deleteLabel: (name: string) => `Xóa ${name}`,
    },
    activated: (name: string) => `Đã bật “${name}”.`,
    deactivated: (name: string) => `Đã ngừng dùng “${name}”.`,
    deleted: (name: string) => `Đã xóa “${name}”.`,
    confirmDelete: {
      title: (name: string) => `Xóa template “${name}”?`,
      description:
        "Tệp bị xóa vĩnh viễn khỏi kho lưu trữ. Nếu chỉ muốn tạm không dùng, hãy chọn “Ngừng dùng”.",
      confirm: "Xóa template",
    },
    empty: {
      title: "Chưa có template báo cáo",
      description:
        "Tải lên template .xlsx hoặc .docx của công ty để PM xuất báo cáo đúng mẫu.",
    },
    loading: "Đang tải danh sách template",
    loadFailed: "Không tải được danh sách template.",
    retry: "Thử lại",
    rules: {
      title: "Quy tắc",
      body: "Chỉ tải lên tệp .xlsx hoặc .docx dưới 4 MB, không có macro. Người dùng không sửa được cấu trúc template trong ứng dụng (BR-08). Mỗi định dạng chỉ có một template đang dùng; bật template mới sẽ tự ngừng template cũ cùng định dạng.",
    },
    errors: {
      tooLarge: "Tệp vượt quá 4 MB.",
      unsupportedType: "Chỉ nhận tệp .xlsx hoặc .docx.",
      mimeMismatch: "Loại tệp không khớp với đuôi tệp.",
      invalidFile:
        "Tệp không phải tài liệu Excel/Word hợp lệ hoặc nội dung không khớp đuôi tệp.",
      macro: "Tệp có macro hoặc ActiveX, không được nhận.",
      zipBomb:
        "Tệp giải nén ra quá lớn hoặc có quá nhiều phần, không được nhận.",
      invalidName:
        "Tên tệp không hợp lệ (có ký tự điều khiển, đường dẫn hoặc quá dài).",
      activeConflict:
        "Template khác cùng định dạng vừa được bật. Vui lòng thử lại.",
      network: "Mất kết nối. Vui lòng thử lại.",
    },
  },
  /** Story E13-2 (QLDA-54): menu chế độ xem S12 trên bảng phân cấp, 7 chế độ xem mặc định. */
  savedViewsMenu: {
    regionLabel: "Chế độ xem đã lưu",
    toggle: (name: string) => `Chế độ xem: ${name}`,
    noneSelected: "Cách xem của bạn",
    searchLabel: "Tìm chế độ xem",
    searchPlaceholder: "Tìm chế độ xem…",
    sections: {
      favorites: "Yêu thích",
      defaults: "Mặc định",
      shared: "Công khai",
      mine: "Riêng tư",
    },
    mineEmpty: "Bạn chưa có chế độ xem riêng.",
    noResults: "Không có chế độ xem nào khớp.",
    loading: "Đang tải chế độ xem…",
    loadError: "Chưa tải được danh sách chế độ xem.",
    retry: "Thử lại",
    favoriteAdd: (name: string) => `Thêm “${name}” vào yêu thích`,
    favoriteRemove: (name: string) => `Bỏ “${name}” khỏi yêu thích`,
    favoriteFailed: "Chưa cập nhật được yêu thích. Thử lại sau.",
    eyebrow: "Chế độ xem",
    kind: {
      default: "Mặc định",
      public: "Công khai",
      private: "Riêng tư",
    },
    readOnly: "Chỉ đọc",
    defaultNote:
      "Chế độ xem mặc định, không sửa được. Bạn vẫn đổi bộ lọc, sắp xếp, nhóm để xem tạm.",
    publicNote: "Chế độ xem công khai của dự án.",
    privateNote: "Chế độ xem riêng của bạn, chỉ bạn thấy.",
    modified: "Đã đổi so với chế độ xem",
    reset: "Đặt lại",
    missing:
      "Không mở được chế độ xem trong liên kết (có thể đã bị xóa hoặc bạn không có quyền). Đang hiện cách xem của bạn.",
    dismiss: "Đóng thông báo",
    names: {
      allOpen: "Tất cả đang mở",
      latestActivity: "Hoạt động gần nhất",
      recentlyCreated: "Mới tạo",
      overdue: "Quá hạn",
      summary: "Tóm tắt",
      createdByMe: "Tạo bởi tôi",
      assignedToMe: "Giao cho tôi",
    },
    assigneeMe: "Tôi",
    chips: {
      label: "Bộ lọc khác",
      open: "Chưa hoàn thành",
      overdue: "Quá hạn",
      createdByMe: "Tạo bởi tôi",
      createdBy: (name: string) => `Tạo bởi ${name}`,
      remove: (label: string) => `Bỏ bộ lọc “${label}”`,
    },
  },
  /** Story E13-3 (QLDA-63): lưu, đổi tên, công khai, xóa chế độ xem trên bảng phân cấp. */
  savedViewsManage: {
    actionsLabel: "Thao tác với chế độ xem",
    saveNew: "Lưu thành chế độ xem mới",
    saveChanges: "Lưu thay đổi",
    rename: "Đổi tên",
    publish: "Công khai",
    privatize: "Chuyển về riêng tư",
    delete: "Xóa",
    dialog: {
      createTitle: "Lưu chế độ xem",
      createDescription:
        "Lưu bộ lọc, sắp xếp, nhóm và cột đang bật để dùng lại. Chế độ xem không lưu danh sách task.",
      renameTitle: "Đổi tên chế độ xem",
      renameDescription: "Tên mới hiện trong menu chế độ xem.",
      name: "Tên chế độ xem",
      nameHint: (max: number) => `Tối đa ${max} ký tự.`,
      nameRequired: "Nhập tên chế độ xem.",
      nameTooLong: (max: number) => `Tên tối đa ${max} ký tự.`,
      visibility: "Ai thấy chế độ xem này",
      private: "Riêng tư",
      privateHint: "Chỉ bạn thấy và dùng được.",
      public: "Công khai",
      publicHint:
        "Mọi người trong dự án thấy được; mỗi người chỉ thấy task họ đủ quyền.",
      privateOnly:
        "Chế độ xem sẽ ở chế độ riêng tư, chỉ bạn thấy. Chỉ PM của dự án và Admin tạo được chế độ xem công khai.",
      save: "Lưu",
      saving: "Đang lưu…",
      copySuffix: "(bản sao)",
    },
    deleteTitle: (name: string) => `Xóa chế độ xem “${name}”?`,
    deleteDescription:
      "Chế độ xem bị xóa vĩnh viễn, kể cả với người đã đánh dấu yêu thích. Task không bị ảnh hưởng.",
    deleteConfirm: "Xóa chế độ xem",
    readOnly: {
      default:
        "Chế độ xem mặc định không sửa được. Đổi bộ lọc rồi bấm “Lưu thành chế độ xem mới” để có bản của riêng bạn.",
      public:
        "Chỉ PM của dự án và Admin sửa được chế độ xem công khai. Bạn có thể lưu thành chế độ xem mới của riêng mình.",
      other: "Bạn không sửa được chế độ xem này.",
    },
    unsavedHint: "Có thay đổi chưa lưu vào chế độ xem.",
    toast: {
      created: (name: string) => `Đã lưu chế độ xem “${name}”.`,
      saved: "Đã lưu thay đổi vào chế độ xem.",
      renamed: "Đã đổi tên chế độ xem.",
      published: "Đã công khai: mọi người trong dự án thấy chế độ xem này.",
      privatized: "Đã chuyển chế độ xem về riêng tư.",
      deleted: (name: string) => `Đã xóa chế độ xem “${name}”.`,
    },
    errors: {
      notFound:
        "Chế độ xem không còn (có thể vừa bị xóa). Đã tải lại danh sách.",
      forbiddenReloaded: "Đã tải lại danh sách chế độ xem.",
      failed: "Chưa lưu được chế độ xem. Thử lại sau.",
      deleteFailed: "Chưa xóa được chế độ xem. Thử lại sau.",
    },
  },
  blockedTask: {
    badge: "Bị chặn",
    badgeTitle: (count: number) =>
      count === 1
        ? "Bị chặn bởi 1 task chưa xong"
        : `Bị chặn bởi ${count} task chưa xong`,
    bannerTitle: "Task này đang bị chặn",
    bannerBody:
      "Các task dưới đây chưa xong. Bạn vẫn có thể đánh dấu hoàn thành task này (chỉ cảnh báo).",
    listLabel: "Task chặn chưa xong",
    unknownTask: (index: number) => `Task chặn ${index}`,
    more: (count: number) => `và ${count} task khác`,
    toastTitle: (title: string) => `“${title}” đã hoàn thành dù còn bị chặn`,
    toastBody: (titles: string) =>
      `Còn task chặn chưa xong: ${titles}. Hãy kiểm tra lại thứ tự công việc.`,
    toastBodyCount: (count: number) =>
      `Còn ${count} task chặn chưa xong. Hãy kiểm tra lại thứ tự công việc.`,
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
