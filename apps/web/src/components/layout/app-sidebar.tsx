import type { ComponentType } from 'react';
import { APP_VERSION } from '@mcproute/shared';
import { Activity, Globe, LayoutDashboard, Route, ScrollText, Server, Waypoints } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { UserMenu } from './user-menu';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Gateway',
    items: [
      { to: '/providers', label: 'Providers', icon: Server },
      { to: '/endpoints', label: 'Endpoints', icon: Waypoints },
      { to: '/proxies', label: 'Proxies', icon: Globe },
    ],
  },
  {
    label: 'Monitoring',
    items: [
      { to: '/sessions', label: 'Sessions', icon: Activity },
      { to: '/logs', label: 'Logs', icon: ScrollText },
    ],
  },
];

export function isNavActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}

export function AppSidebar({ username }: { username: string }) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" onClick={closeOnMobile}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Route className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">MCPRoute</span>
                  <span className="truncate text-xs text-muted-foreground">v{APP_VERSION}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isNavActive(item.to, pathname)} tooltip={item.label}>
                      <Link to={item.to} onClick={closeOnMobile}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu username={username} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
