import {
  LayoutDashboard,
  ClipboardList,
  Brain,
  History,
  UserRound,
  X,
  GraduationCap,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  currentPath: string;
};

const navigationItems = [
  { label: "Dashboard", path: "/app/dashboard", icon: LayoutDashboard },
  { label: "Exams", path: "/app/tests", icon: ClipboardList },
  { label: "AI Tutor", path: "/app/tutor", icon: Brain },
  { label: "Test History", path: "/app/history", icon: History },
];

const profileItem = {
  label: "Profile",
  path: "/app/profile",
  icon: UserRound,
};

export default function Sidebar({ open, onClose, currentPath }: SidebarProps) {
  const routerNavigate = useNavigate();
  const location = useLocation();
  const activePath = location.pathname || currentPath;

  const isActive = (path: string) => {
    if (path === "/app/tests") {
      return activePath === path || activePath.startsWith("/app/tests/");
    }
    return activePath === path;
  };

  const handleNavigate = (path: string) => {
    onClose();
    if (activePath !== path) routerNavigate(path);
  };

  const renderNavigationItem = (
    item: (typeof navigationItems)[number] | typeof profileItem,
  ) => {
    const Icon = item.icon;
    const active = isActive(item.path);

    return (
      <button
        key={item.path}
        type="button"
        onClick={() => handleNavigate(item.path)}
        aria-current={active ? "page" : undefined}
        className={`
          flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left
          text-sm font-medium transition-colors
          ${
            active
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          }
        `}
      >
        <Icon size={19} />
        <span>{item.label}</span>
      </button>
    );
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        aria-label="Main navigation"
        className={`
          fixed bottom-0 left-0 top-0 z-50 flex w-72 flex-col
          border-r border-slate-200/80 bg-white shadow-xl shadow-slate-900/5
          transition-transform duration-300 dark:border-slate-800 dark:bg-slate-900
          lg:top-[72px] lg:z-30 lg:h-[calc(100vh-72px)] lg:overflow-y-auto
          lg:shadow-none lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-5 dark:border-slate-800 lg:hidden">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <GraduationCap size={23} />
            </span>
            <div>
              <p className="font-bold text-slate-900 dark:text-white">AdaptiveLearning</p>
              <p className="text-xs text-slate-500">Learning workspace</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-6">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Workspace
          </p>
          <nav className="space-y-1">{navigationItems.map(renderNavigationItem)}</nav>
        </div>

        <div className="mt-auto border-t border-slate-200/80 p-4 dark:border-slate-800">
          {renderNavigationItem(profileItem)}
        </div>
      </aside>
    </>
  );
}
