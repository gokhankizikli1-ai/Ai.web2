import { useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  ArrowLeft, User, Bell, Shield, Cpu,
  Palette, Trash2,
  Save, AlertTriangle, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import Navbar from '@/sections/Navbar';

const sections = [
  {
    id: 'account',
    label: 'Account',
    icon: User,
    settings: [
      { id: 'display-name', label: 'Display Name', type: 'text', value: 'You' },
      { id: 'email', label: 'Email', type: 'text', value: 'user@korvixai.com' },
      { id: 'language', label: 'Language', type: 'select', value: 'English', options: ['English', 'Spanish', 'French', 'German', 'Chinese'] },
      { id: 'timezone', label: 'Timezone', type: 'select', value: 'UTC-5', options: ['UTC-8', 'UTC-5', 'UTC+0', 'UTC+1', 'UTC+8'] },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    settings: [
      { id: 'dark-mode', label: 'Dark Mode', type: 'toggle', value: true },
      { id: 'compact-mode', label: 'Compact Mode', type: 'toggle', value: false },
      { id: 'font-size', label: 'Font Size', type: 'select', value: 'Medium', options: ['Small', 'Medium', 'Large'] },
      { id: 'animations', label: 'Smooth Animations', type: 'toggle', value: true },
    ],
  },
  {
    id: 'ai',
    label: 'AI Behavior',
    icon: Cpu,
    settings: [
      { id: 'default-mode', label: 'Default Mode', type: 'select', value: 'Fast', options: ['Fast', 'Deep Think', 'Research', 'Creative', 'Coding', 'Study'] },
      { id: 'auto-save', label: 'Auto-save Chats', type: 'toggle', value: true },
      { id: 'stream-response', label: 'Stream Responses', type: 'toggle', value: true },
      { id: 'context-memory', label: 'Extended Context Memory', type: 'toggle', value: true },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    settings: [
      { id: 'sound', label: 'Sound Effects', type: 'toggle', value: true },
      { id: 'browser-notif', label: 'Browser Notifications', type: 'toggle', value: false },
      { id: 'activity-alerts', label: 'AI Activity Alerts', type: 'toggle', value: true },
    ],
  },
  {
    id: 'privacy',
    label: 'Privacy & Security',
    icon: Shield,
    settings: [
      { id: 'data-retention', label: 'Data Retention', type: 'select', value: '30 days', options: ['7 days', '30 days', '90 days', '1 year'] },
      { id: 'share-analytics', label: 'Share Analytics', type: 'toggle', value: false },
    ],
  },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('account');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const currentSection = sections.find((s) => s.id === activeSection) || sections[0];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-foreground">
      <Navbar />

      <main className="pt-24 pb-12 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <Link to="/chat">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-white hover:bg-white/[0.05] rounded-lg">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-white">Settings</h1>
              <p className="text-[12px] text-slate-600">Customize your KorvixAI workspace</p>
            </div>
          </div>

          <div className="flex gap-6">
            {/* Sidebar */}
            <aside className="w-48 shrink-0 hidden md:block">
              <div className="space-y-0.5 sticky top-24">
                {sections.map((section) => {
                  const isActive = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      onClick={() => setActiveSection(section.id)}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-all duration-200 ${
                        isActive
                          ? 'bg-white/[0.06] text-white border border-white/[0.08]'
                          : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.02] border border-transparent'
                      }`}
                    >
                      <section.icon className={`h-4 w-4 ${isActive ? 'text-cyan-400' : 'text-slate-600'}`} />
                      {section.label}
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Content */}
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="flex-1 min-w-0"
            >
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.04]">
                  <currentSection.icon className="h-4 w-4 text-cyan-400/60" />
                  <h2 className="text-[14px] font-semibold text-white">{currentSection.label}</h2>
                </div>

                <div className="divide-y divide-white/[0.03]">
                  {currentSection.settings.map((setting) => (
                    <div key={setting.id} className="flex items-center justify-between px-5 py-4 hover:bg-white/[0.01] transition-colors">
                      <div>
                        <p className="text-[13px] font-medium text-slate-300">{setting.label}</p>
                      </div>

                      {setting.type === 'toggle' && (
                        <Switch
                          checked={!!setting.value}
                          onCheckedChange={() => {}}
                        />
                      )}

                      {setting.type === 'text' && (
                        <input
                          type="text"
                          defaultValue={String(setting.value)}
                          className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 text-[12px] text-white w-48 outline-none focus:border-cyan-500/30 transition-colors"
                        />
                      )}

                      {setting.type === 'select' && (
                        <select
                          defaultValue={String(setting.value)}
                          className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-1.5 text-[12px] text-white outline-none focus:border-cyan-500/30 transition-colors appearance-none cursor-pointer"
                        >
                          {setting.options?.map((opt) => (
                            <option key={opt} value={opt} className="bg-[#0f0f16]">{opt}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Danger zone */}
              {activeSection === 'privacy' && (
                <div className="mt-6 rounded-2xl border border-red-500/[0.08] bg-red-500/[0.02] p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-red-400/60" />
                    <h3 className="text-[13px] font-semibold text-red-400/80">Danger Zone</h3>
                  </div>
                  <p className="text-[12px] text-slate-600 mb-4">These actions cannot be undone.</p>
                  <Button
                    variant="ghost"
                    className="h-8 text-[12px] text-red-400/70 hover:text-red-400 hover:bg-red-500/10 border border-red-500/[0.1] rounded-lg"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete All Conversations
                  </Button>
                </div>
              )}

              {/* Save */}
              <div className="flex justify-end mt-6">
                <Button
                  onClick={handleSave}
                  className="h-9 bg-white text-slate-950 hover:bg-slate-200 text-[12px] font-medium rounded-xl transition-all"
                >
                  {saved ? (
                    <>
                      <Check className="h-3.5 w-3.5 mr-1.5" />
                      Saved
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}
