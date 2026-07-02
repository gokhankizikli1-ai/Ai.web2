import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { ProjectAgent } from '@/types/projects';

interface AgentNode {
  x: number;
  y: number;
  agent: ProjectAgent;
  vx: number;
  vy: number;
}

interface AgentNetworkProps {
  agents: ProjectAgent[];
  selectedAgentId: string;
}

export default function AgentNetwork({ agents, selectedAgentId }: AgentNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const nodesRef = useRef<AgentNode[]>([]);
  const frameRef = useRef<number>(0);

  // Initialize node positions
  useEffect(() => {
    if (dimensions.width === 0 || agents.length === 0) return;

    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;
    const radius = Math.min(cx, cy) * 0.55;

    nodesRef.current = agents.map((agent, i) => {
      const angle = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
      return {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        agent,
        vx: 0,
        vy: 0,
      };
    });
  }, [dimensions, agents]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Canvas animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    let time = 0;

    const animate = () => {
      time += 0.008;
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);

      const nodes = nodesRef.current;
      const cx = dimensions.width / 2;
      const cy = dimensions.height / 2;

      // Draw center hub
      const hubGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 24);
      hubGlow.addColorStop(0, 'rgba(139, 92, 246,0.15)');
      hubGlow.addColorStop(0.5, 'rgba(139, 92, 246,0.05)');
      hubGlow.addColorStop(1, 'rgba(139, 92, 246,0)');
      ctx.fillStyle = hubGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fill();

      // Center pulse
      const pulseSize = 6 + Math.sin(time * 3) * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, pulseSize, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(139, 92, 246,0.6)';
      ctx.fill();

      // Draw connections
      nodes.forEach((node, i) => {
        // Connection to center
        const isSelected = node.agent.id === selectedAgentId;
        const lineOpacity = isSelected ? 0.25 : 0.08;
        const lineWidth = isSelected ? 1.5 : 0.5;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(node.x, node.y);
        ctx.strokeStyle = `rgba(182, 187, 198,${lineOpacity})`;
        ctx.lineWidth = lineWidth;
        ctx.stroke();

        // Connection to neighbors
        nodes.forEach((other, j) => {
          if (i >= j) return;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(node.x, node.y);
            ctx.lineTo(other.x, other.y);
            ctx.strokeStyle = `rgba(182, 187, 198,0.04)`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        });

        // Animated particle along center connection
        if (node.agent.status === 'active' || node.agent.status === 'syncing') {
          const t = (time + i * 0.5) % 1;
          const px = cx + (node.x - cx) * t;
          const py = cy + (node.y - cy) * t;
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = node.agent.status === 'active'
            ? 'rgba(52,211,153,0.5)'
            : 'rgba(139, 92, 246,0.4)';
          ctx.fill();
        }
      });

      // Draw nodes
      nodes.forEach((node) => {
        const isSelected = node.agent.id === selectedAgentId;
        const isActive = node.agent.status === 'active';

        // Outer glow for active/selected
        if (isActive || isSelected) {
          const glowSize = isSelected ? 14 : 8;
          const glowOpacity = isSelected ? 0.2 : 0.1;
          const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowSize);
          glow.addColorStop(0, `rgba(139, 92, 246,${glowOpacity})`);
          glow.addColorStop(1, 'rgba(139, 92, 246,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowSize, 0, Math.PI * 2);
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, isSelected ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? 'rgba(52,211,153,0.8)' : isSelected ? 'rgba(139, 92, 246,0.8)' : 'rgba(182, 187, 198,0.4)';
        ctx.fill();

        // White inner
        ctx.beginPath();
        ctx.arc(node.x, node.y, isSelected ? 3 : 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
      });

      // Orbiting ring
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(cx, cy) * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Second ring
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(cx, cy) * 0.4, time * 0.2, time * 0.2 + Math.PI * 1.5);
      ctx.strokeStyle = 'rgba(139, 92, 246,0.04)';
      ctx.lineWidth = 1;
      ctx.stroke();

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [dimensions, selectedAgentId, agents]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[180px]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'auto' }}
      />

      {/* Agent labels overlaid */}
      <div className="absolute inset-0 pointer-events-none">
        {agents.map((agent, i) => {
          const cx = 50;
          const cy = 50;
          const radius = 35;
          const angle = (i / agents.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;

          return (
            <motion.div
              key={agent.id}
              className="absolute pointer-events-auto"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: 'translate(-50%, -50%)',
              }}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
            >
              <div
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full backdrop-blur-sm ${
                  agent.id === selectedAgentId ? 'bg-white/10' : 'bg-white/[0.04]'
                }`}
                style={{ border: `1px solid ${agent.id === selectedAgentId ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}` }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{
                    background: agent.status === 'active' ? '#4ADE80' : agent.status === 'syncing' ? '#8B5CF6' : '#B6BBC6',
                    boxShadow: agent.status === 'active' ? '0 0 4px rgba(52,211,153,0.5)' : 'none',
                  }}
                />
                <span className="text-[8px] text-white/50 whitespace-nowrap">{agent.name}</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
