import { Gear, House, ShieldCheck, type Icon } from "@phosphor-icons/react";

export interface NavItem {
  label: string;
  to: "/dashboard" | "/settings" | "/admin";
  icon: Icon;
  adminOnly?: boolean;
}

/** Sidebar navigation. Labels double as page titles — keep them in sync. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: House },
  { label: "Settings", to: "/settings", icon: Gear },
  { label: "Admin", to: "/admin", icon: ShieldCheck, adminOnly: true },
];

export function navItemsFor(role: string | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");
}
