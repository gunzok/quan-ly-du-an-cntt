-- QLDA-81: chặn xóa task cha còn việc con (quyết định 2026-11-18).
-- Thay hành vi của E2-2 (20261114090000_tasks.sql): khóa ngoại tasks.parent_id ON DELETE CASCADE
-- xóa dây chuyền mọi hậu duệ, kể cả việc con do người khác tạo, và bỏ qua RLS (hành động dây chuyền
-- của khóa ngoại chạy với quyền chủ bảng). Nay xóa một task còn ≥ 1 việc con (bất kỳ cấp, vì cháu
-- luôn có cha là con trực tiếp) bị TỪ CHỐI với mọi vai trò và mọi đường ghi, kể cả service_role:
-- phải xóa hoặc chuyển các việc con đi trước (đổi parent_id, E2-4).
--
-- Cơ chế: đổi khóa ngoại sang ON DELETE NO ACTION (không dùng trigger BEFORE DELETE).
--   * NO ACTION kiểm ở CUỐI câu lệnh (khác RESTRICT kiểm ngay từng dòng). Xóa dự án
--     (projects → tasks ON DELETE CASCADE) xóa MỌI task của dự án trong cùng một câu lệnh dây chuyền,
--     nên khi kiểm thì không còn việc con nào trỏ tới: xóa dự án vẫn chạy. Một câu lệnh tự xóa cả cha
--     lẫn toàn bộ hậu duệ (`delete ... where id in (cha, con, cháu)`) cũng qua, đúng nghĩa "xóa các
--     việc con trước".
--   * Xóa tài khoản (auth.users → profiles ON DELETE CASCADE) không xóa task, chỉ đặt
--     tasks.assignee_id / created_by = null (ON DELETE SET NULL): không liên quan khóa ngoại này.
--   * Khóa ngoại áp dụng cho mọi vai trò (kể cả service_role, postgres) và không phụ thuộc RLS.
--   * Đồng thời: kiểm khóa ngoại khóa dòng cha (FOR KEY SHARE khi tạo/chuyển con, khóa dòng khi xóa
--     cha), nên "xóa cha" và "thêm việc con vào cha đó" chạy song song không thể cùng lọt. Trigger
--     BEFORE DELETE tự viết phải tự lo khóa để đạt điều này, và phải tự nhận biết "đang xóa cả dự án"
--     (trigger dòng không biết câu lệnh gốc) để miễn trừ: phức tạp hơn mà không thêm gì.
-- Lỗi: SQLSTATE 23503, constraint `tasks_parent_id_fkey` (giữ tên cũ). API DELETE /tasks/{id} ánh xạ
-- sang 422 `business_rule_violated` kèm `subtask_count` (lib/tasks/handlers.ts).
--
-- Khóa: ALTER TABLE giữ ACCESS EXCLUSIVE trên tasks trong lúc kiểm lại khóa ngoại (một lần quét;
-- dữ liệu cũ chắc chắn hợp lệ vì khóa ngoại cũ đã bảo đảm). Bảng nhỏ, chấp nhận được.

alter table public.tasks
  drop constraint tasks_parent_id_fkey,
  add constraint tasks_parent_id_fkey
    foreign key (parent_id) references public.tasks (id) on delete no action;

comment on constraint tasks_parent_id_fkey on public.tasks is
  'QLDA-81: không xóa được task còn việc con (NO ACTION, kiểm cuối câu lệnh nên xóa dự án dây chuyền vẫn chạy).';
