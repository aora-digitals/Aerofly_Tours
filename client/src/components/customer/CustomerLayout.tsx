import { useMemo } from "react";
import {
  CalendarDays,
  Clock3,
  Heart,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings2,
  UserRound,
  Eye,
  Bell,
  Plane,
  MessageSquareText,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Profile", href: "/dashboard/profile", icon: UserRound },
  { label: "Preferences", href: "/dashboard/preferences", icon: Settings2 },
  { label: "Wishlist", href: "/dashboard/wishlist", icon: Heart },
  { label: "Recently Viewed", href: "/dashboard/recently-viewed", icon: Eye },
  { label: "My Enquiries", href: "/dashboard/enquiries", icon: MessageSquareText },
  { label: "Appointments", href: "/dashboard/appointments", icon: CalendarDays },
  { label: "Callbacks", href: "/dashboard/callbacks", icon: Clock3 },
  { label: "Activity", href: "/dashboard/activity", icon: ListChecks },
];

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const initials = useMemo(() => {
    const value = user?.name?.trim() || user?.email || "A";
    return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }, [user?.name, user?.email]);

  return (
    <div className="min-h-screen bg-[#f3ede5]">
      <Header />
      <main className="container py-6 sm:py-8">
        <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-3 lg:sticky lg:top-24">
            <div className="flex items-center gap-3 rounded-xl bg-[#f8f4ee] p-3">
              <Avatar className="h-10 w-10 border border-[#eadfd5]">
                <AvatarFallback className="bg-[#fff0e8] text-[#c94d1c]">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-extrabold text-[#20201e]">{user?.name || "AeroFly traveller"}</p>
                <p className="truncate text-[11px] text-[#77736c]">{user?.email}</p>
              </div>
            </div>

            <nav className="mt-3 space-y-1" aria-label="Customer account">
              {navigation.map((item) => {
                const active = item.href === "/dashboard" ? location === item.href : location.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <span className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-bold transition-colors",
                      active ? "bg-[#fff0e8] text-[#c94d1c]" : "text-[#6f6c66] hover:bg-[#f8f4ee] hover:text-[#20201e]",
                    )}>
                      <Icon size={16} />
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="my-3 border-t border-[#eee9e1]" />
            <Link href="/tours">
              <span className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-bold text-[#6f6c66] hover:bg-[#f8f4ee]">
                <Plane size={16} /> Explore tours
              </span>
            </Link>
            <Link href="/dashboard/notifications">
              <span className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-bold text-[#6f6c66] hover:bg-[#f8f4ee]">
                <Bell size={16} /> Notifications
              </span>
            </Link>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void logout()}
              className="mt-1 h-10 w-full justify-start gap-3 rounded-xl px-3 text-[12px] font-bold text-[#77736c] hover:bg-[#fff0e8] hover:text-[#c94d1c]"
            >
              <LogOut size={16} /> Sign out
            </Button>
          </aside>

          <section className="min-w-0">{children}</section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
