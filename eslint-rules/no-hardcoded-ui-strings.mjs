/**
 * Quy tắc ESLint cục bộ (Story E10-2, tiêu chí 2): cấm văn bản giao diện gõ cứng trong JSX.
 * Mọi chuỗi hiển thị phải lấy từ từ điển (lib/i18n/messages/vi.ts, en.ts) qua getStrings() hoặc
 * useStrings().
 *
 * Báo lỗi khi gặp chuỗi có ít nhất một chữ cái (Unicode, nên bắt cả tiếng Việt lẫn tiếng Anh):
 *   - văn bản giữa thẻ JSX: <p>Xin chào</p>
 *   - chuỗi trong biểu thức con của thẻ: <p>{"Hello"}</p>, <p>{ok ? "Có" : "Không"}</p>,
 *     <p>{`Còn ${n} task`}</p>
 *   - thuộc tính người dùng đọc/nghe được: aria-label, aria-description, aria-placeholder,
 *     aria-roledescription, aria-valuetext, placeholder, title, alt, label.
 * Ký hiệu không có chữ cái ("·", "/", "→", "—", số) được phép.
 *
 * Ngoại lệ (hiếm, ví dụ dữ liệu mẫu ở trang /dev/ui) phải ghi rõ lý do:
 *   // eslint-disable-next-line local/no-hardcoded-ui-strings -- <lý do>
 */

const LETTER = /\p{L}/u;

const TEXT_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "placeholder",
  "title",
  "alt",
  "label",
]);

function hasLetter(value) {
  return typeof value === "string" && LETTER.test(value);
}

function attributeName(node) {
  if (node.name.type === "JSXNamespacedName") {
    return `${node.name.namespace.name}:${node.name.name.name}`;
  }
  return node.name.name;
}

/**
 * Leo từ một chuỗi lên qua các biểu thức "chọn giá trị" (a ? "x" : "y", a && "x", a ?? "x") tới
 * nơi chuỗi được hiển thị. Trả "child" nếu là nội dung của thẻ, tên thuộc tính nếu là giá trị của
 * thuộc tính, null nếu chuỗi dùng vào việc khác (className, key, đối số hàm...).
 */
function displayContext(node) {
  let current = node;
  let parent = node.parent;
  while (
    parent &&
    ((parent.type === "ConditionalExpression" && parent.test !== current) ||
      parent.type === "LogicalExpression")
  ) {
    current = parent;
    parent = parent.parent;
  }
  if (!parent || parent.type !== "JSXExpressionContainer") return null;
  const owner = parent.parent;
  if (!owner) return null;
  if (owner.type === "JSXElement" || owner.type === "JSXFragment") {
    return "child";
  }
  if (owner.type === "JSXAttribute") return attributeName(owner);
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Cấm văn bản giao diện gõ cứng trong JSX; dùng từ điển i18n (lib/i18n).",
    },
    schema: [],
    messages: {
      text: "Văn bản gõ cứng trong JSX: “{{text}}”. Đưa vào lib/i18n/messages (vi.ts, en.ts) rồi dùng getStrings()/useStrings().",
      attribute:
        "Thuộc tính {{name}} gõ cứng: “{{text}}”. Đưa vào lib/i18n/messages (vi.ts, en.ts) rồi dùng getStrings()/useStrings().",
    },
  },
  create(context) {
    const preview = (text) => {
      const trimmed = text.trim().replace(/\s+/g, " ");
      return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
    };
    const reportValue = (node, where, text) => {
      if (where === "child") {
        context.report({
          node,
          messageId: "text",
          data: { text: preview(text) },
        });
      } else if (where && TEXT_ATTRIBUTES.has(where)) {
        context.report({
          node,
          messageId: "attribute",
          data: { name: where, text: preview(text) },
        });
      }
    };
    return {
      JSXText(node) {
        if (hasLetter(node.value)) {
          context.report({
            node,
            messageId: "text",
            data: { text: preview(node.value) },
          });
        }
      },
      JSXAttribute(node) {
        const value = node.value;
        if (!value || value.type !== "Literal") return;
        const name = attributeName(node);
        if (TEXT_ATTRIBUTES.has(name) && hasLetter(value.value)) {
          context.report({
            node: value,
            messageId: "attribute",
            data: { name, text: preview(String(value.value)) },
          });
        }
      },
      Literal(node) {
        if (!hasLetter(node.value)) return;
        // Giá trị thuộc tính dạng name="..." đã xét ở JSXAttribute.
        if (node.parent && node.parent.type === "JSXAttribute") return;
        reportValue(node, displayContext(node), String(node.value));
      },
      TemplateLiteral(node) {
        const text = node.quasis.map((q) => q.value.cooked ?? "").join("");
        if (!hasLetter(text)) return;
        reportValue(node, displayContext(node), text);
      },
    };
  },
};

export default rule;
