import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DashboardSkeleton } from '../components/ui/skeleton-block';
import { PlatinumCard } from '../components/ui/platinum-card';
import { ScreenHeader } from '../components/ui/screen-header';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getOddzialFeatureConfig, isFeatureEnabledForOddzial } from '../utils/oddzial-features';
import { getStoredSession } from '../utils/session';
import { triggerHaptic } from '../utils/haptics';
import { openAddressInMaps } from '../utils/maps-link';
import { buildNewOrderRoute } from '../utils/new-order-route';

import { AppStatusBar } from '../components/ui/app-status-bar';
type OgledzinyLite = {
  id: number;
  status?: string;
  data_planowana?: string;
  oddzial_id?: number | string;
  wyceniajacy_id?: number | string;
  klient_nazwa?: string;
  klient_telefon?: string;
  adres?: string;
  miasto?: string;
  notatki?: string;
  notatki_wyniki?: string;
  wycena_id?: number | string;
};

type SessionUser = {
  id?: number | string;
  rola?: string;
  oddzial_id?: number | string;
};

const isToday = (dateLike?: string) => {
  if (!dateLike) return false;
  return dateLike.split('T')[0] === new Date().toISOString().split('T')[0];
};

const sortByVisitTime = (a: OgledzinyLite, b: OgledzinyLite) => {
  const ta = a.data_planowana ? new Date(a.data_planowana).getTime() : Number.MAX_SAFE_INTEGER;
  const tb = b.data_planowana ? new Date(b.data_planowana).getTime() : Number.MAX_SAFE_INTEGER;
  return ta - tb;
};

const visitTime = (dateLike?: string) => {
  if (!dateLike) return '--:--';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
};

const visitDate = (dateLike?: string) => {
  if (!dateLike) return new Date().toISOString().split('T')[0];
  return dateLike.split('T')[0];
};

const visitHour = (dateLike?: string) => {
  if (!dateLike) return '';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
};

const isVisitClosed = (item: OgledzinyLite) => item.status === 'Zakonczone' || item.status === 'Anulowane';

const hasVisitLocation = (item: OgledzinyLite) => Boolean(item.adres || item.miasto);

const visitStatusLabel = (status?: string) => {
  if (status === 'Zakonczone') return 'gotowe';
  if (status === 'Anulowane') return 'anulowane';
  if (status === 'W_Trakcie') return 'w trakcie';
  return 'plan';
};

const visitStatusColor = (status: string | undefined, theme: Theme) => {
  if (status === 'Zakonczone') return theme.success;
  if (status === 'Anulowane') return theme.danger;
  if (status === 'W_Trakcie') return theme.warning;
  return theme.info;
};

