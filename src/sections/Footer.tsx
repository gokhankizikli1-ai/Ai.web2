import { Link } from 'react-router';
import { Github, Twitter, Linkedin, Sparkles } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="border-t border-slate-200/80 bg-slate-50/80 py-14">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 mb-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 font-bold text-lg text-slate-900 mb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              KorvixAI
            </Link>
            <p className="text-[13px] text-slate-500 leading-relaxed">
              Intelligence, refined. Built for the future of work.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="font-semibold text-slate-800 mb-3 text-[13px]">Product</h4>
            <ul className="space-y-2.5">
              <li>
                <Link to="/features" className="text-[13px] text-slate-500 hover:text-slate-800 transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link to="/pricing" className="text-[13px] text-slate-500 hover:text-slate-800 transition-colors">
                  Pricing
                </Link>
              </li>
              <li>
                <Link to="/workspace" className="text-[13px] text-slate-500 hover:text-slate-800 transition-colors">
                  Workspace
                </Link>
              </li>
              <li>
                <Link to="/agents" className="text-[13px] text-slate-500 hover:text-slate-800 transition-colors">
                  AI Agents
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="font-semibold text-slate-800 mb-3 text-[13px]">Company</h4>
            <ul className="space-y-2.5">
              <li>
                <Link to="/about" className="text-[13px] text-slate-500 hover:text-slate-800 transition-colors">
                  About
                </Link>
              </li>
              <li>
                <span className="text-[13px] text-slate-400 cursor-default flex items-center gap-1">
                  Blog <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200/60">Soon</span>
                </span>
              </li>
              <li>
                <span className="text-[13px] text-slate-400 cursor-default flex items-center gap-1">
                  Careers <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200/60">Soon</span>
                </span>
              </li>
              <li>
                <Link to="/chat" className="text-[13px] text-slate-500 hover:text-slate-800 transition-colors">
                  Contact via Chat
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="font-semibold text-slate-800 mb-3 text-[13px]">Legal</h4>
            <ul className="space-y-2.5">
              <li>
                <span className="text-[13px] text-slate-400 cursor-default">Privacy</span>
              </li>
              <li>
                <span className="text-[13px] text-slate-400 cursor-default">Terms</span>
              </li>
              <li>
                <span className="text-[13px] text-slate-400 cursor-default">Security</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8 border-t border-slate-200/60">
          <p className="text-[12px] text-slate-400">
            &copy; {new Date().getFullYear()} KorvixAI. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="text-slate-400 hover:text-slate-600 transition-colors cursor-default">
              <Twitter className="h-4 w-4" />
            </span>
            <span className="text-slate-400 hover:text-slate-600 transition-colors cursor-default">
              <Github className="h-4 w-4" />
            </span>
            <span className="text-slate-400 hover:text-slate-600 transition-colors cursor-default">
              <Linkedin className="h-4 w-4" />
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
