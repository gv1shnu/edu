"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  BookOpen,
  NotebookPen,
  Trophy,
  Settings,
  ArrowUpRight,
  Sun,
  Moon,
  PanelLeft,
  Search,
  LogOut,
  ShieldCheck,
  Command,
} from "lucide-react";
import { Dialog } from "./ui";
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient();
export function Shell({
  user,
  children,
}: {
  user: any;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [command, setCommand] = useState(false);
  const [search, setSearch] = useState("");
  const staff =
    user?.isAdmin || user?.memberships?.some((m: any) => m.role !== "student");
  const workspace =
    !!user &&
    !["/", "/courses", "/contact", "/terms", "/privacy"].includes(path) &&
    !path.startsWith("/courses/") &&
    !path.startsWith("/u/");
  const links = staff
    ? [
        { href: "/teach", label: "Courses", icon: BookOpen },
        ...(user.isAdmin
          ? [{ href: "/admin", label: "Administration", icon: ShieldCheck }]
          : []),
      ]
    : [
        { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
        { href: "/courses", label: "Courses", icon: BookOpen },
        { href: "/notes", label: "Class notes", icon: NotebookPen },
        { href: "/leagues", label: "League", icon: Trophy },
      ];
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand(true);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {workspace ? (
        <>
          <aside className={`sidebar ${menu ? "visible" : ""}`}>
            <Link href="/" className="brand" aria-label="Vishnu / Learn">
              <span className="brand-mark" aria-hidden="true">
                v<span>.</span>
              </span>
            </Link>
            <div className="workspace-label">
              {staff ? "TEACHING" : "YOUR CLASSROOM"}
            </div>
            <nav>
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMenu(false)}
                  className={path === href ? "active" : ""}
                >
                  <Icon size={19} />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="sidebar-bottom">
              {!staff && (
                <>
                  <div className="tutor-card">
                    <Link href="https://vishnugandarapu.in">
                      Contact <ArrowUpRight size={16} />
                    </Link>
                  </div>
                  <Link className="sidebar-settings" href="/settings/profile">
                    <Settings size={18} />
                    Profile & settings
                  </Link>
                </>
              )}
              <button
                className="button ghost full"
                onClick={() => {
                  authClient.signOut().then(() => {
                    router.push("/");
                    router.refresh();
                  });
                }}
              >
                Sign out
                <LogOut size={16} />
              </button>
            </div>
          </aside>
          <header className="workspace-header">
            <div className="row">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMenu(!menu)}
              >
                <PanelLeft size={20} />
              </button>
              <span className="breadcrumb">
                {staff ? "Teaching" : "Your classroom"} <span>/</span>{" "}
                {path.startsWith("/teach")
                  ? "Courses"
                  : path.startsWith("/admin")
                    ? "Administration"
                    : path.split("/")[1]?.replaceAll("-", " ")}
              </span>
            </div>
            <div className="row">
              <button
                className="search-trigger"
                onClick={() => setCommand(true)}
              >
                <Search size={16} />
                <span>Search</span>
                <kbd>⌘ K</kbd>
              </button>
              <button
                className="icon-button"
                aria-label="Toggle color theme"
                onClick={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
              >
                <Sun size={19} />
              </button>
            </div>
          </header>
        </>
      ) : (
        <header className={`public-header ${path === "/" ? "home-nav" : ""}`}>
          <Link href="/" className="brand" aria-label="Vishnu / Learn">
            <span className="brand-mark" aria-hidden="true">
              v<span>.</span>
            </span>
          </Link>
          <nav>
            <Link href="/courses">Courses</Link>
            {!staff && <Link href="https://vishnugandarapu.in">Contact</Link>}
          </nav>
          <div className="row">
            <button
              className="icon-button"
              aria-label="Toggle color theme"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              <Moon size={18} />
            </button>
            <Link
              className="button small-button"
              href={user ? "/dashboard" : "/login"}
            >
              {user ? "Dashboard" : "Sign in"}
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </header>
      )}
      <main id="main" className={workspace ? "workspace-main" : "public-main"}>
        {children}
      </main>
      {!workspace && (
        <footer>
          <Link href="/" className="brand" aria-label="Vishnu / Learn">
            <span className="brand-mark" aria-hidden="true">
              v<span>.</span>
            </span>
          </Link>
          <div>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/tutor/login">Tutor sign in</Link>
          </div>
          <small>© {new Date().getFullYear()} Vishnu Gandarapu</small>
        </footer>
      )}
      <Dialog open={command} onOpenChange={setCommand} title="Go somewhere">
        <input
          autoFocus
          placeholder="Search pages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="command-list">
          {[
            ...links,
            ...(!staff
              ? [
                  {
                    href: "/settings/profile",
                    label: "Edit profile",
                    icon: Settings,
                  },
                ]
              : []),
          ]
            .filter((l) => l.label.toLowerCase().includes(search.toLowerCase()))
            .map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setCommand(false)}>
                <Icon size={19} />
                {label}
                <Command size={14} />
              </Link>
            ))}
        </div>
      </Dialog>
    </>
  );
}
