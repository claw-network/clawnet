import {
  LayoutDashboard,
  KeyRound,
  Settings,
  Radio,
  Droplets,
  Database,
  ShieldCheck,
  Moon,
  Sun,
  LogOut,
  Vote,
  Layers,
  Coins,
  FileCheck,
  Lock,
  PieChart,
  UserCog,
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
import { useNode } from '@/lib/node-context';

interface NavItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  /** If set, only show on these networks. Omit to show always. */
  networks?: string[];
}

const nodeItems: NavItem[] = [
  { title: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { title: 'API Keys', icon: KeyRound, path: '/api-keys' },
  { title: 'Config', icon: Settings, path: '/config' },
  { title: 'Relay', icon: Radio, path: '/relay' },
  { title: 'Storage', icon: Database, path: '/storage' },
  { title: 'Security', icon: ShieldCheck, path: '/security' },
];

const blockchainItems: NavItem[] = [
  { title: 'Governance', icon: Vote, path: '/governance', networks: ['testnet', 'mainnet'] },
  { title: 'Staking', icon: Layers, path: '/staking', networks: ['testnet', 'mainnet'] },
  { title: 'Token', icon: Coins, path: '/token', networks: ['testnet', 'mainnet'] },
  { title: 'Contracts', icon: FileCheck, path: '/contracts', networks: ['testnet', 'mainnet'] },
  { title: 'Escrow', icon: Lock, path: '/escrow', networks: ['testnet', 'mainnet'] },
  { title: 'Faucet', icon: Droplets, path: '/faucet', networks: ['testnet', 'mainnet'] },
  { title: 'Ecosystem', icon: PieChart, path: '/ecosystem', networks: ['testnet', 'mainnet'] },
  { title: 'Accounts', icon: UserCog, path: '/accounts', networks: ['testnet', 'mainnet'] },
];

export function AppSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { network } = useNode();

  const filterItems = (items: NavItem[]) =>
    items.filter((item) => !item.networks || (network && item.networks.includes(network)));

  const visibleNodeItems = filterItems(nodeItems);
  const visibleBlockchainItems = filterItems(blockchainItems);

  const isActive = (path: string) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path);

  const handleLogout = () => {
    logout();
    navigate('/login');
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
          <SidebarGroupLabel>Node Management</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNodeItems.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton isActive={isActive(item.path)} onClick={() => navigate(item.path)}>
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {visibleBlockchainItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Blockchain</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleBlockchainItems.map((item) => (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton isActive={isActive(item.path)} onClick={() => navigate(item.path)}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
