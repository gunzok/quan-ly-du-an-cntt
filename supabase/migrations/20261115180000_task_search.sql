-- QLDA-48 (Story E3-3): tìm kiếm task bỏ dấu tiếng Việt (FR-09, database.md mục 4).
--
-- Quyết định đã chốt (thay [CẦN XÁC NHẬN] của tiêu chí 1): tìm BỎ DẤU và không phân biệt hoa
-- thường bằng extension unaccent ("bao cao" khớp "Báo cáo" và ngược lại, "dang" khớp "Đăng").
-- Không làm fuzzy/sửa lỗi gõ. Khớp theo "chứa chuỗi": mỗi từ khóa (tách theo khoảng trắng) phải
-- xuất hiện trong tiêu đề hoặc mô tả (AND).
--
-- Phương án (đơn giản nhất đủ dùng):
--   * Chỉ mục GIN pg_trgm trên BIỂU THỨC private.task_search_text(title, description), không thêm
--     cột sinh: thêm cột vào tasks sẽ làm nhật ký activity_logs (to_jsonb(new)) ghi cả cột đó.
--   * Hàm public.search_tasks(project_id, q, label_id?) (SECURITY INVOKER, RLS của tasks vẫn áp
--     dụng; lấy id khớp qua private.search_task_ids, xem mục 4) trả về setof public.tasks để API
--     gọi qua PostgREST rpc() mà vẫn nhúng task_labels, lọc, sắp xếp, phân trang như GET bảng
--     tasks (riêng lọc nhãn làm trong hàm). Bỏ dấu và thoát ký tự LIKE làm trong SQL (một nơi duy
--     nhất), không phụ thuộc cách PostgREST hiểu ký tự `*` trong toán tử like.
--   * tsvector không dùng: chỉ khớp theo từ/tiền tố, không khớp "chứa chuỗi".

-- ---------------------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------------------
-- unaccent đã bật ở 20261113044119_init_base.sql (schema extensions). pg_trgm cho chỉ mục GIN
-- phục vụ LIKE '%...%'.
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. Hàm chuẩn hóa (IMMUTABLE để dùng trong chỉ mục)
-- ---------------------------------------------------------------------------
-- extensions.unaccent(text) chỉ là STABLE (phụ thuộc search_path để tìm từ điển); gọi bản hai
-- tham số với từ điển ghi rõ schema thì kết quả cố định, nên bọc lại là IMMUTABLE được.
-- Bỏ dấu trước rồi mới lower(): 'Đ' -> 'D' -> 'd'. unaccent cũng bỏ dấu dạng tổ hợp (NFD).
-- SECURITY DEFINER theo quy ước của schema private (mọi hàm ở đây đều vậy, rls-profiles.test.sql
-- kiểm); ba hàm thuần túy này không đọc bảng nào nên không mở thêm quyền. Mệnh đề SET search_path
-- vốn đã làm hàm không được inline, nên DEFINER không tốn thêm chi phí.
create or replace function private.search_normalize(p_text text)
returns text
language sql
immutable
strict
parallel safe
security definer
set search_path = ''
as $$
  select pg_catalog.lower(extensions.unaccent('extensions.unaccent'::regdictionary, p_text));
$$;
comment on function private.search_normalize(text) is
  'Bỏ dấu tiếng Việt và chữ hoa để tìm kiếm (QLDA-48). IMMUTABLE để dùng trong chỉ mục.';

-- Văn bản tìm kiếm của một task: tiêu đề và mô tả, ngăn bằng khoảng trắng nên một từ khóa
-- (không chứa khoảng trắng) không khớp vắt qua ranh giới hai trường.
create or replace function private.task_search_text(p_title text, p_description text)
returns text
language sql
immutable
parallel safe
security definer
set search_path = ''
as $$
  select private.search_normalize(p_title || ' ' || coalesce(p_description, ''));
$$;
comment on function private.task_search_text(text, text) is
  'Biểu thức của chỉ mục tasks_search_trgm_idx; truy vấn phải dùng đúng biểu thức này.';

