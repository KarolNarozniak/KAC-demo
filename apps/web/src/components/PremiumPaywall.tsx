import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { AuthUser } from '../domain/auth';
import { getPremiumCampaign, redeemPremiumCode, type PremiumCampaignConfig } from '../services/authApi';
import { Button, useTheme } from './ui';
import PremiumCrown from './PremiumCrown';

type Props = { visible: boolean; user: AuthUser; onClose: (redeemed?: boolean) => void; onUserUpdated: (user: AuthUser) => void };

const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString('pl-PL') : null;
const durationText = (days: number) => days === 365 ? '12 miesięcy' : `${days} dni`;

export default function PremiumPaywall({ visible, user, onClose, onUserUpdated }: Props) {
  const { palette, styles } = useTheme();
  const { width, height } = useWindowDimensions();
  const [campaign, setCampaign] = useState<PremiumCampaignConfig | null>(null);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setCampaignLoading(true); setError('');
    void getPremiumCampaign().then((result) => { if (active) setCampaign(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać informacji o Premium.'); })
      .finally(() => { if (active) setCampaignLoading(false); });
    return () => { active = false; };
  }, [visible]);

  const redeem = async () => {
    if (busy || !campaign?.available || campaign.redeemedByAccount || !code.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await redeemPremiumCode(code);
      onUserUpdated(result.user);
      setCode('');
      onClose(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się aktywować kodu. Spróbuj ponownie.');
    } finally { setBusy(false); }
  };

  const activeUntil = formatDate(user.premiumExpiresAt);
  const campaignEnds = campaign?.available ? formatDate(campaign.campaignEndsAt) : null;
  const compact = width < 600;
  const maxWidth = Math.min(520, Math.max(280, width - 24));
  const maxHeight = Math.max(320, height - 32);

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onClose(false)} statusBarTranslucent>
    <View style={{ flex: 1, backgroundColor: palette.scrim, justifyContent: 'center', alignItems: 'center', padding: 12 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', maxWidth }}>
        <View style={{ maxHeight, borderRadius: 22, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, overflow: 'hidden' }}>
          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: compact ? 16 : 22, gap: compact ? 10 : 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><PremiumCrown size={22} /><Text style={styles.heading}>KAC Premium</Text></View>
                  <Text style={[styles.body, { marginTop: 8, fontWeight: '700' }]}>{campaign?.available ? campaign.campaignName : 'Odblokuj funkcje AI'}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Zamknij ofertę Premium" onPress={() => onClose(false)}
                style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.surfaceAlt }}>
                <Text style={{ color: palette.ink, fontSize: 22, lineHeight: 26 }}>×</Text>
              </Pressable>
            </View>

            {user.isPremium && <View style={{ padding: 12, borderRadius: 12, backgroundColor: palette.greenSoft }}>
              <Text style={styles.body}>Premium jest aktywne{activeUntil ? ` do ${activeUntil}` : ''}.</Text>
            </View>}

            <Text style={styles.body}>Odblokuj funkcje Premium:</Text>
            {[
              'Asystent AI i zatwierdzane przez Ciebie propozycje do kalendarza',
              'Podsumowanie dnia przygotowane przez AI',
              'Odczyt AI planu zajęć i grafiku pracy z PDF, PNG lub JPG',
            ].map((benefit) => <View key={benefit} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
              <PremiumCrown size={13} /><Text style={[styles.body, { flex: 1 }]}>{benefit}</Text>
            </View>)}

            <View style={{ padding: compact ? 10 : 12, borderRadius: 12, backgroundColor: palette.surfaceAlt, gap: compact ? 4 : 6 }}>
              <Text style={styles.muted}>Korona oznacza funkcję Premium. Rozmowy, kalendarz i wybrane pliki są przetwarzane przez Azure AI; oryginały importu nie są przechowywane w bazie KAC.</Text>
              <Text style={styles.muted}>Kod aktywuje Premium na {campaign ? durationText(campaign.durationDays) : '12 miesięcy'}. Brak płatności i automatycznego odnowienia w aplikacji.</Text>
              {campaignEnds && <Text style={[styles.muted, { fontWeight: '700' }]}>Kod z kampanii można wykorzystać do {campaignEnds}.</Text>}
            </View>

            {campaignLoading && <View style={{ alignItems: 'center', padding: 12, gap: 8 }}><ActivityIndicator color={palette.blue} /><Text style={styles.muted}>Pobieranie informacji o kampanii…</Text></View>}
            {!campaignLoading && (!campaign?.available || campaign.redeemedByAccount) && <View style={{ padding: 12, borderRadius: 12, backgroundColor: palette.amberSoft }}>
                <Text style={styles.body}>{error || (campaign?.redeemedByAccount ? 'To konto wykorzystało już kod z tej kampanii.' : 'Kody aktywacyjne Black Friday nie są obecnie dostępne.')}</Text>
              </View>}
          </ScrollView>
          {!campaignLoading && campaign?.available && !campaign.redeemedByAccount && <View style={{ paddingHorizontal: compact ? 16 : 22, paddingTop: 10, paddingBottom: compact ? 16 : 22, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.surface }}>
            <Text style={[styles.label, { marginBottom: 7 }]}>KOD AKTYWACYJNY</Text>
            <TextInput accessibilityLabel="Kod aktywacyjny Premium" value={code} onChangeText={(value) => { setCode(value); setError(''); }}
              autoCapitalize="characters" autoCorrect={false} maxLength={128} editable={!busy}
              placeholder="Wpisz kod" placeholderTextColor={palette.placeholder}
              onSubmitEditing={() => void redeem()} style={[styles.input, { borderColor: error ? palette.red : palette.line }]} />
            {!!error && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 7 }]}>{error}</Text>}
            <Button title={busy ? 'Aktywowanie…' : user.isPremium ? 'Przedłuż Premium kodem' : 'Aktywuj Premium'}
              primary disabled={busy || !code.trim()} onPress={() => void redeem()} />
          </View>}
        </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}
