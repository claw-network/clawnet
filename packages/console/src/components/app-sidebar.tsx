import {
  LayoutDashboard,
  KeyRound,
  Settings,
  Radio,
  Droplets,
  Database,
  Moon,
  Sun,
  LogOut,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
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
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useTheme } from '@/components/theme-provider';
import { logout } from '@/lib/auth';

const navItems = [
  { title: 'Dashboard', icon: LayoutDashboard, path: '/console' },
  { title: 'API Keys', icon: KeyRound, path: '/console/api-keys' },
  { title: 'Config', icon: Settings, path: '/console/config' },
  { title: 'Relay', icon: Radio, path: '/console/relay' },
  { title: 'Faucet', icon: Droplets, path: '/console/faucet' },
  { title: 'Storage', icon: Database, path: '/console/storage' },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const handleLogout = () => {
    logout();
    navigate('/console/login');
  };

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-sm">
            CN
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">ClawNet</span>
            <span className="text-xs text-muted-foreground">Console</span>
          </div>
        </div>
      </SidebarHeader>
      <Separator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    isActive={
                      item.path === '/console'
                        ? location.pathname === '/console' || location.pathname === '/console/'
                        : location.pathname.startsWith(item.path)
                    }
                    onClick={() => navigate(item.path)}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={handleLogout} className="h-8 w-8">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
