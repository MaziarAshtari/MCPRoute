import { useQueryClient } from '@tanstack/react-query';
import { ChevronsUpDown, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { useLogout } from '@/queries/auth';
import { queryKeys } from '@/queries/query-keys';

export function UserMenu({ username }: { username: string }) {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useLogout();

  async function signOut() {
    try {
      await logout.mutateAsync();
    } catch {
      return;
    }
    navigate('/login', { replace: true });
    queryClient.clear();
    queryClient.setQueryData(queryKeys.me, null);
    toast.success('Signed out');
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" aria-label="User menu">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg uppercase">{username.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{username}</span>
                <span className="truncate text-xs text-muted-foreground">Administrator</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" className="min-w-56">
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{username}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={logout.isPending} onSelect={() => void signOut()}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
