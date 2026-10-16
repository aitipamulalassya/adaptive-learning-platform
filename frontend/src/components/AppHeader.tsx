import { Brain, GraduationCap, Menu } from 'lucide-react';
import { ThemeToggle} from '../auth';

import { useNavigate } from 'react-router-dom';
type AppHeaderProps = {
  userName?: string;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onSignOut: () => void | Promise<void>;
};

export default function AppHeader({ userName, sidebarOpen, onOpenSidebar, onSignOut }: AppHeaderProps) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90">
      <div className="flex h-[72px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button type="button" onClick={onOpenSidebar} aria-label="Open navigation menu" aria-expanded={sidebarOpen}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 lg:hidden">
          <Menu size={21} />
        </button>
        <button type="button" onClick={() => navigate('/app/dashboard')} className="flex min-w-0 items-center gap-3 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/20"><Brain size={22} /></span>
          <span className="min-w-0"><span className="block truncate text-base font-bold tracking-tight text-slate-900 dark:text-white sm:text-lg">AdaptiveLearning</span><span className="hidden text-xs text-slate-500 sm:block">Learn at your own pace</span></span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="hidden max-w-44 items-center gap-2 truncate text-sm text-slate-500 md:flex"><GraduationCap size={18} className="shrink-0" /><span className="truncate">{userName ?? 'Student workspace'}</span></div>
          
          <ThemeToggle compact />
          <button type="button" onClick={() => void onSignOut()} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Sign out</button>
        </div>
      </div>
    </header>
  );
}
