import { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { donutSegments, Slice } from '@/domain/chartMath';
import { useTheme } from '@/theme';

/** A ring split into coloured slices. Anything placed as children sits in the middle. */
export function DonutChart({
  slices,
  size = 190,
  thickness = 28,
  children,
}: {
  slices: Slice[];
  size?: number;
  thickness?: number;
  children?: ReactNode;
}) {
  const t = useTheme();
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = donutSegments(
    slices.map((s) => s.value),
    radius,
  );
  const c = size / 2;
  return (
    <View style={{ width: size, height: size, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${c}, ${c}`}>
          {/* Track shown when there is nothing to draw. */}
          <Circle cx={c} cy={c} r={radius} stroke={t.inputBg} strokeWidth={thickness} fill="none" />
          {slices.map((s, i) =>
            segments[i].length > 0 ? (
              <Circle
                key={s.key}
                cx={c}
                cy={c}
                r={radius}
                stroke={s.color}
                strokeWidth={thickness}
                fill="none"
                strokeDasharray={`${segments[i].length} ${circumference}`}
                strokeDashoffset={-segments[i].offset}
              />
            ) : null,
          )}
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', width: size - thickness * 2 - 8 }}>
        {children}
      </View>
    </View>
  );
}
