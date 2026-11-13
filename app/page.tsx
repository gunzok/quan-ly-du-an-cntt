import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { signOut } from "@/lib/auth/actions";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>{strings.app.name}</h1>
      <Suspense fallback={<p role="status">{strings.home.loading}</p>}>
        <CurrentUser />
      </Suspense>
    </main>
  );
}

async function CurrentUser() {
  // Phần này luôn chạy theo request (supabase-js đọc giờ hiện tại để kiểm hạn phiên).
  await connection();
  const supabase = await createClient();
  // getUser hỏi Supabase Auth: phiên đã thu hồi thì không còn hợp lệ (proxy chỉ kiểm tra lạc quan).
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    redirect(LOGIN_PATH);
  }

  return (
    <>
      <p>
        {strings.home.signedInAs} <strong>{data.user.email}</strong>
      </p>
      <p className={styles.muted}>{strings.home.placeholder}</p>
      <form action={signOut}>
        <button type="submit" className={styles.button}>
          {strings.home.signOut}
        </button>
      </form>
    </>
  );
}
