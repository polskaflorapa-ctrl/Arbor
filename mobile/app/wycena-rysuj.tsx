import { safeBack } from '../utils/navigation';
/**
 * Ekran rysowania na zdjęciu wyceny
 * Nawigacja: router.push(`/wycena-rysuj?uri=${encodeURIComponent(photoUri)}&wycenaId=${id}`)
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, PanResponder,
  ScrollView, StyleSheet, Text, TouchableOpacity, View, StatusBar, useWindowDimensions,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { API_URL } from '../constants/api';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { createOfflineRequestId, enqueueOfflineRequest, queueTaskPhotoOffline } from '../utils/offline-queue';
import { triggerHaptic } from '../utils/haptics';
import { getStoredSession } from '../utils/session';

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
const TOOL_PRESETS = [
  { key: 'cut', label: 'Cięcie', icon: 'git-branch-outline', color: '#EF4444', width: 6 },
  { key: 'risk', label: 'Ryzyko', icon: 'warning-outline', color: '#EAB308', width: 10 },
  { key: 'access', label: 'Dojazd', icon: 'navigate-outline', color: '#3B82F6', width: 6 },
  { key: 'keep', label: 'Zostawić', icon: 'leaf-outline', color: '#22C55E', width: 6 },
] as const;

interface Stroke {
  path: string;
  color: string;
  width: number;
}

export default function WycenaRysujScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { width, height } = useWindowDimensions();
  const { uri, wycenaId, taskId, inspectionId, quotationId, itemId, photoKind } = useLocalSearchParams<{
    uri: string;
    wycenaId?: string;
    taskId?: string;
    inspectionId?: string;
    quotationId?: string;
    itemId?: string;
    photoKind?: string;
  }>();
  const guard = useOddzialFeatureGuard(inspectionId ? '/ogledziny' : '/wycena');
  const decodedUri = uri ? decodeURIComponent(uri) : '';

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [selectedKolor, setSelectedKolor] = useState('#EF4444');
  const [selectedGrubosc, setSelectedGrubosc] = useState(6);
  const [saving, setSaving] = useState(false);

  const viewShotRef = useRef<ViewShot>(null);
  const isDrawing = useRef(false);
  const currentPathRef = useRef('');

  const canvasW = Math.max(280, Math.min(width, 720));
  const canvasH = Math.max(320, Math.min(Math.round(canvasW * 1.18), Math.round(height * 0.58)));
  const s = useMemo(() => makeDrawStyles(theme, canvasW, canvasH), [theme, canvasW, canvasH]);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,

    onPanResponderGrant: (evt) => {
      isDrawing.current = true;
      const { locationX, locationY } = evt.nativeEvent;
      const next = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
      currentPathRef.current = next;
      setCurrentPath(next);
    },

    onPanResponderMove: (evt) => {
      if (!isDrawing.current) return;
      const { locationX, locationY } = evt.nativeEvent;
      const next = `${currentPathRef.current} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
      currentPathRef.current = next;
      setCurrentPath(next);
    },

    onPanResponderRelease: () => {
      const finalPath = currentPathRef.current;
      if (!isDrawing.current || !finalPath) return;
      isDrawing.current = false;
      setStrokes(prev => [...prev, {
        path: finalPath,
        color: selectedKolor,
        width: selectedGrubosc,
      }]);
      currentPathRef.current = '';
      setCurrentPath('');
    },

    onPanResponderTerminate: () => {
      isDrawing.current = false;
      currentPathRef.current = '';
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
      { text: t('draw.btn.clearConfirm'), style: 'destructive', onPress: () => { setStrokes([]); currentPathRef.current = ''; setCurrentPath(''); } },
    ]);
  };

  const applyPreset = (preset: (typeof TOOL_PRESETS)[number]) => {
    setSelectedKolor(preset.color);
    setSelectedGrubosc(preset.width);
    void triggerHaptic('light');
  };

  const queueInspectionSketchOffline = async (capturedUri: string) => {
    if (!inspectionId) return;
    const idempotencyKey = createOfflineRequestId(`ogledziny-${inspectionId}-sketch`);
    await enqueueOfflineRequest({
      id: idempotencyKey,
      url: `${API_URL}/ogledziny/${inspectionId}/media`,
      method: 'POST',
      multipart: {
        fileUri: capturedUri,
        fieldName: 'media',
        fileName: `ogledziny_szkic_${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
        fields: {
          kind: 'photo',
          typ: 'photo',
          opis: 'Szkic zakresu prac z oględzin terenowych.',
        },
      },
    });
  };

  const save = async () => {
    if (!viewShotRef.current) return;
    setSaving(true);
    let capturedUri = '';
    try {
      // Zrób screenshot widoku z rysunkiem
      capturedUri = await viewShotRef.current.capture?.() || '';
      if (!capturedUri) {
        Alert.alert(t('wyceny.alert.saveFail'), t('draw.alert.captureFail'));
        return;
      }

      const qTeren = quotationId && itemId;
      if (qTeren) {
        const { token } = await getStoredSession();
        if (!token) { router.replace('/login'); return; }
        const formData = new FormData();
        formData.append('zdjecie', { uri: capturedUri, name: `rysunek_${Date.now()}.jpg`, type: 'image/jpeg' } as any);
        formData.append('photo_kind', photoKind === 'general' ? 'general' : 'annotated');

        const res = await fetch(`${API_URL}/quotations/${quotationId}/items/${itemId}/zdjecia`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (res.ok) {
          void triggerHaptic('success');
          Alert.alert(t('draw.alert.addedTitle'), t('draw.alert.addedBody'), [
            { text: t('common.ok'), onPress: () => safeBack() },
          ]);
        } else {
          void triggerHaptic('error');
          if (res.status === 404) {
            Alert.alert(
              'Moduł wycen terenowych',
              'Backend produkcyjny nie ma jeszcze wdrożonego nowego modułu wycen. Szkic nie został wysłany do quotation, otwórz klasyczne wyceny.',
              [
                { text: 'Zostań tutaj', style: 'cancel' },
                { text: 'Klasyczne wyceny', onPress: () => router.replace('/wycena' as never) },
              ]
            );
          } else {
            Alert.alert(t('wyceny.alert.saveFail'), t('draw.alert.serverFail'));
          }
        }
      } else if (taskId) {
        const { token } = await getStoredSession();
        if (!token) { router.replace('/login'); return; }
        const idempotencyKey = createOfflineRequestId(`task-${taskId}-sketch`);
        const formData = new FormData();
        formData.append('zdjecie', { uri: capturedUri, name: `szkic_${Date.now()}.jpg`, type: 'image/jpeg' } as any);
        formData.append('typ', photoKind || 'szkic');
        formData.append('opis', 'Szkic zakresu prac z wyceny terenowej.');
        formData.append('tagi', 'wycena,szkic,teren');

        const res = await fetch(`${API_URL}/tasks/${taskId}/zdjecia`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
          body: formData,
        });

        if (res.ok) {
          void triggerHaptic('success');
          Alert.alert(t('draw.alert.addedTitle'), t('draw.alert.addedBody'), [
            { text: t('common.ok'), onPress: () => router.replace(`/zlecenie/${taskId}?tab=zdjecia` as never) },
          ]);
        } else {
          if (res.status >= 500) {
            await queueTaskPhotoOffline({
              id: idempotencyKey,
              url: `${API_URL}/tasks/${taskId}/zdjecia`,
              fileUri: capturedUri,
              typ: photoKind || 'szkic',
              opis: 'Szkic zakresu prac z wyceny terenowej.',
              tagi: 'wycena,szkic,teren',
            });
            void triggerHaptic('warning');
            Alert.alert('Zapisane offline', 'Szkic trafił do kolejki i wyśle się po powrocie internetu.', [
              { text: t('common.ok'), onPress: () => router.replace(`/zlecenie/${taskId}?tab=zdjecia` as never) },
            ]);
            return;
          }
          void triggerHaptic('error');
          Alert.alert(t('wyceny.alert.saveFail'), t('draw.alert.serverFail'));
        }
      } else if (inspectionId) {
        const { token } = await getStoredSession();
        if (!token) { router.replace('/login'); return; }
        const idempotencyKey = createOfflineRequestId(`ogledziny-${inspectionId}-sketch`);
        const formData = new FormData();
        formData.append('kind', 'photo');
        formData.append('typ', 'photo');
        formData.append('opis', 'Szkic zakresu prac z oględzin terenowych.');
        formData.append('media', { uri: capturedUri, name: `ogledziny_szkic_${Date.now()}.jpg`, type: 'image/jpeg' } as any);

        const res = await fetch(`${API_URL}/ogledziny/${inspectionId}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
          body: formData,
        });

        if (res.ok) {
          void triggerHaptic('success');
          Alert.alert('Szkic zapisany', 'Rysunek zapisany do oględzin i będzie widoczny dla biura.', [
            { text: t('common.ok'), onPress: () => router.replace(`/ogledziny-dokumentacja?ogledzinyId=${inspectionId}` as never) },
          ]);
        } else if (res.status >= 500) {
          await queueInspectionSketchOffline(capturedUri);
          void triggerHaptic('warning');
          Alert.alert('Zapisane offline', 'Szkic trafił do kolejki i wyśle się po powrocie internetu.', [
            { text: t('common.ok'), onPress: () => router.replace(`/ogledziny-dokumentacja?ogledzinyId=${inspectionId}` as never) },
          ]);
          return;
        } else {
          void triggerHaptic('error');
          Alert.alert(t('wyceny.alert.saveFail'), t('draw.alert.serverFail'));
        }
      } else if (wycenaId) {
        // Wyślij na serwer jako nowe zdjęcie wyceny (stary moduł /wyceny)
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
            { text: t('common.ok'), onPress: () => safeBack() },
          ]);
        } else {
          void triggerHaptic('error');
          Alert.alert(t('wyceny.alert.saveFail'), t('draw.alert.serverFail'));
        }
      } else {
        void triggerHaptic('success');
        // Zwróć URI do ekranu który otworzył rysowanie
        Alert.alert(t('draw.alert.localTitle'), t('draw.alert.localBody'), [
          { text: t('common.ok'), onPress: () => safeBack() },
        ]);
      }
    } catch {
      if (taskId && capturedUri) {
        try {
          const idempotencyKey = createOfflineRequestId(`task-${taskId}-sketch`);
          await queueTaskPhotoOffline({
            id: idempotencyKey,
            url: `${API_URL}/tasks/${taskId}/zdjecia`,
            fileUri: capturedUri,
            typ: photoKind || 'szkic',
            opis: 'Szkic zakresu prac z wyceny terenowej.',
            tagi: 'wycena,szkic,teren',
          });
          void triggerHaptic('warning');
          Alert.alert('Zapisane offline', 'Szkic trafił do kolejki i wyśle się po powrocie internetu.', [
            { text: t('common.ok'), onPress: () => router.replace(`/zlecenie/${taskId}?tab=zdjecia` as never) },
          ]);
          return;
        } catch {
          // fallback to generic error below
        }
      }
      if (inspectionId && capturedUri) {
        try {
          await queueInspectionSketchOffline(capturedUri);
          void triggerHaptic('warning');
          Alert.alert('Zapisane offline', 'Szkic trafił do kolejki i wyśle się po powrocie internetu.', [
            { text: t('common.ok'), onPress: () => router.replace(`/ogledziny-dokumentacja?ogledzinyId=${inspectionId}` as never) },
          ]);
          return;
        } catch {
          // fallback to generic error below
        }
      }
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
      <StatusBar barStyle={'light-content'} backgroundColor={theme.headerBg} />
      {/* Toolbar górny */}
      <View style={s.toolbar}>
        <TouchableOpacity
          onPress={() => {
            void triggerHaptic('light');
            safeBack();
          }}
          style={s.toolBtn}
        >
          <Text style={s.toolBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={s.toolbarCenter}>
          <Text style={s.toolbarTitle}>{t('draw.title')}</Text>
          <Text style={s.toolbarSub}>{strokes.length} linii • {selectedGrubosc}px</Text>
        </View>
        <PlatinumCTA
          label={saving ? t('draw.saving') : 'Zapisz'}
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
          <Svg style={StyleSheet.absoluteFill} width={canvasW} height={canvasH}>
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
                stroke={selectedKolor}
                strokeWidth={selectedGrubosc}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </Svg>
          <View style={s.canvasBadge}>
            <Ionicons name="create-outline" size={13} color="#ffffff" />
            <Text style={s.canvasBadgeText}>Szkic zakresu</Text>
          </View>
        </View>
      </ViewShot>

      {/* Narzędzia dolne */}
      <View style={s.bottomTools}>
        {/* Kolory */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.presetRow}>
          {TOOL_PRESETS.map((preset) => {
            const active = selectedKolor === preset.color && selectedGrubosc === preset.width;
            return (
              <TouchableOpacity
                key={preset.key}
                style={[s.presetBtn, active && { borderColor: preset.color, backgroundColor: preset.color + '22' }]}
                onPress={() => applyPreset(preset)}
              >
                <Ionicons name={preset.icon} size={15} color={active ? preset.color : theme.textMuted} />
                <Text style={[s.presetText, active && { color: preset.color }]}>{preset.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.colorRow}>
          {/* Gumka */}
          <TouchableOpacity
            style={s.eraserBtn}
            onPress={() => {
              void triggerHaptic('light');
              undo();
            }}
          >
            <Ionicons name="arrow-undo-outline" size={18} color={theme.textSub} />
          </TouchableOpacity>
          {KOLORY.map(kolor => (
            <TouchableOpacity
              key={kolor}
              style={[
                s.colorDot,
                { backgroundColor: kolor, borderColor: kolor === BIALY_SWATCH ? theme.border : kolor },
                selectedKolor === kolor && s.colorDotActive,
              ]}
              onPress={() => { setSelectedKolor(kolor); }}
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

function makeDrawStyles(t: Theme, canvasW: number, canvasH: number) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    centered: { justifyContent: 'center', alignItems: 'center' },

    toolbar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: t.headerBg, paddingTop: 52, paddingBottom: 12, paddingHorizontal: 16,
      borderBottomWidth: 1, borderBottomColor: t.border,
    },
    toolBtn: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surface2,
      borderWidth: 1,
      borderColor: t.border,
    },
    toolBtnText: { color: t.textMuted, fontSize: 18 },
    toolbarCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
    toolbarTitle: { color: t.headerText, fontSize: t.fontSection + 1, fontWeight: '700' },
    toolbarSub: { color: t.headerSub, fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
    saveBtn: { minWidth: 96 },

    canvasWrap: {
      width: canvasW,
      height: canvasH,
      alignSelf: 'center',
      backgroundColor: '#07130f',
    },
    canvas: { width: canvasW, height: canvasH, position: 'relative', overflow: 'hidden' },
    bgImage: { width: canvasW, height: canvasH, position: 'absolute' },
    canvasBadge: {
      position: 'absolute',
      left: 10,
      bottom: 10,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: 'rgba(0,0,0,0.55)',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    canvasBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },

    bottomTools: {
      backgroundColor: t.surface,
      paddingBottom: 30,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },

    presetRow: { gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
    presetBtn: {
      minHeight: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface2,
      paddingHorizontal: 11,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    presetText: { color: t.textMuted, fontSize: 12, fontWeight: '900' },
    colorRow: { paddingHorizontal: 12, marginBottom: 10 },
    colorDot: {
      width: 48, height: 48, borderRadius: 24,
      marginRight: 8, borderWidth: 2,
    },
    colorDotActive: { borderColor: t.text, borderWidth: 3, transform: [{ scale: 1.2 }] },
    eraserBtn: {
      width: 48, height: 48, borderRadius: 12, marginRight: 8,
      backgroundColor: t.surface2, justifyContent: 'center', alignItems: 'center',
      borderWidth: 2, borderColor: t.border,
    },
    eraserBtnActive: { borderColor: t.text, backgroundColor: t.surface3 },
    eraserIcon: { fontSize: 16 },

    actionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },

    gruboscRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    gruboscBtn: {
      width: 48, height: 48, borderRadius: 12,
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
