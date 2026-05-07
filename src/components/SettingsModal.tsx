import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Settings, Moon, Globe, Cpu } from 'lucide-react';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [darkMode, setDarkMode] = useState(true);
  const [language, setLanguage] = useState('English');
  const [model, setModel] = useState('Velora Pro');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#12121a] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Settings className="h-5 w-5 text-slate-400" />
            Settings
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Customize your Velora AI experience.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                <Moon className="h-4 w-4 text-slate-400" />
              </div>
              <div>
                <Label className="text-white">Dark Mode</Label>
                <p className="text-xs text-slate-500">Always on for now</p>
              </div>
            </div>
            <Switch checked={darkMode} onCheckedChange={setDarkMode} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                <Globe className="h-4 w-4 text-slate-400" />
              </div>
              <div>
                <Label className="text-white">Language</Label>
                <p className="text-xs text-slate-500">{language}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={() => setLanguage(language === 'English' ? 'Spanish' : 'English')}>
              Change
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                <Cpu className="h-4 w-4 text-slate-400" />
              </div>
              <div>
                <Label className="text-white">Model</Label>
                <p className="text-xs text-slate-500">{model}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white" onClick={() => setModel(model === 'Velora Pro' ? 'Velora Ultra' : 'Velora Pro')}>
              Switch
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => onOpenChange(false)} className="bg-white text-slate-900 hover:bg-slate-200">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
