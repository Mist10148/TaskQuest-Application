import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useT } from "@/i18n/useT";

const NotFound = () => {
  const location = useLocation();
  const t = useT();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">{t("notFound.title")}</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t("notFound.message")}</p>
        <a href="/" className="text-primary-text underline hover:text-primary-text/90">
          {t("notFound.home")}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