export default function WyceniajacyHubScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/wyceniajacy-hub');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<OgledzinyLite[]>([]);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [runtimeError, setRuntimeError] = useState('');

  const load = useCallback(async () => {
    try {
      setRuntimeError('');
      const { token, user } = await getStoredSession();
      if (!token || !user) {
        router.replace('/login');
        return;
      }
      setSessionUser(user);
      const res = await fetch(`${API_URL}/ogledziny`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const source = Array.isArray(data) ? data : [];
        const userId = user?.id != null ? String(user.id) : '';
        const userOddzialId = user?.oddzial_id != null ? String(user.oddzial_id) : '';
        const filtered = source.filter((item: OgledzinyLite) => {
          const sameOddzial = !userOddzialId || !item.oddzial_id || String(item.oddzial_id) === userOddzialId;
          const assignedToUser = !item.wyceniajacy_id || !userId || String(item.wyceniajacy_id) === userId;
          return sameOddzial && assignedToUser;
        });
        setItems(filtered);
      } else {
        setItems([]);
        setRuntimeError('Błąd serwera przy pobieraniu danych hubu.');
      }
    } catch {
      setItems([]);
      setRuntimeError('Błąd serwera przy pobieraniu danych hubu.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = useMemo(() => items.filter((item) => isToday(item.data_planowana)).sort(sortByVisitTime), [items]);
  const todayDone = useMemo(() => today.filter((item) => item.status === 'Zakonczone'), [today]);
  const todayPlanned = today.length;
  const todayLeft = Math.max(0, todayPlanned - todayDone.length);
  const activeVisit = useMemo(() => today.find((item) => item.status === 'W_Trakcie'), [today]);
  const nextVisit = useMemo(
    () => activeVisit || today.find((item) => !isVisitClosed(item)) || today[0] || null,
    [activeVisit, today],
  );
  const nextChecks = useMemo(() => {
    if (!nextVisit) return [];
    return [
      {
        key: 'contact',
        label: 'Kontakt',
        done: Boolean(nextVisit.klient_telefon),
        hint: nextVisit.klient_telefon ? 'Telefon klienta gotowy' : 'Brak telefonu',
        icon: 'call-outline' as const,
      },
      {
        key: 'route',
        label: 'Dojazd',
        done: hasVisitLocation(nextVisit),
        hint: hasVisitLocation(nextVisit) ? 'Adres dla map gotowy' : 'Brak adresu',
        icon: 'map-outline' as const,
      },
      {
        key: 'media',
        label: 'Zdjęcia / szkic',
        done: Boolean(nextVisit.wycena_id || nextVisit.notatki_wyniki),
        hint: nextVisit.wycena_id ? `Powiązana wycena #${nextVisit.wycena_id}` : 'Zrób pakiet dowodów',
        icon: 'images-outline' as const,
      },
      {
        key: 'office',
        label: 'Do biura',
        done: Boolean(nextVisit.wycena_id),
        hint: nextVisit.wycena_id ? 'Biuro widzi draft' : 'Utwórz draft z ceną i ekipą',
        icon: 'briefcase-outline' as const,
      },
    ];
  }, [nextVisit]);
  const nextReadyCount = nextChecks.filter((item) => item.done).length;
  const todayTargetHint = useMemo(() => {
    if (todayPlanned < 6) return t('hub.targetBelow');
    if (todayPlanned > 15) return t('hub.targetAbove');
    return t('hub.targetOk');
  }, [todayPlanned, t]);
  const oddzialConfig = getOddzialFeatureConfig(sessionUser?.oddzial_id);

  const S = makeStyles(theme);

  const openDraftFromInspection = (item: OgledzinyLite) => {
    void triggerHaptic('light');
    router.push(buildNewOrderRoute({
        source: 'ogledziny',
        inspectionId: String(item.id),
        klient: item.klient_nazwa || '',
        telefon: item.klient_telefon || '',
        adres: item.adres || '',
        miasto: item.miasto || '',
        data: visitDate(item.data_planowana),
        godzina: visitHour(item.data_planowana),
        notatki: item.notatki || '',
    }) as never);
  };

  const openDocumentation = (item: OgledzinyLite) => {
    void triggerHaptic('light');
    router.push({
      pathname: '/ogledziny-dokumentacja' as never,
      params: {
        ogledzinyId: String(item.id),
        wycenaId: item.wycena_id ? String(item.wycena_id) : '',
        klient: item.klient_nazwa || '',
      },
    });
  };

  if (!guard.ready || loading) {
    return (
      <View style={S.root}>
        <AppStatusBar />
        <DashboardSkeleton />
      </View>
    );
  }

  if (!guard.allowed) {
    return <View style={S.center} />;
  }

  return (
    <View style={S.root}>
      <AppStatusBar />
      <ScreenHeader
        title={t('hub.screenEstimator')}
        subtitle={t('hub.subtitleEstimator')}
        titleAlign="start"
        paddingTop={54}
        edgeSlotWidth={48}
      />
      {runtimeError ? (
        <View style={S.errorBar}>
          <Ionicons name="warning-outline" size={14} color={theme.warning} />
          <Text style={S.errorBarText}>{runtimeError}</Text>
        </View>
      ) : null}

      <ScrollView
        style={S.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(); }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={S.kpiRow}>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{todayPlanned}</Text>
            <Text style={S.kpiLabel}>{t('hub.kpi.today')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{todayLeft}</Text>
            <Text style={S.kpiLabel}>{t('hub.kpi.left')}</Text>
          </View>
          <View style={S.kpiCard}>
            <Text style={S.kpiNum}>{todayDone.length}</Text>
            <Text style={S.kpiLabel}>{t('hub.kpi.done')}</Text>
          </View>
        </View>
        <View style={S.hintBox}>
          <Ionicons name="information-circle-outline" size={16} color={theme.info} />
          <Text style={S.hintText}>
            {todayTargetHint}
            {` • ${oddzialConfig.name}`}
          </Text>
        </View>

        {nextVisit ? (
          <PlatinumCard style={S.nextMissionCard}>
            <View style={S.nextMissionTop}>
              <View style={[S.nextMissionTime, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
                <Text style={S.nextMissionTimeText}>{visitTime(nextVisit.data_planowana)}</Text>
                <Text style={S.nextMissionTimeLabel}>teraz</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={S.nextMissionTitleRow}>
                  <Text style={S.nextMissionEyebrow}>Następna oględzina</Text>
                  <View style={[S.visitStatus, { backgroundColor: visitStatusColor(nextVisit.status, theme) + '22' }]}>
                    <Text style={[S.visitStatusText, { color: visitStatusColor(nextVisit.status, theme) }]}>
                      {visitStatusLabel(nextVisit.status)}
                    </Text>
                  </View>
                </View>
                <Text style={S.nextMissionClient} numberOfLines={1}>{nextVisit.klient_nazwa || `Oględziny #${nextVisit.id}`}</Text>
                <Text style={S.nextMissionAddress} numberOfLines={1}>
                  {[nextVisit.adres, nextVisit.miasto].filter(Boolean).join(', ') || 'Brak adresu'}
                </Text>
              </View>
            </View>

            {nextVisit.notatki ? (
              <Text style={S.nextMissionNote} numberOfLines={3}>{nextVisit.notatki}</Text>
            ) : null}

            <View style={S.missionScoreRow}>
              <View style={{ flex: 1 }}>
                <Text style={S.missionScoreTitle}>Pakiet do biura</Text>
                <Text style={S.missionScoreSub}>Kontakt, dojazd, zdjęcia/szkic i draft z ceną.</Text>
              </View>
              <View style={[S.missionScoreBadge, { borderColor: nextReadyCount >= nextChecks.length ? theme.success : theme.warning }]}>
                <Text style={[S.missionScoreValue, { color: nextReadyCount >= nextChecks.length ? theme.success : theme.warning }]}>
                  {nextReadyCount}/{nextChecks.length}
                </Text>
                <Text style={S.missionScoreLabel}>gotowe</Text>
              </View>
            </View>

            <View style={S.missionChecks}>
              {nextChecks.map((check) => (
                <TouchableOpacity
                  key={check.key}
                  style={[
                    S.missionCheck,
                    {
                      backgroundColor: check.done ? theme.successBg : theme.warningBg,
                      borderColor: check.done ? theme.success : theme.warning,
                    },
                  ]}
                  onPress={() => {
                    void triggerHaptic('light');
                    if (check.key === 'contact' && nextVisit.klient_telefon) void Linking.openURL(`tel:${nextVisit.klient_telefon}`);
                    else if (check.key === 'route') void openAddressInMaps(nextVisit.adres || '', nextVisit.miasto || '');
                    else if (check.key === 'media') openDocumentation(nextVisit);
                    else openDraftFromInspection(nextVisit);
                  }}
                >
                  <Ionicons name={check.done ? 'checkmark-circle' : check.icon} size={16} color={check.done ? theme.success : theme.warning} />
                  <View style={{ flex: 1 }}>
                    <Text style={S.missionCheckTitle}>{check.label}</Text>
                    <Text style={S.missionCheckHint} numberOfLines={1}>{check.hint}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <View style={S.nextMissionActions}>
              {nextVisit.klient_telefon ? (
                <TouchableOpacity style={S.nextMissionActionBtn} onPress={() => void Linking.openURL(`tel:${nextVisit.klient_telefon}`)}>
                  <Ionicons name="call-outline" size={15} color={theme.success} />
                  <Text style={[S.nextMissionActionText, { color: theme.success }]}>Dzwoń</Text>
                </TouchableOpacity>
              ) : null}
              {(nextVisit.adres || nextVisit.miasto) ? (
                <TouchableOpacity style={S.nextMissionActionBtn} onPress={() => void openAddressInMaps(nextVisit.adres || '', nextVisit.miasto || '')}>
                  <Ionicons name="map-outline" size={15} color={theme.info} />
                  <Text style={[S.nextMissionActionText, { color: theme.info }]}>Mapa</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={S.nextMissionActionBtn} onPress={() => openDocumentation(nextVisit)}>
                <Ionicons name="images-outline" size={15} color={theme.warning} />
                <Text style={[S.nextMissionActionText, { color: theme.warning }]}>Dowody</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.nextMissionActionBtn, S.nextMissionPrimary]} onPress={() => openDraftFromInspection(nextVisit)}>
                <Ionicons name="flash-outline" size={15} color={theme.accentText} />
                <Text style={S.nextMissionPrimaryText}>Draft do biura</Text>
              </TouchableOpacity>
            </View>
          </PlatinumCard>
        ) : null}

        <PlatinumCard style={S.section}>
          <View style={S.sectionHead}>
            <View style={{ flex: 1 }}>
              <Text style={S.sectionTitle}>Plan dnia specjalisty ds. wyceny</Text>
              <Text style={S.sectionSub}>Telefon, mapa i draft zlecenia bez przepisywania danych.</Text>
            </View>
            <TouchableOpacity
              style={S.sectionHeadBtn}
              onPress={() => {
                void triggerHaptic('light');
                router.push('/plan-ogledzin' as never);
              }}
            >
              <Text style={S.sectionHeadBtnText}>Trasa</Text>
            </TouchableOpacity>
          </View>
          {today.length === 0 ? (
            <View style={S.emptyPlan}>
              <Ionicons name="calendar-clear-outline" size={22} color={theme.textMuted} />
              <Text style={S.emptyPlanText}>Brak oględzin na dziś. Możesz od razu utworzyć szybki draft u klienta.</Text>
              <TouchableOpacity style={S.primarySmallBtn} onPress={() => router.push(buildNewOrderRoute({ source: 'wyceniajacy-hub' }) as never)}>
                <Ionicons name="flash-outline" size={15} color={theme.accentText} />
                <Text style={S.primarySmallBtnText}>Nowy draft</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={S.planList}>
              {today.map((item, index) => (
                <View key={item.id} style={S.visitCard}>
                  <View style={S.visitTop}>
                    <View style={S.visitIndex}>
                      <Text style={S.visitIndexText}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.visitClient} numberOfLines={1}>{item.klient_nazwa || `Oględziny #${item.id}`}</Text>
                      <Text style={S.visitMeta}>
                        {visitTime(item.data_planowana)}
                        {[item.adres, item.miasto].filter(Boolean).length ? ` • ${[item.adres, item.miasto].filter(Boolean).join(', ')}` : ''}
                      </Text>
                    </View>
                    <View style={[S.visitStatus, { backgroundColor: item.status === 'Zakonczone' ? theme.successBg : theme.infoBg }]}>
                      <Text style={[S.visitStatusText, { color: item.status === 'Zakonczone' ? theme.success : theme.info }]}>
                        {item.status === 'Zakonczone' ? 'gotowe' : 'plan'}
                      </Text>
                    </View>
                  </View>
                  <View style={S.visitActions}>
                    {item.klient_telefon ? (
                      <TouchableOpacity style={S.visitActionBtn} onPress={() => Linking.openURL(`tel:${item.klient_telefon}`)}>
                        <Ionicons name="call-outline" size={15} color={theme.success} />
                        <Text style={[S.visitActionText, { color: theme.success }]}>Dzwoń</Text>
                      </TouchableOpacity>
                    ) : null}
                    {(item.adres || item.miasto) ? (
                      <TouchableOpacity style={S.visitActionBtn} onPress={() => void openAddressInMaps(item.adres || '', item.miasto || '')}>
                        <Ionicons name="map-outline" size={15} color={theme.info} />
                        <Text style={[S.visitActionText, { color: theme.info }]}>Mapa</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={S.visitActionBtn} onPress={() => openDocumentation(item)}>
                      <Ionicons name="images-outline" size={15} color={theme.warning} />
                      <Text style={[S.visitActionText, { color: theme.warning }]}>Media</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[S.visitActionBtn, S.visitDraftBtn]} onPress={() => openDraftFromInspection(item)}>
                      <Ionicons name="flash-outline" size={15} color={theme.accentText} />
                      <Text style={S.visitDraftText}>Draft</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </PlatinumCard>

        <PlatinumCard style={S.section}>
          <Text style={S.sectionTitle}>{t('hub.quickActions')}</Text>
          <View style={S.grid}>
            <ActionTile label="Plan dnia" icon="navigate-outline" onPress={() => router.push('/plan-ogledzin' as never)} theme={theme} />
            <ActionTile label="Draft u klienta" icon="flash-outline" onPress={() => router.push(buildNewOrderRoute({ source: 'wyceniajacy-hub' }) as never)} theme={theme} />
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/ogledziny') ? (
              <ActionTile label={t('hub.action.inspectionList')} icon="search-outline" onPress={() => router.push('/ogledziny')} theme={theme} />
            ) : null}
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/wycena-kalendarz') ? (
              <ActionTile label={t('hub.action.quoteCalendar')} icon="calendar-outline" onPress={() => router.push('/wycena-kalendarz')} theme={theme} />
            ) : null}
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/wycena-kalendarz') ? (
              <ActionTile label={t('hub.action.newQuote')} icon="add-circle-outline" onPress={() => router.push('/wycena-kalendarz')} theme={theme} />
            ) : null}
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/wycena') ? (
              <ActionTile label={t('hub.action.photoDocs')} icon="camera-outline" onPress={() => router.push('/wycena')} theme={theme} />
            ) : null}
            {isFeatureEnabledForOddzial(sessionUser?.oddzial_id, '/wyceniajacy-finanse') ? (
              <ActionTile
                label={t('hub.action.estimatorPay')}
                icon="cash-outline"
                onPress={() => router.push('/wyceniajacy-finanse' as never)}
                theme={theme}
              />
            ) : null}
          </View>
        </PlatinumCard>

        <PlatinumCard style={S.section}>
          <Text style={S.sectionTitle}>{t('hub.workflowTitle')}</Text>
          <Text style={S.flowText}>{t('hub.flow1')}</Text>
          <Text style={S.flowText}>{t('hub.flow2')}</Text>
          <Text style={S.flowText}>{t('hub.flow3')}</Text>
          <Text style={S.flowText}>{t('hub.flow4')}</Text>
        </PlatinumCard>
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

function ActionTile({
  label,
  icon,
  onPress,
  theme,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <TouchableOpacity
      style={[stylesAction.tile, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}
      onPress={() => {
        void triggerHaptic('light');
        onPress();
      }}
    >
      <Ionicons name={icon} size={20} color={theme.accent} />
      <Text style={[stylesAction.label, { color: theme.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const stylesAction = StyleSheet.create({
  tile: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 8,
  },
  label: { fontSize: 12, fontWeight: '700', textAlign: 'center', letterSpacing: 0 },
});

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  scroll: { flex: 1 },
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
  kpiRow: { flexDirection: 'row', gap: 8, padding: 12 },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 12,
    backgroundColor: t.cardBg,
    padding: 12,
    alignItems: 'center',
  },
  kpiNum: { fontSize: 20, fontWeight: '900', color: t.accent, letterSpacing: 0 },
  kpiLabel: { fontSize: 11, color: t.textSub, marginTop: 2 },
  hintBox: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 10,
    padding: 10,
    backgroundColor: t.surface2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hintText: { fontSize: 12, color: t.textSub, fontWeight: '700' },
  nextMissionCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 16,
    backgroundColor: t.cardBg,
    padding: 12,
    gap: 12,
  },
  nextMissionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nextMissionTime: {
    width: 64,
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  nextMissionTimeText: { color: t.accent, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  nextMissionTimeLabel: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginTop: 2 },
  nextMissionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  nextMissionEyebrow: { color: t.textMuted, flex: 1, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  nextMissionClient: { color: t.text, fontSize: 16, fontWeight: '900' },
  nextMissionAddress: { color: t.textSub, fontSize: 12, marginTop: 2 },
  nextMissionNote: {
    color: t.textSub,
    fontSize: 12,
    lineHeight: 17,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.surface2,
    padding: 10,
  },
  missionScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  missionScoreTitle: { color: t.text, fontSize: 13, fontWeight: '900' },
  missionScoreSub: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  missionScoreBadge: {
    minWidth: 58,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: t.surface2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  missionScoreValue: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  missionScoreLabel: { color: t.textMuted, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  missionChecks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  missionCheck: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 138,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  missionCheckTitle: { color: t.text, fontSize: 12, fontWeight: '900' },
  missionCheckHint: { color: t.textMuted, fontSize: 10.5, marginTop: 1 },
  nextMissionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nextMissionActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  nextMissionActionText: { fontSize: 12, fontWeight: '900' },
  nextMissionPrimary: { backgroundColor: t.accent, borderColor: t.accentDark, marginLeft: 'auto' },
  nextMissionPrimaryText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  section: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 12,
    backgroundColor: t.cardBg,
    padding: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: t.text, marginBottom: 10, letterSpacing: 0 },
  sectionSub: { color: t.textMuted, fontSize: 12, lineHeight: 17 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  sectionHeadBtn: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sectionHeadBtnText: { color: t.textSub, fontSize: 12, fontWeight: '800' },
  emptyPlan: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    alignItems: 'flex-start',
  },
  emptyPlanText: { color: t.textSub, fontSize: 13, lineHeight: 18 },
  primarySmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: t.accent,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  primarySmallBtnText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  planList: { gap: 10 },
  visitCard: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    borderRadius: 13,
    padding: 11,
    gap: 10,
  },
  visitTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  visitIndex: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitIndexText: { color: t.accent, fontWeight: '900', fontSize: 13 },
  visitClient: { color: t.text, fontSize: 14, fontWeight: '900' },
  visitMeta: { color: t.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  visitStatus: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  visitStatusText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  visitActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  visitActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  visitActionText: { fontSize: 12, fontWeight: '800' },
  visitDraftBtn: { backgroundColor: t.accent, borderColor: t.accentDark, marginLeft: 'auto' },
  visitDraftText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flowText: { fontSize: 13, color: t.textSub, marginBottom: 6, lineHeight: 19 },
});
