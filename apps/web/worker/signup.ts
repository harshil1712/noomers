/** Sign-up gate: "true" always closed, "false" always open, unset closes
 * once any admin exists (the first verified account becomes admin). */
export async function signupOpen(env: Env): Promise<boolean> {
  if (env.SIGNUP_DISABLED === "true") return false;
  if (env.SIGNUP_DISABLED === "false") return true;
  const row = await env.DB.prepare("SELECT 1 AS x FROM user WHERE role = 'admin' LIMIT 1").first();
  return row === null;
}
