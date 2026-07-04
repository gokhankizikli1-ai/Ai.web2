import { describe, it, expect } from 'vitest';
import { detectBuilderIntent } from './korvixMode';

describe('detectBuilderIntent', () => {
  it('routes clear website asks (EN + TR)', () => {
    expect(detectBuilderIntent('Peyzaj mimarı için site yap')).toBe('website');
    expect(detectBuilderIntent('Mobilyacı için web sitesi yap')).toBe('website');
    expect(detectBuilderIntent('AI startup landing page oluştur')).toBe('website');
    expect(detectBuilderIntent('Build a website for a bakery')).toBe('website');
    expect(detectBuilderIntent('bir e-ticaret mağazası kur')).toBe('website');
  });

  it('routes app asks', () => {
    expect(detectBuilderIntent('fitness takip uygulaması yap')).toBe('app');
    expect(detectBuilderIntent('build a mobile app for habits')).toBe('app');
    expect(detectBuilderIntent('a SaaS dashboard prototype')).toBe('app');
  });

  it('routes game asks', () => {
    expect(detectBuilderIntent('Roblox coin UI yap')).toBe('game');
    expect(detectBuilderIntent('bir oyun için düşman yapay zekası')).toBe('game');
    expect(detectBuilderIntent('design an enemy quest system')).toBe('game');
  });

  it('stays in chat for questions / unclear asks', () => {
    expect(detectBuilderIntent('NVIDIA kaç dolar?')).toBe('chat');
    expect(detectBuilderIntent('Bugün hava nasıl?')).toBe('chat');
    expect(detectBuilderIntent('bunu açıkla')).toBe('chat');
    expect(detectBuilderIntent('what is the capital of France?')).toBe('chat');
    expect(detectBuilderIntent('')).toBe('chat');
  });

  it('does not misfire on lookalike words', () => {
    expect(detectBuilderIntent('apple stock forecast')).toBe('chat');
    expect(detectBuilderIntent('search the web for news')).toBe('chat');
  });
});
