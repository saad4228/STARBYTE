import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { Link } from "../lib/router";
import { Logo } from "../ui/Logo";
import "./app.css";

interface AppShellProps {
  children: ReactNode;
  /** Where the back link goes; null hides it. */
  back?: string | null;
  backLabel?: string;
  wide?: boolean;
  aside?: ReactNode;
}

/** Shared chrome for the pages around the room: create, join, lobby, legal. */
export function AppShell({ children, back = "/", backLabel = "Home", wide, aside }: AppShellProps) {
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app__sky" aria-hidden="true" />
      <header className="container app__header">
        <Logo />
        <div className="app__header-end">
          {aside}
          {back && (
            <Link to={back} className="app__back">
              <ArrowLeft size={16} aria-hidden="true" />
              {backLabel}
            </Link>
          )}
        </div>
      </header>
      <main id="main" className={cx("container app__main", wide && "app__main--wide")}>
        {children}
      </main>
    </div>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "ok";
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      {title && <strong className="notice__title">{title}</strong>}
      {children && <div className="notice__body">{children}</div>}
    </div>
  );
}
