import type { CSSProperties } from "react";
import styles from "./Bubbles.module.scss";

interface BubbleSpec {
    /** Diameter in px. */
    size: number;
    /** Horizontal start position in vw (0-100). */
    left: number;
    /** Seconds for one full rise. */
    duration: number;
    /** Seconds before this bubble starts, so they don't sync up. */
    delay: number;
    /** Color hue (0-360) for the tint. */
    hue: number;
    /** Horizontal drift amplitude in px (sign = direction). */
    sway: number;
}

// Deterministic specs (not Math.random) so bubbles don't jump on re-render.
// Varied size → depth, varied duration/delay → never visibly repeats.
const BUBBLES: BubbleSpec[] = [
    { size: 58, left: 6, duration: 16, delay: 0, hue: 160, sway: 42 },
    { size: 34, left: 20, duration: 21, delay: 3, hue: 205, sway: -30 },
    { size: 92, left: 36, duration: 26, delay: 6, hue: 275, sway: 58 },
    { size: 24, left: 50, duration: 14, delay: 1, hue: 148, sway: -24 },
    { size: 48, left: 63, duration: 19, delay: 8, hue: 300, sway: 36 },
    { size: 74, left: 78, duration: 23, delay: 4, hue: 190, sway: -52 },
    { size: 30, left: 90, duration: 17, delay: 11, hue: 168, sway: 28 },
    { size: 52, left: 14, duration: 28, delay: 13, hue: 250, sway: -46 },
    { size: 40, left: 44, duration: 20, delay: 9, hue: 178, sway: 40 },
    { size: 66, left: 70, duration: 24, delay: 15, hue: 220, sway: -38 },
];

/**
 * A layer of glassy bubbles that rise from the bottom of the screen,
 * swaying side to side. Purely decorative and safely hidden for users
 * who prefer reduced motion (see the media query in the stylesheet).
 */
export default function Bubbles({ active = false }: { active?: boolean }) {
    return (
        <div
            className={`${styles.field} ${active ? styles.fieldActive : ""}`.trim()}
            aria-hidden="true"
        >
            {BUBBLES.map((b, i) => {
                const style = {
                    width: b.size,
                    height: b.size,
                    left: `${b.left}vw`,
                    "--duration": `${b.duration}s`,
                    "--delay": `${b.delay}s`,
                    "--sway": `${b.sway}px`,
                    background: `radial-gradient(circle at 32% 28%,
                        hsla(${b.hue}, 85%, 92%, 0.95),
                        hsla(${b.hue}, 75%, 70%, 0.45) 55%,
                        hsla(${b.hue}, 70%, 60%, 0.05) 75%)`,
                    boxShadow: `inset 0 0 ${Math.round(b.size / 4)}px
                        hsla(${b.hue}, 90%, 96%, 0.55),
                        0 4px 14px hsla(${b.hue}, 60%, 40%, 0.12)`,
                } as CSSProperties;
                return <span key={i} className={styles.bubble} style={style} />;
            })}
        </div>
    );
}
