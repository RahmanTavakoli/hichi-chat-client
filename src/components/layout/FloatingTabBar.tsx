import React, { useState } from "react";
import { MessageSquare, Trash2, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { clearAllDatabase } from "../../services/db";

export function FloatingTabBar() {
  const { logout } = useAuth();
  const [isClearing, setIsClearing] = useState(false);

  // ─── تابع حذف کل داده‌های کلاینت ──────────────────────────────────────────
  const handleClearData = async () => {
    const confirmDelete = window.confirm(
      "🚨 توجه: تمام پیام‌ها و مخاطبین شما از روی حافظه این مرورگر حذف خواهند شد. آیا مطمئن هستید؟"
    );
    
    if (confirmDelete) {
      setIsClearing(true);
      try {
        await clearAllDatabase();
        // رفرش کردن صفحه باعث می‌شود تمام استیت‌های رم (RAM) نیز پاک شوند
        window.location.reload(); 
      } catch (err) {
        console.error("Failed to clear database:", err);
        setIsClearing(false);
      }
    }
  };

  // ─── تابع خروج از حساب ───────────────────────────────────────────────────
  const handleLogout = async () => {
    const confirmLogout = window.confirm("آیا می‌خواهید از حساب کاربری خود خارج شوید؟");
    if (confirmLogout) {
      // پیشنهاد امنیتی: قبل از خروج، دیتابیس لوکال را هم پاک کنیم تا دیتای کاربر روی سیستم نماند
      await clearAllDatabase();
      logout();
    }
  };

  return (
    <div className=" -m-6 z-50 pointer-events-none">
      <div className="w-[200px] mx-auto bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl rounded-full flex justify-around items-center shadow-2xl pointer-events-auto transition-all duration-500">
        
        {/* دکمه چت‌ها (فعال) */}
        <button className="relative group px-4 py-2 flex flex-col items-center transition-all duration-300 text-blue-600 dark:text-blue-400 scale-110">
          <MessageSquare size={15} />
          <span className="text-[8px] font-bold mt-1">Chats</span>
          <span className="absolute -bottom-0 w-1 h-1 bg-blue-600 rounded-full"></span>
        </button>

        {/* دکمه پاکسازی دیتابیس */}
        <button 
          onClick={handleClearData} 
          disabled={isClearing}
          className="relative group px-4 py-2 flex flex-col items-center transition-all duration-300 text-slate-400 hover:text-red-500 disabled:opacity-50"
        >
          {isClearing ? <Loader2 size={22} className="animate-spin text-red-500" /> : <Trash2 size={15} />}
          <span className="text-[8px] font-bold mt-1">Clear Data</span>
        </button>

        {/* دکمه خروج */}
        <button 
          onClick={handleLogout}
          className="relative group px-4 py-2 flex flex-col items-center transition-all duration-300 text-slate-400 hover:text-rose-500"
        >
          <LogOut size={15} />
          <span className="text-[8px] font-bold mt-1">Logout</span>
        </button>

      </div>
    </div>
  );
}