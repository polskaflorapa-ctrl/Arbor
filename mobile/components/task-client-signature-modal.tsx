import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ViewShot from 'react-native-view-shot';
import Svg, { Path as SvgPath } from 'react-native-svg';

import type { Theme } from '../constants/theme';
import { PlatinumIconBadge } from './ui/platinum-icon-badge';

export type TaskClientSignaturePayload = {
  signer_name: string;
  signature_data_url: string;
  note?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSave: (payload: TaskClientSignaturePayload) => void;
  defaultSignerName?: string;
  theme: Theme;
};

export function TaskClientSignatureModal({
  visible,
  onClose,
  onSave,
  defaultSignerName,
  theme,
}: Props) {
  const [signerName, setSignerName] = useState('');
  const [note, setNote] = useState('');
  const [strokes, setStrokes] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [capturing, setCapturing] = useState(false);
  const currentPathRef = useRef('');
  const signatureShotRef = useRef<any>(null);
  const signed = strokes.length > 0 || currentPath.length > 0;

  useEffect(() => {
    if (!visible) return;
    setSignerName(defaultSignerName || '');
    setNote('');
    setStrokes([]);
    setCurrentPath('');
    currentPathRef.current = '';
  }, [visible, defaultSignerName]);

  const beginStroke = useCallback((x: number, y: number) => {
    const first = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    currentPathRef.current = first;
    setCurrentPath(first);
  }, []);

  const appendStroke = useCallback((x: number, y: number) => {
    if (!currentPathRef.current) {
      beginStroke(x, y);
      return;
    }
    currentPathRef.current = `${currentPathRef.current} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    setCurrentPath(currentPathRef.current);
  }, [beginStroke]);

  const commitStroke = useCallback(() => {
    const finalPath = currentPathRef.current;
    if (!finalPath) return;
    setStrokes((prev) => [...prev, finalPath]);
    currentPathRef.current = '';
    setCurrentPath('');
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          beginStroke(locationX, locationY);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          appendStroke(locationX, locationY);
        },
        onPanResponderRelease: () => commitStroke(),
        onPanResponderTerminate: () => commitStroke(),
      }),
    [appendStroke, beginStroke, commitStroke],
  );

  const handleSave = async () => {
    const cleanName = signerName.trim();
    if (cleanName.length < 2) {
      Alert.alert('Uwaga', 'Podaj imię i nazwisko klienta.');
      return;
    }
    if (capturing) return;

    const mergedStrokes = currentPathRef.current ? [...strokes, currentPathRef.current] : strokes;
    if (mergedStrokes.length <= 0) {
      Alert.alert('Brak podpisu', 'Potwierdź podpis w polu podpisu.');
      return;
    }
    if (currentPathRef.current) {
      setStrokes(mergedStrokes);
      currentPathRef.current = '';
      setCurrentPath('');
    }

    setCapturing(true);
    let dataUrl = '';
    try {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const base64 = await signatureShotRef.current?.capture?.();
      if (!base64 || typeof base64 !== 'string') {
        throw new Error('Pusty podpis');
      }
      dataUrl = `data:image/png;base64,${base64}`;
    } catch {
      setCapturing(false);
      Alert.alert('Błąd podpisu', 'Nie udało się zapisać podpisu. Spróbuj ponownie.');
      return;
    }

    const safeNote = note.trim().replace(/[<>&"]/g, ' ').slice(0, 1000);
    onSave({
      signer_name: cleanName,
      signature_data_url: dataUrl,
      ...(safeNote ? { note: safeNote } : {}),
    });
    setCapturing(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, backgroundColor: 'rgba(5,8,15,0.9)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 44 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Podpis klienta</Text>
              <TouchableOpacity onPress={onClose}>
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Imię i nazwisko klienta</Text>
            <TextInput
              style={{ borderWidth: 1, borderRadius: 6, borderColor: theme.inputBorder, backgroundColor: theme.inputBg, color: theme.inputText, padding: 12, marginBottom: 10 }}
              placeholder="np. Jan Kowalski"
              placeholderTextColor={theme.inputPlaceholder}
              value={signerName}
              onChangeText={setSignerName}
            />

            <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Pole podpisu</Text>
            <View
              style={{
                height: 130,
                borderRadius: 7,
                borderWidth: 2,
                borderColor: signed ? theme.success : theme.border,
                backgroundColor: theme.surface2,
                marginBottom: 10,
                overflow: 'hidden',
              }}
            >
              <ViewShot
                ref={signatureShotRef}
                options={{ format: 'png', quality: 1, result: 'base64' }}
                style={{ flex: 1, backgroundColor: '#ffffff' }}
              >
                <View
                  style={{ flex: 1 }}
                  {...panResponder.panHandlers}
                >
                  <Svg width="100%" height="100%">
                    {strokes.map((stroke, idx) => (
                      <SvgPath
                        key={`${idx}-${stroke.length}`}
                        d={stroke}
                        stroke="#111111"
                        strokeWidth={2.4}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {currentPath ? (
                      <SvgPath
                        d={currentPath}
                        stroke="#111111"
                        strokeWidth={2.4}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                  </Svg>
                  {!signed ? (
                    <View style={{ pointerEvents: 'none', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: '#6b7280' }}>Podpisz palcem lub rysikiem →</Text>
                    </View>
                  ) : null}
                </View>
              </ViewShot>
            </View>

            <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Uwagi (opcjonalnie)</Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderRadius: 6,
                borderColor: theme.inputBorder,
                backgroundColor: theme.inputBg,
                color: theme.inputText,
                padding: 12,
                minHeight: 70,
                textAlignVertical: 'top',
                marginBottom: 14,
              }}
              multiline
              value={note}
              onChangeText={setNote}
              placeholder="Np. odbiór bez uwag"
              placeholderTextColor={theme.inputPlaceholder}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 6, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, padding: 12, alignItems: 'center' }}
                onPress={() => {
                  currentPathRef.current = '';
                  setCurrentPath('');
                  setStrokes([]);
                }}
                disabled={capturing}
              >
                <Text style={{ color: theme.textSub, fontWeight: '600' }}>Wyczyść</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 6, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, padding: 12, alignItems: 'center' }}
                onPress={onClose}
                disabled={capturing}
              >
                <Text style={{ color: theme.textSub, fontWeight: '600' }}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 6, borderWidth: 1, borderColor: theme.accentDark, backgroundColor: theme.accent, padding: 12, alignItems: 'center' }}
                onPress={() => { void handleSave(); }}
                disabled={capturing}
              >
                {capturing ? (
                  <ActivityIndicator color={theme.accentText} size="small" />
                ) : (
                  <Text style={{ color: theme.accentText, fontWeight: '700' }}>Zapisz</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
