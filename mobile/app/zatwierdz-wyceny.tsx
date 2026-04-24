import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, StatusBar, Animated,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { PlatinumModalSheet } from '../components/ui/platinum-modal-sheet';
import { PlatinumPressable } from '../components/ui/platinum-pressable';
import { PLATINUM_MOTION } from '../constants/motion';
import { triggerHaptic } from '../utils/haptics';

const APPROVE_ROLES = ['Kierownik', 'Administrator', 'Dyrektor', 'Specjalista'];

const TABS = ['oczekuje', 'rezerwacja_wstepna', 'do_specjalisty', 'zatwierdzono', 'odrzucono'] as const;
type TabKey = typeof TABS[number];

const tabLabelKey = (k: TabKey) =>
  k === 'oczekuje' ? 'approve.tab.pending'
    : k === 'rezerwacja_wstepna' ? 'Rezerwacja'
      : k === 'do_specjalisty' ? 'Do specjalisty'
        : k === 'zatwierdzono' ? 'approve.tab.approved' : 'approve.tab.rejected';

const tabEmptyKey = (k: TabKey) =>
  k === 'oczekuje' ? 'approve.empty.pending'
    : k === 'rezerwacja_wstepna' ? 'Brak rezerwacji do zatwierdzenia'
      : k === 'do_specjalisty' ? 'Brak pozycji do specjalisty'
        : k === 'zatwierdzono' ? 'approve.empty.approved' : 'approve.empty.rejected';