revoke all on function private.search_normalize(text) from public, anon, authenticated;
revoke all on function private.task_search_text(text, text) from public, anon, authenticated;
-- Postgres kiểm quyền EXECUTE khi tính biểu thức chỉ mục lúc INSERT/UPDATE tasks, nên mọi vai trò
-- ghi task (authenticated qua API, service_role ở đường quản trị/test) cần quyền này. Hai hàm
-- thuần túy, không đọc bảng nào, không lộ dữ liệu. (service_role đã có USAGE trên schema private
-- từ 20261114123700_rate_limit.sql; cấp lại cho chắc.)
grant usage on schema private to service_role;
grant execute on function private.search_normalize(text) to authenticated, service_role;
grant execute on function private.task_search_text(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Chỉ mục
-- ---------------------------------------------------------------------------
create index tasks_search_trgm_idx on public.tasks
  using gin (private.task_search_text(title, description) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 4. Hàm tìm kiếm cho API
-- ---------------------------------------------------------------------------
-- Vì sao hai lớp: dưới RLS, điều kiện LIKE của người dùng (toán tử không LEAKPROOF) không được
-- dùng làm điều kiện chỉ mục, nên một hàm SECURITY INVOKER thuần túy luôn quét toàn bộ task của
-- dự án và tính bỏ dấu từng dòng (đo: ~160 ms với 5.000 task, xem mô tả PR). Do đó:
--   (a) private.search_task_ids: SECURITY DEFINER, chỉ trả id task KHỚP trong ĐÚNG dự án được
--       hỏi, và chỉ khi người gọi đang thấy được dự án đó (Admin đang hoạt động hoặc thành viên
--       chưa bị khóa, cùng điều kiện với chính sách tasks_select). Truy vấn dựng bằng EXECUTE với
--       tham số nên mỗi lần được lập kế hoạch theo đúng mẫu tìm và dùng được chỉ mục trigram.
--   (b) public.search_tasks: SECURITY INVOKER, đọc public.tasks qua RLS rồi giữ các id ở (a).
--       RLS vẫn quyết định cuối cùng người gọi thấy gì.
--
-- Từ khóa: bỏ dấu, tách theo khoảng trắng, thoát \ % _ (ký tự thoát mặc định của LIKE là \) rồi
-- bọc '%...%'; mọi mẫu phải khớp, mỗi mẫu một điều kiện LIKE (GIN không dùng được cho
-- LIKE ALL(mảng)). Không có từ khóa (rỗng, chỉ khoảng trắng) hoặc từ
-- khóa dài quá 200 ký tự: trả tập rỗng (API đã chặn trước; đây là chốt chặn khi gọi thẳng
-- /rest/v1/rpc).
create or replace function private.search_patterns(p_q text)
returns text[]
language sql
immutable
parallel safe
security definer
set search_path = ''
as $$
  select array_agg(
           '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           order by char_length(w) desc, w
         )
  from regexp_split_to_table(private.search_normalize(p_q), '[[:space:]]+') as w
  where w <> '' and char_length(p_q) <= 200;
$$;
comment on function private.search_patterns(text) is
  'Mẫu LIKE (đã thoát \ % _) cho từng từ khóa đã bỏ dấu; null nếu không có từ khóa (QLDA-48).';

create or replace function private.search_task_ids(p_project_id uuid, p_q text)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_patterns text[];
begin
  -- Cùng điều kiện đọc với chính sách tasks_select: không thấy dự án thì không trả gì, kể cả
  -- khi từ khóa khớp (không làm "máy dò" nội dung dự án khác).
  if not (private.is_admin() or private.project_role_of(p_project_id) is not null) then
    return;
  end if;
  v_patterns := private.search_patterns(p_q);
  if v_patterns is null then
    return;
  end if;
  -- Mỗi mẫu là một điều kiện LIKE riêng để chỉ mục GIN giao các trigram của mọi từ khóa (ít dòng
  -- phải kiểm lại hơn). Văn bản truy vấn chỉ chứa số thứ tự, giá trị mẫu truyền qua USING.
  return query execute
    'select t.id from public.tasks t where t.project_id = $1'
    || (
      select string_agg(
               format(' and private.task_search_text(t.title, t.description) like $2[%s]', i),
               '' order by i)
      from generate_series(1, pg_catalog.array_length(v_patterns, 1)) as i
    )
    using p_project_id, v_patterns;
end;
$$;
comment on function private.search_task_ids(uuid, text) is
  'Id task khớp từ khóa trong một dự án người gọi được thấy (QLDA-48). Chỉ public.search_tasks dùng.';

-- p_label_id (tùy chọn): lọc theo nhãn ngay trong hàm, vì PostgREST (v14) không áp được bộ lọc
-- trên bảng nhúng (task_labels!inner) cho kết quả của RPC. task_labels đọc qua RLS của người gọi.
create or replace function public.search_tasks(
  p_project_id uuid,
  p_q text,
  p_label_id uuid default null
)
returns setof public.tasks
language sql
stable
set search_path = ''
as $$
  select t.*
  from public.tasks t
  where t.project_id = p_project_id
    and t.id in (select private.search_task_ids(p_project_id, p_q))
    and (
      p_label_id is null
      or exists (
        select 1 from public.task_labels tl
        where tl.task_id = t.id and tl.label_id = p_label_id
      )
    );
$$;
comment on function public.search_tasks(uuid, text, uuid) is
  'Tìm task trong dự án theo từ khóa, bỏ dấu, mọi từ phải có (QLDA-48). RLS của tasks áp dụng.';

revoke all on function private.search_patterns(text) from public, anon, authenticated;
revoke all on function private.search_task_ids(uuid, text) from public, anon, authenticated;
grant execute on function private.search_task_ids(uuid, text) to authenticated;
revoke all on function public.search_tasks(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.search_tasks(uuid, text, uuid) to authenticated;
