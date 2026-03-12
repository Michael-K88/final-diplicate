import React, { useState, useEffect, useRef } from 'react';
import './app-loader.scss';

interface AppLoaderProps {
    onLoadingComplete: () => void;
    duration?: number;
}

const AppLoader: React.FC<AppLoaderProps> = ({ onLoadingComplete, duration = 5000 }) => {
    const [progress, setProgress] = useState(0);
    const [phase, setPhase] = useState<'in' | 'loaded' | 'out'>('in');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animFrameRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);

        type Particle = {
            x: number; y: number; vx: number; vy: number;
            size: number; alpha: number; color: string;
        };

        const colors = ['rgba(99,179,237,', 'rgba(255,215,100,', 'rgba(147,112,219,', 'rgba(255,255,255,'];
        const particles: Particle[] = Array.from({ length: 120 }, () => ({
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            vx: (Math.random() - 0.5) * 0.3,
            vy: (Math.random() - 0.5) * 0.3,
            size: Math.random() * 2 + 0.4,
            alpha: Math.random() * 0.6 + 0.1,
            color: colors[Math.floor(Math.random() * colors.length)],
        }));

        let t = 0;
        const draw = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            t += 0.008;

            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;

                const glow = p.alpha * (0.7 + 0.3 * Math.sin(t + p.x * 0.01));
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = p.color + glow + ')';
                ctx.fill();
            });

            const cx = canvas.width / 2;
            const segments = 60;
            const amp = 18;
            ctx.beginPath();
            for (let i = 0; i <= segments; i++) {
                const xp = (canvas.width * 0.15) + (canvas.width * 0.7) * (i / segments);
                const yp = canvas.height * 0.82 + Math.sin(i * 0.4 + t * 1.5) * amp * Math.sin(i * 0.15);
                i === 0 ? ctx.moveTo(xp, yp) : ctx.lineTo(xp, yp);
            }
            ctx.strokeStyle = 'rgba(99,179,237,0.12)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.beginPath();
            for (let i = 0; i <= segments; i++) {
                const xp = (canvas.width * 0.1) + (canvas.width * 0.8) * (i / segments);
                const yp = canvas.height * 0.85 + Math.cos(i * 0.3 + t * 1.2) * amp * 0.6;
                i === 0 ? ctx.moveTo(xp, yp) : ctx.lineTo(xp, yp);
            }
            ctx.strokeStyle = 'rgba(255,215,100,0.08)';
            ctx.lineWidth = 1;
            ctx.stroke();

            const grad = ctx.createRadialGradient(cx, canvas.height * 0.38, 0, cx, canvas.height * 0.38, 220);
            grad.addColorStop(0, 'rgba(0,30,80,0.08)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            animFrameRef.current = requestAnimationFrame(draw);
        };
        draw();

        return () => {
            cancelAnimationFrame(animFrameRef.current);
            window.removeEventListener('resize', resize);
        };
    }, []);

    useEffect(() => {
        let current = 0;
        const total = duration;
        const start = Date.now();

        const tick = () => {
            const elapsed = Date.now() - start;
            const raw = elapsed / total;
            const eased = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw;
            current = Math.min(Math.round(eased * 100), 100);
            setProgress(current);

            if (current < 100) {
                requestAnimationFrame(tick);
            } else {
                setPhase('loaded');
                setTimeout(() => {
                    setPhase('out');
                    setTimeout(onLoadingComplete, 600);
                }, 400);
            }
        };
        requestAnimationFrame(tick);
    }, [onLoadingComplete, duration]);

    return (
        <div className={`bt-splash bt-splash--${phase}`}>
            <canvas ref={canvasRef} className='bt-splash__canvas' />

            <div className='bt-splash__glow bt-splash__glow--top' />
            <div className='bt-splash__glow bt-splash__glow--mid' />

            <div className='bt-splash__content'>
                <div className='bt-splash__logo-wrap'>
                    <div className='bt-splash__logo-ring' />
                    <img
                        src='/blue-traders-logo.png'
                        alt='Blue Traders'
                        className='bt-splash__logo-img'
                        draggable={false}
                    />
                </div>

                <div className='bt-splash__brand'>
                    <h1 className='bt-splash__title'>BLUE TRADERS</h1>
                    <p className='bt-splash__tagline'>Mastering The Market</p>
                </div>

                <div className='bt-splash__divider'>
                    <span className='bt-splash__divider-line' />
                    <span className='bt-splash__divider-diamond' />
                    <span className='bt-splash__divider-line' />
                </div>

                <div className='bt-splash__stats'>
                    <div className='bt-splash__stat'>
                        <span className='bt-splash__stat-value'>24/7</span>
                        <span className='bt-splash__stat-label'>TRADING</span>
                    </div>
                    <div className='bt-splash__stat-sep' />
                    <div className='bt-splash__stat'>
                        <span className='bt-splash__stat-value'>0.5s</span>
                        <span className='bt-splash__stat-label'>EXECUTION</span>
                    </div>
                    <div className='bt-splash__stat-sep' />
                    <div className='bt-splash__stat'>
                        <span className='bt-splash__stat-value'>100+</span>
                        <span className='bt-splash__stat-label'>MARKETS</span>
                    </div>
                </div>

                <div className='bt-splash__progress-wrap'>
                    <div className='bt-splash__progress-bar'>
                        <div className='bt-splash__progress-fill' style={{ width: `${progress}%` }} />
                        <div className='bt-splash__progress-glow' style={{ left: `${progress}%` }} />
                    </div>
                    <div className='bt-splash__progress-meta'>
                        <span className='bt-splash__progress-label'>
                            {progress < 40 ? 'INITIALIZING' : progress < 70 ? 'LOADING BOTS' : progress < 95 ? 'PREPARING TOOLS' : 'READY'}
                        </span>
                        <span className='bt-splash__progress-pct'>{progress}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AppLoader;
