// Small hand-drawn icon set (no icon font needed offline). 24-unit grid, 2px strokes.
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'sprout' | 'trend' | 'leaf' | 'ask' | 'rig' | 'camera' | 'bolt' | 'drop' | 'sun' | 'fan' | 'heat' | 'mist'
  | 'close' | 'torch' | 'flip' | 'image' | 'thermo' | 'humidity' | 'soil' | 'wifi' | 'chevron' | 'speaker' | 'stop' | 'play';

export function Icon({ name, color, size = 24 }: { name: IconName; color: string; size?: number }) {
  const p = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'sprout' && (
        <>
          <Path d="M12 21V11" {...p} />
          <Path d="M12 12c0-4 2.5-6.5 7-6.5 0 4.2-2.6 6.5-7 6.5Z" {...p} />
          <Path d="M12 14c0-3.3-2.2-5.5-6-5.5 0 3.5 2.1 5.5 6 5.5Z" {...p} />
        </>
      )}
      {name === 'trend' && <Path d="M3 17l5-6 4 3 6-8M15 6h3v3" {...p} />}
      {name === 'leaf' && (
        <>
          <Path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" {...p} />
          <Path d="M5 19l8-8" {...p} />
        </>
      )}
      {name === 'ask' && (
        <>
          <Path d="M4 5h16v11H9l-5 4V5Z" {...p} />
          <Path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5" {...p} />
        </>
      )}
      {name === 'rig' && (
        <>
          <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...p} />
          <Circle cx={16} cy={7} r={2} {...p} />
          <Circle cx={10} cy={17} r={2} {...p} />
        </>
      )}
      {name === 'camera' && (
        <>
          <Path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" {...p} />
          <Circle cx={12} cy={13} r={3.5} {...p} />
        </>
      )}
      {name === 'bolt' && <Path d="M13 3L5 14h6l-1 7 8-11h-6l1-7Z" {...p} />}
      {name === 'drop' && <Path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" {...p} />}
      {name === 'sun' && (
        <>
          <Circle cx={12} cy={12} r={4} {...p} />
          <Path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...p} />
        </>
      )}
      {name === 'fan' && (
        <>
          <Circle cx={12} cy={12} r={1.5} {...p} />
          <Path d="M12 10.5C11 6 13 3 16 4s1 5-4 6.5ZM13.5 12c4.5-1 7.5 1 6.5 4s-5 1-6.5-4ZM10.5 12c-4.5 1-7.5-1-6.5-4s5-1 6.5 4ZM12 13.5c1 4.5-1 7.5-4 6.5s-1-5 4-6.5Z" {...p} />
        </>
      )}
      {name === 'heat' && <Path d="M8 20c-2-3 2-5 0-9M12 20c-2-3 2-5 0-9M16 20c-2-3 2-5 0-9M7 5h10" {...p} />}
      {name === 'mist' && (
        <>
          <Rect x={8} y={3} width={8} height={5} rx={1} {...p} />
          <Path d="M12 8v2M7 14l-1 2M12 13v3M17 14l1 2M9 19l-.5 1.5M15 19l.5 1.5" {...p} />
        </>
      )}
      {name === 'close' && <Path d="M6 6l12 12M18 6L6 18" {...p} />}
      {name === 'torch' && <Path d="M8 3h8l-1 5H9L8 3ZM9 8l1 13h4l1-13M12 12v3" {...p} />}
      {name === 'flip' && (
        <>
          <Path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5" {...p} />
          <Path d="M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" {...p} />
        </>
      )}
      {name === 'image' && (
        <>
          <Rect x={3} y={4} width={18} height={16} rx={3} {...p} />
          <Circle cx={9} cy={10} r={1.8} {...p} />
          <Path d="M3.5 17l5-4.5 4 3.5 3-2.5 5 4" {...p} />
        </>
      )}
      {name === 'thermo' && (
        <>
          <Path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0Z" {...p} />
          <Path d="M12 9v7" {...p} />
        </>
      )}
      {name === 'humidity' && (
        <>
          <Path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" {...p} />
          <Path d="M9.5 15.5a2.6 2.6 0 0 0 2.5 2" {...p} />
        </>
      )}
      {name === 'soil' && (
        <>
          <Path d="M12 13V7M12 9c0-2.5 1.6-4 4.5-4 0 2.7-1.7 4-4.5 4ZM12 10.5c0-2-1.3-3.3-3.6-3.3 0 2.1 1.4 3.3 3.6 3.3Z" {...p} />
          <Path d="M3 14h18M5 18h2M11 18h2M17 18h2M8 21h2M14 21h2" {...p} />
        </>
      )}
      {name === 'wifi' && (
        <>
          <Path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" {...p} />
          <Circle cx={12} cy={19.5} r={0.6} {...p} />
        </>
      )}
      {name === 'chevron' && <Path d="M9 5l7 7-7 7" {...p} />}
      {name === 'speaker' && (
        <>
          <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" {...p} />
          <Path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" {...p} />
        </>
      )}
      {name === 'play' && <Path d="M8 5.5v13l10-6.5-10-6.5Z" {...p} />}
      {name === 'stop' && <Rect x={6.5} y={6.5} width={11} height={11} rx={2} {...p} />}
    </Svg>
  );
}
