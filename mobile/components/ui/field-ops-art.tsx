import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useTheme } from '../../constants/ThemeContext';

type FieldOpsHeroVariant = 'dispatch' | 'crew' | 'inspection' | 'work';

type FieldOpsHeroImageProps = {
  size?: number;
  variant?: FieldOpsHeroVariant;
  style?: StyleProp<ViewStyle>;
};

type FieldOpsCockpitProps = {
  variant?: FieldOpsHeroVariant;
  style?: StyleProp<ViewStyle>;
};

export function FieldOpsBackdrop() {
  const { theme } = useTheme();
  const ink = theme.name === 'dark' ? '#D8FFE8' : '#123326';
  const route = theme.accent;
  const haze = theme.info;

  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="ops-field-bg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={route} stopOpacity={theme.name === 'dark' ? 0.18 : 0.08} />
            <Stop offset="0.44" stopColor={theme.bg} stopOpacity={theme.name === 'dark' ? 0.98 : 0.86} />
            <Stop offset="1" stopColor={haze} stopOpacity={theme.name === 'dark' ? 0.12 : 0.05} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="390" height="844" fill="url(#ops-field-bg)" />
        {Array.from({ length: 9 }).map((_, index) => (
          <Line
            key={`grid-h-${index}`}
            x1="0"
            y1={92 + index * 76}
            x2="390"
            y2={92 + index * 76}
            stroke={ink}
            strokeOpacity={theme.name === 'dark' ? 0.035 : 0.05}
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: 5 }).map((_, index) => (
          <Line
            key={`grid-v-${index}`}
            x1={42 + index * 78}
            y1="0"
            x2={42 + index * 78}
            y2="844"
            stroke={ink}
            strokeOpacity={theme.name === 'dark' ? 0.03 : 0.04}
            strokeWidth="1"
          />
        ))}
        <Path
          d="M-40 146 C 44 120, 92 158, 152 132 S 265 89, 430 120"
          fill="none"
          stroke={ink}
          strokeOpacity={theme.name === 'dark' ? 0.16 : 0.09}
          strokeWidth="1.4"
        />
        <Path
          d="M-36 640 C 62 584, 122 690, 209 626 S 319 574, 430 618"
          fill="none"
          stroke={route}
          strokeOpacity={theme.name === 'dark' ? 0.18 : 0.1}
          strokeWidth="1.5"
        />
        <Path
          d="M312 -22 C 336 58, 392 110, 430 192"
          fill="none"
          stroke={haze}
          strokeOpacity={theme.name === 'dark' ? 0.16 : 0.08}
          strokeWidth="18"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

export function FieldOpsHeroImage({ size = 88, variant = 'dispatch', style }: FieldOpsHeroImageProps) {
  const { theme } = useTheme();
  const accent = theme.accent;
  const info = theme.info;
  const warning = theme.warning;
  const ink = theme.name === 'dark' ? '#E9FFF2' : '#10251B';
  const ground = theme.name === 'dark' ? '#12241D' : '#E8F1EC';
  const panel = theme.name === 'dark' ? '#07100D' : '#FFFFFF';

  return (
    <View style={[styles.heroImage, { width: size, height: size * 0.82 }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 112 92">
        <Defs>
          <LinearGradient id="ops-hero-fill" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={panel} stopOpacity="1" />
            <Stop offset="1" stopColor={ground} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="3" y="6" width="106" height="80" rx="7" fill="url(#ops-hero-fill)" stroke={theme.cardBorder} strokeWidth="1.2" />
        <Rect x="12" y="15" width="43" height="55" rx="5" fill={panel} stroke={theme.cardBorder} strokeWidth="1" />
        <Path d="M18 58 C 29 44, 37 63, 49 49" fill="none" stroke={accent} strokeWidth="3.4" strokeLinecap="round" />
        <Circle cx="20" cy="57" r="3.8" fill={accent} />
        <Circle cx="49" cy="49" r="3.8" fill={info} />
        <Rect x="18" y="23" width="28" height="5" rx="2.5" fill={ink} opacity="0.74" />
        <Rect x="18" y="33" width="18" height="4" rx="2" fill={theme.textMuted} opacity="0.5" />
        <Rect x="64" y="18" width="31" height="10" rx="5" fill={accent} opacity="0.22" />
        <Rect x="64" y="35" width="23" height="8" rx="4" fill={info} opacity="0.24" />
        <Rect x="64" y="51" width="28" height="8" rx="4" fill={warning} opacity="0.22" />
        <Line x1="60" y1="15" x2="60" y2="72" stroke={theme.cardBorder} strokeWidth="1" />
        <G opacity="0.96">
          <Rect x="70" y="61" width="29" height="16" rx="4" fill={panel} stroke={theme.cardBorder} />
          <Path d="M75 72 L82 66 L88 70 L95 64" fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx="75" cy="72" r="2.5" fill={accent} />
          <Circle cx="95" cy="64" r="2.5" fill={variant === 'work' ? warning : info} />
          <Rect x="72" y="55" width="24" height="4" rx="2" fill={ink} opacity="0.64" />
        </G>
      </Svg>
    </View>
  );
}

export function FieldOpsCockpit({ variant = 'dispatch', style }: FieldOpsCockpitProps) {
  const { theme } = useTheme();
  const accent = theme.accent;
  const info = theme.info;
  const warning = theme.warning;
  const danger = theme.danger;
  const ink = theme.name === 'dark' ? '#E9FFF2' : '#10251B';
  const panel = theme.name === 'dark' ? '#07100D' : '#FFFFFF';
  const surface = theme.name === 'dark' ? '#0D1B16' : '#EEF5F1';
  const focusTone = variant === 'crew' ? warning : variant === 'inspection' ? accent : info;

  return (
    <View style={[styles.cockpit, style]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 340 126" preserveAspectRatio="xMidYMid meet">
        <Defs>
          <LinearGradient id="ops-cockpit-panel" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={panel} stopOpacity="1" />
            <Stop offset="1" stopColor={surface} stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="ops-cockpit-road" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={accent} stopOpacity="0.05" />
            <Stop offset="0.52" stopColor={accent} stopOpacity="0.74" />
            <Stop offset="1" stopColor={info} stopOpacity="0.32" />
          </LinearGradient>
        </Defs>
        <Rect x="4" y="6" width="332" height="114" rx="9" fill="url(#ops-cockpit-panel)" stroke={theme.cardBorder} strokeWidth="1.2" />

        <G opacity="0.42">
          <Line x1="28" y1="22" x2="296" y2="22" stroke={ink} strokeOpacity="0.18" />
          <Line x1="28" y1="46" x2="310" y2="46" stroke={ink} strokeOpacity="0.12" />
          <Line x1="28" y1="70" x2="304" y2="70" stroke={ink} strokeOpacity="0.13" />
          <Line x1="28" y1="94" x2="312" y2="94" stroke={ink} strokeOpacity="0.12" />
          <Line x1="62" y1="18" x2="62" y2="106" stroke={ink} strokeOpacity="0.10" />
          <Line x1="132" y1="18" x2="132" y2="106" stroke={ink} strokeOpacity="0.10" />
          <Line x1="204" y1="18" x2="204" y2="106" stroke={ink} strokeOpacity="0.10" />
          <Line x1="274" y1="18" x2="274" y2="106" stroke={ink} strokeOpacity="0.10" />
        </G>

        <Path
          d="M31 91 C 74 46, 107 110, 151 62 S 232 27, 303 72"
          fill="none"
          stroke="url(#ops-cockpit-road)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <Path
          d="M31 91 C 74 46, 107 110, 151 62 S 232 27, 303 72"
          fill="none"
          stroke={ink}
          strokeOpacity="0.54"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="5 7"
        />

        <G>
          <Circle cx="35" cy="91" r="7" fill={accent} />
          <Circle cx="151" cy="62" r="7" fill={warning} />
          <Circle cx="303" cy="72" r="7" fill={info} />
          <Circle cx="35" cy="91" r="3.5" fill={panel} />
          <Circle cx="151" cy="62" r="3.5" fill={panel} />
          <Circle cx="303" cy="72" r="3.5" fill={panel} />
        </G>

        <G transform="translate(84 28)">
          <Rect x="0" y="0" width="92" height="66" rx="7" fill={panel} stroke={focusTone} strokeOpacity="0.48" />
          <Rect x="12" y="12" width="42" height="6" rx="3" fill={ink} opacity="0.76" />
          <Rect x="12" y="25" width="28" height="5" rx="2.5" fill={theme.textMuted} opacity="0.58" />
          <Rect x="62" y="11" width="18" height="18" rx="4" fill={focusTone} opacity="0.20" stroke={focusTone} strokeOpacity="0.55" />
          <Path d="M66 20 L70 24 L78 14" fill="none" stroke={focusTone} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M13 49 C 24 36, 34 53, 46 39 S 63 31, 78 43" fill="none" stroke={focusTone} strokeWidth="3" strokeLinecap="round" />
          <Circle cx="13" cy="49" r="3.6" fill={accent} />
          <Circle cx="46" cy="39" r="3.6" fill={warning} />
          <Circle cx="78" cy="43" r="3.6" fill={info} />
        </G>

        <G transform="translate(212 18)">
          <Rect x="0" y="0" width="82" height="54" rx="7" fill={panel} stroke={theme.cardBorder} />
          <Rect x="11" y="12" width="34" height="6" rx="3" fill={ink} opacity="0.74" />
          <Rect x="11" y="24" width="24" height="5" rx="2.5" fill={theme.textMuted} opacity="0.55" />
          <Rect x="53" y="11" width="20" height="9" rx="4.5" fill={accent} opacity="0.28" />
          <Rect x="53" y="27" width="17" height="8" rx="4" fill={warning} opacity="0.30" />
          <Path d="M13 42 C 24 31, 33 47, 46 35" fill="none" stroke={accent} strokeWidth="3" strokeLinecap="round" />
          <Circle cx="13" cy="42" r="3.2" fill={accent} />
          <Circle cx="46" cy="35" r="3.2" fill={info} />
        </G>

        <G transform="translate(41 24)">
          <Rect x="0" y="0" width="51" height="39" rx="7" fill={panel} stroke={theme.cardBorder} />
          <Circle cx="16" cy="18" r="7" fill={accent} opacity="0.20" />
          <Path d="M14 18 L17 21 L24 13" fill="none" stroke={accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <Rect x="30" y="11" width="12" height="5" rx="2.5" fill={danger} opacity={variant === 'work' ? 0.82 : 0.24} />
          <Rect x="30" y="23" width="15" height="5" rx="2.5" fill={warning} opacity="0.38" />
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    opacity: 1,
  },
  heroImage: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cockpit: {
    width: '100%',
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
