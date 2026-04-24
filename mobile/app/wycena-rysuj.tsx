/**
 * Ekran rysowania na zdjęciu wyceny
 * Nawigacja: router.push(`/wycena-rysuj?uri=${encodeURIComponent(photoUri)}&wycenaId=${id}`)
 */

import { useLocalSearchParams, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, Image, PanResponder,
  ScrollView, StyleSheet, Text, TouchableOpacity, View, StatusBar,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { API_URL } from '../constants/api';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { triggerHaptic } from '../utils/haptics';
import { getStoredSession } from '../utils/session';

const { width: SW } = Dimensions.get('window');
const CANVAS_W = SW;
const CANVAS_H = SW * 1.2;

/** Stała paleta kreślarska (nie motyw UI — musi być czytelna na zdjęciu). */
const KOLORY = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#3B82F6',
  '#14b8a6',
  '#000000',
  '#ffffff',
];
const BIALY_SWATCH = '#ffffff';

const GRUBOSCI = [3, 6, 12];

interface Stroke {
  path: string;
  color: string;
  width: number;
}

export default function WycenaRysujScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/wycena');
  const { uri, wycenaId } = useLocalSearchParams<{ uri: string; wycenaId: string }>();
  const decodedUri = uri ? decodeURIComponent(uri) : '';

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [selectedKolor, setSelectedKolor] = useState('#EF4444');
  const [selectedGrubosc, setSelectedGrubosc] = useState(6);
  const [saving, setSaving] = useState(false);
  const [eraser, setEraser] = useState(false);

  const viewShotRef = useRef<ViewShot>(null);
  const isDrawing = useRef(false);

  const s = useMemo(() => makeDrawStyles(theme), [theme]);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (evt) => {
      isDrawing.current = true;
      const { locationX, locationY } = evt.nativeEvent;
      setCurrentPath(`M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`);
    },

    onPanResponderMove: (evt) => {
      if (!isDrawing.current) return;
      const { locationX, locationY } = evt.nativeEvent;
      setCurrentPath(prev => `${prev} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`);
    },

    onPanResponderRelease: () => {
      if (!isDrawing.current || !currentPath) return;
      isDrawing.current = false;
      setStrokes(prev => [...prev, {
        path: currentPath,
        color: eraser ? '#00000000' : selectedKolor,
        width: eraser ? selectedGrubosc * 3 : selectedGrubosc,
      }]);
      setCurrentPath('');
    },
  });

  const undo = () => {
    setStrokes(prev => prev.slice(0, -1));
    setCurrentPath('');
  };

  const clear = () => {
    Alert.alert(t('draw.alert.clearTitle'), t('draw.alert.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('draw.btn.clearConfirm'), style: 'destructive', onPress: () => { setStrokes([]); setCurrentPath(''); } },
    ]);
  };

  const save = async () => {
    if (!viewShotRef.current) return;
    setSaving(true);
    try {
      // Zrób screenshot widoku z rysunkiem
      const capturedUri = await viewShotRef.current.capture?.();
      if (!capturedUri) {
        Alert.alert(t('wyceny.alert.saveFail'), t('draw.alert.captureFail'));
        return;
      }

      if (wycenaId) {
        // Wyślij na serwer jako nowe zdjęcie wyceny
        const { token } = await getStoredSession();
        if (!token) { router.replace('/login'); return; }
        const formData = new FormData();
        formData.append('zdjecie', { uri: capturedUri, name: `rysunek_${Date.now()}.jpg`, type: 'image/jpeg' } as any);

        const res = await fetch(`${API_URL}/wyceny/${wycenaId}/zdjecia`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (res.ok) {
          void triggerHaptic('success');
          Alert.alert(t('draw.alert.addedTitle'), t('draw.alert.addedBody'), [
            { text: t('common.ok'), onPress: () => router.back() },
          ]);
        } else {
          void triggerHaptic('error');
          Alert.alert(t('wyceny.alert.saveFail'), t('draw.alert.serverFail'));
        }
      } else {
        void triggerHaptic('success');
        // Zwróć URI do ekranu który otworzył rysowanie
        Alert.alert(t('draw.alert.localTitle'), t('draw.alert.localBody'), [
          { text: t('common.ok'), onPress: () => router.back() },
        ]);
      }
    } catch {
      void triggerHaptic('error');
      Alert.alert(t('wyceny.alert.saveFail'), t('draw.alert.saveFail'));
    } finally {
      setSaving(false);
    }
  };

  if (guard.ready && !guard.allowed) {
    return <View style={s.root} />;
  }

  if (!guard.ready) {
    return (
      <View style={[s.root, s.centered]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      {/* Toolbar górny */}
      <View style={s.toolbar}>
        <TouchableOpacity
          onPress={() => {
            void triggerHaptic('light');
            router.back();
          }}
          style={s.toolBtn}
        >
          <Text style={s.toolBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={s.toolbarTitle}>{t('draw.title')}</Text>
        <PlatinumCTA
          label={saving ? t('draw.saving') : t('draw.save')}
          onPress={save}
          disabled={saving}
          loading={saving}
          style={s.saveBtn}
        />
      </View>

      {/* Canvas - zdjęcie + rysowanie */}
      <ViewShot ref={viewShotRef} options={{ format: 'jpg', quality: 0.9 }} style={s.canvasWrap}>
        <View style={s.canvas} {...panResponder.panHandlers}>
          {/* Zdjęcie w tle */}
          {decodedUri ? (
            <Image
              source={{ uri: decodedUri }}
              style={s.bgImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[s.bgImage, { backgroundColor: theme.surface2 }]} />
          )}

          {/* SVG warstwa rysowania */}
          <Svg style={StyleSheet.absoluteFill} width={CANVAS_W} height={CANVAS_H}>
            {strokes.map((s, i) => (
              <Path
                key={i}
                d={s.path}
                stroke={s.color}
                strokeWidth={s.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {currentPath ? (
              <Path
                d={currentPath}
                stroke={eraser ? 'rgba(0,0,0,0.3)' : selectedKolor}
                strokeWidth={eraser ? selectedGrubosc * 3 : selectedGrubosc}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={eraser ? '5,3' : undefined}
              />
            ) : null}
          </Svg>
        </View>
      </ViewShot>

      {/* Narzędzia dolne */}
      <View style={s.bottomTools}>
        {/* Kolory */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.colorRow}>
          {/* Gumka */}
          <TouchableOpacity
            style={[s.eraserBtn, eraser && s.eraserBtnActive]}
            onPress={() => setEraser(!eraser)}
          >
            <Text style={s.eraserIcon}>⬜</Text>
          </TouchableOpacity>
          {KOLORY.map(kolor => (
            <TouchableOpacity
              key={kolor}
              style={[
                s.colorDot,
                { backgroundColor: kolor, borderColor: kolor === BIALY_SWATCH ? theme.border : kolor },
                selectedKolor === kolor && !eraser && s.colorDotActive,
              ]}
              onPress={() => { setSelectedKolor(kolor); setEraser(false); }}
            />
          ))}
        </ScrollView>

        {/* Grubość + akcje */}
        <View style={s.actionsRow}>
          <View style={s.gruboscRow}>
            {GRUBOSCI.map(g => (
              <TouchableOpacity
                key={g}
                style={[s.gruboscBtn, selectedGrubosc === g && s.gruboscBtnActive]}
                onPress={() => setSelectedGrubosc(g)}
              >
                <View style={[s.gruboscLine, {
                  height: g,
                  backgroundColor: selectedGrubosc === g ? theme.text : theme.textMuted,
                }]} />
              </TouchableOpacity>
            ))}
          </View>

          <View style={s.actionBtns}>
            <TouchableOpacity
              style={s.actionBtn}
              onPress={() => {
                void triggerHaptic('light');
                undo();
              }}
              disabled={strokes.length === 0}
            >
              <Text style={[s.actionBtnText, strokes.length === 0 && { opacity: 0.3 }]}>{t('draw.undo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.actionBtn, s.clearBtn]}
              onPress={() => {
                void triggerHaptic('warning');
                clear();
              }}
            >
              <Text style={s.clearBtnText}>{t('draw.clearBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

function makeDrawStyles(t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    centered: { justifyContent: 'center', alignItems: 'center' },

    toolbar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: t.headerBg, paddingTop: 52, paddingBottom: 12, paddingHorizontal: 16,
      borderBottomWidth: 1, borderBottomColor: t.border,
    },
    toolBtn: { padding: 8 },
    toolBtnText: { color: t.textMuted, fontSize: 18 },
    toolbarTitle: { color: t.headerText, fontSize: t.fontSection + 1, fontWeight: '700' },
    saveBtn: { minWidth: 110 },

    canvasWrap: { flex: 1 },
    canvas: { width: CANVAS_W, height: CANVAS_H, position: 'relative' },
    bgImage: { width: CANVAS_W, height: CANVAS_H, position: 'absolute' },

    bottomTools: {
      backgroundColor: t.surface,
      paddingBottom: 30,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },

    colorRow: { paddingHorizontal: 12, marginBottom: 10 },
    colorDot: {
      width: 32, height: 32, borderRadius: 16,
      marginRight: 8, borderWidth: 2,
    },
    colorDotActive: { borderColor: t.text, borderWidth: 3, transform: [{ scale: 1.2 }] },
    eraserBtn: {
      width: 32, height: 32, borderRadius: t.radiusSm, marginRight: 8,
      backgroundColor: t.surface2, justifyContent: 'center', alignItems: 'center',
      borderWidth: 2, borderColor: t.border,
    },
    eraserBtnActive: { borderColor: t.text, backgroundColor: t.surface3 },
    eraserIcon: { fontSize: 16 },

    actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },

    gruboscRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    gruboscBtn: {
      width: 40, height: 40, borderRadius: t.radiusSm,
      backgroundColor: t.surface2, justifyContent: 'center', alignItems: 'center',
      borderWidth: 1.5, borderColor: t.border,
    },
    gruboscBtnActive: { borderColor: t.text, backgroundColor: t.surface3 },
    gruboscLine: { width: 24, borderRadius: 4 },

    actionBtns: { flexDirection: 'row', gap: 8 },
    actionBtn: { backgroundColor: t.surface2, borderRadius: t.radiusSm, paddingVertical: 8, paddingHorizontal: 12 },
    actionBtnText: { color: t.textSub, fontSize: 13, fontWeight: '600' },
    clearBtn: { backgroundColor: t.dangerBg, borderWidth: 1, borderColor: t.danger + '55' },
    clearBtnText: { color: t.danger, fontSize: 13, fontWeight: '600' },
  });
}
