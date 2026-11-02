import { useEffect, useRef } from 'react';
import { useAppearance } from '../lib/appearance';
import { useMediaQuery, useReducedMotion } from '../lib/hooks';

type Shape = 'plus' | 'spark' | 'arrow';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  born: number;
  life: number;
  size: number;
  shape: Shape;
  color: string;
}

const MAX_PARTICLES = 90;
const STEP = 16; // px percorridos entre uma partícula e outra

function readColors(): string[] {
  const css = getComputedStyle(document.documentElement);
  return ['--trail-1', '--trail-2', '--trail-3'].map((v) => css.getPropertyValue(v).trim() || '#2a78d6');
}

function draw(ctx: CanvasRenderingContext2D, p: Particle, alpha: number, scale: number) {
  const s = p.size * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.strokeStyle = p.color;
  ctx.fillStyle = p.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (p.shape === 'plus') {
    ctx.lineWidth = Math.max(1.5, s * 0.28);
    ctx.beginPath();
    ctx.moveTo(-s / 2, 0);
    ctx.lineTo(s / 2, 0);
    ctx.moveTo(0, -s / 2);
    ctx.lineTo(0, s / 2);
    ctx.stroke();
  } else if (p.shape === 'spark') {
    // Estrela de quatro pontas
    const r = s / 2;
    const k = r * 0.28;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(k, -k, r, 0);
    ctx.quadraticCurveTo(k, k, 0, r);
    ctx.quadraticCurveTo(-k, k, -r, 0);
    ctx.quadraticCurveTo(-k, -k, 0, -r);
    ctx.fill();
  } else {
    // Setinha de cursor
    const u = s / 10;
    ctx.beginPath();
    ctx.moveTo(-3 * u, -5 * u);
    ctx.lineTo(4 * u, 1 * u);
    ctx.lineTo(0.6 * u, 1.6 * u);
    ctx.lineTo(-1.2 * u, 5 * u);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Rastro de cruzes, brilhos e setinhas atrás do mouse. Só com mouse e sem "menos movimento". */
export function CursorTrail() {
  const { trail } = useAppearance();
  const reduced = useReducedMotion();
  const fine = useMediaQuery('(hover: hover) and (pointer: fine)');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const on = trail && !reduced && fine;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!on || !canvas || !ctx) return;

    let dpr = 1;
    // Pelo tamanho na tela (sem a barra de rolagem), para o desenho não esticar.
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round((canvas.clientWidth || window.innerWidth) * dpr);
      canvas.height = Math.round((canvas.clientHeight || window.innerHeight) * dpr);
    };
    resize();

    let colors = readColors();
    let colorsAt = performance.now();
    const particles: Particle[] = [];
    let last: { x: number; y: number } | null = null;
    let raf = 0;

    const spawn = (x: number, y: number, dx: number, dy: number, burst = false) => {
      const now = performance.now();
      // O tema pode ter mudado (inclusive pelo sistema): relê as cores de vez em quando.
      if (now - colorsAt > 800) {
        colors = readColors();
        colorsAt = now;
      }
      const roll = Math.random();
      const shape: Shape = roll < 0.5 ? 'plus' : roll < 0.82 ? 'spark' : 'arrow';
      const len = Math.hypot(dx, dy) || 1;
      const speed = burst ? 0.12 + Math.random() * 0.12 : 0.02 + Math.random() * 0.04;
      const angle = burst ? Math.random() * Math.PI * 2 : Math.atan2(-dy / len, -dx / len) + (Math.random() - 0.5) * 1.6;
      particles.push({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: shape === 'arrow' ? -0.35 + (Math.random() - 0.5) * 0.8 : Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.006,
        born: now,
        life: 650 + Math.random() * 500,
        size: shape === 'arrow' ? 11 + Math.random() * 4 : 7 + Math.random() * 6,
        shape,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
      if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
      if (!raf) raf = requestAnimationFrame(tick);
    };

    let prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - prev);
      prev = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const age = (now - p.born) / p.life;
        if (age >= 1) {
          particles.splice(i, 1);
          continue;
        }
        p.vy += 0.00012 * dt; // cai devagar
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const pop = age < 0.15 ? age / 0.15 : 1;
        draw(ctx, p, (1 - age) ** 1.6, 0.5 + 0.5 * pop * (1 - age * 0.4));
      }
      if (particles.length) raf = requestAnimationFrame(tick);
      else {
        raf = 0;
        prev = performance.now();
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (!last) {
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (Math.hypot(dx, dy) < STEP) return;
      last = { x: e.clientX, y: e.clientY };
      if (!raf) prev = performance.now();
      spawn(e.clientX, e.clientY, dx, dy);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (!raf) prev = performance.now();
      for (let i = 0; i < 7; i++) spawn(e.clientX, e.clientY, 0, 0, true);
    };
    const onLeave = () => (last = null);

    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [on]);

  return on ? <canvas ref={canvasRef} className="cursor-trail" aria-hidden="true" /> : null;
}