export default function ZatwierdzWycenyScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const statusColor = useMemo(() => ({
    oczekuje: theme.warning,
    rezerwacja_wstepna: theme.success,
    do_specjalisty: theme.info,
    zatwierdzono: theme.success,
    odrzucono: theme.danger,
  }), [theme]);
  const guard = useOddzialFeatureGuard('/zatwierdz-wyceny');
  const [wyceny, setWyceny] = useState<any[]>([]);
  const [ekipy, setEkipy] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>('oczekuje');
  const [tabsWidth, setTabsWidth] = useState(0);
  const tabAnim = useState(new Animated.Value(0))[0];

  const [approving, setApproving] = useState<any | null>(null);
  const [approveForm, setApproveForm] = useState({
    ekipa_id: '' as string | number,
    data: '', godzina: '', wartosc: '', uwagi: '',
  });
  const [rejecting, setRejecting] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState('');

  const loadAll = useCallback(async (tokenOverride?: string) => {
    try {
      const authToken = tokenOverride || token;
      if (!authToken) { router.replace('/login'); return; }
      const headers = { Authorization: `Bearer ${authToken}` };
      const [wRes, eRes] = await Promise.all([
        fetch(`${API_URL}/wyceny`, { headers }),
        fetch(`${API_URL}/ekipy`, { headers }),
      ]);
      if (wRes.ok) {
        const wData = await wRes.json();
        setWyceny(Array.isArray(wData) ? wData : (wData.wyceny || []));
      }
      if (eRes.ok) setEkipy(await eRes.json());
    } catch {
      setWyceny([]);
      setRuntimeError('Błąd serwera przy pobieraniu wycen do zatwierdzenia.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  const init = useCallback(async () => {
    const { token: storedToken, user: u } = await getStoredSession();
    if (!storedToken) { router.replace('/login'); return; }
    setToken(storedToken);
    const role = typeof u?.rola === 'string' ? u.rola : '';
    if (!u || !APPROVE_ROLES.includes(role)) {
      Alert.alert(t('approve.accessDeniedTitle'), t('approve.accessDeniedBody'));
      router.back();
      return;
    }
    await loadAll(storedToken);
  }, [loadAll, t]);

  useEffect(() => { void init(); }, [init]);

  const onRefresh = () => { setRefreshing(true); loadAll(); };

  const filtered = wyceny.filter(w => w.status_akceptacji === tab);

  useEffect(() => {
    const idx = TABS.indexOf(tab);
    Animated.spring(tabAnim, {
      toValue: idx < 0 ? 0 : idx,
      ...PLATINUM_MOTION.spring.tabs,
      useNativeDriver: true,
    }).start();
  }, [tab, tabAnim]);

  const openApprove = (w: any) => {
    setApproveForm({
      ekipa_id: w.proponowana_ekipa_id || w.ekipa_id || '',
      data: (w.proponowana_data || w.data_wykonania || '').slice(0, 10),
      godzina: (w.proponowana_godzina || w.godzina_rozpoczecia || '').slice(0, 5),
      wartosc: w.wartosc_planowana ? String(w.wartosc_planowana) : w.wartosc_szacowana ? String(w.wartosc_szacowana) : '',
      uwagi: '',
    });
    setApproving(w);
  };

  const handleApprove = async () => {
    if (!approveForm.ekipa_id) {
      void triggerHaptic('warning');
      Alert.alert(t('notif.alert.errorTitle'), t('approve.pickTeam'));
      return;
    }
    setSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const body = {
        ekipa_id: approveForm.ekipa_id,
        data_wykonania: approveForm.data,
        godzina_rozpoczecia: approveForm.godzina,
        wartosc_planowana: approveForm.wartosc ? parseFloat(approveForm.wartosc) : undefined,
        uwagi: approveForm.uwagi,
      };
      const res = await fetch(`${API_URL}/wyceny/${approving.id}/zatwierdz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        void triggerHaptic('error');
        Alert.alert(t('notif.alert.errorTitle'), err.message || t('approve.approveFail'));
        return;
      }
      void triggerHaptic('success');
      setApproving(null);
      Alert.alert(t('approve.approvedTitle'), t('approve.approvedBody'));
      loadAll();
    } catch {
      void triggerHaptic('error');
      Alert.alert(t('notif.alert.errorTitle'), t('approve.serverError'));
      setRuntimeError('Błąd serwera przy zatwierdzaniu wyceny.');
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    setSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/wyceny/${rejecting.id}/odrzuc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ powod: rejectReason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        void triggerHaptic('error');
        Alert.alert(t('notif.alert.errorTitle'), err.message || t('approve.rejectFail'));
        return;
      }
      void triggerHaptic('success');
      setRejecting(null);
      setRejectReason('');
      Alert.alert(t('approve.rejectedTitle'), t('approve.rejectedBody'));
      loadAll();
    } catch {
      void triggerHaptic('error');
      Alert.alert(t('notif.alert.errorTitle'), t('approve.serverError'));
      setRuntimeError('Błąd serwera przy odrzucaniu wyceny.');
    } finally {
      setSaving(false);
    }
  };

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
  }
  if (!guard.ready) {
    return (
      <View style={S.centerFull}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.centerFull}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardSafeScreen style={S.root}>
      <View pointerEvents="none" style={S.bgOrbTop} />
      <View pointerEvents="none" style={S.bgOrbBottom} />
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <PlatinumIconBadge icon="arrow-back" color={theme.headerText} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
        </TouchableOpacity>
        <Text style={S.headerTitle}>{t('approve.screenTitle')}</Text>
        <View style={{ width: 36 }} />
      </View>
      <View style={S.platinumBar}>
        <PlatinumIconBadge icon="diamond-outline" color={theme.accent} size={10} style={S.platinumBarIcon} />
        <Text style={S.platinumBarText}>Platinum Approval Deck</Text>
      </View>
      {runtimeError ? (
        <View style={S.errorBar}>
          <PlatinumIconBadge icon="warning-outline" color={theme.warning} size={10} style={S.platinumBarIcon} />
          <Text style={S.errorBarText}>{runtimeError}</Text>
        </View>
      ) : null}

      {/* Tabs */}
      <View
        style={S.tabsRow}
        onLayout={(e) => setTabsWidth(e.nativeEvent.layout.width)}
      >
        {tabsWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              S.tabIndicator,
              {
                width: tabsWidth / TABS.length,
                transform: [
                  {
                    translateX: tabAnim.interpolate({
                      inputRange: [0, TABS.length - 1],
                      outputRange: [0, tabsWidth - tabsWidth / TABS.length],
                    }),
                  },
                ],
              },
            ]}
          />
        ) : null}
        {TABS.map((tabKey) => {
          const count = wyceny.filter(w => w.status_akceptacji === tabKey).length;
          return (
            <TouchableOpacity
              key={tabKey}
              style={[S.tabBtn, tab === tabKey && { backgroundColor: statusColor[tabKey] + '1A' }]}
              onPress={() => {
                void triggerHaptic('light');
                setTab(tabKey);
              }}
            >
              <Text style={[S.tabText, tab === tabKey && { color: statusColor[tabKey] }]}>
                {t(tabLabelKey(tabKey))}
              </Text>
              {count > 0 && (
                <View style={[S.tabBadge, { backgroundColor: statusColor[tabKey] }]}>
                  <Text style={S.tabBadgeText}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
        contentContainerStyle={S.scroll}
      >
        {filtered.length === 0 ? (
          <View style={S.empty}>
            <PlatinumIconBadge icon="checkmark-circle-outline" color={theme.textMuted} size={24} style={{ width: 42, height: 42, borderRadius: 13 }} />
            <Text style={S.emptyText}>
              {t(tabEmptyKey(tab))}
            </Text>
          </View>
        ) : (
          filtered.map(w => (
            <WycenaItem
              key={w.id}
              wycena={w}
              ekipy={ekipy}
              tab={tab}
              theme={theme}
              onApprove={() => openApprove(w)}
              onReject={() => { setRejecting(w); setRejectReason(''); }}
            />
          ))
        )}
      </ScrollView>

      {/* Approve Modal */}
      <Modal visible={!!approving} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={S.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <PlatinumModalSheet visible={!!approving} style={S.modalSheet}>
            <View style={S.modalHeader}>
              <View>
                <Text style={S.modalTitle}>{t('approve.modalApproveTitle')}</Text>
                <Text style={S.modalSub}>{approving?.adres}</Text>
              </View>
              <TouchableOpacity onPress={() => setApproving(null)}>
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={S.modalScroll}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            >
              <View style={S.infoBox}>
                <InfoRow label={t('approve.label.service')} value={approving?.typ_uslugi || '-'} theme={theme} />
                <InfoRow label={t('approve.label.client')} value={approving?.klient_nazwa || '-'} theme={theme} />
                <InfoRow label={t('approve.info.estimator')} value={approving?.wyceniajacy_nazwa || approving?.autor_nazwa || '-'} theme={theme} />
                {(approving?.wartosc_planowana || approving?.wartosc_szacowana) && (
                  <InfoRow label={t('approve.info.estValue')} value={`${Number(approving.wartosc_planowana || approving.wartosc_szacowana).toFixed(2)} PLN`} theme={theme} />
                )}
              </View>

              <Text style={S.label}>
                {t('approve.label.team')} <Text style={{ color: theme.warning }}>{t('approve.teamRequired')}</Text>
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={S.pillsScroll}>
                {ekipy.map(e => {
                  const active = String(approveForm.ekipa_id) === String(e.id);
                  const color = e.kolor || theme.accent;
                  return (
                    <TouchableOpacity
                      key={e.id}
                      style={[S.ekipaPill, active && { backgroundColor: color + '22', borderColor: color }]}
                      onPress={() => setApproveForm(f => ({ ...f, ekipa_id: e.id }))}
                    >
                      <View style={[S.ekipaDot, { backgroundColor: color }]} />
                      <Text style={[S.ekipaText, active && { color: color, fontWeight: '700' }]}>
                        {e.nazwa}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={S.label}>{t('approve.label.doneDate')}</Text>
              <TextInput style={S.input} placeholder={t('approve.placeholder.date')} placeholderTextColor={theme.inputPlaceholder}
                value={approveForm.data} onChangeText={(txt) => setApproveForm(f => ({ ...f, data: txt }))} />

              <Text style={S.label}>{t('approve.label.hour')}</Text>
              <TextInput style={S.input} placeholder="09:00" placeholderTextColor={theme.inputPlaceholder}
                value={approveForm.godzina} onChangeText={(txt) => setApproveForm(f => ({ ...f, godzina: txt }))} />

              <Text style={S.label}>{t('approve.label.orderValue')}</Text>
              <TextInput style={S.input} placeholder="0.00" placeholderTextColor={theme.inputPlaceholder}
                keyboardType="decimal-pad" value={approveForm.wartosc}
                onChangeText={(txt) => setApproveForm(f => ({ ...f, wartosc: txt }))} />

              <Text style={S.label}>{t('approve.label.managerNotes')}</Text>
              <TextInput style={[S.input, S.inputMulti]} placeholder={t('approve.placeholder.notes')}
                placeholderTextColor={theme.inputPlaceholder} multiline numberOfLines={3}
                value={approveForm.uwagi} onChangeText={(txt) => setApproveForm(f => ({ ...f, uwagi: txt }))} />
            </ScrollView>

            <View style={S.modalActions}>
              <TouchableOpacity style={S.rejectBtn}
                onPress={() => { setApproving(null); setRejecting(approving); setRejectReason(''); }}>
                <PlatinumIconBadge icon="close-circle-outline" color={theme.danger} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                <Text style={S.rejectBtnText}>{t('approve.btn.reject')}</Text>
              </TouchableOpacity>
              <PlatinumCTA
                style={[S.approveBtn, saving && { opacity: 0.6 }]}
                onPress={handleApprove}
                disabled={saving}
                loading={saving}
                label={t('approve.btn.approveCreate')}
              />
            </View>
          </PlatinumModalSheet>
        </KeyboardAvoidingView>
      </Modal>

      {/* Reject Modal */}
      <Modal visible={!!rejecting} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={S.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <PlatinumModalSheet visible={!!rejecting} style={[S.modalSheet, { maxHeight: '55%' }]}>
            <View style={S.modalHeader}>
              <Text style={S.modalTitle}>{t('approve.rejectModalTitle')}</Text>
              <TouchableOpacity onPress={() => setRejecting(null)}>
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>
            <View style={{ padding: 20 }}>
              <Text style={S.label}>{t('approve.rejectReasonLabel')}</Text>
              <TextInput style={[S.input, S.inputMulti]} placeholder={t('approve.rejectPlaceholder')}
                placeholderTextColor={theme.inputPlaceholder} multiline numberOfLines={4}
                autoFocus value={rejectReason} onChangeText={setRejectReason} />
              <View style={[S.modalActions, { marginTop: 16 }]}>
                <TouchableOpacity style={S.cancelBtn} onPress={() => setRejecting(null)}>
                  <Text style={S.cancelBtnText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <PlatinumCTA
                  style={[S.rejectConfirmBtn, saving && { opacity: 0.6 }]}
                  onPress={handleReject}
                  disabled={saving}
                  loading={saving}
                  label={t('approve.rejectConfirm')}
                />
              </View>
            </View>
          </PlatinumModalSheet>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardSafeScreen>
  );
}

function WycenaItem({
  wycena: w, ekipy, tab, theme, onApprove, onReject,
}: {
  wycena: any; ekipy: any[]; tab: TabKey; theme: Theme;
  onApprove: () => void; onReject: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const S = makeStyles(theme);
  const statusMap = {
    oczekuje: theme.warning,
    rezerwacja_wstepna: theme.success,
    do_specjalisty: theme.info,
    zatwierdzono: theme.success,
    odrzucono: theme.danger,
  } as const;
  const statusCol = statusMap[w.status_akceptacji as keyof typeof statusMap] || theme.textMuted;
  const ekipa = ekipy.find(e => String(e.id) === String(w.ekipa_id));

  return (
    <View style={S.card}>
      <PlatinumPressable onPress={() => setOpen(o => !o)}>
        <View style={[S.cardBorder, { borderLeftColor: statusCol }]}>
          <View style={S.cardTop}>
            <Text style={S.cardTitle} numberOfLines={1}>{w.adres || t('approve.card.unknownAddress')}</Text>
            <View style={[S.badge, { backgroundColor: statusCol + '22', borderColor: statusCol }]}>
              <Text style={[S.badgeText, { color: statusCol }]}>
                {(TABS as readonly string[]).includes(w.status_akceptacji)
                  ? t(tabLabelKey(w.status_akceptacji as TabKey))
                  : w.status_akceptacji}
              </Text>
            </View>
          </View>
          <View style={S.cardMeta}>
            {w.klient_nazwa && <MetaTag icon="person-outline" text={w.klient_nazwa} theme={theme} />}
            {w.data_wykonania && <MetaTag icon="calendar-outline" text={(w.data_wykonania || '').slice(0, 10)} theme={theme} />}
            {(w.ekipa_nazwa || ekipa) && (
              <MetaTag icon="people-outline" text={w.ekipa_nazwa || ekipa?.nazwa} ekipaColor={ekipa?.kolor} theme={theme} />
            )}
          </View>
          <View style={S.cardFooter}>
            {w.opis && <Text style={S.cardOpisText} numberOfLines={open ? undefined : 1}>{w.opis}</Text>}
            <PlatinumIconBadge icon={open ? 'chevron-up' : 'chevron-down'} color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 8, alignSelf: 'flex-end', marginTop: 4 }} />
          </View>
          {open && (
            <View style={S.expandedSection}>
              {w.miasto && <InfoRow label={t('approve.info.city')} value={w.miasto} theme={theme} />}
              {(w.wartosc_planowana || w.wartosc_szacowana) && (
                <InfoRow label={t('approve.info.estValue')} value={`${Number(w.wartosc_planowana || w.wartosc_szacowana).toFixed(2)} PLN`} theme={theme} />
              )}
              {w.godzina_rozpoczecia && <InfoRow label={t('approve.info.hour')} value={w.godzina_rozpoczecia.slice(0, 5)} theme={theme} />}
              {(w.wyceniajacy_nazwa || w.autor_nazwa) && <InfoRow label={t('approve.info.estimator')} value={w.wyceniajacy_nazwa || w.autor_nazwa} theme={theme} />}
              {w.wycena_uwagi && <InfoRow label={t('approve.info.notes')} value={w.wycena_uwagi} theme={theme} />}
            </View>
          )}
        </View>
      </PlatinumPressable>
      {(tab === 'oczekuje' || tab === 'rezerwacja_wstepna' || tab === 'do_specjalisty') && (
        <View style={S.actionRow}>
          <PlatinumCTA
            style={[S.rejectBtn, { backgroundColor: theme.dangerBg, borderColor: theme.danger }]}
            label={t('approve.btn.reject')}
            onPress={onReject}
          />
          <PlatinumCTA
            style={[S.approveSmallBtn, { backgroundColor: theme.accent }]}
            label={t('approve.btn.approveShort')}
            onPress={onApprove}
          />
        </View>
      )}
    </View>
  );
}

function MetaTag({ icon, text, ekipaColor, theme }: { icon: any; text: string; ekipaColor?: string; theme: Theme }) {
  const S = makeStyles(theme);
  return (
    <View style={S.metaTag}>
      {ekipaColor ? <View style={[S.ekipaDotSmall, { backgroundColor: ekipaColor }]} /> : <PlatinumIconBadge icon={icon} color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />}
      <Text style={S.metaTagText}>{text}</Text>
    </View>
  );
}

function InfoRow({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  const S = makeStyles(theme);
  return (
    <View style={S.infoRow}>
      <Text style={S.infoLabel}>{label}</Text>
      <Text style={S.infoValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  // Platinum style accents
  root: { flex: 1, backgroundColor: t.bg },
  bgOrbTop: {
    position: 'absolute',
    top: -120,
    right: -90,
    width: 250,
    height: 250,
    borderRadius: 140,
    backgroundColor: t.accent + '20',
  },
  bgOrbBottom: {
    position: 'absolute',
    bottom: 120,
    left: -80,
    width: 220,
    height: 220,
    borderRadius: 120,
    backgroundColor: t.chartCyan + '14',
  },
  centerFull: { flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 12, paddingBottom: 40 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 52, paddingBottom: 14,
    backgroundColor: t.headerBg, borderBottomWidth: 1, borderBottomColor: t.accent + '55',
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.58,
    shadowRadius: t.shadowRadius * 1.05,
    shadowOffset: { width: 0, height: 5 },
    elevation: t.cardElevation + 1,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: t.headerText, letterSpacing: 0.35 },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  platinumBar: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: t.accent + '88',
    backgroundColor: t.accent + '1F',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.35,
    shadowRadius: t.shadowRadius * 0.6,
    shadowOffset: { width: 0, height: 3 },
    elevation: t.cardElevation,
  },
  platinumBarIcon: { width: 22, height: 22, borderRadius: 8 },
  platinumBarText: {
    color: t.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  errorBar: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: t.warning + '66',
    backgroundColor: t.warning + '1A',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorBarText: { color: t.warning, fontSize: 12, fontWeight: '700', flex: 1 },

  tabsRow: {
    flexDirection: 'row', backgroundColor: t.cardBg,
    borderBottomWidth: 1, borderBottomColor: t.accent + '2E',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.2,
    shadowRadius: t.shadowRadius * 0.4,
    shadowOffset: { width: 0, height: 2 },
  },
  tabIndicator: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    backgroundColor: t.accent,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  tabBtn: {
    flex: 1, paddingVertical: 12, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  tabText: { fontSize: 12, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  tabBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText: { fontSize: 11, fontWeight: '700', color: t.accentText },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 12 },
  emptyText: { color: t.textMuted, fontSize: 15 },

  card: {
    backgroundColor: t.cardBg, borderRadius: 18, marginBottom: 10,
    overflow: 'hidden', borderWidth: 1, borderColor: t.accent + '2E',
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.45,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: t.cardElevation,
  },
  cardBorder: { borderLeftWidth: 4, padding: 14 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: t.text, flex: 1, marginRight: 8, letterSpacing: 0.2 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  cardFooter: {},
  cardOpisText: { fontSize: 13, color: t.textSub },
  expandedSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.border },

  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.25 },

  metaTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: t.accent + '22',
  },
  metaTagText: { fontSize: 12, color: t.textSub },
  ekipaDotSmall: { width: 7, height: 7, borderRadius: 4 },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  infoLabel: { fontSize: 13, color: t.textMuted },
  infoValue: { fontSize: 13, color: t.text, fontWeight: '500', flex: 1, textAlign: 'right' },

  infoBox: {
    backgroundColor: t.bg, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: t.border, marginBottom: 8,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.18,
    shadowRadius: t.shadowRadius * 0.4,
    shadowOffset: { width: 0, height: 2 },
  },

  actionRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.border, padding: 10, gap: 8 },
  rejectBtn: {
    flex: 1,
  },
  rejectBtnText: { fontSize: 14, color: t.danger, fontWeight: '600' },
  approveSmallBtn: {
    flex: 1,
  },
  approveSmallText: { fontSize: 14, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(5,8,15,0.9)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: t.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%', paddingBottom: 24, borderTopWidth: 1, borderTopColor: t.accent + '4A',
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.42,
    shadowRadius: t.shadowRadius * 0.85,
    shadowOffset: { width: 0, height: -4 },
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, borderBottomWidth: 1, borderBottomColor: t.border,
    backgroundColor: t.surface3,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: t.text },
  modalSub: { fontSize: 13, color: t.textMuted, marginTop: 2 },
  modalScroll: { paddingHorizontal: 20, paddingTop: 8 },
  modalActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 8 },

  label: { fontSize: 12, fontWeight: '800', color: t.textMuted, marginBottom: 6, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.7 },
  input: {
    backgroundColor: t.inputBg, borderRadius: 10, borderWidth: 1,
    borderColor: t.accent + '33', color: t.inputText, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 14,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },

  pillsScroll: { marginBottom: 4 },
  ekipaPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: t.bg, borderRadius: 20, paddingHorizontal: 12,
    paddingVertical: 7, marginRight: 8, borderWidth: 1, borderColor: t.accent + '33',
  },
  ekipaDot: { width: 8, height: 8, borderRadius: 4 },
  ekipaText: { fontSize: 13, color: t.text, fontWeight: '500' },

  approveBtn: {
    flex: 1, backgroundColor: t.accent, borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: t.accent + '66',
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.42,
    shadowRadius: t.shadowRadius * 0.55,
    shadowOffset: { width: 0, height: 3 },
    elevation: t.cardElevation,
  },

  cancelBtn: {
    flex: 1, backgroundColor: t.bg, borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
    borderWidth: 1, borderColor: t.border,
  },
  cancelBtnText: { color: t.textMuted, fontWeight: '600', fontSize: 14 },
  rejectConfirmBtn: {
    flex: 1, backgroundColor: t.dangerBg, borderRadius: 10,
    paddingVertical: 13, alignItems: 'center',
    borderWidth: 1,
    borderColor: t.danger + '55',
  },
});
