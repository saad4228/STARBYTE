import { Menu, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { cx } from "../lib/cx";
import { Link, navigate } from "../lib/router";
import { Logo } from "../ui/Logo";
import { PixelLink } from "../ui/PixelButton";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (href: string) => (e: MouseEvent) => {
    e.preventDefault();
    setOpen(false);
    navigate(href);
  };

  return (
    <header className={cx("nav", scrolled && "nav--scrolled", open && "nav--open")}>
      <div className="container nav__inner">
        <Logo />
        <nav className="nav__links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={go(l.href)}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav__actions">
          <Link to="/join" className="nav__join">
            Join Room
          </Link>
          <PixelLink to="/create" size="sm" className="nav__create">
            Create Room
          </PixelLink>
          <button
            type="button"
            className="ibtn nav__menu"
            aria-expanded={open}
            aria-controls="nav-sheet"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      <div id="nav-sheet" className="nav__sheet" hidden={!open}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={go(l.href)}>
            {l.label}
          </a>
        ))}
        <Link to="/join" onClick={() => setOpen(false)}>
          Join Room
        </Link>
        <PixelLink to="/create" block className="nav__sheet-cta">
          Create Room
        </PixelLink>
      </div>
    </header>
  );
}
