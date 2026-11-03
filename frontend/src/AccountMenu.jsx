import { useTranslation } from "react-i18next";

export function AccountMenu({ user }) {
  const { t } = useTranslation("mapper");
  if (!user) return null;
  return <div className="account-menu">
    {user.avatarUrl && <img src={user.avatarUrl} alt="" width="28" height="28" />}
    <span className="account-name" title={user.name}>{user.name}</span>
    <form method="post" action="/auth/logout/">
      <input type="hidden" name="csrfmiddlewaretoken" value={document.getElementById("mapper-root").dataset.csrfToken} />
      <button className="text-button" type="submit">{t("auth.signOut")}</button>
    </form>
  </div>;
}
